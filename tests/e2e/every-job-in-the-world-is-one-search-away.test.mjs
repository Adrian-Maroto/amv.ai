/* EVERY JOB IN THE WORLD IS ONE SEARCH AWAY (Nov 16, the owner: "a 'See all
   jobs' directory of 1,000,000+ jobs across all countries, searchable").

   The directory is the product of two real things - every service each
   country's data lists, and the jobs worth watching about each kind of
   service - and it is never built: it is counted and searched from those
   factors, and only the rows on screen are made (ccDirFind). What is held:

     · the number on screen is the number there is: worked out here again,
       independently, from the country files and the templates - a job about
       a service alone counted once however many countries list it, a job
       about the service IN a country counted per country - and it is over a
       million;
     · a search counts exactly the jobs it would list, and every one it lists
       has every word somewhere in it;
     · a row opens its own job, and a job about a country says which in its id;
     · it stays light: a tripwire on memory and on the time a search takes;
     · in Spanish the titles are Spanish, the country named in Spanish. */
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* The independent count: the data files and the templates, read from source. */
const src = readFileSync(join(ROOT, 'src/country/country-catalog.js'), 'utf8');
const CREW = (0, eval)('(' + src.match(/const CC_CREW = (\{[\s\S]*?\n\});/)[1] + ')');
/* And the page's nationwide blocks (CC_BLOCKED), read from the same source. */
const BLOCKED = (0, eval)('(' + src.match(/const CC_BLOCKED = (\{[\s\S]*?\n\});/)[1] + ')');
/* And the chains it files under the kind they are (CC_REFILE: Pizza Hut is a
   restaurant, AMC Theatres a cinema), from the same source. */
const REFILE = (0, eval)('(' + src.match(/const CC_REFILE = (\[[\s\S]*?\n\]);/)[1] + ')');
const kindOf = (kind, e) => { if (kind !== 'retail') return kind; const m = REFILE.find(([, re]) => re.test(e.n)); return m ? m[0] : kind; };
let CC = '';
const good = e => e && !(BLOCKED[CC] && BLOCKED[CC].test(String(e.s || ''))) && /^Q\d{1,12}$/.test(e.q) && typeof e.n === 'string' && e.n.length >= 2 && e.n.length <= 90
  && !/[\u0000-\u001f\u007f<>{}\[\]`]|https?:|www\./i.test(e.n);
const seen = new Set();
let expect = 0;
for (const f of readdirSync(join(ROOT, 'data/countries')).filter(f => /^[A-Z]{2}\.json$/.test(f)).sort()) {
  const d = JSON.parse(readFileSync(join(ROOT, 'data/countries', f), 'utf8'));
  CC = d.cc;
  for (const [kind0, list] of Object.entries(d.kinds || {})) {
    for (const e of list) {
      if (!good(e)) continue;
      const kind = kindOf(kind0, e), tpl = CREW[kind]; if (!tpl) continue;
      const sc = tpl.filter(t => t[3] === 'c').length, own = tpl.length - sc;
      expect += sc;
      const k = kind + '|' + e.q;
      if (!seen.has(k)) { seen.add(k); expect += own; }
    }
  }
}

const app = await bootApp({ tab: 'chat', viewport: { width: 1280, height: 900 }, user: { name: 'U', email: 'u@x.com', ini: 'U' } });
const { page, errors } = app;

section('The directory counts what there is - over a million, the same number worked out from the data');
{
  await page.evaluate(() => { document.getElementById('ck')?.remove(); _cwSetCountry('ES'); setTab('crew'); });
  await page.waitForSelector('[data-dact="cjDirectory"]', { timeout: 20000 });
  await page.evaluate(() => cjDirectory());
  await page.waitForFunction(() => { const t = (document.getElementById('cxd-n') || {}).textContent || '';
    return /\d/.test(t) && !/loading/i.test(t); }, null, { timeout: 120000 });
  const r = await page.evaluate(() => ({
    shown: Number(((document.getElementById('cxd-n') || {}).textContent || '').replace(/[^\d]/g, '')),
    everywhere: _cjdAll.length,
    rows: document.querySelectorAll('#cxd-list .cxd-row').length,
  }));
  ok(r.shown - r.everywhere === expect, 'the country jobs on screen are exactly the ones the data makes - ' + expect.toLocaleString(), { shown: r.shown, everywhere: r.everywhere, expect });
  ok(r.shown >= 1000000, 'over a million jobs - ' + r.shown.toLocaleString(), r.shown);
  ok(r.rows > 0 && r.rows <= 61, 'and only a screenful is drawn', r.rows);
}

section('A search counts exactly what it lists, and everything it lists matches');
{
  for (const q of ['iberia', 'microsoft results', 'jobs spain']) {
    const r = await page.evaluate(q => {
      const words = q.toLowerCase().split(/\s+/);
      const codes = (CW_WORLD_COUNTRIES || []).map(c => c[0]);
      const t0 = performance.now();
      const head = ccDirFind(codes, words, 60);
      const ms = performance.now() - t0;
      const all = ccDirFind(codes, words, 100000);
      const miss = all.rows.filter(j => { const hay = [j.title, j.prompt, j.cat, T(j.cat), j.site, j.src, j.desc,
        (_cwCountryRow(j.country) || [])[1], _cwThe(((_cwCountryRow(j.country) || [])[1]) || '')].join(' ').toLowerCase();
        return !words.every(w => hay.indexOf(w) >= 0); }).map(j => j.title);
      return { n: head.n, listed: all.rows.length, ids: new Set(all.rows.map(j => j.id)).size, miss: miss.slice(0, 3), ms };
    }, q);
    ok(r.n > 0 && r.n === r.listed, '"' + q + '": ' + r.n + ' counted, ' + r.listed + ' listed', r);
    ok(r.ids === r.listed, '"' + q + '": no job listed twice', r);
    ok(r.miss.length === 0, '"' + q + '": every job listed holds every word', r.miss);
    ok(r.ms < 1500, '"' + q + '": searched in ' + Math.round(r.ms) + 'ms (tripwire 1500ms)', r.ms);
  }
}

section('A row opens its own job; a job about a country says which');
{
  const r = await page.evaluate(async () => {
    const i = document.getElementById('cxd-q'); i.value = 'jobs spain'; _cjdQ = 'jobs spain'; _cjdN = 60; _cjdPaint();
    const row = [...document.querySelectorAll('#cxd-list .cxd-row')].find(b => /^ccj-/.test(b.dataset.darg));
    if (!row) return { none: true };
    const id = row.dataset.darg, title = row.querySelector('.cxd-t').textContent;
    const j = _cwFindJob(id);
    row.click(); await new Promise(r => setTimeout(r, 300));
    const panel = document.querySelector('#ovr .cwp, #ovr [class*="cwp"]');
    return { id, title, found: !!j && j.title === title, panel: !!panel && (panel.textContent || '').indexOf(title) >= 0,
      scoped: /-ES$/.test(id), prompt: j && j.prompt };
  });
  ok(!r.none, 'the search lists country jobs', r);
  ok(r.found, 'the row’s job is the one its id names', r);
  ok(r.panel, 'and pressing it opens that job’s panel', r);
  ok(r.scoped && /Spain/.test(r.prompt || ''), 'a job about Spain has Spain in its id and in what it runs', { id: r.id, prompt: r.prompt });
  const ids = await page.evaluate(() => { const g = (window.ccDirFind(['ES'], ['microsoft'], 40).rows || []);
    return g.map(j => j.id); });
  ok(ids.some(id => /^ccj-[a-z]+-Q\d+-\d+$/.test(id)), 'a job about the service alone keeps the id it was always saved under', ids.slice(0, 4));
  await page.evaluate(() => { try{ closeOvr(); }catch(e){} });
}

section('It stays light');
{
  const heap = await page.evaluate(() => (performance.memory || {}).usedJSHeapSize || 0);
  ok(heap === 0 || heap < 250e6, 'the whole world’s directory in ' + Math.round(heap / 1e6) + 'MB of memory (tripwire 250MB)', heap);
}

section('In Spanish, the titles are Spanish and the country is named in Spanish');
{
  await page.evaluate(async () => {
    saveStr('amv_lang', 'es');
    try { _translateUI(); } catch (e) {}
    for (let i = 0; i < 60 && !_i18nPackHave('es'); i++) await new Promise(s => setTimeout(s, 100));
  });
  const r = await page.evaluate(() => {
    const g = window.ccDirFind(['ES'], ['iberia'], 200).rows.map(j => j.title);
    return { titles: g, scoped: g.filter(t => /\(España\)/.test(t)) };
  });
  ok(r.scoped.length > 0, 'a job about the country reads "(España)"', r.titles.slice(0, 6));
  ok(r.titles.some(t => /^Empleo en |^Novedades de |^Vuelos de |^Ofertas de /.test(t)), 'and its words are Spanish', r.titles.slice(0, 6));
  await page.evaluate(() => { saveStr('amv_lang', 'en'); try { _translateUI(); } catch (e) {} });
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
