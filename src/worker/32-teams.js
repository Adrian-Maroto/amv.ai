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
  /* ONE CREATION AT A TIME PER PERSON. Everything below reads "no team yet"
     and then makes one, so a double-click made two - the second pointer won
     and the first team was left holding the owner's cached plan with nobody
     able to reach it: the abandoned-team hole above, without anybody trying.
     A second create while one is in flight is told so; asked again a moment
     later, it gets the team the first one made. */
  if(!(await _claimOnce(env, 'teamnew', String(user.email).toLowerCase(), 30)))
    return json({ error:'Your team is already being created. Give it a moment.', code:'in_progress' }, 409);
  try {
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
    id, name: name||'My Team', ownerEmail: user.email,
    members: [{ email:user.email, role:'owner', joinedAt:Date.now() }],
    createdAt: Date.now(), data:{}
  };
  /* The owner's plan is cached on the team so a member's request costs ONE
     extra read rather than two. Every billing event refreshes it, and the
     lapse marker rides along so `_teamPlan` can honour a grace window that
     expires with no write at all. */
  const ownerEnt = (await DB.get(env, 'ent', user.email)) || { plan: 'free' };
  team.plan = ownerEnt.plan || 'free';   /* sold: the lapse rides alongside and _teamPlan applies it at read */
  /* The owner's renewal anniversary, cached with the plan it belongs to, so a
     seat's allowance window is the one the team is actually billed on. */
  team.renewedAt = +ownerEnt.renewedAt || 0;
  if(ownerEnt.pastDueSince) team.pastDueSince = ownerEnt.pastDueSince;
  team.customCfg = ownerEnt.custom || null;
  /* AMV-034: the same three writes, and the same compensation. A team record
     with no pointer at it is invisible to its own owner - they cannot open it,
     and `teamCreate` will happily make them another - while the first one keeps
     whatever plan was cached on it. Deleting it is safe here in a way it never
     is later: it has exactly one member, who is the person standing in front of
     this failure. */
  await DB.put(env, 'team', id, team);
  try {
    await env.AMV_KV.put(`userteam:${user.email}`, id);
    await _setUserTeam(env, user.email, id);
  } catch (e) {
    try { await DB.del(env, 'team', id); } catch (_) {}
    audit(env, 'team_create_rolled_back', { team: id, email: user.email });
    return json({ error: 'AMV could not finish creating the team. Nothing was changed - please try again.',
                  code: 'create_incomplete' }, 503);
  }
  await _teamAudit(env, team, user.email, 'team_created', { name: team.name });
  return json({ ok:true, team, seats: { used: 1, limit: _teamSeatLimit(_teamPlan(team), team.customCfg) } });
  } finally { await _releaseClaim(env, 'teamnew', String(user.email).toLowerCase()); }
}
async function teamGet(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const tid = await env.AMV_KV.get(`userteam:${user.email}`);
  if(!tid) return json({ ok:true, team:null });
  const team = await DB.get(env, 'team', tid);
  if(!team || !_role(team, user.email)) return json({ ok:true, team:null });
  /* Seats travel with the team record so the app never has to guess which
     members the plan is currently covering (AMV-100). */
  const limit = _teamSeatLimit(_teamPlan(team), team.customCfg);
  const seated = new Set(_teamSeated(team).map(m => m.email));
  const out = Object.assign({}, team, {
    members: (team.members||[]).map(m => Object.assign({}, m, { seated: seated.has(m.email) })),
    seats: { used: (team.members||[]).length, limit, over: Math.max(0, (team.members||[]).length - limit) },
  });
  return json({ ok:true, team: out });
}
async function _teamOf(env, email){
  const tid = await env.AMV_KV.get(`userteam:${email}`);
  if(!tid) return null;
  const team = await DB.get(env, 'team', tid);
  // Membership is the source of truth. A stale or tampered userteam pointer must
  // NOT grant access to a team the caller is no longer an active member of.
  if(!team || !_role(team, email)) return null;
  return team;
}
function _role(team, email){ const m=(team.members||[]).find(x=>x.email===email); return m?m.role:null; }
/* Reject an oversized or too-deeply-nested JSON payload so a member can't amplify
   storage or make a shared record fail to parse/write. Returns an error string or
   null when the value is within bounds. */
function _boundedJson(obj, maxBytes, maxDepth){
  let s; try{ s = JSON.stringify(obj); }catch{ return 'invalid data'; }
  if(s == null) return 'invalid data';
  if(new TextEncoder().encode(s).length > maxBytes) return 'data too large';
  const depth = (o, d)=>{
    if(d > maxDepth) return d;
    if(o && typeof o === 'object'){
      let mx = d;
      for(const k in o){ mx = Math.max(mx, depth(o[k], d+1)); if(mx > maxDepth) return mx; }
      return mx;
    }
    return d;
  };
  if(depth(obj, 0) > maxDepth) return 'data nesting too deep';
  return null;
}

