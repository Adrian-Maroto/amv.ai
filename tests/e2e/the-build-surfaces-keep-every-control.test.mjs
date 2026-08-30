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

/* studio/dev/lab are what the buttons are called; design/code/lab are the
   modes they select. Same map the product uses, named here so the assertion
   does not restate it wrongly. */
const BUILD_SURFACES_T = { studio: 'design', dev: 'code', lab: 'lab' };

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
    /* It settles on `build` on purpose. The three are sections of one surface
       now, and leaving S.tab as `studio` would mean the sidebar - which has a
       single Build entry - could not show where you are. The property this
       line exists for is that the old name still WORKS rather than 404s, and
       the two assertions above are what prove it: it resolves to the right
       mode and renders that surface's shell. */
    ok(got.tab === 'build', `and ${tab} still routes somewhere real`, got.tab);
  }

  /* Dev hands code to Lab and that crossing is the product already admitting
     these are one job. It has to survive every step of the merge. */
  const handoff = await page.evaluate(async () => {
    /* Arrive first, THEN put a file in it. The earlier viewport sweep clears
       _DEV.project between runs, and seeding before navigating left this
       depending on whether the trip to Dev preserved it - so the failure read
       as "the handoff lost the code" when the code had never made it onto the
       surface. This is also the real sequence: you build something while you
       are on Dev, then send it to Lab. */
    setTab('dev');
    await new Promise(s => setTimeout(s, 400));
    _DEV.log = [{ role: 'sys', text: 'x' }];
    _devSetFile('a.js', 'console.log(1)', 'js');
    await new Promise(s => setTimeout(s, 120));
    /* Null-guarded on purpose. Reaching straight through to .click() turns a
       MISSING control - exactly what this suite exists to detect - into an
       uncaught TypeError that kills the run before it reports anything. A guard
       that crashes instead of failing tells you less than no guard at all,
       because the gate shows a stack trace where it should be naming a button.
       Found by sabotaging the router and getting no report. */
    const btn = document.getElementById('dev-tolab');
    if (!btn) return { missing: true, tab: S.tab, code: '' };
    btn.click();
    /* Waited for rather than slept past. The handoff lands when the Lab
       surface renders and reads _LAB_HANDOFF, and a fixed 500ms was just
       enough until Build gained a state settle before its render - at which
       point this failed reporting an empty editor, which reads exactly like
       the code being lost rather than like the test being early. */
    const stop = Date.now() + 8000;
    while(Date.now() < stop){
      const el = document.getElementById('lab-code');
      if(el && el.value) break;
      await new Promise(s => setTimeout(s, 40));
    }
    /* Reported rather than inferred. When this failed it said only "the code
       is empty", which is true of a lost handoff AND of a Dev surface that
       never had the file - two very different bugs wearing one message. */
    return { missing: false, tab: S.tab, mode: _buildMode(),
             activePath: _DEV.activePath,
             files: Object.keys(_DEV.project || {}),
             curCode: String(_DEV.curCode || '').slice(0, 20),
             code: (document.getElementById('lab-code') || {}).value || '' };
  });
  ok(!handoff.missing, 'the Dev-to-Lab control is on the Dev surface', handoff);
  ok(handoff.tab === 'build' && handoff.mode === 'lab',
     'Dev still hands off to Lab', handoff);
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
        return { tab: S.tab, mode: _buildMode(), active: on ? on.dataset.bmode : null,
                 selected: [...document.querySelectorAll('#vc .build-mode')]
                   .filter(b => b.getAttribute('aria-selected') === 'true').length };
      });
      /* The three are sections of one Build surface, so choosing one changes
         the MODE and stays on Build - which is what keeps the single sidebar
         entry showing where you are. `active` below already checks the button
         lit up; this checks the surface actually followed it. */
      ok(now.tab === 'build' && now.mode === (BUILD_SURFACES_T[target] || target),
         `at ${w}x${h} choosing ${target} really goes there`, now);
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

section('Reading your own code does not depend on a popup (AMV-D007 step 5)')
{
  /* Studio used to open a NEW BROWSER WINDOW and write the markup into it.
     `window.open` returns null when popups are blocked - the default in several
     browsers and common on phones - and the guarded call then did nothing at
     all: no window, no toast, no error, nothing on screen.

     It shows the code in the surface now. Since step 5 that is a TAB in the
     shared bar rather than a button in the side panel that renamed itself
     between "View code" and "View preview" - a label describing where you are
     going, next to a title describing where you are. Two tabs say it once, and
     Dev keeps its in the same place, so the control does not move when you
     move surface.

     What is asserted is the intent, which did not change: the code is reachable
     without a popup, it is really the design's own markup, and you can get
     back. Only the mechanism moved. */
  const r = await page.evaluate(async () => {
    setTab('studio');
    _studioNewArtifact('T', 'page', 'b');
    _studioSetHTML('<h1>the real markup</h1>', 'b');
    _studioShowCanvas('b');
    await new Promise(s => setTimeout(s, 400));
    const realOpen = window.open;
    window.open = () => null;                       // popups blocked

    const bar  = document.getElementById('studio-rb');
    const code = document.getElementById('studio-code');
    const prev = document.getElementById('studio-frame-t');
    if (!bar || !code || !prev) { window.open = realOpen; return { missing: true }; }

    const inBar = bar.contains(code) && bar.contains(prev);
    code.click();
    await new Promise(s => setTimeout(s, 350));
    const body = document.getElementById('studio-code-body');
    const stage = document.getElementById('studio-stage-inner');
    const shown = {
      codeVisible: !!body && body.style.display !== 'none',
      text: (document.getElementById('studio-code-text') || {}).textContent || '',
      codeSelected: code.getAttribute('aria-selected') === 'true',
      prevSelected: prev.getAttribute('aria-selected') === 'true',
    };

    prev.click();
    await new Promise(s => setTimeout(s, 350));
    const back = {
      codeHidden: !!body && body.style.display === 'none',
      previewVisible: !!stage && stage.style.display !== 'none',
      prevSelected: prev.getAttribute('aria-selected') === 'true',
      codeSelected: code.getAttribute('aria-selected') === 'true',
    };
    window.open = realOpen;
    return { inBar, shown, back };
  });

  ok(!r.missing, 'the bar carries both a Preview and a Code tab', !r.missing);
  ok(r.inBar, 'and they live in the bar, not in a side panel', r.inBar);
  ok(r.shown.codeVisible, 'with popups blocked, the code is still shown', r.shown.codeVisible);
  ok(/the real markup/.test(r.shown.text), 'and it is the design s own markup', r.shown.text.slice(0, 60));
  ok(r.shown.codeSelected && !r.shown.prevSelected,
     'the bar says which one you are on, to a screen reader too',
     'code=' + r.shown.codeSelected + ' preview=' + r.shown.prevSelected);
  ok(r.back.codeHidden && r.back.previewVisible, 'and Preview really goes back', JSON.stringify(r.back));
  ok(r.back.prevSelected && !r.back.codeSelected, 'with the selection following', JSON.stringify(r.back));
}

section('A phone can give the result the whole screen on every Build surface (AMV-D007 step 5)');
{
  /* Dev and Lab both had a mobile pane toggle. Studio - the one surface whose
     entire purpose IS the preview - did not: measured at 390x844, its side
     panel took 575px of the screen and the live canvas got 190px.

     Two things had to be right and only the first is obvious. The toggle is
     mounted by setTab, and at that moment Studio still shows its hero, because
     the canvas only exists after a design is created on a model call seconds
     later - so it found no `.studio-canvas` and silently did nothing. And
     hiding the side pane is not the same as giving the stage the room: the
     canvas is height:auto on mobile, so the stage's height:100% referred to
     nothing and it stayed at 190px with the side gone. That version looks fixed
     if you check the side panel and is not fixed at all, which is why this
     measures the STAGE. */
  await page.setViewportSize({ width: 390, height: 844 });
  const phone = await page.evaluate(async () => {
    setTab('studio');
    _studioNewArtifact('T', 'page', 'brief');
    _studioSetHTML('<h1>hi</h1>', 'brief');
    _studioShowCanvas('brief');
    await new Promise(s => setTimeout(s, 500));
    const h = (q) => { const e = document.querySelector(q); return e ? Math.round(e.getBoundingClientRect().height) : 0; };
    const t = document.querySelector('.mv-toggle');
    if (!t) return { toggle: false };
    const before = h('.studio-stage');
    t.querySelector('[data-mv="out"]').click();
    await new Promise(s => setTimeout(s, 400));
    const showing = { stage: h('.studio-stage'), sideHidden: getComputedStyle(document.querySelector('.studio-side')).display === 'none' };
    t.querySelector('[data-mv="in"]').click();
    await new Promise(s => setTimeout(s, 400));
    return { toggle: true, labels: [...t.querySelectorAll('button')].map(b => b.textContent.trim()),
             before, showing, back: h('.studio-stage'), vh: window.innerHeight };
  });
  ok(phone.toggle, 'Studio has the same pane toggle as Dev and Lab on a phone');
  ok((phone.labels || []).length === 2, 'with two panes to choose between', phone.labels);
  ok(phone.showing.sideHidden, 'choosing the preview puts the side panel away');
  ok(phone.showing.stage > phone.before * 2,
     'and the canvas actually grows, rather than the side just vanishing',
     `${phone.before}px -> ${phone.showing.stage}px`);
  ok(phone.showing.stage > phone.vh * 0.6,
     'to most of the screen', `${phone.showing.stage} of ${phone.vh}`);
  ok(phone.back === phone.before, 'and going back restores the design pane', `${phone.back} vs ${phone.before}`);

  /* Desktop has both panes side by side and must not grow a toggle. */
  await page.setViewportSize({ width: 1280, height: 860 });
  const desk = await page.evaluate(async () => {
    setTab('studio'); _studioShowCanvas('brief');
    await new Promise(s => setTimeout(s, 400));
    const t = document.querySelector('.mv-toggle');
    return { present: !!t, shown: t ? getComputedStyle(t).display !== 'none' : false,
             sideVisible: getComputedStyle(document.querySelector('.studio-side')).display !== 'none' };
  });
  ok(!desk.shown, 'and on a desktop the toggle stays out of the way', desk);
  ok(desk.sideVisible, 'where both panes fit side by side anyway');
}

section('Checking a result at phone width works, on both surfaces (AMV-D007 step 5)');
{
  /* Studio could check a design at tablet and phone width and Dev could not, so
     the same question got a different answer depending on which surface you
     were on. One component and one handler now.

     And Studio's had never actually worked. The inline style was applied
     correctly - phone really did set width:390px - and the frame stayed at full
     width, because `.studio-frame` carries `flex:1`. In a flex row the basis
     decides the main size and `width` is not consulted. The buttons
     highlighted, the transition ran on nothing, and the preview never moved.
     Confirmed pre-existing by rebuilding the previous commit.

     So this measures the RENDERED WIDTH. A check on the inline style would have
     passed against the broken version, which is exactly how it survived. */
  /* WIDE ENOUGH THAT THE CLAIM CAN ACTUALLY BE TRUE.

     This ran at 1280 and asserted the tablet preset sits between phone and the
     full pane. At 1280 with the sidebar showing, the pane is 730px - narrower
     than the 768px tablet preset - so the claim is arithmetically impossible
     and the switcher is not at fault. It passed anyway, because an earlier
     section in this file leaves the viewport at a phone width, the sidebar
     collapses, and it used to STAY collapsed on the way back to desktop. The
     assertion was riding on a bug: with the sidebar gone the pane was wide
     enough, and the moment the sidebar started being restored properly the
     check failed on a product that had not changed.

     Measured on both trees to be sure: in isolation this section reports
     390 / 768 / 730 identically before and after the sidebar fix.

     So the viewport is now wide enough for the three presets to be genuinely
     distinguishable, and the assertion below keeps its full strength rather
     than being loosened to fit. A tablet preset wider than the pane still
     scrolls inside it, which is what a device preview should do - it is not
     clamped, because a "Tablet" button that quietly shows 730px is lying. */
  await page.setViewportSize({ width: 1600, height: 900 });
  const studio = await page.evaluate(async () => {
    setTab('studio');
    _studioNewArtifact('T', 'page', 'b'); _studioSetHTML('<h1>hi</h1>', 'b');
    _studioShowCanvas('b');
    await new Promise(s => setTimeout(s, 500));
    const w = () => Math.round(document.getElementById('studio-frame').getBoundingClientRect().width);
    const out = { full: w() };
    for (const vp of ['phone', 'tablet', 'desktop']) {
      document.querySelector('#studio-vp [data-vp="' + vp + '"]').click();
      await new Promise(s => setTimeout(s, 250));
      out[vp] = w();
    }
    return out;
  });
  ok(studio.phone < studio.full * 0.6,
     'Studio really narrows the canvas to phone width', `${studio.full} -> ${studio.phone}`);
  ok(studio.tablet > studio.phone && studio.tablet < studio.full,
     'and tablet sits between the two', `${studio.phone} / ${studio.tablet} / ${studio.full}`);
  ok(studio.desktop === studio.full, 'and desktop gives it the pane back', studio.desktop);

  const dev = await page.evaluate(async () => {
    _DEV.log = [{ role: 'sys', text: 'x' }];
    _devSetFile('index.html', '<h1>hi</h1>', 'html');
    setTab('dev');
    await new Promise(s => setTimeout(s, 400));
    _devShowResult('<h1>hi</h1>', 'html', { html: '<h1>hi</h1>' });
    await new Promise(s => setTimeout(s, 300));
    const w = () => { const e = document.querySelector('#dev-prev-body .dev-prev-frame'); return e ? Math.round(e.getBoundingClientRect().width) : null; };
    const out = { switcher: !!document.getElementById('dev-vp'), full: w() };
    document.querySelector('#dev-vp [data-vp="phone"]').click();
    await new Promise(s => setTimeout(s, 250));
    out.phone = w();
    /* Dev replaces its iframe on every build. A handler that captured the
       element at wiring time would drive a frame that no longer exists. */
    _devShowResult('<h1>again</h1>', 'html', { html: '<h1>again</h1>' });
    await new Promise(s => setTimeout(s, 300));
    document.querySelector('#dev-vp [data-vp="phone"]').click();
    await new Promise(s => setTimeout(s, 250));
    out.phoneAfterRebuild = w();
    return out;
  });
  ok(dev.switcher, 'Dev has the same switcher Studio does');
  ok(dev.phone < dev.full * 0.7, 'and it narrows its preview too', `${dev.full} -> ${dev.phone}`);
  /* Both halves, and the second is the one that matters. "same as before"
     is true when the switcher does nothing at all - a captured element is null
     at wiring time, every click returns early, and both measurements are the
     full width and therefore equal. That version passed this check until the
     narrowness was asserted alongside it. */
  ok(dev.phoneAfterRebuild < dev.full * 0.7 && dev.phoneAfterRebuild === dev.phone,
     'still driving the right frame after a rebuild replaces it',
     `${dev.phoneAfterRebuild} (phone was ${dev.phone}, full ${dev.full})`);
}

section('Every control on a Build surface actually does something');
{
  /* Four controls on these surfaces were found this session to be present,
     correct, and inert: Lab's entry buttons died to a blur handler, the mode
     switch sat behind a phone toolbar, View code vanished into a popup blocker,
     and Studio's viewport switcher was defeated by a flex basis. All four
     looked right in the markup. Three were found by accident while doing other
     work, which is not a method.

     So this clicks everything and asks whether ANYTHING observable changed -
     the view, an overlay, a toast, the tab. It is deliberately a low bar: it
     cannot tell right behaviour from wrong, only doing something from doing
     nothing, and doing nothing silently is the failure that keeps recurring.

     Inputs are fed first. "Does nothing when its box is empty" is not a defect;
     "does nothing when you have given it what it needs" is, and that is the
     path a person is actually on. */
  const SKIP = ['studio-back', 'dev-new', 'lab-new', 'studio-export', 'studio-download',
                'dev-download-proj', 'dev-deploy', 'lab-deploy', 'dev-open-ext', 'dev-tolab'];
  const FEEDS = { 'studio-refine-go': 'studio-refine', 'dev-send': 'dev-msg',
                  'lab-ask-go': 'lab-ask', 'lab-run': 'lab-code', 'lab-debug': 'lab-code' };
  /* Forwards a click to a hidden <input type=file>, which opens a picker the
     page cannot observe. Named rather than silently tolerated. */
  const OPENS_A_FILE_PICKER = ['lab-upload-top', 'dev-add', 'dev-hero-add'];

  const setups = {
    'Studio canvas': `()=>{ setTab('studio'); _studioNewArtifact('T','page','b');
        _studioSetHTML('<h1>hi</h1>','b'); _studioShowCanvas('b'); }`,
    'Dev working': `()=>{ _DEV.log=[{role:'sys',text:'x'}]; _devSetFile('index.html','<h1>hi</h1>','html');
        setTab('dev'); _devShowResult('<h1>hi</h1>','html',{html:'<h1>hi</h1>'}); }`,
    'Lab loaded': `()=>{ _LAB.code='console.log(1)'; setTab('lab'); renderLabView(); }`,
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [label, setupSrc] of Object.entries(setups)) {
    const dead = await page.evaluate(async ({ setupSrc, SKIP, FEEDS, PICKERS }) => {
      const run = new Function('return (' + setupSrc + ')')();
      const sig = () => {
        const vc = document.getElementById('vc'), ovr = document.getElementById('ovr');
        return JSON.stringify({ tab: S.tab, len: vc ? vc.innerHTML.length : 0,
          ovr: ovr ? ovr.innerHTML.length : 0,
          toasts: document.querySelectorAll('#toast-wrap > *').length,
          cls: vc && vc.firstElementChild ? vc.firstElementChild.className : '' });
      };
      const nameOf = (b) => (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24)
        || b.getAttribute('aria-label') || b.getAttribute('title') || '';
      const visible = () => [...document.querySelectorAll('#vc button')]
        .filter(b => { const r = b.getBoundingClientRect(); return r.width > 1 && r.height > 1; });
      run(); await new Promise(s => setTimeout(s, 500));
      const wanted = visible().map(b => ({ id: b.id, label: nameOf(b) }));
      const out = [];
      for (const c of wanted) {
        if (c.id && (SKIP.includes(c.id) || PICKERS.includes(c.id))) continue;
        /* A tab that is ALREADY selected is correctly a no-op when clicked -
           it is showing its panel and there is nowhere to go. Flagging that
           would report correct behaviour as a defect, and a sweep that cries
           wolf is a sweep people learn to skim. The pair is still proven live:
           the unselected sibling is swept like any other control, and the
           dedicated section below drives both directions and back. */
        {
          const pre = c.id ? document.getElementById(c.id) : null;
          if (pre && pre.getAttribute('role') === 'tab'
                  && pre.getAttribute('aria-selected') === 'true') continue;
        }
        run(); await new Promise(s => setTimeout(s, 320));
        const el = c.id ? document.getElementById(c.id) : visible().find(b => nameOf(b) === c.label);
        if (!el) continue;
        const feed = FEEDS[c.id];
        if (feed) { const t = document.getElementById(feed);
          if (t) { t.value = 'make the heading bigger'; t.dispatchEvent(new Event('input')); } }
        await new Promise(s => setTimeout(s, 120));
        const before = sig();
        try { el.click(); } catch (e) { out.push((c.id || c.label) + ' threw ' + e.message); continue; }
        await new Promise(s => setTimeout(s, 450));
        if (sig() === before) out.push(c.id || '"' + c.label + '"');
      }
      return out;
    }, { setupSrc, SKIP, FEEDS, PICKERS: OPENS_A_FILE_PICKER });
    ok(dead.length === 0, `on ${label}, no control does nothing at all`, dead.join(', '));
  }
}

section('Handing somebody a file works the same way everywhere (AMV-D007)');
{
  /* Fourteen copies of the same four-line blob-download dance existed and had
     drifted: three appended the anchor to the document before clicking, the
     rest clicked a detached one. Studio appended; Dev did not.

     No failure was REPRODUCED - a detached anchor downloads fine in Chromium,
     which is the only engine testable here - so this is alignment on the safer
     of two behaviours rather than a verified bug fix, and the Build surfaces
     now share one helper.

     What is testable, and is what this checks, is that each download still
     really fires. A refactor of file-saving that quietly stopped saving files
     would be a poor trade for tidiness. */
  const fired = [];
  const onDownload = (d) => fired.push(d.suggestedFilename());
  page.on('download', onDownload);

  await page.evaluate(async () => {
    setTab('studio');
    _studioNewArtifact('My Design', 'page', 'b');
    _studioSetHTML('<h1>design</h1>', 'b');
    _studioShowCanvas('b');
    await new Promise(s => setTimeout(s, 400));
    document.getElementById('studio-download').click();
  });
  await page.waitForTimeout(700);

  await page.evaluate(async () => {
    _DEV.log = [{ role: 'sys', text: 'x' }]; _DEV.project = {};
    _devSetFile('index.html', '<h1>one</h1>', 'html');
    setTab('dev'); renderCodeView();
    await new Promise(s => setTimeout(s, 400));
    document.getElementById('dev-download-proj').click();
  });
  await page.waitForTimeout(700);

  await page.evaluate(async () => {
    _devSetFile('a.js', '1', 'js'); _devSetFile('b.css', 'x{}', 'css');
    renderCodeView();
    await new Promise(s => setTimeout(s, 400));
    document.getElementById('dev-download-proj').click();
  });
  await page.waitForTimeout(700);
  page.off('download', onDownload);

  ok(fired.length === 3, 'all three Build downloads actually produce a file', fired.join(', '));
  ok(fired.some(f => /\.html$/.test(f)), 'the design comes back as a page', fired.join(', '));
  ok(fired.some(f => f === 'amv-project.txt'), 'and a multi-file project as a bundle', fired.join(', '));

  /* One helper, not fourteen - checked at the source, since "a file downloaded"
     is equally true of the copies. */
  const src = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const helpers = (src.match(/function amvDownload\(/g) || []).length;
  ok(helpers === 1, 'and there is exactly one download helper to keep correct', helpers);
}

ok(errors.length === 0, 'no console errors while opening every Build state', errors.slice(0, 3));
await app.close();
if (report('the-build-surfaces-keep-every-control') > 0) process.exitCode = 1;
done();
