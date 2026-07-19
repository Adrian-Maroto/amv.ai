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
writeFileSync(harness, src + '\nexport { errorsList, adminUsers, issueTokens };\n');
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

/* ── AMV-035: admin token is header-only, constant-time, fail-closed ────── */
section('AMV-035: admin token must be a header, not a body field');
{
  store.clear();
  const env = mkEnv({ ADMIN_TOKEN: 'admin-secret' });
  // token in the BODY only → rejected (bodies leak into logs)
  let r = await W.errorsList(new Request('https://api/errors/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'admin-secret' }) }), env);
  ok(r.status === 401, 'a token supplied in the request BODY is rejected', r.status);
  // token in the header → accepted
  r = await W.errorsList(new Request('https://api/errors/list', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'admin-secret' }, body: '{}' }), env);
  ok(r.status === 200, 'the correct token in the X-Admin-Token header is accepted', r.status);
  // wrong token → rejected
  r = await W.errorsList(new Request('https://api/errors/list', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'nope' }, body: '{}' }), env);
  ok(r.status === 401, 'a wrong header token is rejected', r.status);
}
section('AMV-035: admin endpoints fail closed when ADMIN_TOKEN is unset');
{
  store.clear();
  const env = mkEnv({});   // no ADMIN_TOKEN
  const r = await W.errorsList(new Request('https://api/errors/list', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'anything' }, body: '{}' }), env);
  ok(r.status === 401, 'with no ADMIN_TOKEN configured, admin access is denied', r.status);
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

if (report() > 0) process.exitCode = 1;
done();
