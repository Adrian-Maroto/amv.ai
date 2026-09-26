/* AN APP YOU SIGN IN TO IS AN APP AMV CAN USE, AND NOTHING MORE THAN THAT.

   App connectors: Notion, Canva, Linear, Stripe and the rest, through each
   app's own official connector. Press Connect, sign in at the app, and chat
   can use it - asking before each action. Every step is a place a sign-in
   flow is classically wrong, so each is driven here against a fake app that
   behaves like the real ones: it names its metadata in a 401, publishes the
   documents, registers AMV on request, exchanges a code for a token only with
   the right PKCE verifier, and answers MCP over a stream it never closes.

   What has to hold:
     · discovery follows the app's own documents, and an endpoint they name on
       an internal address is refused, not fetched;
     · AMV registers itself once per return address, not once per sign-in;
     · the sign-in carries PKCE (S256) and the resource, the state is
       single-use and belongs to the account that started it;
     · the token is sealed at rest - never readable in the store, never sent
       to the page;
     · tools are listed and called through a session, a reply is read from a
       stream that stays open, and a result is bounded;
     · an expiring token is refreshed; one the app refuses marks the
       connection broken and says reconnect;
     · disconnecting revokes at the app and forgets it either way. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { webcrypto } from 'crypto';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'rmcp.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, issueTokens, connOpen, REMOTE_APPS, PER_USER_KINDS, BACKUP_NEVER, EXPORT_REDACTED };\n');
const W = await import(harness + '?t=' + Date.now());

const ME = 'alex@example.com', OTHER = 'sam@example.com';
const ctx = { waitUntil() {}, passThroughOnException() {} };

function mkEnv(extra) {
  const m = new Map();
  return Object.assign({
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
    JWT_SECRET: 'j'.repeat(40), ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    CONNECT_KEY: 'the-secret-this-deployment-seals-connections-with',
  }, extra || {});
}
const tok = async (env, email) => (await W.issueTokens(env, email, email.split('@')[0])).token;
const call = async (env, path, body, t) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '44.44.44.44', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    body: JSON.stringify(body || {}),
  }), env, ctx);
  let d = {}; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
};

/* ── THE FAKE APP (answers as mcp.notion.com, the first entry) ──────────── */
const APP = 'https://mcp.notion.com';
let app;
function resetApp(over) {
  app = Object.assign({
    registrations: [], tokenCalls: [], rpc: [], revoked: [], fetched: [],
    prm: { resource: APP + '/mcp', authorization_servers: [APP] },
    as: { issuer: APP, authorization_endpoint: APP + '/authorize', token_endpoint: APP + '/token',
          registration_endpoint: APP + '/register', revocation_endpoint: APP + '/revoke', code_challenge_methods_supported: ['S256'] },
    codes: {}, access: 'at-1', refresh: 'rt-1', expiresIn: 3600, refuseRefresh: false, rejectToken: false,
    tools: [{ name: 'search', description: 'Search pages', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }],
    bigResult: false,
  }, over || {});
}
const J = (status, body, headers) => new Response(JSON.stringify(body), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) });
/* An event stream that sends the reply and then stays open, the way a server
   that multiplexes other messages over it does. */
function openStream(msg, sid) {
  const enc = new TextEncoder();
  const body = new ReadableStream({ start(c) { c.enqueue(enc.encode('event: message\ndata: ' + JSON.stringify(msg) + '\n\n')); /* never closed */ } });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': sid } });
}
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url && url.url ? url.url : url));
  app.fetched.push(u.toString());
  if (u.origin !== APP) throw new Error('the suite reached an address it does not stub: ' + u);
  const method = (init && init.method) || 'GET';
  const auth = (init && init.headers && (init.headers.Authorization || init.headers.authorization)) || '';
  if (u.pathname === '/mcp' && method === 'POST') {
    if (!auth) return new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="' + APP + '/.well-known/oauth-protected-resource/mcp"' } });
    if (app.rejectToken || auth !== 'Bearer ' + app.access) return new Response('', { status: 401 });
    const msg = JSON.parse(init.body);
    const sid = (init.headers['Mcp-Session-Id']) || '';
    app.rpc.push({ method: msg.method, sid, params: msg.params });
    if (msg.method === 'initialize') return J(200, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake' } } }, { 'Mcp-Session-Id': 'sess-42' });
    if (msg.method === 'notifications/initialized') return new Response('', { status: 202 });
    if (sid !== 'sess-42') return J(400, { jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'no session' } });
    if (msg.method === 'tools/list') return openStream({ jsonrpc: '2.0', id: msg.id, result: { tools: app.tools } }, 'sess-42');
    if (msg.method === 'tools/call') {
      const text = app.bigResult ? 'x'.repeat(200000) : 'found: ' + JSON.stringify(msg.params.arguments);
      return openStream({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }], isError: false } }, 'sess-42');
    }
    return J(200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'nope' } });
  }
  if (u.pathname === '/.well-known/oauth-protected-resource/mcp') return J(200, app.prm);
  if (u.pathname === '/.well-known/oauth-authorization-server') return J(200, app.as);
  if (u.pathname === '/register') { const b = JSON.parse(init.body); app.registrations.push(b); return J(201, { client_id: 'cid-' + app.registrations.length, token_endpoint_auth_method: 'none' }); }
  if (u.pathname === '/token') {
    const p = Object.fromEntries(new URLSearchParams(String(init.body)));
    app.tokenCalls.push(p);
    if (p.grant_type === 'authorization_code') {
      const want = app.codes[p.code];
      if (!want) return J(400, { error: 'invalid_grant' });
      const d = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(p.code_verifier));
      const ch = Buffer.from(d).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (ch !== want) return J(400, { error: 'invalid_grant', error_description: 'pkce' });
      return J(200, { access_token: app.access, refresh_token: app.refresh, expires_in: app.expiresIn, token_type: 'Bearer' });
    }
    if (p.grant_type === 'refresh_token') {
      if (app.refuseRefresh || p.refresh_token !== app.refresh) return J(400, { error: 'invalid_grant' });
      app.access = 'at-2'; app.refresh = 'rt-2';
      return J(200, { access_token: app.access, refresh_token: app.refresh, expires_in: 3600 });
    }
  }
  if (u.pathname === '/revoke') { app.revoked.push(Object.fromEntries(new URLSearchParams(String(init.body)))); return new Response('', { status: 200 }); }
  return new Response('not found', { status: 404 });
};

/* A call that must answer within a limit of the suite's own, so a reader that
   waits on a stream that never ends fails with a sentence instead of hanging. */
const limited = (p) => Promise.race([p, new Promise(res => setTimeout(() => res({ status: 'hung', d: {} }), 8000))]);

/* Signs in all the way: start, "approve at the app", finish. */
async function signIn(env, t) {
  const s = await call(env, '/v1/remote/start', { app: 'notion', redirect: 'https://amv.test/' }, t);
  const url = new URL(s.d.url);
  const code = 'code-' + Math.random().toString(36).slice(2);
  app.codes[code] = url.searchParams.get('code_challenge');
  const f = await call(env, '/v1/remote/finish', { code, state: url.searchParams.get('state') }, t);
  return { s, url, f, code };
}

section('Every app on the list is published under its own verified name');
{
  const apps = Object.entries(W.REMOTE_APPS);
  ok(apps.length >= 15, 'there are real apps to connect', apps.length);
  ok(apps.every(([, a]) => /^https:\/\//.test(a.url) && /^(com|app|io)\.[a-z0-9.-]+\/[\w.-]+$/.test(a.reg)),
     'each names the registry entry it came from and an https connector', apps.filter(([, a]) => !/^https:/.test(a.url)).map(([k]) => k));
  /* The registry grants `com.notion` only to whoever proves they own
     notion.com. A proxy run by somebody else sits under their name, not the
     app's - so the namespace must be the app's own. */
  const owns = { notion: 'notion', linear: 'linear', canva: 'canva', stripe: 'stripe', paypal: 'paypal', figma: 'figma', zapier: 'zapier' };
  ok(Object.entries(owns).every(([k, n]) => W.REMOTE_APPS[k] && W.REMOTE_APPS[k].reg.includes(n) && new URL(W.REMOTE_APPS[k].url).hostname.includes(n)),
     'and the name and the address are both the app’s own', Object.keys(owns));
}

section('Not set up, it says so and starts nothing');
{
  resetApp();
  const env = mkEnv({ CONNECT_KEY: '' });
  const t = await tok(env, ME);
  const r = await call(env, '/v1/remote/start', { app: 'notion', redirect: 'https://amv.test/' }, t);
  ok(r.status === 503 && r.d.code === 'connect_key_missing', 'no key, no sign-in - a token would be stored unencrypted', r);
  ok(app.fetched.length === 0, 'and nothing was asked of the app', app.fetched);
}

section('Starting: the app’s own documents, one registration, PKCE and the resource');
{
  resetApp();
  const env = mkEnv();
  const t = await tok(env, ME);
  const s = await call(env, '/v1/remote/start', { app: 'notion', redirect: 'https://amv.test/' }, t);
  ok(s.status === 200 && s.d.url, 'a sign-in address comes back', s);
  const u = new URL(s.d.url);
  ok(u.origin + u.pathname === APP + '/authorize', 'at the endpoint the app’s metadata named', u.origin + u.pathname);
  ok(u.searchParams.get('code_challenge_method') === 'S256' && (u.searchParams.get('code_challenge') || '').length >= 43, 'with PKCE, S256', u.search);
  ok(u.searchParams.get('resource') === APP + '/mcp', 'naming the connector as the resource', u.searchParams.get('resource'));
  ok(/^r_/.test(u.searchParams.get('state') || '') && u.searchParams.get('redirect_uri') === 'https://amv.test/', 'with a state that says it is an app connector, returning here', u.search);
  ok(app.registrations.length === 1 && app.registrations[0].redirect_uris[0] === 'https://amv.test/' && app.registrations[0].token_endpoint_auth_method === 'none',
     'AMV registered itself with the app, as a public client', app.registrations);
  await call(env, '/v1/remote/start', { app: 'notion', redirect: 'https://amv.test/' }, t);
  ok(app.registrations.length === 1, 'and a second sign-in reuses the registration', app.registrations.length);
  const bad = await call(env, '/v1/remote/start', { app: 'notion', redirect: 'https://evil.example/' }, t);
  ok(bad.status === 400 && bad.d.error === 'bad_redirect', 'a return address that is not this deployment is refused', bad);
  const unk = await call(env, '/v1/remote/start', { app: 'constructor' }, t);
  ok(unk.status === 400 && unk.d.error === 'unknown_app', 'an app not on the list is refused, including a name every object has', unk);
}

section('An endpoint the app’s documents point at inside the network is never fetched');
{
  const env = mkEnv();
  const t = await tok(env, ME);
  /* Each on its own, because the token address is not fetched until the
     finish: a sign-in that started on a poisoned token endpoint would send the
     code, the verifier and the client there a minute later. */
  for (const [what, as] of [
    ['token', { authorization_endpoint: APP + '/authorize', token_endpoint: 'http://169.254.169.254/token', registration_endpoint: APP + '/register' }],
    ['registration', { authorization_endpoint: APP + '/authorize', token_endpoint: APP + '/token', registration_endpoint: 'https://localhost/register' }],
    ['authorization', { authorization_endpoint: 'https://10.0.0.5/authorize', token_endpoint: APP + '/token', registration_endpoint: APP + '/register' }],
  ]) {
    resetApp({ as });
    const r = await call(env, '/v1/remote/start', { app: 'notion', redirect: 'https://amv.test/' }, t);
    ok(r.status === 502 && !r.d.url, 'an internal ' + what + ' address: the sign-in does not start', r);
    ok(!app.fetched.some(x => /169\.254|localhost|10\.0\.0\.5/.test(x)), 'and it was never reached', app.fetched);
  }
  resetApp({ prm: { resource: 'https://elsewhere.example/api', authorization_servers: [APP] } });
  const r2 = await call(env, '/v1/remote/start', { app: 'notion', redirect: 'https://amv.test/' }, t);
  ok(new URL(r2.d.url).searchParams.get('resource') === 'https://mcp.notion.com/mcp', 'a document naming another origin as the resource is not believed', r2.d.url);
}

section('Finishing: only the account that started it, only once, only with the verifier');
{
  resetApp();
  const env = mkEnv();
  const t = await tok(env, ME), t2 = await tok(env, OTHER);
  const s = await call(env, '/v1/remote/start', { app: 'notion', redirect: 'https://amv.test/' }, t);
  const u = new URL(s.d.url), state = u.searchParams.get('state');
  app.codes.c1 = u.searchParams.get('code_challenge');
  const theirs = await call(env, '/v1/remote/finish', { code: 'c1', state }, t2);
  ok(theirs.d.error === 'state_mismatch', 'another account cannot finish it', theirs.d);
  const again = await call(env, '/v1/remote/finish', { code: 'c1', state }, t);
  ok(again.d.error === 'unknown_state', 'and it was spent by the attempt - the state is single use', again.d);
  const { f } = await signIn(env, t);
  ok(f.status === 200 && f.d.ok && f.d.name === 'Notion', 'the right account, the right verifier: connected', f);
  const codeCall = app.tokenCalls.find(p => p.grant_type === 'authorization_code' && p.code_verifier);
  ok(codeCall && codeCall.resource === APP + '/mcp' && codeCall.client_id, 'the exchange sent the verifier, the resource and the client', codeCall);
  const raw = [...env.AMV_KV._map.entries()].filter(([k]) => k.startsWith('rmcp:')).map(([, v]) => String(v)).join(' ');
  ok(raw && !raw.includes('at-1') && !raw.includes('rt-1'), 'the tokens are sealed in the store, not readable', raw.slice(0, 80));
  const list = await call(env, '/v1/remote/list', {}, t);
  const n = (list.d.apps || []).find(a => a.slug === 'notion');
  ok(n && n.connected && !JSON.stringify(list.d).includes('at-1'), 'the list says connected, and carries no token', n);
  const other = await call(env, '/v1/remote/list', {}, t2);
  ok(!((other.d.apps || []).find(a => a.slug === 'notion') || {}).connected, 'and it is this account’s, not the other’s', other.d.apps && other.d.apps[0]);
}

section('Tools: listed through a session, from a stream that never closes');
{
  resetApp();
  const env = mkEnv();
  const t = await tok(env, ME);
  await signIn(env, t);
  const t0 = Date.now();
  /* Raced against a limit of our own: a reader that waits for the stream to
     end would wait for ever here, and that has to fail with a sentence rather
     than hang the gate. */
  const r = await Promise.race([call(env, '/v1/remote/tools', { app: 'notion' }, t),
    new Promise(res => setTimeout(() => res({ status: 'hung', d: {} }), 8000))]);
  ok(r.status === 200 && r.d.tools && r.d.tools[0].name === 'search', 'the app’s tools come back', r.status);
  ok(Date.now() - t0 < 5000, 'without waiting for the stream to end', Date.now() - t0);
  const list = app.rpc.find(x => x.method === 'tools/list');
  ok(app.rpc[0].method === 'initialize' && list && list.sid === 'sess-42', 'after initialize, carrying the session it was given', app.rpc);
  const c = await limited(call(env, '/v1/remote/call', { app: 'notion', tool: 'search', args: { q: 'roadmap' } }, t));
  ok(c.status === 200 && c.d.content && /found: \{"q":"roadmap"\}/.test(c.d.content[0].text), 'a call runs with its arguments and returns the result', c.d);
  app.bigResult = true;
  const big = await limited(call(env, '/v1/remote/call', { app: 'notion', tool: 'search', args: {} }, t));
  ok(big.status === 200 && big.d.content && big.d.content[0].text.length <= 60000, 'a huge result is bounded', big.d.content && big.d.content[0].text.length);
  const nope = await call(env, '/v1/remote/call', { app: 'linear', tool: 'search', args: {} }, t);
  ok(nope.status === 404 && nope.d.error === 'not_connected', 'an app this account has not connected cannot be called', nope);
  const anon = await call(env, '/v1/remote/call', { app: 'notion', tool: 'search', args: {} });
  ok(anon.status === 401, 'nor by anybody signed out', anon.status);
}

section('An expiring sign-in renews itself; one the app refuses says reconnect');
{
  resetApp({ expiresIn: 1 });
  const env = mkEnv();
  const t = await tok(env, ME);
  await signIn(env, t);
  const r = await call(env, '/v1/remote/tools', { app: 'notion' }, t);
  ok(r.status === 200 && app.tokenCalls.some(p => p.grant_type === 'refresh_token'), 'an expired token was refreshed first', app.tokenCalls.map(p => p.grant_type));
  ok(app.rpc.some(x => x.method === 'tools/list'), 'and the call went through on the new one', app.rpc.length);
  app.expiresIn = 1;
  resetApp({ expiresIn: 1, refuseRefresh: true });
  const env2 = mkEnv(); const t2 = await tok(env2, ME);
  await signIn(env2, t2);
  const r2 = await call(env2, '/v1/remote/tools', { app: 'notion' }, t2);
  ok(r2.status === 401 && r2.d.error === 'reconnect', 'a refused refresh asks to reconnect', r2);
  const l2 = await call(env2, '/v1/remote/list', {}, t2);
  ok(l2.d.apps.find(a => a.slug === 'notion').broken === true, 'and the list says it is broken, so the page can say so', l2.d.apps[0]);
  resetApp();
  const env3 = mkEnv(); const t3 = await tok(env3, ME);
  await signIn(env3, t3);
  app.rejectToken = true;
  const r3 = await call(env3, '/v1/remote/call', { app: 'notion', tool: 'search', args: {} }, t3);
  ok(r3.status === 401 && r3.d.error === 'reconnect', 'an app that stops accepting the token: reconnect, in words', r3.d);
}

section('Disconnecting revokes at the app and forgets it');
{
  resetApp();
  const env = mkEnv();
  const t = await tok(env, ME);
  await signIn(env, t);
  const r = await call(env, '/v1/remote/remove', { app: 'notion' }, t);
  ok(r.status === 200 && r.d.revoked === true, 'the app confirmed the revocation', r.d);
  ok(app.revoked.length === 1 && app.revoked[0].token === 'rt-1', 'with the refresh token, so the whole grant goes', app.revoked);
  const l = await call(env, '/v1/remote/list', {}, t);
  ok(!l.d.apps.find(a => a.slug === 'notion').connected, 'and it is gone from the list', l.d.apps[0]);
}

section('It goes with the account, and never into a backup or an export');
{
  ok(W.PER_USER_KINDS.includes('rmcp'), 'erased with the account', true);
  ok(W.BACKUP_NEVER.includes('rmcp:') && W.BACKUP_NEVER.includes('rmcpstate:') && W.BACKUP_NEVER.includes('rmcpcli:'), 'never in a backup', true);
  ok(!!W.EXPORT_REDACTED.rmcp, 'and disclosed, not handed over, in an export', W.EXPORT_REDACTED.rmcp);
}

if (report('an-app-you-sign-in-to-is-an-app-amv-can-use') > 0) process.exitCode = 1;
done();
/* A reader left waiting on a stream that never ends would keep the process
   alive; the verdict above is already written. */
setTimeout(() => process.exit(process.exitCode || 0), 50).unref();
