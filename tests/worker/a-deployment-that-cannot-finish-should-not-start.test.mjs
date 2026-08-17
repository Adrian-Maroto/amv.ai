/* ONE FORGOTTEN SECRET LOCKED PEOPLE OUT OF THEIR OWN ADDRESS, FOR EVER.

   Found by running this Worker in workerd - `wrangler dev --local` - with no
   secrets set, which is exactly the state a first deploy is in until somebody
   remembers `wrangler secret put`. No test found it, because every Worker test
   builds an env by hand and every one of them sets JWT_SECRET.

   What happened. Token signing fails closed without JWT_SECRET, deliberately
   and correctly: a missing secret must never become a public signing key. But
   issueTokens is the LAST thing signup does. By the time it threw, the account
   row was written, the population counter incremented, the growth and funnel
   marks recorded, the account_created event stored. The throw surfaced as a
   generic 500.

   So the account existed. Its owner had no token and no way to get one. And
   signing up again answered `account exists` with a 409 - which is true, and
   is the worst possible thing to tell them, because the account it names is
   one nobody can ever sign into. The address is spent. The operator, meanwhile,
   sees a 500 with no cause, on the single most likely mistake there is to make
   when deploying this.

   The fix is not to change the fail-closed signer. It is to refuse the request
   BEFORE any of the work, because the whole defect is that the work happened
   first - and to answer 503 rather than 500, since those mean different things:
   500 says AMV broke and invites a retry, 503 says AMV is not set up and a
   retry will do exactly the same thing.

   Both halves are checked here: that an unconfigured deployment refuses, and
   that it refuses having written nothing. The second is the one that matters. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'unconfigured.harness.mjs');
writeFileSync(harness, src + '\nexport { NEEDS_SIGNING, _deploymentCannotServe };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

const PW = 'A-real-Passw0rd!';

/* An env with everything EXCEPT the secret named. The point is a deployment
   that is otherwise complete - storage bound, counter bound, cron set - and
   missing one `wrangler secret put`. */
function mkEnv(opts = {}) {
  const m = new Map(); const vals = new Map();
  const env = {
    ADMIN_TOKEN: 'admintok', APP_URL: 'https://amv.test',
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit, cursor } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        const from = cursor ? +cursor : 0;
        const page = all.slice(from, from + (limit || 1000));
        return { keys: page, list_complete: from + page.length >= all.length, cursor: String(from + page.length) };
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
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
  if (opts.configured) env.JWT_SECRET = 'a-real-signing-secret-for-the-test';
  return env;
}

const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };

const post = async (env, path, body) => {
  const r = await worker.fetch(new Request('https://api.amv.test' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '3.3.3.3' },
    body: JSON.stringify(body || {}),
  }), env, ctx);
  return { status: r.status, body: await r.json().catch(() => ({})), retryAfter: r.headers.get('Retry-After') };
};

section('THE FINDING: signing up on an unconfigured deployment writes nothing');
{
  const env = mkEnv();
  const before = env.AMV_KV._map.size;
  const r = await post(env, '/auth/signup', { email: 'b@example.com', name: 'B', password: PW });

  ok(r.status === 503, 'the request is refused', r.status);
  ok(r.body.code === 'not_configured',
     'as a deployment that is not set up, not as a crash', r.body);
  ok(r.body.missing === 'JWT_SECRET',
     'and it names what is missing, so the operator knows what to do', r.body.missing);
  ok(!/secret.{0,4}[:=]\s*\S/i.test(JSON.stringify(r.body)),
     'without printing the value of anything', r.body);
  ok(r.retryAfter === '300', 'with a Retry-After, because a retry now is pointless', r.retryAfter);

  /* THE HALF THAT MATTERS. Before this, the account row was already written
     when the signer threw - so the address was spent on an account nobody
     could ever sign into. */
  ok(env.AMV_KV._map.size === before,
     'and not one record was created on the way to refusing', env.AMV_KV._map.size - before);
  const keys = [...env.AMV_KV._map.keys()].filter(k => /b@example\.com/.test(k));
  ok(keys.length === 0, 'nothing anywhere is keyed to that address', keys);
}

section('So trying again is not told the address is taken');
{
  /* The compounding part. A 500 that half-succeeded turned the second attempt
     into "account exists" - true, and useless, because the account it refers to
     is unreachable. The person cannot sign up and cannot sign in. */
  const env = mkEnv();
  await post(env, '/auth/signup', { email: 'c@example.com', name: 'C', password: PW });
  const again = await post(env, '/auth/signup', { email: 'c@example.com', name: 'C', password: PW });
  ok(again.status === 503, 'the second attempt gets the same honest answer', again.status);
  ok(!/exists/i.test(JSON.stringify(again.body)),
     'never "account exists", which would spend an address on nothing', again.body);
}

section('Every route that must mint a token is covered, and no others');
{
  /* Read off the source rather than remembered. A route on this list that does
     not sign is a route refused for no reason; one that signs and is missing is
     the whole finding again under a different path. /auth/reset/confirm was on
     the first draft of this list and signs nothing. */
  const code = codeOnly(src);
  const signing = [];
  for (const m of code.matchAll(/case '(\/auth\/[a-z/-]+)':\s*return (\w+)\(/g)) {
    const fn = m[2];
    const at = code.search(new RegExp('(?:async\\s+)?function\\s+' + fn + '\\s*\\('));
    if (at < 0) continue;
    let end = code.indexOf('\n}\n', at);
    if (end < 0) end = at + 8000;
    if (/issueTokens\(|signToken\(/.test(code.slice(at, end))) signing.push(m[1]);
  }
  ok(signing.length >= 4, 'the routes that sign a token were found', signing);

  const roster = [...W.NEEDS_SIGNING];
  const uncovered = signing.filter(p => roster.indexOf(p) < 0).sort();
  ok(uncovered.length === 0,
     'every one of them refuses instead of throwing halfway through', uncovered);
  const spurious = roster.filter(p => signing.indexOf(p) < 0).sort();
  ok(spurious.length === 0,
     'and nothing is refused that would have worked', spurious);
}

section('A deployment that IS configured is untouched');
{
  /* The other direction, and the one that would make this a bad trade: a guard
     that refuses a working deployment is worse than the defect it closes. */
  const env = mkEnv({ configured: true });
  const r = await post(env, '/auth/signup', { email: 'd@example.com', name: 'D', password: PW });
  ok(r.status === 200, 'signup works', r.status);
  ok(!!r.body.token, 'and hands back a real token', !!r.body.token);

  const login = await post(env, '/auth/login', { email: 'd@example.com', password: PW });
  ok(login.status === 200, 'so does signing in afterwards', login.status);
}

section('And a route that only READS a token is left alone');
{
  /* verifyToken wraps its work in a try and answers null, so paths that only
     check who you are already come back 401 - the right answer to "this
     deployment cannot tell". Refusing those too would turn one missing secret
     into a Worker that answers nothing at all. */
  const env = mkEnv();
  const r = await worker.fetch(new Request('https://api.amv.test/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-a-real-token' },
    body: '{}',
  }), env, ctx);
  ok(r.status !== 503, 'a verify-only route is not caught by the roster', r.status);
  ok(r.status !== 500, 'and does not crash on the missing secret either', r.status);
}

section('The check runs before the route, not inside it');
{
  /* The defect was entirely about ordering, so the shape is asserted: the guard
     sits at the one place every request passes through, ahead of _route. If it
     ever moves inside the handlers it is a hundred and sixty separate rules
     again, and the first one somebody forgets is the one that writes first. */
  const code = codeOnly(src);
  const at = code.indexOf('_deploymentCannotServe(request, env)');
  const routeAt = code.indexOf('await _route(request, env, ctx)');
  ok(at > 0 && routeAt > 0, 'both the guard and the dispatch were found', { at, routeAt });
  ok(at < routeAt, 'and the guard is decided first', { at, routeAt });
}

if (report('a-deployment-that-cannot-finish-should-not-start') > 0) process.exitCode = 1;
done();
