/* ADMIN FINANCIAL STATEMENT - real transactions, owner-only.
   Proves: admin-only (403 without token), honest empty state when Stripe isn't
   configured, and correct totals (gross/refunded/net) from real charge data. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'finance.harness.mjs');
writeFileSync(harness, src + '\nexport { adminFinance, _recordTxn, _readTxnLog };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map(); const meta = new Map();
/* Listing is by prefix, in key order, with each key's metadata - the way KV
   answers it, because the ledger is one key per transaction and is read by
   listing them. */
const baseEnv = { ADMIN_TOKEN: 'admin-secret', AMV_KV: {
  async get(k){ return store.has(k)?store.get(k):null; },
  async put(k,v,o){ store.set(k,v); if(o && o.metadata) meta.set(k, JSON.parse(JSON.stringify(o.metadata))); else meta.delete(k); },
  async delete(k){ store.delete(k); meta.delete(k); },
  async list({ prefix = '', limit = 1000 } = {}){
    const keys = [...store.keys()].filter(k => k.startsWith(prefix)).sort().slice(0, limit)
      .map(name => meta.has(name) ? { name, metadata: meta.get(name) } : { name });
    return { keys, list_complete: true };
  }
}};
const clearLedger = () => { for (const k of [...store.keys()]) if (k.startsWith('txn:')) { store.delete(k); meta.delete(k); } };
const adminReq = () => new Request('https://api.amv.dev/v1/admin/finance', { method:'GET', headers:{ Authorization:'Bearer admin-secret' } });

section('The finance statement is admin-only');
let r = await W.adminFinance(new Request('https://api.amv.dev/v1/admin/finance', { method:'GET' }), baseEnv);
ok(r.status === 403, 'no admin token → forbidden', r.status);
r = await W.adminFinance(new Request('https://api.amv.dev/v1/admin/finance', { method:'GET', headers:{ Authorization:'Bearer wrong' } }), baseEnv);
ok(r.status === 403, 'a wrong admin token → forbidden', r.status);

section('Honest empty state when Stripe is not configured');
clearLedger();
r = await W.adminFinance(adminReq(), baseEnv);
let d = await r.json();
ok(d.ok && d.configured === false, 'it reports Stripe is not configured', d.configured);
ok(Array.isArray(d.transactions) && d.transactions.length === 0, 'and returns no fake transactions', d.transactions.length);
ok(d.totals.gross === 0 && d.totals.net === 0, 'with zeroed totals', d.totals);

section('Real transactions + correct totals from Stripe charges');
clearLedger();   // isolate: only Stripe charges in this section
const stripeEnv = { ...baseEnv, STRIPE_SECRET_KEY: 'sk_test' };
const origFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if(String(url).includes('/v1/charges')){
    return { ok:true, status:200, json: async () => ({ has_more:false, data:[
      { id:'ch_1', created:1700000000, amount:1500, amount_refunded:0, paid:true, status:'succeeded', currency:'usd',
        billing_details:{email:'a@test.com'}, payment_method_details:{card:{last4:'4242'}}, description:'Pro', receipt_url:'https://r/1' },
      { id:'ch_2', created:1700001000, amount:7500, amount_refunded:7500, paid:true, status:'succeeded', refunded:true, currency:'usd',
        billing_details:{email:'b@test.com'}, payment_method_details:{card:{last4:'1111'}}, description:'Elite' },
      { id:'ch_3', created:1700002000, amount:20000, amount_refunded:0, paid:true, status:'succeeded', currency:'usd',
        metadata:{email:'c@test.com', plan:'Ultra'} }
    ]}) };
  }
  return { ok:true, status:200, json: async () => ({}) };
};

r = await W.adminFinance(adminReq(), stripeEnv);
d = await r.json();
ok(d.configured === true, 'it reports Stripe is connected');
ok(d.transactions.length === 3, 'all 3 transactions are returned', d.transactions.length);
ok(d.totals.gross === 290, 'gross = all collected: $15 + $75 + $200 = $290', d.totals.gross);
ok(d.totals.refunded === 75, 'refunded = the $75 Elite refund', d.totals.refunded);
ok(d.totals.net === 215, 'net = gross - refunded = $215 (the real money kept)', d.totals.net);
const byId = Object.fromEntries(d.transactions.map(t => [t.id, t]));
ok(byId['ch_2'].status === 'refunded', 'the refunded charge is marked refunded', byId['ch_2'].status);
ok(byId['ch_1'].last4 === '4242', 'card last4 is shown for reconciliation', byId['ch_1'].last4);
ok(byId['ch_3'].email === 'c@test.com', 'email is pulled from metadata when billing_details is absent', byId['ch_3'].email);

globalThis.fetch = origFetch;

section('ALL payment methods appear - not just Stripe');
// record a PayPal + a marketplace transaction in the ledger
clearLedger();
await W._recordTxn(stripeEnv, { provider: 'paypal', email: 'pp@test.com', amount: 75, currency: 'USD', kind: 'Elite', status: 'succeeded' });
await W._recordTxn(stripeEnv, { provider: 'marketplace', email: 'buyer@test.com', amount: 4, currency: 'USD', kind: 'marketplace fee', status: 'succeeded' });

// re-stub stripe with one card charge
globalThis.fetch = async (url) => {
  if(String(url).includes('/v1/charges')){
    return { ok:true, status:200, json: async () => ({ has_more:false, data:[
      { id:'ch_x', created:1700003000, amount:1500, amount_refunded:0, paid:true, status:'succeeded', currency:'usd', billing_details:{email:'card@test.com'} }
    ]}) };
  }
  return { ok:true, status:200, json: async () => ({}) };
};
r = await W.adminFinance(adminReq(), stripeEnv);
d = await r.json();
const providers = new Set(d.transactions.map(t => t.provider));
ok(providers.has('stripe'), 'Stripe card payments appear', [...providers]);
ok(providers.has('paypal'), 'PayPal payments appear', [...providers]);
ok(providers.has('marketplace'), 'marketplace payments appear', [...providers]);
ok(d.totals.gross === 94, 'gross combines all methods: $15 + $75 + $4 = $94', d.totals.gross);
globalThis.fetch = origFetch;

section('Stripe payments are NOT double-counted (webhook ledger + live pull)');
// The webhook records Stripe payments to the ledger AND the live pull returns
// them - the merge must dedup so gross isn't doubled.
clearLedger();
await W._recordTxn(stripeEnv, { provider: 'stripe', email: 'dup@test.com', amount: 15, currency: 'USD', kind: 'Pro', status: 'succeeded', ref: 'sub_1' });
globalThis.fetch = async (url) => {
  if(String(url).includes('/v1/charges')){
    return { ok:true, status:200, json: async () => ({ has_more:false, data:[
      { id:'ch_dup', created:1700005000, amount:1500, amount_refunded:0, paid:true, status:'succeeded', currency:'usd', billing_details:{email:'dup@test.com'} }
    ]}) };
  }
  return { ok:true, status:200, json: async () => ({}) };
};
r = await W.adminFinance(adminReq(), stripeEnv);
d = await r.json();
const stripeCount = d.transactions.filter(t => t.provider === 'stripe').length;
ok(stripeCount === 1, 'the Stripe payment appears once, not doubled', stripeCount);
ok(d.totals.gross === 15, 'gross is $15, not $30 (no double-count)', d.totals.gross);
globalThis.fetch = origFetch;

section('Non-Stripe transactions show even with NO Stripe configured');
clearLedger();
await W._recordTxn(baseEnv, { provider: 'paypal', email: 'pp2@test.com', amount: 200, currency: 'USD', kind: 'Ultra', status: 'succeeded' });
r = await W.adminFinance(adminReq(), baseEnv);  // baseEnv has no STRIPE_SECRET_KEY
d = await r.json();
ok(d.transactions.length === 1 && d.transactions[0].provider === 'paypal', 'a PayPal sale shows even without Stripe', d.transactions.map(t=>t.provider));
ok(d.totals.gross === 200, 'and counts toward gross', d.totals.gross);

section('Sales in the same moment are all on the books');
{
  /* The ledger was one record read, prepended to and written back, so two
     sales at once each wrote a list without the other. Fifty at once now. */
  clearLedger();
  await Promise.all(Array.from({ length: 50 }, (_, i) =>
    W._recordTxn(baseEnv, { provider: 'paypal', email: 'buyer' + i + '@test.com', amount: 10, currency: 'USD', kind: 'Pro', status: 'succeeded' })));
  const all = await W._readTxnLog(baseEnv, 500);
  ok(all.length === 50, 'every one of fifty simultaneous sales is recorded', all.length);
  r = await W.adminFinance(adminReq(), baseEnv);
  d = await r.json();
  ok(d.totals.gross === 500, 'and the statement adds up to all of them', d.totals.gross);
  ok(all.every((e, i) => i === 0 || (all[i - 1].ts || 0) >= (e.ts || 0)), 'newest first', true);
}

section('A sale recorded under its own id is on the books once, however often it is retried');
{
  clearLedger();
  await W._recordTxn(baseEnv, { id: 'mktfee_x', provider: 'marketplace', email: 'b@test.com', amount: 4, kind: 'marketplace fee' });
  await W._recordTxn(baseEnv, { id: 'mktfee_x', provider: 'marketplace', email: 'b@test.com', amount: 4, kind: 'marketplace fee' });
  const all = await W._readTxnLog(baseEnv, 500);
  ok(all.filter(e => e.id === 'mktfee_x').length === 1, 'the retried fee appears once', all.length);
}

section('Everything recorded before the move is still on the statement');
{
  clearLedger();
  store.set('txn:log', JSON.stringify([{ id: 'old_1', ts: 1700000000000, provider: 'paypal', email: 'o@test.com', amount: 30, currency: 'USD', status: 'succeeded' }]));
  await W._recordTxn(baseEnv, { provider: 'paypal', email: 'n@test.com', amount: 12, currency: 'USD', status: 'succeeded' });
  const all = await W._readTxnLog(baseEnv, 500);
  ok(all.length === 2 && all[0].email === 'n@test.com' && all[1].id === 'old_1', 'the old record and the new keys, newest first', all.map(e => e.id));
  await W._recordTxn(baseEnv, { id: 'old_1', provider: 'paypal', email: 'o@test.com', amount: 30 });
  ok((await W._readTxnLog(baseEnv, 500)).length === 2, 'and an id already in the old record is not recorded again', true);
}

section('Each currency is counted in its own units and never added to another (Nov 7 audit FIN-022/023)');
{
  clearLedger();
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes('/v1/charges') ? { ok: true, status: 200, json: async () => ({ has_more: false, data: [
    { id: 'ch_u', created: 1700000000, amount: 2000, amount_refunded: 0, paid: true, status: 'succeeded', currency: 'usd' },
    { id: 'ch_e', created: 1700000100, amount: 1500, amount_refunded: 500, paid: true, status: 'succeeded', currency: 'eur' },
    { id: 'ch_y', created: 1700000200, amount: 1000, amount_refunded: 0, paid: true, status: 'succeeded', currency: 'jpy' },
    { id: 'ch_k', created: 1700000300, amount: 12345, amount_refunded: 0, paid: true, status: 'succeeded', currency: 'kwd' },
  ] }) } : { ok: true, status: 200, json: async () => ({}) };
  const f = await (await W.adminFinance(adminReq(), { ...baseEnv, STRIPE_SECRET_KEY: 'sk_test' })).json();
  globalThis.fetch = real;
  const by = Object.fromEntries(f.transactions.map(t => [t.id, t]));
  ok(by.ch_y.amount === 1000, 'a yen charge of 1000 is 1000 yen, not 10', by.ch_y.amount);
  ok(by.ch_k.amount === 12.345, 'a dinar has three decimals', by.ch_k.amount);
  ok(f.byCurrency.USD.gross === 20 && f.byCurrency.EUR.gross === 15 && f.byCurrency.EUR.net === 10 && f.byCurrency.JPY.gross === 1000, 'each currency has totals of its own', f.byCurrency);
  ok(f.totals.currency === 'USD', 'with one charge in each, the main figure is dollars - 1000 yen does not outrank 20 dollars by being a bigger number', f.totals.currency);
  ok(f.totals.gross === f.byCurrency[f.totals.currency].gross && f.totals.otherCurrencies.length === 3, 'and the main figure is one currency\u2019s, saying the others exist - never a sum across them', f.totals);
  ok(f.totals.scope === 'page', 'it says it covers this page, not all time');
}

section('A reused transaction id with different money is refused, not absorbed (Nov 7 audit FIN-024)');
{
  clearLedger();
  const a = await W._recordTxn(baseEnv, { id: 'fee_sale_9', provider: 'marketplace', email: 'b@test.com', amount: 4, currency: 'USD', kind: 'marketplace fee' });
  const again = await W._recordTxn(baseEnv, { id: 'fee_sale_9', provider: 'marketplace', email: 'b@test.com', amount: 4, currency: 'USD', kind: 'marketplace fee' });
  ok(a && again && again.amount === 4, 'the same event again answers with what was recorded');
  const other = await W._recordTxn(baseEnv, { id: 'fee_sale_9', provider: 'marketplace', email: 'b@test.com', amount: 400, currency: 'USD', kind: 'marketplace fee' });
  ok(other === null, 'a different amount under that id is refused - answered as nothing recorded', other);
  const kept = [...store.keys()].filter(k => k.startsWith('txn:e:'));
  ok(kept.length === 1 && JSON.parse(store.get(kept[0])).amount === 4, 'and the first stands alone on the books', kept.length);
}

section('A payment recorded half way is finished once, not written twice (Nov 7 audit FIN-020)');
{
  clearLedger();
  const realPut = baseEnv.AMV_KV.put;
  let dieOnce = true;
  /* The Worker stops after the line is written and before the id is final. */
  baseEnv.AMV_KV.put = async (k, v, o) => { if (dieOnce && String(k) === 'txn:id:pay_77' && !String(v).includes('"pending":true')) { dieOnce = false; throw new Error('worker stopped'); } return realPut.call(baseEnv.AMV_KV, k, v, o); };
  const first = await W._recordTxn(baseEnv, { id: 'pay_77', provider: 'paypal', email: 'p@test.com', amount: 30, currency: 'USD', kind: 'Pro' });
  baseEnv.AMV_KV.put = realPut;
  ok(first === null, '(the first attempt did not finish)');
  await new Promise(r => setTimeout(r, 5));
  const retry = await W._recordTxn(baseEnv, { id: 'pay_77', provider: 'paypal', email: 'p@test.com', amount: 30, currency: 'USD', kind: 'Pro' });
  const lines = [...store.keys()].filter(k => k.startsWith('txn:e:'));
  ok(retry && retry.amount === 30 && lines.length === 1, 'the retry finishes it: one line for one payment', lines.length);
  ok(!JSON.parse(store.get('txn:id:pay_77')).pending, 'and the id is no longer pending');
}

section('Two regions writing one payment at once make one line (Nov 8 audit)');
{
  /* Both writers read the id as absent - what eventually consistent KV does
     across regions - and are held there until both have looked. Driven with
     the real counter object, which is what decides between them. */
  clearLedger();
  const objs = new Map();
  const ns = { idFromName: n => n, get: (n) => ({ async fetch(_u, init) {
    if (!objs.has(n)) { const st = new Map(); objs.set(n, new W.AMVCounter({ storage: { async get(k){ return st.get(k); }, async put(k, v){ st.set(k, v); }, async delete(k){ st.delete(k); }, async deleteAll(){ st.clear(); }, async setAlarm(){}, async deleteAlarm(){} } }, {})); }
    /* One request at a time, as a Durable Object runs them. */
    const o = objs.get(n); const run = (o._q || Promise.resolve()).then(() => o.fetch(new Request('https://do/c', init)));
    o._q = run.catch(() => {}); return run; } }) };
  let reads = 0, release; const both = new Promise(r => release = r);
  const kv = { ...baseEnv.AMV_KV,
    async get(k){ if (k === 'txn:id:evt_same' && reads < 2) { reads++; if (reads === 2) release(); await both; return null; } return baseEnv.AMV_KV.get(k); },
    async put(k, v, o){ await new Promise(r => setTimeout(r, 5)); return baseEnv.AMV_KV.put(k, v, o); } };
  const env = { ...baseEnv, AMV_KV: kv, AMV_COUNTER: ns };
  const base = { id: 'evt_same', provider: 'stripe', email: 'buyer@example.com', amount: 25, currency: 'USD', kind: 'credit_pack', status: 'succeeded', ref: 'pi_1' };
  const [a, b] = await Promise.all([W._recordTxn(env, { ...base, ts: 1000 }), W._recordTxn(env, { ...base, ts: 2000 })]);
  const lines = [...store.keys()].filter(k => k.startsWith('txn:e:'));
  ok(lines.length === 1, 'one payment, one line on the books', lines);
  ok(a && b && a.id === 'evt_same' && b.id === 'evt_same' && a.ts === b.ts, 'and both writers are answered with the same record', { a, b });
}

section('A ledger longer than the page says there is more (Nov 8 audit FIN-021)');
{
  clearLedger();
  for (let i = 0; i < 302; i++) await W._recordTxn(baseEnv, { id: 'pp_' + i, provider: 'paypal', email: 'p@x.com', amount: 1, currency: 'USD', kind: 'plan', ts: 1000 + i });
  const d = await (await W.adminFinance(adminReq(), baseEnv)).json();
  ok(d.transactions.length === 300 && d.hasMore === true && d.totals.scope === 'page', 'three hundred shown, more said to exist, and the totals say they cover the page', { n: d.transactions.length, more: d.hasMore, scope: d.totals.scope });
  clearLedger();
}

report();
done();
