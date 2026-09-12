/* ADMIN AUTH / OWNER IDENTITY (AMV-034, AMV-035).

   AMV-034  owner privilege came from a hardcoded personal-email fallback. It now
            comes ONLY from the configured OWNER_EMAIL (fail closed if unset).
   AMV-035  the admin token was accepted from the request BODY (captured by logs)
            with a non-constant-time compare. It is now header-only, constant-time
            and fails closed when ADMIN_TOKEN is unconfigured. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'admin-security.harness.mjs');
writeFileSync(harness, src + '\nexport { errorsList, adminUsers, issueTokens, _adminGate };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const mkEnv = (extra = {}) => ({
  JWT_SECRET: 'x'.repeat(40),
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
  },
  ...extra,
});
const jget = async (r) => { try { return await r.json(); } catch { return {}; } };

/* Why the refusal is 403 and not 401.

   These three asserted 401 while every other admin route in the product
   answered 403, and once all of them went through one gate the disagreement
   had to be settled. 401 reads better in the abstract - no valid credential
   was presented - but it is the wrong answer HERE, for a reason in the client:
   src/app/01-core.js treats a 401 on any non-/auth call as an expired SESSION,
   silently refreshes the token and signs the person out if that fails. An
   operator whose admin token is stale would be logged out of their own
   account, which is a different fault than the one that happened. Their
   session is fine; the admin token is not. 403 says exactly that, and it is
   what the rest of the admin surface already said. */

/* ── AMV-035: admin token is header-only, constant-time, fail-closed ────── */
section('AMV-035: admin token must be a header, not a body field');
{
  store.clear();
  const env = mkEnv({ ADMIN_TOKEN: 'admin-secret' });
  // token in the BODY only → rejected (bodies leak into logs)
  let r = await W.errorsList(new Request('https://api/errors/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'admin-secret' }) }), env);
  ok(r.status === 403, 'a token supplied in the request BODY is rejected', r.status);
  // token in the header → accepted
  r = await W.errorsList(new Request('https://api/errors/list', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'admin-secret' }, body: '{}' }), env);
  ok(r.status === 200, 'the correct token in the X-Admin-Token header is accepted', r.status);
  // wrong token → rejected
  r = await W.errorsList(new Request('https://api/errors/list', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'nope' }, body: '{}' }), env);
  ok(r.status === 403, 'a wrong header token is rejected', r.status);
}
section('AMV-035: admin endpoints fail closed when ADMIN_TOKEN is unset');
{
  store.clear();
  const env = mkEnv({});   // no ADMIN_TOKEN
  const r = await W.errorsList(new Request('https://api/errors/list', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'anything' }, body: '{}' }), env);
  ok(r.status === 403, 'with no ADMIN_TOKEN configured, admin access is denied', r.status);
}

/* ── AMV-034: owner identity comes only from OWNER_EMAIL ────────────────── */
section('AMV-034: no hardcoded owner-email fallback');
{
  store.clear();
  const HARD = 'amarotovaleria@gmail.com';   // the former hardcoded fallback
  // env WITHOUT OWNER_EMAIL: the previously-hardcoded address is NOT owner
  let env = mkEnv({});
  store.set(`acct:${HARD}`, JSON.stringify({ email: HARD }));
  let tokn = (await W.issueTokens(env, HARD, 'X')).token;
  let r = await W.adminUsers(new Request('https://api/admin/users', { headers: { Authorization: 'Bearer ' + tokn } }), env);
  ok(r.status === 403, 'the formerly-hardcoded email is NOT owner when OWNER_EMAIL is unset', r.status);
  // env WITH OWNER_EMAIL set to that address: now they are owner
  env = mkEnv({ OWNER_EMAIL: HARD });
  tokn = (await W.issueTokens(env, HARD, 'X')).token;
  r = await W.adminUsers(new Request('https://api/admin/users', { headers: { Authorization: 'Bearer ' + tokn } }), env);
  ok(r.status === 200, 'the configured OWNER_EMAIL grants owner access', r.status);
}

section('The limit in front of the admin door is a real limit');
{
  /* THE GUARD THAT ONLY MATTERS ONCE THE TOKEN IS ALREADY LOST.

     `_adminGate` runs a rate limit BEFORE the token check, and the comment on
     the most expensive route in the product says why: backup export reads
     every record under every prefix, and "anything faster than that is either
     a script gone wrong or somebody draining the store through a token they
     should not have."

     So it is the second lock. The token check stops a stranger; this bounds
     what a STOLEN token is worth, which is the scenario where every other
     admin defence has already failed. Nothing tested it - deleting the refusal
     broke no suite in the repository - and an unbounded drain is precisely the
     difference between an incident and a breach.

     Driven through _adminGate directly, because the point is the gate rather
     than any one route that calls it. */
  const env = mkEnv({ ADMIN_TOKEN: 'admin-secret' });
  const hit = () => W._adminGate(new Request('https://api/admin/backup/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'admin-secret',
               'CF-Connecting-IP': '203.0.113.9' },
    body: '{}',
  }), env, 'backuptest', 3, 100);

  const first = [];
  for (let i = 0; i < 3; i++) first.push(await hit());
  ok(first.every(r => r === null), 'the calls inside the limit are allowed through', first.map(r => r && r.status).join(','));

  const over = await hit();
  ok(over !== null, 'the call past the limit is refused rather than served', over && over.status);
  ok(over && over.status === 429, 'with 429, which says slow down rather than forbidden', over && over.status);
  const body = await jget(over);
  ok(/too fast|daily limit/i.test(body.error || ''),
     'and a sentence an operator can act on', body.error);

  /* THE OTHER DIRECTION, which is deliberate and easy to "fix" by mistake.

     When the counter store cannot be reached the gate does NOT refuse. These
     are the routes an operator needs during exactly that failure - readiness
     exists to report that storage is broken and must not be the first casualty
     of it. The token check is untouched and still fails closed, so this widens
     nothing to a stranger. Pinned here so a later reader does not turn a
     considered fail-open into a fail-closed and lock the operator out mid
     incident. */
  const blind = mkEnv({ ADMIN_TOKEN: 'admin-secret',
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { throw new Error('counter down'); } }) } });
  let allowed = 0;
  for (let i = 0; i < 6; i++) {
    const r = await W._adminGate(new Request('https://api/admin/backup/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'admin-secret',
                 'CF-Connecting-IP': '203.0.113.10' },
      body: '{}',
    }), blind, 'backupblind', 1, 2);
    if (r === null) allowed++;
  }
  ok(allowed === 6, 'a limit that cannot be evaluated does not lock the operator out', allowed);

  const stranger = await W._adminGate(new Request('https://api/admin/backup/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'wrong',
               'CF-Connecting-IP': '203.0.113.11' },
    body: '{}',
  }), blind, 'backupblind2', 1, 2);
  ok(stranger !== null && stranger.status === 403,
     'and the token check is still fail-closed while the limit is blind', stranger && stranger.status);
}

if (report() > 0) process.exitCode = 1;
done();
