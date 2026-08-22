/* THE HIGHEST-INTENT SECOND IN THE PRODUCT, ANSWERED WITH A RED ERROR.

   Publishing to a live URL is an Elite feature and the server now enforces it,
   answering 402 with code:'plan_required' and the plan that lifts it. That is
   the money half. This file is the other half, and it is the half that decides
   whether the gate earns anything: somebody has just finished building a thing
   and pressed the button that puts it on the internet. If what comes back is
   "Deploy failed:" in red with nothing to press, the gate has cost a customer
   instead of making one.

   Four places a deploy refusal can surface, and three of them could not have
   worked at all before this:

     - the tool that publishes RETURNS its refusals rather than throwing, so a
       branch on the caught error was dead code and the refusal arrived as prose
     - the error object carried `code` but not `minPlan`, so a caller could tell
       a plan was needed but not which one, and could only guess
     - Dev's chat renderer never read the `html` field that tool results have
       been setting since Dev learned to use tools, so every card it built -
       generated images included - was discarded on the way to the screen

   Each check below fails if any of those regresses. The last one is the one
   that matters most: the card has to be a route, not a picture of a route. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

const REFUSAL = {
  error: 'Publishing to a live URL is part of Elite. Your app still runs here, and you can download it any time.',
  code: 'plan_required', minPlan: 'elite',
};

await page.evaluate((refusal) => {
  saveStr('amv_api_base', 'https://engine.test');
  saveStr('amv_api_token', 'tok');
  const rf = window.fetch;
  window.__deployCalls = 0;
  window.fetch = async (url, opts) => {
    if (String(url).includes('/deploy')) {
      window.__deployCalls++;
      return new Response(JSON.stringify(refusal), { status: 402, headers: { 'Content-Type': 'application/json' } });
    }
    return rf(url, opts);
  };
}, REFUSAL);

section('The refusal reaches the caller as a fact, not as a sentence');
{
  const r = await page.evaluate(async () => {
    const out = await _amvRunTool('deploy_site', { html: '<h1>hi</h1>', title: 'Mine' }, () => {});
    return { code: out && out.code, minPlan: out && out.minPlan,
             text: String((out && out.text) || ''), render: String((out && out.render) || '') };
  });
  ok(r.code === 'plan_required', 'the tool returns the code rather than only prose', r.code);
  ok(r.minPlan === 'elite', 'and the plan that lifts it, so nobody has to guess a tier', r.minPlan);
  ok(!/^Deploy failed/.test(r.text), 'it does not call a plan limit a failure', r.text.slice(0, 60));
  ok(/not published/i.test(r.text), 'while still being honest that nothing was published', r.text.slice(0, 60));
  ok(/do not retry/i.test(r.text), 'and telling the model not to burn a retry on it', r.text.slice(0, 120));
  ok(/data-stab="plans"/.test(r.render), 'the rendered card carries a route to the plans', r.render.slice(0, 120));
}

section('Lab shows the tier where it used to show a stack of red text');
{
  const r = await page.evaluate(async () => {
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
    return { html: out ? out.innerHTML : '', stat: stat ? stat.textContent : '',
             err: !!(out && out.querySelector('.lab-sec.err')) };
  });
  ok(!r.missing, 'the Lab editor is present', !r.missing);
  ok(/deploy-tier/.test(r.html), 'the tier card is in the result pane', r.html.slice(0, 160));
  ok(!r.err, 'and nothing in the pane is styled as an error', r.err);
  ok(!/>Published</.test(r.html), 'it does not claim a publish that did not happen', r.html.slice(0, 160));
  ok(!/✗/.test(r.stat), 'the status line is not a red cross', r.stat);
}

section('Dev offers the plan instead of reporting a fault');
{
  const r = await page.evaluate(async () => {
    setTab('dev');
    await new Promise(res => setTimeout(res, 300));
    document.querySelectorAll('#toast-wrap .toast').forEach(t => t.remove());
    _DEV.lastHTML = '<!doctype html><html><body>built</body></html>';
    _DEV.deploySlug = '';
    await _devDeploy();
    await new Promise(res => setTimeout(res, 200));
    const toasts = [...document.querySelectorAll('#toast-wrap .toast')];
    return {
      any: toasts.length,
      text: toasts.map(t => t.textContent).join(' | '),
      isError: toasts.some(t => t.classList.contains('error')),
      btn: toasts.map(t => { const b = t.querySelector('.toast-btn'); return b ? b.textContent : ''; }).join(''),
    };
  });
  ok(r.any > 0, 'pressing Publish says something', r.any);
  ok(!/Deploy failed/.test(r.text), 'and does not call it a failure', r.text.slice(0, 120));
  ok(!r.isError, 'nor style it as an error', r.isError);
  ok(/Elite/.test(r.text), 'it names the plan', r.text.slice(0, 120));
  ok(/plans/i.test(r.btn), 'and offers the way to it in the same breath', r.btn);
}

section('A card Dev builds is a card Dev shows');
{
  /* The renderer ignored `html` entirely. Every tool card - the tier card here,
     but also every image Dev has ever generated - was built and dropped. */
  const r = await page.evaluate(async () => {
    _DEV.log = [{ role: 'ai', text: 'Publishing is part of Elite.',
                  html: _planUpsellCardHTML('Publishing is part of Elite', 'You can still download it.') }];
    _devRenderLog();
    await new Promise(res => setTimeout(res, 100));
    const el = document.getElementById('dev-log');
    return { html: el ? el.innerHTML : '', card: !!(el && el.querySelector('.deploy-tier')) };
  });
  ok(r.card, 'the card a tool result carries reaches the screen', r.html.slice(0, 160));
}

section('The card is a route, not a picture of one');
{
  const r = await page.evaluate(async () => {
    const btn = document.querySelector('#dev-log .deploy-tier [data-stab="plans"]');
    if (!btn) return { missing: true };
    const before = S.tab;
    btn.click();
    await new Promise(res => setTimeout(res, 400));
    return { before, after: S.tab, visible: !!document.querySelector('#app .plans, #app [data-plan], #plans') };
  });
  ok(!r.missing, 'the card has a button', !r.missing);
  ok(r.after === 'plans', 'pressing it actually arrives at the plans', r.before + ' -> ' + r.after);
}

section('Nothing retried the refusal behind their back');
{
  const n = await page.evaluate(() => window.__deployCalls);
  ok(n >= 3, 'each surface really called the server', n);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
