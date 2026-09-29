/* THE BROWSER YOU SIGN IN WITH SEES THE SCREEN, AND NOTHING ELSE NEW.

   Chat and the Crew connect to any service with a sign-in by opening its real
   website in a browser on the person's own computer, where they type their own
   password. Two things the bridge does for that one connector, and only that
   one, are asserted here against a real bridge and a real child process:

   1. The screen. On Linux a program cannot open a window unless it is told
      where the display is, and without one the browser silently runs
      invisibly - so the person would have nowhere to sign in. The display
      settings are NOT on the allowed list, because a display connection can
      watch other windows; they are handed over only when the page asks for
      them by name (`desktop`), never to an ordinary connector or command.

   2. Where it runs. The browser writes what it sees - page snapshots, console
      logs - into the folder it runs in, and by default that was the project.
      A bank page does not belong in somebody's project folder. So it runs in
      a fresh temporary folder that is deleted when it stops.

   Measured with the real @playwright/mcp@0.0.83 before this was written: with
   the display it opened the page and the login form received what was typed;
   without it the browser ran headless; the project folder stayed empty and
   the temporary folder was gone after stop. That run needs the network and a
   browser, so the gate asserts the bridge's half here, with no network. */
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, existsSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN = 'https://amv.homes';
const AWKWARD = join(ROOT, 'tests', 'fixtures', 'mcp-awkward-server.mjs');
const SCREEN = { DISPLAY: ':42', WAYLAND_DISPLAY: 'wayland-7', XAUTHORITY: '/tmp/fake-xauth' };

const running = [];
process.on('exit', () => { for (const c of running) try { c.kill('SIGKILL'); } catch (e) {} });

async function startBridge() {
  const box = mkdtempSync(join(tmpdir(), 'amv-desk-'));
  const proj = join(box, 'proj'); mkdirSync(proj, { recursive: true });
  const child = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), proj], {
    stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, SCREEN),
  });
  running.push(child);
  let banner = '';
  child.stdout.on('data', b => { banner += b.toString(); });
  child.stderr.on('data', b => { banner += b.toString(); });
  const waitFor = async (re, ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) { const m = banner.match(re); if (m) return m; await new Promise(r => setTimeout(r, 60)); }
    return null;
  };
  const port = (await waitFor(/Port\s+(\d+)/, 8000) || [])[1] || '0';
  const code = (await waitFor(/([0-9A-F]{4}(?:-[0-9A-F]{4}){5})/, 8000) || [])[1] || '';
  await waitFor(/Close this window/, 4000);
  const base = 'http://127.0.0.1:' + port;
  const pr = await fetch(base + '/amv-bridge/pair', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ code }) });
  const paired = await pr.json().catch(() => ({}));
  const call = async (route, body) => {
    const r = await fetch(base + '/amv-bridge/' + route, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-AMV-Bridge-Token': paired.token || '' },
      body: JSON.stringify(body || {}) });
    let d = {}; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
  };
  return { proj: realpathSync(proj), banner: () => banner, call };
}
const text = (r) => ((r.d.result && r.d.result.content) || []).map(c => c.text || '').join('');
const envOf = async (b, id) => { try { return JSON.parse(text(await b.call('mcp/call', { id, method: 'tools/call', params: { name: 'env', arguments: {} } }))); } catch (e) { return {}; } };
const cwdOf = async (b, id) => text(await b.call('mcp/call', { id, method: 'tools/call', params: { name: 'cwd', arguments: {} } }));

const b = await startBridge();

section('An ordinary connector gets neither the screen nor a folder of its own');
{
  const s = await b.call('mcp/start', { id: 'plain', command: process.execPath, args: [AWKWARD] });
  ok(s.status === 200, 'it starts', s.status);
  const env = await envOf(b, 'plain');
  const got = Object.keys(SCREEN).filter(k => k in env);
  ok(got.length === 0, 'the display settings are not handed to it', got);
  ok(await cwdOf(b, 'plain') === b.proj, 'and it runs in the project, as connectors always have', await cwdOf(b, 'plain'));
  await b.call('mcp/stop', { id: 'plain' });
}

section('Asking for the screen, by name, hands over exactly the screen');
{
  const s = await b.call('mcp/start', { id: 'amv-browser', command: process.execPath, args: [AWKWARD], desktop: true });
  ok(s.status === 200, 'it starts', s.status);
  const env = await envOf(b, 'amv-browser');
  ok(Object.keys(SCREEN).every(k => env[k] === SCREEN[k]), 'DISPLAY, WAYLAND_DISPLAY and XAUTHORITY are there, unchanged',
     Object.fromEntries(Object.keys(SCREEN).map(k => [k, env[k]])));
  ok(!('AWS_SECRET_ACCESS_KEY' in env) && !('HTTPS_PROXY' in env && !process.env.HTTPS_PROXY),
     'and nothing else outside the allowed list came with them', Object.keys(env).length);
  ok(/may open a window on your screen/.test(b.banner()), 'the terminal says a window may open', true);

  const where = await cwdOf(b, 'amv-browser');
  const tmp = realpathSync(tmpdir());
  ok(where && where !== b.proj && where.startsWith(tmp) && /amv-browser-/.test(where),
     'it runs in a temporary folder of its own, not the project', where);
  ok(existsSync(where), 'which exists while it runs', where);

  const st = await b.call('mcp/stop', { id: 'amv-browser' });
  ok(st.d.stopped === true, 'it stops', st.d);
  await new Promise(r => setTimeout(r, 300));
  ok(!existsSync(where), 'and the folder, with whatever the browser wrote there, is gone', where);
}

section('A command never gets the screen, whatever a connector was given');
{
  const r = await b.call('exec', { command: '"' + process.execPath + '" -e "process.stdout.write(JSON.stringify(process.env))"' });
  let env = {}; try { env = JSON.parse(r.d.stdout); } catch (e) {}
  const got = Object.keys(SCREEN).filter(k => k in env);
  ok(got.length === 0, 'the display settings stay out of commands', got);
}

if (report('the-browser-you-sign-in-with-sees-the-screen-and-nothing-else') > 0) process.exitCode = 1;
done();
