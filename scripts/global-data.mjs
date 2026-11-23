#!/usr/bin/env node
/* SERVICES THAT WORK ANYWHERE, PER INTEGRATIONS TOPIC, FROM WIKIDATA (Nov 22).

   The owner: "integrations should have a minimum of 200 per section - email,
   calendar, all these sections - for all countries, backed by research and
   popularity." A country's own file (country-data.mjs) holds the services
   filed under that country: banks, newspapers, universities. It cannot hold
   the email providers, calendar and scheduling tools, messaging apps, file
   stores, password managers and the rest that are used in every country and
   filed under none. This builds those, once, for every country.

   For each topic, the services that are an instance of one of its classes
   (or of a direct subclass), HAVE an official website and are NOT
   discontinued - ranked by how many Wikipedia language editions have an
   article on them (wikibase:sitelinks), the same public measure the country
   files use. The page then orders each country's view by visits from that
   country (Chrome UX Report) where the host is measured.

   Every class is named by its exact English label and RESOLVED BY NAME here
   (the candidate with the most members): a label that does not exist drops
   that class, printed in the log, rather than filling a topic with the wrong
   things. Every entry keeps its Wikidata ID, and is checked like the country
   files: a plain one-line name, an http(s) site with a bare host name.

   Run where Wikidata is reachable (the global-data workflow does it):
     node scripts/global-data.mjs
   Writes data/global/<topic>.json. */
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'global');
const EP = 'https://query.wikidata.org/sparql';
const UA = 'AMV-global-data/1.0 (public-data builder; contact via the project repository)';
const KEEP = 400;

/* topic (the id in AMV_APP_CATS) -> the English labels of its classes. */
export const TOPICS = {
  email:     ['webmail', 'email service', 'email service provider', 'email client', 'email hosting service'],
  calendar:  ['calendaring software', 'scheduling software', 'appointment scheduling software', 'personal information manager', 'time-tracking software'],
  messaging: ['instant messaging client', 'instant messaging service', 'messaging app', 'VoIP software', 'videoconferencing software', 'web conferencing'],
  files:     ['file hosting service', 'cloud storage service', 'online office suite', 'file sharing', 'document management system'],
  money:     ['online bank', 'neobank', 'payment service provider', 'mobile payment system', 'cryptocurrency exchange', 'online payment system', 'personal finance software'],
  dev:       ['integrated development environment', 'source code hosting facility', 'continuous integration software', 'bug tracking system', 'version control system'],
  school:    ['learning management system', 'massive open online course provider', 'educational website', 'language learning software', 'online learning platform'],
  jobs:      ['employment website', 'job board', 'freelance marketplace', 'professional network service'],
  home:      ['smart home platform', 'home automation software', 'real estate website', 'classified advertising website'],
  work:      ['project management software', 'collaborative software', 'note-taking software', 'task management software', 'wiki software'],
  design:    ['graphics software', 'raster graphics editor', 'vector graphics editor', 'video editing software', 'photo sharing website', 'stock photography'],
  video:     ['video on demand service', 'streaming service', 'video hosting service', 'over-the-top media service', 'live streaming platform'],
  music:     ['music streaming service', 'podcast hosting service', 'internet radio', 'audio streaming service'],
  social:    ['social networking service', 'microblogging service', 'online community', 'image sharing website', 'dating website'],
  shop:      ['online marketplace', 'e-commerce platform', 'price comparison service', 'online auction website', 'comparison shopping website'],
  travel:    ['online travel agency', 'travel website', 'flight search engine', 'hotel booking website', 'vacation rental website'],
  maps:      ['web mapping service', 'ridesharing company', 'navigation software', 'vehicle for hire company', 'bicycle-sharing system'],
  food:      ['online food ordering service', 'food delivery service', 'recipe website', 'meal kit company'],
  health:    ['fitness app', 'telehealth service', 'health information website', 'mobile health application', 'meditation app'],
  news:      ['news aggregator', 'news website', 'news agency', 'online magazine', 'blog platform'],
  biz:       ['customer relationship management software', 'enterprise resource planning software', 'accounting software', 'invoicing software', 'point of sale system'],
  marketing: ['email marketing software', 'marketing automation software', 'search engine optimization software', 'advertising network', 'social media management software'],
  support:   ['help desk software', 'customer service software', 'live chat software', 'issue tracking system'],
  auto:      ['workflow automation software', 'robotic process automation software', 'integration platform as a service', 'business process management software'],
  data:      ['business intelligence software', 'database management system', 'data warehouse', 'web analytics software', 'spreadsheet software'],
  cloud:     ['cloud computing provider', 'web hosting service', 'content delivery network', 'platform as a service', 'domain name registrar'],
  monitor:   ['application performance management software', 'network monitoring software', 'log management software', 'website monitoring service'],
  security:  ['password manager', 'antivirus software', 'virtual private network service', 'identity management software', 'two-factor authentication software'],
  legal:     ['electronic signature software', 'legal software', 'contract management software', 'legal information website'],
  hr:        ['human resource management system', 'payroll software', 'applicant tracking system', 'employee scheduling software'],
  testing:   ['software testing tool', 'test automation software', 'web testing software', 'load testing software'],
  games:     ['digital distribution platform', 'online game', 'video game store', 'cloud gaming service', 'massively multiplayer online game'],
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function sparql(q, tries = 4, ms = 90000) {
  for (let i = 0; i < tries; i++) {
    let r;
    try { r = await fetch(EP + '?format=json&query=' + encodeURIComponent(q), { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' }, signal: AbortSignal.timeout(ms) }); }
    catch (e) { await sleep(3000 * (i + 1)); continue; }
    if (r.ok) return (await r.json()).results.bindings;
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * (i + 1) * (i + 1)); continue; }
    throw new Error('wikidata ' + r.status + ' ' + (await r.text()).slice(0, 200));
  }
  throw new Error('wikidata kept refusing');
}
const qid = (uri) => String(uri).split('/').pop();
const esc = (s) => String(s).replace(/["\\]/g, '');

/* A class by its exact English label: the candidate with the most members.
   None, or one with too few members to be a real class of services: null. */
async function classOf(label) {
  try {
    const c = await sparql(`SELECT ?c (COUNT(?x) AS ?k) WHERE { ?c rdfs:label "${esc(label)}"@en . ?x wdt:P31 ?c } GROUP BY ?c ORDER BY DESC(?k) LIMIT 1`, 3, 60000);
    return c[0] && +c[0].k.value >= 5 ? qid(c[0].c.value) : null;
  } catch (e) { return null; }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2);
  const LANGS = 'en,mul,es,fr,de,pt,it,nl,sv,pl,ru,uk,tr,ar,fa,he,hi,bn,ur,id,ms,vi,th,ja,ko,zh';
  const END = Date.now() + (+process.env.BUDGET_MIN || 120) * 60000;
  for (const [topic, labels] of Object.entries(TOPICS)) {
    if (only.length && !only.includes(topic)) continue;
    if (Date.now() > END) { console.log('topic', topic, 'not asked: out of time'); continue; }
    const classes = [];
    for (const l of labels) { const q = await classOf(l); console.log('topic', topic.padEnd(10), ('"' + l + '"').padEnd(46), q ? 'is ' + q : 'NOT FOUND - not used'); if (q) classes.push([q, l]); }
    const rows = new Map();
    for (const [klass, label] of classes) {
      const q = `SELECT ?i ?site ?n ?iLabel WHERE {
        ?i wdt:P31/wdt:P279? wd:${klass} ; wdt:P856 ?site ; wikibase:sitelinks ?n .
        FILTER NOT EXISTS { ?i wdt:P576 ?gone } FILTER NOT EXISTS { ?i wdt:P582 ?ended } FILTER NOT EXISTS { ?i wdt:P2669 ?discontinued }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "${LANGS}". }
      }`;
      let got = [];
      try { got = await sparql(q); } catch (e) { console.log('topic', topic, label, 'failed:', e.message); continue; }
      for (const b of got) {
        const name = b.iLabel && b.iLabel.value; if (!name || /^Q\d+$/.test(name)) continue;
        if (name.length < 2 || name.length > 90 || /[\u0000-\u001f\u007f<>{}\[\]`]|https?:|www\./i.test(name)) continue;
        let host = ''; try { const u = new URL(b.site.value); if (u.protocol !== 'https:' && u.protocol !== 'http:') continue; host = u.hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { continue; }
        if (!host || host.length > 80 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host)) continue;
        const id = qid(b.i.value), w = +b.n.value;
        const prev = rows.get(id);
        if (!prev || prev.w < w) rows.set(id, { q: id, n: name, s: host, w, c: label });
      }
      await sleep(400);
    }
    /* One per site: the same service filed under two classes, or two items for one site, is listed once. */
    const hosts = new Set(), list = [];
    for (const e of [...rows.values()].sort((a, b) => b.w - a.w)) { if (hosts.has(e.s)) continue; hosts.add(e.s); list.push(e); if (list.length >= KEEP) break; }
    let old = []; try { old = JSON.parse(readFileSync(join(OUT, topic + '.json'), 'utf8')).items || []; } catch (e) {}
    /* A topic that came back thinner than last time (a timeout) keeps the last list. */
    const items = list.length >= old.length * 0.8 ? list : old;
    writeFileSync(join(OUT, topic + '.json'), JSON.stringify({ topic, source: 'Wikidata (query.wikidata.org), ranked by Wikipedia sitelinks', classes: classes.map(([q, l]) => q + ' ' + l), generated: new Date().toISOString().slice(0, 10), items }));
    console.log('topic', topic, items.length, items === old ? '(kept the last run: this one had ' + list.length + ')' : '');
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e); process.exit(1); });
