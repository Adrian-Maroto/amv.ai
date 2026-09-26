/* AN APP WITH A PUBLIC API CONNECTS, AND ITS TOKEN STAYS IN ITS LANE.

   Slack, Spotify, Dropbox, HubSpot and the rest publish no official connector,
   so they connect through their own standard sign-in (CONN_PROVIDERS) and chat
   uses their API through /v1/connect/api. Each provider has quirks, and each
   quirk is a way for a sign-in to fail at the one moment somebody tries it -
   so they are data in the table and asserted here against what goes out:
     · Slack's user token: scopes in `user_scope`, joined with commas, and the
       token nested under `authed_user` in the reply;
     · Spotify, Zoom, Reddit, Pinterest: the client secret in a Basic header,
       never in the body;
     · scopes fixed in the app (Zoom, Box, Calendly): none asked for;
     · a token with no stated lifetime (GitHub, Slack) is not "expired" after
       an hour - which the old default of 3600 made it;
     · each revoke style reaches its endpoint the way that provider wants,
       and Google's is exactly what it was.
   And the API route, which is the one that holds real power:
     · a path can only be a path under that provider's own API;
     · a call for one provider can never be given another provider's token,
       even where the two share capability names (mail.read);
     · not connected, not signed in: refused. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'apiapps.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, issueTokens, connSeal, connOpen, CONN_PROVIDERS, CONN_KV, _connRevokeRequest, _connApiUrl };\n');
const W = await import(harness + '?t=' + Date.now());

const ME = 'alex@example.com';
const ctx = { waitUntil() {}, passThroughOnException() {} };
const SECRETS = {};
for (const k of Object.keys(W.CONN_PROVIDERS)) { const p = W.CONN_PROVIDERS[k]; SECRETS[p.idEnv] = k + '-id'; SECRETS[p.secretEnv] = k + '-secret'; }
function mkEnv() {
  const m = new Map();
  return Object.assign({
    AMV_KV: { _map: m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0 })); } }) },
    JWT_SECRET: 'j'.repeat(40), ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    CONNECT_KEY: 'the-secret-this-deployment-seals-connections-with',
  }, SECRETS);
}
const call = async (env, path, body, t) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '44.44.44.44', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    body: JSON.stringify(body || {}) }), env, ctx);
  let d = {}; try { d = await r.json(); } catch (e) {} return { status: r.status, d };
};
const tok = async (env) => (await W.issueTokens(env, ME, 'alex')).token;

/* Every provider endpoint, answered here and recorded. */
let sent = [], tokenReply = () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
globalThis.fetch = async (url, init) => {
  const u = String(url && url.url ? url.url : url);
  const h = Object.assign({}, (init && init.headers) || {});
  sent.push({ url: u, method: (init && init.method) || 'GET', headers: h, body: String((init && init.body) || '') });
  if (Object.values(W.CONN_PROVIDERS).some(p => p.token === u)) return new Response(JSON.stringify(tokenReply(u)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (Object.values(W.CONN_PROVIDERS).some(p => p.revoke === u)) return new Response('{}', { status: 200 });
  return new Response(JSON.stringify({ ok: true, echo: u }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const form = (b) => Object.fromEntries(new URLSearchParams(b));

async function connect(env, t, provider, scopes, reply) {
  if (reply) tokenReply = reply;
  const s = await call(env, '/v1/connect/start', { provider, scopes, redirect: 'https://amv.test/' }, t);
  const u = new URL(s.d.url);
  sent = [];
  const f = await call(env, '/v1/connect/finish', { code: 'code-1', state: u.searchParams.get('state') }, t);
  const ex = sent.find(x => x.url === W.CONN_PROVIDERS[provider].token);
  tokenReply = () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
  return { u, f, ex };
}

section('Every app in the table names its sign-in, its API and a secret pair of its own');
{
  const ps = Object.entries(W.CONN_PROVIDERS);
  ok(ps.length >= 15, 'the providers are there', ps.map(([k]) => k));
  const ids = ps.map(([, p]) => p.idEnv);
  ok(new Set(ids).size === ids.length, 'no two share a secret', ids);
  const api = ps.filter(([, p]) => p.api);
  ok(api.length >= 15 && api.every(([, p]) => /^https:\/\/[a-z0-9.-]+\/.*\/?$/.test(p.api.base) && p.api.base.endsWith('/')), 'each has an https API base, ending in a slash', api.map(([k, p]) => k + ' ' + p.api.base));
  ok(ps.every(([, p]) => /^https:\/\//.test(p.auth) && /^https:\/\//.test(p.token) && (!p.revoke || /^https:\/\//.test(p.revoke))), 'and every endpoint is https', true);
}

section('Slack: scopes in user_scope, joined with commas; the token under authed_user; it does not expire');
{
  const env = mkEnv(), t = await tok(env);
  const { u, f } = await connect(env, t, 'slack', ['slack.read', 'slack.write'],
    () => ({ ok: true, access_token: 'bot-should-not-be-used', authed_user: { id: 'U1', access_token: 'xoxp-user', token_type: 'user' } }));
  ok(!u.searchParams.has('scope') && /channels:read,.*chat:write/.test(u.searchParams.get('user_scope') || ''), 'the scopes go in user_scope, comma-joined', u.search);
  ok(f.status === 200 && f.d.unattended === true, 'connected, and a token with no lifetime counts as lasting', f.d);
  const all = await W.DB.get(env, W.CONN_KV, ME);
  const rec = Object.values(all)[0], opened = await W.connOpen(env, rec.sealed);
  ok(opened.access === 'xoxp-user' && opened.exp === 0, 'the person’s own token was kept, with no expiry', opened.exp);
}

section('Spotify: the secret goes in a Basic header, never in the body');
{
  const env = mkEnv(), t = await tok(env);
  const { ex } = await connect(env, t, 'spotify', ['spotify.read']);
  const b = form(ex.body);
  ok(ex.headers.Authorization === 'Basic ' + btoa('spotify-id:spotify-secret'), 'the client authenticates in the header', ex.headers.Authorization);
  ok(!('client_secret' in b), 'and the secret is not also in the body', Object.keys(b));
}

section('Scopes fixed in the app are not asked for; Dropbox asks for a lasting token');
{
  const env = mkEnv(), t = await tok(env);
  const z = await call(env, '/v1/connect/start', { provider: 'zoom', scopes: ['zoom.all'], redirect: 'https://amv.test/' }, t);
  ok(!new URL(z.d.url).searchParams.has('scope'), 'Zoom: no scope parameter', z.d.url);
  const d = await call(env, '/v1/connect/start', { provider: 'dropbox', scopes: ['dropbox.read'], redirect: 'https://amv.test/' }, t);
  ok(new URL(d.d.url).searchParams.get('token_access_type') === 'offline', 'Dropbox: token_access_type=offline, so it can refresh', d.d.url);
}

section('A token with no stated lifetime is not expired an hour later');
{
  const env = mkEnv(), t = await tok(env);
  await connect(env, t, 'github', ['repo.read'], () => ({ access_token: 'gho_x', token_type: 'bearer', scope: 'repo' }));
  const all = await W.DB.get(env, W.CONN_KV, ME);
  const id = Object.keys(all)[0];
  const opened = await W.connOpen(env, all[id].sealed);
  ok(opened.exp === 0, 'GitHub’s token is stored as not expiring', opened.exp);
  sent = [];
  const r = await call(env, '/v1/connect/api', { provider: 'github', method: 'GET', path: 'user/repos' }, t);
  ok(r.status === 200 && !sent.some(x => x.url === W.CONN_PROVIDERS.github.token), 'and using it later asks for no refresh it could never get', r);
}

section('The API route: a path can only be a path under that app’s own API');
{
  const base = W.CONN_PROVIDERS.slack.api.base;
  const good = W._connApiUrl(base, 'conversations.list', { limit: 5 });
  ok(good === 'https://slack.com/api/conversations.list?limit=5', 'a real path, with its query', good);
  for (const bad of ['https://evil.example/x', '//evil.example/x', '../x', 'a/../../x', '%2e%2e/x', 'a%2f..%2fx', 'a\\..\\x', 'javascript:alert(1)', '', 'x'.repeat(600)]) {
    ok(W._connApiUrl(base, bad) === '', 'refused: ' + bad.slice(0, 30), W._connApiUrl(base, bad));
  }
  const env = mkEnv(), t = await tok(env);
  await connect(env, t, 'slack', ['slack.read']);
  sent = [];
  const r = await call(env, '/v1/connect/api', { provider: 'slack', method: 'GET', path: '//evil.example/steal' }, t);
  ok(r.status === 400 && r.d.error === 'bad_path' && sent.length === 0, 'the route refuses it, and nothing goes out', r);
}

section('A call goes to its own app with its own token - never another’s');
{
  const env = mkEnv(), t = await tok(env);
  await connect(env, t, 'google', ['mail.read'], () => ({ access_token: 'GOOGLE-TOKEN', refresh_token: 'g', expires_in: 3600 }));
  await connect(env, t, 'microsoft', ['mail.read'], () => ({ access_token: 'MS-TOKEN', refresh_token: 'm', expires_in: 3600 }));
  sent = [];
  const r = await call(env, '/v1/connect/api', { provider: 'microsoft', method: 'GET', path: 'me/messages', query: { '$top': 3 } }, t);
  const out = sent.find(x => x.url.startsWith('https://graph.microsoft.com/'));
  ok(r.status === 200 && out, 'the call reached Microsoft Graph', r.status);
  ok(out && out.headers.Authorization === 'Bearer MS-TOKEN', 'with Microsoft’s token, though Google’s shares the capability name', out && out.headers.Authorization);
  ok(!sent.some(x => /GOOGLE-TOKEN/.test(JSON.stringify(x.headers)) && !x.url.includes('googleapis')), 'Google’s token went nowhere but Google', true);
  sent = [];
  const w = await call(env, '/v1/connect/api', { provider: 'microsoft', method: 'POST', path: 'me/sendMail', body: { message: { subject: 'hi' } } }, t);
  const post = sent.find(x => x.url.endsWith('/me/sendMail'));
  ok(w.status === 200 && post && post.method === 'POST' && JSON.parse(post.body).message.subject === 'hi' && /application\/json/.test(post.headers['Content-Type']), 'a write sends its JSON body', post);
  const nc = await call(env, '/v1/connect/api', { provider: 'spotify', method: 'GET', path: 'me' }, t);
  ok(nc.status === 404 && nc.d.error === 'not_connected', 'an app this account has not connected is refused', nc);
  const anon = await call(env, '/v1/connect/api', { provider: 'microsoft', method: 'GET', path: 'me' });
  ok(anon.status === 401, 'and nobody signed out can call anything', anon.status);
  const m = await call(env, '/v1/connect/api', { provider: 'microsoft', method: 'TRACE', path: 'me' }, t);
  ok(m.status === 400 && m.d.error === 'bad_method', 'an odd method is refused', m);
}

section('Each revoke reaches its endpoint the way that provider wants');
{
  const env = mkEnv();
  const cases = {
    dropbox: (x) => x.headers.Authorization === 'Bearer AT' && x.body === '',
    strava: (x) => form(x.body).access_token === 'AT',
    asana: (x) => form(x.body).token === 'RT' && form(x.body).client_id === 'asana-id' && form(x.body).client_secret === 'asana-secret',
    reddit: (x) => form(x.body).token === 'RT' && x.headers.Authorization === 'Basic ' + btoa('reddit-id:reddit-secret'),
    google: (x) => { const f = form(x.body); return f.token === 'RT' && Object.keys(f).length === 1 && !x.headers.Authorization; },
  };
  for (const [pid, check] of Object.entries(cases)) {
    sent = [];
    const r = await W._connRevokeRequest(env, W.CONN_PROVIDERS[pid], { access: 'AT', refresh: 'RT' });
    const x = sent.find(s => s.url === W.CONN_PROVIDERS[pid].revoke);
    ok(r.ok && x && check(x), pid + ': revoked as it expects', x && { headers: x.headers, body: x.body });
  }
  const none = await W._connRevokeRequest(env, W.CONN_PROVIDERS.spotify, { access: 'AT', refresh: 'RT' });
  ok(none.tried === false, 'Spotify has no revoke endpoint, and none is invented', none);
}

if (report('an-app-with-a-public-api-connects-and-stays-in-its-lane') > 0) process.exitCode = 1;
done();
