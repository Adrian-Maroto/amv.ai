#!/usr/bin/env node
/* COUNTRY DATA, FROM WIKIDATA (Nov 10).

   The owner's bar: Tasks, Crew and Integrations each carry 500+ entries for
   every country, every one of them a real, named service there - "backed by
   real data", not a template with the country's name pasted in.

   Source: Wikidata, the structured database behind Wikipedia. For each
   country and each kind of service (banks, universities, newspapers, telecom
   operators, airlines, retailers, government agencies, insurers, hospitals,
   rail operators, TV channels, utilities, airports, museums...) it asks for
   the organisations that are IN that country, HAVE an official website, and
   are NOT dissolved - ranked by how many Wikipedia language editions have an
   article on them (wikibase:sitelinks), which is a public, checkable measure
   of how prominent something is. Every entry keeps its Wikidata ID, so any
   one of them can be looked up and checked by anybody.

   Run where Wikidata is reachable (the country-data workflow does it):
     node scripts/country-data.mjs            all countries AMV lists
     node scripts/country-data.mjs ES US      just these
   Writes data/countries/<CC>.json and prints, first, what each class ID it
   asks about is called on Wikidata - so a wrong ID shows up in the log as the
   wrong word rather than as quietly wrong data. */
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'countries');
const EP = 'https://query.wikidata.org/sparql';
const UA = 'AMV-country-data/1.0 (public-data builder; contact via the project repository)';

/* kind -> [Wikidata class, how many to keep, label]. The class is matched with
   P31/P279? (an instance of it, or of a direct subclass), which keeps each
   query inside Wikidata's time limit. */
export const KINDS = {
  bank:        ['Q22687',    40, 'bank'],
  insurer:     ['Q6881511',  25, 'insurance company'],
  university:  ['Q3918',     60, 'university'],
  college:     ['Q38723',    40, 'higher education institution'],
  newspaper:   ['Q11032',    40, 'newspaper'],
  newssite:    ['Q1153191',  25, 'online newspaper'],
  tv:          ['Q2001305',  25, 'television channel'],
  radio:       ['Q14350',    20, 'radio station'],
  telecom:     ['Q1941618',  20, 'mobile network operator'],
  isp:         ['Q11371',    15, 'internet service provider'],
  airline:     ['Q46970',    20, 'airline'],
  airport:     ['Q1248784',  25, 'airport'],
  rail:        ['Q249556',   15, 'railway company'],
  bus:         ['Q740752',   15, 'transport company'],
  retail:      ['Q507619',   40, 'retail chain'],
  supermarket: ['Q18043413', 25, 'supermarket chain'],
  ecommerce:   ['Q4382945',  25, 'online shop'],
  restaurant:  ['Q18534542', 20, 'restaurant chain'],
  hotel:       ['Q1631129',  15, 'hotel chain'],
  agency:      ['Q327333',   60, 'government agency'],
  ministry:    ['Q192350',   30, 'ministry'],
  hospital:    ['Q16917',    40, 'hospital'],
  utility:     ['Q1326624',  15, 'electricity supply company'],
  carmaker:    ['Q786820',   15, 'automobile manufacturer'],
  museum:      ['Q33506',    30, 'museum'],
  library:     ['Q7075',     15, 'library'],
  sportsclub:  ['Q476028',   25, 'association football club'],
  employer:    ['Q891723',   40, 'public company'],
  school:      ['Q3914',     40, 'school'],
  research:    ['Q31855',    30, 'research institute'],
  publisher:   ['Q2085381',  25, 'publishing house'],
  software:    ['Q1058914',  25, 'software company'],
  pharma:      ['Q19644607', 20, 'pharmaceutical company'],
  nonprofit:   ['Q163740',   30, 'nonprofit organization'],
  theatre:     ['Q24354',    20, 'theatre building'],
  stadium:     ['Q483110',   20, 'stadium'],
  mall:        ['Q31374404', 25, 'shopping mall'],
  park:        ['Q46169',    20, 'national park'],
  zoo:         ['Q43501',    10, 'zoo'],
  festival:    ['Q132241',   25, 'festival'],
  embassy:     ['Q3917681',  40, 'embassy'],
  union:       ['Q178790',   15, 'labor union'],
  brewery:     ['Q131734',   15, 'brewery'],
  /* Last, and only what no kind above already holds: any business there. */
  company:     ['Q4830453', 120, 'business'],
};
/* Kinds asked for as a direct instance only - the class is too wide for its
   subclasses to be walked inside Wikidata's time limit. */
const DIRECT = new Set(['company', 'school']);
/* The ISO code sits on a wider item than the one things are filed under: NL
   is on the Kingdom of the Netherlands, and its banks are in the Netherlands. */
const QFIX = { NL: 'Q55' };
/* Places whose organisations are filed under another country (Hong Kong's
   under China): matched by where they are or are headquartered as well. */
const PLACE = new Set(['HK', 'MO']);

/* kind -> classes whose members are NOT that kind for a person: a central bank
   is a bank on Wikidata, but nobody opens an account there. Checked by name
   like the classes above; one that is not what it says is not applied. */
export const EXCLUDE = {
  bank: [['Q66344', 'central bank']],
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function sparql(q, tries = 4, ms = 90000) {
  for (let i = 0; i < tries; i++) {
    let r;
    try { r = await fetch(EP + '?format=json&query=' + encodeURIComponent(q), { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' }, signal: AbortSignal.timeout(ms) }); }
    catch (e) { await sleep(3000 * (i + 1)); continue; }   /* a hung or dropped query is retried, never waited on for ever */
    if (r.ok) return (await r.json()).results.bindings;
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * (i + 1) * (i + 1)); continue; }
    throw new Error('wikidata ' + r.status + ' ' + (await r.text()).slice(0, 200));
  }
  throw new Error('wikidata kept refusing');
}
const qid = (uri) => String(uri).split('/').pop();

async function main() {
  mkdirSync(OUT, { recursive: true });
  /* The countries AMV lists: the client's own list, so nothing here invents one. */
  const want = process.argv.slice(2).map(s => s.toUpperCase());
  const src = readFileSync(join(ROOT, 'src', 'worker', '65-country-capabilities.js'), 'utf8');
  const block = src.slice(src.indexOf('const COUNTRY_NAME = {'), src.indexOf('};', src.indexOf('const COUNTRY_NAME = {')));
  const listed = [...new Set([...block.matchAll(/\b([A-Z]{2}):\s*'/g)].map(m => m[1]))];
  const codes = want.length ? want : listed;

  /* What each class is called - the check that the IDs above mean what they say. */
  const cls = Object.values(KINDS).map(k => 'wd:' + k[0]).join(' ');
  const names = await sparql(`SELECT ?c ?l WHERE { VALUES ?c { ${cls} } ?c rdfs:label ?l FILTER(LANG(?l)="en") }`);
  const said = Object.fromEntries(names.map(b => [qid(b.c.value), b.l.value]));
  for (const [kind, [q, , meant]] of Object.entries(KINDS)) {
    if (said[q] === meant) { console.log('class', kind.padEnd(12), q.padEnd(10), 'is "' + meant + '"'); continue; }
    /* The ID is not the class it says: find the class by its exact English
       name - the candidate with the most members - or drop the kind. A wrong
       ID never fills a kind with the wrong things (it once filled "insurer"
       with every enterprise). */
    let fix = null;
    try {
      const c = await sparql(`SELECT ?c (COUNT(?x) AS ?k) WHERE { ?c rdfs:label "${meant}"@en . ?x wdt:P31 ?c } GROUP BY ?c ORDER BY DESC(?k) LIMIT 1`);
      if (c[0] && +c[0].k.value > 20) fix = qid(c[0].c.value);
    } catch (e) {}
    console.log('class', kind.padEnd(12), q.padEnd(10), 'is "' + (said[q] || '?') + '", not "' + meant + '" ->', fix ? 'using ' + fix : 'kind dropped');
    if (fix) KINDS[kind][0] = fix; else delete KINDS[kind];
  }

  const ex = Object.values(EXCLUDE).flat();
  const exSaid = Object.fromEntries((await sparql(`SELECT ?c ?l WHERE { VALUES ?c { ${ex.map(e => 'wd:' + e[0]).join(' ')} } ?c rdfs:label ?l FILTER(LANG(?l)="en") }`)).map(b => [qid(b.c.value), b.l.value]));
  for (const k of Object.keys(EXCLUDE)) EXCLUDE[k] = EXCLUDE[k].filter(([q, meant]) => {
    const okk = exSaid[q] === meant; console.log('exclude', k.padEnd(12), q.padEnd(10), 'is "' + (exSaid[q] || '?') + '"', okk ? '' : '  <-- expected "' + meant + '", not applied'); return okk; });

  const iso = await sparql(`SELECT ?c ?code WHERE { ?c wdt:P297 ?code . FILTER NOT EXISTS { ?c wdt:P576 ?end } }`);
  const qOf = {}; for (const b of iso) if (!qOf[b.code.value]) qOf[b.code.value] = qid(b.c.value);
  Object.assign(qOf, QFIX);

  /* One query per kind per group of countries (not per country): about two
     hundred queries for every country AMV lists, instead of three thousand.
     The ranking is done here, so the query has no ORDER BY to time out on.
     Names come from the label service in the first language that has one,
     so a bank known only by its local name is still kept. */
  const want2 = codes.filter(cc => qOf[cc]);
  codes.filter(cc => !qOf[cc]).forEach(cc => console.log(cc, 'no Wikidata country'));
  const byQ = Object.fromEntries(want2.map(cc => [qOf[cc], cc]));
  const got = Object.fromEntries(want2.map(cc => [cc, {}]));
  const GROUP = 8, LANGS = 'en,mul,es,fr,de,pt,it,nl,sv,pl,ru,uk,tr,ar,fa,he,hi,bn,ur,id,ms,vi,th,ja,ko,zh';
  /* A BUDGET, AND WHAT IS NEW FIRST. The run that added sixteen kinds was
     still going after three hours with nothing written, because files were
     only written at the very end. Now: kinds no file has yet go first; each
     kind has its own time limit and the run has one overall; the files are
     written after every kind; and a kind that was cut short keeps what the
     last run found. Stopping early loses nothing that was finished. */
  const END = Date.now() + (+process.env.BUDGET_MIN || 150) * 60000;
  const had = new Set();
  for (const cc of want2) { try { Object.keys(JSON.parse(readFileSync(join(OUT, cc + '.json'), 'utf8')).kinds || {}).forEach(k => had.add(k)); } catch (e) {} }
  const order = Object.entries(KINDS).sort((a, b) => had.has(a[0]) - had.has(b[0]));
  const whole = new Set();
  for (const [kind, [klass, keep]] of order) {
    if (Date.now() > END) { console.log('kind', kind, 'not asked: out of time'); continue; }
    const kindEnd = Math.min(END, Date.now() + 10 * 60000); let cut = false;
    const plain = want2.filter(cc => !PLACE.has(cc));
    const groups = []; for (let i = 0; i < plain.length; i += GROUP) groups.push(plain.slice(i, i + GROUP));
    want2.filter(cc => PLACE.has(cc)).forEach(cc => groups.push([cc]));
    const run = async (g, again) => {
      if (Date.now() > kindEnd) { cut = true; return; }
      const where = PLACE.has(g[0]) ? '(wdt:P17|wdt:P131|wdt:P159)' : 'wdt:P17';
      const q = `SELECT ?i ?c ?site ?n ?iLabel WHERE {
        VALUES ?c { ${g.map(cc => 'wd:' + qOf[cc]).join(' ')} }
        ?i ${where} ?c ; ${DIRECT.has(kind) ? 'wdt:P31' : 'wdt:P31/wdt:P279?'} wd:${klass} ; wdt:P856 ?site ; wikibase:sitelinks ?n .
        FILTER NOT EXISTS { ?i wdt:P576 ?gone } FILTER NOT EXISTS { ?i wdt:P582 ?ended }
        ${(EXCLUDE[kind] || []).map(([x]) => `FILTER NOT EXISTS { ?i wdt:P31 wd:${x} }`).join(' ')}
        SERVICE wikibase:label { bd:serviceParam wikibase:language "${LANGS}". }
      }`;
      let rows = [];
      try { rows = await sparql(q, again ? 1 : 2, again ? 60000 : 90000); } catch (e) {
        /* A group that timed out is asked again one country at a time - eight
           large countries in one query is what timed out, not any one of them. */
        if (g.length > 1) { for (const cc of g) await run([cc], true); return; }
        cut = true; console.log(kind, g.join(','), 'failed:', e.message); return;
      }
      for (const b of rows) {
        const cc = byQ[qid(b.c.value)]; if (!cc) continue;
        const name = b.iLabel && b.iLabel.value; if (!name || /^Q\d+$/.test(name)) continue;   // no name in any language: skipped, never shown as an ID
        /* Wikidata can be edited by anybody. A name goes into instructions and a
           site is where somebody signs in, so only a plain one-line name and an
           https site with a bare host name are kept (the page checks again). */
        if (name.length < 2 || name.length > 90 || /[\u0000-\u001f\u007f<>{}\[\]`]|https?:|www\./i.test(name)) continue;
        let host = ''; try { const u = new URL(b.site.value); if (u.protocol !== 'https:' && u.protocol !== 'http:') continue; host = u.hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { continue; }
        if (!host || host.length > 80 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host)) continue;
        (got[cc][kind] = got[cc][kind] || []).push({ q: qid(b.i.value), n: name, s: host, w: +b.n.value });
      }
    };
    while (groups.length) { await Promise.all(groups.splice(0, 3).map(run)); await sleep(300); }
    if (!cut) whole.add(kind);
    console.log('kind', kind, cut ? 'cut short - what the last run found is kept where this one has less' : 'done');
    flush();
  }
  flush(true);
  function flush(say) {
  for (const cc of want2) {
    const out = { cc, qid: qOf[cc], source: 'Wikidata (query.wikidata.org), ranked by Wikipedia sitelinks', generated: new Date().toISOString().slice(0, 10), v: 2, kinds: {} };
    let total = 0;
    /* Across kinds too: something that is both a bank and a public company is listed once, under the first. */
    const seen = new Set(), hosts = new Set();
    /* A kind whose query failed this time keeps what the last run found for
       it, so one timeout never empties a section that was right before. */
    let old = {}, oldV = 0; try { const f = JSON.parse(readFileSync(join(OUT, cc + '.json'), 'utf8')); old = f.kinds || {}; oldV = f.v || 0; } catch (e) {}
    for (const [kind, [, keep]] of Object.entries(KINDS)) {
      /* Fresh rows when the kind was asked in full; otherwise whichever of the two has more. */
      const fresh = got[cc][kind] || [], prev = (PLACE.has(cc) || QFIX[cc]) && oldV < 2 ? [] : (old[kind] || []);   // those two were matched wrongly before v2
      const rows = (whole.has(kind) || fresh.length >= prev.length ? fresh : prev).slice().sort((x, y) => y.w - x.w), list = [];
      for (const e of rows) {
        if (seen.has(e.q) || hosts.has(e.s)) continue; seen.add(e.q); hosts.add(e.s);
        /* Past the limit it is still marked as seen, so a football club that
           did not make the first twenty-five clubs is not then listed as a
           nonprofit to volunteer with. */
        if (list.length < keep) list.push(e);
      }
      if (list.length) { out.kinds[kind] = list; total += list.length; }
    }
    out.total = total;
    writeFileSync(join(OUT, cc + '.json'), JSON.stringify(out));
    if (say) console.log(cc, total, Object.entries(out.kinds).map(([k, v]) => k + ':' + v.length).join(' '));
  }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
