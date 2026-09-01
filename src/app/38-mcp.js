/* ══════════════════════════════════════════════════════════════════════
   MCP: ONE INTEGRATION INSTEAD OF A HUNDRED AND FIFTY.

   The services people want AMV connected to number in the hundreds, and
   almost every one of them already has an MCP server written by somebody
   who knows that service far better than we ever will. Hand-writing a
   hundred and fifty integrations is a hundred and fifty things to keep
   working, each rotting on its own schedule. Speaking one protocol is one.

   AMV is a browser tab and cannot hold a child process, so the bridge runs
   the servers and this drives them. That means MCP is available exactly
   when a computer is connected, which is the honest shape: no machine, no
   third-party servers, and the screen says so rather than offering a
   feature that cannot work.

   WHERE THE SECRETS GO, WHICH IS THE ONLY HARD QUESTION HERE.

   An MCP server usually needs a credential - a GitHub token, a database
   URL - passed in its environment. Those are written into the child
   process by the bridge and never read back out by any route. On this
   side, the command and its arguments persist (they are not secret and
   retyping them every session is friction nobody accepts), and the
   environment lives in sessionStorage only: it dies with the tab, exactly
   like the bridge token, because both are capabilities rather than
   settings. An argument that LOOKS like a credential is refused rather
   than quietly written to disk.
   ══════════════════════════════════════════════════════════════════════ */

const MCP = {
  /* [{ id, command, args }] - configuration, no secrets. */
  servers: [],
  /* id -> { tools:[...], info, error } for the ones actually running now. */
  live: {},
};
try{ window.MCP = MCP; }catch(e){}

const MCP_MAX_SERVERS = 8;
/* A token, a key, a connection string. Deliberately broad: the cost of a
   false positive is somebody putting a value in the environment box instead,
   and the cost of a false negative is a credential in localStorage. */
const MCP_SECRETISH = /(^|[_-])(token|key|secret|password|passwd|pat|apikey)([_-]|=|$)|:\/\/[^\/\s]*:[^@\/\s]*@|\b(gh[pousr]_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/i;

function _mcpLoad(){
  try{
    const raw = localStorage.getItem('amv_mcp_servers');
    MCP.servers = raw ? (JSON.parse(raw) || []) : [];
    if(!Array.isArray(MCP.servers)) MCP.servers = [];
  }catch(e){ MCP.servers = []; }
}
function _mcpSave(){
  try{ localStorage.setItem('amv_mcp_servers', JSON.stringify(MCP.servers.slice(0, MCP_MAX_SERVERS))); }catch(e){}
}
/* Environment values, per tab. Never localStorage: see the header. */
function _mcpEnv(id){
  try{ return JSON.parse(sessionStorage.getItem('amv_mcp_env_' + id) || '{}') || {}; }catch(e){ return {}; }
}
function _mcpSetEnv(id, env){
  try{
    if(env && Object.keys(env).length) sessionStorage.setItem('amv_mcp_env_' + id, JSON.stringify(env));
    else sessionStorage.removeItem('amv_mcp_env_' + id);
  }catch(e){}
}
try{ window._mcpEnv=_mcpEnv; window._mcpSetEnv=_mcpSetEnv; }catch(e){}

/* An id that is safe in a tool name, a storage key and a log line. */
function _mcpSafeId(s){
  return String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function _mcpAdd(id, command, args, env){
  id = _mcpSafeId(id);
  if(!id) throw new Error('Give the server a short name, like "github".');
  if(MCP.servers.some(s => s.id === id)) throw new Error('There is already a server called "' + id + '".');
  if(MCP.servers.length >= MCP_MAX_SERVERS) throw new Error('That is as many servers as AMV will run at once.');
  command = String(command || '').trim();
  if(!command) throw new Error('Give the command that starts the server.');
  const argv = Array.isArray(args) ? args.map(a => String(a)) : [];
  /* REFUSED RATHER THAN STORED. An argument carrying a credential would be
     written to localStorage, where it outlives the tab and every session
     after it - which is the thing this whole file is careful about. */
  const leak = [command].concat(argv).find(a => MCP_SECRETISH.test(a));
  if(leak) throw new Error('That looks like it contains a credential. Put it in the environment box instead, where AMV keeps it only for this tab.');
  MCP.servers.push({ id, command, args: argv });
  _mcpSave();
  if(env) _mcpSetEnv(id, env);
  return id;
}
function _mcpRemove(id){
  MCP.servers = MCP.servers.filter(s => s.id !== id);
  _mcpSave(); _mcpSetEnv(id, null);
  delete MCP.live[id];
}
try{ window._mcpAdd=_mcpAdd; window._mcpRemove=_mcpRemove; }catch(e){}

/* ── TALKING TO THE BRIDGE ──────────────────────────────────────────────── */
async function _mcpStart(id){
  const cfg = MCP.servers.find(s => s.id === id);
  if(!cfg) throw new Error('No server called "' + id + '".');
  const d = await _bridgeCall('mcp/start', { id, command: cfg.command, args: cfg.args, env: _mcpEnv(id) }, 70000);
  MCP.live[id] = { tools: d.tools || [], info: d.info || null, error: '' };
  return MCP.live[id];
}
async function _mcpStop(id){
  try{ await _bridgeCall('mcp/stop', { id }, 15000); }catch(e){}
  delete MCP.live[id];
}
async function mcpCall(id, method, params){
  const d = await _bridgeCall('mcp/call', { id, method, params }, 70000);
  return d.result;
}
try{ window._mcpStart=_mcpStart; window._mcpStop=_mcpStop; window.mcpCall=mcpCall; }catch(e){}

/* Start everything configured, and report what happened per server rather
   than failing the lot because one is misconfigured. */
async function mcpStartAll(){
  if(!(typeof BRIDGE !== 'undefined' && BRIDGE.connected)) return [];
  const out = [];
  for(const s of MCP.servers.slice(0, MCP_MAX_SERVERS)){
    if(MCP.live[s.id]) { out.push({ id:s.id, ok:true, tools:MCP.live[s.id].tools.length }); continue; }
    try{
      const live = await _mcpStart(s.id);
      out.push({ id:s.id, ok:true, tools:(live.tools || []).length });
    }catch(e){
      MCP.live[s.id] = { tools: [], info: null, error: String(e.message || e) };
      out.push({ id:s.id, ok:false, error: String(e.message || e) });
    }
  }
  return out;
}
try{ window.mcpStartAll=mcpStartAll; }catch(e){}

/* ── THE TOOLS THE MODEL GETS ───────────────────────────────────────────── */
/* Namespaced, because two servers may each have a `search` and the model has
   to be able to mean one of them. The separator is the one the server's
   pattern check knows about, so a name that survives here survives there. */
const MCP_PREFIX = 'mcp__';
function mcpToolName(serverId, toolName){
  return MCP_PREFIX + serverId + '__' + String(toolName).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60);
}
function _mcpSplitName(name){
  const m = /^mcp__([a-z0-9_-]{1,40})__(.+)$/.exec(String(name || ''));
  if(!m) return null;
  const server = MCP.live[m[1]];
  if(!server) return null;
  /* Back to the tool's REAL name, which is what the server answers to - the
     sanitising above is one-way, so the match is made on the sanitised form
     rather than by trying to reverse it. */
  const tool = (server.tools || []).find(t => mcpToolName(m[1], t.name) === name);
  return tool ? { id: m[1], tool } : null;
}

function mcpTools(){
  const out = [];
  for(const id of Object.keys(MCP.live)){
    const live = MCP.live[id];
    for(const t of (live.tools || [])){
      out.push({
        name: mcpToolName(id, t.name),
        /* The server's own description, with its origin stated. The model
           should know a tool came from somewhere else, because that is the
           difference between "AMV can do this" and "this machine has a
           connector that claims to". */
        description: ('[' + id + '] ' + String(t.description || t.name || '')).slice(0, 1000),
        input_schema: (t.inputSchema && typeof t.inputSchema === 'object')
          ? t.inputSchema : { type:'object', properties:{} },
      });
    }
  }
  return out;
}
try{ window.mcpTools=mcpTools; window.mcpToolName=mcpToolName; }catch(e){}

function isMcpTool(name){ return String(name || '').startsWith(MCP_PREFIX); }
try{ window.isMcpTool=isMcpTool; }catch(e){}

/* Run one. Failures come back as a RESULT rather than a throw, for the same
   reason the bridge's do: a connector saying no is information the model
   should read, not a reason to end the turn. */
async function runMcpTool(name, args){
  const hit = _mcpSplitName(name);
  if(!hit) return { ok:false, text:'That connector is not running any more. Reconnect it in Integrations.' };
  try{
    const r = await mcpCall(hit.id, 'tools/call', { name: hit.tool.name, arguments: args || {} });
    const text = (r && Array.isArray(r.content))
      ? r.content.map(c => c && c.type === 'text' ? c.text : ('[' + ((c && c.type) || 'content') + ']')).join('\n')
      : JSON.stringify(r == null ? {} : r).slice(0, 8000);
    /* MCP says a tool that FAILED returns a normal result with isError set,
       not a protocol error. Treating the two the same turns "that file does
       not exist" into "the server is broken", and the model then gives up on
       a connector that is working perfectly. */
    return { ok: !(r && r.isError), text: text || '(no output)' };
  }catch(e){
    return { ok:false, text:'That connector failed: ' + String(e.message || e) };
  }
}
try{ window.runMcpTool=runMcpTool; }catch(e){}

/* Which connectors are live, in words, for the consent screen. A person
   agreeing to let AMV work on their machine should be told that a connector
   to their GitHub is part of what that now means. */
function mcpConsentLine(){
  const ids = Object.keys(MCP.live).filter(id => (MCP.live[id].tools || []).length);
  if(!ids.length) return '';
  const n = mcpTools().length;
  return 'Connected services: ' + ids.join(', ') + ' (' + n + ' tool' + (n === 1 ? '' : 's') + '). '
       + 'AMV can use these to act on those accounts.';
}
try{ window.mcpConsentLine=mcpConsentLine; }catch(e){}

try{ _mcpLoad(); }catch(e){}


/* ══════════════════════════════════════════════════════════════════════
   THE DOOR: connectors, under the computer they run on.

   Deliberately placed with the bridge rather than in its own tab. A
   connector without a machine cannot run at all, so a screen offering one
   while nothing is connected is a screen offering nothing - and this
   codebase has shipped several of those.
   ══════════════════════════════════════════════════════════════════════ */
function _mcpCardHTML(){
  const connected = !!(typeof BRIDGE !== 'undefined' && BRIDGE.connected);
  const rows = MCP.servers.map(sv => {
    const live = MCP.live[sv.id];
    const n = live && live.tools ? live.tools.length : 0;
    const state = !connected ? 'needs your computer'
                : live && live.error ? live.error
                : live ? (n + ' tool' + (n === 1 ? '' : 's') + ' ready')
                : 'not started';
    const cls = live && !live.error ? ' mcp-on' : live && live.error ? ' mcp-bad' : '';
    return '<div class="mcp-row' + cls + '">'
      + '<div class="mcp-row-m">'
        + '<b>' + escH(sv.id) + '</b>'
        + '<code>' + escH((sv.command + ' ' + (sv.args || []).join(' ')).slice(0, 90)) + '</code>'
        + '<span class="mcp-state">' + escH(state) + '</span>'
      + '</div>'
      + '<button class="btn bs mcp-del" type="button" data-mcp-del="' + escH(sv.id) + '">Remove</button>'
    + '</div>';
  }).join('');

  return '<div class="brg mcp">'
    + '<div class="brg-h"><b>Connectors</b></div>'
    + '<p class="brg-p">Anything that speaks MCP - GitHub, a database, your files, hundreds of '
      + 'services - runs on your computer and AMV can use it. It needs the bridge above, because '
      + 'a connector is a program and AMV is a browser tab.</p>'
    + (rows ? '<div class="mcp-rows">' + rows + '</div>'
            : '<p class="brg-p mcp-none">No connectors yet.</p>')
    + '<div class="mcp-form">'
      + '<label class="brg-l" for="mcp-id">Name</label>'
      + '<input class="brg-i" id="mcp-id" autocomplete="off" placeholder="github">'
      + '<label class="brg-l" for="mcp-cmd">Command</label>'
      + '<input class="brg-i brg-i-wide" id="mcp-cmd" autocomplete="off" placeholder="npx -y @modelcontextprotocol/server-github">'
      + '<label class="brg-l" for="mcp-env">Environment</label>'
      + '<input class="brg-i brg-i-wide" id="mcp-env" autocomplete="off" placeholder="GITHUB_TOKEN=…  (kept for this tab only, never saved)">'
      + '<button class="btn bp" id="mcp-add" type="button">Add</button>'
    + '</div>'
    + '<p class="mcp-note">The name and command are saved. Anything in Environment is kept for '
      + 'this tab only and is gone when you close it, because it is usually a credential.</p>'
    + '<div class="brg-msg" id="mcp-msg" role="status" aria-live="polite"></div>'
  + '</div>';
}
try{ window._mcpCardHTML=_mcpCardHTML; }catch(e){}

/* "npx -y pkg --flag" -> command plus argv, respecting quotes so a path with
   a space is one argument rather than two. */
function _mcpParseCommand(line){
  const parts = String(line || '').match(/"[^"]*"|'[^']*'|\S+/g) || [];
  const clean = parts.map(p => p.replace(/^["']|["']$/g, ''));
  return { command: clean[0] || '', args: clean.slice(1) };
}
function _mcpParseEnv(line){
  const env = {};
  for(const pair of String(line || '').split(/\s+/)){
    const i = pair.indexOf('=');
    if(i > 0) env[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return env;
}
try{ window._mcpParseCommand=_mcpParseCommand; window._mcpParseEnv=_mcpParseEnv; }catch(e){}

function _mcpWireCard(root){
  root = root || document;
  const say = (t, bad) => {
    const m = root.querySelector('#mcp-msg');
    if(m){ m.textContent = t; m.className = 'brg-msg' + (bad ? ' brg-bad' : ''); }
  };
  root.querySelectorAll('[data-mcp-del]').forEach(b => on(b, 'click', async () => {
    const id = b.dataset.mcpDel;
    try{ await _mcpStop(id); }catch(e){}
    _mcpRemove(id);
    try{ toast('Removed the "' + id + '" connector.', 'info', 3000); }catch(e){}
    try{ _refreshIntegrationsUI(); }catch(e){}
  }));

  const add = root.querySelector('#mcp-add');
  if(!add) return;
  on(add, 'click', async () => {
    const id = (root.querySelector('#mcp-id') || {}).value || '';
    const cmdLine = (root.querySelector('#mcp-cmd') || {}).value || '';
    const envLine = (root.querySelector('#mcp-env') || {}).value || '';
    const { command, args } = _mcpParseCommand(cmdLine);
    add.disabled = true;
    try{
      const realId = _mcpAdd(id, command, args, _mcpParseEnv(envLine));
      if(typeof BRIDGE !== 'undefined' && BRIDGE.connected){
        say('Starting ' + realId + '…');
        try{
          const live = await _mcpStart(realId);
          const n = (live.tools || []).length;
          say('');
          toast(realId + ' is ready with ' + n + ' tool' + (n === 1 ? '' : 's') + '.', 'success', 5000);
        }catch(e){
          /* Kept rather than discarded: the configuration is probably right
             and the machine is probably missing a package. Throwing the row
             away would make somebody retype it to find out. */
          MCP.live[realId] = { tools: [], info: null, error: String(e.message || e) };
          say(String(e.message || e), true);
        }
      } else {
        say('Saved. Connect your computer above and it will start.');
      }
      try{ _refreshIntegrationsUI(); }catch(e){}
    }catch(e){
      add.disabled = false;
      say(String(e.message || e), true);
    }
  });
  ['#mcp-id', '#mcp-cmd', '#mcp-env'].forEach(sel => {
    const el = root.querySelector(sel);
    if(el) on(el, 'keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); add.click(); } });
  });
}
try{ window._mcpWireCard=_mcpWireCard; }catch(e){}
