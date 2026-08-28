/* THE ERROR BOUNDARY WAS INSTALLED BY THE FUNCTION IT WAS MEANT TO PROTECT.

   _initErrorBoundary arms two window listeners: one for uncaught errors, one
   for unhandled rejections. Between them they are the only reason anybody -
   the person using AMV, or the operator reading telemetry - ever learns that
   something broke.

   It was called from inside goApp, eleventh in a list of twenty, after five
   UNGUARDED calls including setTab, which renders the entire current view. So
   the window in which a failure was least likely to be reported was exactly the
   window in which one was most likely to happen. Injecting a throw into goApp
   showed what that looks like: a half-drawn shell that answers nothing, no
   toast, no telemetry, and the product with no idea.

   And goApp only runs once somebody is INSIDE the app. Every error on the
   landing page - the first thing every visitor sees, and the only thing most of
   them ever see - happened outside any boundary at all.

   It is armed at boot now, before anything else runs.

   WHAT THIS DELIBERATELY DOES NOT ASSERT: that boot steps are wrapped in
   try/catch. They are not, and should not be. A boot step that fails should
   fail loudly - LESSONS 297 is about exactly the damage a swallowed failure
   does. The point of the boundary is not to hide the error; it is to make sure
   somebody hears about it. */
import { bootApp } from '../lib/harness.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundle = readFileSync(join(ROOT, 'app.js'), 'utf8');

section('It is armed before anything that could fail in front of it');
{
  /* The boot block, read as an ordering rule. The behaviour below proves it is
     armed; this proves it is armed FIRST, which is the part that decays
     silently when somebody adds a line above it. */
  const boot = bundle.slice(bundle.indexOf('// critical: the app must be usable right away') - 1500,
                            bundle.indexOf('// critical: the app must be usable right away') + 400);
  ok(boot.length > 500, 'the boot block was found', boot.length);
  const armAt = boot.indexOf('_initErrorBoundary');
  const landAt = boot.indexOf('setupLanding()');
  ok(armAt > 0 && landAt > 0, 'both the arming and the first real step are in it', { armAt, landAt });
  ok(armAt < landAt, 'and the boundary is armed before the first one', { armAt, landAt });
}

section('A visitor who never enters the app is still covered');
{
  /* bootApp calls goApp, so to test the landing page the boundary has to be
     checked for having been armed by the BOOT block rather than by goApp. It
     is armed once and guards itself, so the flag being set is the evidence -
     and the section above is what pins WHERE it was set. */
  const app = await bootApp({ tab: 'chat', user: null });
  const armed = await app.page.evaluate(() => {
    try { return typeof _errBoundaryArmed !== 'undefined' ? !!_errBoundaryArmed : null; }
    catch (e) { return null; }
  });
  ok(armed === true, 'the boundary is armed on a page nobody has signed into', armed);
  await app.close();
}

section('An uncaught error reaches the person and the telemetry');
{
  const app = await bootApp({ tab: 'chat', user: { name: 'E', email: 'e@x.com', ini: 'E' } });
  const { page } = app;
  const r = await page.evaluate(async () => {
    document.querySelectorAll('.toast, [class*="toast"]').forEach(e => e.remove());
    const logged = [];
    const realLog = (window.AEGIS && AEGIS.log) || null;
    if (realLog) AEGIS.log = (k, d) => { logged.push(k); return realLog.call(AEGIS, k, d); };

    window.dispatchEvent(new ErrorEvent('error', { message: 'a genuine uncaught error', error: new Error('boom') }));
    await new Promise(r => setTimeout(r, 500));
    const said = [...document.querySelectorAll('.toast, [class*="toast"]')].map(e => (e.textContent || '').trim());
    if (realLog) AEGIS.log = realLog;
    return { said, logged };
  });
  ok(r.said.length > 0, 'the person is told something went wrong', r.said.slice(0, 1));
  ok(r.said.some(t => /hiccup|work is safe|refresh/i.test(t)),
     'in words that say what to do rather than naming a stack', r.said.slice(0, 1));
  ok(r.logged.includes('uncaught'), 'and it is recorded, so the operator can see it', r.logged);
  await app.close();
}

section('And an unhandled promise rejection is not a quieter kind of error');
{
  /* The half that is usually forgotten. Most of this product is async, so the
     majority of real failures arrive as rejections rather than as errors. */
  const app = await bootApp({ tab: 'chat', user: { name: 'E', email: 'e@x.com', ini: 'E' } });
  const { page } = app;
  const said = await page.evaluate(async () => {
    document.querySelectorAll('.toast, [class*="toast"]').forEach(e => e.remove());
    /* A real rejection, not a synthesised event: this is what the browser
       actually does when a promise is dropped. */
    Promise.reject(new Error('a genuine unhandled rejection'));
    await new Promise(r => setTimeout(r, 600));
    return [...document.querySelectorAll('.toast, [class*="toast"]')].map(e => (e.textContent || '').trim());
  });
  ok(said.length > 0, 'a dropped promise is reported too', said.slice(0, 1));
  await app.close();
}

if (report('a-boot-failure-does-not-happen-in-silence') > 0) process.exitCode = 1;
done();
