/* ══════════════════════════════════════════════════════════════════════
   THE BRIDGE, FROM AMV'S SIDE.

   AMV could write code and never run it. The page is a browser tab and
   the server is a Worker; neither can spawn a process, install a package
   or hold a filesystem, so every capability from "install the
   dependencies" through "deploy the backend" was waiting on a machine
   that did not exist.

   The bridge is that machine: a small program somebody runs themselves,
   in the folder they want AMV to work in. This file is how AMV finds it,
   pairs with it once, and then uses it.

   WHAT THIS DELIBERATELY DOES NOT DO. It does not scan for the bridge on
   a timer, and it does not try a range of ports looking for one. Both
   would make AMV a program that quietly probes your machine, which is
   what everybody rightly hates about software that does this. The port
   comes from the person, once, off the screen the bridge prints - and
   then it is remembered.
   ══════════════════════════════════════════════════════════════════════ */

const BRIDGE = {
  port: 0,
  token: '',
  folder: '',
  root: '',
  connected: false,
  /* The last thing that went wrong, so the surface can say which of the
     several different problems this is rather than "not connected". */
  why: '',
};
try{ window.BRIDGE = BRIDGE; }catch(e){}

const _bridgeBase = (port) => 'http://127.0.0.1:' + (port || BRIDGE.port);

/* Restored on load. The token is a capability - anything holding it can run
   commands in that folder - so it lives in sessionStorage rather than
   localStorage: closing the tab ends it, which matches the bridge itself,
   which ends when its window is closed. */
function _bridgeRestore(){
  try{
    const raw = sessionStorage.getItem('amv_bridge');
    if(!raw) return;
    const s = JSON.parse(raw);
    if(s && s.port && s.token){ Object.assign(BRIDGE, s, { connected: true, why: '' }); }
  }catch(e){}
}
function _bridgeRemember(){
  try{
    sessionStorage.setItem('amv_bridge', JSON.stringify({
      port: BRIDGE.port, token: BRIDGE.token, folder: BRIDGE.folder, root: BRIDGE.root }));
  }catch(e){}
}
function _bridgeForget(){
  BRIDGE.port = 0; BRIDGE.token = ''; BRIDGE.folder = ''; BRIDGE.root = '';
  BRIDGE.connected = false;
  try{ sessionStorage.removeItem('amv_bridge'); }catch(e){}
  /* The connectors ran on that machine, so they are gone with it. Leaving
     them listed as live would offer the model tools whose every call fails,
     which teaches it to stop trying and tells the person AMV is broken. */
  try{ if(typeof MCP !== 'undefined') MCP.live = {}; }catch(e){}
}
try{ window._bridgeForget=_bridgeForget; }catch(e){}

/* ── DISCONNECTING, WHICH USED TO MEAN "THIS TAB FORGETS" ──────────────────

   `_bridgeForget` clears the browser's copy and makes no request. On its own
   that is not a disconnect: the daemon kept the session valid, kept running
   connectors alive, and kept accepting work from anything that still held that
   token from an allowed origin - while the screen said disconnected.

   So the daemon is told first, and the browser state is cleared EITHER WAY.
   Clearing only on success would leave somebody paired in a tab they had
   already told to disconnect, which is worse than the thing being fixed.

   What is returned is which of the two actually happened, because they are
   different facts and only one of them is what the button promises. A caller
   that cannot reach the daemon has disconnected locally and left a machine
   with a live session on it, and saying so is the only honest option: the page
   cannot revoke a token it can no longer talk to. */
async function bridgeDisconnect(){
  /* NOT called `base`. The gate's route-coverage stage reads every
     `base + '/path'` in this bundle as a path the WORKER must answer, and a
     local named `base` here made `/amv-bridge/revoke` look like a Worker route
     that does not exist. It is the daemon's, on a different server, so the
     variable says which server it is. */
  const daemon = BRIDGE.connected ? _bridgeBase() : '';
  const token = BRIDGE.token;
  let revoked = false, stopped = null, why = '';
  if(daemon && token){
    try{
      const r = await fetchDeadline(daemon + '/amv-bridge/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AMV-Bridge-Token': token },
        body: '{}',
      }, 6000);
      const d = await r.json().catch(()=>({}));
      /* A token the daemon has already forgotten is not a failure to revoke -
         there is nothing left to revoke, which is the state being asked for. */
      if(r.ok && d.revoked) { revoked = true; stopped = d.stopped || null; }
      else if(r.status === 401) revoked = true;
      else why = String(d.error || ('the bridge answered ' + r.status));
    }catch(e){
      why = 'the bridge could not be reached';
    }
  }
  _bridgeForget();
  return { revoked, stopped, why };
}
try{ window.bridgeDisconnect=bridgeDisconnect; }catch(e){}

/* Is a bridge listening on this port, and what folder is it holding? The one
   call that works before pairing, so somebody can be told what they are about
   to connect to before they connect to it. */
async function _bridgeHello(port){
  try{
    const r = await fetchDeadline(_bridgeBase(port) + '/amv-bridge/hello', {}, 4000);
    if(!r.ok) return null;
    const d = await r.json();
    return d && d.bridge ? d : null;
  }catch(e){ return null; }
}
try{ window._bridgeHello=_bridgeHello; }catch(e){}

/* Pair once, with the code the bridge printed. */
async function _bridgePair(port, code){
  const r = await fetchDeadline(_bridgeBase(port) + '/amv-bridge/pair', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: String(code || '').trim().toUpperCase() }),
  }, 8000);
  if(r.status === 403){
    const d = await r.json().catch(()=>({}));
    throw new Error(d.error === 'origin_not_allowed'
      ? 'That bridge will not accept connections from this address.'
      : 'That code did not match. Check the one in your terminal - it changes each time the bridge starts.');
  }
  if(!r.ok) throw new Error('Could not pair with the bridge on port ' + port + '.');
  const d = await r.json();
  BRIDGE.port = Number(port); BRIDGE.token = d.token;
  BRIDGE.folder = d.folder || ''; BRIDGE.root = d.root || '';
  BRIDGE.connected = true; BRIDGE.why = '';
  _bridgeRemember();
  return BRIDGE;
}
try{ window._bridgePair=_bridgePair; }catch(e){}

/* Every call after pairing. Failures are named rather than flattened,
   because "the bridge is not running", "this tab is not paired" and "the
   command was refused" have three different fixes and telling somebody the
   wrong one sends them to restart something that is fine. */
async function _bridgeCall(route, body, timeoutMs){
  if(!BRIDGE.connected) throw new Error('No computer is connected. Run the AMV bridge in your project folder, then connect it here.');
  let r;
  try{
    r = await fetchDeadline(_bridgeBase() + '/amv-bridge/' + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json',
                                 'X-AMV-Bridge-Token': BRIDGE.token },
      body: JSON.stringify(body || {}),
    }, timeoutMs || 130000);
  }catch(e){
    BRIDGE.connected = false; BRIDGE.why = 'unreachable';
    throw new Error('The bridge stopped answering. It may have been closed - start it again and reconnect.');
  }
  if(r.status === 401){
    /* The bridge restarted, so its token changed. Saying "reconnect" is the
       whole answer here and it is worth being exact about, because the
       symptom looks identical to it not running. */
    _bridgeForget(); BRIDGE.why = 'stale';
    throw new Error('The bridge restarted, so this tab is no longer paired with it. Connect it again with the new code.');
  }
  const d = await r.json().catch(()=>({}));
  if(r.status === 403 && d.error === 'refused'){
    throw new Error('The bridge refused that command: it looks like ' + d.reason + '. That rule lives on your machine, not in AMV.');
  }
  if(r.status === 403 && d.error === 'outside_root'){
    throw new Error('That path is outside the folder the bridge was started in, so it is not AMV’s to touch.');
  }
  if(!r.ok){
    const err = new Error(d.message || d.error || 'The bridge could not do that.');
    /* THE MACHINE-READABLE HALF, carried rather than left in the prose.

       Callers need to tell one refusal from another - `bridgeRead` has to know
       "not there" from "could not read it", and matching on a sentence is how
       that breaks the first time the wording changes. Same reason the API
       client carries `code` off the worker. */
    if(d.error) err.code = String(d.error);
    err.status = r.status;
    throw err;
  }
  return d;
}

async function bridgeExec(command, opts){
  opts = opts || {};
  return await _bridgeCall('exec', { command, cwd: opts.cwd || '.', timeout: opts.timeout },
                           (opts.timeout || 120000) + 8000);
}
/* A missing file answers `null` rather than throwing, and EVERY other failure
   still throws. That distinction is load-bearing: the build agent decides
   whether it is creating a file or editing one from this call, and a caller
   that cannot tell "not there" from "could not read it" will treat a transient
   failure as a new file - write without keeping a backup, record the path as
   created, and let Undo delete it. See `_agentRunTool`. */
async function bridgeRead(path){
  try{ return await _bridgeCall('read', { path }, 20000); }
  catch(e){
    if(e && e.code === 'not_found') return null;
    throw e;
  }
}
async function bridgeWrite(path, content){ return await _bridgeCall('write', { path, content }, 20000); }
async function bridgeList(path){ return await _bridgeCall('list', { path: path || '.' }, 15000); }
/* Only Undo calls this, and only for a file the turn it is undoing created.
   It is deliberately NOT offered to the model: nothing about building needs
   to delete somebody's file, and a tool that can is a tool that will. */
async function bridgeDelete(path){ return await _bridgeCall('delete', { path }, 20000); }
try{ window.bridgeExec=bridgeExec; window.bridgeRead=bridgeRead;
     window.bridgeWrite=bridgeWrite; window.bridgeList=bridgeList;
     window.bridgeDelete=bridgeDelete; }catch(e){}

/* ── THE TOOLS THE MODEL GETS ─────────────────────────────────────────────
   Offered ONLY while a bridge is connected. A tool that is always present
   and always fails teaches the model to stop trying it, and teaches the
   person that AMV is broken; a tool that appears when the machine does is
   the honest shape.

   `run_command` carries the warning in its own description, because the
   model reads that on every turn and it is the one place a rule about
   destructive work is guaranteed to be in front of it. The daemon refuses
   the catastrophic shapes regardless - this is the belt, that is the
   braces. */
const BRIDGE_TOOLS = [
  {
    name: 'run_command',
    description: 'Run a shell command on the user\'s own computer, in their project folder, and get back stdout, stderr and the exit code. Use this to install dependencies, run builds, run tests, start and stop things, inspect logs, and use git. Prefer the smallest command that answers the question. Anything destructive or irreversible is refused by the bridge itself.',
    input_schema: { type:'object', properties:{
      command:{ type:'string', description:'The shell command, exactly as it would be typed.' },
      cwd:{ type:'string', description:'Folder to run in, relative to the project root. Defaults to the root.' },
      timeout:{ type:'number', description:'Milliseconds before it is killed. Default 120000.' },
    }, required:['command'] },
  },
  {
    name: 'read_file',
    description: 'Read a file from the user\'s project folder on their computer. Use before editing, so a change is made against what is really there rather than what was assumed.',
    input_schema: { type:'object', properties:{
      path:{ type:'string', description:'Path relative to the project root.' },
    }, required:['path'] },
  },
  {
    name: 'write_file',
    description: 'Write a file in the user\'s project folder on their computer, creating folders as needed. Writes the WHOLE file - read it first and include everything that should stay.',
    input_schema: { type:'object', properties:{
      path:{ type:'string', description:'Path relative to the project root.' },
      content:{ type:'string', description:'The complete file contents.' },
    }, required:['path','content'] },
  },
  {
    name: 'list_dir',
    description: 'List what is in a folder of the user\'s project. Use to find your way around a repository before assuming its layout.',
    input_schema: { type:'object', properties:{
      path:{ type:'string', description:'Path relative to the project root. Defaults to the root.' },
    }, required:[] },
  },
];
try{ window.BRIDGE_TOOLS = BRIDGE_TOOLS; }catch(e){}

/* Run one of them. Errors come back as a RESULT rather than being thrown,
   because a failed command is information the model should reason about -
   a missing package, a failing test - and not a reason to end the turn. */
async function runBridgeTool(name, args){
  args = args || {};
  try{
    if(name === 'run_command'){
      const r = await bridgeExec(String(args.command||''), { cwd: args.cwd, timeout: args.timeout });
      return { ok: r.exitCode === 0, exitCode: r.exitCode, timedOut: !!r.timedOut,
               ms: r.ms, stdout: r.stdout || '', stderr: r.stderr || '',
               truncated: !!r.truncated };
    }
    if(name === 'read_file')  return await bridgeRead(String(args.path||''));
    if(name === 'write_file') return await bridgeWrite(String(args.path||''), String(args.content||''));
    if(name === 'list_dir')   return await bridgeList(String(args.path||'.'));
  }catch(e){
    return { ok:false, error: String(e.message||e) };
  }
  return { ok:false, error: 'unknown bridge tool: ' + name };
}
try{ window.runBridgeTool=runBridgeTool; }catch(e){}

try{ _bridgeRestore(); }catch(e){}

/* ══════════════════════════════════════════════════════════════════════
   THE DOOR: connecting a computer, in Settings.

   Deliberately not a button that goes looking. AMV does not scan ports
   and does not probe for a bridge, because software that quietly pokes
   around your machine is the thing everybody is right to hate. The port
   and the code both come off the screen the bridge printed, typed once,
   by the person who started it.
   ══════════════════════════════════════════════════════════════════════ */
function _bridgeCardHTML(){
  if(BRIDGE.connected){
    return '<div class="brg brg-on">'
      + '<div class="brg-h"><span class="brg-dot" aria-hidden="true"></span>'
        + '<b>This computer is connected</b></div>'
      /* WHAT IT SAYS HAS TO BE WHAT HAPPENS. This said "Every command asks
         you first", which was true when the only caller was chat and stopped
         being true the moment Build could work on its own: there, permission
         is asked once for the whole request, by name, before anything runs.
         A card that describes the old behaviour is worse than one that says
         nothing, because somebody reads it and stops watching. */
      + '<p class="brg-p">AMV reads and writes files in '
        + '<code>' + escH(BRIDGE.folder || 'your project folder') + '</code> '
        + 'and nowhere else. Commands run there as you, so a command can reach '
        + 'anything you can - the bridge prints every one in its terminal. In '
        + 'chat AMV asks before each one. In Build it asks once for the whole '
        + 'request, and you can stop it at any point.</p>'
      + '<div class="brg-acts">'
        + '<button class="btn bs" id="brg-off" type="button">Disconnect</button>'
      + '</div></div>';
  }
  /* THREE STEPS, BECAUSE IT REALLY IS THREE STEPS.

     This used to name one command, `npx amv-bridge`, which nobody has
     published - so for everybody who had not cloned the repository it
     failed, which is the one group the card exists for. The file now travels
     inside AMV and is handed over directly.

     Downloading and running are deliberately two steps rather than one
     pipe. The bridge itself refuses `curl … | sh` as a shape; telling people
     to do it to install the thing that refuses it would be teaching the
     habit while claiming to forbid it. It is a small file, it is readable,
     and anybody who wants to look at it before running it should be able to. */
  return '<div class="brg">'
    + '<div class="brg-h"><b>Connect this computer</b></div>'
    /* THE SENTENCE SOMEBODY READS WHILE DECIDING. It said "It works only in
       the folder you point it at", and the file routes do - /read refuses a
       path outside the root. Commands do not: /exec is a real shell with the
       folder as its working directory, and `cat ../secret` came back with the
       secret. Granting a shell is the decision being made here, so the card
       has to describe a shell. */
    + '<p class="brg-p">So AMV can actually run your project instead of only writing it: '
      + 'install packages, run the tests, start the server, use git. Files stay in '
      + 'the folder you point it at; commands run there as you, the way they would '
      + 'if you typed them. It stops when you close it.</p>'
    + '<ol class="brg-steps">'
      + '<li><span>Get the bridge. It is one small file with no dependencies, and '
        + 'you can read it before you run it.</span>'
        + '<button class="btn bs brg-dl" id="brg-dl" type="button">Download amv-bridge.mjs</button></li>'
      + '<li><span>Run it in the folder you want AMV to work in. You need Node.</span>'
        + '<code class="brg-cmd">node amv-bridge.mjs</code></li>'
      + '<li><span>It prints a port and a code. Put them here.</span></li>'
    + '</ol>'
    + '<div class="brg-form">'
      + '<label class="brg-l" for="brg-port">Port</label>'
      + '<input class="brg-i" id="brg-port" inputmode="numeric" autocomplete="off" placeholder="e.g. 51734">'
      + '<label class="brg-l" for="brg-code">Code</label>'
      + '<input class="brg-i brg-i-wide" id="brg-code" autocomplete="off" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX">'
      + '<button class="btn bp" id="brg-go" type="button">Connect</button>'
    + '</div>'
    + '<div class="brg-msg" id="brg-msg" role="status" aria-live="polite"></div>'
    + '</div>';
}
try{ window._bridgeCardHTML=_bridgeCardHTML; }catch(e){}

/* HANDING OVER THE FILE.

   Fetched from AMV's own origin rather than carried in the page. The first
   version embedded it as base64 and the page-weight ceiling refused it: a
   file only developers download should not be paid for by every visitor.

   It is checked before it is handed over. A host that answers an unknown
   path with index.html - which plenty do - would otherwise save somebody a
   web page called amv-bridge.mjs, and they would run it, and node would
   throw something incomprehensible about a `<` character. Saying "AMV could
   not fetch it, here is where it lives" is the honest answer and it takes
   one line to check. */
const BRIDGE_FILE = 'amv-bridge.mjs';
const BRIDGE_REPO = 'https://github.com/adrian-maroto/amv.ai/blob/main/bridge/amv-bridge.mjs';

async function _bridgeFetchSource(){
  const r = await fetchDeadline(BRIDGE_FILE, { cache: 'no-store' }, 15000);
  if(!r.ok) throw new Error('http_' + r.status);
  const text = await r.text();
  /* It has to BE the daemon, not whatever the host decided to answer with. */
  if(!/^#!\/usr\/bin\/env node/.test(text) || !/ALLOWED_ORIGINS/.test(text)){
    throw new Error('not_the_bridge');
  }
  return text;
}
async function _bridgeDownload(){
  let text;
  try{ text = await _bridgeFetchSource(); }
  catch(e){
    try{ toast('AMV could not fetch the bridge from this deployment. You can get it from the AMV repository, under bridge/amv-bridge.mjs.', 'error', 8000); }catch(x){}
    return false;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  const a = document.createElement('a');
  a.href = url; a.download = BRIDGE_FILE;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => { try{ URL.revokeObjectURL(url); }catch(e){} }, 4000);
  return true;
}
try{ window._bridgeFetchSource=_bridgeFetchSource; window._bridgeDownload=_bridgeDownload;
     window.BRIDGE_FILE=BRIDGE_FILE; }catch(e){}

function _bridgeWireCard(root){
  root = root || document;
  const dl = root.querySelector('#brg-dl');
  if(dl) on(dl, 'click', async () => {
    dl.disabled = true;
    try{
      if(await _bridgeDownload()){
        try{ toast('Saved amv-bridge.mjs. Run it with "node amv-bridge.mjs" in your project folder.', 'success', 6000); }catch(e){}
      }
    } finally { dl.disabled = false; }
  });
  const off = root.querySelector('#brg-off');
  if(off) on(off, 'click', async () => {
    off.disabled = true;
    let r = { revoked:false, why:'' };
    try{ r = await bridgeDisconnect(); }
    finally{ off.disabled = false; }
    /* SAY WHICH OF THE TWO HAPPENED.

       "Disconnected. AMV can no longer reach that folder." was the only
       sentence, and it was said whether or not the daemon had been told
       anything - which was the defect, in words. A machine that still holds a
       live session is a different situation from one that has ended it, and
       the person is the only one who can act on the difference (by closing the
       bridge window themselves). */
    try{
      if(r.revoked){
        const s = r.stopped || {};
        const extra = (s.jobs || s.servers)
          ? ' ' + (s.jobs || 0) + ' command' + (s.jobs === 1 ? '' : 's')
            + ' and ' + (s.servers || 0) + ' connector' + (s.servers === 1 ? '' : 's') + ' stopped.'
          : '';
        toast('Disconnected. The bridge ended the session on your computer.' + extra, 'info', 5000);
      } else {
        toast('Disconnected here, but AMV could not reach the bridge to end the session on your computer'
              + (r.why ? ' (' + r.why + ')' : '') + '. Close the bridge window to be sure.', 'warn', 9000);
      }
    }catch(e){}
    try{ _refreshIntegrationsUI(); }catch(e){}
  });
  const go = root.querySelector('#brg-go');
  if(!go) return;
  const say = (t, bad) => {
    const m = root.querySelector('#brg-msg');
    if(m){ m.textContent = t; m.className = 'brg-msg' + (bad ? ' brg-bad' : ''); }
  };
  on(go, 'click', async () => {
    const port = String((root.querySelector('#brg-port') || {}).value || '').replace(/\D/g, '');
    const code = String((root.querySelector('#brg-code') || {}).value || '').trim();
    if(!port) return say('Put in the port the bridge printed.', true);
    if(!code) return say('Put in the code the bridge printed.', true);
    go.disabled = true;
    say('Looking for the bridge on port ' + port + '…');
    try{
      /* Checked before pairing, so "nothing is listening there" and "the code
         is wrong" are two different sentences rather than one shrug. */
      const hello = await _bridgeHello(port);
      if(!hello){
        go.disabled = false;
        return say('Nothing is answering on port ' + port + '. Check the bridge is still running, and that the port matches what it printed.', true);
      }
      say('Found ' + hello.folder + '. Pairing…');
      await _bridgePair(port, code);
      say('');
      try{ toast('Connected to ' + BRIDGE.folder + '. AMV can build in that folder now.', 'success', 5000); }catch(e){}
      try{ _refreshIntegrationsUI(); }catch(e){}
      /* Build's project panel is keyed off the connected folder, so it has
         something to show only from this moment on. */
      try{ _devRenderProject(); }catch(e){}
      /* THE CONNECTORS COME UP WITH THE MACHINE.

         They cannot run without it, so pairing is the only moment they can
         start, and making somebody press a second button for something that
         has exactly one prerequisite is how a feature goes unused. Each one
         reports for itself: a connector missing a package must not stop the
         others, and the row says which failed and why. */
      if(typeof mcpStartAll === 'function'){
        try{
          const started = await mcpStartAll();
          const bad = started.filter(r => !r.ok);
          const good = started.filter(r => r.ok);
          if(good.length) toast(good.length + ' connector' + (good.length === 1 ? '' : 's') + ' ready.', 'success', 4000);
          if(bad.length) toast(bad.length + ' connector' + (bad.length === 1 ? '' : 's') + ' could not start. See Integrations.', 'error', 6000);
          if(started.length) try{ _refreshIntegrationsUI(); }catch(e){}
        }catch(e){}
      }
    }catch(e){
      go.disabled = false;
      say(e.message || 'Could not connect.', true);
    }
  });
  /* Enter in either box is the same as pressing Connect. */
  ['#brg-port', '#brg-code'].forEach(sel => {
    const el = root.querySelector(sel);
    if(el) on(el, 'keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); go.click(); } });
  });
}
try{ window._bridgeWireCard=_bridgeWireCard; }catch(e){}
