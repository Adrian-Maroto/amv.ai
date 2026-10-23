/* A CONNECTOR'S FAILURE REACHES CHAT AS A FAILURE.

   A connector somebody else wrote answers {ok, text}. Chat passed on only
   the text, so a refused send ("permission denied") reached the model with
   nothing saying it had failed, and the model could tell the person it was
   done. And a success is the connector's own word: AMV cannot read a third
   party's action back, so it must not be reported as something AMV checked.

   And the PERSON sees the same: each connector action leaves a line in the
   conversation saying what the connector reported and that AMV could not
   check it. The consent dialog shows what the connector says about the tool
   (MCP annotations: only reads, may delete...) as the connector's word -
   and asks regardless, because a connector that wanted a deletion through
   would simply say it only reads. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

const run = (result) => page.evaluate(async (result) => {
  const real = window.runMcpTool;
  window.runMcpTool = async () => result;
  try { return (await _amvRunTool('mcp__mail__send', { to: 'a@b.c' }, null)); }
  finally { window.runMcpTool = real; }
}, result);

section('A failure says it failed');
{
  const res = await run({ ok: false, text: 'permission denied' }); const t = res.text;
  ok(/FAILURE/.test(t) && /Do not say this was done/.test(t), 'the model is told it failed', t);
  ok(/permission denied/.test(t), 'and still reads what the connector said', t);
  ok(/chat-mcp-rcpt bad/.test(res.render || '') && /says this failed/.test(res.render), 'and the person sees the failure in the conversation', res.render);
}

section('A success is the connector’s word, not AMV’s');
{
  const res = await run({ ok: true, text: 'sent' }); const t = res.text;
  ok(/connector reports this/.test(t) && /AMV has not checked it/.test(t) && !/FAILURE/.test(t), 'labelled as reported, not checked', t);
  ok(/class="chat-mcp-rcpt"/.test(res.render || '') && /AMV could not check it/.test(res.render), 'and the person sees it as the connector\u2019s word, not AMV\u2019s', res.render);
}

section('Asking: what the connector says about a tool is shown as its word, and asked regardless');
{
  const r = await page.evaluate(async () => {
    MCP.live.files = { tools: [
      { name: 'wipe', description: 'Delete a folder', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false, destructiveHint: true } },
      { name: 'peek', description: 'Read a file', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true, destructiveHint: 'yes' } },
      { name: 'plain', description: 'No annotations', inputSchema: { type: 'object' } } ], info: null, error: '', session: 'x', rev: 1 };
    const names = mcpTools().map(t => t.name);
    const nameOf = (tool) => names.find(n => mcpToolIdentity(n) && mcpToolIdentity(n).tool === tool);
    const asked = [];
    const real = window._showModalAsync;
    window._showModalAsync = async (o) => { asked.push(o.body); return true; };
    try {
      for (const t of ['wipe', 'peek', 'plain']) await _confirmModelTool(nameOf(t), { path: '/tmp/x' });
    } finally { window._showModalAsync = real; delete MCP.live.files; }
    return asked;
  });
  ok(r.length === 3, 'every connector action is asked, whatever it says about itself', r.length);
  ok(/may delete or overwrite/.test(r[0]) && /connector says about this/.test(r[0]) && /asks you either way/.test(r[0]), 'a tool that says it may delete is shown as saying so, as the connector\u2019s word', r[0]);
  ok(/only reads/.test(r[1]) && !/delete/.test(r[1]), 'one that says it only reads is shown as saying that - a malformed extra answer is ignored', r[1]);
  ok(!/connector says about this/.test(r[2]), 'and one that says nothing is not described', r[2]);
}

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();
if (report('a-connector-failure-reaches-chat-as-a-failure') > 0) process.exitCode = 1;
done();
