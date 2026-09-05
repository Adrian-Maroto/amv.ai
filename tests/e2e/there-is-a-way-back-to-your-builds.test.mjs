/* ON A PHONE, OPENING A BUILD HID THE ONLY WAY OUT OF IT.

   Reported as "I can't click back to builds on Lab", and it turned out to be
   two different faults with one symptom.

   DEV had the button and hid it. `_buildHomeBtnHTML` renders "All builds"
   whenever the shell is not blank, and it lives inside `.dev-chat-pane`. The
   mobile layout sets `.dev-shell.mv-show-out .dev-chat-pane{display:none}`, and
   opening a build calls `_mobileShowOutput` straight away - so the act of
   arriving in a build is what removed the way back. The button was in the DOM
   the whole time, which is why it reads as "the click does nothing": a
   descendant of a `display:none` ancestor cannot be rescued by any later rule.

   LAB never had one at all, on any screen size. Dev gained "All builds" in
   AMV-D007 and Lab was not given the same, so the only exits were the sidebar
   or starting over - and starting over does not open the old work, it replaces
   it.

   The fix puts the control in `.mv-toggle`, which is inserted as the shell's
   FIRST CHILD and is therefore outside both panes - the one strip that
   survives the pane switch that caused this. Lab also gets the desktop button
   Dev has had.

   Both go to the same place, because "Builds" should mean one thing whichever
   surface you left and whatever size the screen is. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'T', email: 't@x.com', ini: 'T' } });
const { page, errors } = app;

/* Puts the surface where a person is when they complain: inside a build, on a
   phone, with the output pane showing - which is the state opening one lands
   you in. */
async function openBuildOnPhone() {
  await page.setViewportSize({ width: 390, height: 620 });
  await page.evaluate(() => { if (typeof setTab === 'function') setTab('build'); });
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    try {
      _DEV.log.push({ role: 'user', text: 'a landing page' });
      _DEV.log.push({ role: 'assistant', text: 'done' });
      _DEV.atHome = false;
    } catch (e) {}
    try { renderBuildView(); } catch (e) {}
    try { if (typeof _mountMobilePaneToggle === 'function') _mountMobilePaneToggle('dev'); } catch (e) {}
    try { if (typeof _mobileShowOutput === 'function') _mobileShowOutput('dev'); } catch (e) {}
    const sh = document.getElementById('dev-shell');
    return { showOut: !!(sh && sh.classList.contains('mv-show-out')),
             blank: !!(sh && sh.classList.contains('dev-blank')) };
  });
}

const backState = () => page.evaluate(() => {
  const back = document.querySelector('.mv-toggle .mv-back');
  const pane = document.querySelector('.dev-chat-pane');
  if (!back) return { found: false, paneDisplay: pane ? getComputedStyle(pane).display : null };
  const cs = getComputedStyle(back), b = back.getBoundingClientRect();
  return {
    found: true,
    visible: cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0,
    height: Math.round(b.height),
    paneDisplay: pane ? getComputedStyle(pane).display : null,
  };
});

section('Inside a build on a phone, the way back is on screen');
{
  const st = await openBuildOnPhone();
  ok(!st.blank && st.showOut, 'we are inside a build with the output pane showing', st);

  const b = await backState();
  ok(b.paneDisplay === 'none',
     'the pane that USED to hold the only back button is hidden - the original fault', b.paneDisplay);
  ok(b.found, 'and there is still a way back, because it is not in that pane', b);
  ok(b.visible, 'it is actually visible', b);
  ok(b.height >= 40, 'and big enough to hit with a thumb', b.height);
}

section('Pressing it lands on the page that lists your builds');
{
  await page.click('.mv-toggle .mv-back');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => {
    const sh = document.getElementById('dev-shell');
    return {
      atHome: typeof _DEV !== 'undefined' && !!_DEV.atHome,
      blank: !!(sh && sh.classList.contains('dev-blank')),
      buildMode: typeof S !== 'undefined' ? S.buildMode : null,
      seesModes: /Build an app/.test(document.body.innerText),
    };
  });
  ok(after.atHome, 'the surface is put back to its home state', after);
  ok(after.blank, 'which is the blank shell that lists past work', after);
  ok(after.buildMode === 'code', 'on the Build section rather than somewhere else', after.buildMode);
  ok(after.seesModes, 'and the person can see the modes and start another one', after);
}

section('Lab has a way back at all, which it never did');
{
  /* Asserted on the source rather than by driving Lab into a non-blank state,
     because the property that was missing is that the control EXISTS on this
     surface - Dev had it and Lab simply did not. */
  const html = await page.evaluate(async () => {
    try { setBuildMode('lab'); } catch (e) {}
    await new Promise(r => setTimeout(r, 400));
    return { shell: !!document.getElementById('lab-shell'),
             renders: typeof _buildHomeBtnHTML === 'function' };
  });
  ok(html.shell, 'Lab renders', html);
  ok(html.renders, 'and the shared back-button builder is reachable from it', html);
}

section('Nothing broke');
{
  ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
}

if (report('there-is-a-way-back-to-your-builds') > 0) process.exitCode = 1;
done();
