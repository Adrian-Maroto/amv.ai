/* THE GATE WAS ON THE DOOR SOMEBODY REMEMBERED.

   A tool the MODEL asks for can be a request the model absorbed from content it
   read, not something the person wanted. So the ones that execute code or
   publish to the internet require an explicit per-call permission. Chat's
   streaming loop asks. That was verified, and it was true.

   What was never asked is how many loops there are. `runAgentic` - the shared
   runner written later so Dev, Lab and Crew could use tools at all - dispatched
   whatever name the model returned straight into the runner. Two of the tools
   it offers execute code on the device and publish a public page under the
   account. No prompt, on either.

   It had no callers yet, which is the only reason this is a gap rather than an
   incident. It is exported on window, documented as usable from any surface,
   and the first thing to wire it up would have inherited the hole.

   And beside it: Lab's Publish button printed a green "live" tick and the word
   "Published" over the sentence explaining that nothing had been published,
   because deploy_site answers a failure with text rather than by throwing. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

/* One model turn that asks to run code, then stops. */
await page.evaluate(() => {
  saveStr('amv_api_base', 'https://engine.test');
  saveStr('amv_api_token', 'tok');
  window.__asked = [];
  window.__answer = false;
  /* A global `function` declaration is a non-configurable window property, so
     `delete` will not put the real one back. Keep a handle to it instead. */
  window.__realModal = window._showModalAsync;
  window._showModalAsync = async (o) => { window.__asked.push(o); return window.__answer ? true : null; };

  window.__ranTool = [];
  const realRun = window._amvRunTool;
  window._amvRunTool = async (name, input, onStatus) => {
    window.__ranTool.push(name);
    return realRun(name, input, onStatus);
  };

  window.__round = 0;
  const realFetch = window.fetch;
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (opts && opts.method === 'POST' && u.includes('engine.test')) {
      window.__round++;
      const body = window.__round === 1
        ? { stop_reason: 'tool_use', content: [
            { type: 'text', text: 'Let me run that.' },
            { type: 'tool_use', id: 'tu1', name: 'run_code', input: { code: 'console.log(1)', lang: 'js' } }] }
        : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, opts);
  };
});

section('The shared runner asks before running code the model asked for');
{
  const r = await page.evaluate(async () => {
    window.__asked = []; window.__ranTool = []; window.__round = 0; window.__answer = false;
    const out = await runAgentic('dev', 'have a look at this');
    return { asked: window.__asked.map(a => a.title), ran: window.__ranTool, text: out.text };
  });
  ok(r.asked.length === 1, 'a permission prompt was shown', r.asked);
  ok(/run js on your device/i.test(r.asked[0] || ''), 'naming what would actually happen', r.asked[0]);
}

section('And a denial stops it, rather than being noted and ignored');
{
  const r = await page.evaluate(async () => {
    window.__asked = []; window.__ranTool = []; window.__round = 0; window.__answer = false;
    await runAgentic('dev', 'have a look at this');
    return { ran: window.__ranTool };
  });
  ok(r.ran.indexOf('run_code') < 0, 'the tool never ran', r.ran);
}

section('Allowing it lets the work happen');
{
  const r = await page.evaluate(async () => {
    window.__asked = []; window.__ranTool = []; window.__round = 0; window.__answer = true;
    await runAgentic('dev', 'have a look at this');
    return { asked: window.__asked.length, ran: window.__ranTool };
  });
  ok(r.asked === 1, 'still asked once', r.asked);
  ok(r.ran.indexOf('run_code') >= 0, 'and then did it', r.ran);
}

section('With no way to ask, the answer is no');
{
  /* An autonomous surface with no modal host must not become the way around the
     prompt. _showModalAsync resolves null without #ovr, and null is not yes. */
  const r = await page.evaluate(async () => {
    window._showModalAsync = window.__realModal;   // the real one, which needs #ovr
    const ovr = document.getElementById('ovr');
    const parent = ovr && ovr.parentNode;
    if (ovr) ovr.remove();
    window.__ranTool = []; window.__round = 0;
    await runAgentic('dev', 'have a look at this');
    const ran = window.__ranTool.slice();
    if (ovr && parent) parent.appendChild(ovr);
    return ran;
  });
  ok(r.indexOf('run_code') < 0, 'no prompt possible means not allowed', r);
}

section('Lab does not report a publish that did not happen');
{
  const r = await page.evaluate(async () => {
    /* Connected, but the deploy call fails - so deploy_site returns its honest
       failure TEXT rather than throwing, which is the exact case that used to
       print "Published" and a green tick. (Disconnected returns earlier, before
       the tool runs at all, so it would not exercise this.) */
    saveStr('amv_api_base', 'https://engine.test'); saveStr('amv_api_token', 'tok');
    const rf = window.fetch;
    window.fetch = async (url, opts) => {
      if (String(url).includes('/deploy')) return new Response(JSON.stringify({ error: 'storage is full' }), { status: 500 });
      return rf(url, opts);
    };
    setTab('lab');
    await new Promise(res => setTimeout(res, 300));
    const ta = document.getElementById('lab-code');
    if (!ta) return { missing: true };
    ta.value = '<!doctype html><html><body>hi</body></html>';
    if (typeof _LAB === 'object') _LAB.lang = 'html';
    await _labDeploy();
    await new Promise(res => setTimeout(res, 200));
    const out = document.getElementById('lab-out-body');
    const stat = document.getElementById('lab-out-stat');
    return { html: out ? out.innerHTML : '', stat: stat ? stat.textContent : '' };
  });
  ok(!r.missing, 'the Lab editor is present', !r.missing);
  ok(!/>Published</.test(r.html), 'it does not say Published', r.html.slice(0, 200));
  ok(/Not published/.test(r.html), 'it says it was not', r.html.slice(0, 200));
  ok(!/live/i.test(r.stat), 'and the status is not a green "live"', r.stat);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('second-dispatch-path') > 0) process.exitCode = 1;
done();
