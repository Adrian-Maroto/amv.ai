/* THE FILTER HAD EVERYTHING EXCEPT A BUTTON.

   Starring a chat worked. The row context menu offered it, a starred row drew
   a filled star, renderHist() filtered on S.starFilter, there was a written
   empty state for "No starred chats yet", S.starFilter was in the list of
   state that survives a sign-out, and styles.css had a rule for #star-filter.
   Every piece was there except the control, because nothing in the product
   ever rendered that id - so the click handler bound to it at boot found
   nothing and quietly bound to nothing at all.

   That is the same shape as _setChatTone: present, correct, unreachable. The
   difference is that a missing function at least shows up in a search for
   callers, while a missing ELEMENT looks exactly like a feature that works.

   The same markup carried a second one. Three separate places - renderHist,
   updateSbUser and the session autosave - hid the "Recents" heading with
   $('hist-header').style.display, and no element had that id either. When it
   was given one they STILL did nothing, because #sb .sbl{display:block
   !important} outranks an inline style. So the visibility is a class now.

   WHAT THIS ASSERTS. Not that the code exists - that was never the problem.
   It clicks the control a person would click and checks the list changed. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'T', email: 't@x.com', ini: 'T' } });
const { page, errors } = app;

const seed = () => page.evaluate(() => {
  S.convs = [
    { id: 'a', title: 'Starred one', starred: true,  msgs: [{ r: 'u', c: 'hi' }], updated: 2 },
    { id: 'b', title: 'Plain one',   starred: false, msgs: [{ r: 'u', c: 'yo' }], updated: 1 },
  ];
  S.cur = 'a'; S.starFilter = false;
  if (Array.isArray(window._SESSIONS)) _SESSIONS.length = 0;
  renderHist();
});
const titles = () => page.evaluate(() =>
  [...document.querySelectorAll('#hist .hi .hit')].map(e => e.textContent));

section('There is a control, and it is reachable');
{
  const b = await page.$('#star-filter');
  ok(!!b, 'the starred filter exists on the page at all');
  const vis = await page.evaluate(() => {
    const e = document.getElementById('star-filter');
    if (!e) return null;
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    return { w: r.width, h: r.height, disp: cs.display, vis: cs.visibility };
  });
  ok(vis && vis.w > 0 && vis.h > 0, 'and it has a size, so it can be clicked', vis);
  ok(vis && vis.disp !== 'none' && vis.vis !== 'hidden', 'and it is not hidden', vis);
}

section('Clicking it shows only the starred chats');
{
  await seed();
  const before = await titles();
  ok(before.length === 2, 'both chats are listed to begin with', before);
  await page.click('#star-filter');
  const after = await titles();
  ok(after.length === 1 && after[0] === 'Starred one',
     'after the click only the starred one is listed', after);
  await page.click('#star-filter');
  const back = await titles();
  ok(back.length === 2, 'and clicking again brings the rest back', back);
}

section('What the eye sees and what a screen reader hears are the same toggle');
{
  await seed();
  const off = await page.getAttribute('#star-filter', 'aria-pressed');
  ok(off === 'false', 'it starts unpressed', off);
  await page.click('#star-filter');
  const on = await page.getAttribute('#star-filter', 'aria-pressed');
  ok(on === 'true', 'and reports itself pressed once the filter is on', on);
  /* The colour is read after the transition has settled rather than at the
     instant of the click: #star-filter transitions colour, so reading it
     immediately returns the value it is moving AWAY from, and a test that
     asserts on a value mid-animation fails for a reason that has nothing to
     do with the product. */
  const gold = await page.waitForFunction(
    () => getComputedStyle(document.getElementById('star-filter')).color === 'rgb(224, 179, 65)',
    null, { timeout: 3000 }).then(() => true, () => false);
  ok(gold, 'and it is visibly lit, not only announced');
  const label = await page.getAttribute('#star-filter', 'aria-label');
  ok(/show all/i.test(label || ''), 'and it says what pressing it again would do', label);
  await page.click('#star-filter');
}

section('With nothing starred it explains itself instead of looking broken');
{
  await page.evaluate(() => {
    S.convs = [{ id: 'b', title: 'Plain one', starred: false, msgs: [{ r: 'u', c: 'yo' }], updated: 1 }];
    S.cur = 'b'; S.starFilter = false;
    if (Array.isArray(window._SESSIONS)) _SESSIONS.length = 0;
    renderHist();
  });
  await page.click('#star-filter');
  const txt = await page.textContent('#hist');
  ok(/No starred chats yet/.test(txt || ''),
     'the empty state that was written for this is finally reachable', (txt || '').slice(0, 60));
  await page.click('#star-filter');
}

section('The Recents heading can be hidden, which needed a class rather than a style');
{
  const hidden = await page.evaluate(() => {
    S.convs = []; S.starFilter = false;
    if (Array.isArray(window._SESSIONS)) _SESSIONS.length = 0;
    renderHist();
    return getComputedStyle(document.getElementById('hist-header')).display;
  });
  ok(hidden === 'none', 'with nothing to list, the heading goes away', hidden);
  const shown = await page.evaluate(() => {
    S.convs = [{ id: 'a', title: 'One', starred: false, msgs: [{ r: 'u', c: 'hi' }], updated: 1 }];
    S.cur = 'a'; renderHist();
    return getComputedStyle(document.getElementById('hist-header')).display;
  });
  ok(shown === 'flex', 'and comes back when there is', shown);
  /* The bug was that an inline style lost to !important. If the call sites
     ever go back to setting style.display, this catches it: setting the
     inline property must NOT be what decides whether the heading shows. */
  const inlineLoses = await page.evaluate(() => {
    const h = document.getElementById('hist-header');
    h.style.display = 'none';
    const got = getComputedStyle(h).display;
    h.style.display = '';
    return got;
  });
  ok(inlineLoses !== 'none',
     'and an inline display is still outranked, so the class is doing the work', inlineLoses);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('starred-chats-can-actually-be-shown') > 0) process.exitCode = 1;
done();
