/* THE CAP COULD NOT SEE THE SPEND MOST LIKELY TO RUN AWAY.

   There is one daily spend ceiling, and it exists for the reason a ceiling
   always exists: a runaway bill kills a company faster than no customers do.

   It was checked in two places - chat and the widget - and the counter it reads
   was incremented in two places, the stream meter and the automation tick.
   Image generation and video generation, which call a paid provider and cost
   many times what a message costs, did neither. They never asked the ceiling
   for permission, and their cost never reached the number the ceiling reads.

   Three consequences, and the third is the quiet one:

     - the control could not stop the spend most able to run away;
     - the owner's daily spend figure understated the real bill;
     - per-account cost, and the list of accounts costing more than they pay,
       left out the accounts most likely to be on it.

   A number that is quietly wrong is worse than one that is missing, because
   somebody steers by it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'ceiling.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, setEntitlement, todayKey, monthKey, FREE_TIER_CAP_SHARE, _imageCost, _videoCost };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const CAP = 100;
let providerCalls = { image: 0, video: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (/image\.example/.test(u)) {
    providerCalls.image++;
    return new Response(JSON.stringify({ data: [{ b64_json: 'AAAA' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (/video\.example/.test(u)) {
    providerCalls.video++;
    return new Response(JSON.stringify({ id: 'prov_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

function mkEnv() {
  const m = new Map(); const vals = new Map(); providerCalls = { image: 0, video: 0 };
  return {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    GLOBAL_DAILY_USD_CAP: String(CAP),
    IMAGE_API_URL: 'https://image.example/v1', IMAGE_API_KEY: 'k',
    VIDEO_API_URL: 'https://video.example/v1', VIDEO_API_KEY: 'k', VIDEO_MODEL: 'v1',
    _vals: vals,
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: all.slice(0, limit || 1000), list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (x) => x,
      get: (x) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(x) || 0;
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: cur < b.cap, value: cur }));
        if (b.op === 'incr') { vals.set(x, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(x) })); }
        if (b.op === 'reserve') {
          const next = cur + (b.amount || 0);
          if (next > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
          vals.set(x, next); return new Response(JSON.stringify({ allowed: true, value: next }));
        }
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        if (b.op === 'rateCheck') { vals.set(x, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        if (b.op === 'claim') { if (vals.has('c:' + x)) return new Response(JSON.stringify({ claimed: false })); vals.set('c:' + x, 1); return new Response(JSON.stringify({ claimed: true })); }
        if (b.op === 'release') { vals.delete('c:' + x); return new Response(JSON.stringify({ ok: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const PW = 'A-real-Passw0rd!';
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '70.0.0.' + Math.floor(Math.random() * 250),
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b, t) => { const r = await call(env, p, b, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const signup = async (env, email) => (await (await call(env, '/auth/signup', { email, name: 'N', password: PW })).json()).token;

const spend = (env) => env._vals.get(`spend:${W.todayKey()}`) || 0;
const spendToday = (env, usd) => env._vals.set(`spend:${W.todayKey()}`, usd);
const makeImage = (env, tok) => post(env, '/v1/image/generate', { prompt: 'a house' }, tok);
const makeVideo = (env, tok) => post(env, '/v1/video/generate', { prompt: 'a house', seconds: 5 }, tok);

section('A picture costs something, and the something is not zero');
{
  ok(W._imageCost({}) > 0, 'an image has a stated price', W._imageCost({}));
  ok(W._videoCost({}) > 0, 'and so does a video', W._videoCost({}));
  ok(W._videoCost({}) > W._imageCost({}),
     'with video the more expensive of the two, which is the real ordering', {
       image: W._imageCost({}), video: W._videoCost({}) });
  ok(W._imageCost({ IMAGE_COST_USD: '0.25' }) === 0.25,
     'and a deployment can state its own, because providers change their prices',
     W._imageCost({ IMAGE_COST_USD: '0.25' }));
  ok(W._imageCost({ IMAGE_COST_USD: '0' }) > 0,
     'but not to nothing, which would restore exactly the blindness this closes',
     W._imageCost({ IMAGE_COST_USD: '0' }));
}

section('Generating a picture reaches the number the ceiling reads');
{
  const env = mkEnv();
  const tok = await signup(env, 'painter@example.com');
  await W.setEntitlement(env, 'painter@example.com', 'ultra', { source: 'stripe' });
  const before = spend(env);

  const r = await makeImage(env, tok);
  ok(r.body.ok === true, 'the picture is generated', r.body.error || 'ok');
  ok(providerCalls.image === 1, 'and it really went to the provider', providerCalls.image);
  const delta = spend(env) - before;
  ok(delta > 0, 'the day’s spend went up', delta);
  ok(Math.abs(delta - W._imageCost(env)) < 1e-9, 'by what a picture costs', delta);

  const mine = env._vals.get(`cost:painter@example.com:${W.monthKey()}`) || 0;
  ok(Math.abs(mine - W._imageCost(env)) < 1e-9,
     'and it is on the account that spent it, so unit economics can see it', mine);
}

section('And starting a video does too');
{
  const env = mkEnv();
  const tok = await signup(env, 'director@example.com');
  await W.setEntitlement(env, 'director@example.com', 'ultra', { source: 'stripe' });
  const before = spend(env);

  const r = await makeVideo(env, tok);
  ok(r.body.ok === true, 'the job starts', r.body.error || 'ok');
  const delta = spend(env) - before;
  ok(Math.abs(delta - W._videoCost(env)) < 1e-9, 'and is counted at what a video costs', delta);

  /* Counted at acceptance, because the provider bills for the render the moment
     it starts. Waiting for the finished file would leave every in-flight video
     invisible to the ceiling, and a burst of them is the shape of the bill this
     exists to stop. */
  ok(delta > 0, 'at the moment it is accepted, not when the file arrives', delta);
}

section('Past the ceiling, a picture is refused - and never paid for');
{
  const env = mkEnv();
  const tok = await signup(env, 'over@example.com');
  await W.setEntitlement(env, 'over@example.com', 'ultra', { source: 'stripe' });
  spendToday(env, CAP + 1);

  const r = await makeImage(env, tok);
  ok(r.status === 503, 'it is refused', r.status);
  ok(r.body.code === 'global_cap', 'by the ceiling, saying so', r.body.code);
  ok(providerCalls.image === 0, 'and nothing was spent at the provider', providerCalls.image);
}

section('Past the ceiling, a video is refused too');
{
  const env = mkEnv();
  const tok = await signup(env, 'over2@example.com');
  await W.setEntitlement(env, 'over2@example.com', 'ultra', { source: 'stripe' });
  spendToday(env, CAP + 1);

  const r = await makeVideo(env, tok);
  ok(r.status === 503, 'it is refused', r.status);
  ok(providerCalls.video === 0, 'and no render was started', providerCalls.video);
}

section('Being refused does not also cost them their own allowance');
{
  /* The per-user reservation is taken first. Refusing without giving it back
     would mean somebody turned away for capacity ALSO lost one of the images
     their plan includes. */
  const env = mkEnv();
  const tok = await signup(env, 'refunded@example.com');
  await W.setEntitlement(env, 'refunded@example.com', 'ultra', { source: 'stripe' });
  spendToday(env, CAP + 1);

  const key = `img:refunded@example.com:${W.todayKey()}`;
  const before = env._vals.get(key) || 0;
  await makeImage(env, tok);
  const after = env._vals.get(key) || 0;
  ok(after <= before, 'the image allowance is given back', { before, after });
}

section('On a busy day it is the free tier that stops, not the customer');
{
  /* The same order as chat: above the free share and below the whole ceiling,
     free stops and paid keeps working. Turning away somebody who has paid is a
     refund, then a chargeback, then a review. */
  const env = mkEnv();
  const free = await signup(env, 'freehand@example.com');
  const paid = await signup(env, 'paidhand@example.com');
  await W.setEntitlement(env, 'paidhand@example.com', 'ultra', { source: 'stripe' });
  spendToday(env, CAP * W.FREE_TIER_CAP_SHARE + 1);

  const a = await makeImage(env, free);
  ok(a.status === 503, 'the free account is turned away', a.status);
  ok(a.body.code === 'free_capacity', 'and told which kind of busy this is', a.body.code);
  ok(/free accounts/i.test(a.body.error || ''), 'in words that are true and worth knowing', a.body.error);

  const b = await makeImage(env, paid);
  ok(b.body.ok === true, 'while somebody who paid still gets their picture', b.body.error || 'ok');
}

section('Nothing is charged for a picture that was never produced');
{
  const env = mkEnv();
  const tok = await signup(env, 'unlucky@example.com');
  await W.setEntitlement(env, 'unlucky@example.com', 'ultra', { source: 'stripe' });
  const before = spend(env);
  const saved = globalThis.fetch;
  globalThis.fetch = async (url) => /image\.example/.test(String(url))
    ? new Response('upstream said no', { status: 502 })
    : ({ ok: true, status: 200, json: async () => ({}) });

  const r = await makeImage(env, tok);
  globalThis.fetch = saved;
  ok(r.status === 502, 'the failure is reported', r.status);
  ok(spend(env) === before, 'and the day’s spend did not move', spend(env) - before);
}

section('Every path that calls a paid provider goes through the one gate');
{
  /* Stated as a source rule, because the defect was not a wrong number - it was
     a path nobody had put inside the ceiling, and the next one added would be
     outside it for the same reason. */
  const gated = ['aiProxy', 'widgetChat', 'imageGenerate', 'videoGenerate'];
  const missing = gated.filter(fn => {
    const m = src.match(new RegExp('async function ' + fn + '\\s*\\('));
    if (!m) return true;
    const nexts = [src.indexOf('\nasync function ', m.index + 10), src.indexOf('\nfunction ', m.index + 10)].filter(i => i > 0);
    const body = src.slice(m.index, Math.min(...nexts));
    return !/_spendGate\(|GLOBAL_DAILY_USD_CAP/.test(body);
  });
  ok(missing.length === 0, 'no spending path is outside the day’s ceiling', missing);
}

globalThis.fetch = realFetch;
if (report('the-ceiling-covers-what-costs-most') > 0) process.exitCode = 1;
done();
