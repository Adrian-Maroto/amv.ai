/* COUNTRY FACTS CITED BY THEIR OWN WEBSITE (Nov 17).

   For a name Wikidata cannot tie to its country - it has no entry, or only
   given names and songs by the same name - the next source is the service
   itself: its official website, and evidence that people in that country use
   it. data/facts-sites.json holds the address for each, written by hand (and
   says what was left out on purpose). This checks every address against that
   country's Chrome UX Report list - the sites Chrome users there actually
   visit - and only an address found there is cited:
     { n, how: "cited", site, r (its rank bucket there), src: "crux YYYYMM" }.
   An address not in the list is reported and the name stays unresolved: a
   site nobody there visits is no evidence it is what people there use.

   node scripts/facts-cite-sites.mjs [CC ...]   (then facts-check.mjs --report) */
import { readFileSync, writeFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CRUX = 'https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/country/';
/* The registrable domain, the same rule as facts-check.mjs. */
const SECOND = new Set(['co', 'com', 'org', 'net', 'gov', 'gob', 'edu', 'ac', 'or', 'ne', 'go', 'gouv', 'nic']);
const reg = (h) => { const p = h.replace(/^www\./, '').split('.'); return (p.length >= 3 && p[p.length - 1].length === 2 && SECOND.has(p[p.length - 2])) ? p.slice(-3).join('.') : p.slice(-2).join('.'); };

async function crux(cc) {
  const now = new Date();
  for (let back = 0; back < 6; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const ym = d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0');
    let r; try { r = await fetch(CRUX + cc.toLowerCase() + '/' + ym + '.csv.gz', { signal: AbortSignal.timeout(120000) }); } catch (e) { continue; }
    if (!r.ok) continue;
    const text = gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8');
    const byReg = new Map();
    for (const line of text.split('\n')) {
      const c = line.lastIndexOf(','); if (c < 0) continue;
      const rank = +line.slice(c + 1); if (!rank) continue;
      let h; try { h = new URL(line.slice(0, c)).hostname.toLowerCase(); } catch (e) { continue; }
      const g = reg(h); if (!(byReg.get(g) <= rank)) byReg.set(g, rank);
    }
    return { ym, byReg };
  }
  return null;
}

const sites = JSON.parse(readFileSync(join(ROOT, 'data/facts-sites.json'), 'utf8'));
const facts = JSON.parse(readFileSync(join(ROOT, 'data/facts-sources.json'), 'utf8'));
const today = new Date().toISOString().slice(0, 10);
let cited = 0; const notThere = [], noName = [];
const only = process.argv.slice(2).map(s => s.toUpperCase());
for (const [cc, map] of Object.entries(sites)) {
  if (cc === '_' || (only.length && !only.includes(cc))) continue;
  const cr = await crux(cc);
  if (!cr) { console.log(cc, 'no Chrome UX Report list'); Object.keys(map).forEach(k => notThere.push(cc + ' ' + k + ' (no list)')); continue; }
  for (const [key, site] of Object.entries(map)) {
    const [field, n] = key.split('|');
    const e = ((facts[cc] || {})[field] || []).find(x => x.n === n);
    if (!e) { noName.push(cc + ' ' + key); continue; }
    if (e.how !== 'unresolved') continue;
    const r = cr.byReg.get(reg(site));
    if (!r) { notThere.push(cc + ' ' + key + ' -> ' + site); continue; }
    for (const k of Object.keys(e)) delete e[k];
    Object.assign(e, { n, how: 'cited', site, r, src: 'crux ' + cr.ym, checked: today });
    cited++;
  }
  console.log(cc, cr.ym);
}
writeFileSync(join(ROOT, 'data/facts-sources.json'), JSON.stringify(facts, null, 1) + '\n');
console.log('cited', cited, '| not in the country\'s list', notThere.length, '| no such name', noName.length);
if (noName.length) console.log('NO SUCH NAME:\n' + noName.join('\n'));
console.log('NOT IN THE LIST:\n' + notThere.join('\n'));
