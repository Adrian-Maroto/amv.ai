/* YOUR LIFETIME TOTALS ARE YOURS - KEPT FOR AS LONG AS THE ACCOUNT, AND NO LONGER.

   Lifetime usage (docs/OWNER-DECISIONS.md #14) is kept with no expiry, which is
   exactly what makes it dangerous to forget: every other per-account counter
   lapses on its own within weeks, so erasure never had to name them. This one
   would outlive the account for ever. Driven through the real counter object,
   a real sign-up and a real account deletion:

     the record keeps the last 36 months and drops the oldest;
     deleting the account takes the whole record with it;
     a deletion whose clear is not confirmed says so, rather than reporting
     an erasure that left data behind. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'lifetotals.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { counter };\n');
const W = await import(harness + '?t=' + Date.now());

globalThis.fetch = async () => new Response('{}', { status: 200 });
const dos = new Map();
let failClear = false;
function mkEnv() {
  const kv = new Map();
  return {
    AMV_KV: {
      async get(k, t) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); },
      async list({ prefix, cursor, limit } = {}) { return { keys: [...kv.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => { if (!dos.has(n)) { const st = new Map(); dos.set(n, new W.AMVCounter({ storage: {
        async get(k) { return st.get(k); }, async put(k, v) { st.set(k, v); }, async delete(k) { st.delete(k); },
        async deleteAll() { st.clear(); }, async setAlarm() {}, async deleteAlarm() {} } }, {})); }
        const d = dos.get(n);
        return { fetch: async (_u, init) => {
          const b = JSON.parse(init.body);
          if (failClear && b.op === 'clear') return new Response(JSON.stringify({ error: 'down' }), { status: 500 });
          return d.fetch(new Request('https://do/c', init));
        } };
      },
    },
    JWT_SECRET: 'j'.repeat(40), ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
  };
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
const req = (env, path, body, tok) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '77.77.77.77', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}) }), env, ctx);
const PW = 'A-real-Passw0rd!';
const tally = (env, who, month) => W.counter(env, 'life:' + who, { op: 'tally', tokens: 1000, msgs: 1, month, engine: 'amv-core' });
const read = async (env, who) => (await W.counter(env, 'life:' + who, { op: 'tallyGet' })).tally;

section('The record keeps three years of months, and drops the oldest');
{
  const env = mkEnv();
  for (let i = 0; i < 40; i++) {
    const d = new Date(Date.UTC(2023, i, 1));
    await tally(env, 'years@example.com', d.toISOString().slice(0, 7));
  }
  const t = await read(env, 'years@example.com');
  const months = Object.keys(t.months).sort();
  ok(t.msg === 40 && t.tok === 40000, 'all forty messages are in the all-time total', { msg: t.msg, tok: t.tok });
  ok(months.length === 36 && months[0] === '2023-05' && months[35] === '2026-04', 'and the last 36 months, oldest dropped first', [months[0], months[35], months.length]);
}

section('Deleting the account takes the lifetime totals with it');
{
  const env = mkEnv();
  const tok = (await (await req(env, '/auth/signup', { email: 'gone@example.com', name: 'G', password: PW })).json()).token;
  await tally(env, 'gone@example.com', '2026-10');
  ok((await read(env, 'gone@example.com')).msg === 1, 'there is a record before', true);
  const r = await req(env, '/auth/delete', { password: PW }, tok);
  ok(r.status === 200, 'the account is deleted', r.status);
  ok(!(await read(env, 'gone@example.com')), 'and nothing of its lifetime totals is left', await read(env, 'gone@example.com'));
}

section('A clear that is not confirmed is reported, not passed off as done');
{
  const env = mkEnv();
  const tok = (await (await req(env, '/auth/signup', { email: 'stuck@example.com', name: 'S', password: PW })).json()).token;
  await tally(env, 'stuck@example.com', '2026-10');
  failClear = true;
  const r = await req(env, '/auth/delete', { password: PW }, tok);
  failClear = false;
  const body = await r.json().catch(() => ({}));
  ok(JSON.stringify(body).includes('lifetime usage totals'), 'the deletion names what it could not remove', body);
}

if (report('your-lifetime-totals-leave-with-you') > 0) process.exitCode = 1;
done();
