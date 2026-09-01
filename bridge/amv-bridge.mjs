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

     Root confinement on every path, resolved through symlinks. The folder
     you started it in is the whole world.

     Nothing is silently destructive: commands that delete, force-push, or
     reach outside the project are refused here, in the daemon, rather than
     being left to a prompt to remember.

   Run it with no arguments in a project folder:  node amv-bridge.mjs
   ══════════════════════════════════════════════════════════════════════════ */

import { createServer } from 'http';
import { spawn } from 'child_process';
import { realpathSync, existsSync, statSync, readFileSync, writeFileSync,
         mkdirSync, readdirSync } from 'fs';
import { resolve, join, dirname, relative, sep } from 'path';
import { randomBytes, timingSafeEqual } from 'crypto';

const VERSION = '1.0.0';

/* The folder AMV may touch. Resolved through symlinks once, at startup, so a
   link planted inside it later cannot widen the boundary. */
const ROOT = realpathSync(resolve(process.argv[2] || process.cwd()));

/* Origins allowed to talk to this bridge. A pairing code stops a random page
   using it; this stops a random page even trying, and keeps the browser's
   preflight honest. */
const ALLOWED_ORIGINS = new Set([
  'https://amv.homes',
  'https://www.amv.homes',
]);
/* Local development of AMV itself, opt-in, because it widens who may pair. */
if (process.env.AMV_BRIDGE_DEV === '1') {
  ALLOWED_ORIGINS.add('http://localhost:3000');
  ALLOWED_ORIGINS.add('http://127.0.0.1:3000');
}

/* Shown once, in the terminal. Six groups of four is long enough that
   guessing is hopeless and short enough that somebody will actually type it. */
const PAIR_CODE = randomBytes(12).toString('hex').toUpperCase().match(/.{4}/g).join('-');
/* Issued on a successful pair. The code is single-use; this is what every
   later request carries. */
let sessionToken = '';
let pairedAt = 0;

const MAX_BODY = 8 * 1024 * 1024;
const MAX_OUTPUT = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_TIMEOUT_MS = 900000;

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
const REFUSED = [
  [/(^|[;&|]\s*)rm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rf]/, 'a recursive or forced delete'],
  [/(^|[;&|]\s*)(shutdown|reboot|halt|poweroff)\b/, 'a shutdown'],
  [/\bmkfs(\.|\s)/, 'a filesystem format'],
  [/\bdd\s+.*of=\/dev\//, 'a raw write to a device'],
  [/>\s*\/dev\/(sd|nvme|disk)/, 'a raw write to a disk'],
  [/(^|[;&|]\s*)git\s+push\b[^\n]*--force(?!-with-lease)/, 'a force push'],
  [/(^|[;&|]\s*)sudo\b/, 'sudo'],
  [/(^|[;&|]\s*)(chown|chmod)\s+.*\s\//, 'a permission change outside the project'],
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

function refuseReason(cmd){
  for (const [re, why] of REFUSED) if (re.test(cmd)) return why;
  return '';
}

/* Every path AMV names is resolved and checked against the root. Resolved
   FIRST, then compared, because `a/../../etc` only looks like an escape once
   it has been normalised. */
function safePath(p){
  const abs = resolve(ROOT, String(p || '.'));
  /* The parent is resolved through symlinks so a link inside the project
     cannot point out of it; the leaf may not exist yet, which is the whole
     point of a write. */
  let base = abs;
  while (base !== dirname(base) && !existsSync(base)) base = dirname(base);
  const real = realpathSync(base);
  if (real !== ROOT && !real.startsWith(ROOT + sep)) {
    throw Object.assign(new Error('outside the project folder'), { code: 'outside_root' });
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
  const allowed = ALLOWED_ORIGINS.has(origin);

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
                            folder: ROOT.split(sep).pop(), paired: !!sessionToken });
  }

  if (!allowed) return json(res, 403, { error: 'origin_not_allowed' });

  if (path === '/amv-bridge/pair' && req.method === 'POST') {
    let body; try { body = await readBody(req); } catch (e) { return json(res, 400, { error: 'bad_body' }); }
    const given = String(body.code || '').trim().toUpperCase();
    const want = PAIR_CODE;
    const a = Buffer.from(given), b = Buffer.from(want);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      console.log('  ✗ a pairing attempt used the wrong code');
      return json(res, 403, { error: 'bad_code' });
    }
    sessionToken = randomBytes(32).toString('hex');
    pairedAt = Date.now();
    console.log('  ✓ paired with AMV');
    return json(res, 200, { token: sessionToken, folder: ROOT.split(sep).pop(), root: ROOT });
  }

  if (!tokenOk(req.headers['x-amv-bridge-token'])) return json(res, 401, { error: 'not_paired' });

  let body = {};
  if (req.method === 'POST') {
    try { body = await readBody(req); }
    catch (e) { return json(res, e.code === 'too_large' ? 413 : 400, { error: e.code || 'bad_body' }); }
  }

  try {
    if (path === '/amv-bridge/list') {
      const dir = safePath(body.path || '.');
      const out = readdirSync(dir, { withFileTypes: true })
        .filter(d => d.name !== '.git' && d.name !== 'node_modules')
        .slice(0, 2000)
        .map(d => ({ name: d.name, dir: d.isDirectory(),
                     size: d.isFile() ? statSync(join(dir, d.name)).size : 0 }));
      return json(res, 200, { path: relative(ROOT, dir) || '.', entries: out });
    }

    if (path === '/amv-bridge/read') {
      const file = safePath(body.path);
      const st = statSync(file);
      if (!st.isFile()) return json(res, 400, { error: 'not_a_file' });
      if (st.size > MAX_BODY) return json(res, 413, { error: 'too_large', size: st.size });
      return json(res, 200, { path: relative(ROOT, file), size: st.size,
                              content: readFileSync(file, 'utf8') });
    }

    if (path === '/amv-bridge/write') {
      const file = safePath(body.path);
      mkdirSync(dirname(file), { recursive: true });
      const content = String(body.content == null ? '' : body.content);
      writeFileSync(file, content, 'utf8');
      console.log('  · wrote ' + relative(ROOT, file) + ' (' + content.split('\n').length + ' lines)');
      return json(res, 200, { path: relative(ROOT, file), bytes: Buffer.byteLength(content) });
    }

    if (path === '/amv-bridge/exec') {
      const cmd = String(body.command || '').trim();
      if (!cmd) return json(res, 400, { error: 'no_command' });
      const why = refuseReason(cmd);
      if (why) {
        console.log('  ✗ refused: ' + why + '  (' + cmd.slice(0, 70) + ')');
        return json(res, 403, { error: 'refused', reason: why });
      }
      const cwd = safePath(body.cwd || '.');
      const timeout = Math.min(Number(body.timeout) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
      console.log('  $ ' + cmd);

      const started = Date.now();
      const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
      const args = process.platform === 'win32' ? ['/c', cmd] : ['-c', cmd];
      const child = spawn(shell, args, {
        cwd,
        /* The parent's environment, minus the bridge's own secrets. A command
           has no business reading the pairing token. */
        env: Object.assign({}, process.env, { AMV_BRIDGE_TOKEN: '', AMV_BRIDGE_DEV: '' }),
        /* ITS OWN PROCESS GROUP, so the timeout can kill the whole tree.

           Without this, kill reaches the shell and not what the shell
           started: `sh -c "sleep 30"` dies and `sleep 30` is orphaned and
           carries on. Measured, not assumed - the first version reported
           timedOut:true while the process was still running, which is the
           failure the timeout exists to prevent, wearing the label that says
           it did not happen. */
        detached: process.platform !== 'win32',
      });

      let out = '', err = '', truncated = false;
      const take = (buf, which) => {
        const s = buf.toString('utf8');
        if ((out.length + err.length) > MAX_OUTPUT) { truncated = true; return; }
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
        child.on('close', (code) => { clearTimeout(timer); resolveDone({ code, timedOut: false }); });
        child.on('error', (e) => { clearTimeout(timer); resolveDone({ code: -1, error: e.message }); });
      });

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
  console.log('  AMV can run commands, and read and write files, inside');
  console.log('  that folder and nowhere else. Close this window to stop.');
  console.log(line + '\n');
});

process.on('SIGINT', () => { console.log('\n  Bridge stopped. AMV can no longer reach this folder.\n'); process.exit(0); });
