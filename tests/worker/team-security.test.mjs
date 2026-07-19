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
writeFileSync(harness, src + '\nexport { teamCreate, teamInvite, teamJoin, teamData, teamMembers, teamRemove, issueTokens };\n');
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

if (report() > 0) process.exitCode = 1;
done();
