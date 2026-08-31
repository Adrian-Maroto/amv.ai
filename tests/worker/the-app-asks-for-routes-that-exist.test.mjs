/* THE APP ASKED FOR /health FOR THE LIFE OF THE PRODUCT. THE WORKER SERVES
   /v1/health.

   So every healthy deployment answered 404, `r.ok` was false, and the one
   indicator in the product whose entire job is to say whether the backend is
   fine sat permanently on "Some services degraded". Settings had always used
   the right path, which is why two screens disagreed and neither was chased.

   Nothing could have caught it. The client and the worker are different files
   in different runtimes, each perfectly correct about its own half, and a
   404 from a fetch nobody reads the status of is completely silent. It took
   pointing a real browser at the real route table to see it, and that is a
   thing somebody has to think to do.

   This is the cheap permanent version: every path the shipped app asks its own
   backend for is a route the worker serves, or is named below as belonging to
   somebody else's API. An exhaustive pair, so a new route added on one side
   and spelled differently on the other cannot be silent again.

   It reads app.js - the built bundle - rather than the modules, because what
   matters is the path that actually ships. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const client = readFileSync(join(ROOT, 'app.js'), 'utf8');
const worker = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');

/* Every path the worker will answer. */
const ROUTES = new Set([...worker.matchAll(/case\s+'(\/[^']+)'/g)].map(m => m[1]));

/* Every path the app asks for, in each of the shapes it uses to ask.

   AMV_API._fetch takes a path directly. Everything else builds a URL by
   concatenating onto the backend base, and those are the interesting ones -
   a path assembled from pieces is exactly where a spelling drifts. */
const ASKED = new Map();     // path -> how it was found
const add = (p, how) => { if (p && p.startsWith('/') && !ASKED.has(p)) ASKED.set(p, how); };

for (const m of client.matchAll(/_fetch\(\s*[`'"]([^`'"?]+)/g)) add(m[1], '_fetch');
/* base + '/v1/thing' , in any of the spellings the codebase uses for base. */
for (const m of client.matchAll(/(?:AMV_API\.base|\bbase\b|baseUrl)[^;\n]{0,80}?\+\s*[`'"](\/[a-zA-Z0-9\/_-]+)/g)) {
  add(m[1], 'base + literal');
}
/* And the computed ones: `'/v1/finance/' + path` style. The prefix is what
   this file can see; the section below resolves the rest. */
const PREFIXED = [...client.matchAll(/[`'"](\/v1\/[a-z-]+\/)[`'"]\s*\+/g)].map(m => m[1]);

/* Paths that belong to somebody ELSE's API, with whose. A path here is not a
   mistake; a path here that turns out to be ours is. */
const FOREIGN = {
};

section('Both sides were read');
{
  ok(ROUTES.size > 100, 'the worker route table was parsed', ROUTES.size);
  ok(ASKED.size > 50, 'and the paths the app asks for', ASKED.size);
}

section('Every path the app asks its own backend for is a route that exists');
{
  const missing = [...ASKED.keys()]
    .filter(p => !ROUTES.has(p.replace(/\/$/, '')))
    .filter(p => !(p in FOREIGN))
    /* A prefix, resolved separately below. */
    .filter(p => !PREFIXED.includes(p))
    .sort();
  ok(missing.length === 0,
     'nothing is asked for at a spelling the worker does not answer',
     missing.map(p => p + '  (' + ASKED.get(p) + ')'));
}

section('And the paths assembled from pieces resolve too');
{
  /* `base + '/v1/finance/' + path` cannot be read as one string, so the
     suffixes are collected from the call sites and joined back on. This is the
     shape most likely to drift, because neither half looks wrong alone. */
  const unresolved = [];
  for (const prefix of PREFIXED) {
    const fn = prefix.replace(/^\/v1\/([a-z-]+)\/$/, '$1');
    const suffixes = [...client.matchAll(new RegExp('_call\\(\\s*[\'"]([a-z/]+)[\'"]', 'g'))].map(m => m[1]);
    for (const s of suffixes) {
      if (!ROUTES.has(prefix + s) && !ROUTES.has('/v1/' + fn + '/' + s)) {
        /* Only report it against the prefix it plausibly belongs to - the
           suffix list is shared, so a miss is only a miss when NO route with
           this prefix matches. */
        if ([...ROUTES].some(r => r.startsWith(prefix))) unresolved.push(prefix + s);
      }
    }
  }
  ok(unresolved.length === 0, 'every computed path lands on a real route', unresolved);
}

section('The health check in particular, because that is the one that broke');
{
  /* Named on its own. It is the only request in the product whose answer is
     used to tell the user the backend is fine, so it is the one where a 404
     is both silent and maximally misleading. */
  ok(/\/v1\/health/.test(client), 'the app asks for /v1/health', true);
  ok(ROUTES.has('/v1/health'), 'and the worker serves it', true);
  const bad = /[`'"]\/health[`'"]|\+\s*[`'"]\/health/.test(client);
  ok(!bad, 'and nothing still asks for the bare /health that never existed', bad);
}

section('The exclusion list has not gone stale');
{
  /* A foreign path that has since become one of ours would sit here excused
     for ever, which is how an exception outlives the reason for it. */
  const nowOurs = Object.keys(FOREIGN).filter(p => ROUTES.has(p.replace(/\/$/, '')));
  ok(nowOurs.length === 0,
     'nothing excused as another API is now a route we serve', nowOurs);
  const gone = Object.keys(FOREIGN).filter(p => !client.includes(p));
  ok(gone.length === 0, 'and every excused path is still asked for', gone);
}

if (report('the-app-asks-for-routes-that-exist') > 0) process.exitCode = 1;
done();
