/* A COMPANY'S DIRECTORY DECIDES WHO IS AN ADMIN - AND ONLY THAT.

   SCIM 2.0 Groups (71-scim.js; docs/OWNER-DECISIONS.md #20), driven through
   the Worker's own routes the way Okta and Microsoft Entra ID call them:

   - a group is created, listed, read, renamed and deleted;
   - members of the group named "AMV Admins" become admins, and leave it as
     members again - Okta's "remove members[value eq ...]" and Entra's
     "remove members" with a value list both work;
   - an admin the OWNER appointed in AMV is never demoted by the directory,
     and the owner is never touched;
   - a member the directory does not know is refused, and a request with one
     bad operation changes nothing;
   - every role change is in the team's audit log;
   - a wrong token reaches no group. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'scimgroups.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());

const ISS = 'https://login.acme-corp.example';
let dnsTxt = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url instanceof Request ? url.url : url);
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith('https://cloudflare-dns.com/dns-query'))
    return reply(200, { Status: 0, Answer: dnsTxt.map(t => ({ name: '_amv-verify.acme-corp.com', type: 16, data: '"' + t + '"' })) });
  if (u === ISS + '/.well-known/openid-configuration')
    return reply(200, { issuer: ISS, authorization_endpoint: ISS + '/authorize', token_endpoint: ISS + '/token', jwks_uri: ISS + '/keys' });
  return realFetch(url, init);
};

const m = new Map(), vals = new Map();
const env = {
  JWT_SECRET: 'j'.repeat(40), ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test', CONNECT_KEY: 'c'.repeat(44),
  AMV_KV: { async get(k){ return m.has(k) ? m.get(k) : null; }, async put(k, v){ m.set(k, v); }, async delete(k){ m.delete(k); },
    async list({ prefix } = {}){ return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init){
    const b = JSON.parse(init.body || '{}'); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
    if (b.op === 'incr'){ vals.set(n, cur + Number(b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur, count: 1 });
  } }) },
};
const ctx = { waitUntil(){}, passThroughOnException(){} };
let ip = 1;
const call = async (path, body, tok) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.9.0.' + (ip++ % 200 + 1), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
    body: JSON.stringify(body || {}) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
const scim = async (method, path, body, tok) => {
  const r = await W.default.fetch(new Request('https://api.amv.test/scim/v2' + path, { method,
    headers: { 'Content-Type': 'application/scim+json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})), type: r.headers.get('Content-Type') || '' };
};
async function account(email, plan){
  const tok = (await call('/auth/signup', { email, name: 'X', password: 'A-real-Passw0rd!' })).d.token;
  if (plan) await W.DB.put(env, 'ent', email, { plan, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return tok;
}
const owner = await account('boss@acme-corp.com', 'ultra');
await call('/team/create', { name: 'Acme' }, owner);
const teamId = () => m.get('userteam:boss@acme-corp.com');
const team = async () => W.DB.get(env, 'team', teamId());

let token = '', base = '';
section('Only the owner turns it on, and only with a proved domain');
{
  const early = await call('/team/sso', { action: 'scim', on: true }, owner);
  ok(early.status === 400, 'without company sign-in set up, it is refused', early.status);
  const s = await call('/team/sso', { action: 'set', domain: 'acme-corp.com', issuer: ISS, clientId: 'c1', clientSecret: 's' }, owner);
  const unproved = await call('/team/sso', { action: 'scim', on: true }, owner);
  ok(unproved.status === 400 && unproved.d.code === 'not_verified', 'with the domain not yet proved, it is refused', unproved.d);
  dnsTxt = [s.d.sso.record.value];
  await call('/team/sso', { action: 'verify' }, owner);
  const member = await account('pat@acme-corp.com');
  const notOwner = await call('/team/sso', { action: 'scim', on: true }, member);
  ok(notOwner.status === 403 || notOwner.status === 404, 'somebody who is not the owner cannot', notOwner.status);
  const on = await call('/team/sso', { action: 'scim', on: true }, owner);
  token = on.d.token || ''; base = on.d.baseUrl || '';
  ok(on.status === 200 && /^amvscim_team_[a-f0-9]{32}_[a-f0-9]{64}$/.test(token) && base === 'https://api.amv.test/scim/v2', 'on: a token and the address to give the directory', [on.status, base]);
  const t = await team();
  ok(t.scim && t.scim.hash && !JSON.stringify(t).includes(token.split('_').pop()), 'only the token’s hash is kept', t.scim);
  const get = await call('/team/sso', { action: 'get' }, owner);
  ok(get.d.scim && get.d.scim.on && !JSON.stringify(get.d).includes(token.split('_').pop()), 'and it is never shown again', get.d.scim);
}


const sc = (method, path, body) => scim(method, path, body, token);
const users = {};
for (const who of ['ana', 'raj', 'lee']) {
  await account(who + '@acme-corp.com');
  const r = await sc('POST', '/Users', { userName: who + '@acme-corp.com', active: true });
  users[who] = r.d.id;
}
const role = async (email) => ((await team()).members.find(x => x.email === email) || {}).role;
const log = async () => (await call('/team/audit', {}, owner)).d.log || [];

section('A group is created, listed and read');
let gid = '';
{
  const r = await sc('POST', '/Groups', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: 'Engineering', members: [{ value: users.ana }] });
  gid = r.d.id;
  ok(r.status === 201 && /^g[a-f0-9]{24}$/.test(gid) && r.d.displayName === 'Engineering' && r.d.members.length === 1 && r.d.members[0].value === users.ana, 'created, with its member', r.d);
  const list = await sc('GET', '/Groups?filter=' + encodeURIComponent('displayName eq "engineering"'));
  ok(list.status === 200 && list.d.totalResults === 1 && list.d.Resources[0].id === gid, 'found by name, as Okta looks before pushing', list.d);
  const lean = await sc('GET', '/Groups?excludedAttributes=members');
  ok(lean.d.Resources.every(g => !('members' in g)), 'listed without members when Entra asks for that', lean.d.Resources);
  ok((await role('ana@acme-corp.com')) === 'member', 'a group that is not the admin group changes no role');
  const dup = await sc('POST', '/Groups', { displayName: 'ENGINEERING' });
  ok(dup.status === 409, 'a second group with the same name is refused', dup.status);
}

section('Members of "AMV Admins" become admins, and stop being admins when they leave');
let aid = '';
{
  const r = await sc('POST', '/Groups', { displayName: 'AMV Admins', members: [{ value: users.ana }, { value: users.raj }] });
  aid = r.d.id;
  ok(r.status === 201, 'the admin group is pushed', r.status);
  ok((await role('ana@acme-corp.com')) === 'admin' && (await role('raj@acme-corp.com')) === 'admin', 'its members are admins', [await role('ana@acme-corp.com'), await role('raj@acme-corp.com')]);
  const okta = await sc('PATCH', '/Groups/' + aid, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'remove', path: 'members[value eq "' + users.ana + '"]' }] });
  ok(okta.status === 200 && (await role('ana@acme-corp.com')) === 'member', 'removed the way Okta removes: a member again', [okta.status, await role('ana@acme-corp.com')]);
  const entra = await sc('PATCH', '/Groups/' + aid, { Operations: [{ op: 'Remove', path: 'members', value: [{ value: users.raj }] }] });
  ok(entra.status === 200 && (await role('raj@acme-corp.com')) === 'member', 'removed the way Entra removes: a member again', [entra.status, await role('raj@acme-corp.com')]);
  const add = await sc('PATCH', '/Groups/' + aid, { Operations: [{ op: 'Add', path: 'members', value: [{ value: users.lee }] }] });
  ok(add.status === 200 && (await role('lee@acme-corp.com')) === 'admin', 'added: an admin', [add.status, await role('lee@acme-corp.com')]);
  const l = await log();
  ok(l.some(e => e.action === 'scim_role_changed' && e.target === 'raj@acme-corp.com' && e.to === 'member'), 'every role change is in the audit log', l.slice(0, 4));
}

section('An admin the owner appointed stays one; the owner is never touched');
{
  await call('/team/role', { email: 'raj@acme-corp.com', role: 'admin' }, owner);
  ok((await role('raj@acme-corp.com')) === 'admin', 'the owner makes Raj an admin in AMV');
  await sc('PATCH', '/Groups/' + aid, { Operations: [{ op: 'replace', path: 'members', value: [{ value: users.lee }] }] });
  ok((await role('raj@acme-corp.com')) === 'admin', 'the directory, not having him in the group, does not demote him', await role('raj@acme-corp.com'));
  const all = await sc('GET', '/Users');
  const ownerId = (all.d.Resources.find(u => u.userName === 'boss@acme-corp.com') || {}).id;
  if (ownerId) await sc('PATCH', '/Groups/' + aid, { Operations: [{ op: 'add', path: 'members', value: [{ value: ownerId }] }] });
  ok((await role('boss@acme-corp.com')) === 'owner', 'and the owner stays the owner, whatever group they are put in', await role('boss@acme-corp.com'));
}

section('An admin the directory made, then appointed by the owner, is the owner\u2019s from then on');
{
  ok((await role('lee@acme-corp.com')) === 'admin', 'Lee is an admin through the directory group');
  await call('/team/role', { email: 'lee@acme-corp.com', role: 'member' }, owner);
  await call('/team/role', { email: 'lee@acme-corp.com', role: 'admin' }, owner);
  await sc('PATCH', '/Groups/' + aid, { Operations: [{ op: 'remove', path: 'members[value eq "' + users.lee + '"]' }] });
  ok((await role('lee@acme-corp.com')) === 'admin', 'once the owner has set the role in AMV, leaving the group does not take it away', await role('lee@acme-corp.com'));
  await call('/team/role', { email: 'lee@acme-corp.com', role: 'member' }, owner);
  await sc('PATCH', '/Groups/' + aid, { Operations: [{ op: 'add', path: 'members', value: [{ value: users.lee }] }] });
}

section('Nothing unknown, and nothing half-done');
{
  const before = JSON.stringify((await team()).scimGroups);
  const bad = await sc('PATCH', '/Groups/' + aid, { Operations: [{ op: 'add', path: 'members', value: [{ value: users.ana }] }, { op: 'add', path: 'members', value: [{ value: 'u' + '0'.repeat(24) }] }] });
  ok(bad.status === 400, 'a member this team does not have is refused', bad.d);
  ok(JSON.stringify((await team()).scimGroups) === before && (await role('ana@acme-corp.com')) === 'member', 'and the good operation before it did not happen either', await role('ana@acme-corp.com'));
  const path = await sc('PATCH', '/Groups/' + aid, { Operations: [{ op: 'replace', path: 'owner', value: 'x' }] });
  ok(path.status === 400, 'only members and the name can be changed', path.status);
}

section('Renamed away from "AMV Admins", deleted, and a wrong token');
{
  const ren = await sc('PATCH', '/Groups/' + aid, { Operations: [{ op: 'replace', path: 'displayName', value: 'Former admins' }] });
  ok(ren.status === 200 && (await role('lee@acme-corp.com')) === 'member', 'renamed, it no longer gives the role', [ren.status, await role('lee@acme-corp.com')]);
  const del = await sc('DELETE', '/Groups/' + gid);
  ok(del.status === 204 && (await sc('GET', '/Groups/' + gid)).status === 404, 'deleted, it is gone', del.status);
  const wrong = await scim('GET', '/Groups', undefined, token.slice(0, -4) + '0000');
  ok(wrong.status === 401, 'a wrong token reaches no group', wrong.status);
}

report('a-company-directory-decides-who-is-admin');
done();
