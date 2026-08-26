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

section('Both panes are reachable from Settings');
const nav = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('.sn-btn')].map(b => b.dataset.sp);
  return { spending: labels.includes('spending'), family: labels.includes('family') };
});
ok(nav.spending, 'Spending is in the settings navigation');
ok(nav.family, 'so is Family & linked accounts');

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

section('Family: a request needs an address and at least one permission');
await openPane('family');
const noScope = await page.evaluate(() => {
  document.getElementById('mf-inv-email').value = 'mum@x.com';
  document.getElementById('mf-invite').click();
  return document.getElementById('mf-inv-say').textContent;
});
ok(/at least one/i.test(noScope), 'asking for nothing is refused', noScope);

const badEmail = await page.evaluate(() => {
  document.getElementById('mf-inv-email').value = 'not-an-email';
  document.querySelector('input[name="mf-scope"]').checked = true;
  document.getElementById('mf-invite').click();
  return document.getElementById('mf-inv-say').textContent;
});
ok(/valid email/i.test(badEmail), 'and so is a malformed address', badEmail);

section('A real request is honest about whether the code could be sent');
const sent = await page.evaluate(() => {
  document.getElementById('mf-inv-email').value = 'mum@x.com';
  [...document.querySelectorAll('input[name="mf-scope"]')].forEach(x => { x.checked = x.value === 'calendar_view'; });
  document.getElementById('mf-invite').click();
  const said = document.getElementById('mf-inv-say').textContent;
  const cls = document.getElementById('mf-inv-say').className;
  return { said, warn: /warn/.test(cls), pending: (load('amv_links') || {}).invites.length };
});
ok(sent.pending === 1, 'the request is created');
ok(/cannot be approved|Connect the AMV backend/i.test(sent.said),
   'with no backend it says the code cannot be emailed, instead of implying it was sent', sent.said);
ok(sent.warn === true, 'and it reads as a warning, not a success');

section('Only the account being asked for can approve, with the real code');
const approve = await page.evaluate(async () => {
  const inv = load('amv_links').invites[0];
  const realCode = inv.code;
  // switch to the account the request was aimed at
  S.user = { name: 'Mum', email: 'mum@x.com', ini: 'M' };
  renderSetPane();
  const showsIt = !!document.querySelector('.mf-approve');
  const asks = document.querySelector('.set-pane').textContent;
  // a wrong code first
  document.getElementById('mf-code-' + inv.id).value = '000000';
  document.querySelector('.mf-approve').click();
  await new Promise(r => setTimeout(r, 200));
  const wrongSaid = document.getElementById('mf-code-say-' + inv.id).textContent;
  const linksAfterWrong = (load('amv_links').links || []).length;
  // then the real one
  document.getElementById('mf-code-' + inv.id).value = realCode;
  document.querySelector('.mf-approve').click();
  await new Promise(r => setTimeout(r, 300));
  return { showsIt, asks, wrongSaid, linksAfterWrong,
           links: (load('amv_links').links || []).length };
});
ok(approve.showsIt === true, 'the account being asked sees the request waiting for them');
ok(/wants access to your account/.test(approve.asks), 'stated in plain words', approve.asks.slice(0, 140));
ok(approve.linksAfterWrong === 0, 'a wrong code creates nothing');
ok(/not right|could not be verified/i.test(approve.wrongSaid), 'and says so, with attempts remaining', approve.wrongSaid);
ok(approve.links === 1, 'the correct code, from the right account, creates the link');

section('Either side can cut the link, and it stops access immediately');
const revoked = await page.evaluate(() => {
  /* Accept the confirmation. Returns TRUE, which is confirmModal's contract:
     it answers whether it managed to ASK, and the caller falls back to the
     native dialog when it could not. A stub returning undefined reads as "could
     not ask", so the caller would run go() from here and then ask a second time
     - the right outcome by accident. */
  window.confirmModal = (t, b, go) => { go(); return true; };
  const asGrantee = () => { S.user = { name: 'Alice', email: 'alice@x.com', ini: 'A' }; };
  const asOwner = () => { S.user = { name: 'Mum', email: 'mum@x.com', ini: 'M' }; };
  asGrantee();
  const before = AMVFamily.check('mum@x.com', 'calendar_view');   // null = allowed
  // the OWNER cuts it from their own screen
  asOwner(); renderSetPane();
  document.querySelector('.mf-revoke').click();
  const said = document.getElementById('mf-links-say')?.textContent || '';
  asGrantee();
  const after = AMVFamily.check('mum@x.com', 'calendar_view');
  return { before, after, said };
});
ok(revoked.before === null, 'the link genuinely granted access while it existed');
ok(typeof revoked.after === 'string', 'the owner removing it stops that access at once', revoked.after);
ok(/removed|stopped/i.test(revoked.said), 'and the screen confirms it', revoked.said);

section('Refusing a request kills the code');
const refused = await page.evaluate(() => {
  S.user = { name: 'Alice', email: 'alice@x.com', ini: 'A' };
  const inv = AMVFamily.invite('mum@x.com', ['email_view'], {});
  S.user = { name: 'Mum', email: 'mum@x.com', ini: 'M' };
  renderSetPane();
  document.querySelector('.mf-deny').click();
  let stillWorks = true;
  try { AMVFamily.accept(inv.id, (load('amv_links').invites.find(i => i.id === inv.id) || {}).code); }
  catch (e) { stillWorks = false; }
  return { stillWorks, said: document.getElementById('mf-code-say-' + inv.id).textContent };
});
ok(refused.stillWorks === false, 'a refused request cannot be accepted afterwards - "no" does not mean "not yet"');
ok(/Refused/.test(refused.said), 'and the screen confirms it', refused.said);

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
