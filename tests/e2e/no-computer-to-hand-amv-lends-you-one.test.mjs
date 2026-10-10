/* NO COMPUTER TO HAND? AMV LENDS YOU ONE - AND SAYS WHAT IT IS.

   The connect card offers AMV's cloud computer when the server says this
   deployment runs one. In a real browser, with AMV's server stood in for at
   the one function every request goes through (AMV_API._fetch):

   - a deployment without one offers nothing - no button that cannot work;
   - a plan without it is told which plan has it, and offered no "Use";
   - using it asks the machine first, and says connected only once it answered;
     a machine that will not start is said as that, and nothing is connected;
   - commands and files go to AMV's server with the person's sign-in - never
     to a port on this computer - and come back as the bridge said;
   - the server's own refusals (the month's minutes) are said in its words and
     do not disconnect; the bridge's refusals still come through as refusals;
   - connectors, sign-ins and the screen are refused BEFORE any request, with
     what to do instead, and none of their tools are offered;
   - the card says plainly that the machine is cleared when it sleeps;
   - it survives a reload of the tab, and Disconnect stops what runs there and
     forgets it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Pat', email: 'pat@example.com', ini: 'P' } });
const { page, errors } = app;

const local = [];
page.on('request', (r) => { if (/^http:\/\/127\.0\.0\.1:\d+\/amv-bridge\//.test(r.url())) local.push(r.url()); });

/* AMV's server, as the page sees it. `answers[path]` is a function of the
   body; every call is recorded with its options. */
const serve = (answers) => page.evaluate((answers) => {
  Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true });
  window.__calls = [];
  const table = {};
  for (const [k, v] of Object.entries(answers)) table[k] = v;
  window.__answers = table;
  AMV_API._fetch = async (path, opts) => {
    window.__calls.push({ path, method: (opts && opts.method) || 'GET', body: opts && opts.body ? JSON.parse(opts.body) : null, timeout: opts && opts.timeout });
    const a = window.__answers[path] || { status: 404, body: { error: 'not_found' } };
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body };
  };
}, answers);
const setAnswer = (path, status, body) => page.evaluate(([p, s, b]) => { window.__answers[p] = { status: s, body: b }; }, [path, status, body]);
const calls = () => page.evaluate(() => window.__calls);

/* The card where people find it: Integrations, under "Your computer". */
const mountCard = () => page.evaluate(async () => {
  _connMachineOpen = true;
  if (S.tab !== 'integrations') setTab('integrations'); else renderIntegrationsView();
  await new Promise(r => setTimeout(r, 300));
  const host = document.querySelector('.conn-machine-b');
  host.closest('details').open = true;
  host.scrollIntoView({ block: 'start' });
  const slot = host.querySelector('#brg-cloud');
  return { hidden: slot ? slot.hidden : null, text: host.innerText, go: !!host.querySelector('#brg-cloud-go'), up: !!host.querySelector('#brg-cloud-up') };
});
const INFO = '/v1/computer/info';

section('A deployment without a cloud computer offers nothing');
{
  await serve({ [INFO]: { status: 200, body: { ok: true, available: false, allowed: true, minPlan: 'pro', minutes: { used: 0, cap: 300 } } } });
  const c = await mountCard();
  ok(c.hidden === true && !c.go && !/cloud computer/i.test(c.text), 'no row, no button, no mention', c);
}

section('A plan without it is told which plan has it');
{
  await serve({ [INFO]: { status: 200, body: { ok: true, available: true, allowed: false, minPlan: 'pro', minutes: { used: 0, cap: 0 } } } });
  const c = await mountCard();
  ok(c.hidden === false && c.up && !c.go && /comes with Pro and above/.test(c.text), 'it names Pro, and offers plans rather than "Use"', c.text.slice(0, 300));
}

section('A machine that will not start: said as that, and nothing is connected');
{
  await serve({
    [INFO]: { status: 200, body: { ok: true, available: true, allowed: true, minPlan: 'pro', minutes: { used: 12, cap: 300 } } },
    '/v1/computer/status': { status: 503, body: { error: 'The cloud computer did not start. Try again in a minute.', code: 'computer_unavailable' } },
  });
  const c = await mountCard();
  ok(c.go && /12 of 300 minutes/.test(c.text), 'the row offers it, with the minutes used', c.text.slice(0, 300));
  await page.click('#brg-cloud-go');
  await page.waitForFunction(() => /did not start/.test((document.getElementById('brg-msg') || {}).textContent || ''));
  const st = await page.evaluate(() => ({ connected: BRIDGE.connected, cloud: BRIDGE.cloud, msg: document.getElementById('brg-msg').textContent }));
  ok(!st.connected && !st.cloud, 'not connected', st);
}

section('Using it: asked first, then connected - and the card says what it is');
{
  await setAnswer('/v1/computer/status', 200, { exec: { running: 0, max: 4 }, mcp: [] });
  await page.click('#brg-cloud-go');
  await page.waitForFunction(() => BRIDGE.connected === true);
  const st = await page.evaluate(() => ({ cloud: BRIDGE.cloud, port: BRIDGE.port, token: BRIDGE.token, local: bridgeLocal(), saved: sessionStorage.getItem('amv_bridge') }));
  ok(st.cloud === true && st.port === 0 && st.token === '' && st.local === false, 'connected to the cloud, with no port and no token in the page', st);
  ok(st.saved === '{"cloud":true}', 'the tab remembers only that it is the cloud computer', st.saved);
  const cs = await calls();
  ok(cs.some(x => x.path === '/v1/computer/status' && x.method === 'POST'), 'the machine was asked before "connected" was said');
  const c = await mountCard();
  ok(/cloud computer is connected/.test(c.text) && /cleared when it sleeps/.test(c.text) && /After 5 minutes/.test(c.text) && /including the 5 minutes/.test(c.text),
     'the card says it is cleared when it sleeps', c.text.slice(0, 500));
  ok(/Connectors, sign-ins and the screen need your own computer/.test(c.text), 'and what needs your own computer');
  ok(/12 of 300 minutes/.test(c.text), 'and the minutes used', c.text);
}

section('Commands and files go to AMV’s server, never to a port here');
{
  await setAnswer('/v1/computer/exec', 200, { exitCode: 0, stdout: 'hi\n', stderr: '', ms: 40 });
  await setAnswer('/v1/computer/write', 200, { ok: true, bytes: 5 });
  const r = await page.evaluate(async () => ({
    ran: await runBridgeTool('run_command', { command: 'echo hi' }),
    wrote: await runBridgeTool('write_file', { path: 'a.txt', content: 'hello' }),
    offered: bridgeToolsOffered().map(t => t.name),
  }));
  ok(r.ran.ok === true && r.ran.stdout === 'hi\n', 'a command ran and its output came back', r.ran);
  ok(r.wrote.ok === true, 'a file was written', r.wrote);
  const cs = await calls();
  const ex = cs.find(x => x.path === '/v1/computer/exec');
  ok(ex && ex.body.command === 'echo hi' && /^j/.test(ex.body.job) && ex.timeout >= 120000, 'exec carried the command, its job name and a long enough wait', ex);
  ok(local.length === 0, 'and nothing was sent to a port on this computer', local);
  ok(r.offered.includes('run_command') && r.offered.includes('write_file'), 'the model is offered commands and files', r.offered);
}

section('The person’s never-run list still applies here');
{
  const r = await page.evaluate(async () => {
    neverRunSave('git push');
    const n = window.__calls.length;
    const out = await runBridgeTool('run_command', { command: 'git push origin main' });
    neverRunSave('');
    return { out, sent: window.__calls.length - n };
  });
  ok(r.out.ok === false && /git push/.test(r.out.error) && r.sent === 0, 'refused before anything was sent', r);
}

section('The server’s refusals in its words, and they do not disconnect');
{
  await setAnswer('/v1/computer/exec', 429, { error: 'You have used this month’s 300 minutes of cloud computer time. It starts again next month, or upgrade for more.', code: 'computer_minutes', minutes: { used: 300, cap: 300 } });
  const r = await page.evaluate(async () => { try { await bridgeExec('echo again'); return null; } catch (e) { return { m: e.message, code: e.code, still: BRIDGE.connected }; } });
  ok(r && r.code === 'computer_minutes' && /300 minutes/.test(r.m) && r.still === true, 'minutes spent: said, and still connected', r);
  await setAnswer('/v1/computer/exec', 403, { error: 'refused', reason: 'a recursive delete' });
  const b = await page.evaluate(async () => { try { await bridgeExec('rm -rf /'); return null; } catch (e) { return e.message; } });
  ok(/refused that command: it looks like a recursive delete/.test(b || '') && /refuses it for everybody/.test(b || ''), 'the bridge’s own refusal comes through as one', b);
}

section('Connectors, sign-ins and the screen: refused before any request');
{
  const r = await page.evaluate(async () => {
    const n = window.__calls.length;
    let mcp = null, browser = null;
    try { await _bridgeCall('mcp/start', { id: 'x' }, 5000); } catch (e) { mcp = { m: e.message, code: e.code }; }
    try { await browserEnsure(); } catch (e) { browser = { m: e.message, code: e.code }; }
    const shot = await (async () => { try { await _bridgeCall('screen/shot', {}, 5000); return null; } catch (e) { return e.code; } })();
    return { mcp, browser, shot, started: await mcpStartAll(), screen: computerToolsOffered().length, sent: window.__calls.length - n };
  });
  ok(r.mcp && r.mcp.code === 'cloud_local_only' && /Disconnect it/.test(r.mcp.m), 'a connector: refused, with what to do', r.mcp);
  ok(r.browser && /your own computer/.test(r.browser.m), 'AMV’s browser for sign-ins: the same', r.browser);
  ok(r.shot === 'cloud_local_only' && r.screen === 0, 'the screen is neither reachable nor offered', r);
  ok(Array.isArray(r.started) && r.started.length === 0, 'connectors are not started on it', r.started);
  ok(r.sent === 0, 'and none of it reached the server', r.sent);
}

section('It survives a reload of the tab');
{
  const r = await page.evaluate(() => {
    _bridgeForget();
    sessionStorage.setItem('amv_bridge', '{"cloud":true}');
    _bridgeRestore();
    return { connected: BRIDGE.connected, cloud: BRIDGE.cloud, token: BRIDGE.token, folder: BRIDGE.folder };
  });
  ok(r.connected && r.cloud && r.token === '' && /cloud computer/.test(r.folder), 'restored as the cloud computer', r);
}

section('Disconnect stops what runs there, and forgets it');
{
  await setAnswer('/v1/computer/revoke', 200, { revoked: true, wasPaired: true, stopped: { jobs: 1, servers: 0 } });
  const r = await page.evaluate(async () => {
    const d = await bridgeDisconnect();
    return { d, connected: BRIDGE.connected, cloud: BRIDGE.cloud, saved: sessionStorage.getItem('amv_bridge') };
  });
  ok(r.d.revoked && r.d.cloud && r.d.stopped.jobs === 1, 'the server was told, and one command was stopped', r.d);
  ok(!r.connected && !r.cloud && r.saved === null, 'and the tab forgot it', r);
  ok((await calls()).some(x => x.path === '/v1/computer/revoke'), 'through AMV’s server');
  ok(local.length === 0, 'with nothing ever sent to a port on this computer', local);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('no-computer-to-hand-amv-lends-you-one') > 0) process.exitCode = 1;
done();
