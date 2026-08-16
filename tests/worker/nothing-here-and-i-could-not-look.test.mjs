/* THE SCREEN SAID THERE WERE NO ACCOUNTS.

   The operator's user list wrapped its whole listing in `catch(e){}`. So when
   the scan threw - the store unreachable, a read timing out, a page of records
   that would not parse - `users` was still the empty array it started as, and
   the request answered 200 with `users: []` and `count: 0`.

   To whoever is looking at it that is not an error. It is a screen saying the
   customer base is empty. And this is the screen somebody opens DURING an
   incident, to find out whether anything is left: it is the one place where
   "there is nothing here" and "I could not look" absolutely must be different
   answers, and it gave the first one for both.

   AND WHICH DOOR IS WHICH (AMV-052). Sixteen admin routes and three different
   gates between them. Thirteen went through _adminGate, which checks the token,
   applies a ceiling and writes an audit line. Three checked the token and
   nothing else, so guessing at the admin token was unbounded on those three
   while it was bounded on the rest - and an attacker only has to find the one
   that is not. And the user list authenticated by session instead, with no
   ceiling and no audit line at all.

   The two credentials stay apart, deliberately: making a signed-in admin
   account interchangeable with the operator's token would let one export the
   whole database without the other. What they share now is the ceiling and the
   record of who asked. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'adminshape.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, issueTokens, adminUsers };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const ADMIN = 'a-long-random-admin-token-value';
const OWNER = 'owner@example.com';

function mkEnv(opts = {}) {
  const m = new Map(); const vals = new Map();
  return {
    JWT_SECRET: 'x'.repeat(40), ADMIN_TOKEN: ADMIN, OWNER_EMAIL: OWNER, APP_URL: 'https://amv.test',
    _map: m, _vals: vals,
    AMV_KV: {
      async get(k) {
        if (opts.readsThrow && /^acct:/.test(k)) throw new Error('storage unreachable');
        return m.has(k) ? m.get(k) : null;
      },
      async put(k, v) { m.set(k, String(v)); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        if (opts.listThrows && String(prefix || '').startsWith('acct:')) throw new Error('storage unreachable');
        const keys = [...m.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if (b.op === 'rateCheck') { const nx = cur + 1; vals.set(n, nx); return new Response(JSON.stringify({ allowed: nx <= (b.limit || 9999), count: nx })); }
        if (b.op === 'reserve') { const nx = cur + (b.amount || 0); if (nx > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur })); vals.set(n, nx); return new Response(JSON.stringify({ allowed: true, value: nx })); }
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
const seed = async (env, n) => {
  for (let i = 0; i < n; i++) {
    await W.DB.put(env, 'acct', 'u' + i + '@example.com',
      { email: 'u' + i + '@example.com', name: 'U' + i, provider: 'email', createdAt: Date.now() });
  }
};
const sessionOf = async (env, email) => (await W.issueTokens(env, email, 'O')).token;
const hitUsers = async (env, token, ip = '4.4.4.4') => {
  const r = await worker.fetch(new Request('https://api.amv.test/admin/users?offset=0&limit=60', {
    headers: { Authorization: 'Bearer ' + token, 'CF-Connecting-IP': ip },
  }), env, ctx);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const hitAdmin = async (env, path, token, ip = '4.4.4.4') => {
  const r = await worker.fetch(new Request('https://api.amv.test' + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: '{}',
  }), env, ctx);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

section('The screen still works, which is what this is all for');
{
  const env = mkEnv();
  await seed(env, 3);
  const r = await hitUsers(env, await sessionOf(env, OWNER));
  ok(r.status === 200, 'the owner sees the list', r.status);
  ok(r.body.users.length === 3, 'with everybody on it', r.body.users.length);
  ok(r.body.total === 3, 'and a real total', r.body.total);
}

section('THE FINDING: a store it cannot read is not a store with nobody in it');
{
  const env = mkEnv({ listThrows: true });
  await seed(env, 5);
  const r = await hitUsers(env, await sessionOf(env, OWNER));

  ok(r.status !== 200, 'the request does not report success', r.status);
  ok(r.status === 503, 'it says the screen is unavailable', r.status);
  ok(r.body.code === 'listing_unavailable', 'with a code the app can branch on', r.body.code);
  ok(!Array.isArray(r.body.users), 'and no empty list to be read as an answer', r.body.users);
  ok(r.body.count === undefined, 'and no count of nothing', r.body.count);

  /* The sentence matters more here than almost anywhere: the person reading it
     is deciding whether their customers still exist. */
  ok(/not showing one|could not read/i.test(r.body.error || ''), 'saying it could not look', r.body.error);
  ok(/nothing has been lost/i.test(r.body.error || ''),
     'and saying plainly that this is not an empty database', r.body.error);
}

section('An account that individually fails does not empty the whole screen');
{
  /* The opposite failure, and the reason the fix is a return rather than a
     rethrow of everything: one unreadable entitlement must not take the page
     down, because then a single corrupt row hides every other customer. */
  const env = mkEnv({ readsThrow: false });
  await seed(env, 4);
  env._map.set('ent:u2@example.com', '{not json');
  const r = await hitUsers(env, await sessionOf(env, OWNER));
  ok(r.status === 200, 'the page still loads', r.status);
  ok(r.body.users.length === 4, 'with everybody on it', r.body.users.length);
}

section('And the screen is not open to anybody who is not the operator');
{
  const env = mkEnv();
  await seed(env, 2);
  const stranger = await hitUsers(env, await sessionOf(env, 'nobody@example.com'));
  ok(stranger.status === 403, 'a signed-in stranger is refused', stranger.status);
  const none = await hitUsers(env, 'not-a-token');
  ok(none.status === 401, 'and an invalid session is unauthorised', none.status);
}

section('Every admin route is bounded, not just thirteen of the sixteen');
{
  /* Three of them checked the token and did nothing else, so guessing at the
     token was unbounded on those three and bounded on the rest. An attacker
     only has to find the one that is not. */
  const env = mkEnv();
  const answers = [];
  for (let i = 0; i < 90; i++) answers.push(await hitAdmin(env, '/v1/admin/stats', 'wrong-token-' + i, '5.5.5.5'));
  const refusedForRate = answers.filter(a => a.status === 429).length;
  ok(refusedForRate > 0, 'guesses at the admin token run into a ceiling', refusedForRate);
  ok(answers.filter(a => a.status === 403).length > 0, 'while the first ones are simply forbidden', true);
}

section('The three that were ungated are on the same gate as the rest');
{
  const gated = ['adminStats', 'adminFinance', 'supportInbox', 'adminReports', 'abuseList',
                 'adminPayouts', 'adminReadiness', 'adminDigest', 'backupExport', 'backupImport'];
  for (const fn of gated) {
    const b = codeOnly(functionBody(src, fn) || '');
    ok(b.length > 40, fn + ' was read', b.length);
    ok(/_adminGate\(request, env,/.test(b), fn + ' goes through the one gate', fn);
  }
  /* And the bare predicate they used instead has no callers left, because a
     predicate is what let them drift in the first place. */
  const calls = (codeOnly(src).match(/_requireAdmin\(request, env\)/g) || []).length;
  ok(calls === 0, 'nothing checks admin-ness without the gate any more', calls);
}

section('The session-based screen shares the ceiling without sharing the key');
{
  const users = codeOnly(functionBody(src, 'adminUsers') || '');
  ok(/_adminRateLimit\(request, env, 'userlist'/.test(users),
     'the user list is rate limited like everything else', true);
  ok(/audit\(env, 'admin_user_list'/.test(users), 'and writes down who looked', true);
  /* It takes the CEILING and not the gate, which is the point: the first
     attempt at this passed a "already authenticated" flag into _adminGate, and
     that put a `return null` in front of the token check - the exact shape
     every-route-decides refuses, and rightly, because the next caller to pass
     the flag by mistake walks straight through. Splitting the function is the
     same behaviour with no door in it. */
  ok(!/_adminGate\(/.test(users),
     'while keeping its own credential rather than borrowing the operator gate', true);
  ok(!/tokenAlreadyChecked/.test(codeOnly(src)),
     'and there is no flag anywhere that skips a token check', true);

  /* The part that must NOT be true: a signed-in admin account cannot reach the
     routes that need the operator's token. */
  const env = mkEnv();
  await W.DB.put(env, 'acct', 'flagged@example.com',
    { email: 'flagged@example.com', name: 'F', provider: 'email', admin: true, createdAt: Date.now() });
  const asAdminAccount = await hitAdmin(env, '/admin/backup/export', await sessionOf(env, 'flagged@example.com'), '6.6.6.6');
  ok(asAdminAccount.status === 403,
     'an account flagged admin still cannot export the database with its session', asAdminAccount.status);
  const asOwner = await hitAdmin(env, '/admin/backup/export', await sessionOf(env, OWNER), '6.6.6.7');
  ok(asOwner.status === 403, 'and neither can the owner without the operator token', asOwner.status);
  const withToken = await hitAdmin(env, '/admin/backup/export', ADMIN, '6.6.6.8');
  ok(withToken.status === 200, 'while the operator token still works', withToken.status);
}

section('A counter that is down does not lock the operator out mid-incident');
{
  /* These are the routes somebody needs during exactly the failure that would
     break the counter. Refusing on an unenforceable limit would make readiness
     - whose whole job is to report that storage is broken - the first casualty
     of storage being broken. The token check is untouched either way. */
  const env = mkEnv();
  const broken = Object.assign({}, env, {
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { throw new Error('counter down'); } }) },
  });
  const r = await hitAdmin(broken, '/admin/readiness', ADMIN, '7.7.7.7');
  ok(r.status === 200, 'the operator still gets in', r.status);
  const stranger = await hitAdmin(broken, '/admin/readiness', 'wrong', '7.7.7.8');
  ok(stranger.status === 403, 'and a wrong token is still refused', stranger.status);
}

if (report('nothing-here-and-i-could-not-look') > 0) process.exitCode = 1;
done();
