/* WHAT THIS FILE WAS, AND WHY ITS PREMISE IS GONE.

   It was `a-directory-of-thirty-that-all-load`, and it existed because two
   categories on the Connectors page said "this could not be loaded" and
   neither was broken. Thirty rows each asked the registry as they painted; the
   route is rate limited per IP - deliberately, because it needs no account and
   one request there causes up to six reads of somebody else's server - so
   thirty simultaneous asks from one browser was precisely the shape that limit
   exists to refuse. The product was tripping its own guard and reporting the
   result to the person as categories that do not work.

   The rows are gone. The owner asked for the page to be a search box, then the
   connectors AMV built by hand, then a door per topic - "remove the things
   below the search bar entirely", "none of the thing that it says now" - and
   the reason given was that the search bar was laggy, which was the same
   defect seen from the front: the box was inside the node all that repainting
   replaced.

   So the thirty-rows-at-once problem is now solved by construction: the
   overview asks for nothing at all. That claim lives in
   `the-connector-directory-on-the-screen`, with the search box that survives a
   repaint.

   WHAT STILL NEEDS MEASURING, and is what this file now holds, is everything
   that moved behind the door rather than disappearing:

     1. A TOPIC PAGE FILLS. About a hundred, which takes two round trips
        because the server answers fifty at most and that ceiling is not a
        number to raise for a copy decision.
     2. A REFUSAL HEALS ITSELF, ONCE. A rate limit clears in seconds and a dead
        registry does not, and only the first of those should heal silently. A
        refusal that outlasts the retry is REPORTED, because an unreachable
        directory and an empty one are different facts and one of them tells
        somebody this product connects to nothing.
     3. THE LOGO'S FALLBACK. Every tile carries the connector's real logo over
        the letter it falls back to. The first version leaned on a failed <img>
        painting nothing, which is not what browsers do - Chrome draws its
        broken-image glyph on any img with a size, so every entry without an
        avatar got a torn-page icon over its mark. One listener on the document
        in the capture phase, because error events do not bubble but they do
        capture, and a per-tile listener would need re-wiring on every repaint.
     4. WHERE A DOOR LANDS. Pressed from a long way down the page, and the page
        behind it used to inherit that scroll position - so the thing somebody
        just asked to see opened in its own middle. The view remembers a
        position per tab and a mutation observer puts it back on every repaint,
        which is right for a repaint and wrong for a new page in the same tab.

   Worth keeping from the old file's notes: restoring the remembered scroll did
   NOT fail the first time it was mutated, because a pair of setTimeouts added
   as insurance were landing after the observer and hiding whether the real fix
   worked at all. Insurance that makes a defect untestable is not insurance. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const BASE = 'https://backend.example.workers.dev';
/* A 1x1 PNG, so a logo that "loads" really did decode. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

const app = await bootApp({ apiBase: BASE, user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

let calls = 0, inflight = 0, peak = 0;
const asked = [];
const logoAsked = [];

/* The registry, with a cursor so a second page genuinely exists - otherwise
   "it asks twice" would be untestable, since asking again for a page the
   registry has said does not exist is exactly what the code must NOT do. */
await page.route('**/v1/connectors**', async (r) => {
  calls++;
  inflight++; peak = Math.max(peak, inflight);
  const u = new URL(r.request().url());
  const q = u.searchParams.get('q') || '';
  const cursor = u.searchParams.get('cursor') || '';
  const want = Math.min(50, +u.searchParams.get('limit') || 5);
  asked.push({ q, want, cursor });
  await new Promise(res => setTimeout(res, 40));
  inflight--;
  const page1 = !cursor;
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    ok: true,
    /* Page one hands back a cursor, page two does not - so the chain stops on
       its own rather than needing a counter to stop it. */
    cursor: page1 ? 'CURSOR-2' : '',
    /* Half GitHub-shaped ids, half not, so both the logo and its fallback are
       exercised by the same page. */
    servers: Array.from({ length: want }, (_, i) => {
      const n = (page1 ? 0 : 1000) + i;
      return { id: (n % 2 ? 'io.github.acme' + n + '/' + q : 'org.other.' + q + '/' + n),
               name: q + '-' + n, by: 'acme', desc: 'A connector for ' + q,
               version: '1.0.0', command: 'npx', args: ['-y', 'x'], env: [] };
    }) }) });
});
await page.route('**/v1/connector-logo**', (r) => {
  const id = new URL(r.request().url()).searchParams.get('id') || '';
  logoAsked.push(id);
  return id.indexOf('io.github.') === 0
    ? r.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    : r.fulfill({ status: 404, body: 'no logo' });
});

const openConnectors = async (p) => {
  await (p || page).evaluate((b) => {
    saveStr('amv_api_base', b); saveStr('amv_api_token', 'tok');
    saveStr('amv_token_exp', String(Date.now() + 3e6));
    setTab('integrations');
  }, BASE);
  await (p || page).waitForTimeout(1200);
};

await openConnectors();

section('The overview asks for nothing, which is what the rows used to do wrong');
{
  ok(calls === 0,
     'arriving at Connectors makes no registry request at all - thirty at once was the defect this file was named for',
     String(calls));
  const r = await page.evaluate(() => ({
    doors: document.querySelectorAll('.int-seeall [data-dact="cdirAll"]').length,
    tiles: document.querySelectorAll('.cdir-tile').length,
  }));
  ok(r.doors >= 20, 'and there is still a topic for everything', String(r.doors));
  ok(r.tiles === 0, 'with nothing drawn from the registry yet', String(r.tiles));
}

section('An unasked question is not answered "nothing found"');
{
  /* A REAL DEFECT, AND REMOVING THE ROWS IS WHAT EXPOSED IT.

     The topic page's branches read: error, then loading-and-empty, then empty
     - and `idle` fell through to the last of those, which says "nothing in the
     directory matches that". So a page rendered before its first request had
     gone out told somebody the registry has nothing for their topic, a moment
     before filling with connectors for it.

     It was unreachable while the overview carried rows, because by the time
     anybody pressed See more the row had already fetched and the state was
     `done`. The topic page is the first thing that asks now, so `idle` is the
     state it opens in.

     Sampled from the very first frame, because the wrong sentence is only on
     screen until the answer lands - which on a fast connection is the blink
     somebody sees and cannot describe afterwards. */
  let sawNothingMatches = false;
  await page.evaluate(() => { document.querySelector('.int-seeall [data-dact="cdirAll"]').click(); });
  for (let i = 0; i < 20; i++) {
    const t = await page.evaluate(() => (document.querySelector('.cdir') || {}).textContent || '');
    if (/Nothing in the directory matches/i.test(t)) sawNothingMatches = true;
    await page.waitForTimeout(40);
  }
  ok(!sawNothingMatches,
     'opening a topic never claims the registry has nothing for it before AMV has asked',
     String(sawNothingMatches));
  const shown = await page.evaluate(() => ({
    skeleton: document.querySelectorAll('.cdir-skel').length,
    tiles: document.querySelectorAll('.cdir-tile').length,
  }));
  ok(shown.tiles > 0, 'it fills with what really came back', JSON.stringify(shown));
  /* Back, so the section below opens a door from a clean overview and its
     request counting starts from nothing. */
  await page.evaluate(async () => {
    document.querySelector('[data-dact="cdirBack"]').click();
    await new Promise(r => setTimeout(r, 600));
  });
  calls = 0; asked.length = 0; peak = 0;
}

section('A door opens a page that fills to about a hundred, in two trips');
{
  /* A DIFFERENT DOOR FROM THE SECTION ABOVE, because the answers are cached
     per query and `_cdirTried` records what has already been asked. Reopening
     the first topic correctly makes NO request at all - which is the right
     behaviour and would make the round-trip count below measure nothing. The
     first version of this section did exactly that and failed honestly.

     Which door, read off the door itself, so the assertions compare against
     the topic that was actually pressed rather than a name written here. */
  const opened = await page.evaluate(() => {
    const d = [...document.querySelectorAll('.int-seeall [data-dact="cdirAll"]')][1];
    d.click();
    return d.dataset.darg;
  });
  await page.waitForTimeout(2200);
  const r = await page.evaluate(() => ({
    full: !!document.querySelector('.cdir-full'),
    tiles: document.querySelectorAll('.cdir-full .cdir-tile').length,
  }));
  ok(r.full, 'the topic opens as a page of its own', String(r.full));
  /* ABOUT A HUNDRED, asked for in those words, and it takes two requests
     because the server answers fifty at most. The ceiling stays where it is:
     one request there can cause six reads of somebody else's registry and the
     route needs no account, so raising it for a copy decision would widen what
     a stranger can pull per request. */
  ok(r.tiles >= 100, 'holding about a hundred, not the fifty one request returns', String(r.tiles));
  ok(asked.length === 2, 'which took exactly two round trips', JSON.stringify(asked));
  ok(asked[0].cursor === '' && asked[1].cursor === 'CURSOR-2',
     'the second carrying on from where the first stopped rather than asking again',
     JSON.stringify(asked.map(a => a.cursor)));
  ok(peak <= 4, 'and never more than four requests in flight together', String(peak));
  /* Against the door that was actually pressed, not a name written here - a
     page that fetched a different topic than the one opened would otherwise
     pass every count above. */
  ok(asked.every(a => a.q === opened), 'both of them for the topic that was opened',
     opened + ' vs ' + asked.map(a => a.q).join(','));
}

section('It does not keep asking once the registry says that is everything');
{
  const before = calls;
  await page.evaluate(() => { _cdirPaint(); });
  await page.waitForTimeout(900);
  ok(calls === before,
     'a repaint of a finished page asks for nothing - the render-asks-answer-renders loop is what made this page make forty-five requests once',
     calls + ' vs ' + before);
  const end = await page.evaluate(() => {
    const t = (document.querySelector('.cdir-full') || {}).textContent || '';
    return { says: /that is everything/i.test(t), more: document.querySelectorAll('[data-dact="cdirMore"]').length };
  });
  ok(end.says, 'and it says that is everything rather than offering a Load more that returns nothing', String(end.says));
  ok(end.more === 0, 'with no Load more left on it', String(end.more));
}

section('Every tile carries a logo, and the ones without fall back to a mark');
{
  const r = await page.evaluate(async () => {
    /* On screen, because the images are lazy - offscreen ones never load, by
       design, and counting those as failures would be measuring the feature. */
    const grid = document.querySelector('.cdir-full .cdir-grid');
    grid.scrollIntoView({ block: 'center' });
    await new Promise(res => setTimeout(res, 1400));
    const tiles = [...grid.querySelectorAll('.cdir-tile')];
    const imgs = tiles.map(t => t.querySelector('.cdir-logo')).filter(Boolean);
    const settled = imgs.filter(i => i.complete);
    return {
      tiles: tiles.length, imgs: imgs.length,
      loaded: settled.filter(i => i.naturalWidth > 0).length,
      hiddenAfterFail: settled.filter(i => i.naturalWidth === 0 && i.style.display === 'none').length,
      visibleBroken: settled.filter(i => i.naturalWidth === 0 && i.style.display !== 'none').length,
      marks: tiles.map(t => (t.querySelector('.cdir-ic') || {}).textContent || '').filter(Boolean).length,
    };
  });
  ok(r.imgs === r.tiles, 'every tile has a logo element', JSON.stringify(r));
  ok(r.loaded > 0, 'the ones with a real logo show it', JSON.stringify(r));
  /* THE DEFECT: a failed image left visible is a torn-page glyph over the
     mark, which is worse than the mark alone. */
  ok(r.visibleBroken === 0, 'and the ones without are hidden rather than left as a broken glyph', JSON.stringify(r));
  ok(r.hiddenAfterFail > 0, 'which really did happen, rather than every logo loading', JSON.stringify(r));
  ok(r.marks === r.tiles, 'with a letter behind each one to fall back to', JSON.stringify(r));
  ok(logoAsked.length > 0, 'and the logos came from AMV rather than from a third party', String(logoAsked.length));
}

section('A door pressed from the bottom of the page lands at the top of the next one');
{
  await page.evaluate(async () => {
    document.querySelector('[data-dact="cdirBack"]').click();
    await new Promise(r => setTimeout(r, 700));
  });
  const r = await page.evaluate(async () => {
    const sv = document.querySelector('#vc .sv');
    if (sv) sv.scrollTop = 1400;
    const before = sv ? sv.scrollTop : -1;
    const doors = [...document.querySelectorAll('.int-seeall [data-dact="cdirAll"]')];
    doors[doors.length - 1].click();
    await new Promise(res => setTimeout(res, 1400));
    const sv2 = document.querySelector('#vc .sv');
    return { before, after: sv2 ? sv2.scrollTop : -1,
             full: !!document.querySelector('.cdir-full') };
  });
  ok(r.before > 500, 'pressed from a long way down the page', String(r.before));
  ok(r.full, 'the topic opens', String(r.full));
  ok(r.after === 0, 'at the top of it, not wherever the last page was scrolled to', String(r.after));
}

section('And going back does the same');
{
  const r = await page.evaluate(async () => {
    const sv = document.querySelector('#vc .sv');
    if (sv) sv.scrollTop = 1200;
    document.querySelector('[data-dact="cdirBack"]').click();
    await new Promise(res => setTimeout(res, 900));
    const sv2 = document.querySelector('#vc .sv');
    return { after: sv2 ? sv2.scrollTop : -1,
             doors: document.querySelectorAll('.int-seeall [data-dact="cdirAll"]').length };
  });
  ok(r.doors >= 20 && r.after === 0, 'back lands on the topics, at the top', JSON.stringify(r));
}

section('A refusal that outlasts every retry is reported, not hidden');
{
  /* A SECOND APP RATHER THAN A RESET. The answer cache, the record of what has
     been asked and the record of what has been retried are module-level
     bindings in one bundle - script bindings, not properties of window - so
     there is no honest way to reach in and clear them.

     WHAT IT TAKES TO MAKE A TOPIC SAY IT IS BROKEN, which was the whole lesson
     of the section this replaces. Stubbing 429s produced no visible error at
     all: the API layer retries a rate limit itself, so the page simply arrived
     late. Nor did aborting the first few requests - it retries transport
     failures too. This screen's error state is only reached once that budget
     is EXHAUSTED, so "somebody saw a category fail" means a failure that
     outlasted every retry underneath, not a single refusal. Which is why
     failing everything for a window is the right stub and a count of failures
     is the wrong one. */
  let failUntil = 0;
  const app2 = await bootApp({ apiBase: BASE, user: { name: 'A', email: 'a@x.com', ini: 'A' } });
  const p2 = app2.page;
  await p2.route('**/v1/connectors**', async (r) => {
    if (Date.now() < failUntil) return r.abort('failed');
    const u = new URL(r.request().url());
    const q = u.searchParams.get('q') || '';
    const want = Math.min(50, +u.searchParams.get('limit') || 5);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, cursor: '',
      servers: Array.from({ length: want }, (_, i) => ({
        id: 'io.github.acme' + i + '/' + q, name: q + '-' + i, by: 'acme',
        desc: 'd', version: '1', command: 'npx', args: ['-y', 'x'], env: [] })) }) });
  });
  await p2.route('**/v1/connector-logo**', (r) => r.fulfill({ status: 404, body: 'no logo' }));

  await openConnectors(p2);
  /* Started when the DOOR is pressed, not when the browser boots: a window
     measured from boot had already closed before anything asked for anything,
     and the section passed by failing nothing. */
  failUntil = Date.now() + 2600;
  await p2.evaluate(() => { document.querySelector('.int-seeall [data-dact="cdirAll"]').click(); });

  /* Sampled repeatedly rather than at one moment: the failure lands, the retry
     fires 1.2s later, and a single snapshot can miss the window between them -
     which would make "it recovered" indistinguishable from "it never failed",
     the exact thing this section exists to tell apart. */
  /* SAMPLED TOGETHER, which the first version of this got wrong. It recorded
     that an error had been seen, then looked for the Try again link
     AFTERWARDS - by which time the window had closed and the page had healed,
     so the link was legitimately gone and the assertion failed on the test's
     own timing rather than on the product. What is offered alongside the
     message has to be read at the same instant as the message. */
  let sawError = false, sawRetry = false, sawEmpty = false;
  for (let i = 0; i < 45; i++) {
    await p2.waitForTimeout(120);
    const s = await p2.evaluate(() => {
      const t = (document.querySelector('.cdir') || {}).textContent || '';
      return { err: /could not be reached/i.test(t),
               empty: /Nothing in the directory matches/i.test(t),
               retry: document.querySelectorAll('[data-dact="cdirRetry"]').length > 0 };
    });
    if (s.err) { sawError = true; if (s.retry) sawRetry = true; }
    if (s.empty) sawEmpty = true;
  }
  ok(sawError, 'the refusal really was refused, not quietly absorbed', String(sawError));
  ok(sawRetry, 'and while it said so, it offered a way to try again', String(sawRetry));
  ok(!sawEmpty,
     'it never said nothing matches, which would be a different claim about somebody’s options',
     String(sawEmpty));

  /* AND IT HEALS ITSELF. The automatic retry is deliberately ONE: a rate limit
     clears in seconds and a dead registry does not, so only the first of those
     should recover with nobody pressing anything. The window above outlasts
     that retry, so reaching a filled page here means the screen came back on
     its own after the registry did. */
  await p2.evaluate(() => { _cdirPaint(); });
  await p2.waitForTimeout(3000);
  const end = await p2.evaluate(() => ({
    errored: /could not be reached/i.test((document.querySelector('.cdir') || {}).textContent || ''),
    tiles: document.querySelectorAll('.cdir-tile').length,
    retry: document.querySelectorAll('[data-dact="cdirRetry"]').length,
  }));
  ok(!end.errored, 'once the registry answers again the message is gone', JSON.stringify(end));
  ok(end.tiles > 0, 'and the topic fills in', String(end.tiles));
  ok(end.retry === 0, 'with nothing left telling the person it is broken', String(end.retry));
  await app2.close();
}

ok(errors.length === 0, 'and the screen raised no errors', errors.slice(0, 3).join(' | '));
await app.close();
process.exit(report() === 0 ? (done(), 0) : 1);
