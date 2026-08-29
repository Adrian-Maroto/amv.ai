/* A DIALOG YOU CANNOT REACH THE BOTTOM OF.

   `.ov` is a flex backdrop with `align-items:center` and no overflow. That
   centres a dialog beautifully, and the moment the dialog is taller than the
   viewport it puts part of it where nothing can reach: flex centring overflows
   in BOTH directions, and the half above the container cannot be scrolled to
   even when the container scrolls.

   Job Hunt is 1097px tall on a phone. Its bottom 250px is where its Save button
   lives, and it could not be reached at all - the form visible, the button to
   submit it not. Nothing looked broken; it just did not go anywhere.

   The first version of this file got the WRONG ANSWER in both directions. It
   asked whether the PANEL scrolls, which says nothing about whether the
   BACKDROP does, so it reported Cowork as broken when scrolling its backdrop
   brings the bottom into view perfectly well - and it counted inline links in a
   sentence as undersized tap targets, which WCAG 2.5.8 deliberately exempts,
   because padding those breaks the line they sit in and helps nobody.

   So it measures reachability by scrolling the way a finger would and then
   looking, rather than inferring it from a computed style. That distinction is
   the whole value of the file: the first version would have had somebody
   "fixing" a modal that worked while the broken one stayed broken.

   Runs at four real widths, because a phone, a small phone, a tablet and a
   laptop window are four different products. */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { armGeom } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const HTML = readFileSync('index.html');
/* PORT 0 ASKS THE KERNEL FOR A FREE ONE.
   A fixed port is a suite that fails when anything else already holds it -
   another run, a leftover process, or simply the same gate started twice.
   That is not a product failure but it reads exactly like one, and a gate
   that goes red for reasons of its own is a gate people stop believing. */
let PORT = 0;
const server = createServer((_q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(HTML); });
await new Promise(r => server.listen(0, r));
PORT = server.address().port;

const LAUNCH = process.env.PLAYWRIGHT_BROWSERS_PATH
  ? { executablePath: process.env.PLAYWRIGHT_BROWSERS_PATH + '/chromium' } : {};
const browser = await chromium.launch(LAUNCH);

const SIZES = [
  ['phone',        390, 844],
  ['phone-small',  320, 568],
  ['tablet',       768, 1024],
  ['laptop-small', 1280, 720],
];

/* The overlays, by the function that opens them. Only ones that need no
   network and no signed-in server. */
const OPENERS = [
  ['settings picker',   '_openSettingsPicker'],
  ['command palette',   'openCommandPalette'],
  ['shortcut sheet',    'openShortcutSheet'],
  ['terms',             'openTerms'],
  ['privacy',           'openPrivacy'],
  ['delete account',    '_confirmDeleteAccount'],
  ['handoff manager',   'openHandoffManager'],
  ['design DNA',        'openDNA'],
  ['workspace create',  'createWorkspaceModal'],
  ['prompt create',     'createPromptModal'],
  ['share',             'openShareModal'],
  ['job hunt',          'openJobHunt'],
  ['cowork',            'openCowork'],
  ['trip planner',      'openTripPlanner'],
  ['VS Code',           '_devConnectVSCode'],
];

const problems = [];
const note = (s) => { problems.push(s); };

for (const [label, w, h] of SIZES) {
  section(`${label}  ${w}x${h}`);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  /* This page is built here rather than by bootApp, so it has to be armed here
     too - and deviceScaleFactor:2 is the setting that makes a rect come back a
     fraction under its declared size in the first place. */
  await armGeom(page);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
    S.user = { name: 'Test', email: 'test@amv.dev', ini: 'T' };
    goApp(); setTab('chat');
    document.getElementById('ck')?.remove();
  });
  await page.waitForTimeout(300);

  /* The page itself must not scroll sideways at any width. */
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
  }));
  if (overflow.doc > overflow.win + 1) note(`${label}: the PAGE scrolls sideways (${overflow.doc} > ${overflow.win})`);

  let opened = 0;
  for (const [name, fn] of OPENERS) {
    const res = await page.evaluate(async ({ fn, name }) => {
      const r = document.getElementById('ovr');
      if (r) r.innerHTML = '';
      if (typeof window[fn] !== 'function') return { skip: 'no such opener' };
      try { window[fn](); } catch (e) { return { threw: String(e.message || e).slice(0, 90) }; }
      await new Promise(s => setTimeout(s, 260));
      const panel = document.querySelector('#ovr .ob, #ovr .ovr-card, #ovr .cmdk, #ovr .ksheet, #ovr .dna-modal, #ovr .tp-modal, #ovr .upg-modal, #ovr .pay-modal, #ovr .cwp, #ovr .ml-modal, #ovr .status-modal, #ovr .pc-modal, #ovr .cp-modal');
      if (!panel) return { none: true };
      /* REACHABILITY, measured rather than inferred. The first version of this
         asked whether the PANEL scrolls, which says nothing about whether the
         BACKDROP does - and reported Cowork as broken when scrolling its
         backdrop brought the bottom into view perfectly well. Scroll it the way
         a finger would, then look. */
      const back = panel.closest('.ov, .ovr-bg, .upg-ov, .pay-ov, .dna-ov') || panel.parentElement;
      const topBefore = panel.getBoundingClientRect().top;
      if (back) { back.scrollTop = 0; }
      const topAtRest = panel.getBoundingClientRect().top;
      if (back) { back.scrollTop = 99999; }
      await new Promise(s => setTimeout(s, 120));
      const bottomScrolled = panel.getBoundingClientRect().bottom;
      const bottomReachable = Math.round(bottomScrolled) <= window.innerHeight + 2;
      const topReachable = Math.round(topAtRest) >= -2;
      if (back) { back.scrollTop = 0; }

      const b = panel.getBoundingClientRect();
      /* Anything a finger has to hit, inside this panel. */
      /* WCAG 2.5.8 exempts a link inline in a sentence - padding those to 24px
         breaks the line they sit in and helps nobody. Everything else counts. */
      const smallEls = [...panel.querySelectorAll('button, a, input, select, textarea, [data-dact]')]
        .filter(el => !el.matches('.lnk-inline, .ckl'))
        .filter(el => { const r2 = el.getBoundingClientRect(); return r2.width > 0 && r2.height > 0 && (__under(r2.height, 24) || __under(r2.width, 24)); });
      const small = smallEls.length;
      const smallWhat = smallEls.map(el => (el.className || el.tagName) + ' ' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height)).join(', ');
      return {
        wider: Math.round(b.width) > window.innerWidth + 1,
        offLeft: b.left < -1,
        unreachableBottom: !bottomReachable,
        unreachableTop: !topReachable,
        w: Math.round(b.width), h: Math.round(b.height),
        small, smallWhat,
      };
    }, { fn, name });

    if (res.skip || res.none) continue;
    opened++;
    if (res.threw) { note(`${label} / ${name}: opening it threw - ${res.threw}`); continue; }
    if (res.wider) note(`${label} / ${name}: panel is wider than the screen (${res.w} > ${w})`);
    if (res.offLeft) note(`${label} / ${name}: panel starts off the left edge`);
    if (res.unreachableBottom) note(`${label} / ${name}: the BOTTOM cannot be reached even by scrolling (panel ${res.h}px, viewport ${h}px)`);
    if (res.unreachableTop) note(`${label} / ${name}: the TOP is above the scrollable area - flex centring overflowing upward`);
    if (res.small > 0) note(`${label} / ${name}: ${res.small} control(s) under 24px: ${res.smallWhat}`);
  }
  ok(opened >= 10, `${label}: the overlays really opened`, opened);
  await page.close();
}

await browser.close();
server.close();

section('Every overlay is reachable at every width');
{
  ok(problems.length === 0,
     'no dialog hides a control behind an edge nothing can scroll to', problems);
}

if (report('every-dialog-can-be-reached') > 0) process.exitCode = 1;
done();
