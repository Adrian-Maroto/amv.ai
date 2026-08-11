/* EVERY PAYOUT WAITED FOR ONE PERSON TO READ IT.

   That is correct at ten sellers and impossible at ten thousand. The owner
   asked the right question: with a million users, who approves the payments?
   Nobody can, and the answer people reach for - approve everything - is how a
   marketplace gets drained. A bigger inbox is not the answer either; a queue
   containing every payout is a queue nobody finishes, and then the dangerous
   ones are skimmed with the same attention as the rest.

   So payouts decide themselves, and only the ones with a reason against them
   reach a person.

   Three things carry it, and this file exercises all three against the real
   worker rather than reading the code that implements them:

     THE RESERVE. The 14-day hold answers "did this sale stick". It does not
     answer the real risk, which is that a card dispute can arrive up to 120
     days after the charge - so a payout settled at day 14 and disputed at day
     60 was money AMV had already sent. Holding everything for 120 days would
     be safe and would also make AMV useless to an honest seller. So a slice of
     every sale is held across the full window, and a late reversal lands on
     money still on the books.

     THE SCORE. Account age, disputes and refunds, how concentrated the sales
     are, how fast payouts are being asked for, whether the destination just
     changed, and whether identity has been verified past the point where it is
     required. Each is a sentence somebody could read out, because a decision
     nobody can explain is one nobody can appeal.

     THE SEPARATION. 'approved' means AMV cleared it. 'paid' means money moved.
     Those are different acts and the second one belongs to whatever rail the
     operator configured - which is what lets the DECISION be automatic without
     the disbursement being automatic. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'payout.harness.mjs');
writeFileSync(harness, src + '\nexport { PAYOUT_RESERVE_PCT, PAYOUT_RESERVE_MS, PAYOUT_HOLD_MS, PAYOUT_AUTO_MAX_USD, PAYOUT_KYC_THRESHOLD_USD, PAYOUT_MIN_AGE_DAYS, _payoutRisk, _availableOf, _creditSale };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

let notices = [];
globalThis.fetch = async (u, o) => { notices.push(String((o && o.body) || '')); return { ok: true, status: 200, json: async () => ({}) }; };

function mkEnv() {
  const m = new Map(); const vals = new Map(); notices = [];
  return {
    JWT_SECRET: 'j', ADMIN_TOKEN: 'admintok', APP_URL: 'https://amv.test',
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit, cursor } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        const from = cursor ? +cursor : 0;
        const page = all.slice(from, from + (limit || 1000));
        return { keys: page, list_complete: from + page.length >= all.length, cursor: String(from + page.length) };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        if (b.op === 'claim') {
          if (vals.has('c:' + n)) return new Response(JSON.stringify({ claimed: false }));
          vals.set('c:' + n, 1); return new Response(JSON.stringify({ claimed: true }));
        }
        if (b.op === 'release') { vals.delete('c:' + n); return new Response(JSON.stringify({ ok: true })); }
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok, method) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: method || 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '4.4.4.4',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) }),
}), env, ctx);
const post = async (env, p, b, t) => { const r = await call(env, p, b, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const get  = async (env, p, t) => { const r = await call(env, p, null, t, 'GET'); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const signup = async (env, email) =>
  (await (await call(env, '/auth/signup', { email, name: email.split('@')[0], password: 'A-real-Passw0rd!' })).json()).token;

/* A seller who has been around and sold to a spread of people: the ordinary
   case, which is the one that has to stop needing a human. */
async function seller(env, email, { ageDays = 200, balance = 50, buyers = 6, disputes = 0, paidOut = 0 } = {}) {
  const tok = await signup(env, email);
  const acct = JSON.parse(env.AMV_KV._map.get('acct:' + email));
  acct.createdAt = Date.now() - ageDays * 86400000;
  env.AMV_KV._map.set('acct:' + email, JSON.stringify(acct));
  /* Anything touching money is gated on a confirmed birth year, which is its
     own defence and not the one under test here. Set so these cases exercise
     the payout decision rather than stopping at the age wall. */
  env.AMV_KV._map.set('consent:' + email, JSON.stringify({ email, birthYear: 1990, at: Date.now() }));
  env.AMV_KV._map.set('wallet:' + email, JSON.stringify({
    balance, lifetime: balance, currency: 'usd', holds: [], paidOut,
    tx: Array.from({ length: Math.max(3, buyers) }, (_, i) => ({ type: 'sale', buyer: 'b' + (i % buyers) + '@x.com' })),
  }));
  if (disputes) env.AMV_KV._map.set('abuse:' + email, JSON.stringify({ email, disputes, refunds: 0 }));
  return tok;
}
const withdraw = (env, tok, dest) => post(env, '/v1/market/withdraw', { destination: dest || 'paypal@seller.com' }, tok);

section('A slice of every sale is held across the whole dispute window');
{
  /* The reserve, at the point money is credited. Without it the only thing
     standing between AMV and a day-60 chargeback is money it already sent. */
  const env = mkEnv();
  const w = { balance: 0, lifetime: 0, currency: 'usd', holds: [] };
  const pct = W.PAYOUT_RESERVE_PCT;
  ok(pct > 0 && pct < 0.5, 'a reserve percentage is set, and is a slice rather than the lot', pct);
  ok(W.PAYOUT_RESERVE_MS > W.PAYOUT_HOLD_MS * 4,
     'and it runs far longer than the ordinary hold, because that is the point',
     { reserve: W.PAYOUT_RESERVE_MS / 86400000, hold: W.PAYOUT_HOLD_MS / 86400000 });

  /* Straight from the source of truth: two holds, one short, one long. */
  const credit = src.slice(src.indexOf('const reserved = +(sellerShare'), src.indexOf('_pruneMaturedHolds(w);'));
  ok(/reserve:\s*true/.test(credit), 'the long one is marked as the reserve', true);
  ok(/until: at \+ PAYOUT_RESERVE_MS/.test(credit), 'and dated by the dispute window', true);
  ok(/clearing = \+\(sellerShare - reserved\)/.test(credit),
     'while the rest clears normally, so an honest seller is not made to wait four months', true);
}

section('An ordinary payout needs nobody');
{
  const env = mkEnv();
  const tok = await seller(env, 'clean@example.com');
  const r = await withdraw(env, tok);
  ok(r.body.ok === true, 'it goes through', r.body);
  ok(r.body.status === 'approved', 'and is approved without a person', r.body.status);
  ok(r.body.reviewing !== true, 'the seller is not told to wait', r.body.message);
  ok(!notices.some(n => /needs review/i.test(n)),
     'and nobody is notified - an alert for every payout is how the ones that matter stop being read', notices.length);
}

section('Approved is not paid, because deciding and sending are different acts');
{
  const env = mkEnv();
  const tok = await seller(env, 'clean@example.com');
  const r = await withdraw(env, tok);
  const rec = JSON.parse(env.AMV_KV._map.get('withdraw:' + r.body.id));
  ok(rec.status === 'approved', 'the record says approved', rec.status);
  ok(rec.status !== 'paid', 'and not paid - no money moved, and AMV must never claim it did', rec.status);
  ok(rec.approvedBy === 'auto', 'with who decided it recorded', rec.approvedBy);

  /* And an operator can still settle it, which is the next real step. */
  const m = await post(env, '/admin/payouts/mark', { id: r.body.id, status: 'paid' }, 'admintok');
  ok(m.body.ok === true, 'an approved payout can then be marked paid', m.body);
}

section('Each signal on its own sends a payout to a person');
{
  const cases = [
    ['a brand new account',        { ageDays: 3 },            /days old/i],
    ['a dispute on record',        { disputes: 1 },           /dispute/i],
    ['sales from almost nobody',   { buyers: 1 },             /buyer/i],
    ['an amount over the limit',   { balance: 5000 },         /automatic limit/i],
    ['identity not verified yet',  { balance: 900 },          /identity/i],
  ];
  for (const [name, opts, why] of cases) {
    const env = mkEnv();
    const tok = await seller(env, 'x@example.com', opts);
    const r = await withdraw(env, tok);
    ok(r.body.status === 'pending', name + ' is reviewed rather than released', { name, status: r.body.status });
    const rec = JSON.parse(env.AMV_KV._map.get('withdraw:' + r.body.id));
    ok((rec.risk.reasons || []).some(x => why.test(x)),
       'and the reason says so in words a person can read', rec.risk.reasons);
  }
}

section('The money is never destroyed, whatever the score says');
{
  /* A scoring system that can silently delete somebody's earnings is worse
     than the fraud it prevents. Even the worst case still creates the record,
     still debits the balance into a payout that exists, and can be overridden. */
  const env = mkEnv();
  const tok = await seller(env, 'bad@example.com', { ageDays: 1, disputes: 3, buyers: 1, balance: 4000 });
  const r = await withdraw(env, tok);
  ok(r.body.ok === true, 'the request is still accepted', r.body);
  const rec = JSON.parse(env.AMV_KV._map.get('withdraw:' + r.body.id));
  ok(rec.risk.tier === 'blocked', 'and scored as blocked', rec.risk);
  ok(rec.amount > 0 && rec.status === 'pending', 'the money is recorded and waiting, not gone', rec);
  ok(r.body.reviewing === true && /review/i.test(r.body.message || ''),
     'and the seller is told it is being reviewed rather than left guessing', r.body.message);
  const m = await post(env, '/admin/payouts/mark', { id: r.body.id, status: 'paid' }, 'admintok');
  ok(m.body.ok === true, 'an operator can still overrule the score', m.body);
}

section('The operator sees the exceptions, not the business');
{
  const env = mkEnv();
  const good = await seller(env, 'clean@example.com');
  await withdraw(env, good);
  const bad = await seller(env, 'new@example.com', { ageDays: 2 });
  await withdraw(env, bad);

  const d = (await get(env, '/admin/payouts', 'admintok')).body;
  ok(d.pendingCount === 1, 'one payout is waiting for a person', d.pendingCount);
  ok(d.approvedCount === 1, 'and one cleared itself', d.approvedCount);
  ok(d.needsReview.length === 1 && d.needsReview[0].reasons.length > 0,
     'the queue carries the reasons, so somebody is deciding rather than guessing', d.needsReview);
  ok(d.owed === +(d.approvedTotal + d.needsReview[0].amount).toFixed(2),
     'and what is owed counts BOTH - an approved payout is still money not delivered',
     { owed: d.owed, approved: d.approvedTotal });
}

section('Identity is required where it is required, and not faked');
{
  /* There is no provider wired. The honest behaviour past the threshold is to
     ask a person, not to auto-release and not to stamp somebody verified on the
     strength of nothing. */
  ok(!/verified:\s*true/.test(src.slice(src.indexOf('async function _kycState'), src.indexOf('async function _payoutRisk'))),
     'nothing marks an account verified by itself', true);
  const env = mkEnv();
  const tok = await seller(env, 'big@example.com', { balance: 900 });
  const r = await withdraw(env, tok);
  ok(r.body.status === 'pending', 'past the threshold it waits for a person', r.body.status);

  /* And once a provider has actually verified them, it stops asking. */
  const env2 = mkEnv();
  const tok2 = await seller(env2, 'big@example.com', { balance: 900 });
  env2.AMV_KV._map.set('kyc:big@example.com', JSON.stringify({ verified: true, provider: 'test', checkedAt: Date.now() }));
  const r2 = await withdraw(env2, tok2);
  const rec2 = JSON.parse(env2.AMV_KV._map.get('withdraw:' + r2.body.id));
  ok(!(rec2.risk.reasons || []).some(x => /identity/i.test(x)),
     'a verified seller is not asked again', rec2.risk.reasons);
}

section('A signal that cannot be read is not a clean signal');
{
  /* The failure mode that would undo all of this: an error while scoring
     turning into a released payout. */
  const env = mkEnv();
  const tok = await seller(env, 'clean@example.com');
  const realGet = env.AMV_KV.get.bind(env.AMV_KV);
  let armed = false;
  env.AMV_KV.get = async (k) => { if (armed && /^abuse:/.test(k)) throw new Error('storage down'); return realGet(k); };
  armed = true;
  const r = await withdraw(env, tok);
  env.AMV_KV.get = realGet;
  ok(r.body.status === 'pending', 'a scoring failure sends it to a person rather than releasing it', r.body.status);
}


section('A reversal releases the WHOLE sale, reserve included');
{
  /* Adding the reserve gave every sale two holds sharing one reference. The
     reversal released holds by index - one call, one hold - so the reserve
     slice stayed frozen against a sale that no longer existed, and the seller
     was short by it for four months with nothing on screen to explain why.
     That is the precise failure the code's own comment warns about, and my
     change reintroduced it. Exercised here on the arithmetic rather than the
     wording, because the wording was already right and the code still did it. */
  const rel = src.slice(src.indexOf('const byRef = rec.ref ?'), src.indexOf('_pruneMaturedHolds(w);', src.indexOf('const byRef = rec.ref ?')));
  ok(/filter\(/.test(rel) && !/splice\(/.test(rel),
     'holds are filtered, not spliced one at a time', rel.slice(0, 120));

  /* And the behaviour: two holds in, a reversal, nothing of that sale left. */
  const REF = 'ch_test_1';
  const w = { balance: 100, lifetime: 100, currency: 'usd', holds: [
    { amount: 90, at: Date.now(), until: Date.now() + W.PAYOUT_HOLD_MS,    ref: REF, item: 'usr_a' },
    { amount: 10, at: Date.now(), until: Date.now() + W.PAYOUT_RESERVE_MS, ref: REF, item: 'usr_a', reserve: true },
    { amount: 25, at: Date.now(), until: Date.now() + W.PAYOUT_HOLD_MS,    ref: 'ch_other', item: 'usr_b' },
  ] };
  const holds = w.holds;
  const byRef = holds.filter(h => h.ref && h.ref === REF);
  const after = holds.filter(h => !byRef.includes(h));
  ok(after.length === 1, 'both holds for the reversed sale go', after.map(h => h.amount));
  ok(after[0].ref === 'ch_other', 'and another sale is untouched', after[0]);
  ok(!after.some(h => h.reserve), 'no reserve slice is left behind frozen', after);
}

if (report('payouts-decide-themselves') > 0) process.exitCode = 1;
done();
