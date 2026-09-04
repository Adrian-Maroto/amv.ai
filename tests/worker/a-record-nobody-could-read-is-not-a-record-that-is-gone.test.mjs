/* THREE MORE READS THAT TURNED A CORRUPT RECORD INTO A CONFIDENT WRONG ANSWER.

   Found by grepping the worker for `JSON.parse` inside a catch that swallows,
   after the wallet one (LESSONS 357). Seventeen sites; most fail closed and
   are fine. These three do not.

   1. `DB.list` dropped every unparseable row in silence. `scan` sits directly
      on top of it and is built entirely around the opposite principle -
      truncation is audited, alerted and returned as a flag, because "nobody
      was told" is the failure it exists to prevent - while the reader feeding
      it lost rows without a word. An erasure scan reported success over a
      record it never saw; a backup omitted it and a restore then deleted it
      for real; and worst, `scan` writes a durable "this namespace is empty"
      marker at zero rows, so a kind whose records were ALL corrupt got marked
      empty and every later scan skipped it by design.

   2. `_reverseSale` returned null, which is the signal the Stripe webhook uses
      for "this charge is not a marketplace sale". So a corrupt `saleref:`
      record meant the sale was never reversed - buyer keeps the item, seller
      keeps the credit, platform eats the charge, which is the "buy it and
      charge it back" hole the function exists to close - AND the fallthrough
      treated a $9 listing chargeback as a subscription dispute, revoking the
      customer's whole plan and recording an abuse strike against them.

   3. `_purchasesList` returned [], so the library said "No purchases yet" to
      somebody who had paid. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'corruptreads.harness.mjs');
writeFileSync(harness, src + `
export { DB, scan, marketPurchases, _purchasesList, _reverseSale,
         signToken, UnreadableRecordError };
`);
const W = await import(harness + '?t=' + Date.now());

const BUYER = 'buyer@example.com';
function makeEnv() {
  const kv = new Map();
  return { _kv: kv, JWT_SECRET: 'test-secret-abcdefghijklmnop', ADMIN_TOKEN: 'admin-secret',
    AMV_KV: {
      get: async k => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => { kv.set(k, String(v)); },
      delete: async k => { kv.delete(k); },
      list: async ({ prefix }) => ({
        keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })),
        list_complete: true }),
    } };
}
const tokenFor = (env, email) => W.signToken({ email }, env.JWT_SECRET, 3600, env, 'access');

section('A scan over sound records reports nothing wrong');
/* The control: without it every assertion below could pass on a scan that
   always cries corruption. */
{
  const env = makeEnv();
  await W.DB.put(env, 'thing', 'a', { n: 1 });
  await W.DB.put(env, 'thing', 'b', { n: 2 });
  const r = await W.scan(env, 'thing', 100, 'the control');
  ok(r.rows.length === 2, 'both rows come back', r.rows.length);
  ok(!r.unreadable, 'and nothing is flagged', r.unreadable);
  ok(!r.truncated, 'and it is not truncated');
}

section('A scan that skipped a row says how many');
{
  const env = makeEnv();
  await W.DB.put(env, 'thing', 'a', { n: 1 });
  env._kv.set('thing:broken', '{"n":2,"hal');
  await W.DB.put(env, 'thing', 'c', { n: 3 });
  const r = await W.scan(env, 'thing', 100, 'the erasure sweep');
  ok(r.rows.length === 2, 'the readable rows still come back - it is not all-or-nothing', r.rows.length);
  ok(r.unreadable === 1, 'and the one it could not read is counted', r.unreadable);
}

section('A namespace of nothing but corruption is never marked empty');
/* The durable one. The marker makes every later scan skip the kind entirely,
   so a recoverable corruption becomes data nothing will look at again. `auto`
   because only the cron-scanned kinds carry the marker at all - a scheduled
   job nothing ever runs again is what this costs. */
{
  const env = makeEnv();
  env._kv.set('auto:broken', '{"n":2,"hal');
  const r = await W.scan(env, 'auto', 100, 'the automation sweep');
  ok(r.rows.length === 0, 'the walk finds no readable rows', r.rows.length);
  ok(r.unreadable === 1, 'because the one that is there could not be read', r.unreadable);
  const marker = [...env._kv.keys()].filter(k => /kindempty/.test(k));
  ok(marker.length === 0, 'and no "this namespace is empty" marker is written', marker);
}

section('A namespace that really is empty still gets its marker');
/* Or the fix above would just be "the marker never happens", and the marker is
   what stops the cron re-walking dead namespaces every five minutes. */
{
  const env = makeEnv();
  const r = await W.scan(env, 'auto', 100, 'the automation sweep');
  ok(r.rows.length === 0 && !r.unreadable, 'nothing there, and nothing unreadable', r);
  const marker = [...env._kv.keys()].filter(k => /kindempty/.test(k));
  ok(marker.length === 1, 'so the marker is written, as it always was', marker);
}

section('A chargeback on an unreadable sale is not treated as a subscription');
{
  const env = makeEnv();
  env._kv.set('saleref:ch_123', '{"itemId":"i1","buyer":"b@x.com","sell');
  let thrown = null;
  try { await W._reverseSale(env, 'ch_123', 'dispute'); } catch (e) { thrown = e; }
  ok(thrown instanceof W.UnreadableRecordError,
     'it throws, so the webhook returns 500 and the provider retries', thrown && thrown.name);
  ok(thrown !== null && !/^null$/.test(String(thrown)),
     'rather than returning the null that means "not one of mine"');
}

section('A charge that genuinely is not a marketplace sale still returns null');
/* The distinction the fix rests on. Absent is a subscription charge and must
   keep falling through; unreadable is nothing at all. */
{
  const env = makeEnv();
  const r = await W._reverseSale(env, 'ch_subscription', 'dispute');
  ok(r === null, 'so the webhook still handles subscription disputes', r);
}

section('A library that cannot be read does not report itself empty');
{
  const env = makeEnv();
  env._kv.set('purchases:' + BUYER, '[{"id":"i1","tit');
  let thrown = null;
  try { await W._purchasesList(env, BUYER); } catch (e) { thrown = e; }
  ok(thrown instanceof W.UnreadableRecordError, 'the read refuses', thrown && thrown.name);

  const r = await W.marketPurchases(new Request('https://w/v1/market/purchases',
    { headers: { Authorization: 'Bearer ' + await tokenFor(env, BUYER) } }), env);
  const d = await r.json();
  ok(r.status === 503, 'and the endpoint refuses rather than answering', r.status);
  ok(d.code === 'purchases_unreadable', 'with a code the screen can branch on', d.code);
  ok(/still yours/i.test(d.error), 'saying what they own is safe', d.error);
  ok(!Array.isArray(d.items), 'and no empty library is handed back', d.items);
}

section('A buyer who has bought nothing still gets an empty library');
{
  const env = makeEnv();
  const d = await (await W.marketPurchases(new Request('https://w/v1/market/purchases',
    { headers: { Authorization: 'Bearer ' + await tokenFor(env, BUYER) } }), env)).json();
  ok(d.ok === true && Array.isArray(d.items) && d.items.length === 0,
     'absent is still absent, not an error', d);
}

report();
done();
