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
  /* ANCHORED ON THE CALL, NOT ON THE COMMENT ABOVE IT.

     The first version of this sliced a window around
     `// critical: the app must be usable right away`, and the meta-suite
     a-check-anchored-on-prose-is-not-a-check failed it - correctly, and while
     I was quoting that very suite in the commit message. Editing or deleting
     a comment would have silently moved the window, and an ordering check that
     measures the wrong region reports whatever it happens to find.

     `setupLanding();` is the call, with the semicolon, and it appears exactly
     once - the definition reads `function setupLanding(`. That is a landmark
     that cannot be reworded. */
  const landAt = bundle.indexOf('setupLanding();');
  ok(landAt > 0, 'the first real boot step was found in the bundle', landAt);

  /* Look back a bounded distance for the arming. Bounded, because "somewhere
     earlier in a 1.3MB file" would also be satisfied by the function's own
     definition, which proves nothing about boot order. */
  const before = bundle.slice(Math.max(0, landAt - 1200), landAt);
  ok(/_initErrorBoundary\s*\(/.test(before),
     'and the boundary is armed in the lines immediately before it', before.slice(-160));

  /* And it really is the boot block, not some other place those two happen to
     sit near each other. */
  const after = bundle.slice(landAt, landAt + 400);
  ok(/setupApp\s*\(/.test(after) && /setupKeyboard\s*\(/.test(after),
     'the region really is the boot sequence', after.slice(0, 80));
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
