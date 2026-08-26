/* CONNECTING AN ACCOUNT ENDS WHERE THE PERSON COMES BACK, NOT WHERE THEY LEAVE.

   The flow is: press Connect, pick what AMV may do, get sent to Google, approve
   it there, and land back on AMV with `?code=...&state=c_...` in the address
   bar. Everything before that last step is easy to see working - there is a
   button, a picker, a redirect. The last step is a single function running at
   boot with nothing on screen to say it did.

   I DELETED THAT FUNCTION AND IT SHIPPED THROUGH EVERYTHING.

   checkOAuthCallback went with the older Google grant it used to also serve.
   The syntax check passed - it is not a syntax error to call a function that
   does not exist. The build passed. All hundred and thirty-eight e2e suites
   passed, because not one of them opened the URL a provider returns to. And the
   call site was `try{ checkOAuthCallback(); }catch(e){}`, so the ReferenceError
   went into a bare catch and the page carried on booting perfectly.

   The result: anyone connecting an account approved real access at Google, came
   back to a normal-looking AMV, and nothing happened. No tick, no error, no
   toast, nothing in the console. The single most damaging outcome the feature
   has - somebody has granted access to their mail and AMV has silently thrown
   the code away - and the whole test suite was green.

   So this suite does the one thing none of the others did: it arrives at the
   URL a provider sends somebody to, and checks that the code gets handed over.

   LESSONS: an error swallowed by a bare catch is a feature that can be removed
   without anything going red. The guard at the call site names this function
   now, and this is the test that watches the door. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

/* The address a provider really returns to: the app root, with the code and the
   server-issued state on the query string. */
const STATE = 'c_TheStateTheServerIssuedAndSealed';
const CODE = '4/0AY0e-single-use-authorization-code';

const app = await bootApp({ tab: 'chat', query: '?code=' + encodeURIComponent(CODE) + '&state=' + STATE });
const { page, errors } = app;

section('The return is handled at boot, with no help from a test');
{
  /* Recorded from inside the page rather than asserted after the fact, because
     the whole failure was that nothing observable happened. */
  const seen = await page.evaluate(() => ({
    handler: typeof window.checkOAuthCallback,
    finish: typeof window._connectFinish,
  }));
  ok(seen.handler === 'function',
     'the return handler exists - a missing one is the exact bug this suite is for', seen.handler);
  ok(seen.finish === 'function', 'and the thing it hands the code to', seen.finish);

  /* THE ADDRESS BAR IS CLEANED. A single-use code left in the URL survives a
     reload, a bookmark, the browser history and the referrer of the next
     request the page makes. */
  const url = await page.evaluate(() => window.location.search);
  ok(url === '', 'the code is out of the address bar by the time the page settles', url);
}

section('And the code actually reaches the server');
{
  /* Run again by hand, with the network watched. The boot run already happened
     against whatever the harness serves; this one proves WHAT is sent. */
  const posted = await page.evaluate(async (args) => {
    const seenCalls = [];
    const realFetch = window.fetch;
    window.fetch = async (u, o) => {
      const url = String(u);
      if (url.includes('/v1/connect/finish')) {
        seenCalls.push(JSON.parse(String((o && o.body) || '{}')));
        return new Response(JSON.stringify({ ok: true, id: 'c1', provider: 'google',
          name: 'Google', scopes: ['mail.read'], unattended: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/v1/connect/list')) {
        return new Response(JSON.stringify({ ok: true, configured: true, items: [], providers: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(u, o);
    };
    /* THE BOOT RUN ALREADY LEFT A TOAST ON SCREEN, and it says the connection
       failed - correctly, because at boot there was no server to answer. Reading
       the toast without clearing first found that one and reported this run as a
       failure, which is a test measuring the previous step. */
    document.querySelectorAll('.toast, #toast, [class*="toast"]').forEach(e => e.remove());
    history.replaceState(null, '', location.pathname + '?code=' + encodeURIComponent(args.code) + '&state=' + args.state);
    checkOAuthCallback();
    await new Promise(r => setTimeout(r, 500));
    window.fetch = realFetch;
    return { calls: seenCalls, search: location.search,
             toast: (document.querySelector('.toast, #toast, [class*="toast"]') || {}).textContent || '' };
  }, { code: CODE, state: STATE });

  ok(posted.calls.length === 1, 'exactly one exchange is attempted', posted.calls.length);
  ok(posted.calls[0] && posted.calls[0].code === CODE, 'carrying the code the provider returned', posted.calls[0] && posted.calls[0].code);
  ok(posted.calls[0] && posted.calls[0].state === STATE, 'and the state that identifies the handshake', posted.calls[0] && posted.calls[0].state);
  ok(!JSON.stringify(posted.calls[0] || {}).includes('verifier'),
     'and no PKCE verifier, because this browser never held one', true);
  ok(posted.search === '', 'the address bar is cleaned before the request, not after it', posted.search);
  ok(/connected/i.test(posted.toast), 'and the person is told it worked', posted.toast.slice(0, 80));
}

section('A return that is not ours is left completely alone');
{
  /* THE OTHER HALF, AND THE MORE DANGEROUS ONE. Stripping a query string this
     handler does not own would destroy the only copy of somebody else's
     single-use code. The `c_` prefix is what tells them apart. */
  const other = await page.evaluate(async () => {
    let called = 0;
    const realFetch = window.fetch;
    window.fetch = async (u, o) => {
      if (String(u).includes('/v1/connect/finish')) { called++; }
      return realFetch(u, o);
    };
    history.replaceState(null, '', location.pathname + '?code=somebody-elses&state=not-ours');
    checkOAuthCallback();
    await new Promise(r => setTimeout(r, 200));
    const out = { called, search: location.search };
    window.fetch = realFetch;
    history.replaceState(null, '', location.pathname);
    return out;
  });
  ok(other.called === 0, 'a state without the prefix is not exchanged', other.called);
  ok(other.search.includes('code=somebody-elses'),
     'and the address bar is left untouched, so the other handler still has its code', other.search);
}

section('A refusal at the provider is said out loud, not swallowed');
{
  /* Somebody pressed cancel, or Google refused. They are sitting looking at a
     screen waiting for something to happen, and the worst answer is silence -
     which is what a bare catch gives. */
  const denied = await page.evaluate(async () => {
    document.querySelectorAll('.toast, #toast, [class*="toast"]').forEach(e => e.remove());
    history.replaceState(null, '', location.pathname + '?error=access_denied&state=c_whatever');
    checkOAuthCallback();
    await new Promise(r => setTimeout(r, 300));
    const t = [...document.querySelectorAll('.toast, #toast, [class*="toast"]')]
      .map(e => e.textContent || '').join(' ');
    const out = { search: location.search, toast: t };
    history.replaceState(null, '', location.pathname);
    return out;
  });
  ok(denied.search === '', 'the failed return is cleared from the address bar', denied.search);
  ok(/cancel|no access|not.*connected/i.test(denied.toast),
     'and it says so plainly rather than doing nothing', denied.toast.slice(0, 120));
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('coming-back-from-the-provider-finishes-the-job') > 0) process.exitCode = 1;
done();
