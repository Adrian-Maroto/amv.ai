/* KEY READINESS — the promise is "the moment I paste a key, it works".
   That fails silently in two ways: a feature whose endpoint does not exist
   (404 forever), or one that crashes instead of explaining what is missing.
   This suite checks every keyed surface: it degrades honestly WITHOUT the key,
   and there is a real route waiting behind it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'keys.harness.mjs');
writeFileSync(harness, src + '\nexport { financeRoute, linkInvite, browserRun };\n');
const W = await import(harness + '?t=' + Date.now());

const KV = () => ({ get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) });
const req = (body) => new Request('https://x/v1/test', { method: 'POST', body: JSON.stringify(body || {}) });

section('Every client call has a real route waiting for it');
// A path the client calls but the worker never routes = a permanent 404 once
// keys are added. These are the routes added for finance and account linking.
['/v1/finance/accounts', '/v1/finance/transactions', '/v1/link/invite', '/v1/browser/run'].forEach(p => {
  ok(src.includes("case '" + p + "'"), `${p} is routed in the worker`, p);
});
// and the client actually calls them
const client = readFileSync(join(ROOT, 'app.js'), 'utf8');
ok(/v1\/finance\//.test(client), 'the client calls the finance route');
ok(/v1\/link\/invite/.test(client), 'the client calls the link-invite route');
ok(/v1\/browser\/run/.test(client), 'the client calls the browser route');

// REGRESSION (found in review): three client paths had no worker route at all
// and would have 404'd forever once keys were added.
section('Payment and record routes exist');
['/v1/subscribe', '/v1/consent', '/v1/fraud/record'].forEach(p => {
  ok(src.includes("case '" + p + "'"), `${p} is routed`, p);
});

// REGRESSION: the client used to POST raw card numbers and CVCs to a
// nonexistent /v1/pay/card. Receiving a PAN puts the business in PCI-DSS
// scope and storing a CVC is prohibited outright.
section('AMV never handles raw card data');
ok(!/\/v1\/pay\/card/.test(client), 'the raw-card endpoint is gone from the client');
ok(!/cc-csc|pf-cvc/.test(client), 'no CVC field is collected anywhere');
ok(!/card:\s*\{\s*number/.test(client), 'no raw card number is ever sent');
ok(/stripeCheckout/.test(client), 'card payment goes through the processor’s hosted checkout instead');

// REGRESSION: the subscribe call ignored the response and granted the plan
// anyway - handing out paid plans free whenever the charge did not complete.
section('A plan is granted only when the server confirms payment');
// Bound the slice to the function itself rather than a byte count, so adding a
// line inside it cannot silently move the code being asserted out of view.
const _subStart = src.indexOf('async function stripeSubscribe');
const subBody = src.slice(_subStart, src.indexOf('\n}', _subStart));
ok(/setEntitlement\(env, user\.email, plan\)/.test(subBody), 'the SERVER grants entitlement, not the client');
ok(/status !== 'active' && status !== 'trialing'/.test(subBody), 'and only on a confirmed active subscription');
ok(/requires_action/.test(subBody), '3-D Secure is handled as "not yet paid", never as success');
ok(/if\(!r\.ok \|\| !d\.ok\)/.test(client), 'the client refuses to grant the plan unless the server said ok');

section('Without keys, features explain themselves instead of crashing');
const noKeys = await W.financeRoute(req({}), { AMV_KV: KV() }, 'accounts');
ok(noKeys.status === 401 || noKeys.status === 503, 'finance returns a clean status, never a crash', noKeys.status);
const noKeysBody = await noKeys.json();
ok(!!(noKeysBody.error || noKeysBody.code), 'and says what is missing', noKeysBody);
ok(!/balance|amount|\$\d/.test(JSON.stringify(noKeysBody)), 'and NEVER invents a balance', noKeysBody);

section('Each keyed capability is feature-detected, not assumed');
const gates = [
  ['env.BROWSER', /if\(!env\.BROWSER\)/, 'web automation'],
  ['FINANCE_CLIENT_ID', /if\(!env\.FINANCE_CLIENT_ID \|\| !env\.FINANCE_SECRET\)/, 'bank data'],
  ['EMAIL_API_KEY', /if\(!env\.EMAIL_API_KEY\)/, 'link invitations'],
  ['SENTRY_DSN', /if\s*\(\s*!env\s*\|\|\s*!env\.SENTRY_DSN\s*\)/, 'error monitoring'],
  ['POSTHOG_KEY', /if\s*\(\s*env\s*&&\s*env\.POSTHOG_KEY\s*\)/, 'product analytics'],
  ['ANTHROPIC_API_KEY', /if\(!env\.ANTHROPIC_API_KEY\)/, 'the web agent model call']
];
gates.forEach(([key, re, what]) => {
  ok(re.test(src), `${what} checks for ${key} before using it`, key);
});

section('Missing keys produce an actionable code the UI can explain');
['needs_service', 'needs_auth', 'needs_key'].forEach(code => {
  ok(src.includes("code:'" + code + "'"), `the worker emits ${code} so the client can tell the user what to add`, code);
});

section('Money paths are guarded server-side, not just in the browser');
ok(/WEB_ABSOLUTE_SPEND_CAP/.test(src), 'an absolute spend ceiling exists that no client setting can raise');
ok(/code:'over_limit'/.test(src), 'and an over-limit purchase is refused before a browser is launched');
ok(!/\/transfer|\/payments\/create|payment_initiation/.test(src),
  'there is NO money-movement route - bank access stays read-only');

section('Sensitive routes require auth and are rate limited');
[['financeRoute', 'finance:'], ['linkInvite', 'linkinv:'], ['browserRun', 'webagent:']].forEach(([fn, key]) => {
  const body = src.slice(src.indexOf('async function ' + fn), src.indexOf('async function ' + fn) + 1400);
  ok(/requireUser\(request, env\)/.test(body), `${fn} requires a signed-in user`, fn);
  ok(body.includes("guardAction(env, '" + key), `${fn} is rate limited`, key);
});

section('The link code goes to the account being accessed, never the requester');
const linkBody = src.slice(src.indexOf('async function linkInvite'), src.indexOf('async function linkInvite') + 2600);
ok(/to:\[owner\]/.test(linkBody), 'the confirmation email is addressed to the OWNER');
ok(!/to:\[user\.email\]/.test(linkBody), 'never to the person requesting access');
ok(/crypto\.getRandomValues/.test(linkBody), 'the code uses a real CSPRNG, not Math.random');
ok(/expiresAt/.test(linkBody), 'and it expires');

report();
done();
