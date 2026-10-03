/* THE HUNDRED IS WHAT IS USED THERE.

   Asked for: "the top 5 most popular and the other 100 below it also have to
   be the most popular" - for that country.

   What it replaced was not a ranking at all: the catalogue in CATEGORY order,
   cut at a hundred - so every country's hundred was twenty work jobs and
   sixty-four home jobs, in the same order everywhere, and no money, school,
   health or family job ever reached the page. This measures the hundred for
   all 105 countries with the real Worker behind a real server, then checks
   that what the research says matters in a country leads it there and nowhere
   else, and that a real count of what people start beats the research. */
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { LAUNCH } from '../lib/harness.mjs';
import { makeEnv, serveArtifact } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = (await import(join(ROOT, 'amv-backend.js') + '?hundred-used=' + Date.now())).default;
const env = makeEnv({});
const api = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, String(v));
  const r0 = new Request('http://localhost:' + api.address().port + req.url, { method: req.method, headers,
    body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : Buffer.concat(chunks) });
  Object.defineProperty(r0, 'cf', { value: { country: 'US' } });
  const r = await worker.fetch(r0, env, { waitUntil() {}, passThroughOnException() {} });
  const o = {}; r.headers.forEach((v, k) => { o[k] = v; }); res.writeHead(r.status, o); res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise(r => api.listen(0, r));
const site = await serveArtifact(0, 'http://localhost:' + api.address().port);
const browser = await chromium.launch(LAUNCH);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
await ctx.addInitScript(() => { try { localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true })); } catch (e) {} });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:' + site.address().port + '/#/crew', { waitUntil: 'load' });
await page.waitForTimeout(800);

/* Every country's hundred, computed the way its page computes it. */
const hundredOf = (codes) => page.evaluate(async (codes) => {
  const out = {};
  for (const cc of codes) {
    await _cwLoadLocal(cc);
    for (let i = 0; i < 100 && _cwLocalState[cc] === 'loading'; i++) await new Promise(r => setTimeout(r, 20));
    const L = _cwCountryHundred(cc);
    const by = {}; L.forEach(j => { by[j.cat] = (by[j.cat] || 0) + 1; });
    out[cc] = { n: L.length, ids: L.map(j => j.id), kinds: L.map(j => _cwKind(j)), titles: L.map(j => j.title), by,
                top: (_cwTopTen(cc) || []).slice(0, 5).map(j => j.id), topTitles: (_cwTopTen(cc) || []).slice(0, 5).map(j => j.title) };
  }
  return out;
}, codes);

section('Every country: a hundred, from every part of life');
const codes = await page.evaluate(() => CW_WORLD_COUNTRIES.map(c => c[0]));
const all = await hundredOf(codes);
{
  const short = codes.filter(cc => all[cc].n !== 100);
  ok(short.length === 0, 'all ' + codes.length + ' countries have exactly a hundred', short.map(cc => cc + ':' + all[cc].n));
  const dup = codes.filter(cc => new Set(all[cc].ids).size !== all[cc].ids.length);
  ok(dup.length === 0, 'none with a job twice', dup);
  const repeatTop = codes.filter(cc => all[cc].ids.some(id => all[cc].top.includes(id)));
  ok(repeatTop.length === 0, 'none repeating one of its top five', repeatTop);
  /* ev_ev_* are the everyday jobs that are the same everywhere, not a country called "ev". */
  const other = (cc) => all[cc].ids.filter(id => { const m = /^(cc|top|ev)_([a-z]{2})_/.exec(id); return m && m[2] !== 'ev' && m[2] !== cc.toLowerCase(); });
  const foreign = codes.filter(cc => other(cc).length);
  ok(foreign.length === 0, 'none holding another country’s job', foreign.map(cc => cc + ':' + other(cc).slice(0, 2)).slice(0, 3));
  const narrow = codes.filter(cc => Object.keys(all[cc].by).length < 6);
  ok(narrow.length === 0, 'every one spans at least six parts of life - not twenty kinds of grocery list', narrow.map(cc => cc + ':' + JSON.stringify(all[cc].by)).slice(0, 3));
  const heavy = codes.filter(cc => Object.values(all[cc].by).some(n => n > 25));
  ok(heavy.length === 0, 'and no part of life takes more than a quarter', heavy.map(cc => cc + ':' + JSON.stringify(all[cc].by)).slice(0, 3));
  const money = codes.filter(cc => !(all[cc].by.Money >= 10));
  ok(money.length === 0, 'money is there in every country (it was 4 of 100 everywhere)', money.slice(0, 5));
  const same = new Set(codes.map(cc => all[cc].kinds.slice(0, 12).join())).size;
  ok(same > codes.length * 0.6, 'and the order differs by country - ' + same + ' different openings across ' + codes.length, same);
}

section('What the research says matters there leads there');
const rank = (cc, kind) => all[cc].kinds.indexOf(kind);
ok(rank('KE', 'limits') >= 0 && rank('KE', 'limits') < 10,
   'Kenya: M-Pesa’s limits and fees in the first ten (Global Findex 2025: 87% of adults)', rank('KE', 'limits'));
ok(rank('MX', 'remit') >= 0 && rank('MX', 'remit') < 5, 'Mexico: remittances in the first five', rank('MX', 'remit'));
/* The train is a part of life with its own row in the top five - where the
   research says people live on trains, it is IN the top five. */
ok(all.JP.top.includes('cc_jp_rail'), 'Japan: the train is one of its top five (UIC)', all.JP.top);
ok(all.CH.top.includes('cc_ch_rail'), 'Switzerland too', all.CH.top);
ok(!all.US.top.includes('cc_us_rail'), 'and not in the United States', all.US.top);
ok(rank('AR', 'staples') >= 0 && rank('AR', 'staples') < 5, 'Argentina: staple prices first (IAS 29 hyperinflation list)', rank('AR', 'staples'));
ok(rank('VE', 'parallel') >= 0 && rank('AR', 'parallel') < 0,
   'the parallel rate where the gap is still real (Venezuela), not where the 2025 reform closed it (Argentina)', [rank('VE', 'parallel'), rank('AR', 'parallel')]);
ok(rank('PK', 'prayer') >= 0 && rank('PK', 'loadshedding') >= 0 && rank('PK', 'loadshedding') < 5, 'Pakistan: prayer times, and load-shedding in the first five', [rank('PK', 'prayer'), rank('PK', 'loadshedding')]);
ok(rank('IN', 'gold') >= 0 && rank('IN', 'gold') < 25, 'India: the gold price (World Gold Council)', rank('IN', 'gold'));
ok(rank('ET', 'farm') >= 0 && rank('ET', 'farm') < 25, 'Ethiopia: crop and livestock prices (World Bank)', rank('ET', 'farm'));
{
  /* 476 days without load-shedding by September 2026: no load-shedding row
     is added for South Africa, and its own pack spends the slot on SASSA's
     grant dates (about 26 million recipients) rather than a schedule that has
     not run since 2024. Its power and water cuts are the everyday row, once. */
  const za = all.ZA.titles.concat(all.ZA.topTitles || []);
  const cuts = za.filter(t => /load.?shedding|power (?:and water )?cuts?/i.test(t));
  ok(cuts.length === 1 && !/load.?shedding/i.test(cuts[0]) && za.some(t => /SASSA/.test(t)),
     'South Africa: power and water cuts once, no load-shedding schedule, and SASSA’s grant dates', { cuts, sassa: za.filter(t => /SASSA/.test(t)) });
  ok(rank('BD', 'loadshedding') >= 0 && rank('MM', 'loadshedding') >= 0, 'and power cuts where they are scheduled in 2026 (Bangladesh, Myanmar)', [rank('BD', 'loadshedding'), rank('MM', 'loadshedding')]);
  const us = ['prayer', 'loadshedding', 'parallel', 'bundles', 'farm'].filter(k => rank('US', k) >= 0);
  ok(us.length === 0, 'and none of that in the United States', us);
  ok(rank('US', 'remit') < 0 || rank('US', 'remit') > 60, 'where sending money abroad is not near the top', rank('US', 'remit'));
}

section('Every research list names countries AMV covers, and says what the source says');
{
  const r = await page.evaluate(() => {
    const known = new Set(CW_WORLD_COUNTRIES.map(c => c[0]));
    const lists = CW_POP_BOOST.map(b => [b[0], b[1]]).concat(Object.entries(CW_SIGNAL));
    const bad = lists.flatMap(([n, w]) => w.split(' ').filter(cc => !known.has(cc)).map(cc => n + ':' + cc));
    const has = (n, cc) => (lists.find(l => l[0] === n) || ['', ''])[1].split(' ').includes(cc);
    return { bad, gulfCar: has('CAR', 'SA') || has('CAR', 'AE'), nzCar: has('CAR', 'NZ') && has('CAR', 'PL'),
             krRail: has('RAIL', 'KR'), ruRail: has('RAIL', 'RU'), keRemit: has('REMIT', 'KE'), cnRemit: has('REMIT', 'CN'),
             zaPower: has('POWER', 'ZA'), lbPar: has('PARALLEL', 'LB'), gbHouse: has('HOUSE', 'GB'), ptHouse: has('HOUSE', 'PT'),
             bdFarm: has('FARM', 'BD'), mzFarm: has('FARM', 'MZ') };
  });
  ok(r.bad.length === 0, 'no list names a country code AMV does not have (a typo would boost nobody, silently)', r.bad);
  ok(!r.gulfCar && r.nzCar, 'cars: OICA’s ten (New Zealand, Poland...), not a guess about the Gulf', r);
  ok(!r.krRail && r.ruRail, 'rail: per-person kilometres and the four largest networks, nothing unsourced', r);
  ok(!r.keRemit && r.cnRemit, 'remittances: the World Bank’s ten largest and 10% of GDP - China in, Kenya (4%) out', r);
  ok(!r.zaPower && !r.lbPar, 'power cuts and parallel rates as they are in 2026, not as they were', r);
  ok(r.ptHouse && !r.gbHouse && r.mzFarm && !r.bdFarm, 'housing (OECD index) and farming (ILO, 40%) by their stated thresholds', r);
}

section('A fuel price is named by the day it is set there');
{
  const r = await page.evaluate(() => {
    const fw = CW_SIGNAL.FUELWEEK.split(' ');
    const missing = fw.filter(cc => !CW_FUEL_CYCLE[cc]).concat(Object.keys(CW_FUEL_CYCLE).filter(cc => !fw.includes(cc)));
    const t = cc => ((_cwMadeMore(cc).find(j => _cwKind(j) === 'fuelweek')) || {});
    return { missing, ke: t('KE').title || '', vn: t('VN').title || '', kep: t('KE').prompt || '', us: t('US').title || '' };
  });
  ok(r.missing.length === 0, 'every country with a published fuel cycle says what it is, and no cycle is for a country off the list', r.missing);
  ok(/14th/.test(r.ke) && /Thursday/.test(r.vn) && !/\{cycle\}/.test(r.ke + r.kep), 'Kenya’s on the 14th, Viet Nam’s every Thursday - not “next week” everywhere', [r.ke, r.vn]);
  ok(r.us === '', 'and none where the price is not set by anybody on a schedule', r.us);
}

section('No country is described by a name that has been retired');
{
  /* Each of these was in the facts, and each stopped being true: the name a
     job shows is the one a person searches for in their inbox, so a retired
     one finds nothing. [country, field, what was retired, what replaced it]. */
  const RETIRED = [
    ['NG', 'tax', /^the FIRS/, 'the Nigeria Revenue Service, from 1 January 2026'],
    ['BH', 'banks', /Ahli United/, 'Kuwait Finance House - Bahrain'],
    ['DK', 'telco', /Telia/, 'Norlys, which bought Telia Denmark in 2024'],
    ['GH', 'food', /Glovo/, 'Glovo left Ghana'],
    ['BG', 'food', /foodpanda/, 'Glovo since 2021'],
    ['BG', 'cur', /BGN/, 'the euro, from 1 January 2026'],
    ['AR', 'tax', /^AFIP/, 'ARCA'],
  ];
  const r = await page.evaluate(async (rows) => {
    const out = [];
    for (const [cc, k, src] of rows) { await _cwLoadLocal(cc); out.push([cc, k, String((_cwFacts[cc] || {})[k] || '')]); }
    const titles = {}; for (const cc of ['AR', 'ZA', 'GH', 'EE', 'PT', 'RU', 'NZ', 'NO']) { await _cwLoadLocal(cc); for (let i = 0; i < 100 && _cwLocalState[cc] === 'loading'; i++) await new Promise(r => setTimeout(r, 20)); titles[cc] = (_cwLocalJobs(cc) || []).map(j => j.title); }
    return { facts: out, titles };
  }, RETIRED.map(r => [r[0], r[1], r[2].source]));
  const stale = r.facts.filter(([cc, k, v], i) => !v || RETIRED[i][2].test(v)).map(([cc, k, v], i) => cc + '.' + k + '=' + v);
  ok(stale.length === 0, 'none of the retired names is back, and none of the fields is empty', stale);
  ok(r.titles.AR.some(t => /ARCA/.test(t)) && !r.titles.AR.some(t => /^AFIP/.test(t)), 'Argentina’s tax job is titled for ARCA', r.titles.AR);
  ok(r.titles.GH.some(t => /E-Levy/.test(t)), 'Ghana’s mobile money job looks for the E-Levy taken after its repeal (Act 1128, 2 April 2025)', r.titles.GH);
  ok(r.titles.EE.some(t => /€700/.test(t)), 'Estonia: the flat €700 exemption of 2026, not the sliding one it replaced', r.titles.EE);
  ok(!r.titles.PT.some(t => /birthday/i.test(t)), 'Portugal: IUC falls in the car’s registration month, not the owner’s birthday', r.titles.PT);
  /* The instruction each job runs on stays on the server; read it there. */
  const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'amv-backend.js'), 'utf8');
  const job = id => { const i = SRC.indexOf("{ id: '" + id + "'"); return i < 0 ? '' : SRC.slice(i, SRC.indexOf('},', i)); };
  ok(!/half price/i.test(job('ru_shtrafy')) && /as the notice or Gosuslugi states/.test(job('ru_shtrafy')), 'Russia: no promise of half price - the notice states the rate', job('ru_shtrafy').slice(0, 120));
  ok(/260\.72/.test(job('nz_kiwisaver')) && /3\.5%/.test(job('nz_kiwisaver')), 'New Zealand: the 2025 government contribution and the 3.5% default from April 2026', job('nz_kiwisaver').slice(0, 120));
  ok(/Norgespris/.test(job('no_strom')), 'Norway: the fixed Norgespris next to strømstøtte', job('no_strom').slice(0, 120));
}

section('Nothing on a country\u2019s page is called something it could be called anywhere');
{
  /* Asked for: "nothing is generic". Measured before: 65 of every 105 titles
     on a country's page named nothing of the country. A title counts as local
     when it names the country, its currency, one of its mailboxes, or any of
     its facts (its tax office, networks, weather service...). */
  const r = await page.evaluate(() => {
    const per = {};
    for (const cc of CW_WORLD_COUNTRIES.map(c => c[0])) {
      const f = _cwFacts[cc] || {}, C = _cwCountryRow(cc)[1];
      const names = [C, f.cur].concat((_cwInbox[cc] || []).map(b => b.name), ['Google Calendar', 'Outlook Calendar', 'Google Classroom'])
        .concat(Object.values(f).flatMap(v => String(v).split(/[(),·/]| and /).map(x => x.trim()).filter(x => x.length > 2))).filter(Boolean);
      const L = _cwTopTen(cc).slice(0, 5).concat(_cwCountryHundred(cc));
      /* The pack written by hand for a country is in its own words - often its
         own script - so it is local by construction. */
      per[cc] = L.filter(j => !/^ev_(?!ev_)/.test(j.id) && !names.some(n => (j.title || '').includes(n))).map(j => j.title);
    }
    const n = Object.values(per).map(x => x.length);
    const one = (cc, kind) => (_cwMadeMore(cc).concat(_cwTopTen(cc)).find(j => _cwKind(j) === kind) || {}).title || '';
    return { avg: n.reduce((a, b) => a + b, 0) / n.length, max: Math.max(...n), worst: Object.entries(per).sort((a, b) => b[1].length - a[1].length)[0],
             jpWeather: one('JP', 'dailyweather'), usPhone: one('US', 'phoneplan'), krJobs: (_cwCountryHundred('KR').find(j => j.id === 'job_hunt') || {}).title || '',
             cnInbox: (_cwCountryHundred('CN').find(j => j.id === 'inbox_digest') || {}).title || '' };
  });
  ok(r.avg < 8 && r.max <= 12, 'at most a handful of 105 per country name nothing local - ' + r.avg.toFixed(1) + ' on average, ' + r.max + ' at most', r.worst);
  ok(/Japan Meteorological Agency/.test(r.jpWeather), 'Japan\u2019s weather comes from its weather service', r.jpWeather);
  ok(/Verizon/.test(r.usPhone), 'the United States\u2019 phone plan names its networks', r.usPhone);
  ok(r.krJobs === '' || /Saramin|JobKorea|Wanted|LinkedIn/.test(r.krJobs), 'Korea\u2019s job hunt names its job sites', r.krJobs);
  ok(r.cnInbox === '' || /QQ/.test(r.cnInbox), 'and China\u2019s inbox digest names the inbox people there use', r.cnInbox);
}

section('The base order is published data, not a guess');
{
  const r = await page.evaluate(() => ({ g: CW_GWI, groc: CW_POP_BASE.groc, tax: CW_POP_BASE.tax, news: CW_POP_BASE.news, health: CW_POP_BASE.health, exams: CW_POP_BASE.exams }));
  ok(r.g.info === 60.1 && r.g.news === 51.4 && r.g.products === 43.2 && r.g.travel === 36.9 && r.g.education === 35.8 && r.g.finance === 34.5 && r.g.health === 34.2,
     'GWI Q4 2025: why people go online - information, news, products, travel, education, finances, health', r.g);
  ok(r.tax > r.news && r.news > r.groc && r.groc > r.exams && r.exams > r.health, 'and each job weighs the share of the reason it serves', r);
}

section('A count of what people start beats the research');
{
  /* Seeded the way the server writes it. Kenya, 40 starts - past the floor -
     30 of them for a job the research puts far down the list. */
  const low = all.KE.kinds.slice(-1)[0];
  const lowId = all.KE.ids.slice(-1)[0];
  await env.AMV_KV.put('stats:jobuse', JSON.stringify({ counts: {}, total: 40, byCountry: { KE: { counts: { [lowId]: 30 }, total: 40 } } }));
  /* A fresh browser: the catalogue is a public GET the browser may cache, and
     a visitor tomorrow is a new visit, not this one. */
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  const p2 = await c2.newPage();
  p2.on('pageerror', e => errors.push(e.message));
  await p2.goto('http://localhost:' + site.address().port + '/#/crew', { waitUntil: 'load' });
  const r = await p2.evaluate(async () => {
    await _cwLoadLocal('KE');
    for (let i = 0; i < 100 && _cwLocalState.KE === 'loading'; i++) await new Promise(r => setTimeout(r, 20));
    return _cwCountryHundred('KE').map(j => j.id);
  });
  await c2.close();
  ok(r.indexOf(lowId) >= 0 && r.indexOf(lowId) < 15, 'the job people in Kenya actually switch on climbs from last to the top fifteen (' + low + ')', r.indexOf(lowId));
  await env.AMV_KV.delete('stats:jobuse');
}

ok(errors.length === 0, 'and nothing threw', errors.slice(0, 3));
await browser.close(); api.close(); site.close();
if (report('the-hundred-is-what-is-used-there') > 0) process.exitCode = 1;
done();
