/* FIVE MONEY PATHS WROTE THE SELLER'S HISTORY. NONE OF THEM WAITED.

   `_pushWalletTx` was a read, an unshift and a put - a read-modify-write with
   nothing serialising it - and it is called from every path that moves a
   seller's money:

       _creditSaleWork   a sale
       _reverseSale      a chargeback clawing one back
       marketWithdraw    money going out
       adminPayoutMark   a payout returned, and a payout marked paid

   Two of those landing together lost one of the two lines. That record is what
   a seller reads to understand what happened to their money, and what an
   operator reads when somebody says they were not paid.

   THE SINGLE-WRITER SHAPE IS WHAT HID IT. Every other record with this problem
   had several handlers writing it, which is visible in a diff. This is one
   function with five callers, which reads as safe and is not - the race is
   between the CALLERS, not in the function.

   It is also why the lock sweep next door is silent about it: `wallet_tx` had
   no locked writer anywhere, so the rule that file enforces - locked somewhere,
   therefore locked everywhere - never engaged at all. A record that nobody ever
   locked is invisible to a check about locks being taken consistently. Going
   through the shared helper is what puts it inside that rule.

   And it stopped being merely a log. The dedupe in it is what tells a retried
   sale that its history line already exists, so a lost line no longer just
   leaves a gap - it lets the next attempt write a second one. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'wallettx.harness.mjs');
writeFileSync(harness, src +
  '\nexport { DB, _wallet, _saveWallet, _walletTx, _pushWalletTx, _creditSale, marketWithdraw,' +
  ' adminPayoutMark, issueTokens };\n');
const W = await import(harness + '?t=' + Date.now());

section('The history is written through the lock, by the only thing that writes it');
{
  const body = codeOnly(functionBody(src, '_pushWalletTx'));
  ok(/_withKV\(env, 'wallet_tx'/.test(body),
     'the append goes through the shared locked helper', true);
  ok(!/AMV_KV\.put/.test(body),
     'and not straight at the namespace, which is what could be raced', true);

  /* The key has to be the one it always used, or every seller's history starts
     again from empty and the old one is orphaned - a silent data loss dressed
     up as a fix. `_withKV` writes `<name>:<key>`, and `_walletTx` reads
     `wallet_tx:${email}`, so the key must be passed through untouched. */
  ok(!/toLowerCase\(\)/.test(body),
     'with the key untouched, so reads and writes cannot drift apart', true);
  const read = codeOnly(functionBody(src, '_walletTx'));
  ok(/wallet_tx:\$\{email\}/.test(read), 'and the reader still reads that key', true);
}

section('Every writer of the history goes through that one function');
{
  /* If a sixth path appends directly, the lock is decoration again. Computed:
     nothing may write a `wallet_tx:` key except the helper and the locked
     path underneath it. */
  const code = codeOnly(src);
  const decls = [...code.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)]
    .map(m => ({ name: m[1], at: m.index }));
  /* The key being BUILT, not the string being mentioned. BACKUP_PREFIXES lists
     `'wallet_tx:'` so the record is included in a snapshot, which is a mention
     and not a write - and matching the bare string reported it as a sixth
     writer sitting in whatever function happened to precede the constant. A
     checker that reports a backup list as a race is one nobody trusts twice. */
  const owners = [];
  for (const m of code.matchAll(/wallet_tx:\$\{|_withKV\(env, 'wallet_tx'/g)) {
    let owner = '';
    for (const d of decls) { if (d.at <= m.index) owner = d.name; else break; }
    if (owner) owners.push(owner);
  }
  const unexpected = [...new Set(owners)].filter(n => !['_walletTx', '_pushWalletTx'].includes(n));
  ok(unexpected.length === 0,
     'only the reader and the locked appender name that key at all', unexpected);
}

let FAIL = null;
function mkEnv() {
  const m = new Map(), vals = new Map(), claims = new Map();
  return {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', ADMIN_TOKEN: 'admin-secret', APP_URL: 'https://amv.test',
    _map: m,
    AMV_KV: {
      /* Reads and writes yield, so two concurrent money paths really interleave.
         Without this the test would pass on unlocked code and prove nothing. */
      async get(k) { await new Promise(r => setTimeout(r, 1)); return m.has(k) ? m.get(k) : null; },
      async put(k, v) { await new Promise(r => setTimeout(r, 1)); if (FAIL && k.includes(FAIL)) throw new Error('refused'); m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: all.slice(0, limit || 1000), list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (x) => x,
      get: (x) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(x) || 0;
        if (b.op === 'claim') {
          const held = claims.get(x);
          if (held && held > Date.now()) return new Response(JSON.stringify({ claimed: false }));
          claims.set(x, Date.now() + Math.max(1000, Number(b.ttlMs) || 30000));
          return new Response(JSON.stringify({ claimed: true }));
        }
        if (b.op === 'release') { claims.delete(x); return new Response(JSON.stringify({ released: true })); }
        if (b.op === 'incr') { vals.set(x, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(x) })); }
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: cur < b.cap, value: cur }));
        if (b.op === 'rateCheck') { vals.set(x, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}

const SELLER = 'seller@test.com';
const settle = (env, id, status) => W.adminPayoutMark(new Request('https://api/admin/payouts/mark', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'admin-secret', 'CF-Connecting-IP': '4.4.4.4' },
  body: JSON.stringify({ id, status }),
}), env);

section('Two appends at the same instant are two lines');
{
  /* THE RACE ITSELF, with nothing else in the way.

     The higher-level cases below go through whole handlers, and whether their
     appends actually overlap depends on how much work each does first - so
     they can pass on unlocked code, which makes them poor evidence for the one
     thing this file is about. This is the read-modify-write, twice, at the same
     moment: unlocked, both read the same list, both unshift, both write, and
     one line is gone. */
  const env = mkEnv();
  await W._saveWallet(env, SELLER, { balance: 0, lifetime: 0, holds: [], payouts: [], paidOut: 0 });
  await Promise.all([
    W._pushWalletTx(env, SELLER, { type: 'sale', amount: 1, item: 'usr_1', ref: 'ch_1', ts: Date.now() }),
    W._pushWalletTx(env, SELLER, { type: 'sale', amount: 2, item: 'usr_2', ref: 'ch_2', ts: Date.now() }),
  ]);
  const lines = await W._walletTx(env, SELLER);
  ok(lines.length === 2,
     'both survive - neither read a list the other was about to replace',
     { lines: lines.length, items: lines.map(l => l.item) });
}

section('A sale and a payout return landing together both reach the history');
{
  const env = mkEnv();
  await W._saveWallet(env, SELLER, { balance: 0, lifetime: 0, holds: [], payouts: [], paidOut: 100 });
  await env.AMV_KV.put('withdraw:wd_return01', JSON.stringify({
    id: 'wd_return01', seller: SELLER, amount: 100, destination: 'p@t.com', status: 'approved', ts: Date.now(),
  }));
  await W.DB.put(env, 'market', 'usr_a', { id: 'usr_a', title: 'A', kind: 'prompt', price: 20, authorEmail: SELLER, status: 'active' });

  await Promise.all([
    settle(env, 'wd_return01', 'rejected'),
    W._creditSale(env, { itemId: 'usr_a', buyer: 'b@t.com', seller: SELLER, amountCents: 2000, ref: 'ch_a' }),
  ]);

  const lines = await W._walletTx(env, SELLER);
  const kinds = lines.map(l => l.type).sort();
  ok(lines.length === 2,
     'both lines are there - neither write overwrote the other', { lines: lines.length, kinds });
  ok(kinds.includes('sale') && kinds.includes('withdrawal_returned'),
     'the sale AND the returned payout, which is what the seller needs to see', kinds);
}

section('Three at once, because two is the easy case');
{
  const env = mkEnv();
  await W._saveWallet(env, SELLER, { balance: 0, lifetime: 0, holds: [], payouts: [], paidOut: 0 });
  for (const id of ['usr_p', 'usr_q', 'usr_r']) {
    await W.DB.put(env, 'market', id, { id, title: id, kind: 'prompt', price: 10, authorEmail: SELLER, status: 'active' });
  }
  await Promise.all(['usr_p', 'usr_q', 'usr_r'].map((id, i) =>
    W._creditSale(env, { itemId: id, buyer: 'b' + i + '@t.com', seller: SELLER, amountCents: 1000, ref: 'ch_' + id })));

  const lines = await W._walletTx(env, SELLER);
  ok(lines.length === 3, 'three sales at once are three lines', lines.length);
  const items = new Set(lines.map(l => l.item));
  ok(items.size === 3, 'one for each item, none lost to another', [...items]);

  const w = await W._wallet(env, SELLER);
  ok(w.balance === 24, 'and the balance is the sum of all three, not the last one', w.balance);
}

section('The dedupe still holds, so a retry does not double a line');
{
  const env = mkEnv();
  await W._saveWallet(env, SELLER, { balance: 0, lifetime: 0, holds: [], payouts: [], paidOut: 0 });
  const tx = { type: 'sale', amount: 8, item: 'usr_z', ref: 'ch_z', ts: Date.now() };
  const first = await W._pushWalletTx(env, SELLER, tx);
  const second = await W._pushWalletTx(env, SELLER, { ...tx, ts: Date.now() + 1 });
  ok(first === true, 'the first write happens', first);
  ok(second === false, 'and the same event again does not', second);
  ok((await W._walletTx(env, SELLER)).length === 1, 'one line', (await W._walletTx(env, SELLER)).length);
}

section('And a line with no reference is still appended, as it always was');
{
  /* A withdrawal has no charge to key on. It must not be deduped into silence
     just because the seller withdrew the same amount twice. */
  const env = mkEnv();
  await W._saveWallet(env, SELLER, { balance: 0, lifetime: 0, holds: [], payouts: [], paidOut: 0 });
  await W._pushWalletTx(env, SELLER, { type: 'withdrawal', amount: -50, id: 'wd_one00001', ts: Date.now() });
  await W._pushWalletTx(env, SELLER, { type: 'withdrawal', amount: -50, id: 'wd_two00001', ts: Date.now() });
  ok((await W._walletTx(env, SELLER)).length === 2,
     'two withdrawals of the same size are two lines', (await W._walletTx(env, SELLER)).length);
}

if (report('a-money-history-five-paths-write') > 0) process.exitCode = 1;
done();
