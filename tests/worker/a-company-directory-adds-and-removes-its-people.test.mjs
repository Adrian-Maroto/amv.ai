/* A COMPANY'S DIRECTORY ADDS AND REMOVES ITS PEOPLE - AND NOBODY ELSE.

   SCIM 2.0 Users (71-scim.js), driven through the Worker's own routes the way
   Okta and Microsoft Entra ID call them:

   - only the team's owner can turn it on, and only with a proved domain; the
     token is shown once and only its hash is kept;
   - a wrong, replaced or missing token reaches nothing;
   - a person at the domain is added to the team and holds a seat; an address
     at another domain, somebody in another team, or a full team is refused;
   - setting active to false - Okta's PUT, Entra's PATCH with "False" as a
     string - or DELETE takes them off the team AND ends every sign-in they
     have, at once; setting it back to true puts them back;
   - the owner can never be removed by the directory;
   - members at other addresses are not the directory's to see;
   - every change is in the team's audit log;
   - removing access still works with the emergency stop on. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'scim.harness.mjs');
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
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.8.0.' + (ip++ % 200 + 1), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
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

section('A wrong token reaches nothing');
{
  const none = await scim('GET', '/Users');
  const wrong = await scim('GET', '/Users', undefined, token.slice(0, -4) + '0000');
  ok(none.status === 401 && wrong.status === 401, 'missing or wrong: 401', [none.status, wrong.status]);
  ok(/scim\+json/.test(wrong.type) && wrong.d.schemas && /Error/.test(wrong.d.schemas[0]), 'answered as SCIM', wrong.d);
  const cfg = await scim('GET', '/ServiceProviderConfig', undefined, token);
  ok(cfg.status === 200 && cfg.d.patch.supported && cfg.d.filter.supported, 'the directory can read what is supported', cfg.d);
}

let anaId = '';
const ana = await account('ana@acme-corp.com');
section('A person at the domain is added, and holds a seat');
{
  const r = await scim('POST', '/Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'Ana@Acme-Corp.com',
    name: { givenName: 'Ana', familyName: 'Lima' }, active: true }, token);
  anaId = r.d.id;
  ok(r.status === 201 && r.d.userName === 'ana@acme-corp.com' && r.d.active === true && /^u[a-f0-9]{24}$/.test(anaId), 'created', [r.status, r.d]);
  const t = await team();
  ok(t.members.some(x => x.email === 'ana@acme-corp.com' && x.role === 'member'), 'she is a member of the team', t.members.map(x => x.email));
  ok(m.get('userteam:ana@acme-corp.com') === t.id, 'and reaches it', m.get('userteam:ana@acme-corp.com'));
  const again = await scim('POST', '/Users', { userName: 'ana@acme-corp.com' }, token);
  ok(again.status === 409, 'twice is a conflict, not a second seat', again.status);
  const found = await scim('GET', '/Users?filter=' + encodeURIComponent('userName eq "ana@acme-corp.com"'), undefined, token);
  ok(found.d.totalResults === 1 && found.d.Resources[0].id === anaId, 'found by address, as directories look people up', found.d);
  const one = await scim('GET', '/Users/' + anaId, undefined, token);
  ok(one.status === 200 && one.d.userName === 'ana@acme-corp.com', 'and by id', one.status);
}

section('Nobody outside the domain, nobody from another team, and not past the seats');
{
  const out = await scim('POST', '/Users', { userName: 'kim@gmail.com' }, token);
  ok(out.status === 400, 'an address at another domain is refused', out.status);
  const rival = await account('rival@acme-corp.com', 'ultra');
  await call('/team/create', { name: 'Rival' }, rival);
  const taken = await scim('POST', '/Users', { userName: 'rival@acme-corp.com' }, token);
  ok(taken.status === 409, 'somebody in another AMV team is refused, not moved', taken.status);
  const contractor = await account('lee@contractor.example');
  const t = await team();
  t.members.push({ email: 'lee@contractor.example', role: 'member', joinedAt: Date.now() });
  await W.DB.put(env, 'team', t.id, t);
  const list = await scim('GET', '/Users', undefined, token);
  ok(!list.d.Resources.some(x => x.userName === 'lee@contractor.example'), 'a member at another address is not the directory’s to see', list.d.Resources.map(x => x.userName));
  void contractor;
}

section('Switched off, she is off the team and signed out everywhere, at once');
{
  const before = await call('/team/members', {}, ana);
  ok(before.status === 200 && before.d.members.length > 0, 'before: her session works and she sees the team', before.status);
  const r = await scim('PATCH', '/Users/' + anaId, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
    Operations: [{ op: 'Replace', path: 'active', value: 'False' }] }, token);
  ok(r.status === 200 && r.d.active === false, 'Entra’s way of saying it - "Replace", the string "False" - is understood', [r.status, r.d.active]);
  const t = await team();
  ok(!t.members.some(x => x.email === 'ana@acme-corp.com'), 'she is off the team', t.members.map(x => x.email));
  ok(!m.get('userteam:ana@acme-corp.com'), 'and no longer reaches it');
  const after = await call('/team/members', {}, ana);
  ok(after.status === 401, 'and the session she had a moment ago no longer works', after.status);
  const seen = await scim('GET', '/Users/' + anaId, undefined, token);
  ok(seen.status === 200 && seen.d.active === false, 'the directory still sees her, switched off', seen.d.active);
  const back = await scim('PUT', '/Users/' + anaId, { userName: 'ana@acme-corp.com', active: true }, token);
  ok(back.status === 200 && back.d.active === true && (await team()).members.some(x => x.email === 'ana@acme-corp.com'), 'switched back on (Okta’s PUT), she is back', back.status);
  const del = await scim('DELETE', '/Users/' + anaId, undefined, token);
  ok(del.status === 204 && !(await team()).members.some(x => x.email === 'ana@acme-corp.com'), 'DELETE takes her off too', del.status);
}

section('Entra switches her back on with the string "True"; a full team takes nobody');
{
  const back = await scim('PATCH', '/Users/' + anaId, { Operations: [{ op: 'Replace', path: 'active', value: 'True' }] }, token);
  ok(back.status === 200 && back.d.active === true && (await team()).members.some(x => x.email === 'ana@acme-corp.com'), '"True" puts her back', [back.status, back.d.active]);
  /* A malformed value is a directory's bug, not an instruction to switch
     somebody off. Each of these is refused and she stays exactly as she was -
     including a PATCH whose first operation was valid. */
  const on = async () => (await team()).members.some(x => x.email === 'ana@acme-corp.com');
  const bad1 = await scim('PATCH', '/Users/' + anaId, { Operations: [{ op: 'Replace', path: 'active', value: 'banana' }] }, token);
  ok(bad1.status === 400 && bad1.d.scimType === 'invalidValue' && await on(), 'PATCH active "banana" is refused, and she is still on', [bad1.status, bad1.d.scimType]);
  const bad2 = await scim('PUT', '/Users/' + anaId, { userName: 'ana@acme-corp.com', active: 'no' }, token);
  ok(bad2.status === 400 && await on(), 'PUT active "no" is refused, and she is still on', bad2.status);
  const bad3 = await scim('PATCH', '/Users/' + anaId, { Operations: [{ op: 'Replace', path: 'active', value: false }, { op: 'Replace', value: { active: 0 } }] }, token);
  ok(bad3.status === 400 && await on(), 'a PATCH with one bad operation changes nothing, the valid one included', bad3.status);
  const bad4 = await scim('POST', '/Users', { userName: 'new@acme-corp.com', active: 'yes' }, token);
  ok(bad4.status === 400 && !(await team()).members.some(x => x.email === 'new@acme-corp.com'), 'POST with active "yes" adds nobody', bad4.status);
  const t = await team();
  const limit = (await call('/team/members', {}, owner)).d.seats.limit;
  ok(limit > t.members.length, 'the team has a seat limit to reach', limit);
  const pad = [];
  for (let i = 0; t.members.length + pad.length < limit; i++) pad.push({ email: 'pad' + i + '@acme-corp.com', role: 'member', joinedAt: Date.now() });
  const full = Object.assign({}, t, { members: t.members.concat(pad) });
  await W.DB.put(env, 'team', t.id, full);
  const r = await scim('POST', '/Users', { userName: 'one-more@acme-corp.com' }, token);
  ok(r.status === 409 && !(await team()).members.some(x => x.email === 'one-more@acme-corp.com'), 'with every seat taken, the next is refused', r.status);
  await W.DB.put(env, 'team', t.id, t);
  await scim('DELETE', '/Users/' + anaId, undefined, token);
}

section('The owner is never the directory’s to remove');
{
  const list = await scim('GET', '/Users', undefined, token);
  const boss = list.d.Resources.find(x => x.userName === 'boss@acme-corp.com');
  const r = await scim('PATCH', '/Users/' + boss.id, { Operations: [{ op: 'replace', value: { active: false } }] }, token);
  ok(r.status === 400 && (await team()).members.some(x => x.email === 'boss@acme-corp.com' && x.role === 'owner'), 'refused, and the owner is still the owner', r.status);
  const ok2 = await call('/team/members', {}, owner);
  ok(ok2.status === 200, 'and still signed in', ok2.status);
  const rename = await scim('PATCH', '/Users/' + boss.id, { Operations: [{ op: 'replace', path: 'userName', value: 'x@acme-corp.com' }] }, token);
  ok(rename.status === 400, 'nor can an address be changed in place', rename.status);
}

section('Every change is in the team’s audit log');
{
  const log = JSON.parse(m.get('teamlog:' + teamId()) || '[]');
  const acts = log.map(x => x.action);
  ok(acts.includes('scim_token_created') && acts.includes('scim_user_added') && acts.includes('scim_user_removed'), 'added, removed and the token, all logged', acts);
  ok(log.filter(x => x.action === 'scim_user_removed').every(x => x.actor === 'scim' && x.target), 'each saying it was the directory, and who', log.filter(x => x.action === 'scim_user_removed'));
}

section('Removing access works with the emergency stop on');
{
  await scim('POST', '/Users', { userName: 'sam@acme-corp.com' }, token);
  const list = await scim('GET', '/Users', undefined, token);
  const sam = list.d.Resources.find(x => x.userName === 'sam@acme-corp.com');
  m.set('GLOBAL_KILL', '1');
  const r = await scim('DELETE', '/Users/' + sam.id, undefined, token);
  m.delete('GLOBAL_KILL');
  ok(r.status === 204 && !(await team()).members.some(x => x.email === 'sam@acme-corp.com'), 'removed while everything else is paused', r.status);
}

section('If the domain stops being proved, so does the directory');
{
  const t = await team();
  await W.DB.put(env, 'team', t.id, Object.assign({}, t, { sso: Object.assign({}, t.sso, { verified: false }) }));
  const r = await scim('GET', '/Users', undefined, token);
  ok(r.status === 401, 'an unproved domain: no directory', r.status);
  await W.DB.put(env, 'team', t.id, t);
}

section('A new token retires the old; switched off, nothing reaches it');
{
  const again = await call('/team/sso', { action: 'scim', on: true }, owner);
  const old = await scim('GET', '/Users', undefined, token);
  const fresh = await scim('GET', '/Users', undefined, again.d.token);
  ok(old.status === 401 && fresh.status === 200, 'the old token stops, the new one works', [old.status, fresh.status]);
  await call('/team/sso', { action: 'scim', on: false }, owner);
  const off = await scim('GET', '/Users', undefined, again.d.token);
  ok(off.status === 401, 'turned off: no token works', off.status);
  token = again.d.token;
}

if (report('a-company-directory-adds-and-removes-its-people') > 0) process.exitCode = 1;
done();
