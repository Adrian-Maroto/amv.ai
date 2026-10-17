/* =====================================================================
   AMV-069: SYNC MUST NOT LOSE CHATS.

   Every list was stored with Object.assign, which REPLACES the whole key. So
   the last device to push won, wholesale. Two ways that silently destroyed
   work:

     - A phone with a stale or partial copy pushes its 3 conversations and the
       laptop's 50 are gone from the server. The laptop then pulls and loses
       them locally too.
     - Two devices used in the same session: A saves a new chat, B pushes 20
       seconds later from a list that predates it, A's chat is erased.

   Conversations are the most valuable thing a user has here, and losing one is
   the kind of failure a product does not recover its reputation from.

   The fix is ordinary optimistic concurrency plus an item-level merge. The
   server keeps a revision; a pull hands it out; a push echoes the revision it
   was working from:

     baseRev === current rev -> that client has seen everything the server has,
       so its lists are authoritative and DELETIONS are honoured.
     baseRev stale or absent -> somebody else wrote in between, so lists are
       merged by id and nothing is dropped. A deleted item can reappear, which
       is a far better failure than a deleted chat that cannot come back.

   Both fields are additive; a record written before this change simply has no
   rev and takes the safe merge path.
   ===================================================================== */
const SYNC_MERGE_KEYS = new Set(['chats','convs','memory','workspaces','prompts','imgs','vids','sessions','skills','handoffs','projects','plugins']);
const _syncId = it => (it && (it.id || it.key || it.name)) || null;
/* Best available "when was this touched". Different lists use different names
   and older records have none at all. */
const _syncStamp = it => (it && (it.updated || it.updatedAt || it.ts || it.added || it.created || it.createdAt)) || 0;
/* How much substance an item carries. Used only to break a tie, and it is what
   stops a TRIMMED upload from erasing a full one: the client sheds the heavy
   `state` blob off older Dev sessions to fit the 4MB cap, so an item whose body
   was dropped must never overwrite the copy that still has it. */
function _syncWeight(it){
  if(!it || typeof it !== 'object') return 0;
  let w = 0;
  if(Array.isArray(it.msgs)) w += it.msgs.length * 10;
  if(it.state) w += 5;
  if(typeof it.text === 'string') w += Math.min(5, it.text.length / 500);
  return w;
}
/* Pick the survivor for one id. Newer wins; on a tie the one carrying more
   content wins, because the alternative is throwing away a user's work. */
function _syncPick(a, b){
  const sa = _syncStamp(a), sb = _syncStamp(b);
  if(sa !== sb) return sa > sb ? a : b;
  const wa = _syncWeight(a), wb = _syncWeight(b);
  if(wa !== wb) return wa > wb ? a : b;
  return b;                                   // same age, same substance: incoming
}
function _mergeSyncList(currentList, incomingList){
  const cur = Array.isArray(currentList) ? currentList : [];
  const inc = Array.isArray(incomingList) ? incomingList : [];
  const byId = new Map();
  const loose = [];                            // items with no id at all
  const add = it => { const id = _syncId(it); if(id == null){ loose.push(it); return; }
    byId.set(id, byId.has(id) ? _syncPick(byId.get(id), it) : it); };
  cur.forEach(add); inc.forEach(add);
  // Newest first, which is the order every one of these lists is displayed in.
  const out = [...byId.values()].sort((x, y) => _syncStamp(y) - _syncStamp(x));
  return out.concat(loose);
}
function _mergeSyncRecord(current, incoming, authoritative){
  const out = Object.assign({}, current);
  for(const k of Object.keys(incoming)){
    const inc = incoming[k];
    if(!authoritative && SYNC_MERGE_KEYS.has(k) && Array.isArray(inc)){
      out[k] = _mergeSyncList(current[k], inc);
    } else {
      out[k] = inc;                            // scalars, and everything when authoritative
    }
  }
  return out;
}
async function syncPush(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  // Sync can be frequent (autosave), so allow a generous minute rate but a
  // sane daily ceiling so a stuck client can't hammer KV writes forever.
  const blocked = await guardAction(env, `sync:${user.email}`, 60, 5000, 'syncs');
  if(blocked) return blocked;
  const body = await request.json().catch(()=>({}));
  const incoming = body.data || {};
  if(typeof incoming !== 'object' || Array.isArray(incoming)) return json({ error:'invalid data' }, 400);
  // Only persist known keys - a client can't bloat its own server record with
  // arbitrary fields (auditor #3: validate + bound what we store).
  const filtered = {};
  for(const k of Object.keys(incoming)){ if(SYNC_ALLOWED_KEYS.has(k)) filtered[k] = incoming[k]; }
  // AMV-056: bound nesting depth so a pathological deeply-nested structure can't
  // blow up parse/serialize (the size cap alone doesn't bound depth).
  if(_boundedJson(filtered, SYNC_MAX_BYTES, 24)){ return json({ error:'synced data is too deeply nested', code:'sync_too_deep' }, 413); }
  const baseRev = +(body.baseRev || 0);

  /* AMV-078: read, merge, then write ONLY IF nothing changed underneath us.
     Another device can land a push between our read and our write, and without
     the guard that device's work is gone. On a miss we go round again against
     the record that actually won - never more than a couple of times, because
     each attempt starts from newer data. */
  let merged = null, curRev = 0, authoritative = false, guarded = true;
  for(let attempt = 0; attempt < 3; attempt++){
    const current = (await DB.get(env, 'data', user.email)) || {};
    curRev = +(current._rev || 0);
    /* Authoritative only when this client demonstrably saw the current version.
       Anything else merges, so a stale device cannot delete another one's work.
       A retry is by definition no longer authoritative: we are now writing on
       top of a version this client has never seen. */
    authoritative = attempt === 0 && (curRev === 0 || baseRev === curRev);
    merged = _mergeSyncRecord(current, filtered, authoritative);
    merged._updatedAt = Date.now();
    merged._rev = curRev + 1;

    // Enforce a real size cap (the comment used to promise this but didn't do it).
    const serialized = JSON.stringify(merged);
    if(serialized.length > SYNC_MAX_BYTES){
      audit(env, 'sync_oversize', { email: user.email, bytes: serialized.length });
      return json({ error: 'Your synced data is too large. Some older items may need pruning.', code: 'sync_too_large' }, 413);
    }

    const res = await DB.putIfRev(env, 'data', user.email, merged, curRev);
    guarded = res.guarded;
    if(res.ok) break;
    audit(env, 'sync_cas_retry', { email: user.email, attempt, curRev });
    if(attempt === 2){
      /* Three losses in a row means something is writing continuously. Better
         to tell this client to pull and try again than to force a write over
         work we have not seen. */
      audit(env, 'sync_cas_gaveup', { email: user.email });
      return json({ error: 'Another device is syncing right now. Your changes are safe here - please try again in a moment.',
                    code: 'sync_busy' }, 409);
    }
  }
  if(!authoritative) audit(env, 'sync_merged', { email: user.email, baseRev, curRev });
  /* TOLD TO THE OPERATOR, ONCE A WEEK, AND TOLD CORRECTLY.

     This used to be reported by every visitor's browser, and the advice it
     carried - "bind DB in wrangler.toml" - is the one step that must NOT be
     taken as it stands: DB.get reads D1 alone the moment a binding exists, so
     every account, plan, wallet and connection still held in KV would read as
     missing. Binding D1 needs a migration first (copy KV into it, and read
     through to KV until the copy is verified). Until then the push merges
     rather than arbitrates, which loses data only if two devices save the
     same record in the same instant. */
  if(!guarded){
    try{ await alertOnce(env, 'sync_unguarded',
      'Sync writes on this deployment are merged, not arbitrated: KV has no conditional write, so two devices saving the '
      + 'same record in the same instant can overwrite each other. The cure is a D1 database - but do NOT just bind one: '
      + 'the moment DB is bound every read goes to D1 alone and every existing account would read as missing. It needs a '
      + 'migration (copy KV into D1, read through to KV until verified) first.', 7 * 24 * 60); }catch(e){}
  }
  // The client stores rev and echoes it next time, so its next push can be
  // authoritative and its deletions can stick.
  return json({ ok:true, rev: merged._rev, merged: !authoritative, guarded, serverTime: Date.now() });
}

/* AMV-006 / AMV-023: ONE PRINCIPAL, BUILT ONE WAY.

   Everything downstream - quotas, dollar ceilings, holds, family limits, team
   billing - reads fields off the object the auth path returns. There were three
   places that built one: the browser session, the API key, and the SMS handler,
   and only the first was complete.

   An API key returned `{ email, plan, customCfg, billing, bonusTokens }`. No
   billingSubject, so a team member's key drew on their own email instead of the
   team's pooled allowance and the team's ceiling never applied to it. No
   `blocked`, so an account suspended for chargebacks could keep spending
   through a key it made earlier. And no `family`, so a child capped at $10 a
   month could create an API key and spend without the cap - the one control a
   parent set, defeated by a button in settings.

   The SMS handler is the same defect with a comment on top. It builds a user by
   hand and passes it to the shared ceiling helper, under a note saying "the
   shared ceiling, so a parent's limit reaches this too". The object has no
   family on it, so the helper could only ever answer with the plan backstop.
   The prose described the intent and the code guaranteed the opposite.

   Neither was a missing idea. Both were a second copy of a resolution that
   already existed, drifting from it. So there is one now, and the three callers
   share it - which is also the only version where adding a fourth field cannot
   reach two paths out of three. */
async function _principalOf(env, email, ent, extra) {
  const em = String(email || '').toLowerCase();
  const e = ent || (await DB.get(env, 'ent', em)) || {};
  const data = Object.assign({ email: em }, extra || {});
  // _planOf, not e.plan: a lapsed subscription must not still buy compute.
  data.plan = _planOf(e);
  data.customCfg = e.custom || null;   // { price, monthTokens, dayTokens, rpm } set at checkout
  data.billing = _billingState(e);
  data.bonusTokens = _bonusTokens(e);  // AMV-075 referral capacity, already expiry-filtered
  /* AMV-100: a team member draws on the TEAM's plan and the TEAM's counters.
     `billingSubject` is what every quota is keyed by from here - see
     _billingSubjectOf for why the plan and the counters must move together. */
  const sub = await _billingSubjectOf(env, em, e);
  data.billingSubject = sub.subject;
  data.plan = sub.plan;
  data.customCfg = sub.customCfg;
  if (sub.teamId) { data.teamId = sub.teamId; data.teamRole = sub.teamRole; data.teamSeated = sub.seated; data.teamEngines = sub.teamEngines || null; }
  data.billingRenewedAt = sub.renewedAt || 0;
  /* Set when an account is blocked for charging back or a refund pattern. It
     rides on the entitlement, which is read here anyway, so every path that
     spends can ask without a second lookup. */
  data.blocked = !!e.blocked;
  data.blockedReason = e.blockedReason || '';
  /* Resolved here so every check downstream reads the same answer, and none of
     them go to storage on their own (AMV-102). */
  data.family = await _familyOf(env, em, e);
  return data;
}

async function requireUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  /* AMV-097: an API key is a credential for the same account, so it resolves
     HERE - which means every quota, cost ceiling, plan check and abuse control
     downstream applies to an API call exactly as it does to a browser one,
     with no second path to keep in step. */
  if (token.startsWith(API_KEY_PREFIX) || request.headers.get('X-AMV-Key')) {
    return await _userFromApiKey(request, env);
  }
  const data = await verifyToken(token, env.JWT_SECRET, env, 'access');
  if (!data) return null;
  /* The token's own claims survive - name, issued-at, whatever else it carries -
     with the account's current state resolved on top. Read fresh every request
     rather than trusted from the token, so a plan change, a block or a new
     family limit takes effect immediately instead of at the next sign-in. */
  return await _principalOf(env, data.email, null, data);
}

/* Resolve the effective limits for a user - custom plans use their purchased
   pool, and any referral bonus is added on top by effectiveLimits() below. */
function _baseLimits(user) {
  /* The per-seat plan's allowance is Pro's, per seat, pooled. Not a fixed pool
     divided among however many people turned up - that version gets worse for
     the customer with every teammate they add, which is the opposite of what a
     seat is supposed to buy. Margin is unaffected because both the pool and the
     dollar ceiling scale with the same seat count. */
  if (user.plan === 'team') {
    const seats = _teamSeatCount(user.customCfg);
    const per = PLAN_LIMITS.pro;
    return {
      dayTokens: per.dayTokens * seats,
      monthTokens: per.monthTokens * seats,
      rpm: per.rpm,                       // per person: this is a burst control, not a pool
      allModels: true,                    // Apex included - it is what the seat price buys
    };
  }
  if (user.plan === 'custom' && user.customCfg) {
    const c = user.customCfg;
    const price = c.price || 30;
    const monthTokens = c.monthTokens || Math.round(300000 * TOKENIZER_SCALE);
    return {
      dayTokens: c.dayTokens || Math.round(50000 * TOKENIZER_SCALE),
      monthTokens,                              // HARD CAP - the profit guarantee
      rpm: c.rpm || 16,
      /* A custom plan sets its own budget, so its message cap follows that
         budget rather than a tier's. Without a number here the message counter
         would have no ceiling to check and the cap would simply not apply -
         which is the quiet way a limit stops existing. */
      monthMessages: c.monthMessages || PLAN_LIMITS.pro.monthMessages,
      /* Same reasoning as the message cap above: a window with no number is a
         window that does not apply, which is the quiet way a limit stops
         existing. A custom plan falls back to the cheapest paid tier's. */
      messages5h: c.messages5h || PLAN_LIMITS.pro.messages5h,
      topMessagesWeek: c.topMessagesWeek || PLAN_LIMITS.pro.topMessagesWeek,
      allModels: true,
    };
  }
  return PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;
}

/* The limits actually enforced: the plan, plus whatever referral capacity the
   account is holding. The bonus lands on the MONTHLY pool only - an invite buys
   more days at full speed and can never become one enormous day of compute -
   and is clamped to the programme ceiling so a corrupted entitlement record
   cannot mint unlimited allowance. */
function effectiveLimits(user) {
  const base = _baseLimits(user);
  const cap = REFERRAL_MAX_CONVERSIONS * REFERRAL_REWARD_TOKENS;
  const bonus = Math.max(0, Math.min(cap, Math.floor(Number((user && user.bonusTokens) || 0)) || 0));
  if (!bonus) return base;
  return Object.assign({}, base, { monthTokens: base.monthTokens + bonus, bonusTokens: bonus });
}


/* ---- WHICH TOOLS ARE ALLOWED THROUGH TO THE MODEL ----------------------

   The rule has always been right: never forward arbitrary client-supplied tool
   definitions upstream. Somebody with a modified client could otherwise ship a
   thousand tools, or one with a megabyte of schema, on every turn - a cost and
   bounds attack paid for by AMV.

   The implementation was wrong in a way nothing could see. It allowed by
   `t.type`, and only 'web_search_20250305' has a type at all. Every one of
   AMV's OWN tools is a custom tool - { name, description, input_schema }, no
   type - so every one of them was silently dropped here, on every turn, since
   the day they were written.

   The effect was invisible from both ends and worse than either. The client
   assembled the tools and believed it had sent them. The system prompt told the
   model "you have real tools: run_code, build_app, crew_add" - and then the
   model was handed none of them, so it could not emit a tool call even when it
   wanted to. A person asking for an app got a sentence about building one.
   Everything in _amvRunTool - real execution, real deploys, real Crew jobs -
   was unreachable in production, while the code for all of it passed review and
   every test that did not go through this function.

   So: named tools are allowed by NAME, from a list kept here, and the shape is
   bounded rather than trusted. A name AMV does not know is still dropped.

   This list is also the thing that has to be edited when a tool is retired.
   Removing image and video generation took generate_image and generate_video
   out of it, and took this whole block with them by accident - the Set went,
   the three bounds went, and _safeTools was left calling a name that no longer
   existed. Nothing that only parses the file could see it: the throw waits
   until the first turn that forwards a tool, which is every real turn. */
const AMV_CLIENT_TOOLS = new Set([
  'run_code', 'fix_code', 'build_app', 'deploy_site',
  'crew_list', 'crew_add', 'crew_update', 'crew_pause', 'crew_resume', 'crew_remove', 'crew_standing',
  'connect_account',
  'crew_ceiling',
  'memory_list', 'memory_add', 'memory_forget',
  'approvals_list', 'approval_act', 'account_status',
  /* Several workers on one task (11c-agentic-chat.js): runs in the browser,
     each worker a normal metered request. */
  'delegate',
  /* THE BRIDGE'S TOOLS, AND THE SAME MISTAKE ONE FLOOR UP.

     The bridge was built end to end - a daemon on somebody's machine, a
     pairing screen, four tools, a runner that executes them - and the tool
     definitions stopped HERE, dropped by name at the last hop before the
     model. Every piece worked and the model was never told the machine
     existed, so it answered "run the tests" with a paragraph about how to
     run them, on a connected computer that was waiting to.

     That is the exact failure the comment above this list describes, found
     again by reading the list again. Nothing executes on the server: these
     run in the person's browser, through their own bridge, in the one
     folder it was started in, behind a confirmation for the two that
     change something. */
  'run_command', 'read_file', 'write_file', 'list_dir',
  /* The screen, through a bridge started with --computer (36b-computer.js). */
  'computer_screenshot', 'computer_click', 'computer_type', 'computer_key', 'computer_scroll',
]);
/* 24 WAS FEWER THAN AMV ITSELF SENDS.

   This said "more than AMV has" and stopped being true without anybody
   noticing: chat with a computer connected sends twenty-four of its own, so
   every tool after the bridge's four was cut - the screen's, and every
   connector's. Somebody with a computer AND Gmail connected had a Gmail
   connector chat could never call, and nothing anywhere said so, because a
   tool that is dropped looks exactly like a model that chose not to use it.

   The bound that matters to AMV's bill is the SIZE of what is sent, so that
   is bounded directly now (TOOLS_TOTAL_MAX), and the count is a backstop well
   above anything real. AMV's own tools come first in every list the client
   builds, so anything over the budget is a connector's, never AMV's. */
const TOOLS_MAX          = 128;
const TOOLS_TOTAL_MAX    = 240000;  // characters of description + schema across every tool, ~60k tokens
const TOOL_DESC_MAX      = 1200;    // a description, not a second prompt
const TOOL_SCHEMA_MAX    = 4000;    // a schema, not a payload

function _safeTools(list) {
  const out = [];
  let total = 0;
  for (const t of list) {
    if (!t || out.length >= TOOLS_MAX) break;
    /* Server-side tools, identified by type. max_uses is clamped because the
       client asks for research depth and a tampered one must not be able to
       request ten thousand searches. 60 is the ceiling even for the deepest
       research tier. */
    if (t.type === 'web_search_20250305') {
      const n = parseInt(t.max_uses, 10);
      out.push(t.max_uses == null ? t : { ...t, max_uses: Math.max(1, Math.min(60, isNaN(n) ? 5 : n)) });
      continue;
    }
    if (t.type) continue;                         // an unknown server-side tool
    /* AMV's own tools. Allowed by name, and only in a bounded shape - the
       definition still comes from the client, so it is trimmed rather than
       trusted. It only ever steers that user's own turn, which they pay for,
       and nothing here executes: the work happens in their browser, behind
       their own approval. */
    const name = String(t.name || '');
    /* MCP TOOLS CANNOT BE ON A LIST, AND DO NOT NEED TO BE.

       A connector's tools are named by whoever wrote that server; there is
       no build-time list to check them against, and there never will be.
       So they are admitted by SHAPE - `mcp__<server>__<tool>`, bounded
       characters, bounded length - rather than by name.

       That is not a hole, because of what this allowlist is actually for.
       Nothing here executes: the work happens in the caller's own browser,
       through their own bridge, behind their own consent. What the list
       prevents is a modified client shipping a thousand definitions or a
       megabyte of schema at AMV's expense - and TOOLS_MAX, TOOL_DESC_MAX
       and TOOL_SCHEMA_MAX below still enforce every bit of that, on these
       exactly as on the rest.

       What the name list DOES buy for AMV's own tools is the wiring check:
       a tool the client ships and the server has never heard of is a
       feature silently doing nothing, which is how the whole tool system
       was dead once and the bridge was dead again. That check is only
       possible for names known at build time, so it keeps applying to
       those, and a shape check applies to the ones that cannot be. */
    const isMcp = /^mcp__[a-z0-9_-]{1,40}__[A-Za-z0-9_-]{1,60}$/.test(name);
    if (!isMcp && !AMV_CLIENT_TOOLS.has(name)) continue;
    const schema = (t.input_schema && typeof t.input_schema === 'object') ? t.input_schema : { type: 'object', properties: {} };
    let schemaStr = '';
    try { schemaStr = JSON.stringify(schema); } catch (e) { continue; }
    if (schemaStr.length > TOOL_SCHEMA_MAX) continue;
    const description = String(t.description || '').slice(0, TOOL_DESC_MAX);
    if (total + description.length + schemaStr.length > TOOLS_TOTAL_MAX) continue;
    total += description.length + schemaStr.length;
    out.push({ name, description, input_schema: schema });
  }
  return out;
}

/* ---- PAYMENTS THAT SUCCEEDED AND WERE NEVER FINISHED --------------------

   Granting a plan depends on one webhook arriving. Revocation was made not to
   depend on that, because an unrevoked plan costs AMV money - but the mirror
   case costs a CUSTOMER money, and nothing was watching it at all. A dropped
   delivery, a deploy during the retry window, a misconfigured endpoint, and
   somebody has paid and has nothing. They do not file a bug; they charge it
   back and leave.

   So every payment that is started writes a small pending record, every
   webhook that completes one deletes it, and anything still sitting here after
   a few minutes gets asked about DIRECTLY at the provider. Paid means finish
   it; not paid means drop it. Either way somebody is told when a payment had to
   be rescued, because that is a signal the webhook path is broken and the next
   one will need rescuing too.

   All three ways money enters AMV are covered - a plan by card, a marketplace
   purchase, and a PayPal subscription. Covering one of them would leave exactly
   the same hole with a different name on it. */
/* AMV-009: how long a remembered checkout session is handed back instead of a
   new one. Stripe's own sessions expire after 24 hours, so a note that outlived
   that would send somebody to a dead page; one much shorter would let a
   double-click through. */
const MARKET_SESSION_TTL_S = 23 * 3600;
/* And how long a one-of-a-kind listing is held for the buyer who is at its
   checkout. Long enough to finish paying, short enough that an abandoned
   checkout does not take the item off the market for a day. */
const MARKET_RESERVE_S = 20 * 60;

const PEND_KIND = 'paypending';
const PEND_GRACE_MS = 10 * 60 * 1000;      // give the webhook a fair chance first
/* HOW LONG A PAYMENT CAN STILL BE ON ITS WAY.

   This was 24 hours, under a comment saying "an unpaid session is never coming
   back". That was true when the only way to pay was a card, where the answer
   arrives in seconds. It stopped being true when automatic_payment_methods was
   switched on: an OXXO voucher is cash at a shop counter and the customer has
   three days, and SEPA Direct Debit can take up to fourteen and can still come
   back failed.

   This window is the safety net for a webhook that never arrived. Set shorter
   than the payment method takes, it drops the row while the money is still
   genuinely in flight - so somebody pays, the async event goes missing, and
   nothing is left watching on AMV's side. They are charged and never get the
   plan, which is the one outcome worse than not being paid.

   Sixteen days: fourteen for the slowest method Stripe will hand us, plus room
   for a weekend and a settlement delay. A row that really is dead costs one
   provider lookup per sweep until then, which is the cheap side of this trade. */
const PEND_GIVEUP_MS = 16 * 24 * 60 * 60 * 1000;
/* One provider lookup per pending row, so this pass gets its own budget. It
   shares a tick with the rest of the cron work, so it takes a smaller slice. */
const RECONCILE_BUDGET_MS = 15 * 1000;

/* Whether a Stripe Checkout Session has actually been paid for.

   The one question worth asking before anything is granted, and it was being
   asked as `payment_status === 'paid' || status === 'complete'`, which answers
   yes to a session that is complete and unpaid - the exact shape a voucher or a
   direct debit has for its first three to fourteen days.

   'no_payment_required' is a yes: that is a full-coupon or trial session where
   Stripe is telling us there is no money to wait for. Anything else - and
   notably 'unpaid' - is not fulfilled yet. Missing is not a yes either: an
   object that does not say it was paid has not said it was paid.

   Being strict about a missing field is only safe because of what happens next,
   and it is worth writing down. A session this refuses stays in the pending
   ledger, and the reconciliation sweep asks Stripe about it directly - and the
   API object always carries payment_status. So a webhook payload that somehow
   arrived without the field is granted by the sweep minutes later rather than
   lost. Strict here, self-healing there: the failure mode of being wrong about
   this is a delay, not a customer who paid and got nothing.

   Three test fixtures omitted the field, which is how this was noticed - a
   double that is more permissive than the thing it stands for is the same
   defect class as the one this function exists to close. */
function _stripeSessionPaid(session) {
  const s = String((session && session.payment_status) || '');
  return s === 'paid' || s === 'no_payment_required';
}

async function _pendStart(env, id, data) {
  if (!id) return;
  try { await DB.put(env, PEND_KIND, String(id), Object.assign({ at: Date.now() }, data || {})); } catch (e) {}
}
async function _pendDone(env, id) {
  if (!id) return;
  try { await DB.del(env, PEND_KIND, String(id)); } catch (e) {}
}

async function reconcilePayments(env) {
  let checked = 0, rescued = 0, dropped = 0;
  let rows = [];
  /* NOTHING PENDING IS THE NORMAL CASE, AND IT WAS THE EXPENSIVE ONE.

     The comment below is about how much is read once a scan starts. It is not
     about whether to start one, and this ran on all 288 ticks of the day
     whether or not a single payment was outstanding - one list operation each
     time, because a list costs the same for no rows as for a thousand.

     The marker is written only by a completed scan that found nothing and is
     dropped by the write that records a pending payment, so a checkout that
     starts between two ticks is picked up by the next one. Unlike the
     automations tick there is no separate hourly sweep here, so the marker's
     own sub-hour trust window IS the re-verification: worst case a charge
     waits under an hour longer for the last-line rescue, against a grace
     period measured in days before the reconciler will act on it at all. */
  if (await _kindKnownEmpty(env, PEND_KIND)) return { checked, rescued, dropped, idle: true };
  /* No practical ceiling. A pending payment is somebody who has been CHARGED
     and is waiting to be given what they paid for; capping this at 200 meant
     that during the exact incident this exists for - a webhook outage, where
     hundreds pile up at once - the ones past the cap were the ones never
     rescued. The reconciler is the last line, so it reads all of them. */
  try { rows = (await scan(env, PEND_KIND, SCAN_ALL, 'payment reconciliation')).rows; }
  catch (e) { return { checked, rescued, dropped }; }
  const now = Date.now();
  const started = Date.now();

  /* Oldest charge first, and a budget. One provider lookup per row means a
     large pile cannot be worked through in a single tick - but a resolved row
     is DELETED, so the list drains from the front and whatever is left over is
     older than everything just handled, which puts it first next time. The
     person who has been waiting longest for what they paid for is served
     first, and nobody is stuck behind a permanently unreachable row. */
  rows.sort((a, b) => ((a.value || {}).at || 0) - ((b.value || {}).at || 0));

  let seen = 0;
  for (const row of rows) {
    if (Date.now() - started > RECONCILE_BUDGET_MS) {
      audit(env, 'reconcile_deferred', { checked, rescued, dropped, remaining: rows.length - seen });
      break;
    }
    seen++;
    const p = row.value || {};
    const age = now - (p.at || 0);
    if (age < PEND_GRACE_MS) continue;             // the webhook may still be on its way
    checked++;

    if (age > PEND_GIVEUP_MS) { await _pendDone(env, row.id); dropped++; continue; }

    try {
      if (p.provider === 'paypal') {
        const token = await _paypalToken(env);
        if (!token) continue;                       // cannot ask right now; try next sweep
        const r = await fetchDeadline(`${_paypalBase(env)}/v1/billing/subscriptions/${encodeURIComponent(row.id)}`, {
          headers: { 'Authorization': `Bearer ${token}` } });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) continue;
        if (d.status === 'ACTIVE') {
          const tier = _paypalTierOf(env, d.plan_id, p.plan);
          if (tier) {
            await setEntitlement(env, p.email, tier, { source: 'paypal' });
            rescued++;
            audit(env, 'payment_reconciled', { provider: 'paypal', email: p.email, plan: tier });
            await alertOnce(env, 'pay_reconciled',
              'A PayPal subscription was ACTIVE but had never been granted - AMV has just granted it from the reconciliation sweep. '
              + 'The webhook for it did not arrive or did not process. Check the PayPal webhook endpoint.', 60);
          }
          await _pendDone(env, row.id);
        } else if (d.status === 'CANCELLED' || d.status === 'EXPIRED' || d.status === 'SUSPENDED') {
          await _pendDone(env, row.id); dropped++;
        }
        continue;
      }

      /* Stripe: a checkout session, either a plan or a marketplace purchase. */
      if (!env.STRIPE_SECRET_KEY) continue;
      const r = await fetchDeadline(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(row.id)}`, {
        headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) continue;

      /* `d.payment_status === 'paid' || d.status === 'complete'` was the same
         defect as the webhook's, in an or: a session paid by voucher or direct
         debit is 'complete' the moment the customer chooses it and 'unpaid'
         until the money actually arrives, so the second half of that condition
         granted on the first half being false. The sweep exists to rescue
         payments the webhook missed - it must not rescue payments that have not
         happened. An unpaid row is left alone and asked about again next sweep,
         which is exactly what it is for. */
      if (_stripeSessionPaid(d)) {
        if (p.kind === 'market') {
          await _creditSale(env, { itemId: p.itemId, buyer: p.email, seller: p.seller,
                                   amountCents: d.amount_total, ref: d.payment_intent || row.id });
        } else if (p.kind === 'credit') {
          await _creditGrant(env, { subject: p.subject || p.email, email: p.email,
                                    usd: Math.round(+d.amount_total || 0) / 100, ref: d.payment_intent || row.id });
        } else if (p.plan) {
          await setEntitlement(env, p.email, p.plan, { source: 'stripe' });
        }
        rescued++;
        audit(env, 'payment_reconciled', { provider: 'stripe', email: p.email, kind: p.kind || 'plan', plan: p.plan || '' });
        await alertOnce(env, 'pay_reconciled',
          'A Stripe payment had completed but was never applied - AMV has just applied it from the reconciliation sweep. '
          + 'The webhook did not arrive or did not process, so check the Stripe webhook endpoint and its signing secret.', 60);
        await _pendDone(env, row.id);
      } else if (d.status === 'expired') {
        await _pendDone(env, row.id); dropped++;
      }
    } catch (e) { /* a provider being unreachable is not a decision - try again next sweep */ }
  }
  if (checked) console.log('[cron] payments reconciled', JSON.stringify({ checked, rescued, dropped }));
  return { checked, rescued, dropped };
}

/* ---------------- THE AI PROXY (the heart) -------------------------- */
/* GET /v1/engines - what can answer right now: the primary engines, and the
   partner engines whose models the partner confirms. AMV names only; a
   partner's own model id never leaves the server. Public - it says what the
   product offers, nothing about who is asking. */
async function enginesList(request, env) {
  const primary = Object.entries(ENGINES).map(([key, e]) => ({ key, minPlan: e.minPlan }));
  const partners = (await _partnerEngines(env)).map(d => ({ key: d.key, label: d.label, minPlan: d.minPlan, partner: true }));
  return json({ ok: true, engines: primary.concat(partners) });
}

