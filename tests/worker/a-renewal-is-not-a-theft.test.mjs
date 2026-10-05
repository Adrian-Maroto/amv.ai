/* A RENEWAL IS NOT A THEFT.

   Asked for: "every time I refresh it logs me out and makes me sign in".

   A refresh token is single use, and a second use revokes every session on the
   account - the right answer to a stolen token. Two ordinary things reached
   that verdict:

   - The lock store not answering. The claim on a token's id is a Durable
     Object call, and one that throws (a restart during a deploy is enough)
     came back as "already claimed". A hiccup on the server signed the person
     out of every device, and every reload after that asked them to sign in.
   - The same person renewing twice within moments: two tabs, or a reload that
     dropped the first answer before its new cookie was kept.

   Each is checked here by making it happen. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'renewal.harness.mjs');
writeFileSync(harness, src + '\nexport { issueTokens, verifyToken, authRefresh, authLogout };\n');
const W = await import(harness + '?t=' + Date.now());

const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('{}', { status: 200 });

function mkEnv(counter) {
  const m = new Map();
  return {
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
    },
    ...(counter ? { AMV_COUNTER: counter } : {}),
    JWT_SECRET: 'renewal-secret', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
  };
}
const req = (rt) => new Request('https://api.amv.test/auth/refresh', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' },
  body: JSON.stringify({ refreshToken: rt }),
});

/* A Durable Object whose claim can be switched to failing, the way one does
   while it restarts. Everything else answers as the real one would. */
function mkCounter() {
  const claims = new Set(); const state = { down: false };
  return { state, ns: { idFromName: (n) => n, get: (n) => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body);
    if (b.op === 'claim') {
      if (state.down) throw new Error('Durable Object reset because its code was updated.');
      if (claims.has(n)) return new Response(JSON.stringify({ claimed: false }));
      claims.add(n); return new Response(JSON.stringify({ claimed: true, owner: 'o' }));
    }
    return new Response(JSON.stringify({ allowed: true, value: 0 }));
  } }) } };
}

section('The lock store not answering is "try again", never "stolen"');
{
  const c = mkCounter(); const env = mkEnv(c.ns);
  const pair = await W.issueTokens(env, 'kim@example.com', 'Kim');
  c.state.down = true;
  const r = await W.authRefresh(req(pair.refreshToken), env);
  const d = await r.json().catch(() => ({}));
  ok(r.status === 503 && d.code === 'auth_busy', 'the renewal is refused as busy, with a retry', { status: r.status, d });
  ok(!!(await W.verifyToken(pair.token, env.JWT_SECRET, env, 'access')), 'and nothing was revoked - the session is still good');
  c.state.down = false;
  const again = await W.authRefresh(req(pair.refreshToken), env);
  ok(again.status === 200, 'once it answers, the same token renews normally', again.status);
}

section('A database that errors is not a database that says "already used"');
{
  const env = mkEnv(null);
  env.DB = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('D1_ERROR: network connection lost'); } }) }) };
  const pair = await W.issueTokens(env, 'lee@example.com', 'Lee');
  const r = await W.authRefresh(req(pair.refreshToken), env);
  ok(r.status === 503, 'a lost connection is busy, not a replay', r.status);
  ok(!!(await W.verifyToken(pair.token, env.JWT_SECRET, env, 'access')), 'and the account keeps its sessions');
}

section('Two tabs renewing at once both stay signed in');
{
  const c = mkCounter(); const env = mkEnv(c.ns);
  const pair = await W.issueTokens(env, 'two@example.com', 'Two');
  const [a, b] = await Promise.all([W.authRefresh(req(pair.refreshToken), env), W.authRefresh(req(pair.refreshToken), env)]);
  const da = await a.json(), db = await b.json();
  ok(a.status === 200 && b.status === 200 && da.token && db.token, 'both get a session', [a.status, b.status]);
  ok(!!(await W.verifyToken(da.token, env.JWT_SECRET, env, 'access')), 'and neither revoked the other');
}

section('Signing out of one device while it was renewing leaves the others signed in');
{
  /* The laptop signs out; a renewal it had already sent arrives a moment
     later with the token sign-out just retired. That is the laptop, not a
     thief - so it is refused, and the phone stays signed in. */
  const c = mkCounter(); const env = mkEnv(c.ns);
  const laptop = await W.issueTokens(env, 'both@example.com', 'B');
  const phone = await W.issueTokens(env, 'both@example.com', 'B');
  await W.authLogout(new Request('https://api.amv.test/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + laptop.token },
    body: JSON.stringify({ refreshToken: laptop.refreshToken }) }), env);
  const late = await W.authRefresh(req(laptop.refreshToken), env);
  ok(late.status === 401, 'the late renewal is refused - the laptop is signed out', late.status);
  ok(!!(await W.verifyToken(phone.token, env.JWT_SECRET, env, 'access')), 'and the phone is still signed in');
}

section('A reuse after the overlap window is still a replay, and revokes');
{
  const c = mkCounter(); const env = mkEnv(c.ns);
  const pair = await W.issueTokens(env, 'stolen@example.com', 'S');
  const first = await (await W.authRefresh(req(pair.refreshToken), env)).json();
  const real = Date.now; Date.now = () => real() + 31000;
  try {
    const r = await W.authRefresh(req(pair.refreshToken), env);
    ok(r.status === 401, 'the old token is refused', r.status);
    ok(!(await W.verifyToken(first.token, env.JWT_SECRET, env, 'access')), 'and every session on the account is ended');
  } finally { Date.now = real; }
}

globalThis.fetch = realFetch;
if (report('a-renewal-is-not-a-theft') > 0) process.exitCode = 1;
done();
