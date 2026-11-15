/* SPENDING IS THE MONTHLY BUDGET (Nov 15, owner: "remove watching for a
   price, remove the investing section - just keep it like: if you tell chat
   or Crew to spend money, this regulates the total monthly budget").

   It was four answers (Nov 10): the bank card is gone with Investing, because
   the bank link it showed decides nothing about what AMV may buy. Three
   remain - the maximum, what is spent, and whether AMV may pay at all.

   Each card says its fact and carries its action, and the action is the real
   editor's: switching auto-spend on from the card goes through the same
   consent gate and the same save as the switch below it, and the card then
   reads the new state back. Nothing on the cards is a second copy. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
const open = () => page.evaluate(async () => {
  setTab('spend');
  for (let i = 0; i < 100 && typeof window._renderSpendingPaneNow !== 'function'; i++) await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, 600));
});
const cards = () => page.evaluate(() => [...document.querySelectorAll('#spv-money-facts .spv-fc')].map(c => ({
  label: c.querySelector('.spv-fc-l').textContent, big: c.querySelector('.spv-f-b').textContent,
  act: (c.querySelector('[data-spv-go]') || {}).dataset ? c.querySelector('[data-spv-go]').dataset.spvGo : null })));

section('Three cards, the budget and nothing else');
{
  await open();
  const c = await cards();
  ok(c.length === 3, 'three of them', c);
  ok(c.map(x => x.label.toLowerCase()).join('|') === 'monthly maximum|spent this month|auto-spend', 'maximum, spent, auto-spend', c.map(x => x.label));
  ok(/^\$500\.00$/.test(c[0].big) && c[0].act === 'cap', 'the monthly maximum, with Change', c[0]);
  ok(/^\$0\.00$/.test(c[1].big), 'nothing spent', c[1]);
  ok(c[2].big === 'Off' && c[2].act === 'auto', 'auto-spend off, with a switch', c[2]);
  const rest = await page.evaluate(() => ({ text: document.querySelector('.spv').textContent,
    watch: !!document.querySelector('.wl, #wl-add, [id^="wl-"]'), invest: !!document.getElementById('spv-bank') }));
  ok(!rest.watch && !/Watching for a price/.test(rest.text), 'no price watchlist on it', rest.watch);
  ok(!rest.invest && !/Investing/.test(rest.text), 'and no investing section', rest.invest);
  ok(/chat or Crew/.test(rest.text), 'it says what it is for: what chat and Crew may buy', rest.text.slice(0, 160));
}

section('A bank is still linked where a job asks for one');
{
  const b = await page.evaluate(async () => { openBankLink(); await new Promise(r => setTimeout(r, 500));
    const d = document.querySelector('.bank-dlg'); const t = d ? d.textContent : ''; closeOvr(); return { open: !!d, text: t.slice(0, 200) }; });
  ok(b.open && /Link|link|account/.test(b.text), 'the bank link opens in a dialog of its own', b);
}

section('Turning it on from the card goes through the consent first');
{
  await page.click('[data-spv-go="auto"]');
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({ gate: !!document.getElementById('mf-accept-terms'), on: AMVSpend.cfg().enabled }));
  ok(r.gate && !r.on, 'before consent the card does not switch anything on, it shows the consent', r);
  await page.evaluate(async () => { AMVCompliance.setBirthYear(1990); AMVCompliance.accept(); renderSpendView(); await new Promise(r => setTimeout(r, 400)); });
  await page.click('[data-spv-go="auto"]');
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({ on: AMVSpend.cfg().enabled, box: (document.getElementById('mf-enabled') || {}).checked,
    big: document.querySelectorAll('#spv-money-facts .spv-fc')[2].querySelector('.spv-f-b').textContent }));
  ok(after.on && after.box, 'after consent it switches spending on, through the real switch', after);
  ok(after.big === 'On', 'and the card reads it back', after.big);
}

section('Change takes you to the ceiling, ready to type');
{
  await page.click('[data-spv-go="cap"]');
  await page.waitForTimeout(600);
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'mf-cap'), 'the monthly ceiling has the focus');
}
await app.close();

section('Nothing spills out of a card, at any width');
for (const w of [1440, 820, 390, 360]) {
  const a = await bootApp({ tab: 'spend', viewport: { width: w, height: 900 }, hasTouch: w < 500 });
  await a.page.waitForTimeout(900);
  const bad = await a.page.evaluate(() => [...document.querySelectorAll('#spv-money-facts .spv-fc, #spv-money-facts .spv-fc *')]
    .filter(e => { const r = e.getBoundingClientRect(), p = e.closest('.spv-fc').getBoundingClientRect(); return r.width && (r.right > p.right + 0.5 || r.left < p.left - 0.5 || e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow === 'visible' && !e.children.length); })
    .map(e => e.className + ':' + e.textContent.slice(0, 30)));
  const row = await a.page.evaluate(() => { const r = document.getElementById('spv-money-facts').getBoundingClientRect(); return { right: r.right, vw: innerWidth }; });
  ok(bad.length === 0 && row.right <= row.vw, w + 'px: everything inside its card, the row inside the window', { bad, row });
  ok(a.errors.length === 0, w + 'px: no page errors', a.errors.slice(0, 2));
  await a.close();
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
report();
done();
