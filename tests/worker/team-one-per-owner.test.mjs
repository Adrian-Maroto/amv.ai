/* A SECOND TEAM ABANDONED THE FIRST ONE, WITH EVERYONE STILL IN IT.

   The team model has always been one per account. `ent.teamId` holds a single
   id and `userteam:<email>` holds a single id, and every path that asks "which
   team is this person in" reads one of those two. Nothing enforced it.

   So a second /team/create repointed both and left the first team behind:
   members intact, shared library intact, and - this is the part that costs
   money - its cached owner plan intact. `_refreshTeamPlan` only ever visits the
   team the owner CURRENTLY points at, so an abandoned team is never refreshed
   again. Cancel the subscription and everyone still in the first team keeps an
   Elite allowance permanently, funded by nobody. That takes no ill intent:
   clicking "create a team" twice is an ordinary thing to do.

   The mirror case is a billing hole in the other direction. Somebody who was a
   MEMBER of a team and then created their own stopped pointing at the old team
   while remaining in its members array - so its owner kept paying for a seat
   whose holder could no longer reach it, and the member had no route back.

   Both are refused now, and this is the test that says what happens instead. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'team-one-per-owner.harness.mjs');
writeFileSync(harness, src + `
export { teamCreate, teamInvite, teamJoin, teamLeave, teamGet, setEntitlement,
         issueTokens, _refreshTeamPlan, _teamPlan, DB };
`);
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40),
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }; },
  },
};
const tok = async (email) => (await W.issueTokens(env, email, email.split('@')[0])).token;
const req = (body, token) => new Request('https://api.amv.dev/team', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify(body),
});
const jget = async (r) => { try { return await r.json(); } catch { return {}; } };
const teamCount = () => [...store.keys()].filter(k => k.startsWith('team:')).length;

await W.setEntitlement(env, 'owner@x.com', 'elite');
const ownerTok = await tok('owner@x.com');

section('Creating a team works');
{
  const r = await jget(await W.teamCreate(req({ name: 'Acme' }, ownerTok), env));
  ok(r.ok === true && !!r.team && r.team.id, 'the team exists', r.team && r.team.id);
  ok(r.team.ownerEmail === 'owner@x.com', 'owned by the caller', r.team.ownerEmail);
  ok(teamCount() === 1, 'and there is one of them', teamCount());
}
const firstId = (await jget(await W.teamGet(req({}, ownerTok), env))).team.id;

section('Creating a second one returns the first, rather than stranding it');
{
  const r = await jget(await W.teamCreate(req({ name: 'Another' }, ownerTok), env));
  ok(r.ok === true, 'the call still succeeds', r.ok);
  ok(r.existing === true, 'and says it is the one they already had', r.existing);
  ok(r.team.id === firstId, 'the same team comes back', { got: r.team.id, want: firstId });
  ok(teamCount() === 1, 'no second record was written', teamCount());
}

section('So the pointers still agree with each other');
{
  /* The whole failure was these two disagreeing with the record they name. */
  const ptr = await env.AMV_KV.get('userteam:owner@x.com');
  const ent = await W.DB.get(env, 'ent', 'owner@x.com');
  ok(ptr === firstId, 'userteam still points at the team', ptr);
  ok(ent.teamId === firstId, 'and so does the entitlement', ent.teamId);
}

section('Which is what keeps a cancelled plan from paying for people forever');
{
  /* The money version of the same fact. Before, an abandoned team kept
     plan:'elite' and never saw another refresh - _refreshTeamPlan visits the
     team the owner currently points at, and that was the new one. */
  const inv = (await jget(await W.teamInvite(req({ email: 'staff@x.com', role: 'member' }, ownerTok), env))).inviteToken;
  await W.teamJoin(req({ token: inv }, await tok('staff@x.com')), env);

  await W.setEntitlement(env, 'owner@x.com', 'free');
  const ent = await W.DB.get(env, 'ent', 'owner@x.com');
  await W._refreshTeamPlan(env, 'owner@x.com', ent);

  const team = await W.DB.get(env, 'team', firstId);
  ok(W._teamPlan(team) === 'free',
     'the downgrade reaches the team the members are actually in', W._teamPlan(team));
  ok((team.members || []).some(m => m.email === 'staff@x.com'),
     'who are still there, just no longer on somebody else’s allowance', (team.members || []).length);
}

section('A member of somebody else’s team cannot quietly leave it by making their own');
{
  /* They were removed from nothing: the old team went on counting the seat,
     and the person had no way back to it. */
  await W.setEntitlement(env, 'staff@x.com', 'elite');   // rich enough to create one
  const staffTok = await tok('staff@x.com');
  const before = teamCount();

  const r = await W.teamCreate(req({ name: 'Mine' }, staffTok), env);
  const d = await jget(r);
  ok(r.status === 409, 'the request is refused', r.status);
  ok(d.code === 'already_in_team', 'with a code the app can act on', d.code);
  ok(/leave/i.test(d.error || ''), 'and says what to do instead', d.error);
  ok(teamCount() === before, 'no team was created', teamCount());

  const ptr = await env.AMV_KV.get('userteam:staff@x.com');
  ok(ptr === firstId, 'and they still belong to the team that is paying for them', ptr);
}

section('Leaving first is what lets them create one');
{
  const staffTok = await tok('staff@x.com');
  await W.teamLeave(req({}, staffTok), env);

  const r = await jget(await W.teamCreate(req({ name: 'Mine' }, staffTok), env));
  ok(r.ok === true && !r.existing, 'now it is created', { ok: r.ok, existing: r.existing });
  ok(r.team.ownerEmail === 'staff@x.com', 'and it is theirs', r.team.ownerEmail);

  const old = await W.DB.get(env, 'team', firstId);
  ok(!(old.members || []).some(m => m.email === 'staff@x.com'),
     'the team they left is not still counting their seat', (old.members || []).map(m => m.email));
}

section('A pointer to a team that no longer exists does not block anybody');
{
  /* The stale-pointer case has to stay creatable, or a deleted team would lock
     its owner out of ever having another. */
  await W.setEntitlement(env, 'ghost@x.com', 'elite');
  const t = await tok('ghost@x.com');
  await env.AMV_KV.put('userteam:ghost@x.com', 'team_gone');

  const r = await jget(await W.teamCreate(req({ name: 'Fresh' }, t), env));
  ok(r.ok === true && !r.existing, 'a team is created', { ok: r.ok, existing: r.existing });
  ok(r.team.ownerEmail === 'ghost@x.com', 'for them', r.team.ownerEmail);
}

if (report('team-one-per-owner') > 0) process.exitCode = 1;
done();
