/* A SCREEN THAT REFRESHES ITSELF IS NOT A SCREEN ARRIVING AGAIN.

   Crew paints from what is on disk, then again when the server answers what it
   is running, then again when the connector list lands. Handoff and Connectors
   do the same. `#vc > *` carries `viewEnter` - a fade and an 8px rise - so
   every one of those repaints played the entrance again and dropped the scroll
   offset. The owner's words: they start buffering and glitching, they move very
   very fast.

   THE FIRST VERSION OF THIS FILE PASSED WHILE THE BUG WAS STILL THERE, twice
   over, and both reasons are the point of the rewrite.

   It watched the `fi` class on `.sv`. `fi` is a legacy entrance that a later
   layer superseded with the rule on `#vc > *`, so removing it changed nothing -
   and `.sv` is not used by Build, Lab or Chat at all, which is why the owner
   reported those still buffering after it was called fixed.

   And it stubbed the server to answer instantly. With no latency every repaint
   lands before the first frame and the browser coalesces them, so nothing
   replays and any implementation looks correct. The repaints are given a
   realistic delay here, which is what makes the replay observable at all.

   What is pinned now is the thing itself, counted from real animation events:
   the entrance plays at most once however many times a view repaints, and it
   plays on arrival at a different tab. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const page = app.page;

/* A backend that answers the way one really does. Instant stubs hide this bug
   completely: the repaints coalesce before the first frame and nothing replays. */
await page.evaluate(() => {
  saveStr('amv_plan', 'pro');
  AMV_API.base = 'https://stub.amv.dev';
  AMV_API.token = 'test-token';
  const slow = (v) => async () => { await new Promise(r => setTimeout(r, 400)); return v; };
  AMV_API.listAuto = slow({ items: [] });
  AMV_API.listHandoff = slow({ items: [] });
  AMV_API.crewPopular = slow({ enough: false, total: 6, need: 25 });
  AMV_API.connectList = slow({ configured: true, items: [], providers: [] });
  AMV_API.everyday = slow({ name: 'US', countries: ['US'], local: [] });
  AMV_API.connectors = slow({ ok: true, q: '', cursor: '', servers: [] });
  window.__an = [];
  document.addEventListener('animationstart', (e) => {
    if (document.getElementById('vc').contains(e.target)) window.__an.push(e.animationName);
  }, true);
  window.__paints = 0;
  new MutationObserver(() => { window.__paints++; })
    .observe(document.getElementById('vc'), { childList: true });
});

/* Arrive at `tab` from somewhere else, and report what the screen did. */
const open = (tab) => page.evaluate(async (t) => {
  setTab('chat');
  await new Promise(r => setTimeout(r, 350));
  window.__an = []; window.__paints = 0;
  setTab(t);
  await new Promise(r => setTimeout(r, 2500));
  return { paints: window.__paints,
           enter: window.__an.filter(a => a === 'viewEnter').length };
}, tab);

section('A screen that repaints several times still only arrives once');
{
  /* Crew is the worst of them and the one that was reported. */
  const crew = await open('crew');
  ok(crew.paints >= 3, 'Crew really does repaint while the server answers', JSON.stringify(crew));
  ok(crew.enter <= 1, 'and the entrance plays at most once', JSON.stringify(crew));

  const handoff = await open('handoff');
  ok(handoff.paints >= 2, 'so does Handoff', JSON.stringify(handoff));
  ok(handoff.enter <= 1, 'and it arrives once too', JSON.stringify(handoff));
}

section('Every surface is covered, not one family of them');
{
  /* Build, Lab and Chat write `.dev-shell`, `.lab-shell` and their own markup
     rather than `.sv`. The fix this replaced keyed on `.sv`, so none of these
     were touched by it - and these three are what the owner named. */
  for (const t of ['build', 'lab', 'chat', 'integrations', 'billing']) {
    const r = await open(t);
    ok(r.enter <= 1, t + ' arrives once, however many times it repaints', JSON.stringify(r));
  }
}

section('Refreshing the screen you are on keeps your place');
{
  await page.evaluate(() => setTab('crew'));
  await page.waitForTimeout(1600);
  const r = await page.evaluate(async () => {
    const sv = document.querySelector('#vc .sv');
    sv.scrollTop = 400;
    sv.dispatchEvent(new Event('scroll', { bubbles: true }));
    await new Promise(x => setTimeout(x, 60));
    renderCrewView();
    await new Promise(x => setTimeout(x, 120));
    const now = document.querySelector('#vc .sv');
    return { top: Math.round(now.scrollTop), repaint: now.closest('#vc > *').classList.contains('vc-repaint') };
  });
  ok(r.repaint, 'the repaint is marked as one', JSON.stringify(r));
  ok(r.top === 400, 'and it leaves you where you were reading', JSON.stringify(r));
}

section('Leaving and coming back is an arrival, not a refresh');
{
  const r = await page.evaluate(async () => {
    setTab('chat');
    await new Promise(x => setTimeout(x, 300));
    window.__an = [];
    setTab('crew');
    await new Promise(x => setTimeout(x, 500));
    const root = document.querySelector('#vc > *');
    const sv = document.querySelector('#vc .sv');
    return { marked: root.classList.contains('vc-repaint'),
             top: sv ? Math.round(sv.scrollTop) : -1 };
  });
  /* Chat has no `.sv`, which is what broke the first attempt at this: the tab
     has to be recorded whether or not the view it rendered has a scroller. */
  ok(!r.marked, 'coming back from chat is an arrival, not a repaint', JSON.stringify(r));
  ok(r.top === 0, 'and it starts at the top rather than mid-page', JSON.stringify(r));
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
