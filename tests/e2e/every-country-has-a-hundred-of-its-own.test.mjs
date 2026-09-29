/* EVERY COUNTRY HAS A HUNDRED JOBS OF ITS OWN.

   Asked for: "make sure every country has 100+ most popular main jobs". Not a
   hundred generic jobs with the country's name pasted on - the jobs built from
   what the country actually runs on (its bank, its tax office, its exams, its
   job boards, its grocery chains), so the list a person in Mongolia browses is
   Mongolia's and the one in the United States is America's.

   Measured with the real Worker behind a real server, told where the request
   comes from. The list below the top ten is counted card by card: how many are
   the country's own, that they lead, that none of another country's leak in,
   that nothing at the top of the page is repeated, that the page does not move
   while they arrive, and that one of them opens and switches on for real. */
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

/* What the catalogue holds once the country is known: every card's job id,
   in order, and the ids already shown in the top ten and the made-for row. */
async function catalogue(page, cc) {
  const low = cc.toLowerCase();
  await page.waitForFunction((low) => {
    const g = document.getElementById('cw-foryou');
    return g && !g.hasAttribute('aria-busy')
      && document.querySelectorAll('#cw-jobs-body .cw-job-body[data-darg^="cc_' + low + '_"]').length >= 20;
  }, low, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  return page.evaluate(() => ({
    ids: [...document.querySelectorAll('#cw-jobs-body .cw-job-body')].map(b => b.getAttribute('data-darg')),
    titles: [...document.querySelectorAll('#cw-jobs-body .cw-job-t')].map(t => t.textContent),
    groups: [...document.querySelectorAll('#cw-jobs-body .cw-cat')].map(g => [...g.querySelectorAll('.cw-job-body')].map(b => b.getAttribute('data-darg'))),
    catOf: Object.fromEntries(_cwShowcase().map(j => [j.id, j.cat])),
    top: [...document.querySelectorAll('#cw-foryou [data-darg], #cw-madefor [data-darg]')].map(b => b.getAttribute('data-darg')),
    cls: window.__cls,
  }));
}

/* Every card the category views hold, category by category - the whole pool,
   which All only previews. Pressed through the chips, the way a person would. */
async function everyCategory(page) {
  const cats = await page.evaluate(() => [...document.querySelectorAll('.cw-chip')].map(c => c.dataset.darg).filter(c => c && c !== 'all'));
  const ids = [];
  for (const c of cats) {
    await page.evaluate((c) => cwCat(c), c);
    ids.push(...await page.evaluate(() => [...document.querySelectorAll('#cw-jobs-body .cw-job-body')].map(b => b.getAttribute('data-darg'))));
  }
  await page.evaluate(() => cwCat('all'));
  return ids;
}

const NAMES = { ES: 'Spain', US: 'United States', MN: 'Mongolia', CN: 'China', JP: 'Japan', NG: 'Nigeria', IN: 'India' };
for (const [cc, width] of [['ES', 1280], ['US', 1280], ['MN', 1280], ['CN', 390], ['JP', 1280], ['NG', 390], ['IN', 1280]]) {
  section(NAMES[cc] + (width === 390 ? ', on a phone' : ''));
  const { ctx, page } = await open(cc, width);
  const low = 'cc_' + cc.toLowerCase() + '_';
  const r = await catalogue(page, cc);
  const top = new Set(r.top);
  const more = await page.evaluate((cc) => new Set((_cwMadeMore(cc) || []).map(j => j.id)).size, cc);
  ok(more >= 100, 'a hundred or more jobs made for ' + NAMES[cc] + ', before the top ten - ' + more, more);
  const pool = await everyCategory(page);
  const own = new Set(pool.filter(id => id.startsWith(low)));
  ok(own.size >= 100, 'the categories hold them - ' + own.size + ' of the country’s own, besides the top of the page', own.size);
  ok(new Set(pool).size === pool.length, 'each in one category only', pool.length);
  /* Only where a category has both kinds to show - Inbox & calendar is all
     connected-account work, and a country's own jobs are never about a mailbox. */
  const both = new Set(pool.filter(id => id.startsWith(low)).map(id => r.catOf[id]).filter(Boolean));
  const mixed = r.groups.filter(g => g.length >= 4 && r.catOf[g.find(id => !id.startsWith(low))] && both.has(r.catOf[g[0]])
    && !(g.some(id => id.startsWith(low)) && g.some(id => !/^cc_/.test(id))));
  /* And alternated: never three of one kind in a row while the other kind
     still has cards to show in that category. */
  const alt = r.groups.filter(g => {
    const k = g.map(id => id.startsWith(low) ? 'o' : 'e').join('');
    return both.has(r.catOf[g[0]]) && /ooo|eee/.test(k.slice(0, Math.min(k.length, 2 * Math.min((k.match(/o/g) || []).length, (k.match(/e/g) || []).length))));
  });
  ok(mixed.length === 0 && alt.length === 0, 'the first cards of each category are both the country’s own and the ones that run on your accounts', mixed.slice(0, 1));
  ok(r.ids.length <= 120, 'All is a shelf, not a wall - ' + r.ids.length + ' cards', r.ids.length);
  ok(!pool.some(id => /^cc_[a-z]{2}_/.test(id) && !id.startsWith(low)), 'none written for another country', pool.filter(id => /^cc_[a-z]{2}_/.test(id) && !id.startsWith(low)).slice(0, 3));
  ok(!pool.some(id => top.has(id)), 'nothing already at the top of the page repeated below it', pool.filter(id => top.has(id)).slice(0, 3));
  ok(!r.titles.some(t => /\{[A-Za-z0-9]\}|undefined|null/.test(t)), 'no unfilled blanks in any title', r.titles.filter(t => /\{[A-Za-z0-9]\}|undefined|null/.test(t)).slice(0, 3));
  ok(r.cls < 0.001, 'arriving without moving the page', +r.cls.toFixed(4));
  await ctx.close();
}

section('When the country\u2019s data arrives late, the list and its chips are redrawn together');
{
  /* The list draws first from the jobs that are the same everywhere, and the
     country's own arrive a moment later. On a phone the list is below the
     fold then, so it is re-ranked in place - and the chips over it are counted
     from the same list, so they must be redrawn with it, or they say the old
     numbers and miss the categories only the country's own jobs fill. */
  SLOW = 1500;
  const { ctx, page } = await open('ES', 390);
  await page.waitForFunction(() => document.querySelectorAll('#cw-jobs-body .cw-job-body[data-darg^="cc_es_"]').length >= 20, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  SLOW = 0;
  const r = await page.evaluate(() => {
    const pool = _cwShowcase();
    const want = { all: pool.length };
    pool.forEach(j => { want[j.cat] = (want[j.cat] || 0) + 1; });
    const got = {};
    document.querySelectorAll('.cw-chip').forEach(c => { got[c.dataset.darg] = Number((c.querySelector('.cw-chip-n') || {}).textContent); });
    return { want, got, own: document.querySelectorAll('#cw-jobs-body .cw-job-body[data-darg^="cc_es_"]').length, cls: window.__cls, src: window.__clsSrc };
  });
  ok(r.own >= 20, 'Spain\u2019s own arrived in the list', r.own);
  const wrong = Object.keys(r.want).filter(k => r.got[k] !== r.want[k]);
  ok(wrong.length === 0, 'every chip counts the list under it, and every category has its chip', wrong.map(k => k + ': ' + r.got[k] + ' vs ' + r.want[k]));
  ok(r.cls < 0.001, 'and nothing on the screen moved', { cls: +r.cls.toFixed(4), moved: r.src });
  await ctx.close();
}

section('See all opens the whole category, at its top');
{
  const { ctx, page } = await open('ES', 390);
  await catalogue(page, 'ES');
  const before = await page.evaluate(() => {
    const b = document.querySelector('#cw-jobs-body .cw-cat-more .int-seemore');
    const cat = b && b.dataset.darg;
    const shown = b ? b.closest('.cw-cat').querySelectorAll('.cw-job').length : 0;
    const n = b ? Number((b.textContent.match(/\d+/) || [0])[0]) : 0;
    return { cat, shown, n, h: b ? Math.round(b.getBoundingClientRect().height) : 0 };
  });
  ok(before.cat && before.n > before.shown, 'a category shows a few and says how many there are', before);
  ok(before.h >= 32, 'and See all is big enough to press', before.h);
  await page.click('#cw-jobs-body .cw-cat-more .int-seemore');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    cards: document.querySelectorAll('#cw-jobs-body .cw-job').length,
    chip: (document.querySelector('.cw-chip.on') || {}).dataset?.darg,
    chipTop: Math.round((document.querySelector('.cw-chips') || document.body).getBoundingClientRect().top),
    more: document.querySelectorAll('#cw-jobs-body .cw-cat-more').length,
  }));
  ok(after.cards === before.n, 'all ' + before.n + ' are there', after.cards);
  ok(after.chip === before.cat, 'with the category’s chip marked', after.chip);
  ok(after.chipTop >= 0 && after.chipTop < 300, 'opened at its top, not scrolled past it', after.chipTop);
  ok(after.more === 0, 'and no See all inside a category that is already whole', after.more);
  await ctx.close();
}

section('Each country’s own work is its own - Spain names Spain’s, the US names America’s');
{
  const es = await open('ES');
  const e = await catalogue(es.page, 'ES');
  const et = e.titles.join(' | ');
  ok(/Spain|Spanish|Hacienda|Mercadona|Renfe|Idealista|Selectividad|PAU|EvAU|InfoJobs|BBVA|Santander|CaixaBank/i.test(et), 'Spain’s list names Spain and its institutions', et.slice(0, 240));
  ok(!/\bIRS\b|Walmart|Zillow/.test(et), 'and nothing American', et.match(/\bIRS\b|Walmart|Zillow/));
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
  const id = r.ids.find(x => x.startsWith('cc_es_'));
  await page.click('#cw-jobs-body .cw-job-body[data-darg="' + id + '"]');
  await page.waitForFunction(() => /How often/.test((document.getElementById('ovr') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const dlg = await page.evaluate(() => ((document.getElementById('ovr') || {}).textContent || '').replace(/\s+/g, ' '));
  ok(/How often/.test(dlg), 'pressing the card opens what it does', dlg.slice(0, 200));
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
  const sel = '#cw-jobs-body .cw-toggle[data-darg="' + id + '"]';
  await page.waitForSelector(sel, { timeout: 15000 }).catch(() => {});
  const before = created.length;
  await page.click(sel);
  const box = await page.waitForSelector('#ovr input, #ovr textarea', { timeout: 5000 }).catch(() => null);
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
