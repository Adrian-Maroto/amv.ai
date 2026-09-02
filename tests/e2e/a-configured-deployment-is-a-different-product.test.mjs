/* THE HALF OF AMV NOBODY HAD EVER RUN.

   For the whole life of this project the built page carried no backend address,
   so `AMV_API.live` was false in every test, every screenshot and every review.
   Everything gated on it - the connected-account reads, the real checkout, the
   team, the network paths behind half the buttons - was unreachable, and code
   nobody can reach is code nobody has looked at.

   Configuring a deployment turned that on, and the suites found three real
   things within an hour: a push button with no waiting state (LESSONS 327), a
   request counter that counted the wrong requests (327a), and a whole file
   asserting the no-backend copy against a live screen (327b).

   The fix for the third of those was to make the harness state the deployment
   instead of inheriting it - which correctly restored every existing suite to
   the unconfigured world it was written for, and would have left the configured
   world untested again. This file is the deliberate opposite: it asks for a
   backend address and checks the things that only exist when there is one.

   It uses a fictional address. Nothing here may touch the real deployment - a
   test suite that quietly makes requests to somebody's production Worker is a
   defect in its own right, and was live for a while before this file existed. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const BASE = 'https://backend.example.workers.dev';
const app = await bootApp({ apiBase: BASE, tab: 'chat',
                            user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

section('The address in the page is enough on its own');
{
  /* No localStorage, no Settings, no per-device anything: a visitor who has
     never touched this app gets a live one because the BUILD says so. That is
     the entire point of baking it in, and it had never been asserted. */
  const r = await page.evaluate(() => ({
    override: loadStr('amv_api_base') || '',
    base: AMV_API.base,
    live: AMV_API.live,
    tag: (document.querySelector('meta[name="amv-api-base"]') || {}).content,
  }));
  ok(r.override === '', 'nothing is stored on this device', r.override);
  ok(r.tag === BASE, 'the build shipped an address', r.tag);
  ok(r.base === BASE, 'and the app uses it without being told twice', r.base);
  ok(r.live === true, 'so the deployment is live for a first-time visitor', r.live);
}

section('Clearing the per-device override does not switch the backend off');
{
  /* The behaviour that broke a dozen suites, stated here so it is somebody's
     assertion rather than a surprise. Clearing the override is how a person
     undoes pointing one browser at a staging Worker; it returns them to the
     deployment, it does not disconnect them from it. */
  const r = await page.evaluate(() => {
    saveStr('amv_api_base', 'https://staging.example.workers.dev');
    const staged = AMV_API.base;
    saveStr('amv_api_base', '');
    return { staged, cleared: AMV_API.base, live: AMV_API.live };
  });
  ok(r.staged === 'https://staging.example.workers.dev',
     'an override points this browser somewhere else', r.staged);
  ok(r.cleared === BASE, 'and clearing it returns to what the build shipped', r.cleared);
  ok(r.live === true, 'which is still a live backend, not none', r.live);
}

section('Checkout offers a real path, rather than saying it is not connected');
{
  /* The exact inverse of money-needs-a-server, which proves the honest refusal
     when there is no server. Both halves have to be true or one of them is
     just describing the only state that was ever reachable. */
  const r = await page.evaluate(async () => {
    saveStr('amv_api_token', 'tok'); saveStr('amv_token_exp', String(Date.now() + 3e6));
    openPaymentSheet('pro');
    await new Promise(s => setTimeout(s, 250));
    const body = document.getElementById('pay-body');
    return { text: body ? body.textContent : '', plan: loadStr('amv_plan') || 'free' };
  });
  ok(!/not connected/i.test(r.text),
     'a configured deployment does not tell people checkout is unavailable', r.text.slice(0, 120));
  ok(r.plan === 'free', 'and nobody is handed a plan merely by opening the sheet', r.plan);
}

section('A control that waits on the network says so while it waits');
{
  /* LESSONS 327. The button had no busy state because, until a backend
     existed, it never had to wait for anything. */
  const r = await page.evaluate(async () => {
    _DEV.log = [{ role: 'sys', text: 'x' }];
    _devSetFile('index.html', '<h1>hi</h1>', 'html');
    setTab('dev');
    _devShowResult('<h1>hi</h1>', 'html', { html: '<h1>hi</h1>' });
    await new Promise(s => setTimeout(s, 300));
    const btn = document.getElementById('dev-github');
    if (!btn) return { found: false };
    const idle = { busy: btn.getAttribute('aria-busy'), disabled: btn.disabled };
    _devGhBusy(true);
    const working = { busy: btn.getAttribute('aria-busy'), disabled: btn.disabled,
                      title: btn.title };
    _devGhBusy(false);
    const after = { busy: btn.getAttribute('aria-busy'), disabled: btn.disabled };
    return { found: true, idle, working, after };
  });
  ok(r.found, 'the push control is on the Dev surface');
  if (r.found) {
    ok(!r.idle.disabled, 'it is usable when idle', r.idle);
    ok(r.working.busy === 'true' && r.working.disabled === true,
       'it reports itself busy and refuses a second press while working', r.working);
    ok(/checking/i.test(r.working.title || ''),
       'and says what it is doing, not merely that it is doing something', r.working.title);
    ok(r.after.busy === 'false' && r.after.disabled === false,
       'and comes back when the work is over', r.after);
  }
}

section('Nothing in the configured path errors on the way through');
{
  ok(errors.length === 0, 'no console errors booting a live deployment', errors.slice(0, 3));
}

if (report() > 0) process.exitCode = 1;
done();
