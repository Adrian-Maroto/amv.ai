/* THE SESSION IS IN A COOKIE THE PAGE CANNOT READ, AND A RELOAD STILL WORKS.

   AMV-019 moved the REFRESH token into an HttpOnly cookie: weeks valid, and a
   copy of it is a copy of the account, so it is the half worth the most. This
   is part two - the ACCESS token, which was still written to localStorage.

   Be precise about what that buys, because "the session token is no longer in
   localStorage" sounds like more than it is. It does NOT stop an injected
   script running on this page: script that can read localStorage can read a
   module variable just as easily. It stops everything that reads storage
   WITHOUT executing here - an extension enumerating it, a shared machine, a
   stolen disk image - and it stops a working credential outliving the tab.

   And it introduces the one thing that can actually break: on a reload there
   is no token in hand, only a cookie the page cannot see. Everything has to
   come back from that. A change that made storage cleaner and reloads sign
   people out would be worse than the thing it replaced, so this suite reloads
   for real and checks the session is still there afterwards.

   The other half of the test is the fallback. A deployment with no configured
   origin cannot use a SameSite=None cookie - the browser refuses it - so the
   old path has to keep working there rather than the session silently failing
   to survive a reload. Both modes are exercised. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const PORT = 9213;
const ORIGIN = 'http://localhost:' + PORT;
const PW = 'A-real-Passw0rd!';
const WHO = 'reloader@example.com';

const outbound = makeOutbound();
outbound.on(/resend|mail|sendgrid|postmark/i, () => ({ id: 'e1' }));

/* ALLOWED_ORIGIN is what turns cookie mode on: the Worker only sets the cookie
   when it can answer with a concrete Allow-Origin, because a browser refuses a
   SameSite=None cookie without one. */
const env = makeEnv({ APP_URL: ORIGIN, ALLOWED_ORIGIN: ORIGIN });
const L = await bootLive({ env, outbound, port: PORT });
const { page } = L;

async function signUp(p) {
  await p.evaluate(async ([em, pw]) => {
    const until = async (label, cond, ms) => {
      const stop = Date.now() + ms;
      while (Date.now() < stop) {
        try { if (cond()) return; } catch (e) {}
        await new Promise(x => setTimeout(x, 40));
      }
      throw new Error('timed out waiting for ' + label);
    };
    openAuth('signup');
    await until('the signup form', () => document.querySelector('#a-name'), 8000);
    const type = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Rex'); type('#a-email', em); type('#a-pass', pw);
    document.getElementById('auth-submit').click();
    await until('the signup for ' + em, () => S.user && S.user.email === em, 20000);
  }, [WHO, PW]);
}

section('Signing in puts nothing token-shaped on disk');
{
  await signUp(page);

  const after = await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    /* Every value, not just the keys we expect. A token written under a name
       nobody thought to check is still a token on disk, and naming the keys
       would only ever find the ones already known about. A JWT is three
       base64url segments separated by dots and is unmistakable. */
    const jwtish = keys.filter(k => {
      const v = localStorage.getItem(k) || '';
      return /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(v.trim());
    });
    return {
      cookieMode: !!(window.AMV_API && AMV_API.cookieAuth),
      signedIn: !!(S.user && S.user.email),
      hasToken: !!(window.AMV_API && AMV_API.token),
      hasSession: !!(window.AMV_API && AMV_API.hasSession),
      accessOnDisk: localStorage.getItem('amv_api_token') || '',
      refreshOnDisk: localStorage.getItem('amv_api_refresh') || '',
      jwtish,
    };
  });

  ok(after.cookieMode, 'the deployment is in cookie mode, so this is the path under test', after.cookieMode);
  ok(after.signedIn, 'somebody is signed in', after.signedIn);
  ok(after.hasToken, 'and there is a working access token in hand', after.hasToken);
  ok(after.hasSession, 'so the session reads as live', after.hasSession);
  ok(after.accessOnDisk === '', 'the access token is NOT in localStorage', after.accessOnDisk.slice(0, 24));
  ok(after.refreshOnDisk === '', 'and neither is the refresh token', after.refreshOnDisk.slice(0, 24));
  ok(after.jwtish.length === 0,
     'nothing anywhere in storage is shaped like a token, under any key', after.jwtish);
}

section('And nothing script can read carries the refresh token');
{
  const seen = await page.evaluate(() => document.cookie);
  ok(!/amv_rt/.test(seen), 'document.cookie does not contain the refresh cookie', seen.slice(0, 120));

  /* WHAT THIS SUITE DOES NOT TRY TO PROVE, AND WHY.

     The obvious next assertion is that the browser's cookie jar really holds
     an HttpOnly amv_rt - otherwise the absence above would pass just as well
     on a deployment that never set one. It is not asserted here because this
     harness answers the API through Playwright's request interception, and a
     fulfilled response does not go through the cookie jar. The jar is empty in
     this suite for a reason that is about the test rig, not about AMV, and an
     assertion that fails for that reason would be a check nobody believes.

     The cookie itself is proved where it is actually produced:
     tests/worker/the-long-lived-half-is-out-of-reach asserts the Set-Cookie
     header, HttpOnly, Secure, SameSite=None and Path=/auth against the real
     Worker response. What is left for THIS suite is the half that had no
     coverage at all - what the client does with a session it cannot see - and
     that is what everything below exercises. */
  const told = await page.evaluate(() => ({
    mode: !!(window.AMV_API && AMV_API.cookieAuth),
    rtOnDisk: localStorage.getItem('amv_api_refresh') || '',
  }));
  ok(told.mode, 'the client knows the server is holding it', told.mode);
  ok(told.rtOnDisk === '', 'and keeps no copy of its own', told.rtOnDisk.slice(0, 24));
}

section('A reload brings the session back from nothing this page can read');
{
  /* THE ONE THAT MATTERS. Memory is gone, storage has no credential, and the
     only thing that can bring the session back is a refresh the server answers
     from a cookie the page cannot see. If that does not work, the change traded
     a real improvement for signing people out every time they press F5.

     THE COOKIE ITSELF IS SIMULATED HERE, AND THAT IS DELIBERATE. This harness
     answers the API through Playwright's request interception, and a fulfilled
     response never reaches the browser's cookie jar - so a real cookie cannot
     make this round trip in this rig, however correct AMV is. Asserting against
     that would be asserting against the test rig.

     So the two halves are proved where each can be. The Worker really does set
     the cookie, with HttpOnly, Secure, SameSite=None and Path=/auth - see
     tests/worker/the-long-lived-half-is-out-of-reach. What had NO coverage at
     all, and is what this change actually risks, is the client half: on a fresh
     page, with nothing in storage and nothing in memory, does AMV know it still
     has a session, ask for a new token, and end up authenticated?

     The stub stands in for exactly one thing - the browser presenting a cookie
     the script cannot read - and answers /auth/refresh the way the Worker does.
     Everything else in the restore is the real code. */
  await page.addInitScript(() => {
    const real = window.fetch;
    window.fetch = async (u, o) => {
      if (String(u).includes('/auth/refresh')) {
        /* SLOW ON PURPOSE, and the delay is load-bearing.

           Without it the refresh answered so fast that a token was already in
           hand by the time the assertion below ran - so "the session reads as
           live before any token has been minted" was testing nothing, and
           removing the flag it exists for left the suite green. A real network
           round trip is not instant; a stub that is instant hides the entire
           window this flag was written for. */
        await new Promise(r => setTimeout(r, 900));
        /* What the Worker returns when it recognises the cookie. No refresh
           token in the body: that is the point of cookie mode, and a stub that
           handed one back would let a broken client pass by falling into the
           old path. */
        return new Response(JSON.stringify({
          ok: true, token: 'restored.access.token', email: 'reloader@example.com',
          name: 'Rex', refreshInCookie: true,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return real(u, o);
    };
  });

  await page.reload({ waitUntil: 'load' });

  /* Read as early as possible. The question is whether a screen drawn in the
     first moments of the page would render signed out - so waiting first would
     miss the failure entirely. */
  const early = await page.evaluate(() => ({
    hasSession: !!(window.AMV_API && AMV_API.hasSession),
    cookieMode: !!(window.AMV_API && AMV_API.cookieAuth),
    token: !!(window.AMV_API && AMV_API.token),
  }));
  ok(early.cookieMode, 'the page comes back knowing it is in cookie mode', early);
  /* Stated, so the assertion after it cannot pass for the wrong reason. If a
     token were already in hand, "the session reads as live" would be true
     whether or not the flag existed - which is exactly how this suite first
     stayed green with the flag removed. */
  ok(early.token === false,
     'and no token has been minted yet, so the next line is really about the gap', early);
  ok(early.hasSession,
     'the session reads as live immediately, before any token has been minted', early);

  const back = await page.evaluate(async () => {
    const stop = Date.now() + 20000;
    while (Date.now() < stop) {
      if (window.AMV_API && AMV_API.token) break;
      await new Promise(r => setTimeout(r, 50));
    }
    return {
      token: AMV_API.token || '',
      restoring: !!AMV_API._restoring,
      onDisk: localStorage.getItem('amv_api_token') || '',
      hasSession: !!AMV_API.hasSession,
    };
  });

  ok(back.token === 'restored.access.token',
     'a fresh access token was minted without the page ever holding a credential', back.token.slice(0, 30));
  ok(back.restoring === false, 'and the restoring flag was cleared once it landed', back.restoring);
  ok(back.hasSession, 'the session is live on its own terms now, not on the flag', back.hasSession);
  ok(back.onDisk === '', 'and the new token did not go to disk either', back.onDisk.slice(0, 24));
}

section('A restore that FAILS ends up signed out, not stuck pretending');
{
  /* The other side of the flag, and the more dangerous one. _restoring makes
     hasSession answer true before anything has been proved. If it were left set
     when the refresh fails - a revoked session, an expired cookie, a server
     that is down - the person would be shown a screen full of controls that all
     401, forever, with no way to understand why. It has to resolve to false. */
  const ctx = await page.context().browser().newContext();
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => {
    const real = window.fetch;
    window.fetch = async (u, o) => {
      if (String(u).includes('/auth/refresh')) {
        return new Response(JSON.stringify({ error: 'expired' }), { status: 401 });
      }
      return real(u, o);
    };
  });
  await p2.goto('http://localhost:' + PORT, { waitUntil: 'load' });
  await p2.evaluate(() => {
    /* A device that was signed in, in cookie mode, whose session is no longer
       good. Both keys are global, so this is the state a returning person
       really arrives in. */
    localStorage.setItem('amv_refresh_cookie', '1');
    localStorage.setItem('amv_user', JSON.stringify({ name: 'Rex', email: 'reloader@example.com', ini: 'R' }));
  });
  await p2.reload({ waitUntil: 'load' });
  await p2.evaluate(() => { try { goApp(); } catch (e) {} });

  const out = await p2.evaluate(async () => {
    const stop = Date.now() + 15000;
    while (Date.now() < stop) {
      if (!AMV_API._restoring) break;
      await new Promise(r => setTimeout(r, 50));
    }
    return { restoring: !!AMV_API._restoring, token: !!AMV_API.token,
             hasSession: !!AMV_API.hasSession };
  });
  ok(out.restoring === false, 'the restore resolves rather than hanging', out.restoring);
  ok(out.token === false, 'no token was obtained', out.token);
  ok(out.hasSession === false,
     'and the session reads as over, so nothing offers controls that cannot work', out.hasSession);
  await ctx.close();
}

section('Signing out clears what is in memory, not just what is on disk');
{
  const gone = await page.evaluate(async () => {
    await AMV_API.logout(false);
    signOut();
    await new Promise(r => setTimeout(r, 300));
    return { token: !!AMV_API.token, mem: !!AMV_API._atMem,
             rt: !!AMV_API._rtMem, restoring: !!AMV_API._restoring,
             hasSession: !!AMV_API.hasSession };
  });
  /* A sign-out that emptied storage and left a usable token in a module
     variable would be a sign-out that only looked like one: the next request
     would still succeed. */
  ok(!gone.token, 'no token is left in hand', gone.token);
  ok(!gone.mem, 'the access token is cleared from memory', gone.mem);
  ok(!gone.rt, 'and so is any refresh token held for this page', gone.rt);
  ok(!gone.restoring, 'and nothing is left claiming a restore is in progress', gone.restoring);
  ok(!gone.hasSession, 'so the session reads as over', gone.hasSession);
}

await L.close();

section('Without a configured origin it keeps the old path, and still works');
{
  /* HONEST DEGRADATION, NOT A COMPROMISE. There is no cookie to re-mint from
     here, so a memory-only token would mean signing in again on every reload -
     "more secure" by being broken. The old path stays for these deployments,
     and this proves it stayed working rather than being left as a claim. */
  const ob2 = makeOutbound();
  ob2.on(/resend|mail|sendgrid|postmark/i, () => ({ id: 'e1' }));
  const env2 = makeEnv({ APP_URL: 'http://localhost:9215' });   // no ALLOWED_ORIGIN
  const L2 = await bootLive({ env: env2, outbound: ob2, port: 9215 });

  await L2.page.evaluate(async ([em, pw]) => {
    const until = async (cond, ms) => {
      const stop = Date.now() + ms;
      while (Date.now() < stop) { try { if (cond()) return; } catch (e) {} await new Promise(x => setTimeout(x, 40)); }
      throw new Error('timed out');
    };
    openAuth('signup');
    await until(() => document.querySelector('#a-name'), 8000);
    const type = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Plain'); type('#a-email', em); type('#a-pass', pw);
    document.getElementById('auth-submit').click();
    await until(() => S.user && S.user.email === em, 20000);
  }, ['plain@example.com', PW]);

  const plain = await L2.page.evaluate(() => ({
    cookieMode: !!(window.AMV_API && AMV_API.cookieAuth),
    onDisk: !!localStorage.getItem('amv_api_token'),
    hasSession: !!(window.AMV_API && AMV_API.hasSession),
  }));
  ok(plain.cookieMode === false, 'this deployment is NOT in cookie mode', plain.cookieMode);
  ok(plain.onDisk, 'so the token is kept where it can be re-read after a reload', plain.onDisk);
  ok(plain.hasSession, 'and the session is live', plain.hasSession);

  await L2.page.reload({ waitUntil: 'load' });
  await L2.page.waitForTimeout(500);
  const still = await L2.page.evaluate(() => ({
    hasSession: !!(window.AMV_API && AMV_API.hasSession),
    token: !!(window.AMV_API && AMV_API.token),
  }));
  ok(still.token && still.hasSession, 'and it survives a reload the old way', still);

  await L2.close();
}

if (report('the-session-survives-a-reload-without-a-token-on-disk') > 0) process.exitCode = 1;
done();
