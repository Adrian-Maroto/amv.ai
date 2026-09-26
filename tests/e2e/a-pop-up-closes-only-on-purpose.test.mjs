/* A POP-UP CLOSES ONLY ON PURPOSE.

   "When I'm signing in and I click out of the sign in tab it closes it. Same
   with other things. Make sure it only works when you click X."

   A click that lands a few pixels outside a form is the commonest accident
   there is, and on sign-in, payment or a half-written listing it threw away
   what had been typed. Now the dark area around a pop-up does not close it: it
   nudges the panel so the click is plainly seen, and the X, Cancel or Escape
   are the ways out. Measured on the real sign-in, the confirm dialog, the
   shared overlay shell, the command palette and Settings - with real clicks at
   a real corner of the backdrop, not synthetic events on the element. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('cookie-consent-banner')?.remove());

/* A real mouse click at the top-left corner of the backdrop - where a stray
   click lands - and whether the backdrop is still there afterwards. */
async function clickOutside(bgId) {
  const box = await page.locator('#' + bgId).boundingBox();
  if (!box) return { found: false };
  await page.mouse.click(box.x + 6, box.y + 6);
  await page.waitForTimeout(80);
  const nudged = await page.evaluate((id) => {
    const p = document.getElementById(id); return !!(p && p.firstElementChild && p.firstElementChild.classList.contains('ov-nudge'));
  }, bgId);
  await page.waitForTimeout(250);
  return { found: true, open: await page.evaluate((id) => !!document.getElementById(id), bgId), nudged };
}

section('Sign-in: a click outside keeps it open, typed text and all');
{
  await page.evaluate(() => openAuth('signin'));
  await page.waitForSelector('#auth-bg');
  const email = await page.evaluate(() => { const i = document.querySelector('#auth-bg input[type="email"], #auth-bg input'); if (i) { i.value = 'someone@example.com'; return true; } return false; });
  const r = await clickOutside('auth-bg');
  const still = await page.evaluate(() => { const i = document.querySelector('#auth-bg input[type="email"], #auth-bg input'); return i ? i.value : null; });
  ok(r.found && r.open, 'the sign-in stays open after a click on the dark area - this was the complaint', r);
  ok(r.nudged, 'and the panel nudges, so the click was seen', r);
  ok(email && still === 'someone@example.com', 'and what was typed is still there', still);
  await page.click('#auth-x');
  ok(!(await page.evaluate(() => !!document.getElementById('auth-bg'))), 'the X closes it', true);
}

section('A confirm dialog: outside does nothing, Cancel answers no');
{
  const p = page.evaluate(() => _askDestructive('Delete this?', 'It cannot be restored.', 'Delete'));
  await page.waitForSelector('#cfm-bg');
  const r = await clickOutside('cfm-bg');
  ok(r.open, 'a click outside does not answer the question', r);
  await page.evaluate(() => { const b = document.querySelector('#cfm-bg .btn.bs, #cfm-no'); if (b) b.click(); });
  const v = await Promise.race([p, new Promise(res => setTimeout(() => res('HUNG'), 2000))]);
  ok(v === false, 'and Cancel answers no', v);
}

section('The shared overlay shell');
{
  await page.evaluate(() => { const r = document.getElementById('ovr'); r.innerHTML = _ovShell({ id: 'tst', title: 'A test' }); r.classList.add('on'); _ovWire('tst'); });
  const r = await clickOutside('tst-bg');
  ok(r.open, 'stays open on an outside click', r);
  await page.click('#tst-x');
  ok(!(await page.evaluate(() => !!document.getElementById('tst-bg'))), 'and its X closes it', true);
}

section('The command palette has an X, and needs it');
{
  await page.evaluate(() => openCommandPalette());
  await page.waitForSelector('#cmdk-bg');
  const r = await clickOutside('cmdk-bg');
  ok(r.open, 'an outside click leaves it open', r);
  ok(await page.locator('#cmdk-x').isVisible(), 'there is a visible X', true);
  await page.click('#cmdk-x');
  ok(!(await page.evaluate(() => !!document.getElementById('cmdk-bg'))), 'which closes it', true);
  await page.evaluate(() => openCommandPalette());
  await page.waitForSelector('#cmdk-inp');
  await page.focus('#cmdk-inp');
  await page.keyboard.press('Escape');
  ok(!(await page.evaluate(() => !!document.getElementById('cmdk-bg'))), 'and Escape still does too', true);
}

section('Settings: a click beside the panels does not throw you out');
{
  /* A phone, because that is where there IS empty area: the strip Settings
     keeps above the bottom bar. On a desktop the panels fill the shell and the
     old click-away could not be reached at all; on a phone a thumb resting
     just above the bar threw the person out of Settings. */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => setTab('settings'));
  await page.waitForSelector('.settings-shell');
  /* A point that is the empty area itself - found, not assumed. The first
     version clicked a corner that turned out to be a panel, and passed with the
     click-away put back. */
  const pt = await page.evaluate(() => {
    const sh = document.querySelector('.settings-shell'), b = sh.getBoundingClientRect();
    for (let y = b.top + 2; y < b.bottom; y += 6) for (let x = b.left + 2; x < b.right; x += 6)
      if (document.elementFromPoint(x, y) === sh) return { x, y };
    return null;
  });
  ok(!!pt, 'there is empty area beside the panels to click', pt);
  if (pt) { await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.up(); }
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => S.tab === 'settings'), 'still in Settings', await page.evaluate(() => S.tab));
  await page.click('#set-close');
  ok(await page.evaluate(() => S.tab !== 'settings'), 'the X leaves', await page.evaluate(() => S.tab));
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
