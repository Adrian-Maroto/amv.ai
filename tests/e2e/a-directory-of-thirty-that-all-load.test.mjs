/* TWO CATEGORIES SAID "THIS COULD NOT BE LOADED" AND NEITHER WAS BROKEN.

   The directory is thirty rows and every one of them asks the registry on
   render. The route is rate limited per IP - deliberately, because it needs no
   account and one request there causes up to six reads of somebody else's
   server - so thirty simultaneous asks from one browser is precisely the shape
   that limit exists to refuse. The product was tripping its own guard, and the
   rows it refused were reported to the person as categories that do not work.

   It got worse with every category added: visible at twenty, unmissable at
   thirty. And `state:'error'` was final - nothing retried, so one refusal at
   the wrong moment broke that row for the whole visit.

   Four at a time now, with one automatic retry after a pause. One retry, not a
   loop: a rate limit clears in seconds and a dead registry does not, and only
   the first of those should heal itself silently.

   WHAT ELSE IS HELD HERE:

   THE LOGO'S FALLBACK. Every tile carries the connector's real logo over the
   letter it falls back to. The first version leaned on a failed <img> painting
   nothing, which is not what browsers do - Chrome draws its broken-image glyph
   on any img with a size, so every entry without an avatar got a torn-page
   icon over its mark. It was in the first screenshot. The fix is one listener
   on the document in the capture phase, because error events do not bubble but
   they do capture, and because a per-tile listener would have to be re-wired on
   every repaint of a screen that repaints constantly.

   AND WHERE SEE MORE LANDS. It is pressed from the BOTTOM of a row, a long way
   down a page with thirty of them, and the full page used to inherit that
   scroll position - so the thing somebody just asked to see opened in its own
   middle. The cause was not the scroll call: the view remembers a position per
   tab and a mutation observer puts it back on every repaint, which is right
   for a repaint and wrong for a new page inside the same tab. It is forgotten
   now rather than fought with.

   BROKEN FIVE WAYS. Removing the concurrency limit fails the in-flight line.
   Deleting the automatic retry leaves rows telling the person they are broken.
   Leaving a failed logo visible fails the glyph line. Deleting the last ten
   topics fails six lines at once.

   The fifth is worth writing down. Restoring the remembered scroll did NOT
   fail at first - a pair of setTimeouts I had added as insurance were landing
   after the observer and hiding whether the real fix worked at all. They are
   gone, the one mechanism does the job, and the mutation fails. Insurance that
   makes a defect untestable is not insurance. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const BASE = 'https://backend.example.workers.dev';
/* A 1x1 PNG, so a logo that "loads" really did decode. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

const app = await bootApp({ apiBase: BASE, user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

let calls = 0, inflight = 0, peak = 0, refuseFirst = 0;
const logoAsked = [];

await page.route('**/v1/connectors**', async (r) => {
  calls++;
  if (calls <= refuseFirst) {
    /* Exactly how the real limit refuses. */
    return r.fulfill({ status: 429, contentType: 'application/json',
                       body: JSON.stringify({ error: 'too many', code: 'rate_limited' }) });
  }
  inflight++; peak = Math.max(peak, inflight);
  const u = new URL(r.request().url());
  const q = u.searchParams.get('q') || '';
  const want = Math.min(48, +u.searchParams.get('limit') || 5);
  await new Promise(res => setTimeout(res, 40));
  inflight--;
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    ok: true, cursor: '',
    /* Half GitHub-shaped ids, half not, so both the logo and its fallback are
       exercised by the same page. */
    servers: Array.from({ length: want }, (_, i) => ({
      id: (i % 2 ? 'io.github.acme' + i + '/' + q : 'org.other.' + q + '/' + i),
      name: q + '-' + i, by: 'acme', desc: 'A connector for ' + q,
      version: '1.0.0', command: 'npx', args: ['-y', 'x'], env: [] })) }) });
});
await page.route('**/v1/connector-logo**', (r) => {
  const id = new URL(r.request().url()).searchParams.get('id') || '';
  logoAsked.push(id);
  return id.indexOf('io.github.') === 0
    ? r.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    : r.fulfill({ status: 404, body: 'no logo' });
});

const openDirectory = async () => {
  await page.evaluate((b) => {
    saveStr('amv_api_base', b); saveStr('amv_api_token', 'tok');
    saveStr('amv_token_exp', String(Date.now() + 3e6));
    setTab('integrations');
  }, BASE);
  await page.waitForTimeout(3800);
};

await openDirectory();

section('Thirty categories, and every one of them arrives');
{
  const r = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.cdir-row')];
    return { rows: rows.length,
      errored: rows.filter(x => /could not be loaded/i.test(x.innerText)).map(x => x.dataset.cdirRow),
      filled: rows.filter(x => x.querySelectorAll('.cdir-tile').length > 0).length,
      more: document.querySelectorAll('.cdir-more').length };
  });
  /* TWENTY-SIX REGISTRY ROWS, not thirty. Four were dropped because a
     hand-built section above the list already owns that topic and already
     carries a door running the same query - "Developer" beside "Developer
     tools" was the version of this page that shipped. The count of NAMED
     topics on the screen is thirty-one, and `every-topic-has-its-own-door`
     is where that is held; this file is about the registry rows themselves. */
  ok(r.rows === 26, 'there are twenty-six registry topics', r.rows);
  ok(r.errored.length === 0, 'and none of them reports that it could not be loaded', r.errored);
  ok(r.filled === 26, 'every one has connectors in it', r.filled);
  ok(r.more >= 26, 'and every one has a way to see the rest', r.more);
}

section('They do not all ask at once, which is what was refusing them');
{
  ok(peak <= 4, 'at most four requests are in flight together', peak);
  ok(calls >= 26, 'while still asking for every category', calls);
}

section('A refusal heals itself, once');
{
  /* A SECOND APP RATHER THAN A RELOAD. The row state, the record of what has
     been asked and the record of what has been retried are module-level
     bindings in one bundle - script bindings, not properties of window - so
     there is no way to reach in and clear them, and a reload inside the
     harness left the page without its stored credentials. A fresh browser is
     the honest way to ask "what happens on a first visit that gets refused".
     It is also the case that actually matters: the refusal happens on arrival,
     when all thirty rows ask at once. */
  /* WHAT IT TAKES TO MAKE A ROW SAY IT IS BROKEN, which turned out to be the
     whole lesson of this section.

     Stubbing 429s produced no visible error at all - the API layer retries a
     rate limit itself, so those rows simply arrived late. Nor did aborting the
     first eight requests: it retries transport failures too. A row only
     reaches this screen's error state once that budget is EXHAUSTED, so
     "somebody saw two categories fail" means a failure that outlasted every
     retry underneath, not a single refusal.

     Which is why failing everything for a window is the right stub and a
     count of failures is the wrong one. The window is longer than the API's
     own retries and shorter than this screen's, so the rows really do go
     broken and really do come back. */
  /* Started when the SCREEN opens, not when the browser does - booting takes
     long enough that a window measured from here had already closed before
     the first row asked for anything, and the section passed by failing
     nothing. */
  let failUntil = 0;
  const app2 = await bootApp({ apiBase: BASE, user: { name: 'A', email: 'a@x.com', ini: 'A' } });
  const p2 = app2.page;
  await p2.route('**/v1/connectors**', async (r) => {
    if (Date.now() < failUntil) return r.abort('failed');
    const u = new URL(r.request().url());
    const q = u.searchParams.get('q') || '';
    const want = Math.min(48, +u.searchParams.get('limit') || 5);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, cursor: '',
      servers: Array.from({ length: want }, (_, i) => ({
        id: 'io.github.acme' + i + '/' + q, name: q + '-' + i, by: 'acme',
        desc: 'd', version: '1', command: 'npx', args: ['-y', 'x'], env: [] })) }) });
  });
  await p2.route('**/v1/connector-logo**', (r) => r.fulfill({ status: 404, body: 'no logo' }));
  failUntil = Date.now() + 2500;
  await p2.evaluate((b) => {
    saveStr('amv_api_base', b); saveStr('amv_api_token', 'tok');
    saveStr('amv_token_exp', String(Date.now() + 3e6));
    setTab('integrations');
  }, BASE);

  /* Before the retry can have run, so the refusal is real rather than assumed
     - a check that only looks at the end cannot tell "recovered" from "never
     refused in the first place". */
  /* Sampled repeatedly rather than at one moment: the failures land, the
     retry fires 1.2s later, and a single snapshot can miss the window between
     them - which would make "it recovered" indistinguishable from "it never
     failed", the exact thing this section exists to tell apart. */
  let sawErrors = 0;
  for (let i = 0; i < 40; i++) {
    await p2.waitForTimeout(120);
    const e = await p2.evaluate(() => [...document.querySelectorAll('.cdir-row')]
      .filter(x => /could not be loaded/i.test(x.innerText)).length);
    sawErrors = Math.max(sawErrors, e);
  }
  const mid = { errored: sawErrors };

  await p2.waitForTimeout(6000);
  const end = await p2.evaluate(() => {
    const rows = [...document.querySelectorAll('.cdir-row')];
    return { rows: rows.length,
      errored: rows.filter(x => /could not be loaded/i.test(x.innerText)).map(x => x.dataset.cdirRow),
      filled: rows.filter(x => x.querySelectorAll('.cdir-tile').length > 0).length };
  });
  ok(mid.errored > 0, 'the refusals really were refused, not quietly absorbed', mid);
  ok(end.errored.length === 0,
     'and none of those rows is still telling the person it is broken', end.errored);
  ok(end.filled === end.rows && end.rows === 26, 'all of them fill in', end);
  await app2.close();
}

section('Every tile carries a logo, and the ones without fall back to a mark');
{
  const r = await page.evaluate(async () => {
    /* On screen, because the images are lazy - offscreen ones never load, by
       design, and counting those as failures would be measuring the feature. */
    const row = document.querySelector('.cdir-row');
    row.scrollIntoView({ block: 'center' });
    await new Promise(res => setTimeout(res, 1200));
    const tiles = [...row.querySelectorAll('.cdir-tile')];
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
  ok(r.imgs === r.tiles, 'every tile has a logo element', r);
  ok(r.loaded > 0, 'the ones with a real logo show it', r);
  /* THE DEFECT: a failed image left visible is a torn-page glyph over the
     mark, which is worse than the mark alone. */
  ok(r.visibleBroken === 0, 'and the ones without are hidden rather than left as a broken glyph', r);
  ok(r.hiddenAfterFail > 0, 'which really did happen, rather than every logo loading', r);
  ok(r.marks === r.tiles, 'with a letter behind each one to fall back to', r);
  ok(logoAsked.length > 0, 'and the logos came from AMV rather than from a third party',
     logoAsked.length);
}

section('See more opens the category at the top of it');
{
  const r = await page.evaluate(async () => {
    const sv = document.querySelector('#vc .sv');
    if (sv) sv.scrollTop = 1400;
    const before = sv ? sv.scrollTop : -1;
    document.querySelector('.cdir-more').click();
    await new Promise(res => setTimeout(res, 900));
    const sv2 = document.querySelector('#vc .sv');
    return { before, after: sv2 ? sv2.scrollTop : -1,
             full: !!document.querySelector('.cdir-full'),
             tiles: document.querySelectorAll('.cdir-full .cdir-tile').length };
  });
  ok(r.before > 500, 'pressed from a long way down the page', r.before);
  ok(r.full, 'the category opens as a page of its own', r);
  ok(r.after === 0, 'at the top of it, not wherever the last page was scrolled to', r);
  ok(r.tiles > 30, 'with far more than the five the row showed', r.tiles);
}

section('And going back does the same');
{
  const r = await page.evaluate(async () => {
    const sv = document.querySelector('#vc .sv');
    if (sv) sv.scrollTop = 1200;
    document.querySelector('.cdir-back').click();
    await new Promise(res => setTimeout(res, 800));
    const sv2 = document.querySelector('#vc .sv');
    return { after: sv2 ? sv2.scrollTop : -1, rows: document.querySelectorAll('.cdir-row').length };
  });
  ok(r.rows === 26 && r.after === 0, 'back lands on the categories, at the top', r);
}

ok(errors.length === 0, 'and the screen raised no errors', errors);
await app.close();
process.exit(report() === 0 ? (done(), 0) : 1);
