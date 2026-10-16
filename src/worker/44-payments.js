/* =====================================================================
   PAYMENTS - real Stripe + PayPal with webhook-driven entitlement sync.

   The flow that actually grants access:
     1. Frontend calls /v1/stripe/checkout -> we create a Stripe Checkout
        Session (subscription) and return its URL. User pays on Stripe.
     2. Stripe calls /v1/stripe/webhook (signed) on success/renewal/cancel.
        We VERIFY the signature, then write ent:<email> = { plan, ... }.
     3. requireUser() reads ent:<email>, so the new plan takes effect on the
        very next API call. No client-trust: the plan is set ONLY by a
        verified webhook from the payment processor, never by the browser.

   This is the critical link the app was missing - without the webhook,
   a paid user would never actually get upgraded.
   ===================================================================== */

// Map your plans to Stripe Price IDs (create these in the Stripe dashboard).
/* MONTHLY OR YEARLY, AND STRIPE DECIDES THE AMOUNT EITHER WAY.

   A yearly plan is not a discount this file applies - it is a second recurring
   price in Stripe, and the only thing here that changes is WHICH price id the
   checkout session is opened with. That matters: if AMV computed a yearly
   figure of its own, the page and the charge would be two numbers maintained
   in two places, which is the drift this repository keeps finding. The amount
   somebody is charged is the amount on the price the operator created.

   Yearly is optional. A deployment that has not created those prices sells
   monthly exactly as before, and asking for yearly there is answered by
   _planUnsellable naming the secret to set rather than by a failed checkout. */
function _stripePriceId(env, plan, cycle) {
  const map = String(cycle || '') === 'year' ? {
    pro:   env.STRIPE_PRICE_PRO_YEAR,
    elite: env.STRIPE_PRICE_ELITE_YEAR,
    ultra: env.STRIPE_PRICE_ULTRA_YEAR,
    team:  env.STRIPE_PRICE_TEAM_SEAT_YEAR,
  } : {
    pro:   env.STRIPE_PRICE_PRO,
    elite: env.STRIPE_PRICE_ELITE,
    ultra: env.STRIPE_PRICE_ULTRA,
    /* A per-UNIT recurring price in Stripe. The seat count is the subscription
       quantity, which means Stripe handles proration on every change and the
       number of seats AMV honours is by definition the number being billed. */
    team:  env.STRIPE_PRICE_TEAM_SEAT,
  };
  return map[plan] || null;
}

/* WHY A PLAN CANNOT BE BOUGHT, ANSWERED THE SAME WAY BY BOTH CHECKOUTS.

   There are two live routes to buy the same thing: /v1/stripe/checkout hands
   back a hosted Checkout URL, and /v1/subscribe takes a payment method inside
   the app. Both ask "is there a price for this plan", both can be told no, and
   they were answering it DIFFERENTLY - one said the price had not been set up
   and that nothing was charged, the other said `unknown plan`.

   `unknown plan` for pro, elite or ultra is the wrong answer to the customer's
   face. They did not invent the plan, they clicked it on AMV's own pricing
   page; what is missing is a secret on this deployment. The comment that used
   to sit over that line said exactly this - that calling it an unknown plan
   "would send them looking for a mistake they did not make" - and then the
   code did it for the three plans that carry the revenue, handling only `team`
   properly.

   It is one function now, so the two routes cannot drift apart again, and it
   keeps the distinction that matters: a plan AMV does not sell is a bad
   request, and a plan AMV sells but this deployment has not priced is a
   configuration gap that names the secret to set. */
const SELLABLE_PLANS = new Set(['pro', 'elite', 'ultra', 'team']);
const PLAN_PRICE_ENV = { pro: 'STRIPE_PRICE_PRO', elite: 'STRIPE_PRICE_ELITE',
                         ultra: 'STRIPE_PRICE_ULTRA', team: 'STRIPE_PRICE_TEAM_SEAT' };
function _planUnsellable(plan, cycle) {
  const p = String(plan || '').toLowerCase();
  /* Yearly is optional and monthly is not, so a missing yearly price is its own
     answer: this deployment sells the plan, just not by the year. Saying
     "unknown plan" there would send somebody looking for a mistake they did not
     make - the same reasoning as the paragraph below, one field over. */
  if (String(cycle || '') === 'year' && SELLABLE_PLANS.has(p)) {
    const envName = p === 'team' ? 'STRIPE_PRICE_TEAM_SEAT_YEAR' : 'STRIPE_PRICE_' + p.toUpperCase() + '_YEAR';
    return json({ error: 'Yearly billing is not switched on for this plan yet, so only monthly can be bought. Nothing has been charged.',
                  code: 'not_configured', secret: envName, cycle: 'year' }, 503);
  }
  if (!SELLABLE_PLANS.has(p)) return json({ error: 'unknown plan', code: 'unknown_plan' }, 400);
  if (p === 'team')
    return json({ error: 'Teams checkout is not switched on yet. Set STRIPE_PRICE_TEAM_SEAT to a per-seat recurring price and it starts working with no other change.',
                  code: 'not_configured' }, 503);
  /* 503, not 400. The request was fine; the deployment is not finished. A 400
     tells the browser the customer sent something wrong, which is the same
     untruth in a status code. */
  return json({ error: 'That plan cannot be bought on this deployment yet - its price has not been set up. Nothing has been charged.',
                code: 'not_configured', missing: PLAN_PRICE_ENV[p] }, 503);
}
/* Price id -> plan, skipping the ones that are not configured.

   The object-literal version of this had a hole that was invisible until a
   fourth plan was added: an unset env var becomes the KEY "undefined", so every
   unconfigured price collapsed onto the same entry and whichever plan was
   written last won it. A webhook quoting a price id AMV does not know - or an
   event with no price on it at all, which is most invoice events - then resolved
   to a real plan and granted it. Nothing here may match unless it was actually
   set, and an unknown price must resolve to nothing. */
const PLAN_FROM_PRICE = (env) => {
  const out = {};
  const add = (id, plan) => { const k = String(id || '').trim(); if (k) out[k] = plan; };
  add(env.STRIPE_PRICE_PRO, 'pro');
  add(env.STRIPE_PRICE_ELITE, 'elite');
  add(env.STRIPE_PRICE_ULTRA, 'ultra');
  add(env.STRIPE_PRICE_TEAM_SEAT, 'team');
  /* THE YEARLY PRICES GRANT THE SAME PLAN, and forgetting this half is how a
     yearly subscriber pays and gets nothing: the webhook is the only thing
     that turns money into access, and it recognises a subscription by its
     PRICE ID. A price it does not know is a plan it cannot grant. */
  add(env.STRIPE_PRICE_PRO_YEAR, 'pro');
  add(env.STRIPE_PRICE_ELITE_YEAR, 'elite');
  add(env.STRIPE_PRICE_ULTRA_YEAR, 'ultra');
  add(env.STRIPE_PRICE_TEAM_SEAT_YEAR, 'team');
  return out;
};

// Write a user's entitlement. This is the ONLY way a plan gets set on the
// server, and it's only ever called from a verified webhook.
