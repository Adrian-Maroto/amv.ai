/* TEAMS BY THE SEAT.

   Elite gives ten people one plan's compute for seventy-five dollars. That is a
   fine upgrade and a bad product: the customer's cost per person falls as the
   team grows, and so does what each of them actually gets. Nobody is happy at
   twenty people.

   The per-seat plan inverts both. Every seat adds its own Pro-sized allowance to
   the shared pool, so a bigger team genuinely gets more capacity, and revenue
   grows with it. The whole thing only holds if three numbers move together and
   none of them can be set by the customer:

     - the seat count comes from what Stripe is BILLING, not from a request body
     - the pool scales with that count
     - so does the dollar ceiling, which is what keeps the margin fixed

   If the pool scaled and the ceiling did not, a big team would be a loss. If the
   count came from the client, every team would be free. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'seatbill.harness.mjs');
writeFileSync(harness, src + `
export { _teamSeatCount, _teamSeatLimit, _teamPlanPrice, _planPriceUSD, _planRankOf,
         _baseLimits, effectiveLimits, _autoBudget, _stripePriceId, PLAN_FROM_PRICE,
         stripeCheckout, setEntitlement, issueTokens, DB, PLAN_LIMITS,
         TEAM_SEAT_PRICE_USD, TEAM_SEAT_MIN, TEAM_SEAT_MAX };
`);
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const mkEnv = (extra = {}) => ({
  JWT_SECRET: 'x'.repeat(40),
  APP_URL: 'https://amv.test',
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }; },
  },
  ...extra,
});
const tok = async (env, email) => (await W.issueTokens(env, email, 'U')).token;
const post = (body, token) => new Request('https://api.amv.dev/v1/stripe/checkout',
  { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
const jget = async (r) => { try { return await r.json(); } catch { return {}; } };

section('The seat count is bounded before it is believed');
{
  const { TEAM_SEAT_MIN: MIN, TEAM_SEAT_MAX: MAX } = W;
  ok(W._teamSeatCount({ seats: 12 }) === 12, 'a real number is taken as given', W._teamSeatCount({ seats: 12 }));
  ok(W._teamSeatCount({ seats: 1 }) === MIN, 'below the minimum comes back as the minimum', W._teamSeatCount({ seats: 1 }));
  ok(W._teamSeatCount({ seats: 999999 }) === MAX, 'and a huge number is capped', W._teamSeatCount({ seats: 999999 }));
  ok(W._teamSeatCount({ seats: -5 }) === MIN, 'a negative seat count cannot exist', W._teamSeatCount({ seats: -5 }));
  ok(W._teamSeatCount({ seats: 'lots' }) === MIN, 'and neither can a word', W._teamSeatCount({ seats: 'lots' }));
  ok(W._teamSeatCount(null) === MIN, 'a missing config is the minimum, not zero', W._teamSeatCount(null));
  ok(W._teamSeatCount({ seats: 7.9 }) === 7, 'fractional seats are floored - half a person is not a seat',
     W._teamSeatCount({ seats: 7.9 }));
}

section('Price, pool and ceiling all move with the seat count');
{
  const P = W.TEAM_SEAT_PRICE_USD;
  ok(W._planPriceUSD('team', { seats: 10 }) === 10 * P,
     'ten seats bills ten seats', W._planPriceUSD('team', { seats: 10 }));
  ok(W._planPriceUSD('team', { seats: 25 }) === 25 * P, 'and twenty-five bills twenty-five');

  const small = W._baseLimits({ plan: 'team', customCfg: { seats: 3 } });
  const big   = W._baseLimits({ plan: 'team', customCfg: { seats: 30 } });
  ok(big.monthTokens === small.monthTokens * 10,
     'ten times the seats is ten times the pool - adding somebody does not dilute it',
     [small.monthTokens, big.monthTokens]);
  ok(small.monthTokens === W.PLAN_LIMITS.pro.monthTokens * 3,
     'and a seat is worth a full Pro allowance, not a fraction of one', small.monthTokens);
  ok(big.rpm === small.rpm,
     'requests per minute does NOT scale - it is a burst control on one person, not a pool', big.rpm);
  ok(big.allModels === true, 'every seat gets Apex, which is what the price buys');

  /* The margin guarantee. If the pool grew and the ceiling did not, the biggest
     customers would be the loss-making ones. */
  const b3  = W._autoBudget({ plan: 'team', custom: { seats: 3 } });
  const b30 = W._autoBudget({ plan: 'team', custom: { seats: 30 } });
  ok(Math.round(b30.ceiling / b3.ceiling) === 10,
     'the dollar ceiling scales with the seats exactly as the pool does', [b3.ceiling, b30.ceiling]);
  ok(b3.ceiling === 3 * P * 0.45, 'and stays the same fraction of what was paid', b3.ceiling);
  ok(b3.free === false, 'a team is never treated as a free account');
}

section('A Teams seat carries Elite-grade capability');
{
  ok(W._planRankOf('team') === W._planRankOf('elite'),
     'so Apex is included rather than sold again', [W._planRankOf('team'), W._planRankOf('elite')]);
  const lim = W.effectiveLimits({ plan: 'team', customCfg: { seats: 5 } });
  ok(lim.allModels === true, 'and no engine is gated behind a further upgrade');
  ok(lim.videosMonth > 0, 'video is included, scaled by seats', lim.videosMonth);
}

section('The customer cannot name their own seat count');
{
  store.clear();
  const env = mkEnv({ STRIPE_SECRET_KEY: 'sk_test', STRIPE_PRICE_TEAM_SEAT: 'price_seat', STRIPE_PRICE_PRO: 'price_pro' });
  const t = await tok(env, 'buyer@x.com');

  let sent = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent = new URLSearchParams(init.body);
    return { ok: true, status: 200, json: async () => ({ url: 'https://checkout.test/s', id: 'cs_1' }) };
  };

  let r = await W.stripeCheckout(post({ plan: 'team', seats: 9 }, t), env);
  ok(r.status === 200, 'checkout opens for the per-seat plan', r.status);
  ok(sent.get('line_items[0][quantity]') === '9', 'the quantity Stripe bills is the seats asked for', sent.get('line_items[0][quantity]'));
  ok(sent.get('mode') === 'subscription', 'as a recurring subscription, not a one-off');
  ok(sent.get('metadata[seats]') === '9', 'and the count is recorded on the session');

  /* The attack: ask for one seat, or none, and get a team. The server decides. */
  await W.stripeCheckout(post({ plan: 'team', seats: 1 }, t), env);
  ok(sent.get('line_items[0][quantity]') === String(W.TEAM_SEAT_MIN),
     'asking for fewer than the minimum bills the minimum', sent.get('line_items[0][quantity]'));
  await W.stripeCheckout(post({ plan: 'team', seats: 100000 }, t), env);
  ok(sent.get('line_items[0][quantity]') === String(W.TEAM_SEAT_MAX),
     'and asking for a hundred thousand bills the cap', sent.get('line_items[0][quantity]'));
  await W.stripeCheckout(post({ plan: 'team' }, t), env);
  ok(sent.get('line_items[0][quantity]') === String(W.TEAM_SEAT_MIN),
     'omitting it entirely is the minimum, never zero', sent.get('line_items[0][quantity]'));

  await W.stripeCheckout(post({ plan: 'pro', seats: 50 }, t), env);
  ok(sent.get('line_items[0][quantity]') === '1',
     'and seats are ignored on a plan that is not sold by the seat', sent.get('line_items[0][quantity]'));

  globalThis.fetch = realFetch;
}

section('With no seat price configured it says so instead of failing at the till');
{
  store.clear();
  const env = mkEnv({ STRIPE_SECRET_KEY: 'sk_test' });   // no STRIPE_PRICE_TEAM_SEAT
  const t = await tok(env, 'buyer@x.com');
  const r = await W.stripeCheckout(post({ plan: 'team', seats: 5 }, t), env);
  const d = await jget(r);
  ok(r.status === 503, 'the per-seat plan is unavailable rather than broken', r.status);
  ok(d.code === 'not_configured', 'with a reason the app can act on', d.code);
  ok(/STRIPE_PRICE_TEAM_SEAT/.test(d.error), 'that names exactly what to set', d.error);

  const bogus = await W.stripeCheckout(post({ plan: 'nonsense' }, t), env);
  ok(bogus.status === 400, 'while a plan that does not exist is still a bad request', bogus.status);
  ok((await jget(bogus)).code !== 'not_configured',
     'and is not confused with one that simply is not switched on');
}

section('Stripe is the authority on how many seats are paid for');
{
  const env = mkEnv({ STRIPE_PRICE_TEAM_SEAT: 'price_seat' });
  ok(W.PLAN_FROM_PRICE(env)['price_seat'] === 'team',
     'the seat price maps back to the per-seat plan on the way in');
  ok(W._stripePriceId(env, 'team') === 'price_seat', 'and out again');

  /* The webhook reads the quantity off the subscription item rather than
     trusting anything that travelled with the request. */
  ok(/const qty = obj\.items\?\.data\?\.\[0\]\?\.quantity/.test(src),
     'the seat count is read from the subscription Stripe is billing');
  ok(/extra\.custom = \{ seats: _teamSeatCount\(\{ seats: qty \}\) \}/.test(src),
     'and clamped again on the way in, because a webhook is still input');

  await W.setEntitlement(env, 'owner@x.com', 'team', { custom: { seats: 14 } });
  const ent = await W.DB.get(env, 'ent', 'owner@x.com');
  ok(W._teamSeatLimit('team', ent.custom) === 14,
     'and that count is what the team is actually allowed', W._teamSeatLimit('team', ent.custom));
  ok(W._planPriceUSD('team', ent.custom) === 14 * W.TEAM_SEAT_PRICE_USD,
     'and what it is charged for', W._planPriceUSD('team', ent.custom));
}

section('One definition of what a plan costs');
{
  /* There were three copies of the price table - the chat backstop, the SMS
     backstop and the automation budget. Three copies of the number that IS the
     profit guarantee is three chances for one to be quietly out of date. */
  const copies = (src.match(/= ?\{ ?pro: ?15, ?elite: ?75, ?ultra: ?200 ?\}/g) || []).length;   // assignments, not the comment describing them
  ok(copies === 1, 'the plan price table exists exactly once', copies);
  /* THE PROPERTY, NOT THE SPELLING. This matched the literal text of the
     arithmetic while it lived inline in the chat handler. Moving it into one
     shared helper - which is what made the same ceiling bind image, video, SMS
     and the widget - broke the match while the 45% backstop it guards was
     untouched. A rule written against a spelling fails on a correct fix and
     passes on a regression that keeps the words (LESSONS #203). */
  const ceilFn3 = src.slice(src.indexOf('function _monthlyCeiling('), src.indexOf('function _monthlyCeiling(') + 900);
  ok(/_planPriceUSD\(user\.plan, user\.customCfg\)/.test(ceilFn3),
     'the chat cost backstop reads it', true);
  ok(/const price = _planPriceUSD\(user\.plan, user\.customCfg\)/.test(src),
     'the SMS backstop reads the same one');
  ok(/const planPrice = _planPriceUSD\(plan, ent && ent\.custom\)/.test(src),
     'and so does the automation budget');
}

section('An unconfigured price cannot grant a plan');
{
  /* The object-literal map keyed every unset price var on the string
     "undefined", so they all collapsed onto one entry and the last plan written
     won it. An invoice with no price - which is most invoice events - then
     resolved to a real plan and granted it. Adding a fourth plan is what made it
     visible; it was wrong with three. */
  const partial = W.PLAN_FROM_PRICE({ STRIPE_PRICE_PRO: 'price_pro' });
  ok(partial['price_pro'] === 'pro', 'a configured price still maps', partial['price_pro']);
  ok(partial['undefined'] === undefined, 'an unset price is not an entry at all', partial['undefined']);
  ok(partial[undefined] === undefined, 'and neither is a missing lookup');
  ok(Object.keys(partial).length === 1, 'only what was actually set is in the map', Object.keys(partial));

  const none = W.PLAN_FROM_PRICE({});
  ok(Object.keys(none).length === 0, 'nothing configured means nothing matches', Object.keys(none));
  ok(none[''] === undefined, 'including the empty string');

  const blank = W.PLAN_FROM_PRICE({ STRIPE_PRICE_ELITE: '   ' });
  ok(Object.keys(blank).length === 0, 'a price var set to whitespace counts as unset', Object.keys(blank));

  ok(/const plan = priceId \? PLAN_FROM_PRICE\(env\)\[String\(priceId\)\] : undefined/.test(src),
     'and the webhook does not even look one up without a price id');
}

if (report('team-seats-billing') > 0) process.exitCode = 1;
done();
