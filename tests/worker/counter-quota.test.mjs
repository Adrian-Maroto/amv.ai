/* COUNTER / QUOTA REGRESSIONS (AMV-017, AMV-016).

   AMV-017  the reserve op checked the PRE-increment value against the cap, so
            the final reservation before the cap overshot by up to `amount`
            (reproduced: cur 95, amount 10, cap 100 -> allowed, value 105).
            Invalid amounts (negative, NaN) were also not rejected.
   AMV-016  when the atomic counter Durable Object is bound but fails, the code
            silently degrades to non-atomic KV. That degradation must now raise a
            throttled operator alert instead of transparently weakening quotas. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'counter-quota.harness.mjs');
writeFileSync(harness, src + '\nexport { counter };\n');
const W = await import(harness + '?t=' + Date.now());

const mkKV = () => { const m = new Map(); return { m,
  async get(k) { return m.has(k) ? m.get(k) : null; },
  async put(k, v) { m.set(k, v); },
  async delete(k) { m.delete(k); },
}; };

/* ── AMV-017: reservation never overshoots the cap ─────────────────────── */
section('AMV-017: reserve denies when the RESULT would exceed the cap');
{
  const env = { AMV_KV: mkKV() };   // no AMV_COUNTER -> KV fallback path
  let r = await W.counter(env, 'q1', { op: 'reserve', amount: 95, cap: 100 });
  ok(r.allowed && r.value === 95, '95 under a cap of 100 is allowed', r);
  r = await W.counter(env, 'q1', { op: 'reserve', amount: 10, cap: 100 });
  ok(!r.allowed && r.value === 95, '95+10 would exceed 100 -> DENIED, value unchanged', r);
  r = await W.counter(env, 'q1', { op: 'reserve', amount: 5, cap: 100 });
  ok(r.allowed && r.value === 100, 'reserving up to EXACTLY the cap is allowed', r);
  r = await W.counter(env, 'q1', { op: 'reserve', amount: 1, cap: 100 });
  ok(!r.allowed, 'reserving past a full counter is denied', r);
}
section('AMV-017: invalid reservation amounts are rejected');
{
  const env = { AMV_KV: mkKV() };
  let r = await W.counter(env, 'qneg', { op: 'reserve', amount: -50, cap: 100 });
  ok(!r.allowed, 'a negative amount is rejected', r);
  r = await W.counter(env, 'qnan', { op: 'reserve', amount: 'abc', cap: 100 });
  ok(!r.allowed, 'a non-numeric amount is rejected', r);
  r = await W.counter(env, 'qinf', { op: 'reserve', amount: Infinity, cap: 100 });
  ok(!r.allowed, 'a non-finite amount is rejected', r);
}

/* ── AMV-016: a DO failure raises a throttled alert (no silent downgrade) ─ */
section('AMV-016: atomic-counter degradation is alerted, not silent');
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });   // stub the webhook post
  const kv = mkKV();
  const env = {
    AMV_KV: kv,
    ALERT_WEBHOOK: 'https://hook.invalid/x',
    AMV_COUNTER: { idFromName: () => 'id', get: () => ({ fetch: async () => { throw new Error('DO unavailable'); } }) },
  };
  const r = await W.counter(env, 'qx', { op: 'get' });
  globalThis.fetch = realFetch;
  ok(r && typeof r.value === 'number', 'a DO failure still returns a value via KV fallback', r);
  ok(!!(await kv.get('alerted:counter_degraded')), 'the degradation raised a (throttled) operator alert');
}

if (report() > 0) process.exitCode = 1;
done();
