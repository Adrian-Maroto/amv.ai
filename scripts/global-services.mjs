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
import { join } from 'path';
import { TOPICS, FIELDS, WP_CATEGORIES, SERVICE_WORD, NOT_A_KIND, TOPIC_WORDS } from './global-data.mjs';
import { FACT_TOPIC, trustedMatch, visitsFrom } from './crew-services.mjs';

/* By site, not by name: a crypto exchange shares its name with one of these. */
const REFUSED_HOSTS = /(^|\.)(openai\.com|chatgpt\.com|anthropic\.com|claude\.ai|gemini\.google\.com|notebook\.google|notebooklm\.google|copilot\.microsoft\.com|perplexity\.ai|midjourney\.com|mistral\.ai|deepseek\.com|x\.ai|grok\.com|character\.ai|runwayml\.com|stability\.ai|leonardo\.ai|ideogram\.ai|synthesia\.io|pika\.art)$/;
const REFUSED_CLASSES = new Set(['password manager', 'cryptocurrency exchange', 'chatbot']);
/* Adult sites and piracy, whatever class brought them (the Wikidata run
   leaves them out by class too; this is the second line). */
const NOT_FOR_LISTING = /(getchu|erolabs|dlsite|nutaku|fanza|missav|jable|supjav|javhd|javlibrary|porn|xxx|xnxx|xhamster|hentai|onlyfans|fansly|stripchat|camsoda|chaturbate|cam4|livejasmin|bongacams|myfreecams|clips4sale|fetlife|ashleymadison|escort|torrent|1337x|piratebay|fitgirl|rarbg|warez|libgen|z-library|sci-hub|scihub|\bmym\b)/i;
/* Password managers and other AI products, whatever brought them in: a
   category ("Personal information managers") can, where a class cannot. */
const PASSWORD_MANAGER = /\b(lastpass|1password|keeper|dashlane|nordpass|roboform|keeweb|keepass\w*|bitwarden|enpass|passwork|password)\b/i;
const AI_PRODUCT = /\b(AI|GPT|LLM|chatbots?|agentic)\b|humanity's last exam|rabbit r1/i;
const REMOVED = /(^|\.)(temu\.com|shein\.com|binance\.com|mega\.nz|mega\.io|wps\.com|mail\.yandex\.[a-z.]+|mail\.ru|vk\.com|paytm\.com|rocket\.chat)$/;
const VENDOR = /^(microsoft|google|apple|adobe|amazon|meta|ibm|oracle|sap|zoho|yahoo)\s+/;
const GENERIC_WORDS = new Set(['mail', 'email', 'calendar', 'drive', 'docs', 'cloud', 'app', 'online', 'web', 'the', 'and', 'for']);
const words = (s) => String(s).toLowerCase().replace(/&amp;/g, '&').replace(VENDOR, '').replace(/\.(com|net|org|io|app)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/* Classes too broad for a topic: "digital distribution platform" is every
   app store, e-book shop and journal site, not games; "online database" is
   every reference site (the Internet Archive, film and lyrics databases), not
   data tools; "podcast directory" two levels down reaches film databases. */
const PER_TOPIC = 300;
const SUBCAT_ELSEWHERE = /computer-aided|\bCAD\b|CAM software|3D|graphics|modeling|engineering|simulation|video game|statistical|statistics|scientific|bioinformatics|computer algebra|typesetting|diagram|network(ing)? (analy|protocol)|packet|programming language|compilers?|build automation|operating system|music|audio|photo|image/i;
const TOPIC_DROP = { games: ['digital distribution platform'], data: ['online database', 'spreadsheet'], music: ['podcast directory'],
  /* Fields too broad to mean the topic (run 6, read by eye): "marketing" and
     "market research" are polling firms and TV stations, "talent management"
     is entertainment agencies, "automation" is industrial robot makers. */
  marketing: ['field marketing', 'field market research'], hr: ['field talent management'],
  /* Run 7, read by eye: "Automation software" is build tools and CAD,
     "Business process outsourcing companies" is IT consultancies. */
  auto: ['field automation', 'category Automation software'], support: ['category Business process outsourcing companies'] };
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
  let R = null;
  try { R = JSON.parse(readFileSync(join(root, 'data', 'global-reach.json'), 'utf8')); } catch (e) {}
  const at = new Map(); if (R && Array.isArray(R.hosts)) R.hosts.forEach((h, i) => at.set(h, i));
  const nameOf = new Map();
  for (const list of Object.values(got)) for (const e of list) if (e && e.s && !nameOf.has(e.s)) nameOf.set(e.s, e.n);
  const trusted = (h) => at.has(h) && ownSite(nameOf.get(h) || '', h);
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
  const field = (t, c) => (/^field /.test(String(c || '')) && (FIELDS[t] || []).includes(String(c).slice(6)))
    || (/^category /.test(String(c || '')) && (WP_CATEGORIES[t] || []).includes(String(c).slice(9).split(' > ')[0])
      /* and a subcategory whose own name says another kind of thing is not
         the topic's: CAD, graphics, video games, statistics, networking... */
      && !SUBCAT_ELSEWHERE.test(String(c).split(' > ')[1] || ''));
  /* A field or category entry is judged by its own rule only - "category X >
     Computer-aided design software" says "software", which must not let it in
     by the class rule. */
  const kindOk = (t, c) => /^(field|category) /.test(String(c || '')) ? field(t, c)
    : (named(t, c) || (SERVICE_WORD.test(String(c || '')) && !NOT_A_KIND.test(String(c || ''))));
  const seenQ = new Set(), seenHost = new Set(), topics = {};
  const outs = Object.fromEntries(order.map(t => [t, []]));
  for (const pass of [1, 2]) for (const t of order) {
    const out = outs[t];
    for (const e of (got[t] || []).slice().sort((a, b) => (bucket(a.s) - bucket(b.s)) || ((b.w || 0) - (a.w || 0)))) {
      if (!e || (pass === 1) !== named(t, e.c) || !kindOk(t, e.c) || (TOPIC_DROP[t] || []).includes(e.c)) continue;
      if (pass === 2 && !field(t, e.c) && elsewhere(t, String(e.c || ''))) continue;
      if (NOT_FOR_LISTING.test(String(e.s) + ' ' + String(e.n)) || PASSWORD_MANAGER.test(String(e.n) + ' ' + String(e.s)) || AI_PRODUCT.test(String(e.n))) continue;
      if (!e || !/^Q\d{1,12}$/.test(e.q) || typeof e.n !== 'string' || e.n.length < 2 || e.n.length > 90) continue;
      if (/[\u0000-\u001f\u007f<>{}\[\]`]|https?:|www\./i.test(e.n) || e.n.split(/\s+/).length > 6) continue;
      if (typeof e.s !== 'string' || e.s.length > 80 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(e.s)) continue;
      if (REFUSED_HOSTS.test(e.s) || REMOVED.test(e.s) || REFUSED_CLASSES.has(e.c)) continue;
      /* Once per topic. A service a topic's OWN class, field or category
         finds is listed there even when another topic lists it too - a CRM
         is Business and Support - while one a topic only found by a shared
         name was already turned away above (elsewhere, TOPIC_DROP). */
      const key = t + '|';
      if (seenQ.has(key + e.q) || seenHost.has(key + e.s) || sameAsApp(e.n, appSets)) continue;
      if (t !== 'legal' && /\b(Government of|Ministry of|Department of)\b/.test(e.n)) continue;
      seenQ.add(key + e.q); seenHost.add(key + e.s);
      out.push({ k: bucket(e.s), w: e.w || 0, r: [e.q, e.n, e.s] });
    }
  }
  /* Each topic in one order across both passes: visits, then coverage. */
  /* At most PER_TOPIC each, the most visited kept: what a person scrolls
     through, and what every visitor downloads. */
  for (const t of order) { const out = outs[t].sort((a, b) => (a.k - b.k) || (b.w - a.w)).slice(0, PER_TOPIC).map(x => x.r); if (out.length) topics[t] = out; }
  /* The visits that order each country's view: one character per host
     shown (its bucket there, 0 for not measured), only for hosts that are
     the service's own and measured somewhere. */
  /* ONE TABLE, POINTED INTO. A service in two topics is written once:
     `entries` holds [id, name, site] and each topic is a list of positions
     in it. Visits are one character per entry, in the same order - 0 where
     the report does not measure the site or it is not the service's own -
     worldwide here and per country in global-reach/<CC>.json. */
  const entries = [], pos = new Map();
  const ids = {};
  for (const [t, rows] of Object.entries(topics)) ids[t] = rows.map(r => {
    if (!pos.has(r[2])) { pos.set(r[2], entries.length); entries.push(r); }
    return pos.get(r[2]);
  });
  const pick = (codes) => entries.map(r => (trusted(r[2]) && codes[at.get(r[2])]) || '0').join('');
  const reach = R ? { month: R.month, g: pick(R.g) } : null;
  /* Each country's codes in a file of its own (global-reach/<CC>.json,
     a few KB), so a visitor fetches their own country's and no other. */
  /* EVERY SERVICE CREW NAMES THERE (Nov 23, the owner: "backed up by Crew
     jobs as well - you might need something for Crew, some integration, and
     I want it to also be in Integrations"). data/crew-services/<CC>.json
     (scripts/crew-services.mjs) holds each service COUNTRY_FACTS names for
     Crew's jobs, with its site; each goes in that country's file as
     [id, name, site, topic, fact], under the topic its fact belongs to,
     unless an app already is that service. Checked like everything else. */
  const crewDir = join(root, 'data', 'crew-services');
  const crew = {};
  /* Only a match that is believed (crew-services.mjs, trustedMatch): in the
     country and named like the service, or a worldwide service people there
     visit. A lookup's first answer is not evidence. */
  const visited = visitsFrom(root);
  const RB = [1000, 5000, 10000, 50000, 100000, 500000, 1000000];
  const hostAt = new Map(((R && R.hosts) || []).map((h, i) => [h, i]));
  const crewRank = (cc, host) => { const c = R && R.c && R.c[cc], i = hostAt.get(host); const k = c && i !== undefined ? +c[i] : 0; return k > 0 ? RB[k - 1] : 0; };
  if (existsSync(crewDir)) for (const f of readdirSync(crewDir).filter(f => /^[A-Z]{2}\.json$/.test(f))) {
    let d = null; try { d = JSON.parse(readFileSync(join(crewDir, f), 'utf8')); } catch (e) { continue; }
    const cc = f.slice(0, 2), rows = [], hostSeen = new Set();
    for (const e of (d && d.items) || []) {
      const topic = FACT_TOPIC[e && e.f]; if (!topic || !trustedMatch(cc, e, visited)) continue;
      if (!/^Q\d{1,12}$/.test(e.q) || typeof e.s !== 'string' || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(e.s)) continue;
      const name = String(e.name || e.n || '').replace(/\s+/g, ' ').trim();
      if (name.length < 2 || name.length > 90 || /[\u0000-\u001f\u007f<>{}\[\]`]|https?:|www\./i.test(name)) continue;
      if (REFUSED_HOSTS.test(e.s) || REMOVED.test(e.s) || NOT_FOR_LISTING.test(e.s + ' ' + name) || PASSWORD_MANAGER.test(name + ' ' + e.s) || AI_PRODUCT.test(name)) continue;
      if (hostSeen.has(e.s) || sameAsApp(name, appSets)) continue;
      /* Its visits from the country, as the rank bucket the country's own
         services carry (r: 1000 = among the top thousand sites there), so
         the page orders Crew's services among them by the same measure. */
      hostSeen.add(e.s); rows.push([e.q, name, e.s, topic, e.f, crewRank(cc, e.s)]);
    }
    if (rows.length) crew[cc] = rows;
  }
  const countries = {};
  for (const cc of new Set(Object.keys((R && R.c) || {}).concat(Object.keys(crew)))) {
    if (!/^[A-Z]{2}$/.test(cc)) continue;
    countries[cc] = JSON.stringify({ month: R ? R.month : '', codes: R && R.c && R.c[cc] ? pick(R.c[cc]) : '', crew: crew[cc] || [] });
  }
  return { services: JSON.stringify({ source: 'Wikidata (data/global); ordered by Chrome UX Report visits, then Wikipedia sitelinks', generated, entries, topics: ids, reach }), countries, topics };
}
