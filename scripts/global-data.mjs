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
const KEEP = 800;

/* topic (the id in AMV_APP_CATS) -> the English labels of its classes. */
export const TOPICS = {
  email:     ['webmail', 'email client', 'email hosting service', 'mailbox provider', 'email service', 'email provider', 'email address provider', 'disposable email address service'],
  calendar:  ['appointment scheduling software', 'personal information manager', 'calendar software', 'calendaring software', 'calendar application', 'scheduling software', 'time tracking software', 'time-tracking software', 'calendar app'],
  messaging: ['instant messaging client', 'messaging app', 'VoIP software', 'video-conferencing software', 'instant messaging service', 'videoconferencing service', 'chat application', 'team chat software', 'encrypted messaging app'],
  files:     ['document management system', 'presentation software', 'file-hosting service', 'file hosting service', 'cloud storage service', 'cloud storage', 'online storage service', 'office suite', 'word processor', 'file synchronization software', 'PDF software'],
  money:     ['neobank', 'payment service provider', 'payment system', 'e-commerce payment system', 'mobile payment', 'mobile payment system', 'digital wallet', 'online banking', 'money transfer service', 'remittance service', 'personal finance software', 'budgeting software', 'buy now, pay later'],
  dev:       ['integrated development environment', 'continuous integration software', 'bug tracking system', 'version control system', 'issue tracking system', 'forge', 'repository hosting service', 'code reviewing software', 'software repository', 'source code editor', 'package manager', 'online integrated development environment'],
  school:    ['learning management system', 'massive open online course provider', 'educational website', 'online learning platform', 'educational software', 'language learning application', 'language learning app', 'online tutoring service', 'flashcard software', 'student information system'],
  jobs:      ['employment website', 'freelance marketplace', 'job search engine', 'job board', 'recruitment website', 'professional networking service', 'job website', 'gig economy platform'],
  home:      ['classified advertising website', 'real estate portal', 'property portal', 'real estate website', 'online real estate marketplace', 'smart home platform', 'home automation software', 'home automation system', 'smart home hub'],
  work:      ['project management software', 'collaborative software', 'note-taking software', 'wiki software', 'to-do list manager', 'productivity software', 'task management software', 'mind mapping software', 'whiteboard software', 'outliner'],
  design:    ['graphics software', 'raster graphics editor', 'vector graphics editor', 'video editing software', '3D computer graphics software', 'computer-aided design software', 'photo editing software', 'digital painting software', 'image hosting service', 'stock photography website', 'font foundry', 'prototyping tool', 'user interface design software'],
  video:     ['streaming service', 'over-the-top media service', 'video streaming service', 'online video platform', 'video sharing website', 'video-sharing platform', 'video on demand service', 'live streaming service', 'livestreaming platform', 'streaming television service'],
  music:     ['music streaming service', 'podcast hosting service', 'internet radio', 'audio streaming service', 'podcatcher', 'music recognition app', 'lyrics website', 'audiobook service'],
  social:    ['social networking service', 'online community', 'user-generated content platform', 'microblogging service', 'microblog', 'image sharing website', 'social media platform', 'forum software', 'internet forum', 'question-and-answer website'],
  shop:      ['online marketplace', 'e-commerce platform', 'comparison shopping website', 'very large online platform', 'online auction', 'online auction website', 'price comparison website', 'deal website', 'cashback website', 'online shopping platform'],
  travel:    ['online travel agency', 'travel website', 'hotel booking website', 'metasearch engine', 'travel metasearch engine', 'flight search engine', 'vacation rental website', 'vacation rental platform', 'travel search engine'],
  maps:      ['ridesharing company', 'bicycle-sharing system', 'online taxi service', 'internet map service', 'web mapping service', 'navigation software', 'navigation app', 'route planner', 'journey planner', 'carsharing', 'scooter-sharing system', 'public transport app'],
  food:      ['online food ordering service', 'food delivery', 'delivery app', 'online food ordering', 'food delivery company', 'recipe website', 'cooking website', 'online grocery store', 'grocery delivery service', 'meal kit', 'restaurant review website', 'table reservation service'],
  health:    ['fitness app', 'telemedicine', 'telemedicine platform', 'telehealth', 'health app', 'mobile health application', 'meditation app', 'meditation application', 'period tracker', 'online pharmacy', 'medical website', 'health website', 'calorie counter', 'activity tracker'],
  news:      ['news aggregator', 'news website', 'news agency', 'online magazine', 'publishing platform', 'blog hosting service', 'blogging platform', 'newsletter platform'],
  biz:       ['customer relationship management software', 'accounting software', 'online survey service', 'enterprise resource planning software', 'ERP software', 'enterprise resource planning', 'point of sale', 'point-of-sale software', 'invoicing software', 'business software', 'e-invoicing', 'form builder'],
  marketing: ['advertising network', 'email marketing service', 'email marketing software', 'marketing software', 'marketing automation software', 'search engine optimization software', 'online advertising platform', 'advertising platform', 'affiliate network', 'social media management software', 'customer engagement platform', 'web analytics service', 'link shortener', 'URL shortening service'],
  support:   ['help desk software', 'issue tracking system', 'help desk', 'customer service software', 'customer support software', 'live chat software', 'live chat', 'ticketing system', 'knowledge base software', 'customer feedback software'],
  auto:      ['workflow automation software', 'workflow management system', 'business process automation', 'business process management software', 'integration platform as a service', 'integration platform', 'robotic process automation', 'automation software', 'low-code development platform', 'no-code development platform', 'web scraping software'],
  data:      ['business intelligence software', 'database management system', 'data warehouse', 'web analytics software', 'spreadsheet software', 'data visualization software', 'analytics software', 'statistical software'],
  cloud:     ['web hosting service', 'content delivery network', 'platform as a service', 'domain name registrar', 'cloud computing service', 'cloud service provider', 'infrastructure as a service', 'cloud computing provider', 'serverless computing platform', 'website builder'],
  monitor:   ['network monitoring software', 'network monitoring', 'system monitor', 'application performance management', 'application performance monitoring', 'log management software', 'observability platform', 'monitoring software', 'website monitoring service', 'uptime monitoring service', 'status page'],
  security:  ['password manager', 'antivirus software', 'virtual private network service', 'VPN service', 'firewall software', 'identity management software', 'identity provider', 'authenticator', 'two-factor authentication software', 'single sign-on'],
  legal:     ['electronic signature software', 'electronic signature service', 'digital signature software', 'legal software', 'legal database', 'legal research database', 'contract management software', 'contract lifecycle management', 'legal information website', 'online legal services'],
  hr:        ['human resource management system', 'applicant tracking system', 'payroll software', 'payroll service', 'human resources software', 'employee scheduling software', 'recruitment software', 'employer of record', 'performance management software', 'learning experience platform'],
  testing:   ['software testing tool', 'test automation software', 'test automation framework', 'unit testing framework', 'load testing tool', 'automated testing tool', 'web testing software', 'cross-browser testing tool', 'fuzzing tool', 'test management tool'],
  games:     ['video game distribution platform', 'online game', 'cloud gaming service', 'online chess playing site', 'video game store', 'massively multiplayer online role-playing game', 'browser game', 'mobile game', 'free-to-play video game', 'game server hosting', 'game launcher'],
};

/* THE SECOND WAY IN: WHAT A SERVICE IS FOR (run 6, Nov 23). The owner: "200
   for all sections, all countries". Classes alone give few calendar, HR,
   marketing, support, legal, testing, monitoring and automation services,
   because Wikidata files most of those as a company with an INDUSTRY (P452),
   or a product with a USE (P366) or GENRE (P136) - Gusto is a company whose
   industry is payroll, not an instance of "payroll software". So each topic
   also names fields; an item with an official website whose industry, use
   or genre is one of them is a candidate too, and is ordered by visits like
   the rest. Each field is resolved by its exact English label, like classes. */
export const FIELDS = {
  email:     ['email', 'webmail', 'email hosting service', 'email encryption'],
  calendar:  ['calendar', 'scheduling', 'time management', 'time tracking', 'appointment scheduling', 'event management', 'personal information management'],
  messaging: ['instant messaging', 'videotelephony', 'voice over IP', 'web conferencing', 'online chat', 'team communication'],
  files:     ['file hosting service', 'cloud storage', 'file sharing', 'data storage', 'document management', 'office suite', 'PDF', 'backup'],
  money:     ['financial technology', 'mobile payment', 'online banking', 'payment processing', 'personal finance', 'money transfer', 'digital wallet', 'budgeting'],
  dev:       ['software development', 'software engineering', 'DevOps', 'version control', 'continuous integration', 'web development', 'programming tool'],
  school:    ['educational technology', 'e-learning', 'online learning', 'language learning', 'online tutoring', 'distance education'],
  jobs:      ['recruitment', 'employment', 'job search', 'online job board', 'freelancing', 'gig economy'],
  home:      ['real estate', 'home automation', 'smart home', 'property management', 'home improvement', 'moving company'],
  work:      ['project management', 'productivity', 'collaboration', 'note-taking', 'task management', 'knowledge management', 'business productivity software'],
  design:    ['graphic design', 'computer graphics', 'photo editing', 'video editing', '3D modeling', 'computer-aided design', 'web design', 'stock photography'],
  video:     ['video on demand', 'streaming media', 'video hosting', 'live streaming', 'internet television'],
  music:     ['music streaming', 'podcast', 'internet radio', 'audiobook', 'digital music'],
  social:    ['social media', 'social networking', 'online community', 'microblogging', 'internet forum'],
  shop:      ['e-commerce', 'online shopping', 'online marketplace', 'price comparison', 'online auction', 'retail'],
  travel:    ['online travel agency', 'travel', 'hotel reservation', 'airline reservations system', 'vacation rental', 'tourism'],
  maps:      ['ridesharing', 'navigation', 'web mapping', 'vehicle for hire', 'bicycle-sharing', 'carsharing', 'micromobility', 'public transport'],
  food:      ['food delivery', 'online food ordering', 'meal kit', 'online grocer', 'recipe', 'fast food restaurant', 'restaurant reservation', 'grocery delivery'],
  health:    ['telemedicine', 'digital health', 'mobile health', 'physical fitness', 'pharmacy', 'online pharmacy', 'mental health', 'meditation', 'nutrition', 'health informatics', 'health insurance'],
  news:      ['news', 'journalism', 'news aggregator', 'online newspaper', 'newsletter'],
  biz:       ['enterprise software', 'accounting', 'customer relationship management', 'enterprise resource planning', 'point of sale', 'invoice', 'business software', 'e-invoicing'],
  marketing: ['marketing', 'digital marketing', 'online advertising', 'advertising', 'email marketing', 'search engine optimization', 'affiliate marketing', 'social media marketing', 'marketing automation', 'market research', 'influencer marketing', 'content marketing'],
  support:   ['customer service', 'help desk', 'customer support', 'customer relationship management', 'call centre', 'customer experience', 'customer engagement', 'live chat'],
  auto:      ['business process automation', 'workflow', 'workflow management', 'robotic process automation', 'automation', 'low-code development platform', 'no-code development platform', 'integration platform as a service', 'web scraping', 'business process management'],
  data:      ['data analysis', 'business intelligence', 'big data', 'analytics', 'database', 'data science', 'data visualization', 'web analytics', 'data management'],
  cloud:     ['cloud computing', 'web hosting service', 'domain name registrar', 'data center', 'content delivery network', 'serverless computing', 'website builder'],
  monitor:   ['network monitoring', 'system monitoring', 'application performance management', 'observability', 'log management', 'website monitoring', 'IT infrastructure management', 'IT operations', 'incident management', 'site reliability engineering'],
  security:  ['computer security', 'cybersecurity', 'information security', 'antivirus software', 'virtual private network', 'identity management', 'endpoint security', 'network security', 'cloud security', 'authentication'],
  legal:     ['legal technology', 'electronic signature', 'digital signature', 'contract management', 'legal research', 'online legal services', 'intellectual property', 'trademark', 'compliance', 'regulatory compliance'],
  hr:        ['human resources', 'human resource management', 'payroll', 'recruitment', 'employment agency', 'staffing', 'talent management', 'employee benefits', 'professional employer organization', 'workforce management'],
  testing:   ['software testing', 'quality assurance', 'test automation', 'unit testing', 'performance testing', 'web testing', 'usability testing', 'penetration test', 'bug bounty program'],
  games:     ['video game industry', 'online game', 'esports', 'video game distribution', 'cloud gaming', 'browser game', 'mobile game'],
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

/* CLASSES FOUND FROM THE APPS ALREADY LISTED (run 2, Nov 23). Run 1 named
   classes by guessed labels and a third of them do not exist ("email
   service", "calendaring software", "legal software"), so twelve topics came
   back thin and three empty. Each topic now also asks Wikidata what its own
   apps ARE: the names in AMV_APP_CATS (src/app/13c-app-catalog.js) are
   looked up by English label, and every class that at least two of them are
   an instance of is used - unless it is a generic class (software, website,
   company...) or too big to be a kind of service. */
const GENERIC = new Set(['Q7397', 'Q35127', 'Q166142', 'Q620615', 'Q4830453', 'Q783794', 'Q891723', 'Q6881511', 'Q1058914', 'Q218616', 'Q341',
  'Q193424', 'Q189210', 'Q658255', 'Q431289', 'Q167037', 'Q43229', 'Q4182287', 'Q1668024', 'Q7094076', 'Q1371849', 'Q5633421', 'Q1331793',
  'Q2085381', 'Q17155032', 'Q1639024', 'Q3220391', 'Q506240', 'Q1107679', 'Q21980538', 'Q19967801', 'Q15265344', 'Q3966', 'Q1640628']);
/* Words that say which topic a class belongs to; a class found from one
   topic's apps that names another is left to that one. */
export const TOPIC_WORDS = {
  food: /\b(food|meal|recipe|restaurant|grocer)/i,
  maps: /\b(map|mapping|navigation|ride|taxi|bicycle|vehicle|transit)/i,
  music: /\b(music|podcast|radio|audio)/i,
  video: /\b(video|film|movie|television|over-the-top)/i,
  games: /\b(game|gaming|chess)/i,
  money: /\b(bank|payment|wallet|money)/i,
  email: /\b(e-?mail|mailbox|webmail)/i,
};
const MAX_CLASS = 25000;
/* A class found from the apps must name a KIND OF SERVICE. Run 2 took every
   class two apps shared and got towns (an app called Cary), restaurant
   chains, television stations and "technology company". So its English label
   must say software, service, app, site, platform and the like, and must not
   say a place, a company or a broad catch-all. */
export const SERVICE_WORD = /\b(software|service|services|app|apps|application|client|platform|website|site|provider|system|manager|marketplace|exchange|engine|editor|aggregator|messaging|messenger|streaming|hosting|registrar|delivery|wallet|payment|neobank|store|database|warehouse|directory|podcast|podcatcher|radio|forge|repository|tracker|tool|environment|game|ordering|agency|network)\b/i;
export const NOT_A_KIND = /\b(town|city|village|county|municipality|borough|company|corporation|firm|enterprise|conglomerate|station|channel|character|product|community|project|organi[sz]ation|business|chain|restaurant|person|film|series|discipline|developer|framework|technology|privately|dot-com|super-app|mobile software|software as a service|computing platform|search engine|review site|content management system|commercial bank|television)\b/i;
/* Never listed, whatever class brings them: adult sites and piracy. Resolved
   by label like every class; an item that is one, or has one as its genre or
   main subject, is left out. */
const NEVER = ['pornographic website', 'pornography', 'adult website', 'webcam model', 'BitTorrent tracker', 'BitTorrent index', 'torrent website', 'warez', 'shadow library', 'escort agency', 'online dating service', 'dating website', 'adult entertainment'];
export function seedNames(root = ROOT) {
  const src = readFileSync(join(root, 'src', 'app', '13c-app-catalog.js'), 'utf8');
  const m = src.match(/const AMV_APP_CATS = (\[[\s\S]*?\n\]);/);
  if (!m) return {};
  const cats = (0, eval)(m[1]);
  const out = {};
  for (const c of cats) out[c.id] = c.apps.map(s => String(s).split('|')[0].replace(/&amp;/g, '&').trim()).filter(n => n.length >= 2 && n.length <= 60 && !/["\\]/.test(n));
  return out;
}
async function seedClasses(names, topic) {
  if (names.length < 2) return [];
  const vals = names.map(n => '"' + esc(n) + '"@en').join(' ');
  let got = [];
  try {
    got = await sparql(`SELECT ?c (SAMPLE(?cl) AS ?label) (COUNT(DISTINCT ?i) AS ?k) WHERE {
      VALUES ?name { ${vals} } ?i rdfs:label ?name ; wdt:P856 ?site ; wdt:P31 ?c . ?c rdfs:label ?cl . FILTER(LANG(?cl) = "en")
    } GROUP BY ?c HAVING (COUNT(DISTINCT ?i) >= 2) ORDER BY DESC(?k) LIMIT 20`, 3, 90000);
  } catch (e) { console.log('  seed lookup failed:', e.message); return []; }
  const out = [];
  for (const b of got) {
    const c = qid(b.c.value), label = b.label.value;
    if (GENERIC.has(c)) { console.log('  seed class', c, label, 'skipped: generic'); continue; }
    if (!SERVICE_WORD.test(label) || NOT_A_KIND.test(label)) { console.log('  seed class', c, label, 'skipped: not a kind of service'); continue; }
    if (!TOPIC_WORDS[topic]?.test(label) && Object.entries(TOPIC_WORDS).some(([u, re]) => u !== topic && re.test(label))) { console.log('  seed class', c, label, 'skipped: another topic\'s'); continue; }
    let size = Infinity;
    try { const r = await sparql(`SELECT (COUNT(?x) AS ?k) WHERE { ?x wdt:P31 wd:${c} }`, 2, 45000); size = +r[0].k.value; } catch (e) {}
    if (!(size <= MAX_CLASS)) { console.log('  seed class', c, label, 'skipped:', size === Infinity ? 'too big to count' : size + ' members'); continue; }
    console.log('  seed class', c, label, 'used:', b.k.value, 'of its apps,', size, 'members');
    out.push([c, label]);
    if (out.length >= 8) break;
    await sleep(300);
  }
  return out;
}

/* A field by its exact English label: the item with that label that most
   things name as their industry, use or genre. */
async function fieldOf(label) {
  try {
    const c = await sparql(`SELECT ?c (COUNT(?x) AS ?k) WHERE { ?c rdfs:label "${esc(label)}"@en . ?x wdt:P452|wdt:P366|wdt:P136 ?c } GROUP BY ?c ORDER BY DESC(?k) LIMIT 1`, 3, 60000);
    return c[0] && +c[0].k.value >= 3 ? qid(c[0].c.value) : null;
  } catch (e) { return null; }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const SEEDS = seedNames();
  const never = [];
  for (const l of NEVER) { const q = await classOf(l); console.log('never', ('"' + l + '"').padEnd(30), q ? 'is ' + q : 'not found'); if (q) never.push('wd:' + q); }
  const NOPE = never.length ? `FILTER NOT EXISTS { VALUES ?bad { ${never.join(' ')} } ?i (wdt:P31|wdt:P136|wdt:P921|wdt:P31/wdt:P279) ?bad }` : '';
  const only = process.argv.slice(2);
  const LANGS = 'en,mul,es,fr,de,pt,it,nl,sv,pl,ru,uk,tr,ar,fa,he,hi,bn,ur,id,ms,vi,th,ja,ko,zh';
  const END = Date.now() + (+process.env.BUDGET_MIN || 120) * 60000;
  for (const [topic, labels] of Object.entries(TOPICS)) {
    if (only.length && !only.includes(topic)) continue;
    if (Date.now() > END) { console.log('topic', topic, 'not asked: out of time'); continue; }
    const classes = [];
    for (const l of labels) { const q = await classOf(l); console.log('topic', topic.padEnd(10), ('"' + l + '"').padEnd(46), q ? 'is ' + q : 'NOT FOUND - not used'); if (q) classes.push([q, l]); }
    for (const [q, l] of await seedClasses(SEEDS[topic] || [], topic)) if (!classes.some(([c]) => c === q)) classes.push([q, l]);
    const rows = new Map();
    const fields = [];
    for (const l of FIELDS[topic] || []) { const q = await fieldOf(l); console.log('topic', topic.padEnd(10), ('field "' + l + '"').padEnd(46), q ? 'is ' + q : 'NOT FOUND - not used'); if (q) fields.push([q, l]); }
    const asks = classes.map(([q, l]) => [`?i wdt:P31/wdt:P279?/wdt:P279? wd:${q}`, l]).concat(fields.map(([q, l]) => [`?i wdt:P452|wdt:P366|wdt:P136 wd:${q} . FILTER NOT EXISTS { ?i wdt:P31 wd:Q5 }`, 'field ' + l]));
    for (const [match, label] of asks) {
      const q = `SELECT ?i ?site ?n ?iLabel WHERE {
        ${match} . ?i wdt:P856 ?site ; wikibase:sitelinks ?n .
        FILTER NOT EXISTS { ?i wdt:P576 ?gone } FILTER NOT EXISTS { ?i wdt:P582 ?ended } FILTER NOT EXISTS { ?i wdt:P2669 ?discontinued }
        ${NOPE}
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
    let old = [], oldClasses = ''; try { const o = JSON.parse(readFileSync(join(OUT, topic + '.json'), 'utf8')); old = o.items || []; oldClasses = (o.classes || []).join('|'); } catch (e) {}
    /* A topic that came back thinner than last time from the SAME classes (a
       timeout) keeps the last list; new classes are a new list. */
    const same = oldClasses === classes.map(([q, l]) => q + ' ' + l).concat(fields.map(([q, l]) => q + ' field ' + l)).join('|');
    const items = !same || list.length >= old.length * 0.8 ? list : old;
    writeFileSync(join(OUT, topic + '.json'), JSON.stringify({ topic, source: 'Wikidata (query.wikidata.org), ranked by Wikipedia sitelinks', classes: classes.map(([q, l]) => q + ' ' + l).concat(fields.map(([q, l]) => q + ' field ' + l)), generated: new Date().toISOString().slice(0, 10), items }));
    console.log('topic', topic, items.length, items === old ? '(kept the last run: this one had ' + list.length + ')' : '');
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e); process.exit(1); });
