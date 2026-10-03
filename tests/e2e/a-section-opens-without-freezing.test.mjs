/* A SECTION OPENS WITHOUT FREEZING, AND NOTHING KEEPS THE PAGE BUSY.

   The owner reported lag "in all sections", Crew worst, and chat when it
   first loads. Measured at a phone's CPU (4x throttle), two causes:

     · Crew laid out its whole job catalogue on every visit - 1,270 elements,
       17,400px tall, starting 4,500px down the page. Opening it froze the page
       for 482ms. `content-visibility:auto` on each category and each block
       below the first screen lets the browser skip what is not near the
       screen: the freeze became ~150ms and the first paint 641ms -> ~320ms.

     · The chat greeting swept an accent across its gradient text by animating
       background-position, which the GPU cannot do on its own - so the page
       restyled and repainted it every frame for three seconds each time chat
       opened, during the page's own boot. About 20 restyles a second, and
       264ms of main-thread work in five seconds of "idle".

   The first is checked by WHAT IS LAID OUT, not how long it took: the browser
   says which elements content-visibility is skipping, and that is exact on any
   machine. The second is checked by listing every running animation and the
   properties it moves. The freeze time itself is only a loose tripwire; the
   section that measures it says why. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const FREEZE_MAX = 1500;   /* a tripwire, not the test - see the section that uses it */

const app = await bootApp({ tab: 'chat', viewport: { width: 390, height: 844 }, hasTouch: true,
                            user: { name: 'Alex', email: 'alex@x.com', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => { document.getElementById('cookie-consent-banner')?.remove(); _setPlan('pro'); });

section('Crew lays out what is on screen, not the whole catalogue');
{
  await page.evaluate(() => setTab('crew'));
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => {
    const cats = [...document.querySelectorAll('.crew-page .cw-cat')];
    const cards = [...document.querySelectorAll('.crew-page .cw-cat .cw-cat-grid > *')];
    const drawn = cards.filter(c => c.checkVisibility({ contentVisibilityAuto: true })).length;
    const cv = cats.map(c => getComputedStyle(c).contentVisibility);
    return { cats: cats.length, cards: cards.length, drawn, cv: [...new Set(cv)],
             hasCheck: typeof Element.prototype.checkVisibility === 'function' };
  });
  ok(r.hasCheck, 'the browser can say what it is skipping');
  /* All draws the first few of each category now (See all has the rest), so
     there are fewer cards than the hundred this once counted - still several
     screens of them on a phone, which is what there has to be for skipping to
     mean anything. */
  ok(r.cats >= 5 && r.cards >= 60, 'the catalogue is really there to be skipped', r);
  ok(r.cv.length === 1 && r.cv[0] === 'auto', 'every category is content-visibility:auto', r.cv);
  ok(r.drawn < r.cards / 10,
     'and on arrival fewer than a tenth of the job cards are rendered', r.drawn + ' of ' + r.cards);

  /* Skipped is not missing: scrolled to, a category renders, and a search
     still reaches every job. */
  const s = await page.evaluate(async () => {
    const last = [...document.querySelectorAll('.crew-page .cw-cat')].pop();
    last.scrollIntoView({ block: 'start' });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => setTimeout(r, 200));
    const card = last.querySelector('.cw-cat-grid > *');
    const b = card && card.getBoundingClientRect();
    return { shown: !!card && card.checkVisibility({ contentVisibilityAuto: true }), onScreen: !!b && b.top < innerHeight && b.bottom > 0 };
  });
  ok(s.shown && s.onScreen, 'scrolled to, the last category is drawn and on screen', s);
}

section('The blocks below the first screen of Crew wait too');
{
  const r = await page.evaluate(() => {
    const kids = [...document.querySelector('.crew-page').children];
    return kids.map((k, i) => ({ i, cls: String(k.className).slice(0, 24), cv: getComputedStyle(k).contentVisibility }));
  });
  ok(r.slice(0, 3).every(k => k.cv !== 'auto'), 'the first three blocks, always on screen, are drawn as usual', r.slice(0, 3));
  ok(r.slice(3).filter(k => !/crew-jobs-sec/.test(k.cls)).every(k => k.cv === 'auto'),
     'every block after them is content-visibility:auto', r.slice(3));
}

section('Opening Crew for the first time, at a phone’s CPU, does not freeze the page');
{
  /* A TRIPWIRE, NOT THE TEST.

     This was an absolute budget, 420ms at 4x CPU throttle, measured ~150ms
     here - and on GitHub's runner, slower and running four suites at once, the
     same build measured 427 and CI went red. Red CI skips the Worker deploy, so
     for a day the live backend stopped moving while the page kept deploying.

     Measuring the fix against its own defect on the same machine was tried
     next and is no better: under four-way load the defect reproduced at 177ms
     one run and 548 the next, and the two sides crossed. Timing on a shared
     machine cannot rank two things 30% apart.

     So the fix is proved by the sections above, which do not depend on the
     clock: every category is content-visibility:auto, and on arrival fewer
     than a tenth of the job cards are drawn - removing the fix fails both. This
     keeps only a ceiling for something gross, which no busy machine reaches. */
  const openCrew = async () => {
    const fresh = await bootApp({ tab: 'chat', viewport: { width: 390, height: 844 }, hasTouch: true,
                                  user: { name: 'Alex', email: 'alex@x.com', ini: 'A' } });
    const p = fresh.page;
    const cdp = await p.context().newCDPSession(p);
    await p.evaluate(() => { document.getElementById('cookie-consent-banner')?.remove(); _setPlan('pro'); });
    await p.waitForTimeout(500);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const longest = await p.evaluate(async () => {
      const lt = [];
      const po = new PerformanceObserver(l => { for (const e of l.getEntries()) lt.push(e.duration); });
      po.observe({ entryTypes: ['longtask'] });
      setTab('crew');
      await new Promise(r => setTimeout(r, 1500));
      po.disconnect();
      return Math.round(Math.max(0, ...lt));
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const errors = fresh.errors.slice(0, 3);
    await fresh.close();
    return { longest, errors };
  };
  const shipped = await openCrew(false);
  ok(shipped.longest < FREEZE_MAX, 'the longest freeze is under ' + FREEZE_MAX + 'ms even on a slow, busy machine - a tripwire for anything gross', shipped);
  ok(shipped.errors.length === 0, 'and nothing threw', shipped.errors);
}

section('No screen keeps the page repainting on its own');
{
  /* The GPU can animate opacity, transform and filter without the page (the
     headings' 0.7s entrance blurs in, and that is a compositor animation);
     anything else
     is a restyle and a repaint on the main thread, every frame, for as long as
     it runs. A spinner is fine while something is loading - which is why only
     animations that are still running after the screen has settled count. */
  const COMPOSITED = new Set(['opacity', 'transform', 'filter', 'translate', 'scale', 'rotate', 'offset', 'composite', 'easing', 'computedOffset']);
  const bad = [];
  for (const tab of ['chat', 'crew', 'build', 'integrations', 'settings', 'market', 'plans', 'spend']) {
    await page.evaluate(t => setTab(t), tab);
    await page.waitForTimeout(700);
    const found = await page.evaluate((comp) => document.getAnimations()
      .filter(a => a.playState === 'running')
      .map(a => {
        const props = new Set();
        try { for (const k of a.effect.getKeyframes()) for (const p of Object.keys(k)) props.add(p); } catch (e) {}
        const t = a.effect && a.effect.target;
        return { name: a.animationName || a.transitionProperty || 'script', el: t ? t.tagName + '.' + String(t.className).slice(0, 30) : '',
                 moves: [...props].filter(p => !comp.includes(p)) };
      })
      .filter(x => x.moves.length), [...COMPOSITED]);
    for (const f of found) bad.push(tab + ': ' + f.name + ' on ' + f.el + ' moves ' + f.moves.join(','));
  }
  ok(bad.length === 0, 'every animation still running is one the GPU does alone', bad);

  const g = await page.evaluate(async () => {
    setTab('chat');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const el = document.querySelector('#cv.cv-home .chome-greet');
    const names = el ? el.getAnimations().map(a => a.animationName) : null;
    return { found: !!el, names };
  });
  ok(g.found, 'the chat greeting is on screen to be checked');
  ok(g.found && !g.names.includes('amvSweep'), 'and it has no repainting sweep', g.names);

  /* THE SWEEP IS BACK, ON THE GPU (A277). Asked for: "I still want the text
     moving from left to right when AMV loads, I just don't want it to lag".
     So: it exists, it moves by transform and nothing else, and the accent copy
     sits exactly on the real letters at every point of it - a copy that drifts
     even a few pixels reads as a blurred, doubled greeting. */
  const sw = await page.evaluate(async () => {
    const shine = document.querySelector('#cv.cv-home .chome-shine');
    if (!shine) return { found: false };
    const anims = document.getAnimations().filter(a => /amvShine/.test(a.animationName || ''));
    const props = [...new Set(anims.flatMap(a => a.effect.getKeyframes().flatMap(k => Object.keys(k))))]
      .filter(k => !['offset', 'easing', 'composite', 'computedOffset'].includes(k));
    const drift = [];
    for (const t of [400, 900, 1400]) {
      anims.forEach(a => { a.pause(); a.currentTime = t; });
      await new Promise(r => requestAnimationFrame(r));
      const g = document.querySelector('#cv.cv-home .chome-greet').getBoundingClientRect();
      const c = shine.firstElementChild.getBoundingClientRect();
      drift.push(Math.abs(g.left - c.left));
    }
    anims.forEach(a => a.finish());
    return { found: true, n: anims.length, props, drift, hidden: shine.getAttribute('aria-hidden') };
  });
  ok(sw.found && sw.n === 2, 'the greeting sweeps left to right again - a window and the accent copy in it', sw);
  ok(sw.found && sw.props.length === 1 && sw.props[0] === 'transform', 'and it moves by transform alone, which the GPU does', sw.props);
  ok(sw.found && sw.drift.every(d => d < 1.5), 'with the copy on top of the real letters the whole way across', sw.drift);
  ok(sw.found && sw.hidden === 'true', 'and a screen reader hears the greeting once', sw.hidden);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
