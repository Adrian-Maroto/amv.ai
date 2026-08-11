/* THE ONE FIGURE A FILING NEEDS, AND THE ONE PLACE IT DID NOT EXIST.

   If AMV pays somebody more than $600 in a calendar year, that has to be
   reported, and their taxpayer details had to be collected BEFORE the money
   went out rather than chased afterwards. So the question "what did AMV pay
   this person in year N" is not an analytics nicety - it is the number, and
   getting it wrong is a penalty rather than a bad dashboard.

   It could not be answered. `wallet.paidOut` is a lifetime running total with
   no year boundary. `wallet.payouts` keeps the last TWENTY, because it exists
   for the velocity signal. `wallet_tx` keeps 500. The withdraw: ledger does
   carry seller, amount and time - but the only way to total a year from it is
   the admin scan, which lists KV in KEY order, caps at 5000 records and
   already says its totals are a floor. At forty sellers that is fine. At forty
   thousand the filing is a guess.

   And the two thresholds were one number doing two jobs. Identity is fairly
   measured over a lifetime; reporting is measured over a calendar year, and
   they only look the same until somebody moves one for a fraud reason. A
   seller paid $400 in each of three years has passed the lifetime mark and has
   never been reportable. One paid $700 in their first year is reportable and
   has passed nothing measured over a lifetime.

   Checked here: the year record is written where the money actually LEAVES and
   not when it is requested, a rejected payout never counts, the totals survive
   an erasure that takes the wallet, and an account cannot be deleted out from
   under a payout still in flight. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { functionBody, codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'taxyear.harness.mjs');
writeFileSync(harness, src +
  '\nexport { _recordPaidForTax, _paidThisYear, _payoutsInFlight, _payoutRisk, taxYearOf,' +
  ' TAX_REPORT_THRESHOLD_USD, PAYOUT_KYC_THRESHOLD_USD, PER_USER_KINDS, BACKUP_PREFIXES, adminPayoutMark };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = {
  ADMIN_TOKEN: 'tok',
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix, cursor, limit }) {
      const keys = [...store.keys()].filter(k => k.startsWith(prefix || '')).sort();
      return { keys: keys.map(name => ({ name })), list_complete: true, cursor: undefined };
    },
  },
};
const YEAR = new Date().getUTCFullYear();
const adminReq = (body) => new Request('https://w/admin/payouts/mark', {
  method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

section('The year record exists, and is keyed so one year is one prefix');
{
  store.clear();
  await W._recordPaidForTax(env, 'Seller@X.com', 120, Date.UTC(YEAR, 2, 1));
  const key = `payoutyear:${YEAR}:seller@x.com`;
  ok(store.has(key), 'a payout writes a row for that seller and that year', [...store.keys()]);
  /* Parsed defensively so a MISSING row reads as a failed assertion rather
     than a stack trace - the run still goes red either way, but a crash tells
     the next person the check is broken instead of the code. */
  const r = JSON.parse(store.get(key) || '{}');
  ok(r.paid === 120 && r.count === 1, 'with what was paid and how many times', r);
  ok(r.reportable === false, 'and whether it is past the line, which $120 is not', r.reportable);

  /* Year first. This is the whole reason it is not keyed by seller: the
     reporting population for a year is one prefix list rather than a scan of
     every withdrawal ever made. */
  ok(key.indexOf(String(YEAR)) < key.indexOf('seller@'),
     'the year comes before the seller in the key', key);
}

section('It accumulates, and crosses the line where it should');
{
  store.clear();
  await W._recordPaidForTax(env, 's@x.com', 400, Date.UTC(YEAR, 1, 1));
  let r = JSON.parse(store.get(`payoutyear:${YEAR}:s@x.com`) || '{}');
  ok(r.reportable === false, '$400 is not reportable', r.paid);
  await W._recordPaidForTax(env, 's@x.com', 250, Date.UTC(YEAR, 5, 1));
  r = JSON.parse(store.get(`payoutyear:${YEAR}:s@x.com`) || '{}');
  ok(r.paid === 650 && r.count === 2, 'two payouts add up', r);
  ok(r.reportable === true, 'and $650 is past the $600 line', r);
  ok(r.firstAt < r.lastAt, 'with the span of the year recorded', [r.firstAt, r.lastAt]);
}

section('A new year starts at zero, which is the entire point of it');
{
  store.clear();
  await W._recordPaidForTax(env, 's@x.com', 500, Date.UTC(YEAR - 1, 10, 1));
  await W._recordPaidForTax(env, 's@x.com', 500, Date.UTC(YEAR, 0, 15));
  const last = JSON.parse(store.get(`payoutyear:${YEAR - 1}:s@x.com`) || '{}');
  const now = JSON.parse(store.get(`payoutyear:${YEAR}:s@x.com`) || '{}');
  ok(last.paid === 500 && now.paid === 500,
     '$1000 across two years is $500 in each, not $1000 in one', { last: last.paid, now: now.paid });
  ok(!last.reportable && !now.reportable,
     'and neither year is reportable, which the lifetime total would have got wrong', true);
  ok(await W._paidThisYear(env, 's@x.com') === 500,
     'the reader answers for THIS year', await W._paidThisYear(env, 's@x.com'));
}

section('The two thresholds are two numbers, because they answer two questions');
{
  ok(typeof W.TAX_REPORT_THRESHOLD_USD === 'number', 'the reporting line is its own constant', W.TAX_REPORT_THRESHOLD_USD);
  const risk = codeOnly(functionBody(src, '_payoutRisk'));
  ok(/_paidThisYear\(/.test(risk),
     'the risk engine asks the calendar year for the reporting line', true);
  ok(/paidOut/.test(risk),
     'and still asks the lifetime figure for identity, which is a different question', true);
}

section('A payout being REQUESTED does not count; being sent does');
{
  /* paidOut is incremented at request time, deliberately, because for the
     identity signal counting money on its way out is the conservative
     direction. Reporting is the opposite: what is reportable is what was
     actually sent, and a requested-then-rejected payout must not inflate
     anybody's year. */
  const mark = codeOnly(functionBody(src, 'adminPayoutMark'));
  const paidAt = mark.indexOf('_recordPaidForTax');
  const rejectedAt = mark.indexOf("status === 'rejected'");
  ok(paidAt > 0, 'the year record is written when a payout settles', paidAt);
  ok(paidAt > rejectedAt, 'on the paid branch, after the rejected one', { paidAt, rejectedAt });

  store.clear();
  store.set('withdraw:wd_aaaa1111', JSON.stringify({ id: 'wd_aaaa1111', seller: 's@x.com', amount: 700, status: 'pending', ts: Date.now() }));
  store.set('withdraw:wd_bbbb2222', JSON.stringify({ id: 'wd_bbbb2222', seller: 's@x.com', amount: 900, status: 'pending', ts: Date.now() }));
  await W.adminPayoutMark(adminReq({ id: 'wd_aaaa1111', status: 'rejected' }), env);
  ok(!store.has(`payoutyear:${YEAR}:s@x.com`),
     'a REJECTED payout writes no year record at all', [...store.keys()].filter(k => k.startsWith('payoutyear')));
  await W.adminPayoutMark(adminReq({ id: 'wd_bbbb2222', status: 'paid' }), env);
  const r = JSON.parse(store.get(`payoutyear:${YEAR}:s@x.com`) || '{}');
  ok(r.paid === 900, 'and a PAID one records exactly what was sent', r);
}

section('The record outlives the account, and the person is told that it does');
{
  /* Money actually sent has to be kept under tax and anti-money-laundering
     rules, and the right to erasure does not override a legal retention
     obligation. Keeping it silently would be the wrong way to be right. */
  ok(!W.PER_USER_KINDS.includes('withdraw'), 'erasure does not take the payout ledger', true);
  ok(!W.PER_USER_KINDS.includes('payoutyear'), 'nor the year totals built from it', true);
  ok(W.PER_USER_KINDS.includes('wallet') && W.PER_USER_KINDS.includes('wallet_tx'),
     'while the wallet and its history, which are personal, still go', true);
  const del = functionBody(src, 'authDeleteAccount');
  ok(/retained:/.test(del), 'and the deletion reply says what was kept', true);
  ok(/Tax and anti-money-laundering law require these to be kept/.test(del),
     'on what grounds, in words the person asking can read', true);
}

section('And a restore brings the money records back');
{
  /* They were in neither backup list - not excluded, never considered -
     because the completeness check derived its record kinds from DB.put and
     these are written straight to the namespace. */
  ['withdraw:', 'payoutyear:', 'wallet_tx:'].forEach(p => {
    ok(W.BACKUP_PREFIXES.includes(p), p + ' is in the backup', p);
  });
}

section('An account cannot be deleted out from under a payout in flight');
{
  store.clear();
  store.set('withdraw:wd_1111aaaa', JSON.stringify({ id: 'wd_1111aaaa', seller: 'gone@x.com', amount: 40, status: 'pending' }));
  store.set('withdraw:wd_2222bbbb', JSON.stringify({ id: 'wd_2222bbbb', seller: 'gone@x.com', amount: 60, status: 'approved' }));
  store.set('withdraw:wd_3333cccc', JSON.stringify({ id: 'wd_3333cccc', seller: 'gone@x.com', amount: 999, status: 'paid' }));
  store.set('withdraw:wd_4444dddd', JSON.stringify({ id: 'wd_4444dddd', seller: 'other@x.com', amount: 500, status: 'pending' }));
  const held = await W._payoutsInFlight(env, 'gone@x.com');
  ok(held.length === 2, 'pending and approved both count as in flight', held.map(h => h.id));
  ok(!held.some(h => h.status === 'paid'), 'a settled one does not', held.map(h => h.status));
  ok(!held.some(h => h.seller !== 'gone@x.com'), 'and somebody else’s payout is not theirs', held);

  ok((await W._payoutsInFlight(env, 'nobody@x.com')).length === 0,
     'an account with nothing in flight is not held up', true);

  /* A scan that cannot run must not become a way to block a deletion - the
     payout records survive erasure, so it stays traceable either way. */
  const broken = { AMV_KV: { list: async () => { throw new Error('kv down'); } } };
  ok((await W._payoutsInFlight(broken, 'gone@x.com')).length === 0,
     'and a failed scan lets the deletion proceed rather than refusing it', true);
}

section('The guard lives outside the erasure routine, on purpose');
{
  /* erasure-covers-every-key reads any key prefix named inside
     authDeleteAccount as a claim that erasure DELETES it. A scan for a guard,
     written in the middle of that function, would have made the payout ledger
     look erased to the one check whose job is to notice if it ever were. */
  const del = codeOnly(functionBody(src, 'authDeleteAccount'));
  ok(!/withdraw:/.test(del),
     'the deletion routine names no key it does not remove', true);
  ok(/_payoutsInFlight\(env, email\)/.test(del), 'it asks a helper instead', true);
}

if (report('what-was-paid-this-year-is-a-number-somebody-can-read') > 0) process.exitCode = 1;
done();
