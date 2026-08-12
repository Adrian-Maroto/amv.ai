/* THE TOP-LEVEL CATCH HAD NEVER CAUGHT A SINGLE ROUTE.

   The Worker's fetch handler wraps its routing in a try/catch whose comment
   says what it is for: record the fault, alert an operator, and answer in AMV's
   own words rather than leaking an exception message to a stranger. Careful,
   deliberate, and dead. The switch it guarded said

       case '/v1/messages': return aiProxy(request, env, ctx);

   and every handler in this file is async. RETURNING A PROMISE EXITS THE TRY.
   The rejection arrives after the block is gone, so it was never an exception
   reaching the top level - it was one leaving through the roof.

   What that cost, every time any handler threw:

     - the visitor got Cloudflare's own 1101 error page. Not AMV's wording, no
       recovery path, and the text on screen decided by somebody else;
     - nothing was written to the error log;
     - nobody was alerted. The one signal that says the product is broken for
       everybody was silent for the exact class of faults most likely to break
       it: a provider timing out, storage refusing, a null dereference in a
       handler somebody shipped an hour ago;
     - and four public GET routes - a deployed site, a shared conversation, the
       password-reset page - were outside the try to begin with.

   The second half is what a throw costs the PERSON. Every refusal in chat
   refunds the tokens it reserved, and the comment on the first one says why:
   "otherwise an outage would quietly burn through everyone's daily quota".
   That was true of an error STATUS. A thrown network error walked past all of
   it with the reservation still booked - so the failure mode that fails every
   request at once was the one that charged for it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'roof.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, todayKey, _route };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

section('The handler awaits its routing, which is the whole fix');
{
  /* The text of `async fetch(...)` in the default export, up to the `},` that
     closes it. Read from the source rather than asserted through behaviour
     alone, because the behaviour below can be green while a SECOND unawaited
     return sits beside the awaited one. */
  const code = codeOnly(src);
  const s = code.indexOf('async fetch(request, env, ctx) {');
  const e = code.indexOf('\n  },', s);
  const fetchBody = code.slice(s, e);
  ok(s > 0 && e > s, 'the fetch handler was found', fetchBody.length);

  const returns = [...fetchBody.matchAll(/return\s+([^\n;]*)/g)].map(m => m[1].trim());
  ok(returns.length === 2,
     'it returns in exactly two places: the route, and the refusal when it throws', returns);
  ok(/^await _route\(/.test(returns[0]),
     'the routing one is AWAITED, so a rejection lands in the catch below', returns[0]);
  /* The specific regression: a route wired straight into the handler is
     outside the await again, and the catch goes quiet for it. */
  ok(!/case\s*'/.test(fetchBody),
     'and no route is wired directly into the handler, where it would escape again', true);

  /* Every route lives in the awaited function - including the four public GETs
     that used to sit above the try entirely. */
  ok(typeof W._route === 'function', 'the router is a real function', typeof W._route);
  const routeSrc = code.slice(code.indexOf('async function _route(request, env, ctx) {'));
  ['/s/', '/c/', "path === '/reset'"].forEach(p => {
    ok(routeSrc.slice(0, 3000).includes(p),
       'the public GET route ' + p + ' is inside the awaited router now', p);
  });
}

/* ── and now against the running Worker ─────────────────────────────────── */

let THROW = null;                 // set to a message to make the provider throw
let CALLS = 0;
globalThis.fetch = async (u) => {
  CALLS++;
  if (THROW) throw new TypeError(THROW);
  const url = String(u);
  if (/image\.example/.test(url)) return new Response(JSON.stringify({ data: [{ b64_json: 'AA' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (/video\.example/.test(url)) return new Response(JSON.stringify({ id: 'p1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return new Response('data: {"type":"message_stop"}\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

function mkEnv() {
  const m = new Map(), vals = new Map();
  return {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    GLOBAL_DAILY_USD_CAP: '500',
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
    IMAGE_API_URL: 'https://image.example/v1', IMAGE_API_KEY: 'k',
    VIDEO_API_URL: 'https://video.example/v1', VIDEO_API_KEY: 'k', VIDEO_MODEL: 'v1',
    _map: m, _vals: vals,
    AMV_KV: {
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
          if (b.cap && next > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
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
const ctx = { waitUntil(p) { (this._p = this._p || []).push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); this._p = []; } };
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '70.0.0.' + Math.floor(Math.random() * 250),
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b, t) => { const r = await call(env, p, b, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };

const env = mkEnv();
const tok = (await (await call(env, '/auth/signup', { email: 'user@test.com', name: 'N', password: 'A-real-Passw0rd!' })).json()).token;

section('A handler that throws is answered by AMV, not by Cloudflare');
{
  THROW = 'ECONNREFUSED at 10.0.0.1:443 while reading /internal/secret-path';
  CALLS = 0;
  /* An account with no storage of its own to break: the throw comes from the
     provider, which is the realistic source and the one the old code let out.
     `/v1/site/deploy` is used because it reaches fetch without a refund path
     of its own, so what is asserted here is the ROOF, not a handler's manners. */
  let threw = null, res = null;
  try { res = await call(env, '/v1/image/generate', { prompt: 'a house' }, tok); }
  catch (e) { threw = e; }
  ok(!threw, 'the request does not reject out of the Worker', threw && String(threw.message));
  ok(res && res.status >= 400, 'it answers with a status', res && res.status);
  const body = await res.json().catch(() => ({}));
  const text = JSON.stringify(body);
  ok(!/ECONNREFUSED|10\.0\.0\.1|secret-path/.test(text),
     'and the exception message stays on the server, where it was written for', text.slice(0, 160));
}

section('A throw the router cannot foresee still becomes AMV’s 500');
{
  /* The general case, forced directly: a route whose handler rejects for a
     reason nothing in it anticipated. Before the await, this rejected out of
     worker.fetch and the visitor got Cloudflare's error page. */
  const down = () => ({
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', APP_URL: 'https://amv.test',
    AMV_KV: { async get() { throw new Error('KV is down: namespace ffff-secret'); },
              async put() { throw new Error('KV is down'); },
              async delete() { throw new Error('KV is down'); },
              async list() { throw new Error('KV is down'); } },
    AMV_COUNTER: { idFromName: (x) => x, get: () => ({ async fetch() { throw new Error('counter is down'); } }) },
  });
  const hit = async (path, init) => {
    let threw = null, res = null;
    try { res = await worker.fetch(new Request('https://api.amv.test' + path, init), down(), ctx); }
    catch (e) { threw = e; }
    return { threw, res };
  };

  const login = await hit('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' }, body: JSON.stringify({ email: 'a@b.com', password: 'x' }) });
  ok(!login.threw, 'storage failing does not reject out of the Worker', login.threw && String(login.threw.message));
  ok(login.res && login.res.status === 500, 'it is a 500', login.res && login.res.status);
  /* Guarded, because the failure this whole file is about is a request that
     REJECTS rather than answering - and a checker that crashes on the fault it
     is testing reports nothing at all. */
  const body = login.res ? await login.res.json().catch(() => ({})) : {};
  ok(/logged/i.test(body.error || ''), 'in AMV’s own words', body.error);
  ok(!/ffff-secret|namespace/.test(JSON.stringify(body)),
     'with nothing from the exception in it', body.error);

  /* A deployed site: a public GET, and one of the four that used to be above
     the try altogether rather than merely un-awaited inside it. */
  const site = await hit('/s/somebodys-site', { method: 'GET' });
  ok(!site.threw, 'and a public page does not reject out either', site.threw && String(site.threw.message));
  ok(site.res && site.res.status >= 400, 'it is answered', site.res && site.res.status);
}

section('And a model that cannot be reached does not eat the allowance');
{
  const fresh = mkEnv();
  const t2 = (await (await call(fresh, '/auth/signup', { email: 'chatter@test.com', name: 'N', password: 'A-real-Passw0rd!' })).json()).token;
  const booked = () => [...fresh._vals.entries()]
    .filter(([k]) => k.startsWith('usg:chatter@test.com')).map(([, v]) => v);

  THROW = 'network failure';
  const r = await post(fresh, '/v1/messages', { messages: [{ role: 'user', content: 'hello' }], max_tokens: 1024 }, t2);
  await ctx.settle();

  ok(r.status === 503, 'the person is told AMV could not reach the model', r.status);
  ok(r.body.code === 'provider_error',
     'with a code the client treats as worth retrying, because a blip usually is', r.body.code);
  ok(/allowance/i.test(r.body.error || ''),
     'and is told their allowance was not charged', r.body.error);
  ok(booked().every(v => v === 0),
     'which is true: every reserved token was given back', booked());
}

section('The same is true of the widget, which spends somebody else’s allowance');
{
  const wenv = mkEnv();
  const OWNER = 'owner@test.com';
  await call(wenv, '/auth/signup', { email: OWNER, name: 'N', password: 'A-real-Passw0rd!' });
  await W.DB.put(wenv, 'ent', OWNER, { plan: 'ultra', updatedAt: Date.now() });
  await W.DB.put(wenv, 'widget', 'pk_roof', {
    key: 'pk_roof', owner: OWNER, enabled: true, model: 'amv-core', origins: [],
    dailyMsgCap: 5, dailySpendCapUSD: 0, maxOut: 256, systemPrompt: 'be helpful',
  });
  const booked = () => [...wenv._vals.entries()]
    .filter(([k]) => k.startsWith('usg:' + OWNER) || k.startsWith('wmsg:'))
    .map(([k, v]) => k + '=' + v);

  THROW = 'network failure';
  const r = await worker.fetch(new Request('https://api.amv.test/v1/widget/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'https://site.example', 'CF-Connecting-IP': '9.9.9.9' },
    body: JSON.stringify({ key: 'pk_roof', messages: [{ role: 'user', content: 'hello' }] }),
  }), wenv, ctx);
  await ctx.settle();

  ok(r.status === 503, 'the visitor is told the assistant is unavailable', r.status);
  /* The page is on somebody else's domain. Without these headers it cannot
     read the body at all, so it has nothing to show the person typing. */
  ok(!!r.headers.get('Access-Control-Allow-Origin'),
     'in a response the embedding page is actually allowed to read', r.headers.get('Access-Control-Allow-Origin'));
  ok(booked().every(s => s.endsWith('=0')),
     'and neither the owner’s tokens nor the widget’s message were charged', booked());
  THROW = null;
}

section('None of which broke the ordinary case');
{
  const good = mkEnv();
  const t3 = (await (await call(good, '/auth/signup', { email: 'fine@test.com', name: 'N', password: 'A-real-Passw0rd!' })).json()).token;
  THROW = null;
  const r = await call(good, '/v1/messages', { messages: [{ role: 'user', content: 'hello' }], max_tokens: 64 }, t3);
  ok(r.status === 200, 'a working model still answers', r.status);
  const nf = await post(good, '/v1/nothing-here', {}, t3);
  ok(nf.status === 404, 'and an unknown path is still a 404, not a 500', nf.status);
  const h = await worker.fetch(new Request('https://api.amv.test/v1/health'), good, ctx);
  ok(h.status === 200, 'and health still answers', h.status);
}

if (report('an-exception-leaves-through-the-roof') > 0) process.exitCode = 1;
done();
