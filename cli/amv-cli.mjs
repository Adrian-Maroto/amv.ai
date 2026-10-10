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

   THE KEY IS READ FROM THE ENVIRONMENT AND NOWHERE ELSE. Not a flag: a key on
   the command line is in the shell's history and in every process listing
   on the machine, and there is no way to take it back out of either. */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_API = '__AMV_API__';
const VERSION = '1';
const ENGINES = ['auto', 'amv-pulse', 'amv-core', 'amv-swift', 'amv-forge', 'amv-apex'];

const HELP = `amv - ask AMV from a terminal

  amv "your question"            answer streams as it is written
  some-command | amv "what to do with it"
                                 what is piped in is sent along with the question
  amv chat                       a conversation; Ctrl-D or "exit" to end

Options
  -m, --model NAME     ${ENGINES.join(', ')} (default auto)
  -s, --system TEXT    instructions for this request
  -t, --max-tokens N   longest answer, in tokens (default 4096)
      --json           print one JSON object when done: text, model, usage, stop_reason
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
    else if (a === '--api') o.api = val();
    else if (/^--?(key|api-key|token)(=|$)/.test(a)) throw usage('the key is never taken on the command line, where it would be saved in your shell history. Set AMV_API_KEY instead.');
    else if (a === '--') { o.words.push(...argv.slice(i + 1)); break; }
    else if (/^-/.test(a) && a !== '-') throw usage('unknown option ' + a);
    else o.words.push(a);
  }
  if (o.words[0] === 'chat' && o.words.length === 1) { o.chat = true; o.words = []; }
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

    const piped = await readStdin(stdin);
    if (piped.length > PIPED_MAX) { stderr.write('amv: what was piped in is over ' + PIPED_MAX + ' characters; send a smaller part.\n'); return 2; }
    const q = o.words.join(' ').trim();
    if (!q && !piped.trim()) { stderr.write('amv: nothing to ask. Try: amv "your question"   (or amv --help)\n'); return 2; }
    const content = piped.trim() ? (q ? q + '\n\n' + piped : piped) : q;

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
