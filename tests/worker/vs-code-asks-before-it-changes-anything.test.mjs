/* VS CODE ASKS BEFORE IT CHANGES ANYTHING.

   The extension (vscode/extension.js) is driven here with a stand-in for the
   editor's API and a real local server speaking AMV's event stream, so what
   is asserted is what reached the server and what ended up in the file:

     the key goes only to an https address (or this machine), and only from
     the system keychain - never into settings;
     an answer streams into the panel as it is written, and the question
     carries the code that was selected and the problems VS Code reports;
     a change is shown first and applied only on Apply - Discard leaves the
     file exactly as it was, and so does a file edited while AMV worked;
     a key the server refuses is reported as a key problem. */
import { createRequire } from 'module';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Module from 'module';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const require = createRequire(import.meta.url);

/* ── a small editor ─────────────────────────────────────────────────────── */
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (a instanceof Position) { this.start = a; this.end = b; }
    else { this.start = new Position(a, b); this.end = new Position(c, d); }
  }
  get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; }
  intersection(o) { return (o.end.line < this.start.line || o.start.line > this.end.line) ? undefined : o; }
}
function mkDoc(text, lang) {
  const d = {
    text, version: 1, languageId: lang || 'javascript', uri: { fsPath: '/work/app.js', toString: () => 'file:///work/app.js' },
    get lineCount() { return d.text.split('\n').length; },
    offsetAt(p) { const ls = d.text.split('\n'); let o = 0; for (let i = 0; i < Math.min(p.line, ls.length); i++) o += ls[i].length + 1; return Math.min(d.text.length, o + p.character); },
    positionAt(o) { const before = d.text.slice(0, o).split('\n'); return new Position(before.length - 1, before[before.length - 1].length); },
    getText(r) { return r ? d.text.slice(d.offsetAt(r.start), d.offsetAt(r.end)) : d.text; },
  };
  return d;
}
const state = { key: null, inputs: [], pick: 'Apply', posted: [], errors: [], infos: [], configWrites: 0, diffs: 0, beforeApply: null };
let doc = mkDoc('function add(a, b) {\n  return a - b;\n}\n');
const editor = { document: doc, selection: new Range(1, 0, 1, 15) };
const commands = {};
const vscodeMock = {
  Position, Range, ViewColumn: { Beside: 2 }, ProgressLocation: { Notification: 15 },
  WorkspaceEdit: class { constructor() { this.edits = []; } replace(uri, range, text) { this.edits.push({ uri, range, text }); } },
  workspace: {
    getConfiguration: () => ({ get: (k) => ({ server: state.server, model: 'auto', maxTokens: 4096 })[k], update: () => { state.configWrites++; } }),
    asRelativePath: () => 'app.js',
    openTextDocument: async (o) => ({ uri: { o }, getText: () => o.content }),
    applyEdit: async (we) => {
      if (state.beforeApply) state.beforeApply();
      for (const e of we.edits) { const a = doc.offsetAt(e.range.start), b = doc.offsetAt(e.range.end); doc.text = doc.text.slice(0, a) + e.text + doc.text.slice(b); doc.version++; }
      return true;
    },
  },
  window: {
    get activeTextEditor() { return editor; },
    showInputBox: async () => state.inputs.shift(),
    showInformationMessage: async (m, opts, ...items) => { state.infos.push(m); return items.length ? state.pick : undefined; },
    showErrorMessage: async (m) => { state.errors.push(m); },
    withProgress: async (_o, fn) => fn({}, { onCancellationRequested() {} }),
    createWebviewPanel: () => ({ webview: { html: '', postMessage: (m) => { state.posted.push(m); } }, reveal() {}, onDidDispose() {} }),
  },
  commands: {
    registerCommand: (id, fn) => { commands[id] = fn; return { dispose() {} }; },
    executeCommand: async (id) => { if (id === 'vscode.diff') state.diffs++; },
  },
  languages: { getDiagnostics: () => [{ range: new Range(1, 2, 1, 14), message: 'add() subtracts' }] },
};
const realLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'vscode' ? vscodeMock : realLoad.call(this, req, ...rest); };
const ext = require(join(ROOT, 'vscode', 'extension.js'));
const context = { subscriptions: [], secrets: {
  get: async () => state.key, store: async (_k, v) => { state.key = v; }, delete: async () => { state.key = null; } } };
ext.activate(context);

/* ── a server speaking AMV's stream ─────────────────────────────────────── */
const seen = [];
let reply = 'Looks fine.', status = 200;
const srv = createServer((q, s) => {
  let b = ''; q.on('data', c => b += c); q.on('end', () => {
    seen.push({ auth: q.headers.authorization, body: JSON.parse(b || '{}') });
    if (status !== 200) { s.writeHead(status, { 'Content-Type': 'application/json' }); s.end(JSON.stringify({ error: 'unauthorized' })); return; }
    s.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const half = Math.ceil(reply.length / 2);
    for (const part of [reply.slice(0, half), reply.slice(half)])
      s.write('event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: part } }) + '\n\n');
    s.end('data: ' + JSON.stringify({ type: 'message_stop' }) + '\n\n');
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const LOCAL = 'http://127.0.0.1:' + srv.address().port;
const KEY = 'amv_sk_' + 'x'.repeat(30);

section('The webview\u2019s script nonce comes from the cryptographic source');
{
  /* The panel's CSP admits only scripts carrying this value. With Math.random
     pinned to one number, a nonce built from it would repeat; one from the
     system's cryptographic source does not. */
  const real = Math.random;
  Math.random = () => 0.5;
  const a = ext._test.nonce(), b = ext._test.nonce();
  Math.random = real;
  ok(a !== b && /^[A-Za-z0-9_-]{32,}$/.test(a), 'two nonces differ even with Math.random pinned, and are long', [a, b]);
}

section('The key goes only to a safe address, and only from the keychain');
{
  const t = ext._test;
  const err = (s) => { state.server = s; try { t.serverBase(); return ''; } catch (e) { return e.message; } };
  ok(/https/.test(err('http://amv.example.com')), 'a plain http server is refused', err('http://amv.example.com'));
  ok(/Set your AMV server/.test(err('__AMV' + '_API__')), 'an extension never given an address says so', err('__AMV' + '_API__'));
  ok(err('https://amv.example.com') === '' && err(LOCAL) === '', 'https, and this machine for testing, are accepted', true);
  state.server = LOCAL;
  state.inputs = [KEY];
  await commands['amv.setKey']();
  ok(state.key === KEY, 'the key is stored in the system keychain', !!state.key);
  ok(state.configWrites === 0, 'and never written to settings', state.configWrites);
}

section('An answer streams in, and the question carries the code and its problems');
{
  state.posted = []; seen.length = 0; reply = 'It subtracts instead of adding.';
  state.inputs = ['What is wrong here?'];
  await commands['amv.askSelection']();
  ok(seen.length === 1 && seen[0].auth === 'Bearer ' + KEY, 'one request, with the key as a bearer token', seen.map(s => s.auth && s.auth.slice(0, 14)));
  const content = seen[0] && seen[0].body.messages[0].content;
  ok(/return a - b;/.test(content) && /add\(\) subtracts/.test(content) && seen[0].body.stream === true,
     'the selected line and the reported problem went with it, streamed', content);
  const texts = state.posted.filter(m => m.type === 'text').map(m => m.text);
  ok(texts.length === 2 && texts.join('') === reply, 'and the panel received it piece by piece', texts);
}

section('A change is shown first, and Discard changes nothing');
{
  const before = doc.text;
  reply = '```js\n  return a + b;\n```';
  state.pick = 'Discard'; state.diffs = 0; state.inputs = ['fix the bug'];
  await commands['amv.editSelection']();
  ok(state.diffs === 1, 'the diff was shown', state.diffs);
  ok(doc.text === before, 'Discard left the file exactly as it was', doc.text);
}

section('Apply changes only the selected lines, and is read back');
{
  state.pick = 'Apply'; state.inputs = ['fix the bug']; state.errors = []; state.infos = [];
  await commands['amv.editSelection']();
  ok(doc.text === 'function add(a, b) {\n  return a + b;\n}\n', 'the selection was replaced and nothing else', doc.text);
  ok(state.errors.length === 0 && state.infos.some(m => /^Applied/.test(m)), 'and it says so', [state.errors, state.infos.slice(-1)]);
}

section('A file edited while AMV worked is not pasted over');
{
  doc = mkDoc('let x = 1;\nlet y = 2;\n'); editor.document = doc; editor.selection = new Range(0, 0, 0, 10);
  reply = '```js\nlet x = 100;\n```';
  state.pick = 'Apply'; state.errors = [];
  /* The person types while the answer is being written. */
  state.inputs = ['make it bigger'];
  const origWith = vscodeMock.window.withProgress;
  vscodeMock.window.withProgress = async (o, fn) => { const r = await fn({}, { onCancellationRequested() {} }); doc.text = 'let x = 2;\nlet y = 2;\n'; doc.version++; return r; };
  await commands['amv.editSelection']();
  vscodeMock.window.withProgress = origWith;
  ok(doc.text === 'let x = 2;\nlet y = 2;\n', 'the newer edit is kept', doc.text);
  ok(state.errors.some(m => /changed while AMV was working/.test(m)), 'and the person is told why nothing was applied', state.errors);
}

section('A refused key is reported as a key problem');
{
  status = 401; state.errors = []; state.inputs = ['anything'];
  await commands['amv.ask']();
  ok(state.errors.some(m => /did not accept this key/.test(m)), 'it says the key was not accepted', state.errors);
  status = 200;
}

srv.close();
Module._load = realLoad;
if (report('vs-code-asks-before-it-changes-anything') > 0) process.exitCode = 1;
done();
