/* THE SPLIT WAS SOMEBODY ELSE'S CHOICE, MADE ONCE.

   Dev put the conversation and the preview side by side at flex:1 against
   flex:1.5 - a fixed 40/60 that suits neither reading a long answer nor
   watching a wide layout render, and could not be changed.

   It is a percentage now, set by dragging the divider between the panes, and
   remembered. Stored as a DEVICE setting rather than an account one: how wide
   a pane should be is a fact about the screen in front of you, and the same
   person on a laptop and a phone wants different answers. LESSONS 335 is the
   version of this that was got wrong the other way round - a deployment
   setting filed per account - so the classification is asserted here rather
   than assumed.

   Below 760px the panes stack and only one is shown at a time, so there is
   nothing to divide; the divider hides rather than becoming a control that
   moves something invisible. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: '' });
const { page, errors } = app;

const openBuild = () => page.evaluate(() => {
  S.tab = 'dev';
  _DEV.log = [{ role: 'user', text: 'build something' }];
  _DEV.project = { 'a.js': { content: 'x' } };
  _DEV.atHome = false;
  renderBuildView();
});
const geom = () => page.evaluate(() => {
  const sh = document.getElementById('dev-shell');
  if (!sh) return { missing: true };
  const c = sh.querySelector('.dev-chat-pane').getBoundingClientRect();
  const p = sh.querySelector('.dev-preview').getBoundingClientRect();
  const d = document.getElementById('dev-split');
  return {
    chat: Math.round(c.width), prev: Math.round(p.width),
    split: parseFloat(getComputedStyle(sh).getPropertyValue('--dev-split')) || 0,
    dividerShown: d ? getComputedStyle(d).display !== 'none' : false,
    dividerW: d ? Math.round(d.getBoundingClientRect().width) : 0,
    saved: (() => { try { return loadStr('amv_dev_split') || ''; } catch (e) { return ''; } })(),
  };
});
async function dragBy(dx) {
  const box = await page.locator('#dev-split').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

await openBuild();
await page.waitForTimeout(250);

section('There is a divider, and it is big enough to grab');
{
  const g = await geom();
  ok(g.dividerShown, 'the divider is there', g);
  ok(g.dividerW >= 8, 'and wider than the hairline it draws, so it can be hit', g.dividerW);
  ok(g.prev > g.chat, 'the preview starts as the larger pane, as it always did', g);
}

section('Dragging it makes the preview bigger');
{
  const before = await geom();
  await dragBy(-150);                     // left = more preview
  const after = await geom();
  ok(after.prev > before.prev + 80, 'the preview grew', { before: before.prev, after: after.prev });
  ok(after.chat < before.chat - 80, 'and the conversation gave up the room', { before: before.chat, after: after.chat });
  ok(after.chat + after.prev >= before.chat + before.prev - 20,
     'without either pane leaking space out of the window', after);
}

section('And dragging it back the other way makes it smaller');
{
  const before = await geom();
  await dragBy(250);
  const after = await geom();
  ok(after.prev < before.prev - 80, 'the preview shrank', { before: before.prev, after: after.prev });
  ok(after.chat > before.chat + 80, 'and the conversation got the room back', { before: before.chat, after: after.chat });
}

section('Neither pane can be dragged away to nothing');
{
  /* A divider that can be pulled to the edge is one that can hide the thing it
     divides, with no way back except knowing the divider is still there. */
  await dragBy(-4000);
  const far = await geom();
  ok(far.chat > 100, 'the conversation keeps a usable width at the extreme', far);
  await dragBy(4000);
  const other = await geom();
  ok(other.prev > 100, 'and so does the preview at the other one', other);

  /* TWO GUARDS, AND ONLY ONE OF THEM IS VISIBLE ABOVE.

     The panes carry min-width in CSS, so the two assertions above hold even
     with the stored percentage at 0 or 100 - which a mutation run showed by
     widening the clamp and watching them both still pass. That is the CSS
     doing the work, and it is worth knowing rather than assuming the number
     was what saved it.

     The stored value matters separately: it is what a later render and the
     aria value are built from, and a 0 there means the layout is only being
     rescued by a minimum every time. So the range itself is pinned. */
  const stored = await page.evaluate(() => ({
    saved: parseFloat(loadStr('amv_dev_split')),
    min: window.DEV_SPLIT_MIN, max: window.DEV_SPLIT_MAX,
    aria: parseFloat(document.getElementById('dev-split').getAttribute('aria-valuenow')),
  }));
  ok(stored.saved >= stored.min && stored.saved <= stored.max,
     'and the size that gets written down stays inside its declared range', stored);
  ok(stored.min >= 10 && stored.max <= 90,
     'which is a range that leaves both panes usable', stored);
  ok(stored.aria === stored.saved,
     'with the announced value matching what was stored', stored);
}

section('It is remembered, and it comes back');
{
  await dragBy(-120);
  const set = await geom();
  ok(set.saved, 'the size is written down', set.saved);
  ok(Math.abs(parseFloat(set.saved) - set.split) < 2,
     'as the size that is actually on screen', { saved: set.saved, split: set.split });

  await openBuild();
  await page.waitForTimeout(250);
  const back = await geom();
  ok(Math.abs(back.split - set.split) < 2, 're-rendering keeps it', { was: set.split, now: back.split });
  ok(Math.abs(back.prev - set.prev) < 20, 'and the panes are the same size', { was: set.prev, now: back.prev });
}

section('It belongs to the screen, not to the account');
{
  /* The mistake LESSONS 335 records, pointing the other way: a value about the
     device filed per account disappears at sign-out. A pane width is not
     personal - it is about the monitor. */
  const r = await page.evaluate(() => ({
    /* The set is a top-level const in the bundle, not a window property -
       reading window._GLOBAL_KEYS asked whether it happens to be exposed,
       which is not the question and answered no while the key was correctly
       in it. */
    global: (typeof _GLOBAL_KEYS !== 'undefined') && _GLOBAL_KEYS.has('amv_dev_split'),
    device: (window._DEVICE_GLOBAL_KEYS || []).includes('amv_dev_split'),
    cleared: (window._SIGNOUT_CLEAR_GLOBAL || []).includes('amv_dev_split'),
    unscoped: Object.keys(localStorage).includes('amv_dev_split'),
  }));
  ok(r.global, 'the key is unscoped', r);
  ok(r.device, 'and declared as a device setting', r);
  ok(!r.cleared, 'rather than something a sign-out wipes', r);
  ok(r.unscoped, 'and it really is stored unscoped, not under an account prefix', r);
}

section('The keyboard moves it too');
{
  const before = await geom();
  await page.evaluate(() => document.getElementById('dev-split').focus());
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(100);
  const bigger = await geom();
  ok(bigger.split > before.split, 'left arrow gives the preview more', { before: before.split, after: bigger.split });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  const smaller = await geom();
  ok(smaller.split < bigger.split, 'and right arrow takes it back', { was: bigger.split, now: smaller.split });

  const named = await page.evaluate(() => {
    const d = document.getElementById('dev-split');
    return { role: d.getAttribute('role'), label: d.getAttribute('aria-label'),
             now: d.getAttribute('aria-valuenow'), min: d.getAttribute('aria-valuemin'),
             focusable: d.tabIndex >= 0 };
  });
  ok(named.role === 'separator', 'it is announced as a separator', named);
  ok(/resize/i.test(named.label || ''), 'with a name that says what it does', named.label);
  ok(named.focusable, 'and can be reached by keyboard at all', named);
  ok(named.now && named.min, 'reporting its value and its range', named);
}

section('On a phone there is nothing to divide, so there is no divider');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const g = await geom();
  ok(!g.dividerShown, 'the divider is gone where the panes stack', g);
  ok(g.chat > 300, 'and the visible pane has the whole width', g);
}

ok(errors.length === 0, 'no console errors', errors);

await app.close();
if (report('the-preview-is-as-big-as-you-want-it') > 0) process.exitCode = 1;
done();
