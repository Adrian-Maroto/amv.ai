/* A PLAN OUTLIVING THE MONEY THAT PAID FOR IT.

   Every path that REVOKES a plan is a webhook: invoice.payment_failed,
   customer.subscription.updated, BILLING.SUBSCRIPTION.CANCELLED. That is fine
   right up until a webhook stops arriving, and the two directions fail very
   differently. A grant that never arrives is loud - the customer pays and
   complains within the hour. A revocation that never arrives is silent: the
   subscription ends, nothing tells AMV, and the account keeps Ultra for ever.

   If STRIPE_WEBHOOK_SECRET is unset, or the endpoint is deleted, or Stripe
   disables it after enough failures, that is the state of EVERY paid account
   at once, and nothing anywhere in the product would have said so.

   The sweep re-confirms rather than trusting one delivery. The interesting
   half is what it does about a stale account, because "no renewal seen" has
   two causes that call for opposite actions:

     their subscription really ended  -> revoking is correct
     OUR webhook is broken            -> revoking cancels a paying customer
                                         over our own bug

   Cards fail one at a time. Plumbing fails for everybody at once. That is the
   whole discriminator, and these cases hold it to it - including the one that
   matters most, where a large share go stale together and the sweep must touch
   NOBODY. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'renewal-sweep.harness.mjs');
writeFileSync(harness, src +
  '\nexport { DB, runRenewalSweep, setEntitlement, _planOf, _billingState, _markPastDue, RENEWAL_MAX_AGE_MS };\n');
const W = await import(harness + '?t=' + Date.now());

const DAY = 86400000;
let alerts = [];
function mkEnv(extra) {
  const m = new Map();
  alerts = [];
  return Object.assign({
    ALERT_WEBHOOK: 'https://hooks.example/alert',
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix }) {
        return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true };
      },
    },
  }, extra || {});
}
/* Every alert the sweep sends is captured rather than posted. */
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  alerts.push(String((opts && opts.body) || ''));
  return { ok: true, status: 200, json: async () => ({}) };
};

/* Write an entitlement straight to storage so a case can state exactly how
   long ago the last money signal was, which is the input under test. */
async function seed(env, email, plan, agoDays, extra) {
  await W.DB.put(env, 'ent', email, Object.assign(
    { plan, updatedAt: Date.now() - agoDays * DAY, renewedAt: Date.now() - agoDays * DAY }, extra || {}));
}
const entOf = (env, email) => W.DB.get(env, 'ent', email);

section('A subscription nobody has confirmed in over a month is caught');
{
  const env = mkEnv();
  await seed(env, 'lapsed@x.com', 'pro', 50);
  await seed(env, 'current@x.com', 'pro', 3);
  const r = await W.runRenewalSweep(env);
  ok(r.ran === true, 'the sweep ran', r);
  ok(r.marked === 1, 'exactly one account was marked', r);

  const stale = await entOf(env, 'lapsed@x.com');
  ok(!!stale.pastDueSince, 'the stale one is past due', !!stale.pastDueSince);
  ok(stale.plan === 'pro',
     'the plan that was SOLD is kept, so a real payment restores it exactly', stale.plan);

  const fresh = await entOf(env, 'current@x.com');
  ok(!fresh.pastDueSince, 'and a current subscription is left alone', !!fresh.pastDueSince);
}

section('It never drops somebody straight to Free');
{
  /* Past due is a seven-day window with full access, not a switch. Cutting a
     customer off the moment a renewal is late - when the most likely cause is
     our own plumbing - is the failure this whole file exists to prevent. */
  const env = mkEnv();
  await seed(env, 'a@x.com', 'ultra', 50);
  await W.runRenewalSweep(env);
  const e = await entOf(env, 'a@x.com');
  ok(W._planOf(e) === 'ultra', 'they still have everything they paid for today', W._planOf(e));
  /* And it does end, on the clock, without anything else having to run. */
  const later = Object.assign({}, e, { pastDueSince: Date.now() - 9 * DAY });
  ok(W._planOf(later) === 'free', 'and it lapses by itself once the grace runs out', W._planOf(later));
}

section('And it does not tell a paying customer their card failed');
{
  /* We know one thing: we did not see a renewal. We do NOT know their payment
     failed, and saying so sends somebody whose payments are fine to cancel a
     card that works. */
  const env = mkEnv();
  await seed(env, 'b@x.com', 'pro', 50);
  await W.runRenewalSweep(env);
  const e = await entOf(env, 'b@x.com');
  const st = W._billingState(e);
  ok(!/did not go through/.test(st.message),
     'the message does not claim a payment failed', st.message);
  ok(/could not|not been able to confirm/i.test(st.message),
     'it says we could not confirm the renewal, which is what we know', st.message);
  ok(/contact support/i.test(st.message),
     'and points at a human, because we might be the ones who are wrong', st.message);

  /* A real declined card still reads as one - the honest message for that case
     was not softened into vagueness for everybody. */
  const env2 = mkEnv();
  await seed(env2, 'c@x.com', 'pro', 1);
  await W._markPastDue(env2, 'c@x.com', { invoice: 'in_1' });
  const declined = W._billingState(await entOf(env2, 'c@x.com'));
  ok(/did not go through/.test(declined.message),
     'a genuinely declined card is still told plainly', declined.message);
}

section('When EVERYBODY goes stale at once, nobody is touched');
{
  /* The case that matters. Cards fail one at a time; a webhook fails for the
     whole deployment at the same instant. Acting on that would cancel every
     paying customer AMV has, over a missing environment variable. */
  const env = mkEnv();
  for (let i = 0; i < 8; i++) await seed(env, `u${i}@x.com`, 'pro', 60);
  const r = await W.runRenewalSweep(env);
  ok(r.systemic === true, 'the sweep recognises it as systemic', r);
  ok(r.marked === 0, 'and marks NOBODY past due', r.marked);
  for (let i = 0; i < 8; i++) {
    const e = await entOf(env, `u${i}@x.com`);
    if (e.pastDueSince) { ok(false, `u${i} was wrongly marked`, e); break; }
  }
  ok(true, 'every account still has the plan it is paying for', 8);
}

section('But it shouts, because that state is silently un-revoking cancellations too');
{
  const env = mkEnv();
  for (let i = 0; i < 8; i++) await seed(env, `v${i}@x.com`, 'elite', 60);
  await W.runRenewalSweep(env);
  const said = alerts.join(' ');
  ok(/STRIPE_WEBHOOK_SECRET/.test(said),
     'the page names the variable to check', /STRIPE_WEBHOOK_SECRET/.test(said));
  ok(/NO account has been touched/.test(said),
     'and says plainly that nothing was done to anybody', /NO account has been touched/.test(said));
  ok(/not being revoked/.test(said),
     'and that revocations are not arriving either, which is the money side', /not being revoked/.test(said));
}

section('An isolated lapse pages too, with who');
{
  const env = mkEnv();
  await seed(env, 'one@x.com', 'pro', 55);
  for (let i = 0; i < 10; i++) await seed(env, `ok${i}@x.com`, 'pro', 2);
  const r = await W.runRenewalSweep(env);
  ok(r.marked === 1, 'one in eleven is not a pattern, so it is acted on', r);
  ok(alerts.join(' ').includes('one@x.com'), 'and the operator is told who', alerts.length);
}

section('Comped and free accounts are not swept');
{
  const env = mkEnv();
  /* Granted by a person, not a subscription. There is no renewal coming and
     there never will be, so waiting for one and revoking is nonsense. */
  await seed(env, 'comped@x.com', 'ultra', 900, { source: 'admin' });
  await seed(env, 'free@x.com', 'free', 900);
  const r = await W.runRenewalSweep(env);
  ok(r.marked === undefined || r.marked === 0, 'neither is marked', r);
  const c = await entOf(env, 'comped@x.com');
  ok(!c.pastDueSince, 'an owner-granted plan is left alone for ever', !!c.pastDueSince);
  ok(W._planOf(c) === 'ultra', 'and keeps working', W._planOf(c));
}

section('An account already past due is not re-dated');
{
  /* The grace window runs from the FIRST failure. Re-stamping it every day
     would make the window never end, so the plan would never actually lapse. */
  const env = mkEnv();
  const since = Date.now() - 5 * DAY;
  await seed(env, 'd@x.com', 'pro', 50, { pastDueSince: since });
  await W.runRenewalSweep(env);
  const e = await entOf(env, 'd@x.com');
  ok(e.pastDueSince === since, 'the original failure date survives', e.pastDueSince);
}

section('It runs once a day, however often the cron ticks');
{
  /* The cron fires every five minutes. Without the claim this would re-page
     288 times a day and re-read every entitlement each time. */
  const env = mkEnv();
  await seed(env, 'e@x.com', 'pro', 50);
  const first = await W.runRenewalSweep(env);
  const second = await W.runRenewalSweep(env);
  ok(first.ran === true, 'the first tick sweeps', first.ran);
  ok(second.ran === false, 'the second does not', second);
}

section('A renewal that DOES arrive resets the clock');
{
  /* The signal has to be written by the thing that knows money moved, or the
     sweep is measuring nothing. */
  const env = mkEnv();
  await W.setEntitlement(env, 'f@x.com', 'pro', { source: 'stripe' });
  const e = await entOf(env, 'f@x.com');
  ok(typeof e.renewedAt === 'number' && Date.now() - e.renewedAt < 5000,
     'a processor grant stamps renewedAt', e.renewedAt);

  /* And a write that is NOT a payment must not. An admin edit or a team seat
     change moving the clock would hide a lapse for another 40 days. */
  const env2 = mkEnv();
  await W.setEntitlement(env2, 'g@x.com', 'pro', { source: 'admin' });
  const g = await entOf(env2, 'g@x.com');
  ok(g.renewedAt === undefined, 'an admin grant does not', g.renewedAt);
}

section('renewedAt survives a rewrite of the record');
{
  /* If a later write dropped it, a live subscription would look like one
     nobody had paid for in months and the sweep would act on that. */
  const env = mkEnv();
  await W.setEntitlement(env, 'h@x.com', 'pro', { source: 'stripe' });
  const at = (await entOf(env, 'h@x.com')).renewedAt;
  await W.setEntitlement(env, 'h@x.com', 'pro', { source: 'admin', note: 'support edit' });
  const after = (await entOf(env, 'h@x.com')).renewedAt;
  ok(after === at, 'it is carried, not lost', { at, after });
}

section('The webhook is required once payments are on');
{
  /* The sweep is a backstop, not a substitute - it acts on a 40-day clock,
     where a webhook acts in seconds. A deployment taking money with no webhook
     grants nothing on payment and revokes nothing on cancellation. */
  const item = src.slice(src.indexOf("id: 'paymentsHook'"), src.indexOf("id: 'paymentsHook'") + 1200);
  ok(/blocking:\s*_has\(env,\s*'STRIPE_SECRET_KEY'\)/.test(item),
     'it blocks readiness exactly when payments are switched on', true);
  ok(/REQUIRED NOW/.test(item), 'and says so in the state where it matters', true);
  /* Not blocking for a deployment that is not selling yet, or every fresh
     install fails readiness for a thing it does not need. */
  ok(!/blocking:\s*true/.test(item), 'but not unconditionally', true);
}

globalThis.fetch = realFetch;
if (report('renewal-sweep') > 0) process.exitCode = 1;
done();
