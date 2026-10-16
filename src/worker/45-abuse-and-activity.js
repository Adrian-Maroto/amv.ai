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
/* ══════════════════════════════════════════════════════════════════════
   ABUSE / REFUND-FRAUD PROTECTION  (auditor #3)

   The "DoorDash method": pay, consume the product, then claw the money back
   (chargeback or refund) while keeping what you took. For AMV the product is
   compute - model calls, deep research, autonomous jobs - which costs real money the
   moment it's delivered. So a refund/chargeback after heavy use is a direct
   loss, and a repeat pattern is fraud.

   This layer:
     • records every refund and dispute against the user (abuse:<email>)
     • revokes the entitlement that was refunded/disputed (no free access)
     • flags accounts with a pattern, so they can't just re-subscribe and
       repeat. A flagged user can still USE a free account, but new paid
       checkouts are refused until a human clears them.
   None of this blocks a legitimate one-off refund; it takes a PATTERN.
   ══════════════════════════════════════════════════════════════════════ */

const ABUSE_DISPUTE_BLOCK = 1;   // a single chargeback is a hard fraud signal → block
const ABUSE_REFUND_BLOCK  = 3;   // this many refunds shows a pattern → block

/* =====================================================================
   AMV-076  ACCOUNT ACTIVITY - what happened on YOUR account

   `audit()` writes security events to the operator's logs, which is the right
   place for them and completely useless to the person whose account it is. The
   Security screen meanwhile showed a hardcoded "This browser - Active now" row
   that was not reading anything: a picture of a session list, not a session
   list. Someone whose password had leaked would have looked straight at it and
   seen nothing wrong.

   So security events are also written per account, and the account can read
   them back. What is recorded is deliberately coarse:
     - WHAT happened, and when
     - the browser family (Chrome/Safari/...), not the full user-agent string
     - the country, when the edge knows it, not a city and never an address
   That is enough to recognise "someone signed in from another country" and not
   enough to become a tracking record of its own. The log is capped at the last
   100 events and expires, so it cannot grow into a liability either.
   ===================================================================== */
const ACTIVITY_MAX_EVENTS = 100;
const ACTIVITY_TTL_S      = 400 * 86400;

/* Browser family only. A full user-agent is a fingerprint; "Chrome on Windows"
   is what actually helps someone recognise their own session. */
function _deviceLabel(request) {
  const ua = String((request && request.headers && request.headers.get('User-Agent')) || '');
  if (!ua) return '';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : '';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return [browser, os].filter(Boolean).join(' on ') || '';
}

/* Record one thing that happened to an account. Never throws: an account event
   is a record OF an action, and must not be able to break the action. */
async function _userEvent(env, request, email, kind, detail) {
  try {
    const em = String(email || '').toLowerCase();
    if (!em || !kind) return;
    const cf = (request && request.cf) || {};
    const ev = { at: Date.now(), kind };
    const dev = _deviceLabel(request); if (dev) ev.dev = dev;
    if (cf.country) ev.country = String(cf.country).slice(0, 2);
    if (detail && typeof detail === 'object') {
      // Only short, non-identifying extras - this record is shown back to the user.
      for (const k of ['plan', 'from', 'to', 'reason', 'count']) {
        if (detail[k] != null) ev[k] = String(detail[k]).slice(0, 40);
      }
    }
    const key = `alog:${em}`;
    let list = [];
    try { list = JSON.parse(await env.AMV_KV.get(key) || '[]') || []; } catch (e) { list = []; }
    list.push(ev);
    if (list.length > ACTIVITY_MAX_EVENTS) list = list.slice(-ACTIVITY_MAX_EVENTS);
    await env.AMV_KV.put(key, JSON.stringify(list), { expirationTtl: ACTIVITY_TTL_S });
  } catch (e) { /* never let logging break the thing being logged */ }
}

/* GET /v1/activity -> the account's own security history, newest first. */
async function accountActivity(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  let list = [];
  try { list = JSON.parse(await env.AMV_KV.get(`alog:${user.email}`) || '[]') || []; } catch (e) { list = []; }
  return json({
