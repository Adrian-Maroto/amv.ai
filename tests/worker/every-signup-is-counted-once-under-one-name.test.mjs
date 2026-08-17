/* THE NUMBERS AGREED WITH EACH OTHER AND DISAGREED WITH THE PRODUCT.

   Two ways to create an account, and they counted differently.

   The Google path referred to a variable called `email`. In that function the
   address is `em`; `email` does not exist. So the line threw a ReferenceError
   into an empty catch, and every Google signup went unrecorded - no funnel
   step, no growth row - while the password path recorded both. It also never
   incremented the account population, which the password path did.

   Nothing downstream depends on accounting code, which is exactly why it was
   invisible: the signup itself worked, the customer got their account, and the
   only symptom was numbers that were quietly wrong. An empty catch around
   analytics is a promise never to find out.

   The sibling defect is in the password path and is the same mistake without
   the exception. It passed the RAW typed address to the funnel while every
   other record uses the normalised one, so somebody who typed a capital or a
   leading space was filed under one identity at signup and another at payment:
   counted as a signup who never converted, for ever.

   Both are the same class - the wrong variable at the same call - and only one
   of them announced itself. So this file checks the OUTCOME both paths must
   share: one account, one increment, filed under the address the rest of the
   product uses. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'signupcount.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, _workerError };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const AUD = 'amv-client-id.apps.googleusercontent.com';
const PW = 'A-real-Passw0rd!';

/* A Google id token is verified against Google's keys, which is not what this
   file is about - the signature check is stubbed and the CLAIMS are real, so
   the code under test walks the same branch a real token walks. */
const realFetch = globalThis.fetch;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (email) => [b64({ alg: 'RS256', kid: 'k1' }),
                            b64({ aud: AUD, iss: 'accounts.google.com', email, email_verified: true,
                                  name: 'G User', exp: Math.floor(Date.now() / 1000) + 3600 }),
                            'sig'].join('.');

function mkEnv() {
  const m = new Map(); const vals = new Map();
  return {
    JWT_SECRET: 'j', APP_URL: 'https://amv.test', GOOGLE_CLIENT_ID: AUD,
    _vals: vals,
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
        const b = JSON.parse(init.body);
        const cur = vals.get(n) || 0;
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        if (b.op === 'claim') return new Response(JSON.stringify({ claimed: true }));
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' },
  body: JSON.stringify(body),
}), env, ctx);

/* Google's tokeninfo endpoint is what validates the signature and returns the
   claims - the Worker does not parse the JWT itself. So the stub answers in
   that endpoint's shape, decoding the claims out of the credential it was
   handed. Returning something else made every case here 401 with an audience
   mismatch, which looked like a product failure and was a stub that did not
   match the thing it stood in for. */
globalThis.fetch = async (url) => {
  const u = String(url);
  const m = /tokeninfo\?id_token=([^&]+)/.exec(u);
  if (m) {
    const payload = JSON.parse(Buffer.from(decodeURIComponent(m[1]).split('.')[1], 'base64url').toString());
    return { ok: true, status: 200, json: async () => payload };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};
const g = (env, email) => call(env, '/auth/google', { credential: idToken(email) });

const pop = (env) => env._vals.get('popaccounts') || 0;
const funnelSignups = (env) => env._vals.get('funnel:signup') || 0;
const funnelKeys = (env) => [...env.AMV_KV._map.keys()].filter(k => k.startsWith('fstep:'));

section('The password path counts a signup, which is the standard to match');
{
  const env = mkEnv();
  const r = await call(env, '/auth/signup', { email: 'pw@example.com', name: 'P', password: PW });
  await ctx.settle();
  ok(r.status === 200, 'the account is created', r.status);
  ok(pop(env) === 1, 'the account population moves', pop(env));
  ok(funnelSignups(env) === 1, 'and the funnel records a signup', funnelSignups(env));
}

section('An address is filed under the form the rest of the product uses');
{
  /* The sibling defect. Typed with a capital and a trailing space; the account
     record is keyed on the normalised address, so the funnel must be too, or
     this person is two people to the numbers. */
  const env = mkEnv();
  const r = await call(env, '/auth/signup', { email: '  Mixed.Case@Example.COM ', name: 'M', password: PW });
  await ctx.settle();
  ok(r.status === 200, 'the account is created', r.status);

  ok(!!env.AMV_KV._map.get('acct:mixed.case@example.com'),
     'the account is stored under the normalised address',
     [...env.AMV_KV._map.keys()].filter(k => k.startsWith('acct:')));

  const keys = funnelKeys(env);
  ok(keys.length === 1, 'exactly one funnel key exists for them', keys);
  ok(keys[0] === 'fstep:mixed.case@example.com:signup',
     'and it is the normalised address, so the later paid step will match it', keys[0]);
}

section('The Google path counts the same signup the same way');
{
  const env = mkEnv();
  const r = await g(env, 'goog@example.com');
  await ctx.settle();
  ok(r.status === 200, 'the account is created', r.status);

  /* What was silently zero for every Google customer AMV has ever had. */
  ok(pop(env) === 1, 'the account population moves, as it does for a password signup', pop(env));
  ok(funnelSignups(env) === 1, 'and the funnel records a signup', funnelSignups(env));
  ok(funnelKeys(env).includes('fstep:goog@example.com:signup'),
     'filed under the same address as the account record', funnelKeys(env));
}

section('Signing in again is not a second signup');
{
  /* The obvious way to "fix" a zero count is to increment somewhere that runs
     more often, which turns an undercount into an overcount. */
  const env = mkEnv();
  await g(env, 'goog@example.com');
  await g(env, 'goog@example.com');
  await g(env, 'goog@example.com');
  await ctx.settle();
  ok(pop(env) === 1, 'three sign-ins are one account', pop(env));
  ok(funnelSignups(env) === 1, 'and one signup', funnelSignups(env));
}

section('The accounting never breaks a signup');
{
  /* Whatever else is true, somebody creating an account does not care about the
     funnel. Every counter fails here; the account must still be created. */
  const env = mkEnv();
  const broken = Object.assign({}, env, {
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { throw new Error('counter down'); } }) },
  });
  const r = await g(broken, 'resilient@example.com');
  await ctx.settle();
  ok(r.status === 200, 'the person still gets their account', r.status);
  ok(!!broken.AMV_KV._map.get('acct:resilient@example.com'), 'which really exists',
     [...broken.AMV_KV._map.keys()].filter(k => k.startsWith('acct:')));
}

section('And a failure in it leaves a trace instead of vanishing');
{
  /* The root cause was not the wrong variable - it was that the wrong variable
     could not be noticed. The catch around the accounting block was empty, so a
     ReferenceError thrown at the call site had nowhere to go.

     A ReferenceError cannot be injected from out here: it is raised while
     evaluating the argument, before any function is entered, and every call
     inside the block is separately defensive so nothing else reaches the outer
     catch. So the chain is checked in its two links rather than asserted as
     prose - the catch calls the reporter, and the reporter really records. A
     check on the catch alone would pass on a reporter that did nothing. */
  const i = src.indexOf('async function authGoogle');
  const block = src.slice(src.indexOf("_funnelMark(env, em, 'signup')", i),
                          src.indexOf('_referralCapture', i));
  ok(/catch\s*\(e\)\s*\{\s*try\s*\{\s*await _workerError\(/.test(block),
     'the accounting catch reports rather than discarding', block.trim().slice(0, 90));
  ok(!/catch\s*\(e\)\s*\{\s*\}/.test(block), 'and is not empty', true);

  /* Link two: the reporter writes something an operator can find. */
  const env = mkEnv();
  await W._workerError(env, 'authGoogle:accounting', new ReferenceError('email is not defined'));
  const idx = JSON.parse(env.AMV_KV._map.get('errors:index') || 'null');
  ok(idx && idx.groups && Object.keys(idx.groups).length === 1,
     'a reported failure lands in the error index', idx && Object.keys(idx.groups || {}));
  const grp = idx && Object.values(idx.groups)[0];
  ok(grp && /email is not defined/.test(grp.msg), 'with the message', grp && grp.msg);
  ok(grp && /authGoogle:accounting/.test(grp.where), 'and where it happened', grp && grp.where);
}

section('Neither path reads a variable it does not define');
{
  /* The mistake itself, checked where it happened. Both blocks must refer to
     the normalised address and nothing else. */
  const i = src.indexOf('async function authGoogle');
  /* Anchored on the END of the handler rather than on the exact line it
     returns. That line changed when the refresh token moved into a cookie
     (AMV-019) and this slice silently became empty, which made three real
     checks below pass on nothing. */
  const gbody = src.slice(i, src.indexOf('\n}\n', src.indexOf('catch(e){', src.indexOf('const tokens = await issueTokens', i))));
  ok(gbody.length > 400, 'the Google handler was read', gbody.length);
  ok(!/_funnelMark\(env, email\b/.test(gbody), 'the Google path does not name a variable it lacks', true);
  ok(/_funnelMark\(env, em\b/.test(gbody), 'it uses the address it actually has', true);
  ok(/counter\(env, 'popaccounts'/.test(gbody), 'and counts the account, like the password path', true);

  const j = src.indexOf('async function authSignup');
  const sbody = src.slice(j, src.indexOf('async function authLogin'));
  ok(!/_funnelMark\(env, email\b/.test(sbody), 'and the password path uses the normalised address too', true);
}

globalThis.fetch = realFetch;
if (report('every-signup-is-counted-once-under-one-name') > 0) process.exitCode = 1;
done();
