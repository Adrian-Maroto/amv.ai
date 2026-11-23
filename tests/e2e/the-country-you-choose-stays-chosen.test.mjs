/* THE COUNTRY YOU CHOOSE STAYS CHOSEN.

   (Its own pages became one picker on Nov 15, shared by Crew and Tasks, with
   Use my location - the owner's "not in this country? select your country".
   What this file holds is unchanged: choosing sticks.)

   Asked for: "put 'Not in the US?' on the top right and then it sends you to
   the page selecting countries. Then when you select you go to a new page and
   you see the top 5 in that country plus 100+ used options. And always on the
   top of the page put: if not on here type it in the text box (only showing
   100). Make sure when you select your country it stays - it doesn't auto go
   back to the original if you leave the tab. Same if you change it again. And
   when they first load AMV, have their location."

   The reported fault was real: choosing a country only BROWSED it unless a
   second button was pressed, so leaving the tab put somebody back where the
   network said they were. Measured with the real Worker behind a real server,
   told which country each request comes from, and a browser set to en-US so
   the language guess is always the United States - anything else on screen
   came from the network or from the choice. */
import { createServer } from 'http';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { LAUNCH } from '../lib/harness.mjs';
import { makeEnv, serveArtifact } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = (await import(join(ROOT, 'amv-backend.js') + '?stays=' + Date.now())).default;
const env = makeEnv({});
let FROM = 'ES', WHERE_SLOW = 0, whereAsked = 0;
const api = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  /* The browser's CORS preflight (OPTIONS) is not AMV asking - only GETs count. */
  if (req.url.startsWith('/v1/where') && req.method === 'GET') { whereAsked++; if (WHERE_SLOW) await new Promise(r => setTimeout(r, WHERE_SLOW)); }
  const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, String(v));
  const r0 = new Request('http://localhost:' + api.address().port + req.url, { method: req.method, headers,
    body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : Buffer.concat(chunks) });
  Object.defineProperty(r0, 'cf', { value: { country: FROM } });
  const r = await worker.fetch(r0, env, { waitUntil() {}, passThroughOnException() {} });
  const o = {}; r.headers.forEach((v, k) => { o[k] = v; }); res.writeHead(r.status, o); res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise(r => api.listen(0, r));
const site = await serveArtifact(0, 'http://localhost:' + api.address().port);
const SITE = 'http://localhost:' + site.address().port;
const browser = await chromium.launch(LAUNCH);
const errors = [];

async function open(from, width = 1280, hash = 'crew', ctx0 = null) {
  FROM = from;
  const phone = width === 390;
  const ctx = ctx0 || await browser.newContext({ viewport: { width, height: phone ? 844 : 1000 }, locale: 'en-US', hasTouch: phone, isMobile: phone });
  if (!ctx0) await ctx.addInitScript(() => { try { localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true })); } catch (e) {} });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(SITE + '/#/' + hash, { waitUntil: 'load' });
  return { ctx, page };
}
const settle = (page, ms = 300) => page.waitForTimeout(ms);
/* Crew is one page since Nov 15: the box, then "Jobs for <country>" with the
   country as a button beside it, which opens the one country picker (shared
   with Tasks, with Use my location). */
const listReady = (page) => page.waitForFunction(() => typeof _cjList === 'function' && document.querySelector('#cj-grid .cj-card'), null, { timeout: 15000 }).catch(() => {});
const head = (page) => page.evaluate(() => ((document.getElementById('cx-jobs-h') || {}).textContent || '').replace(/\s+/g, ' ').trim());
const where = (page) => page.evaluate(() => ((document.getElementById('cw-where') || {}).textContent || '').replace(/\s+/g, ' ').trim());
const pick = async (page, name) => {
  await page.click('#cw-where');
  await page.waitForSelector('#ccp-list', { timeout: 8000 });
  await page.fill('#ccp-q', name);
  await page.keyboard.press('Enter');
  await settle(page, 500);
  await listReady(page);
};

section('Crew says where it thinks you are, beside the list it is for');
const { ctx, page } = await open('ES');
await listReady(page);
await page.waitForFunction(() => /Spain/.test((document.getElementById('cx-jobs-h') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
{
  const r = await page.evaluate(() => {
    const b = document.getElementById('cw-where'), h = document.getElementById('cx-jobs-h');
    const br = b.getBoundingClientRect(), hr = h.getBoundingClientRect();
    return { text: b.textContent.replace(/\s+/g, ' ').trim(), sameRow: Math.abs((br.top + br.bottom) / 2 - (hr.top + hr.bottom) / 2) < 24,
             box: !!document.getElementById('mc-cmd-input') };
  });
  ok(/Spain/.test(r.text), 'it names the network’s country, not the browser’s language - "' + r.text + '"', r.text);
  ok(r.sameRow, 'on the row of the list it is for', r);
  ok(/Jobs for .*Spain/.test(await head(page)), 'and the list is Spain’s', await head(page));
  ok(r.box, 'with the box above it for anything that is not on the list', r.box);
}

section('It opens a picker with every country');
await page.click('#cw-where');
await page.waitForSelector('#ccp-list', { timeout: 8000 });
{
  const r = await page.evaluate(() => ({ n: document.querySelectorAll('#ccp-list [data-ccp]').length,
    cur: [...document.querySelectorAll('#ccp-list [data-ccp][aria-current="true"]')].map(b => b.dataset.ccp),
    loc: !!document.getElementById('ccp-loc') }));
  ok(r.n >= 100, 'every country - ' + r.n, r.n);
  ok(r.cur.length === 1 && r.cur[0] === 'ES', 'Spain marked as the one in use', r.cur);
  ok(r.loc, 'and Use my location beside the search', r.loc);
  await page.fill('#ccp-q', 'jap');
  const vis = await page.evaluate(() => [...document.querySelectorAll('#ccp-list [data-ccp]')].filter(b => !b.hidden).map(b => b.dataset.ccp));
  ok(vis.length === 1 && vis[0] === 'JP', 'searching narrows it to Japan', vis);
  await page.keyboard.press('Enter');
  await settle(page, 500);
  await listReady(page);
}

section('Choosing a country makes the list that country’s');
{
  await page.waitForFunction(() => /Japan/.test((document.getElementById('cx-jobs-h') || {}).textContent || '') && (_cwMadeMore('JP') || []).length >= 100, null, { timeout: 15000 }).catch(() => {});
  const r = await page.evaluate(() => {
    const ids = _cjList().map(j => j.id);
    const drawn = [...document.querySelectorAll('#cj-grid .cj-card-b')].map(b => b.dataset.darg);
    return { saved: loadStr('amv_cw_country'), open: !!document.getElementById('ccp-list'), ids, drawn };
  });
  ok(!r.open, 'the picker closes', r.open);
  ok(/Jobs for Japan/.test(await head(page)) && /Japan/.test(await where(page)), 'the list and the button say Japan', [await head(page), await where(page)]);
  ok(r.ids.filter(id => /^(cc|top)_jp_/.test(id)).length >= 100, 'a hundred or more of Japan’s own - ' + r.ids.filter(id => /^(cc|top)_jp_/.test(id)).length, null);
  ok(!r.ids.some(id => /^(cc|top)_[a-z]{2}_/.test(id) && !/^(cc|top)_jp_/.test(id)), 'and none written for another country',
     r.ids.filter(id => /^(cc|top)_[a-z]{2}_/.test(id) && !/^(cc|top)_jp_/.test(id)).slice(0, 3));
  ok(r.drawn.slice(0, 5).every(id => /^(cc|top|ev)_jp_/.test(id) || (_cwLocalJobs('JP') || []).some(j => j.id === id)), 'Japan’s own lead it', r.drawn.slice(0, 5));
  ok(r.saved === 'JP', 'and choosing it kept it - saved on this device', r.saved);
  /* A category narrows the list in place, and All puts it back. */
  const chip = await page.evaluate(async () => { const c = [...document.querySelectorAll('#cj-cats .cj-chip')].find(c => c.dataset.darg !== 'all' && c.dataset.darg !== 'popular');
    /* No totals on the chips since Nov 23: what a category holds is its jobs in the list. */
    const want = _cjList().filter(j => _cjCat(j) === c.dataset.darg).length; c.click(); await new Promise(r => setTimeout(r, 60));
    while (document.querySelector('#cj-grid .cj-more')) { document.querySelector('#cj-grid .cj-more').click(); await new Promise(r => setTimeout(r, 20)); }
    const got = document.querySelectorAll('#cj-grid .cj-card').length;
    document.querySelector('#cj-cats .cj-chip[data-darg="all"]').click(); await new Promise(r => setTimeout(r, 60));
    return { want, got, back: document.querySelectorAll('#cj-grid .cj-card').length, all: _cjList().length }; });
  ok(chip.want === chip.got && chip.back > 0 && chip.back < chip.all, 'a category shows its own count, and All shows the first rows again', chip);
}

section('Leaving the tab does not undo it');
await page.evaluate(() => setTab('chat'));
await settle(page);
await page.evaluate(() => setTab('crew'));
await listReady(page);
ok(/Japan/.test(await head(page)) && /Japan/.test(await where(page)), 'coming back, it is still Japan - "' + await where(page) + '"', await head(page));
await page.reload({ waitUntil: 'load' });
await listReady(page);
await settle(page, 600);
ok(/Japan/.test(await head(page)) && /Japan/.test(await where(page)),
   'nor does a reload, although the network still says Spain', [await head(page), await where(page)]);

section('Changing it again changes it everywhere');
await pick(page, 'mexico');
ok(/Mexico/.test(await head(page)), 'Mexico’s list', await head(page));
await page.evaluate(() => setTab('settings'));
await settle(page);
/* Tasks asks a visitor to sign up first, so here it is the one setting it
   reads that is checked; tasks-know-where-you-are opens Tasks itself. */
ok(await page.evaluate(() => _cwCountryGuess()) === 'MX', 'the country Tasks reads is Mexico too', await page.evaluate(() => _cwCountryGuess()));
await page.evaluate(() => setTab('crew'));
await listReady(page);
ok(/Mexico/.test(await head(page)) && /Mexico/.test(await where(page)), 'and Crew is Mexico’s from then on', await head(page));
{
  const r = await page.evaluate(async () => { cjCountry(); for (let i = 0; i < 40 && !document.getElementById('ccp-list'); i++) await new Promise(r => setTimeout(r, 50));
    const cur = [...document.querySelectorAll('#ccp-list [aria-current="true"]')].map(b => b.dataset.ccp); closeOvr(); return { saved: loadStr('amv_cw_country'), cur }; });
  ok(r.saved === 'MX' && r.cur.join() === 'MX', 'the picker marks Mexico as the one in use', r);
}

section('Closing the picker changes nothing');
{
  await page.click('#cw-where');
  await page.waitForSelector('#ccp-list', { timeout: 8000 });
  await page.keyboard.press('Escape');
  await settle(page);
  const r = await page.evaluate(() => ({ open: !!document.getElementById('ccp-list'), saved: loadStr('amv_cw_country') }));
  if (r.open) await page.click('#ccp-x');
  await settle(page);
  ok(!(await page.evaluate(() => !!document.getElementById('ccp-list'))) && r.saved === 'MX', 'it closes, and Mexico is still chosen', r);
}
await ctx.close();

section('Where somebody is, asked as AMV loads - not when Crew is opened');
{
  whereAsked = 0;
  const o = await open('KE', 1280, 'chat');
  await o.page.waitForFunction(() => { try { return _cwHere === 'KE'; } catch (e) { return false; } }, null, { timeout: 8000 }).catch(() => {});
  const r = await o.page.evaluate(() => ({ tab: S.tab, here: _cwHere }));
  ok(r.tab === 'chat' && r.here === 'KE' && whereAsked === 1, 'asked once, on the chat screen, before Crew was ever opened', { ...r, whereAsked });
  await o.page.evaluate(() => setTab('crew'));
  await listReady(o.page);
  ok(/Kenya/.test(await head(o.page)), 'so Crew opens already for Kenya', await head(o.page));
  await o.ctx.close();
}

section('A slow answer is still used, not thrown away');
{
  WHERE_SLOW = 2600;
  const o = await open('NG', 1280, 'crew');
  await o.page.waitForFunction(() => /Nigeria/.test((document.getElementById('cx-jobs-h') || {}).textContent || ''), null, { timeout: 12000 }).catch(() => {});
  ok(/Nigeria/.test(await head(o.page)) && /Nigeria/.test(await where(o.page)),
     'the network answered after the wait gave up, and the page moved to it - "' + await head(o.page) + '"', await where(o.page));
  WHERE_SLOW = 0;
  await o.ctx.close();
}

section('On a phone, it all fits');
{
  const o = await open('ES', 390, 'crew');
  await listReady(o.page);
  const fits = async () => o.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok(await fits(), 'Crew', null);
  await o.page.click('#cw-where');
  await o.page.waitForSelector('#ccp-list', { timeout: 8000 });
  ok(await fits(), 'the picker', null);
  await o.page.fill('#ccp-q', 'india');
  await o.page.keyboard.press('Enter');
  await settle(o.page, 500);
  await listReady(o.page);
  ok(await fits() && /India/.test(await head(o.page)), 'India’s list', await head(o.page));
  const box = await o.page.evaluate(() => { const t = document.getElementById('mc-cmd-input'); return { h: t.offsetHeight, sh: (() => { t.value = t.placeholder; const s = t.scrollHeight; t.value = ''; return s; })() }; });
  ok(box.h >= box.sh, 'and the box shows its whole example, not half a line of it', box);
  await o.ctx.close();
}

ok(errors.length === 0, 'and nothing threw on the way', errors.slice(0, 3));
await browser.close(); api.close(); site.close();
if (report('the-country-you-choose-stays-chosen') > 0) process.exitCode = 1;
done();
