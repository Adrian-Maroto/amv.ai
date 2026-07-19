/* The agentic layer: chat must actually DO the work, not describe it.
   Also guards the honesty rule — when the engine is off, we say so rather
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
ok(tools.all.includes('generate_image'), 'generate_image tool exists');
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

const honest = await page.evaluate(async () => {
  const realSrc = window._premiumImageSrc;
  window._premiumImageSrc = async () => null;      // engine unavailable
  const out = await _amvRunTool('generate_image', { prompt: 'a cat' });
  window._premiumImageSrc = realSrc;
  return { text: out.text, render: out.render };
});
ok(/connect/i.test(honest.text),
   'image tool says the engine must be connected', honest.text.slice(0, 60));
ok(honest.render === null,
   'it renders NO fake image', honest.render);

/* Video USED to be a lie: a setInterval faking a progress bar, producing
   nothing. It is now a real job against a real provider (see video.test.mjs).
   What this guards is that the FAKE never comes back. */
section('Video is real — and the fake never returns');

const video = await page.evaluate(async () => {
  setTab('video');
  await new Promise(r => setTimeout(r, 250));
  const src = String(window.genVid || '');
  return {
    noInterval: !/setInterval/.test(src),
    callsRealApi: /_vidApi|\/v1\/video\/generate/.test(src),
    pollsRealStatus: typeof window._vidRetry === 'function' || /video\/status/.test(String(window._vidPoll || '')),
    engineFlagGone: typeof VIDEO_ENGINE_READY === 'undefined'
  };
});
ok(video.noInterval, 'genVid does NOT run a fake progress interval');
ok(video.callsRealApi, 'it calls the real video endpoint');
ok(video.engineFlagGone, 'the "not implemented" placeholder flag is gone — it IS implemented');

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
