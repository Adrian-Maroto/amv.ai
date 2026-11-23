/* THE WORLDWIDE SERVICES INTEGRATIONS SHOWS, ONE FILE (Nov 23).

   data/global/<topic>.json (scripts/global-data.mjs, from Wikidata) holds up
   to 400 services per Integrations topic. The page needs all of them at once
   to count each topic honestly ("See the remaining 214"), so the build packs
   them into global-services.json - one fetch, made when Integrations is
   drawn - after taking out what Integrations already lists or refuses:

     · an app the topic lists already (AMV_APP_CATS): the same service twice,
       once with Connect and once with Use, is the confusion this avoids;
     · password managers and other AI products - the catalogue leaves those
       out on purpose (13c-app-catalog.js says why), and a second source must
       not bring them back in;
     · a service filed under two topics is kept under the first.

     · what the owner had taken off the list (Nov 15: "remove the sketchy
       ones nobody uses") and cryptocurrency exchanges, the same call made
       for the one that was listed - hard to lose money comes first.

   Each entry is checked again as the country files are (a real Wikidata ID,
   a plain one-line name, a bare host). Order inside a topic: how much its
   website is visited worldwide (Chrome UX Report bucket,
   data/global-reach.json from scripts/global-reach.mjs), then - for the
   ones the report does not reach - Wikipedia sitelinks. */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { TOPICS, FIELDS, SERVICE_WORD, NOT_A_KIND, TOPIC_WORDS } from './global-data.mjs';

/* By site, not by name: a crypto exchange shares its name with one of these. */
const REFUSED_HOSTS = /(^|\.)(openai\.com|chatgpt\.com|anthropic\.com|claude\.ai|gemini\.google\.com|notebook\.google|notebooklm\.google|copilot\.microsoft\.com|perplexity\.ai|midjourney\.com|mistral\.ai|deepseek\.com|x\.ai|grok\.com|character\.ai|runwayml\.com|stability\.ai|leonardo\.ai|ideogram\.ai|synthesia\.io|pika\.art)$/;
const REFUSED_CLASSES = new Set(['password manager', 'cryptocurrency exchange', 'chatbot']);
/* Adult sites and piracy, whatever class brought them (the Wikidata run
   leaves them out by class too; this is the second line). */
const NOT_FOR_LISTING = /(getchu|erolabs|dlsite|nutaku|fanza|missav|jable|supjav|javhd|javlibrary|porn|xxx|xnxx|xhamster|hentai|onlyfans|fansly|stripchat|camsoda|chaturbate|cam4|livejasmin|bongacams|myfreecams|clips4sale|fetlife|ashleymadison|escort|torrent|1337x|piratebay|fitgirl|rarbg|warez|libgen|z-library|sci-hub|scihub|\bmym\b)/i;
const REMOVED = /(^|\.)(temu\.com|shein\.com|binance\.com|mega\.nz|mega\.io|wps\.com|mail\.yandex\.[a-z.]+|mail\.ru|vk\.com|paytm\.com|rocket\.chat)$/;
const VENDOR = /^(microsoft|google|apple|adobe|amazon|meta|ibm|oracle|sap|zoho|yahoo)\s+/;
const GENERIC_WORDS = new Set(['mail', 'email', 'calendar', 'drive', 'docs', 'cloud', 'app', 'online', 'web', 'the', 'and', 'for']);
const words = (s) => String(s).toLowerCase().replace(/&amp;/g, '&').replace(VENDOR, '').replace(/\.(com|net|org|io|app)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/* Classes too broad for a topic: "digital distribution platform" is every
   app store, e-book shop and journal site, not games; "online database" is
   every reference site (the Internet Archive, film and lyrics databases), not
   data tools; "podcast directory" two levels down reaches film databases. */
const PER_TOPIC = 450;
const TOPIC_DROP = { games: ['digital distribution platform'], data: ['online database', 'spreadsheet'], music: ['podcast directory'],
  /* Fields too broad to mean the topic (run 6, read by eye): "marketing" and
     "market research" are polling firms and TV stations, "talent management"
     is entertainment agencies, "automation" is industrial robot makers. */
  marketing: ['field marketing', 'field market research'], hr: ['field talent management'], auto: ['field automation'] };
export function appNames(root) {
  const src = readFileSync(join(root, 'src', 'app', '13c-app-catalog.js'), 'utf8');
  const m = src.match(/const AMV_APP_CATS = (\[[\s\S]*?\n\]);/);
  if (!m) throw new Error('global-services: AMV_APP_CATS not found in 13c-app-catalog.js');
  const cats = (0, eval)(m[1]);
  return cats.map(c => ({ id: c.id, names: c.apps.map(s => String(s).split('|')[0]) }));
}
/* Whether a worldwide entry is an app the page lists already. */
export function sameAsApp(name, appWordSets) {
  const w = words(name); if (!w.length) return true;
  const key = w.join(' ');
  for (const aw of appWordSets) {
    if (aw.join(' ') === key) return true;
    const own = w.filter(x => !GENERIC_WORDS.has(x));
    if (own.length && own.every(x => x.length >= 4 && aw.includes(x))) return true;
  }
  return false;
}
/* Whether a site is the service's OWN, so its visits measure the service:
   a word of the name in the host, or the host's name in the name. A product
   whose site is its maker's (Outlook Express at microsoft.com) is not given
   the maker's visits. */
export function ownSite(name, host) {
  const labels = String(host).toLowerCase().split('.');
  const hostWords = labels.slice(0, -1).join(' ').replace(/[^a-z0-9]+/g, ' ');
  const flat = hostWords.replace(/ /g, '');
  const w = words(name).filter(x => x.length >= 3 && !GENERIC_WORDS.has(x));
  if (w.some(x => flat.includes(x))) return true;
  const first = labels.length > 2 && /^(www|app|web|my|mail|go|en|m)$/.test(labels[0]) ? labels[1] : labels[0];
  return first.length >= 3 && words(name).join('').includes(first);
}
export function buildGlobalServices(root) {
  const dir = join(root, 'data', 'global');
  const cats = appNames(root);
  const appSets = cats.flatMap(c => c.names.map(words));
  const order = cats.map(c => c.id);
  const files = existsSync(dir) ? readdirSync(dir).filter(f => /^[a-z]+\.json$/.test(f)) : [];
  const got = {};
  let generated = '';
  for (const f of files) {
    const d = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (!d || typeof d.topic !== 'string' || !Array.isArray(d.items)) continue;
    got[d.topic] = d.items;
    if (d.generated > generated) generated = d.generated;
  }
  /* The Open Directory's sites for the thin topics (scripts/dmoz-data.mjs):
     shown only where the Chrome UX Report measures the site - categorised by
     people, kept by use. Their id is the site's, since they have no
     Wikidata ID. */
  const dmoz = {};
  const ddir = join(root, 'data', 'dmoz');
  if (existsSync(ddir)) for (const f of readdirSync(ddir).filter(f => /^[a-z]+\.json$/.test(f))) {
    try { const d = JSON.parse(readFileSync(join(ddir, f), 'utf8')); if (d && typeof d.topic === 'string' && Array.isArray(d.items)) dmoz[d.topic] = d.items; } catch (e) {}
  }
  let R = null;
  try { R = JSON.parse(readFileSync(join(root, 'data', 'global-reach.json'), 'utf8')); } catch (e) {}
  const at = new Map(); if (R && Array.isArray(R.hosts)) R.hosts.forEach((h, i) => at.set(h, i));
  const nameOf = new Map();
  for (const list of Object.values(got)) for (const e of list) if (e && e.s && !nameOf.has(e.s)) nameOf.set(e.s, e.n);
  const dmozHost = new Set(Object.values(dmoz).flat().map(e => e && e.s).filter(Boolean));
  /* A directory entry's address IS the site an editor looked at, so its
     visits are its own; a Wikidata entry's site must be its own (ownSite). */
  const trusted = (h) => at.has(h) && (dmozHost.has(h) || ownSite(nameOf.get(h) || '', h));
  const bucket = (h) => { if (!trusted(h)) return 99; const b = +R.g[at.get(h)]; return b || 50; };
  /* A class the topic NAMES (global-data.mjs TOPICS) is the topic's own; one
     found from its apps is accepted only if it names a kind of service. And a
     service is placed first by a named class: every topic's named entries
     are taken before any topic's found ones, so a video service brought into
     Music by a found class stays under Video. */
  const named = (t, c) => (TOPICS[t] || []).includes(c) && !(TOPIC_DROP[t] || []).includes(c);
  /* A found class whose name says another topic (food delivery found from a
     ride app's classes) belongs to that topic, not to the one that found it. */
  const elsewhere = (t, c) => !TOPIC_WORDS[t]?.test(c) && Object.entries(TOPIC_WORDS).some(([u, re]) => u !== t && re.test(c));
  /* A field the topic names (FIELDS: an industry, use or genre) is its own too,
     taken after the classes. */
  const field = (t, c) => /^field /.test(String(c || '')) && (FIELDS[t] || []).includes(String(c).slice(6));
  const kindOk = (t, c) => named(t, c) || field(t, c) || (SERVICE_WORD.test(String(c || '')) && !NOT_A_KIND.test(String(c || '')));
  const seenQ = new Set(), seenHost = new Set(), topics = {};
  const outs = Object.fromEntries(order.map(t => [t, []]));
  for (const pass of [1, 2]) for (const t of order) {
    const out = outs[t];
    for (const e of (got[t] || []).slice().sort((a, b) => (bucket(a.s) - bucket(b.s)) || ((b.w || 0) - (a.w || 0)))) {
      if (!e || (pass === 1) !== named(t, e.c) || !kindOk(t, e.c) || (TOPIC_DROP[t] || []).includes(e.c)) continue;
      if (pass === 2 && !field(t, e.c) && elsewhere(t, String(e.c || ''))) continue;
      if (NOT_FOR_LISTING.test(String(e.s) + ' ' + String(e.n))) continue;
      if (!e || !/^Q\d{1,12}$/.test(e.q) || typeof e.n !== 'string' || e.n.length < 2 || e.n.length > 90) continue;
      if (/[\u0000-\u001f\u007f<>{}\[\]`]|https?:|www\./i.test(e.n) || e.n.split(/\s+/).length > 6) continue;
      if (typeof e.s !== 'string' || e.s.length > 80 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(e.s)) continue;
      if (REFUSED_HOSTS.test(e.s) || REMOVED.test(e.s) || REFUSED_CLASSES.has(e.c)) continue;
      if (seenQ.has(e.q) || seenHost.has(e.s) || sameAsApp(e.n, appSets)) continue;
      seenQ.add(e.q); seenHost.add(e.s);
      out.push({ k: bucket(e.s), w: e.w || 0, r: [e.q, e.n, e.s] });
    }
  }
  for (const t of order) for (const e of dmoz[t] || []) {
    if (!e || typeof e.n !== 'string' || typeof e.s !== 'string' || !at.has(e.s) || !(+R.g[at.get(e.s)] || Object.values(R.c || {}).some(c => +c[at.get(e.s)]))) continue;
    if (e.n.length < 2 || e.n.length > 90 || /[\u0000-\u001f\u007f<>{}\[\]`]|https?:|www\./i.test(e.n) || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(e.s)) continue;
    if (REFUSED_HOSTS.test(e.s) || REMOVED.test(e.s) || NOT_FOR_LISTING.test(e.s + ' ' + e.n)) continue;
    if (seenHost.has(e.s) || sameAsApp(e.n, appSets)) continue;
    seenHost.add(e.s);
    outs[t].push({ k: (+R.g[at.get(e.s)] || 50), w: 0, r: ['D' + createHash('sha1').update(e.s).digest('hex').slice(0, 10), e.n, e.s] });
  }
  /* Each topic in one order across both passes: visits, then coverage. */
  /* At most PER_TOPIC each, the most visited kept: what a person scrolls
     through, and what every visitor downloads. */
  for (const t of order) { const out = outs[t].sort((a, b) => (a.k - b.k) || (b.w - a.w)).slice(0, PER_TOPIC).map(x => x.r); if (out.length) topics[t] = out; }
  /* The visits that order each country's view: one character per host
     shown (its bucket there, 0 for not measured), only for hosts that are
     the service's own and measured somewhere. */
  const hosts = Object.values(topics).flat().map(x => x[2]).filter(trusted).sort();
  const pick = (codes) => hosts.map(h => codes[at.get(h)] || '0').join('');
  const reach = R && hosts.length ? { month: R.month, hosts, g: pick(R.g) } : null;
  /* Each country's codes in a file of its own (global-reach/<CC>.json,
     about 1KB), so a visitor fetches their own country's and no other. */
  const countries = {};
  if (reach) for (const [cc, codes] of Object.entries(R.c || {})) if (/^[A-Z]{2}$/.test(cc)) countries[cc] = JSON.stringify({ month: R.month, codes: pick(codes) });
  return { services: JSON.stringify({ source: 'Wikidata (data/global); ordered by Chrome UX Report visits, then Wikipedia sitelinks', generated, topics, reach }), countries };
}
