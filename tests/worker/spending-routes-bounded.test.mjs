/* A ROUTE THAT SPENDS MONEY NEEDS A CEILING ON HOW OFTEN.

   Some handlers cost something every time they run: they call the model, a bank
   aggregator, Stripe, Google, Twilio. Several had no bound at all.

   The damage is not to the person doing it. One signed-in account hammering
   checkout burns the platform's Stripe API rate limit, and the customers who
   cannot check out are everybody else. Hammering the Google refresh gets the
   OAuth client throttled for every connected user. The bill and the outage both
   land on the operator.

   The model paths were already metered - that is what the plan allowances are -
   so this is about the third-party calls beside them.

   Like the other lists here it is exhaustive: a route that spends is bounded,
   or it is named below with the reason it does not need to be. There is no
   third state where nobody thought about it. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { functionBody } from '../lib/source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');

/* One definition, in tests/lib/source.mjs. Three files carried an identical
   copy of this, each with its own 30000-character escape hatch - and a copy is
   a second definition that drifts silently. */
const bodyOf = (fn) => functionBody(src, fn);

/* Calls that cost money or consume somebody else's rate limit. */
const SPENDS = /_modelFetch\(|_finCall\(|api\.resend\.com|api\.stripe\.com|oauth2\.googleapis|api\.twilio|_vidCall\(/;
/* Anything that bounds how often, whether by rate limit or by allowance. */
/* What counts as a bound.

   `counter(env` was on this list and matched ANY counter call - including the
   plain population tally in account deletion, which counts how many accounts
   exist and limits nothing. That made a route look bounded because it happened
   to count something, which is the opposite of what this file is for, and it
   fired as a false positive against an exemption that was still perfectly
   honest.

   A counter is a bound when it is used as one: rateCheck refuses, reserve
   holds budget. Counting is not limiting. */
const BOUNDED = /guardAction\(|limitAction\(|checkCap|_spendAllowed\(|_budgetFor\(|effectiveLimits\(|op:\s*'rateCheck'|op:\s*'reserve'/;

/* Spends, but does not need its own bound - each with the reason. */
const EXEMPT = {
  authGoogle:          'sign-in itself, and the token check is what proves who is calling',
  authDeleteAccount:   'one call per account deletion, behind an explicit confirmation',
  adminFinance:        'admin only',
};

const routes = [...src.matchAll(/case\s+'([^']+)'\s*:\s*return\s+([A-Za-z_$][\w$]*)\(/g)]
  .map(m => ({ path: m[1], fn: m[2] }))
  .filter(r => bodyOf(r.fn));

const spenders = routes.filter(r => SPENDS.test(bodyOf(r.fn)));

section('The routes that cost something were found');
{
  ok(spenders.length > 5, 'handlers calling a paid or rate-limited service', spenders.length);
}

section('Each one is bounded, or exempt for a stated reason');
{
  const loose = spenders
    .filter(r => !BOUNDED.test(bodyOf(r.fn)) && !(r.fn in EXEMPT))
    .map(r => r.path + ' -> ' + r.fn);
  ok(loose.length === 0,
     'nothing calls a third party as often as somebody likes', loose);
}

section('The exemptions have not gone stale');
{
  const live = new Set(spenders.map(r => r.fn));
  const gone = Object.keys(EXEMPT).filter(fn => !live.has(fn));
  ok(gone.length === 0, 'every exemption still describes a route that spends', gone);
  const nowBounded = Object.keys(EXEMPT).filter(fn => BOUNDED.test(bodyOf(fn)));
  ok(nowBounded.length === 0, 'and nothing exempt has quietly gained a bound', nowBounded);
}

section('The ones that create sessions at a third party are bounded by name');
{
  /* Named individually: these four are where an unbounded loop hurts other
     customers rather than the caller, so a general rule passing is not enough. */
  [['stripeCheckout', 'stripeco:'], ['stripePortal', 'stripepo:'],
   ['marketBuy', 'mktbuy:'], ['googleOAuthRefresh', 'goauthref:']].forEach(([fn, key]) => {
    ok(new RegExp('guardAction\\(env, `' + key).test(bodyOf(fn)),
       fn + ' is rate limited per account', fn);
  });
}

if (report('spending-routes-bounded') > 0) process.exitCode = 1;
done();
