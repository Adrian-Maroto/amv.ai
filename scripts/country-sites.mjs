#!/usr/bin/env node
/* CHOOSES EACH SERVICE'S WEBSITE FOR THE COUNTRY IT IS LISTED IN (Nov 28).

   For every entry in data/countries/<CC>.json, asks Wikidata for all of the
   organisation's official websites (P856) and keeps the one that fits the
   country best (scripts/site-fit.mjs) - replacing a site only when another
   fits strictly better (scripts/site-fit.mjs: the country's own domain, then
   fewer labels, then more visits from the country) and is recognisably the
   same organisation, and never with a host another entry in the same file
   already uses. An entry whose site changes is ranked again on the new site,
   by the same Chrome UX Report month as the rest of its file, so the order
   stays one measurement.

   Run where Wikidata and the Chrome UX Report lists are reachable (the
   country-sites workflow does it), then `node scripts/country-reach.mjs`:
     node scripts/country-sites.mjs            every country file
     node scripts/country-sites.mjs US GB      just these
     DRY=1 node scripts/country-sites.mjs      say what would change, write nothing */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { siteBetter, siteRelated, siteFit, LOCAL_KINDS } from './site-fit.mjs';
import { crux, rankOf } from './country-popular.mjs';
import { listed } from './not-listed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'countries');
const EP = 'https://query.wikidata.org/sparql';
const UA = 'AMV-country-data/1.0 (public-data builder; contact via the project repository)';
const BATCH = 300;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const qid = (uri) => String(uri).split('/').pop();
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

async function sparql(q, tries = 5) {
  for (let i = 0; i < tries; i++) {
    let r;
    try { r = await fetch(EP, { method: 'POST', headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'query=' + encodeURIComponent(q), signal: AbortSignal.timeout(90000) }); }
    catch (e) { await sleep(3000 * (i + 1)); continue; }
    if (r.ok) return (await r.json()).results.bindings;
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * (i + 1) * (i + 1)); continue; }
    throw new Error('wikidata ' + r.status + ' ' + (await r.text()).slice(0, 200));
  }
  throw new Error('wikidata kept refusing');
}
/* The same checks country-data.mjs makes on a site: https or http, a bare
   host, not an adult site. */
function hostOf(url) {
  try {
    const u = new URL(url); if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    return (h.length <= 80 && HOST.test(h) && listed(h)) ? h : '';
  } catch (e) { return ''; }
}

async function main() {
  const want = process.argv.slice(2).map(s => s.toUpperCase());
  const dry = !!process.env.DRY;
  const files = readdirSync(OUT).filter(f => /^[A-Z]{2}\.json$/.test(f)).map(f => f.slice(0, 2)).filter(cc => !want.length || want.includes(cc));
  const data = Object.fromEntries(files.map(cc => [cc, JSON.parse(readFileSync(join(OUT, cc + '.json'), 'utf8'))]));
  const qs = [...new Set(Object.values(data).flatMap(d => Object.values(d.kinds || {}).flat().map(e => e.q)))];
  console.log(files.length, 'files,', qs.length, 'organisations');
  /* WHERE EACH ORGANISATION OPERATES (Build 19 audit B19-R-03, R-15, NEW-05).
     The visit ranking adds any site people in a country visit, so Pakistan's
     only supermarkets were Sam's Club and Walmart Canada. For the kinds that
     are no use unless they operate in the country (LOCAL_KINDS), each entry
     gets `l`: 1 when Wikidata places it there - its country, its
     headquarters' country, its operating area, the jurisdiction it applies
     to, the place it is in, or a subsidiary there (Carrefour España for
     Carrefour, whose own country is France) - or its site is on the
     country's own domain;
     0 when it was checked and none of those says so. The page puts 0 after
     the rest of its kind and says it is not confirmed there. Nothing is
     removed: Wikidata misses some real local branches, and a missing fact is
     not a proof of absence. */
  const where = new Map();
  for (let i = 0; i < qs.length; i += BATCH) {
    const part = qs.slice(i, i + BATCH);
    const rows = await sparql(`SELECT ?i ?c WHERE { VALUES ?i { ${part.map(q => 'wd:' + q).join(' ')} }
      { ?i wdt:P17 ?c } UNION { ?i wdt:P159/wdt:P17 ?c } UNION { ?i wdt:P2541 ?c } UNION { ?i wdt:P2541/wdt:P17 ?c }
      UNION { ?i wdt:P1001 ?c } UNION { ?i wdt:P1001/wdt:P17 ?c } UNION { ?i wdt:P131/wdt:P17 ?c }
      UNION { ?i wdt:P355/wdt:P17 ?c } UNION { ?i wdt:P355/wdt:P159/wdt:P17 ?c } }`);
    for (const b of rows) { const q = qid(b.i.value); (where.get(q) || where.set(q, new Set()).get(q)).add(qid(b.c.value)); }
    if ((i / BATCH) % 20 === 0) console.log('placed', Math.min(qs.length, i + BATCH), 'of', qs.length);
    await sleep(250);
  }
  const sites = new Map();
  for (let i = 0; i < qs.length; i += BATCH) {
    const part = qs.slice(i, i + BATCH);
    const rows = await sparql(`SELECT ?i ?site WHERE { VALUES ?i { ${part.map(q => 'wd:' + q).join(' ')} } ?i wdt:P856 ?site . }`);
    for (const b of rows) { const h = hostOf(b.site.value); if (!h) continue; const q = qid(b.i.value); (sites.get(q) || sites.set(q, new Set()).get(q)).add(h); }
    if ((i / BATCH) % 20 === 0) console.log('asked', Math.min(qs.length, i + BATCH), 'of', qs.length);
    await sleep(250);
  }
  let changed = 0;
  for (const cc of files) {
    const d = data[cc], used = new Set(Object.values(d.kinds || {}).flat().map(e => e.s));
    /* The file's own Chrome month, read first: between two sites that fit
       the country equally, the one more visited from it wins. */
    const ym = (/Chrome UX Report (\d{6})/.exec(String(d.popular || '')) || [])[1];
    const c = ym ? await crux(cc, ym) : null;
    const rank = (h) => (c ? rankOf(c, h) : 0) || 0;
    const moves = [];
    for (const list of Object.values(d.kinds || {})) for (const e of list) {
      let best = e.s;
      for (const h of sites.get(e.q) || []) if (!used.has(h) && siteRelated(h, e.n, e.s) && siteBetter(h, best, cc, rank)) best = h;
      if (best !== e.s) { moves.push([e, best]); used.delete(e.s); used.add(best); }
    }
    let placed = 0;
    for (const [kind, list] of Object.entries(d.kinds || {})) {
      if (!LOCAL_KINDS.has(kind)) { for (const e of list) delete e.l; continue; }
      for (const e of list) {
        const l = (siteFit(e.s, cc) === 0 || (where.get(e.q) || new Set()).has(d.qid)) ? 1 : 0;
        if (e.l !== l) { e.l = l; placed++; }
      }
    }
    if (!moves.length && !placed) continue;
    if (placed) console.log(cc, placed, 'entries placed or not placed in the country');
    for (const [e, best] of moves) {
      console.log(cc, e.q, e.n, ':', e.s, '->', best);
      e.s = best;
      const r = rank(best); if (r) e.r = r; else delete e.r;
    }
    changed += moves.length;
    if (!dry) writeFileSync(join(OUT, cc + '.json'), JSON.stringify(d));
  }
  console.log('done:', changed, 'sites replaced', dry ? '(dry run, nothing written)' : '');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e); process.exit(1); });
