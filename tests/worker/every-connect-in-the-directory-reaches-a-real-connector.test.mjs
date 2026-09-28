/* EVERY CONNECT IN THE DIRECTORY REACHES A CONNECTOR THE SERVER HAS.

   The Integrations directory (src/app/13c-app-catalog.js) says what each row's
   Connect does in a short code - r:<slug> for an app's own connector, p:<id>
   for its standard sign-in, mail:<id> to open the mailbox picker on one
   provider. The code is a NAME, and the server's tables are what the name has
   to mean: REMOTE_APPS, CONN_PROVIDERS, MAIL_PROVIDERS.

   Nothing else joins the two. A row named with a slug the server does not
   know draws a Connect button like every other, and the press fails at the
   one moment somebody wanted it - or, for mail, quietly opens the generic
   picker, which the catalogue's own comment calls harmless and which is in
   fact the Yahoo row opening on Gmail's setup instructions.

   The other direction matters too: a connector the server can really run and
   the directory never offers is work nobody can reach.

   The countries' mailboxes (COUNTRY_MAIL, "Popular in <country>") are held to
   the same rule, because that row is the one a person sees first.

   Read from the sources, not from a running page: these are tables, and a
   table is checked completely by reading it. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const W = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const C = readFileSync(join(ROOT, 'src/app/13c-app-catalog.js'), 'utf8');

/* A literal assigned to `const NAME =`, evaluated on its own. */
function literal(src, name) {
  const at = src.indexOf('const ' + name + ' = ');
  if (at < 0) throw new Error(name + ' not found');
  const j = src.slice(at).search(/[[{]/) + at;
  const open = src[j], close = open === '{' ? '}' : ']';
  let d = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === open) d++;
    else if (src[k] === close && --d === 0) return (0, eval)('(' + src.slice(j, k + 1) + ')');
  }
  throw new Error(name + ' is not closed');
}

const REMOTE = literal(W, 'REMOTE_APPS');
const PROVIDERS = literal(W, 'CONN_PROVIDERS');
const MAIL = literal(W, 'MAIL_PROVIDERS');
const COUNTRY_MAIL = literal(W, 'COUNTRY_MAIL');
const CATS = literal(C, 'AMV_APP_CATS');

const rows = CATS.flatMap(c => c.apps.map(a => { const [name, how = ''] = a.split('|'); return { cat: c.id, name, how }; }));
const coded = (k) => rows.filter(r => r.how.split(':')[0] === k && r.how.includes(':')).map(r => ({ ...r, id: r.how.slice(k.length + 1) }));

section('Every app connector the directory names, the server has');
{
  const r = coded('r');
  ok(r.length >= 20, 'the directory offers app connectors', r.length);
  const missing = r.filter(x => !REMOTE[x.id]);
  ok(missing.length === 0, 'each r:<slug> is a REMOTE_APPS entry', missing.map(x => x.name + ' r:' + x.id));
}

section('Every standard sign-in the directory names, the server has');
{
  const p = coded('p');
  ok(p.length >= 5, 'the directory offers sign-ins', p.length);
  const missing = p.filter(x => !PROVIDERS[x.id]);
  ok(missing.length === 0, 'each p:<id> is a CONN_PROVIDERS entry', missing.map(x => x.name + ' p:' + x.id));
}

section('Every mailbox the directory names opens on that mailbox');
{
  const m = coded('mail');
  ok(m.length >= 4, 'the directory names mailboxes', m.length);
  const missing = m.filter(x => !MAIL[x.id]);
  ok(missing.length === 0, 'each mail:<id> is a MAIL_PROVIDERS entry, not the generic picker', missing.map(x => x.name + ' mail:' + x.id));
}

section('Nothing the server can connect is left out of the directory');
{
  const offered = new Set(coded('r').map(x => x.id));
  const unreached = Object.keys(REMOTE).filter(k => !offered.has(k));
  ok(unreached.length === 0, 'every REMOTE_APPS entry has a row', unreached);
  /* Google, Microsoft and GitHub are offered through Connected accounts
     (g, ms, gh), which lists the scopes; the rest by p:<id>. */
  const viaAccounts = { google: 'g', microsoft: 'ms', github: 'gh' };
  const offeredP = new Set(coded('p').map(x => x.id));
  const hows = new Set(rows.map(r => r.how));
  const unreachedP = Object.keys(PROVIDERS).filter(k => !offeredP.has(k) && !(viaAccounts[k] && hows.has(viaAccounts[k])));
  ok(unreachedP.length === 0, 'every CONN_PROVIDERS entry has a row', unreachedP);
}

section('Every country’s mailboxes are mailboxes the server can open');
{
  const bad = [];
  for (const [cc, list] of Object.entries(COUNTRY_MAIL))
    for (const id of (Array.isArray(list) ? list : [])) if (!MAIL[id] && !['gmail', 'outlook'].includes(id)) bad.push(cc + ':' + id);
  ok(Object.keys(COUNTRY_MAIL).length >= 20, 'countries have their own mailbox lists', Object.keys(COUNTRY_MAIL).length);
  ok(bad.length === 0, 'each is a MAIL_PROVIDERS entry', bad);
}

report();
done();
