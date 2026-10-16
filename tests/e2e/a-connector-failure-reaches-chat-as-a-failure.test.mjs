/* A CONNECTOR'S FAILURE REACHES CHAT AS A FAILURE.

   A connector somebody else wrote answers {ok, text}. Chat passed on only
   the text, so a refused send ("permission denied") reached the model with
   nothing saying it had failed, and the model could tell the person it was
   done. And a success is the connector's own word: AMV cannot read a third
   party's action back, so it must not be reported as something AMV checked. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

const run = (result) => page.evaluate(async (result) => {
  const real = window.runMcpTool;
  window.runMcpTool = async () => result;
  try { return (await _amvRunTool('mcp__mail__send', { to: 'a@b.c' }, null)).text; }
  finally { window.runMcpTool = real; }
}, result);

section('A failure says it failed');
{
  const t = await run({ ok: false, text: 'permission denied' });
  ok(/FAILURE/.test(t) && /Do not say this was done/.test(t), 'the model is told it failed', t);
  ok(/permission denied/.test(t), 'and still reads what the connector said', t);
}

section('A success is the connector’s word, not AMV’s');
{
  const t = await run({ ok: true, text: 'sent' });
  ok(/connector reports this/.test(t) && /AMV has not checked it/.test(t) && !/FAILURE/.test(t), 'labelled as reported, not checked', t);
}

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();
if (report('a-connector-failure-reaches-chat-as-a-failure') > 0) process.exitCode = 1;
done();
