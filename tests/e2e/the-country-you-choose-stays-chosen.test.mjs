/* THE COUNTRY YOU CHOOSE STAYS CHOSEN, AND HAS A PAGE OF ITS OWN.

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
const topReady = (page) => page.waitForFunction(() => { const g = document.getElementById('cw-foryou');
  return g && !g.hasAttribute('aria-busy') && g.querySelectorAll('.cw-t10:not(.cw-t10-ph)').length === 5; }, null, { timeout: 15000 }).catch(() => {});
const listReady = (page) => page.waitForFunction(() => { const l = document.getElementById('cw-cp-list');
  return l && !l.querySelector('[aria-busy]') && l.querySelectorAll('.cw-job, .cw-lock-card, [data-dact="cwPeek"]').length > 0; }, null, { timeout: 15000 }).catch(() => {});
const head = (page) => page.evaluate(() => ((document.querySelector('#cw-foryou h3') || {}).textContent || '').replace(/\s+/g, ' ').trim());
const where = (page) => page.evaluate(() => ((document.getElementById('cw-where') || {}).textContent || '').replace(/\s+/g, ' ').trim());

section('Crew says where it thinks you are, at the top right');
const { ctx, page } = await open('ES');
await topReady(page);
{
  const r = await page.evaluate(() => {
    const b = document.getElementById('cw-where'), v = document.querySelector('#vc .vi') || document.getElementById('vc');
    const br = b.getBoundingClientRect(), vr = v.getBoundingClientRect();
    return { text: b.textContent.replace(/\s+/g, ' ').trim(), right: vr.right - br.right, top: br.top - vr.top, w: vr.width };
  });
  ok(/Not in Spain\?/.test(r.text), 'it names the network’s country, not the browser’s language - "' + r.text + '"', r.text);
  ok(r.right < 40 && r.top < 80, 'and it is at the top right of the page', r);
  ok(/Top 5 for you in .*Spain/.test(await head(page)), 'with the top five for Spain under it', await head(page));
  const n = await page.evaluate(() => document.querySelectorAll('#cw-foryou .cw-t10').length);
  ok(n === 5, 'five of them, as asked - ' + n, n);
  const banner = await page.evaluate(() => ((document.querySelector('.crew-jobs-sec .cw-nothere') || {}).textContent || '').replace(/\s+/g, ' '));
  ok(/Not on here\? Type it in the text box/.test(banner), 'and the line saying anything else goes in the box', banner);
}

section('It opens a page for choosing the country');
await page.click('#cw-where');
await settle(page);
{
  const r = await page.evaluate(() => ({ page: S.crewPage, n: document.querySelectorAll('#cw-cp-grid .cw-cpick').length,
    here: ((document.querySelector('.cw-cpick-here') || {}).closest ? document.querySelector('.cw-cpick-here').closest('.cw-cpick').dataset.darg : ''),
    selected: document.querySelectorAll('.cw-cpick.on').length, h2: (document.querySelector('.cw-cpage h2') || {}).textContent }));
  ok(r.page === 'countries' && r.n >= 100, 'a page of its own, with every country - ' + r.n, r);
  ok(r.here === 'ES' && r.selected === 0, 'Spain marked as where you are, and nothing marked chosen before anything is', r);
  await page.fill('#cw-cfind', 'jap');
  const vis = await page.evaluate(() => [...document.querySelectorAll('.cw-cpick')].filter(b => !b.hidden).map(b => b.dataset.darg));
  ok(vis.length === 1 && vis[0] === 'JP', 'searching narrows it to Japan', vis);
  await page.press('#cw-cfind', 'Enter');
}

section('Choosing a country opens its page: its five, then exactly a hundred');
await listReady(page);
await topReady(page);
{
  const r = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('#cw-cp-list [data-dact="cwPeek"]')].map(b => b.dataset.darg);
    const cards = [...new Set(ids)];
    const top = [...document.querySelectorAll('#cw-foryou [data-darg]')].map(b => b.dataset.darg);
    return { page: S.crewPage, saved: loadStr('amv_cw_country'), h2: (document.querySelector('.cw-cpage h2') || {}).textContent,
      banner: ((document.querySelector('.cw-cpage .cw-nothere') || {}).textContent || '').replace(/\s+/g, ' '),
      top: [...new Set(top)], cards, listHead: (document.querySelector('#cw-cp-list h3') || {}).textContent,
      boxFirst: !!document.querySelector('.cw-cpage .cw-nothere ~ .mc-cmd #mc-cmd-input') };
  });
  ok(r.page === 'country' && /Japan/.test(r.h2), 'Japan’s page - "' + r.h2 + '"', r.h2);
  ok(/Not on here\? Type it in the text box below/.test(r.banner) && /Only 100 jobs are shown/.test(r.banner),
     'the top of it says: not on here, type it in the box; only 100 shown', r.banner);
  ok(r.boxFirst, 'and the box it points at is right under that line', r.boxFirst);
  ok(r.top.length === 5, 'the top five', r.top);
  ok(r.cards.length === 100, 'exactly a hundred more, because the page says a hundred - ' + r.cards.length, r.cards.length);
  ok(!r.cards.some(id => r.top.includes(id)), 'none of them one of the five', r.cards.filter(id => r.top.includes(id)));
  ok(!r.cards.some(id => /^(cc|top)_[a-z]{2}_/.test(id) && !/^(cc|top)_jp_/.test(id)), 'and none written for another country',
     r.cards.filter(id => /^(cc|top)_[a-z]{2}_/.test(id) && !/^(cc|top)_jp_/.test(id)).slice(0, 3));
  ok(r.cards.filter(id => /^(cc|top)_jp_/.test(id)).length >= 50, 'most of them Japan’s own - ' + r.cards.filter(id => /^(cc|top)_jp_/.test(id)).length, null);
  ok(r.saved === 'JP', 'and choosing it kept it - saved on this device', r.saved);
  ok(/100 most used in Japan/.test(r.listHead), 'the list says what it is', r.listHead);
  /* The chips filter the hundred in place, and All puts them back. */
  const chip = await page.evaluate(() => { const c = [...document.querySelectorAll('#cw-cp-list .cw-chip')].find(c => c.dataset.darg !== 'all');
    const want = +c.querySelector('.cw-chip-n').textContent; c.click();
    const got = new Set([...document.querySelectorAll('#cw-cp-body [data-dact="cwPeek"]')].map(b => b.dataset.darg)).size;
    document.querySelector('#cw-cp-list .cw-chip[data-darg="all"]').click();
    const back = new Set([...document.querySelectorAll('#cw-cp-body [data-dact="cwPeek"]')].map(b => b.dataset.darg)).size;
    return { want, got, back }; });
  ok(chip.want === chip.got && chip.back === 100, 'a category shows its own count, and All shows the hundred again', chip);
}

section('Leaving the tab does not undo it');
await page.evaluate(() => setTab('chat'));
await settle(page);
await page.evaluate(() => setTab('crew'));
await topReady(page);
{
  ok(await page.evaluate(() => S.crewPage) === '', 'coming back opens Crew’s own page', await page.evaluate(() => S.crewPage));
  ok(/Japan/.test(await head(page)) && /Not in Japan\?/.test(await where(page)), 'and it is still Japan - "' + await where(page) + '"', await head(page));
}
await page.reload({ waitUntil: 'load' });
await topReady(page);
ok(/Japan/.test(await head(page)) && /Not in Japan\?/.test(await where(page)),
   'nor does a reload, although the network still says Spain', [await head(page), await where(page)]);

section('Changing it again changes it everywhere');
await page.click('#cw-where');
await settle(page);
await page.click('.cw-cpick[data-darg="MX"]');
await listReady(page);
ok(/Mexico/.test(await page.evaluate(() => document.querySelector('.cw-cpage h2').textContent)), 'Mexico’s page', null);
await page.evaluate(() => setTab('settings'));
await settle(page);
await page.evaluate(() => setTab('crew'));
await topReady(page);
ok(/Mexico/.test(await head(page)) && /Not in Mexico\?/.test(await where(page)), 'and Crew is Mexico’s from then on', await head(page));
{
  const r = await page.evaluate(() => ({ saved: loadStr('amv_cw_country'), sel: (() => { cwMoreCountries(); return [...document.querySelectorAll('.cw-cpick.on')].map(b => b.dataset.darg); })() }));
  ok(r.saved === 'MX' && r.sel.join() === 'MX', 'the countries page marks Mexico as chosen', r);
}

section('Back walks out the way you came in');
{
  await page.click('.cw-cpick[data-darg="JP"]');
  await listReady(page);
  await page.goBack();
  await settle(page, 500);
  const a = await page.evaluate(() => S.crewPage);
  await page.goBack();
  await settle(page, 500);
  const b = await page.evaluate(() => ({ p: S.crewPage, tab: S.tab }));
  ok(a === 'countries' && b.p === '' && b.tab === 'crew', 'country page, then the countries page, then Crew', { a, b });
  await page.evaluate(() => cwBrowse('JP'));
  await settle(page);
  await page.click('.cw-cpage [data-dact="cwBackMain"]');
  await settle(page);
  ok(await page.evaluate(() => S.crewPage) === '', '"Back to Crew" goes to Crew', null);
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
  await topReady(o.page);
  ok(/Kenya/.test(await head(o.page)), 'so Crew opens already for Kenya', await head(o.page));
  await o.ctx.close();
}

section('A slow answer is still used, not thrown away');
{
  WHERE_SLOW = 2600;
  const o = await open('NG', 1280, 'crew');
  await o.page.waitForFunction(() => { const g = document.querySelector('#cw-foryou h3'); return g && /Nigeria/.test(g.textContent); }, null, { timeout: 12000 }).catch(() => {});
  ok(/Nigeria/.test(await head(o.page)) && /Not in Nigeria\?/.test(await where(o.page)),
     'the network answered after the wait gave up, and the page moved to it - "' + await head(o.page) + '"', await where(o.page));
  WHERE_SLOW = 0;
  await o.ctx.close();
}

section('On a phone, both pages fit');
{
  const o = await open('ES', 390, 'crew');
  await topReady(o.page);
  const fits = async () => o.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok(await fits(), 'Crew', null);
  await o.page.click('#cw-where');
  await settle(o.page);
  ok(await fits(), 'the countries page', null);
  await o.page.click('.cw-cpick[data-darg="IN"]');
  await listReady(o.page);
  ok(await fits(), 'India’s page', null);
  const box = await o.page.evaluate(() => { const t = document.getElementById('mc-cmd-input'); return { h: t.offsetHeight, sh: (() => { t.value = t.placeholder; const s = t.scrollHeight; t.value = ''; return s; })() }; });
  ok(box.h >= box.sh, 'and the box shows its whole example, not half a line of it', box);
  await o.ctx.close();
}

ok(errors.length === 0, 'and nothing threw on the way', errors.slice(0, 3));
await browser.close(); api.close(); site.close();
if (report('the-country-you-choose-stays-chosen') > 0) process.exitCode = 1;
done();
