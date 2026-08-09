/* THE RECORDS SEVERAL PEOPLE WRITE AT ONCE.

   An account record belongs to one person, so losing a write there takes two of
   their own devices. A team record and a family record are different in kind:
   everybody in them writes to the same row, from different places, at the same
   time. Joining, leaving, being removed, a role change, sharing something into
   the library, a payment webhook refreshing the cached plan - all of it lands on
   one object that was read, changed, and written back with nothing holding it.

   That does not need a coincidence. It needs two people using the product.

   And what is lost is not an edit:

     - a seat somebody paid for, granted and then written away;
     - a member removed who is still on the team, with the access that comes
       with it;
     - two people accepting the last invitation and a team one seat over the
       limit it is billed for;
     - an item shared into the library that is simply not there afterwards,
       which looks exactly like AMV losing somebody's work;
     - a child removed from a family who is back in it, still spending.

   Every case here fires the writers together and asserts that BOTH survived,
   and the store hands back the value as it stood when each read was ISSUED -
   without that the two writers never disagree and none of this is a test. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'teamfam.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, setEntitlement, _withTeam, _withFam, FAMILY_MAX_CHILDREN, TEAM_SEATS };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

function mkEnv(readDelayMs = 12) {
  const m = new Map(); const n = new Map();
  const env0 = {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    _map: m,
    AMV_KV: {
      _map: m,
      /* Answered with what was held when the read arrived. Sleeping first and
         reading the map afterwards makes a slow reader see the other writer's
         result, so nothing ever disagrees and no lock can be missed. */
      async get(k) {
        const asServed = m.has(k) ? m.get(k) : null;
        /* One read, once, made much slower than the rest. Firing two writers
           together expresses simultaneity, not sequence, and the sequence that
           does the damage - one reads, the other completes in full, the first
           writes - comes up too rarely to catch. Holding a single read open
           states it instead. The delay is one-shot so the writer that has to
           get in behind it is not slowed down as well. */
        const slow = env0._slowOnce;
        if (slow && slow.key === k) { env0._slowOnce = null; await new Promise(r => setTimeout(r, slow.ms)); return asServed; }
        if (readDelayMs) await new Promise(r => setTimeout(r, readDelayMs));
        return asServed;
      },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit, cursor } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        const from = cursor ? +cursor : 0;
        const page = all.slice(from, from + (limit || 1000));
        return { keys: page, list_complete: from + page.length >= all.length, cursor: String(from + page.length) };
      },
    },
    AMV_COUNTER: {
      idFromName: (x) => x,
      get: (x) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = n.get(x) || 0;
        if (b.op === 'claim') { if (n.has('c:' + x)) return new Response(JSON.stringify({ claimed: false })); n.set('c:' + x, 1); return new Response(JSON.stringify({ claimed: true })); }
        if (b.op === 'release') { n.delete('c:' + x); return new Response(JSON.stringify({ ok: true })); }
        if (b.op === 'incr') { n.set(x, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: n.get(x) })); }
        if (b.op === 'rateCheck') { n.set(x, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
  return env0;
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok, method) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: method || 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '66.66.66.66',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: (method === 'GET') ? undefined : JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b, t) => { const r = await call(env, p, b, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const together = async (...ps) => (await Promise.allSettled(ps))
  .filter(r => r.status === 'rejected')
  .map(r => String((r.reason && r.reason.message) || r.reason));

const PW = 'A-real-Passw0rd!';
const signup = async (env, email, name) =>
  (await (await call(env, '/auth/signup', { email, name, password: PW })).json()).token;

async function anOwnerWithATeam(env, plan = 'ultra') {
  const tok = await signup(env, 'owner@example.com', 'Olive');
  await W.setEntitlement(env, 'owner@example.com', plan, { source: 'stripe' });
  const t = await post(env, '/team/create', { name: 'The Team' }, tok);
  const team = t.body.team || t.body;
  ok(!!(team && team.id), 'the team was created on the ' + plan + ' plan', t.body.error || (team && team.id));
  return { tok, team };
}
async function anInviteFor(env, ownerTok, email, role) {
  const r = await post(env, '/team/invite', { email, role: role || 'member' }, ownerTok);
  return r.body.inviteToken;
}

section('The fixture can express a race at all');
{
  const env = mkEnv();
  await env.AMV_KV.put('probe', 'before');
  const inFlight = env.AMV_KV.get('probe');
  await env.AMV_KV.put('probe', 'after');
  ok(await inFlight === 'before',
     'a read already in flight does not see a write that landed after it', await inFlight);
}

section('Two people joining at once both end up on the team');
{
  /* The seat is the product. Both redemptions read the same member list and
     both wrote it back, so one person joined, was billed for, and then was not
     on the team - with nothing failing anywhere. */
  const env = mkEnv();
  const { tok, team } = await anOwnerWithATeam(env);
  const aTok = await signup(env, 'ann@example.com', 'Ann');
  const bTok = await signup(env, 'ben@example.com', 'Ben');
  const aInv = await anInviteFor(env, tok, 'ann@example.com');
  const bInv = await anInviteFor(env, tok, 'ben@example.com');
  ok(!!aInv && !!bInv, 'both invitations exist', { aInv: !!aInv, bInv: !!bInv });

  const refused = await together(
    post(env, '/team/join', { token: aInv }, aTok),
    post(env, '/team/join', { token: bInv }, bTok),
  );
  ok(refused.length === 0, 'neither join threw', refused);

  const after = await W.DB.get(env, 'team', team.id);
  const emails = (after.members || []).map(m => m.email);
  ok(emails.includes('ann@example.com'), 'the first is on the team', emails);
  ok(emails.includes('ben@example.com'), 'and so is the second', emails);
  ok(emails.length === 3, 'owner plus two, nobody written away', emails.length);
}

section('And the seat limit still holds when they arrive together');
{
  /* The other direction, and the one that costs money: the check and the seat
     have to be one operation, or two people both pass a check only one of them
     should and the team is billed for fewer seats than it has. */
  const env = mkEnv();
  const { tok, team } = await anOwnerWithATeam(env, 'ultra');
  const limit = W.TEAM_SEATS && W.TEAM_SEATS.ultra ? W.TEAM_SEATS.ultra : 0;
  ok(limit > 1, 'the plan has a real seat limit to reach', limit);

  /* Fill every seat but one, directly, so the case is about the last seat. */
  const rec = await W.DB.get(env, 'team', team.id);
  while (rec.members.length < limit - 1) {
    rec.members.push({ email: 'filler' + rec.members.length + '@example.com', role: 'member', joinedAt: Date.now() });
  }
  await W.DB.put(env, 'team', team.id, rec);

  const aTok = await signup(env, 'last1@example.com', 'L1');
  const bTok = await signup(env, 'last2@example.com', 'L2');
  const aInv = await anInviteFor(env, tok, 'last1@example.com');
  const bInv = await anInviteFor(env, tok, 'last2@example.com');

  const [r1, r2] = await Promise.all([
    post(env, '/team/join', { token: aInv }, aTok),
    post(env, '/team/join', { token: bInv }, bTok),
  ]);

  const after = await W.DB.get(env, 'team', team.id);
  ok(after.members.length <= limit,
     'the team never holds more seats than it is billed for', { held: after.members.length, limit });
  const refusals = [r1, r2].filter(r => r.status === 402 || (r.body || {}).code === 'seat_limit');
  ok(refusals.length === 1, 'exactly one of them is told there is no room',
     { refusals: refusals.length, first: r1.status, second: r2.status });
  /* Guarded: with the seat check outside the lock BOTH are admitted and there
     is no refusal to read, and a file that crashes there reports nothing at
     all instead of the failure it just found. */
  ok(/no free seats/i.test(((refusals[0] || {}).body || {}).error || ''),
     'in words the person can act on', ((refusals[0] || {}).body || {}).error);
}

section('A removal is not undone by a role change landing at the same moment');
{
  /* The worst of the team cases. Somebody is removed - because they left the
     company, or because they should not have had access - and a role change
     written from a copy read a moment earlier puts them back, with everything
     the team can see. */
  const env = mkEnv();
  const { tok, team } = await anOwnerWithATeam(env);
  const goneTok = await signup(env, 'gone@example.com', 'Gone');
  const stayTok = await signup(env, 'stay@example.com', 'Stay');
  await post(env, '/team/join', { token: await anInviteFor(env, tok, 'gone@example.com') }, goneTok);
  await post(env, '/team/join', { token: await anInviteFor(env, tok, 'stay@example.com') }, stayTok);

  const refused = await together(
    post(env, '/team/remove', { email: 'gone@example.com' }, tok),
    post(env, '/team/role', { email: 'stay@example.com', role: 'admin' }, tok),
  );
  ok(refused.length === 0, 'neither change threw', refused);

  const after = await W.DB.get(env, 'team', team.id);
  const emails = (after.members || []).map(m => m.email);
  ok(!emails.includes('gone@example.com'),
     'the person who was removed is really off the team', emails);
  const stay = (after.members || []).find(m => m.email === 'stay@example.com') || {};
  ok(stay.role === 'admin', 'and the role change also happened', stay.role);
}

section('Two members sharing at once both have something to show for it');
{
  /* The shared library is one list on one record. Both writers built a whole
     record from their own read, so one item was never there - and somebody
     watching their colleague share something that does not exist cannot tell
     that from the product losing it. */
  const env = mkEnv();
  const { tok } = await anOwnerWithATeam(env);
  const mTok = await signup(env, 'mate@example.com', 'Mate');
  await post(env, '/team/join', { token: await anInviteFor(env, tok, 'mate@example.com') }, mTok);

  const [s1, s2] = await Promise.all([
    post(env, '/team/share', { kind: 'prompt', item: { title: 'OWNERS THING' } }, tok),
    post(env, '/team/share', { kind: 'prompt', item: { title: 'MATES THING' } }, mTok),
  ]);
  ok(s1.body.ok === true && s2.body.ok === true, 'neither share was refused',
     { first: s1.body.error || 'ok', second: s2.body.error || 'ok' });

  const shared = (await post(env, '/team/shared', {}, tok)).body.shared || [];
  const titles = shared.map(s => s.title);
  ok(titles.includes('OWNERS THING'), 'the first item is in the library', titles);
  ok(titles.includes('MATES THING'), 'and so is the second', titles);
}

section('A payment webhook refreshing the plan does not erase a member');
{
  /* _refreshTeamPlan runs from a processor, so it lands at whatever moment the
     processor chooses - often the same one somebody is joining in. Written
     from a copy read first, the paid plan wipes the new member, or the new
     member wipes the plan the customer just paid for. */
  const env = mkEnv();
  const { tok, team } = await anOwnerWithATeam(env, 'elite');
  const nTok = await signup(env, 'newbie@example.com', 'Newbie');
  const inv = await anInviteFor(env, tok, 'newbie@example.com');

  /* Stated as a sequence rather than left to chance: the plan refresh's read of
     the team is held open while the join runs to completion, so the refresh is
     working from a record that is already out of date. That is the ordering
     that loses the member, and it is the one a payment webhook produces - it
     arrives whenever the processor sends it, which is often the same moment
     somebody is joining. */
  env._slowOnce = { key: 'team:' + team.id, ms: 400 };
  const plan = W.setEntitlement(env, 'owner@example.com', 'ultra', { source: 'stripe' });
  await new Promise(r => setTimeout(r, 40));
  const joinRes = await post(env, '/team/join', { token: inv }, nTok);
  const refused = await together(plan);
  ok(refused.length === 0, 'neither landed as an error', refused);
  ok(joinRes.body.ok === true || joinRes.status === 200, 'the join was accepted', joinRes.body.error || 'ok');

  const after = await W.DB.get(env, 'team', team.id);
  ok((after.members || []).some(m => m.email === 'newbie@example.com'),
     'the member who joined is still on the team', (after.members || []).map(m => m.email));
  ok(after.plan === 'ultra', 'and the plan that was paid for is on the team', after.plan);
}

section('A child removed from a family does not come back');
{
  /* A parent removes a child, and sets another child's limits in the same
     moment. Unguarded, the limits write restores the removed row - and the
     account nobody meant to keep goes on spending against the family's card. */
  const env = mkEnv();
  const parent = await signup(env, 'parent@example.com', 'Parent');
  const kid1 = await signup(env, 'kid1@example.com', 'Kid One');
  const kid2 = await signup(env, 'kid2@example.com', 'Kid Two');
  await W.DB.put(env, 'fam', 'parent@example.com', {
    id: 'fam_x', parentEmail: 'parent@example.com',
    members: [
      { email: 'parent@example.com', role: 'parent', joinedAt: Date.now() },
      { email: 'kid1@example.com', role: 'child', joinedAt: Date.now(), limits: { monthlyUSD: 10 } },
      { email: 'kid2@example.com', role: 'child', joinedAt: Date.now(), limits: { monthlyUSD: 10 } },
    ], createdAt: Date.now(),
  });
  await W.DB.put(env, 'ent', 'kid1@example.com', { plan: 'free', familyOf: 'parent@example.com' });
  await W.DB.put(env, 'ent', 'kid2@example.com', { plan: 'free', familyOf: 'parent@example.com' });

  const [rm, lim] = await Promise.all([
    post(env, '/v1/family/remove', { child: 'kid1@example.com' }, parent),
    post(env, '/v1/family/limits', { child: 'kid2@example.com', limits: { monthlyUSD: 25, marketplace: true } }, parent),
  ]);
  ok(rm.body.ok === true && lim.body.ok === true, 'neither change was refused',
     { remove: rm.body.error || 'ok', limits: lim.body.error || 'ok' });

  const fam = await W.DB.get(env, 'fam', 'parent@example.com');
  const emails = (fam.members || []).map(m => m.email);
  ok(!emails.includes('kid1@example.com'), 'the removed child is really out', emails);
  const two = (fam.members || []).find(m => m.email === 'kid2@example.com') || {};
  ok((two.limits || {}).monthlyUSD === 25, 'and the other child’s new limit took', two.limits);
}

section('A change that cannot take the lock is refused, not written blind');
{
  /* Silently proceeding without the lock is the original bug with a comment
     over it. Refusing is survivable: the person is told to try again. */
  const env = mkEnv();
  const { tok, team } = await anOwnerWithATeam(env);
  const mTok = await signup(env, 'held@example.com', 'Held');
  await post(env, '/team/join', { token: await anInviteFor(env, tok, 'held@example.com') }, mTok);

  const lock = 'claim:rmut:team:' + String(team.id).toLowerCase();
  const taken = await (await env.AMV_COUNTER.get(lock).fetch('https://do/counter',
    { method: 'POST', body: JSON.stringify({ op: 'claim', ttlMs: 15000 }) })).json();
  ok(taken.claimed === true, 'the team lock is held before the change is attempted', taken);

  const r = await post(env, '/team/remove', { email: 'held@example.com' }, tok);
  ok(r.body.ok !== true, 'the change is not reported as applied', r.body);
  ok(r.status === 503 && r.body.code === 'record_busy', 'it says the record was busy', { status: r.status, code: r.body.code });

  const after = await W.DB.get(env, 'team', team.id);
  ok((after.members || []).some(m => m.email === 'held@example.com'),
     'and nothing was changed underneath whoever holds it', (after.members || []).map(m => m.email));
}

section('Two different teams do not queue behind each other');
{
  /* A per-record lock that is really a global one would serialise every team in
     the product behind whichever one is busiest. */
  const env = mkEnv();
  const t1 = await signup(env, 'own1@example.com', 'One');
  const t2 = await signup(env, 'own2@example.com', 'Two');
  await W.setEntitlement(env, 'own1@example.com', 'ultra', { source: 'stripe' });
  await W.setEntitlement(env, 'own2@example.com', 'ultra', { source: 'stripe' });
  const a = (await post(env, '/team/create', { name: 'A' }, t1)).body;
  const b = (await post(env, '/team/create', { name: 'B' }, t2)).body;
  const idA = (a.team || a).id, idB = (b.team || b).id;
  ok(idA && idB && idA !== idB, 'two separate teams exist', { idA, idB });

  const t0 = Date.now();
  const refused = await together(
    W._withTeam(env, idA, (t) => { if (t) t.name = 'A2'; }),
    W._withTeam(env, idB, (t) => { if (t) t.name = 'B2'; }),
  );
  const elapsed = Date.now() - t0;
  ok(refused.length === 0, 'neither was refused because of the other', refused);
  ok((await W.DB.get(env, 'team', idA)).name === 'A2', 'the first went through', 'A2');
  ok((await W.DB.get(env, 'team', idB)).name === 'B2', 'and so did the second', 'B2');
  ok(elapsed < 400, 'without one waiting on the other', elapsed);
}

globalThis.fetch = realFetch;
if (report('a-team-is-written-by-everybody-in-it') > 0) process.exitCode = 1;
done();
