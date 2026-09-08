/* THE ONE RULE THE WHOLE PRODUCT RESTS ON.

   A model may PROPOSE an action. Code decides whether it runs. That separation
   is worth nothing unless the code holds when the proposal is hostile, so this
   suite is written from the attacker's side: every case here is a way an agent
   with real permissions ends up doing something nobody authorised.

   The failures being defended against are not hypothetical shapes. They are
   the ones the master brief names as critical: an unauthorised consequential
   action is a critical failure even when every other metric is perfect.

   Nothing here touches the network or a model. That is the point - the policy
   engine is pure, so it can be tested against cases that would be reckless to
   produce for real. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: '' });
const { page, errors } = app;

/* The engine lives in the page, so it is exercised there rather than
   re-implemented here. A test that reimplements the thing it checks proves
   only that two copies of a bug agree. */
const evaluate = (contract, ctx) => page.evaluate(
  ([c, x]) => { try { return amvPolicyEvaluate(amvActionContract(c), x); }
                catch (e) { return { decision: 'DENY', threw: String(e.message) }; } },
  [contract, ctx]);

/* A permissive world. Every test below starts from "everything is allowed"
   and changes ONE thing, so a pass cannot come from an unrelated denial. */
const OPEN = {
  now: 1_000_000, granted_scopes: ['calendar.write', 'email.send', 'email.draft'],
  autonomy_level: 6, user_paused: false, platform_paused: false,
};
const DRAFT = { goal: 'draft a reply', tool: 'email.draft', required_scope: 'email.draft',
                risk_class: 'R1', reversible: true };
const SEND  = { goal: 'send the reply', tool: 'email.send', required_scope: 'email.send',
                risk_class: 'R2', reversible: false, arguments: { to: 'boss@work.com' } };

section('A proposal that is not a valid contract is denied, not attempted');
{
  for (const [what, bad] of [
    ['no risk class',  { goal: 'g', tool: 't', required_scope: 's' }],
    ['unknown risk',   { goal: 'g', tool: 't', required_scope: 's', risk_class: 'R9' }],
    ['no tool',        { goal: 'g', required_scope: 's', risk_class: 'R0' }],
    ['no scope',       { goal: 'g', tool: 't', risk_class: 'R0' }],
  ]) {
    const r = await evaluate(bad, OPEN);
    ok(r.decision === 'DENY', 'denied: ' + what, r);
  }
}

section('R5 is unreachable from every direction');
{
  const r5 = { goal: 'x', tool: 't', required_scope: 'calendar.write', risk_class: 'R5' };
  const r = await evaluate(r5, OPEN);
  ok(r.decision === 'DENY', 'prohibited at maximum autonomy', r);

  const withRule = await evaluate(r5, { ...OPEN,
    rule: { name: 'mine', max_risk: 'R5', tools: ['t'] } });
  ok(withRule.decision === 'DENY', 'and a user rule cannot grant it', withRule);
}

section('R4 always needs identity, then approval - never a rule');
{
  const r4 = { goal: 'move money', tool: 'bank.transfer', required_scope: 'calendar.write',
               risk_class: 'R4', arguments: { amount: 10 } };
  const cold = await evaluate(r4, OPEN);
  ok(cold.decision === 'REQUIRE_STEP_UP', 'unverified identity is stopped first', cold);

  const warm = await evaluate(r4, { ...OPEN, step_up_verified: true });
  ok(warm.decision === 'REQUIRE_APPROVAL', 'and then it still has to be approved', warm);

  const ruled = await evaluate(r4, { ...OPEN, step_up_verified: true,
    rule: { name: 'auto', max_risk: 'R4', tools: ['bank.transfer'], max_amount: 1000 } });
  ok(ruled.decision === 'REQUIRE_APPROVAL',
     'a rule authorising R4 does not make it automatic', ruled);
}

section('A permission that was never granted is not one the agent has');
{
  const r = await evaluate(SEND, { ...OPEN, granted_scopes: ['email.draft'] });
  ok(r.decision === 'DENY', 'sending is denied when only drafting was granted', r);
  ok(String(JSON.stringify(r.reasons)).includes('email.send'),
     'and the reason names the missing permission', r.reasons);
}

section('The strictest ceiling wins, whoever set it');
{
  for (const who of ['region_max_risk', 'org_max_risk', 'household_max_risk', 'user_max_risk']) {
    const r = await evaluate(SEND, { ...OPEN, [who]: 'R1' });
    ok(r.decision === 'DENY', who + ' can hold back a lower layer', r);
  }
  /* And the direction that must NOT work: a permissive user setting cannot
     reach past a restrictive one above it. */
  const r = await evaluate(SEND, { ...OPEN, region_max_risk: 'R1', user_max_risk: 'R4' });
  ok(r.decision === 'DENY', 'a permissive user cannot widen a strict region', r);
}

section('Silence is never consent');
{
  const expired = await evaluate({ ...SEND, expires_at: 999_999 }, OPEN);
  ok(expired.decision === 'DENY', 'an expired proposal is denied, not run late', expired);

  const paused = await evaluate(DRAFT, { ...OPEN, user_paused: true });
  ok(paused.decision === 'DENY', 'a paused user stops everything', paused);

  const killed = await evaluate(DRAFT, { ...OPEN, platform_paused: true });
  ok(killed.decision === 'DENY', 'and the platform switch stops everyone', killed);

  const off = await evaluate(DRAFT, { ...OPEN, autonomy_level: 0 });
  ok(off.decision === 'DENY', 'autonomy off means off', off);
}

section('Every bound on a user-written rule is actually checked');
{
  const base = { name: 'reply to my boss', max_risk: 'R2', tools: ['email.send'],
                 allowed_destinations: ['boss@work.com'], max_amount: 50, max_runs: 3 };

  const inside = await evaluate(SEND, { ...OPEN, rule: base, runs_used: 0 });
  ok(inside.decision === 'ALLOW', 'inside the rule, it runs', inside);

  const elsewhere = await evaluate({ ...SEND, arguments: { to: 'someone-else@evil.com' } },
                                   { ...OPEN, rule: base });
  ok(elsewhere.decision === 'REQUIRE_APPROVAL',
     'a destination the rule does not list falls back to asking', elsewhere);

  const otherTool = await evaluate({ ...SEND, tool: 'calendar.delete' },
                                   { ...OPEN, rule: base, granted_scopes: ['email.send'] });
  ok(otherTool.decision === 'REQUIRE_APPROVAL', 'a tool the rule does not cover does too', otherTool);

  const spent = await evaluate(SEND, { ...OPEN, rule: base, runs_used: 3 });
  ok(spent.decision === 'REQUIRE_APPROVAL', 'a rule out of budget is not a rule', spent);

  const stale = await evaluate(SEND, { ...OPEN, rule: { ...base, expires_at: 1 } });
  ok(stale.decision === 'REQUIRE_APPROVAL', 'an expired rule stops applying', stale);

  const quiet = await evaluate(SEND, { ...OPEN, rule: base, in_quiet_hours: true });
  ok(quiet.decision === 'REQUIRE_APPROVAL', 'quiet hours hold it rather than acting', quiet);

  const over = await evaluate({ ...SEND, arguments: { to: 'boss@work.com', amount: 500 } },
                              { ...OPEN, rule: base });
  ok(over.decision === 'REQUIRE_APPROVAL', 'and an amount over the limit is refused', over);
}

section('Autonomy is a ceiling, and it is not learned');
{
  /* Prepare may draft. It may not send, however many times sending was
     approved before - the level is the level. */
  const prepDraft = await evaluate(DRAFT, { ...OPEN, autonomy_level: 4, rule: null });
  ok(prepDraft.decision === 'ALLOW', 'prepare can create a reversible draft', prepDraft);

  const prepSend = await evaluate(SEND, { ...OPEN, autonomy_level: 4, rule: null });
  ok(prepSend.decision === 'REQUIRE_APPROVAL', 'prepare cannot send', prepSend);

  const observe = await evaluate(DRAFT, { ...OPEN, autonomy_level: 1, rule: null });
  ok(observe.decision === 'REQUIRE_APPROVAL', 'observe cannot even draft', observe);

  /* R1 is only quiet when it is genuinely reversible. */
  const oneWay = await evaluate({ ...DRAFT, reversible: false }, { ...OPEN, autonomy_level: 4 });
  ok(oneWay.decision === 'REQUIRE_APPROVAL',
     'a private action that cannot be undone still gets asked about', oneWay);
}

section('Content someone else wrote is evidence, never authority');
{
  const r = await page.evaluate(() => {
    const mk = (trust, id) => amvCanonicalEvent({ tenant_id: 't', user_id: 'u', home_region: 'eu',
      source_connector: 'gmail', event_type: 'email.received', event_id: id, trust_level: trust });
    const send = amvActionContract({ goal: 'send', tool: 'email.send', required_scope: 'email.send',
      risk_class: 'R2', arguments: { to: 'attacker@evil.com' } });
    const read = amvActionContract({ goal: 'read', tool: 'email.read', required_scope: 'email.read',
      risk_class: 'R0' });
    return {
      onlyUntrusted: amvEvidenceIsSafe([mk('untrusted', 'a')], send),
      mixed:         amvEvidenceIsSafe([mk('untrusted', 'a'), mk('user', 'b')], send),
      readOnly:      amvEvidenceIsSafe([mk('untrusted', 'a')], read),
      defaultTrust:  mk(undefined, 'c').trust_level,
    };
  });
  ok(r.onlyUntrusted.safe === false,
     'an outward action supported only by outside content is flagged', r.onlyUntrusted);
  ok(String(JSON.stringify(r.onlyUntrusted.reasons)).includes('attacker@evil.com'),
     'and the destination it tried to use is named', r.onlyUntrusted.reasons);
  ok(r.mixed.safe === true, 'the same action with real user evidence is not', r.mixed);
  ok(r.readOnly.safe === true, 'reading is not restricted by this', r.readOnly);
  ok(r.defaultTrust === 'untrusted',
     'and a connector that forgets to say gets the safe answer, not the convenient one',
     r.defaultTrust);
}

section('The same fact twice is one event; two facts are two');
{
  const r = await page.evaluate(() => {
    const base = { tenant_id: 't', user_id: 'u', home_region: 'eu', source_connector: 'gmail',
                   event_type: 'email.received', source_event_id: 'msg-1', occurred_at: 5000 };
    const live    = amvCanonicalEvent({ ...base, received_at: 5001 });
    const redeliv = amvCanonicalEvent({ ...base, received_at: 90000 });   /* same fact, later */
    const other   = amvCanonicalEvent({ ...base, source_event_id: 'msg-2' });
    return { same: live.deduplication_key === redeliv.deduplication_key,
             diff: live.deduplication_key !== other.deduplication_key,
             ids:  live.event_id !== redeliv.event_id };
  });
  ok(r.same, 'a redelivery hours later carries the same deduplication key', r);
  ok(r.diff, 'a genuinely different message does not', r);
  ok(r.ids,  'even though each has its own event id', r);
}

section('An idempotency key covers who, what and with which arguments');
{
  const r = await page.evaluate(() => ({
    retry:    amvIdempotencyKey('u1', 'email.send', { to: 'a@b.c', subject: 'hi' }, 'g')
           === amvIdempotencyKey('u1', 'email.send', { to: 'a@b.c', subject: 'hi' }, 'g'),
    reorder:  amvIdempotencyKey('u1', 'email.send', { to: 'a@b.c', subject: 'hi' }, 'g')
           === amvIdempotencyKey('u1', 'email.send', { subject: 'hi', to: 'a@b.c' }, 'g'),
    otherUser: amvIdempotencyKey('u1', 'email.send', { to: 'a@b.c' }, 'g')
           !== amvIdempotencyKey('u2', 'email.send', { to: 'a@b.c' }, 'g'),
    otherArgs: amvIdempotencyKey('u1', 'email.send', { to: 'a@b.c' }, 'g')
           !== amvIdempotencyKey('u1', 'email.send', { to: 'x@y.z' }, 'g'),
  }));
  ok(r.retry, 'a retry of the same action is the same key', r);
  ok(r.reorder,
     'and stays the same when the arguments serialise in a different order', r);
  ok(r.otherUser, 'two users doing the same thing are two actions', r);
  ok(r.otherArgs, 'a different recipient is a different action', r);
}

section('An event without an owner is not an event');
{
  const r = await page.evaluate(() => {
    const out = [];
    for (const bad of [{}, { tenant_id: 't' }, { tenant_id: 't', user_id: 'u' },
                       { tenant_id: 't', user_id: 'u', home_region: 'eu' }]) {
      try { amvCanonicalEvent(bad); out.push('accepted'); }
      catch (e) { out.push('rejected'); }
    }
    return out;
  });
  ok(r.every(x => x === 'rejected'),
     'tenant, user, region, connector and type are all required', r);
}

ok(errors.length === 0, 'no console errors', errors);
await app.close();
if (report('the-policy-engine-cannot-be-talked-out-of-its-answer') > 0) process.exitCode = 1;
done();
