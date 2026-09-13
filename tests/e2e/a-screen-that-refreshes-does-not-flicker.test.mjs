/* A SCREEN THAT REFRESHES ITSELF IS NOT A SCREEN THAT ARRIVES AGAIN.

   Crew paints from what is on disk, then again when the server answers what it
   is running, then again when the connector list lands. Handoff does the same.
   Every one of those repaints wrote a fresh `<div class="sv fi">`, and `.fi` is
   a fade-and-rise - so opening Crew played the entrance three or four times in
   its first second and threw the scroll offset back to the top each time. The
   owner's words: they start buffering and glitching, they move very very fast.

   The repaints are right and are not what changed. What is pinned here is the
   difference between a REPAINT and an ARRIVAL: a repaint of the tab you are
   already on keeps its scroll and skips the entrance, and moving to a
   different tab gets both back.

   The third case is the one that was wrong on the first attempt and is the
   reason this file exists: crew, then chat, then crew. Chat has no `.sv`, so
   the observer returned before recording where it was, and coming back to crew
   looked like a repaint of crew - no entrance, and a scroll offset restored
   from the previous visit. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const page = app.page;

const sv = () => page.evaluate(() => {
  const el = document.querySelector('#vc .sv');
  return el ? { fi: el.classList.contains('fi'), top: Math.round(el.scrollTop) } : null;
});

section('Arriving at a screen plays its entrance');
{
  await page.evaluate(() => setTab('crew'));
  await page.waitForTimeout(500);
  const a = await sv();
  ok(!!a, 'Crew rendered a page scroller');
  ok(a.fi, 'and it carries the entrance on arrival', JSON.stringify(a));
}

section('Refreshing the same screen does not play it again');
{
  await page.evaluate(() => { document.querySelector('#vc .sv').scrollTop = 400; });
  await page.waitForTimeout(60);
  await page.evaluate(() => renderCrewView());
  await page.waitForTimeout(80);
  const b = await sv();
  ok(!b.fi, 'a repaint of the tab you are on skips the entrance', JSON.stringify(b));
  ok(b.top === 400, 'and leaves you where you were reading', JSON.stringify(b));
}

section('Leaving and coming back is an arrival, not a refresh');
{
  await page.evaluate(() => setTab('chat'));
  await page.waitForTimeout(250);
  await page.evaluate(() => setTab('crew'));
  await page.waitForTimeout(400);
  const c = await sv();
  /* Chat has no `.sv` of its own, which is exactly what made this case fail
     before: the tab has to be recorded whether or not the view it rendered has
     a scroller. */
  ok(c.fi, 'the entrance is back after a visit somewhere else', JSON.stringify(c));
  ok(c.top === 0, 'and the screen starts at the top rather than mid-page', JSON.stringify(c));
}

section('Every tab the app can open still renders something');
{
  const out = await page.evaluate(async () => {
    const tabs = ['crew', 'handoff', 'build', 'tasks', 'billing', 'help', 'plans', 'integrations'];
    const empty = [];
    for (const t of tabs) {
      setTab(t);
      await new Promise(r => setTimeout(r, 140));
      const vc = document.getElementById('vc');
      if (!vc || vc.innerHTML.trim().length < 50) empty.push(t);
    }
    return empty;
  });
  ok(out.length === 0, 'no tab settles on a blank page', out.join(','));
}

await app.close();
if (report('a-screen-that-refreshes-does-not-flicker') > 0) process.exitCode = 1;
done();
