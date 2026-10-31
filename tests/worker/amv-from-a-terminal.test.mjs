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
   - --count asks how many input tokens a request would be, counted on what
     AMV would really send, and sends nothing to be answered;
   - `amv code` works in the folder it was started in: it reads freely and
     only there (not by .., not through a link), shows each write as the lines
     it changes and asks first, asks before every command and runs it without
     the API key in its environment, takes no answer as no, and can put every
     change back at the end;
   - `amv batch` hands over a file of requests and collects the answers;
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
import { authObjectOp } from '../lib/auth-object.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const CLI = join(ROOT, 'cli', 'amv-cli.mjs');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'cli.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, todayKey, runBatches };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

/* The model: records what it was sent, answers in its real streamed shape. */
const sent = [];
const realFetch = globalThis.fetch;
const sse = (text) => 'data: {"type":"message_start","message":{"model":"m","usage":{"input_tokens":12,"output_tokens":0}}}\n\n'
  + text.split(' ').map((w, i) => 'data: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: (i ? ' ' : '') + w } }) + '\n\n').join('')
  + 'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n'
  + 'data: {"type":"message_stop"}\n\n';
const counted = [];
globalThis.fetch = async (url, init) => {
  if (!/model\.example/.test(String(url))) return { ok: true, status: 200, json: async () => ({}) };
  if (/\/v1\/messages\/count_tokens$/.test(String(url))) {
    counted.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ input_tokens: 4321 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
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
    { const a = authObjectOp(n, b); if (a) return a; }
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

section('--count says how many input tokens, and sends nothing to be answered');
{
  sent.length = 0; counted.length = 0;
  const before = vals.get(`usg:${EMAIL}:${W.todayKey()}`) || 0;
  const r = await run(['--api', API, '--count', '-s', 'Be brief.', 'How long is this?']);
  ok(r.code === 0 && r.out === '4321 input tokens on amv-core\n', 'the count is printed, and the engine it is for', r);
  const c = counted[0] || {};
  const sys = JSON.stringify(c.system || '');
  ok(counted.length === 1 && /Be brief\./.test(sys) && sys.length > 200, 'counted on what AMV would send: AMV\u2019s own framing and the caller\u2019s instructions', sys.slice(0, 120));
  ok(sent.length === 0, 'nothing was sent to be answered', sent.length);
  ok((vals.get(`usg:${EMAIL}:${W.todayKey()}`) || 0) === before, 'and nothing was counted against the plan');
  const j = await run(['--api', API, '--count', '--json', 'hi']);
  let o = null; try { o = JSON.parse(j.out); } catch (e) {}
  ok(o && o.input_tokens === 4321 && o.engine === 'amv-core', 'a script gets the number as JSON', j.out);
  const both = await run(['--api', API, '--count', 'chat']);
  ok(both.code === 2 && /does not start a conversation/.test(both.err), '--count with chat is refused, with the reason', both.err);
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

section('amv code works in this folder, and asks before every write and every command');
{
  const { mkdtempSync, writeFileSync: wf, readFileSync: rf, existsSync: ex, symlinkSync } = await import('fs');
  const { tmpdir } = await import('os');
  const dir = mkdtempSync(join(tmpdir(), 'amv-code-'));
  wf(join(dir, 'app.js'), 'const x = 1;\nmodule.exports = x;\n');
  wf(join(dirname(dir), 'outside-secret.txt'), 'top secret');
  try { symlinkSync(join(dirname(dir), 'outside-secret.txt'), join(dir, 'link.txt')); } catch (e) {}

  /* The engine's side of the conversation, one turn at a time. */
  const turn = (blocks) => 'data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":0}}}\n\n'
    + blocks.map((b, i) => b.text != null
      ? 'data: ' + JSON.stringify({ type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } }) + '\n\n'
        + 'data: ' + JSON.stringify({ type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: b.text } }) + '\n\n'
      : 'data: ' + JSON.stringify({ type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: 't' + i + Math.random().toString(36).slice(2, 6), name: b.name, input: {} } }) + '\n\n'
        + JSON.stringify(b.input).match(/.{1,7}/g).map(p => 'data: ' + JSON.stringify({ type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: p } }) + '\n\n').join('')
    ).join('')
    + 'data: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: blocks.some(b => b.name) ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 3 } }) + '\n\n'
    + 'data: {"type":"message_stop"}\n\n';
  let script = [], seenTools = [], seenResults = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!/model\.example/.test(String(url))) return prev(url, init);
    const b = JSON.parse(init.body);
    seenTools.push((b.tools || []).map(t => t.name).sort().join(','));
    const last = b.messages[b.messages.length - 1];
    if (Array.isArray(last.content)) seenResults.push(...last.content.filter(x => x.type === 'tool_result').map(x => x.content));
    return new Response(turn(script.shift() || [{ text: 'Done.' }]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  const runIn = (args, input) => new Promise((res) => {
    const p = spawn(process.execPath, [CLI, '--api', API, ...args], { cwd: dir, env: { PATH: process.env.PATH, AMV_API_KEY: KEY } });
    let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', (code) => res({ code, out, err })); p.stdin.end(input || '');
  });

  script = [
    [{ text: 'Looking. ' }, { name: 'list_dir', input: {} }, { name: 'read_file', input: { path: 'app.js' } }],
    [{ name: 'read_file', input: { path: '../outside-secret.txt' } }, { name: 'read_file', input: { path: 'link.txt' } }],
    [{ name: 'write_file', input: { path: 'app.js', content: 'const x = 2;\nmodule.exports = x;\n' } }],
    [{ name: 'run_command', input: { command: 'node -e "require(\'fs\').writeFileSync(\'ran.txt\', String(process.env.AMV_API_KEY || \'none\'))"' } }],
    [{ text: 'Changed x to 2.' }],
  ];
  const r = await runIn(['code', 'set', 'x', 'to', '2'], 'y\ny\nn\n');
  ok(r.code === 0 && /Changed x to 2\./.test(r.out), 'the task runs to its end', { code: r.code, err: r.err.slice(0, 200) });
  ok(seenTools[0] === 'list_dir,read_file,run_command,write_file', 'the engine is offered the four tools, through AMV’s own server', seenTools[0]);
  ok(/app\.js/.test(seenResults[0] || '') && /const x = 1/.test(seenResults[1] || ''), 'it can look around and read without asking', seenResults.slice(0, 2));
  ok(/outside the folder/.test(seenResults[2] || '') && /outside the folder/.test(seenResults[3] || ''), 'a path out of the folder is refused - by .. and by a link', seenResults.slice(2, 4));
  ok(!/top secret/.test(seenResults.join('')), 'and nothing outside it was read');
  ok(/@@ line 1 @@/.test(r.out) && /- const x = 1;/.test(r.out) && /\+ const x = 2;/.test(r.out), 'the write is shown as the lines it changes, before it happens', r.out.slice(0, 400));
  ok(rf(join(dir, 'app.js'), 'utf8').startsWith('const x = 2;'), 'and with a yes, it is written');
  ok(rf(join(dir, 'ran.txt'), 'utf8') === 'none', 'the command ran, with a yes - and without the API key in its environment');
  ok(/Changed:\n  app\.js/.test(r.out), 'it lists what it changed at the end', r.out.slice(-200));

  script = [
    [{ name: 'write_file', input: { path: 'app.js', content: 'hacked' } }, { name: 'run_command', input: { command: 'node -e "require(\'fs\').writeFileSync(\'no.txt\',\'1\')"' } }],
    [{ text: 'Understood.' }],
  ];
  seenResults = [];
  const n = await runIn(['code', 'break', 'it'], 'n\nn\n');
  ok(rf(join(dir, 'app.js'), 'utf8').startsWith('const x = 2;') && !ex(join(dir, 'no.txt')), 'a no leaves the file alone and runs nothing', n.out.slice(-300));
  ok(/said no to writing/.test(seenResults[0] || '') && /said no to running/.test(seenResults[1] || ''), 'and the engine is told it was the person’s no', seenResults);

  script = [
    [{ name: 'write_file', input: { path: 'new/file.txt', content: 'hello' } }],
    [{ text: 'Made it.' }],
  ];
  const nobody = await runIn(['code', 'make', 'a', 'file'], '');
  ok(!ex(join(dir, 'new', 'file.txt')) && /no answer - taken as no/.test(nobody.out), 'with nobody at the keyboard, every question is a no', nobody.out.slice(-200));

  script = [
    [{ name: 'write_file', input: { path: 'new/file.txt', content: 'hello' } }],
    [{ text: 'Made it.' }],
  ];
  const undo = await runIn(['code', 'make', 'a', 'file'], 'y\ny\n');
  ok(!ex(join(dir, 'new', 'file.txt')) && /Put back as they were/.test(undo.out), 'and at the end every change can be put back', undo.out.slice(-200));

  /* A link to a file that does not exist yet, under an ordinary name - the
     shape a downloaded repository can ship. Even with a yes, nothing may be
     written where it leads. */
  const target = join(dirname(dir), 'planted-' + Date.now() + '.txt');
  try { symlinkSync(target, join(dir, 'notes.txt')); } catch (e) {}
  script = [
    [{ name: 'write_file', input: { path: 'notes.txt', content: 'written through a link' } }],
    [{ text: 'Done.' }],
  ];
  seenResults = [];
  const planted = await runIn(['code', 'update', 'the', 'notes'], 'y\ny\n');
  ok(!ex(target), 'a link to a file that does not exist yet does not carry a write out of the folder', planted.out.slice(-300));
  ok(/link/.test(seenResults[0] || ''), 'and the engine is told why', seenResults[0]);

  globalThis.fetch = prev;
}

section('amv batch: many requests handed over, and collected later');
{
  const { mkdtempSync, writeFileSync: wf } = await import('fs');
  const { tmpdir } = await import('os');
  const f = join(mkdtempSync(join(tmpdir(), 'amv-batch-')), 'asks.jsonl');
  wf(f, 'What is two plus two?\n\nName a colour.\n');
  const sub = await run(['--api', API, 'batch', 'submit', f]);
  const id = (sub.out.match(/batch_[a-f0-9]{24}/) || [])[0];
  ok(sub.code === 0 && id && /amv batch status/.test(sub.out), 'a file of questions becomes one batch, with how to check on it', sub);
  /* Batches are worked by the cron, never inside the request that made them:
     one tick here stands in for the next five-minute run. */
  await W.runBatches(env, ctx);
  let st = '';
  for (let i = 0; i < 40 && !/ended/.test(st); i++) { st = (await run(['--api', API, 'batch', 'status', id])).out; if (!/ended/.test(st)) await new Promise(r => setTimeout(r, 100)); }
  ok(/ended/.test(st) && /2 succeeded/.test(st), 'it finishes in the background', st);
  const res = await run(['--api', API, 'batch', 'results', id]);
  const lines = res.out.trim().split('\n').map(l => JSON.parse(l));
  ok(lines.length === 2 && lines[0].custom_id === 'line-1' && lines[1].custom_id === 'line-3' && lines[0].result.type === 'succeeded',
     'one result per question, named by the line it came from', lines.map(l => [l.custom_id, l.result.type]));
  const list = await run(['--api', API, 'batch', 'list']);
  ok(list.out.includes(id), 'and it is in the list', list.out);
  const bad = await run(['--api', API, 'batch', 'status', 'nope']);
  ok(bad.code === 2 && /which batch/.test(bad.err), 'a malformed id is refused before anything is sent', bad.err);
}

section('The JetBrains tool set runs, as the IDE would run it');
{
  /* The file somebody saves as AMV.xml, read as written: each entry's
     command, its macros filled the way the IDE fills them, run against this
     server. Nothing is retyped here, so an entry that drifts from the tool's
     options fails. */
  const { mkdtempSync, writeFileSync: wf } = await import('fs');
  const { tmpdir } = await import('os');
  const xml = readFileSync(join(ROOT, 'jetbrains', 'amv-jetbrains.xml'), 'utf8');
  const tools = [...xml.matchAll(/<tool name="([^"]+)"[\s\S]*?<option name="PARAMETERS" value="([^"]*)"[\s\S]*?<\/tool>/g)].map(m => ({ name: m[1], params: m[2].replace(/&quot;/g, '"') }));
  ok(tools.length === 3 && !/amv_sk_|https?:\/\//.test(xml), 'three entries, and the file holds no key and no address', tools.map(t => t.name));
  const proj = mkdtempSync(join(tmpdir(), 'amv-jb-'));
  const file = join(proj, 'app.js');
  wf(file, 'line one\nconst price = "9.99";\nline three\nline four\n');
  const fill = (p) => p.replace('$FilePath$', file).replace('$SelectionStartLine$', '2').replace('$SelectionEndLine$', '3')
    .replace('$ProjectFileDir$', proj).replace('$Prompt$', 'What does this do?');
  const argv = (p) => [...fill(p).matchAll(/"([^"]*)"|(\S+)/g)].map(m => m[1] != null ? m[1] : m[2]);
  for (const t of tools) {
    const args = argv(t.params);
    ok(args[0] === '$UserHome$/amv-cli.mjs', t.name + ': runs the tool saved in the home folder', args[0]);
    sent.length = 0;
    const r = await run(args.slice(1), { extraEnv: { AMV_API_URL: API } });
    const asked = JSON.stringify((sent[0] || {}).messages || '');
    if (/selection/.test(t.name)) ok(r.code === 0 && /What does this do\?/.test(asked) && /const price = \\"9.99\\";\\nline three/.test(asked) && !/line one|line four/.test(asked),
      t.name + ': the selected lines go with the question - quotes in the code included - and nothing else', asked.slice(0, 240));
    else if (/this file/.test(t.name)) ok(r.code === 0 && /=== app.js ===/.test(asked) && /line one/.test(asked) && /line four/.test(asked), t.name + ': the whole file goes with the question', asked.slice(0, 200));
    else ok(r.code === 0 && sent.length >= 1, t.name + ': AMV works in the project; with no one to answer, it changes nothing', [r.code, r.err.slice(0, 200)]);
  }
  const bad = await run(['--lines', '5-2', '--file', file, 'x'], { extraEnv: { AMV_API_URL: API } });
  ok(bad.code === 2 && /--lines takes/.test(bad.err), 'a backwards range is refused with the form it takes', bad.err);
  const none = await run(['--lines', '2', 'x'], { extraEnv: { AMV_API_URL: API } });
  ok(none.code === 2 && /name the file too/.test(none.err), '--lines without a file says so', none.err);
  const dir = await run(['--file', proj, 'x'], { extraEnv: { AMV_API_URL: API } });
  ok(dir.code === 2 && /is not a file/.test(dir.err), 'a folder is not read as a file', dir.err);
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
  ok(readFileSync(join(ROOT, 'public', 'amv-jetbrains.xml'), 'utf8') === readFileSync(join(ROOT, 'jetbrains', 'amv-jetbrains.xml'), 'utf8'),
     'and the JetBrains tool set it serves is the one run here');
}

server.close();
globalThis.fetch = realFetch;
if (report('amv-from-a-terminal') > 0) process.exitCode = 1;
done();
