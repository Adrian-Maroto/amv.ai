/* "CONTINUE WITH GOOGLE" WAS CHAINED TO THE SLOWEST THING ON THE PAGE.

   Google sign-in was initialised like this:

       window.addEventListener('load', () => setTimeout(initGAuth, 500));

   `load` does not fire until every async script has resolved - including
   `accounts.google.com/gsi/client`, which is the very script being waited for.
   So initialisation was chained to the slowest resource on the page and then
   delayed a further half second.

   Measured on a network where Google's host does not answer: first paint at
   236ms, `loadEventEnd` at 12,567ms. Signing up is the first thing a new person
   does and "Continue with Google" is the first button on the sheet, so for that
   whole window the button sits on screen and does nothing. A school or
   workplace filter does not degrade sign-in there, it removes it silently while
   the page looks ready.

   What this pins is the DECOUPLING, not a millisecond budget: initialisation
   must start from the library being ready or the sheet being opened, never from
   `load`. A timing assertion here would be a machine-speed assertion; this one
   is about which event it hangs off. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: null });
const page = app.page;

section('Sign-in starts when the library is ready, not when the page finishes');
{
  const out = await page.evaluate(async () => {
    const realInit = window.initGAuth;
    let called = 0;
    window.initGAuth = () => { called++; };
    /* The library, as it looks the moment Google's script finishes. */
    window.google = { accounts: { id: { initialize(){}, renderButton(){} } } };

    window.__amvGAuthStarted = false;
    const before = called;
    window._gauthStart();
    const afterReady = called;

    window.__amvGAuthStarted = false;
    try { window.openAuth('signup'); } catch (e) {}
    const afterSheet = called;

    window.initGAuth = realInit;
    try { window.closeOvr(); } catch (e) {}
    return { before, afterReady, afterSheet };
  });

  ok(out.afterReady === out.before + 1,
     'the library arriving is enough to start sign-in', out);
  ok(out.afterSheet === out.afterReady + 1,
     'and so is opening the sheet, which is when somebody actually wants it', out);
}

section('Nothing in the sign-in path hangs off the load event');
{
  /* Read rather than driven, because the defect is the ABSENCE of a listener
     and there is no way to observe an event that is never waited for. Narrowed
     to the auth code so an unrelated `load` listener elsewhere - an iframe
     fading in, a preview frame - does not fail this. */
  const src = await page.evaluate(async () => {
    const r = await fetch('/app.js'); return r.ok ? await r.text() : '';
  });
  const hasSrc = src.length > 1000;
  ok(hasSrc, 'the bundle was readable', src.length);
  if (hasSrc) {
    const bad = /addEventListener\(\s*['"]load['"]\s*,[^)]{0,120}initGAuth/.test(src);
    ok(!bad, 'initGAuth is not called from a load listener', bad);
  }
}

await app.close();
if (report('sign-in-does-not-wait-for-the-slowest-script') > 0) process.exitCode = 1;
done();
