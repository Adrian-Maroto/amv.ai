/* EVERY FAULT THAT WAS REPORTED, CHECKED AGAINST THE FILE THE HOST SERVES.

   This file exists because of how the last round went. Fourteen things were
   reported, I fixed them, said they were done, and most of them were still
   broken - and the tests I had written agreed with me the whole time.

   Two reasons, both worth encoding rather than remembering.

   THE STUBS ANSWERED INSTANTLY. Every repaint then lands before the first
   frame, the browser coalesces them, and no entrance animation ever replays.
   Any implementation passes that, including doing nothing. The flicker only
   exists when the server takes time, so every case here is driven against a
   backend with a REAL delay.

   AND THE TESTS DROVE THE SOURCE. The thing a person opens is
   `public/index.html` - one built file, minified, with the CSS and JS inlined.
   Testing the modules proves the modules. This serves the published folder
   itself, so what is measured is what is served.

   It is deliberately one file covering unrelated screens, which is not how the
   rest of the suite is organised. It is not a unit of behaviour; it is the
   owner's list, and the point of it is that the list is checked as a list. */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import { LAUNCH, armGeom } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUB = join(ROOT, 'public');
ok(existsSync(join(PUB, 'index.html')), 'the published folder exists to be tested');

const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
                '.css':'text/css', '.json':'application/json', '.png':'image/png',
                '.webmanifest':'application/manifest+json' };
const srv = createServer((req, res) => {
  const p = (req.url || '/').split('?')[0];
  const f = join(PUB, p === '/' ? 'index.html' : p.replace(/^\/+/, ''));
  if (f.startsWith(PUB) && existsSync(f) && statSync(f).isFile()) {
    res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' });
    return res.end(readFileSync(f));
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(readFileSync(join(PUB, 'index.html')));
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const URL_ = 'http://127.0.0.1:' + srv.address().port + '/';

const browser = await chromium.launch(LAUNCH);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await armGeom(page);
await page.goto(URL_, { waitUntil: 'load' });
await page.waitForTimeout(700);

/* Signed in, on a paid plan, with a backend that takes 400ms to answer -
   which is the condition every one of these faults needs to appear. */
await page.evaluate(() => {
  localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
  S.user = { name: 'Test', email: 'test@amv.dev', ini: 'T' };
  goApp();
  saveStr('amv_plan', 'pro');
  document.getElementById('ck')?.remove();
  document.querySelector('.cc-banner')?.remove();
  AMV_API.base = 'https://stub.amv.dev'; AMV_API.token = 't';
  const slow = (v) => async (...a) => {
    await new Promise(r => setTimeout(r, 400));
    return typeof v === 'function' ? v(...a) : v;
  };
  AMV_API.listAuto    = slow({ items: [] });
  AMV_API.listHandoff = slow({ items: [] });
  AMV_API.crewPopular = slow({ enough: false, total: 6, need: 25 });
  AMV_API.connectList = slow({ configured: true, items: [],
    providers: [{ id: 'google', name: 'Google', ready: true, scopes: ['mail.read', 'calendar.read'] }] });
  AMV_API.everyday    = slow((cc) => ({ name: cc === 'UZ' ? 'Uzbekistan' : cc, countries: ['US', 'UZ'],
    local: [{ id: cc.toLowerCase() + '_a', icon: '.', title: cc + ' paperwork', desc: 'Only in ' + cc + '.', needs: 'Email' }] }));
  AMV_API.connectors  = slow({ ok: true, q: '', cursor: '', servers: [] });
  AMV_API.toggleJob   = slow({ ok: true });
  window.__an = [];
  document.addEventListener('animationstart', (e) => {
    if (document.getElementById('vc').contains(e.target)) window.__an.push(e.animationName);
  }, true);
});

const arrive = (tab) => page.evaluate(async (t) => {
  setTab('chat'); await new Promise(r => setTimeout(r, 350));
  window.__an = [];
  setTab(t); await new Promise(r => setTimeout(r, 2400));
  return window.__an.filter(a => a === 'viewEnter').length;
}, tab);

section('1. Opening a screen does not play its entrance twice');
{
  for (const t of ['crew', 'handoff', 'build', 'chat', 'lab', 'integrations', 'billing']) {
    const n = await arrive(t);
    ok(n <= 1, t + ' arrives once', String(n));
  }
}

section('2. Lab is one scroll, and its actions are reachable on a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  const r = await page.evaluate(async () => {
    _LAB.code = ''; _LAB.atHome = false; setTab('lab');
    await new Promise(x => setTimeout(x, 600));
    const shell = document.getElementById('lab-shell');
    const entry = document.getElementById('lab-entry');
    return { inner: entry.scrollHeight - entry.clientHeight,
             page: shell.scrollHeight - shell.clientHeight };
  });
  ok(r.inner <= 1, 'the entry is not a scroller inside a scroller', JSON.stringify(r));
  await page.mouse.move(195, 500);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(200);
  const reach = await page.evaluate(() => {
    const a = document.getElementById('lab-entry-acts').getBoundingClientRect();
    return { bottom: Math.round(a.bottom), h: window.innerHeight,
             moved: Math.round(document.getElementById('lab-shell').scrollTop) };
  });
  ok(reach.moved > 0, 'a wheel scrolls the page itself', JSON.stringify(reach));
  ok(reach.bottom <= reach.h, 'and the actions come into view', JSON.stringify(reach));
  await page.setViewportSize({ width: 1280, height: 900 });
}

section('3. The three Build sections sit the same way, so nothing jumps');
{
  const where = {};
  for (const m of ['code', 'design', 'lab']) {
    where[m] = await page.evaluate(async (mm) => {
      _DEV.atHome = true; _STUDIO.atHome = true; _LAB.atHome = true;
      setBuildMode(mm); await new Promise(x => setTimeout(x, 600));
      /* MEASURED FROM THE HEADING, NOT FROM THE FIRST DESCENDANT.

         Build's root is `.dev-shell` and its child `.dev-chat-pane` fills the
         height by construction, so "the first descendant" always starts at
         zero whatever the content does - a measurement that cannot tell a
         centred entry from a top-aligned one. Every one of the three renders
         `.build-head`, and where THAT sits is the thing being claimed. */
      const root = document.querySelector('#vc > *');
      const rr = root.getBoundingClientRect();
      const head = root.querySelector('.build-head');
      const kids = [...root.querySelectorAll('*')].filter(e => e.getBoundingClientRect().height > 6);
      const bot = Math.max(...kids.map(e => e.getBoundingClientRect().bottom));
      return { above: head ? Math.round(head.getBoundingClientRect().top - rr.top) : -1,
               overflow: Math.round(bot - rr.bottom),
               scrollable: Math.round(root.scrollHeight - root.clientHeight),
               overflowY: getComputedStyle(root).overflowY };
    }, m);
  }
  /* REACHABLE, NOT "FITS". The first version of this demanded overflow <= 0,
     and it is worth saying why that was the wrong claim rather than just
     loosening it.

     The three entries share one top offset - that is the whole fix for the
     jump - and Studio's entry is the tall one. Any offset large enough to
     answer "it is way too high, move it down" is by definition an offset the
     tall entry cannot absorb on a short window. "Fits" is therefore not a
     property all three can have at once, and a rule that demands it is a rule
     that gets deleted the first time somebody adds a line of copy.

     What must never happen is content a person cannot get to. That is a real
     fault this codebase has already paid for once, with a modal whose Save
     button sat 250px below a centred box that would not scroll to it. So the
     claim is: it fits, or it scrolls far enough to reach the part that does
     not. Verified by mutation - setting the container to overflow:hidden with
     content past the edge fails this line. */
  for (const m of ['code', 'design', 'lab']) {
    const w = where[m];
    const reachable = w.overflow <= 0
      || (/(auto|scroll)/.test(w.overflowY) && w.scrollable >= w.overflow);
    ok(reachable, m + ' keeps every part of the entry reachable', JSON.stringify(w));
  }
  /* TWO CLAIMS, BECAUSE ONE OF THEM DOES NOT DISTINGUISH ANYTHING.

     "They start within a screenful of each other" is true when all three are
     centred AND when all three are pinned to the top - so on its own it passes
     with the centring deleted, which is exactly how the last round's tests
     agreed with a broken product. Verified by deleting it: the suite stayed
     green. The second claim is the one that bites, and it is the owner's actual
     words - "way too high ... needs to move more down". */
  const tops = ['code', 'design', 'lab'].map(m => where[m].above);
  /* 24, not 140. The first number here was 140 - "within a screenful" - and it
     passed a real 57px jump: the rule had been written in the middle of the
     stylesheet, so Design lost it to a later `!important` and measured 81 / 24
     / 81 while this line called it fine. A threshold loose enough to pass the
     defect it guards is the same useless assertion as before, wearing a
     number. All three take ONE rule, so the honest expectation is that they
     agree exactly; 24 is slack for a border or a rounded margin, not room for
     a different rule to win. */
  ok(Math.max(...tops) - Math.min(...tops) < 24,
     'and they start at the same place, because one rule sets all three',
     tops.join(' / '));
  for (const m of ['code', 'design', 'lab']) {
    ok(where[m].above > 20,
       m + ' is not slammed against the top of the window', JSON.stringify(where[m]));
  }
}

section('4. A design in Recents opens, and Build goes to Build');
{
  const r = await page.evaluate(async () => {
    _STUDIO.artifacts = [{ id: 'a1', name: 'D', type: 'page', html: '', brief: 'a poster', history: [] }];
    _STUDIO.activeId = 'a1'; _sessTouch('studio');
    await new Promise(x => setTimeout(x, 1600));
    const id = (_SESSIONS.find(s => s.kind === 'studio') || {}).id;
    setTab('chat'); await new Promise(x => setTimeout(x, 250));
    _sessResume(id); await new Promise(x => setTimeout(x, 700));
    const opened = !!document.querySelector('.studio-canvas');
    const exit = !!document.getElementById('bld-home');
    const b = document.querySelector('.snb[data-tab="build"], .sb-tool[data-tab="build"]');
    if (b) b.click();
    await new Promise(x => setTimeout(x, 700));
    return { opened, exit, home: (document.querySelector('#vc > *') || {}).className || '',
             kept: (_STUDIO.artifacts || []).length };
  });
  ok(r.opened, 'resuming a design opens its canvas, not the homepage', r.opened);
  ok(r.exit, 'and there is a way out of it', r.exit);
  ok(/bld-sv/.test(r.home), 'pressing Build lands on the main screen', r.home);
  ok(r.kept > 0, 'without throwing the design away', String(r.kept));
}

section('5. Crew: the country control changes the list, and five lead it');
{
  const r = await page.evaluate(async () => {
    setTab('crew'); await new Promise(x => setTimeout(x, 1800));
    const five = document.querySelectorAll('.cw-top5-item .cw-job').length;
    cwCountry('UZ'); await new Promise(x => setTimeout(x, 900));
    const uz = (document.getElementById('cw-country-group') || {}).textContent || '';
    cwCountry('JP'); await new Promise(x => setTimeout(x, 900));
    const jp = (document.getElementById('cw-country-group') || {}).textContent || '';
    const page_ = document.querySelector('.crew-page');
    const cat = document.querySelector('.crew-jobs-sec');
    const kids = [...page_.children];
    return { five, uz: uz.slice(0, 40), jp: jp.slice(0, 40),
             last: kids.indexOf(cat) === kids.length - 1 };
  });
  ok(r.five === 5, 'five jobs lead the catalogue', String(r.five));
  ok(/Uzbekistan/.test(r.uz), 'choosing Uzbekistan changes the list', r.uz);
  ok(/Japan/.test(r.jp), 'and choosing Japan changes it again', r.jp);
  ok(r.last, 'and nothing follows the catalogue', r.last);
}

section('6. Deciding on a job does not need a scroll, and connecting asks for nothing');
{
  const r = await page.evaluate(async () => {
    const j = (_cwJobs() || []).slice()
      .sort((a, b) => ((b.prompt || '') + (b.desc || '')).length - ((a.prompt || '') + (a.desc || '')).length)[0];
    cwPeek(j.id); await new Promise(x => setTimeout(x, 400));
    const panel = document.querySelector('.cwp');
    const go = document.getElementById('cwp-go');
    const pr = panel.getBoundingClientRect(), gr = go.getBoundingClientRect();
    const onScreen = gr.bottom <= window.innerHeight && gr.top >= 0 && gr.bottom <= pr.bottom + 1;
    closeOvr(); await new Promise(x => setTimeout(x, 200));
    openCrewConnect('inbox_digest'); await new Promise(x => setTimeout(x, 400));
    const el = document.querySelector('.cwc');
    const out = { onScreen, screen: !!el,
                  title: (document.querySelector('.cwc-t') || {}).textContent || '',
                  fields: el ? el.querySelectorAll('input,textarea').length : -1 };
    closeOvr();
    return out;
  });
  ok(r.onScreen, 'the decision is on the screen when the job opens', r.onScreen);
  ok(r.screen && /^Connect .+ to your AMV$/.test(r.title.trim()),
     'connecting opens a screen that names the account', r.title.trim());
  ok(r.fields === 0, 'and asks for no credential here - the sign-in is at the provider', String(r.fields));
}

section('7. Billing says the plan once, and Help promises nothing removed');
{
  const r = await page.evaluate(async () => {
    setTab('billing'); await new Promise(x => setTimeout(x, 900));
    const t = (document.getElementById('vc').textContent || '').replace(/\s+/g, ' ');
    const cards = document.querySelectorAll('#vc .ss2').length;
    const boxed = [...document.querySelectorAll('#vc .ss2')]
      .filter(e => getComputedStyle(e).borderTopWidth !== '0px'
                && getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)').length;
    setTab('help'); await new Promise(x => setTimeout(x, 600));
    const h = (document.getElementById('vc').textContent || '').replace(/\s+/g, ' ');
    return { dup: (t.match(/\$15/g) || []).length, manage: /Manage billing/.test(t),
             dash: /Started -|Renews -/.test(t), cards, boxed,
             promises: /image and video generation|Images, video/i.test(h) };
  });
  ok(r.manage, 'billing offers the one action that matters');
  ok(r.dup <= 1, 'and states the price once rather than twice', String(r.dup));
  ok(!r.dash, 'with no bare dash where a date should be', r.dash);
  ok(r.boxed <= 1, 'one surface, not a stack of boxes', r.boxed + ' of ' + r.cards);
  ok(!r.promises, 'Help no longer offers a feature AMV removed', r.promises);
}

section('8. Nothing threw while all of that happened');
{
  ok(errors.length === 0, 'no page errors across every screen', errors.slice(0, 4).join(' | '));
}

await browser.close();
srv.close();
if (report('every-fault-that-was-reported-stays-fixed') > 0) process.exitCode = 1;
done();
