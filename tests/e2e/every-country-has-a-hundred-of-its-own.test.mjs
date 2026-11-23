/* EVERY COUNTRY HAS A HUNDRED JOBS OF ITS OWN.

   Asked for: "make sure every country has 100+ most popular main jobs". Not a
   hundred generic jobs with the country's name pasted on - the jobs built from
   what the country actually runs on (its bank, its tax office, its exams, its
   job boards, its grocery chains), so the list a person in Mongolia browses is
   Mongolia's and the one in the United States is America's.

   Measured with the real Worker behind a real server, told where the request
   comes from. Crew's one list is counted job by job: how many are the
   country's own, that they lead, that none of another country's leak in, that
   none repeats, that the page does not move while they arrive, and that one
   of them opens and switches on for real. */
import { createServer } from 'http';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { LAUNCH } from '../lib/harness.mjs';
import { makeEnv, serveArtifact } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = (await import(join(ROOT, 'amv-backend.js') + '?hundred=' + Date.now())).default;
const env = makeEnv({});
let FROM = 'ES';
let SLOW = 0;
const created = [];
const api = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  if (SLOW && req.url.startsWith('/v1/everyday')) await new Promise(r => setTimeout(r, SLOW));
  if (req.url.startsWith('/auto/create')) { try { created.push(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) {} }
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

async function open(from, width = 1280) {
  FROM = from;
  const phone = width === 390;
  const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 1000 }, locale: 'en-US', hasTouch: phone, isMobile: phone });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true })); } catch (e) {}
    window.__cls = 0;
    /* WHAT moved, not only how much: a total of 0.0026 on a CI runner names
       nothing, and the next person guesses. Each shift keeps its elements and
       where they went from and to. */
    window.__clsSrc = [];
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) { window.__cls += e.value;
      window.__clsSrc.push(+e.value.toFixed(4) + ' @' + Math.round(e.startTime) + 'ms ' + (e.sources || []).map(x => {
        const n = x.node, id = n ? (n.id || (typeof n.className === 'string' ? n.className : n.nodeName)) : '?';
        return String(id).slice(0, 40) + ' ' + Math.round(x.previousRect.top) + '->' + Math.round(x.currentRect.top);
      }).join(' | ')); } }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  /* AMV_THROTTLE=4 runs it at a CI runner's pace, to reproduce what only
     shows up there. Off by default: the gate measures at full speed. */
  if (Number(process.env.AMV_THROTTLE) > 1) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.AMV_THROTTLE) });
  }
  await page.goto(SITE + '/#/crew', { waitUntil: 'load' });
  return { ctx, page };
}

/* What the list holds once the country is known: every job in it, in order,
   what is drawn, and the categories. Crew is one list now (Nov 15): the
   country's own lead it, the jobs that run anywhere follow, then the jobs
   built from the country's real services. */
async function catalogue(page, cc) {
  await page.waitForFunction((cc) => typeof _cjList === 'function' && _cwLocalState[cc] === 'ok'
      && (_cwMadeMore(cc) || []).length >= 100 && !!document.querySelector('#cj-grid .cj-card-b'), cc, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  /* Crew opens on Popular since Nov 23; the country's whole list is All. */
  await page.evaluate(() => { if (_cjC !== 'all') cjCat('all'); });
  await page.waitForTimeout(150);
  return page.evaluate(() => {
    const list = _cjList();
    return {
      ids: list.map(j => j.id), titles: list.map(j => j.title),
      cat: Object.fromEntries(list.map(j => [j.id, _cjCat(j)])),
      drawn: [...document.querySelectorAll('#cj-grid .cj-card-b')].map(b => b.getAttribute('data-darg')),
      uni: _cwUniversalJobs().map(j => j.id),
      cls: window.__cls, src: window.__clsSrc,
    };
  });
}

const NAMES = { ES: 'Spain', US: 'United States', MN: 'Mongolia', CN: 'China', JP: 'Japan', NG: 'Nigeria', IN: 'India' };
for (const [cc, width] of [['ES', 1280], ['US', 1280], ['MN', 1280], ['CN', 390], ['JP', 1280], ['NG', 390], ['IN', 1280]]) {
  section(NAMES[cc] + (width === 390 ? ', on a phone' : ''));
  const { ctx, page } = await open(cc, width);
  const low = cc.toLowerCase();
  const r = await catalogue(page, cc);
  const more = await page.evaluate((cc) => new Set((_cwMadeMore(cc) || []).map(j => j.id)).size, cc);
  ok(more >= 100, 'a hundred or more jobs made for ' + NAMES[cc] + ' - ' + more, more);
  const own = new Set(r.ids.filter(id => id.startsWith('cc_' + low + '_')));
  ok(own.size >= 100, 'the list holds them - ' + own.size + ' of the country’s own', own.size);
  ok(new Set(r.ids).size === r.ids.length, 'each once', r.ids.length);
  /* The country's own lead: what is drawn first is written or built for it,
     not the jobs that are the same everywhere. */
  const uni = new Set(r.uni);
  const lead = r.drawn.slice(0, 12).filter(id => uni.has(id));
  ok(lead.length === 0, 'the first cards are the country’s own', lead);
  ok(r.drawn.length > 0 && r.drawn.length <= 48, 'only the first rows are drawn - ' + r.drawn.length + ' cards', r.drawn.length);
  ok(r.ids.some(id => uni.has(id)), 'and the jobs that run on your accounts anywhere are in it too', '');
  const foreign = r.ids.filter(id => { const m = /^(top|cc|ev)_([a-z]{2})_/.exec(id); return m && m[2] !== low && m[2] !== 'ev'; });
  ok(foreign.length === 0, 'none written for another country', foreign.slice(0, 3));
  ok(!r.titles.some(t => /\{[A-Za-z0-9]\}|undefined|null/.test(t)), 'no unfilled blanks in any title', r.titles.filter(t => /\{[A-Za-z0-9]\}|undefined|null/.test(t)).slice(0, 3));
  ok(r.cls < 0.001, 'arriving without moving the page', { cls: +r.cls.toFixed(4), moved: r.src });
  await ctx.close();
}

section('When the country’s data arrives late, the list and its chips are redrawn together');
{
  /* The list draws first from what is already here, and the country's own
     arrive a moment later. The chips over it are counted from the same list,
     so they must be redrawn with it, or they say the old numbers and miss the
     categories only the country's own jobs fill. */
  SLOW = 1500;
  const { ctx, page } = await open('ES', 390);
  await catalogue(page, 'ES');
  SLOW = 0;
  const r = await page.evaluate(() => {
    const list = _cjList();
    const want = { all: list.length };
    list.forEach(j => { const c = _cjCat(j); want[c] = (want[c] || 0) + 1; });
    /* The chips carry no totals since Nov 23 (the owner asked for no big
       numbers); what each one holds is what pressing it shows. */
    const got = {};
    document.querySelectorAll('#cj-cats .cj-chip').forEach(c => { const k = c.dataset.darg; got[k] = k === 'all' ? list.length : k === 'popular' ? want[k] : list.filter(j => _cjCat(j) === k).length; });
    return { want, got, own: list.filter(j => /^cc_es_/.test(j.id)).length, cls: window.__cls, src: window.__clsSrc };
  });
  ok(r.own >= 100, 'Spain’s own arrived in the list', r.own);
  const wrong = Object.keys(r.want).filter(k => r.got[k] !== r.want[k]);
  ok(wrong.length === 0, 'every category has its chip', wrong.map(k => k + ': ' + r.got[k] + ' vs ' + r.want[k]));
  ok(r.cls < 0.001, 'and nothing on the screen moved', { cls: +r.cls.toFixed(4), moved: r.src });
  await ctx.close();
}

section('A category opens whole, through Show more');
{
  const { ctx, page } = await open('ES', 390);
  await catalogue(page, 'ES');
  const chip = await page.evaluate(() => {
    const c = [...document.querySelectorAll('#cj-cats .cj-chip')].filter(c => c.dataset.darg !== 'all')
      .filter(c => c.dataset.darg !== 'popular')
      .map(c => ({ cat: c.dataset.darg, n: _cjList().filter(j => _cjCat(j) === c.dataset.darg).length, h: Math.round(c.getBoundingClientRect().height) }))
      .sort((a, b) => b.n - a.n)[0];
    return c;
  });
  ok(chip && chip.n > 24, 'a category holds more than one screen', chip);
  ok(chip && chip.h >= 32, 'and its chip is big enough to press', chip && chip.h);
  await page.click('#cj-cats .cj-chip[data-darg="' + chip.cat + '"]');
  for (let i = 0; i < 400 && await page.$('#cj-grid .cj-more'); i++) { await page.click('#cj-grid .cj-more'); await page.waitForTimeout(30); }
  const after = await page.evaluate(() => ({
    cards: document.querySelectorAll('#cj-grid .cj-card').length,
    on: (document.querySelector('#cj-cats .cj-chip.on') || {}).dataset?.darg,
  }));
  ok(after.cards === chip.n, 'all ' + chip.n + ' are there', after.cards);
  ok(after.on === chip.cat, 'with the category’s chip marked', after.on);
  await ctx.close();
}

section('Each country’s own work is its own - Spain names Spain’s, the US names America’s');
{
  const es = await open('ES');
  const e = await catalogue(es.page, 'ES');
  const et = e.titles.slice(0, 200).join(' | ');
  ok(/Spain|Spanish|Hacienda|Mercadona|Renfe|Idealista|Selectividad|PAU|EvAU|InfoJobs|BBVA|Santander|CaixaBank/i.test(et), 'Spain’s list names Spain and its institutions', et.slice(0, 240));
  /* Spain's OWN jobs - written for it. The catalogue (ccj- ids) is the
     services people in Spain really visit, from the data, and walmart.com is
     among them; whether it had arrived when this read the list was timing,
     which made the line pass or fail by the millisecond. The catalogue is
     held to its data by its own suites; China's blocks are checked below on
     everything. */
  const own = e.titles.filter((t, i) => !/^ccj-/.test(e.ids[i])).join(' | ');
  ok(!/\bIRS\b|Walmart|Zillow/.test(own), 'and nothing American among its own jobs', own.match(/\bIRS\b|Walmart|Zillow/));
  await es.ctx.close();
  const cn = await open('CN');
  const c = await catalogue(cn.page, 'CN');
  const ct = c.titles.join(' | ');
  ok(!/Gmail|Google|\bIRS\b|Chase/.test(ct), 'China’s list names nothing it cannot use', ct.match(/Gmail|Google|\bIRS\b|Chase/));
  await cn.ctx.close();
}

section('One of them opens, and switches on for real');
{
  const { ctx, page } = await open('ES');
  const r = await catalogue(page, 'ES');
  const id = r.drawn.find(x => x.startsWith('cc_es_'));
  await page.click('#cj-grid .cj-card-b[data-darg="' + id + '"]');
  await page.waitForSelector('#ovr #cwp-cad', { timeout: 8000 }).catch(() => {});
  const dlg = await page.evaluate(() => ({ cad: !!document.querySelector('#ovr #cwp-cad'), text: ((document.getElementById('ovr') || {}).textContent || '').replace(/\s+/g, ' ') }));
  ok(dlg.cad, 'pressing the card opens what it does, with when it runs', dlg.text.slice(0, 200));
  await page.keyboard.press('Escape');
  /* Switched on through the Worker, as a signed-in person on the plan Crew
     needs - on it for real, the way a verified payment leaves it, because the
     page's own check puts a plan set only in the browser back to free. */
  await env.AMV_KV.put('ent:hundred@example.com', JSON.stringify({ plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  const signed = await page.evaluate(async () => {
    try { const d = await AMV_API.signup('hundred@example.com', 'Hundred', 'A-real-Passw0rd!'); loginUser((d && d.user) || { name: 'Hundred', email: 'hundred@example.com', ini: 'H' }); return 'ok'; }
    catch (e) { return String(e && e.message); }
  });
  ok(signed === 'ok', 'signed up', signed);
  await page.waitForTimeout(300);
  await page.evaluate(() => { saveStr('amv_plan', 'pro'); setTab('crew'); });
  const sel = '#cj-grid .cw-toggle[data-darg="' + id + '"]';
  await page.waitForSelector(sel, { timeout: 15000 }).catch(() => {});
  const before = created.length;
  await page.click(sel);
  const box = await page.waitForSelector('#ovr input:not([type=time]), #ovr textarea', { timeout: 5000 }).catch(() => null);
  if (box) { await box.fill('Valencia'); await page.click('#ovr button.bp'); }
  for (let i = 0; i < 40 && created.length === before; i++) await page.waitForTimeout(150);
  const c = created[created.length - 1] || {};
  ok(created.length > before, 'the Worker is asked to create it', created.length - before);
  ok(c.country === 'ES' && c.srcId === id, 'for Spain, counted as this job', { country: c.country, srcId: c.srcId, id });
  ok(/Spain/.test(c.detail || '') && /never invent/.test(c.detail || ''), 'with an instruction that knows where it is and forbids inventing', String(c.detail || '').slice(0, 160));
  await ctx.close();
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await browser.close(); site.close(); api.close();
report();
done();
