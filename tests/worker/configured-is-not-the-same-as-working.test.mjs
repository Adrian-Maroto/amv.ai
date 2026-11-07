/* CONFIGURED IS NOT THE SAME AS WORKING (Nov 3 audit REL-003, REL-019).

   Readiness used to say a capability was "on" because its key was present.
   This holds the hourly checks that make each one prove it: a real, harmless
   operation with the real credentials, kept and reported as `proved`, and a
   broken one told to the owner by name. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'synth.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { runCapabilitySynthetics, _synthProved, healthReady, SYNTH_CRON };\n');
const W = await import(harness + '?t=' + Date.now());
const quiet = console.log; console.log = () => {};

function mkEnv(extra) {
  const m = new Map(), files = new Map();
  return Object.assign({
    JWT_SECRET: 'j'.repeat(40), AMV_MODEL_KEY: 'mk', EMAIL_API_KEY: 're_x', STRIPE_SECRET_KEY: 'sk_x', ALERT_WEBHOOK: 'https://hooks.example/owner',
    AMV_KV: { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
    AMV_FILES: { async put(k, v) { files.set(k, String(v)); }, async get(k) { return files.has(k) ? { text: async () => files.get(k) } : null; }, async delete(k) { files.delete(k); }, _files: files },
  }, extra || {});
}
let answer = {};
const seen = [], told = [];
globalThis.fetch = async (u, init) => {
  u = String(u); seen.push(u);
  if (u === 'https://hooks.example/owner') { told.push(JSON.parse(init.body).text); return new Response('{}'); }
  for (const [frag, status] of Object.entries(answer)) if (u.includes(frag)) return new Response('{}', { status });
  if (/\/v1\/messages/.test(u)) return new Response(answer.__noStart ? 'event: ping\n\n' : 'event: message_start\ndata: {"type":"message_start"}\n\n', { status: 200 });
  return new Response('{}', { status: 200 });
};

section('Every configured capability does one real, harmless thing');
{
  const env = mkEnv(); answer = {}; seen.length = 0;
  const r = await W.runCapabilitySynthetics(env);
  ok(r.results.model.ok === true && seen.some(u => /\/v1\/messages/.test(u)), 'the model answers one token, streamed - a real reply, not a list (READY-022)', r.results.model);
  ok(r.results.email.ok === true && seen.some(u => /api\.resend\.com\/domains/.test(u)), 'the email key reads its sending domains', r.results.email);
  ok(r.results.payments.ok === true && seen.some(u => /api\.stripe\.com\/v1\/balance/.test(u)), 'the payments key reads the balance - a read, nothing charged', r.results.payments);
  ok(r.results.library.ok === true && env.AMV_FILES._files.size === 0, 'storage writes, reads back and deletes its probe, leaving nothing', r.results.library);
  ok(r.results.postgres.ok === null && /not configured/.test(r.results.postgres.why), 'what is not configured is said to be, not counted as working', r.results.postgres);
  ok(['job_queue', 'browser', 'meaning'].every(k => r.results[k].ok === null && /not exercised/.test(r.results[k].why)), 'and what is not exercised says so');
  ok(r.failed.length === 0, 'nothing failed', r.failed);
  ok(!seen.some(u => /charges|payment_intents|emails$/.test(u)), 'nothing was charged or sent', seen);
}

section('A key the provider no longer takes is found, named and told');
{
  const env = mkEnv(); answer = { 'api.stripe.com': 401 }; told.length = 0;
  const r = await W.runCapabilitySynthetics(env);
  ok(r.results.payments.ok === false && /401/.test(r.results.payments.why), 'the payments check fails with the provider’s own answer', r.results.payments);
  ok(r.failed.join() === 'payments', 'only payments is failing', r.failed);
  ok(told.length === 1 && /payments/.test(told[0]) && /401/.test(told[0]), 'the owner is told which, and what the provider said', told);
  told.length = 0; await W.runCapabilitySynthetics(env);
  ok(told.length === 0, 'and not again within the day', told);
  const p = await W._synthProved(env, Date.now());
  ok(p.state === 'failing' && p.proved.payments === false && p.proved.model === true, 'readiness reports it as configured and broken', p);
}

section('A model key that lists models but cannot answer is broken (Nov 7 audit READY-022)');
{
  answer = { '/v1/messages': 402 };
  let r = await W.runCapabilitySynthetics(mkEnv());
  ok(r.results.model.ok === false && /402/.test(r.results.model.why), 'out of credit at the provider: the check fails, saying so', r.results.model);
  answer = { __noStart: true };
  r = await W.runCapabilitySynthetics(mkEnv());
  ok(r.results.model.ok === false && /no reply started/.test(r.results.model.why), 'an answer that never starts a reply fails too', r.results.model);
  answer = {};
}

section('A send-only email key is working; an unknown one is not');
{
  const env = mkEnv();
  const real = globalThis.fetch;
  const answerWith = (status, name) => { globalThis.fetch = async (u, init) => String(u).includes('api.resend.com') ? new Response(JSON.stringify({ name, message: 'x' }), { status }) : real(u, init); };
  answerWith(401, 'restricted_api_key');
  let r = await W.runCapabilitySynthetics(env);
  ok(r.results.email.ok === true, 'a key the provider says may only send is a key that works - not BROKEN', r.results.email);
  answerWith(403, 'invalid_api_key');
  r = await W.runCapabilitySynthetics(env);
  ok(r.results.email.ok === false && /403/.test(r.results.email.why) && /invalid_api_key/.test(r.results.email.why), 'a key it does not know fails, naming why', r.results.email);
  answerWith(401, 'missing_api_key');
  r = await W.runCapabilitySynthetics(env);
  ok(r.results.email.ok === false, 'and so does any other refusal', r.results.email);
  globalThis.fetch = real;
}

section('Storage that answers with something else fails');
{
  const env = mkEnv(); answer = {};
  env.AMV_FILES.get = async () => ({ text: async () => 'not what was written' });
  const r = await W.runCapabilitySynthetics(env);
  ok(r.results.library.ok === false && /something else/.test(r.results.library.why), 'a read-back that differs is not a working store', r.results.library);
}

section('Readiness carries it, and an old result is not proof');
{
  const env = mkEnv(); answer = {};
  await W.runCapabilitySynthetics(env);
  const res = await W.healthReady(new Request('https://api.amv.test/v1/health/ready'), env);
  const d = await res.json();
  ok(d.proved && d.proved.model === true && d.proved.payments === true && d.state.synthetics.state === 'ok', '/v1/health/ready says what was proved, and when', { proved: d.proved, s: d.state.synthetics });
  ok(!JSON.stringify(d).includes('sk_x') && !JSON.stringify(d).includes('re_x'), 'and carries no key');
  const later = await W._synthProved(env, Date.now() + 3 * 3600 * 1000);
  ok(later.state === 'stale' && !later.proved, 'three hours on, it is stale - not counted as proved', later);
  const fresh = await W._synthProved(mkEnv(), Date.now());
  ok(fresh.state === 'never', 'and a deployment that never ran a check says so', fresh);
}

section('A probe that hangs does not hang the check');
{
  const env = mkEnv(); answer = {};
  const real = globalThis.fetch;
  globalThis.fetch = (u, init) => String(u).includes('resend') ? new Promise((_, rej) => init && init.signal && init.signal.addEventListener('abort', () => rej(new Error('aborted')))) : real(u, init);
  const t = Date.now();
  const r = await W.runCapabilitySynthetics(env);
  globalThis.fetch = real;
  ok(r.results.email.ok === false && Date.now() - t < 15000, 'it is cut off and reported, the rest still answered', { email: r.results.email, ms: Date.now() - t });
}

section('It has a trigger of its own, and the five-minute tick does not run it');
{
  const toml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
  ok(W.SYNTH_CRON === '17 * * * *' && toml.includes('"' + W.SYNTH_CRON + '"'), 'its hourly schedule is in the deployed configuration', W.SYNTH_CRON);
  const run = async (cron) => {
    const env = mkEnv(); seen.length = 0; answer = {};
    const c = { _p: [], waitUntil(p) { this._p.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {} };
    await W.default.scheduled({ cron, scheduledTime: Date.UTC(2026, 10, 7, 4, 17) }, env, c);
    await Promise.all(c._p);
    return { probed: seen.some(u => /\/v1\/messages|api\.stripe\.com\/v1\/balance/.test(u)), kept: !!(await env.AMV_KV.get('synth:last')) };
  };
  const hourly = await run(W.SYNTH_CRON);
  ok(hourly.probed && hourly.kept, 'the hourly trigger runs the checks and keeps the answer', hourly);
  const tick = await run('*/5 * * * *');
  ok(!tick.probed && !tick.kept, 'the five-minute tick does not', tick);
  const paused = mkEnv(); await paused.AMV_KV.put('GLOBAL_KILL', '1'); seen.length = 0;
  const c = { _p: [], waitUntil(p) { this._p.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {} };
  await W.default.scheduled({ cron: W.SYNTH_CRON }, paused, c); await Promise.all(c._p);
  ok(!seen.some(u => /\/v1\/messages/.test(u)), 'and nothing is called while AMV is paused', seen);
}

console.log = quiet;
report();
done();
