/* A ROUTE NOBODY CALLS IS A FEATURE NOBODY GETS.

   There is already a check that every path the app asks for is a path the
   Worker serves. This is the mirror, and it is the one that catches the worse
   defect - because the failure is silent on both ends.

   `/v1/market/threads` was written, tested at the Worker, and served. Nothing
   in the client ever called it. The marketplace inbox read localStorage
   instead, and the send was fired at the server best-effort with the result
   discarded. So a buyer asked "is this still available?", watched it appear in
   their own thread, and the seller never received it. Both halves worked. The
   wire between them did not exist, and no test on either side could see that,
   because each was correct on its own.

   Nothing throws in that world. Nothing 500s. The route has passing tests.

   So: every route the Worker serves is either called by the shipped client, or
   is named below with the reason it is not. The point of the exemption list is
   that it is a SENTENCE somebody wrote, not an absence somebody never noticed.

   Dynamically built paths count as called - the finance module composes
   `/v1/finance/` + name, and a check that cannot see that would demand callers
   for routes that already have them. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const client = readFileSync(join(ROOT, 'app.js'), 'utf8');

/* Not called by the app, on purpose, each with the reason. */
const EXEMPT = {
  '/v1/stripe/webhook':  'Stripe calls this, not a browser',
  '/v1/paypal/webhook':  'PayPal calls this, not a browser',
  '/sms/incoming':       'Twilio calls this, not a browser',
  '/auth/admin-reset':   'operator recovery, admin token, run by hand',
  '/v1/admin/support':   'operator inbox, admin token',
  '/v1/admin/user':      'operator account inspector, admin token',
  '/admin/abuse/list':   'operator abuse review, admin token',
  '/admin/abuse/clear':  'operator abuse review, admin token',
  '/admin/backup/export':'operator backup, admin token',
  '/admin/backup/import':'operator restore, admin token',
  '/auth/reset/status':  'diagnostic for the reset flow; the flow itself works without it',
  '/team/members':       'superseded by /team/get, which already returns the roster',
  '/team/data':          'superseded by /team/share and /team/shared',
};

/* Paths the client composes at runtime rather than writing out. */
const DYNAMIC = [/^\/v1\/finance\//];

const routes = [...worker.matchAll(/case\s+'([^']+)'\s*:\s*return\s+([A-Za-z_$][\w$]*)\(/g)]
  .map(m => ({ path: m[1], fn: m[2] }));

/* A path is called if it appears as a literal, OR as the start of one that
   carries a query string - `'/v1/resume?id=' + turnId` is a caller, and a
   matcher that cannot see that reports two working routes as orphans. A check
   that cries wolf is how an exemption list stops being read. */
const calledByClient = (p) =>
  client.includes(`'${p}'`) || client.includes(`"${p}"`) || client.includes('`' + p + '`')
  || client.includes(`'${p}?`) || client.includes(`"${p}?`) || client.includes('`' + p + '?')
  || DYNAMIC.some(re => re.test(p));

section('Both sides were read');
{
  ok(routes.length > 100, 'the Worker serves a lot of routes', routes.length);
  const called = routes.filter(r => calledByClient(r.path));
  ok(called.length > 60, 'and the app really calls most of them', called.length);
}

section('Every route is called by the app, or exempt for a stated reason');
{
  const orphans = routes
    .filter(r => !calledByClient(r.path) && !(r.path in EXEMPT))
    .map(r => r.path + ' -> ' + r.fn);
  ok(orphans.length === 0,
     'nothing is served that no part of the product ever asks for', orphans);
}

section('The exemptions have not gone stale');
{
  /* An exemption for a route that no longer exists is a sentence about nothing,
     and it hides the next orphan behind a list nobody trusts. */
  const live = new Set(routes.map(r => r.path));
  const gone = Object.keys(EXEMPT).filter(p => !live.has(p));
  ok(gone.length === 0, 'every exemption still names a route that exists', gone);

  const nowCalled = Object.keys(EXEMPT).filter(p => calledByClient(p));
  ok(nowCalled.length === 0,
     'and nothing exempt has quietly gained a caller - wire it up and delete the excuse', nowCalled);
}

section('The marketplace inbox is wired to the server, both ways');
{
  /* Named directly, because the general rule above would be satisfied by the
     path appearing anywhere at all. This is the specific defect: messages were
     SENT to the server and never READ back, so only the sender saw them.
     Both directions have to be real. */
  ok(client.includes('/v1/market/message'), 'the app sends a message to the server', true);
  ok(client.includes('/v1/market/threads'),
     'AND reads conversations back from it, which is how the other person sees anything', true);

  /* The send used to be fire-and-forget with the result discarded, so a refused
     or failed delivery looked identical to a delivered one. */
  const at = client.indexOf('/v1/market/message');
  const around = client.slice(at, at + 220);
  ok(!/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(around),
     'and a failed send is not swallowed, so "sent" means sent', around.slice(0, 170));
}

if (report('every-route-has-a-caller') > 0) process.exitCode = 1;
done();
