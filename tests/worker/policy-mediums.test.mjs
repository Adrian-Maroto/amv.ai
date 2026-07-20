/* PASSWORD POLICY + WAITLIST (AMV-051, AMV-060). */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'policy-mediums.harness.mjs');
writeFileSync(harness, src + '\nexport { authSignup, waitlistAdd };\n');
const W = await import(harness + '?t=' + Date.now());

const mkEnv = () => { const store = new Map(); return { JWT_SECRET: 'x'.repeat(40), AMV_KV: {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v) { store.set(k, v); },
  async delete(k) { store.delete(k); },
} }; };
const signup = (env, email, password) => W.authSignup(new Request('https://api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, name: 'U', password }) }), env);
const wl = (env, ip) => W.waitlistAdd(new Request('https://api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify({ email: 'a@b.com', product: 'x' }) }), env);

/* ── AMV-051: password policy ──────────────────────────────────────────── */
section('AMV-051: stronger password policy at signup');
{
  const env = mkEnv();
  ok((await signup(env, 'a@x.com', 'short12')).status === 400, 'a 7-character password is rejected');
  ok((await signup(env, 'b@x.com', 'password123')).status === 400, 'a common password is rejected');
  ok((await signup(env, 'c@x.com', 'aaaaaaaa')).status === 400, 'an all-same-character password is rejected');
  const good = await signup(env, 'd@x.com', 'Str0ngPass!88');
  ok(good.status < 400, 'a strong password is accepted', good.status);
}

/* ── AMV-060: waitlist is rate limited ─────────────────────────────────── */
section('AMV-060: waitlist throttles per IP');
{
  const env = mkEnv();
  let limited = 0;
  for (let i = 0; i < 8; i++) { const r = await wl(env, '5.5.5.5'); if (r.status === 429) limited++; }
  ok(limited > 0, 'a burst of waitlist submissions from one IP is throttled', limited);
}

if (report() > 0) process.exitCode = 1;
done();
