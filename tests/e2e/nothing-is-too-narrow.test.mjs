/* A COLUMN CAN BE TOO NARROW TO USE WITHOUT BEING BROKEN.

   The mobile sweep asks whether anything overflows sideways and whether tap
   targets are big enough. Both were true of Settings on a tablet, and it was
   still unusable: app rail, settings nav, and 191 pixels of content. Every
   field label wrapped to three lines, the instructions box showed about ten
   characters per line, and the body copy broke every four words.

   Nothing overflowed. Nothing was too small to tap. The screen was simply the
   wrong shape at that width, and no assertion in the suite had an opinion
   about it, because "too narrow" is a judgement the existing checks do not
   make.

   The gap was between two breakpoints that were each reasonable alone: the app
   rail undocks at 700, the settings screen collapses to a picker at 720. Every
   width in between - iPad portrait at 768, and every small laptop window up to
   about a thousand - got three columns and whatever was left.

   So this measures the CONTENT column across the range, which is the number
   that decides whether a screen can be used. */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 9142;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = rel === '/' ? 'index.html' : rel.replace(/^\/+/, '');
  const abs = join(ROOT, file);
  if (!abs.startsWith(ROOT) || !existsSync(abs) || !/\.[a-z0-9]+$/i.test(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' });
  res.end(readFileSync(abs));
});
await new Promise(r => server.listen(PORT, r));
const browser = await chromium.launch();

/* Narrower than this and a form field cannot hold a sentence, a label wraps to
   three lines, and a textarea shows a word per line. It is not a style rule -
   it is the width below which the screen stops working. */
const MIN_CONTENT = 320;

async function contentWidthAt(width, tab, sel) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load' });
  await page.waitForTimeout(650);
  await page.evaluate((t) => {
    localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
    S.user = { name: 'Alex Rivera', email: 'alex@example.com', ini: 'A' };
    goApp(); setTab(t);
  }, tab);
  await page.waitForTimeout(550);
  const w = await page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? Math.round(el.getBoundingClientRect().width) : -1;
  }, sel);
  await page.close();
  return w;
}

/* Every width somebody actually holds: phone, phablet, iPad portrait, small
   laptop, the awkward half-screen sizes, and a real desktop. */
const WIDTHS = [390, 560, 700, 768, 900, 1000, 1100, 1280, 1440];

section('Settings has a usable column at every width');
{
  const narrow = [];
  for (const w of WIDTHS) {
    const px = await contentWidthAt(w, 'settings', '.set-pane');
    if (px >= 0 && px < MIN_CONTENT) narrow.push(`${w}px viewport -> ${px}px pane`);
  }
  ok(narrow.length === 0,
     `the settings pane is never squeezed under ${MIN_CONTENT}px`, narrow);
}

section('And the collapse happens before the squeeze does');
{
  /* The picker replaces the section list when space is short. If the two
     breakpoints drift apart again, a gap reopens exactly where this started. */
  const page = await browser.newPage({ viewport: { width: 768, height: 900 } });
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load' });
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
    S.user = { name: 'A', email: 'a@x.com', ini: 'A' }; goApp(); setTab('settings');
  });
  await page.waitForTimeout(550);
  const r = await page.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; };
    return { picker: vis('.set-picker'), list: vis('.settings-nav-list') };
  });
  ok(r.picker, 'at iPad portrait the picker is what you get', r.picker);
  ok(!r.list, 'and the section list is not also taking a column', r.list);
  await page.close();
}

section('A desktop still gets the two-column layout');
{
  /* The fix must not have simply deleted the good version. */
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load' });
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
    S.user = { name: 'A', email: 'a@x.com', ini: 'A' }; goApp(); setTab('settings');
  });
  await page.waitForTimeout(550);
  const r = await page.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; };
    const el = document.querySelector('.set-pane');
    return { list: vis('.settings-nav-list'), pane: el ? Math.round(el.getBoundingClientRect().width) : 0 };
  });
  ok(r.list, 'the section list is there on a real screen', r.list);
  ok(r.pane >= 600, 'with a full-width pane beside it', r.pane);
  await page.close();
}

section('The main surfaces hold up too');
{
  /* Same question of the screens people spend their time on. */
  const thin = [];
  for (const [tab, sel] of [['chat', '#cm'], ['market', '#vc'], ['tasks', '#vc']]) {
    for (const w of [390, 768, 1024]) {
      const px = await contentWidthAt(w, tab, sel);
      if (px >= 0 && px < MIN_CONTENT) thin.push(`${tab} at ${w}px -> ${px}px`);
    }
  }
  ok(thin.length === 0, 'no main surface is squeezed either', thin);
}

section('The pricing CTAs sit on one line');
{
  /* The row where somebody compares four things and decides to pay. The cards
     are the same height, so the buttons drifted apart only because the
     reassurance note under them wraps to two lines on the middle two - fifteen
     pixels, which reads as sloppiness rather than as a bug, and is worse for
     it. Checked per ROW, since the grid wraps below 1200. */
  for (const width of [1440, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 1600 } });
    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load' });
    await page.waitForTimeout(650);
    await page.evaluate(() => {
      localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
      S.user = { name: 'A', email: 'a@x.com', ini: 'A' }; goApp(); setTab('plans');
    });
    await page.waitForTimeout(700);
    const rows = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.plnc .plnbtn')]
        .filter(b => b.getBoundingClientRect().top > 100)
        .map(b => Math.round(b.getBoundingClientRect().top));
      /* Group by row: anything within 40px of each other is the same row. */
      const groups = [];
      btns.sort((a, b) => a - b).forEach(y => {
        const g = groups.find(g => Math.abs(g[0] - y) < 40);
        if (g) g.push(y); else groups.push([y]);
      });
      return groups.map(g => Math.max(...g) - Math.min(...g));
    });
    await page.close();
    ok(rows.length > 0, `the plan buttons were found at ${width}px`, rows);
    ok(rows.every(spread => spread === 0),
       `and every row of them is level at ${width}px`, rows);
  }
}

section('Nothing runs off the side of a tablet either');
{
  /* The mobile sweep asks this at phone widths. Between phone and desktop
     nobody was asking, and that is where the Lab toolbar hung 36px past the
     edge of the screen and took the horizontal scrollbar with it - a flex row
     with space-between and no wrap, comfortable on a desktop and not at 768. */
  const spills = [];
  const TABS = ['chat', 'images', 'video', 'crew', 'handoff', 'studio', 'dev', 'lab', 'tasks', 'market', 'plans', 'settings'];
  for (const width of [768, 900]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
      S.user = { name: 'Alex Rivera', email: 'alex@example.com', ini: 'A' }; goApp();
    });
    for (const tab of TABS) {
      await page.evaluate((t) => setTab(t), tab);
      await page.waitForTimeout(360);
      const worst = await page.evaluate(() => {
        let over = 0, sel = '';
        document.querySelectorAll('#vc *, #cv *').forEach((e) => {
          const b = e.getBoundingClientRect();
          if (b.width > 0 && b.right > window.innerWidth + 2 && b.right - window.innerWidth > over) {
            over = Math.round(b.right - window.innerWidth);
            sel = (e.className || e.tagName).toString().slice(0, 24);
          }
        });
        return { over, sel };
      });
      if (worst.over > 0) spills.push(`${tab} at ${width}px: ${worst.over}px past the edge (${worst.sel})`);
    }
    await page.close();
  }
  ok(spills.length === 0, 'no surface overflows sideways between phone and desktop', spills);
}

await browser.close();
server.close();
if (report('nothing-is-too-narrow') > 0) process.exitCode = 1;
done();
