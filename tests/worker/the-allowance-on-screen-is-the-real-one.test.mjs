/* THE NUMBER ON THE SCREEN IS THE NUMBER THAT REFUSES YOU.

   A person opens the usage page for one reason: to find out what they have
   left. If that figure is not the one the server enforces, the page is worse
   than blank - they plan around it, and then get refused at a number they were
   never shown, or stop early at a limit that was never real.

   Both failures were live.

   The images bar was a device-local count against a hardcoded 4. The real cap
   is 100 a day on Pro and 2000 on Ultra, so somebody paying was shown a ceiling
   five hundred times smaller than the one they bought. Nothing errored; the bar
   just filled up and said upgrade, to a customer already on the top plan.

   Video was worse in the other direction: `/v1/video/list` existed, worked, and
   had tests, and no screen anywhere read it. The allowance somebody pays twenty
   videos a month for was invisible until generation refused.

   So this file asserts one thing in several ways: every allowance a person can
   spend is reported by the server, from the same counter that enforces it, and
   moves when the plan moves. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const client = readFileSync(join(ROOT, 'app.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'allowance.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, PLAN_LIMITS };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

function mkEnv(extra) {
  const m = new Map(); const vals = new Map();
  return Object.assign({
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit, cursor } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        const from = cursor ? +cursor : 0;
        const page = all.slice(from, from + (limit || 1000));
        return { keys: page, list_complete: from + page.length >= all.length, cursor: String(from + page.length) };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if (b.op === 'reserve') {
          if (b.cap != null && cur + b.amount > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
          vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: vals.get(n) }));
        }
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  }, extra || {});
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '44.44.44.44',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b, t) => { const r = await call(env, p, b, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const PW = 'A-real-Passw0rd!';
const USER = 'spender@example.com';
async function signedIn(env, plan) {
  const tok = (await (await call(env, '/auth/signup', { email: USER, name: 'S', password: PW })).json()).token;
  if (plan) await W.DB.put(env, 'ent', USER, { plan, source: 'stripe', updatedAt: Date.now(), renewedAt: Date.now() });
  return tok;
}

section('Every allowance a person can spend is reported');
{
  const env = mkEnv();
  const tok = await signedIn(env, 'pro');
  const u = (await post(env, '/v1/usage', {}, tok)).body;
  ok(!!u.day && !!u.month, 'tokens, as before', !!u.day);
  ok(!!u.images, 'images', u.images);
  ok(!!u.videos, 'and video, which nothing reported at all before', u.videos);
}

section('And it is the number the server actually enforces');
{
  /* The point of the whole file. Read the reported cap, then spend up to it and
     one past it, and require the refusal to land exactly where the screen said
     it would. A hardcoded number on a page cannot pass this. */
  const env = mkEnv();
  const tok = await signedIn(env, 'pro');
  const u = (await post(env, '/v1/usage', {}, tok)).body;
  const cap = (u.images || {}).limit;
  ok(cap != null && cap === W.PLAN_LIMITS.pro.imagesDay,
     'the reported image cap is the plan’s own number', { reported: cap, plan: W.PLAN_LIMITS.pro.imagesDay });
  ok(cap > 4, 'and is nothing like the 4 the screen used to claim', cap);
  if (cap == null) throw new Error('no image cap reported - the sections below cannot run');

  /* Spend the whole day's allowance through the metering route. */
  let lastOk = 0, refusedAt = 0;
  for (let i = 1; i <= cap + 1; i++) {
    const r = await post(env, '/v1/image', {}, tok);
    if (r.status === 200) lastOk = i; else { refusedAt = i; break; }
  }
  ok(lastOk === cap, 'every image up to the reported cap is allowed', { lastOk, cap });
  ok(refusedAt === cap + 1, 'and the one past it is refused, at exactly the number shown', refusedAt);

  const after = (await post(env, '/v1/usage', {}, tok)).body;
  ok(((after.images) || {}).used === cap, 'and the screen now shows the allowance as spent', (after.images || {}).used);
}

section('A bigger plan really is a bigger number');
{
  /* A constant passes every assertion above if it happens to match one plan.
     It cannot survive the plan changing underneath it. */
  const env = mkEnv();
  const tok = await signedIn(env, 'free');
  const free = (await post(env, '/v1/usage', {}, tok)).body;
  await W.DB.put(env, 'ent', USER, { plan: 'ultra', source: 'stripe', updatedAt: Date.now(), renewedAt: Date.now() });
  const ultra = (await post(env, '/v1/usage', {}, tok)).body;

  const fi = (free.images || {}).limit, ui = (ultra.images || {}).limit;
  ok(ui != null && fi != null && ui > fi, 'paying raises the image allowance', { free: fi, ultra: ui });
  const fv = (free.videos || {}).limit, uv = (ultra.videos || {}).limit;
  ok(uv != null && fv != null && uv > fv, 'and the video allowance', { free: fv, ultra: uv });
  ok(fv === 0, 'while a free account is told plainly that video is not on their plan', fv);
}

section('An allowance that cannot be spent says so rather than promising it');
{
  /* Video is the honest-degradation case: the plan grants it, the deployment
     may not have it switched on. Showing "0 of 120 used" to somebody who cannot
     make a video at all is a promise AMV cannot keep. */
  const env = mkEnv();
  const tok = await signedIn(env, 'ultra');
  const u = (await post(env, '/v1/usage', {}, tok)).body;
  ok((u.videos || {}).configured === false,
     'with no video provider configured, the screen is told so', (u.videos || {}).configured);

  const on = mkEnv({ VIDEO_API_URL: 'https://v.example', VIDEO_API_KEY: 'k', VIDEO_MODEL: 'm' });
  const tok2 = await signedIn(on, 'ultra');
  const u2 = (await post(on, '/v1/usage', {}, tok2)).body;
  ok((u2.videos || {}).configured === true, 'and told when it really is available', (u2.videos || {}).configured);
}

section('The screen reads those numbers, rather than inventing its own');
{
  /* The defect was never in the Worker - it was a page confidently drawing a
     limit nobody enforced. Checked against the shipped bundle, because that is
     what a person looks at. */
  ok(/d\.images/.test(client) && /d\.videos/.test(client),
     'the usage screen reads the reported image and video allowances', true);
  ok(!/Images<\/span><span>'\+ic\+' \/ 4</.test(client),
     'and no longer draws images against a hardcoded 4', true);
  ok(!/'\+mc\+' \/ 30</.test(client),
     'nor messages against a hardcoded 30', true);
}

globalThis.fetch = realFetch;
if (report('the-allowance-on-screen-is-the-real-one') > 0) process.exitCode = 1;
done();
