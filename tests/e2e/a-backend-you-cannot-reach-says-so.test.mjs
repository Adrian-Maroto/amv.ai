/* A BACKEND URL CAN BE PERFECTLY CORRECT AND STILL UNREACHABLE.

   connect-src is fixed when the page is built. So a host typed into Settings
   can be the right host, spelled right, with the server up - and the browser
   still refuses the request before it leaves. Every call returns "Failed to
   fetch", which from the outside is indistinguishable from a server that is
   down or a URL with a typo. Somebody would reasonably spend an evening on
   the wrong problem.

   The build half of this is fixed where it belongs: baking a backend in now
   teaches the policy about it, so a production build cannot instruct the page
   to call an address it may not use. This is the half that build cannot
   reach - a host typed in at runtime, long after the policy was sealed - and
   the answer is to say so precisely rather than let it fail as a mystery.

   The page can read its own policy, so this is answerable rather than
   guessable. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

section('The page knows which hosts it is allowed to contact');
{
  const r = await page.evaluate(() => ({
    own: _cspReachable(location.origin),
    workers: _cspReachable('https://amv-backend.someone.workers.dev'),
    stripe: _cspReachable('https://api.stripe.com'),
    /* A HOST THAT CANNOT BECOME REAL.

       This read `https://api.amv.homes` and passed for months, because that
       host was not in the policy. Then it became AMV's actual backend - the
       *.workers.dev address was blocked by school filters as free hosting -
       and the fixture inverted: the suite asserted a permitted host was
       forbidden and went red on a product that was correct.

       example.com is reserved by RFC 2606 for exactly this. It can never be
       AMV's backend, so this assertion can never mean the opposite of what it
       says. A fixture that names a plausible domain is a fixture waiting for
       somebody to register it. */
    custom: _cspReachable('https://backend.example.com'),
    stranger: _cspReachable('https://evil.example'),
  }));
  ok(r.own === true, 'its own origin, which is what a same-origin build uses', r.own);
  ok(r.workers === true, 'a workers.dev backend, through the wildcard', r.workers);
  ok(r.stripe === true, 'a host named outright in the policy', r.stripe);
  ok(r.custom === false, 'and it knows a host outside the policy is NOT permitted', r.custom);
  ok(r.stranger === false, 'nor is anything else', r.stranger);
}

section('Saving an unreachable backend says exactly that');
{
  const said = await page.evaluate(() => {
    const t = []; const real = window.toast;
    window.toast = (m, k) => { t.push((k || '') + ' | ' + m); return real(m, k); };
    const el = document.createElement('input');
    el.id = 'be-url'; el.value = 'https://backend.example.com';
    document.body.appendChild(el);
    amvSaveBackend();
    window.toast = real; el.remove();
    return t.join(' ');
  });
  ok(/not allowed to contact/i.test(said),
     'it says the page may not contact that host', said.slice(0, 70));
  /* The detail is the MESSAGE, not `true`. When this went red it printed
     "got: true", which says nothing about what the toast actually said - and
     the whole point of the assertion is the wording. */
  ok(/backend\.example\.com/.test(said),
     'naming the host, so there is nothing to guess at', said.slice(0, 90));
  ok(/AMV_API_BASE/.test(said),
     'and names what actually fixes it, rather than only reporting a fault', true);
  ok(/error \|/.test(said), 'as an error, not as a cheerful "saved"', said.slice(0, 30));
}

section('A reachable backend is saved without a lecture');
{
  const said = await page.evaluate(() => {
    const t = []; const real = window.toast;
    window.toast = (m, k) => { t.push((k || '') + ' | ' + m); return real(m, k); };
    const el = document.createElement('input');
    el.id = 'be-url'; el.value = 'https://amv-backend.someone.workers.dev';
    document.body.appendChild(el);
    amvSaveBackend();
    window.toast = real; el.remove();
    return t.join(' ');
  });
  ok(/saved/i.test(said) && !/not allowed/i.test(said),
     'a host the policy permits is just saved', said.slice(0, 60));
}

section('When the policy cannot be read, nothing is claimed about it');
{
  /* A warning invented from an unknown is worse than silence: it would send
     somebody chasing a policy problem that may not exist. */
  const r = await page.evaluate(() => {
    const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    const keep = m.content;
    m.content = 'default-src \'self\'';          // a policy with no connect-src
    const unknown = _cspReachable('https://backend.example.com');
    m.content = keep;
    return unknown;
  });
  ok(r === null, 'it answers "cannot tell" rather than "not allowed"', r);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('a-backend-you-cannot-reach-says-so') > 0) process.exitCode = 1;
done();
