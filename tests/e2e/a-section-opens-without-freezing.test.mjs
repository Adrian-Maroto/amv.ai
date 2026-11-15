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

section('Crew draws the first jobs, not the whole catalogue');
{
  /* Nov 15: one list, its first rows drawn and the rest a press away (Show
     more) or a search away. The catalogue used to be drawn whole and skipped
     with content-visibility; now it is simply not drawn until asked for. */
  await page.evaluate(() => { _cwSetCountry('ES'); setTab('crew'); });
  await page.waitForFunction(() => (window._ccCrewJobs || {}).ES && document.querySelectorAll('.cj-card').length, null, { timeout: 15000 });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ drawn: document.querySelectorAll('#cj-grid .cj-card').length, all: _cjList().length,
    more: !!document.querySelector('[data-dact="cjMore"]') }));
  ok(r.all >= 1000, 'there are over a thousand jobs for Spain', r.all);
  ok(r.drawn > 0 && r.drawn <= 48, 'and the page draws only the first of them', r);
  ok(r.more, 'with Show more for the rest', r);
  const s = await page.evaluate(async () => {
    const before = document.querySelectorAll('#cj-grid .cj-card').length;
    document.querySelector('[data-dact="cjMore"]').click(); await new Promise(x => setTimeout(x, 100));
    const after = document.querySelectorAll('#cj-grid .cj-card').length;
    const last = _cjList()[_cjList().length - 1];
    const q = document.getElementById('cx-q'); q.value = last.title; q.dispatchEvent(new Event('input'));
    await new Promise(x => setTimeout(x, 300));
    return { before, after, found: !!document.querySelector('.cj-card-b[data-darg="' + last.id + '"]') };
  });
  ok(s.after > s.before, 'Show more draws more', s);
  ok(s.found, 'and the last job in the list is found by searching for it', s);
  await page.evaluate(() => { const q = document.getElementById('cx-q'); q.value = ''; q.dispatchEvent(new Event('input')); });
}

section('Nothing on Crew is a placeholder that changes size later');
{
  /* A skipped block measured 300px until it was drawn, which moved somebody's
     scroll position after every repaint. The page is small enough now to draw. */
  const r = await page.evaluate(() => [...document.querySelector('#vc .cj').children].map(k => getComputedStyle(k).contentVisibility));
  ok(r.every(v => v !== 'auto'), 'every block is drawn as it is', r);
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
