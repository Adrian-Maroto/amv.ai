/* THE WHOLE PRODUCT, ON A PHONE.

   Every feature built in this arc was checked at 390px as it was written. That
   is not the same as checking the product: regressions land in the screens
   nobody touched, and a layer of CSS added for one pane can push another one
   off the side of the screen. This walks every tab and every settings pane and
   asserts the four things that make a screen usable on a phone at all.

   It is deliberately mechanical. The value is coverage, not cleverness. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { overflowingElement } from '../lib/layout.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Alice', email: 'alice@x.com', ini: 'A' } });
const { page, errors } = app;

const PHONE = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };     // the narrowest phone still in use

/* Every tab reachable from the app shell. */
const TABS = ['chat', 'workspaces', 'memory', 'usage', 'billing', 'plans',
              'settings', 'help', 'apps', 'tasks', 'integrations', 'crew', 'studio', 'dev',
              'handoff', 'lab', 'market'];

/* Every settings pane a normal (non-operator) user can open. */
const PANES = ['account', 'privacy', 'security', 'billing', 'usage', 'capabilities', 'spending',
               'api', 'invite', 'family', 'appearance', 'language', 'skills', 'integrations',
               'projects', 'about'];

async function measure() {
  return page.evaluate(() => {
    // Controls too small to hit reliably with a thumb.
    const tiny = [];
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (__under(r.height, 22) || __under(r.width, 22)) tiny.push((el.id || el.className || el.tagName).toString().slice(0, 40));
    }
    // Controls a screen reader would announce as nothing at all.
    const unnamed = [];
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
      if (!name) unnamed.push((el.id || el.className || 'button').toString().slice(0, 40));
    }
    // Inputs with no label anything could read out.
    const unlabelled = [];
    for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const has = el.getAttribute('aria-label') || el.getAttribute('placeholder') ||
                  (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) ||
                  el.closest('label');
      if (!has) unlabelled.push((el.id || el.name || el.type || 'input').toString().slice(0, 40));
    }
    return { tiny: [...new Set(tiny)], unnamed: [...new Set(unnamed)], unlabelled: [...new Set(unlabelled)] };
  });
}

async function openTab(tab) {
  await page.evaluate(t => { S.tab = t; setTab(t); }, tab);
  await page.waitForTimeout(90);
}
async function openPane(pane) {
  await page.evaluate(p => { S.tab = 'settings'; setTab('settings'); S.settingsPane = p; renderSetPane(); }, pane);
  await page.waitForTimeout(90);
}

await page.setViewportSize(PHONE);

section('Every tab fits a phone');
{
  const bad = [];
  for (const tab of TABS) {
    await openTab(tab);
    const w = await overflowingElement(page);
    if (w) bad.push(tab + ': ' + w.tag + '.' + w.cls + ' +' + w.over + 'px');
  }
  ok(bad.length === 0, 'no tab pushes anything off the side of the screen', bad);
}

section('Every settings pane fits a phone');
{
  const bad = [];
  for (const pane of PANES) {
    await openPane(pane);
    const w = await overflowingElement(page);
    if (w) bad.push(pane + ': ' + w.tag + '.' + w.cls + ' +' + w.over + 'px');
  }
  ok(bad.length === 0, 'no settings pane does either', bad);
}

section('It still fits on the narrowest phone people actually use');
{
  await page.setViewportSize(SMALL);
  const bad = [];
  for (const tab of ['chat', 'plans', 'usage', 'billing', 'market', 'crew', 'dev']) {
    await openTab(tab);
    const w = await overflowingElement(page);
    if (w) bad.push(tab + ': ' + w.tag + '.' + w.cls + ' +' + w.over + 'px');
  }
  ok(bad.length === 0, 'the busiest screens survive 320px', bad);
  await page.setViewportSize(PHONE);
}

section('Nothing important is too small to tap');
{
  const bad = [];
  for (const tab of TABS) {
    await openTab(tab);
    const m = await measure();
    if (m.tiny.length) bad.push(tab + ': ' + m.tiny.slice(0, 3).join(', '));
  }
  ok(bad.length === 0, 'every control is at least 22px on both sides', bad);
}

section('Every button says what it is');
{
  const bad = [];
  for (const tab of TABS) {
    await openTab(tab);
    const m = await measure();
    if (m.unnamed.length) bad.push(tab + ': ' + m.unnamed.slice(0, 3).join(', '));
  }
  for (const pane of PANES) {
    await openPane(pane);
    const m = await measure();
    if (m.unnamed.length) bad.push('settings/' + pane + ': ' + m.unnamed.slice(0, 3).join(', '));
  }
  ok(bad.length === 0, 'no button would be announced as nothing at all', bad);
}

section('Every field has something to announce');
{
  const bad = [];
  for (const pane of PANES) {
    await openPane(pane);
    const m = await measure();
    if (m.unlabelled.length) bad.push('settings/' + pane + ': ' + m.unlabelled.slice(0, 3).join(', '));
  }
  ok(bad.length === 0, 'no input is unlabelled', bad);
}

section('The composer stays reachable with the keyboard up');
{
  /* A phone keyboard takes roughly half the screen. If the composer is pinned
     to the bottom of a full-height layout it goes under the keyboard, which is
     the single most common way a chat app breaks on mobile. */
  await page.setViewportSize({ width: 390, height: 420 });
  await openTab('chat');
  const v = await page.evaluate(() => {
    const ta = document.getElementById('mta');
    if (!ta) return { found: false };
    const r = ta.getBoundingClientRect();
    return { found: true, onScreen: r.top >= 0 && r.bottom <= window.innerHeight + 1, height: Math.round(r.height) };
  });
  ok(v.found, 'the composer exists');
  ok(v.onScreen, 'and stays fully on screen in a short viewport', v);
  await page.setViewportSize(PHONE);
}

section('Every control on a phone is big enough to hit');
{
  /* Measured, not assumed. At 390px the Crew screen alone had 39 job toggles
     under 32px tall, plus the selects and chips on chat, Lab and Dev. A
     control you miss is a control that does not work, and a screen that merely
     FITS on a phone is not the same as one you can use on a phone.

     44px is the figure both major platforms settled on. Anything shorter than
     32 is well past arguable. */
  await page.setViewportSize({ width: 390, height: 844 });
  const bad = await page.evaluate(async () => {
    saveStr('amv_plan', 'ultra');
    const out = [];
    for (const t of ['crew', 'chat', 'lab', 'dev', 'studio', 'market', 'plans', 'settings']) {
      S.tab = t; try { setTab(t); } catch (e) {}
      await new Promise(r => setTimeout(r, 110));
      const small = [];
      document.querySelectorAll('#vc button,#vc a[href],#vc input,#vc select').forEach(el => {
        const b = el.getBoundingClientRect();
        if (b.width > 0 && b.height > 0 && __under(b.height, 32)) {
          small.push(t + ':' + (String(el.className).split(' ')[0] || el.tagName) + '@' + Math.round(b.height));
        }
      });
      if (small.length) out.push({ tab: t, count: small.length, first: small.slice(0, 3) });
    }
    return out;
  });
  ok(bad.length === 0, 'no control on any screen is under 32px tall at 390px', bad);

  /* And raising them must not have pushed anything off the side. */
  const over = await page.evaluate(() => {
    const w = window.innerWidth; let worst = 0;
    document.querySelectorAll('#vc *').forEach(el => {
      const b = el.getBoundingClientRect();
      if (b.right > w + 1) worst = Math.max(worst, Math.round(b.right - w));
    });
    return worst;
  });
  ok(over === 0, 'and nothing overflows as a result', over);
}

ok(errors.length === 0, 'and none of it threw', errors.slice(0, 3));
report('mobile-sweep');
done();
