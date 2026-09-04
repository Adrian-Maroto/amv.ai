/* THE BRIDGE'S PAIRING CODE HAD NO ATTEMPT LIMIT, AND ITS COMMENT SAID IT WAS
   SINGLE-USE WHEN NOTHING MADE IT SO.

   The bridge is the most dangerous program in this repository: it runs shell
   commands on somebody's own machine. Everything that reaches it goes through
   one gate - the code printed in their terminal - and that gate had no ceiling
   on wrong answers at all. Ninety-six bits is not brute forceable over a
   network, so this is not a break; it is the absence of the thing that turns
   an attack into something a person NOTICES, on the one surface where noticing
   is the whole defence.

   The comment beside the code said "The code is single-use". It was not. It
   stayed valid for the life of the daemon and could be used any number of
   times, each use silently replacing the token the previous pairing held.

   Reusable is the right design - the session token lives in sessionStorage, so
   closing the tab loses it and a single-use code would mean restarting the
   daemon to carry on - so the claim was what was wrong, not the behaviour.
   What was actually missing is here: a ceiling on wrong codes, and a line on
   the terminal when re-pairing disconnects an existing session, which is the
   only place that would ever have shown. */
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const ORIGIN = 'https://amv.homes';

const box = mkdtempSync(join(tmpdir(), 'amv-pair-'));
const proj = join(box, 'project');
mkdirSync(proj, { recursive: true });
writeFileSync(join(proj, 'hello.txt'), 'inside\n');

const child = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), proj],
                    { stdio: ['ignore', 'pipe', 'pipe'] });
let banner = '';
child.stdout.on('data', b => { banner += b.toString(); });
child.stderr.on('data', b => { banner += b.toString(); });
/* Killed however this file ends. A daemon that can run shell commands must not
   outlive the test that started it - least of all the test about its gate. */
const killBridge = () => { try { child.kill('SIGKILL'); } catch (e) {} };
process.on('exit', killBridge);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { killBridge(); process.exit(1); });
process.on('uncaughtException', (e) => { killBridge(); throw e; });

const waitFor = async (re, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { const m = banner.match(re); if (m) return m; await new Promise(r => setTimeout(r, 60)); }
  return null;
};
const portM = await waitFor(/Port\s+(\d+)/, 8000);
const codeM = await waitFor(/([0-9A-F]{4}(?:-[0-9A-F]{4}){5})/, 8000);
const PORT = portM ? portM[1] : '0';
const CODE = codeM ? codeM[1] : '';
const base = 'http://127.0.0.1:' + PORT;
const pair = (code) => fetch(base + '/amv-bridge/pair', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
  body: JSON.stringify({ code }) });
const jsonOf = async (r) => { try { return await r.json(); } catch (e) { return {}; } };

try {
  ok(!!PORT && Number(PORT) > 0, 'the bridge is listening', PORT);
  ok(!!CODE, 'and printed a code', CODE ? CODE.slice(0, 9) + '…' : '');

  section('A wrong code is refused, and says how many tries are left');
  {
    const r = await pair('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF');
    const d = await jsonOf(r);
    ok(r.status === 403, 'refused', r.status);
    ok(d.error === 'bad_code', 'for the right reason', d.error);
    ok(typeof d.attemptsLeft === 'number' && d.attemptsLeft >= 0,
       'and the ceiling is a real number somebody can act on', d.attemptsLeft);
  }

  section('Wrong codes run out');
  /* There was no ceiling at all: the loop below could have run for ever. */
  {
    let last = null;
    for (let i = 0; i < 8; i++) last = await pair('0000-0000-0000-0000-0000-0000');
    const d = await jsonOf(last);
    ok(last.status === 429, 'pairing is locked after enough wrong answers', last.status);
    ok(d.error === 'too_many_attempts', 'and says so', d.error);
    ok(/start it again|restart/i.test(String(d.detail || '')),
       'telling them the one thing that fixes it', d.detail);
  }

  section('And the correct code is refused too once it is locked');
  /* Otherwise the ceiling is decoration: whoever is guessing simply keeps
     going and the person at the terminal never learns anything happened. */
  {
    const r = await pair(CODE);
    ok(r.status === 429, 'even the right code has to wait for a restart', r.status);
  }
} finally {
  killBridge();
}

/* A second bridge, fresh, for the half of the behaviour that needs an unlocked
   gate: a correct code, then re-pairing. */
const child2 = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), proj],
                     { stdio: ['ignore', 'pipe', 'pipe'] });
let banner2 = '';
child2.stdout.on('data', b => { banner2 += b.toString(); });
child2.stderr.on('data', b => { banner2 += b.toString(); });
const kill2 = () => { try { child2.kill('SIGKILL'); } catch (e) {} };
process.on('exit', kill2);
const waitFor2 = async (re, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { const m = banner2.match(re); if (m) return m; await new Promise(r => setTimeout(r, 60)); }
  return null;
};
try {
  const p2 = await waitFor2(/Port\s+(\d+)/, 8000);
  const c2 = await waitFor2(/([0-9A-F]{4}(?:-[0-9A-F]{4}){5})/, 8000);
  const base2 = 'http://127.0.0.1:' + (p2 ? p2[1] : '0');
  const pair2 = (code) => fetch(base2 + '/amv-bridge/pair', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ code }) });

  section('A wrong try does not hold against somebody who then gets it right');
  /* Typing it wrong once is the common case. A ceiling that punished that
     would lock out the person who owns the terminal. */
  {
    await pair2('1111-1111-1111-1111-1111-1111');
    const r = await pair2(c2[1]);
    const d = await jsonOf(r);
    ok(r.status === 200, 'the correct code still works', r.status);
    ok(!!d.token, 'and a session is issued', !!d.token);
    ok(d.replaced === false, 'nothing was disconnected, because nothing was connected', d.replaced);
  }

  section('Re-pairing works, and says that it disconnected the last session');
  /* The code is deliberately reusable - the token lives in sessionStorage, so
     closing the tab must not mean restarting the daemon. What must not happen
     is that it does so silently. */
  {
    const r = await pair2(c2[1]);
    const d = await jsonOf(r);
    ok(r.status === 200, 'the code can be used again', r.status);
    ok(d.replaced === true, 'and the answer says a session was replaced', d.replaced);
    const said = await waitFor2(/previous session was disconnected/, 3000);
    ok(!!said, 'the terminal says it too, which is where somebody would see it', !!said);
  }

  section('The comment no longer claims something the code does not do');
  {
    const { readFileSync } = await import('fs');
    const src = readFileSync(join(ROOT, 'bridge', 'amv-bridge.mjs'), 'utf8');
    const stated = /The code is single-use; this is what every/.test(src);
    ok(!stated, 'the "single-use" claim is gone', stated);
    ok(/PAIR_MAX_FAILS/.test(src), 'and a real ceiling is there instead');
  }
} finally {
  kill2();
}

report();
done();
