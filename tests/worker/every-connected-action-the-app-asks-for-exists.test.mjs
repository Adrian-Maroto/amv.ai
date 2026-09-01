/* THE NAME ON ONE SIDE HAS TO BE THE NAME ON THE OTHER.

   `_connActRun('gmail.unread')` is a string. Nothing checks it. Get it wrong -
   `github.issue.list` where the server says `github.issues`, a rename that
   moved one of the two - and the route answers `unknown_action` with a 400,
   which the browser surfaces as "AMV does not know that action" on a feature
   that looks completely wired from either end.

   That is the defect this codebase keeps producing: correct at both ends and
   not joined in the middle. It has cost a dead "most used" band, a Crew tab
   behind a locked door, an everyday-jobs route answering 405 to its only
   caller, and - while GitHub was being added - two issue tools reading a
   token from a localStorage key no flow has ever written.

   None of those needed a browser to catch. They needed somebody to compare
   two lists. This compares them.

   The reverse direction is REPORTED, not failed. A server action with no
   caller is usually a client half still to be written, which is a normal
   state to be in mid-change; a client calling something that does not exist
   is always broken. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'connnames.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { CONN_ACTIONS, CONN_PROVIDERS };\n');
const W = await import(harness + '?t=' + Date.now());

/* Comments stripped, so an action named only in a note explaining why it was
   removed is not mistaken for one being called. */
const client = codeOnly(readFileSync(join(ROOT, 'app.js'), 'utf8'));

const served = new Set(Object.keys(W.CONN_ACTIONS));
const asked = [...client.matchAll(/_connActRun\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
const askedSet = new Set(asked);

section('Both lists were really read, so this has a subject');
{
  ok(served.size >= 8, 'the server serves a real set of actions', served.size);
  ok(askedSet.size >= 6, 'and the app asks for a real set of them', askedSet.size);
}

section('Every action the app asks for is one the server answers');
{
  const missing = [...askedSet].filter(a => !served.has(a));
  ok(missing.length === 0,
     'no call names an action that would come back as unknown_action', missing);
}

section('Every capability those actions need is one its provider can grant');
{
  /* The second half of the same seam, and the one that fails later and more
     confusingly: the name resolves, the call is made, and `connUse` refuses
     because the capability it asks for is not in the provider's scope table.
     That reads to somebody as "reconnect your account", which does not help,
     because reconnecting cannot grant a permission nothing offers. */
  const grantable = new Set();
  for (const p of Object.values(W.CONN_PROVIDERS)) {
    for (const cap of Object.keys(p.scopes || {})) grantable.add(cap);
  }
  const bad = [];
  for (const [name, spec] of Object.entries(W.CONN_ACTIONS)) {
    const needs = Array.isArray(spec.need) ? spec.need : [spec.need];
    for (const n of needs) if (n && !grantable.has(n)) bad.push(name + ' needs ' + n);
  }
  ok(bad.length === 0,
     'every action needs a capability some provider actually offers', bad);
}

section('Every action that changes something is marked as a write');
{
  /* `writes` picks the rate limit: ten a minute against sixty. Reading your
     inbox forty times is a busy morning; sending forty messages is not. An
     action that mutates and is not marked gets the generous cap, which is
     the wrong way round to be wrong. */
  const MUTATES = /\.(send|create|copy|share|push|pr|remove|delete|update)$/;
  const unmarked = Object.entries(W.CONN_ACTIONS)
    .filter(([name, spec]) => MUTATES.test(name) && !spec.writes)
    .map(([name]) => name);
  ok(unmarked.length === 0,
     'nothing that writes is bounded by the read limit', unmarked);
}

section('And what the server can do that nothing asks for');
{
  /* Reported rather than failed - a server action with no caller is often a
     client half not written yet. It is printed so it cannot sit unnoticed
     for a year, which is how the last four unreachable routes happened. */
  const unused = [...served].filter(s => !askedSet.has(s));
  ok(true, 'server actions with no caller in the app: '
     + (unused.length ? unused.join(', ') : 'none'), unused.length);
}

if (report('every-connected-action-the-app-asks-for-exists') > 0) process.exitCode = 1;
done();
