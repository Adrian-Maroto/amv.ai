/* ALIVE IS NOT READY.

   Scale audit, Oct 26. /v1/health said "ok" whenever the Worker ran, so a
   deployment whose store could not be reached looked healthy to every
   monitor. /v1/health/ready asks the stores. Checked here, through the real
   router:
     - healthy stores: 200, ready, each check named with its time;
     - a KV that fails: 503, not ready, and which check failed and why;
     - a Durable Object that hangs: 503 within its own time limit, not a hang;
     - what is switched on comes back as booleans, with no secret in it;
     - it is a GET, needs no sign-in, and works while spending is paused;
     - asked in a loop it is held, so a loop costs what one call costs. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const load = async () => {
  /* A fresh module each time: the ten-second hold is per isolate, and each
     section is a different isolate's first look. */
  const h = join(__dir, '.build', 'ready.' + Math.random().toString(36).slice(2) + '.harness.mjs');
  writeFileSync(h, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8'));
  return (await import(h)).default;
};
const kv = (over = {}) => { const m = new Map(); let reads = 0, writes = 0; return Object.assign({
  get reads() { return reads; }, get writes() { return writes; },
  async get(k) { reads++; return m.has(k) ? m.get(k) : null; }, async put(k, v) { writes++; m.set(k, v); },
  async delete(k) { m.delete(k); }, async list() { return { keys: [], list_complete: true }; } }, over); };
const counterNs = (fetchImpl) => { let calls = 0; return { get calls() { return calls; }, idFromName: n => n,
  get: () => ({ fetch: async (...a) => { calls++; return fetchImpl(...a); } }) }; };
const okCounter = () => counterNs(async () => new Response(JSON.stringify({ value: 0 })));
const get = (w, env, path = '/v1/health/ready', method = 'GET') => w.fetch(new Request('https://api.amv.test' + path, { method }), env, { waitUntil() {} });
const SECRET = 'sk_live_this_must_never_be_echoed_1234567890';

section('Healthy stores: ready');
{
  const w = await load();
  const env = { AMV_KV: kv(), AMV_COUNTER: okCounter(), AMV_MODEL_KEY: SECRET, STRIPE_SECRET_KEY: SECRET, STRIPE_WEBHOOK_SECRET: 'whsec', EMAIL_API_KEY: SECRET, JWT_SECRET: 'j' };
  const r = await get(w, env); const d = await r.json();
  ok(r.status === 200 && d.ready === true, 'answers 200 and ready', { status: r.status, d });
  ok(d.checks.kv.ok && typeof d.checks.kv.ms === 'number' && d.checks.counter.ok, 'names each store it asked, with how long it took', d.checks);
  ok(env.AMV_KV.reads >= 1 && env.AMV_COUNTER.calls === 1, 'it really read KV and really asked the Durable Object', { r: env.AMV_KV.reads, c: env.AMV_COUNTER.calls });
  ok(env.AMV_KV.writes === 0, 'and wrote nothing - it is a GET', env.AMV_KV.writes);
  ok(d.capabilities.model === true && d.capabilities.payments === true && d.capabilities.email === true && d.capabilities.browser === false && d.capabilities.library === false,
     'says what is switched on, as booleans', d.capabilities);
  ok(!JSON.stringify(d).includes(SECRET) && !JSON.stringify(d).includes('whsec'), 'and no secret appears anywhere in it');
}

section('Notifications read as on only when both keys have the right shape - never the keys themselves');
{
  const PUB = 'B' + 'x'.repeat(86), PRIV = 'p'.repeat(43);
  const w = await load();
  const base = () => ({ AMV_KV: kv(), AMV_COUNTER: okCounter(), JWT_SECRET: 'j' });
  const off = await (await get(w, base())).json();
  ok(off.capabilities.notifications === false && off.capabilities.job_queue === false && off.capabilities.nightly_backup === false && off.capabilities.postgres === false,
     'nothing set: each reads off', off.capabilities);
  const w2 = await load();
  const on = await (await get(w2, Object.assign(base(), { VAPID_PUBLIC_KEY: PUB, VAPID_PRIVATE_KEY: PRIV }))).json();
  ok(on.capabilities.notifications === true, 'both keys set: on', on.capabilities);
  ok(!JSON.stringify(on).includes(PRIV) && !JSON.stringify(on).includes(PUB), 'and neither key appears in the answer');
  const w3 = await load();
  const bad = await (await get(w3, Object.assign(base(), { VAPID_PUBLIC_KEY: PUB, VAPID_PRIVATE_KEY: 'VAPID_PRIVATE_KEY=' + PRIV }))).json();
  ok(bad.capabilities.notifications === false, 'a key pasted with its label still on it reads as off, so the mistake shows', bad.capabilities);
}

section('State, not only bindings: a backup that finished, and Postgres answering every read (Nov 1 audit REL-001/003)');
{
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const BK = { put: async () => {}, get: async () => null, list: async () => ({ objects: [] }) };
  const PG = { connectionString: 'postgres://u@h:5432/d' };
  const base = (extra) => Object.assign({ AMV_KV: kv(), AMV_COUNTER: okCounter(), JWT_SECRET: 'j', AMV_BACKUPS: BK }, extra || {});
  const none = await (await get(await load(), base())).json();
  ok(none.capabilities.nightly_backup === true && none.capabilities.backup_fresh === false, 'backups switched on but none finished: not fresh', none.capabilities);
  /* Nov 3 audit REL-017: a status record saying "done" is not a backup. */
  const e1 = base(); await e1.AMV_KV.put('bkrun:' + day(Date.now() - 86400000), JSON.stringify({ done: true }));
  const y = await (await get(await load(), e1)).json();
  ok(y.capabilities.backup_fresh === false && /no complete backup/.test(y.state.backup), 'a record that says last night finished, with no manifest behind it: not fresh, and why', y.state);
  const e2 = base(); await e2.AMV_KV.put('bkrun:' + day(Date.now() - 3 * 86400000), JSON.stringify({ done: true }));
  await e2.AMV_KV.put('bkrun:' + day(Date.now()), JSON.stringify({ done: false }));
  const old = await (await get(await load(), e2)).json();
  ok(old.capabilities.backup_fresh === false, 'only an older one, and tonight\u2019s still running: not fresh', old.capabilities);
  const half = await (await get(await load(), base({ PG, PG_READ: '50%' }))).json();
  ok(half.capabilities.postgres === true && half.capabilities.postgres_reads_all === false, 'Postgres bound and answering half: not all', half.capabilities);
  /* Nov 3 audit REL-018: the dial at 100% is not a cutover. This database
     does not answer, so nothing about the move can be shown clean. */
  const all = await (await get(await load(), base({ PG, PG_READ: '100%' }))).json();
  ok(all.capabilities.postgres_reads_all === false && all.state.postgres.blockers.length > 0, 'the cohort at 100% with nothing proved: not all, and the blockers named', all.state.postgres);
  const unbound = await (await get(await load(), base({ PG_READ: '100%' }))).json();
  ok(unbound.capabilities.postgres_reads_all === false, 'the variable without a database is not "all"', unbound.capabilities);
}

section('A store that fails: not ready, and which one');
{
  const w = await load();
  const env = { AMV_KV: kv({ async get() { throw new Error('KV GET failed: 503'); } }), AMV_COUNTER: okCounter(), JWT_SECRET: 'j' };
  const r = await get(w, env); const d = await r.json();
  ok(r.status === 503 && d.ready === false, 'answers 503, so a monitor needs no parsing to page somebody', r.status);
  ok(d.checks.kv.ok === false && /503/.test(d.checks.kv.why) && d.checks.counter.ok === true, 'and says KV failed, why, and that the rest did not', d.checks);
}

section('A Durable Object that hangs: an answer, not a hang');
{
  const w = await load();
  const env = { AMV_KV: kv(), AMV_COUNTER: counterNs(() => new Promise(() => {})), JWT_SECRET: 'j' };
  const t = Date.now(); const r = await get(w, env); const d = await r.json(); const took = Date.now() - t;
  ok(r.status === 503 && d.checks.counter.ok === false && /timed out/.test(d.checks.counter.why), 'the stuck check is reported as timed out', d.checks.counter);
  ok(took < 6000, 'within its own limit', took + 'ms');
}

section('A GET, no sign-in, and through a spending pause');
{
  const w = await load();
  const store = kv(); await store.put('GLOBAL_KILL', '1');
  const env = { AMV_KV: store, AMV_COUNTER: okCounter(), JWT_SECRET: 'j' };
  const r = await get(w, env); 
  ok(r.status === 200, 'paused spending is not "not ready" - an outage stays distinguishable from a pause', r.status);
  const post = await get(w, env, '/v1/health/ready', 'POST');
  ok(post.status !== 404 && post.status < 500, 'a POST does not break it either', post.status);
}

section('Asked in a loop, it is held');
{
  const w = await load();
  const env = { AMV_KV: kv(), AMV_COUNTER: okCounter(), JWT_SECRET: 'j' };
  for (let i = 0; i < 50; i++) await get(w, env);
  ok(env.AMV_COUNTER.calls === 1, 'fifty calls ask the Durable Object once', { counter: env.AMV_COUNTER.calls });
}

section('Liveness is unchanged');
{
  const w = await load();
  const r = await get(w, { AMV_KV: kv({ async get() { throw new Error('down'); } }), JWT_SECRET: 'j' }, '/v1/health');
  ok(r.status === 200, '/v1/health still answers ok with the store down - it is about the Worker, not its stores', r.status);
}

if (report('alive-is-not-ready') > 0) process.exitCode = 1;
done();
