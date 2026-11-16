/* HOW MUCH EACH APP ON INTEGRATIONS IS USED, WORLDWIDE AND IN EVERY COUNTRY
   (Nov 16, the owner: "all backed up by research - every section, every
   country, every integration").

   Source: the Chrome UX Report - which sites people actually load in Chrome,
   published monthly by Google as rank buckets (top 1,000, 5,000, 10,000,
   50,000, 100,000, 500,000, 1,000,000), worldwide and per country, cached as
   CSV by zakird/crux-top-lists (Ruth et al., "Toppling Top Lists", IMC 2022).
   The same source ranks every country's services (country-popular.mjs).

   Each app's host comes from scripts/app-sites.mjs, then AMV_APP_WEB.
   Matching is by the exact host (www. ignored); see TENANTS there for the
   products that live on customers' subdomains. An app with no website of its
   own is not measured, and the page says nothing about it rather than guess.

   What it measures, said plainly: visits in Chrome to the app's website. An
   app used mostly on phones (WhatsApp, Uber) is undercounted against one used
   in a browser; across apps that do the same job it is a fair comparison,
   which is the only comparison the page makes - within one topic.

   Writes data/app-reach.json, published as app-reach.json and read when the
   Integrations screen opens: { source, month, apps: [name...], g: codes,
   c: {CC: codes} }, where codes has one character per app in `apps` order -
   its bucket, 1 for the top 1,000 to 7 for the top 1,000,000, 0 for not in
   the list (or no website).
   Run: node scripts/app-reach.mjs   (about 900MB downloaded; a few minutes) */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { gunzipSync } from 'zlib';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { APP_SITES, TENANTS, SHARED } from './app-sites.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/';
const UA = 'amv-data (country and app research)';

const cat = readFileSync(join(ROOT, 'src/app/13c-app-catalog.js'), 'utf8');
const CATS = (0, eval)(cat.match(/const AMV_APP_CATS = (\[[\s\S]*?\n\]);/)[1].replace(/\/\*[\s\S]*?\*\//g, ''));
const view = readFileSync(join(ROOT, 'src/integrations/integrations-view.js'), 'utf8');
const WEB = (0, eval)('(' + view.match(/const AMV_APP_WEB = (\{[\s\S]*?\n\});/)[1] + ')');

const apps = [...new Set(CATS.flatMap(c => c.apps.map(a => String(a).split('|')[0])))];
const site = {};
const missing = [];
const clean = (h) => String(h).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
/* The registrable part: bbc.co.uk, rappi.com.mx, asana.com. */
const SECOND = new Set(['co', 'com', 'org', 'net', 'gov', 'gob', 'edu', 'ac', 'or', 'ne', 'go']);
const reg = (h) => { const p = h.split('.'); return (p.length >= 3 && p[p.length - 1].length === 2 && SECOND.has(p[p.length - 2])) ? p.slice(-3).join('.') : p.slice(-2).join('.'); };
for (const a of apps) {
  const s = Object.prototype.hasOwnProperty.call(APP_SITES, a) ? APP_SITES[a] : (WEB[a] || undefined);
  if (s === undefined) missing.push(a);
  site[a] = s ? [].concat(s).map(clean) : null;
}
if (missing.length) { console.error('no site recorded (add to scripts/app-sites.mjs, null if none):', missing.join(', ')); process.exit(1); }
/* Amazon's subdomains are AWS, Prime Video, Music and Alexa - not the shop. */
const ROOT_ONLY = new Set(['amazon']);
const exact = new Map(), whole = new Map(), brand = new Map();   // host / brand -> [apps]
const put = (m, k, a) => { if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(a)) m.get(k).push(a); };
for (const a of apps) for (const h of (site[a] || [])) {
  if (h.endsWith('.*')) put(brand, h.slice(0, -2), a);
  else if (reg(h) === h && !SHARED.has(h)) put(whole, h, a); else put(exact, h, a);
}
for (const t of TENANTS) for (const a of apps) if ((site[a] || []).includes(t)) put(whole, t, a);
const appsFor = (h) => { const out = (exact.get(h) || []).slice(); let d = h;
  /* brand.* - the brand's domain in any country, with its subdomains
     (uk.indeed.com), except where the subdomains are other products. */
  { const r = reg(h), b = r.split('.')[0];
    if (brand.has(b) && (r === h || !ROOT_ONLY.has(b))) brand.get(b).forEach(a => { if (!out.includes(a)) out.push(a); }); }
  while (d.includes('.')) { (whole.get(d) || []).forEach(a => { if (!out.includes(a)) out.push(a); }); d = d.slice(d.indexOf('.') + 1); }
  return out; };

async function list(path) {
  const now = new Date();
  for (let back = 0; back < 6; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const ym = d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0');
    let r, buf = null;
    const cf = process.env.CRUX_CACHE ? join(process.env.CRUX_CACHE, path.replace(/\//g, '_') + '_' + ym + '.csv.gz') : '';
    if (cf && existsSync(cf)) buf = readFileSync(cf);
    if (!buf) for (let t = 0; t < 3; t++) {
      try { r = await fetch(BASE + path + '/' + ym + '.csv.gz', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(180000) }); break; }
      catch (e) { r = null; await new Promise(x => setTimeout(x, 2000 * (t + 1))); }
    }
    if (!buf) { if (!r || !r.ok) continue; buf = Buffer.from(await r.arrayBuffer()); if (cf) writeFileSync(cf, buf); }
    const text = gunzipSync(buf).toString('utf8');
    const best = {};
    for (const line of text.split('\n')) {
      const c = line.lastIndexOf(','); if (c < 0) continue;
      const rank = +line.slice(c + 1); if (!rank) continue;
      const u = line.slice(0, c); const s = u.indexOf('://'); if (s < 0) continue;
      let h = u.slice(s + 3).toLowerCase(); const k = h.search(/[:/]/); if (k >= 0) h = h.slice(0, k);
      h = h.replace(/^www\./, '');
      for (const a of appsFor(h)) if (!(best[a] <= rank)) best[a] = rank;
    }
    return { ym, best };
  }
  return null;
}

export const BUCKETS = [1000, 5000, 10000, 50000, 100000, 500000, 1000000];
export function compact(o){
  const names = apps.slice();
  const code = (m) => names.map(a => { const r = m[a]; if (!r) return '0'; const i = BUCKETS.findIndex(b => r <= b); return String(i < 0 ? 7 : i + 1); }).join('');
  const c = {}; for (const [cc, m] of Object.entries(o.c)) c[cc] = code(m);
  return { source: o.source, month: o.month, apps: names, g: code(o.g), c };
}
if (process.argv[2] === '--compact') {
  const raw = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  writeFileSync(join(ROOT, 'data/app-reach.json'), JSON.stringify(compact(raw)) + '\n');
  console.log('compacted'); process.exit(0);
}
const countries = readdirSync(join(ROOT, 'data/countries')).filter(f => /^[A-Z]{2}\.json$/.test(f)).map(f => f.slice(0, 2)).sort();
const out = { source: 'Chrome UX Report rank buckets (zakird/crux-top-lists), by each app’s own website', month: '', g: {}, c: {} };
const g = await list('global');
if (!g) { console.error('the worldwide list could not be read'); process.exit(1); }
out.month = g.ym; out.g = g.best;
console.log('global', g.ym, Object.keys(g.best).length, 'of', apps.filter(a => site[a]).length, 'apps with a website measured');
let i = 0;
for (const cc of countries) {
  const r = await list('country/' + cc.toLowerCase());
  i++;
  if (!r) { console.log(cc, 'no list'); continue; }
  out.c[cc] = r.best;
  if (i % 10 === 0) console.log(i, '/', countries.length, cc, r.ym, Object.keys(r.best).length);
}
writeFileSync(join(ROOT, 'data/app-reach.json'), JSON.stringify(compact(out)) + '\n');
const unmeasured = apps.filter(a => site[a] && !out.g[a]);
console.log('done:', Object.keys(out.c).length, 'countries;', apps.filter(a => !site[a]).length, 'apps with no website;',
  unmeasured.length, 'with a website the worldwide list does not reach:', unmeasured.slice(0, 40).join(', '));
