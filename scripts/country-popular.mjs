#!/usr/bin/env node
/* WHAT PEOPLE IN EACH COUNTRY ACTUALLY USE (Nov 15).

   The owner: "the jobs in all the countries aren't actually the most popular
   right now - they have to be based on research, the most popular and used."

   country-data.mjs ranks a country's services by how many Wikipedia editions
   cover them, which measures how famous something is, not how many people use
   it: Spain's "colleges" opened on a French business school. This adds the
   measure that is about use:

     THE CHROME UX REPORT (CrUX), Google's public record of the websites Chrome
     users in each country actually load, published monthly in BigQuery and
     cached as CSV by zakird/crux-top-lists (Ruth et al., "Toppling Top Lists",
     IMC 2022, found it the most accurate public top list). Each site comes
     with its rank bucket in that country: top 1,000, 5,000, 10,000, 50,000 ...

   Two things are done with it, per country:

     1. RANK. Every service already in the file is given the bucket of its
        site in that country (`r`), matched by host, then by registrable
        domain, then by the brand name in the domain (bbva.com and bbva.es).
        Each kind is then ordered by `r`, and by Wikipedia coverage after it.
        A service no Chrome user there loaded keeps its place at the end.

     2. ADD. The most-visited sites there that the file does not have yet are
        looked up on Wikidata BY THEIR OFFICIAL WEBSITE (P856). One that
        Wikidata files under a kind AMV lists (a bank, a retailer, an airline -
        the same classes country-data.mjs asks for, checked by name the same
        way) is added to that kind, with its rank. One Wikidata cannot place
        is not added: a popular site of unknown kind would be a job of unknown
        meaning.

   Run where both hosts are reachable (the country-popular workflow does it):
     node scripts/country-popular.mjs            every country file
     node scripts/country-popular.mjs ES US      just these */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { gunzipSync } from 'zlib';
import { KINDS } from './country-data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'countries');
const EP = 'https://query.wikidata.org/sparql';
const CRUX = 'https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/country/';
const UA = 'AMV-country-data/1.0 (public-data builder; contact via the project repository)';
const ADD_BELOW = 10000;          // sites in a country's top 10,000 are looked up
const ADD_MAX_PER_KIND = 60;      // and at most this many are added to one kind
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const qid = (uri) => String(uri).split('/').pop();

async function sparql(q, tries = 4, ms = 90000) {
  for (let i = 0; i < tries; i++) {
    let r;
    try { r = await fetch(EP, { method: 'POST', headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'query=' + encodeURIComponent(q), signal: AbortSignal.timeout(ms) }); }
    catch (e) { await sleep(3000 * (i + 1)); continue; }
    if (r.ok) return (await r.json()).results.bindings;
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * (i + 1) * (i + 1)); continue; }
    throw new Error('wikidata ' + r.status + ' ' + (await r.text()).slice(0, 200));
  }
  throw new Error('wikidata kept refusing');
}

/* The registrable part of a host: bbva.es, bbc.co.uk, gob.mx stays with its
   owner (sat.gob.mx). A short list, not the whole public-suffix list: a miss
   only makes a match less likely, never wrong. */
const SECOND = new Set(['co', 'com', 'org', 'net', 'gov', 'gob', 'edu', 'ac', 'or', 'ne', 'go', 'gouv', 'nic', 'mil', 'gv', 'govt', 'nom', 'info', 'biz', 'sch', 'web']);
function reg(host) {
  const p = String(host).toLowerCase().replace(/^www\./, '').split('.');
  if (p.length >= 3 && p[p.length - 1].length === 2 && SECOND.has(p[p.length - 2])) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}
const brand = (h) => reg(h).split('.')[0];

async function crux(cc) {
  const now = new Date();
  for (let back = 0; back < 8; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const ym = d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0');
    let r;
    try { r = await fetch(CRUX + cc.toLowerCase() + '/' + ym + '.csv.gz', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) }); } catch (e) { continue; }
    if (!r.ok) continue;
    const text = gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8');
    const host = new Map(), byReg = new Map(), byBrand = new Map();
    for (const line of text.split('\n')) {
      const c = line.lastIndexOf(','); if (c < 0) continue;
      const rank = +line.slice(c + 1); if (!rank) continue;
      let h; try { h = new URL(line.slice(0, c)).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { continue; }
      if (!(host.get(h) <= rank)) host.set(h, rank);
      const g = reg(h); if (!(byReg.get(g) <= rank)) byReg.set(g, rank);
      const b = brand(h); if (b.length >= 4 && !(byBrand.get(b) <= rank)) byBrand.set(b, rank);
    }
    return { ym, host, byReg, byBrand };
  }
  return null;
}
function rankOf(c, site) {
  const h = String(site).toLowerCase().replace(/^www\./, '');
  return c.host.get(h) || c.byReg.get(reg(h)) || (brand(h).length >= 4 ? c.byBrand.get(brand(h)) : 0) || 0;
}

async function main() {
  const want = process.argv.slice(2).map(s => s.toUpperCase());
  /* Named countries are always done again; otherwise a country already ranked
     (v 3) is skipped, so a run that ran out of time is picked up where it
     stopped rather than redone from A. SHARD/SHARDS split the rest across
     parallel jobs, one file each, so no two jobs write the same file. */
  const SHARDS = Math.max(1, +process.env.SHARDS || 1), SHARD = (+process.env.SHARD || 0) % SHARDS;
  const files = readdirSync(OUT).filter(f => /^[A-Z]{2}\.json$/.test(f)).map(f => f.slice(0, 2))
    .filter(cc => want.length ? want.includes(cc) : (() => { try { return JSON.parse(readFileSync(join(OUT, cc + '.json'), 'utf8')).v !== 3; } catch (e) { return true; } })())
    .filter((cc, i) => i % SHARDS === SHARD);
  console.log('to do (shard ' + SHARD + ' of ' + SHARDS + '):', files.join(' ') || 'nothing');
  const END = Date.now() + (+process.env.BUDGET_MIN || 200) * 60000;
  /* The classes, checked by name exactly as country-data.mjs checks them. */
  const cls = Object.values(KINDS).map(k => 'wd:' + k[0]).join(' ');
  const said = Object.fromEntries((await sparql(`SELECT ?c ?l WHERE { VALUES ?c { ${cls} } ?c rdfs:label ?l FILTER(LANG(?l)="en") }`)).map(b => [qid(b.c.value), b.l.value]));
  const kindOf = {};
  for (const [kind, [q, , meant]] of Object.entries(KINDS)) {
    if (said[q] === meant) kindOf[q] = kind; else console.log('class', kind, q, 'is "' + (said[q] || '?') + '", not "' + meant + '" - not used to add');
  }
  const classes = Object.keys(kindOf).map(q => 'wd:' + q).join(' ');
  let ranked = 0, added = 0;
  for (const cc of files) {
    if (Date.now() > END) { console.log(cc, 'not done: out of time'); continue; }
    const path = join(OUT, cc + '.json');
    const d = JSON.parse(readFileSync(path, 'utf8'));
    const c = await crux(cc);
    if (!c) { console.log(cc, 'no Chrome UX Report list'); continue; }
    /* 1. Rank what is there. */
    const have = new Set(), haveQ = new Set();
    let n = 0;
    for (const list of Object.values(d.kinds || {})) for (const e of list) {
      const r = rankOf(c, e.s); if (r) { e.r = r; n++; } else delete e.r;
      have.add(reg(e.s)); haveQ.add(e.q);
    }
    ranked += n;
    /* 2. Add the most-visited sites Wikidata can place, by their website. */
    const cand = [...c.byReg.entries()].filter(([g, r]) => r <= ADD_BELOW && !have.has(g)).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    const found = {};
    for (let i = 0; i < cand.length && Date.now() < END; i += 40) {
      const batch = cand.slice(i, i + 40);
      const vals = batch.flatMap(g => ['https://' + g + '/', 'https://www.' + g + '/', 'https://' + g, 'https://www.' + g, 'http://' + g + '/', 'http://www.' + g + '/'].map(u => '<' + u + '>')).join(' ');
      let rows = [];
      try {
        rows = await sparql(`SELECT ?i ?site ?cls ?n ?iLabel WHERE {
          VALUES ?site { ${vals} } VALUES ?cls { ${classes} }
          ?i wdt:P856 ?site ; wdt:P31/wdt:P279? ?cls ; wikibase:sitelinks ?n .
          FILTER NOT EXISTS { ?i wdt:P576 ?gone } FILTER NOT EXISTS { ?i wdt:P582 ?ended }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,es,fr,de,pt,it,nl,ru,tr,ar,id,ja,ko,zh". }
        }`, 2, 60000);
      } catch (e) { console.log(cc, 'lookup failed:', e.message); continue; }
      for (const b of rows) {
        const q = qid(b.i.value); if (haveQ.has(q)) continue;
        const name = b.iLabel && b.iLabel.value;
        if (!name || /^Q\d+$/.test(name) || name.length < 2 || name.length > 90 || /[\u0000-\u001f\u007f<>{}\[\]`]|https?:|www\./i.test(name)) continue;
        let host = ''; try { host = new URL(b.site.value).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { continue; }
        if (!host || host.length > 80 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host)) continue;
        const kind = kindOf[qid(b.cls.value)]; if (!kind) continue;
        haveQ.add(q);
        (found[kind] = found[kind] || []).push({ q, n: name, s: host, w: +b.n.value, r: c.byReg.get(reg(host)) || ADD_BELOW });
      }
      await sleep(250);
    }
    let a = 0;
    for (const [kind, list] of Object.entries(found)) {
      const into = (d.kinds[kind] = d.kinds[kind] || []);
      for (const e of list.sort((x, y) => x.r - y.r || y.w - x.w).slice(0, ADD_MAX_PER_KIND)) { into.push(e); a++; }
    }
    added += a;
    /* Each kind, most used first; Wikipedia coverage breaks ties and orders
       what Chrome users there never loaded. */
    let total = 0;
    for (const k of Object.keys(d.kinds)) { d.kinds[k].sort((x, y) => (x.r || 1e9) - (y.r || 1e9) || (y.w || 0) - (x.w || 0)); total += d.kinds[k].length; }
    d.total = total; d.v = 3; d.popular = 'Chrome UX Report ' + c.ym;
    d.source = 'Wikidata (query.wikidata.org); ranked by Chrome UX Report visits in this country (' + c.ym + '), then Wikipedia sitelinks';
    writeFileSync(path, JSON.stringify(d));
    console.log(cc, c.ym, 'ranked', n, 'added', a, 'total', total);
  }
  console.log('done: ranked', ranked, 'added', added);
}
main().catch(e => { console.error(e); process.exit(1); });
