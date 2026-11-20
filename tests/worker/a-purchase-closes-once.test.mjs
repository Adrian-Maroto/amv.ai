/* A PURCHASE CLOSES ONCE (Build 16 audit STATE16-06..09, Nov 20).

   A purchase hold ends settled or released, and the month's own counter now
   decides which, once, under a name only that hold has. Driven here against
   the real Worker and the real counter object (serialized, as the platform
   runs it), with storage that fails on cue:
   - released twice, or released then settled, or settled then released: the
     month moves once and the other purchase's booking is untouched;
   - a settlement whose record could not be saved is finished from the
     counter's memory on the retry, with no second adjustment and one receipt;
   - a counter that cannot answer leaves the purchase pending, never done,
     and the retry makes exactly one adjustment;
   - a hold whose record could not be finished can be released, and gives back
     nothing if its booking never arrived - and that booking can no longer land;
   - a purchase held in dollars settles into the dollar total after the limits
     move to euros, and the euro month only counts euros. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'closesonce.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `
export { spendHold, spendSettle, spendRelease, spendBuys, spendSet, spendGet, DB, counter, _spendMonthKey };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());
const log = console.log; console.log = (...a) => { if (!/^AUDIT|"event"/.test(String(a[0]))) log(...a); };

const EM = 'buyer@example.com';
W.__setRequireUser(async () => ({ email: EM, plan: 'pro' }));
function fixture() {
  const f = { live: new Map(), objects: new Map(), queues: new Map() };
  f.env = { JWT_SECRET: 'x'.repeat(40), APP_URL: 'https://amv.test' };
  f.env.AMV_KV = {
    async get(k) { if (f.getOverride) { const x = f.getOverride(k); if (x !== undefined) return x; } return f.live.has(k) ? f.live.get(k) : null; },
    async put(k, v) { if (f.beforePut) f.beforePut(k); f.live.set(k, String(v)); },
    async delete(k) { f.live.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...f.live.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
  };
  f.env.AMV_COUNTER = { idFromName: n => n, get: n => ({ fetch: async (u, init) => {
    const p = JSON.parse(init.body);
    const run = async () => {
      if (f.failCounter && f.failCounter(n, p)) throw new Error('counter down');
      if (!f.objects.has(n)) { const store = new Map(); f.objects.set(n, new W.AMVCounter({ storage: {
        async get(k) { return structuredClone(store.get(k)); }, async put(k, v) { store.set(k, structuredClone(v)); },
        async delete(k) { store.delete(k); }, async deleteAll() { store.clear(); }, async setAlarm() {}, async deleteAlarm() {} } }, {})); }
      return f.objects.get(n).fetch(new Request('https://counter.invalid', init));
    };
    const prev = f.queues.get(n) || Promise.resolve(); const pending = prev.then(run, run); f.queues.set(n, pending.catch(() => {}));
    return pending;
  } }) };
  return f;
}
const req = (path, body) => new Request('https://x' + path, { method: body ? 'POST' : 'GET',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '5.5.5.' + Math.floor(Math.random() * 200) }, body: body ? JSON.stringify(body) : undefined });
const call = async (f, fn, path, body) => { const r = await fn(req(path, body), f.env); return { status: r.status, d: await r.json() }; };
const limits = (f, currency = 'USD') => call(f, W.spendSet, '/v1/spend/set', { enabled: true, perPurchase: 200, monthlyCap: 1000, autoUnder: 100, currency });
const hold = async (f, amount = 50, currency = 'USD') => (await call(f, W.spendHold, '/v1/spend/hold', { amount, currency, store: 'shop.example.com', item: 'A kettle' })).d;
const month = async (f, currency) => (await W.counter(f.env, W._spendMonthKey(EM, currency), { op: 'get', strict: true })).value;
const settle = (f, id, total, order = 'A-1') => call(f, W.spendSettle, '/v1/spend/settle', { hold: id, total, order, verified: true });
const release = (f, id) => call(f, W.spendRelease, '/v1/spend/release', { hold: id });
const status = (f, id) => JSON.parse(f.live.get('buyhold:' + id)).status;

section('Released twice, or released and settled: the month moves once');
{
  const f = fixture(); await limits(f);
  const a = (await hold(f)).hold, b = (await hold(f)).hold;
  const stale = f.live.get('buyhold:' + a.id);
  await release(f, a.id);
  f.getOverride = k => k === 'buyhold:' + a.id ? stale : undefined;
  const again = await release(f, a.id);
  ok(again.d.status === 'released' && await month(f) === 50, 'a second release from a stale copy gives nothing back', { again: again.d, month: await month(f) });
  const late = await settle(f, a.id, 50);
  ok(late.status === 409 && late.d.status === 'released' && await month(f) === 50, 'and a settlement against that stale copy is refused, without a booking', { late: late.d, month: await month(f) });
  f.getOverride = null;
  ok(status(f, b.id) === 'held', 'the other purchase is still held', status(f, b.id));
  const buys = (await call(f, W.spendBuys, '/v1/spend/buys')).d.buys;
  ok(buys.length === 0, 'and no receipt was written for the released one', buys);
}

section('Settled, then released from a stale copy: it stays settled');
{
  const f = fixture(); await limits(f);
  const a = (await hold(f)).hold;
  const stale = f.live.get('buyhold:' + a.id);
  const s = await settle(f, a.id, 40, 'A-77');
  ok(s.d.ok && await month(f) === 40, 'settled at what the store charged', { s: s.d, month: await month(f) });
  f.getOverride = k => k === 'buyhold:' + a.id ? stale : undefined;
  const r = await release(f, a.id);
  f.getOverride = null;
  ok(r.d.status === 'settled' && await month(f) === 40, 'a release replayed from before the settlement does not give the 40 back', { r: r.d, month: await month(f) });
  ok(status(f, a.id) === 'settled', 'and the record says settled', status(f, a.id));
}

section('A settlement whose record was lost is finished from the counter');
{
  const f = fixture(); await limits(f);
  const a = (await hold(f)).hold;
  f.beforePut = k => { if (k === 'buyhold:' + a.id) throw new Error('storage down'); };
  let threw = false; try { await settle(f, a.id, 70, 'A-9'); } catch (e) { threw = true; }
  f.beforePut = null;
  ok(await month(f) === 70, 'the store charged 70: the month says 70', await month(f));
  ok(status(f, a.id) === 'held', 'the record could not be saved, so it still reads held', { threw, status: status(f, a.id) });
  const retry = await settle(f, a.id, 70, 'A-9');
  ok(retry.d.ok && retry.d.receipt.total === 70 && retry.d.receipt.over === 20 && await month(f) === 70, 'the retry finishes it with no second adjustment', { retry: retry.d, month: await month(f) });
  const third = await settle(f, a.id, 70, 'A-9');
  ok(third.status === 409, 'after that it is settled once', third.d);
  const buys = (await call(f, W.spendBuys, '/v1/spend/buys')).d.buys;
  ok(buys.length === 1 && buys[0].order === 'A-9', 'with one receipt', buys);
}

section('A counter that cannot answer: pending, never done');
{
  const f = fixture(); await limits(f);
  const a = (await hold(f)).hold;
  f.failCounter = (n, p) => n.startsWith('spendmo:') && p.op === 'incr';
  const s = await settle(f, a.id, 70, 'A-5');
  ok(s.status === 503 && s.d.code === 'settle_pending' && status(f, a.id) === 'held', 'the settlement is pending and the purchase stays open', s.d);
  const r = await release(f, a.id);
  ok(r.status === 503 && r.d.code === 'release_pending', 'so is a release', r.d);
  ok(![...f.live.keys()].some(k => k.startsWith('ctr:spendmo:')), 'and nothing was written to a store the month is never read from', [...f.live.keys()]);
  f.failCounter = null;
  const ok2 = await settle(f, a.id, 70, 'A-5');
  ok(ok2.d.ok && await month(f) === 70, 'the retry makes exactly the one adjustment', { d: ok2.d, month: await month(f) });
}

section('A hold that could not be finished leaves something findable or nothing');
{
  const f = fixture(); await limits(f);
  let n = 0;
  f.beforePut = k => { if (k.startsWith('buyhold:') && ++n === 2) throw new Error('storage down'); };
  const h = await hold(f);
  f.beforePut = null;
  ok(!h.ok && h.code === 'hold_unavailable' && await month(f) === 0, 'the record could not be finished: the booking is closed again', { h, month: await month(f) });
  const recs = [...f.live.keys()].filter(k => k.startsWith('buyhold:'));
  ok(recs.length === 1 && JSON.parse(f.live.get(recs[0])).status === 'reserving', 'and the hold is still written down by name', recs);

  /* A record left reserving whose booking never arrived: releasing it gives
     back nothing, and that booking cannot land afterwards. */
  const g = fixture(); await limits(g);
  const other = (await hold(g, 30)).hold;
  const id = 'bh_' + 'a'.repeat(24);
  await W.DB.put(g.env, 'buyhold', id, { id, email: EM, amount: 50, currency: 'USD', store: 'shop.example.com', item: 'x', at: Date.now(),
    ledgerKey: W._spendMonthKey(EM, 'USD'), named: true, status: 'reserving', reserved: 0 });
  const r = await release(g, id);
  ok(r.d.status === 'released' && await month(g) === 30, 'releasing it takes nothing from the other purchase', { r: r.d, month: await month(g) });
  const late = await W.counter(g.env, W._spendMonthKey(EM, 'USD'), { op: 'reserve', amount: 50, cap: 1000, ttlMs: 1000, once: 'buybooked:' + id, unless: 'buyclosed:' + id });
  ok(!late.allowed && late.ended && await month(g) === 30, 'and its booking arriving late is refused', { late, month: await month(g) });
  ok(status(g, other.id) === 'held', 'the other purchase is untouched', status(g, other.id));
}

section('Each currency is its own month');
{
  const f = fixture(); await limits(f, 'USD');
  const usd = (await hold(f, 50, 'USD')).hold;
  await limits(f, 'EUR');
  const eur = (await hold(f, 10, 'EUR')).hold;
  const g = (await call(f, W.spendGet, '/v1/spend/get')).d;
  ok(g.limits.currency === 'EUR' && g.spentThisMonth === 10, 'the euro month counts the euros only', g);
  const s = await settle(f, usd.id, 45, 'U-1');
  ok(s.d.ok && await month(f, 'USD') === 45 && await month(f, 'EUR') === 10, 'a purchase held in dollars settles into the dollar total, after the change', { usd: await month(f, 'USD'), eur: await month(f, 'EUR') });
  ok(s.d.receipt.currency === 'USD', 'and its receipt is in dollars', s.d.receipt);
  await release(f, eur.id);
  ok(await month(f, 'EUR') === 0 && await month(f, 'USD') === 45, 'releasing the euro one gives back euros only', { usd: await month(f, 'USD'), eur: await month(f, 'EUR') });
}

console.log = log;
if (report('a-purchase-closes-once') > 0) process.exitCode = 1;
done();
