/* A CONNECTOR THAT CHANGES IS FOLLOWED, TURN BY TURN.

   The page took a connector's tool list once, at start. The bridge now counts
   the lists a server has had (`rev`, see a-connector-can-change-its-tools);
   this is the page's side: at the start of every chat turn and every Build
   agent turn it asks whether any count moved, and takes the new list for the
   ones that did - and only those, and only from this pairing.

   The bridge is stood in for at `_bridgeCall`, which is the one door the page
   uses to reach it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', apiBase: 'https://api.example.workers.dev' });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('cookie-consent-banner')?.remove());

await page.evaluate(() => {
  const tool = (name) => ({ name, description: 'gh: ' + name, inputSchema: { type: 'object', properties: {} } });
  window.__tool = tool;
  window.__bridge = { rev: 1, tools: [tool('search'), tool('open_pr')], calls: [], old: false };
  BRIDGE.connected = true; BRIDGE.token = 'pairing-now';
  MCP.live = {
    gh:    { tools: [tool('search')], info: null, error: '', session: 'pairing-now', rev: 0 },
    stale: { tools: [tool('x')], info: null, error: '', session: 'an-old-pairing', rev: 0 },
  };
  window._bridgeCall = async (route, body) => {
    window.__bridge.calls.push(route + (body && body.id ? ':' + body.id : ''));
    const b = window.__bridge;
    if (route === 'mcp/list') return { servers: [
      b.old ? { id: 'gh', running: true, tools: b.tools.map(t => t.name) }
            : { id: 'gh', running: true, rev: b.rev, tools: b.tools.map(t => t.name) },
      { id: 'stale', running: true, rev: 9, tools: ['x', 'y'] },
    ] };
    if (route === 'mcp/tools') return { id: body.id, rev: b.rev, tools: b.tools };
    if (route === 'mcp/call') return { result: { content: [{ type: 'text', text: 'ok' }] } };
    throw new Error('unexpected route ' + route);
  };
});
const names = () => page.evaluate(() => mcpTools().map(t => mcpToolIdentity(t.name)).filter(Boolean).map(w => w.id + '/' + w.tool).sort());

section('A list that moved is taken, one that did not is not asked for');
{
  const changed = await page.evaluate(() => mcpRefreshTools());
  const calls = await page.evaluate(() => window.__bridge.calls.slice());
  ok(changed === true && (await names()).includes('gh/open_pr'), 'the new tool is offered', await names());
  ok(calls.includes('mcp/tools:gh'), 'fetched for the server whose count moved', calls);
  ok(!calls.includes('mcp/tools:stale'), 'and not for an entry from another pairing', calls);
  await page.evaluate(() => { window.__bridge.calls = []; });
  const again = await page.evaluate(() => mcpRefreshTools());
  const calls2 = await page.evaluate(() => window.__bridge.calls.slice());
  ok(again === false && calls2.join() === 'mcp/list', 'nothing moved: one small request, no list fetched', calls2);
}

section('A bridge too old to count reads as never changing');
{
  await page.evaluate(() => { window.__bridge.old = true; window.__bridge.calls = []; MCP.live.gh.rev = 0; });
  await page.evaluate(() => mcpRefreshTools());
  const calls = await page.evaluate(() => window.__bridge.calls.slice());
  ok(!calls.some(c => c.startsWith('mcp/tools')), 'no list is fetched', calls);
  await page.evaluate(() => { window.__bridge.old = false; MCP.live.gh.rev = 1; });
}

section('A chat turn offers the list as it is now');
{
  await page.evaluate(() => {
    AMV_API.token = 'tok-for-this-test';
    window._aiBackendReady = () => true;
    window.__sent = null;
    window.__bridge.rev = 2;
    window.__bridge.tools = window.__bridge.tools.concat([window.__tool('merge')]);
    const real = window.fetch;
    window.fetch = async (url, init) => {
      if (/\/v1\/messages/.test(String(url))) {
        try { window.__sent = JSON.parse(init.body); } catch (e) {}
        const enc = new TextEncoder();
        const ev = (d) => 'event: ' + d.type + '\ndata: ' + JSON.stringify(d) + '\n\n';
        const body = [ev({ type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 1 } } }),
                      ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
                      ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } }),
                      ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }),
                      ev({ type: 'message_stop' })].join('');
        return new Response(enc.encode(body), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return real(url, init);
    };
    const i = document.getElementById('inp') || document.querySelector('textarea'); if (i) i.value = 'merge the open pull request';
    sendMsg();
  });
  await page.waitForFunction(() => !!window.__sent, null, { timeout: 10000 }).catch(() => {});
  const sent = await page.evaluate(() => (window.__sent && window.__sent.tools || []).map(t => t.name)
    .map(n => mcpToolIdentity(n)).filter(Boolean).map(w => w.id + '/' + w.tool));
  ok(sent.includes('gh/merge'), 'the tool added since the last turn is in the request', sent);
  await page.waitForFunction(() => !S.busy, null, { timeout: 10000 }).catch(() => {});
}

section('So does a Build agent turn');
{
  const r = await page.evaluate(async () => {
    window.__bridge.rev = 3;
    window.__bridge.tools = window.__bridge.tools.concat([window.__tool('close_issue')]);
    const realLoop = window.aiAgentLoop, realConsent = window._agentConsent;
    let seen = null;
    window._agentConsent = async () => true;
    window.aiAgentLoop = async (opts) => { seen = opts; return { text: 'ok', why: 'done', steps: [], rounds: 1 }; };
    try { await _devSendAgent('close the stale issue', null); } catch (e) {}
    window.aiAgentLoop = realLoop; window._agentConsent = realConsent;
    return (seen ? seen.tools : []).map(t => mcpToolIdentity(t.name)).filter(Boolean).map(w => w.id + '/' + w.tool);
  });
  ok(r.includes('gh/close_issue'), 'the tool added since the last turn is offered', r);
}

section('A tool the server took away is named as taken away');
{
  const r = await page.evaluate(async () => {
    const alias = mcpTools().find(t => (mcpToolIdentity(t.name) || {}).tool === 'open_pr').name;
    window.__bridge.rev = 4;
    window.__bridge.tools = window.__bridge.tools.filter(t => t.name !== 'open_pr');
    await mcpRefreshTools();
    return await runMcpTool(alias, {});
  });
  ok(r.ok === false && /no longer offers "open_pr"/.test(r.text), 'not "the connector stopped"', r);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
