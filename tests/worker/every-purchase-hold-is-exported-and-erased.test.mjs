/* EVERY PURCHASE HOLD IS EXPORTED AND ERASED, PAST THE FIRST PAGE (Nov 22).

   Build 18's plan left SEC-14 "partial": the per-person index of purchase
   holds exists and the export and erasure walk it page after page, but
   nothing had shown a walk past one page. And nothing here could have: the
   shared test store answered every listing in one go and said it was
   complete, so a loop that stops after page one passed every suite.

   The store now lists as the real one does - 1,000 keys a page, with a
   cursor - and this seeds 2,350 holds for one person (three pages), one more
   from the list kept before the index existed, and one for somebody else.
   The export must return all 2,351 of theirs and none of the other person's;
   erasure must leave none of theirs and the other person's untouched. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomBytes } from 'crypto';
import { ok, section, report, done } from '../lib/assert.mjs';
import { makeEnv } from '../lib/live-backend.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'holdpages.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `
export { accountExport, _eraseAccount, DB, _buyIxKey, _buyHoldIds };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());
const log = console.log; console.log = (...a) => { if (!/^AUDIT|"event"/.test(String(a[0]))) log(...a); };
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });

const EM = 'many-holds@example.com', OTHER = 'someone-else@example.com';
const N = 2350;
const env = makeEnv();
const hid = () => 'bh_' + randomBytes(12).toString('hex');
const mine = new Set();
const t0 = Date.now() - N * 1000;
for (let i = 0; i < N; i++) {
  const id = hid(); mine.add(id);
  await env.AMV_KV.put(W._buyIxKey(EM, t0 + i * 1000, id), '1');
  await W.DB.put(env, 'buyhold', id, { id, email: EM, status: 'settled', amount: 1 + (i % 50), currency: 'USD', at: t0 + i * 1000 });
}
/* One from before the index: only in the old list. */
const legacy = hid(); mine.add(legacy);
await W.DB.put(env, 'buyholds', EM, [legacy]);
await W.DB.put(env, 'buyhold', legacy, { id: legacy, email: EM, status: 'settled', amount: 3, currency: 'USD', at: t0 - 5000 });
/* Somebody else's. */
const theirs = hid();
await env.AMV_KV.put(W._buyIxKey(OTHER, t0, theirs), '1');
await W.DB.put(env, 'buyhold', theirs, { id: theirs, email: OTHER, status: 'held', amount: 9, currency: 'USD', at: t0 });

section('The store really pages');
{
  const first = await env.AMV_KV.list({ prefix: '', limit: 1000 });
  ok(first.keys.length === 1000 && first.list_complete === false && !!first.cursor,
     'a listing of more than 1,000 keys comes back in pages, with a cursor', { n: first.keys.length, complete: first.list_complete });
  let pages = 0, cur = null, seen = 0;
  do { const pg = await W._buyHoldIds(env, EM, cur, 1000); seen += pg.ids.length; cur = pg.next; pages++; } while (cur && pages < 20);
  ok(pages >= 3 && seen === N + 1, 'and one person’s holds take three pages to walk', { pages, seen });
}

section('The export carries every hold, and only theirs');
{
  W.__setRequireUser(async () => ({ email: EM, plan: 'pro' }));
  const r = await W.accountExport(new Request('https://x/v1/account/export', { headers: { 'CF-Connecting-IP': '7.7.7.7' } }), env);
  const d = await r.json();
  const rec = (d.records || (d.data && d.data.records) || {}).buyhold || [];
  const ids = new Set(rec.map(h => h.id));
  ok(r.status === 200, 'the export answers', r.status);
  ok(ids.size === N + 1 && [...mine].every(id => ids.has(id)), `all ${N + 1} of the person’s holds are in it, across every page and the old list`, ids.size);
  ok(!ids.has(theirs), 'and somebody else’s is not');
}

section('Erasure removes every hold, and only theirs');
{
  const res = await W._eraseAccount(env, EM, {});
  let left = 0;
  for (const id of mine) if (await W.DB.get(env, 'buyhold', id)) left++;
  ok(left === 0, `none of the person’s ${N + 1} holds is left`, { left, res: res && (res.failed || res.survived) });
  const ixLeft = (await env.AMV_KV.list({ prefix: W._buyIxKey(EM, 0, 'x').split(':').slice(0, -2).join(':') + ':', limit: 1000 })).keys.length;
  ok(ixLeft === 0, 'nor any key of their index', ixLeft);
  ok(!!(await W.DB.get(env, 'buyhold', theirs)), 'and the other person’s hold is still there');
}

if (report('every-purchase-hold-is-exported-and-erased') > 0) process.exitCode = 1;
done();
