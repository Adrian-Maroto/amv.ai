/* SIGN IN TO ANYTHING, ON YOUR OWN COMPUTER.

   Asked for: chat and the Crew must connect to ANY account the person has a
   password for - "my point 72 account", a bank in a country AMV has no list
   for. The one honest way: open the service's real website in a browser on
   their own computer, they type their own password there, and AMV reads and
   acts in that window, asking before every step.

   This drives the page's half through the real controls, with the bridge
   replaced at its one seam (`_bridgeCall`) so what is asserted is exactly what
   the page asks the computer to do. The bridge's half - the screen handed to
   this connector only, and a temporary folder of its own - is asserted
   against a real bridge in the-browser-you-sign-in-with-sees-the-screen-and-
   nothing-else, and the whole chain was run for real against
   @playwright/mcp@0.0.83 before either was written (see 38-mcp.js). */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'chat' });
const { page, errors } = app;

/* The six the model must never be handed, and three it needs. */
const WITHHELD = ['browser_run_code_unsafe', 'browser_evaluate', 'browser_network_request',
                  'browser_network_requests', 'browser_file_upload', 'browser_drop'];
const NEEDED = ['browser_navigate', 'browser_snapshot', 'browser_click'];

await page.evaluate(({ WITHHELD, NEEDED }) => {
  window.__calls = [];
  window.__navReply = { content: [{ type: 'text', text: '### Page\n- Page URL: https://www.bmi.ir/' }] };
  window._bridgeCall = async (route, body) => {
    window.__calls.push({ route, body: JSON.parse(JSON.stringify(body || {})) });
    if (route === 'mcp/start') return { tools: WITHHELD.concat(NEEDED).map(n => ({ name: n, description: n, inputSchema: { type: 'object', properties: {} } })), info: { name: 'Playwright' }, rev: 1 };
    if (route === 'mcp/call') return { result: window.__navReply };
    if (route === 'mcp/stop') return { stopped: true };
    return {};
  };
}, { WITHHELD, NEEDED });

const card = async (input) => page.evaluate(async (inp) => {
  const r = await connectAccountTool(inp);
  const box = document.createElement('div'); box.id = 'cx-probe'; box.innerHTML = r.render || '';
  document.getElementById('cx-probe')?.remove(); document.body.appendChild(box);
  const c = box.querySelector('.cx-card');
  return { text: r.text, sub: c ? (c.querySelector('.cx-sub') || {}).textContent : '', note: c ? (c.querySelector('.cx-note') || {}).textContent : '',
           buttons: c ? [...c.querySelectorAll('.cx-btn')].map(b => ({ label: b.textContent, code: b.dataset.darg })) : [] };
}, input);
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast, #toasts > *, [role=status]')].map(t => t.textContent).join(' | '));

section('Anything AMV has no connector for gets a real way in, first');
{
  const c = await card({ service: 'my Bank Melli account', url: 'https://www.bmi.ir' });
  ok(c.buttons[0] && /^Sign in to Bank Melli on your computer$/.test(c.buttons[0].label),
     'the first button signs in to it, by name', c.buttons.map(b => b.label));
  ok(c.buttons[0] && c.buttons[0].code === 'web:https://www.bmi.ir/', 'at the address given', c.buttons[0] && c.buttons[0].code);
  ok(/www\.bmi\.ir/.test(c.sub) && /Check the address bar shows www\.bmi\.ir/.test(c.note) && /never sees your password/.test(c.note),
     'and the card names the site, says to check the address, and that AMV never sees the password', { sub: c.sub, note: c.note });
  ok(/NEVER ask for their password/.test(c.text) && /each one asks their permission/.test(c.text) && /cannot use it/.test(c.text),
     'the engine is told never to ask for a password, that every step is asked, and what it cannot do', c.text.slice(0, 160));
  const p72 = await card({ service: 'my point 72 account' });
  ok(p72.buttons[0] && /Sign in to point 72 on your computer/.test(p72.buttons[0].label) && p72.buttons[0].code === 'web:about:blank',
     'with no address known, it opens a blank window for them to type it rather than guessing one', p72.buttons[0]);
}

section('Only a real website address is ever opened');
{
  const r = await page.evaluate(() => ({
    bare: _browserUrl('bmi.ir'), js: _browserUrl('javascript:alert(1)'), file: _browserUrl('file:///etc/passwd'),
    data: _browserUrl('data:text/html,hi'), creds: _browserUrl('https://user:pw@bank.example'), blank: _browserUrl(''),
  }));
  ok(r.bare === 'https://bmi.ir/', 'a bare domain becomes https', r.bare);
  ok(r.js === '' && r.file === '' && r.data === '' && r.creds === '', 'script, file, data and credential-carrying addresses are refused', r);
  ok(r.blank === 'about:blank', 'and nothing given means a blank page', r.blank);
  const bad = await card({ service: 'Evil Bank', url: 'javascript:alert(1)' });
  ok(bad.buttons[0] && bad.buttons[0].code === 'web:about:blank', 'a refused address from the engine never reaches a button', bad.buttons[0]);
}

section('No computer connected: it takes them to connect one, and opens nothing');
{
  await page.evaluate(() => { window.__calls = []; BRIDGE.connected = false; });
  await page.evaluate(() => chatConnectGo('web:https://www.bmi.ir/'));
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({ tab: S.tab, calls: window.__calls.length,
    machine: !!(document.querySelector('details.conn-machine') || {}).open }));
  ok(r.calls === 0, 'nothing is asked of a computer that is not there', r.calls);
  ok(r.tab === 'integrations' && r.machine, 'they land on Your computer, opened', r);
}

section('Computer connected: AMV’s browser starts with its safety settings and opens the page');
{
  await page.evaluate(() => { window.__calls = []; BRIDGE.connected = true; BRIDGE.token = 'tok-1'; setTab('chat'); });
  await page.evaluate(() => chatConnectGo('web:https://www.bmi.ir/'));
  await page.waitForFunction(() => window.__calls.some(c => c.route === 'mcp/call'), null, { timeout: 5000 }).catch(() => {});
  const r = await page.evaluate(() => window.__calls);
  const start = r.find(c => c.route === 'mcp/start'), nav = r.find(c => c.route === 'mcp/call');
  ok(start && start.body.id === 'amv-browser' && start.body.command === 'npx' && start.body.desktop === true,
     'it starts AMV’s own browser, asking for the screen', start && start.body);
  const a = (start && start.body.args) || [];
  ok(a.includes('@playwright/mcp@0.0.83') && a.includes('--isolated') && a.join(' ').includes('--snapshot-mode none'),
     'pinned to the version that was read, sign-in kept in memory, no page written to disk', a);
  ok(nav && nav.body.params && nav.body.params.name === 'browser_navigate' && nav.body.params.arguments.url === 'https://www.bmi.ir/',
     'then opens exactly the address on the button', nav && nav.body);
  await page.waitForTimeout(300);
  ok(/www\.bmi\.ir is open in a browser window on your computer/.test(await toasts()), 'and says where to sign in', await toasts());
}

section('The engine is never handed the tools no sign-in needs');
{
  const r = await page.evaluate(({ WITHHELD, NEEDED }) => {
    const names = mcpTools({ bridge: true, remote: true }).map(t => mcpToolIdentity(t.name)).filter(Boolean)
      .filter(x => x.id === 'amv-browser').map(x => x.tool);
    const aliases = WITHHELD.map(n => mcpToolName('amv-browser', n));
    return { names, reachable: aliases.filter(a => _mcpSplitName(a)), needed: NEEDED.filter(n => names.includes(n)) };
  }, { WITHHELD, NEEDED });
  ok(WITHHELD.every(n => !r.names.includes(n)), 'running code, page script, raw network and file upload are not offered', r.names);
  ok(r.reachable.length === 0, 'and cannot be called by name either', r.reachable);
  ok(r.needed.length === NEEDED.length, 'while opening, reading and clicking are', r.needed);
}

section('The safeguards belong to AMV’s browser alone');
{
  const r = await page.evaluate(async () => {
    let claimed = '';
    try { _mcpAdd('amv-browser', 'node', ['evil.js']); claimed = 'added'; } catch (e) { claimed = e.message; }
    /* Somebody's own connector, with a tool that happens to share a name. */
    MCP.servers.push({ id: 'other', command: 'node', args: ['x.js'] });
    window.__calls = [];
    await _mcpStart('other');
    const start = window.__calls.find(c => c.route === 'mcp/start');
    return { claimed, desktop: start && start.body.desktop, otherWithheld: _mcpWithheld('other', 'browser_evaluate') };
  });
  ok(/reserved/.test(r.claimed), 'no connector can be added under its name', r.claimed);
  ok(r.desktop === false, 'another connector is never given the screen', r.desktop);
  ok(r.otherWithheld === false, 'and the withheld list applies to AMV’s browser only', r.otherWithheld);
}

section('No Chrome on the computer: it says to install it, in plain words');
{
  await page.evaluate(() => {
    /* Playwright's own words, as measured on a computer without Chrome. */
    window.__navReply = { isError: true, content: [{ type: 'text', text: "### Error\nError: async initializeServer: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome\nRun \"npx playwright install chrome\"" }] };
  });
  const msg = await page.evaluate(async () => { try { await browserOpen('https://www.bmi.ir/'); return 'opened'; } catch (e) { return e.code + ': ' + e.message; } });
  ok(/^no_chrome: .*Google Chrome is not installed/.test(msg), 'the fix is named, not the stack trace', msg);
}

ok(errors.length === 0, 'and nothing threw on the way', errors);

await app.close();
if (report('sign-in-to-anything-on-your-own-computer') > 0) process.exitCode = 1;
done();
