/* A REFUND IS REAL MONEY, READ BACK (Nov 16, the owner's decision: "14 days,
   light use").

   Within 14 days of a plan charge, with under 20% of the plan used since it,
   the whole charge comes back in one press and the plan ends; once a year
   automatically; anything else is a request the owner decides. Held here,
   against a stand-in Stripe:
     · each refusal - over 14 days, 20% used, once this year, already refunded,
       a team member, no Stripe - and that the server decides, not the page;
     · the money is refunded FIRST, with the invoice as the idempotency key,
       and read back; a refund Stripe does not complete ends nothing;
     · then the plan ends - at Stripe, and here even if Stripe will not;
     · a request is recorded once, and the owner's approval refunds it while a
       decline refunds nothing;
     · and the owner routes refuse anybody without the owner's token. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'refunds.harness.mjs');
writeFileSync(harness, src + `
export { billingRefund, billingRefundState, adminRefunds, adminRefundDecide, DB, counter, _periodKeyOf, _monthlyCeilingUSD };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const kv = {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v) { store.set(k, String(v)); },
  async delete(k) { store.delete(k); },
  async list({ prefix } = {}) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }; },
};
const env = { JWT_SECRET: 'x'.repeat(40), STRIPE_SECRET_KEY: 'sk_test_x', APP_URL: 'https://amv.test', ADMIN_TOKEN: 'owner-token-123', AMV_KV: kv };
const DAY = 86400000;
const EMAIL = 'payer@x.com';
let USER = { email: EMAIL, plan: 'pro', billingRenewedAt: Date.now() - 2 * DAY };
W.__setRequireUser(async () => USER);

/* The stand-in Stripe. */
let calls = [], invoice = null, refundReply = null, refundRead = null, subRead = null, delReply = null;
const keep = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  const url = String(u), method = (o && o.method) || 'GET';
  const h = (o && o.headers) || {};
  if (/api\.stripe\.com/.test(url)) {
    calls.push({ url, method, body: String((o && o.body) || ''), idem: h['Idempotency-Key'] || '' });
    const send = (j, st = 200) => new Response(JSON.stringify(j), { status: st });
    if (/\/v1\/invoices\?/.test(url)) return send({ data: invoice ? [invoice] : [] });
    if (/\/v1\/refunds$/.test(url) && method === 'POST') return refundReply ? send(refundReply.json, refundReply.status || 200) : send({ id: 're_1', status: 'succeeded', amount: 1500 });
    if (/\/v1\/refunds\/re_/.test(url)) return send(refundRead || { id: 're_1', status: 'succeeded', amount: 1500 });
    if (/\/v1\/subscriptions\//.test(url) && method === 'GET') return send(subRead || { id: 'sub_1', status: 'active', customer: 'cus_me' });
    if (/\/v1\/subscriptions\//.test(url) && method === 'DELETE') return delReply ? send(delReply.json, delReply.status || 200) : send({ id: 'sub_1', status: 'canceled' });
    return send({});
  }
  return keep(u, o);
};

async function seed(over = {}){
  store.clear(); calls = []; refundReply = null; refundRead = null; subRead = null; delReply = null;
  USER = Object.assign({ email: EMAIL, plan: 'pro', billingRenewedAt: Date.now() - 2 * DAY }, over.user || {});
  store.set('stripecust:' + EMAIL, 'cus_me');
  await W.DB.put(env, 'ent', EMAIL, { plan: 'pro', subId: 'sub_1', updatedAt: Date.now() });
  invoice = Object.assign({ id: 'in_1', customer: 'cus_me', amount_paid: 1500, currency: 'usd', charge: 'ch_1',
    status_transitions: { paid_at: Math.floor((Date.now() - 2 * DAY) / 1000) } }, over.invoice || {});
  if (over.usedShare) {
    const ceil = W._monthlyCeilingUSD(USER);
    await W.counter(env, `cost:${EMAIL}:${W._periodKeyOf(USER)}`, { op: 'incr', amount: ceil * over.usedShare, ttlMs: 70 * DAY });
  }
}
const get = async () => { const r = await W.billingRefundState(new Request('https://x/v1/billing/refund', { method: 'GET' }), env); return r.json(); };
const post = async (body) => { const r = await W.billingRefund(new Request('https://x/v1/billing/refund', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.' + Math.floor(Math.random() * 200) }, body: JSON.stringify(body) }), env);
  return { status: r.status, d: await r.json() }; };
const plan = async () => ((await W.DB.get(env, 'ent', EMAIL)) || {}).plan;

section('Inside 14 days with light use: one press, the money first, then the plan');
{
  await seed({ usedShare: 0.05 });
  const s = await get();
  ok(s.ok && s.auto === true && s.charge.amount === 15 && s.usedPercent === 5, 'the screen is told it can refund $15 now', s);
  const r = await post({ mode: 'auto' });
  ok(r.status === 200 && r.d.ok && r.d.refund.status === 'succeeded' && r.d.refund.amount === 15, 'refunded, as Stripe reports it', r);
  const iRef = calls.findIndex(c => /\/v1\/refunds$/.test(c.url)), iDel = calls.findIndex(c => c.method === 'DELETE');
  ok(iRef >= 0 && iDel > iRef, 'the refund is made before the subscription is ended', calls.map(c => c.method + ' ' + c.url.replace('https://api.stripe.com', '')));
  ok(calls[iRef].idem === 'amv-refund-in_1' && /charge=ch_1/.test(calls[iRef].body), 'for that invoice’s charge, keyed by the invoice so a second press cannot refund twice', calls[iRef]);
  ok(calls.some(c => /\/v1\/refunds\/re_1/.test(c.url)), 'and read back from Stripe', '');
  ok(await plan() === 'free', 'the plan has ended', await plan());
  const again = await get();
  ok(again.auto === false && again.why.includes('already_refunded'), 'and the same charge cannot be refunded again', again);
}

section('Each limit is the server’s, whatever the page shows');
{
  await seed({ invoice: { status_transitions: { paid_at: Math.floor((Date.now() - 15 * DAY) / 1000) } } });
  let s = await get();
  ok(!s.auto && s.why.includes('over_14_days'), 'after 14 days: no automatic refund', s.why);
  let r = await post({ mode: 'auto' });
  ok(r.status === 400 && r.d.code === 'not_eligible' && !calls.some(c => /\/v1\/refunds$/.test(c.url)), 'and pressing anyway refunds nothing', r);

  await seed({ usedShare: 0.25 });
  s = await get();
  ok(!s.auto && s.why.includes('used_20_percent') && s.usedPercent === 25, '25% used: no automatic refund', s);

  await seed({ usedShare: 0.05 });
  await W.DB.put(env, 'refundauto', EMAIL, { at: Date.now() - 100 * DAY, invoice: 'in_old' });
  s = await get();
  ok(!s.auto && s.why.includes('refunded_this_year'), 'one automatic refund in twelve months', s.why);

  await seed({ user: { billingSubject: 'teamowner@x.com' } });
  s = await get();
  ok(s.ok === false && s.code === 'team_member', 'a team member cannot refund the team’s plan', s);

  await seed();
  const r2 = await W.billingRefundState(new Request('https://x/v1/billing/refund', { method: 'GET' }), Object.assign({}, env, { STRIPE_SECRET_KEY: '' }));
  const d2 = await r2.json();
  ok(d2.code === 'needs_service', 'with no payments connected, it says so', d2);

  await seed({ invoice: { customer: 'cus_someone_else' } });
  s = await get();
  ok(s.ok === false && s.code === 'forbidden', 'a charge that belongs to another customer is never refunded', s);
}

section('A refund Stripe does not complete ends nothing');
{
  await seed();
  refundReply = { json: { id: 're_2', status: 'failed', amount: 1500 } };
  refundRead = { id: 're_2', status: 'failed', amount: 1500 };
  const r = await post({ mode: 'auto' });
  ok(r.status === 502 && r.d.code === 'refund_failed', 'the person is told it did not go through', r);
  ok(!calls.some(c => c.method === 'DELETE') && await plan() === 'pro', 'and their plan is untouched', await plan());
}

section('If Stripe will not end the subscription, access still ends here and the owner is told');
{
  await seed();
  delReply = { status: 500, json: { error: { message: 'down' } } };
  const r = await post({ mode: 'auto' });
  ok(r.d.ok && r.d.endedAtStripe === false, 'the refund stands, and the reply says Stripe was not ended', r.d);
  ok(await plan() === 'free', 'and the plan is free here', await plan());
}

section('Anything else is a request the owner decides');
{
  await seed({ usedShare: 0.6 });
  let r = await post({ mode: 'request', reason: '' });
  ok(r.status === 400, 'a request says why', r.d);
  r = await post({ mode: 'request', reason: 'I was charged twice this month' });
  ok(r.d.ok && /^rr_/.test(r.d.request.id), 'a request is recorded', r.d);
  const id = r.d.request.id;
  const again = await post({ mode: 'request', reason: 'again' });
  ok(again.d.already && again.d.request.id === id, 'one open request at a time', again.d);
  ok(!calls.some(c => /\/v1\/refunds$/.test(c.url)), 'and asking moves no money', '');

  const adm = (path, body, token) => new Request('https://x' + path, { method: body ? 'POST' : 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '7.7.7.7' }, token ? { 'X-Admin-Token': token } : {}),
    body: body ? JSON.stringify(body) : undefined });
  let a = await W.adminRefunds(adm('/v1/admin/refunds', null, 'wrong'), env);
  ok(a.status === 403, 'the owner list refuses the wrong token', a.status);
  a = await W.adminRefunds(adm('/v1/admin/refunds', null, env.ADMIN_TOKEN), env);
  const list = (await a.json()).requests;
  ok(list.length === 1 && list[0].id === id && list[0].usedPercent === 60 && list[0].amount === 15, 'the owner sees it with its usage and amount', list);

  a = await W.adminRefundDecide(adm('/v1/admin/refunds/decide', { id, approve: true }, 'wrong'), env);
  ok(a.status === 403 && !calls.some(c => /\/v1\/refunds$/.test(c.url)), 'deciding needs the owner’s token', a.status);
  a = await W.adminRefundDecide(adm('/v1/admin/refunds/decide', { id, approve: true }, env.ADMIN_TOKEN), env);
  const ad = await a.json();
  ok(ad.ok && ad.status === 'approved' && ad.refund.status === 'succeeded' && ad.planEnded, 'approving refunds it and ends the plan it paid for', ad);
  a = await W.adminRefundDecide(adm('/v1/admin/refunds/decide', { id, approve: false }, env.ADMIN_TOKEN), env);
  ok(a.status === 409, 'a decided request cannot be decided again', a.status);

  await seed({ usedShare: 0.6 });
  const r3 = await post({ mode: 'request', reason: 'changed my mind' });
  calls = [];
  a = await W.adminRefundDecide(adm('/v1/admin/refunds/decide', { id: r3.d.request.id, approve: false }, env.ADMIN_TOKEN), env);
  ok((await a.json()).status === 'declined' && !calls.some(c => /\/v1\/refunds$/.test(c.url)) && await plan() === 'pro', 'declining refunds nothing and leaves the plan', await plan());
  const s = await get();
  ok(s.request === null, 'and the person can ask again', s.request);
  ok(s.answered && s.answered.status === 'declined', 'and their screen can say it was declined', s.answered);
}

report();
done();
