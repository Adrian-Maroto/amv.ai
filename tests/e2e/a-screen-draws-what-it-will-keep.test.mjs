/* A SCREEN DRAWS WHAT IT WILL KEEP (Nov 22).

   The owner: "you click it and it shows something, then instantly changes in
   the first second". Measured at 4x CPU on slow 4G: Crew drew its categories
   from a small built-in list ("All 126, Money 20") and two seconds later from
   the country's catalogue ("All 23,052, Money 745"), five more chips pushing
   in; Tasks, Usage and Help each opened on "Loading…" for a moment. The
   catalogue, Usage and Help are now fetched while the page is idle, and a
   Crew opened before its country's list arrives holds the chip row with
   blanks instead of numbers that are about to change. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

/* Every text the screen shows in its first three seconds, frame by frame. */
const states = (p, tab) => p.evaluate(async (tab) => {
  const seen = []; let last = null;
  const sig = () => { const el = document.getElementById('vc'); return el ? (el.innerText || '').replace(/\s+/g, ' ') : ''; };
  const t0 = performance.now(); setTab(tab);
  await new Promise(res => { const tick = () => { const s = sig(); if (s !== last) { seen.push({ ms: Math.round(performance.now() - t0), s }); last = s; } if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  return seen;
}, tab);
const chipsOf = (s) => (s.match(/All [\d,]+ Popular [\d,]+[^📬🚨]*/) || [''])[0];

section('Opened after the page has settled: Crew, Tasks, Usage and Help draw once');
{
  const app = await bootApp({ tab: 'chat' });
  await app.page.waitForTimeout(3500);
  for (const tab of ['crew', 'tasks', 'usage', 'help']) {
    await app.page.evaluate(() => setTab('chat')); await app.page.waitForTimeout(300);
    const s = await states(app.page, tab);
    ok(s.length === 1, `${tab}: the first thing drawn is the screen itself, not a stand-in`, s.map(x => x.ms + 'ms ' + x.s.slice(0, 90)));
  }
  await app.close();
}

section('Opened at once, before the country’s list has arrived');
{
  const app = await bootApp({ tab: 'chat', beforeLoad: async (page) => {
    /* The country's file is slow to arrive: the case the prefetch cannot cover. */
    await page.route(/\/countries\/[A-Z]{2}\.json$/, async (r) => { await new Promise(x => setTimeout(x, 2000)); r.continue(); });
  } });
  const s = await states(app.page, 'crew');
  const numbers = s.map(x => chipsOf(x.s)).filter(Boolean);
  ok(new Set(numbers).size <= 1, 'the category counts are drawn once, never a small set first and the real one after', numbers);
  ok(await app.page.evaluate(() => !document.querySelector('.cj-chip-wait') && !!document.querySelector('#cj-cats .cj-chip')), 'and the real chips are there once it arrives');
  await app.close();
}

if (report('a-screen-draws-what-it-will-keep') > 0) process.exitCode = 1;
done();
