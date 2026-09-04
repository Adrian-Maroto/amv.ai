/* THE READ THAT INVENTED A ZERO, AND THE WRITE THAT MADE IT PERMANENT.

   `_wallet` was `try { return JSON.parse(raw) } catch {}` falling through to
   `{ balance: 0, lifetime: 0, holds: [] }`. So a seller whose wallet record
   became unparseable was indistinguishable from one who has never sold
   anything, and two things followed.

   The screen showed $0.00 available, $0.00 lifetime and "No earnings yet -
   sell something to start" to somebody who is owed money - eight lines from a
   comment that says "Never a fabricated zero" about the network-failure path.

   And `_withWallet`, the lock EVERY money path goes through, is read-mutate-
   `_saveWallet`. A sale credit landing on a corrupt record did not fail: it
   wrote the fabricated zero plus the new sale over the top. The balance, the
   lifetime total and the holds array were gone, permanently, and nothing said
   so. `_withKV` - which every other locked record uses - has always refused
   exactly this: "Nothing is known about this record, so nothing may be written
   over it." The money one was the one that did not.

   Absent is still a new seller. Only present-and-unparseable refuses. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'walletcorrupt.harness.mjs');
writeFileSync(harness, src + `
export { DB, marketWithdraw, marketEarnings, _wallet, _saveWallet, _walletTx,
         _withWallet, _pushWalletTx, signToken, UnreadableRecordError, MARKET_MIN_WITHDRAW };
`);
const W = await import(harness + '?t=' + Date.now());

const SELLER = 'seller@example.com';

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
async function adult(env, email) {
  await W.DB.put(env, 'consent', String(email).toLowerCase(),
    { birthYear: new Date().getUTCFullYear() - 30, ageSetAt: Date.now(), history: [] });
}
const tokenFor = (env, email) => W.signToken({ email }, env.JWT_SECRET, 3600, env, 'access');
const earnings = (env, token) => W.marketEarnings(
  new Request('https://w/v1/market/earnings', { headers: { Authorization: 'Bearer ' + token } }), env);
const withdraw = (env, token, destination) => W.marketWithdraw(
  new Request('https://w/v1/market/withdraw',
    { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ destination }) }), env);

/* What a real corrupt record looks like: a write that was cut off. */
const TRUNCATED = '{"balance":412.5,"lifetime":980.25,"currency":"usd","hol';

section('A seller who has never sold anything still gets a wallet');
/* The control. Absent must stay absent-and-fine, or the fix below would just
   be "every new seller is an error". */
{
  const env = makeEnv();
  const w = await W._wallet(env, SELLER);
  ok(w.balance === 0 && w.lifetime === 0, 'a fresh wallet, not a failure', w);
  ok(Array.isArray(w.holds) && w.holds.length === 0, 'with nothing held', w.holds);
  ok((await W._walletTx(env, SELLER)).length === 0, 'and an empty money history');
}

section('A wallet that cannot be parsed refuses to be read as zero');
{
  const env = makeEnv();
  env._kv.set('wallet:' + SELLER, TRUNCATED);
  let thrown = null;
  try { await W._wallet(env, SELLER); } catch (e) { thrown = e; }
  ok(thrown instanceof W.UnreadableRecordError, 'it throws rather than answering', thrown && thrown.name);
  ok(/wallet:/.test(String(thrown && thrown.message)), 'naming the record', thrown && thrown.message);
}

section('And a sale landing on it does not overwrite the money');
/* The one that cannot be undone. Before: the credit read a fabricated zero,
   added its own amount, and wrote that over a balance of $412.50. */
{
  const env = makeEnv();
  env._kv.set('wallet:' + SELLER, TRUNCATED);
  let thrown = null;
  try { await W._withWallet(env, SELLER, (w) => { w.balance = +(w.balance + 25).toFixed(2); }); }
  catch (e) { thrown = e; }
  ok(thrown !== null, 'the credit fails instead of succeeding on a guess', thrown && thrown.name);
  ok(env._kv.get('wallet:' + SELLER) === TRUNCATED,
     'and the record on disk is byte-for-byte what it was, so it can still be recovered',
     String(env._kv.get('wallet:' + SELLER)).slice(0, 40));
}

section('The earnings screen is told, rather than shown a zero');
{
  const env = makeEnv();
  await adult(env, SELLER);
  env._kv.set('wallet:' + SELLER, TRUNCATED);
  const r = await earnings(env, await tokenFor(env, SELLER));
  const d = await r.json();
  ok(r.status === 503, 'it refuses rather than answering', r.status);
  ok(d.code === 'wallet_unreadable', 'with a code the screen can branch on', d.code);
  ok(d.balance === undefined && d.available === undefined,
     'and no balance at all, invented or otherwise', { balance: d.balance, available: d.available });
  ok(/nothing has changed/i.test(d.error) || /where it was/i.test(d.error),
     'saying their money is untouched, which is the thing they need to hear', d.error);
}

section('And a withdrawal against it is refused, not priced at zero');
/* Before, this path answered "Minimum withdrawal is $10. You have $0.00
   available." - a specific, confident, false number, at the one moment a
   seller is trying to get paid. */
{
  const env = makeEnv();
  await adult(env, SELLER);
  env._kv.set('wallet:' + SELLER, TRUNCATED);
  const r = await withdraw(env, await tokenFor(env, SELLER), 'seller@paypal.example');
  const d = await r.json();
  ok(d.code === 'wallet_unreadable', 'it says it could not read the balance', d.code);
  ok(!/\$0\.00 available/.test(String(d.error)), 'rather than quoting a zero it made up', d.error);
  ok(env._kv.get('wallet:' + SELLER) === TRUNCATED, 'and nothing was debited');
}

section('A money history that cannot be read does not sink the balances');
/* Separate records, so they degrade separately. The numbers are still right;
   only the list is missing. */
{
  const env = makeEnv();
  await adult(env, SELLER);
  await W._saveWallet(env, SELLER, { balance: 412.5, lifetime: 980.25, currency: 'usd', holds: [] });
  env._kv.set('wallet_tx:' + SELLER, '[{"type":"sale","amount":8.0,"tit');
  const d = await (await earnings(env, await tokenFor(env, SELLER))).json();
  ok(d.ok === true, 'the screen still loads', d.ok);
  ok(d.balance === 412.5 && d.lifetime === 980.25, 'with the real numbers', [d.balance, d.lifetime]);
  ok(d.txUnavailable === true, 'and the list marked unreadable', d.txUnavailable);
  ok((d.tx || []).length === 0, 'rather than a half-parsed one', (d.tx || []).length);
}

section('A history longer than what is sent says how much longer');
/* The list is capped at 50 under a heading that reads "Transaction history",
   which claims a completeness the response cannot support. */
{
  const env = makeEnv();
  await adult(env, SELLER);
  await W._saveWallet(env, SELLER, { balance: 10, lifetime: 600, currency: 'usd', holds: [] });
  const many = Array.from({ length: 60 }, (_, i) => ({ type: 'sale', amount: 10, title: 'item ' + i, ts: i }));
  env._kv.set('wallet_tx:' + SELLER, JSON.stringify(many));
  const d = await (await earnings(env, await tokenFor(env, SELLER))).json();
  ok(d.tx.length === 50, 'fifty are sent', d.tx.length);
  ok(d.txTotal === 60, 'and the real count goes with them', d.txTotal);
  ok(d.txTruncated === true, 'flagged, so the screen can say which fifty these are', d.txTruncated);
  ok(d.txUnavailable === false, 'and not confused with the unreadable case', d.txUnavailable);
}

section('A history that fits is not dressed up as truncated');
{
  const env = makeEnv();
  await adult(env, SELLER);
  await W._saveWallet(env, SELLER, { balance: 10, lifetime: 20, currency: 'usd', holds: [] });
  env._kv.set('wallet_tx:' + SELLER, JSON.stringify([{ type: 'sale', amount: 10, ts: 1 }]));
  const d = await (await earnings(env, await tokenFor(env, SELLER))).json();
  ok(d.txTruncated === false, 'no warning is invented', d.txTruncated);
  ok(d.txTotal === 1, 'and the count is the count', d.txTotal);
}

report();
done();
