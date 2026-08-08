/* A TEAM IS SEVERAL PEOPLE SHARING ONE PAID PLAN AND ONE BODY OF WORK.

   That makes it the only place in AMV where somebody who is legitimately
   signed in has a reason to want more than they were given: a member who can
   promote themselves is an admin, an admin who can remove the owner owns the
   team, and either one takes the plan, the shared data and the audit trail with
   them. Nothing else in the product has that shape - everywhere else a stranger
   is either you or not you.

   The capability matrix is defined in one place and looks right. Ten of the
   routes that consult it appeared in no test at all, which means every rule in
   it was a comment as far as anything automated could tell.

   These cases are written as the attempts somebody would actually make, in
   order of how much they would gain: promote yourself, remove the person above
   you, take the owner's seat, read what you should not, and act on a team you
   are not in. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'team.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, TEAM_PERMS, _can, _role };\n');
const W = await import(harness + '?t=' + Date.now());

const OWNER = 'owner@example.com';
const ADMIN = 'admin@example.com';
const MEMBER = 'member@example.com';
const OUTSIDER = 'outsider@example.com';
const PW = 'A-real-Passw0rd!';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

function mkEnv() {
  const m = new Map();
  return {
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0 })); } }) },
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
  };
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
const call = (env, path, body, tok) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '22.22.22.22',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const jsonOf = async (r) => { try { return await r.json(); } catch (e) { return {}; } };

async function signup(env, email) {
  const d = await jsonOf(await call(env, '/auth/signup', { email, name: 'X', password: PW }));
  return d.token;
}
/* A real team with the three roles in it, built through storage so every case
   starts from the same shape. */
async function team(env) {
  const toks = {};
  for (const e of [OWNER, ADMIN, MEMBER, OUTSIDER]) toks[e] = await signup(env, e);
  await W.DB.put(env, 'ent', OWNER, { plan: 'team', seats: 5, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  const t = {
    id: 'team1', name: 'A team', ownerEmail: OWNER, seats: 5, createdAt: Date.now(),
    members: [
      { email: OWNER, role: 'owner', joinedAt: Date.now() },
      { email: ADMIN, role: 'admin', joinedAt: Date.now() },
      { email: MEMBER, role: 'member', joinedAt: Date.now() },
    ],
  };
  await W.DB.put(env, 'team', t.id, t);
  for (const e of [OWNER, ADMIN, MEMBER]) await env.AMV_KV.put(`userteam:${e}`, t.id);
  return toks;
}
const teamNow = async (env) => await W.DB.get(env, 'team', 'team1');
const roleOf = async (env, email) => {
  const t = await teamNow(env);
  const m = (t.members || []).find(x => x.email === email);
  return m ? m.role : null;
};

section('The capability matrix says what it looks like it says');
{
  const t = { members: [{ email: OWNER, role: 'owner' }, { email: ADMIN, role: 'admin' }, { email: MEMBER, role: 'member' }] };
  ok(W._can(t, MEMBER, 'viewMembers'), 'a member can see who is on the team', true);
  ok(!W._can(t, MEMBER, 'invite') && !W._can(t, MEMBER, 'remove') && !W._can(t, MEMBER, 'setRole'),
     'and can do nothing that changes who is on it', {
       invite: W._can(t, MEMBER, 'invite'), remove: W._can(t, MEMBER, 'remove'), setRole: W._can(t, MEMBER, 'setRole') });
  ok(!W._can(t, ADMIN, 'deleteTeam'), 'an admin cannot delete the team', true);
  ok(!W._can(t, OUTSIDER, 'viewMembers'), 'and somebody who is not in it can do nothing at all', true);
}

section('A member cannot promote themselves');
{
  /* The single most valuable move available to anybody legitimately signed in. */
  const env = mkEnv();
  const toks = await team(env);
  const r = await call(env, '/team/role', { email: MEMBER, role: 'admin' }, toks[MEMBER]);
  ok(r.status === 403, 'refused', r.status);
  ok((await roleOf(env, MEMBER)) === 'member', 'and they are still a member', await roleOf(env, MEMBER));
}

section('And cannot remove anybody');
{
  const env = mkEnv();
  const toks = await team(env);
  const r = await call(env, '/team/remove', { email: ADMIN }, toks[MEMBER]);
  ok(r.status === 403, 'refused', r.status);
  const t = await teamNow(env);
  ok(t.members.length === 3, 'the team is intact', t.members.length);
}

section('An admin can manage members but cannot take the team');
{
  /* Admins are trusted with people. They are not trusted with ownership, and
     the difference is the whole reason there are two roles. */
  const env = mkEnv();
  const toks = await team(env);

  const promote = await call(env, '/team/role', { email: MEMBER, role: 'admin' }, toks[ADMIN]);
  ok(promote.status === 403, 'an admin cannot create another admin - only the owner can', promote.status);
  ok((await roleOf(env, MEMBER)) === 'member', 'so the member is unchanged', await roleOf(env, MEMBER));

  const takeOwner = await call(env, '/team/role', { email: OWNER, role: 'member' }, toks[ADMIN]);
  ok(takeOwner.status >= 400, 'and cannot demote the owner', takeOwner.status);
  ok((await roleOf(env, OWNER)) === 'owner', 'who is still the owner', await roleOf(env, OWNER));
}

section('The owner can, which is what makes them the owner');
{
  const env = mkEnv();
  const toks = await team(env);
  const r = await call(env, '/team/role', { email: MEMBER, role: 'admin' }, toks[OWNER]);
  ok(r.status === 200, 'the owner promotes a member', r.status);
  ok((await roleOf(env, MEMBER)) === 'admin', 'and it took effect', await roleOf(env, MEMBER));

  const back = await call(env, '/team/role', { email: MEMBER, role: 'member' }, toks[OWNER]);
  ok(back.status === 200 && (await roleOf(env, MEMBER)) === 'member', 'and can demote again', await roleOf(env, MEMBER));
}

section('The owner cannot demote themselves out of existence');
{
  /* The one path that reaches the owner-immutability rule. Everybody else is
     stopped earlier by the owner-only check, so without this case that rule
     could be deleted and every assertion here would still pass - and a team
     whose owner demoted themselves has nobody who can administer it or cancel
     the plan it is billing for. */
  const env = mkEnv();
  const toks = await team(env);
  const r = await call(env, '/team/role', { email: OWNER, role: 'member' }, toks[OWNER]);
  ok(r.status >= 400, 'refused even to the owner themselves', r.status);
  ok((await roleOf(env, OWNER)) === 'owner', 'and they are still the owner', await roleOf(env, OWNER));

  const t = await teamNow(env);
  ok(t.members.filter(m => m.role === 'owner').length === 1,
     'the team has exactly one owner, which is what makes it administrable', t.members.map(m => m.role));
}

section('Nobody can remove the owner, including the owner');
{
  /* A team with no owner is a team nobody can administer and nobody can
     cancel - which means a plan that bills for ever with no one able to stop
     it. */
  const env = mkEnv();
  const toks = await team(env);
  for (const who of [ADMIN, MEMBER, OWNER]) {
    const r = await call(env, '/team/remove', { email: OWNER }, toks[who]);
    ok(r.status >= 400, 'removing the owner is refused for ' + who.split('@')[0], r.status);
  }
  const t = await teamNow(env);
  ok(t.members.some(m => m.role === 'owner'), 'the team still has an owner', true);
}

section('Somebody outside the team can do nothing to it');
{
  /* Signed in, valid token, no membership. Every one of these routes has to
     find that out for itself. */
  const env = mkEnv();
  const toks = await team(env);
  const attempts = [
    ['/team/role',    { email: MEMBER, role: 'admin' }],
    ['/team/remove',  { email: MEMBER }],
    ['/team/audit',   {}],
    ['/team/members', {}],
    ['/team/unshare', { id: 'x' }],
    ['/team/task/create', { title: 'x' }],
  ];
  const leaked = [];
  for (const [path, body] of attempts) {
    const r = await call(env, path, body, toks[OUTSIDER]);
    const d = await jsonOf(r);
    /* Either refused, or answered about THEIR OWN (absent) team - never about
       this one. A 200 carrying somebody else's members is the failure. */
    const saw = JSON.stringify(d);
    if (r.status < 400 && (saw.includes(OWNER) || saw.includes(ADMIN))) leaked.push(path + ' -> ' + saw.slice(0, 80));
  }
  ok(leaked.length === 0, 'no route tells an outsider anything about a team they are not in', leaked);

  const t = await teamNow(env);
  ok(t.members.length === 3 && (await roleOf(env, MEMBER)) === 'member',
     'and nothing they tried changed it', t.members.length);
}

section('Leaving is allowed, and the owner leaving is not');
{
  const env = mkEnv();
  const toks = await team(env);
  const r = await call(env, '/team/leave', {}, toks[MEMBER]);
  ok(r.status === 200, 'a member can leave', r.status);
  const t = await teamNow(env);
  ok(!t.members.some(m => m.email === MEMBER), 'and is gone from the team', t.members.map(m => m.email));
  ok(!(await env.AMV_KV.get(`userteam:${MEMBER}`)), 'with their pointer to it cleared', true);

  const own = await call(env, '/team/leave', {}, toks[OWNER]);
  ok(own.status >= 400, 'the owner cannot walk away and leave it ownerless', own.status);
}

section('The audit log is for the people who run the team');
{
  /* It records who removed whom. That is exactly what somebody would want to
     read, and to erase, after doing something they should not have. */
  const env = mkEnv();
  const toks = await team(env);
  await call(env, '/team/role', { email: MEMBER, role: 'admin' }, toks[OWNER]);

  const mine = await jsonOf(await call(env, '/team/audit', {}, toks[OWNER]));
  ok(Array.isArray(mine.log) && mine.log.length > 0, 'the owner can read it', (mine.log || []).length);
  ok(JSON.stringify(mine.log).includes('role_changed'), 'and the role change is in it', true);

  /* Checked on somebody who is still a member. The first version of this asked
     the person who had just been promoted to admin two lines above, and read
     their correct 200 as a permission failure - a test wrong about its own
     fixture, which is the easiest way to "find" a bug that is not there. */
  const stillMember = await call(env, '/team/audit', {}, toks[ADMIN]);
  ok(stillMember.status === 200, 'an admin can read it too', stillMember.status);

  const env2 = mkEnv();
  const t2 = await team(env2);
  const theirs = await call(env2, '/team/audit', {}, t2[MEMBER]);
  ok(theirs.status === 403, 'an ordinary member cannot', theirs.status);
}

section('And none of it works without being signed in');
{
  const env = mkEnv();
  await team(env);
  for (const path of ['/team/role', '/team/remove', '/team/leave', '/team/audit', '/team/members']) {
    const r = await call(env, path, { email: MEMBER, role: 'admin' });
    ok(r.status === 401, path + ' needs an account', r.status);
  }
  ok((await roleOf(env, MEMBER)) === 'member', 'and nothing changed', await roleOf(env, MEMBER));
}

globalThis.fetch = realFetch;
if (report('a-team-has-boundaries') > 0) process.exitCode = 1;
done();
