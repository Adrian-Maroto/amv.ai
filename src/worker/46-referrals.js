/* =====================================================================
   AMV-075  REFERRALS - growth that cannot be farmed
   ---------------------------------------------------------------------
   A referral programme is the cheapest growth AMV can buy, and the easiest
   thing in the product to steal from. The fraud register already names
   `referral_farming`: one person, one laptop, ten throwaway inboxes, and a
   reward for each. So the defences are the design, not a later patch.

   Four rules make farming unprofitable:
     1. NOTHING IS PAID FOR A SIGNUP. The reward lands only after the invited
        account has used AMV for real - a token floor AND a full day of age, so
        it cannot be satisfied in one sitting with a burner address.
     2. Same-device signups earn nothing. Signup IP is stored only as a keyed
        hash (never the address itself), and a referral between two accounts
        that share one is rejected and recorded against the referrer.
     3. There is a hard ceiling. Five active rewards per account, each expiring
        after 90 days, so the maximum any account can ever hold is bounded and
        the exposure is a known number rather than an open tap.
     4. The reward is CAPACITY, not money. Bonus monthly tokens - never wallet
        credit, never a plan upgrade, never anything convertible to cash.

   The reward is added to the MONTHLY allowance and deliberately not to the
   daily one: an invite buys more days at full speed, and can never turn into a
   single enormous day of compute.
   ===================================================================== */
const REFERRAL_REWARD_TOKENS   = 100000;             // to BOTH sides, on conversion
const REFERRAL_MAX_CONVERSIONS = 5;                  // active rewards per account
const REFERRAL_BONUS_TTL_MS    = 90 * 86400000;      // a reward lasts 90 days
const REFERRAL_QUALIFY_TOKENS  = 25000;              // real usage before anyone is paid
const REFERRAL_MIN_AGE_MS      = 24 * 60 * 60 * 1000;
const REFERRAL_PENDING_TTL_S   = 60 * 86400;         // an uninvoked invite expires
const REFERRAL_DAY_CAP         = 20;                 // signups one code may mint per day

/* A keyed, pseudonymous fingerprint of the signup network. We never store the
   address: this is a truncated HMAC, so it can be COMPARED but not reversed
   into an IP, which is what the same-device check actually needs. */
/* ONE ANSWER TO "WHO IS THIS", FOR EVERY RATE LIMIT.

   Twelve places wrote this by hand and eleven took X-Forwarded-For whole.
   `_ipHash` below is the one that did not, and its comment says exactly why:
   XFF is a caller-SUPPLIED list, so appending junk to it buys a fresh
   rate-limit bucket on every request just by lengthening the string. The limit
   is still there and no longer limits anything - which is the worst shape a
   limit can have, because the audit line still says it fired.

   Behind the edge this does not bite: CF-Connecting-IP is always set, so the
   fallback never runs. That is a reason it has not hurt anybody yet, not a
   reason to keep it - the fallback exists precisely for running OFF the edge,
   which is the one deployment where the header is attacker-controlled.

   45 characters because that is the longest an IPv6 address gets, so a real
   address is never truncated and a padded one cannot buy a second bucket by
   being longer. */
function _rlIp(request){
  try{
    const cf = request.headers.get('CF-Connecting-IP');
    if (cf) return String(cf).trim().slice(0, 45);
    const fwd = String(request.headers.get('X-Forwarded-For') || '').split(',')[0].trim();
    return (fwd || 'noip').slice(0, 45);
  }catch(e){ return 'noip'; }
}

async function _ipHash(env, request) {
  try {
    /* CF-Connecting-IP is set by the edge and cannot be forged from outside.
       X-Forwarded-For is a caller-supplied LIST and is only a fallback for
       running off the edge - so take the first hop rather than the whole
       header, or somebody appending junk gets a fresh rate-limit bucket per
       request just by lengthening the string. */
    const fwd = String(request.headers.get('X-Forwarded-For') || '').split(',')[0].trim();
    const ip = request.headers.get('CF-Connecting-IP') || fwd || '';
    if (!ip || !env.JWT_SECRET) return '';
    const key = await _hmacKey(env.JWT_SECRET);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('ip:' + ip)));
    return Array.from(mac.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) { return ''; }
}

/* The code for an email, derived rather than random so it is stable forever and
   needs no allocation table to mint. Crockford's alphabet minus I/L/O/U, so a
   code read down a phone line cannot be transcribed into someone else's. */
async function _referralCode(env, email) {
  const key = await _hmacKey(env.JWT_SECRET);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('referral:' + email)));
  const AL = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // 32 chars, so mac[i] % 32 is uniform
  let out = '';
  for (let i = 0; i < 12; i++) out += AL[mac[i] % 32];
  return out;
}

/* Resolve (and on first call, claim) this account's code. Derivation alone is
   not enough: two emails can hash to the same prefix, and the loser of that
   race must not silently collect the winner's invites. So the claim is written
   BOTH ways and every conversion re-checks that the pair still agrees. */
async function _referralEnsure(env, email) {
  const em = String(email || '').toLowerCase();
  if (!em || !env.JWT_SECRET) return null;
  try {
    const mine = await env.AMV_KV.get(`refmine:${em}`);
    if (mine) return mine;
    const base = await _referralCode(env, em);
    for (const len of [8, 10, 12]) {
      const cand = base.slice(0, len);
      const owner = await env.AMV_KV.get(`refcode:${cand}`);
      if (owner && owner !== em) continue;            // taken - lengthen and retry
      if (!owner) await env.AMV_KV.put(`refcode:${cand}`, em);
      await env.AMV_KV.put(`refmine:${em}`, cand);
      return cand;
    }
    return null;   // three collisions in a row: astronomically unlikely, and the
                   // caller shows "unavailable" rather than a code that isn't ours
  } catch (e) { return null; }
}

/* Record an invite at signup. This NEVER blocks the signup itself - a bad or
   abusive code costs the new user nothing; it simply earns nobody anything. */
async function _referralCapture(env, request, newEmail, refRaw) {
  const em = String(newEmail || '').toLowerCase();
  const code = String(refRaw || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 12);
  if (!em || !code) return;
  try {
    const referrer = await env.AMV_KV.get(`refcode:${code}`);
    if (!referrer) return;
    if (referrer === em) { audit(env, 'referral_self', { email: em }); return; }
    /* Velocity. A real person does not invite twenty strangers who all sign up
       inside one day; a script does. Past the cap the signup still works and the
       referral simply does not exist, and the referrer is flagged. */
    /* Atomic, not read-then-write: a scripted burst of signups all read the same
       value at once and every one of them would think it was under the cap. The
       shared counter is the only thing here that can actually say no. */
    const res = await counter(env, `refday:${code}:${todayKey()}`,
                              { op: 'reserve', amount: 1, cap: REFERRAL_DAY_CAP, ttlMs: 3 * 86400000 });
    if (!res.allowed) {
      await _abuseRecord(env, referrer, 'referral_velocity', { signupsToday: res.value || 0 });
      audit(env, 'referral_velocity_blocked', { referrer, count: res.value || 0 });
      return;
    }
    await env.AMV_KV.put(`refpend:${em}`, JSON.stringify({ code, referrer, at: Date.now() }),
                         { expirationTtl: REFERRAL_PENDING_TTL_S });
    /* A marker on the entitlement, which every app load already reads. Without
       it, checking for a pending invite would mean an extra lookup on every
       load for every account forever - a permanent cost paid by the whole user
       base for a state that only a few accounts are ever in. */
    /* AMV-202: the marker goes on under the lock. A signup grant landing at the
       same moment would otherwise be written away by this, or take this with it. */
    await _withRecord(env, 'ent', em,
      async (e, k) => (await DB.get(e, 'ent', k)) || { plan: 'free' },
      async (e, k, rec) => { await DB.put(e, 'ent', k, rec); },
      (rec) => { rec.refPending = true; });
    audit(env, 'referral_pending', { referrer, email: em });
  } catch (e) { /* never let growth plumbing break account creation */ }
}

/* The rewards an account actually holds right now: expired ones fall off, and
   the list is bounded so the entitlement record cannot grow without limit. */
function _referralActive(ent) {
  const now = Date.now();
  return (((ent && ent.refBonus) || [])
    .filter(b => b && b.at && (now - b.at) < REFERRAL_BONUS_TTL_MS))
    .slice(-REFERRAL_MAX_CONVERSIONS);
}
function _bonusTokens(ent) {
  return _referralActive(ent).reduce((sum, b) => sum + (Number(b.tokens) || 0), 0);
}

/* Grant one reward, honouring the ceiling. Returns whether it was actually
   granted so the caller can tell the user the truth either way. */
async function _referralGrant(env, email, kind) {
  const em = String(email || '').toLowerCase();
  if (!em) return false;
  /* AMV-202: bonus capacity is money. Two conversions landing together both
     read the same list and both wrote it, so one reward vanished - and the cap
     on how many a person may earn was checked against a list that was already
     out of date, so both could pass a check only one should. Counted and
     appended inside the lock, against the list as it is now. */
  const granted = await _withRecord(env, 'ent', em,
    async (e, k) => (await DB.get(e, 'ent', k)) || { plan: 'free' },
    async (e, k, rec) => { if (rec) await DB.put(e, 'ent', k, rec); },
    (rec) => {
      const live = _referralActive(rec);
      if (live.length >= REFERRAL_MAX_CONVERSIONS) return false;
      rec.refBonus = live.concat({ at: Date.now(), tokens: REFERRAL_REWARD_TOKENS, kind });
      return true;
    });
  if (!granted) { audit(env, 'referral_capped', { email: em }); return false; }
  audit(env, 'referral_reward', { email: em, tokens: REFERRAL_REWARD_TOKENS, kind });
  return true;
}

/* Called when the invited account opens AMV. Everything here is a reason to pay
   NOBODY; the reward is the last thing that happens, and only once. */
/* Take the marker off the entitlement. Called wherever an invite stops being
   pending, for any reason - otherwise the flag outlives the invite and every
   app load pays for a lookup that can never find anything. */
async function _referralClearPending(env, em) {
  try {
    await _withEnt(env, em, (ent) => {
      if (!ent || !ent.refPending) return null;
      delete ent.refPending;
      return ent;
    });
  } catch (e) { /* the flag is an optimisation; never fail a request over it */ }
}

async function _referralMaybeConvert(env, email) {
  const em = String(email || '').toLowerCase();
  if (!em) return null;
  let pend = null;
  try { const raw = await env.AMV_KV.get(`refpend:${em}`); if (raw) pend = JSON.parse(raw); } catch (e) { return null; }
  // The invite expired without ever qualifying. Clear the marker so this
  // account stops paying for the lookup.
  if (!pend || !pend.referrer || !pend.code) { await _referralClearPending(env, em); return null; }

  const drop = async (reason) => {
    try { await env.AMV_KV.delete(`refpend:${em}`); } catch (e) {}
    await _referralClearPending(env, em);
    audit(env, 'referral_rejected', { referrer: pend.referrer, reason });
    return null;
  };

  const acct = await DB.get(env, 'acct', em);
  if (!acct) return null;
  // Not yet a real user. Not a rejection - just not yet, so we leave the invite
  // pending and check again next time they open the app.
  if (Date.now() - (acct.createdAt || 0) < REFERRAL_MIN_AGE_MS) return null;
  /* Read through the same window the meter writes to, or this finds nothing
     for anybody on a paid plan and referrals silently stop qualifying. The
     entitlement is read for the anchor - once per invite, on a path that runs
     rarely, which is the right place to spend a read. */
  const refEnt = (await DB.get(env, 'ent', em)) || {};
  const refPeriod = _periodKeyFor(refEnt.renewedAt, _planOf(refEnt), refEnt.custom);
  const used = (await counter(env, `usg:${em}:${refPeriod}`, { op: 'get' })).value || 0;
  if (used < REFERRAL_QUALIFY_TOKENS) return null;

  // The code must STILL belong to the referrer in both directions (collision race).
  const owner = await env.AMV_KV.get(`refcode:${pend.code}`);
  const mine  = await env.AMV_KV.get(`refmine:${pend.referrer}`);
  if (owner !== pend.referrer || mine !== pend.code) return drop('code_reassigned');

  // Same device: the farming case, and the reason this check exists at all.
  const ref = await DB.get(env, 'acct', pend.referrer);
  if (!ref) return drop('referrer_gone');
  if (acct.sipHash && ref.sipHash && acct.sipHash === ref.sipHash) {
    await _abuseRecord(env, pend.referrer, 'referral_same_device', {});
    return drop('same_device');
  }
  // An account already flagged for abuse earns nothing further.
  const st = await _abuseStatus(env, pend.referrer);
  if (st && st.blocked) return drop('referrer_blocked');

  /* Consume the invite BEFORE granting. If a grant then fails, the reward is
     lost rather than paid twice - the safe direction for anything of value. */
  try { await env.AMV_KV.delete(`refpend:${em}`); } catch (e) { return null; }
  await _referralClearPending(env, em);
  const paidReferrer = await _referralGrant(env, pend.referrer, 'invited');
  const paidJoiner   = await _referralGrant(env, em, 'joined');
  try { await _recordGrowth(env, 'referral'); } catch (e) {}
  audit(env, 'referral_converted', { referrer: pend.referrer, email: em, paidReferrer, paidJoiner });
  return { paidReferrer, paidJoiner, tokens: REFERRAL_REWARD_TOKENS };
}

/* GET /v1/referral -> this account's invite link and what it has earned.
   Deliberately does NOT list who joined: the referrer invited them, they did
   not consent to having their account confirmed back to anyone. */
async function referralStatus(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const code = await _referralEnsure(env, user.email);
  const ent = (await DB.get(env, 'ent', user.email)) || {};
  const active = _referralActive(ent);
  const origin = String(env.APP_URL || env.APP_ORIGIN || '').replace(/\/$/, '');
  return json({
    ok: true,
    code: code || '',
    link: code && origin ? `${origin}/?ref=${code}` : '',
    rewards: active.map(b => ({ at: b.at, tokens: b.tokens, kind: b.kind || '', expiresAt: b.at + REFERRAL_BONUS_TTL_MS })),
    bonusTokens: _bonusTokens(ent),
    perReferral: REFERRAL_REWARD_TOKENS,
    max: REFERRAL_MAX_CONVERSIONS,
    windowDays: Math.round(REFERRAL_BONUS_TTL_MS / 86400000),
    qualifyTokens: REFERRAL_QUALIFY_TOKENS,
    minAgeHours: Math.round(REFERRAL_MIN_AGE_MS / 3600000),
  });
}

/* Fields on an entitlement that belong to the ACCOUNT, not to the plan it is
   currently on. setEntitlement builds a fresh record every time - which is what
   makes a plan change clean - so anything earned separately has to be carried
   across explicitly or it is destroyed by the next upgrade. Referral capacity
   was exactly that: earn a bonus, subscribe, lose the bonus. */
/* Fields that survive a plan change. setEntitlement rebuilds the record from
   scratch, so anything not listed here is destroyed by an upgrade, a downgrade,
   a Stripe webhook or an admin override. `teamId` belongs here for the same
   reason `refBonus` does: losing it would silently eject somebody from their
   team's plan and counters on the next billing event, and the cause would be
   invisible from the outside. */
/* Carried across a rewrite of the entitlement record. renewedAt is here on
   purpose: losing it would make a live subscription look like one nobody has
   paid for in months, and the sweep below would act on that. The asymmetry
   decides it - failing to notice a lapse costs one month's revenue, wrongly
   cancelling somebody who is paying costs the customer. */
/* `blocked` is here for the reason the whole list exists. setEntitlement
   REPLACES the record, so without carrying it, the next plan change - a
   renewal, an upgrade, a webhook - would quietly unblock an account that was
   blocked for charging back. The one thing somebody in that position does next
   is pay again. */
const ENT_CARRY_KEYS = ['refBonus', 'teamId', 'familyOf', 'renewedAt', 'lastEventAt', 'lastEventSrc',
                        'blocked', 'blockedReason', 'blockedAt',
                        /* AMV-007: which subscription owns this plan, and the ones that no
                           longer do. Carried like every other fact that must survive a
                           write from a different source. */
                        'subId', 'retiredSubs',
                        /* What the next charge is. Written by the subscription
                           webhook and by the auto-renew route; carried so a
                           referral bonus or a seat change does not erase the
                           only answer the billing screen has. Cleared below
                           when the plan stops costing anything, because a
                           renewal date on a free account is a date nobody is
                           billed on. */
                        'autoRenew', 'renewsAt', 'cycle'];

/* AMV-007: WHOSE SUBSCRIPTION IS THIS PLAN?

   Staleness is compared per provider, and that is correct: two processors'
   clocks are not one timeline and nothing sensible can be said across them.
   The gap is what happens when the event comes from the OTHER processor
   entirely. The comparison simply does not apply, so the event wins by default.

   The sequence that costs a customer their plan: they cancel PayPal, resubscribe
   on Stripe, and PayPal's cancellation webhook - retried for days, as both
   providers do - lands afterwards and sets them to free. They have paid, the
   payment is live, and AMV has revoked the thing they are being charged for.
   It runs the other way too: a stale PayPal "still active" reactivating an
   account that cancelled on Stripe, which is a paid plan given away for free.

   The audit's implied fix is to compare the timestamps across processors. That
   is unsound for the reason the existing comment already gives.

   OWNERSHIP is the sound version, and it needs no shared clock. One subscription
   owns the plan at a time. An event from that subscription is authoritative. An
   event from any other is only allowed to do one thing - take ownership, by
   granting a paid plan, which is the one message that can only follow real money
   moving. Everything else from a non-owner is ignored, because a processor that
   is not billing this customer has nothing to say about whether they are paid up.

   A retired subscription can never speak again, even to claim ownership: its
   activation events are exactly what a days-long retry queue is full of.

   Events with no subscription id - a chargeback, a refund - are not making an
   ownership claim at all. They apply if they come from the processor that owns
   the plan, and are ignored otherwise, so a dispute still revokes access and a
   refund on an old PayPal charge cannot revoke a live Stripe plan. */
const ENT_MAX_RETIRED = 8;
function _entEventVerdict(prev, src, subId, isPaidGrant) {
  const owner = String((prev && prev.lastEventSrc) || '');
  const ownerSub = String((prev && prev.subId) || '');
  const retired = Array.isArray(prev && prev.retiredSubs) ? prev.retiredSubs : [];

  if (subId && retired.indexOf(subId) > -1) {
    return { apply: false, reason: 'retired_subscription' };
  }
  /* Nothing owns it yet - the first processor event to arrive takes it. */
  if (!owner || (!ownerSub && !subId)) return { apply: true, takeOver: !!subId };
  if (!subId) {
    /* No claim of its own, so it defers to whoever owns the plan. */
    return src === owner ? { apply: true } : { apply: false, reason: 'not_the_owning_processor' };
  }
  if (src === owner && subId === ownerSub) return { apply: true };
  if (!ownerSub) return { apply: true, takeOver: true };
  /* A different subscription. Only real money moving lets it take over. */
  if (isPaidGrant) return { apply: true, takeOver: true };
  return { apply: false, reason: 'not_the_owning_subscription' };
}

/* ── FAMILY ────────────────────────────────────────────────────────────────
   A parent's account carries a child's, the way a phone plan does.

   What existed before was a consent flow: an account could ask another account
   for named permissions, a code was emailed, and the grant was recorded. All of
   that was real and none of it was CONSULTED - no endpoint anywhere read a link
   record before allowing anything. Permissions that nothing checks are text.

   So this is deliberately small and entirely enforced. Three controls, each
   wired to the code path that can actually spend or expose something:

     - a monthly dollar cap, checked in the same backstop that protects the plan
     - buying in the marketplace, refused at the purchase
     - taking money out, refused at the withdrawal

   And one thing it deliberately does NOT do: a parent cannot read their child's
   conversations. Not "we do not show it in the UI" - there is no endpoint, no
   scope and no record that would let them. A control panel that quietly becomes
   surveillance is a different product from the one a family is buying, and the
   child is told in plain words exactly where the line is. */
const FAMILY_MAX_CHILDREN = 5;
const FAMILY_DEFAULTS = { monthlyUSD: 5, marketplace: false, payouts: false };

function _familyLimitsOf(fam, childEmail){
  const m = fam && (fam.members || []).find(x => x.email === childEmail && x.role === 'child');
  if(!m) return null;
  return Object.assign({}, FAMILY_DEFAULTS, m.limits || {});
}

/* Resolved once per request, next to the plan, because every check below needs
   it and none of them should be reaching into storage on their own. */
async function _familyOf(env, email, ent){
  const em = String(email || '').toLowerCase();
  const e = ent || (await DB.get(env, 'ent', em)) || {};
  if(!e.familyOf) return null;
  /* AMV-031: the entitlement SAYS this person is in a family. If the family
     record cannot be read, the honest answer is not "then they have no limits" -
     that is the one reading which hands a capped child the full plan allowance,
     and it happens silently because a corrupt record and an absent one look
     identical to the caller.
     Strictest defaults instead: still in the family, limited to what the
     defaults allow, until somebody repairs the record. */
  let fam = null;
  try {
    fam = await DB.getStrict(env, 'fam', e.familyOf);
  } catch (err) {
    audit(env, 'family_unreadable', { email: em, family: e.familyOf });
    return { id: e.familyOf, parent: '', limits: Object.assign({}, FAMILY_DEFAULTS), unreadable: true };
  }
  const limits = _familyLimitsOf(fam, em);
  if(!fam || !limits) return null;        // membership is the source of truth
  return { id: fam.id, parent: fam.parentEmail, limits };
}


/* AMV-088: aggregates that do not require reading every account.

   The founder dashboard listed every entitlement and then read a counter per
   user. At forty accounts that is fine; at forty thousand it is forty thousand
   reads on every page load - and the list was capped at 5000, so past that the
   MRR was simply WRONG with nothing on screen to say so. A number that is
   quietly wrong is worse than one that is missing.

   Population is maintained where it changes - one increment and one decrement
   per plan change - so headline revenue is exact at any size and costs nothing
   to read. The per-account detail below still needs per-account data, so it
   stays a bounded scan that SAYS it is bounded. */
async function _planPopShift(env, fromPlan, toPlan, fromSeats, toSeats){
  try{
    /* Seats move even when the plan does not - somebody going from 5 seats to 20
       is the same plan and four times the revenue, and a population counter that
       only counted heads would report both as one Teams customer. */
    const df = (+toSeats || 0) - (+fromSeats || 0);
    if(df) await counter(env, 'seatcount:team', { op:'incr', amount: df });
    if(fromPlan === toPlan) return;
    if(fromPlan) await counter(env, `plancount:${fromPlan}`, { op:'incr', amount: -1 });
    if(toPlan)   await counter(env, `plancount:${toPlan}`,   { op:'incr', amount: 1 });
  }catch(e){ /* the scan is still the fallback; never fail a write over a stat */ }
}
async function _planPopulation(env){
  const out = {};
  for(const plan of ['free','pro','elite','ultra','custom','team']){
    try{ out[plan] = Math.max(0, (await counter(env, `plancount:${plan}`, { op:'get' })).value || 0); }
    catch(e){ out[plan] = 0; }
  }
  return out;
}
/* Total seats sold on the per-seat plan. Revenue there is seats, not accounts. */
async function _teamSeatsSold(env){
  try{ return Math.max(0, (await counter(env, 'seatcount:team', { op:'get' })).value || 0); }
  catch(e){ return 0; }
}

/* The team marker lives on the entitlement record, because requireUser already
   reads that - putting it anywhere else would add a lookup to every single
   authenticated request for the sake of the few accounts in a team. */
async function _setUserTeam(env, email, teamId){
  const em = String(email||'').toLowerCase(); if(!em) return;
  /* AMV-202: joining or leaving a team must not write back a plan read before
     a payment landed. */
  await _withRecord(env, 'ent', em,
    async (e, k) => (await DB.get(e, 'ent', k)) || { plan: 'free' },
    async (e, k, ent) => { await DB.put(e, 'ent', k, ent); },
    (ent) => { if(teamId) ent.teamId = teamId; else delete ent.teamId; });
}

/* AMV-100: the single answer to "whose allowance is this request spending".

   Both halves have to travel together. A member who inherits the team's plan
   but keeps their own counters is fifty people's compute for one subscription -
   the cost ceiling, the daily tokens and the monthly tokens are all keyed by
   subject, so a shared plan has to mean a shared budget or it is a hole with a
   login screen. Equally, a member whose counters are shared but who does not
   inherit the plan is paying nothing and getting nothing, which is just a
   filing cabinet.

   The one case that is NOT pooled: somebody who already pays for a plan better
   than the team's. Joining a Pro team must never take away the Ultra they are
   paying for on their own card, so they keep their plan and their own counters
   and cost the team nothing. */
function _planRankOf(plan, cfg){
  if(plan === 'custom') return _customRank(cfg);
  /* A Teams seat carries Elite-grade capability - Apex included - because that
     is the thing being sold. Ranked here rather than in PLAN_RANK so the seat
     price and the capability it buys stay in one place. */
  if(plan === 'team') return PLAN_RANK.elite;
  return PLAN_RANK[plan] || 0;
}

/* Which members the current plan actually pays for.

   Invite and join both refuse a seat past the limit, but neither of them runs
   when the OWNER downgrades. Without this, a ten-person Elite team could drop to
   Pro and keep handing ten people an Elite plan for fifteen dollars - the seat
   check would be a formality anyone could walk around by upgrading, filling the
   team and downgrading again.

   The order is fixed rather than arbitrary so the same people keep their seats
   on every request: the owner first, because it is their subscription, then by
   join date. A downgrade takes the seat from whoever joined last, which is the
   only ordering a user would predict. */
function _teamSeated(team){
  const limit = _teamSeatLimit(_teamPlan(team), team.customCfg);
  const ms = (team.members || []).slice().sort((a, b) => {
    const ao = a.role === 'owner', bo = b.role === 'owner';
    if(ao !== bo) return ao ? -1 : 1;
    return (a.joinedAt || 0) - (b.joinedAt || 0);
  });
  return ms.slice(0, limit);
}

async function _billingSubjectOf(env, email, ent){
  const em = String(email || '').toLowerCase();
  const e = ent || (await DB.get(env, 'ent', em)) || {};
  const out = { subject: em, plan: _planOf(e), customCfg: e.custom || null,
                teamId: null, teamRole: null, seated: false,
                /* The anniversary the allowance window is anchored on. It
                   travels with the subject, so a team member is measured over
                   the TEAM's period rather than opening one of their own. */
                renewedAt: +e.renewedAt || 0 };
  if(!e.teamId) return out;
  const team = await DB.get(env, 'team', e.teamId);
  /* Membership is the source of truth, exactly as in _teamOf - a stale pointer
     left on an entitlement record must not keep buying compute after removal. */
  const m = team && (team.members || []).find(x => x.email === em);
  if(!m) return out;
  out.teamId = team.id;
  out.teamRole = m.role || 'member';
  /* Every member, seated or not: the policy is the company's rule about its
     people, not a condition of the seat it pays for. */
  out.teamEngines = _teamEngineList(team);
  out.seated = _teamSeated(team).some(x => x.email === em);
  const teamPlan = _teamPlan(team);
  if(out.seated && _planRankOf(teamPlan, team.customCfg) >= _planRankOf(out.plan, out.customCfg)){
    out.plan = teamPlan;
    out.customCfg = team.customCfg || null;
    out.subject = 'team:' + team.id;
    out.renewedAt = +team.renewedAt || 0;
  }
  return out;
}

async function setEntitlement(env, email, plan, extra = {}) {
  const em = email.toLowerCase();
  /* AMV-196: the read and the write are one operation.

     This reads the current entitlement, carries fields forward, and writes a
     new one. Unguarded, two of those at once lose a write - and the writers are
     a Stripe webhook, a PayPal webhook, a referral bonus, a past-due mark and
     an admin edit, several of which can land in the same second after a
     checkout. The one that loses can be the plan somebody just paid for, and
     nothing fails: they simply stay on free. */
  return _withRecord(env, 'ent', em,
    async (e, k) => (await DB.get(e, 'ent', k)) || {},
    async () => {},                      // written explicitly below, with the counters
    async (prev) => {
  /* AMV-200: A LATE WEBHOOK MUST NOT UNDO A NEWER ONE.

     Stripe and PayPal both deliver at-least-once with NO ordering guarantee,
     and both retry a failed delivery for days. Nothing here knew which event
     was newer, so the last one to arrive won - whatever it said.

     The sequence that costs money: a cancellation is delivered and applied, and
     then an earlier "still active" event, retried after its first delivery
     failed, arrives behind it. The cancelled customer is back on a paid plan,
     free, until somebody notices. It cuts the other way too - a late cancel
     undoing an upgrade somebody has just paid for, which is a support ticket
     from a customer who did everything right.

     Only PROCESSOR events carry a time, and only they are compared. An admin
     edit, a team seat change or a referral bonus has no event behind it and
     always applies - it is a person deciding now, not a message from a queue.
     Comparison is per provider, because two processors' clocks are not one
     timeline and nothing sensible can be said across them. */
  const evtAt = +extra.eventAt || 0;
  const evtSrc = String(extra.source || '');
  const fromProcessor = (evtSrc === 'stripe' || evtSrc === 'paypal');
  const evtSub = String(extra.sub || '');
  /* A grant of a PAID plan is the only message that can only follow real money
     moving, which is what makes it the one thing allowed to move ownership. */
  const isPaidGrant = fromProcessor && _planPriceUSD(plan, extra.custom || prev.custom) > 0;

  /* AMV-007. Asked before staleness, because "is this processor even billing
     this customer" comes before "is this the newest thing it said". */
  let verdict = { apply: true };
  if (fromProcessor) {
    verdict = _entEventVerdict(prev, evtSrc, evtSub, isPaidGrant);
    if (!verdict.apply) {
      audit(env, 'entitlement_event_ignored', { email, plan, source: evtSrc,
        sub: evtSub, reason: verdict.reason, owner: prev.lastEventSrc || '', ownerSub: prev.subId || '' });
      return prev;                       // nothing written; the owning subscription stands
    }
  }

  if (evtAt && fromProcessor
      && prev.lastEventSrc === evtSrc && +prev.lastEventAt > evtAt) {
    audit(env, 'entitlement_stale_event', { email, plan, source: evtSrc, eventAt: evtAt, applied: +prev.lastEventAt });
    return prev;                         // nothing written; the newer state stands
  }
  const ent = { plan, updatedAt: Date.now(), ...extra };
  for (const k of ENT_CARRY_KEYS) if (prev[k] !== undefined && ent[k] === undefined) ent[k] = prev[k];
  if (evtAt && fromProcessor) {
    ent.lastEventAt = evtAt; ent.lastEventSrc = evtSrc;
  }
  if (fromProcessor && evtSub) {
    /* Ownership moved, so the subscription that held it is retired and can
       never speak again - its own retries are the thing being defended
       against. Bounded, because this is a defence against a retry queue rather
       than a history. */
    if (verdict.takeOver && prev.subId && prev.subId !== evtSub) {
      const was = Array.isArray(prev.retiredSubs) ? prev.retiredSubs.slice() : [];
      if (was.indexOf(prev.subId) < 0) was.push(prev.subId);
      ent.retiredSubs = was.slice(-ENT_MAX_RETIRED);
      audit(env, 'entitlement_owner_changed', { email, from: prev.lastEventSrc || '',
        fromSub: prev.subId, to: evtSrc, toSub: evtSub, plan });
    }
    ent.subId = evtSub;
    ent.lastEventSrc = evtSrc;
  }
  /* `sub` is the claim; `subId` above is the record of it. Leaving both would
     put two names for one fact on the entitlement. */
  delete ent.sub;
  delete ent.eventAt;                    // the marker above is the record of it
  /* When a PROCESSOR is the reason for this write, money is behind it - a
     checkout, a renewal, a live subscription re-read. That is the only signal
     that says "this plan is still being paid for", and without recording it
     the only thing that can ever revoke a plan is a webhook arriving. See
     runRenewalSweep. `updatedAt` is not a substitute: an admin edit or a team
     seat change moves it without a penny changing hands. */
  if ((extra.source === 'stripe' || extra.source === 'paypal') && _planPriceUSD(plan, ent.custom) > 0) {
    ent.renewedAt = Date.now();
  }
  /* A cancelled or downgraded account has no next charge, and the carry above
     would otherwise hand it the old one - so the billing screen would promise a
     renewal to somebody who has just cancelled. */
  if (_planPriceUSD(plan, ent.custom) <= 0) {
    delete ent.autoRenew; delete ent.renewsAt; delete ent.cycle;
  }
  await DB.put(env, 'ent', em, ent);
  // Keep the population counters true at the one place a plan can change.
  await _planPopShift(env, prev.plan ? _planOf(prev) : null, _planOf(ent),
    _planOf(prev) === 'team' ? _teamSeatCount(prev.custom) : 0,
    _planOf(ent)  === 'team' ? _teamSeatCount(ent.custom)  : 0);
  /* If this account owns a team, the team's cached plan follows it - otherwise
     an upgrade would not reach the seats it just paid for, and a downgrade
     would leave them on a plan nobody is paying for (AMV-100). */
  await _refreshTeamPlan(env, em, Object.assign({}, ent, { teamId: ent.teamId || prev.teamId }));
  /* PAID, counted at the one place a plan can be granted and only on the way UP
     from not paying - so a renewal, a seat change or a downgrade-and-back does
     not count the same customer twice. */
  try {
    if (_planPriceUSD(_planOf(ent), ent.custom) > 0 && _planPriceUSD(_planOf(prev), prev.custom) === 0) {
      await _funnelMark(env, em, 'paid');
    }
  } catch (e) {}
  audit(env, 'entitlement_set', { email, plan });
  /* Also on the account's own activity log. A plan change nobody made is how a
     compromised account usually announces itself. There is no request here -
     this runs from a payment webhook and a cron - so the event carries no
     device or country, which is honest: we do not know one. */
  await _userEvent(env, null, email, 'plan_changed', { plan });
  return ent;
    });
}

/* AMV-064: a renewal that FAILED must not buy another month of service.
   When a card is declined Stripe retries for up to three weeks. Nothing here
   listened for that, so the plan stayed fully granted the whole time - free
   Ultra, repeatable every cycle, for anyone whose card simply stops working.
   Cutting access the second a payment fails is the other extreme: cards expire
   for honest reasons and an instant lockout loses a paying customer over a
   fixable problem. So there is a stated grace period. Inside it the plan works
   and the app asks them to fix the card; past it the plan is free until a
   payment succeeds. */
/* AMV-085: three days was too short, and it was costing real money.

   When a card fails at renewal the payment processor keeps retrying for about
   three weeks - most recoveries land inside the first week. Cutting a paying
   customer off on day three ends the subscription while the retry that would
   have succeeded has not happened yet. That is involuntary churn: revenue lost
   to an expired card or a bank's fraud hold, not to anyone deciding to leave.
   It is the cheapest revenue there is to keep.

   Seven days of full access covers the common causes without giving away much.
   The exposure is bounded either way: the monthly cost ceiling
   (planPrice * 0.45) applies during grace exactly as it does at any other
   time, so a lapsed account cannot spend more than the plan was already sized
   to allow. Four extra days of that is worth far less than the subscription it
   saves. */
const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;   // full access while the card is retried

/* How long the processor keeps trying before giving up. Past the grace window
   the plan drops to Free limits, but the subscription is not dead yet - and
   telling someone their plan "has dropped" when a retry could still succeed
   reads as final and stops them fixing the card. */
const PAST_DUE_RECOVER_MS = 21 * 24 * 60 * 60 * 1000;

/* The plan as it stands RIGHT NOW, which is not always the plan that was sold.
   Every read of an entitlement goes through this, so an expired grace period
   cannot be missed by one caller and honoured by another. */
function _planOf(ent) {
  if (!ent || !ent.plan) return 'free';
  if (ent.pastDueSince && Date.now() > ent.pastDueSince + PAST_DUE_GRACE_MS) return 'free';
  return ent.plan;
}
/* What the app should tell the user about their billing, if anything.

   Three states, because they call for three different things from the user.
   While the plan still works, say by when. Once it has stopped working but the
   card is still being retried, say it comes straight back - that is the window
   where most cards actually get fixed. Only after the processor has given up
   is it over, and only then should the message read that way. */
/* WHAT A SUBSCRIPTION SAYS ABOUT ITS NEXT CHARGE.

   Read off a Stripe SUBSCRIPTION object - the one Stripe sends with
   customer.subscription.updated, and the one the auto-renew route gets back
   from its own write. Never off an invoice or a checkout session: those carry
   neither `cancel_at_period_end` nor the subscription's period, and guessing
   from them is how a billing screen ends up stating a date nobody is billed on.

   Returns null when the object cannot answer, and null means the app says
   nothing rather than something reassuring it does not know. */
function _renewalFromSub(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const end = +sub.current_period_end || 0;
  if (!end) return null;
  const iv = sub.items?.data?.[0]?.price?.recurring?.interval || '';
  return {
    autoRenew: !sub.cancel_at_period_end,
    renewsAt: end * 1000,
    cycle: iv === 'year' ? 'year' : (iv === 'month' ? 'month' : ''),
  };
}

/* THE ANSWER TO "WILL I BE CHARGED AGAIN, AND WHEN".

   Only ever from facts a processor put on the record. An account with nothing
   stored gets null and the screen stays quiet, which is the honest state for a
   deployment whose webhook has not yet delivered a subscription event - a
   confident "renews monthly" derived from the plan name would be a guess about
   somebody's money.

   A date that has passed is dropped rather than shown. Stripe moves
   current_period_end forward on every renewal, so a stale one means the event
   that would have moved it has not arrived - and "renews 3 weeks ago" is worse
   than no date at all. */
function _renewalState(ent) {
  if (!ent || !ent.renewsAt) return null;
  if (+ent.renewsAt < Date.now()) return null;
  return {
    autoRenew: ent.autoRenew !== false,
    renewsAt: +ent.renewsAt,
    cycle: ent.cycle === 'year' ? 'year' : (ent.cycle === 'month' ? 'month' : ''),
    /* Whether the app may offer the switch at all. Without a subscription id
       there is nothing to write to, and a control that cannot act is one that
       fails at the moment somebody presses it. */
    manageable: !!ent.subId,
  };
}

function _billingState(ent) {
  if (!ent || !ent.pastDueSince) return null;
  const since = ent.pastDueSince;
  const graceEndsAt = since + PAST_DUE_GRACE_MS;
  const recoverEndsAt = since + PAST_DUE_RECOVER_MS;
  const now = Date.now();
  /* Flagged by the renewal sweep rather than by a processor telling us a
     payment failed. We do NOT know their card failed - we know we have not
     seen a renewal, which can equally mean our own webhook stopped arriving.
     Saying "your payment did not go through" to somebody whose payments are
     going through is a lie that costs them their subscription. */
  if (ent.pastDueReason === 'no_renewal_seen') {
    const over = now > graceEndsAt;
    return { state: over ? 'unconfirmed_lapsed' : 'unconfirmed', since, graceEndsAt, recoverEndsAt,
      message: over
        ? 'We could not confirm your subscription renewed, so your account is on Free for now. If you are still being '
        + 'charged, nothing is wrong on your side and we want to fix it - contact support and we will restore your plan.'
        : 'We have not been able to confirm your latest renewal. Your plan stays active until '
        + new Date(graceEndsAt).toUTCString().replace(/ GMT$/, ' UTC')
        + '. If your payments are going through normally, contact support rather than changing anything.' };
  }
  if (now <= graceEndsAt) {
    return { state: 'past_due', since, graceEndsAt,
      message: 'Your last payment did not go through. Update your card to keep your plan - it stays active until ' +
               new Date(graceEndsAt).toUTCString().replace(/ GMT$/, ' UTC') + '.' };
  }
  if (now <= recoverEndsAt) {
    return { state: 'paused', since, graceEndsAt, recoverEndsAt,
      message: 'Your plan is paused because the payment did not go through. We are still trying your card - '
             + 'update it and your plan comes back immediately, with nothing lost.' };
  }
  return { state: 'lapsed', since, graceEndsAt, recoverEndsAt,
    message: 'Your last payment could not be collected, so your plan has ended and your account is on Free. '
           + 'Your data is untouched - subscribe again any time to pick up where you left off.' };
}
/* Mark a subscription as unpaid without touching the plan that was sold, so
   that a later successful payment restores it exactly. */
async function _markPastDue(env, email, detail) {
  const em = String(email || '').toLowerCase(); if (!em) return;
  /* AMV-202: THE ONE THAT COSTS A PAYING CUSTOMER THEIR ACCOUNT.

     A past-due mark written from a copy read before a payment landed puts that
     copy back - so somebody who has just paid is marked past due and loses what
     they bought, with nothing failing anywhere. Under the lock, and re-read
     inside it, so the plan this judges is the plan as it is now. */
  const ent = await _withRecord(env, 'ent', em,
    async (e, k) => (await DB.get(e, 'ent', k)) || { plan: 'free' },
    async (e, k, rec) => { if (rec) await DB.put(e, 'ent', k, rec); },
    (rec) => {
      if (rec.plan === 'free') return null;              // nothing to lose
      if (rec.pastDueSince) return null;                 // keep the FIRST failure date
      rec.pastDueSince = Date.now();
      /* WHY, kept on the record, because the honest sentence differs. A declined
         card is the customer's to fix. A renewal we never saw might be nothing
         but our own webhook being broken, and telling somebody who is paying
         that their payment failed sends them to cancel a card that works. */
      if (detail && detail.reason) rec.pastDueReason = String(detail.reason).slice(0, 40);
      return rec;
    });
  /* Nothing to do is not a failure - the record is written back exactly as it
     was read inside the lock, which changes nothing. */
  if (!ent) return;
  /* A failed payment never touched the team, so a team whose owner stopped
     paying kept its plan until something else happened to write the record -
     and the grace window expires on a clock, not on a write (AMV-100). */
  await _refreshTeamPlan(env, em, ent);
  audit(env, 'payment_failed', Object.assign({ email: em, plan: ent.plan }, detail || {}));
}
