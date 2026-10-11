#!/usr/bin/env node
/* AMV FROM A TERMINAL.

   One file, no dependencies, Node 18 or newer. Downloaded from Settings ->
   API keys, where AMV writes this deployment's address into it, so there is
   nothing to configure but the key.

     export AMV_API_KEY=amv_sk_...
     node amv-cli.mjs "Summarise the plot of Hamlet in three lines"
     cat notes.txt | node amv-cli.mjs "Turn these notes into an email"
     node amv-cli.mjs chat                       a conversation, Ctrl-D to end
     node amv-cli.mjs -m amv-pulse --json "..."  one JSON object, for scripts
     node amv-cli.mjs --count "..."              how many input tokens, without sending
     node amv-cli.mjs code "make the tests pass" AMV works in this folder, asking first

   THE KEY IS READ FROM THE ENVIRONMENT AND NOWHERE ELSE. Not a flag: a key on
   the command line is in the shell's history and in every process listing
   on the machine, and there is no way to take it back out of either. */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const DEFAULT_API = '__AMV_API__';
const VERSION = '1';
const ENGINES = ['auto', 'amv-pulse', 'amv-core', 'amv-swift', 'amv-forge', 'amv-apex'];

const HELP = `amv - ask AMV from a terminal

  amv "your question"            answer streams as it is written
  some-command | amv "what to do with it"
                                 what is piped in is sent along with the question
  amv chat                       a conversation; Ctrl-D or "exit" to end
  amv code "what to do"          AMV works on the files in this folder: it reads freely,
                                 and asks before every change and every command

Options
  -m, --model NAME     ${ENGINES.join(', ')} (default auto)
  -s, --system TEXT    instructions for this request
  -t, --max-tokens N   longest answer, in tokens (default 4096)
      --json           print one JSON object when done: text, model, usage, stop_reason
      --count          print how many input tokens the request would use, and send nothing
      --api URL        a different AMV server (or set AMV_API_URL)
  -h, --help           this text
  -v, --version

The key comes from AMV_API_KEY. Create one in AMV under Settings -> API keys.
Usage counts against that account's plan.`;

/* ── arguments ─────────────────────────────────────────────────────────── */
function parseArgs(argv) {
  const o = { model: 'auto', system: '', maxTokens: 4096, json: false, api: '', words: [], chat: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) throw usage(a + ' needs a value');
      return argv[++i];
    };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a === '-m' || a === '--model') o.model = val();
    else if (a === '-s' || a === '--system') o.system = val();
    else if (a === '-t' || a === '--max-tokens') o.maxTokens = Number(val());
    else if (a === '--json') o.json = true;
    else if (a === '--count') o.count = true;
    else if (a === '--api') o.api = val();
    else if (/^--?(key|api-key|token)(=|$)/.test(a)) throw usage('the key is never taken on the command line, where it would be saved in your shell history. Set AMV_API_KEY instead.');
    else if (a === '--') { o.words.push(...argv.slice(i + 1)); break; }
    else if (/^-/.test(a) && a !== '-') throw usage('unknown option ' + a);
    else o.words.push(a);
  }
  if (o.words[0] === 'chat' && o.words.length === 1) { o.chat = true; o.words = []; }
  if (o.count && o.chat) throw usage('--count counts one request; it does not start a conversation');
  if (o.words[0] === 'code') o.code = true;
  if (o.count && o.code) throw usage('--count counts one request; it does not start work in a folder');
  if (!ENGINES.includes(o.model)) throw usage('unknown model "' + o.model + '" - one of ' + ENGINES.join(', '));
  if (!Number.isInteger(o.maxTokens) || o.maxTokens < 1 || o.maxTokens > 64000) throw usage('--max-tokens takes a whole number from 1 to 64000');
  return o;
}
function usage(msg) { const e = new Error(msg); e.exit = 2; return e; }

function apiBase(o, env) {
  const raw = o.api || env.AMV_API_URL || (DEFAULT_API.startsWith('__') ? '' : DEFAULT_API);
  if (!raw) throw usage('no AMV server is set. Download this tool again from Settings -> API keys, or set AMV_API_URL.');
  let u;
  try { u = new URL(raw); } catch (e) { throw usage('"' + raw + '" is not a web address'); }
  /* The key travels in every request, so it never travels in the clear -
     except to this machine, which is how the tool is tested. */
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw usage('the AMV server must be an https:// address, so your key is never sent unencrypted');
  return u.origin;
}

/* ── one request, streamed ─────────────────────────────────────────────── */
/* Reads the server's event stream and writes text as it arrives. Returns the
   whole message, the shape the API's own non-streaming clients use. */
async function ask({ base, key, model, system, maxTokens, messages, onText, signal }) {
  const body = { model, max_tokens: maxTokens, stream: true, messages };
  if (system) body.system = system;
  let res;
  try {
    res = await fetch(base + '/v1/messages', {
      method: 'POST', signal,
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
                 'User-Agent': 'amv-cli/' + VERSION },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (signal && signal.aborted) throw stopped();
    throw fail('could not reach ' + base + ' (' + (e.cause && e.cause.code || e.message) + ')');
  }
  if (!res.ok) throw await refusal(res);

  const out = { text: '', model: '', usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: null };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let ev; try { ev = JSON.parse(data); } catch (e) { continue; }
        if (ev.type === 'message_start' && ev.message) {
          out.model = ev.message.model || out.model;
          if (ev.message.usage) out.usage.input_tokens = ev.message.usage.input_tokens || 0;
        } else if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
          out.text += ev.delta.text;
          if (onText) onText(ev.delta.text);
        } else if (ev.type === 'message_delta') {
          if (ev.delta && ev.delta.stop_reason) out.stop_reason = ev.delta.stop_reason;
          if (ev.usage && ev.usage.output_tokens != null) out.usage.output_tokens = ev.usage.output_tokens;
        } else if (ev.type === 'error') {
          throw fail((ev.error && ev.error.message) || 'the answer stopped with an error');
        }
      }
    }
  } catch (e) {
    if (signal && signal.aborted) throw stopped();
    throw e;
  }
  return out;
}
function fail(msg) { const e = new Error(msg); e.exit = 1; return e; }
function stopped() { const e = new Error('stopped'); e.exit = 130; e.quiet = true; return e; }

/* What the server said, in a sentence somebody can act on. The server already
   writes one; this adds the part only a terminal needs - which setting, and
   how long to wait. */
async function refusal(res) {
  let d = {};
  try { d = await res.json(); } catch (e) {}
  const code = d.code || '';
  const said = d.error || ('the server answered ' + res.status);
  if (res.status === 401) return fail('AMV did not accept this key. It may have been revoked - check Settings -> API keys.');
  if (res.status === 402 || code === 'plan_required') return fail(said);
  if (res.status === 429 || res.status === 503) {
    const wait = Number(res.headers.get('Retry-After') || d.retryAfter || 0);
    return fail(said + (wait ? ' Try again in ' + human(wait) + '.' : ''));
  }
  return fail(said + (code ? ' (' + code + ')' : ''));
}
function human(s) {
  if (s < 90) return s + ' seconds';
  if (s < 5400) return Math.round(s / 60) + ' minutes';
  return Math.round(s / 3600) + ' hours';
}

/* How many input tokens a request would use - counted by the server on what
   it would really send, AMV's own instructions included. Nothing is
   generated and nothing counts against the plan. */
async function countTokens({ base, key, model, system, messages, signal }) {
  const body = { model, messages };
  if (system) body.system = system;
  let res;
  try {
    res = await fetch(base + '/v1/messages/count_tokens', {
      method: 'POST', signal,
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'User-Agent': 'amv-cli/' + VERSION },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (signal && signal.aborted) throw stopped();
    throw fail('could not reach ' + base + ' (' + (e.cause && e.cause.code || e.message) + ')');
  }
  if (!res.ok) throw await refusal(res);
  return res.json();
}

/* ── stdin ─────────────────────────────────────────────────────────────── */
async function readStdin(stdin) {
  if (stdin.isTTY) return '';
  const chunks = [];
  for await (const c of stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}
const PIPED_MAX = 400000;

/* ── main ──────────────────────────────────────────────────────────────── */
export async function main(argv, { env = process.env, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) { stderr.write('amv: ' + e.message + '\n'); return e.exit || 2; }
  if (o.help) { stdout.write(HELP + '\n'); return 0; }
  if (o.version) { stdout.write('amv-cli ' + VERSION + '\n'); return 0; }

  const key = String(env.AMV_API_KEY || '').trim();
  if (!key) { stderr.write('amv: set AMV_API_KEY to a key from AMV (Settings -> API keys).\n'); return 2; }
  if (!/^amv_sk_[A-Za-z0-9_-]{16,}$/.test(key)) { stderr.write('amv: AMV_API_KEY does not look like an AMV key (they start amv_sk_).\n'); return 2; }
  let base;
  try { base = apiBase(o, env); } catch (e) { stderr.write('amv: ' + e.message + '\n'); return e.exit || 2; }

  const ctrl = new AbortController();
  const onInt = () => ctrl.abort();
  process.once('SIGINT', onInt);
  const write = (t) => { if (!o.json) stdout.write(t); };
  try {
    if (o.chat) return await chat(o, base, key, stdin, stdout, stderr, ctrl);
    /* Before stdin is read as part of a question: here it carries the answers. */
    if (o.code) return await code(o, base, key, stdin, stdout, stderr, ctrl);

    const piped = await readStdin(stdin);
    if (piped.length > PIPED_MAX) { stderr.write('amv: what was piped in is over ' + PIPED_MAX + ' characters; send a smaller part.\n'); return 2; }
    const q = o.words.join(' ').trim();
    if (!q && !piped.trim()) { stderr.write('amv: nothing to ask. Try: amv "your question"   (or amv --help)\n'); return 2; }
    const content = piped.trim() ? (q ? q + '\n\n' + piped : piped) : q;

    if (o.count) {
      const c = await countTokens({ base, key, model: o.model, system: o.system, messages: [{ role: 'user', content }], signal: ctrl.signal });
      stdout.write(o.json ? JSON.stringify(c) + '\n'
        : c.input_tokens + ' input tokens' + (c.engine ? ' on ' + c.engine : '') + (c.estimate ? ' (an estimate - this engine cannot be counted exactly)' : '') + '\n');
      return 0;
    }
    const r = await ask({ base, key, model: o.model, system: o.system, maxTokens: o.maxTokens,
                          messages: [{ role: 'user', content }], onText: write, signal: ctrl.signal });
    if (o.json) stdout.write(JSON.stringify(r) + '\n');
    else {
      if (!r.text.endsWith('\n')) stdout.write('\n');
      if (r.stop_reason === 'max_tokens') stderr.write('amv: the answer reached --max-tokens and was cut off.\n');
    }
    return 0;
  } catch (e) {
    if (!e.quiet) stderr.write('\namv: ' + e.message + '\n');
    return e.exit || 1;
  } finally {
    process.removeListener('SIGINT', onInt);
  }
}

/* ── amv code: AMV working in this folder ──────────────────────────────────
   The same four tools AMV uses through the bridge - read, list, write, run -
   but here the terminal IS the computer, so they run in this process, in the
   folder `amv code` was started in, and nowhere else.

   WHAT IT MAY DO WITHOUT ASKING: read files and list folders, inside this
   folder only (a path that leaves it, by `..` or by a link, is refused).

   WHAT IT ASKS ABOUT, EVERY TIME: every write, shown as the lines it changes,
   and every command, shown exactly as it would run. "a" at a write allows the
   rest of this session's writes; there is no "a" for commands, because a
   command can reach the whole computer and a write cannot leave the folder.

   With no one at the keyboard (stdin is not a terminal and gives no answer),
   every question is answered no: it can read and explain, and it changes
   nothing. Commands run without AMV_API_KEY in their environment - nothing
   it runs can read the key it is running on.

   At the end it lists every file it changed and offers to put them all back. */
const CODE_ROUNDS = 30, CODE_RESULT_MAX = 12000, CODE_FILE_MAX = 400000, CODE_CMD_MS = 120000;
const CODE_TOOLS = [
  { name: 'read_file', description: 'Read a file in the folder you are working in. Read before you change a file.',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Path relative to the folder.' } }, required: ['path'] } },
  { name: 'list_dir', description: 'List a folder inside the folder you are working in.',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Path relative to the folder. Defaults to the folder itself.' } }, required: [] } },
  { name: 'write_file', description: 'Write a whole file in the folder you are working in, creating folders as needed. The person is shown the change and asked first.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string', description: 'The complete file contents.' } }, required: ['path', 'content'] } },
  { name: 'run_command', description: 'Run a shell command in the folder you are working in and get stdout, stderr and the exit code. The person is asked before each one; if they say no, do not try another way to do the same thing.',
    input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
];
const CODE_SYS = 'You are AMV, working in a folder on the person\'s computer from their terminal. Do the task with the tools: '
  + 'look around with list_dir and read_file, change files with write_file (whole files - read first), and run builds and tests '
  + 'with run_command. Every write and every command is shown to the person and needs their yes; if they say no, respect it and '
  + 'carry on without it or say what you need. Never print secrets or dump the environment. Keep explanations short; finish with '
  + 'what you changed and anything left to do.';

/* Stream one turn, collecting text AND tool calls (assembled from their JSON
   fragments). Text is shown as it is written. */
async function askTools({ base, key, model, system, maxTokens, messages, tools, onText, signal }) {
  let res;
  try {
    res = await fetch(base + '/v1/messages', { method: 'POST', signal,
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'User-Agent': 'amv-cli/' + VERSION },
      body: JSON.stringify({ model, max_tokens: maxTokens, stream: true, system, messages, tools }) });
  } catch (e) {
    if (signal && signal.aborted) throw stopped();
    throw fail('could not reach ' + base + ' (' + (e.cause && e.cause.code || e.message) + ')');
  }
  if (!res.ok) throw await refusal(res);
  const blocks = []; let stop = null, buf = '';
  const dec = new TextDecoder();
  try {
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = raw.split('\n').find(l => l.startsWith('data:'));
        if (!line) continue;
        let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
        if (ev.type === 'content_block_start') {
          const b = ev.content_block || {};
          blocks[ev.index] = b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, _json: '' } : { type: 'text', text: '' };
        } else if (ev.type === 'content_block_delta' && blocks[ev.index]) {
          const d = ev.delta || {};
          if (d.type === 'text_delta') { blocks[ev.index].text += d.text; onText(d.text); }
          else if (d.type === 'input_json_delta') blocks[ev.index]._json += d.partial_json || '';
        } else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
        else if (ev.type === 'error') throw fail((ev.error && ev.error.message) || 'the server reported an error');
      }
    }
  } catch (e) {
    if (signal && signal.aborted) throw stopped();
    throw e;
  }
  const content = blocks.filter(Boolean).map(b => {
    if (b.type !== 'tool_use') return b;
    let input = {}; try { input = b._json ? JSON.parse(b._json) : {}; } catch (e) { input = { _unreadable: true }; }
    return { type: 'tool_use', id: b.id, name: b.name, input };
  });
  return { content, stop_reason: stop };
}

/* A question on the terminal. No answer - stdin closed, not a terminal - is no. */
function makeAsker(stdin, stdout) {
  const lines = []; let waiting = null, ended = false;
  const rl = createInterface({ input: stdin, terminal: false });
  rl.on('line', (l) => { if (waiting) { const w = waiting; waiting = null; w(l); } else lines.push(l); });
  rl.on('close', () => { ended = true; if (waiting) { const w = waiting; waiting = null; w(null); } });
  return {
    ask(q) {
      stdout.write(q);
      if (lines.length) return Promise.resolve(lines.shift());
      if (ended) { stdout.write('(no answer - taken as no)\n'); return Promise.resolve(null); }
      return new Promise((r) => { waiting = r; });
    },
    close() { try { rl.close(); } catch (e) {} },
  };
}

/* The changed lines, between what was there and what will be: the common
   start and end are left out, the middle is shown, bounded. */
function changeView(before, after) {
  const a = before == null ? [] : before.split('\n'), b = after.split('\n');
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const gone = a.slice(s, a.length - e), added = b.slice(s, b.length - e);
  const show = (xs, sign) => xs.slice(0, 40).map(l => sign + ' ' + l.slice(0, 200)).join('\n') + (xs.length > 40 ? '\n' + sign + ' … ' + (xs.length - 40) + ' more lines' : '');
  return (before == null ? '(new file, ' + b.length + ' lines)\n' : '@@ line ' + (s + 1) + ' @@\n')
    + (gone.length ? show(gone, '-') + '\n' : '') + (added.length ? show(added, '+') : '');
}

async function code(o, base, key, stdin, stdout, stderr, ctrl) {
  const { realpathSync, existsSync, statSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } = await import('node:fs');
  const { resolve, relative, dirname, isAbsolute, basename } = await import('node:path');
  const { spawn } = await import('node:child_process');
  const task = o.words.slice(1).join(' ').trim();
  if (!task) { stderr.write('amv: say what to do, e.g.  amv code "make the tests pass"\n'); return 2; }
  const root = realpathSync(process.cwd());
  const asker = makeAsker(stdin, stdout);
  const originals = new Map();   // path -> what was there (null: it did not exist)
  let allEdits = false;

  /* Inside the folder, by name AND by where a link really leads. */
  const inside = (p) => { const r = relative(root, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
  const place = (rel, forWrite) => {
    const p = resolve(root, String(rel || '.'));
    if (!inside(p)) return { error: 'That path is outside the folder AMV is working in, so it was refused.' };
    let probe = p;
    while (!existsSync(probe)) { if (!forWrite) return { error: 'There is no ' + rel + ' in this folder.' }; probe = dirname(probe); }
    if (!inside(realpathSync(probe))) return { error: 'That path leads outside the folder through a link, so it was refused.' };
    return { p };
  };
  const clip = (s) => { s = String(s || ''); return s.length > CODE_RESULT_MAX ? s.slice(0, CODE_RESULT_MAX) + '\n… (cut, ' + s.length + ' characters in all)' : s; };

  const run = async (name, input) => {
    if (name === 'read_file') {
      const w = place(input.path, false); if (w.error) return { ok: false, text: w.error };
      if (statSync(w.p).isDirectory()) return { ok: false, text: input.path + ' is a folder - use list_dir.' };
      if (statSync(w.p).size > CODE_FILE_MAX) return { ok: false, text: input.path + ' is too large to read whole.' };
      const t = readFileSync(w.p, 'utf8');
      if (t.indexOf('\u0000') >= 0) return { ok: false, text: input.path + ' is not a text file.' };
      return { ok: true, text: t };
    }
    if (name === 'list_dir') {
      const w = place(input.path || '.', false); if (w.error) return { ok: false, text: w.error };
      const ents = readdirSync(w.p, { withFileTypes: true }).slice(0, 500);
      return { ok: true, text: ents.map(e => (e.isDirectory() ? e.name + '/' : e.name)).join('\n') || '(empty)' };
    }
    if (name === 'write_file') {
      const w = place(input.path, true); if (w.error) return { ok: false, text: w.error };
      const content = String(input.content == null ? '' : input.content);
      const was = existsSync(w.p) ? readFileSync(w.p, 'utf8') : null;
      if (was === content) return { ok: true, text: 'No change - ' + input.path + ' already says that.' };
      stdout.write('\n── write ' + relative(root, w.p) + '\n' + changeView(was, content) + '\n');
      if (!allEdits) {
        const a = String((await asker.ask('Write this file? [y/N/a = all writes this session] ')) || '').trim().toLowerCase();
        if (a === 'a') allEdits = true;
        else if (a !== 'y' && a !== 'yes') return { ok: false, text: 'The person said no to writing ' + input.path + '. Do not write it another way.' };
      }
      if (!originals.has(w.p)) originals.set(w.p, was);
      mkdirSync(dirname(w.p), { recursive: true });
      writeFileSync(w.p, content);
      return { ok: true, text: 'Wrote ' + relative(root, w.p) + ' (' + content.length + ' characters).' };
    }
    if (name === 'run_command') {
      const command = String(input.command || '').trim();
      if (!command) return { ok: false, text: 'No command was given.' };
      const a = String((await asker.ask('\n── run in ' + basename(root) + ':\n  ' + command + '\nRun it? [y/N] ')) || '').trim().toLowerCase();
      if (a !== 'y' && a !== 'yes') return { ok: false, text: 'The person said no to running that command. Do not try another way to do the same thing.' };
      const env = Object.assign({}, process.env); delete env.AMV_API_KEY;
      return await new Promise((done) => {
        const t0 = Date.now(); let out = '', err = '', killed = false;
        const child = spawn(command, { shell: true, cwd: root, env });
        const timer = setTimeout(() => { killed = true; child.kill('SIGTERM'); }, CODE_CMD_MS);
        const onAbort = () => { killed = true; child.kill('SIGTERM'); };
        ctrl.signal.addEventListener('abort', onAbort, { once: true });
        child.stdout.on('data', d => { out += d; if (out.length > CODE_RESULT_MAX * 4) out = out.slice(-CODE_RESULT_MAX * 2); });
        child.stderr.on('data', d => { err += d; if (err.length > CODE_RESULT_MAX * 4) err = err.slice(-CODE_RESULT_MAX * 2); });
        child.on('close', (codeN) => {
          clearTimeout(timer); ctrl.signal.removeEventListener('abort', onAbort);
          stdout.write('  exit ' + codeN + (killed ? ' (stopped)' : '') + ' in ' + (Date.now() - t0) + 'ms\n');
          done({ ok: codeN === 0 && !killed, text: 'exit ' + codeN + (killed ? ' (stopped or timed out)' : '') + '\n\nstdout:\n' + clip(out) + '\n\nstderr:\n' + clip(err) });
        });
      });
    }
    return { ok: false, text: 'There is no tool called ' + name + '.' };
  };

  const messages = [{ role: 'user', content: task }];
  const system = CODE_SYS + ' The folder is "' + basename(root) + '".';
  let rounds = 0, why = 'done';
  const write = (t) => stdout.write(t);
  try {
    for (;;) {
      if (ctrl.signal.aborted) { why = 'stopped'; break; }
      if (++rounds > CODE_ROUNDS) { why = 'rounds'; break; }
      const r = await askTools({ base, key, model: o.model, system, maxTokens: o.maxTokens, messages, tools: CODE_TOOLS, onText: write, signal: ctrl.signal });
      const calls = r.content.filter(b => b.type === 'tool_use');
      if (!calls.length) break;
      const results = [];
      for (const c of calls) {
        if (ctrl.signal.aborted) break;
        let res;
        try { res = c.input && c.input._unreadable ? { ok: false, text: 'The tool input could not be read; send it again.' } : await run(c.name, c.input || {}); }
        catch (e) { res = { ok: false, text: 'That did not work: ' + (e && e.message || e) }; }
        results.push(Object.assign({ type: 'tool_result', tool_use_id: c.id, content: clip(res.text) }, res.ok ? {} : { is_error: true }));
      }
      if (ctrl.signal.aborted) { why = 'stopped'; break; }
      messages.push({ role: 'assistant', content: r.content });
      messages.push({ role: 'user', content: results });
    }
  } catch (e) {
    if (e && e.quiet) why = 'stopped';
    else { stderr.write('\namv: ' + e.message + '\n'); why = 'error'; }
  }
  stdout.write('\n');
  if (why === 'rounds') stderr.write('amv: stopped after ' + CODE_ROUNDS + ' rounds - run it again to carry on.\n');
  if (why === 'stopped') stderr.write('amv: stopped.\n');
  if (originals.size) {
    stdout.write('Changed:\n' + [...originals.keys()].map(p => '  ' + relative(root, p) + (originals.get(p) == null ? ' (new)' : '')).join('\n') + '\n');
    const u = String((await asker.ask('Undo all of these? [y/N] ')) || '').trim().toLowerCase();
    if (u === 'y' || u === 'yes') {
      for (const [p, was] of originals) { try { if (was == null) unlinkSync(p); else writeFileSync(p, was); } catch (e) { stderr.write('amv: could not put back ' + relative(root, p) + '\n'); } }
      stdout.write('Put back as they were.\n');
    }
  }
  asker.close();
  return why === 'error' ? 1 : why === 'stopped' ? 130 : 0;
}

/* A conversation. The history lives in this process only: nothing is saved
   to disk, and it is gone when the terminal closes. */
async function chat(o, base, key, stdin, stdout, stderr, ctrl) {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: stdin, output: stdout, terminal: !!stdin.isTTY });
  const history = [];
  const prompt = () => { if (stdin.isTTY) stdout.write('\n> '); };
  stderr.write('AMV chat (' + o.model + '). Ctrl-D or "exit" to end.\n');
  prompt();
  for await (const line of rl) {
    const q = line.trim();
    if (q === 'exit' || q === 'quit') break;
    if (!q) { prompt(); continue; }
    history.push({ role: 'user', content: q });
    try {
      const r = await ask({ base, key, model: o.model, system: o.system, maxTokens: o.maxTokens,
                            messages: history, onText: (t) => stdout.write(t), signal: ctrl.signal });
      history.push({ role: 'assistant', content: r.text });
      stdout.write('\n');
    } catch (e) {
      history.pop();
      if (e.exit === 130) { rl.close(); return 130; }
      stderr.write('amv: ' + e.message + '\n');
    }
    prompt();
  }
  rl.close();
  return 0;
}

/* Run when executed, not when imported (the tests import main). */
let invoked = false;
try { invoked = !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch (e) {}
if (invoked) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
