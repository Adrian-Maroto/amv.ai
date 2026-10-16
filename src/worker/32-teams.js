                           but "it will be gone tomorrow" is not what erasure means, and
                           there is nothing left to throttle once the account is gone. */
                        `rl:act:delacct:${email}:`, `ctr:actday:delacct:${email}:`]) {
    try {
      let cursor;
      do {
        const page = await env.AMV_KV.list({ prefix, cursor, limit: 1000 });
        for (const k of (page.keys || [])) { try { await env.AMV_KV.delete(k.name); deleted++; } catch { _eraseFailed('scanned per-user keys'); } }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
    } catch { _eraseFailed('scanned per-user keys'); }
  }

  /* The waitlist puts the address at the END of the key (waitlist:<product>:
     <email>), so there is no prefix that finds it - it takes a scan of the
     whole list. Erasure is rare and this is somebody asking not to be on a
     mailing list any more, which is the request it would be worst to ignore. */
  try {
    let cursor;
    const suffix = ':' + email;
    do {
      const page = await env.AMV_KV.list({ prefix: 'waitlist:', cursor, limit: 1000 });
      for (const k of (page.keys || [])) {
        if (k.name.endsWith(suffix)) { try { await env.AMV_KV.delete(k.name); deleted++; } catch { _eraseFailed('waitlist entries'); } }
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  } catch { _eraseFailed('waitlist entries'); }

  // Revoke all tokens so existing sessions die immediately.
  await _revokeOrSay(env, email, 'account_deleted');

  /* What survived, said out loud in all three places it has to be said: to the
     person who asked, in AMV's own record, and to somebody who can go and
     finish it. The person leaving will not keep this reply - the audit line and
     the page are what exist afterwards. */
  if (eraseFailed.length) {
    audit(env, 'account_delete_incomplete', { email, keysRemoved: deleted, failed: eraseFailed.join(',') });
    try {
      await alertOnce(env, 'erase_incomplete:' + email,
        'AN ERASURE DID NOT COMPLETE. ' + email + ' asked to be deleted and these could not be removed: '
        + eraseFailed.join(', ') + '. Everything else went. This is a legal obligation that is now part done, '
        + 'and the person has been told it is incomplete - remove the rest by hand and confirm to them.', 60);
    } catch (e) {}
    return json({
      ok: false,
      incomplete: true,
      deleted: false,
      prefixesPurged: deleted,
      failed: eraseFailed,
      error: 'Some of your data could not be deleted (' + eraseFailed.join(', ') + '). '
           + 'Everything else has been removed and our team has been alerted to finish it. '
           + 'Contact support if you do not get confirmation.',
    }, 500);
  }
  audit(env, 'account_deleted', { email, keysRemoved: deleted });
  /* WHAT IS KEPT, AND WHY, SAID RATHER THAN LEFT TO BE DISCOVERED.

     Erasure takes the wallet and its transaction history with everything else.
     What it does NOT take is the payout ledger and the calendar-year totals -
     deliberately, because a record of money actually sent has to outlive the
     account under tax and anti-money-laundering rules, and both GDPR and the
     CCPA say so in the same breath as the right to erasure. Keeping them
     silently would be the wrong way to be right: somebody who asked to be
     deleted is entitled to know what survived and on what grounds.

     It is stated here whether or not this person was ever paid, because a
     reply that only appears for sellers tells the reader something about the
     account, and because the sentence is about AMV's policy rather than about
     them. */
  return json({ ok: true, deleted: true, prefixesPurged: deleted,
    retained: {
      what: 'Records of payouts actually sent to you, and the yearly totals built from them.',
      why: 'Tax and anti-money-laundering law require these to be kept for a set period, '
         + 'and the right to erasure does not override that. They hold what was paid and when. '
         + 'Nothing about what you sold, to whom, or anything you wrote.',
    },
  });
}

/* Pull all of a user's synced data (or just keys changed since `since`). */
/* ============================================================
   TEAM / WORKSPACE MODE - the B2B tier.
   A team has an owner, members with roles, and shared data (projects,
   prompts, memory). Stored in KV: team:{id} and teammember lookups.
   ============================================================ */
/* =====================================================================
   AMV-100  SEATS - a team is one plan, shared

   The team machinery existed and was sound: invites bound to a recipient,
   redeemed atomically, roles enforced server-side, everything audited. Two
   things stopped it being a product.

   There was no seat limit, and joining a team gave you shared data but not the
   plan - so a team was a filing cabinet, not a subscription.

   Making members inherit the plan is the obvious fix and the dangerous one:
   the cost ceiling and every quota are keyed by EMAIL, so fifty members on one
   Pro plan would have been fifty times the compute for fifteen dollars. A
   shared plan has to mean a shared budget or it is a hole with a login screen.

   So the billing SUBJECT moves. A member of a team spends the team's counters,
   not their own - one plan, one ceiling, one allowance, however many people
   are drawing on it. That is what a shared plan already means to the person
   paying for it, and it is the only version that cannot be farmed. */
/* Seats by plan.

   Two ways to have a team, and they answer different questions.

   Elite and Ultra include seats because a company that has already bought the
   top plan should be able to put its people on it: 10 and 25 seats sharing that
   one plan's allowance. That is the upgrade path, not the product.

   `team` is the product. It is priced PER SEAT, and every seat adds its own
   allowance to the shared pool rather than dividing a fixed one - which is the
   only version where growing the team is worth more to the customer AND worth
   more to AMV. Ten people on Elite is 75 dollars for one plan's compute; ten
   people on Teams is 200 dollars for ten plans' worth of compute, with Apex
   included. Both sides are better off, which is why the number goes up.

   Below Elite there is exactly one seat, which is the same thing as not having
   a team. Enforced on the SERVER as well as in the app, because a gate that
   only exists in the browser is not a gate. */
const TEAM_MIN_PLAN = 'elite';
const TEAM_SEATS = { free: 1, pro: 1, elite: 10, ultra: 25 };

/* The per-seat plan. One number to change if the price moves; everything
   downstream - the ceiling, the pool, the checkout, the copy - derives from it. */
const TEAM_SEAT_PRICE_USD = 20;
const TEAM_SEAT_MIN = 3;      // below this, Pro or Elite is the better buy and we say so
const TEAM_SEAT_MAX = 500;
function _teamSeatCount(cfg){
  const n = Math.floor(+((cfg && cfg.seats) || 0)) || 0;
  return Math.max(TEAM_SEAT_MIN, Math.min(TEAM_SEAT_MAX, n || TEAM_SEAT_MIN));
}
function _teamPlanPrice(cfg){ return _teamSeatCount(cfg) * TEAM_SEAT_PRICE_USD; }

/* What this plan costs per month, in dollars. ONE definition.

   There were three copies of `{pro:15, elite:75, ultra:200}` - the chat cost
   backstop, the SMS backstop and the automation budget - each with its own
   handling of a custom plan. Three copies of a price table is three chances for
   one of them to be a month out of date while still looking authoritative, and
   the number they compute is the profit guarantee. A per-seat plan would have
   had to be added to all three, correctly, forever. */
const PLAN_PRICE_USD = { pro: 15, elite: 75, ultra: 200 };
function _planPriceUSD(plan, cfg){
  if(plan === 'team') return _teamPlanPrice(cfg);
  if(plan === 'custom') return (cfg && +cfg.price) || 0;
  return PLAN_PRICE_USD[plan] || 0;
}
/* Where a custom plan sits against the named tiers.

   `custom` is a price, not a rank, so it cannot be looked up in PLAN_RANK. It
   was being treated as top-tier, which meant a twenty dollar custom plan
   cleared the Elite-and-above gate and would have had team rights costing more
   than the plan. Ranking it by what was actually paid is the only version that
   does not sell Elite for less than Elite. */
const PLAN_PRICE_TIERS = [[200, 3], [75, 2], [15, 1]];
function _customRank(cfg){
  const price = (cfg && +cfg.price) || 0;
  for(const [at, rank] of PLAN_PRICE_TIERS) if(price >= at) return rank;
  return 0;
}

/* The team's plan, with the owner's lapse honoured.

   `team.plan` is a CACHE of the owner's plan, and `_planOf` is time-based: the
   grace window closes with no write happening anywhere. Reading the cache
   directly would keep a whole team on Elite indefinitely after the card that
   paid for it stopped working - the exact shape of "one code path uses ent.plan
   and hands out compute nobody paid for", one level of indirection along. */
function _teamPlan(team){
  if(!team) return 'free';
  return _planOf({ plan: team.plan, pastDueSince: team.pastDueSince });
}

/* Keep the cached copy current at every point the owner's billing can change.
   setEntitlement is not enough on its own: a failed payment writes the
   entitlement record directly, and never went near the team. */
async function _refreshTeamPlan(env, email, ent){
  try{
    const tid = (ent && ent.teamId) || null;
    if(!tid) return;
    /* AMV-197: the cached plan is written under the team's lock. This runs from
       a payment webhook, so it lands at whatever moment the processor chooses -
       often the same one somebody is joining or leaving in. Written from a copy
       read first, a paid plan can be wiped by a membership change, or a
       membership change wiped by the plan. */
    await _withTeam(env, tid, (team) => {
      if(!team || team.ownerEmail !== String(email||'').toLowerCase()) return;
      team.plan = (ent && ent.plan) || 'free';   /* sold: paired with pastDueSince below */
      if(ent && ent.pastDueSince) team.pastDueSince = ent.pastDueSince; else delete team.pastDueSince;
      team.customCfg = (ent && ent.custom) || null;
    });
  }catch(e){ /* the cache refreshes on the next write; never fail a billing event */ }
}

function _teamSeatLimit(plan, customCfg){
  /* The per-seat plan's limit IS what was bought - it comes from the Stripe
     subscription quantity, not from a table. */
  if(plan === 'team') return _teamSeatCount(customCfg);
  if(plan === 'custom'){
    /* An explicit seat count if one was negotiated, otherwise the seats of the
       tier the price actually reaches. Returning 1 here - which is what an
       unset field used to do - handed a custom Elite-tier customer a team they
       could not put anybody in, while the app told them they had one. */
    if(customCfg && customCfg.seats) return Math.max(1, Math.min(500, +customCfg.seats || 1));
    const rank = _customRank(customCfg);
    return rank >= 3 ? TEAM_SEATS.ultra : rank >= 2 ? TEAM_SEATS.elite : 1;
  }
  return TEAM_SEATS[plan] || 1;
}

async function teamCreate(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const { name } = await request.json().catch(()=>({}));
  /* Creating a team requires the plan that includes it. JOINING one does not -
     the whole point of a seat is that the team pays for the person filling it,
     so a free account invited to an Elite team gets in without buying anything. */
  if(_planRankOf(user.plan, user.customCfg) < _planRankOf(TEAM_MIN_PLAN)){
    return json({ error: 'Team workspaces are included with Elite and above. Upgrade to create one.',
                  code: 'plan_required', requires: TEAM_MIN_PLAN }, 402);
  }
  /* One team per account, because the data model has always assumed one and
     nothing enforced it. `ent.teamId` and `userteam:<email>` are both single
     valued, so a second /team/create repointed them and ABANDONED the first
     team - which kept every member and its cached owner plan.

     That cached plan is the hole. `_refreshTeamPlan` only ever visits the team
     the owner currently points at, so an abandoned team is never refreshed
     again: cancel the subscription, and everyone still in the first team keeps
     an Elite allowance that nobody is paying for, permanently. Creating a
     second team is an ordinary thing to click, so this did not need anybody to
     be trying.

     The other direction is a billing hole too. Somebody who was a MEMBER of a
     team and created their own stopped pointing at the old one while remaining
     in its members array - so its owner went on paying for a seat its holder
     could no longer reach. That is refused rather than papered over: leave the
     team first, which is a route that exists and does the accounting. */
  const priorId = await env.AMV_KV.get(`userteam:${user.email}`);
  if(priorId){
    const prior = await DB.get(env, 'team', priorId);
    if(prior && _role(prior, user.email)){
      if(String(prior.ownerEmail||'').toLowerCase() === String(user.email||'').toLowerCase()){
        return json({ ok:true, existing:true, team: prior,
                      seats:{ used:(prior.members||[]).length,
                              limit:_teamSeatLimit(_teamPlan(prior), prior.customCfg) } });
      }
      return json({ error:'You are already in a team. Leave it before creating your own.',
                    code:'already_in_team' }, 409);
    }
    /* A pointer to a team that is gone, or one they are no longer in, is stale
       and safe to replace. */
  }

  const id = 'team_' + crypto.randomUUID().replace(/-/g,'');
  const team = {
