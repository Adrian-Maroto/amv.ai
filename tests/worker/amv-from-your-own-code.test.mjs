/* AMV FROM YOUR OWN CODE - THE SDK, AGAINST THE REAL SERVER.

   sdk/amv-sdk.mjs is one dependency-free file somebody imports. This imports
   it here and points it at the Worker itself (amv-backend.js, served over
   HTTP on this machine) with a real key from /v1/keys/create, and the model
   stood in for with replies in its real streamed shape - so what is checked
   is the SDK and the server agreeing:

   - create() returns the whole message, stream() the events, and every
     request streams, as the endpoint requires;
   - runAgent runs the CALLER's own tools - which the server used to drop by
     name, without a word, for any tool AMV had not heard of - and hands the
     results back; an unknown tool, unreadable input, a tool that throws and
     one the person declines each go back to the model as an error it can
     read, and nothing is run on a guess;
   - it stops at maxTurns and when aborted, and says which;
   - the app's own requests still drop a name AMV does not know: only an API
     key brings its own tools;
   - a revoked key, plain http to another machine and a web page are each
     refused with a sentence, and the key is never in an error;
   - the copy the site serves is byte-identical to the one tested here. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'sdk.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, todayKey };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;
const { AMV, AMVError } = await import(join(ROOT, 'sdk', 'amv-sdk.mjs'));

/* The model: records what it was sent, and answers from a script - text, or
   a tool call - in its real streamed shape. */
const sent = [];
let script = [];
const ev = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
const textReply = (t) => ev({ type: 'message_start', message: { model: 'm', usage: { input_tokens: 9 } } })
  + ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  + t.split(' ').map((w, i) => ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: (i ? ' ' : '') + w } })).join('')
  + ev({ type: 'content_block_stop', index: 0 })
  + ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }) + ev({ type: 'message_stop' });
const toolReply = (name, inputJson, id) => ev({ type: 'message_start', message: { model: 'm', usage: { input_tokens: 9 } } })
  + ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: id || ('tu_' + Math.random().toString(36).slice(2, 8)), name } })
  + ev({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: inputJson } })
  + ev({ type: 'content_block_stop', index: 0 })
  + ev({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } }) + ev({ type: 'message_stop' });
const counted = [];
globalThis.fetch = (() => { const real = globalThis.fetch; return async (url, init) => {
  if (!/model\.example/.test(String(url))) return real(url, init);
  if (/count_tokens$/.test(String(url))) { counted.push(JSON.parse(init.body)); return new Response(JSON.stringify({ input_tokens: 77 }), { status: 200 }); }
  sent.push(JSON.parse(init.body));
  const next = script.length ? script.shift() : textReply('Done.');
  return new Response(next, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}; })();

const m = new Map(), vals = new Map();
const env = {
  AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example', JWT_SECRET: 'cli-secret', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
  AMV_KV: {
    async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
    async list({ prefix, limit } = {}) { const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })); return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true }; },
  },
  AMV_COUNTER: withAuthOps({ idFromName: (n) => n, get: (n) => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
    if (b.op === 'reserve') { if (b.cap != null && b.cap !== Infinity && cur + b.amount > b.cap) return r({ allowed: false, value: cur }); vals.set(n, cur + b.amount); return r({ allowed: true, value: cur + b.amount }); }
    if (b.op === 'incr') { vals.set(n, cur + b.amount); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    if (b.op === 'checkCap') return r({ allowed: b.cap == null || cur < b.cap, value: cur });
    if (b.op === 'rateCheck') return r({ allowed: true });
    if (b.op === 'claim') return r({ claimed: true });
    return r({ allowed: true, value: cur });
  } }) }),
};
const ctx = { waitUntil(p) { if (p) Promise.resolve(p).catch(() => {}); }, passThroughOnException() {} };

/* The Worker on a real port, so the tool's own fetch makes real requests. */
const server = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const wreq = new Request('https://api.amv.test' + req.url, { method: req.method, headers: req.headers, body: body.length ? body : undefined });
  const wres = await worker.fetch(wreq, env, ctx);
  res.writeHead(wres.status, Object.fromEntries(wres.headers));
  if (wres.body) { const rd = wres.body.getReader(); for (;;) { const { value, done } = await rd.read(); if (done) break; res.write(value); } }
  res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const API = 'http://127.0.0.1:' + server.address().port;

const call = async (path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '42.42.42.42' }, tok ? { Authorization: 'Bearer ' + tok } : {}),
  body: JSON.stringify(body) }), env, ctx);
const EMAIL = 'dev@example.com';
const tok = (await (await call('/auth/signup', { email: EMAIL, name: 'Dev', password: 'A-real-Passw0rd!' })).json()).token;
await W.DB.put(env, 'ent', EMAIL, { plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
const made = await (await call('/v1/keys/create', { name: 'laptop' }, tok)).json();
const KEY = made.key;
const amv = new AMV({ apiKey: KEY, baseURL: API });
const toolNames = (b) => (b.tools || []).map(t => t.name);
const lastResults = () => { const b = sent[sent.length - 1] || {}; const m = (b.messages || []).slice(-1)[0] || {}; return Array.isArray(m.content) ? m.content.filter(c => c.type === 'tool_result') : []; };

section('A message, whole or as it is written');
{
  sent.length = 0; script = [textReply('Paris is the capital of France.')];
  const msg = await amv.messages.create({ messages: [{ role: 'user', content: 'Capital of France?' }] });
  ok(AMV.text(msg) === 'Paris is the capital of France.' && msg.stop_reason === 'end_turn' && msg.usage.output_tokens === 5, 'create() returns the whole message', msg);
  ok(sent.length === 1 && sent[0].stream === true, 'and the request streamed, as the endpoint requires', sent[0] && sent[0].stream);
  script = [textReply('One two three')];
  const s = amv.messages.stream({ messages: [{ role: 'user', content: 'Count' }] });
  const deltas = [];
  for await (const e of s) if (e.type === 'content_block_delta') deltas.push(e.delta.text);
  ok(deltas.join('') === 'One two three' && deltas.length === 3 && (await s.text()) === 'One two three', 'stream() gives the pieces as they come, and the whole after', deltas);
  const c = await amv.messages.countTokens({ messages: [{ role: 'user', content: 'How long?' }] });
  ok(c.input_tokens === 77, 'countTokens asks the server, which counts on what it would send', c);
}

section('An agent: your tools, run here, the results handed back');
{
  sent.length = 0;
  script = [toolReply('weather', '{"city":"Lisbon"}'), textReply('It is sunny in Lisbon.')];
  const calls = [];
  const run = await amv.runAgent({
    messages: [{ role: 'user', content: 'Is it raining in Lisbon?' }],
    tools: [{ name: 'weather', description: 'Weather for a city', input_schema: { type: 'object', properties: { city: { type: 'string' } } },
      run: async ({ city }) => { calls.push(city); return { city, sky: 'sunny' }; } }],
  });
  ok(toolNames(sent[0]).includes('weather'), 'the server passes the caller’s own tool to the model - it used to drop it by name', toolNames(sent[0]));
  ok(calls.join() === 'Lisbon', 'the tool ran here, once, with what the model asked for', calls);
  const tr = ((sent[1] || {}).messages || []).slice(-1)[0];
  ok(tr && tr.role === 'user' && Array.isArray(tr.content) && tr.content.some(c => c.type === 'tool_result' && /"sky":"sunny"/.test(c.content)), 'and its result went back to the model', tr);
  ok(run.stoppedBy === 'done' && run.turns === 2 && AMV.text(run.message) === 'It is sunny in Lisbon.', 'the run says it finished, after two turns', [run.stoppedBy, run.turns]);
}

section('Nothing is run on a guess, and every failure is something the model can read');
{
  let ran = 0;
  const tool = { name: 'weather', input_schema: { type: 'object' }, run: async () => { ran++; return 'ok'; } };
  sent.length = 0; script = [toolReply('teleport', '{}'), textReply('ok')];
  await amv.runAgent({ messages: [{ role: 'user', content: 'go' }], tools: [tool] });
  ok(lastResults().some(r => r.is_error && /no tool called "teleport"/.test(r.content)), 'a tool that does not exist is answered as an error, naming the ones that do', lastResults());
  sent.length = 0; script = [toolReply('weather', '{"city": "Lis'), textReply('ok')];
  ran = 0; await amv.runAgent({ messages: [{ role: 'user', content: 'go' }], tools: [tool] });
  ok(ran === 0 && lastResults().some(r => r.is_error && /could not be read/.test(r.content)), 'input that does not parse is not run', [ran, lastResults()]);
  sent.length = 0; script = [toolReply('weather', '{}'), textReply('ok')];
  await amv.runAgent({ messages: [{ role: 'user', content: 'go' }], tools: [{ ...tool, run: async () => { throw new Error('service down'); } }] });
  ok(lastResults().some(r => r.is_error && /failed: service down/.test(r.content)), 'a tool that throws is reported, with what it said', lastResults());
  sent.length = 0; script = [toolReply('weather', '{}'), textReply('ok')];
  ran = 0; await amv.runAgent({ messages: [{ role: 'user', content: 'go' }], tools: [tool], approve: async () => false });
  ok(ran === 0 && lastResults().some(r => r.is_error && /declined/.test(r.content)), 'a call the person declines is not run, and the model is told', [ran, lastResults()]);
}

section('It stops when it is told to, and says which');
{
  const tool = { name: 'weather', input_schema: { type: 'object' }, run: async () => 'again' };
  script = [toolReply('weather', '{}'), toolReply('weather', '{}'), toolReply('weather', '{}'), toolReply('weather', '{}')];
  const r = await amv.runAgent({ messages: [{ role: 'user', content: 'loop' }], tools: [tool], maxTurns: 3 });
  ok(r.stoppedBy === 'max_turns' && r.turns === 3, 'at maxTurns, and it says so rather than passing it off as an answer', [r.stoppedBy, r.turns]);
  script = [];
  const ctl = new AbortController();
  script = [toolReply('weather', '{}'), textReply('never')];
  const r2 = await amv.runAgent({ messages: [{ role: 'user', content: 'go' }], signal: ctl.signal,
    tools: [{ name: 'weather', input_schema: { type: 'object' }, run: async () => { ctl.abort(); return 'x'; } }] });
  ok(r2.stoppedBy === 'aborted', 'and when stopped', r2.stoppedBy);
  script = [];
}

section('Only an API key brings its own tools - the app’s requests keep AMV’s list');
{
  sent.length = 0; script = [textReply('hi')];
  await call('/v1/messages', { model: 'auto', max_tokens: 50, stream: true, messages: [{ role: 'user', content: 'hi' }],
    tools: [{ name: 'weather', description: 'x', input_schema: { type: 'object' } }, { name: 'run_code', description: 'x', input_schema: { type: 'object' } }] }, tok).then(r => r.text());
  ok(sent.length === 1 && !toolNames(sent[0]).includes('weather') && toolNames(sent[0]).includes('run_code'),
     'signed in through the app, a name AMV does not know is still dropped, and its own are kept', sent[0] && toolNames(sent[0]));
  sent.length = 0; script = [textReply('hi')];
  await amv.messages.create({ messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'bad name!', input_schema: { type: 'object' } }, { name: 'x'.repeat(65), input_schema: { type: 'object' } }] });
  ok(sent.length === 1 && toolNames(sent[0]).length === 0, 'and a caller’s tool still has to be named like one', sent[0] && toolNames(sent[0]));
}

section('Refused with a sentence, and the key never in it');
{
  const thrown = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
  const e1 = await thrown(() => new AMV({ apiKey: KEY, baseURL: 'http://amv.example.com' }));
  ok(e1 instanceof AMVError && /https:\/\//.test(e1.message), 'plain http to another machine is refused before anything is sent', e1 && e1.message);
  globalThis.window = {}; globalThis.document = {};
  const e2 = await thrown(() => new AMV({ apiKey: KEY, baseURL: API }));
  delete globalThis.window; delete globalThis.document;
  ok(e2 instanceof AMVError && e2.code === 'browser' && /anybody can read the API key/.test(e2.message), 'a web page is refused, and told why', e2 && e2.message);
  const e3 = await thrown(() => new AMV({ apiKey: '', baseURL: API }));
  ok(e3 instanceof AMVError && /AMV_API_KEY/.test(e3.message), 'no key says where one comes from', e3 && e3.message);
  const list = await (await call('/v1/keys/list', {}, tok)).json();
  await call('/v1/keys/revoke', { id: list.keys[0].id }, tok);
  const e4 = await thrown(() => amv.messages.create({ messages: [{ role: 'user', content: 'hi' }] }));
  ok(e4 instanceof AMVError && e4.status === 401 && /did not accept this key/.test(e4.message), 'a revoked key is refused, pointing at where keys are managed', e4 && e4.message);
  ok(![e1, e2, e3, e4].some(e => e && String(e.message).includes(KEY)), 'and the key is in none of them');
}

section('The copy the site serves is the one tested here');
{
  const served = readFileSync(join(ROOT, 'public', 'amv-sdk.mjs'), 'utf8');
  ok(served === readFileSync(join(ROOT, 'sdk', 'amv-sdk.mjs'), 'utf8'), 'public/amv-sdk.mjs is byte-identical to sdk/amv-sdk.mjs');
  ok(served.includes("'__AMV_API__'"), 'with the placeholder the page fills with this deployment’s address');
}

server.close();
if (report('amv-from-your-own-code') > 0) process.exitCode = 1;
done();
