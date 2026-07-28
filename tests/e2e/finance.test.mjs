/* BANK CONNECTION — money is the one place a fabricated number does real
   damage. These assertions prove AMV never invents a balance, never gains a
   way to MOVE money, and that the analysis on top of real data is correct. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;

section('With no bank linked it refuses honestly - it never guesses a balance');
const unlinked = await page.evaluate(async () => {
  const F = window.AMVFinance, C = window.AMVConnectors;
  const out = {};
  for (const id of ['finance.balances', 'finance.transactions', 'finance.unusual_activity', 'finance.low_balance', 'finance.budget_trend']) {
    try { const r = await C.run(id, {}); out[id] = 'RETURNED_DATA:' + JSON.stringify(r).slice(0, 40); }
    catch (e) { out[id] = e.code || e.message; }
  }
  return { out, linked: F.linked(), live: C.live('finance') };
});
ok(unlinked.linked === false && unlinked.live === false, 'the finance connector reports itself as not connected');
Object.entries(unlinked.out).forEach(([id, v]) => {
  ok(!String(v).startsWith('RETURNED_DATA'), `${id} returns NO fabricated data when unlinked`, v);
  ok(/needs_(auth|service)/.test(String(v)), `${id} names exactly what is missing`, v);
});

section('AMV can SEE money but has no action that MOVES it');
const actions = await page.evaluate(() => {
  const C = window.AMVConnectors;
  return C.catalog().filter(a => a.connector === 'finance').map(a => a.action);
});
ok(actions.length >= 5, 'the finance connector exposes read actions', actions);
ok(!actions.some(a => /transfer|pay|send|withdraw|move|wire/i.test(a)),
  'there is deliberately NO transfer/payment action - a compromised agent cannot empty an account', actions);

section('Unusual-activity detection uses YOUR pattern, not a fixed threshold');
const unusual = await page.evaluate(() => {
  const F = window.AMVFinance;
  const normal = [];
  for (let i = 0; i < 20; i++) normal.push({ date: '2026-07-0' + ((i % 9) + 1), merchant: 'Cafe', amount: -12 });
  const withSpike = normal.concat([{ date: '2026-07-09', merchant: 'Electronics', amount: -2400 }]);
  const dupes = normal.concat([
    { date: '2026-07-09', merchant: 'Gym', amount: -40 },
    { date: '2026-07-09', merchant: 'Gym', amount: -40 }
  ]);
  return {
    tooLittle: F.unusual(normal.slice(0, 4)),
    spike: F.unusual(withSpike),
    dupes: F.unusual(dupes),
    quiet: F.unusual(normal)
  };
});
ok(unusual.tooLittle.ready === false, 'with too little history it says so rather than guessing', unusual.tooLittle.why);
ok(unusual.spike.unusual.length === 1 && unusual.spike.unusual[0].amount === 2400, 'a genuine outlier is caught', unusual.spike.unusual);
ok(unusual.quiet.unusual.length === 0, 'ordinary spending is NOT flagged (no alert fatigue)', unusual.quiet.unusual);
// A genuine double-charge is caught, but a merchant you simply use twice a
// day is NOT - flagging normal behaviour would make every alert worthless.
ok(unusual.dupes.duplicates.length === 1 && /Gym/i.test(unusual.dupes.duplicates[0].merchant),
  'a genuine same-day double charge is caught', unusual.dupes.duplicates);
ok(!unusual.dupes.duplicates.some(d => /Cafe/i.test(d.merchant)),
  'a merchant you routinely use more than once a day is NOT flagged (no alert fatigue)', unusual.dupes.duplicates);
ok(unusual.quiet.duplicates.length === 0, 'ordinary repeat spending produces no duplicate alerts', unusual.quiet.duplicates);

section('Low balance warns BEFORE it bites, counting scheduled payments');
const low = await page.evaluate(() => {
  const F = window.AMVFinance;
  const accounts = [{ id: 'a1', name: 'Checking', balance: 500 }, { id: 'a2', name: 'Savings', balance: 9000 }];
  const upcoming = [{ account: 'a1', amount: 450 }];
  return { warned: F.lowBalance(accounts, upcoming, 100), none: F.lowBalance(accounts, [], 100) };
});
ok(low.warned.length === 1 && low.warned[0].account === 'Checking', 'the account heading below the floor is flagged', low.warned);
ok(low.warned[0].projected === 50, 'the projection subtracts scheduled payments', low.warned[0]);
ok(low.none.length === 0, 'a healthy account is not warned about', low.none);

section('Budget pace is projected mid-month, while you can still act');
const trend = await page.evaluate(() => {
  const F = window.AMVFinance;
  const txns = [];
  for (let i = 1; i <= 10; i++) txns.push({ date: '2026-07-' + String(i).padStart(2, '0'), amount: -100 });
  return {
    over: F.budgetTrend(txns, 2000, '2026-07-10'),
    under: F.budgetTrend(txns, 5000, '2026-07-10'),
    noBudget: F.budgetTrend(txns, 0, '2026-07-10')
  };
});
ok(trend.over.ready === true && trend.over.onTrack === false, 'spending 1000 by the 10th on a 2000 budget is flagged as over pace', trend.over.projected);
ok(Math.round(trend.over.projected) === 3100, 'the projection is arithmetically correct (1000/10*31)', trend.over.projected);
ok(trend.under.onTrack === true, 'the same spend inside a bigger budget is on track', trend.under.projected);
ok(trend.noBudget.ready === false, 'with no budget set it asks instead of inventing one', trend.noBudget.why);

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
