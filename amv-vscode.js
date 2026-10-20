/* AMV IN VS CODE.

   Ask about the code in front of you, or have AMV change the lines you
   selected. One file, no dependencies, talking to the same /v1/messages the
   command-line tool uses, with an API key from Settings -> API keys.

   THE KEY lives in VS Code's secret storage (the operating system's keychain),
   never in settings.json, which people commit and sync. It is sent only to
   an https address - or to this machine, which is how it is tested.

   NOTHING IS CHANGED WITHOUT A YES. A change is shown as a diff first and
   applied only when the person presses Apply. If the file moved underneath
   while AMV was working, the change is refused rather than pasted over
   somebody's newer edit. After applying, the file is read back, and the
   result says whether it holds what was approved. */
'use strict';
const vscode = require('vscode');

const KEY_SECRET = 'amv.apiKey';
const PLACEHOLDER = '__AMV' + '_API__';   // written as two halves so a download can replace the setting's default only

function cfg() { return vscode.workspace.getConfiguration('amv'); }

/* The server address, checked before a key goes anywhere near it. */
function serverBase() {
  const raw = String(cfg().get('server') || '').trim();
  if (!raw || raw === PLACEHOLDER) throw new Error('Set your AMV server address first: Settings -> Extensions -> AMV -> Server.');
  let u;
  try { u = new URL(raw); } catch (e) { throw new Error('"' + raw + '" is not a web address. Set AMV -> Server to your AMV address.'); }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:'))
    throw new Error('The AMV server must be an https:// address, so your key is never sent unencrypted.');
  return u.origin;
}

async function getKey(context, ask) {
  let key = await context.secrets.get(KEY_SECRET);
  if (!key && ask) {
    key = await vscode.window.showInputBox({
      title: 'AMV API key', prompt: 'Create one in AMV under Settings -> API keys. It is kept in your system keychain.',
      password: true, ignoreFocusOut: true,
      validateInput: (v) => /^amv_sk_[A-Za-z0-9_-]{16,}$/.test(String(v || '').trim()) ? null : 'An AMV key starts with amv_sk_',
    });
    key = key && key.trim();
    if (key) await context.secrets.store(KEY_SECRET, key);
  }
  if (!key) throw new Error('No AMV API key yet. Run "AMV: Set API key".');
  return key;
}

/* What the server said, as a sentence somebody can act on. */
async function refusal(res) {
  let d = {};
  try { d = await res.json(); } catch (e) {}
  if (res.status === 401) return new Error('AMV did not accept this key. It may have been revoked - run "AMV: Set API key" with a new one.');
  const said = d.message || d.error || ('AMV answered ' + res.status + '.');
  if (res.status === 429 || res.status === 503) {
    const wait = Number(res.headers.get('Retry-After') || d.retryAfter || 0);
    return new Error(said + (wait ? ' Try again in ' + wait + ' seconds.' : ''));
  }
  return new Error(String(said));
}

/* One request, streamed. Calls onText as words arrive; returns the whole text. */
async function stream({ base, key, system, messages, onText, signal }) {
  const body = { model: String(cfg().get('model') || 'auto'), max_tokens: Number(cfg().get('maxTokens') || 4096), stream: true, messages };
  if (system) body.system = system;
  let res;
  try {
    res = await fetch(base + '/v1/messages', {
      method: 'POST', signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'User-Agent': 'amv-vscode/1' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (signal && signal.aborted) throw stopped();
    throw new Error('Could not reach ' + base + '. Check the address and your connection.');
  }
  if (!res.ok) throw await refusal(res);
  let text = '', buf = '';
  const dec = new TextDecoder();
  const reader = res.body.getReader();
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
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
          text += ev.delta.text; if (onText) onText(ev.delta.text);
        } else if (ev.type === 'error') {
          throw new Error((ev.error && ev.error.message) || 'The answer stopped with an error.');
        }
      }
    }
  } catch (e) {
    if (signal && signal.aborted) throw stopped();
    throw e;
  }
  return text;
}
function stopped() { const e = new Error('Stopped.'); e.stopped = true; return e; }

/* ── the answer panel ──────────────────────────────────────────────────── */
/* Text only: the answer is put in with textContent, never as HTML, and the
   panel's policy allows exactly one script, its own. */
let panel = null;
/* The webview's Content-Security-Policy admits only scripts carrying this
   value, so it is a security value: from the system's cryptographic source,
   never Math.random, whose next outputs can be worked out from earlier ones. */
function nonce() { return require('crypto').randomBytes(24).toString('base64url'); }
function showPanel(title) {
  if (!panel) {
    panel = vscode.window.createWebviewPanel('amv.answer', 'AMV', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true });
    panel.onDidDispose(() => { panel = null; });
    const n = nonce();
    panel.webview.html = '<!doctype html><html><head><meta charset="utf-8">'
      + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + n + '\';">'
      + '<style>body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);padding:12px 16px;line-height:1.55}'
      + 'h2{font-size:1em;font-weight:600;opacity:.8;margin:0 0 10px}#out{white-space:pre-wrap;word-wrap:break-word;font-family:var(--vscode-editor-font-family)}'
      + '#err{color:var(--vscode-errorForeground);margin-top:10px}</style></head><body><h2 id="t"></h2><div id="out" aria-live="polite"></div><div id="err" role="alert"></div>'
      + '<script nonce="' + n + '">const o=document.getElementById("out"),t=document.getElementById("t"),e=document.getElementById("err");'
      + 'addEventListener("message",ev=>{const m=ev.data||{};if(m.type==="start"){t.textContent=m.title||"";o.textContent="";e.textContent="";}'
      + 'else if(m.type==="text"){o.textContent+=m.text;}else if(m.type==="error"){e.textContent=m.text;}});</script></body></html>';
  }
  panel.reveal(vscode.ViewColumn.Beside, true);
  panel.webview.postMessage({ type: 'start', title });
  return panel;
}

const SYSTEM = 'You are AMV, helping inside the code editor. Be direct and specific to the code shown. '
  + 'Use code blocks for code. Say plainly when something cannot be known from what was shown.';

/* What the editor knows that the question needs: the file, its language, the
   selection or the lines around the cursor, and the problems VS Code reports. */
function editorContext(editor, wholeIfEmpty) {
  if (!editor) return '';
  const doc = editor.document;
  const sel = editor.selection;
  const range = sel && !sel.isEmpty ? sel
    : wholeIfEmpty ? new vscode.Range(0, 0, Math.min(doc.lineCount, 400), 0)
    : new vscode.Range(Math.max(0, sel.active.line - 40), 0, Math.min(doc.lineCount, sel.active.line + 40), 0);
  const code = doc.getText(range).slice(0, 60000);
  const problems = vscode.languages.getDiagnostics(doc.uri)
    .filter(d => !range || range.intersection(d.range))
    .slice(0, 30)
    .map(d => 'line ' + (d.range.start.line + 1) + ': ' + d.message);
  return 'File: ' + vscode.workspace.asRelativePath(doc.uri) + ' (' + doc.languageId + '), lines '
    + (range.start.line + 1) + '-' + (range.end.line + 1) + '\n```' + doc.languageId + '\n' + code + '\n```'
    + (problems.length ? '\nProblems VS Code reports here:\n' + problems.join('\n') : '');
}

async function ask(context, question, withContext, title) {
  const base = serverBase();
  const key = await getKey(context, true);
  const p = showPanel(title || question.slice(0, 80));
  const content = withContext ? question + '\n\n' + withContext : question;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'AMV is answering', cancellable: true }, async (_p, token) => {
    const ctrl = new AbortController();
    token.onCancellationRequested(() => ctrl.abort());
    try {
      await stream({ base, key, system: SYSTEM, messages: [{ role: 'user', content }], signal: ctrl.signal,
        onText: (t) => { if (panel) p.webview.postMessage({ type: 'text', text: t }); } });
    } catch (e) {
      if (panel) p.webview.postMessage({ type: 'error', text: e.message });
      if (!e.stopped) throw e;
    }
  });
}

/* The code inside the first fenced block, or the whole answer if there is none. */
function codeFrom(answer) {
  const m = String(answer || '').match(/```[^\n]*\n([\s\S]*?)\n?```/);
  return m ? m[1] : String(answer || '').trim();
}

async function editSelection(context) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) throw new Error('Select the code you want AMV to change first.');
  const doc = editor.document;
  const range = new vscode.Range(editor.selection.start, editor.selection.end);
  const before = doc.getText(range);
  const version = doc.version;
  const instruction = await vscode.window.showInputBox({ title: 'Change the selection', prompt: 'What should AMV do to these lines?', ignoreFocusOut: true });
  if (!instruction) return;
  const base = serverBase();
  const key = await getKey(context, true);

  const answer = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'AMV is writing the change', cancellable: true }, async (_p, token) => {
    const ctrl = new AbortController();
    token.onCancellationRequested(() => ctrl.abort());
    return await stream({ base, key, signal: ctrl.signal,
      system: SYSTEM + ' You are rewriting a selection. Reply with ONLY the replacement for the selected lines, in one fenced code block, '
        + 'keeping the indentation style. No explanation outside the block.',
      messages: [{ role: 'user', content: 'Instruction: ' + instruction + '\n\nSelected lines to replace:\n' + editorContext(editor, false) }] });
  }).catch(e => { if (e && e.stopped) return null; throw e; });
  if (answer == null) return;
  const after = codeFrom(answer);
  if (!after || after === before) { vscode.window.showInformationMessage('AMV suggested no change to those lines.'); return; }

  /* Shown before anything happens. */
  const left = await vscode.workspace.openTextDocument({ content: before, language: doc.languageId });
  const right = await vscode.workspace.openTextDocument({ content: after, language: doc.languageId });
  await vscode.commands.executeCommand('vscode.diff', left.uri, right.uri, 'AMV: proposed change to ' + vscode.workspace.asRelativePath(doc.uri));
  const pick = await vscode.window.showInformationMessage('Apply AMV’s change to ' + vscode.workspace.asRelativePath(doc.uri) + '?', { modal: true }, 'Apply', 'Discard');
  if (pick !== 'Apply') { vscode.window.showInformationMessage('Nothing was changed.'); return; }

  /* The file must still be what the change was written against. */
  if (doc.version !== version || doc.getText(range) !== before)
    throw new Error('The file changed while AMV was working, so the change was not applied. Run it again on the current code.');
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, range, after);
  const applied = await vscode.workspace.applyEdit(edit);
  /* Read back: the lines now in the file, from where the change started. */
  const endPos = doc.positionAt(doc.offsetAt(range.start) + after.length);
  const now = doc.getText(new vscode.Range(range.start, endPos));
  if (!applied || now !== after) throw new Error('VS Code did not apply the change as approved. Check the file - nothing else was touched.');
  vscode.window.showInformationMessage('Applied. Undo (Ctrl/Cmd+Z) puts the old lines back.');
}

function activate(context) {
  const run = (fn) => async (...a) => {
    try { await fn(...a); }
    catch (e) { vscode.window.showErrorMessage('AMV: ' + ((e && e.message) || 'that did not work.')); }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('amv.setKey', run(async () => {
      await context.secrets.delete(KEY_SECRET);
      await getKey(context, true);
      vscode.window.showInformationMessage('AMV key saved in your system keychain.');
    })),
    vscode.commands.registerCommand('amv.signOut', run(async () => {
      await context.secrets.delete(KEY_SECRET);
      vscode.window.showInformationMessage('AMV key forgotten on this computer.');
    })),
    vscode.commands.registerCommand('amv.ask', run(async () => {
      const q = await vscode.window.showInputBox({ title: 'Ask AMV', prompt: 'About the file you have open, or anything else', ignoreFocusOut: true });
      if (!q) return;
      await ask(context, q, editorContext(vscode.window.activeTextEditor, false), q);
    })),
    vscode.commands.registerCommand('amv.askSelection', run(async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed || ed.selection.isEmpty) throw new Error('Select some code first.');
      const q = await vscode.window.showInputBox({ title: 'Ask AMV about the selection', value: 'Explain this code.', ignoreFocusOut: true });
      if (!q) return;
      await ask(context, q, editorContext(ed, false), q);
    })),
    vscode.commands.registerCommand('amv.editSelection', run(() => editSelection(context))),
    vscode.commands.registerCommand('amv.explainProblems', run(async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) throw new Error('Open a file first.');
      if (!vscode.languages.getDiagnostics(ed.document.uri).length) { vscode.window.showInformationMessage('VS Code reports no problems in this file.'); return; }
      await ask(context, 'Explain each problem below and how to fix it.', editorContext(ed, true), 'Problems in ' + vscode.workspace.asRelativePath(ed.document.uri));
    })),
  );
}
function deactivate() {}

module.exports = { activate, deactivate, _test: { serverBase, codeFrom, stream, nonce } };
