/* RATE LIMITS - money & abuse protection on write/spend endpoints.
   Proves the reusable limiter blocks per-minute floods AND per-day totals, and
   that the endpoints wired to it (handoff, market publish/message, crew jobs,
   sync, widget) actually return 429 when hammered. A limit that isn't enforced
   is worthless - these enforce. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withFrozenClock } from '../lib/clock.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'ratelimit.harness.mjs');
writeFileSync(harness, src +
  '\nexport { limitAction, guardAction, handoffCreate, marketPublish, marketMessage, crewJobs, syncPush };' +
  '\nexport function __setRequireUser(fn){ requireUser = fn; }\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = { AMV_KV: {
  async get(k){ return store.has(k)?store.get(k):null; },
  async put(k,v){ store.set(k,v); },
  async delete(k){ store.delete(k); },
  async list({prefix}){ return { keys:[...store.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})), list_complete:true }; }
}};

/* ── The core limiter ─────────────────────────────────────────────────────── */
section('limitAction blocks a per-minute flood');

let allowed = 0, blocked = 0;
/* Pinned: this asserts EXACTLY 5 allowed, so a minute boundary landing inside
   the loop starts a second bucket and lets a sixth through. */
await withFrozenClock(async () => {
  for (let i = 0; i < 10; i++) {
    const r = await W.limitAction(env, 'flood:user@test.com', 5, 0);   // 5/min, no daily cap
    r.ok ? allowed++ : blocked++;
  }
});
ok(allowed === 5, 'exactly 5 calls are allowed in the minute', allowed);
ok(blocked === 5, 'the 6th onward are blocked', blocked);

section('limitAction enforces a daily cap independent of the minute rate');

store.clear();
let dayAllowed = 0;
// generous per-minute (100) but a daily cap of 3 - the day cap must bite
await withFrozenClock(async () => {
  for (let i = 0; i < 8; i++) {
    const r = await W.limitAction(env, 'daily:user@test.com', 100, 3);
    if (r.ok) dayAllowed++;
  }
});
ok(dayAllowed === 3, 'only 3 calls allowed for the day, then blocked', dayAllowed);

section('guardAction returns a real 429 response when blocked');

store.clear();
let first = await W.guardAction(env, 'g:user@test.com', 2, 0, 'things');
ok(first === null, 'first call is allowed (returns null = proceed)', first);
await W.guardAction(env, 'g:user@test.com', 2, 0, 'things');   // 2nd
const third = await W.guardAction(env, 'g:user@test.com', 2, 0, 'things');
ok(third !== null && third.status === 429, 'the 3rd call returns a 429 response', third && third.status);

/* ── Endpoints actually enforce it ────────────────────────────────────────── */
section('handoffCreate is rate limited (spam guard on cross-user writes)');

store.clear();
W.__setRequireUser(async () => ({ email: 'sender@test.com' }));
const hReq = () => new Request('https://x', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ title:'t', context:'c', to:'target@test.com' }) });
let h429 = 0;
await withFrozenClock(async () => {
  for (let i = 0; i < 15; i++) { const r = await W.handoffCreate(hReq(), env); if (r.status === 429) h429++; }
});
ok(h429 > 0, 'flooding handoffs eventually returns 429', h429);

section('marketPublish is rate limited (listing spam guard)');

store.clear();
W.__setRequireUser(async () => ({ email: 'seller@test.com' }));
const pReq = () => new Request('https://x', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ title:'Thing', price:0, kind:'prompt', body:'x' }) });
let p429 = 0;
for (let i = 0; i < 10; i++) { const r = await W.marketPublish(pReq(), env); if (r.status === 429) p429++; }
ok(p429 > 0, 'flooding listings eventually returns 429', p429);

section('marketMessage is rate limited (harassment/spam guard)');

store.clear();
W.__setRequireUser(async () => ({ email: 'msgr@test.com' }));
const mReq = () => new Request('https://x', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ to:'victim@test.com', text:'hi' }) });
let m429 = 0;
for (let i = 0; i < 25; i++) { const r = await W.marketMessage(mReq(), env); if (r.status === 429) m429++; }
ok(m429 > 0, 'flooding messages eventually returns 429', m429);

section('syncPush is rate limited (KV write-hammer guard)');

store.clear();
W.__setRequireUser(async () => ({ email: 'syncer@test.com' }));
const sReq = () => new Request('https://x', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ data: { amv_test: '1' } }) });
let s429 = 0;
await withFrozenClock(async () => {
  for (let i = 0; i < 70; i++) { const r = await W.syncPush(sReq(), env); if (r.status === 429) s429++; }
});
ok(s429 > 0, 'hammering sync eventually returns 429 (protects KV write costs)', s429);

section('A normal amount of use is NOT blocked');

store.clear();
W.__setRequireUser(async () => ({ email: 'normal@test.com' }));
let normalOk = true;
/* Frozen too, which makes this STRICTER rather than looser: all three land in
   one window, so it proves a few requests in a row are fine even at their most
   concentrated. */
await withFrozenClock(async () => {
  for (let i = 0; i < 3; i++) { const r = await W.handoffCreate(hReq(), env); if (r.status === 429) normalOk = false; }
});
ok(normalOk, 'a few handoffs in a row are fine - limits do not punish real use', normalOk);

/* ── A LIMITER THAT STOPS LIMITING AND SAYS NOTHING ─────────────────────────

   Found by a CI run, not by reading: forty-five simultaneous sign-in attempts
   from one address, forty-five reached password hashing, none refused.

   The cause is that the Durable Object call FAILED while its namespace was
   bound, and rateCheck was the one operation left out of the rule that covers
   claim and reserve - so it fell back to a KV counter, which is a read
   followed by a write. That is the precise race the Durable Object exists to
   close: every one of the forty-five read zero before any of them wrote one.
   Not a loose limit. No limit.

   It hid for so long because nearly every caller also passes a daily cap, and
   that second call is a reserve, which already answered "unavailable" a line
   later. Exactly one caller has no daily cap - /crew/popular, public and
   unauthenticated, the single route whose own comment calls it the one worth
   hammering - so it was the one endpoint relying on the racy check alone.

   Both halves are asserted: that concurrency really does defeat the fallback
   (or this test proves nothing), and that a bound namespace no longer takes
   it. */
section('A rate limit whose counter is broken says so instead of passing everything');

/* Bound, and every call to it fails. This is the CI condition, and it is
   different from having no Durable Object at all. */
const failingDO = { idFromName: n => n, get: () => ({ async fetch(){ throw new Error('DO unreachable'); } }) };
/* Slow enough to interleave, which is what a real store does and what a
   synchronous Map hides. A fallback that only looks safe because JavaScript
   happens to run it in one go is the thing being tested. */
const slowStore = new Map();
const slowKV = {
  async get(k){ await new Promise(r=>setTimeout(r,1)); return slowStore.has(k)?slowStore.get(k):null; },
  async put(k,v){ await new Promise(r=>setTimeout(r,1)); slowStore.set(k,v); },
  async delete(k){ slowStore.delete(k); },
  async list({prefix}){ return { keys:[], list_complete:true }; },
};

{
  /* First: the fallback really is racy, so the fix is not guarding against an
     imaginary problem. No AMV_COUNTER here - the development-machine path,
     which keeps its fallback on purpose. */
  const devEnv = { AMV_KV: slowKV };
  const burst = await Promise.all(Array.from({ length: 45 },
    () => W.limitAction(devEnv, 'race:one-address', 30, 0)));
  const allowed = burst.filter(r => r.ok).length;
  ok(allowed > 30,
     'the KV fallback really does let a concurrent burst past its cap - otherwise this proves nothing',
     allowed);
}

{
  slowStore.clear();
  /* Now the same burst with the namespace BOUND and failing. No caller here
     passes a daily cap, which is exactly /crew/popular's shape - so nothing
     else can rescue the answer. */
  const brokenEnv = { AMV_KV: slowKV, AMV_COUNTER: failingDO };
  const burst = await Promise.all(Array.from({ length: 45 },
    () => W.limitAction(brokenEnv, 'race:one-address', 30, 0)));
  const allowed = burst.filter(r => r.ok).length;
  const unavailable = burst.filter(r => r.unavailable).length;
  ok(allowed === 0,
     'a bound-but-failing counter allows nothing through on a promise it cannot keep', allowed);
  ok(unavailable === 45,
     'and says the ceiling could not be evaluated, rather than reporting success', unavailable);

  /* guardAction turns that into the honest answer rather than "slow down",
     which would blame the caller for a fault on this side. */
  const res = await W.guardAction(brokenEnv, 'race:one-address', 30, 0, 'this');
  ok(res && res.status === 503, 'the caller gets 503, not 429 and not a silent pass', res && res.status);
}

{
  /* And a working counter is untouched: the fix must not make a healthy
     limiter refuse. */
  let n = 0;
  /* counter() calls stub.fetch(url, init) - a string and an init object, not
     a Request - so the double has to read init.body. Getting that wrong made
     this double throw, which the code then correctly reported as a broken
     counter: the double was the fault, and it looked exactly like the bug. */
  const goodDO = { idFromName: k => k, get: () => ({ async fetch(_url, init){
    const p = JSON.parse((init && init.body) || '{}');
    if (p.op === 'rateCheck') { n++; return new Response(JSON.stringify({ allowed: n <= p.limit, count: n })); }
    return new Response(JSON.stringify({ allowed: true, value: 0 }));
  } }) };
  const goodEnv = { AMV_KV: slowKV, AMV_COUNTER: goodDO };
  const first = await W.limitAction(goodEnv, 'race:healthy', 30, 0);
  ok(first.ok === true, 'a healthy counter still lets normal use through', first);
}

report();
done();
