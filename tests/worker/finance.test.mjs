/* ADMIN FINANCIAL STATEMENT — real transactions, owner-only.
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

const store = new Map();
const baseEnv = { ADMIN_TOKEN: 'admin-secret', AMV_KV: {
  async get(k){ return store.has(k)?store.get(k):null; },
  async put(k,v){ store.set(k,v); },
  async delete(k){ store.delete(k); },
  async list(){ return { keys: [], list_complete: true }; }
}};
const adminReq = () => new Request('https://api.amv.dev/v1/admin/finance', { method:'GET', headers:{ Authorization:'Bearer admin-secret' } });

section('The finance statement is admin-only');
let r = await W.adminFinance(new Request('https://api.amv.dev/v1/admin/finance', { method:'GET' }), baseEnv);
ok(r.status === 403, 'no admin token → forbidden', r.status);
r = await W.adminFinance(new Request('https://api.amv.dev/v1/admin/finance', { method:'GET', headers:{ Authorization:'Bearer wrong' } }), baseEnv);
ok(r.status === 403, 'a wrong admin token → forbidden', r.status);

section('Honest empty state when Stripe is not configured');
store.delete('txn:log');
r = await W.adminFinance(adminReq(), baseEnv);
let d = await r.json();
ok(d.ok && d.configured === false, 'it reports Stripe is not configured', d.configured);
ok(Array.isArray(d.transactions) && d.transactions.length === 0, 'and returns no fake transactions', d.transactions.length);
ok(d.totals.gross === 0 && d.totals.net === 0, 'with zeroed totals', d.totals);

section('Real transactions + correct totals from Stripe charges');
store.delete('txn:log');   // isolate: only Stripe charges in this section
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

section('ALL payment methods appear — not just Stripe');
// record a PayPal + a marketplace transaction in the ledger
store.delete('txn:log');
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
// them — the merge must dedup so gross isn't doubled.
store.delete('txn:log');
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
store.delete('txn:log');
await W._recordTxn(baseEnv, { provider: 'paypal', email: 'pp2@test.com', amount: 200, currency: 'USD', kind: 'Ultra', status: 'succeeded' });
r = await W.adminFinance(adminReq(), baseEnv);  // baseEnv has no STRIPE_SECRET_KEY
d = await r.json();
ok(d.transactions.length === 1 && d.transactions[0].provider === 'paypal', 'a PayPal sale shows even without Stripe', d.transactions.map(t=>t.provider));
ok(d.totals.gross === 200, 'and counts toward gross', d.totals.gross);

report();
done();
