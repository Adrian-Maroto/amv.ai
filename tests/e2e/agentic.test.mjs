/* The agentic layer: chat must actually DO the work, not describe it.
   Also guards the honesty rule - when the engine is off, we say so rather
   than faking a result. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
await app.connect();

section('Tools exist and are wired to real engines');

const tools = await page.evaluate(() => ({
  all: (window.AMV_TOOLS || []).map(t => t.name),
  chat: _toolsFor('chat').map(t => t.name),
  dev: _toolsFor('dev').map(t => t.name),
  lab: _toolsFor('lab').map(t => t.name),
}));
ok(tools.all.includes('run_code'), 'run_code tool exists');
ok(tools.all.includes('crew_add'), 'crew_add tool exists');
ok(tools.all.includes('build_app'), 'build_app tool exists');
ok(tools.all.includes('deploy_site'), 'deploy_site tool exists');
ok(tools.dev.length > 0, 'Dev has its own tools (not chat-only)', tools.dev);
ok(tools.lab.length > 0, 'Lab has its own tools', tools.lab);

section('run_code REALLY executes (not a simulation)');

const run = await page.evaluate(async () => {
  const out = await _amvRunTool('run_code', { code: 'console.log(6*7)', lang: 'js' });
  return out.text;
});
ok(/42/.test(run), 'real JS executed and returned 42', run.slice(0, 60));

const runFail = await page.evaluate(async () => {
  const out = await _amvRunTool('run_code', { code: 'throw new Error("boom")', lang: 'js' });
  return out.text;
});
ok(/FAILED|Error|boom/i.test(runFail),
   'a failing program reports the REAL error (no hallucinated success)', runFail.slice(0, 60));

section('Tool output is escaped (model output is untrusted)');

const toolXss = await page.evaluate(async () => {
  window.__pwn = 0;
  const out = await _amvRunTool('run_code', {
    code: 'console.log("<img src=x onerror=window.__pwn=1>")', lang: 'js'
  });
  const d = document.createElement('div');
  d.innerHTML = out.render || '';
  document.body.appendChild(d);
  await new Promise(r => setTimeout(r, 200));
  const pwned = window.__pwn;
  d.remove();
  return { pwned };
});
ok(toolXss.pwned === 0, 'code output containing HTML cannot execute', toolXss.pwned);

section('Honesty: no faking when the engine is off');

/* The rule this guards is older than any one tool: when the thing a tool needs
   is not there, AMV says so instead of producing something that looks like a
   result. It used to be asserted through image generation, which returned no
   picture and said "connect the engine" rather than drawing a placeholder one.
   That tool is gone; the rule is not, and the tools that reach the server are
   where it matters most now - a background job the person is told was created,
   and was not, is a worse lie than a missing picture. */
const honest = await page.evaluate(async () => {
  const realApi = window.api;
  window.api = async () => { const e = new Error('not-connected'); throw e; };
  const out = await _amvRunTool('crew_add', { title: 'water the plants', every: 'daily', prompt: 'x' });
  window.api = realApi;
  return { text: String((out && out.text) || out || ''), render: (out && out.render) || null };
});
ok(/not connected/i.test(honest.text),
   'a tool whose engine is unreachable says exactly that', honest.text.slice(0, 80));
ok(/do not say/i.test(honest.text),
   'and tells the model not to claim it worked, which is the failure that costs trust', honest.text.slice(0, 120));
ok(honest.render === null,
   'and renders nothing that could be mistaken for a result', honest.render);

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
