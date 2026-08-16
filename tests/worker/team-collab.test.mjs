/* THE COLLABORATION HALF OF A TEAM.

   Seats and billing were hardened first, and the shared library, task board and
   presence were left as they were - written before any of it, and never tested
   end to end. The billing question ("who pays for this request") and the access
   question ("who may read this") are genuinely different, and the answer here is
   that access follows MEMBERSHIP, not seats: someone the plan has stopped paying
   for still belongs to the team and can still see its work. They just spend
   their own compute.

   What was actually wrong was size. The team record is loaded on EVERY
   authenticated request a member makes - _teamOf for permissions and
   _billingSubjectOf for billing both read it - so its size is the latency and
   the cost of everything the whole team does. Two hundred shared items at
   thirty-two kilobytes each is a six megabyte record on every keystroke, and
   nothing bounded the total: teamData bounded the incoming PATCH, and teamShare
   bounded the incoming ITEM, and neither bounded what they were adding to. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'teamcollab.harness.mjs');
writeFileSync(harness, src + `
export { teamCreate, teamInvite, teamJoin, teamShare, teamShared, teamUnshare, teamData,
         teamTasks, teamTaskCreate, teamTaskUpdate, teamPresence, teamRemove,
         setEntitlement, issueTokens, _billingSubjectOf, DB,
         TEAM_RECORD_MAX, TEAM_SHARE_MAX, TEAM_SHARE_PER_MEMBER, TEAM_TASK_MAX };
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

await W.setEntitlement(env, 'owner@x.com', 'elite');
const ownerTok = await tok('owner@x.com');
const teamId = (await jget(await W.teamCreate(req({ name: 'Acme' }, ownerTok), env))).team.id;

const joinTeam = async (email, role = 'member') => {
  const inv = (await jget(await W.teamInvite(req({ email, role }, ownerTok), env))).inviteToken;
  const t = await tok(email);
  await W.teamJoin(req({ token: inv }, t), env);
  return t;
};
const bobTok = await joinTeam('bob@x.com');
const carolTok = await joinTeam('carol@x.com');

section('One member cannot evict the whole team’s shared work');
{
  /* A single FIFO list with a global cap means the most prolific sharer
     silently deletes everybody else's items - which from the inside looks
     exactly like AMV losing your work. */
  let last;
  for (let i = 0; i < W.TEAM_SHARE_PER_MEMBER; i++) {
    last = await W.teamShare(req({ kind: 'prompt', item: { title: 'bob ' + i, body: 'x' } }, bobTok), env);
  }
  ok(last.status === 200, 'a member can share up to their own limit', last.status);

  const over = await W.teamShare(req({ kind: 'prompt', item: { title: 'one too many' } }, bobTok), env);
  const od = await jget(over);
  ok(over.status === 429, 'and is stopped at it rather than pushing somebody else out', over.status);
  ok(od.code === 'share_limit', 'with a reason the app can act on', od.code);
  ok(/Remove one of yours/.test(od.error), 'that tells them what to remove - their own, not a colleague’s', od.error);

  const mine = await W.teamShare(req({ kind: 'prompt', item: { title: 'carol here' } }, carolTok), env);
  ok(mine.status === 200, 'while a different member is unaffected by their colleague being full', mine.status);

  const shared = (await jget(await W.teamShared(req({}, ownerTok), env))).shared;
  ok(shared.some(s => s.by === 'carol@x.com'), 'and both people’s work is in the library', shared.length);
  ok(shared.filter(s => s.by === 'bob@x.com').length === W.TEAM_SHARE_PER_MEMBER,
     'with nobody over their share', shared.filter(s => s.by === 'bob@x.com').length);
}

section('The record every request loads has a ceiling');
{
  /* teamData bounded the incoming patch and teamShare bounded the incoming
     item. Neither bounded the thing they were adding to, so repeated writes
     under different keys grew it without limit. */
  const big = 'A'.repeat(60 * 1024);
  let last = null, wrote = 0;
  for (let i = 0; i < 12; i++) {
    last = await W.teamData(req({ data: { ['blob' + i]: big } }, ownerTok), env);
    if (last.status === 200) wrote++; else break;
  }
  ok(last.status === 413, 'the record stops growing at the ceiling', last.status);
  const d = await jget(last);
  ok(d.code === 'team_full', 'with a code the app can branch on', d.code);
  ok(/Remove something from the shared library/.test(d.error),
     'and a sentence that says how to get unstuck', d.error);
  ok(wrote > 0, 'while normal writes below the ceiling still work', wrote);

  const rec = await W.DB.get(env, 'team', teamId);
  ok(JSON.stringify(rec).length <= W.TEAM_RECORD_MAX,
     'and what is actually stored is within it', JSON.stringify(rec).length);

  /* Sharing reads the SAME ceiling, so a big item is refused once the record is
     near full - it does not get its own separate budget to blow past it. */
  const share = await W.teamShare(req({ kind: 'prompt', item: { title: 'no room', body: 'B'.repeat(30 * 1024) } }, carolTok), env);
  ok(share.status === 413, 'sharing reads the same ceiling, not a separate one', share.status);
  ok((await jget(share)).code === 'team_full', 'and reports it the same way');

  // put the record back so the sections below are testing what they say they are
  const clean = await W.DB.get(env, 'team', teamId);
  for (const k of Object.keys(clean.data || {})) if (/^blob/.test(k)) delete clean.data[k];
  await W.DB.put(env, 'team', teamId, clean);
}

section('The task board is bounded too, and says so rather than dropping work');
{
  ok(W.TEAM_TASK_MAX > 0, 'there is a limit at all', W.TEAM_TASK_MAX);
  /* Anchored on the property rather than on the line. This read
     `if(tasks.length >= TEAM_TASK_MAX)` against a count taken before the record
     lock - which is where AMV-SP-05 found it, and is a check two members can
     both pass at once. What matters is that the ceiling is decided against the
     list as it is INSIDE the lock, so the anchor is the ordering. */
  const create = codeOnly(functionBody(src, 'teamTaskCreate') || '');
  const lock = create.indexOf("_withKind(env, 'teamtasks'");
  const cap = create.indexOf('TEAM_TASK_MAX');
  const end = create.indexOf('}, []);', lock);
  ok(lock > -1 && cap > lock && cap < end,
     'checked inside the lock, against the list as it is at that moment', { lock, cap, end });
  ok(/code: 'task_limit'/.test(src), 'and refused with a reason');
  ok(!/tasks\.length\s*=\s*TEAM_TASK_MAX/.test(src),
     'never silently trimmed - a board that drops the oldest task loses work without saying so');
}

section('Access follows membership, and billing follows the seat');
{
  /* These are different questions and they need different answers. Somebody the
     plan has stopped paying for is still on the team and can still see its work;
     what changes is whose compute they spend. */
  const t = await W.DB.get(env, 'team', teamId);
  t.plan = 'pro';                 // one seat: only the owner is covered now
  await W.DB.put(env, 'team', teamId, t);

  const sub = await W._billingSubjectOf(env, 'bob@x.com');
  ok(sub.seated === false, 'bob has lost his seat', sub.seated);
  ok(sub.subject === 'bob@x.com', 'and spends his own allowance', sub.subject);

  const r = await W.teamShared(req({}, bobTok), env);
  ok(r.status === 200, 'but he can still reach the team library he helped build', r.status);
  const tasks = await W.teamTasks(req({}, bobTok), env);
  ok(tasks.status === 200, 'and the task board', tasks.status);
  const p = await W.teamPresence(req({}, bobTok), env);
  ok(p.status === 200, 'and still shows as present to his colleagues', p.status);
}

section('Removal ends access immediately, on every surface');
{
  await W.teamRemove(req({ email: 'bob@x.com' }, ownerTok), env);
  const after = [
    ['the shared library', await W.teamShared(req({}, bobTok), env)],
    ['the task board', await W.teamTasks(req({}, bobTok), env)],
    ['team data', await W.teamData(req({}, bobTok), env)],
  ];
  for (const [what, r] of after) {
    const d = await jget(r);
    const closed = r.status >= 400 || (Array.isArray(d.shared) && d.shared.length === 0);
    ok(closed, 'a removed member gets nothing from ' + what, { status: r.status, d });
  }
  const share = await W.teamShare(req({ kind: 'prompt', item: { title: 'still here?' } }, bobTok), env);
  ok(share.status === 404, 'and cannot write to it either', share.status);

  const sub = await W._billingSubjectOf(env, 'bob@x.com');
  ok(sub.teamId === null, 'with no team left on their record', sub.teamId);
}

section('Sharing is attributed, and only the sharer or a manager can remove it');
{
  // the section above dropped the team to one seat; restore it so invites work
  const back = await W.DB.get(env, 'team', teamId);
  back.plan = 'elite';
  await W.DB.put(env, 'team', teamId, back);
  const r = await W.teamShare(req({ kind: 'prompt', item: { title: 'carols thing' } }, carolTok), env);
  const entry = (await jget(r)).shared.find(s => s.title === 'carols thing');
  ok(entry && entry.by === 'carol@x.com', 'every entry names who shared it', entry && entry.by);

  const daveTok = await joinTeam('dave@x.com');
  const nope = await W.teamUnshare(req({ id: entry.id }, daveTok), env);
  ok(nope.status === 403, 'another plain member cannot delete it', nope.status);

  const yes = await W.teamUnshare(req({ id: entry.id }, ownerTok), env);
  ok(yes.status === 200, 'the owner can', yes.status);
  ok(!(await jget(yes)).shared.some(s => s.id === entry.id), 'and it is really gone');
}

if (report('team-collab') > 0) process.exitCode = 1;
done();
