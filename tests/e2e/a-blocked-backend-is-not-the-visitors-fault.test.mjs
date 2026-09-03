/* "PLEASE COMPLETE THE VERIFICATION AND TRY AGAIN", WITH NO VERIFICATION ON SCREEN.

   The owner could not sign up on a school Chromebook. The Worker was serving
   TURNSTILE_SITE_KEY correctly - confirmed by opening /v1/public-config in a
   tab - and the page never drew the widget. What the console held was one line:

     [AMV] csp.connect-src: https://<worker>/v1/public-config

   The network refuses the request before it leaves the browser. Tested against
   the shipped policy in Chromium, AMV's own connect-src permits that host, and
   the page carried exactly one policy with no header policy behind it - so the
   restriction is being added on the machine, by a filter, and is not something
   this repository can or should widen its way around.

   What IS AMV's to fix is everything that happened next. With no site key,
   _mountTurnstile hid its empty box - correct for a deployment that has no
   captcha configured, and precisely wrong here, because the server still
   demands a token. So the sign-up came back "Please complete the verification
   and try again" about a box that was not on the screen and could not be put
   there. The person is blamed for their network and given nothing to act on,
   which is how this feature came to be deleted twice.

   Both situations are an empty string at the point of decision, which is why
   one line of code served both. The config loader now records WHY it has
   nothing, and the policy listener names the case it can identify exactly -
   the blocked address being the backend the build shipped. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: '' });
const { page, errors } = app;

const BASE = 'https://amv-e2e.workers.dev';
const boxHTML = () => page.evaluate(() => {
  const b = document.getElementById('a-turnstile');
  return b ? { html: b.innerHTML, hidden: b.style.display === 'none', failed: b.dataset.failed || '' } : null;
});

/* The sign-up sheet has to exist for any of this to be visible. */
async function openSignUp() {
  await page.evaluate(() => {
    let b = document.getElementById('a-turnstile');
    if (!b) {
      b = document.createElement('div');
      b.id = 'a-turnstile';
      document.body.appendChild(b);
    }
    b.innerHTML = ''; b.style.display = ''; delete b.dataset.failed; delete b.dataset.rendered;
  });
}

section('A deployment with no captcha configured still shows nothing');
{
  /* The behaviour that was right all along, and must not regress: no key, no
     failed fetch, nothing expected - so no invented problem. */
  await openSignUp();
  await page.evaluate(() => {
    localStorage.removeItem('amv_turnstile_site');
    window.__AMV_TURNSTILE_SITE_KEY__ = '';
    _publicConfigFail = '';
    _mountTurnstile();
  });
  const b = await boxHTML();
  ok(b.hidden, 'the empty box is hidden', b);
  ok(b.html === '', 'and nothing is drawn in it', b.html);
}

section('A backend the network refuses is named, not hidden');
{
  await openSignUp();
  await page.evaluate((base) => {
    localStorage.removeItem('amv_turnstile_site');
    window.__AMV_TURNSTILE_SITE_KEY__ = '';
    AMV_API.base = base;
    _publicConfigFail = "this network's security policy blocked it";
    _mountTurnstile();
  }, BASE);
  const b = await boxHTML();
  ok(!b.hidden, 'the box is visible rather than hidden', b);
  ok(b.failed === '1', 'and marked as failed', b.failed);
  ok(/could not reach its own server/i.test(b.html),
     'it says AMV could not reach its own server', b.html.slice(0, 200));
  ok(/security policy/i.test(b.html), 'and quotes the reason it was given', b.html.slice(0, 200));
  ok(!/complete the verification/i.test(b.html),
     'and does NOT ask the person to complete a verification that is not there');
  ok(/different network|mobile data/i.test(b.html),
     'and names something they can actually try', b.html.slice(0, 240));
}

section('The reason travels from the refusal to the screen');
{
  /* End to end through the real listener rather than by setting the variable:
     a connect-src violation naming the backend must be what produces the
     message. This is the join that did not exist - the browser told AMV, AMV
     wrote a console line, and nothing carried it to the person. */
  await openSignUp();
  const got = await page.evaluate(async (base) => {
    localStorage.removeItem('amv_turnstile_site');
    window.__AMV_TURNSTILE_SITE_KEY__ = '';
    AMV_API.base = base;
    _publicConfigFail = '';
    /* Exactly the event Chrome dispatches, with the directive and the blocked
       address the owner's console showed. */
    const ev = new Event('securitypolicyviolation');
    ev.violatedDirective = 'connect-src';
    ev.blockedURI = base + '/v1/public-config';
    document.dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 50));
    const reason = configUnreachable();
    _mountTurnstile();
    return { reason, html: (document.getElementById('a-turnstile') || {}).innerHTML || '' };
  }, BASE);
  ok(!!got.reason, 'the refusal is recorded as a reason', got.reason);
  ok(/could not reach its own server/i.test(got.html),
     'and the sign-up form says so', got.html.slice(0, 200));
}

section('A violation about something else does not blame the backend');
{
  /* The page legitimately loads third-party scripts, and a filter refusing one
     of those says nothing about whether the backend is reachable. Reporting it
     as "AMV cannot reach its own server" would be a confident wrong answer. */
  await openSignUp();
  const got = await page.evaluate(async (base) => {
    AMV_API.base = base;
    _publicConfigFail = '';
    for (const [d, u] of [['connect-src', 'https://plausible.io/api/event'],
                          ['script-src',  base + '/v1/public-config'],
                          ['img-src',     'https://example.com/x.png']]) {
      const ev = new Event('securitypolicyviolation');
      ev.violatedDirective = d; ev.blockedURI = u;
      document.dispatchEvent(ev);
    }
    await new Promise(r => setTimeout(r, 50));
    return configUnreachable();
  }, BASE);
  ok(got === '', 'neither a different host nor a different directive is mistaken for it', got);
}

section('A fetch that merely failed does NOT announce a missing captcha');
{
  /* THE OVER-CLAIM THIS FILE ORIGINALLY SHIPPED, AND THE SUITE THAT CAUGHT IT.

     The first version showed the message whenever the config fetch had failed
     for any reason at all. On a deployment with NO captcha configured, a 503
     or a timeout would then announce that a verification could not be set up -
     on a sign-up form that works perfectly. A false alarm on a working form is
     its own kind of dishonesty, and a-stranger-can-pay was right to fail.

     A refusal naming this build's backend is different in kind: the browser
     refused the ORIGIN, so a key living behind it cannot arrive. That one is
     certain. Everything else waits for the server to say a verification was
     required - see the refusal section below, which is the only moment anybody
     knows. */
  await openSignUp();
  await page.unroute('**/v1/public-config').catch(() => {});
  await page.route('**/v1/public-config', route => route.fulfill({ status: 503, body: '{}' }));
  const got = await page.evaluate(async (base) => {
    localStorage.removeItem('amv_turnstile_site');
    window.__AMV_TURNSTILE_SITE_KEY__ = '';
    AMV_API.base = base;
    _publicConfigFail = ''; _publicConfigDone = false;
    await window._loadPublicConfig();
    const reason = configUnreachable();
    _mountTurnstile();
    const b = document.getElementById('a-turnstile');
    return { reason, html: b.innerHTML || '', hidden: b.style.display === 'none' };
  }, BASE);
  ok(/503/.test(got.reason), 'the reason is still recorded, as what it was', got.reason);
  ok(got.hidden, 'but the box just hides, because nothing is certain yet', got);
  ok(!/could not reach its own server/i.test(got.html),
     'nothing is announced about a captcha that may not exist', got.html.slice(0, 160));
}

section('The refusal is the moment anybody knows a verification was expected');
{
  /* And it is exact: the server has just said so. No inference, no guessing
     from an empty string, and it works whatever went wrong - a filter that
     refuses the origin, one that hangs, or a key the operator half-configured. */
  await openSignUp();
  const got = await page.evaluate(() => {
    let e = document.getElementById('auth-err');
    if (!e) { e = document.createElement('div'); e.id = 'auth-err'; document.body.appendChild(e); }
    e.textContent = ''; e.style.display = 'none';
    const box = document.getElementById('a-turnstile');
    box.style.display = 'none';                       // no key arrived
    showAuthErr('Please complete the verification and try again.', null, 'captcha_required');
    return e.textContent;
  });
  ok(/could not be loaded/i.test(got),
     'the person is told the verification could not be loaded', got.slice(0, 120));
  ok(/not something you can fix from this form/i.test(got),
     'and that it is not theirs to fix', got.slice(0, 200));
  ok(/different network|mobile data/i.test(got), 'with something to try', got.slice(0, 240));
  ok(!/^Please complete the verification/.test(got),
     'rather than being asked again for a box that is not there', got.slice(0, 60));
}

section('But with a working box on screen, the plain message is right');
{
  /* "Complete the verification" is correct advice when there IS one to
     complete - most often somebody who simply did not tick it. Rewriting that
     into a network explanation would be the same mistake pointing the other
     way. */
  await openSignUp();
  const got = await page.evaluate(() => {
    const e = document.getElementById('auth-err');
    e.textContent = ''; e.style.display = 'none';
    const box = document.getElementById('a-turnstile');
    box.style.display = ''; delete box.dataset.failed; box.dataset.rendered = '1';
    showAuthErr('Please complete the verification and try again.', null, 'captcha_required');
    return e.textContent;
  });
  ok(/^Please complete the verification/.test(got),
     'the message is left exactly as the server wrote it', got.slice(0, 80));
}

section('And an ordinary auth error is never rewritten');
{
  await openSignUp();
  const got = await page.evaluate(() => {
    const e = document.getElementById('auth-err');
    e.textContent = '';
    const box = document.getElementById('a-turnstile');
    box.style.display = 'none';                       // unusable, but irrelevant here
    showAuthErr('Wrong password. Please try again.', null, 'bad_password');
    return e.textContent;
  });
  ok(got === 'Wrong password. Please try again.',
     'a different refusal keeps its own words', got);
}

section('A key that arrives is still just a captcha');
{
  /* The whole mechanism must vanish once the normal path works. */
  await openSignUp();
  const b = await page.evaluate((base) => {
    AMV_API.base = base;
    localStorage.setItem('amv_turnstile_site', '0x4AAAAAAtestsitekey');
    _publicConfigFail = '';
    _mountTurnstile();
    const box = document.getElementById('a-turnstile');
    return { html: box.innerHTML, key: box.getAttribute('data-sitekey'), hidden: box.style.display === 'none' };
  }, BASE);
  ok(b.key === '0x4AAAAAAtestsitekey', 'the widget gets its site key', b.key);
  ok(!b.hidden, 'the box is shown');
  ok(!/could not reach/i.test(b.html), 'and no failure message is drawn', b.html.slice(0, 160));
}

ok(errors.length === 0, 'no console errors', errors);

await app.close();
if (report('a-blocked-backend-is-not-the-visitors-fault') > 0) process.exitCode = 1;
done();
