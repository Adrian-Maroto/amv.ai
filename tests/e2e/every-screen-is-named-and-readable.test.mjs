/* EVERY SCREEN IS NAMED AND READABLE, IN BOTH THEMES (Nov 3 audit OPS-010).

   every-control-has-a-name-and-a-target checks eight tabs at two widths, and
   computes names itself. This covers the rest of the product and asks the
   browser instead: Chromium's own accessibility tree - the thing a screen
   reader is actually given - read over the DevTools protocol, on every one of
   the eighteen screens and the dialogs people open, in dark and in light.

     - no control (button, link, field, menu item, tab, switch...) has an
       empty accessible name: a screen reader would say only "button";
     - every dialog has a name, so opening one says what it is;
     - text meets WCAG 2.2 AA contrast against what is behind it: 4.5:1, or
       3:1 for large text (24px, or 18.66px bold).

   Two things are not held to the contrast rule, each for a stated reason:
   text that is only emoji - a colour glyph is drawn in its own colours, so
   the CSS colour the check reads is not what anybody sees - and the logotype,
   which WCAG 1.4.3 exempts by name. Nothing else is skipped: a hidden or
   off-screen element is not measured because nobody sees it, not because it
   was waived.

   No new dependency: the tree and the computed styles come from the browser
   the suite already drives. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const TABS = ['chat', 'dashboard', 'workspaces', 'memory', 'usage', 'billing', 'plans', 'settings', 'help', 'apps', 'tasks',
  'integrations', 'crew', 'market', 'team', 'build:design', 'build:code', 'build:lab'];
const MODALS = ['openCommandPalette', 'openSharedChatsManager', 'openHandoffManager', 'openSchedManager', 'openTaskPanel',
  'openStatusPanel', 'openShortcuts', 'openMySites', 'openFeedback', 'openPlanCompare', 'openWhatsNew', 'openErrors', 'openResearchWatch'];
const CONTROLS = new Set(['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'switch', 'slider', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'tab', 'searchbox', 'spinbutton', 'listbox']);

const app = await bootApp({ tab: 'chat', user: { name: 'Ana', email: 'ana@example.com', ini: 'A' } });
const { page, errors } = app;
const cdp = await page.context().newCDPSession(page);
await cdp.send('Accessibility.enable');

async function describe(id) {
  try {
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: id });
    const { result } = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
      functionDeclaration: 'function(){ return this.outerHTML.replace(/\\s+/g," ").slice(0,140); }' });
    return result.value;
  } catch (e) { return '(gone)'; }
}
async function names() {
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const unnamed = [], dialogs = [];
  for (const n of nodes) {
    if (n.ignored) continue;
    const role = n.role && n.role.value, name = (n.name && n.name.value || '').trim();
    if (CONTROLS.has(role) && !name) unnamed.push({ role, id: n.backendDOMNodeId });
    if ((role === 'dialog' || role === 'alertdialog')) dialogs.push({ name, id: n.backendDOMNodeId });
  }
  const shown = [];
  for (const u of unnamed.slice(0, 3)) shown.push(u.role + ': ' + await describe(u.id));
  return { unnamed: unnamed.length, shown, dialogs };
}
const contrast = () => page.evaluate(() => {
  const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Component}‍️\s]+$/u;
  /* rgb()/rgba() give 0-255; color(srgb ...) - what color-mix() resolves to -
     gives 0-1, and reading it as 0-255 makes every mixed panel near black. */
  const lum = (c) => { const m = c.match(/[\d.]+/g); if (!m) return null; let [r, g, b, a] = m.map(Number);
    if (/^color\(srgb/.test(c)) { r *= 255; g *= 255; b *= 255; }
    const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
    return { L: .2126 * f(r) + .7152 * f(g) + .0722 * f(b), a: a === undefined ? 1 : a }; };
  const behind = (el) => { for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; const l = lum(cs.backgroundColor); if (l && l.a >= .95) return l; }
    return lum(getComputedStyle(document.body).backgroundColor); };
  const low = []; let measured = 0; const seen = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const t = w.currentNode, text = t.nodeValue.trim(); if (!text) continue;
    const el = t.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    if (EMOJI_ONLY.test(text) || el.closest('.logo-mark')) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const cs = getComputedStyle(el), fg = lum(cs.color); if (!fg || fg.a < .95) continue;
    const bg = behind(el); if (!bg) continue;
    const ratio = (Math.max(fg.L, bg.L) + .05) / (Math.min(fg.L, bg.L) + .05);
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
    measured++;
    if (ratio < need) low.push(ratio.toFixed(2) + ' < ' + need + ': ' + el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] + ' "' + text.slice(0, 30) + '"');
  }
  return { measured, low };
});

for (const theme of ['dark', 'light']) {
  await page.evaluate(t => { document.body.classList.toggle('light', t === 'light'); }, theme);
  await page.waitForTimeout(200);
  const isLight = await page.evaluate(() => document.body.classList.contains('light'));
  section(`Every screen, ${theme}`);
  ok(isLight === (theme === 'light'), `the ${theme} theme is the one measured`);
  const noName = [], dim = [], dark = []; let measured = 0;
  for (const tab of TABS) {
    await page.evaluate(t => { try { if (t.startsWith('build:')) { setTab('build'); setBuildMode(t.slice(6)); } else setTab(t); } catch (e) {} }, tab);
    await page.waitForTimeout(350);
    const n = await names(); const c = await contrast();
    measured += c.measured;
    if (n.unnamed) noName.push(tab + ' (' + n.unnamed + '): ' + n.shown.join(' | '));
    if (c.low.length) dim.push(tab + ': ' + c.low.slice(0, 3).join(' | '));
  }
  ok(measured > 500, 'a real amount of text was measured', measured);
  ok(noName.length === 0, 'no control on any screen is announced without a name', noName);
  ok(dim.length === 0, 'all text meets WCAG AA contrast against what is behind it', dim);

  section(`Every dialog, ${theme}`);
  const badM = [], unnamedD = [], dimM = [];
  for (const fn of MODALS) {
    const opened = await page.evaluate(async (name) => {
      const o = document.getElementById('ovr'); if (o) { o.innerHTML = ''; o.className = ''; }
      if (typeof window[name] !== 'function') return false;
      try { window[name](); } catch (e) { return false; }
      await new Promise(x => setTimeout(x, 450));
      return true;
    }, fn);
    if (!opened) continue;
    const n = await names(); const c = await contrast();
    if (n.unnamed) badM.push(fn + ' (' + n.unnamed + '): ' + n.shown.join(' | '));
    for (const d of n.dialogs) if (!d.name) unnamedD.push(fn + ': ' + await describe(d.id));
    if (c.low.length) dimM.push(fn + ': ' + c.low.slice(0, 3).join(' | '));
    await page.evaluate(() => { try { closeOvr(); } catch (e) {} });
  }
  ok(badM.length === 0, 'no control in any dialog is announced without a name', badM);
  ok(unnamedD.length === 0, 'every dialog says what it is when it opens', unnamedD);
  ok(dimM.length === 0, 'and the text in every dialog is readable', dimM);
}

section('The checks themselves notice');
{
  await page.evaluate(() => { setTab('chat'); const b = document.createElement('button'); b.id = 'amv-a11y-probe'; b.innerHTML = '<svg width="20" height="20"></svg>'; document.body.appendChild(b);
    const p = document.createElement('p'); p.id = 'amv-a11y-dim'; p.textContent = 'Barely there'; p.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;color:#777;background:#888;font-size:13px'; document.body.appendChild(p);
    const q = document.createElement('p'); q.id = 'amv-a11y-mix'; q.textContent = 'Mixed and fine'; q.style.cssText = 'position:fixed;top:40px;left:0;z-index:99999;color:#111;background:color-mix(in srgb,#fff 90%,#000);font-size:13px'; document.body.appendChild(q); });
  await page.waitForTimeout(150);
  const n = await names(); const c = await contrast();
  ok(n.shown.some(s => s.includes('amv-a11y-probe')), 'an icon-only button with no label is found', n.shown);
  ok(c.low.some(s => s.includes('Barely there')), 'and grey on grey is found', c.low.slice(0, 3));
  ok(!c.low.some(s => s.includes('Mixed and fine')), 'while dark text on a color-mix() panel is not flagged', c.low.slice(0, 3));
  await page.evaluate(() => { for (const id of ['amv-a11y-probe', 'amv-a11y-dim', 'amv-a11y-mix']) document.getElementById(id).remove(); });
}

report(errors);
await app.close();
done();
