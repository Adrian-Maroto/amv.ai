/* THE OVERFLOW THAT DOES NOT SCROLL THE PAGE.

   Two suites already check that no SCREEN scrolls sideways. Neither caught any
   of these, because the overflow is inside the view's own scroller: the page
   stays put, the document reports no sideways scroll, and content sits past
   the right edge with nothing on screen to say it is there.

   Measured with touch emulated, before the fixes:

     768x1024  apps          280px  - "Connect Slack" rendered 813..1031 in a
                                      768-wide window, and elementFromPoint at
                                      its centre did not return the button
     320x568   billing        43px  - the upgrade rows could not wrap
     320x568   crew           14px
     320x568   integrations    8px
     320x568   apps            6px

   Three separate causes, all of them a floor that could not yield: a grid item
   defaulting to `min-width:auto`, a track written `minmax(320px,1fr)` on a
   320px screen, and `white-space:nowrap` inherited onto prose.

   This measures the SCROLLER, not the document, which is the thing that was
   never asked. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const TABS = ['apps', 'integrations', 'crew', 'billing', 'chat', 'plans', 'market',
              'tasks', 'settings', 'help', 'usage', 'handoff', 'upgrade'];
const WIDTHS = [{ w: 320, h: 568 }, { w: 390, h: 844 },
                { w: 768, h: 1024 }, { w: 1024, h: 768 }];

for (const v of WIDTHS) {
  const app = await bootApp({ viewport: { width: v.w, height: v.h }, hasTouch: true });
  const { page, errors } = app;
  const over = [];
  let measured = 0;
  for (const t of TABS) {
    await page.evaluate(t => {
      try { t === 'upgrade' ? openUpgrade('pro') : setTab(t); } catch (e) {}
    }, t);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const sv = document.querySelector('.sv');
      if (!sv) return { none: true };
      return { none: false,
               scroller: sv.scrollWidth - sv.clientWidth,
               page: document.documentElement.scrollWidth > window.innerWidth + 1,
               kids: sv.querySelectorAll('*').length };
    });
    if (r.none || r.kids < 5) continue;
    measured++;
    if (r.scroller > 0) over.push(t + ' scroller+' + r.scroller);
    if (r.page) over.push(t + ' PAGE scrolls sideways');
  }

  section('Nothing sits past the right edge at ' + v.w + 'x' + v.h);
  {
    /* A screen that renders nothing would pass this trivially. */
    ok(measured >= 8, 'enough screens actually rendered to measure', measured);
    ok(over.length === 0,
       'no view scrolls sideways and nothing hides past its right edge', over);
    ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));
  }
  await app.close();
}

report();
done();
