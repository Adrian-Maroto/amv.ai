/* A FIVE-ATTEMPT LIMIT THAT COUNTED FIVE PER ROUND TRIP.

   Two places on the way into an account read a value, decided something, and
   wrote it back. Both are safe one request at a time and neither is safe
   against two.

   THE RESET CODE (AMV-018). A six-digit code is a million possibilities, which
   five attempts makes safe. The counter was read, compared, incremented and
   written - four steps with three gaps - so guesses arriving together all read
   the same number, all decide they are under the limit, and all write the same
   increment back. The cap bounds SEQUENTIAL guesses and nothing else. A
   thousand at a time turns a million possibilities into a few minutes of
   traffic, against whatever address somebody names.

   The correct code has the same shape: two submissions of a real code both read
   it, both delete it, and both mint a single-use token. Two live tokens, one
   use.

   THE SIGNUP (AMV-017). Read the account, find nothing, write one. Two signups
   for the same address arriving together both read nothing and both write, and
   the last one wins - so both callers are handed a working session for one
   account whose password belongs to the SECOND person. Whoever signed up first
   is signed in to an account somebody else controls, and neither is told
   anything happened. A double-submitted form on a slow connection is the
   ordinary way to produce it, and the password hash sits in the middle of the
   gap making it wider.

   Every case here runs concurrently. Sequentially both defects look correct,
   which is exactly why they were there. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'signuprace.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, RESET_CODE_ATTEMPTS, verifyToken };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const USER = 'contested@example.com';
const PW_A = 'First-Persons-Pw1!';
const PW_B = 'Second-Persons-Pw2!';

const realFetch = globalThis.fetch;
let mailed = [];
globalThis.fetch = async (url, init) => {
  mailed.push(String((init && init.body) || ''));
  return { ok: true, status: 200, json: async () => ({}) };
};

/* Storage that interleaves. Each op yields before it reads and again before it
   writes, so a read-then-write really can be raced - which is what makes this
   file able to fail. A synchronous Map cannot lose a race by construction and
   would report both defects as fixed. */
function mkEnv() {
  const m = new Map(); const vals = new Map(); mailed = [];
  let chain = Promise.resolve();
  const serialise = (fn) => (chain = chain.then(fn, fn));
  return {
    JWT_SECRET: 'j', APP_URL: 'https://amv.test', EMAIL_API_KEY: 'k', _vals: vals,
    AMV_KV: {
      _map: m,
      async get(k) { await new Promise(r => setTimeout(r, 1)); return m.has(k) ? m.get(k) : null; },
      async put(k, v) { await new Promise(r => setTimeout(r, 1)); m.set(k, v); },
      async delete(k) { await new Promise(r => setTimeout(r, 1)); m.delete(k); },
      async list({ prefix, limit } = {}) {
        const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    /* The Durable Object serialises; the claim is what the record lock is built
       on, so it has to behave like the real one or the lock proves nothing. */
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ fetch(_u, init) {
        return serialise(async () => {
          await Promise.resolve();
          const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
          if (b.op === 'claim') {
            if (vals.has('c:' + n)) return new Response(JSON.stringify({ claimed: false }));
            vals.set('c:' + n, 1); return new Response(JSON.stringify({ claimed: true }));
          }
          if (b.op === 'release') { vals.delete('c:' + n); return new Response(JSON.stringify({ ok: true })); }
          if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
          if (b.op === 'reserve') {
            const amt = Number(b.amount);
            if (b.cap != null && cur + amt > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
            vals.set(n, cur + amt); return new Response(JSON.stringify({ allowed: true, value: cur + amt }));
          }
          if (b.op === 'rateCheck') {
            const next = cur + 1; vals.set(n, next);
            return new Response(JSON.stringify({ allowed: next <= (b.limit || 9999), count: next }));
          }
          return new Response(JSON.stringify({ allowed: true, value: cur }));
        });
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '11.11.11.11' },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b) => { const r = await call(env, p, b); return { status: r.status, body: await r.json().catch(() => ({})) }; };

const signup = (env, pw) => post(env, '/auth/signup', { email: USER, name: 'N', password: pw });
const login = (env, pw) => post(env, '/auth/login', { email: USER, password: pw, provider: 'email' });

section('One signup makes one account');
{
  const env = mkEnv();
  const r = await signup(env, PW_A);
  ok(r.status === 200, 'it works', r.status);
  ok(!!r.body.token, 'and hands back a session', !!r.body.token);
}

section('The same address twice is refused the second time');
{
  const env = mkEnv();
  await signup(env, PW_A);
  const second = await signup(env, PW_B);
  ok(second.status === 409, 'the second is told the account exists', second.status);
  ok(!second.body.token, 'and gets no session', second.body.token);
}

section('Two signups at the same instant produce ONE account');
{
  /* The finding. Both used to succeed, and the account ended up with the second
     person's password while the first still held a working session. */
  const env = mkEnv();
  const [a, b] = await Promise.all([signup(env, PW_A), signup(env, PW_B)]);

  const wins = [a, b].filter(r => r.status === 200);
  ok(wins.length === 1, 'exactly one of them creates the account', { a: a.status, b: b.status });
  ok([a, b].some(r => r.status === 409), 'and the other is told it exists', [a.status, b.status]);

  /* Which password ended up on the account has to match which signup was told
     it succeeded, or somebody is holding a session for an account they cannot
     sign back into. */
  const winnerPw = a.status === 200 ? PW_A : PW_B;
  const loserPw = a.status === 200 ? PW_B : PW_A;
  const good = await login(env, winnerPw);
  ok(good.status === 200, 'the password of the one that won is the account password', good.status);
  const bad = await login(env, loserPw);
  ok(bad.status === 401, 'and the other password does not open it', bad.status);
}

section('Ten at once is still one');
{
  const env = mkEnv();
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => signup(env, 'Passw0rd-Number-' + i + '!')));
  const made = rs.filter(r => r.status === 200).length;
  ok(made === 1, 'one account, nine refusals', { made, statuses: rs.map(r => r.status) });
  const accts = [...env.AMV_KV._map.keys()].filter(k => k.startsWith('acct:'));
  ok(accts.length === 1, 'and one account record on disk', accts);
}

/* ---- the reset code ---- */

async function withCode(env) {
  await signup(env, PW_A);
  mailed = [];
  await post(env, '/auth/reset/code', { email: USER });
  await ctx.settle();
  const rec = JSON.parse(env.AMV_KV._map.get('resetcode:' + USER) || 'null');
  return rec && rec.code;
}
const tryCode = (env, code) => post(env, '/auth/reset/verify', { email: USER, code });

section('A code is issued and the right one works');
{
  const env = mkEnv();
  const code = await withCode(env);
  ok(/^\d{6}$/.test(String(code || '')), 'a six-digit code exists', code);
  const r = await tryCode(env, code);
  ok(r.status === 200, 'and it verifies', r.status);
  ok(!!r.body.token, 'handing back a single-use token', !!r.body.token);
}

section('Wrong guesses run out, one at a time');
{
  const env = mkEnv();
  await withCode(env);
  const codes = [];
  for (let i = 0; i < W.RESET_CODE_ATTEMPTS + 2; i++) codes.push((await tryCode(env, '000' + String(i).padStart(3, '0'))).status);
  ok(codes.some(c => c === 429), 'the limit is reached and says so', codes);
}

section('And they run out just as fast in parallel');
{
  /* The finding. Every guess used to read the same attempt count, so the limit
     bounded round trips rather than guesses - and a six-digit code against
     unlimited parallel tries is minutes of traffic. */
  const env = mkEnv();
  const real = await withCode(env);

  const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => tryCode(env, String(100000 + i))));

  /* Counted by what the answer SAYS, not by its status. A 400 is also what an
     expired code gets, and once the tries are spent the record is deleted - so
     every guess after that is a 400 that consumed nothing. Counting statuses
     made five spent attempts look like nine and would have failed on correct
     code. The guesses that were actually counted are the ones told how many
     they have left. */
  const consumed = rs.filter(r => /attempt(s)? left/.test(r.body.error || '')).length;
  ok(consumed <= W.RESET_CODE_ATTEMPTS,
     'no more than the allowed number of guesses were ever counted, however many arrived at once',
     { consumed, allowed: W.RESET_CODE_ATTEMPTS });
  ok(consumed >= 1, 'and some really were counted, so the measure is not blind', consumed);
  ok(rs.some(r => r.status === 429), 'the rest are refused outright', rs.filter(r => r.status === 429).length);

  /* The record itself never went past the cap, which is the thing the old code
     could not promise: every parallel guess read the same number and wrote the
     same increment back. */
  const rec = JSON.parse(env.AMV_KV._map.get('resetcode:' + USER) || 'null');
  ok(!rec || (+rec.attempts || 0) <= W.RESET_CODE_ATTEMPTS,
     'and the stored count never exceeded it either', rec && rec.attempts);

  /* And the code is genuinely dead afterwards - a limit that stops counting but
     still accepts the right answer is not a limit. */
  const after = await tryCode(env, real);
  ok(after.status !== 200, 'even the correct code no longer works once they are used up', after.status);
}

section('One correct code cannot be spent twice');
{
  /* Two submissions of a real code both read it, both delete it, and both mint
     a token. Single-use has to mean once even when two arrive together. */
  const env = mkEnv();
  const code = await withCode(env);
  const rs = await Promise.all([tryCode(env, code), tryCode(env, code)]);
  const tokens = rs.filter(r => r.status === 200 && r.body.token).map(r => r.body.token);
  ok(tokens.length === 1, 'exactly one reset token is issued', { statuses: rs.map(r => r.status) });
}

section('A code that cannot be read is neither accepted nor counted');
{
  /* Letting it through would be a free guess; counting it would let a storage
     fault burn somebody's attempts. */
  const env = mkEnv();
  const code = await withCode(env);
  const realGet = env.AMV_KV.get;
  env.AMV_KV.get = async (k) => {
    if (k.startsWith('resetcode:')) throw new Error('storage down');
    return realGet.call(env.AMV_KV, k);
  };
  const r = await tryCode(env, code);
  env.AMV_KV.get = realGet;

  ok(r.status === 503, 'it says it could not check', r.status);
  ok(!r.body.token, 'no token is handed out', r.body.token);
  const rec = JSON.parse(env.AMV_KV._map.get('resetcode:' + USER) || 'null');
  ok(rec && (+rec.attempts || 0) === 0, 'and no attempt was spent', rec && rec.attempts);

  const good = await tryCode(env, code);
  ok(good.status === 200, 'so the real code still works once the store recovers', good.status);
}

section('Both decisions are made inside the lock that writes');
{
  /* The shape, because a fix that reads under a lock and writes outside it
     passes every sequential case and none of the concurrent ones - which is
     what the first attempt at the signup fix did. */
  const su = codeOnly(functionBody(src, 'authSignup'));
  ok(/_withKind\(env, 'acct'/.test(su), 'the signup decides existence under the account lock', true);
  const iLock = su.indexOf("_withKind(env, 'acct'");
  const iAssign = su.indexOf('Object.assign(rec', iLock);
  const iEnd = su.indexOf('}, {});', iLock);
  ok(iAssign > iLock && iEnd > iAssign,
     'and writes the new account inside it, not after it', { lock: iLock, write: iAssign, end: iEnd });
  ok(!/DB\.put\(env, 'acct', em, acct\)/.test(su),
     'there is no second write outside the lock', true);

  const rv = codeOnly(functionBody(src, 'authResetVerify') || '');
  const body = rv || codeOnly(src.slice(src.indexOf("const code = String(body.code"),
                                        src.indexOf('async function sendResetCodeEmail')));
  ok(/_withKV\(env, 'resetcode'/.test(body), 'the code check runs under the record lock', true);
  ok(!/rec\.attempts\+\+/.test(body) || /_withKV\(env, 'resetcode'/.test(body),
     'and the attempt counter is incremented there', true);
}

globalThis.fetch = realFetch;
if (report('two-at-once-cannot-both-be-first') > 0) process.exitCode = 1;
done();
