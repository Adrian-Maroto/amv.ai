/* WHAT A SCREEN OWES SOMEBODY WHO HAS JUST ARRIVED ON IT.

   Six findings from the design audit, all small, all about the same thing: a
   surface should say where you are, offer the thing you came to do, and give
   its controls the weight their importance deserves. Each check below is
   anchored to a measurement taken on the built page before anything changed,
   so a later edit that quietly undoes one fails here rather than in a review
   six weeks from now.

     AMV-D021  the landing proof strip read "Delegatewhole jobs" to the only
               reader it has
     AMV-D024  Crew opened with an emergency brake for a machine nobody started
     AMV-D034  the model picker priced its options instead of describing them
     AMV-D056  Help was twenty questions in one undifferentiated list
     AMV-D059  three cookie buttons of equal weight for one real choice
     AMV-D070  Images and Video were the only two tabs with no heading at all
*/
import { readFileSync } from 'fs';
import { bootApp, APP } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

/* ────────────────────────────────────────────────────────────────────────
   AMV-D021 - read from the SOURCE, because this block never paints.

   #land is display:none on every path (the funnel goes straight to chat) and
   is kept only so a crawler has something to read. So a browser-rendered check
   would measure nothing, and the defect lives exactly where a rendered check
   cannot see it: adjacent tags with no source whitespace, which textContent
   joins into one word.
   ──────────────────────────────────────────────────────────────────────── */
section('The one text the landing block exists to provide reads as written (AMV-D021)');
{
  const html = readFileSync(APP, 'utf8');
  /* End the slice at the app shell, not at </body> - the built page carries the
     whole minified bundle before the closing tag, and every template string in
     it looks like glued markup to the check below. Scoping this wrong is how a
     source check ends up measuring the compiler's output. */
  const from = html.indexOf('<div id="land">');
  const to = html.indexOf('<div id="app"', from);
  const land = html.slice(from, to > from ? to : html.indexOf('</body>'));
  ok(land.length > 500, 'the landing block is still in the page for crawlers to read', land.length);

  const glued = land.match(/<\/(b|strong|span|em)><(b|strong|span|em)[ >]/g) || [];
  ok(glued.length === 0,
     'no two inline elements sit against each other with no whitespace between',
     glued.slice(0, 4));

  for (const want of ['Delegate whole jobs', 'Build apps', 'Run work on a schedule', '$0 to start']) {
    const flat = land.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    ok(flat.includes(want), `"${want}" extracts as a readable phrase`);
  }
}

/* ──────────────────────────────────────────────────────────────────────── */
section('Crew leads with the way in, and with the brake only when it is needed (AMV-D024)');
{
  /* Wait for the control under test to exist, not for a number of
      milliseconds. Crew kicks off a background refresh that can re-render, so a
      fixed delay here is a bet on which render you read. */
  const head = async () => {
    await page.evaluate(() => setTab('crew'));
    await page.waitForSelector('.mc-head-r button', { timeout: 15000 }).catch(() => {});
    return page.evaluate(() => {
      const b = document.querySelector('.mc-head-r button');
      return b ? { cls: b.className, act: b.dataset.dact, txt: b.textContent.trim() } : null;
    });
  };

  /* Crew is gated on a plan. Without this the tab renders the upsell catalogue
     instead of Mission Control - which is how an earlier pass read "no pause
     button" as a pass when the header was not on screen at all. */
  await page.evaluate(() => { saveStr('amv_plan', 'pro'); saveStr('amv_autonomy_paused', '0'); _saveSched([]); });
  const idle = await head();
  ok(!!idle, 'Mission Control renders for a plan that includes Crew', idle);
  ok(idle.cls.includes('mc-browse'), 'with nothing running, the header offers a way to start work', idle.cls);
  ok(idle.act === 'openCowork', 'and it points at the thing that creates one', idle.act);
  ok(!/pause/i.test(idle.txt), 'no pause control for work that is not happening', idle.txt);

  await page.evaluate(() => _saveSched([{ id: 'g1', title: 'Brief', prompt: 'x', every: 'day', active: true, next: Date.now() + 9e6 }]));
  const busy = await head();
  ok(/pause/i.test(busy.txt), 'a job running brings the pause control back', busy.txt);
  ok(busy.act === 'pauseAllAutonomous', 'and it is the real one', busy.act);

  await page.evaluate(() => { _saveSched([]); saveStr('amv_autonomy_paused', '1'); });
  const paused = await head();
  ok(/resume/i.test(paused.txt), 'paused autonomy can always be resumed, running job or not', paused.txt);
  ok(paused.act === 'resumeAllAutonomous', 'by the control that resumes it', paused.act);
  await page.evaluate(() => saveStr('amv_autonomy_paused', '0'));
}

/* ──────────────────────────────────────────────────────────────────────── */
section('The model picker describes what you get, not what it costs us (AMV-D034)');
{
  const labels = await page.evaluate(() => Object.keys(MODELS).map(k => _modelOutcomeLabel(k)));
  ok(labels.length > 3, 'every model has an outcome label', labels.length);
  ok(labels.every(l => !/credit|token|cost|\$|\dx/i.test(l)),
     'and none of them prices the model at the point of choosing it', labels);
  ok(new Set(labels).size >= 4, 'the labels actually distinguish the models', [...new Set(labels)]);
}

/* ──────────────────────────────────────────────────────────────────────── */
section('Help can be reached by topic, not only by already knowing the word (AMV-D056)');
{
  await page.evaluate(() => setTab('help'));
  await page.waitForSelector('.hc-group .faq-q', { timeout: 15000 });
  const shape = await page.evaluate(() => ({
    groups: document.querySelectorAll('.hc-group').length,
    chips: document.querySelectorAll('.hc-chip').length,
    items: document.querySelectorAll('.faq-item').length,
    ungrouped: [...document.querySelectorAll('.faq-item')].filter(i => !i.closest('.hc-group')).length,
    aboveFold: [...document.querySelectorAll('.faq-q')].filter(q => q.getBoundingClientRect().bottom <= innerHeight).length,
  }));
  ok(shape.groups >= 6, 'the questions are grouped under real headings', shape.groups);
  ok(shape.ungrouped === 0, 'and every question lives in one of them', shape.ungrouped);
  ok(shape.chips === shape.groups + 1, 'each group is a filter chip, plus All', shape.chips);
  ok(shape.aboveFold >= 5, 'five common topics are visible without scrolling', shape.aboveFold);

  /* The two routes have to compose. A chip and a search box that each hide rows
     on their own is how a filtered list ends up disagreeing with itself. */
  const state = () => page.evaluate(() => ({
    items: [...document.querySelectorAll('.faq-item')].filter(i => !i.hidden).length,
    groups: [...document.querySelectorAll('.hc-group')].filter(g => !g.hidden).length,
    none: !document.getElementById('faq-none').hidden,
  }));
  await page.click('.hc-chip[data-hcc="auto"]');
  const chipped = await state();
  ok(chipped.items > 0 && chipped.items < shape.items, 'a chip narrows the list', chipped.items);
  ok(chipped.groups === 1, 'and hides the headings it emptied', chipped.groups);

  await page.fill('#faq-search', 'stripe');
  const both = await state();
  ok(both.items === 0 && both.none, 'search still applies inside the chosen topic', both);

  await page.click('.hc-chip[data-hcc="all"]');
  const searched = await state();
  ok(searched.items === 1, 'and reaches the answer once the topic is widened', searched.items);
  await page.fill('#faq-search', '');
  ok((await state()).items === shape.items, 'clearing the search brings everything back');
}

/* ──────────────────────────────────────────────────────────────────────── */
section('Images and Video say what they are (AMV-D070)');
{
  for (const tab of ['images', 'video']) {
    await page.evaluate((t) => setTab(t), tab);
    await page.waitForSelector('#vc .pghd h2', { timeout: 15000 }).catch(() => {});
    const h = await page.evaluate((t) => {
      const vc = document.getElementById('vc');
      const head = vc.querySelector('.pghd');
      const title = head && head.querySelector('h2');
      return { hasHeader: !!head, title: title ? title.textContent.trim() : null,
               sub: !!vc.querySelector('.pghd-sub'),
               repeats: [...vc.querySelectorAll('h2,h3')].filter(x => new RegExp('^' + t + '$', 'i').test(x.textContent.trim())).length };
    }, tab);
    ok(h.hasHeader, `${tab} opens with a page header rather than straight into a form`);
    ok((h.title || '').length > 8, `${tab} names the outcome`, h.title);
    ok(h.sub, `${tab} says in one line what happens here`);
    ok(h.repeats === 0, `${tab} does not repeat the sidebar's own label as a heading`, h.repeats);
  }
}

/* ──────────────────────────────────────────────────────────────────────── */
section('The cookie banner is sized like compliance, not like the product (AMV-D059)');
{
  for (const [w, h, maxPct] of [[1440, 900, 10], [390, 844, 17]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => {
      localStorage.removeItem(_scopeKey('amv_cookie_consent'));
      localStorage.removeItem('amv_cookie_consent');
      document.getElementById('cookie-consent-banner')?.remove();
      _initCookieConsent();
    });
    await page.waitForSelector('#cookie-consent-banner', { timeout: 10000 });
    const m = await page.evaluate(() => {
      const b = document.getElementById('cookie-consent-banner');
      const wOf = (id) => document.getElementById(id).getBoundingClientRect().width;
      const text = b.querySelector('.cc-text').textContent.trim();
      return { pct: +(b.getBoundingClientRect().height / innerHeight * 100).toFixed(1),
               manage: wOf('cc-manage'), accept: wOf('cc-accept'),
               manageIsLink: !document.getElementById('cc-manage').classList.contains('btn'),
               manageStillAButton: document.getElementById('cc-manage').tagName === 'BUTTON',
               tap: document.getElementById('cc-manage').getBoundingClientRect().height,
               sentences: (text.match(/[.!?](\s|$)/g) || []).length };
    });
    ok(m.pct <= maxPct, `at ${w}x${h} it takes at most ${maxPct}% of the screen`, m.pct + '%');
    ok(m.manageIsLink, `at ${w}x${h} Manage is not drawn as a button beside the two answers`);
    ok(m.manageStillAButton, `at ${w}x${h} it is still a <button>, so it is still operable by keyboard`);
    ok(m.manage < m.accept, `at ${w}x${h} Manage is narrower than the primary answer`, `${Math.round(m.manage)} vs ${Math.round(m.accept)}`);
    ok(m.tap >= 24, `at ${w}x${h} it is still big enough to hit`, Math.round(m.tap));
    ok(m.sentences <= 1, `at ${w}x${h} the notice is one sentence`, m.sentences);
  }
  await page.setViewportSize({ width: 1280, height: 860 });
}

/* ──────────────────────────────────────────────────────────────────────── */
section('A labelled button that is enabled does something');
{
  /* Memory's "Add Memory" was enabled, sat next to an empty field, and returned
     silently - no focus, no message, nothing anybody could perceive. Found by a
     sweep of 224 controls across 13 tabs; it was the only real one of fourteen
     flagged, and the other thirteen were checked rather than assumed.

     Not fixed by disabling the button when empty: a disabled control is skipped
     by a screen reader's list and explains nothing to anyone. */
  const r = await page.evaluate(async () => {
    setTab('memory');
    await new Promise(s => setTimeout(s, 500));
    const add = document.getElementById('mem-add'), inp = document.getElementById('mem-inp');
    if (!add || !inp) return { missing: true };
    inp.value = '';
    document.querySelectorAll('#toast-wrap > *').forEach(t => t.remove());
    add.click();
    await new Promise(s => setTimeout(s, 350));
    const said = [...document.querySelectorAll('#toast-wrap > *')].map(t => t.textContent).join(' ');
    const focused = document.activeElement === inp;
    inp.value = 'I prefer short answers';
    add.click();
    await new Promise(s => setTimeout(s, 350));
    return { said, focused, saved: (S.memory || []).length > 0, cleared: inp.value === '' };
  });
  ok(!r.missing, 'the memory composer is there', !r.missing);
  ok(r.said.length > 0, 'pressing it on an empty field says something', r.said.slice(0, 60));
  ok(r.focused, 'and puts the cursor where the answer goes', r.focused);
  ok(r.saved, 'while a real memory still saves', r.saved);
  ok(r.cleared, 'and the field is cleared afterwards', r.cleared);
}

section('Lab offers one run action per state, and it is one that works (AMV-D033)');
{
  const enterLab = async () => {
    await page.evaluate(() => { saveStr('amv_plan', 'ultra'); _LAB.code = ''; setTab('lab'); });
    await page.waitForSelector('#lab-entry-acts [data-go]', { timeout: 15000 });
  };
  const visible = (sel) => page.evaluate((q) => [...document.querySelectorAll(q)]
    .filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none'; })
    .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim()), sel);

  await enterLab();
  const emptyRuns = await visible('#lab-run,[data-go="run"]');
  const emptyFixes = await visible('#lab-debug,[data-go="debug"]');
  ok(emptyRuns.length === 1, 'on the entry screen exactly one run action is offered', emptyRuns);
  ok(emptyFixes.length === 1, 'and exactly one fix action', emptyFixes);
  ok(/run it/i.test(emptyRuns[0] || ''), 'the one that survives is the one beside the paste box', emptyRuns[0]);

  await page.evaluate(() => { _LAB.code = 'console.log(1)'; renderLabView(); });
  await page.waitForSelector('#lab-run', { timeout: 15000 });
  const loadedRuns = await visible('#lab-run,[data-go="run"]');
  ok(loadedRuns.length === 1, 'with code loaded there is still exactly one', loadedRuns);
  ok(!/run it/i.test(loadedRuns[0] || ''), 'and now it is the toolbar one, next to the editor', loadedRuns[0]);

  /* THE HALF THAT MATTERS MOST.

     Before this was fixed, every entry button was dead whenever the paste box
     had focus - which is the state somebody is in the instant after pasting.
     Blur fired before click, loaded the code, dropped `lab-blank`, and the
     entry screen vanished from under the pointer between mousedown and mouseup.
     Nothing threw and nothing logged; the code simply appeared in the editor
     and no run started. A check that only counts buttons would have called that
     screen fixed. */
  await enterLab();
  await page.fill('#lab-paste', 'console.log("the entry button really runs")');
  await page.click('[data-go="run"]');
  /* WAIT FOR AN OUTCOME, NOT FOR ANY TEXT AT ALL.

     This waited for the status line to become non-empty, which _labRun sets to
     "Running…" as its first act - so the wait returned while the run was still
     going and the assertion read the progress message. It passed on a fast
     machine and failed on CI, which is the same proxy-instead-of-the-rule
     mistake this suite exists to catch, committed inside the suite itself.

     Every terminal state is matched, the failing ones included: a real error
     ends the wait and then fails the assertion below with the error in hand,
     rather than sitting here until the timeout and reporting nothing useful. */
  await page.waitForFunction(() => {
    const t = (document.getElementById('lab-out-stat') || {}).textContent || '';
    return /ran in|rendered|\u2717|error|isn\u2019t connected/i.test(t);
  }, { timeout: 25000 }).catch(() => {});
  const ran = await page.evaluate(() => ({
    stat: (document.getElementById('lab-out-stat').textContent || '').trim(),
    out: (document.getElementById('lab-out-body').textContent || '').replace(/\s+/g, ' ').trim(),
  }));
  ok(/ran in|rendered/i.test(ran.stat), 'pasting and pressing the entry run really executes the code', ran.stat);
  ok(ran.out.includes('the entry button really runs'), 'and the output is the code the person pasted', ran.out.slice(0, 60));

  /* The analysis chips take the same dead path, so one of them is checked too.
     Without an engine key the honest answer is a refusal, not silence. */
  await enterLab();
  await page.fill('#lab-paste', 'const x = 1');
  await page.click('[data-go="bugs"]');
  await page.waitForFunction(() => {
    const t = (document.getElementById('lab-out-stat') || {}).textContent || '';
    return /\u2713|\u2717|error|isn\u2019t connected|found|no issues/i.test(t);
  }, { timeout: 25000 }).catch(() => {});
  const chip = await page.evaluate(() => (document.getElementById('lab-out-stat').textContent || '').trim());
  ok(chip.length > 0, 'an analysis chip answers rather than doing nothing at all', chip.slice(0, 70));
  ok(!/^(analy|running|working|thinking)/i.test(chip),
     'and the answer is an outcome, not a progress message', chip.slice(0, 70));
}

ok(errors.length === 0, 'no console errors anywhere in this sweep', errors.slice(0, 3));
await app.close();
if (report('a-screen-explains-itself') > 0) process.exitCode = 1;
done();
