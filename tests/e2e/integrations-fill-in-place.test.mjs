/* INTEGRATIONS FILL IN PLACE (Nov 27, the owner: "there's a lag in
   integrations when I load it... I don't want it to show something else and
   then something else").

   Opened before the country's services had arrived, every topic drew its
   apps and a count, and a moment later the country's services pushed in:
   the count jumped (47 to 221), the grids grew, and News and Jobs swapped
   their rows for the country's own. Now the slots they fill are held by
   placeholders of the same size and the count waits; one draw replaces them.

   Measured here as what a person sees: every topic's height before and after
   the fill (with content-visibility off, so a topic off screen is measured
   too), the count, and the placeholders gone. And on a phone, no service
   listed twice - the phone layout out-ranked the rule hiding duplicates. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const slow = (ms) => async (page) => {
  await page.route(/\/(countries\/|country-catalog|global-services|global-reach\/)/, async r => { await new Promise(z => setTimeout(z, ms)); r.continue(); });
};
const sizes = (page) => page.evaluate(() => {
  if (!document.getElementById('cvx')) { const st = document.createElement('style'); st.id = 'cvx'; st.textContent = '#int-catalog > *{content-visibility:visible!important}'; document.head.appendChild(st); }
  return Object.fromEntries([...document.querySelectorAll('#int-catalog > [data-topic]')].map(s => [s.dataset.topic, Math.round(s.getBoundingClientRect().height)]));
});

for (const w of [1440, 390]) {
  section(w + 'px: opened before the country’s services arrive, nothing on screen changes size');
  const app = await bootApp({ tab: 'chat', viewport: { width: w, height: 900 }, hasTouch: w < 500, beforeLoad: slow(1800) });
  const { page, errors } = app;
  /* Off screen, a topic is not laid out (content-visibility) and reports a
     stand-in height; measured laid out, from the first frame. */
  await page.evaluate(() => { const st = document.createElement('style'); st.id = 'cvx'; st.textContent = '#int-catalog > *{content-visibility:visible!important}'; document.head.appendChild(st); setTab('integrations'); });
  await page.waitForTimeout(60);
  const before = await page.evaluate(() => {
    const cat = document.getElementById('int-catalog');
    const more = [...cat.querySelectorAll('.int-more')].filter(m => getComputedStyle(m).visibility !== 'hidden').length;
    return { filling: cat.classList.contains('int-filling'), ph: cat.querySelectorAll('.int-ph').length, more,
      hidden: [...cat.querySelectorAll('.int-ph')].every(p => p.getAttribute('aria-hidden') === 'true') };
  });
  ok(before.filling && before.ph > 0, 'the slots the country fills are held by placeholders', before);
  ok(before.hidden, 'which a screen reader skips', before);
  ok(before.more === 0, 'and no count is shown until it is the real one', before);
  const a = await sizes(page);
  await page.waitForFunction(() => !document.getElementById('int-catalog').classList.contains('int-filling'), null, { timeout: 15000 });
  const b = await sizes(page);
  const moved = Object.keys(a).filter(k => a[k] !== b[k]).map(k => k + ' ' + a[k] + '->' + b[k]);
  ok(moved.length === 0, 'every topic is the same height before and after the fill', moved);
  const after = await page.evaluate(() => ({ ph: document.querySelectorAll('#int-catalog .int-ph').length,
    more: (document.querySelector('[data-topic="money"] .int-seemore') || {}).textContent || '' }));
  ok(after.ph === 0, 'and the placeholders are gone', after);
  ok(/\d{2,}/.test(after.more), 'the count arrives once, with the country’s services in it', after.more);
  if (w < 500) {
    const dup = await page.evaluate(() => ['jobs', 'news'].map(t => {
      const names = [...document.querySelectorAll('[data-topic="' + t + '"] .int-card')].filter(c => c.offsetParent !== null).map(c => c.querySelector('.int-name').textContent.trim().toLowerCase());
      return { t, dup: names.filter((n, i) => names.indexOf(n) !== i) };
    }));
    ok(dup.every(d => d.dup.length === 0), 'on a phone, no service is listed twice under Jobs or News', dup);
  }
  ok(errors.length === 0, 'no page errors', errors.slice(0, 2));
  await app.close();
}

section('An app people in the country do not use follows the country’s own services');
{
  /* Nov 27: Zomato (India's) opened Food in the United States, and Swiggy,
     Deliveroo and Just Eat filled its first screen ahead of DoorDash and the
     country's own restaurants. */
  const app = await bootApp({ tab: 'chat', viewport: { width: 1440, height: 900 } });
  const { page } = app;
  await page.evaluate(() => { try{ _cwSetCountry('US'); }catch(e){} setTab('integrations'); });
  await page.waitForFunction(() => { const c = document.getElementById('int-catalog'); return c && !c.classList.contains('int-filling') && c.querySelector('[data-topic="food"] .cc-svc'); }, null, { timeout: 20000 });
  const food = await page.evaluate(() => [...document.querySelectorAll('[data-topic="food"] .int-card')].filter(c => getComputedStyle(c).display !== 'none').slice(0, 9)
    .map(c => ({ n: c.querySelector('.int-name').textContent.trim(), far: c.hasAttribute('data-far'), svc: c.classList.contains('cc-svc') })));
  ok(food[0] && food[0].n === 'DoorDash', 'Food opens with DoorDash', food.map(x => x.n));
  ok(!food.some(x => /Zomato|Swiggy/.test(x.n)), 'and India’s apps are not on its first screen', food.map(x => x.n));
  const firstFar = food.findIndex(x => x.far), lastSvc = food.map(x => x.svc).lastIndexOf(true);
  ok(firstFar < 0 || lastSvc < firstFar, 'any app not used there comes after the country’s own services', food);
  await app.close();
}

section('With the catalogue unreachable, the apps stay and no placeholder is left behind');
{
  const app = await bootApp({ tab: 'chat', beforeLoad: async (page) => { await page.route(/country-catalog/, r => r.abort('connectionreset')); } });
  const { page } = app;
  await page.evaluate(() => setTab('integrations'));
  await page.waitForFunction(() => { const c = document.getElementById('int-catalog'); return c && !c.classList.contains('int-filling'); }, null, { timeout: 15000 });
  const r = await page.evaluate(() => ({ ph: document.querySelectorAll('#int-catalog .int-ph').length,
    gmail: [...document.querySelectorAll('#int-catalog .int-name')].some(n => n.textContent.trim() === 'Gmail') }));
  ok(r.ph === 0 && r.gmail, 'the apps remain, and nothing waits forever', r);
  await app.close();
}

report();
done();
