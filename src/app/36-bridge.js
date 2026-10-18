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
  /* AMV's cloud computer rather than one on this desk: the same bridge, run
     in a container AMV starts for this account, reached through AMV's own
     server (/v1/computer) with the person's sign-in - so there is no port and
     no token here at all. */
  cloud: false,
};
try{ window.BRIDGE = BRIDGE; }catch(e){}

/* A machine connectors, sign-ins and the screen can run on: the person's own.
   The cloud computer runs commands and files only - the server forwards
   nothing else to it - so everything that opens something the person sees, or
   holds their credentials, asks for this rather than "connected". */
function bridgeLocal(){ return !!(BRIDGE.connected && !BRIDGE.cloud); }
const BRIDGE_CLOUD_LOCAL_ONLY = 'Connectors, sign-ins and the screen run on your own computer, and AMV is using its cloud workspace right now. '
  + 'Disconnect it under Integrations \u203a Your computer, then connect this one.';
try{ window.bridgeLocal = bridgeLocal; }catch(e){}

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
    if(s && s.cloud){ Object.assign(BRIDGE, _bridgeCloudState(), { connected: true, why: '' }); }
    else if(s && s.port && s.token){ Object.assign(BRIDGE, s, { cloud: false, connected: true, why: '' }); }
  }catch(e){}
}
function _bridgeRemember(){
  try{
    if(BRIDGE.cloud){ sessionStorage.setItem('amv_bridge', JSON.stringify({ cloud: true })); return; }
    sessionStorage.setItem('amv_bridge', JSON.stringify({
      port: BRIDGE.port, token: BRIDGE.token, folder: BRIDGE.folder, root: BRIDGE.root,
      sharesEnv: !!BRIDGE.sharesEnv, fence: BRIDGE.fence || '', computer: BRIDGE.computer || null }));
  }catch(e){}
}
function _bridgeForget(){
  BRIDGE.port = 0; BRIDGE.token = ''; BRIDGE.folder = ''; BRIDGE.root = ''; BRIDGE.sharesEnv = false; BRIDGE.fence = '';
  BRIDGE.computer = null; BRIDGE.cloud = false;
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
  let revoked = false, stopped = null, why = '';
  /* The cloud computer: ending the session there means stopping what runs.
     Its key is AMV's server's, not this tab's, so there is nothing to revoke
     but the work - and the person's sign-in is what asks for that. */
  if(BRIDGE.connected && BRIDGE.cloud){
    try{
      const r = await AMV_API._fetch('/v1/computer/revoke', { method: 'POST', body: '{}', timeout: 15000 });
      const d = await r.json().catch(()=>({}));
      if(r.ok && d.revoked){ revoked = true; stopped = d.stopped || null; }
      else why = String(d.error || ('AMV answered ' + r.status));
    }catch(e){ why = 'AMV could not be reached'; }
    _bridgeForget();
    return { revoked, stopped, why, cloud: true };
  }
  const daemon = BRIDGE.connected ? _bridgeBase() : '';
  const token = BRIDGE.token;
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
  BRIDGE.sharesEnv = d.sharesEnvironment === true;
  /* 'on', or why not: off | unsupported | missing | failed. A bridge too old
     to say is treated as unfenced, which is what it is. */
  BRIDGE.fence = /^(on|off|unsupported|missing|failed)$/.test(String(d.fence || '')) ? String(d.fence) : 'unsupported';
  /* Whether it may use the screen, mouse and keyboard - only ever true when
     the person started it with --computer. A bridge too old to say cannot. */
  const c = d.computer && typeof d.computer === 'object' ? d.computer : null;
  BRIDGE.computer = c ? { on: c.on === true, os: String(c.os || '').slice(0, 16), why: String(c.why || '').slice(0, 32) } : null;
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
  if(BRIDGE.cloud) return await _bridgeCloudCall(route, body, timeoutMs);
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
    /* The bridge restarted, so its token changed - or the pairing sat unused
       long enough that the bridge ended it. Saying which is the whole answer,
       because both look exactly like it not running. */
    const d401 = await r.json().catch(()=>({}));
    _bridgeForget();
    if(d401 && d401.error === 'expired'){
      BRIDGE.why = 'expired';
      throw new Error('This computer was not used by AMV for 12 hours, so the bridge ended the pairing. Connect it again with the code in its terminal.');
    }
    BRIDGE.why = 'stale';
    throw new Error('The bridge restarted, so this tab is no longer paired with it. Connect it again with the new code.');
  }
  return _bridgeAnswer(r.status, await r.json().catch(()=>({})));
}
/* The bridge's answer, wherever it ran: its refusals named, its result as-is. */
function _bridgeAnswer(status, d){
  d = d || {};
  if(status === 403 && d.error === 'refused'){
    throw new Error('The bridge refused that command: it looks like ' + d.reason + '. '
      + (BRIDGE.cloud ? 'The cloud workspace refuses it for everybody.' : 'That rule lives on your machine, not in AMV.'));
  }
  if(status === 429 && d.error === 'busy'){
    const e = new Error('Your computer is already running ' + (d.running || 'several') + ' commands, which is as many as the bridge runs at once. Wait for one to finish, then try again.');
    e.code = 'busy'; e.status = 429;
    throw e;
  }
  if(status === 403 && d.error === 'outside_root'){
    throw new Error('That path is outside the folder the bridge was started in, so it is not AMV’s to touch.');
  }
  if(status === 403 && d.error === 'secret_path'){
    const e = new Error('That is where keys or logins are kept, so the bridge will not read or change it, even inside the folder.');
    e.code = 'secret_path'; e.status = 403;
    throw e;
  }
  if(!(status >= 200 && status < 300)){
    const err = new Error(d.message || d.error || 'The bridge could not do that.');
    /* THE MACHINE-READABLE HALF, carried rather than left in the prose.

       Callers need to tell one refusal from another - `bridgeRead` has to know
       "not there" from "could not read it", and matching on a sentence is how
       that breaks the first time the wording changes. Same reason the API
       client carries `code` off the worker. */
    if(d.error) err.code = String(d.error);
    err.status = status;
    throw err;
  }
  return d;
}

/* ── THE CLOUD COMPUTER ───────────────────────────────────────────────────

   The same calls, sent to AMV's server instead of this computer. What comes
   back from the bridge is the bridge's own answer, passed through, so its
   refusals are told the same way; what the SERVER refuses (the plan, the
   month's minutes, a machine that would not start) carries a `code`, and is
   said in the server's words. Only commands and files go: connectors and the
   screen are refused here, before a request, with what to do instead. */
/* Each route spelled out whole, so the checks that every path the app asks
   for is one the server has can read them - and so a route not listed here is
   simply not sent. */
const BRIDGE_CLOUD_PATHS = {
  'exec': '/v1/computer/exec', 'exec/cancel': '/v1/computer/exec/cancel', 'read': '/v1/computer/read',
  'write': '/v1/computer/write', 'list': '/v1/computer/list', 'delete': '/v1/computer/delete',
  'status': '/v1/computer/status', 'revoke': '/v1/computer/revoke',
};
function _bridgeCloudState(){
  return { cloud: true, port: 0, token: '', folder: 'AMV\u2019s cloud workspace', root: 'amv-cloud:/work',
           sharesEnv: false, fence: 'cloud', computer: null };
}
async function _bridgeCloudCall(route, body, timeoutMs){
  const path = Object.prototype.hasOwnProperty.call(BRIDGE_CLOUD_PATHS, route) ? BRIDGE_CLOUD_PATHS[route] : '';
  if(!path){
    const e = new Error(BRIDGE_CLOUD_LOCAL_ONLY); e.code = 'cloud_local_only'; throw e;
  }
  /* A failure to reach AMV's server is NOT "the machine is gone", so unlike
     the local bridge it does not disconnect: a dropped connection or a lapsed
     sign-in is said in its own words, and the next call may well work. */
  const r = await AMV_API._fetch(path, { method: 'POST', body: JSON.stringify(body || {}),
                                                           timeout: timeoutMs || 130000, bodyTimeout: 30000 });
  const d = await r.json().catch(()=>({}));
  if(!r.ok && d && d.code){
    const err = new Error(String(d.error || 'AMV\u2019s cloud workspace could not do that.'));
    err.code = String(d.code); err.status = r.status;
    if(d.minutes) err.minutes = d.minutes;
    throw err;
  }
  return _bridgeAnswer(r.status, d);
}
/* What the cloud computer has to offer this account, from the server: whether
   this deployment runs one, whether the plan includes it, and the minutes. */
async function bridgeCloudInfo(){
  if(!(AMV_API && AMV_API.live && typeof S !== 'undefined' && S.user)) return null;
  try{
    const r = await AMV_API._fetch('/v1/computer/info', { method: 'GET', timeout: 10000 });
    if(!r.ok) return null;
    const d = await r.json();
    if(!d || d.ok !== true) return null;
    const m = d.minutes || {};
    return { available: d.available === true, allowed: d.allowed === true, minPlan: String(d.minPlan || 'pro'),
             used: Math.max(0, +m.used || 0), cap: Math.max(0, +m.cap || 0) };
  }catch(e){ return null; }
}
/* Connecting it is asking it something: the first request starts the
   machine, so "connected" is said only after it has answered. */
async function bridgeCloudConnect(){
  if(BRIDGE.connected && !BRIDGE.cloud) throw new Error('Disconnect this computer first - AMV works on one computer at a time.');
  const prev = Object.assign({}, BRIDGE);
  Object.assign(BRIDGE, _bridgeCloudState(), { connected: true, why: '' });
  try{ await _bridgeCloudCall('status', {}, 90000); }
  catch(e){ Object.assign(BRIDGE, prev); throw e; }
  _bridgeRemember();
  return BRIDGE;
}
try{ window.bridgeCloudInfo = bridgeCloudInfo; window.bridgeCloudConnect = bridgeCloudConnect; }catch(e){}

/* ══════════════════════════════════════════════════════════════════════
   COMMANDS THE PERSON TOLD AMV NEVER TO RUN.

   The bridge refuses the catastrophic shapes on its own (a recursive
   delete, sudo, a force push). What no built-in list can know is what THIS
   person never wants run on their computer: `git push` because they review
   first, `npm publish`, their own deploy script. So they write the list
   themselves, and every command AMV starts - chat, Build, a background job -
   is checked against it in bridgeExec, the one place they all pass through
   on the way to the computer. Chat also checks before asking permission,
   so nobody is asked to approve something that will then be refused.

   Kept in localStorage on purpose. The bridge only ever listens on this
   computer's own address, so the browser holding the list IS the computer
   the commands would run on. Not a secret, and not a capability - it only
   ever takes power away.

   Matching leans towards refusing. A rule's first word may appear anywhere a
   command can begin and its other words in order after it, inside the same
   command: `git -C app push` is still `git push`, and so is `bash -c "git
   push"`. That also catches `git commit -m "push later"`. The refusal names
   the rule, so the person or the model can rephrase - the other kind of wrong
   is the push they said never to make. */
const NEVER_RUN_KEY = 'amv_never_run';
const NEVER_RUN_MAX = 50;
const NEVER_RUN_RULE_MAX = 120;

function _neverRunClean(text){
  const out = [];
  for(const line of String(text || '').split(/\r?\n/)){
    const rule = line.replace(/\s+/g, ' ').trim().slice(0, NEVER_RUN_RULE_MAX);
    if(rule && !out.some(r => r.toLowerCase() === rule.toLowerCase())) out.push(rule);
    if(out.length >= NEVER_RUN_MAX) break;
  }
  return out;
}
function neverRunRules(){
  try{
    const v = JSON.parse(localStorage.getItem(NEVER_RUN_KEY) || '[]');
    return Array.isArray(v) ? _neverRunClean(v.join('\n')) : [];
  }catch(e){ return []; }
}
function neverRunSave(text){
  const rules = _neverRunClean(text);
  try{
    if(rules.length) localStorage.setItem(NEVER_RUN_KEY, JSON.stringify(rules));
    else localStorage.removeItem(NEVER_RUN_KEY);
  }catch(e){ return null; }
  return rules;
}
/* One word as a shell would see the program: lower case, without the
   folder it was called from and without Windows' .exe. */
const _nrWord = (w) => String(w).toLowerCase().replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat)$/, '');
/* Yours, and your team's: an owner or admin can set commands nobody's AMV
   runs (Settings -> Skills -> Rules), and a member cannot switch those off. */
function _teamNeverRun(){ try{ return _neverRunClean(_agentRules().teamBlock.join('\n')); }catch(e){ return []; } }
/* The rule this command breaks, or ''. */
function neverRunHit(command){ return _nrMatch(command, neverRunRules().concat(_teamNeverRun())); }
/* The same reading of a command for any list of rules - the never-run list
   above, and the ask-first list in Build. */
function _nrMatch(command, rules){
  if(!rules || !rules.length) return '';
  /* Every place a command can begin: separators, pipes, brackets,
     substitutions and backticks split it into pieces; quotes are dropped so a
     command handed to `sh -c` is read like any other. */
  const pieces = String(command || '').replace(/\\\r?\n/g, ' ').split(/\$\(|[;&|\n(){}`]/);
  for(const piece of pieces){
    const words = piece.replace(/["']/g, ' ').split(/\s+/).filter(Boolean).map(_nrWord);
    for(const rule of rules){
      const want = rule.split(' ').map(_nrWord);
      for(let i = 0; i < words.length; i++){
        if(words[i] !== want[0]) continue;
        let j = 1;
        for(let k = i + 1; k < words.length && j < want.length; k++) if(words[k] === want[j]) j++;
        if(j === want.length) return rule;
      }
    }
  }
  return '';
}
/* What the model is told when a command is refused this way: the rule,
   and that it is the person's decision - not an error to retry around. */
function neverRunRefusal(name, input){
  if(name !== 'run_command') return '';
  const rule = neverRunHit(input && input.command);
  const theirs = rule && !neverRunRules().some(r => r.toLowerCase() === rule.toLowerCase());
  return rule ? ('Refused: ' + (theirs ? 'the person\u2019s team' : 'the person') + ' told AMV never to run "' + rule + '" on their computer. '
               + 'Do not try another way to do the same thing. Tell them what you would have run, '
               + 'and that they can run it themselves.') : '';
}

/* Every command is named, so Stop can end the ones still running rather than
   waiting for them (see the bridge's exec/cancel). */
const _BRIDGE_RUNNING = new Set();
async function bridgeExec(command, opts){
  opts = opts || {};
  /* The person's own list, checked here because every command AMV starts
     passes through here - so nothing listed reaches the computer, whichever
     surface asked. */
  const refused = neverRunRefusal('run_command', { command });
  if(refused){ const e = new Error(refused); e.code = 'never_run'; throw e; }
  const job = 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  _BRIDGE_RUNNING.add(job);
  try{
    return await _bridgeCall('exec', { command, cwd: opts.cwd || '.', timeout: opts.timeout, job },
                             (opts.timeout || 120000) + 8000);
  } finally { _BRIDGE_RUNNING.delete(job); }
}
/* Stop: end every command this tab has running on the computer. Best effort
   and quiet - a bridge that has gone has nothing left to stop - but each is
   asked directly, so the answer to the command itself says it was stopped. */
async function bridgeCancelRunning(){
  if(!_BRIDGE_RUNNING.size || !(typeof BRIDGE !== 'undefined' && BRIDGE.connected)) return 0;
  const jobs = [..._BRIDGE_RUNNING];
  let n = 0;
  if(BRIDGE.cloud){
    await Promise.all(jobs.map(job => AMV_API._fetch('/v1/computer/exec/cancel', { method:'POST', body: JSON.stringify({ job }), timeout: 8000 })
      .then(r => r.json()).then(d => { if(d && d.cancelled) n++; }).catch(() => {})));
    return n;
  }
  await Promise.all(jobs.map(job => fetchDeadline(_bridgeBase() + '/amv-bridge/exec/cancel', {
      method:'POST', headers:{ 'Content-Type':'application/json', 'X-AMV-Bridge-Token': BRIDGE.token },
      body: JSON.stringify({ job }) }, 5000)
    .then(r => r.json()).then(d => { if(d && d.cancelled) n++; }).catch(() => {})));
  return n;
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
try{ window.bridgeExec=bridgeExec; window.bridgeCancelRunning=bridgeCancelRunning; window.bridgeRead=bridgeRead;
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
/* The tools as offered on a turn: the same four, with the person's
   never-run list written into run_command's description so the model knows
   it before it tries - a refusal is still the backstop, not the first time
   it hears of the rule. */
function bridgeToolsOffered(){
  const rules = neverRunRules().concat(_teamNeverRun()), prot = _agentRules().protect;
  if(!rules.length && !prot.length) return BRIDGE_TOOLS;
  return BRIDGE_TOOLS.map(t => {
    if(t.name === 'run_command' && rules.length) return Object.assign({}, t, {
      description: t.description + ' The user has told AMV never to run these on their computer, '
        + 'and they are refused: ' + rules.map(r => '"' + r + '"').join(', ')
        + '. Do not try another way to do the same thing.' });
    /* Protected files, said up front for the same reason. */
    if(t.name === 'write_file' && prot.length) return Object.assign({}, t, {
      description: t.description + ' The user has protected these and writing them is refused: '
        + prot.map(r => '"' + r + '"').join(', ') + '.' });
    return t;
  });
}
try{ window.bridgeToolsOffered = bridgeToolsOffered; window.neverRunRules = neverRunRules;
     window.neverRunSave = neverRunSave; window.neverRunRefusal = neverRunRefusal; }catch(e){}

/* Run one of them. Errors come back as a RESULT rather than being thrown,
   because a failed command is information the model should reason about -
   a missing package, a failing test - and not a reason to end the turn. */
/* ── RULES FOR YOUR COMPUTER ───────────────────────────────────────────────
   What somebody can tell AMV about working on their machine, beyond the
   consent each turn asks for: commands it must never run, commands it must
   ask about first even mid-turn (both read the way the never-run list above
   reads a command), files it must never change, a check to run
   after every file it changes (a linter, the tests) and one to run before it
   says it is finished. A team's owner or admin can set the same rules for
   everybody on the team; a member cannot switch those off.

   Edited in Settings -> Skills (src/skills/skills.js). Enforced here, at the
   one door every command and every write on the machine goes through, so a
   rule holds in chat and in Build alike.

   WHAT A RULE IS, SAID PLAINLY. A guardrail on AMV, not a sandbox: a command
   spelled to dodge one is still a command the bridge prints in its own
   window, and the screen that edits the rules says exactly that. */
const AGENT_RULES_MAX = 30;
function _agentRules(){
  let mine = {}, team = {};
  try{ mine = JSON.parse(loadStr('amv_agentrules') || '{}') || {}; }catch(e){}
  try{ const t = window.AMVTeam && AMVTeam._cache; team = (t && t.policy && t.policy.agentRules) || {}; }catch(e){}
  const list = k => [].concat(Array.isArray(team[k]) ? team[k] : [], Array.isArray(mine[k]) ? mine[k] : [])
    .map(s => String(s || '').trim()).filter(Boolean).slice(0, AGENT_RULES_MAX * 2);
  const one = k => [team[k], mine[k]].map(s => String(s || '').trim()).filter(Boolean);
  return { ask: list('ask'), protect: list('protect'), afterWrite: one('afterWrite'), onFinish: one('onFinish'),
           teamBlock: (Array.isArray(team.block) ? team.block : []).map(s => String(s || '').trim()).filter(Boolean) };
}
const _ruleEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* The rule that protects a path, or ''. `*` is within a folder, `**` across
   folders, and a rule with no slash in it names a file wherever it is. */
/* Paths are compared after `.`, `..` and doubled slashes are resolved, and a
   rule matches wherever the path ENDS with it on a folder boundary. The model
   names files however it likes - `/home/me/proj/config/secrets.json`,
   `src/../config/secrets.json` - and comparing from the start of the string
   let both of those past a `config/secrets.json` rule. Matching a tail can only
   protect more than meant, never less, which is the right way to be wrong. */
function _ruleNormPath(path){
  const out = [];
  for(const seg of String(path || '').replace(/\\/g, '/').split('/')){
    if(!seg || seg === '.') continue;
    if(seg === '..'){ out.pop(); continue; }
    out.push(seg);
  }
  return out.join('/');
}
function _rulePathHit(path, list){
  const p = _ruleNormPath(path);
  if(!p) return '';
  return (list || []).find(r => {
    const g = _ruleNormPath(r);
    if(!g) return false;
    const src = g.split('**').map(x => x.split('*').map(_ruleEsc).join('[^/]*')).join('.*');
    return new RegExp('^(?:.*/)?' + src + '$', 'i').test(p);
  }) || '';
}
try{ Object.assign(window, { _agentRules, _rulePathHit, _nrMatch }); }catch(e){}

async function runBridgeTool(name, args){
  args = args || {};
  /* Files the person protected hold at the door, for chat and Build alike
     (commands they never want run are refused in bridgeExec). */
  if(name === 'write_file'){
    const hit = _rulePathHit(args.path, _agentRules().protect);
    if(hit) return { ok:false, error:'Your rule "' + hit + '" protects ' + String(args.path || '') + ', so AMV did not change it.' };
  }
  try{
    if(name === 'run_command'){
      const r = await bridgeExec(String(args.command||''), { cwd: args.cwd, timeout: args.timeout });
      return { ok: r.exitCode === 0 && !r.cancelled, exitCode: r.exitCode, timedOut: !!r.timedOut,
               cancelled: !!r.cancelled, ms: r.ms, stdout: r.stdout || '', stderr: r.stderr || '',
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
  /* The cloud computer, connected. What it is, and the two things somebody
     would otherwise find out the hard way: it is cleared when it sleeps, and
     what needs their own computer instead. */
  if(BRIDGE.connected && BRIDGE.cloud){
    return '<div class="brg brg-on brg-cloud-on">'
      + '<div class="brg-h"><span class="brg-dot" aria-hidden="true"></span>'
        + '<b>AMV\u2019s cloud workspace is connected</b></div>'
      + '<p class="brg-p">A private Linux machine in AMV\u2019s cloud, for your account only. AMV can install '
        + 'packages, run code and tests, and use git there - in chat it asks before each command, in Build once '
        + 'for the whole request. Nothing on this device is reachable from it.</p>'
      + '<p class="brg-p brg-warn"><b>It is cleared when it sleeps.</b> After 5 minutes without use it stops, '
        + 'and its files go with it. Download or push anything you want to keep.</p>'
      + '<p class="brg-p">Connectors, sign-ins and the screen need your own computer.</p>'
      + '<p class="brg-p brg-cloud-min" id="brg-cloud-min" aria-live="polite"></p>'
      + '<div class="brg-repo" id="brg-repo" aria-live="polite">' + _cloudRepoHTML() + '</div>'
      + '<div class="brg-acts">'
        + '<button class="btn bs" id="brg-gh-open" type="button">' + escH(T('Open a GitHub repository')) + '</button>'
        + '<button class="btn bs" id="brg-off" type="button">Disconnect</button>'
      + '</div></div>';
  }
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
        + 'and nowhere else. Commands run there as you - the bridge prints every '
        + 'one in its terminal. In chat AMV asks before each one. In Build it asks '
        + 'once for the whole request, and you can stop it at any point.</p>'
      /* What commands can READ, said either way - the fence is checked by the
         bridge when it starts, and this repeats what it found. */
      + (BRIDGE.fence === 'on'
          ? '<p class="brg-p">Your SSH keys, cloud logins, token files, shell history and browser '
            + 'profiles are hidden from commands and connectors.</p>'
          : '<p class="brg-p brg-warn"><b>Commands and connectors can read every file you can,</b> including keys and '
            + 'logins saved in your home folder. '
            + (BRIDGE.fence === 'off' ? 'This bridge was started with <code>--no-fence</code>.'
              : BRIDGE.fence === 'missing' ? 'Install bubblewrap on this computer and restart the bridge to hide them.'
              : BRIDGE.fence === 'failed' ? 'This computer would not start the fence that hides them.'
              : 'Only ask for work you would run yourself.')
            + '</p>')
      /* The screen, said either way: on only when the person started the
         bridge with --computer, and if they asked and it could not start,
         what is missing. */
      + (BRIDGE.computer && BRIDGE.computer.on
          ? '<p class="brg-p brg-warn"><b>AMV can use this screen.</b> This bridge was started with '
            + '<code>--computer</code>, so in chat AMV can look at your screen and use the mouse and keyboard. '
            + 'It asks before it looks, and before every click and keystroke.</p>'
          : '<p class="brg-p">AMV cannot see or use this screen. '
            + ({ no_display: 'This session has no screen.',
                 wayland: 'This desktop uses Wayland; screen control needs an X11 session.',
                 no_xdotool: 'Install xdotool and restart the bridge with <code>--computer</code> to allow it.',
                 no_screenshot_tool: 'Install a screenshot tool (ImageMagick) and restart the bridge with <code>--computer</code> to allow it.' }
               [BRIDGE.computer && BRIDGE.computer.why]
               || 'To allow it, restart the bridge with <code>--computer</code>. It asks before every action.')
            + '</p>')
      /* What commands can see of this computer's settings, said either way:
         the default is a short allowed list with no keys or tokens, and the
         full environment is a flag somebody chose when starting the bridge. */
      + (BRIDGE.sharesEnv
          ? '<p class="brg-p brg-warn"><b>Sharing everything.</b> This bridge was started with '
            + '<code>--share-environment</code>, so every command and connector can read all of '
            + 'that terminal\u2019s settings, including any keys or tokens in it.</p>'
          : '<p class="brg-p">Commands get your program path and basic settings - none of the keys '
            + 'or tokens set in that terminal. A connector gets only the credentials you give it.</p>')
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
    /* Filled in once the server says this deployment runs a cloud computer -
       empty, and so invisible, where it does not. */
    + '<div class="brg-cloud" id="brg-cloud" hidden></div>'
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

/* The never-run list, on the computer card. Shown whether or not a
   computer is connected, so it can be set before the first command. */
function _neverRunHTML(){
  const rules = neverRunRules();
  return '<div class="brg nr">'
    + '<div class="brg-h"><b>Never run</b></div>'
    + '<p class="brg-p">Commands AMV must never run on this computer, one per line. It refuses them in chat, '
      + 'in Build and in background jobs, before anything reaches your computer.</p>'
    + '<label class="sr-only" for="nr-list">Commands AMV must never run</label>'
    + '<textarea id="nr-list" class="brg-i nr-list" rows="4" spellcheck="false" autocapitalize="off" '
      + 'autocomplete="off" placeholder="git push&#10;npm publish&#10;./deploy.sh">' + escH(rules.join('\n')) + '</textarea>'
    + '<div class="brg-acts"><button class="btn bs" id="nr-save" type="button">Save</button></div>'
    + '<div class="brg-msg" id="nr-msg" role="status" aria-live="polite"></div>'
    + '</div>';
}
function _neverRunWire(root){
  root = root || document;
  const save = root.querySelector('#nr-save');
  const box = root.querySelector('#nr-list');
  if(!save || !box) return;
  on(save, 'click', () => {
    const m = root.querySelector('#nr-msg');
    const rules = neverRunSave(box.value);
    if(!rules){
      if(m){ m.textContent = 'This browser would not save the list. Check that it allows this site to store data.'; m.className = 'brg-msg brg-bad'; }
      return;
    }
    box.value = rules.join('\n');
    if(m){
      m.className = 'brg-msg';
      m.textContent = rules.length
        ? 'Saved. AMV will never run these ' + rules.length + ' command' + (rules.length === 1 ? '' : 's') + ' on this computer.'
        : 'Saved. Only the bridge\u2019s own refusals apply now.';
    }
  });
}
try{ window._neverRunHTML = _neverRunHTML; window._neverRunWire = _neverRunWire; }catch(e){}

/* The cloud computer's row on the card, from what the server says. Shown only
   where this deployment runs one: an option that cannot work is not offered,
   and a plan that does not include it says which one does. */
function _bridgeCloudRowHTML(info){
  const mins = info.cap ? (info.used + ' of ' + info.cap + ' minutes used this month.') : '';
  if(!info.allowed){
    return '<div class="brg-cloud-t"><b>No computer to hand?</b> AMV\u2019s cloud workspace runs your project on a '
      + 'private machine in AMV\u2019s cloud. It comes with ' + escH((PLANS[info.minPlan] && PLANS[info.minPlan].name) || 'Pro') + ' and above.</div>'
      + '<button class="btn bs" id="brg-cloud-up" type="button">See plans</button>';
  }
  return '<div class="brg-cloud-t"><b>No computer to hand?</b> Use AMV\u2019s cloud workspace: a private machine in '
    + 'AMV\u2019s cloud that runs commands and keeps files while you work. ' + escH(mins) + '</div>'
    + '<button class="btn bp" id="brg-cloud-go" type="button"'
      + (info.cap && info.used >= info.cap ? ' disabled' : '') + '>Use the cloud workspace</button>';
}
async function _bridgeCloudWire(root){
  const slot = root.querySelector('#brg-cloud');
  const minLine = root.querySelector('#brg-cloud-min');
  if(!slot && !minLine) return;
  const info = await bridgeCloudInfo();
  if(minLine && info && info.cap) minLine.textContent = info.used + ' of ' + info.cap + ' minutes used this month. '
    + 'Minutes count while it is on, including the 5 minutes it waits after you last use it.';
  if(!slot || !info || !info.available || !slot.isConnected) return;
  slot.innerHTML = _bridgeCloudRowHTML(info);
  slot.hidden = false;
  const up = slot.querySelector('#brg-cloud-up');
  if(up) on(up, 'click', () => { try{ openUpgrade(info.minPlan, 'integrations'); }catch(e){} });
  const go = slot.querySelector('#brg-cloud-go');
  if(go) on(go, 'click', async () => {
    const m = root.querySelector('#brg-msg');
    const say = (t, bad) => { if(m){ m.textContent = t; m.className = 'brg-msg' + (bad ? ' brg-bad' : ''); } };
    go.disabled = true;
    say('Starting your cloud workspace. The first time can take up to a minute\u2026');
    try{
      await bridgeCloudConnect();
      say('');
      try{ toast('Connected to AMV\u2019s cloud workspace. AMV can run your project there now.', 'success', 5000); }catch(e){}
      try{ _refreshIntegrationsUI(); }catch(e){}
      try{ _devRenderProject(); }catch(e){}
    }catch(e){
      go.disabled = false;
      say(e.message || 'The cloud workspace could not be started.', true);
    }
  });
}

function _bridgeWireCard(root){
  root = root || document;
  _bridgeCloudWire(root).catch(() => {});
  const dl = root.querySelector('#brg-dl');
  if(dl) on(dl, 'click', async () => {
    dl.disabled = true;
    try{
      if(await _bridgeDownload()){
        try{ toast('Saved amv-bridge.mjs. Run it with "node amv-bridge.mjs" in your project folder.', 'success', 6000); }catch(e){}
      }
    } finally { dl.disabled = false; }
  });
  _cloudRepoWire(root);
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
      if(r.cloud){
        const s = r.stopped || {};
        toast(r.revoked
          ? 'Disconnected from the cloud workspace.' + (s.jobs ? ' ' + s.jobs + ' command' + (s.jobs === 1 ? '' : 's') + ' stopped.' : '')
          : 'Disconnected here. AMV could not confirm the cloud workspace stopped what it was running'
            + (r.why ? ' (' + r.why + ')' : '') + '; it stops on its own after 5 minutes.', r.revoked ? 'info' : 'warn', 7000);
      } else if(r.revoked){
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
