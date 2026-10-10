/* AMV USES THE SCREEN ONLY WHEN YOU STARTED IT SO - AND WHAT IT TYPES IS TEXT.

   The bridge can look at the screen and use the mouse and keyboard, which is
   the whole computer rather than a folder. Checked against real bridges and a
   real screen (a virtual X display), with a real browser window as the thing
   being driven - so every claim below is about pixels and keystrokes that
   actually happened, read back from the window that received them:

   - started without --computer, it says so and refuses the screen routes;
   - started with --computer where there is no screen, it says that, not "on";
   - on a screen: a screenshot is a real PNG the size of the display;
   - a click lands where it was aimed, typing arrives character for
     character - including "$(...)" and quotes, which reach the window as
     text and are never run - a key press is the key, and scrolling scrolls;
   - every value is checked before anything moves: an unknown action,
     coordinates off the screen, control characters, unknown keys;
   - nothing works unpaired or from another origin;
   - the bridge prints what AMV did in its own window.

   Needs Xvfb, xdotool and ImageMagick (CI and the session setup install
   them). Without them this FAILS and says what to install - a check that
   passes because it could not look is not a check. */
import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { ok, section, report, done } from '../lib/assert.mjs';
import { LAUNCH } from '../lib/harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN = 'https://amv.homes';
const W = 1280, H = 800;
const running = [];
process.on('exit', () => { for (const c of running) try { c.kill('SIGKILL'); } catch (e) {} });
const has = (c) => spawnSync('sh', ['-c', 'command -v ' + c]).status === 0;

const missing = ['Xvfb', 'xdotool', 'import'].filter(c => !has(c));
if (missing.length) {
  ok(false, 'the tools this check drives are installed (sudo apt install xvfb xdotool imagemagick)', missing);
  report('amv-uses-the-screen-only-when-you-started-it-so'); process.exitCode = 1; done();
} else {

async function startBridge(args, env) {
  const box = mkdtempSync(join(tmpdir(), 'amv-screen-'));
  const proj = join(box, 'proj'); mkdirSync(proj, { recursive: true });
  const child = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), proj].concat(args), {
    stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { LANG: 'en_US.UTF-8' }, env) });
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
  const hello = await (await fetch(base + '/amv-bridge/hello', { headers: { Origin: ORIGIN } })).json().catch(() => ({}));
  const paired = await (await fetch(base + '/amv-bridge/pair', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ code }) })).json().catch(() => ({}));
  const call = async (route, body, opts = {}) => {
    const r = await fetch(base + '/amv-bridge/' + route, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: opts.origin || ORIGIN,
                 'X-AMV-Bridge-Token': opts.token === undefined ? (paired.token || '') : opts.token },
      body: JSON.stringify(body || {}) });
    let d = {}; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
  };
  return { child, banner: () => banner, hello, paired, call };
}

/* A real screen, there from the start: the first check below has to show
   the bridge refusing a screen it COULD reach, or it proves nothing. */
/* Xvfb picks a free display itself and says which (-displayfd). A number
   chosen here can collide with a display a killed run left its lock file on,
   and then nothing starts and the run fails with nothing said about why. */
const xvfb = spawn('Xvfb', ['-displayfd', '1', '-screen', '0', W + 'x' + H + 'x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'pipe', 'ignore'] });
running.push(xvfb);
const DISPLAY = ':' + await new Promise((res, rej) => {
  let got = '';
  const t = setTimeout(() => rej(new Error('Xvfb did not start')), 10000);
  xvfb.stdout.on('data', b => { got += b.toString(); const m = /(\d+)\s/.exec(got); if (m) { clearTimeout(t); res(m[1]); } });
  xvfb.on('exit', c => { clearTimeout(t); rej(new Error('Xvfb exited ' + c)); });
});

section('Started without --computer: it says so, and the screen is not there');
{
  const b = await startBridge([], { DISPLAY });
  ok(b.hello.computer && b.hello.computer.on === false && b.hello.computer.why === 'off', 'hello says the screen is off, and why', b.hello.computer);
  ok(b.paired.computer && b.paired.computer.on === false, 'so does pairing', b.paired.computer);
  const r = await b.call('screen/shot');
  ok(r.status === 403 && r.d.error === 'computer_off', 'a screenshot is refused', r);
  const a = await b.call('screen/act', { kind: 'click', x: 1, y: 1 });
  ok(a.status === 403 && a.d.error === 'computer_off', 'and so is a click', a);
  ok(/restart with\s+--computer/.test(b.banner()), 'the terminal says how to turn it on');
  b.child.kill('SIGKILL');
}

section('Asked for, with no screen: it says there is no screen rather than "on"');
{
  const env = { DISPLAY: '', WAYLAND_DISPLAY: '' };
  const b = await startBridge(['--computer'], env);
  ok(b.hello.computer && b.hello.computer.on === false && b.hello.computer.why === 'no_display', 'off, because there is no screen', b.hello.computer);
  ok(/no screen in this session/.test(b.banner()), 'and the terminal says so');
  b.child.kill('SIGKILL');
}

const b = await startBridge(['--computer'], { DISPLAY });
const browser = await chromium.launch({ ...LAUNCH, headless: false, env: Object.assign({}, process.env, { DISPLAY }),
  args: ['--kiosk', '--window-position=0,0', '--window-size=' + W + ',' + H, '--no-first-run'] });
const page = await (await browser.newContext({ viewport: null })).newPage();
await page.setContent(`<!doctype html><body style="margin:0;height:4000px;font:16px sans-serif">
  <form id="f" onsubmit="event.preventDefault();window.__sent=document.getElementById('box').value;">
  <input id="box" style="position:absolute;left:300px;top:200px;width:500px;height:40px" autocomplete="off"></form>
  <div id="pad" style="position:absolute;left:900px;top:500px;width:120px;height:80px;background:#c33"
       onclick="window.__clicks=(window.__clicks||0)+1"></div></body>`);
await page.waitForTimeout(500);
/* Where the page's own pixels sit on the screen. Kiosk has no browser bar,
   so this is the window's position plus nothing - measured, not assumed. */
const off = await page.evaluate(() => ({ x: window.screenX + (window.outerWidth - window.innerWidth), y: window.screenY + (window.outerHeight - window.innerHeight) }));
const centre = async (sel) => page.evaluate(([s, o]) => { const r = document.querySelector(s).getBoundingClientRect();
  return { x: Math.round(o.x + r.left + r.width / 2), y: Math.round(o.y + r.top + r.height / 2) }; }, [sel, off]);

section('On a screen: it is on, and a screenshot is the screen');
{
  ok(b.hello.computer && b.hello.computer.on === true && b.hello.computer.os === 'linux', 'hello says the screen is on', b.hello.computer);
  ok(/--computer is ON/.test(b.banner()), 'and the terminal says so plainly');
  const r = await b.call('screen/shot');
  const png = Buffer.from(r.d.png || '', 'base64');
  ok(r.status === 200 && png.subarray(1, 4).toString() === 'PNG', 'a real PNG comes back', r.status);
  ok(r.d.width === W && r.d.height === H && r.d.scale === 1, 'the size of the display, at one pixel per pointer unit', { w: r.d.width, h: r.d.height, s: r.d.scale });
}

section('A click lands where it was aimed');
{
  /* A virtual display has no window manager, so nothing has focused the
     browser window yet, and on a slow machine its first click can go to
     focusing it. A real desktop focuses windows itself. So the window is
     focused first, with a click on empty page that nothing counts, and each
     result is waited for rather than read after a fixed pause. */
  await b.call('screen/act', { kind: 'click', x: 40, y: 700 });
  await page.waitForFunction(() => document.hasFocus(), null, { timeout: 5000 }).catch(() => {});
  const p = await centre('#pad');
  const r = await b.call('screen/act', { kind: 'click', x: p.x, y: p.y });
  await page.waitForFunction(() => (window.__clicks || 0) >= 1, null, { timeout: 3000 }).catch(() => {});
  const clicks = await page.evaluate(() => window.__clicks || 0);
  ok(r.status === 200 && clicks === 1, 'the red box received exactly one click', { r, clicks });
  const miss = await b.call('screen/act', { kind: 'click', x: 50, y: 50 });
  await page.waitForTimeout(200);
  ok(miss.status === 200 && (await page.evaluate(() => window.__clicks || 0)) === 1, 'and a click elsewhere did not reach it');
}

section('What AMV types arrives as text - including what looks like a command');
{
  const p = await centre('#box');
  await b.call('screen/act', { kind: 'click', x: p.x, y: p.y });
  const TEXT = 'hi $(touch /tmp/amv-pwned) `id` "q" \'s\' & ok';
  const r = await b.call('screen/act', { kind: 'type', text: TEXT });
  await page.waitForTimeout(300);
  const got = await page.evaluate(() => document.getElementById('box').value);
  ok(r.status === 200 && got === TEXT, 'the box holds exactly what was typed', { got });
  ok(spawnSync('sh', ['-c', 'test -e /tmp/amv-pwned']).status !== 0, 'and nothing in it was run');
  const k = await b.call('screen/act', { kind: 'key', keys: 'enter' });
  await page.waitForTimeout(200);
  ok(k.status === 200 && (await page.evaluate(() => window.__sent)) === TEXT, 'Enter submitted the form', await page.evaluate(() => window.__sent));
  await b.call('screen/act', { kind: 'key', keys: 'ctrl+a' });
  await b.call('screen/act', { kind: 'key', keys: 'backspace' });
  await page.waitForTimeout(200);
  ok((await page.evaluate(() => document.getElementById('box').value)) === '', 'ctrl+a then Backspace emptied it');
}

section('Scrolling scrolls');
{
  const r = await b.call('screen/act', { kind: 'scroll', x: 640, y: 600, direction: 'down', amount: 5 });
  await page.waitForTimeout(400);
  const y = await page.evaluate(() => window.scrollY);
  ok(r.status === 200 && y > 0, 'the page moved down', y);
}

section('Every value is checked before anything moves');
{
  const bad = [
    [{ kind: 'drag', x: 1, y: 1 }, 'an action not on the list'],
    [{ kind: 'click', x: -1, y: 5 }, 'a coordinate off the screen'],
    [{ kind: 'click', x: 10.5, y: 5 }, 'a coordinate that is not a whole number'],
    [{ kind: 'type', text: 'a\u0007b' }, 'a control character'],
    [{ kind: 'type', text: 'x'.repeat(2001) }, 'text past the limit'],
    [{ kind: 'key', keys: 'ctrl+alt+shift+cmd+x' }, 'five keys at once'],
    [{ kind: 'key', keys: 'rm -rf' }, 'a key that does not exist'],
    [{ kind: 'scroll', x: 1, y: 1, direction: 'down', amount: 99 }, 'a scroll past the limit'],
  ];
  for (const [body, what] of bad) {
    const r = await b.call('screen/act', body);
    ok(r.status === 400 && r.d.error === 'bad_action', 'refused: ' + what, r);
  }
}

section('Nothing works unpaired or from another origin');
{
  const r1 = await b.call('screen/shot', {}, { token: '' });
  ok(r1.status === 401, 'no pairing, no screenshot', r1.status);
  const r2 = await b.call('screen/act', { kind: 'click', x: 1, y: 1 }, { origin: 'https://evil.example' });
  ok(r2.status === 403, 'another site, no click', r2.status);
}

section('The bridge says what AMV did, in its own window');
{
  const t = b.banner();
  ok(/◉ AMV looked at the screen/.test(t), 'that it looked');
  ok(/◉ AMV clicked at \d+,\d+/.test(t), 'where it clicked');
  ok(/◉ AMV typed "hi \$\(touch/.test(t), 'what it typed');
  ok(/◉ AMV pressed enter/.test(t) && /◉ AMV pressed ctrl\+a/.test(t), 'which keys it pressed');
}

await browser.close();
b.child.kill('SIGKILL'); xvfb.kill('SIGKILL');
if (report('amv-uses-the-screen-only-when-you-started-it-so') > 0) process.exitCode = 1;
done();
}
