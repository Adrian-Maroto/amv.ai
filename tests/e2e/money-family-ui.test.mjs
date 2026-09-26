/* SPENDING + FAMILY PANES - the logic for spending limits, age/terms consent
   and linked accounts all worked and none of it was reachable. Worse, the
   consent gate refuses every purchase until terms are accepted and an age is
   confirmed, and there was no screen to do either: a dead end the user could
   not get out of. These assertions cover the way in, and that the controls
   really change what the engine enforces. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'settings', user: { name: 'Alice', email: 'alice@x.com', ini: 'A' } });
const { page, errors } = app;

const openPane = pane => page.evaluate(p => { S.settingsPane = p; renderSetPane(); }, pane);

section('Family is a Settings section of its own; Spending has its own tab');
/* The six-section Settings the owner chose: Family is one of the six, and
   Spending - what AMV may spend for you - has its own tab rather than a row
   here, so its limits live in exactly one place. */
const nav = await page.evaluate(async () => {
  const rows = [...document.querySelectorAll('.sn-btn')].map(b => b.dataset.sp);
  S.settingsPane = 'family'; renderSettingsView();
  await new Promise(r => setTimeout(r, 350));
  const t = document.querySelector('#set-pane .set-title');
  return { rows, familyTitle: t ? t.textContent : null };
});
ok(nav.rows.includes('family'), 'Family is a row', nav.rows);
ok(!nav.rows.includes('spending'), 'Spending is not a row - it has its own tab', nav.rows);
ok(nav.familyTitle === 'Family', 'and Family opens on its own screen', nav.familyTitle);

section('The consent dead end has an exit');
await page.evaluate(() => { AMVCompliance.reset ? AMVCompliance.reset() : localStorage.removeItem(_scopeKey('amv_consent')); });
await openPane('spending');
const gate1 = await page.evaluate(() => ({
  blocked: AMVCompliance.gate('spend'),
  hasAccept: !!document.getElementById('mf-accept-terms'),
  limitsHidden: !document.getElementById('mf-auto')
}));
ok(typeof gate1.blocked === 'string', 'spending starts refused until consent is given', gate1.blocked);
ok(gate1.hasAccept, 'and the pane offers the accept button that unblocks it');
ok(gate1.limitsHidden, 'limits are not shown before consent - one decision at a time');

const gate2 = await page.evaluate(async () => {
  document.getElementById('mf-accept-terms').click();
  return { askAge: !!document.getElementById('mf-birth'), accepted: AMVCompliance.accepted() };
});
ok(gate2.accepted === true, 'accepting really records consent');
ok(gate2.askAge === true, 'then it asks for the year of birth');

const badYear = await page.evaluate(() => {
  document.getElementById('mf-birth').value = String(new Date().getFullYear() - 5);
  document.getElementById('mf-save-birth').click();
  return { said: document.getElementById('mf-age-say').textContent, known: AMVCompliance.ageKnown() };
});
ok(badYear.known === false, 'an age below the minimum is refused');
ok(badYear.said.length > 0, 'and the reason is announced, not just shown in red', badYear.said);

section('A 16-year-old is told the truth instead of being left stuck');
const teen = await page.evaluate(() => {
  AMVCompliance.setBirthYear(new Date().getFullYear() - 16);
  renderSetPane();
  return { txt: document.querySelector('.set-pane').textContent, limits: !!document.getElementById('mf-auto') };
});
ok(/18\+|and over/.test(teen.txt), 'the pane says money features are adults only', teen.txt.slice(0, 120));
ok(teen.limits === false, 'and does not offer limits it would refuse to honour');
ok(/Family/.test(teen.txt), 'it points at the family route instead of just saying no');

section('An adult can set limits, and contradictory ones are refused');
await page.evaluate(() => { AMVCompliance.setBirthYear(1990); renderSetPane(); });
const bad1 = await page.evaluate(() => {
  document.getElementById('mf-auto').value = '400';
  document.getElementById('mf-per').value = '100';
  document.getElementById('mf-cap').value = '500';
  document.getElementById('mf-save-limits').click();
  return { said: document.getElementById('mf-limits-say').textContent, saved: AMVSpend.cfg().autoUnder };
});
ok(/cannot be higher/.test(bad1.said), 'an auto-buy limit above the per-purchase limit is refused', bad1.said);
ok(bad1.saved !== 400, 'and nothing is saved, so the user is never protected by a number that can never apply');

const bad2 = await page.evaluate(() => {
  document.getElementById('mf-auto').value = '20';
  document.getElementById('mf-per').value = '900';
  document.getElementById('mf-cap').value = '500';
  document.getElementById('mf-save-limits').click();
  return document.getElementById('mf-limits-say').textContent;
});
ok(/monthly ceiling/i.test(bad2), 'a single purchase larger than the whole month is refused', bad2);

const good = await page.evaluate(() => {
  document.getElementById('mf-auto').value = '25';
  document.getElementById('mf-per').value = '100';
  document.getElementById('mf-cap').value = '300';
  document.getElementById('mf-save-limits').click();
  document.getElementById('mf-enabled').click();
  const c = AMVSpend.cfg();
  return { c, under: AMVSpend.check(10), over: AMVSpend.check(60), way: AMVSpend.check(150) };
});
ok(good.c.autoUnder === 25 && good.c.perPurchase === 100 && good.c.monthlyCap === 300,
   'valid limits are saved', good.c);
ok(good.c.enabled === true, 'and the toggle really turns spending on');
ok(good.under.allow && !good.under.needsApproval, 'a $10 purchase now goes through on its own');
ok(good.over.allow && good.over.needsApproval, 'a $60 purchase asks first');
ok(good.way.allow === false, 'a $150 purchase is refused by the limit the user just typed');

section('Purchases are listed, and an empty history says so');
const hist = await page.evaluate(() => {
  const before = document.querySelector('.set-pane').textContent;
  AMVSpend.record(24.5, { item: 'Graphing calculator', merchant: 'Campus Store', rule: 'auto' });
  renderSetPane();
  const el = document.querySelector('.set-pane');
  return { emptyBefore: /has not bought anything/.test(before),
           row: /Graphing calculator/.test(el.textContent) && /Campus Store/.test(el.textContent),
           amount: /\$24\.50/.test(el.textContent),
           table: !!document.querySelector('.mf-tbl th[scope="col"]') };
});
ok(hist.emptyBefore, 'an empty history is stated plainly rather than left blank');
ok(hist.row, 'a real purchase appears with what it was and where');
ok(hist.amount, 'with the amount');
ok(hist.table, 'and the table has proper column headers for screen readers');

/* The Family sections that were here tested asking for access to another
   person's account, which the owner removed. Family itself - the invitation,
   joining on the child's own device, declining - is covered in account-access. */
section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
