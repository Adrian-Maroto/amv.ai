/* THE APPEND WAS LOCKED AND THE LIMIT WAS NOT.

   `autoCreate` appends the new job inside the record lock, with a comment
   explaining why: a run holds that record for the length of a job, and writing
   the whole thing back afterwards would erase whatever the tick produced
   meanwhile. All correct.

   The plan's job LIMIT is counted before the lock is taken. So two creates
   arriving together both read the same list, both find room, and both append -
   one after the other, inside the lock, which keeps the list perfectly intact
   while the limit is what breaks. A plan that runs one background job in the
   background runs two, from a double-click, and each of them spends money every
   tick forever.

   That is the shape twice over in this file: the part that mutates was made
   safe and the part that DECIDES was left outside, where the answer it gets can
   already be stale by the time it is used.

   AND THE PARTIAL COMMIT (AMV-034). Joining a team is three writes: the member
   goes into the team, then two pointers say which team they are in. The
   membership is what the owner is billed for; the pointers are what lets the
   member reach it and what makes their usage spend the team's allowance. A
   failure between them leaves the worst of both - a seat counted and charged,
   held by somebody who cannot open the team, whose requests draw on their own
   allowance, and who can then go on to create a team of their own because that
   check reads the pointer that was never written.

   AND THE SHARED LIST (AMV-SP-05). A team's task board and its audit log are
   read, appended to and written back by every member. Two people adding a task
   at the same moment lose one, and the person who created it was told it
   worked. An audit log with holes is worse than no audit log, because it is
   trusted. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'autolimit.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, _autoKey, AUTO_MAX_BY_PLAN, _teamTasks, TEAM_MIN_PLAN, _teamAudit };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const PW = 'A-real-Passw0rd!';
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

function mkEnv() {
  const m = new Map(); const vals = new Map();
  let chain = Promise.resolve();
  const serialise = (fn) => (chain = chain.then(fn, fn));
  const env = {
    JWT_SECRET: 'j', APP_URL: 'https://amv.test', _vals: vals, _failPointer: false,
    AMV_KV: {
      _map: m,
      async get(k) { await new Promise(r => setTimeout(r, 1)); return m.has(k) ? m.get(k) : null; },
      async put(k, v) {
        await new Promise(r => setTimeout(r, 1));
        if (env._failPointer && k.startsWith('userteam:')) throw new Error('storage down');
        m.set(k, v);
      },
      async delete(k) { await new Promise(r => setTimeout(r, 1)); m.delete(k); },
      async list({ prefix, limit } = {}) {
        const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ fetch(_u, init) {
        return serialise(async () => {
          await Promise.resolve();
          const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
          if (b.op === 'claim') {
            if (vals.has('c:' + n)) return new Response(JSON.stringify({ claimed: false }));
            vals.set('c:' + n, 1); return new Response(JSON.stringify({ claimed: true, owner: 'o' + Math.random() }));
          }
          if (b.op === 'release') { vals.delete('c:' + n); return new Response(JSON.stringify({ released: true })); }
          if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
          if (b.op === 'rateCheck') { const nx = cur + 1; vals.set(n, nx); return new Response(JSON.stringify({ allowed: nx <= (b.limit || 9999) })); }
          return new Response(JSON.stringify({ allowed: true, value: cur }));
        });
      } }),
    },
  };
  return env;
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '6.6.6.6',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b, t) => { const r = await call(env, p, b, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };

async function person(env, email, plan) {
  const tok = (await (await call(env, '/auth/signup', { email, name: 'P', password: PW })).json()).token;
  if (plan) await W.DB.put(env, 'ent', email, { plan, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return tok;
}
const jobsOf = async (env, email) => ((await W.DB.get(env, 'auto', W._autoKey(email))) || { items: [] }).items || [];

section('One automation is created, and the plan allows it');
{
  const env = mkEnv();
  const tok = await person(env, 'auto@example.com', 'pro');
  const r = await post(env, '/auto/create', { detail: 'check the news each morning', repeat: 'daily' }, tok);
  ok(r.body.ok === true, 'it is created', r.body);
  ok((await jobsOf(env, 'auto@example.com')).length === 1, 'and stored', 1);
}

section('A burst cannot create more jobs than the plan runs');
{
  /* The finding. Each job spends money every tick, for ever, so a plan limit
     that a double-click walks through is a recurring bill nobody agreed to. */
  const env = mkEnv();
  const tok = await person(env, 'burst@example.com', 'pro');
  const max = W.AUTO_MAX_BY_PLAN.pro;

  const rs = await Promise.all(Array.from({ length: max + 6 },
    (_, i) => post(env, '/auto/create', { detail: 'job number ' + i, repeat: 'daily' }, tok)));
  const made = rs.filter(r => r.body.ok).length;
  const stored = (await jobsOf(env, 'burst@example.com')).length;

  ok(stored <= max, 'no more jobs exist than the plan runs', { stored, max });
  ok(made === stored, 'and every create that said yes really made one', { made, stored });
  ok(rs.some(r => !r.body.ok), 'the rest are refused', rs.filter(r => !r.body.ok).length);
}

section('A free account gets none at all, however many it asks for');
{
  /* Scheduled work is a paid feature - AUTO_MAX_BY_PLAN.free is zero - so the
     burst that matters on this tier is the one that must produce nothing. */
  const env = mkEnv();
  const tok = await person(env, 'free@example.com');
  const rs = await Promise.all([
    post(env, '/auto/create', { detail: 'the first thing', repeat: 'weekly' }, tok),
    post(env, '/auto/create', { detail: 'the second thing', repeat: 'weekly' }, tok),
  ]);
  ok(W.AUTO_MAX_BY_PLAN.free === 0, 'the free plan runs no scheduled work', W.AUTO_MAX_BY_PLAN.free);
  ok((await jobsOf(env, 'free@example.com')).length === 0, 'and none were created', 0);
  ok(rs.every(r => r.body.code === 'plan_required'), 'each is told it is a paid feature', rs.map(r => r.body.code));
}

section('A refused create says which limit and what to do');
{
  const env = mkEnv();
  const tok = await person(env, 'told@example.com', 'pro');
  const max = W.AUTO_MAX_BY_PLAN.pro;
  for (let i = 0; i < max; i++) await post(env, '/auto/create', { detail: 'job ' + i, repeat: 'daily' }, tok);
  const r = await post(env, '/auto/create', { detail: 'one too many', repeat: 'daily' }, tok);
  ok(!r.body.ok, 'the one past the cap is refused', r.status);
  ok(r.body.code === 'plan_limit' || r.body.code === 'job_limit', 'with a code', r.body.code);
  ok(/plan|upgrade|Remove/i.test(r.body.error || ''), 'and something they can act on', r.body.error);
}

section('Two members adding a task at once both get one');
{
  /* AMV-SP-05. The board is one record and everybody in the team writes it. */
  const env = mkEnv();
  const owner = await person(env, 'owner@example.com', 'elite');
  const t = await post(env, '/team/create', { name: 'Team' }, owner);
  ok(t.body.ok === true, 'a team exists', t.body.error || t.status);

  const rs = await Promise.all([
    post(env, '/team/task/create', { title: 'the first task' }, owner),
    post(env, '/team/task/create', { title: 'the second task' }, owner),
  ]);
  ok(rs.every(r => r.body.ok), 'both are accepted', rs.map(r => r.status));

  const tasks = await W._teamTasks(env, t.body.team.id);
  ok(tasks.length === 2, 'and both are on the board', tasks.map(x => x.title));
}

section('And the audit log keeps both entries');
{
  /* A log with holes in it is worse than none, because it is trusted. */
  const env = mkEnv();
  const owner = await person(env, 'logger@example.com', 'elite');
  const t = await post(env, '/team/create', { name: 'Logged' }, owner);
  await Promise.all([
    post(env, '/team/task/create', { title: 'task one' }, owner),
    post(env, '/team/task/create', { title: 'task two' }, owner),
  ]);
  const log = JSON.parse(env.AMV_KV._map.get('teamlog:' + t.body.team.id) || '[]');
  const created = log.filter(e => e.action === 'task_created');
  ok(created.length === 2, 'both actions are recorded', created.map(e => e.title));

  /* Through the route, those two creates never actually overlap AT THE LOG: the
     task board's own lock serialises them a step earlier, so the log write is
     already alone by the time it happens and this section passes on a log that
     has no protection at all. The log is therefore also driven directly, with
     the writers genuinely concurrent, which is the situation a real team is in
     whenever two people do two DIFFERENT things - an invite and a role change
     take no common lock. */
  const team = t.body.team;
  const before = JSON.parse(env.AMV_KV._map.get('teamlog:' + team.id) || '[]').length;
  await Promise.all(['member_invited', 'role_changed', 'member_removed', 'settings_changed', 'task_deleted']
    .map(a => W._teamAudit(env, team, 'logger@example.com', a, {})));
  const after = JSON.parse(env.AMV_KV._map.get('teamlog:' + team.id) || '[]');
  ok(after.length === before + 5,
     'five things done at once leave five lines', { before, after: after.length });
  const names = after.map(e => e.action);
  const missing = ['member_invited', 'role_changed', 'member_removed', 'settings_changed', 'task_deleted']
    .filter(a => !names.includes(a));
  ok(missing.length === 0, 'and each of the five is the one that was done', missing);
}

section('A join that cannot be finished leaves no seat behind');
{
  /* AMV-034. The member is added, then the pointers are written. If the
     pointers fail, the owner is billed for a seat its holder cannot reach - and
     the holder can go on to create their own team, because that check reads the
     pointer that was never written. */
  const env = mkEnv();
  const owner = await person(env, 'boss@example.com', 'elite');
  const t = await post(env, '/team/create', { name: 'Payroll' }, owner);
  ok(t.body.ok === true, 'the team exists', t.body.error || t.status);

  const inv = await post(env, '/team/invite', { email: 'newbie@example.com', role: 'member' }, owner);
  const token = inv.body.inviteToken || '';
  ok(!!token, 'an invite was issued', Object.keys(inv.body));

  const joiner = await person(env, 'newbie@example.com');
  env._failPointer = true;
  const j = await post(env, '/team/join', { token }, joiner);
  env._failPointer = false;

  ok(j.status === 503, 'the join reports that it could not be finished', j.status);
  ok(j.body.code === 'join_incomplete', 'and names why', j.body.code);

  const team = await W.DB.get(env, 'team', t.body.team.id);
  const seats = (team.members || []).map(m => m.email);
  ok(!seats.includes('newbie@example.com'),
     'and the seat is given back, so nobody is billed for a member who is not there', seats);

  /* And the invite still works, because it is consumed last. */
  const again = await post(env, '/team/join', { token }, joiner);
  ok(again.body.ok === true, 'so the invite can simply be tried again', again.body.error || again.status);
}

section('The decision is made inside the lock, not beside it');
{
  /* The property, on the shape: a limit read before the lock and enforced
     nowhere inside it is the defect, and it passes every sequential test. */
  const fn = codeOnly(functionBody(src, 'autoCreate'));
  const iLock = fn.indexOf('_withAuto(env, key');
  const iCheck = fn.indexOf('overBudget = true');
  const iEnd = fn.indexOf('}, { items:[], results:[] });', iLock);
  ok(iLock > -1 && iCheck > iLock && iCheck < iEnd,
     'the job limit is re-decided inside the record lock', { lock: iLock, check: iCheck, end: iEnd });
  ok(/if\(overBudget\)/.test(fn), 'and a create that was over it is refused', true);

  /* Scoped to the handler and nothing else. The first version of this check
     fell back to searching the whole file, which passes as long as SOME other
     function locks `teamtasks` - the handler under test could go back to
     read-modify-write and the check would not notice. */
  const tasks = codeOnly(functionBody(src, 'teamTaskCreate') || '');
  ok(tasks.length > 400, 'the create handler was read', tasks.length);
  ok(/_withKind\(env, 'teamtasks'/.test(tasks),
     'the task board is written under the record lock', true);
  ok(!/_saveTeamTasks\(/.test(tasks),
     'and not written a second way beside it', true);
  const tLock = tasks.indexOf("_withKind(env, 'teamtasks'");
  const tCap = tasks.indexOf('TEAM_TASK_MAX');
  const tEnd = tasks.indexOf('}, []);', tLock);
  ok(tLock > -1 && tCap > tLock && tCap < tEnd,
     'and the board ceiling is decided inside that lock too', { lock: tLock, cap: tCap, end: tEnd });
  ok(/_withKV\(env, 'teamlog'/.test(codeOnly(functionBody(src, '_teamAudit'))),
     'and so is the audit log', true);

  const join = codeOnly(functionBody(src, 'teamJoin'));
  const iPtr = join.indexOf('userteam:');
  const iRollback = join.indexOf('team_join_rolled_back');
  const iInvite = join.indexOf('AMV_KV.delete(`invite:');
  ok(iRollback > iPtr, 'a pointer failure rolls the seat back', { ptr: iPtr, rollback: iRollback });
  ok(iInvite > iPtr, 'and the invite is consumed last, so a retry is possible', { ptr: iPtr, invite: iInvite });
}

globalThis.fetch = realFetch;
if (report('a-limit-checked-outside-the-lock-is-not-a-limit') > 0) process.exitCode = 1;
done();
