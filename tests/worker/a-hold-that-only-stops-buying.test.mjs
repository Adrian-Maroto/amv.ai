/* THE BLOCK STOPPED THEM BUYING AND DID NOTHING ABOUT THEM SPENDING.

   `_abuseRecord` sets `blocked` on an account when a chargeback lands, or when
   refunds form a pattern. That flag is the product's verdict that this person
   takes their money back after taking the compute, which is the scam the whole
   anti-abuse register was written around.

   It was read in exactly two places: whether a new checkout could start, and
   whether a referral paid out. Neither of those is where the money goes.

   So a blocked account went on calling the model, generating images, generating
   video, texting, serving a widget on a public website and running scheduled
   work every hour - every one of them an invoice AMV pays a provider - and it
   could still withdraw marketplace earnings to a PayPal address on the way out.
   The one thing it could not do was pay AMV again.

   Two halves have to hold for that to be fixed, and only the first is obvious:

     1. every path that spends has to ASK. There are five, and one of them is
        the cron, where nobody is watching and the bill is the first news.
     2. the flag has to SURVIVE. It rides on the entitlement so the hot path can
        read it for free, and setEntitlement REPLACES that record - so without
        carrying it, the next renewal, upgrade or webhook silently unblocks the
        account. The very next thing somebody in that position does is pay
        again, which would have cleared it.

   The roster of spending paths below is COMPUTED, not typed. A path that spends
   an account's money is one that asks that account's dollar counter for
   permission; that is what makes it a spending path, and a sixth one added next
   year appears here without anybody remembering to add it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { functionBody, codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'hold.harness.mjs');
writeFileSync(harness, src +
  '\nexport { DB, setEntitlement, todayKey, _abuseRecord, _abuseStatus, _accountHold, runDueAutomations, ACCOUNT_HOLD_MESSAGE };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

/* ── the roster, computed from the source ──────────────────────────────────
   Every place that asks an account's dollar counter for permission, and the
   function it is in. `checkCap` is the operation that means "may I spend this
   person's money" - a `get` is a report reading somebody else's total and an
   `incr` is the bill after the fact, so neither is a path that can be stopped.
   Comments stripped first: a prefix named in a paragraph is not a counter. */
const code = codeOnly(src);
const decls = [...code.matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/gm)]
  .map(m => ({ name: m[1], at: m.index }));
const enclosing = (i) => {
  let last = '';
  for (const d of decls) { if (d.at <= i) last = d.name; else break; }
  return last;
};
/* The counter name is built on one line and used on another - chat builds
   `costName` forty lines before it asks with it - so this pairs a `cost:`
   counter name with the checkCap that follows it inside the SAME function
   rather than assuming they are adjacent. */
const SPENDERS = new Set();
for (const m of code.matchAll(/`cost:\$\{/g)) {
  const fn = enclosing(m.index);
  if (!fn) continue;
  const body = codeOnly(functionBody(src, fn));
  if (/op:\s*'checkCap'/.test(body)) SPENDERS.add(fn);
}

section('The paths that spend an account’s money were found');
{
  ok(SPENDERS.size >= 5,
     'every path that asks an account’s dollar counter for permission is known', [...SPENDERS]);
  /* Named, because the whole defect was that four of these five were not
     considered. If the derivation narrows, it must not narrow back to the
     blind spot it was written for. */
  ['_spendGate', 'aiProxy', 'widgetChat', 'smsIncoming', 'runDueAutomations'].forEach(fn => {
    ok(SPENDERS.has(fn), fn + ' is counted as a path that spends', fn);
  });
}

section('Every one of them consults the hold before spending');
{
  /* Three accepted spellings, because they are three different situations and
     collapsing them would mean lying about one of them:
       _accountHold   returns the refusal to hand back to a caller
       _spendGate     the shared gate, which asks _accountHold itself
       ent.blocked    the cron, which has no request to refuse - it skips the
                      account and moves to the next one
     Each is proven to really refuse below, so accepting a name here is a claim
     with evidence rather than a name somebody added to go green. */
  const CONSULTS = /_accountHold\(|_spendGate\(|\.blocked\b/;
  const deaf = [...SPENDERS].filter(fn => !CONSULTS.test(codeOnly(functionBody(src, fn))));
  ok(deaf.length === 0,
     'no path can spend an account’s money without asking whether it is held', deaf);
}

section('And each name accepted as "asks" actually refuses');
{
  const hold = codeOnly(functionBody(src, '_accountHold'));
  ok(/subject\.blocked/.test(hold), '_accountHold reads the flag', true);
  ok(/403/.test(hold), 'and answers 403 - a decision, not a limit that resets', true);
  ok(/account_blocked/.test(hold), 'with a code the client can act on', true);

  const gate = codeOnly(functionBody(src, '_spendGate'));
  const hIdx = gate.indexOf('_accountHold'), cIdx = gate.indexOf('checkCap');
  ok(hIdx > 0 && cIdx > hIdx,
     '_spendGate asks the hold BEFORE it asks the ceiling', { hIdx, cIdx });

  /* The cron's is a `continue`, not a return, and it must come before the
     account's budget is worked out or it is doing the lookups it exists to
     avoid. */
  const cron = codeOnly(functionBody(src, 'runDueAutomations'));
  const bIdx = cron.indexOf('ent.blocked'), sIdx = cron.indexOf('_billingSubjectOf');
  ok(bIdx > 0 && sIdx > bIdx, 'the cron skips a held account before costing it', { bIdx, sIdx });
  ok(/continue/.test(cron.slice(bIdx, bIdx + 220)), 'and moves on to the next account', true);
}

section('The flag survives a plan change, which is the one thing they will do next');
{
  /* setEntitlement REPLACES the record. ENT_CARRY_KEYS is the list of fields
     that survive that, and this is asserted against the source rather than
     only through behaviour because the behavioural test below can be satisfied
     by one code path while a second write still drops it. */
  const carry = (src.match(/ENT_CARRY_KEYS\s*=\s*\[([\s\S]*?)\]/) || [])[1] || '';
  ['blocked', 'blockedReason', 'blockedAt'].forEach(k => {
    ok(new RegExp("'" + k + "'").test(carry), k + ' is carried across a plan change', k);
  });
}

/* ── and now the same claims, against the running Worker ───────────────── */

const PROVIDER = { chat: 0, image: 0, video: 0 };
globalThis.fetch = async (url) => {
  const u = String(url);
  if (/image\.example/.test(u)) { PROVIDER.image++; return new Response(JSON.stringify({ data: [{ b64_json: 'AA' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  if (/video\.example/.test(u)) { PROVIDER.video++; return new Response(JSON.stringify({ id: 'p1' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  if (/model\.example/.test(u)) {
    PROVIDER.chat++;
    return new Response('data: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
};

function mkEnv() {
  const m = new Map(), vals = new Map();
  return {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', ADMIN_TOKEN: 'admin-secret', APP_URL: 'https://amv.test',
    GLOBAL_DAILY_USD_CAP: '500',
    AMV_MODEL_KEY: 'mk', MODEL_API_URL: 'https://model.example/v1',
    IMAGE_API_URL: 'https://image.example/v1', IMAGE_API_KEY: 'k',
    VIDEO_API_URL: 'https://video.example/v1', VIDEO_API_KEY: 'k', VIDEO_MODEL: 'v1',
    _map: m, _vals: vals,
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: all.slice(0, limit || 1000), list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (x) => x,
      get: (x) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(x) || 0;
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: cur < b.cap, value: cur }));
        if (b.op === 'incr') { vals.set(x, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(x) })); }
        if (b.op === 'reserve') {
          const next = cur + (b.amount || 0);
          if (b.cap && next > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
          vals.set(x, next); return new Response(JSON.stringify({ allowed: true, value: next }));
        }
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        if (b.op === 'rateCheck') { vals.set(x, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        if (b.op === 'claim') { if (vals.has('c:' + x)) return new Response(JSON.stringify({ claimed: false })); vals.set('c:' + x, 1); return new Response(JSON.stringify({ claimed: true })); }
        if (b.op === 'release') { vals.delete('c:' + x); return new Response(JSON.stringify({ ok: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); this._p = []; } };
const PW = 'A-real-Passw0rd!';
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '70.0.0.' + Math.floor(Math.random() * 250),
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b, t) => { const r = await call(env, p, b, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const signup = async (env, email) => (await (await call(env, '/auth/signup', { email, name: 'N', password: PW })).json()).token;
const entOf = async (env, email) => (await W.DB.get(env, 'ent', email)) || {};

const SELLER = 'held@test.com';
const env = mkEnv();
const tok = await signup(env, SELLER);
/* Old enough to touch money, or the withdrawal below is refused for a reason
   that has nothing to do with the hold. */
await W.DB.put(env, 'consent', SELLER, { birthYear: 1990, termsVersion: '1' });
await W.setEntitlement(env, SELLER, 'pro', { source: 'stripe' });

section('A chargeback marks the account where the spending paths can see it');
{
  await W._abuseRecord(env, SELLER, 'dispute', { amount: 2000 });
  const status = await W._abuseStatus(env, SELLER);
  ok(status.blocked === true, 'the abuse record says blocked', status.blocked);
  const e = await entOf(env, SELLER);
  ok(e.blocked === true,
     'and so does the entitlement, which every request reads anyway', e.blocked);
  ok(e.blockedReason === 'chargeback', 'with the reason recorded for an operator', e.blockedReason);
}

section('Nothing that costs money will run for it');
{
  PROVIDER.chat = PROVIDER.image = PROVIDER.video = 0;

  const chat = await post(env, '/v1/messages', { messages: [{ role: 'user', content: 'hello' }] }, tok);
  ok(chat.status === 403, 'chat refuses', chat.status);
  ok(chat.body.code === 'account_blocked', 'and says why in a code the client can act on', chat.body.code);

  const img = await post(env, '/v1/image/generate', { prompt: 'a house' }, tok);
  ok(img.status === 403, 'image generation refuses', img.status);
  ok(img.body.code === 'account_blocked', 'with the same code', img.body.code);

  const vid = await post(env, '/v1/video/generate', { prompt: 'a house', seconds: 5 }, tok);
  ok(vid.status === 403, 'video refuses', vid.status);
  ok(vid.body.code === 'account_blocked', 'with the same code', vid.body.code);

  await ctx.settle();
  /* The point of all three. A refusal that still called the provider has cost
     AMV the money it was written to save. */
  ok(PROVIDER.chat === 0 && PROVIDER.image === 0 && PROVIDER.video === 0,
     'and no provider was called, so nothing was billed to AMV', PROVIDER);
}

section('And it cannot take money out on the way past');
{
  const w = await post(env, '/v1/market/withdraw', { destination: 'paypal@test.com' }, tok);
  ok(w.status === 403, 'a withdrawal is refused', w.status);
  ok(w.body.code === 'account_blocked',
     'for the hold, not for one of the other reasons a withdrawal can fail', w.body.code);
}

section('Paying again does not clear it - which is the first thing they would try');
{
  /* A renewal, an upgrade, a webhook: all of them go through setEntitlement,
     which REPLACES the record. This is the write that used to unblock the
     account without anybody deciding to. */
  await W.setEntitlement(env, SELLER, 'max', { source: 'stripe' });
  const e = await entOf(env, SELLER);
  ok(e.plan === 'max', 'the plan really did change', e.plan);
  ok(e.blocked === true, 'and the hold survived it', e.blocked);

  const chat = await post(env, '/v1/messages', { messages: [{ role: 'user', content: 'hello' }] }, tok);
  ok(chat.status === 403, 'so the upgraded account still cannot spend', chat.status);
}

section('The cron does not run its scheduled work either');
{
  /* Two accounts, both with work due right now, one held. The tick is the path
     where this matters most: unattended, hourly, and the first anybody hears
     of it is the invoice. */
  const FREE = 'notheld@test.com';
  await signup(env, FREE);
  const due = Date.now() - 60000;
  const job = (email) => W.DB.put(env, 'auto', email,
    { items: [{ id: 'j1', detail: 'check the news', kind: 'task', repeat: 'daily',
                active: true, next: due, approval: 'auto', notify: 'app', results: [] }] });
  await job(SELLER); await job(FREE);

  await W.runDueAutomations(env, Date.now());

  const heldRec = await W.DB.get(env, 'auto', SELLER);
  const freeRec = await W.DB.get(env, 'auto', FREE);
  ok(heldRec.items[0].next === due,
     'the held account’s job was not touched, so it did not run', heldRec.items[0].next === due);
  ok(freeRec.items[0].next !== due,
     'while an ordinary account’s job did - so the tick still works', freeRec.items[0].next !== due);
}

section('An operator can lift it, and everything works again');
{
  const r = await call(env, '/admin/abuse/clear', { email: SELLER }, null);
  ok(r.status === 403, 'clearing needs the admin token', r.status);

  const cleared = await worker.fetch(new Request('https://api.amv.test/admin/abuse/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'admin-secret', 'CF-Connecting-IP': '70.0.0.9' },
    body: JSON.stringify({ email: SELLER }),
  }), env, ctx);
  ok(cleared.status === 200, 'and with it, the flag is lifted', cleared.status);

  const e = await entOf(env, SELLER);
  ok(!e.blocked,
     'the entitlement is unblocked too, not just the abuse record', e.blocked);

  PROVIDER.chat = 0;
  const chat = await post(env, '/v1/messages', { messages: [{ role: 'user', content: 'hello' }] }, tok);
  ok(chat.status !== 403 || chat.body.code !== 'account_blocked',
     'and the account can spend again - a false positive is not a life sentence',
     { status: chat.status, code: chat.body.code });
}

section('The refusal says enough and no more');
{
  ok(!/chargeback|refund|dispute|fraud/i.test(W.ACCOUNT_HOLD_MESSAGE),
     'the message does not tell somebody probing which signal tripped', W.ACCOUNT_HOLD_MESSAGE);
  ok(/support/i.test(W.ACCOUNT_HOLD_MESSAGE),
     'but it does tell an honest person where to go', true);
}

if (report('a-hold-that-only-stops-buying') > 0) process.exitCode = 1;
done();
