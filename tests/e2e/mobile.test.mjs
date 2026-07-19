/* MOBILE — the workbench must be usable on a phone.

   On a 390px screen, Dev and Lab used to lay their input and output panes side
   by side (flex:1 each ~195px), which collapsed the code editor to ~29px tall
   and pushed Lab's controls off the right edge. On mobile we now stack the panes
   and show one at a time via an Editor/Preview toggle.

   These tests run at BOTH a phone width and a desktop width, because the risk
   cuts both ways: the fix must engage on mobile AND must not touch the desktop
   split. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

/* ---------- MOBILE ---------- */
const m = await bootApp({ tab: 'chat', viewport: { width: 390, height: 844 } });

section('Mobile: Lab stacks its panes with a working toggle');

const labMobile = await m.page.evaluate(async () => {
  setTab('lab');
  await new Promise(r => setTimeout(r, 300));
  const ta = document.getElementById('lab-code');
  if (ta) { ta.value = 'console.log(1+1)'; ta.dispatchEvent(new Event('input', { bubbles: true })); }
  await new Promise(r => setTimeout(r, 200));

  const vw = window.innerWidth;
  const ed = document.getElementById('lab-code').getBoundingClientRect();
  const ctrls = [...document.querySelectorAll('.lab-split button, .lab-split input, .lab-split select')]
    .filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
  let off = 0;
  for (const e of ctrls) { const b = e.getBoundingClientRect(); if (b.right > vw + 2 || b.left < -2) off++; }

  const bar = document.querySelector('.mv-toggle');
  const toggleVisible = bar ? getComputedStyle(bar).display !== 'none' : false;

  return { editorW: Math.round(ed.width), editorH: Math.round(ed.height), off, toggleVisible };
});

ok(labMobile.toggleVisible, 'the Editor/Output toggle is shown on mobile');
ok(labMobile.editorW > 300, 'the code editor is full-width, not squeezed into a half-pane', labMobile.editorW);
ok(labMobile.editorH > 200, 'and it is tall enough to actually write code in', labMobile.editorH);
ok(labMobile.off === 0, 'no Lab controls are pushed off-screen', labMobile.off);

const labToggle = await m.page.evaluate(async () => {
  const before = {
    ed: getComputedStyle(document.querySelector('.lab-editor')).display !== 'none',
    out: getComputedStyle(document.querySelector('.lab-out')).display !== 'none',
  };
  document.querySelector('.mv-toggle button[data-mv="out"]').click();
  await new Promise(r => setTimeout(r, 150));
  const after = {
    ed: getComputedStyle(document.querySelector('.lab-editor')).display !== 'none',
    out: getComputedStyle(document.querySelector('.lab-out')).display !== 'none',
  };
  return { before, after };
});
ok(labToggle.before.ed && !labToggle.before.out, 'editor shows first, output hidden');
ok(!labToggle.after.ed && labToggle.after.out, 'tapping Output flips to the output pane');

section('Mobile: Dev stacks its panes too');

const devMobile = await m.page.evaluate(async () => {
  setTab('dev');
  await new Promise(r => setTimeout(r, 300));
  const shell = document.getElementById('dev-shell');
  // simulate a build having started (leaves the blank hero state)
  shell.classList.remove('dev-blank');
  _mountMobilePaneToggle('dev');
  await new Promise(r => setTimeout(r, 150));

  const bar = document.querySelector('.mv-toggle');
  const toggleVisible = bar ? getComputedStyle(bar).display !== 'none' : false;
  const chatFirst = getComputedStyle(document.querySelector('.dev-chat-pane')).display !== 'none';

  document.querySelector('.mv-toggle button[data-mv="out"]').click();
  await new Promise(r => setTimeout(r, 120));
  const prevShown = getComputedStyle(document.querySelector('.dev-preview')).display !== 'none';
  const chatHidden = getComputedStyle(document.querySelector('.dev-chat-pane')).display === 'none';

  return { toggleVisible, chatFirst, prevShown, chatHidden };
});
ok(devMobile.toggleVisible, 'Dev shows the pane toggle once a build is active');
ok(devMobile.chatFirst, 'the build pane shows first');
ok(devMobile.prevShown && devMobile.chatHidden, 'tapping Preview flips to the preview pane');

section('Mobile: no horizontal overflow on any main tab');

const overflow = await m.page.evaluate(async () => {
  const tabs = ['chat', 'images', 'video', 'dev', 'lab', 'studio', 'crew', 'projects', 'marketplace'];
  const bad = [];
  for (const t of tabs) {
    setTab(t);
    await new Promise(r => setTimeout(r, 150));
    const over = document.documentElement.scrollWidth - window.innerWidth;
    if (over > 2) bad.push(t + ':' + over + 'px');
  }
  return bad;
});
ok(overflow.length === 0, 'no tab overflows the viewport width', overflow);

await m.close();

/* ---------- DESKTOP (the fix must NOT touch it) ---------- */
const d = await bootApp({ tab: 'chat', viewport: { width: 1280, height: 800 } });

section('Desktop: the split view is unchanged');

const desktop = await d.page.evaluate(async () => {
  setTab('lab');
  await new Promise(r => setTimeout(r, 300));
  const ta = document.getElementById('lab-code');
  if (ta) { ta.value = 'x'; ta.dispatchEvent(new Event('input', { bubbles: true })); }
  await new Promise(r => setTimeout(r, 150));
  const bar = document.querySelector('.mv-toggle');
  return {
    toggleHidden: bar ? getComputedStyle(bar).display === 'none' : true,
    editorVisible: getComputedStyle(document.querySelector('.lab-editor')).display !== 'none',
    outVisible: getComputedStyle(document.querySelector('.lab-out')).display !== 'none',
  };
});
ok(desktop.toggleHidden, 'the mobile toggle is hidden on desktop');
ok(desktop.editorVisible && desktop.outVisible, 'both panes remain visible side by side');

await d.close();
report();
done();
