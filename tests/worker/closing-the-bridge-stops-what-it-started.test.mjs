/* TWO WAYS A MACHINE-SIDE PROMISE WAS NOT KEPT.

   Both come from an audit of the bridge, both were reproduced against a real
   daemon, and both are about the gap between what the product SAYS happened on
   somebody's computer and what happened.

   1. CLOSING THE BRIDGE DID NOT STOP WHAT THE BRIDGE STARTED (AMV-AUD-004).
      The signal handler killed MCP servers, because those are the children
      something kept a list of. `/exec` spawns its child inside the route
      handler and lets the close event tidy up, so nothing outside that closure
      ever knew it existed. A `npm run build`, a download, a long test run -
      all carried on after the daemon was gone. The request socket closed, so
      the person saw the command stop; the process did not.

      That makes closing the bridge an unreliable stop control, and it is the
      one control somebody reaches for when they want AMV off their machine.

   2. "NOT THERE" AND "COULD NOT READ IT" WERE THE SAME ANSWER (AMV-AUD-007),
      AND THE AUDIT BLAMED THE WRONG END.

      The build agent reads a file before editing it to decide whether it is
      creating or changing it, and treated ANY failure as "this file does not
      exist" - so it wrote without keeping a backup and recorded the path as
      newly created, which is exactly what Undo deletes. One flaky read and
      somebody's file is gone, with the product reporting that it undid its own
      work. That part of the finding is real and the fix is in the browser.

      What the finding got wrong is where the information was lost. It says the
      daemon does not distinguish absence; the daemon has always distinguished
      it, because ENOENT is turned into 404 `not_found` by the handler at the
      bottom of the request function. The break was in `_bridgeCall`, which
      threw a plain Error carrying no code - so the caller could not act on the
      404 it was already being sent.

      A first pass at this added a second ENOENT check inside the read route,
      on the strength of the report rather than of a measurement. It was
      redundant, and it only came out because the mutation written to prove it
      mattered did not fail. The wire behaviour is asserted here anyway: it is
      what the browser fix now depends on, and a claim relied upon is a claim
      worth pinning even when it was never broken.

   WHY A REAL DAEMON. Both defects live in process and filesystem behaviour
   that a mock cannot have: a child that outlives its parent, and an errno
   coming off a real `stat`. Reading the source would only show that the lines
   are present. */
import { spawn } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, chmodSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const ORIGIN = 'https://amv.homes';

const box = mkdtempSync(join(tmpdir(), 'amv-bridge-stop-'));
const proj = join(box, 'project');
mkdirSync(proj, { recursive: true });
writeFileSync(join(proj, 'existing.txt'), 'the original bytes\n');

const child = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), proj],
                    { stdio: ['ignore', 'pipe', 'pipe'] });
let banner = '';
child.stdout.on('data', b => { banner += b.toString(); });
child.stderr.on('data', b => { banner += b.toString(); });
/* Killed whether or not this file reaches its last line - a failing run must
   not leave a daemon that executes shell commands listening on a port. */
const killBridge = () => { try { child.kill('SIGKILL'); } catch (e) {} };
process.on('exit', killBridge);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { killBridge(); process.exit(1); });
}
process.on('uncaughtException', (e) => { killBridge(); throw e; });

const waitFor = async (re, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const m = banner.match(re);
    if (m) return m;
    await new Promise(r => setTimeout(r, 60));
  }
  return null;
};
const portM = await waitFor(/Port\s+(\d+)/, 8000);
const codeM = await waitFor(/([0-9A-F]{4}(?:-[0-9A-F]{4}){5})/, 8000);
const PORT = portM ? portM[1] : '0';
const CODE = codeM ? codeM[1] : '';
const base = 'http://127.0.0.1:' + PORT;

const call = (route, body, token) => fetch(base + '/amv-bridge/' + route, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', Origin: ORIGIN },
                         token ? { 'X-AMV-Bridge-Token': token } : {}),
  body: JSON.stringify(body || {}),
});
const jsonOf = async (r) => { try { return await r.json(); } catch (e) { return {}; } };

ok(Number(PORT) > 0 && !!CODE, 'a real bridge started', PORT);
const paired = await jsonOf(await call('pair', { code: CODE }));
const TOKEN = paired.token || '';
ok(!!TOKEN, 'and paired', TOKEN ? 'yes' : JSON.stringify(paired));

section('A missing file is its own answer, not a generic failure');
{
  const r = await call('read', { path: 'nope-not-here.txt' }, TOKEN);
  const d = await jsonOf(r);
  ok(r.status === 404, 'reading a path that is not there answers 404', r.status);
  ok(d.error === 'not_found',
     'with a code a caller can act on, rather than a sentence it has to match on', JSON.stringify(d));
}

section('A read that fails for any OTHER reason is still a failure');
{
  /* A directory is the cheapest read failure that is genuinely NOT absence -
     the path exists, and there is nothing to return as text. If this came back
     as not_found the agent would treat somebody's directory as a new file. */
  const r = await call('read', { path: '.' }, TOKEN);
  const d = await jsonOf(r);
  ok(r.status !== 404 && d.error !== 'not_found',
     'a path that exists but is not a readable file is NOT reported as missing', r.status + ' ' + JSON.stringify(d));
  ok(d.error === 'not_a_file', 'it says what it actually is', JSON.stringify(d));
}

section('A file that is there reads as itself');
{
  const d = await jsonOf(await call('read', { path: 'existing.txt' }, TOKEN));
  ok(d.content === 'the original bytes\n', 'content comes back verbatim', JSON.stringify(d.content));
}

section('A command that outlives its request does not outlive the bridge');
{
  /* THE PROOF HAS TO BE ON DISK, because a process id says nothing once the
     daemon is gone and "the socket closed" is exactly the false comfort this
     defect hid behind. The child sleeps past the daemon's death and then
     writes a marker; if the marker appears, it was still running. */
  const marker = join(proj, 'survived.txt');
  const cmd = 'sleep 4; echo still-running > ' + JSON.stringify(marker);
  /* Not awaited: the request will never come back, because the bridge is
     killed underneath it. That is the scenario. */
  const inflight = call('exec', { command: cmd, timeout: 60000 }, TOKEN).catch(() => {});

  /* Long enough for the shell to be spawned and sleeping, short enough to be
     well inside the sleep. */
  await new Promise(r => setTimeout(r, 1200));

  /* SIGTERM, which is what closing a terminal window sends, rather than
     SIGKILL - a daemon cannot run a handler on SIGKILL and asserting against
     that would be measuring the operating system. */
  child.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 600));

  /* Past when the child would have written, with room to spare. */
  await new Promise(r => setTimeout(r, 4200));
  await inflight;

  ok(!existsSync(marker),
     'the command the bridge started is gone with it - closing the bridge is a real stop control',
     existsSync(marker) ? readFileSync(marker, 'utf8') : '(no marker, which is the pass)');
}

section('And the daemon really did go away');
{
  let reached = false;
  try {
    const r = await fetch(base + '/amv-bridge/hello', { signal: AbortSignal.timeout(1200) });
    reached = r.ok;
  } catch (e) { reached = false; }
  ok(!reached,
     'so the section above measured a dead bridge rather than a live one that happened to be tidy',
     String(reached));
}

killBridge();
report();
done();
