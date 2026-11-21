/* A PURCHASE IS HELD AGAINST YOUR LIMITS FIRST (Nov 16, buying phase 1 -
   docs/BUYING.md).

   Before AMV's browser may press a store's final button, the amount is held on
   the server against the person's own Spending limits. Held here:
     · spending switched off, over the per-purchase limit, past what is left
       this month, or in another currency: refused, with the reason;
     · two holds that together pass the month cannot both succeed;
     · settling at a lower total gives the rest back; at a higher one books
       what really happened and says so on the receipt;
     · releasing gives it all back; a hold is settled once, by its owner. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'buying.harness.mjs');
writeFileSync(harness, src + `
export { spendHold, spendSettle, spendRelease, spendBuys, DB, counter, monthKey };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = { JWT_SECRET: 'x'.repeat(40), APP_URL: 'https://amv.test', AMV_KV: {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v) { store.set(k, String(v)); },
  async delete(k) { store.delete(k); },
  async list({ prefix } = {}) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }; },
} };
let USER = { email: 'buyer@x.com', plan: 'pro' };
W.__setRequireUser(async () => USER);

const call = async (fn, path, body) => { const r = await fn(new Request('https://x' + path, { method: body ? 'POST' : 'GET',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '5.5.5.' + Math.floor(Math.random() * 200) }, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, d: await r.json() }; };
const hold = (b) => call(W.spendHold, '/v1/spend/hold', Object.assign({ store: 'shop.example.com', item: 'A kettle', currency: 'USD', key: 'k' + crypto.randomUUID().replace(/-/g, '') }, b));
const month = async () => +((await W.counter(env, `spendmo:${USER.email}:${W.monthKey()}`, { op: 'get' })).value || 0);
const limits = (l) => W.DB.put(env, 'spendlimits', USER.email, Object.assign({ enabled: true, autoUnder: 50, perPurchase: 100, monthlyCap: 150, currency: 'USD' }, l));

section('Refused, with the reason, before anything is pressed');
{
  store.clear(); await limits({ enabled: false });
  let r = await hold({ amount: 20 });
  ok(r.status === 400 && r.d.code === 'spending_off', 'spending switched off: nothing is held', r.d);
  await limits({});
  r = await hold({ amount: 120 });
  ok(r.d.code === 'over_limit', 'over the single-purchase limit', r.d);
  r = await hold({ amount: 20, currency: 'EUR' });
  ok(r.d.code === 'currency_mismatch' && /EUR/.test(r.d.need) && /USD/.test(r.d.need), 'in another currency: refused, never converted with a guess', r.d);
  r = await hold({ amount: 20, store: 'javascript:alert(1)' });
  ok(r.status === 400, 'a store that is not a plain address is refused', r.d);
  ok(await month() === 0, 'and the month is untouched', await month());
}

section('Held atomically against the month');
{
  store.clear(); await limits({});
  const a = await hold({ amount: 90 });
  ok(a.d.ok && /^bh_/.test(a.d.hold.id), 'a purchase within the limits is held', a.d);
  ok(await month() === 90, 'and booked against the month at once', await month());
  const b = await hold({ amount: 90 });
  ok(b.d.code === 'over_monthly' && await month() === 90, 'a second that would pass the month is refused', b.d);
}

section('Settled at what the store charged');
{
  store.clear(); await limits({});
  let h = (await hold({ amount: 80 })).d.hold;
  let s = await call(W.spendSettle, '/v1/spend/settle', { hold: h.id, total: 75.5, order: 'A-1001', verified: true });
  /* Seen on the store's page, as the person's computer reported it - never
     "verified": nobody at AMV asked the store (Build 17 audit B17-006). */
  ok(s.d.ok && s.d.receipt.total === 75.5 && s.d.receipt.over === 0 && s.d.receipt.seenOnPage === true && s.d.receipt.verified === false, 'a lower total is settled, and reported as seen on the page - not verified', s.d);
  ok(await month() === 75.5, 'and the rest goes back to the month', await month());
  const again = await call(W.spendSettle, '/v1/spend/settle', { hold: h.id, total: 75.5, order: 'A-1001' });
  ok(again.status === 409, 'a purchase is settled once', again.d);

  h = (await hold({ amount: 40 })).d.hold;
  s = await call(W.spendSettle, '/v1/spend/settle', { hold: h.id, total: 44, order: 'A-1002', verified: true });
  ok(s.d.receipt.over === 4, 'a higher total is said out loud on the receipt', s.d.receipt);
  ok(await month() === 119.5, 'and booked, because it happened', await month());
  const list = (await call(W.spendBuys, '/v1/spend/buys')).d.buys;
  ok(list.length === 2 && list[0].order === 'A-1002' && list[1].order === 'A-1001', 'both are on the receipts, newest first', list.map(x => x.order));
}

section('Released, and only by its owner');
{
  store.clear(); await limits({});
  const h = (await hold({ amount: 60 })).d.hold;
  USER = { email: 'someone@else.com', plan: 'pro' };
  let r = await call(W.spendRelease, '/v1/spend/release', { hold: h.id });
  ok(r.status === 404, 'another account cannot touch it', r.d);
  r = await call(W.spendSettle, '/v1/spend/settle', { hold: h.id, total: 1, order: 'x' });
  ok(r.status === 404, 'nor settle it', r.d);
  USER = { email: 'buyer@x.com', plan: 'pro' };
  r = await call(W.spendRelease, '/v1/spend/release', { hold: h.id });
  ok(r.d.status === 'released' && await month() === 0, 'releasing gives it all back', { d: r.d, month: await month() });
  r = await call(W.spendSettle, '/v1/spend/settle', { hold: h.id, total: 60, order: 'late' });
  ok(r.status === 409, 'and a released purchase cannot then be settled', r.d);
}

section('One purchase, one hold, however often it is asked (Build 17 audit B17-005)');
{
  store.clear(); await limits({});
  const key = 'k' + 'a'.repeat(30);
  const a = await hold({ amount: 30, key });
  const b = await hold({ amount: 30, key });
  ok(a.d.ok && b.d.ok && b.d.repeat === true && a.d.hold.id === b.d.hold.id, 'asked twice, the same hold comes back', [a.d, b.d]);
  ok(await month() === 30, 'and the month is booked once', await month());
  const c = await hold({ amount: 31, key });
  ok(c.status === 409 && c.d.code === 'hold_terms_differ' && await month() === 30, 'the same purchase with a different total is refused, never a second hold', c.d);
  const old = await hold({ amount: 30, key: 'short' });
  ok(old.status === 400 && old.d.code === 'reload_needed', 'a page too old to send a key is told to reload', old.d);
  await call(W.spendRelease, '/v1/spend/release', { hold: a.d.hold.id });
  const after = await hold({ amount: 30, key });
  ok(after.status === 409 && after.d.code === 'decided' && after.d.status === 'released', 'and once decided, asking again does not reopen it', after.d);
  await limits({ perPurchase: 10 });
  const rkey = 'k' + 'b'.repeat(30);
  const r1 = await hold({ amount: 20, key: rkey });
  const r2 = await hold({ amount: 20, key: rkey });
  ok(r1.status === 400 && r2.status === 400 && r2.d.repeat === true && r2.d.code === 'refused', 'a refused purchase asked again is told it was refused', [r1.d, r2.d]);
}

section('Receipts: a page at a time, older ones still read, and a failed read is said (Build 17 audit B17-003, B17-008)');
{
  store.clear(); await limits({});
  const h = (await hold({ amount: 12 })).d.hold;
  await call(W.spendSettle, '/v1/spend/settle', { hold: h.id, total: 12, order: 'N-1', seenOnPage: true });
  /* A receipt written to the old single list, before the index. */
  await W.DB.put(env, 'buys', USER.email, [{ id: 'bh_' + 'c'.repeat(24), store: 'old.example.com', item: 'Old thing', total: 5, currency: 'USD', at: 1, verified: true }]);
  let r = await call(W.spendBuys, '/v1/spend/buys');
  ok(r.d.ok && r.d.buys.length === 2 && r.d.next === null, 'the new receipt and the old one, both', r.d);
  const old = r.d.buys.find(x => x.store === 'old.example.com');
  ok(old && old.seenOnPage === true && old.verified === false && old.source === 'reported', 'and the old one is relabelled as reported, never verified', old);
  const realGet = env.AMV_KV.get;
  env.AMV_KV.get = async (k) => { if (String(k).startsWith('buyhold:')) throw new Error('storage down'); return realGet(k); };
  r = await call(W.spendBuys, '/v1/spend/buys');
  env.AMV_KV.get = realGet;
  ok(r.status === 503 && r.d.code === 'receipts_unavailable', 'a receipt that cannot be read is said, not left out of the list', r.d);
  const realList = env.AMV_KV.list;
  env.AMV_KV.list = async () => { throw new Error('list down'); };
  r = await call(W.spendBuys, '/v1/spend/buys');
  env.AMV_KV.list = realList;
  ok(r.status === 503 && r.d.code === 'receipts_unavailable', 'and so is an index that cannot be read', r.d);
}

section('The money is closed even when the record write is refused (Build 17 audit B17-004)');
{
  store.clear(); await limits({});
  const h = (await hold({ amount: 25 })).d.hold;
  const realPut = env.AMV_KV.put;
  let n = 0;
  env.AMV_KV.put = async (k, v) => { if (String(k).startsWith('buyhold:') && ++n === 1) throw new Error('429 Too Many Requests'); return realPut(k, v); };
  const s1 = await call(W.spendSettle, '/v1/spend/settle', { hold: h.id, total: 25, order: 'P-1', seenOnPage: true });
  env.AMV_KV.put = realPut;
  ok(s1.status === 202 && s1.d.ok === true && s1.d.recordPending === true && s1.d.receipt, 'settled, and said that the record is still being written', s1.d);
  ok(await month() === 25, 'the month counts it once', await month());
  const s2 = await call(W.spendSettle, '/v1/spend/settle', { hold: h.id, total: 25, order: 'P-1', seenOnPage: true });
  ok(s2.status === 200 && await month() === 25, 'settling again finishes the record without counting it twice', [s2.status, await month()]);
  const r = await call(W.spendBuys, '/v1/spend/buys');
  ok(r.d.buys.length === 1 && r.d.buys[0].order === 'P-1', 'and the receipt is there', r.d.buys);
}

report();
done();
