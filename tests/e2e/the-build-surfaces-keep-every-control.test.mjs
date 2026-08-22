/* NOTHING DISAPPEARS IN THE MERGE.

   AMV-D007 folds Studio, Dev and Lab into one Build surface. The failure a merge
   like that actually has is not a crash - it is a button that quietly stopped
   being anywhere, on a screen nobody opened, noticed weeks later by the one
   person who used it.

   So the inventory is taken FIRST, against the build before any of the work, by
   driving the real app rather than reading its markup. It has to pass before
   and after, and the step that finishes the merge is the step that re-runs it.

   Taking it this way immediately found the gap that would have made it useless:
   a first pass drove Studio's hero and stopped, because reaching the canvas
   behind it normally needs a model call. That inventoried seven controls and
   left eight - back, add, refine, download, export, code, history - outside the
   baseline. The entire canvas, which is where Studio's work happens, could have
   been deleted with every check still green. It is mounted directly now.

   Design DNA needed the same treatment for the same reason: twelve sections,
   one mounted at a time, 217 controls between them. Snapshotting the open tab
   would have covered a twelfth of Studio and reported a pass.

   Five controls cannot be reached by driving at all - three hidden file inputs,
   a hidden language select, and Save, which appears only once a folder is
   connected. Those are checked against the built bundle instead, because "I
   could not click it" and "it is gone" have to stay different answers. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/build-surface-controls.json'), 'utf8'));

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

/* The same identity the fixture was captured with. An id is already unique and
   already stable, so it stands alone - appending the label made #dev-model carry
   the whole model picker's option text, and a wording change would then read as
   a deleted control. */
const IDENTITY = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const idOf = (e) => {
    if (e.id) return '#' + e.id;
    const label = (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)
      || e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('placeholder') || '';
    const hooks = ['data-dact','data-go','data-an','data-pv','data-add','data-s','data-r','data-dq','data-sld','data-pill','data-val'];
    const parts = [];
    for (const a of hooks) if (e.hasAttribute(a)) parts.push(a.replace('data-', '') + '=' + e.getAttribute(a));
    if (e.hasAttribute('data-darg')) parts.push('darg=' + e.getAttribute('data-darg'));
    if (parts.length) return '[' + parts.join(' ') + ']' + (label ? ' "' + label + '"' : '');
    const c = (e.className || '').toString().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    return (c ? '.' + c : e.tagName.toLowerCase()) + (label ? ' "' + label + '"' : '');
  };
  return { vis, idOf };
};

const snap = (root) => page.evaluate((ROOT_SEL) => {
  const { vis, idOf } = window.__identity();
  const out = [];
  const scope = document.querySelector(ROOT_SEL);
  if (scope) for (const e of scope.querySelectorAll('button, select, input, textarea, a[href], [role=button], [data-dact]')) {
    if (vis(e)) out.push(idOf(e));
  }
  return [...new Set(out)];
}, root);

await page.evaluate(`window.__identity = ${IDENTITY.toString()};`);
await page.evaluate(() => { S.user = { name: 'T', email: 't@amv.dev', ini: 'T' }; saveStr('amv_plan', 'ultra'); });

const found = new Set();
/* Ids are collected separately and WITHOUT the visibility filter, because five
   of these controls are invisible by design - three file inputs, a language
   select, and Save, which appears only once a folder is connected - and "I could
   not click it" must not read as "it is gone". */
const foundIds = new Set();
const collectIds = (root) => page.evaluate((SEL) => {
  const scope = document.querySelector(SEL);
  return scope ? [...scope.querySelectorAll('[id]')].map(e => e.id) : [];
}, root);
/* A render that THROWS has to be reported, not thrown onward. Sabotaging the
   toolbar away made renderLabView die on `$('lab-lang').value` - a fair crash
   for a surface with half of itself removed - and the whole suite went with it,
   printing a stack instead of naming the state that would not render. The gate
   then shows a Playwright trace where it should be saying "lab did not render".
   Every step of this merge changes a renderer, so this is the failure most
   likely to happen next. */
const renderFailures = [];
const walk = async (setup, root = '#vc', settle = 500, label = '') => {
  try {
    await page.evaluate(setup);
  } catch (e) {
    renderFailures.push((label || root) + ': ' + String(e.message || e).split('\n')[0]);
    return;
  }
  await page.waitForTimeout(settle);
  for (const c of await snap(root)) found.add(c);
  for (const id of await collectIds(root)) foundIds.add(id);
};

section('Every state of every Build surface is opened');
{
  await walk(() => { setTab('studio'); }, '#vc', 500, 'studio hero');
  await walk(() => { setTab('studio'); _studioNewArtifact('Test design', 'page', 'a brief'); _studioShowCanvas('a brief'); }, '#vc', 500, 'studio canvas');
  await walk(() => { _DEV.log = []; _DEV.project = {}; setTab('dev'); }, '#vc', 500, 'dev blank');
  await walk(() => { _DEV.log = [{ role: 'sys', text: 'built' }]; _devSetFile('index.html', '<h1>hi</h1>', 'html'); setTab('dev'); renderCodeView(); }, '#vc', 500, 'dev working');
  await walk(() => { _LAB.code = ''; setTab('lab'); }, '#vc', 500, 'lab entry');
  await walk(() => { _LAB.code = 'console.log(1)'; renderLabView(); }, '#vc', 500, 'lab loaded');

  await page.evaluate(() => { setTab('studio'); openDNA(); });
  await page.waitForTimeout(600);
  for (const c of await snap('#ovr')) found.add(c);
  for (const id of await collectIds('#ovr')) foundIds.add(id);
  await page.click('#dna-intro-go').catch(() => {});
  await page.waitForTimeout(500);
  const sections = await page.evaluate(() =>
    [...document.querySelectorAll('#ovr .dna-nav-b')].map(b => (b.textContent || '').trim()));
  ok(sections.length >= 10, 'Design DNA still has all of its sections', sections.length);
  for (const name of sections) {
    await page.evaluate((n) => {
      const b = [...document.querySelectorAll('#ovr .dna-nav-b')].find(x => (x.textContent || '').trim() === n);
      if (b) b.click();
    }, name);
    await page.waitForTimeout(260);
    for (const c of await snap('#ovr')) found.add(c);
    for (const id of await collectIds('#ovr')) foundIds.add(id);
  }
  ok(renderFailures.length === 0,
     'every Build state rendered without throwing', renderFailures);
  ok(found.size > 200, 'the walk reached a realistic number of controls', found.size);
}

section('Every control that existed before the merge is still reachable');
{
  const missing = FIX.rendered.filter(c => !found.has(c));
  ok(missing.length === 0,
     `all ${FIX.rendered.length} controls captured before AMV-D007 are still there`,
     missing.length + ' gone: ' + missing.slice(0, 12).join(' | '));
}

section('The controls that cannot be clicked are still in the page');
{
  /* This used to grep app.js for the literal `id="dev-save"`. That is the same
     proxy this repository keeps finding in its own checks - "the string appears
     in the bundle" standing in for "the control exists" - and it broke the
     moment AMV-D007 step 3 started building ids as arguments instead of
     spelling them into markup. The check went red while every control was
     present and correct.

     It asks the DOM now, with the visibility filter off. That is the actual
     question, it does not care how the markup was produced, and it cannot be
     satisfied by a string in a comment. */
  const gone = FIX.operable_ids.filter(id => !foundIds.has(id));
  ok(gone.length === 0,
     `all ${FIX.operable_ids.length} operable ids the three surfaces create still exist`,
     gone.join(', '));
}

section('The baseline itself cannot be quietly trimmed');
{
  /* Without this, the cheapest way to make the check above pass is to delete the
     line that fails it. Lowering these counts is then a deliberate edit that
     shows up in the diff beside whatever was removed. */
  ok(FIX.rendered.length >= FIX.expected_rendered_count,
     'the rendered baseline has not shrunk',
     `${FIX.rendered.length} vs ${FIX.expected_rendered_count}`);
  ok(FIX.operable_ids.length >= FIX.expected_operable_id_count,
     'and neither has the operable-id baseline',
     `${FIX.operable_ids.length} vs ${FIX.expected_operable_id_count}`);
}

section('Every route into a Build surface goes through the one door (AMV-D007 step 2)');
{
  /* The seam, checked at the router rather than by trusting the comment above
     it. If a fourth `case` ever calls a build renderer directly, the merge has
     a second entry point and the steps after this one stop being one change. */
  const src = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const router = /function renderView\(\)\{[\s\S]*?\n\}/.exec(src);
  ok(router != null, 'the view router was found');
  const body = (router ? router[0] : '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const direct of ['renderDesignView', 'renderCodeView', 'renderLabView']) {
    ok(!body.includes(direct + '()'),
       `the router no longer calls ${direct} directly`, direct);
  }
  ok(body.includes('renderBuildView()'), 'it calls the shared one instead');

  /* And each of the three still lands on its own surface, with the mode the
     route implies. Behaviour-neutral is a claim, so it is measured. */
  for (const [tab, mode, shell] of [['studio','design','.dsn-wrap'], ['dev','code','.dev-shell'], ['lab','lab','.lab-shell']]) {
    const got = await page.evaluate(async ({ t, sel }) => {
      _LAB.code = ''; _DEV.log = []; _DEV.project = {};
      setTab(t);
      await new Promise(s => setTimeout(s, 400));
      return { mode: _buildMode(), shell: !!document.querySelector('#vc ' + sel), tab: S.tab };
    }, { t: tab, sel: shell });
    ok(got.mode === mode, `${tab} resolves to the ${mode} surface`, got.mode);
    ok(got.shell, `${tab} still renders ${shell}`);
    ok(got.tab === tab, `and ${tab} is still a real route name, not a redirect`, got.tab);
  }

  /* Dev hands code to Lab and that crossing is the product already admitting
     these are one job. It has to survive every step of the merge. */
  const handoff = await page.evaluate(async () => {
    _DEV.log = [{ role: 'sys', text: 'x' }];
    _devSetFile('a.js', 'console.log(1)', 'js');
    setTab('dev');
    await new Promise(s => setTimeout(s, 400));
    /* Null-guarded on purpose. Reaching straight through to .click() turns a
       MISSING control - exactly what this suite exists to detect - into an
       uncaught TypeError that kills the run before it reports anything. A guard
       that crashes instead of failing tells you less than no guard at all,
       because the gate shows a stack trace where it should be naming a button.
       Found by sabotaging the router and getting no report. */
    const btn = document.getElementById('dev-tolab');
    if (!btn) return { missing: true, tab: S.tab, code: '' };
    btn.click();
    await new Promise(s => setTimeout(s, 500));
    return { missing: false, tab: S.tab, code: (document.getElementById('lab-code') || {}).value || '' };
  });
  ok(!handoff.missing, 'the Dev-to-Lab control is on the Dev surface', handoff);
  ok(handoff.tab === 'lab', 'Dev still hands off to Lab', handoff.tab);
  ok(handoff.code.includes('console.log(1)'), 'carrying the code with it', handoff.code);
}

section('One toolbar definition, not two that drift (AMV-D007 step 3)');
{
  /* Dev and Lab each had their own toolbar and they had drifted the way two
     copies of anything drift: the same job wore a paperclip on one and an
     upload tray on the other, and Deploy was written twice. One definition now,
     parameterised by mode.

     Checked at the source, because "there is one toolbar on screen" is true of
     the old code too - each surface only ever rendered its own. The question is
     whether there is one DEFINITION. */
  const src = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const builders = (src.match(/function _buildBarHTML\(/g) || []).length;
  ok(builders === 1, 'the toolbar is built in exactly one place', builders);
  const literalBars = (src.match(/class="(?:dev|lab)-bar"/g) || []).length;
  ok(literalBars === 0,
     'and no surface still spells a toolbar out by hand',
     literalBars + ' literal bar(s) left in the bundle');

  /* Both surfaces must reach it, or "one definition" just means one of them
     lost its toolbar. */
  for (const [tab, sel] of [['dev', '.dev-bar'], ['lab', '.lab-bar']]) {
    const bar = await page.evaluate(async ({ t, q }) => {
      setTab(t);
      await new Promise(s => setTimeout(s, 400));
      const b = document.querySelector('#vc ' + q);
      if (!b) return { present: false };
      const btns = [...b.querySelectorAll('button')];
      const derived = btns.filter(x => {
        const name = (x.getAttribute('aria-label') || '').trim();
        return x.id && name && name === x.id.replace(/[-_]/g, ' ');
      }).map(x => x.id + ' -> "' + x.getAttribute('aria-label') + '"');
      return { present: true, shared: b.classList.contains('build-bar'), buttons: btns.length,
               derivedNames: derived };
    }, { t: tab, q: sel });
    ok(bar.present, `${tab} still has a toolbar`);
    ok(bar.shared, `and ${tab}'s comes from the shared builder`, bar);
    ok(bar.buttons > 0, `with controls in it`, bar.buttons);
    /* "Has an accessible name" is not worth asserting here and the first version
       of this check did assert it, uselessly. _initA11y labels every icon-only
       button from its title at boot, so the name is always present by the time
       anything can measure it - the check passed with the labels deliberately
       stripped out of the markup, which is how it was caught.
       
       What CAN go wrong is the name being derived rather than written. When a
       control has no title, _initA11y falls back to the id with its dashes
       swapped for spaces, and a screen reader then announces "lab upload top".
       That is the failure worth catching, so that is what is checked. */
    ok(bar.derivedNames.length === 0,
       `and no control on ${tab} is announced as its own id`,
       bar.derivedNames.join(', '));
  }
}

section('The outcome can be chosen from any Build surface (AMV-D007 step 4)');
{
  /* CLICKED, not measured. The first version of this switch sat inside Lab's
     scrolling entry region, and on a 390px phone the toolbar wraps to 164px -
     so the first button rendered at the right size, in the right place, with
     the right label, BEHIND the bar. elementFromPoint returned .lab-bar.
     Anything that only measured it would have called it fine. It is above each
     surface's own toolbar now. */
  /* The DNA walk above leaves its panel open, and a modal is SUPPOSED to block
     the page under it - the first run of this section failed with the overlay
     intercepting every click, which was the check working and the starting
     state being wrong. Closed explicitly rather than by hoping section order
     never changes. */
  await page.evaluate(() => { try { closeDNA(); } catch (e) {} const o = document.getElementById('ovr'); if (o) o.innerHTML = ''; });
  await page.waitForTimeout(250);

  for (const [w, h] of [[1280, 860], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => { _LAB.code = ''; _DEV.log = []; _DEV.project = {}; setTab('studio'); });
    await page.waitForSelector('#vc [data-bmode]', { timeout: 15000 });

    const seen = await page.evaluate(() => document.querySelectorAll('#vc .build-mode').length);
    ok(seen === 3, `at ${w}x${h} all three outcomes are offered`, seen);

    /* Every one of them, from every surface, by clicking it. */
    for (const target of ['dev', 'lab', 'studio']) {
      const covered = await page.evaluate((t) => {
        const b = document.querySelector('#vc [data-bmode="' + t + '"]');
        if (!b) return 'missing';
        const r = b.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return (top && (top === b || b.contains(top))) ? null
          : 'covered by ' + ((top && (top.className || top.tagName)) || 'nothing').toString().slice(0, 30);
      }, target);
      ok(covered === null, `at ${w}x${h} the ${target} choice is not covered by anything`, covered);

      await page.click(`#vc [data-bmode="${target}"]`, { timeout: 15000 });
      await page.waitForTimeout(450);
      const now = await page.evaluate(() => {
        const on = document.querySelector('#vc .build-mode.on');
        return { tab: S.tab, active: on ? on.dataset.bmode : null,
                 selected: [...document.querySelectorAll('#vc .build-mode')]
                   .filter(b => b.getAttribute('aria-selected') === 'true').length };
      });
      ok(now.tab === target, `at ${w}x${h} choosing ${target} really goes there`, now.tab);
      ok(now.active === target, `and the switch shows ${target} as current`, now.active);
      ok(now.selected === 1, 'with exactly one marked selected for a screen reader', now.selected);
    }
  }
  await page.setViewportSize({ width: 1280, height: 860 });

  /* It is for starting, not for interrupting: once there is work in progress the
     screen belongs to the work. */
  const whenBusy = await page.evaluate(async () => {
    _LAB.code = 'console.log(1)'; setTab('lab'); renderLabView();
    await new Promise(s => setTimeout(s, 400));
    const m = document.querySelector('#vc .build-mode');
    return m ? getComputedStyle(m.parentElement).display : 'absent';
  });
  ok(whenBusy === 'none' || whenBusy === 'absent',
     'and it steps out of the way once there is work on the surface', whenBusy);
}

section('Reading your own code does not depend on a popup (AMV-D007 step 5)');
{
  /* Studio's "View code" opened a new window and wrote the markup into it.
     window.open returns null when popups are blocked - the default in several
     browsers and common on phones - and the guarded call then did nothing at
     all: no window, no toast, no error, nothing on screen. Measured both ways
     before it was changed; popups allowed opened a tab, popups blocked opened
     none and reported nothing.

     window.open is stubbed to null here, which is exactly what a blocker does.
     A check that only runs with popups working would never have seen this. */
  const out = await page.evaluate(async () => {
    const realOpen = window.open;
    window.open = () => null;
    try {
      setTab('studio');
      _studioNewArtifact('T', 'page', 'brief');
      _studioSetHTML('<h1>the markup they asked to read</h1>', 'brief');
      _studioShowCanvas('brief');
      await new Promise(s => setTimeout(s, 400));
      const btn = document.getElementById('studio-code');
      if (!btn) return { missing: true };
      const vis = (e) => !!e && getComputedStyle(e).display !== 'none';
      btn.click();
      await new Promise(s => setTimeout(s, 300));
      const shown = {
        codeVisible: vis(document.getElementById('studio-code-body')),
        text: (document.getElementById('studio-code-text') || {}).textContent || '',
        label: btn.textContent.trim(),
      };
      btn.click();
      await new Promise(s => setTimeout(s, 300));
      const back = {
        codeHidden: !vis(document.getElementById('studio-code-body')),
        previewVisible: vis(document.getElementById('studio-stage-inner')),
        label: btn.textContent.trim(),
      };
      return { missing: false, shown, back };
    } finally { window.open = realOpen; }
  });
  ok(!out.missing, 'the View code control is on the canvas');
  ok(out.shown.codeVisible, 'with popups blocked, the code is still shown', out.shown);
  ok(out.shown.text.includes('the markup they asked to read'),
     'and it is the design\'s own markup', out.shown.text.slice(0, 50));
  ok(/preview/i.test(out.shown.label), 'the control then offers the way back', out.shown.label);
  ok(out.back.codeHidden && out.back.previewVisible, 'and really goes back', out.back);
  ok(/code/i.test(out.back.label), 'with its original label', out.back.label);
}

ok(errors.length === 0, 'no console errors while opening every Build state', errors.slice(0, 3));
await app.close();
if (report('the-build-surfaces-keep-every-control') > 0) process.exitCode = 1;
done();
