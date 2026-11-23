#!/usr/bin/env node
/* HOW MUCH EACH WORLDWIDE SERVICE IS VISITED (Nov 23).

   data/global (scripts/global-data.mjs) ranks each topic's services by how
   many Wikipedia editions cover them - which says what is notable, and puts a
   mail program from 1995 above one people open every day. The order people
   asked for is what is USED, so each service's website is looked up in the
   Chrome UX Report's worldwide list (Google, monthly, rank buckets: top
   1,000 to top 1,000,000; cached as CSV by zakird/crux-top-lists - Ruth et
   al., "Toppling Top Lists", IMC 2022), the same source Integrations and the
   country files already use.

   Matching is by the service's own host only (www. ignored): a product on a
   shared domain (outlook.office.com) is never given its parent's rank.

   Worldwide, and in every country AMV has a file for, so each visitor's
   Integrations lists what is visited where they are first.

   Writes data/global-reach.json: { source, month, hosts: [...], g: codes,
   c: { CC: codes } }, where codes has one character per host in `hosts`
   order - 1 for the top 1,000 ... 7 for the top 1,000,000, 0 for not in the
   list. Only hosts measured somewhere are kept.
   Run: node scripts/global-reach.mjs  (about 900MB downloaded; a few minutes)
   CRUX_CACHE=<dir> keeps and reuses the downloaded files. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { gunzipSync } from 'zlib';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/';
const BUCKETS = [1000, 5000, 10000, 50000, 100000, 500000, 1000000];

const hosts = new Set();
for (const f of readdirSync(join(ROOT, 'data', 'global')).filter(f => /^[a-z]+\.json$/.test(f)))
  for (const e of JSON.parse(readFileSync(join(ROOT, 'data', 'global', f), 'utf8')).items || []) hosts.add(e.s);
/* And the Open Directory's sites (scripts/dmoz-data.mjs). */
if (existsSync(join(ROOT, 'data', 'dmoz'))) for (const f of readdirSync(join(ROOT, 'data', 'dmoz')).filter(f => /^[a-z]+\.json$/.test(f)))
  for (const e of JSON.parse(readFileSync(join(ROOT, 'data', 'dmoz', f), 'utf8')).items || []) if (e && e.s) hosts.add(e.s);

async function load(path) {
  const now = new Date();
  for (let back = 0; back < 6; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const ym = d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0');
    const cf = process.env.CRUX_CACHE ? join(process.env.CRUX_CACHE, path.replace(/\//g, '_') + '_' + ym + '.csv.gz') : '';
    let buf = cf && existsSync(cf) ? readFileSync(cf) : null;
    if (!buf) {
      let r = null;
      for (let t = 0; t < 3 && !r; t++) r = await fetch(BASE + path + '/' + ym + '.csv.gz', { signal: AbortSignal.timeout(300000) }).catch(() => null);
      if (!r || !r.ok) { if (process.env.DEBUG) console.log(path, ym, r ? r.status : 'no answer'); continue; }
      buf = Buffer.from(await r.arrayBuffer());
      if (cf) writeFileSync(cf, buf);
    }
    const text = gunzipSync(buf).toString('utf8');
    const best = {};
    for (const line of text.split('\n')) {
      const c = line.lastIndexOf(','); if (c < 0) continue;
      const rank = +line.slice(c + 1); if (!rank) continue;
      const u = line.slice(0, c); const s = u.indexOf('://'); if (s < 0) continue;
      let h = u.slice(s + 3).toLowerCase(); const k = h.search(/[:/]/); if (k >= 0) h = h.slice(0, k);
      h = h.replace(/^www\./, '');
      if (hosts.has(h) && !(best[h] <= rank)) best[h] = rank;
    }
    return { ym, best };
  }
  return null;
}
const bucket = (rank) => { if (!rank) return 0; const i = BUCKETS.findIndex(b => rank <= b); return i < 0 ? 7 : i + 1; };
const g = await load('global');
if (!g) { console.error('the worldwide Chrome UX Report list could not be read'); process.exit(1); }
const countries = readdirSync(join(ROOT, 'data', 'countries')).filter(f => /^[A-Z]{2}\.json$/.test(f)).map(f => f.slice(0, 2)).sort();
const per = {};
let i = 0;
await Promise.all(Array.from({ length: 6 }, async () => { while (i < countries.length) { const cc = countries[i++]; const r = await load('country/' + cc.toLowerCase()); if (r) per[cc] = r.best; else console.log('no list for', cc); } }));
const measured = [...hosts].filter(h => g.best[h] || Object.values(per).some(m => m[h])).sort();
const code = (m) => measured.map(h => String(bucket(m[h]))).join('');
const c = {}; for (const cc of Object.keys(per).sort()) c[cc] = code(per[cc]);
writeFileSync(join(ROOT, 'data', 'global-reach.json'), JSON.stringify({ source: 'Chrome UX Report (zakird/crux-top-lists), worldwide and per country, by each service’s own host', month: g.ym.slice(0, 4) + '-' + g.ym.slice(4), hosts: measured, g: code(g.best), c }) + '\n');
console.log('measured', measured.length, 'of', hosts.size, 'hosts; worldwide', Object.keys(g.best).length, '; countries', Object.keys(c).length, '; month', g.ym);
