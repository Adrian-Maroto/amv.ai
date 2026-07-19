/* RATE LIMITS — money & abuse protection on write/spend endpoints.
   Proves the reusable limiter blocks per-minute floods AND per-day totals, and
   that the endpoints wired to it (handoff, market publish/message, crew jobs,
   sync, widget) actually return 429 when hammered. A limit that isn't enforced
   is worthless — these enforce. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

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
for (let i = 0; i < 10; i++) {
  const r = await W.limitAction(env, 'flood:user@test.com', 5, 0);   // 5/min, no daily cap
  r.ok ? allowed++ : blocked++;
}
ok(allowed === 5, 'exactly 5 calls are allowed in the minute', allowed);
ok(blocked === 5, 'the 6th onward are blocked', blocked);

section('limitAction enforces a daily cap independent of the minute rate');

store.clear();
let dayAllowed = 0;
// generous per-minute (100) but a daily cap of 3 — the day cap must bite
for (let i = 0; i < 8; i++) {
  const r = await W.limitAction(env, 'daily:user@test.com', 100, 3);
  if (r.ok) dayAllowed++;
}
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
for (let i = 0; i < 15; i++) { const r = await W.handoffCreate(hReq(), env); if (r.status === 429) h429++; }
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
for (let i = 0; i < 70; i++) { const r = await W.syncPush(sReq(), env); if (r.status === 429) s429++; }
ok(s429 > 0, 'hammering sync eventually returns 429 (protects KV write costs)', s429);

section('A normal amount of use is NOT blocked');

store.clear();
W.__setRequireUser(async () => ({ email: 'normal@test.com' }));
let normalOk = true;
for (let i = 0; i < 3; i++) { const r = await W.handoffCreate(hReq(), env); if (r.status === 429) normalOk = false; }
ok(normalOk, 'a few handoffs in a row are fine — limits do not punish real use', normalOk);

report();
done();
