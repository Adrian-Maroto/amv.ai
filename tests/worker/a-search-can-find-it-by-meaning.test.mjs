/* A SEARCH CAN FIND IT BY MEANING - THE SERVER HALF.

   Oct 26 audit: hybrid retrieval. /v1/meaning scores the passages the page
   sends against the question with an embedding model on the deployment's
   Workers AI, and keeps nothing. Run against the Worker with a stand-in model:
     - off unless the deployment binds AI, said plainly, and public-config
       says whether it is on;
     - the scores are the cosine of each passage against the question, in the
       order sent, computed in batches the model accepts;
     - bounds on what is sent; signed in only; metered like any spend;
     - a model that fails or answers short is a 502 that says words were used,
       never a list of made-up scores. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'meaning.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `
export { issueTokens, MEANING_BATCH };
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'reader@test.com';
const store = new Map(); const vals = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
  AMV_KV: { async get(k){ return store.has(k) ? store.get(k) : null; }, async put(k, v){ store.set(k, v); }, async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: { idFromName: (n) => n, get: (n) => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
    if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: cur + b.amount })); }
    if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
    return new Response(JSON.stringify({ allowed: true, ok: true, value: cur }));
  } }) } };
store.set('ent:' + ME, JSON.stringify({ plan: 'pro', renewedAt: Date.now() }));
const pair = await W.issueTokens(env, ME, 'Reader');
const ctx = { waitUntil(){}, passThroughOnException(){} };
let ip = 1;
const call = async (path, body, method = 'POST', tok = pair.token) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method,
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}), Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.5.' + (ip++ % 250) },
    ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}) }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
/* A model that turns a text into a vector by topic: money words one way,
   weather words another - so "revenue grew" and "ventas subieron" are close
   and "it rained" is not. */
const calls = [];
const vec = (t) => { t = t.toLowerCase(); return [/revenue|sales|ventas|ingresos|growth|crec/.test(t) ? 1 : 0, /rain|lluvia|weather|storm/.test(t) ? 1 : 0, 0.1]; };
const model = { async run(name, input){ calls.push({ name, n: input.text.length }); return { shape: [input.text.length, 3], data: input.text.map(vec) }; } };

section('Off unless the deployment has the model, and public-config says which');
{
  const off = await call('/v1/meaning', { query: 'sales growth', passages: ['Revenue grew'] });
  ok(off.status === 503 && off.d.error === 'not_configured' && /words still works/.test(off.d.message), 'off: refused, saying words still work', off.status + ' ' + JSON.stringify(off.d));
  const cfg = await call('/v1/public-config', null, 'GET');
  ok(!cfg.d.meaning, 'and public-config does not claim it', cfg.d.meaning);
  env.AI = model;
  const cfg2 = await call('/v1/public-config', null, 'GET');
  ok(cfg2.d.meaning === true, 'on: public-config says so', cfg2.d.meaning);
}

section('Scores by meaning, in the order sent, across languages');
{
  const r = await call('/v1/meaning', { query: 'sales growth', passages: ['Las ventas subieron un 14 por ciento.', 'It rained all week in Leeds.', 'Revenue expanded in Iberia.'] });
  ok(r.status === 200 && r.d.ok && r.d.scores.length === 3, 'one score per passage', JSON.stringify(r.d));
  ok(r.d.scores[0] > 0.9 && r.d.scores[2] > 0.9 && r.d.scores[1] < 0.2, 'a passage in Spanish with no word in common scores as close; the weather does not', r.d.scores);
  ok(calls.at(-1).name === '@cf/baai/bge-m3', 'with the multilingual model', calls.at(-1).name);
}

section('Sent to the model in batches it accepts, scores still in order');
{
  calls.length = 0;
  const many = Array.from({ length: 130 }, (_, i) => i % 2 ? 'storm warning ' + i : 'sales up ' + i);
  const r = await call('/v1/meaning', { query: 'revenue', passages: many });
  ok(r.status === 200 && r.d.scores.length === 130, 'all 130 scored', r.d.scores && r.d.scores.length);
  ok(calls.every(c => c.n <= W.MEANING_BATCH) && calls.length === Math.ceil(131 / W.MEANING_BATCH), 'in batches of at most ' + W.MEANING_BATCH, calls.map(c => c.n));
  ok(r.d.scores.every((s, i) => i % 2 ? s < 0.2 : s > 0.9), 'and every score is against its own passage', r.d.scores.slice(0, 6));
}

section('Bounded, signed in, metered');
{
  const big = await call('/v1/meaning', { query: 'x', passages: Array.from({ length: 241 }, () => 'p') });
  ok(big.status === 413 && big.d.error === 'too_large', 'more than 240 passages is refused', big.status);
  const none = await call('/v1/meaning', { query: '', passages: ['a'] });
  ok(none.status === 400, 'no question is refused', none.status);
  const anon = await call('/v1/meaning', { query: 'x', passages: ['a'] }, 'POST', '');
  ok(anon.status === 401, 'signed out is refused', anon.status);
  const spent = [...vals.entries()].filter(([k]) => k.startsWith('cost:' + ME)).reduce((a, [, v]) => a + v, 0);
  ok(spent > 0, 'and what it cost is counted', spent);
}

section('A model that fails or answers short is a failure, never made-up scores');
{
  env.AI = { async run(){ throw new Error('model down'); } };
  const r = await call('/v1/meaning', { query: 'x', passages: ['a', 'b'] });
  ok(r.status === 502 && !r.d.scores && /words alone/.test(r.d.message), 'a failing model: 502, saying words were used', r.status + ' ' + JSON.stringify(r.d));
  env.AI = { async run(_n, input){ return { data: input.text.slice(1).map(vec) }; } };
  const s = await call('/v1/meaning', { query: 'x', passages: ['a', 'b'] });
  ok(s.status === 502 && !s.d.scores, 'a model that answers one vector short: 502, no scores', s.status);
}

if (report('a-search-can-find-it-by-meaning') > 0) process.exitCode = 1;
done();
