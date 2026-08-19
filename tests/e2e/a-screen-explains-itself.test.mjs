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
  const head = async () => page.evaluate(async () => {
    setTab('crew');
    await new Promise(s => setTimeout(s, 400));
    const b = document.querySelector('.mc-head-r button');
    return b ? { cls: b.className, act: b.dataset.dact, txt: b.textContent.trim() } : null;
  });

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
  await page.evaluate(async () => { setTab('help'); await new Promise(s => setTimeout(s, 400)); });
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
    const h = await page.evaluate(async (t) => {
      setTab(t);
      await new Promise(s => setTimeout(s, 400));
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

ok(errors.length === 0, 'no console errors anywhere in this sweep', errors.slice(0, 3));
await app.close();
if (report('a-screen-explains-itself') > 0) process.exitCode = 1;
done();
