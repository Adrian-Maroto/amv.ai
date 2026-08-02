/* PAYOUTS - the money had nowhere to go.

   A seller could request a withdrawal. Their balance was zeroed, a debit was
   written to their log, and a record was stored under `withdraw:<id>` - which
   nothing in the product ever read. No endpoint listed it, no screen showed
   it, no way to mark one paid.

   So the seller's money left their balance and arrived nowhere, and the
   operator had no idea they owed anybody anything. Destroyed user funds and an
   undisclosed liability, from one missing reader. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'payouts.harness.mjs');
writeFileSync(harness, src + `
export { DB, marketWithdraw, marketEarnings, adminPayouts, adminPayoutMark,
         _wallet, _saveWallet, _walletTx, signToken, MARKET_MIN_WITHDRAW };
`);
const W = await import(harness + '?t=' + Date.now());

/* Money endpoints now require a recorded adult age - an account that has never
   been asked is refused with age_required, which is a prompt rather than a
   verdict. Production accounts answer it once; fixtures have to say it too. */
async function _adult(env, email){
  await W.DB.put(env, 'consent', String(email).toLowerCase(),
    { birthYear: new Date().getUTCFullYear() - 30, ageSetAt: Date.now(), history: [] });
}

function makeEnv() {
  const kv = new Map();
  return { _kv: kv, JWT_SECRET: 'test-secret-abcdefghijklmnop', ADMIN_TOKEN: 'admin-secret',
    AMV_KV: {
      get: async k => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => { kv.set(k, String(v)); },
      delete: async k => { kv.delete(k); },
      list: async ({ prefix, cursor, limit }) => ({
        keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })),
        list_complete: true,
      }),
    } };
}
const tokenFor = (env, email) => W.signToken({ email }, env.JWT_SECRET, 3600, env, 'access');
const withdraw = (env, token, destination) => W.marketWithdraw(new Request('https://w/v1/market/withdraw',
  { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ destination }) }), env);
const adminGet = (env) => W.adminPayouts(new Request('https://w/admin/payouts',
  { headers: { Authorization: 'Bearer admin-secret' } }), env);
const mark = (env, body) => W.adminPayoutMark(new Request('https://w/admin/payouts/mark',
  { method: 'POST', headers: { Authorization: 'Bearer admin-secret' }, body: JSON.stringify(body) }), env);
const balanceOf = async (env, email) => (await W._wallet(env, email)).balance;

async function fund(env, email, amount) {
  const w = await W._wallet(env, email);
  w.balance = amount; w.lifetime = amount;
  await W._saveWallet(env, email, w);
  /* Somebody with a balance to withdraw is somebody who has used the product,
     so they have answered the age question. Seeded with the money. */
  await _adult(env, email);
}

section('A requested payout is visible to the operator, with what is owed');
{
  const env = makeEnv();
  await fund(env, 'seller@x.com', 120);
  const token = await tokenFor(env, 'seller@x.com');
  const d = await (await withdraw(env, token, 'paypal: seller@x.com')).json();
  ok(d.ok === true && d.amount === 120, 'the withdrawal is accepted', d);
  ok((await balanceOf(env, 'seller@x.com')) === 0, 'and the balance is debited');

  const list = await (await adminGet(env)).json();
  ok(list.payouts.length === 1, 'the operator can SEE it - nothing read this record before', list.payouts.length);
  ok(list.payouts[0].seller === 'seller@x.com', 'with who is owed', list.payouts[0].seller);
  ok(list.payouts[0].destination === 'paypal: seller@x.com', 'and where they asked it to go');
  ok(list.owed === 120, 'and the total owed, which is a liability until it is paid', list.owed);
  ok(list.pendingCount === 1, 'counted');
}

section('Marking one paid settles it, once');
{
  const env = makeEnv();
  await fund(env, 'seller@x.com', 60);
  const d = await (await withdraw(env, await tokenFor(env, 'seller@x.com'), 'bank ref 123')).json();

  const r = await (await mark(env, { id: d.id, status: 'paid', note: 'sent' })).json();
  ok(r.ok === true && r.status === 'paid', 'it can be marked paid', r);

  const list = await (await adminGet(env)).json();
  ok(list.owed === 0, 'and it stops counting as owed', list.owed);
  ok(list.paidTotal === 60, 'moving into what has been paid', list.paidTotal);

  const again = await mark(env, { id: d.id, status: 'paid' });
  ok(again.status === 409, 'settling twice is refused - it is money', again.status);
  ok((await again.json()).code === 'already_settled', 'with a reason');
}

section('Rejecting a payout gives the money BACK');
{
  /* The balance was debited when the request was made. A payout that will never
     be sent has to return it, or rejecting is just a second way to destroy the
     same money. */
  const env = makeEnv();
  await fund(env, 'seller@x.com', 90);
  const d = await (await withdraw(env, await tokenFor(env, 'seller@x.com'), 'bad details')).json();
  ok((await balanceOf(env, 'seller@x.com')) === 0, 'debited on request');

  await mark(env, { id: d.id, status: 'rejected', note: 'destination unusable' });
  ok((await balanceOf(env, 'seller@x.com')) === 90, 'and returned in full on rejection',
     await balanceOf(env, 'seller@x.com'));

  const tx = await W._walletTx(env, 'seller@x.com');
  ok(tx.some(t => t.type === 'withdrawal_returned' && t.amount === 90),
     'with the return recorded, so the log balances', tx.map(t => t.type));

  const list = await (await adminGet(env)).json();
  ok(list.owed === 0, 'and nothing is still owed on it', list.owed);
}

section('Two withdrawals at once cannot both take the same balance');
{
  const env = makeEnv();
  await fund(env, 'seller@x.com', 100);
  const token = await tokenFor(env, 'seller@x.com');
  const [a, b] = await Promise.all([withdraw(env, token, 'x'), withdraw(env, token, 'x')]);
  const ja = await a.json(), jb = await b.json();
  const okCount = [ja, jb].filter(x => x.ok).length;
  ok(okCount === 1, 'exactly one succeeds', [ja, jb]);
  ok((await balanceOf(env, 'seller@x.com')) === 0, 'and the balance is taken once', await balanceOf(env, 'seller@x.com'));
  const list = await (await adminGet(env)).json();
  ok(list.owed === 100, 'so the operator owes 100, not 200', list.owed);
}

section('Below the minimum, nothing moves');
{
  const env = makeEnv();
  await fund(env, 'small@x.com', 1);
  const r = await withdraw(env, await tokenFor(env, 'small@x.com'), 'x');
  ok(r.status === 400, 'a tiny balance cannot be withdrawn', r.status);
  ok((await balanceOf(env, 'small@x.com')) === 1, 'and the balance is untouched by the refusal');
  ok((await (await adminGet(env)).json()).payouts.length === 0, 'with no phantom payout created');
}

section('Only the operator can see or settle payouts');
{
  const env = makeEnv();
  await fund(env, 'seller@x.com', 50);
  const d = await (await withdraw(env, await tokenFor(env, 'seller@x.com'), 'x')).json();

  const anon = await W.adminPayouts(new Request('https://w/admin/payouts'), env);
  ok(anon.status === 403, 'who is owed what is not public', anon.status);

  const badMark = await W.adminPayoutMark(new Request('https://w/admin/payouts/mark',
    { method: 'POST', headers: { Authorization: 'Bearer nope' }, body: JSON.stringify({ id: d.id, status: 'paid' }) }), env);
  ok(badMark.status === 403, 'and nobody else can mark their own payout paid', badMark.status);
  ok((await (await adminGet(env)).json()).owed === 50, 'so it is still owed', (await (await adminGet(env)).json()).owed);
}

section('A settlement has to name a real state');
{
  const env = makeEnv();
  await fund(env, 'seller@x.com', 40);
  const d = await (await withdraw(env, await tokenFor(env, 'seller@x.com'), 'x')).json();
  ok((await mark(env, { id: d.id, status: 'pending' })).status === 400, 'pending is not a settlement');
  ok((await mark(env, { id: d.id, status: 'whatever' })).status === 400, 'nor is anything invented');
  ok((await mark(env, { id: 'wd_nope', status: 'paid' })).status === 404, 'and an unknown id is not found');
  ok((await (await adminGet(env)).json()).owed === 40, 'none of which changed the money', (await (await adminGet(env)).json()).owed);
}

report('payouts');
done();
