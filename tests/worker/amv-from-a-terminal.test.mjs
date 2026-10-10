/* AMV FROM A TERMINAL - THE COMMAND-LINE TOOL, AGAINST THE REAL SERVER.

   cli/amv-cli.mjs is one dependency-free file somebody downloads from
   Settings -> API keys. This runs it as a real child process against the
   Worker itself (amv-backend.js, served over HTTP on this machine), with a
   real key created through /v1/keys/create - so what is checked is the tool
   and the server agreeing, not the tool and a stub that agrees with it:

   - a question streams back as it is written, and the server is sent exactly
     what was asked;
   - what is piped in travels with the question; --json gives scripts one
     object; -m picks the engine;
   - the key is only ever read from AMV_API_KEY, never a flag, and is never
     sent unencrypted to anything but this machine;
   - a revoked key, a used-up day and a bad option each end with a sentence
     somebody can act on and a non-zero exit;
   - the copy the site serves is byte-identical to the one tested here. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import { spawn } from 'child_process';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const CLI = join(ROOT, 'cli', 'amv-cli.mjs');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'cli.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, todayKey };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

/* The model: records what it was sent, answers in its real streamed shape. */
const sent = [];
const realFetch = globalThis.fetch;
const sse = (text) => 'data: {"type":"message_start","message":{"model":"m","usage":{"input_tokens":12,"output_tokens":0}}}\n\n'
  + text.split(' ').map((w, i) => 'data: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: (i ? ' ' : '') + w } }) + '\n\n').join('')
  + 'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n'
  + 'data: {"type":"message_stop"}\n\n';
globalThis.fetch = async (url, init) => {
  if (!/model\.example/.test(String(url))) return { ok: true, status: 200, json: async () => ({}) };
  sent.push(JSON.parse(init.body));
  return new Response(sse('Paris is the capital of France.'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

const m = new Map(), vals = new Map();
const env = {
  AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example', JWT_SECRET: 'cli-secret', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
  AMV_KV: {
    async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
    async list({ prefix, limit } = {}) { const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })); return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true }; },
  },
  AMV_COUNTER: { idFromName: (n) => n, get: (n) => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
    if (b.op === 'reserve') { if (b.cap != null && b.cap !== Infinity && cur + b.amount > b.cap) return r({ allowed: false, value: cur }); vals.set(n, cur + b.amount); return r({ allowed: true, value: cur + b.amount }); }
    if (b.op === 'incr') { vals.set(n, cur + b.amount); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    if (b.op === 'checkCap') return r({ allowed: b.cap == null || cur < b.cap, value: cur });
    if (b.op === 'rateCheck') return r({ allowed: true });
    if (b.op === 'claim') return r({ claimed: true });
    return r({ allowed: true, value: cur });
  } }) },
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

function run(args, { key = KEY, input, extraEnv } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { env: Object.assign({ PATH: process.env.PATH, AMV_API_KEY: key || '' }, extraEnv || {}) });
    let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', (code) => resolve({ code, out, err }));
    if (input != null) p.stdin.end(input); else p.stdin.end();
  });
}

section('A question is answered, streamed, and the server is sent exactly that');
{
  ok(typeof KEY === 'string' && KEY.startsWith('amv_sk_'), 'a real key was created through the API', made);
  sent.length = 0;
  const r = await run(['--api', API, 'What is the capital of France?']);
  ok(r.code === 0 && r.out === 'Paris is the capital of France.\n', 'the answer is printed, ending in a newline', r);
  const b = sent[0] || {};
  const userTurn = (b.messages || []).map(x => typeof x.content === 'string' ? x.content : JSON.stringify(x.content)).join('|');
  ok(sent.length === 1 && /What is the capital of France\?/.test(userTurn), 'the model is sent the question', userTurn.slice(0, 120));
  ok(b.stream === true, 'and the request streams, as the endpoint requires', b.stream);
}

section('Piped text travels with the question; --json is one object; -m picks the engine');
{
  sent.length = 0;
  const r = await run(['--api', API, '-m', 'amv-pulse', 'Summarise this'], { input: 'line one\nline two\n' });
  const userTurn = JSON.stringify(sent[0] && sent[0].messages);
  ok(r.code === 0 && /Summarise this\\n\\nline one\\nline two/.test(userTurn), 'question first, then what was piped in', userTurn.slice(0, 160));
  const j = await run(['--api', API, '--json', 'hi']);
  let o = null; try { o = JSON.parse(j.out); } catch (e) {}
  ok(j.code === 0 && o && o.text === 'Paris is the capital of France.' && o.usage.output_tokens === 7 && o.stop_reason === 'end_turn',
     'a script gets text, usage and stop_reason, and nothing else on stdout', j.out.slice(0, 200));
}

section('The key comes from the environment only, and never travels unencrypted');
{
  const flag = await run(['--api', API, '--key', KEY, 'hi'], { key: '' });
  ok(flag.code === 2 && /never taken on the command line/.test(flag.err), 'a --key flag is refused with the reason', flag.err);
  const none = await run(['--api', API, 'hi'], { key: '' });
  ok(none.code === 2 && /AMV_API_KEY/.test(none.err), 'no key says where to put one', none.err);
  const plain = await run(['--api', 'http://example.com', 'hi']);
  ok(plain.code === 2 && /https/.test(plain.err), 'a plain-http server elsewhere is refused before the key is sent', plain.err);
  const noServer = await run(['hi']);
  ok(noServer.code === 2 && /Download this tool again|AMV_API_URL/.test(noServer.err), 'the undownloaded copy says it has no server set', noServer.err);
}

section('Refusals say what to do');
{
  const bad = await run(['--api', API, '-m', 'gpt', 'hi']);
  ok(bad.code === 2 && /unknown model/.test(bad.err), 'an unknown engine names the real ones', bad.err);
  vals.set(`usg:${EMAIL}:${W.todayKey()}`, 10 ** 9);
  const day = await run(['--api', API, 'hi']);
  ok(day.code === 1 && /Daily usage limit/.test(day.err) && /Try again in/.test(day.err), 'a used-up day says so, and when it clears', day.err);
  vals.delete(`usg:${EMAIL}:${W.todayKey()}`);
  const list = await (await call('/v1/keys/list', {}, tok)).json();
  await call('/v1/keys/revoke', { id: list.keys[0].id }, tok);
  const gone = await run(['--api', API, 'hi']);
  ok(gone.code === 1 && /did not accept this key/.test(gone.err), 'a revoked key is refused, pointing at where keys are managed', gone.err);
}

section('The site serves the same file that was tested');
{
  const served = readFileSync(join(ROOT, 'public', 'amv-cli.mjs'), 'utf8');
  ok(served === readFileSync(CLI, 'utf8'), 'public/amv-cli.mjs is byte-identical to cli/amv-cli.mjs');
  ok(served.includes("'__AMV_API__'"), 'with the placeholder the page fills with this deployment’s address');
}

server.close();
globalThis.fetch = realFetch;
if (report('amv-from-a-terminal') > 0) process.exitCode = 1;
done();
