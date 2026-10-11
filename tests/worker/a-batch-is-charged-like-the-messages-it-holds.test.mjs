/* A BATCH IS CHARGED LIKE THE MESSAGES IT HOLDS.

   Up to a hundred requests handed over at once and answered in the
   background. Every item runs through the same route a direct request does,
   as the batch's owner - so it is metered, capped and refused exactly the way
   a message is. Checked against the real Worker with the model stood in for:

   - a batch made with an API key is answered in full, and its results read
     back one line per request, in order;
   - it costs exactly what the same requests sent one by one cost;
   - nobody else can read, list or cancel it;
   - a malformed batch is refused whole, before anything runs;
   - a full window makes an item wait, not fail - and not run;
   - a revoked key stops the rest of the batch;
   - a cancelled batch runs nothing more;
   - an item interrupted mid-run is reported, never run (or charged) twice;
   - there is a ceiling on batches running at once. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, '..', '..', 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'batch.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, todayKey, runBatches };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

let modelCalls = 0, modelDown = false;
const sse = (text) => 'data: {"type":"message_start","message":{"model":"m","usage":{"input_tokens":40,"output_tokens":0}}}\n\n'
  + 'data: ' + JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) + '\n\n'
  + 'data: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }) + '\n\n'
  + 'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}\n\n'
  + 'data: {"type":"message_stop"}\n\n';
globalThis.fetch = async (url, init) => {
  if (!/model\.example/.test(String(url))) return { ok: true, status: 200, json: async () => ({}) };
  /* "Down" answers like a provider having a bad minute, which a batch item
     waits out - the way the tests hold a batch still while they act on it. */
  if (modelDown) return new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }), { status: 529, headers: { 'Content-Type': 'application/json' } });
  modelCalls++;
  const b = JSON.parse(init.body);
  const last = b.messages[b.messages.length - 1];
  return new Response(sse('Answer to: ' + (typeof last.content === 'string' ? last.content : 'x')), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

const m = new Map(), vals = new Map();
const env = {
  AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example', JWT_SECRET: 'batch-secret', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
  AMV_KV: {
    _map: m,
    async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
    async list({ prefix, limit } = {}) { const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).sort().map(name => ({ name })); return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true }; },
  },
  AMV_COUNTER: { idFromName: (n) => n, get: (n) => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
    if (b.op === 'reserve') { if (b.cap != null && b.cap !== Infinity && cur + b.amount > b.cap) return r({ allowed: false, value: cur }); vals.set(n, cur + b.amount); return r({ allowed: true, value: cur + b.amount, reserved: b.amount }); }
    if (b.op === 'incr') { vals.set(n, cur + b.amount); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    if (b.op === 'checkCap') return r({ allowed: b.cap == null || cur < b.cap, value: cur });
    if (b.op === 'rateCheck') return r({ allowed: true });
    if (b.op === 'claim') { if (vals.has('c:' + n)) return r({ claimed: false }); vals.set('c:' + n, 1); return r({ claimed: true, owner: 'o' }); }
    if (b.op === 'release') { vals.delete('c:' + n); return r({ ok: true }); }
    return r({ allowed: true, value: cur });
  } }) },
};
const pending = [];
const runCtx = { waitUntil(p) { if (p) pending.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {} };
const settle = async () => { while (pending.length) await pending.shift(); };
const call = async (path, body, tok, ctx) => {
  const r = await worker.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.' + (1 + Math.floor(Math.random() * 200)) }, tok ? { Authorization: 'Bearer ' + tok } : {}),
    body: JSON.stringify(body) }), env, ctx || runCtx);
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, body: json, text };
};
const account = async (email) => {
  const tok = (await call('/auth/signup', { email, name: 'Dev', password: 'A-real-Passw0rd!' })).body.token;
  await W.DB.put(env, 'ent', email, { plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  const key = (await call('/v1/keys/create', { name: 'k' }, tok)).body.key;
  return { tok, key };
};
const req = (cid, text) => ({ custom_id: cid, params: { model: 'amv-core', max_tokens: 200, messages: [{ role: 'user', content: text }] } });
const usedToday = (email) => vals.get(`usg:${email}:${W.todayKey()}`) || 0;
/* A batch held still: made while the model is down, so its items are waiting. */
const held = async (who, reqs) => { modelDown = true; const r = await call('/v1/messages/batches', { requests: reqs }, who.key); await settle(); modelDown = false; return r.body.id; };
const unwait = async (id) => { const rec = await W.DB.get(env, 'batch', id); rec.items.forEach(it => { it.wait = 0; }); await W.DB.put(env, 'batch', id, rec); };

const A = await account('dev-a@example.com');
const B = await account('dev-b@example.com');

section('A batch made with an API key is answered in full, and reads back in order');
let first;
{
  const r = await call('/v1/messages/batches', { requests: [req('one', 'first'), req('two', 'second'), req('three', 'third')] }, A.key);
  ok(r.status === 200 && /^batch_/.test(r.body.id) && r.body.request_counts.processing === 3, 'it is accepted, with all three to do', r.body);
  first = r.body.id;
  await settle();
  const g = await call('/v1/messages/batches/get', { id: first }, A.key);
  ok(g.body.processing_status === 'ended' && g.body.request_counts.succeeded === 3, 'and all three are answered', g.body);
  const res = await call('/v1/messages/batches/results', { id: first }, A.key);
  const lines = res.text.trim().split('\n').map(l => JSON.parse(l));
  ok(lines.map(l => l.custom_id).join() === 'one,two,three', 'one line per request, in the order sent', lines.map(l => l.custom_id));
  ok(lines[1].result.type === 'succeeded' && lines[1].result.message.content[0].text === 'Answer to: second' && lines[1].result.message.usage.output_tokens === 9,
     'each with its answer and what it used', lines[1].result);
  const list = await call('/v1/messages/batches/list', {}, A.tok);
  ok(list.body.data.some(b => b.id === first), 'and it is listed for the account, whichever way it signs in', list.body.data.map(b => b.id));
}

section('It costs exactly what the same requests sent one by one cost');
{
  const before = usedToday('dev-a@example.com'), calls0 = modelCalls;
  for (const t of ['a', 'b']) { const r = await call('/v1/messages', { model: 'amv-core', max_tokens: 200, messages: [{ role: 'user', content: t }] }, A.key); await settle(); }
  const direct = usedToday('dev-a@example.com') - before;
  const mid = usedToday('dev-a@example.com');
  await call('/v1/messages/batches', { requests: [req('x', 'a'), req('y', 'b')] }, A.key); await settle();
  const batched = usedToday('dev-a@example.com') - mid;
  ok(direct > 0 && batched === direct, 'the same allowance is used, to the token', { direct, batched });
  ok(modelCalls - calls0 === 4, 'and the model was asked once per request, no more', modelCalls - calls0);
}

section('Nobody else can read, list or cancel it');
{
  const g = await call('/v1/messages/batches/get', { id: first }, B.key);
  const r = await call('/v1/messages/batches/results', { id: first }, B.key);
  const c = await call('/v1/messages/batches/cancel', { id: first }, B.key);
  const l = await call('/v1/messages/batches/list', {}, B.key);
  ok(g.status === 404 && r.status === 404 && c.status === 404, 'another account is told there is no such batch', [g.status, r.status, c.status]);
  ok(!l.body.data.some(b => b.id === first), 'and does not see it listed', l.body.data);
  const anon = await call('/v1/messages/batches/get', { id: first });
  ok(anon.status === 401, 'nor does anybody signed out', anon.status);
}

section('A malformed batch is refused whole, before anything runs');
{
  const calls0 = modelCalls;
  const many = await call('/v1/messages/batches', { requests: Array.from({ length: 101 }, (_, i) => req('r' + i, 'x')) }, A.key);
  const dup = await call('/v1/messages/batches', { requests: [req('same', 'x'), req('same', 'y')] }, A.key);
  const nostream = await call('/v1/messages/batches', { requests: [{ custom_id: 'a', params: { model: 'amv-core', stream: false, messages: [{ role: 'user', content: 'x' }] } }] }, A.key);
  const bad = await call('/v1/messages/batches', { requests: [req('ok', 'x'), { custom_id: 'bad', params: { messages: [] } }] }, A.key);
  ok([many, dup, nostream, bad].every(r => r.status === 400), 'too many, a repeated id, stream:false and an empty request are each refused', [many, dup, nostream, bad].map(r => r.body && r.body.error));
  ok(modelCalls === calls0, 'and nothing was sent to the model', modelCalls - calls0);
}

section('A full window makes an item wait - not fail, and not run');
{
  const id = await held(A, [req('w', 'wait')]);
  await unwait(id);
  const full = [...vals.keys()].filter(k => k.startsWith('msgs5h:dev-a@example.com:'));
  const prev = full.map(k => [k, vals.get(k)]);
  for (const k of full) vals.set(k, 1e9);
  const calls0 = modelCalls;
  await W.runBatches(env, runCtx); await settle();
  const g = (await call('/v1/messages/batches/get', { id }, A.key)).body;
  ok(g.processing_status === 'in_progress' && g.request_counts.processing === 1 && modelCalls === calls0, 'the item is still waiting, and the model was not asked', { g, calls: modelCalls - calls0 });
  for (const [k, v] of prev) vals.set(k, v);
  const rec = await W.DB.get(env, 'batch', id); rec.items[0].wait = 0; await W.DB.put(env, 'batch', id, rec);
  await W.runBatches(env, runCtx); await settle();
  const g2 = (await call('/v1/messages/batches/get', { id }, A.key)).body;
  ok(g2.processing_status === 'ended' && g2.request_counts.succeeded === 1, 'and once the window opens it is answered', g2);
}

section('A revoked key stops the rest of the batch');
{
  const C = await account('dev-c@example.com');
  const id = await held(C, [req('p', '1'), req('q', '2')]);
  const keys = (await call('/v1/keys/list', {}, C.tok)).body.keys;
  await call('/v1/keys/revoke', { id: keys[0].id }, C.tok);
  await unwait(id);
  const calls0 = modelCalls;
  await W.runBatches(env, runCtx); await settle();
  const rec = await W.DB.get(env, 'batch', id);
  ok(modelCalls === calls0 && rec.items[0].code === 'key_revoked' && rec.items[1].result === 'canceled', 'nothing more runs, and the first item says why', rec.items);
}

section('A cancelled batch runs nothing more, and says so');
{
  const id = await held(A, [req('c1', '1'), req('c2', '2')]);
  const c = await call('/v1/messages/batches/cancel', { id }, A.key);
  await unwait(id);
  ok(c.body.processing_status === 'canceling', 'cancelling is acknowledged', c.body);
  const calls0 = modelCalls;
  await W.runBatches(env, runCtx); await settle();
  const res = (await call('/v1/messages/batches/results', { id }, A.key)).text.trim().split('\n').map(l => JSON.parse(l));
  ok(modelCalls === calls0 && res.every(l => l.result.type === 'canceled'), 'neither request ran, and each is reported cancelled', res);
}

section('An item interrupted mid-run is reported, never run twice');
{
  const id = await held(A, [req('i1', '1'), req('i2', '2')]);
  const rec = await W.DB.get(env, 'batch', id); rec.items.forEach(it => { it.wait = 0; }); rec.items[0].state = 'running'; rec.items[0].at = Date.now() - 11 * 60000; await W.DB.put(env, 'batch', id, rec);
  const calls0 = modelCalls;
  await W.runBatches(env, runCtx); await settle();
  const after = await W.DB.get(env, 'batch', id);
  ok(after.items[0].code === 'interrupted' && after.items[1].result === 'succeeded' && modelCalls - calls0 === 1, 'the stale one is marked interrupted; only the other is asked', { items: after.items, calls: modelCalls - calls0 });
}

section('There is a ceiling on batches running at once');
{
  const D = await account('dev-d@example.com');
  for (let i = 0; i < 5; i++) await held(D, [req('n' + i, 'x')]);
  modelDown = true;
  const sixth = await call('/v1/messages/batches', { requests: [req('n6', 'x')] }, D.key);
  await settle(); modelDown = false;
  ok(sixth.status === 429 && sixth.body.code === 'batch_limit', 'a sixth waits for one of the five to finish', sixth.body);
}

report('a-batch-is-charged-like-the-messages-it-holds');
done();
