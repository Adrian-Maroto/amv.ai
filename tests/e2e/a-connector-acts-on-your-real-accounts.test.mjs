/* CONNECTORS, FROM THE PAGE, WITH A REAL SERVER BEHIND THEM.

   MCP is how AMV reaches the hundreds of services people actually want,
   without hand-writing an integration for each. The worker suite proves the
   bridge can run a server and speak the protocol. This proves the half that
   decides whether the feature is safe: what the PAGE does with tools it did
   not write, acting on accounts it does not own.

   Three things have to hold, and none is about whether a call succeeds:

     · The tools reach the model at all. This product has twice shipped a
       complete feature whose tools were silently dropped before the model
       ever saw them, so a namespaced name that no build-time list can
       contain is exactly the case worth checking end to end.
     · A person is asked first, every time, with the connector named and its
       arguments visible. AMV cannot classify a third-party tool's risk -
       the name and description come from whoever wrote the server - so any
       rule it invented would be a guess dressed as a policy.
     · A credential typed into the connector form never reaches localStorage.

   A real server runs behind a real bridge; only the engine is stubbed. */
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(ROOT, 'tests', 'fixtures', 'mcp-echo-server.mjs');
const box = mkdtempSync(join(tmpdir(), 'amv-mcp-ui-'));
mkdirSync(join(box, 'proj'), { recursive: true });
const proj = join(box, 'proj');
writeFileSync(join(proj, 'three.txt'), 'a\nb\nc\n');

const bridge = spawn(process.execPath, [join(ROOT, 'bridge', 'amv-bridge.mjs'), proj], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: Object.assign({}, process.env, { AMV_BRIDGE_DEV: '1' }),
});
const stop = () => { try { bridge.kill('SIGKILL'); } catch (e) {} };
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });
process.on('uncaughtException', (e) => { stop(); console.error(e); process.exit(1); });

let banner = '';
bridge.stdout.on('data', b => { banner += b.toString(); });
bridge.stderr.on('data', b => { banner += b.toString(); });
const waitFor = async (re, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { const m = banner.match(re); if (m) return m; await new Promise(r => setTimeout(r, 60)); }
  return null;
};
const PORT = (await waitFor(/Port\s+(\d+)/, 8000) || [])[1] || '0';
const CODE = (await waitFor(/([0-9A-F]{4}(?:-[0-9A-F]{4}){5})/, 8000) || [])[1] || '';

const A = await bootApp({ tab: 'chat' });
const { page } = A;
await page.evaluate(() => { document.getElementById('cookie-consent-banner')?.remove(); setTab('integrations'); });
await page.waitForSelector('.mcp', { timeout: 8000 });

section('A connector is added through the screen, not by hand');
{
  const before = await page.evaluate(() => document.querySelectorAll('.mcp-row').length);
  ok(before === 0, 'nothing is configured to begin with', before);

  const r = await page.evaluate(([exe, server]) => {
    document.getElementById('mcp-id').value = 'echo';
    document.getElementById('mcp-cmd').value = exe + ' ' + server;
    document.getElementById('mcp-env').value = 'DEMO_TOKEN=super-secret-value';
    document.getElementById('mcp-add').click();
    return true;
  }, [process.execPath, SERVER]);
  ok(r === true, 'the form accepts it', r);
  await page.waitForFunction(() => (window.MCP && MCP.servers.length) === 1, null, { timeout: 8000 });
  const cfg = await page.evaluate(() => MCP.servers[0]);
  ok(cfg.id === 'echo', 'it is stored under the name given', cfg.id);
  ok(Array.isArray(cfg.args) && cfg.args.length === 1, 'with the command split into argv', cfg.args.length);
}

section('The credential does not go where credentials must not go');
{
  const where = await page.evaluate(() => ({
    local: JSON.stringify(localStorage),
    session: sessionStorage.getItem('amv_mcp_env_echo') || '',
  }));
  ok(!/super-secret-value/.test(where.local),
     'it is nowhere in localStorage, which outlives the tab', /super-secret/.test(where.local));
  ok(/super-secret-value/.test(where.session),
     'it is in sessionStorage, which does not', /super-secret-value/.test(where.session));

  /* And a credential typed into the COMMAND box is refused rather than
     quietly written to disk, because that box is the one that persists. */
  const refused = await page.evaluate(() => {
    try { _mcpAdd('leaky', 'npx', ['server', '--token=ghp_AAAAAAAAAAAAAAAAAAAA'], {}); return 'accepted'; }
    catch (e) { return e.message; }
  });
  ok(/credential/i.test(refused), 'an argument that looks like a credential is refused', refused.slice(0, 60));
  ok(!/ghp_/.test(await page.evaluate(() => JSON.stringify(localStorage))),
     'and never lands in storage', true);
}

section('Connecting the computer brings the connector up with it');
{
  const r = await page.evaluate(async ([port, code]) => {
    await _bridgePair(port, code);
    const started = await mcpStartAll();
    return { connected: BRIDGE.connected, started };
  }, [PORT, CODE]);
  ok(r.connected === true, 'the bridge pairs', r.connected);
  ok(r.started.length === 1 && r.started[0].ok === true,
     'and the connector starts with it, without a second button', r.started[0]);
  ok(r.started[0].tools === 2, 'reporting the tools it really has', r.started[0].tools);
}

section('Its tools reach the model, namespaced so two servers can coexist');
{
  const tools = await page.evaluate(() => mcpTools());
  ok(tools.length === 2, 'both are offered', tools.length);
  const shout = tools.find(t => /shout/.test(t.name));
  ok(shout.name === 'mcp__echo__shout', 'under a name carrying the server', shout.name);
  ok(/^\[echo\]/.test(shout.description),
     'described as coming from that connector rather than from AMV', shout.description.slice(0, 20));
  ok(shout.input_schema && shout.input_schema.properties.text,
     'with the schema the server published', !!shout.input_schema.properties.text);

  /* The other half of this seam - that a namespaced name survives the
     server's filter - is checked against the real Worker in
     `the-tools-reach-the-model`. It cannot be checked from here, and an
     assertion that quietly passes because it cannot see its subject is worse
     than no assertion: it reads as coverage.  */
}

section('Nothing happens on a real account without being asked');
{
  const gated = await page.evaluate(() => _toolNeedsConsent('mcp__echo__shout'));
  ok(gated === true, 'every connector tool needs consent, with no exceptions', gated);

  /* The dialog has to name the connector and show the arguments: a call with
     invisible arguments is a blank cheque on somebody's account. */
  const dlg = page.evaluate(() => _confirmModelTool('mcp__echo__shout', { text: 'hello world' }));
  await page.waitForSelector('#modal-ok', { timeout: 6000 });
  const seen = await page.evaluate(() => ({
    title: document.querySelector('#modal-box h2')?.textContent || '',
    body: document.querySelector('#modal-box .ob-sub')?.textContent || '',
  }));
  ok(/echo/.test(seen.title) && /shout/.test(seen.title),
     'it names the connector and the action', seen.title);
  ok(/hello world/.test(seen.body), 'and shows what will be sent', seen.body.slice(0, 90));
  await page.click('#modal-cancel');
  ok(await dlg === false, 'and declining means declining', true);
}

section('And one argument cannot push another off the screen');
{
  /* THE PREVIEW WAS TRUNCATABLE, WHICH MADE IT WORSE THAN NO PREVIEW.

     It was `JSON.stringify(input, null, 1).slice(0, 700)`. Measured with
     `{ body: 'x'.repeat(900), to: 'attacker@example.com', subject: 'Invoice' }`
     the dialog showed 700 characters of padding and neither the address nor
     the word "to" - and the cut left no mark, so it read as a complete
     preview of a message with no recipient in it.

     The model chooses both the values and the order they serialize in, and
     this dialog exists because a tool call can come from content the model
     READ rather than from the person. So this drives exactly that shape. */
  const dlg2 = page.evaluate(() => _confirmModelTool('mcp__echo__shout', {
    body: 'x'.repeat(900), to: 'attacker@example.com', subject: 'Invoice' }));
  await page.waitForSelector('#modal-ok', { timeout: 6000 });
  const body = await page.evaluate(() =>
    document.querySelector('#modal-box .ob-sub')?.textContent || '');
  ok(/attacker@example\.com/.test(body),
     'the recipient is on screen even behind 900 characters of padding',
     body.slice(-160));
  ok(/\bsubject\b/.test(body) && /Invoice/.test(body),
     'and so is every other field - a name is never dropped', /Invoice/.test(body));
  ok(/more characters?\)/.test(body),
     'the long value says how much of it was left out, rather than trailing off',
     /more characters?\)/.test(body));
  await page.click('#modal-cancel');
  await dlg2;

  /* THE SAME ATTACK WITH A DIFFERENT LEVER. The first fix capped the LIST at
     24 fields, which is the hole wearing different clothes: 24 decoy fields
     and `to` at position 25 hides the recipient exactly as 900 characters of
     padding did. Caught by re-running the check with the count moved instead
     of the length, which is the variable the first fix left free. */
  const many = {}; for (let i = 0; i < 24; i++) many['decoy_' + i] = 'y'.repeat(400);
  many.to = 'attacker@example.com';
  const dlg3 = page.evaluate((m) => _confirmModelTool('mcp__echo__shout', m), many);
  await page.waitForSelector('#modal-ok', { timeout: 6000 });
  const body3 = await page.evaluate(() =>
    document.querySelector('#modal-box .ob-sub')?.textContent || '');
  /* MATCHED AS A LINE, NOT AS A WORD. The first version of this was
     `/\bto\b/`, and it passed against a build where the field really WAS
     dropped - because the sentence explaining the truncation contains the
     word "to". The mutation run is the only reason that is not still here.
     `to` has to appear as a field name on its own line, which is the thing
     somebody actually scans for. */
  ok(/^\s*to\s*$/m.test(body3),
     'a recipient hidden behind 24 decoy fields is still NAMED', body3.slice(-160));
  ok(/too many to show what is in them/.test(body3),
     'and the dialog says outright that it cannot show the values, rather than '
     + 'printing stubs that look like them', /too many/.test(body3));
  ok(body3.length < 2000,
     'while the preview stays short enough to read on a phone', body3.length);
  await page.click('#modal-cancel');
  await dlg3;
}

section('Allowed, it really runs on the real server');
{
  const out = await page.evaluate(() => runMcpTool('mcp__echo__shout', { text: 'it really works' }));
  ok(out.ok === true, 'the call succeeds', out.ok);
  ok(out.text === 'IT REALLY WORKS', 'and the answer came from the process', out.text);

  const real = await page.evaluate(() => runMcpTool('mcp__echo__count_lines', { path: 'three.txt' }));
  ok(real.text === '4', 'reaching the real filesystem through it', real.text);

  /* A tool that failed is not a connector that broke. */
  const failed = await page.evaluate(() => runMcpTool('mcp__echo__count_lines', { path: 'nope.txt' }));
  ok(failed.ok === false, 'a failing tool is reported as failing', failed.ok);
  ok(/cannot read/.test(failed.text), 'with the reason the server gave', failed.text);
}

section('Build says which services a request may touch, before it starts');
{
  /* Build asks once per request rather than per command, so that one ask has
     to carry everything the turn may now do - including leaving the folder. */
  const line = await page.evaluate(() => mcpConsentLine());
  ok(/echo/.test(line), 'the consent line names the connected service', line);
  ok(/2 tools/.test(line), 'and how much it can do', line);
}

section('Disconnecting the computer takes the connectors with it');
{
  const after = await page.evaluate(() => { _bridgeForget(); return { live: Object.keys(MCP.live).length, tools: mcpTools().length }; });
  ok(after.live === 0, 'nothing is left marked as running', after.live);
  ok(after.tools === 0,
     'so the model is not offered tools whose every call would fail', after.tools);
  const cfg = await page.evaluate(() => MCP.servers.length);
  ok(cfg === 1, 'while the configuration survives, ready for next time', cfg);
}

section('No JavaScript errors');
{
  ok(A.errors.length === 0, 'zero uncaught page errors', A.errors.slice(0, 3));
}

await A.close();
if (report('a-connector-acts-on-your-real-accounts') > 0) process.exitCode = 1;
done();
