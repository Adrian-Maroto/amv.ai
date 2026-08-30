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
import { functionBody, codeOnly } from '../lib/source.mjs';

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
/* _adminGate is the fifth way, and the one that caught this check out: fourteen
   admin routes moved from calling _requireAdmin directly to calling the gate
   that rate-limits AND checks the token, and every one of them was reported
   here as newly unauthenticated. Recognising a name is only safe if the name
   really does the check, so that is asserted below rather than assumed. */
const AUTH = new RegExp(
  ['requireUser\\(', '_adminTokenOK\\(', '_adminOk\\(', '_adminGate\\(', '_mailRun\\(']
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
  /* Aggregate counts of a catalogue that is already public, so there is nothing
     here that a login would protect - and requiring one to read a leaderboard
     of your own product's features helps nobody. The record it reads holds
     catalogue id to integer and nothing else: no address, no job text, no
     per-user timestamp, so there is nothing in it to attribute to a person.
     It only READS, and it is bounded per IP because an endpoint anybody can
     reach without a credential is the one worth hammering. */
  '/crew/popular':       'a ranking of a public catalogue, read by people deciding what to try',
  /* The catalogue itself, opened deliberately and with the owner's sign-off.
     The handler returns three constants and nothing else - the ten universal
     jobs, the five for the country asked about, and the country names for the
     picker. It reads no storage, writes none, and takes two characters of
     country code as its only input, so there is no record here belonging to
     anybody and nothing a login would protect.

     Why it is open rather than merely harmless: "does this do anything where I
     live" is a question people ask BEFORE signing up, and a login wall answers
     a different one. Unlike /crew/popular it needs no per-IP ceiling, because
     it touches no storage - a cache header and constants make a flood cheap to
     serve, and a rate limiter would cost a round trip more than the handler. */
  '/v1/everyday':        'what AMV does where you live, asked before anybody signs up',
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

section('Each name this check accepts as "authenticates" actually does');
{
  /* The failure mode of a list like AUTH is not that it misses a helper - that
     shows up immediately as a false positive. It is that somebody adds a name
     to it to make this file green, and the name does not check anything. Every
     accepted name is read here, so accepting one is a claim with evidence. */
  /* codeOnly, because the first version of this assertion passed on a COMMENT.
     It looked for the refusal status in _adminGate and found it in the
     sentence explaining which status the function no longer returns. */
  const gate = codeOnly(bodyOf('_adminGate'));
  ok(/_adminTokenOK\(/.test(gate), '_adminGate verifies the admin token', true);
  ok(/return json\([^)]*\},\s*40[13]\s*\)/.test(gate.replace(/\s+/g, ' ')),
     'and returns a refusal when it does not match', gate.replace(/\s+/g, ' ').slice(-260));
  ok(/_adminTokenOK\(/.test(codeOnly(bodyOf('_adminOk'))), '_adminOk does too', true);
  /* _requireAdmin used to be on this list. It is deleted (AMV-052): it was a
     bare "is this an admin" predicate with no ceiling and no audit, and three
     routes reached for it instead of the gate. A name that is easier to call
     than the correct thing gets called, so the fix was to remove the name. */
  ok(!/function _requireAdmin\b/.test(codeOnly(src)),
     'and the bare admin predicate is gone rather than merely unused', true);

  /* The sixth way, and the one that caught this check out again: the mail
     routes hand the whole request to _mailRun, which authenticates, rate
     limits and loads the mailbox. Recognising the name is only safe if the
     name really does the check. */
  const mail = codeOnly(bodyOf('_mailRun'));
  ok(/requireUser\(/.test(mail), '_mailRun authenticates', true);
  ok(/return json\(\{ error: 'unauthorized' \}, 401\)/.test(mail.replace(/\s+/g, ' ')),
     'and refuses when there is nobody there', true);

  /* And the gate must not be able to let somebody through by failing. Storage
     being unreachable relaxes the RATE LIMIT deliberately; it must never
     relax the token, so the refusal cannot sit before the check. */
  /* The rate limit lives in its own function now (AMV-052), because one caller
     authenticates by session and wants the ceiling without a way past the token
     check - and the first attempt at that was a flag into this gate, which put
     a `return null` in front of the token check. Exactly what this rule is for.

     So the property is checked across the two: the gate runs the limiter, then
     the token check, with nothing returning in between; and the limiter is
     asked no question about tokens at all, so it cannot answer one wrongly. */
  const lIdx = gate.indexOf('_adminRateLimit'), tIdx = gate.indexOf('_adminTokenOK');
  ok(lIdx > 0 && tIdx > lIdx, 'the gate limits first and then checks the token', { lIdx, tIdx });
  ok(!/return null/.test(gate.slice(lIdx, tIdx)),
     'with nothing returning early in between', gate.slice(lIdx, tIdx).replace(/\s+/g, ' ').slice(0, 120));

  const limiter = codeOnly(bodyOf('_adminRateLimit'));
  ok(/unavailable/.test(limiter), 'the limiter is the one that relaxes on an outage', true);
  ok(!/_adminTokenOK|requireUser/.test(limiter),
     'and it never decides who is calling, so it cannot let anybody through', true);
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
  /* And the public READ. It writes nothing, which is why it is in this section
     rather than above it - but it costs a storage read per call, and an
     unauthenticated call that costs anything is somebody else's free amplifier
     unless it is bounded. */
  const pop = bodyOf('crewPopular');
  ok(/limitAction\(|guardAction\(/.test(pop), 'and the public ranking read is limited too', true);
  ok(/CF-Connecting-IP/.test(pop), 'per caller rather than as one global tap', true);
}

section('Every route the client asks for with a GET is allowed to answer one');
{
  /* THE ROUTE THAT ANSWERED 405 TO ITS ONLY CALLER, FOR AS LONG AS IT EXISTED.

     AMV_API.crewPopular() calls /crew/popular with no method, which is a GET.
     The router refuses a GET unless the path is on GET_SAFE, and it was not,
     so every request the product ever made to that route came back "does not
     accept GET requests". The most-used band had no data because it was never
     given any - and it degraded politely into "not enough runs yet", which is
     indistinguishable from a young product, so nothing ever looked wrong.

     Nothing caught it because the suite covering that band stubs fetch: it
     proves the rendering, and a stub answers whatever verb it is asked. The
     two halves were each correct and never met.

     So this reads the shipped client, works out which paths it fetches without
     naming a method, and checks the router will actually answer them. It is
     the general form of the bug rather than a note about one route - the same
     mistake was made again the same week on /v1/everyday. */
  const client = readFileSync(join(ROOT, 'app.js'), 'utf8');

  /* _fetch(path) with no second argument, or a second argument that names no
     method, is a GET. Template literals are taken by their static prefix,
     which is what the router matches on anyway. */
  const calls = [...client.matchAll(/_fetch\(\s*(['"`])([^'"`$]+)[^)]*?\)/g)]
    .map(m => ({ raw: m[0], path: m[2].split('?')[0].replace(/\/+$/, '') }))
    .filter(c => c.path.startsWith('/'));
  const gets = [...new Set(calls.filter(c => !/method\s*:/.test(c.raw)).map(c => c.path))];

  ok(gets.length > 3, 'the client really does fetch some paths as GETs', gets.length);

  /* GET_SAFE is read from the worker rather than restated, so this cannot pass
     by agreeing with a copy of itself. Comments are stripped first: the list is
     annotated in prose, prose contains apostrophes ("the caller's own data"),
     and an apostrophe shifts the quote pairing so that the next two real
     entries are read as one string between them. Without this the check
     reported /api/jobs and /v1/resume as refused when both are plainly on the
     list - a check wrong about the product rather than the other way round,
     which is the failure mode these files exist to avoid. */
  const code = codeOnly(src);
  const safeBlock = code.slice(code.indexOf('const GET_SAFE'));
  const safe = new Set([...safeBlock.slice(0, safeBlock.indexOf(']);'))
    .matchAll(/'([^']+)'/g)].map(m => m[1]));
  ok(safe.size > 10, 'and GET_SAFE was read from the worker, not restated here', safe.size);

  /* EVERY path in the table, including the ones whose case does not end in a
     bare call. Two routes branch on the verb inside the case - `return method
     === 'POST' ? a(...) : b(...)` - and the `routes` list above only matches a
     plain `return fn(`, so /api/jobs and /api/handoff were absent from it.
     They are exactly the two routes where the verb matters most, and the check
     was skipping them for lack of a name to look up. */
  const allPaths = new Set([...code.matchAll(/case\s+'([^']+)'\s*:/g)].map(m => m[1]));
  ok(allPaths.size > routes.length,
     'the path list includes routes that branch inside the case', allPaths.size);

  const refused = gets.filter(p => allPaths.has(p) && !safe.has(p));
  ok(refused.length === 0,
     'no path the client GETs is one the router answers 405 to', refused);

  /* And the other half of the same seam: a path the client asks for that the
     router has no case for at all. That is how this went wrong once already -
     the note beside _mcScheduleServer records a client posting for months to
     /api/schedule/create, a route the Worker has never had. */
  const everyCall = [...client.matchAll(/_fetch\(\s*(['"`])([^'"`$]+)/g)]
    .map(m => m[2].split('?')[0].replace(/\/+$/, ''))
    .filter(p => p.startsWith('/'));
  /* Some routes are matched by prefix rather than by an exact case. */
  const prefixes = [...code.matchAll(/path\.startsWith\('([^']+)'\)/g)].map(m => m[1]);
  const nowhere = [...new Set(everyCall)]
    .filter(p => !allPaths.has(p) && !prefixes.some(x => p.startsWith(x)));
  ok(nowhere.length === 0,
     'every path the client asks for is one the router actually has', nowhere);
}

if (report('every-route-decides') > 0) process.exitCode = 1;
done();
