/* SPENDING IS THE MONTHLY BUDGET (Nov 15, owner: "remove watching for a
   price, remove the investing section - just keep it like: if you tell chat
   or Crew to spend money, this regulates the total monthly budget").

   ONE COLUMN, IN THE ORDER IT IS DECIDED (Nov 27, owner: "it shows spending,
   what it is, then the maximum spent this month, auto spend off, and then it
   has the limits, and then save limits. Very simple, centred, no lag - I
   don't want it to show something and then something else").

   It was three fact cards with buttons that pressed a switch further down,
   which waited for the server before it moved and then said "read and accept
   first" somewhere off screen. So this suite measures the three things that
   went wrong: the order, the switch changing in the same frame it is pressed,
   and the consent opening where the switch is. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
const open = () => page.evaluate(async () => {
  setTab('spend');
  for (let i = 0; i < 100 && typeof window._renderSpendingPaneNow !== 'function'; i++) await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, 600));
});
const state = () => page.evaluate(() => ({
  on: (document.getElementById('mf-enabled') || {}).checked,
  line: (document.getElementById('spx-auto-s') || {}).textContent,
  gate: (() => { const g = document.getElementById('mf-consent'); return g ? !g.hidden : null; })(),
  cfg: AMVSpend.cfg().enabled,
}));

section('Spending, what it is, this month, auto-spend, the limits, Save');
{
  await open();
  const r = await page.evaluate(() => {
    const v = document.querySelector('.spv');
    const at = (sel) => { const e = v.querySelector(sel); return e ? e.getBoundingClientRect().top : null; };
    return {
      title: (v.querySelector('.spv-t') || {}).textContent,
      sub: (v.querySelector('.spv-sub') || {}).textContent || '',
      order: [at('.spv-t'), at('.spv-sub'), at('.spx-month'), at('.spx-auto'), at('.spx-limits'), at('#mf-save-limits')],
      spent: document.getElementById('spx-spent').textContent,
      cap: document.getElementById('spx-cap').textContent,
      line: document.getElementById('spx-auto-s').textContent,
      watch: !!document.querySelector('.wl, #wl-add, [id^="wl-"]'), invest: !!document.getElementById('spv-bank'),
      text: v.textContent,
    };
  });
  ok(r.title === 'Spending', 'titled Spending', r.title);
  ok(/chat or Crew/.test(r.sub), 'then what it is: what chat and Crew may buy', r.sub);
  ok(r.order.every(x => x !== null) && r.order.every((y, i) => i === 0 || y > r.order[i - 1]),
     'in that order, top to bottom: title, what it is, this month, auto-spend, limits, Save limits', r.order);
  ok(r.spent === '$0.00' && r.cap === '$500.00', 'this month: nothing spent of a $500.00 maximum', r);
  ok(/will not pay/.test(r.line), 'auto-spend says it is off', r.line);
  ok(!r.watch && !/Watching for a price/.test(r.text), 'no price watchlist on it');
  ok(!r.invest && !/Investing/.test(r.text), 'and no investing section');
}

section('Centred: one column in the middle of the screen');
{
  const c = await page.evaluate(() => {
    const vc = document.getElementById('vc').getBoundingClientRect();
    return [...document.querySelectorAll('.spx > .spx-card')].map(e => { const r = e.getBoundingClientRect();
      return { left: Math.round(r.left - vc.left), right: Math.round(vc.right - r.right), w: Math.round(r.width) }; });
  });
  ok(c.length >= 3 && c.every(x => Math.abs(x.left - x.right) <= 24), 'every card sits as far from the left edge as the right', c);
  ok(new Set(c.map(x => x.w)).size === 1, 'and every card is the same width', c.map(x => x.w));
}

section('A bank is still linked where a job asks for one');
{
  const b = await page.evaluate(async () => { openBankLink(); await new Promise(r => setTimeout(r, 500));
    const d = document.querySelector('.bank-dlg'); const t = d ? d.textContent : ''; closeOvr(); return { open: !!d, text: t.slice(0, 200) }; });
  ok(b.open && /Link|link|account/.test(b.text), 'the bank link opens in a dialog of its own', b);
}

section('Before consent, the switch opens the terms right under it, and switches nothing on');
{
  await page.click('.spx-auto .sw');
  const r = await state();
  ok(r.gate === true && r.on === false && r.cfg === false, 'the terms open in place; spending stays off', r);
  const near = await page.evaluate(() => {
    const a = document.querySelector('.spx-auto').getBoundingClientRect(), g = document.getElementById('mf-consent').getBoundingClientRect();
    return { gap: g.top - a.bottom, focus: document.activeElement && document.activeElement.id };
  });
  ok(near.gap >= 0 && near.gap < 40, 'directly beneath the switch, not somewhere else on the page', near);
  ok(near.focus === 'mf-accept-terms', 'with the accept button focused', near.focus);
  await page.click('#mf-accept-terms');
  ok(await page.evaluate(() => !!document.getElementById('mf-birth') && !document.getElementById('mf-consent').hidden),
     'then the year of birth, in the same place');
  await page.fill('#mf-birth', '1990');
  await page.click('#mf-save-birth');
  const after = await state();
  ok(after.on && after.cfg && /may buy/.test(after.line) && after.gate === null,
     'and confirming it turns spending on in the same press, the line reading it back', after);
}

section('The switch changes in the frame it is pressed');
{
  /* Measured as "the very next read after the click", with no wait between:
     the line and the box both follow the press before anything is saved. */
  await page.click('.spx-auto .sw');
  const off = await state();
  ok(off.on === false && /will not pay/.test(off.line), 'off at once', off);
  await page.click('.spx-auto .sw');
  const on = await state();
  ok(on.on === true && /may buy/.test(on.line), 'on at once', on);
  await page.waitForTimeout(300);
  ok((await state()).cfg === true, 'and saved behind it');
}

section('A refusal from the account puts the switch back, and says why under it');
{
  const r = await page.evaluate(async () => {
    const push = AMVSpend.push;
    AMVSpend.push = () => Promise.reject(new Error('Your account refused that change.'));
    document.getElementById('mf-enabled').click();
    const mid = document.getElementById('mf-enabled').checked;
    await new Promise(r => setTimeout(r, 100));
    AMVSpend.push = push;
    const say = document.getElementById('mf-auto-say');
    return { mid, now: document.getElementById('mf-enabled').checked, line: document.getElementById('spx-auto-s').textContent,
             said: say.textContent, inAuto: !!say.closest('.spx-auto') };
  });
  ok(r.mid === false, 'it moved at once', r);
  ok(r.now === true && /may buy/.test(r.line), 'and went back when the account refused', r);
  ok(/refused/.test(r.said) && r.inAuto, 'with the reason beside the switch', r);
}

section('Saving the limits rewrites the month in place, nothing redrawn');
{
  const r = await page.evaluate(async () => {
    const card = document.getElementById('spv-money-facts');
    document.getElementById('mf-cap').value = '300';
    document.getElementById('mf-save-limits').click();
    await new Promise(r => setTimeout(r, 300));
    return { same: card === document.getElementById('spv-money-facts'), cap: document.getElementById('spx-cap').textContent };
  });
  ok(r.cap === '$300.00', 'the maximum reads the new ceiling', r);
  ok(r.same, 'the same card, written in place - not drawn again', r);
}
await app.close();

section('Nothing spills out of a card, at any width');
for (const w of [1440, 820, 390, 360]) {
  const a = await bootApp({ tab: 'spend', viewport: { width: w, height: 900 }, hasTouch: w < 500 });
  await a.page.waitForTimeout(900);
  const bad = await a.page.evaluate(() => [...document.querySelectorAll('.spx-card, .spx-card *')]
    .filter(e => { const r = e.getBoundingClientRect(), p = e.closest('.spx-card').getBoundingClientRect(); return r.width && (r.right > p.right + 0.5 || r.left < p.left - 0.5); })
    .map(e => e.className + ':' + e.textContent.slice(0, 30)));
  const page = await a.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
  ok(bad.length === 0 && page.sw <= page.vw, w + 'px: everything inside its card, nothing wider than the window', { bad, page });
  ok(a.errors.length === 0, w + 'px: no page errors', a.errors.slice(0, 2));
  await a.close();
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
report();
done();
