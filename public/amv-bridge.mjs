#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   THE AMV BRIDGE - the machine AMV did not have.

   AMV runs in a browser tab and its server is a Cloudflare Worker. Neither
   can spawn a process, install a package, or hold a filesystem, so AMV could
   write code and never run it. Everything from "install the dependencies"
   through "deploy the backend" was waiting on this one absence.

   This is a small program you run yourself, in the folder you want AMV to
   work in. It listens on loopback only, and it hands AMV exactly four
   abilities inside that one folder: run a command, read a file, write a
   file, list a directory.

   WHY THE USER'S OWN MACHINE RATHER THAN A RENTED CONTAINER. It costs
   nothing per minute, so it can be on for everybody rather than metered. It
   is your real repository with your real toolchain, your real versions and
   your real GPU, so what AMV runs is what you would have run. And it starts
   and stops with a program you launched, which is a boundary you can see -
   there is no server somewhere holding a copy of your work.

   ── THE SECURITY MODEL, WHICH IS MOST OF THIS FILE ────────────────────────

   The threat is not AMV. The threat is that a program listening on your
   machine can be reached by ANY page in your browser, and by anything else
   on the loopback interface. So:

     Loopback only. Never 0.0.0.0. A bound port on a public interface is a
     remote shell for the coffee shop.

     A pairing code, shown in YOUR terminal, that has to be typed into AMV
     once. A page that has not been paired cannot do anything, so a malicious
     site that guesses the port still gets nothing.

     An allowlisted browser origin. Even paired, requests are refused unless
     they come from AMV.

     Root confinement on every FILE path, resolved through symlinks. The
     read, write, list and remove routes cannot name anything outside the
     folder you started it in.

     Nothing is silently destructive: commands that delete, force-push,
     format or fetch-and-run are refused here, in the daemon, rather than
     being left to a prompt to remember.

     But a command is not a path, and this is the boundary of the model:
     /exec hands the string to /bin/sh with cwd set to the root. The shell
     is the person's own shell with the person's own permissions, so a
     command CAN read and write outside the folder. That is not a hole to
     be patched with a path filter - `cat $(echo /etc/passwd)` defeats any
     such filter, and a filter that can be walked around is worse than none
     because it makes the promise look enforced. What holds instead is that
     nothing runs unpaired, nothing runs from an origin that is not AMV,
     every command is printed on this terminal as it runs, and AMV asks
     before running. Say that, rather than the stronger thing that is false.

   Run it with no arguments in a project folder:  node amv-bridge.mjs
   ══════════════════════════════════════════════════════════════════════════ */

import { createServer } from 'http';
import { spawn } from 'child_process';
import { realpathSync, existsSync, statSync, lstatSync, readlinkSync, readFileSync, writeFileSync,
         mkdirSync, readdirSync, unlinkSync, renameSync, chmodSync } from 'fs';
import { resolve, join, dirname, relative, sep } from 'path';
import { randomBytes, timingSafeEqual } from 'crypto';

const VERSION = '1.0.0';

/* The folder AMV may touch. Resolved through symlinks once, at startup, so a
   link planted inside it later cannot widen the boundary. */
const ARGS = process.argv.slice(2);
const ROOT = realpathSync(resolve(ARGS.find(a => !a.startsWith('--')) || process.cwd()));

/* WHAT A COMMAND SEES OF THIS COMPUTER'S ENVIRONMENT.  (AMV-AUD-005)

   Every command and every connector used to inherit the whole environment of
   the window the bridge was started in - which, on a developer's machine, is
   where the cloud keys, the API tokens, the npm auth token and the SSH agent
   live. A command AMV runs is chosen by a model, and a connector is a program
   somebody else wrote; neither should be handed those by default.

   So by default a child gets a short list of settings a build needs and no
   credential ever lives in: where programs are (PATH), where home and temp
   are, language, terminal, and the toolchain roots. A connector also gets the
   credentials typed into ITS OWN environment box - those were given to it on
   purpose. Anything else a command needs can be passed explicitly.

   The old behaviour is still there for somebody who wants it, named for what
   it does: start the bridge with --share-environment, and the banner and AMV's
   screen both say that everything in this window is visible to what AMV runs.

   What this does NOT do: keep a command from READING files - a key saved in a
   file under home is as reachable as before. That boundary is an isolated
   project copy, which is a bigger change; this closes the variables. */
const SHARE_ENV = ARGS.includes('--share-environment');
const ENV_ALLOW = new Set([
  'PATH', 'PATHEXT', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'USER', 'USERNAME', 'LOGNAME',
  'SHELL', 'COMSPEC', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'OS', 'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES',
  'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LANGUAGE',
  'TERM', 'COLORTERM', 'TZ', 'PWD', 'NODE_ENV', 'NVM_DIR', 'NVM_BIN', 'PYENV_ROOT', 'VIRTUAL_ENV',
  'CONDA_PREFIX', 'JAVA_HOME', 'GOPATH', 'GOROOT', 'CARGO_HOME', 'RUSTUP_HOME', 'DOTNET_ROOT',
  'ANDROID_HOME',
]);
const ENV_ALLOW_PREFIX = ['LC_', 'XDG_'];
function childEnv(extra) {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    const K = k.toUpperCase();                    // Windows names are case-insensitive
    if (SHARE_ENV || ENV_ALLOW.has(K) || ENV_ALLOW_PREFIX.some(p => K.startsWith(p))) out[k] = v;
  }
  if (extra && typeof extra === 'object') for (const k of Object.keys(extra)) out[k] = String(extra[k]);
  /* Never the bridge's own, whatever else is shared. */
  for (const k of Object.keys(out)) if (/^AMV_BRIDGE_/i.test(k)) delete out[k];
  return out;
}

/* Origins allowed to talk to this bridge. A pairing code stops a random page
   using it; this stops a random page even trying, and keeps the browser's
   preflight honest. */
const ALLOWED_ORIGINS = new Set([
  'https://amv.homes',
  'https://www.amv.homes',
]);
/* Local development of AMV itself, opt-in, because it widens who may pair.

   Any loopback port rather than a fixed one: AMV's own harness asks the
   kernel for a free port precisely so two runs cannot collide, so pinning
   3000 here meant the one thing this flag exists for did not work. Still
   loopback only, still behind an environment variable somebody has to set,
   and the pairing code is unchanged - this widens who may KNOCK. */
const DEV_ORIGINS = process.env.AMV_BRIDGE_DEV === '1';
const isLoopbackOrigin = (o) => /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(o);

/* Shown once, in the terminal. Six groups of four is long enough that
   guessing is hopeless and short enough that somebody will actually type it. */
const PAIR_CODE = randomBytes(12).toString('hex').toUpperCase().match(/.{4}/g).join('-');
/* Issued on a successful pair; this is what every later request carries.

   THE COMMENT HERE USED TO SAY "The code is single-use". It was not, and
   nothing made it so - the code stayed valid for the whole life of the daemon
   and could be used any number of times, each time silently replacing the
   token the previous pairing was using.

   Reusable is the RIGHT design and the claim was the thing that was wrong:
   the session token lives in sessionStorage, so closing the tab loses it, and
   a single-use code would mean restarting the daemon to carry on working. The
   trust model is that you must be able to see this terminal. So the code stays
   reusable and the two things that were actually missing are here instead.

   A guessing limit, because there was none at all: 96 bits is not brute
   forceable over a network, but a bridge with no attempt ceiling is one whose
   log fills with attempts nobody counted, and the ceiling is what turns that
   into a thing somebody notices.

   And a line on the terminal when an existing session is replaced. Re-pairing
   revokes whatever was connected before; if that was not you, this is the
   only place it would ever have shown. */
let sessionToken = '';
let pairedAt = 0;
const PAIR_MAX_FAILS = 5;
let pairFails = 0;

const MAX_BODY = 8 * 1024 * 1024;
const MAX_OUTPUT = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_TIMEOUT_MS = 900000;
const MIN_TIMEOUT_MS = 1000;
/* HOW MUCH MAY RUN AT ONCE, IN TOTAL.  (AMV-AUD-022)
   Every request was bounded - body, output, time - and nothing bounded how
   many there were. A page, a stuck loop or a model asking for twenty builds at
   once could start twenty, each within its own limits and together enough to
   take the machine. Work past the cap is REFUSED before anything is spawned,
   not queued: a queue on somebody's computer is work they did not see start. */
const EXEC_MAX_CONCURRENT = 4;
const MCP_MAX_PENDING = 16;      // requests in flight to one connector

/* ── COMMANDS THIS WILL NOT RUN ───────────────────────────────────────────
   Refused in the daemon, not in a prompt. A rule a model is asked to follow
   is a rule that holds until the model is confused or talked out of it; a
   rule here holds regardless of what reached the model.

   This is deliberately about the shapes that are irreversible or that reach
   outside the project, not a general attempt to sandbox a shell - somebody
   determined can always write a script and run it, and pretending otherwise
   would be the dangerous kind of comfort. The honest claim is: the obvious
   catastrophes are blocked, the folder is confined, and you can see the
   process in your own terminal. */
/* WHERE A DANGEROUS COMMAND IS ALLOWED TO START.

   These rules were anchored to `(^|[;&|]\s*)` - the beginning of the line,
   or straight after a shell separator. That is exactly one of the ways a
   command reaches a shell, and it let five of the seven catastrophic forms
   through:

     sh -c rm -rf /            the word is after "-c", not after a separator
     sh -c "rm -rf /"          and after a quote
     bash -lc "rm -rf ~"       and after a combined flag
     $(rm -rf /)               and inside a substitution
     `rm -rf /`                and inside a backtick

   `rm -rf /` was refused and every dressed-up version of it ran. That is
   worse than having no list, because the list is what everything else here
   says it can rely on.

   So the anchor is every position a command can actually begin: the start,
   after a separator or a bracket, after a backtick or `$(`, after a quote,
   and after a `-c`-style flag. It costs a false positive - `echo "rm -rf
   tmp"` is now refused as well - and that is the right side to be wrong on,
   because the message names the reason and the person can rephrase, while
   the other kind of wrong is somebody's home directory.

   This is still not a sandbox and the file has never claimed to be one:
   anybody determined can write a script and run that. It is a guard against
   the obvious catastrophe arriving by accident, and it now covers the
   obvious catastrophe wearing a quote. */
const AT = String.raw`(?:^|[;&|(){}\`]\s*|\$\(\s*|['"]\s*|\s-[a-zA-Z]*c\s+['"]?)`;
const at = (body, flags) => new RegExp(AT + body, flags);
const REFUSED = [
  [at(String.raw`rm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rf]`), 'a recursive or forced delete'],
  [at(String.raw`(shutdown|reboot|halt|poweroff)\b`), 'a shutdown'],
  [/\bmkfs(\.|\s)/, 'a filesystem format'],
  [/\bdd\s+.*of=\/dev\//, 'a raw write to a device'],
  [/>\s*\/dev\/(sd|nvme|disk)/, 'a raw write to a disk'],
  [at(String.raw`git\s+push\b[^\n]*--force(?!-with-lease)`), 'a force push'],
  [at(String.raw`sudo\b`), 'sudo'],
  [at(String.raw`(chown|chmod)\s+.*\s\/`), 'a permission change outside the project'],
  [/:\(\)\s*\{.*\}\s*;\s*:/, 'a fork bomb'],
  [/\bcurl\b[^\n]*\|\s*(ba)?sh/, 'piping a download straight into a shell'],
  [/\bwget\b[^\n]*\|\s*(ba)?sh/, 'piping a download straight into a shell'],
];
/* Kill a command and everything it started. A negative pid addresses the
   process GROUP, which is why the child is spawned detached; Windows has no
   equivalent, so taskkill walks the tree instead. */
function killTree(child){
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch (e) {
    /* Already gone, or never grouped. Falls back to the child alone rather
       than leaving it running because the group call failed. */
    try { child.kill('SIGKILL'); } catch (e2) {}
  }
}

/* ══════════════════════════════════════════════════════════════════════
   MCP: SPEAKING TO SERVERS SOMEBODY ELSE WROTE.

   The connectors people want from AMV number in the hundreds, and almost
   every one of them already has an MCP server published by somebody who
   knows that service far better than we do. Writing a hundred and fifty
   integrations by hand is a hundred and fifty things to keep working;
   speaking one protocol is one.

   An MCP server over stdio is a child process exchanging newline-delimited
   JSON-RPC on its stdin and stdout. A browser tab cannot hold one. This can,
   which is the whole reason the work lands here.

   WHAT IS BOUNDED, AND WHY EACH BOUND EXISTS.

     · Starting a server runs a command, so it goes through exactly the same
       refusal list as `/exec`. A route that runs arbitrary commands while
       calling itself something else is a hole with a nicer name.
     · A server count, so a page cannot start fifty processes.
     · A line length, because a server that never emits a newline would
       otherwise grow a buffer until the machine complains.
     · A per-request timeout, so one server that stops answering does not
       hold a request open for ever.
     · Everything is killed by tree when the daemon exits, the same way the
       exec timeout does it - a stdio server whose parent went away is a
       process nobody is left to stop.
   ══════════════════════════════════════════════════════════════════════ */
const MCP_MAX_SERVERS   = 8;
const MCP_MAX_LINE      = 4 * 1024 * 1024;
const MCP_TIMEOUT_MS    = 60000;
const MCP_STDERR_KEEP   = 8000;
const mcpServers = new Map();

function mcpKillAll(){
  for (const [, srv] of mcpServers) { try { killTree(srv.child); } catch (e) {} }
  mcpServers.clear();
}

/* ── CLOSING THE BRIDGE HAS TO STOP WHAT THE BRIDGE STARTED ────────────────

   The signal handler below killed MCP servers and nothing else, because those
   are the children something kept a list of. `/exec` spawns its child inside
   the route handler and lets the close event tidy up, so nothing outside that
   closure ever knew it existed - and a `npm run build`, a download or a long
   test run carried on after the daemon was gone. The request socket closed, so
   the person saw the command stop; the process did not.

   That makes closing the bridge an unreliable stop control, which is the one
   control somebody reaches for when they want AMV off their machine. "I closed
   it" has to mean it stopped.

   Two halves, and both are needed. Running jobs are TRACKED so they can be
   killed by tree - the same group kill the timeout already uses, so what the
   command itself started goes too. And once shutdown begins nothing new is
   ADMITTED, because a job accepted during teardown is an orphan created by the
   thing meant to prevent them. */
const execJobs = new Set();
let shuttingDown = false;

function execKillAll(){
  for (const child of execJobs) { try { killTree(child); } catch (e) {} }
  execJobs.clear();
}

/* Not only on a clean exit. A daemon killed with ^C is the ordinary way
   somebody stops this, and it is the case where an orphan is most likely. */
for (const sig of ['exit', 'SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    shuttingDown = true;
    execKillAll();
    mcpKillAll();
    if (sig !== 'exit') process.exit(0);
  });
}

function mcpStart(id, command, args, envExtra){
  const shell = false;
  const child = spawn(command, Array.isArray(args) ? args : [], {
    cwd: ROOT,
    /* The allowed environment plus the credentials typed in for THIS
       connector, and never the bridge's own - see childEnv. */
    env: childEnv(envExtra),
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    shell,
  });
  const srv = { id, child, command, stderr: '', pending: new Map(), nextId: 1,
                tools: [], info: null, exited: false,
                /* rev counts the tool lists this server has had; see mcpToolsChanged. */
                rev: 0, ready: false, refreshing: false, again: false };

  /* FRAMED IN BYTES, DECODED A WHOLE LINE AT A TIME.  (AMV-AUD-017)

     A chunk is wherever the pipe happened to cut, and that can be in the
     middle of a character: `€` is three bytes, and decoding each chunk on its
     own turned one split across two into three replacement characters -
     inside a tool result that was otherwise valid JSON, so nothing noticed.
     A newline byte can never occur inside a multi-byte UTF-8 sequence, so
     splitting the BYTES on it and decoding each complete line is exact.

     The size bound is on the line that is still incomplete, and only that.
     It used to be checked on the whole buffer before any line was taken out,
     so one large chunk holding several complete, valid replies was thrown
     away together. A line that really is over the bound is dropped up to its
     end - not merely truncated, which would parse its tail as a message - and
     whoever was waiting is told why, instead of waiting out the timeout. */
  let pending = [], pendingBytes = 0, discarding = false;
  const deliver = (line) => {
    if (!line) return;
    let msg; try { msg = JSON.parse(line); } catch (e) { return; }
    /* A response carries the id we sent. Anything else is a notification -
       progress, a log line, a tools-changed nudge - and is not what any
       caller is waiting on. */
    if (msg && msg.id != null && srv.pending.has(msg.id)) {
      const p = srv.pending.get(msg.id);
      srv.pending.delete(msg.id);
      clearTimeout(p.timer);
      p.resolve(msg);
    } else if (msg && msg.id == null && msg.method === 'notifications/tools/list_changed') {
      mcpToolsChanged(srv);
    }
  };
  child.stdout.on('data', (chunk) => {
    let from = 0, nl;
    while ((nl = chunk.indexOf(0x0a, from)) >= 0) {
      const piece = chunk.subarray(from, nl);
      from = nl + 1;
      if (discarding) { discarding = false; pending = []; pendingBytes = 0; continue; }
      const whole = pendingBytes ? Buffer.concat(pending.concat([piece])) : piece;
      pending = []; pendingBytes = 0;
      deliver(whole.toString('utf8').trim());
    }
    if (from >= chunk.length || discarding) return;
    const rest = chunk.subarray(from);
    pending.push(rest); pendingBytes += rest.length;
    if (pendingBytes > MCP_MAX_LINE) {
      /* A server producing an unbounded line is malfunctioning, and holding
         it in memory is how that becomes the machine's problem rather than
         its own. */
      pending = []; pendingBytes = 0; discarding = true;
      const why = 'the server sent a message over ' + Math.round(MCP_MAX_LINE / 1048576) + 'MB, which the bridge does not accept';
      srv.stderr = (srv.stderr + '\n[bridge] ' + why).slice(-MCP_STDERR_KEEP);
      for (const [, p] of srv.pending) { clearTimeout(p.timer); p.resolve({ error: { message: why } }); }
      srv.pending.clear();
    }
  });
  /* MCP servers log to stderr as a matter of course, so this is diagnostics
     rather than failure - kept short, and only the tail, because the useful
     part of a crash is always the end. */
  /* setEncoding keeps a decoder across chunks, so a character cut in two by
     the pipe arrives whole. */
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    srv.stderr = (srv.stderr + chunk).slice(-MCP_STDERR_KEEP);
  });
  const done = (why) => {
    srv.exited = true;
    for (const [, p] of srv.pending) { clearTimeout(p.timer); p.resolve({ error: { message: why } }); }
    srv.pending.clear();
  };
  child.on('error', (e) => done('could not start: ' + (e && e.message)));
  child.on('exit', (code) => done('the server exited (code ' + code + ')'));
  return srv;
}

function mcpSend(srv, method, params){
  return new Promise((resolve) => {
    if (srv.exited) return resolve({ error: { message: 'the server is not running' } });
    /* A connector that stops answering must not collect an unbounded pile of
       requests, each holding a timer and a waiting page. (AMV-AUD-022) */
    if (srv.pending.size >= MCP_MAX_PENDING) {
      return resolve({ error: { message: 'the connector already has ' + MCP_MAX_PENDING + ' requests waiting; try again when it answers' } });
    }
    const id = srv.nextId++;
    const timer = setTimeout(() => {
      srv.pending.delete(id);
      resolve({ error: { message: 'the server did not answer in ' + MCP_TIMEOUT_MS + 'ms' } });
    }, MCP_TIMEOUT_MS);
    srv.pending.set(id, { resolve, timer });
    try {
      srv.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n');
    } catch (e) {
      srv.pending.delete(id); clearTimeout(timer);
      resolve({ error: { message: 'could not write to the server: ' + (e && e.message) } });
    }
  });
}
/* Every page of tools/list, or the reason there is not one. */
const MCP_LIST_PAGES = 20;
const MCP_LIST_TOOLS = 500;
async function mcpListTools(srv){
  const tools = [];
  const seen = new Set();
  let cursor;
  for (let page = 0; page < MCP_LIST_PAGES; page++) {
    const r = await mcpSend(srv, 'tools/list', cursor === undefined ? {} : { cursor });
    if (r.error) return { error: 'listing its tools failed: ' + (r.error.message || 'the server returned an error') };
    const res = r.result;
    if (!res || typeof res !== 'object' || !Array.isArray(res.tools)) {
      return { error: 'the server answered the tool listing with something that is not one' };
    }
    for (const t of res.tools) if (t && typeof t === 'object' && typeof t.name === 'string' && t.name) tools.push(t);
    if (tools.length > MCP_LIST_TOOLS) return { error: 'the server lists more than ' + MCP_LIST_TOOLS + ' tools' };
    const next = res.nextCursor;
    if (next === undefined || next === null || next === '') return { tools };
    const key = String(next);
    if (seen.has(key)) return { error: 'the server handed back a page cursor it had already given, so its listing never ends' };
    seen.add(key);
    cursor = next;
  }
  return { error: 'the server lists its tools over more than ' + MCP_LIST_PAGES + ' pages' };
}
/* A SERVER THAT SAYS ITS TOOLS CHANGED IS LISTED AGAIN.

   The list used to be read once, at start, and a server that changed what it
   offers mid-session - one tool per open project, tools unlocked by signing
   in - was seen only at the next pairing. Now the announcement is followed by
   a fresh listing, under the same bounds as the first (pages, tools, cursors),
   and `rev` goes up so the page knows to take the new list.

   One listing at a time: announcements that arrive while one is running are
   folded into a single re-run, so a server announcing fifty times costs two
   listings, not fifty. Before the start's own listing has finished, an
   announcement only marks the list as due - the start is about to read it.

   A listing that fails keeps the list it had and says so in the server's log:
   the tools that were there may still work, and throwing them away would turn
   a server's bad moment into every tool vanishing. */
function mcpToolsChanged(srv){
  if (srv.exited) return;
  if (!srv.ready || srv.refreshing) { srv.again = true; return; }
  srv.refreshing = true;
  (async () => {
    do {
      srv.again = false;
      const found = await mcpListTools(srv);
      if (srv.exited) break;
      if (found.error) {
        srv.stderr = (srv.stderr + '\n[bridge] the server said its tools changed, and ' + found.error).slice(-MCP_STDERR_KEEP);
      } else {
        srv.tools = found.tools;
        srv.rev++;
      }
    } while (srv.again && !srv.exited);
    srv.refreshing = false;
  })().catch(() => { srv.refreshing = false; });
}
function mcpNotify(srv, method, params){
  try { srv.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params: params || {} }) + '\n'); }
  catch (e) {}
}

function refuseReason(cmd){
  for (const [re, why] of REFUSED) if (re.test(cmd)) return why;
  return '';
}

/* Every path AMV names is resolved and checked against the root. Resolved
   FIRST, then compared, because `a/../../etc` only looks like an escape once
   it has been normalised. */
const _outside = () =>
  Object.assign(new Error('outside the project folder'), { code: 'outside_root' });

/* Is this resolved location inside the root? The nearest EXISTING ancestor is
   what gets realpath'd, because the leaf of a write does not exist yet. */
function _insideRoot(abs){
  let base = abs;
  while (base !== dirname(base) && !existsSync(base)) base = dirname(base);
  const real = realpathSync(base);
  return real === ROOT || real.startsWith(ROOT + sep);
}

function safePath(p){
  const abs = resolve(ROOT, String(p || '.'));
  /* The parent is resolved through symlinks so a link inside the project
     cannot point out of it; the leaf may not exist yet, which is the whole
     point of a write. */
  if (!_insideRoot(abs)) throw _outside();

  /* A DANGLING SYMLINK IS NOT AN ABSENT LEAF, AND THAT IS HOW WRITES GOT OUT.

     `existsSync` FOLLOWS the link. So a link inside the project whose target
     does not exist yet reads as "nothing here", the walk above steps straight
     over it to the parent, the parent is inside the root, and the check
     passes - and then `writeFileSync` follows the link and lands wherever it
     points. Measured against the running daemon: `write` to such a link
     answered 200 and created the file OUTSIDE the root, while `read` of the
     very same path answered 403 once the target existed. Read and write
     disagreeing about one path is the whole bug; read was right.

     Nor did it need a second way in. `ln -s` is not on the refusal list, so
     `exec` plants the link and `write` walks through it - both routes the page
     already drives.

     So the LEAF is examined with `lstat`, which does not follow, and a link is
     followed by hand to where it really goes. Symlinks that stay inside the
     project keep working; a chain is walked rather than trusted, because a
     link may point at another link. */
  /* EVERY COMPONENT, not just the leaf. A dangling link one directory UP is
     the same trick one level higher: `proj/outLater/file.txt` where `outLater`
     is a link to a directory that does not exist yet. The leaf is not a link,
     so a leaf-only walk sees nothing, and the `existsSync` walk steps over
     `outLater` for the same reason it stepped over a dangling leaf. That one
     happened to fail at `mkdir` rather than escape - which is luck, not a
     guard, and luck stops holding the moment the target directory exists. */
  const rel = relative(ROOT, abs);
  let cur = ROOT;
  for (const part of (rel ? rel.split(sep) : [])) {
    cur = join(cur, part);
    let hops = 0, at = cur;
    for (;;) {
      let st = null;
      try { st = lstatSync(at); } catch (e) { break; }  // nothing there: done
      if (!st.isSymbolicLink()) break;
      if (++hops > 12) throw _outside();                 // a loop, or deep enough to be one
      at = resolve(dirname(at), readlinkSync(at));
      if (!_insideRoot(at)) throw _outside();
    }
  }
  return abs;
}

const json = (res, status, body) => {
  const s = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(s),
    'Cache-Control': 'no-store',
  });
  res.end(s);
};

/* Compared in constant time. A token check that returns early leaks the
   token one character at a time to anything that can measure. */
function tokenOk(given){
  if (!sessionToken || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(sessionToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req){
  return new Promise((res, rej) => {
    let n = 0; const chunks = [];
    req.on('data', c => {
      n += c.length;
      if (n > MAX_BODY) { rej(Object.assign(new Error('too large'), { code: 'too_large' })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { res(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { rej(e); } });
    req.on('error', rej);
  });
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const allowed = ALLOWED_ORIGINS.has(origin) || (DEV_ORIGINS && isLoopbackOrigin(origin));

  /* CORS, and Chrome's private-network preflight with it: a page on the
     public internet reaching a loopback server has to be granted that
     explicitly, and answering the preflight is how this says yes to AMV and
     nothing else. */
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AMV-Bridge-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.headers['access-control-request-private-network']) {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
  }
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.writeHead(allowed ? 204 : 403); res.end(); return; }

  const url = new URL(req.url, 'http://127.0.0.1');
  const path = url.pathname;

  /* The one route that answers before pairing, so AMV can tell a bridge is
     there and offer to connect. It says nothing about the machine beyond the
     folder's own name - not its path, which is somebody's home directory and
     often their real name. */
  if (path === '/amv-bridge/hello' && req.method === 'GET') {
    return json(res, 200, { bridge: true, version: VERSION,
                            folder: ROOT.split(sep).pop(), paired: !!sessionToken,
                            sharesEnvironment: SHARE_ENV });
  }

  if (!allowed) return json(res, 403, { error: 'origin_not_allowed' });

  if (path === '/amv-bridge/pair' && req.method === 'POST') {
    let body; try { body = await readBody(req); } catch (e) { return json(res, 400, { error: 'bad_body' }); }
    if (pairFails >= PAIR_MAX_FAILS) {
      return json(res, 429, { error: 'too_many_attempts',
                              detail: 'Too many wrong codes. Stop the bridge and start it again to pair.' });
    }
    const given = String(body.code || '').trim().toUpperCase();
    const want = PAIR_CODE;
    const a = Buffer.from(given), b = Buffer.from(want);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      pairFails++;
      const left = PAIR_MAX_FAILS - pairFails;
      console.log('  ✗ a pairing attempt used the wrong code' +
                  (left > 0 ? ` (${left} left before pairing is locked)` : ' - pairing is now locked, restart the bridge'));
      return json(res, 403, { error: 'bad_code', attemptsLeft: Math.max(0, left) });
    }
    /* A correct code clears the count: the failures were somebody typing it
       wrong, which is the common case, and holding those against them after
       they get it right would lock the person who owns the terminal out. */
    pairFails = 0;
    const replaced = !!sessionToken;
    sessionToken = randomBytes(32).toString('hex');
    pairedAt = Date.now();
    console.log(replaced
      ? '  ✓ paired with AMV - the previous session was disconnected'
      : '  ✓ paired with AMV');
    return json(res, 200, { token: sessionToken, folder: ROOT.split(sep).pop(), root: ROOT, replaced,
                            sharesEnvironment: SHARE_ENV });
  }

  if (!tokenOk(req.headers['x-amv-bridge-token'])) return json(res, 401, { error: 'not_paired' });

  let body = {};
  if (req.method === 'POST') {
    try { body = await readBody(req); }
    catch (e) { return json(res, e.code === 'too_large' ? 413 : 400, { error: e.code || 'bad_body' }); }
  }

  /* ── DISCONNECT HAS TO REACH THE MACHINE ──────────────────────────────────

     Disconnect cleared the browser's copy of the token and made no request at
     all. So the daemon kept the session valid, kept running connectors alive,
     and kept accepting work from anything that still held that token from an
     allowed origin - while the screen said disconnected. Re-pairing replaced
     the token and stopping the daemon ended it; the button did neither.

     That is the gap between "I disconnected" and "AMV is off my machine", and
     it is the sentence the button is making.

     Revoking is deliberately total: the session is cleared, running commands
     are killed by process group, and connectors are stopped. There is no
     partial disconnect here - a connector left running is a program somebody
     else wrote, still on their computer, after they said stop.

     It is authenticated by the token it is about to destroy, so only the
     session that owns it can end it, and it is idempotent: a second call from
     a token that is already gone is refused as not_paired, which is the
     honest answer rather than an error. */
  if (path === '/amv-bridge/revoke') {
    const hadSession = !!sessionToken;
    sessionToken = '';
    pairedAt = 0;
    const jobs = execJobs.size, servers = mcpServers.size;
    execKillAll();
    mcpKillAll();
    console.log('  ✓ disconnected by AMV - session ended'
      + (jobs || servers ? ' (' + jobs + ' command' + (jobs === 1 ? '' : 's')
          + ' and ' + servers + ' connector' + (servers === 1 ? '' : 's') + ' stopped)' : ''));
    /* Counted back, so the page can say what actually stopped rather than
       claiming a clean disconnect it did not observe. */
    return json(res, 200, { revoked: true, wasPaired: hadSession, stopped: { jobs, servers } });
  }

  try {
    /* What is running, in numbers - so a page that is refused as busy can say
       what it is waiting for, and a person can see it. */
    if (path === '/amv-bridge/status') {
      return json(res, 200, {
        exec: { running: execJobs.size, max: EXEC_MAX_CONCURRENT },
        mcp: [...mcpServers.values()].map(v => ({ id: v.id, running: !v.exited, pending: v.pending.size, maxPending: MCP_MAX_PENDING })),
      });
    }
    if (path === '/amv-bridge/list') {
      const dir = safePath(body.path || '.');
      const out = readdirSync(dir, { withFileTypes: true })
        .filter(d => d.name !== '.git' && d.name !== 'node_modules')
        .slice(0, 2000)
        .map(d => ({ name: d.name, dir: d.isDirectory(),
                     size: d.isFile() ? statSync(join(dir, d.name)).size : 0 }));
      return json(res, 200, { path: relative(ROOT, dir) || '.', entries: out });
    }

    /* ON "not_found", WHICH THIS ROUTE DOES NOT HAVE TO SPELL OUT.

       A missing path throws ENOENT out of `statSync`, and the handler at the
       bottom of this function already turns that into 404 `not_found` - so
       absence has always been distinguishable from any other failure ON THE
       WIRE. A version of this fix added a second ENOENT check right here
       before anybody checked whether one was needed; it was redundant, and two
       places deciding one thing is how they come to disagree.

       Recorded because an audit reported the opposite and the report was
       wrong, which is worth knowing the next time this route is read: the gap
       was entirely in the BROWSER, where `_bridgeCall` threw a plain Error
       carrying no code, so the caller could not act on the 404 it was already
       being sent and collapsed every failure into "the file is not there". */
    /* A HARD LINK IS ONE FILE WITH TWO NAMES, AND ONLY ONE NAME IS INSIDE.
       (AMV-AUD-021)

       Every check above is about NAMES - is this path inside the folder, does
       a link along it point out. A hard link passes all of them: its name is
       inside, it is not a symlink, and its contents are the same bytes as a
       file somewhere else entirely. Reading it read that file; writing it
       rewrote that file.

       Reads of a file with more than one name are refused, since there is no
       asking where the other name lives. Writes do not write INTO the file at
       all: they write a new file beside it and rename it into place, so the
       name inside the folder gets new contents and the other name keeps the
       old ones - the shared bytes are never touched. That is also a write that
       cannot be left half-done by a crash.

       These are checks on paths, made and then acted on; a process racing the
       daemon between the two is not something path checks can stop. The
       boundary against that is the isolated project copy AMV-AUD-001
       describes, which is the owner's decision. */
    if (path === '/amv-bridge/read') {
      const file = safePath(body.path);
      const st = statSync(file);
      if (!st.isFile()) return json(res, 400, { error: 'not_a_file' });
      if (st.nlink > 1) return json(res, 403, { error: 'hard_linked',
        message: 'That file is also reachable under another name, possibly outside the folder (a hard link), so the bridge will not read it.' });
      if (st.size > MAX_BODY) return json(res, 413, { error: 'too_large', size: st.size });
      return json(res, 200, { path: relative(ROOT, file), size: st.size,
                              content: readFileSync(file, 'utf8') });
    }

    if (path === '/amv-bridge/write') {
      const file = safePath(body.path);
      mkdirSync(dirname(file), { recursive: true });
      const content = String(body.content == null ? '' : body.content);
      /* A symlink that stays inside is written THROUGH, as before - to where
         it points, which safePath has already checked is inside. Followed by
         hand rather than with realpath, because realpath fails on a link whose
         target does not exist yet, and writing one of those has always
         created the file it points at. */
      let target = file;
      for (let hops = 0; hops < 12; hops++) {
        let lst = null;
        try { lst = lstatSync(target); } catch (e) { break; }
        if (!lst.isSymbolicLink()) break;
        target = resolve(dirname(target), readlinkSync(target));
      }
      if (target !== file) mkdirSync(dirname(target), { recursive: true });
      let mode = null;
      try { const was = statSync(target); if (was.isFile()) mode = was.mode & 0o7777; } catch (e) {}
      const tmp = join(dirname(target), '.' + target.split(sep).pop() + '.amv-' + randomBytes(6).toString('hex'));
      try {
        writeFileSync(tmp, content, 'utf8');
        if (mode !== null) chmodSync(tmp, mode);     // an executable script stays executable
        renameSync(tmp, target);
      } catch (e) {
        try { unlinkSync(tmp); } catch (e2) {}
        throw e;
      }
      console.log('  · wrote ' + relative(ROOT, file) + ' (' + content.split('\n').length + ' lines)');
      return json(res, 200, { path: relative(ROOT, file), bytes: Buffer.byteLength(content) });
    }

    /* UNDO NEEDS THIS, AND NOTHING ELSE DOES.

       A build turn that creates a file and is then undone has to be able to
       remove it, or "undo" means "put back what was edited and leave the rest
       lying around" - which is the half-undo this repository has been careful
       to avoid everywhere else.

       Bounded to exactly that job. One file at a time, never a directory, and
       inside the same root as everything else - so this is strictly less power
       than `write`, which can already empty any file in the folder. A path
       that is not there is answered as done rather than as an error, because
       the state the caller wanted is the state it is in. */
    if (path === '/amv-bridge/delete') {
      const file = safePath(body.path);
      let st = null;
      try { st = statSync(file); } catch (e) { return json(res, 200, { path: relative(ROOT, file), removed: false }); }
      if (!st.isFile()) return json(res, 400, { error: 'not_a_file' });
      unlinkSync(file);
      console.log('  · removed ' + relative(ROOT, file));
      return json(res, 200, { path: relative(ROOT, file), removed: true });
    }

    /* ── MCP ROUTES ───────────────────────────────────────────────────
       Start a server, ask it things, stop it. The handshake is done here
       rather than in the page, because it is protocol bookkeeping the caller
       should not have to repeat and getting it wrong leaves a half-open
       server that answers nothing. */
    if (path === '/amv-bridge/mcp/start') {
      const id = String(body.id || '').slice(0, 64);
      const command = String(body.command || '').trim();
      if (!id || !command) return json(res, 400, { error: 'need_id_and_command' });
      if (mcpServers.has(id)) return json(res, 409, { error: 'already_running', id });
      if (mcpServers.size >= MCP_MAX_SERVERS) return json(res, 429, { error: 'too_many_servers', max: MCP_MAX_SERVERS });

      /* THE SAME REFUSALS AS EXEC. Starting a connector is running a command,
         and a route that runs commands under a friendlier name is a hole with
         a friendlier name. The full line is checked, arguments included. */
      const args = Array.isArray(body.args) ? body.args.map(a => String(a)) : [];
      const why = refuseReason([command].concat(args).join(' '));
      if (why) {
        console.log('  ✗ refused an MCP server: ' + why);
        return json(res, 403, { error: 'refused', reason: why });
      }
      /* Its environment may carry a connector's own credentials. They are
         written into the child and never read back out by any route here. */
      const envExtra = {};
      if (body.env && typeof body.env === 'object') {
        for (const k of Object.keys(body.env).slice(0, 40)) envExtra[String(k)] = String(body.env[k]);
      }

      const srv = mcpStart(id, command, args, envExtra);
      mcpServers.set(id, srv);
      console.log('  · started MCP server "' + id + '": ' + command + ' ' + args.join(' '));

      const init = await mcpSend(srv, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'AMV', version: VERSION },
      });
      /* A result that is not an object is not a handshake, whatever it says.
         Carrying on would advertise a server nobody knows the capabilities
         of. (AMV-AUD-018) */
      const initBad = init.error ? (init.error.message || 'the server refused the handshake')
        : (!init.result || typeof init.result !== 'object' || Array.isArray(init.result))
          ? 'the server answered the handshake with something that is not a handshake' : '';
      if (initBad) {
        killTree(srv.child); mcpServers.delete(id);
        return json(res, 502, { error: 'handshake_failed', message: initBad,
                                stderr: srv.stderr.slice(-1200) });
      }
      /* The spec requires this after initialize, and a server that does not
         get it is entitled to answer nothing afterwards. */
      mcpNotify(srv, 'notifications/initialized', {});
      srv.info = (init.result && init.result.serverInfo) || null;

      /* DISCOVERY IS PART OF STARTING, SO ITS FAILURE IS A FAILED START.
         (AMV-AUD-018)

         An error from tools/list used to become a successful start with no
         tools - indistinguishable, on the screen, from a server that really
         offers nothing - and a listing that came in pages returned only the
         first. Now every page is followed, bounded in pages and in tools, a
         cursor handed back twice is refused rather than followed for ever,
         and any of these ends the start with the reason. */
      const found = await mcpListTools(srv);
      if (found.error) {
        killTree(srv.child); mcpServers.delete(id);
        return json(res, 502, { error: 'discovery_failed', message: found.error,
                                stderr: srv.stderr.slice(-1200) });
      }
      srv.tools = found.tools;
      srv.ready = true;
      if (srv.again) mcpToolsChanged(srv);
      return json(res, 200, { id, info: srv.info, rev: srv.rev,
                              capabilities: (init.result && init.result.capabilities) || {},
                              tools: srv.tools });
    }

    if (path === '/amv-bridge/mcp/call') {
      const srv = mcpServers.get(String(body.id || ''));
      if (!srv) return json(res, 404, { error: 'no_such_server' });
      const method = String(body.method || '');
      if (!/^[a-z][a-zA-Z0-9_/]{1,40}$/.test(method)) return json(res, 400, { error: 'bad_method' });
      const out = await mcpSend(srv, method, body.params || {});
      if (out.error) return json(res, 502, { error: 'server_error',
                                             message: out.error.message || 'the server returned an error',
                                             stderr: srv.stderr.slice(-1200) });
      return json(res, 200, { result: out.result });
    }

    if (path === '/amv-bridge/mcp/stop') {
      const id = String(body.id || '');
      const srv = mcpServers.get(id);
      if (!srv) return json(res, 200, { id, stopped: false });
      killTree(srv.child);
      mcpServers.delete(id);
      console.log('  · stopped MCP server "' + id + '"');
      return json(res, 200, { id, stopped: true });
    }

    if (path === '/amv-bridge/mcp/list') {
      return json(res, 200, { servers: [...mcpServers.values()].map(s => ({
        id: s.id, command: s.command, info: s.info, running: !s.exited, rev: s.rev,
        tools: s.tools.map(t => t.name) })) });
    }

    /* The whole current list, for a page whose copy is behind (a lower rev). */
    if (path === '/amv-bridge/mcp/tools') {
      const srv = mcpServers.get(String(body.id || ''));
      if (!srv) return json(res, 404, { error: 'no_such_server' });
      return json(res, 200, { id: srv.id, rev: srv.rev, tools: srv.tools });
    }

    if (path === '/amv-bridge/exec') {
      /* Refused rather than queued. A command admitted while the daemon is
         tearing down is an orphan made by the teardown. */
      if (shuttingDown) return json(res, 503, { error: 'shutting_down' });
      const cmd = String(body.command || '').trim();
      if (!cmd) return json(res, 400, { error: 'no_command' });
      const why = refuseReason(cmd);
      if (why) {
        console.log('  ✗ refused: ' + why + '  (' + cmd.slice(0, 70) + ')');
        return json(res, 403, { error: 'refused', reason: why });
      }
      if (execJobs.size >= EXEC_MAX_CONCURRENT) {
        return json(res, 429, { error: 'busy', running: execJobs.size, max: EXEC_MAX_CONCURRENT });
      }
      const cwd = safePath(body.cwd || '.');
      /* A number, positive and finite, or the default. `Number(-5) || x` is
         -5, and a negative timeout fired at once and killed the command the
         moment it started. */
      const asked = Number(body.timeout);
      const timeout = (Number.isFinite(asked) && asked > 0)
        ? Math.min(Math.max(asked, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
      console.log('  $ ' + cmd);

      const started = Date.now();
      const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
      const args = process.platform === 'win32' ? ['/c', cmd] : ['-c', cmd];
      const child = spawn(shell, args, {
        cwd,
        /* The allowed environment only - see childEnv. */
        env: childEnv(null),
        /* ITS OWN PROCESS GROUP, so the timeout can kill the whole tree.

           Without this, kill reaches the shell and not what the shell
           started: `sh -c "sleep 30"` dies and `sleep 30` is orphaned and
           carries on. Measured, not assumed - the first version reported
           timedOut:true while the process was still running, which is the
           failure the timeout exists to prevent, wearing the label that says
           it did not happen. */
        detached: process.platform !== 'win32',
      });
      /* Tracked BEFORE anything awaits it, so a shutdown landing between the
         spawn and the first await still finds it. Registering after the await
         would leave exactly the window this exists to close. */
      execJobs.add(child);

      let out = '', err = '', truncated = false;
      /* One decoder per stream, kept across chunks: decoding each chunk alone
         turns a character the pipe cut in two into replacement characters,
         in output a person reads and a model edits code from. (AMV-AUD-017) */
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      /* Counted in BYTES, which is what the bound is for - memory held here
         and bytes sent back - rather than in characters, which undercount any
         text that is not ASCII by up to four times. */
      let outBytes = 0;
      const take = (s, which) => {
        if (truncated) return;
        const n = Buffer.byteLength(s, 'utf8');
        if (outBytes + n > MAX_OUTPUT) { truncated = true; return; }
        outBytes += n;
        if (which === 'o') out += s; else err += s;
      };
      child.stdout.on('data', b => take(b, 'o'));
      child.stderr.on('data', b => take(b, 'e'));

      const done = await new Promise((resolveDone) => {
        const timer = setTimeout(() => {
          /* The whole group. A build that hangs would otherwise hold the
             folder - and everything it started - until somebody noticed and
             went looking with a task manager. */
          killTree(child);
          resolveDone({ code: null, timedOut: true });
        }, timeout);
        child.on('close', (code) => { clearTimeout(timer); execJobs.delete(child); resolveDone({ code, timedOut: false }); });
        child.on('error', (e) => { clearTimeout(timer); execJobs.delete(child); resolveDone({ code: -1, error: e.message }); });
      });
      /* Belt and braces: a path that resolved without either event firing
         would otherwise leave a dead child in the set for ever, and a set that
         grows is a shutdown that gets slower every run. */
      execJobs.delete(child);

      return json(res, 200, {
        command: cmd, cwd: relative(ROOT, cwd) || '.',
        exitCode: done.code, timedOut: !!done.timedOut, error: done.error || '',
        ms: Date.now() - started, truncated,
        stdout: out.slice(0, MAX_OUTPUT), stderr: err.slice(0, MAX_OUTPUT),
      });
    }

    return json(res, 404, { error: 'unknown_route' });
  } catch (e) {
    if (e.code === 'outside_root') return json(res, 403, { error: 'outside_root' });
    if (e.code === 'ENOENT') return json(res, 404, { error: 'not_found' });
    return json(res, 500, { error: 'failed', message: String(e.message || e).slice(0, 200) });
  }
});

/* Port zero: the operating system picks a free one and tells us. A fixed
   port is a port that is already taken on somebody's machine, and it is also
   the port a hostile page would guess first. */
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  const line = '═'.repeat(52);
  console.log('\n' + line);
  console.log('  AMV Bridge ' + VERSION + '  ·  ready');
  console.log(line);
  console.log('  Folder   ' + ROOT);
  console.log('  Port     ' + port + '  (127.0.0.1 only)');
  console.log('\n  In AMV, choose Connect this computer and enter:\n');
  console.log('      ' + PAIR_CODE + '\n');
  /* WORDED FROM WHAT THE CODE ACTUALLY ENFORCES. This used to say "and
     nowhere else", which is true of the file routes and is NOT true of
     /exec: a command is handed to /bin/sh with cwd set to the folder, and a
     shell can read and write anything the person running it can. Verified,
     not assumed - `cat ../secret` and `head /etc/passwd` both came back with
     content while /read refused the same path. The sentence somebody reads
     while deciding whether to grant this has to be the weaker true one. */
  console.log('  AMV reads and writes files inside that folder and nowhere');
  console.log('  else. Commands run there as you, so a command can reach');
  console.log('  anything you can - every one is printed below as it runs.');
  if (SHARE_ENV) {
    console.log('\n  !! --share-environment is ON: every command and connector');
    console.log('     can read ALL of this window\'s environment variables,');
    console.log('     including any keys or tokens set in it.');
  } else {
    console.log('\n  Commands get your PATH and basic settings, none of this');
    console.log('  window\'s keys or tokens. To share everything, restart with');
    console.log('  --share-environment.');
  }
  console.log('  Close this window to stop.');
  console.log(line + '\n');
});

process.on('SIGINT', () => { console.log('\n  Bridge stopped. AMV can no longer reach this folder.\n'); process.exit(0); });
