/* THE ONLY PART OF AMV THAT RUNS ON SOMEBODY ELSE'S WEBSITE.

   Everything else in the product is reached by a person who came to AMV and
   signed in. The widget is loaded by a <script> tag on a customer's own domain
   and answers their visitors, who have no account here and never will. That
   makes it the whole external attack surface in one place: a public site key
   that anybody can read out of the page source, an endpoint that must answer
   cross-origin, and a bill that somebody else pays.

   There was no end-to-end coverage of it at all. The pieces were tested - caps
   atomically, origins parsed - and the thing they add up to was not: can a
   stranger who copies a site key out of one customer's page use it from their
   own, and what does AMV say when they try.

   The assertions here are almost all refusals, and the one that matters most
   is what a refusal LEAKS. This endpoint is unauthenticated by design, so its
   error messages are the one channel an attacker gets for free: whether a key
   exists, who owns it, what plan they are on, how close to a limit they are.
   None of that may cross. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'widgetsite.harness.mjs');
writeFileSync(harness, src + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const KEY = 'pk_livewidget';
const OWNER = 'shopowner@example.com';
const THEIR_SITE = 'https://theircompany.example';
const SOMEBODY_ELSE = 'https://attacker-blog.example';

let calls = [];
const realFetch = globalThis.fetch;
const sse = () => 'data: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":0}}}\n\n'
                + 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Our hours are 9 to 5."}}\n\n'
                + 'data: {"type":"message_delta","usage":{"output_tokens":20}}\n\n'
                + 'data: {"type":"message_stop"}\n\n';
globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), body: String((opts && opts.body) || '') });
  return new Response(sse(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

function mkEnv(extra) {
  const m = new Map(); const vals = new Map(); calls = [];
  return Object.assign({
    AMV_MODEL_KEY: 'server-side-only-key', MODEL_API_URL: 'https://model.example',
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix } = {}) {
        return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body);
        const cur = vals.get(n) || 0;
        if (b.op === 'reserve') {
          if (b.cap != null && b.cap !== Infinity && cur + b.amount > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
          vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: cur + b.amount }));
        }
        if (b.op === 'incr') { vals.set(n, Math.max(0, cur + b.amount)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: b.cap == null || cur < b.cap, value: cur }));
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: cur + 1 <= (b.limit || 999) })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
    _vals: vals,
  }, extra || {});
}
const ctx = { waitUntil() {}, passThroughOnException() {} };

async function seed(env, cfg) {
  const w = Object.assign({
    key: KEY, owner: OWNER, enabled: true, model: 'amv-core',
    origins: ['theircompany.example'], dailyMsgCap: 0, dailySpendCapUSD: 0, maxOut: 512,
    systemPrompt: 'You answer questions about the shop.', title: 'Chat', greeting: 'Hi',
  }, cfg || {});
  await W.DB.put(env, 'widget', KEY, w);
  await W.DB.put(env, 'widget_owner', OWNER, w);
  await W.DB.put(env, 'ent', OWNER, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
}
const visit = (env, { origin, key, ip, msg } = {}) => worker.fetch(new Request('https://api.amv.dev/v1/widget/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Origin': origin || THEIR_SITE, 'CF-Connecting-IP': ip || '20.20.20.1' },
  body: JSON.stringify({ key: key === undefined ? KEY : key, messages: [{ role: 'user', content: msg || 'what are your hours?' }] }),
}), env, ctx);

section('A visitor on the customer’s own site gets an answer');
{
  const env = mkEnv();
  await seed(env);
  const r = await visit(env);
  ok(r.status === 200, 'the turn is served', r.status);
  ok(calls.length === 1, 'the model was called for it', calls.length);
  const body = await r.text();
  ok(/9 to 5/.test(body), 'and the words reach the page', body.slice(0, 90));
  ok(r.headers.get('Access-Control-Allow-Origin') === THEIR_SITE,
     'with CORS naming their site, so the browser will let them read it',
     r.headers.get('Access-Control-Allow-Origin'));
}

section('The same key from a different site is refused');
{
  /* The site key is public - it sits in the <script> tag of every page the
     widget is on, readable by anybody who views source. The allowlist is the
     only thing between that and a stranger running a chatbot on the customer's
     budget. */
  const env = mkEnv();
  await seed(env);
  const r = await visit(env, { origin: SOMEBODY_ELSE });
  ok(r.status === 403, 'it is refused', r.status);
  ok(calls.length === 0, 'and costs the owner nothing', calls.length);
  ok(r.headers.get('Access-Control-Allow-Origin') !== SOMEBODY_ELSE,
     'and CORS does not hand the attacker’s origin back to them',
     r.headers.get('Access-Control-Allow-Origin'));
}

section('A subdomain of the allowed site works, a lookalike does not');
{
  /* The two mistakes an allowlist makes. Refusing shop.theircompany.example
     breaks a real customer; accepting theircompany.example.evil.com hands the
     key to anybody who can register a domain. */
  const env = mkEnv();
  await seed(env);
  const sub = await visit(env, { origin: 'https://shop.theircompany.example' });
  ok(sub.status === 200, 'a real subdomain is allowed', sub.status);

  const lookalike = await visit(env, { origin: 'https://theircompany.example.evil.example' });
  ok(lookalike.status === 403, 'a domain that merely starts the same is not', lookalike.status);

  const suffix = await visit(env, { origin: 'https://nottheircompany.example' });
  ok(suffix.status === 403, 'nor one that merely ends the same', suffix.status);
}

section('An unknown key says nothing about whether keys exist');
{
  /* Answering differently for "no such key" and "key exists but not for this
     domain" turns the endpoint into an oracle for enumerating customers. */
  const env = mkEnv();
  await seed(env);
  const missing = await visit(env, { key: 'pk_doesnotexist' });
  const md = await missing.json();
  ok(missing.status === 404, 'an unknown key is refused', missing.status);
  ok(!/exist|unknown|invalid key|not found/i.test(md.error || ''),
     'without confirming that the key is the problem', md.error);
  ok(!/owner|plan|account/i.test(md.error || ''), 'and naming nobody', md.error);
}

section('A disabled widget stops, and says nothing about its owner');
{
  const env = mkEnv();
  await seed(env, { enabled: false });
  const r = await visit(env);
  ok(r.status === 404, 'it is off', r.status);
  ok(calls.length === 0, 'and nothing is spent', calls.length);
  const d = await r.json();
  ok(!/disabled|owner|plan|billing/i.test(d.error || ''),
     'a visitor is not told their host’s business', d.error);
}

section('One abusive visitor cannot drain the widget');
{
  /* The whole point of a per-visitor throttle: the caps below bound the total,
     this bounds any one caller so a single script cannot spend the customer's
     entire day in a burst before anybody notices. */
  const env = mkEnv();
  await seed(env);
  let refused = 0;
  for (let i = 0; i < 25; i++) {
    const r = await visit(env, { ip: '66.66.66.66' });
    if (r.status === 429) refused++;
  }
  ok(refused > 0, 'a burst from one address is throttled', refused);
}

section('The owner’s message cap ends the day, politely');
{
  const env = mkEnv();
  await seed(env, { dailyMsgCap: 2 });
  await visit(env); await visit(env);
  const r = await visit(env, { ip: '20.20.20.9' });
  ok(r.status === 429, 'past the cap the widget stops', r.status);
  const d = await r.json();
  ok(/daily message limit|try again tomorrow/i.test(d.error || ''),
     'and says so in a sentence a stranger can read', d.error);
  ok(!/owner|plan|cap is|budget/i.test(d.error || ''),
     'without exposing how the customer has configured it', d.error);
}

section('Nothing AMV holds crosses to the embedding page');
{
  /* The page this runs on belongs to somebody else. Whatever comes back is
     readable by their JavaScript, their analytics and their visitors. */
  const env = mkEnv();
  await seed(env);
  const r = await visit(env);
  const body = await r.text();
  const headers = JSON.stringify([...r.headers.entries()]);
  ok(!/server-side-only-key/.test(body + headers),
     'the model key never appears', true);
  ok(!new RegExp(OWNER).test(body + headers),
     'nor the owner’s address', true);
  ok(!/ultra|plan/i.test(body), 'nor what plan is behind it', body.slice(0, 90));
}

section('A preflight is answered, or the browser never sends the request');
{
  /* A cross-origin POST with a JSON content type is preflighted. If OPTIONS is
     not answered correctly the widget fails on every site with no error a
     customer could act on. */
  const env = mkEnv();
  await seed(env);
  const r = await worker.fetch(new Request('https://api.amv.dev/v1/widget/chat', {
    method: 'OPTIONS',
    headers: { 'Origin': THEIR_SITE, 'Access-Control-Request-Method': 'POST',
               'Access-Control-Request-Headers': 'content-type' },
  }), env, ctx);
  ok(r.status < 400, 'the preflight is answered', r.status);
  const allowH = (r.headers.get('Access-Control-Allow-Headers') || '').toLowerCase();
  ok(/content-type/.test(allowH), 'and permits the header the widget sends', allowH);
}

section('The loader is public, because it is a script tag on their site');
{
  const env = mkEnv();
  await seed(env);
  const r = await worker.fetch(new Request('https://api.amv.dev/widget.js?k=' + KEY, {
    headers: { 'Origin': THEIR_SITE },
  }), env, ctx);
  ok(r.status === 200, 'it is served', r.status);
  const js = await r.text();
  ok(!/server-side-only-key/.test(js), 'and carries no secret of AMV’s', true);
  ok(!new RegExp(OWNER).test(js), 'nor the owner’s address', true);
}

globalThis.fetch = realFetch;
if (report('the-widget-on-somebody-elses-site') > 0) process.exitCode = 1;
done();
