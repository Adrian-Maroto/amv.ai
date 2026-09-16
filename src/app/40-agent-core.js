/* ══════════════════════════════════════════════════════════════════════════
   THE TRUST PLANE

   AMV already asks for approval in 425 places, verifies outcomes in 397, and
   writes audit in 385. All of that is correct and none of it is a PLANE: the
   rule lives wherever somebody remembered to write it, which means the next
   surface is one forgotten `if` away from acting without permission.

   This module is the one place that answers "may this happen". It holds four
   things and no more:

     1. a canonical event, so every connector speaks one language
     2. a risk class and an autonomy level, so "how bad" and "how far am I
        allowed" are separate numbers instead of one vague feeling
     3. an action contract, so a proposal is a typed object rather than a
        sentence
     4. a deterministic policy decision over the three

   NO MODEL IS CALLED FROM ANY FUNCTION IN THIS FILE, and none may ever be. A
   model proposes; this decides. That separation is the whole point: an email
   can talk a language model into almost anything, and it cannot talk a
   comparison out of its answer.

   Everything here is pure - no network, no storage, no DOM. That is what makes
   it testable against the adversarial cases that matter.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── RISK ─────────────────────────────────────────────────────────────────
   What the action could cost if it is wrong. Independent of who asked. */
const AMV_RISK = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'];
const AMV_RISK_MEANING = {
  R0: 'read, organise, categorise or summarise',
  R1: 'a reversible private action - a draft, a label, a task, a note',
  R2: 'an external communication or a scheduling change',
  R3: 'a purchase, booking, cancellation or meaningful account change',
  R4: 'money movement, trading, legal, medical, employment, identity or government submission',
  R5: 'prohibited by law, policy, consent or platform rules',
};
const _riskRank = (r) => { const i = AMV_RISK.indexOf(String(r)); return i < 0 ? 5 : i; };

/* ── AUTONOMY ─────────────────────────────────────────────────────────────
   How far the user has let the agent go. There is no level 7; unrestricted
   autonomy is not a decision that is available to make. */
const AMV_AUTONOMY = {
  OFF: 0, OBSERVE: 1, NOTIFY: 2, RECOMMEND: 3, PREPARE: 4, ASK_AND_ACT: 5, BOUNDED: 6,
};

/* The highest risk each level can reach ON ITS OWN, with nobody asked.
   R2 and above never appear here: an external effect always needs either an
   approval or a rule the user wrote, which is checked separately below. */
const _AUTONOMY_SILENT_CEILING = {
  0: -1,   /* off - not even a read */
  1: 0,    /* observe - R0 only */
  2: 0,
  3: 0,
  4: 1,    /* prepare - may create a reversible private draft */
  5: 1,    /* ask and act - anything beyond R1 goes to approval */
  6: 3,    /* bounded - up to R3, and ONLY inside a user-written rule */
};

/* R4 and R5 are unreachable by every level, deliberately. R4 is defined so the
   engine can refuse it; no tool that performs one is being added. */
const _NEVER_AUTOMATIC = 4;

/* ── TRUST ────────────────────────────────────────────────────────────────
   Where a piece of content came from, and therefore what it is allowed to be.
   `untrusted` is anything a stranger can write into: an email body, a web
   page, a file, a calendar description, a connector response, an MCP tool
   result. It is evidence. It is never instruction. */
const AMV_TRUST = ['system', 'user', 'connector', 'untrusted'];

/* ── CANONICAL EVENT ──────────────────────────────────────────────────────
   One shape for every source, so a workflow is written once and a new
   connector adds a translator rather than a special case. */
const _EVENT_REQUIRED = ['tenant_id', 'user_id', 'home_region', 'source_connector', 'event_type'];

function amvCanonicalEvent(input) {
  const e = input || {};
  const missing = _EVENT_REQUIRED.filter(k => !e[k]);
  if (missing.length) throw new Error('canonical event missing: ' + missing.join(', '));

  const trust = AMV_TRUST.includes(e.trust_level) ? e.trust_level : 'untrusted';
  const occurred = Number(e.occurred_at) || Date.now();
  return {
    schema_version: 1,
    event_id: String(e.event_id || _amvId('ev')),
    tenant_id: String(e.tenant_id),
    user_id: String(e.user_id),
    home_region: String(e.home_region),
    source_connector: String(e.source_connector),
    source_account: e.source_account ? String(e.source_account) : '',
    source_event_id: e.source_event_id ? String(e.source_event_id) : '',
    event_type: String(e.event_type),
    event_subtype: e.event_subtype ? String(e.event_subtype) : '',
    occurred_at: occurred,
    received_at: Number(e.received_at) || Date.now(),
    actor: e.actor ? String(e.actor) : '',
    summary: e.summary ? String(e.summary) : '',
    correlation_keys: Array.isArray(e.correlation_keys) ? e.correlation_keys.map(String) : [],
    /* Default untrusted, not trusted. A connector that forgets to say where
       content came from gets the safe answer rather than the convenient one. */
    trust_level: trust,
    sensitivity_class: e.sensitivity_class ? String(e.sensitivity_class) : 'normal',
    deduplication_key: String(e.deduplication_key || amvDedupKey(e)),
    expiration: Number(e.expiration) || 0,
    metadata: (e.metadata && typeof e.metadata === 'object') ? e.metadata : {},
  };
}

/* DEDUPLICATION.

   Derived from the connector, the source's own id and the FACT - never from
   arrival time, which differs on every redelivery and would make a duplicate
   look new. The reconciliation pass must produce the same key as the webhook
   path for the same fact, or a backfill duplicates everything that already
   arrived live. */
function amvDedupKey(e) {
  const o = e || {};
  return _amvHash([
    o.source_connector || '', o.source_account || '',
    o.source_event_id || '', o.event_type || '',
    /* occurred_at, not received_at - see above. */
    String(Number(o.occurred_at) || 0),
  ].join('\0'));
}

/* ── IDEMPOTENCY ──────────────────────────────────────────────────────────
   The brief forbids claiming exactly-once external execution, and it is right
   to: the network can always drop the acknowledgement of a send that happened.
   Effectively-once is what is achievable - the same key, a stored outcome, and
   an independent verification afterwards.

   The key covers WHO, WHAT and WITH WHICH ARGUMENTS. Two different users doing
   the same thing are two actions; the same user retrying one is one. */
function amvIdempotencyKey(userId, tool, args, bucket) {
  return _amvHash([
    String(userId || ''), String(tool || ''),
    _amvStable(args || {}),
    String(bucket || ''),
  ].join('\0'));
}

/* Argument order must not change the key, or a retry that serialises its
   object differently looks like a new action and sends a second email. */
function _amvStable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(_amvStable).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + _amvStable(v[k])).join(',') + '}';
}

function _amvHash(s) {
  /* FNV-1a. Not a security hash and never used as one - this is a bucket label
     for deduplication, where a collision costs one merged duplicate and an
     attacker gains nothing by forcing one. */
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8) + '-' + ('0000' + (str.length & 0xffff).toString(16)).slice(-4);
}

function _amvId(p) {
  const r = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID()
          : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  return String(p || 'id') + '_' + r;
}

/* ── ACTION CONTRACT ──────────────────────────────────────────────────────
   What a model is allowed to hand back: a typed proposal, not a sentence. An
   invalid contract is a DENIAL rather than a best-effort execution, because
   "the model nearly said something valid" is not a basis for sending email. */
const _ACTION_REQUIRED = ['goal', 'tool', 'required_scope', 'risk_class'];

function amvActionContract(input) {
  const a = input || {};
  const missing = _ACTION_REQUIRED.filter(k => !a[k]);
  if (missing.length) throw new Error('action contract missing: ' + missing.join(', '));
  if (!AMV_RISK.includes(String(a.risk_class))) throw new Error('unknown risk class: ' + a.risk_class);

  const args = (a.arguments && typeof a.arguments === 'object') ? a.arguments : {};
  return {
    action_id: String(a.action_id || _amvId('act')),
    goal: String(a.goal),
    tool: String(a.tool),
    arguments: args,
    evidence_event_ids: Array.isArray(a.evidence_event_ids) ? a.evidence_event_ids.map(String) : [],
    required_scope: String(a.required_scope),
    risk_class: String(a.risk_class),
    confidence: Math.max(0, Math.min(1, Number(a.confidence) || 0)),
    reversible: a.reversible === true,
    preconditions: Array.isArray(a.preconditions) ? a.preconditions.map(String) : [],
    idempotency_key: String(a.idempotency_key || amvIdempotencyKey(a.user_id, a.tool, args, a.goal)),
    expires_at: Number(a.expires_at) || 0,
    verification: (a.verification && typeof a.verification === 'object') ? a.verification : null,
    compensation: (a.compensation && typeof a.compensation === 'object') ? a.compensation : null,
    user_visible_summary: String(a.user_visible_summary || a.goal),
  };
}

/* ── THE POLICY ENGINE ────────────────────────────────────────────────────
   Deterministic. No model call, no network, no clock beyond the one passed in.

   Layers, strictest first. A lower layer can never widen what a higher one
   restricted - the user cannot grant themselves what the platform forbids, and
   an automation cannot grant itself what the user did not.

       1 law and platform safety      (never overridable)
       2 region
       3 organisation
       4 household
       5 user
       6 automation rule
       7 model recommendation         (advisory only, never authority)

   Returns a decision and the reasons for it. The reasons are the point: an
   approval screen that cannot say why is one people click through. */
const AMV_DECISION = {
  ALLOW: 'ALLOW',
  DENY: 'DENY',
  REQUIRE_APPROVAL: 'REQUIRE_APPROVAL',
  REQUIRE_STEP_UP: 'REQUIRE_STEP_UP',
};
const AMV_POLICY_VERSION = 1;

function amvPolicyEvaluate(contract, ctx) {
  const c = contract || {};
  const x = ctx || {};
  const reasons = [];
  const deny = (code, msg) => ({
    decision: AMV_DECISION.DENY, reasons: reasons.concat([{ code, message: msg }]),
    policy_version: AMV_POLICY_VERSION, risk_class: c.risk_class || 'R5',
  });
  const need = (d, code, msg) => ({
    decision: d, reasons: reasons.concat([{ code, message: msg }]),
    policy_version: AMV_POLICY_VERSION, risk_class: c.risk_class,
  });

  /* LAYER 1 - law and platform safety. Nothing below can reach past this. */
  if (!AMV_RISK.includes(String(c.risk_class))) return deny('bad_contract', 'The action has no valid risk class.');
  if (c.risk_class === 'R5') return deny('prohibited', 'This class of action is never permitted.');
  if (!c.tool) return deny('bad_contract', 'The action names no tool.');
  if (!c.required_scope) return deny('bad_contract', 'The action declares no permission scope.');

  /* The killswitch and the user's own pause are both absolute. */
  if (x.platform_paused) return deny('platform_paused', 'AMV is paused for everyone right now.');
  if (x.user_paused) return deny('user_paused', 'You have autonomy paused.');

  /* An expired approval is a denial, not a warning. Silence is never consent. */
  if (c.expires_at && x.now && c.expires_at < x.now)
    return deny('expired', 'This proposal expired before it could run.');

  /* LAYER 2-5 - region, organisation, household, user. Each may only narrow.
     Evaluated as a ceiling: the strictest wins, whoever set it. */
  const ceilings = [
    ['region', x.region_max_risk], ['organisation', x.org_max_risk],
    ['household', x.household_max_risk], ['user', x.user_max_risk],
  ];
  for (const [who, cap] of ceilings) {
    if (cap && _riskRank(c.risk_class) > _riskRank(cap))
      return deny(who + '_ceiling', 'Your ' + who + ' settings do not allow ' + AMV_RISK_MEANING[c.risk_class] + '.');
  }

  /* The scope has to have actually been granted. Not "the connector could do
     this" - "the user said yes to this". */
  const granted = Array.isArray(x.granted_scopes) ? x.granted_scopes : [];
  if (!granted.includes(c.required_scope))
    return deny('scope', 'You have not granted the permission this needs (' + c.required_scope + ').');

  /* R4 is never automatic and never approved by a rule. Strong auth, every
     time, and the engine says so rather than silently downgrading. */
  if (_riskRank(c.risk_class) >= _NEVER_AUTOMATIC) {
    if (!x.step_up_verified) return need(AMV_DECISION.REQUIRE_STEP_UP, 'step_up',
      'This is ' + AMV_RISK_MEANING[c.risk_class] + '. It needs you to confirm your identity first.');
    return need(AMV_DECISION.REQUIRE_APPROVAL, 'high_risk',
      'This is ' + AMV_RISK_MEANING[c.risk_class] + ' and always needs your approval.');
  }

  /* LAYER 6 - the automation rule, if the user wrote one. Bounded autonomy is
     the ONLY route to acting on R2/R3 without asking, and every bound is
     checked. A rule that has run out of budget is not a rule any more. */
  const lvl = Number(x.autonomy_level);
  const level = Number.isFinite(lvl) ? lvl : AMV_AUTONOMY.NOTIFY;
  if (level <= AMV_AUTONOMY.OFF) return deny('autonomy_off', 'Autonomy is switched off.');

  const rule = x.rule || null;
  if (level >= AMV_AUTONOMY.BOUNDED && rule) {
    const bad = _amvRuleBreach(c, rule, x);
    if (bad) {
      reasons.push({ code: 'rule_breach', message: bad });
      return need(AMV_DECISION.REQUIRE_APPROVAL, 'rule_breach', bad);
    }
    if (_riskRank(c.risk_class) <= _riskRank(rule.max_risk || 'R1'))
      return { decision: AMV_DECISION.ALLOW,
               reasons: reasons.concat([{ code: 'bounded_rule', message: 'Inside the rule you set: ' + (rule.name || rule.id || 'your rule') + '.' }]),
               policy_version: AMV_POLICY_VERSION, risk_class: c.risk_class };
  }

  /* No rule. The silent ceiling for this autonomy level decides whether this
     can happen quietly or has to be asked about. */
  const ceiling = _AUTONOMY_SILENT_CEILING[level];
  if (ceiling < 0) return deny('autonomy_off', 'Autonomy is switched off.');

  if (_riskRank(c.risk_class) <= ceiling) {
    /* R1 is only silent when it really is reversible. A "draft" that cannot be
       unmade is not a draft. */
    if (c.risk_class === 'R1' && !c.reversible)
      return need(AMV_DECISION.REQUIRE_APPROVAL, 'not_reversible',
        'This cannot be undone, so it needs your approval even though it is private.');
    return { decision: AMV_DECISION.ALLOW,
             reasons: reasons.concat([{ code: 'within_autonomy', message: 'Allowed at your current autonomy level.' }]),
             policy_version: AMV_POLICY_VERSION, risk_class: c.risk_class };
  }

  return need(AMV_DECISION.REQUIRE_APPROVAL, 'needs_approval',
    'This is ' + AMV_RISK_MEANING[c.risk_class] + ', so it needs your approval.');
}

/* Every bound on a user-written rule, checked. Returns the reason it does not
   apply, or '' when the action is genuinely inside it. */
function _amvRuleBreach(c, rule, x) {
  const r = rule || {};
  if (r.tools && Array.isArray(r.tools) && !r.tools.includes(c.tool))
    return 'Your rule does not cover ' + c.tool + '.';

  /* Recipients and destinations are an allowlist, never a guess. Substituting
     a similar address is how an agent emails the wrong person. */
  const dest = c.arguments && (c.arguments.to || c.arguments.recipient || c.arguments.destination);
  if (r.allowed_destinations && Array.isArray(r.allowed_destinations) && dest) {
    const list = r.allowed_destinations.map(s => String(s).toLowerCase());
    if (!list.includes(String(dest).toLowerCase()))
      return 'Your rule does not list ' + dest + ' as somewhere I may send this.';
  }

  const amount = Number(c.arguments && (c.arguments.amount || c.arguments.total));
  if (Number.isFinite(amount) && amount > 0 && Number.isFinite(Number(r.max_amount)) && amount > Number(r.max_amount))
    return 'That is over the ' + r.max_amount + ' limit you set on this rule.';

  if (Number.isFinite(Number(r.max_runs)) && Number(x.runs_used || 0) >= Number(r.max_runs))
    return 'Your rule has already run its ' + r.max_runs + ' times for this period.';

  if (r.expires_at && x.now && Number(r.expires_at) < Number(x.now))
    return 'Your rule expired.';

  /* Quiet hours defer, they do not cancel - except where the user said an
     urgent deadline may still come through. */
  if (x.in_quiet_hours && !r.quiet_hours_override)
    return 'It is your quiet hours, so I held this rather than acting.';

  return '';
}

/* ── UNTRUSTED CONTENT ────────────────────────────────────────────────────
   The single most important rule in the product, in one function: content that
   arrived from outside may inform a decision and may never make one.

   This is not a prompt instruction. It is a gate the proposal passes through
   after the model has spoken, so an email that talks the model into proposing
   something still has to get past code that never read the email. */
function amvEvidenceIsSafe(events, contract) {
  const evs = Array.isArray(events) ? events : [];
  const c = contract || {};
  const untrusted = evs.filter(e => e && e.trust_level === 'untrusted');
  if (!untrusted.length) return { safe: true, reasons: [] };

  const reasons = [];
  /* An action whose ONLY support is untrusted content, and which has an effect
     outside AMV, is exactly the shape of a successful injection. */
  if (_riskRank(c.risk_class) >= _riskRank('R2') && untrusted.length === evs.length)
    reasons.push('Everything supporting this came from content someone else wrote.');

  /* A destination that appears nowhere except inside untrusted content is a
     destination the user never chose. */
  const dest = c.arguments && (c.arguments.to || c.arguments.recipient || c.arguments.destination);
  if (dest && evs.every(e => e && e.trust_level === 'untrusted'))
    reasons.push('The destination (' + dest + ') was taken from that content rather than from you.');

  return { safe: reasons.length === 0, reasons };
}

/* EXPORTED ONLY WHERE SOMETHING ACTUALLY OPENS THE DOOR.

   `every-entry-point-has-a-door` refuses a `window.X = X` that nothing in the
   bundle reaches, and it caught this file on its first run: four entry points
   declared, none called. It was right. A trust plane nothing consults is worse
   than no trust plane, because it looks like protection.

   `amvActionContract` and `amvPolicyEvaluate` now govern the scheduled-job
   decision in 16-palette-sched, so they are doors. `amvCanonicalEvent` and
   `amvEvidenceIsSafe` have no caller until ingestion and the planner exist
   (Milestones 2 and 3), so they are not declared as doors yet - writing the
   export line would be claiming a caller that does not exist, which is the rot
   that check's own comments describe. They are top-level function
   declarations, so they remain reachable for their tests; the export line goes
   back the day something calls them.

   The constants are exported because the wiring above reads them by name. */
try {
  window.AMV_RISK = AMV_RISK; window.AMV_AUTONOMY = AMV_AUTONOMY;
  window.AMV_DECISION = AMV_DECISION; window.AMV_TRUST = AMV_TRUST;
  window.amvDedupKey = amvDedupKey; window.amvIdempotencyKey = amvIdempotencyKey;
  window.amvActionContract = amvActionContract; window.amvPolicyEvaluate = amvPolicyEvaluate;
} catch (e) {}

/* THE BUNDLE IS WHOLE FROM HERE.

   This is the last module in concat order, so anything that ran before this
   line ran while later modules were still evaluating - and a top-level
   `let`/`const` in one of them is unreachable until then, `typeof` included.
   Boot (at the top level of 12-handoff) is such a caller. goApp reads this to
   know whether it may honour the address bar immediately or has to wait one
   turn of the event loop for it. */
try{ window._BUNDLE_READY = true; }catch(e){}
