/* TEAM SECURITY REGRESSIONS (AMV-008 / AMV-009 / AMV-010).

   AMV-008  invites were not bound to the recipient and were weakly consumed, so
            a leaked admin-invite link could be redeemed by ANY account, and two
            racers could redeem the same token.
   AMV-009  the team-data write path enforced no role check and accepted
            arbitrary unbounded nested objects.
   AMV-010  _teamOf trusted the userteam pointer without checking active
            membership, so a stale/tampered pointer kept access after removal. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'team-security.harness.mjs');
writeFileSync(harness, src + '\nexport { teamCreate, teamInvite, teamJoin, teamData, teamMembers, teamRemove, teamLeave, issueTokens, setEntitlement, requireUser, _billingSubjectOf, _teamSeatLimit, _setUserTeam, _planRankOf, _markPastDue, _clearPastDue, _teamPlan, DB };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40),
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
  },
};
const tok = async (email) => (await W.issueTokens(env, email, email.split('@')[0])).token;
const req = (body, token, method = 'POST') => new Request('https://api.amv.dev/team', {
  method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body),
});
const jget = async (r) => { try { return await r.json(); } catch { return {}; } };

const ownerTok = await tok('owner@x.com');

/* Seats are what a team plan sells (AMV-100), so the owner has to be on a plan
   that includes more than one of them before any of this is reachable. */
await W.setEntitlement(env, 'owner@x.com', 'elite');

/* setup: owner creates a team, invites bob as admin */
section('Setup: team + invite');
let r = await W.teamCreate(req({ name: 'Acme' }, ownerTok), env);
let d = await jget(r);
ok(r.status === 200 && d.team && d.team.id, 'team created');
ok(/^team_[0-9a-f]{32}$/.test(d.team.id), 'team id uses full-entropy identifier', d.team.id);
const teamId = d.team.id;
r = await W.teamInvite(req({ email: 'bob@x.com', role: 'admin' }, ownerTok), env);
d = await jget(r);
const inviteToken = d.inviteToken;
ok(r.status === 200 && !!inviteToken, 'invite issued');
ok(inviteToken.length >= 40, 'invite token has high entropy (256-bit)', inviteToken.length);

/* AMV-008: only the named recipient may redeem */
section('AMV-008: invite is bound to the recipient and single-use');
const malloryTok = await tok('mallory@x.com');
r = await W.teamJoin(req({ token: inviteToken }, malloryTok), env);
ok(r.status === 403, 'a different account cannot redeem the invite (403)');
const bobTok = await tok('bob@x.com');
r = await W.teamJoin(req({ token: inviteToken }, bobTok), env);
d = await jget(r);
ok(r.status === 200 && d.ok, 'the invited recipient CAN redeem');
r = await W.teamJoin(req({ token: inviteToken }, bobTok), env);
ok(r.status >= 400, 'the invite cannot be redeemed a second time');

/* AMV-009: a plain member cannot edit team data; oversized data is rejected */
section('AMV-009: team-data write is role-gated and bounded');
r = await W.teamInvite(req({ email: 'carol@x.com', role: 'member' }, ownerTok), env);
const carolInvite = (await jget(r)).inviteToken;
const carolTok = await tok('carol@x.com');
await W.teamJoin(req({ token: carolInvite }, carolTok), env);
r = await W.teamData(req({ data: { evil: 'tampered' } }, carolTok), env);
ok(r.status === 403, 'a plain member cannot overwrite shared team data (403)');
r = await W.teamData(req({ data: { ok: 'yes' } }, ownerTok), env);
ok(r.status === 200, 'an owner CAN edit team data');
const huge = { blob: 'A'.repeat(200 * 1024) };
r = await W.teamData(req({ data: huge }, ownerTok), env);
ok(r.status === 413, 'an oversized data payload is rejected (413)');

/* AMV-010: a stale userteam pointer does not grant access after removal */
section('AMV-010: membership is the source of truth');
r = await W.teamRemove(req({ email: 'carol@x.com' }, ownerTok), env);
ok(r.status === 200, 'owner removes carol');
// simulate a stale/tampered pointer that survived removal
store.set('userteam:carol@x.com', teamId);
r = await W.teamMembers(req({}, carolTok), env);
d = await jget(r);
ok(Array.isArray(d.members) && d.members.length === 0, 'a removed member with a stale pointer resolves to no team');

/* AMV-100: a shared plan has to mean a shared budget, or a team is a way to buy
   one subscription and spend twenty-five of them. */
section('AMV-100: seats are finite and the allowance is shared');
{
  const ownerSub = await W._billingSubjectOf(env, 'owner@x.com');
  ok(ownerSub.subject === 'team:' + teamId,
     'the owner spends against the team, not a private counter', ownerSub.subject);

  const bobSub = await W._billingSubjectOf(env, 'bob@x.com');
  ok(bobSub.plan === 'elite', 'a member inherits the team plan rather than staying free', bobSub.plan);
  ok(bobSub.subject === 'team:' + teamId,
     'and spends against the SAME counter as everyone else on it', bobSub.subject);
  ok(bobSub.subject === ownerSub.subject,
     'one subscription is one allowance, however many people are on it');

  /* The whole point of the check. Elite is ten seats; carol was removed above,
     so the team is owner + bob. Fill it, then prove the eleventh is refused. */
  ok(W._teamSeatLimit('elite') === 10, 'elite includes ten seats', W._teamSeatLimit('elite'));
  ok(W._teamSeatLimit('free') === 1, 'and a free account cannot invite anyone', W._teamSeatLimit('free'));

  const team = await W.DB.get(env, 'team', teamId);
  ok(team.plan === 'elite', 'the team caches the plan it was created under', team.plan);
  while (team.members.length < 10) {
    team.members.push({ email: 'filler' + team.members.length + '@x.com', role: 'member', joinedAt: Date.now() });
  }
  await W.DB.put(env, 'team', teamId, team);

  let rr = await W.teamInvite(req({ email: 'eleventh@x.com', role: 'member' }, ownerTok), env);
  let dd = await jget(rr);
  ok(rr.status === 402, 'inviting past the last seat is refused', rr.status);
  ok(dd.code === 'seat_limit', 'with a reason the app can act on', dd.code);
  ok(/upgrade/i.test(dd.error || ''), 'and a message that says what to do', dd.error);
}

section('AMV-100: a plan change does not silently eject somebody from their team');
{
  /* setEntitlement rebuilds the entitlement record from scratch. Before teamId
     was carried, any upgrade, downgrade, admin override or Stripe webhook would
     drop the marker - the member would quietly fall back to free and nothing
     anywhere would say why. */
  await W.setEntitlement(env, 'bob@x.com', 'free', { source: 'test' });
  const after = await W._billingSubjectOf(env, 'bob@x.com');
  ok(after.teamId === teamId, 'bob is still on the team after a billing event', after.teamId);
  ok(after.plan === 'elite', 'and still has the plan the team pays for', after.plan);
}

section('AMV-100: a better personal plan is never taken away by joining a team');
{
  /* Somebody paying for Ultra on their own card must not be downgraded to the
     team's Elite - and because they are not drawing on the team's budget, they
     keep their own counters too. */
  await W.setEntitlement(env, 'bob@x.com', 'ultra', { source: 'test' });
  const sub = await W._billingSubjectOf(env, 'bob@x.com');
  ok(sub.plan === 'ultra', 'the plan they pay for wins', sub.plan);
  ok(sub.subject === 'bob@x.com', 'and they spend against their own allowance', sub.subject);
  ok(sub.teamId === teamId, 'while still being a member of the team', sub.teamId);
}

section('AMV-100: a removed member stops spending the team allowance immediately');
{
  const gone = await W._billingSubjectOf(env, 'carol@x.com');
  ok(gone.subject === 'carol@x.com', 'carol is back on her own counter', gone.subject);
  ok(gone.plan === 'free', 'and back on her own plan', gone.plan);
  ok(gone.teamId === null, 'with no team attributed to her', gone.teamId);
}

section('AMV-100: downgrading the plan takes the seats back it stopped paying for')
{
  /* The way around the invite check: upgrade, fill every seat, downgrade. If the
     plan were only read at invite time, twelve people would keep an Ultra plan
     for the price of Elite and nothing would ever reconcile it. */
  await W.setEntitlement(env, 'owner@x.com', 'ultra', { source: 'test' });   // 25 seats
  const team = await W.DB.get(env, 'team', teamId);
  while (team.members.length < 12) {
    team.members.push({ email: 'later' + team.members.length + '@x.com', role: 'member', joinedAt: Date.now() + team.members.length });
  }
  await W.DB.put(env, 'team', teamId, team);
  // the fixture members need the same entitlement marker a real join writes
  for (const m of team.members) await W._setUserTeam(env, m.email, teamId);
  const newest = team.members[team.members.length - 1].email;
  const oldest = team.members.find(m => m.role !== 'owner').email;
  // bob bought his own Ultra in the section above; put him back on the team's
  // plan so this section is testing seats rather than that exemption again.
  await W.setEntitlement(env, oldest, 'free', { source: 'test' });

  ok((await W._billingSubjectOf(env, newest)).seated === true, 'everyone fits on Ultra');

  await W.setEntitlement(env, 'owner@x.com', 'elite', { source: 'test' });   // 10 seats
  const t2 = await W.DB.get(env, 'team', teamId);
  ok(t2.plan === 'elite', 'the team plan follows the owner down, not just up', t2.plan);

  const dropped = await W._billingSubjectOf(env, newest);
  ok(dropped.seated === false, 'the member who joined last is no longer covered', dropped.seated);
  ok(dropped.plan === 'free', 'and falls back to their own plan rather than keeping a paid one', dropped.plan);
  ok(dropped.subject === newest, 'and stops drawing on the team allowance', dropped.subject);

  const kept = await W._billingSubjectOf(env, oldest);
  ok(kept.seated === true, 'while the earliest member keeps their seat', kept.seated);
  ok(kept.subject === 'team:' + teamId, 'and still shares the allowance', kept.subject);

  const ownerStill = await W._billingSubjectOf(env, 'owner@x.com');
  ok(ownerStill.seated === true, 'the owner is never the one squeezed out of their own team');

  const rr = await W.teamMembers(req({}, ownerTok, 'POST'), env);
  const dd = await jget(rr);
  ok(dd.seats && dd.seats.limit === 10 && dd.seats.over === 2,
     'and the owner can see exactly how many people are over the limit', dd.seats);
  ok(dd.members.filter(m => m.seated === false).length === 2, 'named individually, not just counted');
}

section('AMV-100: creating a team needs the plan that includes teams')
{
  const soloTok = await tok('solo@x.com');
  let rr = await W.teamCreate(req({ name: 'Free Co' }, soloTok), env);
  let dd = await jget(rr);
  ok(rr.status === 402, 'a free account cannot create a team on the server either', rr.status);
  ok(dd.code === 'plan_required', 'and is told which plan it needs', dd.code);

  await W.setEntitlement(env, 'solo@x.com', 'pro', { source: 'test' });
  rr = await W.teamCreate(req({ name: 'Pro Co' }, soloTok), env);
  ok(rr.status === 402, 'and neither can Pro, which is what the plans page says', rr.status);

  await W.setEntitlement(env, 'solo@x.com', 'elite', { source: 'test' });
  rr = await W.teamCreate(req({ name: 'Elite Co' }, soloTok), env);
  ok(rr.status === 200, 'Elite can', rr.status);
}

section('AMV-100: a member can leave without asking the person whose plan they are on')
{
  /* Removal was the only exit, so the only person who could end a membership
     was the owner - while the member's usage was pooled with theirs the whole
     time. Joining is the member's decision; leaving has to be too. */
  const gone = await W.DB.get(env, 'team', teamId);
  const who = gone.members.find(m => m.role !== 'owner').email;
  const whoTok = await tok(who);

  let rr = await W.teamLeave(req({}, whoTok), env);
  ok(rr.status === 200, 'a member can leave on their own', rr.status);

  const after = await W._billingSubjectOf(env, who);
  ok(after.teamId === null, 'and is off the team afterwards', after.teamId);
  ok(after.subject === who, 'back on their own counter', after.subject);
  ok(after.plan === 'free', 'and their own plan', after.plan);

  const t3 = await W.DB.get(env, 'team', teamId);
  ok(!t3.members.some(m => m.email === who), 'the team record no longer lists them');
  ok(!(await env.AMV_KV.get('userteam:' + who)), 'and neither does the pointer that grants access');

  rr = await W.teamLeave(req({}, whoTok), env);
  ok(rr.status === 404, 'leaving twice is not an error worth inventing state for', rr.status);

  rr = await W.teamLeave(req({}, ownerTok), env);
  const dd = await jget(rr);
  ok(rr.status === 400 && dd.code === 'owner_cannot_leave',
     'the owner cannot walk away and leave everyone on a plan nobody pays for', dd.code);
  ok(/Transfer ownership/i.test(dd.error || ''), 'and is told what to do instead', dd.error);
}

section('AMV-100: a custom plan is ranked by what was paid, not by being custom')
{
  /* `custom` is a price, not a tier. Treating it as top-rank meant a twenty
     dollar custom plan cleared an Elite-and-above gate, and an unset seat field
     meant a genuine Elite-tier custom customer got a team with one seat in it
     while the app told them they had a team. Both directions were wrong. */
  ok(W._planRankOf('custom', { price: 20 }) < W._planRankOf('elite'),
     'a cheap custom plan does not clear the Elite gate', W._planRankOf('custom', { price: 20 }));
  ok(W._planRankOf('custom', { price: 90 }) >= W._planRankOf('elite'),
     'while one priced at Elite or above does', W._planRankOf('custom', { price: 90 }));
  ok(W._planRankOf('custom', null) === 0, 'and a custom plan with no price ranks at the bottom, not the top');

  ok(W._teamSeatLimit('custom', { price: 90 }) === 10, 'an Elite-priced custom plan gets Elite seats',
     W._teamSeatLimit('custom', { price: 90 }));
  ok(W._teamSeatLimit('custom', { price: 400 }) === 25, 'an Ultra-priced one gets Ultra seats',
     W._teamSeatLimit('custom', { price: 400 }));
  ok(W._teamSeatLimit('custom', { price: 20 }) === 1, 'and a Pro-priced one gets no team at all',
     W._teamSeatLimit('custom', { price: 20 }));
  ok(W._teamSeatLimit('custom', { price: 90, seats: 40 }) === 40,
     'a negotiated seat count still wins over the price tier', W._teamSeatLimit('custom', { price: 90, seats: 40 }));
  ok(W._teamSeatLimit('custom', { price: 90, seats: 9000 }) === 500,
     'but is bounded, so a bad config cannot open an unlimited plan');

  const cheapTok = await tok('cheap@x.com');
  await W.setEntitlement(env, 'cheap@x.com', 'custom', { custom: { price: 20 } });
  let rr = await W.teamCreate(req({ name: 'Cheap Co' }, cheapTok), env);
  ok(rr.status === 402, 'and the gate holds end to end for a cheap custom plan', rr.status);

  const bigTok = await tok('big@x.com');
  await W.setEntitlement(env, 'big@x.com', 'custom', { custom: { price: 300 } });
  rr = await W.teamCreate(req({ name: 'Big Co' }, bigTok), env);
  const dd = await jget(rr);
  ok(rr.status === 200, 'while a real custom enterprise plan gets its team', rr.status);
  ok(dd.seats && dd.seats.limit === 25, 'with the seats its price paid for', dd.seats);
}

section('AMV-100: a team stops being Elite when the card stops paying for it')
{
  /* The team caches the owner's plan so a member's request costs one read
     instead of two. A cache is only safe if it expires the same way the thing
     it copies does - and a lapse expires on a CLOCK: seven days after the first
     failed payment, with no write happening anywhere. Reading the cached plan
     directly would have kept a whole team on a plan nobody was paying for. */
  const ownTok2 = await tok('lapse@x.com');
  await W.setEntitlement(env, 'lapse@x.com', 'elite');
  let rr = await W.teamCreate(req({ name: 'Lapse Co' }, ownTok2), env);
  const tid = (await jget(rr)).team.id;

  rr = await W.teamInvite(req({ email: 'seat@x.com', role: 'member' }, ownTok2), env);
  const inv = (await jget(rr)).inviteToken;
  await W.teamJoin(req({ token: inv }, await tok('seat@x.com')), env);
  ok((await W._billingSubjectOf(env, 'seat@x.com')).plan === 'elite',
     'the member is on the team plan while it is being paid for');

  await W._markPastDue(env, 'lapse@x.com', { reason: 'test' });
  const t = await W.DB.get(env, 'team', tid);
  ok(!!t.pastDueSince, 'a failed payment reaches the team, not only the owner record', t.pastDueSince);
  ok(W._teamPlan(t) === 'elite', 'and inside the grace window the team keeps working');

  // wind the clock past the grace window without waiting seven days for it
  t.pastDueSince = Date.now() - (8 * 86400000);
  await W.DB.put(env, 'team', tid, t);
  ok(W._teamPlan(await W.DB.get(env, 'team', tid)) === 'free',
     'once the grace window closes the team plan is gone, on a clock and with no write');

  const after = await W._billingSubjectOf(env, 'seat@x.com');
  ok(after.plan === 'free', 'so the member stops getting compute nobody is paying for', after.plan);
  ok(after.subject === 'seat@x.com', 'and stops spending against a lapsed subscription', after.subject);

  await W._clearPastDue(env, 'lapse@x.com');
  ok(!(await W.DB.get(env, 'team', tid)).pastDueSince,
     'and a recovered payment clears it on the team too, not just the owner');
  ok((await W._billingSubjectOf(env, 'seat@x.com')).plan === 'elite',
     'restoring the whole team in one payment');
}

if (report() > 0) process.exitCode = 1;
done();
