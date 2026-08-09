/* EVERY ROUTE EITHER CHECKS WHO IS CALLING, OR SAYS WHY IT DOES NOT.

   An unauthenticated route is the worst single defect a product handling money
   can have, and it is added the same way every time: somebody writes a handler,
   wires it into the switch, and the auth line is the one thing they forget.
   Nothing about the code looks wrong afterwards.

   Computing it found no hole today - every route authenticates through one of
   six helpers, or is public on purpose. This check is so that stays true. The
   risk was never the routes that exist; it is the next one.

   It is an EXHAUSTIVE pair, deliberately: a route is authenticated, or it is
   named here as public with a reason. There is no third state, so a new route
   cannot default into being open by nobody thinking about it.

   Writing this also caught two of my own false positives - adminUsers verifies
   a token by hand rather than calling requireUser, and the admin routes use
   _requireAdmin and _adminOk rather than _adminTokenOK. A checker that does not
   know every way the codebase says "who are you" reports safe code as broken,
   which is how a check gets disabled. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { functionBody } from '../lib/source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');

/* Every way this worker establishes who is calling.

   The named helpers, plus EVERY webhook verifier the worker defines - derived
   from the source rather than typed out, because the list of them is exactly
   what a hand-maintained checker gets wrong. Twilio was the third verifier this
   check did not know about, after two admin helpers, and each omission reported
   safe code as broken. A checker that cries wolf gets deleted. */
const VERIFIERS = [...src.matchAll(/function\s+(verify[A-Za-z]*(?:Signature|Webhook|Token))\s*\(/g)]
  .map(m => m[1]);
const AUTH = new RegExp(
  ['requireUser\\(', '_adminTokenOK\\(', '_adminOk\\(', '_requireAdmin\\(']
    .concat(VERIFIERS.map(v => v + '\\(')).join('|'));

/* Public on purpose, each with the reason it has to be. */
const PUBLIC = {
  '/auth/signup':        'creating an account is how you get credentials',
  '/auth/login':         'signing in is how you get credentials',
  '/auth/google':        'the same, through Google',
  '/auth/reset':         'somebody locked out has no token to present',
  '/auth/reset/confirm': 'same flow, and the emailed code is the credential',
  '/auth/reset/status':  'same flow',
  '/auth/reset/code':    'same flow',
  '/auth/reset/verify':  'same flow',
  '/waitlist':           'a public sign-up form',
  '/v1/market/list':     'the catalogue is meant to be browsable by anyone',
  '/v1/market/view':     'a view counter on a public listing',
  '/v1/widget/config-public': 'the embeddable widget runs on other peoples sites',
  '/v1/widget/chat':     'the same widget, gated by its own key and rate limits',
  '/widget.js':          'the loader script itself',
  '/errors':             'a telemetry sink from browsers that may have no session',
  /* Read before anybody has an account - it is what tells a first-time
     visitor's browser that Google sign-in exists at all. It serves ONLY values
     that are public by design (a Google client id, a PayPal client id, a
     support address), an unset one is absent rather than reported as unset so
     it cannot be used to inventory secrets, and public-config.test.mjs asserts
     all of that against an env deliberately stuffed with twelve real secrets. */
  '/v1/public-config':   'the values a visitor needs before they can sign in',
  /* The people this counts are, by definition, the ones with no account -
     requiring auth would measure only the group already counted everywhere
     else. It stores nothing but a daily integer: no id, no address, no
     referrer, no user agent, so there is nothing here to protect. Bounded per
     IP, and a refused visit still answers 200 because this runs on somebody's
     first page load and a metric must not break the thing it measures. */
  '/v1/visit':           'counting arrivals, from people who have no account yet',
};

/* One definition, in tests/lib/source.mjs. Three files carried an identical
   copy of this, each with its own 30000-character escape hatch - and a copy is
   a second definition that drifts silently. */
const bodyOf = (fn) => functionBody(src, fn);

const routes = [...src.matchAll(/case\s+'([^']+)'\s*:\s*return\s+([A-Za-z_$][\w$]*)\(/g)]
  .map(m => ({ path: m[1], fn: m[2] }))
  .filter(r => bodyOf(r.fn));

section('The route table and every verifier were read');
{
  ok(routes.length > 60, 'routes and their handlers were resolved', routes.length);
  /* If this stops finding them the AUTH pattern narrows silently and the check
     starts passing for the wrong reason. */
  ok(VERIFIERS.length >= 3,
     'every webhook verifier the worker defines is known to this check', VERIFIERS);
}

section('Every route authenticates, or is listed as public with a reason');
{
  const open = routes.filter(r => !AUTH.test(bodyOf(r.fn)) && !(r.path in PUBLIC));
  ok(open.length === 0,
     'no route is reachable without a check that nobody decided to allow',
     open.map(r => r.path + ' -> ' + r.fn));
}

section('And the public list has not gone stale');
{
  /* A path listed as public that no longer exists means the list is describing
     a product that has moved on, and the next reader trusts it anyway. */
  const paths = new Set(routes.map(r => r.path));
  const gone = Object.keys(PUBLIC).filter(p => !paths.has(p));
  ok(gone.length === 0, 'every deliberately-public path is still a real route', gone);

  /* And nothing on it has quietly GAINED auth - if it did, it is no longer an
     exception and should not be excused as one. */
  const nowChecked = Object.keys(PUBLIC)
    .filter(p => { const r = routes.find(x => x.path === p); return r && AUTH.test(bodyOf(r.fn)); });
  ok(nowChecked.length === 0,
     'and nothing excused as public is actually authenticated now', nowChecked);
}

section('The public writes are bounded');
{
  /* Two of the public routes WRITE. Unauthenticated writes need a limit, or the
     storage they touch is a free amplifier. */
  ok(/limitAction\(env, `errreport:/.test(bodyOf('errorsReport')),
     'the error sink is rate limited per IP', true);
  const wl = bodyOf('waitlistAdd');
  ok(/limitAction\(|guardAction\(/.test(wl), 'and so is the waitlist', true);
}

if (report('every-route-decides') > 0) process.exitCode = 1;
done();
