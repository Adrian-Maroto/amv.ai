/* A MONTH-LONG CREDENTIAL, WHERE ANY SCRIPT COULD READ IT.

   A session is two tokens. The access token is short-lived and has to be
   readable by script, because it goes in an Authorization header. The refresh
   token is valid for a month and mints new access tokens on demand, so a copy
   of it is a copy of the account.

   Both were written to localStorage, which is readable by anything that ends up
   running on the page - an injected script, a compromised dependency, an
   extension. The short one being reachable is the cost of the design. The long
   one being reachable is a choice, and it was the wrong one: the same injection
   that costs somebody an hour instead cost them their account for a month.

   It travels as an HttpOnly cookie now. Script cannot read one at all.

   THAT DEPENDS ON A SETTING NOBODY WAS APPLYING (AMV-028). A cross-origin
   cookie needs `SameSite=None`, which needs `Secure`, which needs a concrete
   `Access-Control-Allow-Origin` and `Allow-Credentials` - a browser refuses
   credentials alongside a wildcard. AMV had `ALLOWED_ORIGIN` and a `corsFor`
   helper written to honour it, and nothing called either: every response went
   out through `json()`, which carries a hardcoded `*`. So the setting was a
   comment describing behaviour the product did not have, and a deployment that
   had locked its API down was no more restricted than one that had not.

   AND THE CACHE (AMV-020). The service worker stored every same-origin 200 it
   saw, keyed by the full URL. On a single-file app the URLs that carry a query
   string are exactly the ones that must never be kept - an OAuth return with a
   code, a share link with its token - so a live credential ended up in Cache
   Storage, where script can read it, outliving signing out. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const core = readFileSync(join(ROOT, 'src', 'app', '01-core.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'cookieauth.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, REFRESH_COOKIE, REFRESH_TTL_MS };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const USER = 'session@example.com';
const PW = 'A-real-Passw0rd!';
const APP = 'https://app.amv.test';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

function mkEnv(extra) {
  const m = new Map(); const vals = new Map();
  return Object.assign({
    JWT_SECRET: 'j', APP_URL: APP,
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
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if (b.op === 'claim') {
          if (vals.has('c:' + n)) return new Response(JSON.stringify({ claimed: false }));
          vals.set('c:' + n, 1); return new Response(JSON.stringify({ claimed: true }));
        }
        if (b.op === 'release') { vals.delete('c:' + n); return new Response(JSON.stringify({ ok: true })); }
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  }, extra || {});
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, headers) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '3.3.3.3', Origin: APP }, headers || {}),
  body: JSON.stringify(body || {}),
}), env, ctx);

const setCookieOf = (res) => res.headers.get('Set-Cookie') || '';
const cookieValue = (sc) => {
  const m = new RegExp('(?:^|;\\s*)' + W.REFRESH_COOKIE + '=([^;]*)').exec(sc);
  return m ? m[1] : '';
};
const signup = (env) => call(env, '/auth/signup', { email: USER, name: 'S', password: PW });

/* A deployment that has locked its API to the front end, which is the one a
   cross-origin cookie is possible on at all. */
const locked = () => mkEnv({ ALLOWED_ORIGIN: APP });

section('The configured origin is actually applied');
{
  /* AMV-028. `ALLOWED_ORIGIN` and `corsFor` both existed; nothing called
     either, and every response carried a hardcoded wildcard. */
  const env = locked();
  const r = await signup(env);
  ok(r.headers.get('Access-Control-Allow-Origin') === APP,
     'a locked deployment answers with its own origin, not a wildcard',
     r.headers.get('Access-Control-Allow-Origin'));
  ok(r.headers.get('Access-Control-Allow-Credentials') === 'true',
     'and allows credentials, which is what a cookie needs', r.headers.get('Access-Control-Allow-Credentials'));
  ok(/Origin/i.test(r.headers.get('Vary') || ''),
     'and says the answer varies by origin, so no shared cache mixes them up', r.headers.get('Vary'));
}

section('And a deployment that has set nothing is unchanged');
{
  /* Locking the API is a real choice with consequences for anybody embedding
     the widget. Turning it on for people who never asked would break working
     deployments to enforce a setting they did not set. */
  const env = mkEnv();
  const r = await signup(env);
  ok(r.headers.get('Access-Control-Allow-Origin') === '*',
     'the default is still open', r.headers.get('Access-Control-Allow-Origin'));
  ok(!r.headers.get('Access-Control-Allow-Credentials'),
     'and credentials are not offered alongside a wildcard, which a browser refuses anyway',
     r.headers.get('Access-Control-Allow-Credentials'));
}

section('Signing up puts the long-lived token where script cannot read it');
{
  const env = locked();
  const r = await signup(env);
  const sc = setCookieOf(r);
  const body = await r.json();

  ok(/HttpOnly/i.test(sc), 'the refresh token is set HttpOnly', sc);
  ok(/Secure/i.test(sc), 'and Secure', sc);
  ok(/SameSite=None/i.test(sc), 'and SameSite=None, because the app and the API are different origins', sc);
  ok(/Path=\/auth/i.test(sc),
     'scoped to the two routes that need it, so it does not ride along on every call', sc);
  ok(cookieValue(sc) === body.refreshToken, 'and it really is the refresh token', cookieValue(sc).slice(0, 12));
  ok(body.refreshInCookie === true,
     'the client is told the cookie is authoritative rather than left to guess', body.refreshInCookie);
}

section('The cookie alone is enough to refresh');
{
  /* The whole point: script has no copy, so refreshing has to work from the
     cookie the browser holds. */
  const env = locked();
  const sc = setCookieOf(await signup(env));
  const rt = cookieValue(sc);

  const r = await call(env, '/auth/refresh', {}, { Cookie: `${W.REFRESH_COOKIE}=${rt}` });
  const d = await r.json();
  ok(r.status === 200, 'a refresh with no body but the cookie works', r.status);
  ok(!!d.token, 'and hands back a new access token', !!d.token);
  ok(/HttpOnly/i.test(setCookieOf(r)), 'rotating the cookie as it goes', setCookieOf(r).slice(0, 40));
}

section('And a request with neither is refused');
{
  const env = locked();
  await signup(env);
  const r = await call(env, '/auth/refresh', {});
  ok(r.status === 400, 'no cookie and no token is not a refresh', r.status);
}

section('Signing out ends this device, not every device');
{
  /* In cookie mode the client has nothing to name the session with, so without
     reading the cookie the server's only safe reading of "sign me out" is all
     of them - and an ordinary sign-out would silently end every session the
     person has anywhere. */
  const env = locked();
  const up = await signup(env);
  const rt = cookieValue(setCookieOf(up));
  const tok = (await up.json()).token;

  const r = await call(env, '/auth/logout', {},
    { Authorization: 'Bearer ' + tok, Cookie: `${W.REFRESH_COOKIE}=${rt}` });
  const d = await r.json();
  ok(d.scope === 'device', 'the sign-out is scoped to this device', d.scope);
  ok(/Max-Age=0/.test(setCookieOf(r)), 'and the cookie is cleared', setCookieOf(r));
}

section('A spent refresh token still cannot be replayed');
{
  /* The rotation and reuse detection that already existed must survive the
     move - a stolen cookie used twice has to revoke the account. */
  const env = locked();
  const rt = cookieValue(setCookieOf(await signup(env)));
  const first = await call(env, '/auth/refresh', {}, { Cookie: `${W.REFRESH_COOKIE}=${rt}` });
  ok(first.status === 200, 'the first use works', first.status);
  const second = await call(env, '/auth/refresh', {}, { Cookie: `${W.REFRESH_COOKIE}=${rt}` });
  ok(second.status === 401, 'the second is refused as a replay', second.status);
}

section('A deployment with no origin keeps the old path, honestly');
{
  /* A browser refuses a SameSite=None cookie without a concrete Allow-Origin,
     so setting one anyway would mean the session silently stopped surviving a
     reload. Degrading is the right answer; degrading in silence is not. */
  const env = mkEnv();
  const r = await signup(env);
  const d = await r.json();
  ok(!setCookieOf(r), 'no cookie is set', setCookieOf(r));
  ok(!!d.refreshToken, 'the token is still returned so the session works', !!d.refreshToken);
  ok(!d.refreshInCookie, 'and the client is told it is holding it itself', d.refreshInCookie);
}

section('The client stops keeping its own copy when the server holds it');
{
  ok(/get cookieAuth\(\)/.test(core), 'the client tracks which mode it is in', true);
  const setter = core.slice(core.indexOf('set refreshTok(v)'), core.indexOf('get live()'));
  ok(/if\(this\.cookieAuth\)/.test(setter),
     'and the refresh-token setter asks before writing anything', true);
  ok(/localStorage\.removeItem\('amv_api_refresh'\)/.test(setter),
     'clearing any copy an earlier build left behind', true);

  /* And the requests that need the cookie send it. */
  ok(/credentials: this\.cookieAuth \? 'include' : 'same-origin'/.test(core),
     'refresh and sign-out send the cookie in cookie mode', true);
  const n = (core.match(/credentials: this\.cookieAuth/g) || []).length;
  ok(n >= 2, 'both of them, not just the one that was noticed', n);
}

section('The cache does not keep a credential');
{
  /* AMV-020. Keyed by the full URL, so an OAuth return with its code, or a
     share link with its token, was stored - readable by script, and outliving
     signing out. */
  ok(/if \(url\.search\)/.test(sw),
     'a URL carrying a query string is never stored', true);
  ok(/no-store\|private/.test(sw),
     'and the server can say no, which is a rule rather than a list of paths', true);
  ok(/req\.headers\.get\('Authorization'\)/.test(sw),
     'nor is anything that arrived with a credential attached', true);

  /* Not caching them must not mean not working offline. */
  const q = sw.slice(sw.indexOf('if (url.search)'), sw.indexOf('NETWORK FIRST'));
  ok(/caches\.match\(SHELL\)/.test(q),
     'and offline still serves the app, because the shell is cached under its own key', true);

  /* The API was already excluded; that must stay true. */
  ok(/pathname\.startsWith\('\/v1\/'\)/.test(sw) && /pathname\.startsWith\('\/auth\/'\)/.test(sw),
     'the API is still never cached at all', true);
}

section('One place decides the origin, so no route can be forgotten');
{
  /* `json()` is called from several hundred places and has no access to env,
     which is why the setting went unapplied for so long. Applied at the single
     point every response passes through instead. */
  const fn = codeOnly(functionBody(src, '_applyCors'));
  ok(fn.length > 200, 'the helper exists', fn.length);
  ok(/Access-Control-Allow-Credentials/.test(fn), 'it sets credentials', true);
  ok(/want === '\*'/.test(fn), 'and leaves an unconfigured deployment alone', true);
  ok(/_applyCors\(request, env, await _route/.test(codeOnly(src)),
     'and every routed response goes through it', true);
  ok(/_applyCors\(request, env, json\(/.test(codeOnly(src)),
     'including the one produced when a route throws', true);
}

globalThis.fetch = realFetch;
if (report('the-long-lived-half-is-out-of-reach') > 0) process.exitCode = 1;
done();
