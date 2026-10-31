/* A COMPANY SIGNS ITS PEOPLE IN - AND ONLY ITS OWN PEOPLE.

   Company sign-in (OpenID Connect), driven through the Worker's own routes
   against a real identity provider stood up in this file: its own signing
   keys, its discovery document, its token endpoint and its key set, and DNS
   answered the way a resolver would. Every id token is signed for real, so a
   check that is skipped is a check that fails here:

   - only the team's owner configures it; a public mail domain is refused;
   - an unproved domain signs nobody in, and proving it takes the DNS record;
     another team cannot take a domain somebody already proved;
   - sign-in starts with state, nonce and PKCE, and the state is spent once;
   - a good token signs the person in AND seats them in the team;
   - a token with a bad signature, from the wrong issuer, for another
     audience, expired, with the wrong nonce, signed `none`, or for an address
     outside the domain - each is refused;
   - "require company sign-in" refuses passwords and Google for the domain,
     never for the owner;
   - no free seat is said as that. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'sso.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());

const ISS = 'https://login.acme-corp.example';
const CLIENT = 'amv-client-123';
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const rsa = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const stranger = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pubJwk = Object.assign(await crypto.subtle.exportKey('jwk', rsa.publicKey), { kid: 'k1', use: 'sig', alg: 'RS256' });

async function sign(claims, opts = {}){
  const header = { alg: opts.alg || 'RS256', kid: opts.kid || 'k1', typ: 'JWT' };
  const head = b64u(JSON.stringify(header)) + '.' + b64u(JSON.stringify(claims));
  if (header.alg === 'none') return head + '.';
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', (opts.key || rsa).privateKey, new TextEncoder().encode(head));
  return head + '.' + b64u(sig);
}

/* The provider. `nextClaims(params)` decides what the next token says. */
let dnsTxt = [], nextToken = null, lastTokenReq = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url instanceof Request ? url.url : url);
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith('https://cloudflare-dns.com/dns-query')) {
    return reply(200, { Status: 0, Answer: dnsTxt.map(t => ({ name: '_amv-verify.acme-corp.com', type: 16, data: '"' + t + '"' })) });
  }
  if (u === ISS + '/.well-known/openid-configuration') return reply(200, {
    issuer: ISS, authorization_endpoint: ISS + '/authorize', token_endpoint: ISS + '/token', jwks_uri: ISS + '/keys' });
  if (u === ISS + '/keys') return reply(200, { keys: [pubJwk] });
  if (u === ISS + '/token') {
    lastTokenReq = Object.fromEntries(new URLSearchParams(String(init.body)));
    return reply(200, { id_token: await nextToken(lastTokenReq), access_token: 'x', token_type: 'Bearer' });
  }
  return realFetch(url, init);
};

function mkEnv(){
  const m = new Map(), vals = new Map();
  return {
    JWT_SECRET: 'j'.repeat(40), ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test', CONNECT_KEY: 'c'.repeat(44),
    AMV_KV: { async get(k){ return m.has(k) ? m.get(k) : null; }, async put(k, v){ m.set(k, v); }, async delete(k){ m.delete(k); },
      async list({ prefix } = {}){ return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
    AMV_COUNTER: withAuthOps({ idFromName: n => n, get: n => ({ async fetch(_u, init){
      const b = JSON.parse(init.body || '{}'); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
      if (b.op === 'incr'){ vals.set(n, cur + Number(b.amount || 0)); return r({ value: vals.get(n) }); }
      if (b.op === 'get') return r({ value: cur });
      return r({ allowed: true, value: cur, count: 1 });
    } }) }),
  };
}
const ctx = { waitUntil(){}, passThroughOnException(){} };
let ip = 1;
const env = mkEnv();
const call = async (path, body, tok) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.7.0.' + (ip++ % 200 + 1), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
    body: JSON.stringify(body || {}) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
async function account(email, plan){
  const tok = (await call('/auth/signup', { email, name: 'X', password: 'A-real-Passw0rd!' })).d.token;
  if (plan) await W.DB.put(env, 'ent', email, { plan, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return tok;
}
const owner = await account('boss@acme-corp.com', 'ultra');
await call('/team/create', { name: 'Acme' }, owner);
const now = () => Math.floor(Date.now() / 1000);
const good = (p, over = {}) => Object.assign({ iss: ISS, aud: CLIENT, sub: 'u-1', email: 'ana@acme-corp.com', email_verified: true,
  name: 'Ana', iat: now(), exp: now() + 300, nonce: p.nonce }, over);

section('Only the owner sets it up, and never on a public mail domain');
{
  const member = await account('outsider@acme-corp.com');
  const r = await call('/team/sso', { action: 'set', domain: 'acme-corp.com', issuer: ISS, clientId: CLIENT, clientSecret: 's3cret' }, member);
  ok(r.status === 404 || r.status === 403, 'somebody not owning the team cannot', r);
  const g = await call('/team/sso', { action: 'set', domain: 'gmail.com', issuer: ISS, clientId: CLIENT, clientSecret: 's3cret' }, owner);
  ok(g.status === 400 && g.d.code === 'public_domain', 'gmail.com is refused outright', g.d);
  const s = await call('/team/sso', { action: 'set', domain: 'acme-corp.com', issuer: ISS, clientId: CLIENT, clientSecret: 's3cret' }, owner);
  ok(s.status === 200 && s.d.sso.verified === false && /^amv-verify=[0-9a-f]{32}$/.test(s.d.sso.record.value), 'set, unproved, with the record to add', s.d);
  ok(!JSON.stringify(s.d).includes('s3cret'), 'and the secret is never sent back');
  globalThis.__record = s.d.sso.record.value;
}

section('An unproved domain signs nobody in; the DNS record proves it');
{
  const a = await call('/auth/sso/start', { email: 'ana@acme-corp.com' });
  ok(a.status === 200 && a.d.sso === false, 'before the proof: no company sign-in', a.d);
  dnsTxt = ['amv-verify=00000000000000000000000000000000'];
  const wrong = await call('/team/sso', { action: 'verify' }, owner);
  ok(wrong.d.verified === false, 'a different record proves nothing', wrong.d);
  dnsTxt = [globalThis.__record];
  const v = await call('/team/sso', { action: 'verify' }, owner);
  ok(v.status === 200 && v.d.verified === true, 'the right record proves it', v.d);
}

section('Another team cannot take a domain already proved');
{
  const other = await account('rival@rival.example', 'ultra');
  await call('/team/create', { name: 'Rival' }, other);
  const set = await call('/team/sso', { action: 'set', domain: 'acme-corp.com', issuer: ISS, clientId: CLIENT, clientSecret: 'x' }, other);
  ok(set.d.sso.record.value !== globalThis.__record, 'its proof is its own - Acme’s record proves nothing for it');
  dnsTxt = [globalThis.__record, set.d.sso.record.value];
  const v = await call('/team/sso', { action: 'verify' }, other);
  ok(v.status === 409 && v.d.code === 'domain_taken', 'refused, even with its own record in place', v.d);
  dnsTxt = [globalThis.__record];
}

/* Start a sign-in, and come back with whatever the provider says. */
async function signIn(claimsFor, opts){
  const s = await call('/auth/sso/start', { email: 'ana@acme-corp.com' });
  const u = new URL(s.d.url);
  const p = Object.fromEntries(u.searchParams);
  nextToken = async () => sign(claimsFor(p), opts);
  const f = await call('/auth/sso/finish', { code: 'the-code', state: p.state });
  return { start: s, p, f };
}

section('A domain on record but never marked proved signs nobody in');
{
  /* The state a verify leaves if the domain is written and the team record is
     not: the team itself still says unproved, and that is what decides. */
  const other = await account('half@half-done.example', 'ultra');
  await call('/team/create', { name: 'Half' }, other);
  await call('/team/sso', { action: 'set', domain: 'half-done.example', issuer: ISS, clientId: CLIENT, clientSecret: 'x' }, other);
  await env.AMV_KV.put('ssodom:half-done.example', await env.AMV_KV.get('userteam:half@half-done.example'));
  const s = await call('/auth/sso/start', { email: 'someone@half-done.example' });
  ok(s.d.sso === false, 'no company sign-in until the team record says proved', s.d);
}

section('Sign-in starts bound to this request');
{
  const s = await call('/auth/sso/start', { email: 'ana@acme-corp.com' });
  const u = new URL(s.d.url);
  ok(u.origin + u.pathname === ISS + '/authorize', 'it goes to the company’s provider', s.d.url);
  ok(/^s_/.test(u.searchParams.get('state')) && u.searchParams.get('nonce') && u.searchParams.get('code_challenge_method') === 'S256'
     && u.searchParams.get('client_id') === CLIENT && u.searchParams.get('redirect_uri') === 'https://amv.test/', 'with state, nonce, PKCE and AMV’s address', Object.fromEntries(u.searchParams));
}

section('Each bad token is refused, and nobody is signed in');
{
  const cases = [
    ['a signature from another key', (p) => good(p), { key: stranger }],
    ['another issuer', (p) => good(p, { iss: 'https://evil.example' })],
    ['another audience', (p) => good(p, { aud: 'someone-else' })],
    ['expired', (p) => good(p, { exp: now() - 600 })],
    ['the wrong nonce', (p) => good(p, { nonce: 'not-it' })],
    ['signed "none"', (p) => good(p), { alg: 'none' }],
    ['an address outside the domain', (p) => good(p, { email: 'victim@other-company.com' })],
    ['an address the provider says is unverified', (p) => good(p, { email_verified: false })],
  ];
  for (const [what, claims, opts] of cases) {
    const r = await signIn(claims, opts);
    ok(r.f.status === 401 && !r.f.d.token, what + ': refused', r.f.d);
  }
}

section('A good token signs them in and seats them in the team');
{
  const r = await signIn((p) => good(p));
  ok(r.f.status === 200 && r.f.d.token && r.f.d.email === 'ana@acme-corp.com', 'signed in as the address the provider vouched for', r.f.d.email);
  ok(lastTokenReq.code_verifier && lastTokenReq.client_secret === 's3cret' && lastTokenReq.redirect_uri === 'https://amv.test/', 'the code was exchanged with the verifier and the stored secret');
  const t = await call('/team/get', {}, r.f.d.token);
  ok(t.d.team && t.d.team.name === 'Acme' && t.d.team.members.some(m => m.email === 'ana@acme-corp.com'), 'and she is in Acme', t.d.team && t.d.team.members);
  const again = await call('/auth/sso/finish', { code: 'the-code', state: r.p.state });
  ok(again.status === 400 && again.d.code === 'sso_bad_state', 'the same return used twice is refused', again.d);
}

section('A stranger who signed up with the address first loses it to the company’s word');
{
  /* Signed up with Mia's work address, never confirmed it - and holds a session. */
  const squat = (await call('/auth/signup', { email: 'mia@acme-corp.com', name: 'Not Mia', password: 'Squatter-Passw0rd!' })).d.token;
  ok(!!squat, 'the stranger has a session on an unconfirmed account');
  const r = await signIn((p) => good(p, { email: 'mia@acme-corp.com', sub: 'u-mia', name: 'Mia' }));
  ok(r.f.status === 200 && r.f.d.email === 'mia@acme-corp.com', 'Mia signs in through her company', r.f.d.email);
  const again = await call('/auth/login', { email: 'mia@acme-corp.com', password: 'Squatter-Passw0rd!' });
  ok(!again.d.token, 'the stranger’s password no longer opens it', again.d);
  const old = await call('/team/get', {}, squat);
  ok(old.status === 401, 'and the stranger’s session is over', old.status);
}

section('Requiring company sign-in turns off passwords for the domain - not for the owner');
{
  const req = await call('/team/sso', { action: 'require', on: true }, owner);
  ok(req.status === 200 && req.d.sso.required === true, 'required', req.d);
  await call('/auth/signup', { email: 'leo@acme-corp.com', name: 'L', password: 'A-real-Passw0rd!' });
  const l = await call('/auth/login', { email: 'leo@acme-corp.com', password: 'A-real-Passw0rd!' });
  ok(l.status === 403 && l.d.code === 'sso_required' && !l.d.token, 'a password sign-in at the domain is sent to the company', l.d);
  const o = await call('/auth/login', { email: 'boss@acme-corp.com', password: 'A-real-Passw0rd!' });
  ok(o.d.code !== 'sso_required', 'the owner can still get in, so a broken provider cannot lock everybody out', o.d.code || o.status);
  const elsewhere = await call('/auth/login', { email: 'rival@rival.example', password: 'A-real-Passw0rd!' });
  ok(elsewhere.d.code !== 'sso_required', 'and other domains are untouched');
  await call('/team/sso', { action: 'require', on: false }, owner);
}

section('No free seat is said as that');
{
  const t = await W.DB.get(env, 'team', (await env.AMV_KV.get('userteam:boss@acme-corp.com')));
  t.members = t.members.concat(Array.from({ length: 60 }, (_, i) => ({ email: 'f' + i + '@acme-corp.com', role: 'member', joinedAt: 1 })));
  await W.DB.put(env, 'team', t.id, t);
  const r = await signIn((p) => good(p, { email: 'new@acme-corp.com', sub: 'u-9' }));
  ok(r.f.status === 402 && r.f.d.code === 'seat_limit' && !r.f.d.token, 'refused, and says to ask for a seat', r.f.d);
}

section('Removing it frees the domain');
{
  const r = await call('/team/sso', { action: 'remove' }, owner);
  ok(r.status === 200 && r.d.sso === null, 'removed');
  const s = await call('/auth/sso/start', { email: 'ana@acme-corp.com' });
  ok(s.d.sso === false, 'and nobody signs in through it any more', s.d);
}

if (report('a-company-signs-in-only-its-own-people') > 0) process.exitCode = 1;
done();
