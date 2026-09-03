/* THE VIOLATION THE BROWSER REALLY DISPATCHES, NOT ONE THE TEST MADE UP.

   The page-level notice is driven by a `securitypolicyviolation` listener that
   inspects `violatedDirective` and `blockedURI`. The suite that introduced it
   dispatched a hand-built Event with those two properties assigned - which
   proves the listener's logic and nothing about whether Chrome's real event
   carries what the listener expects, or in the shape it expects.

   That distinction is not academic here. Earlier the same day, a CSP
   experiment that lifted one directive out and tested it alone gave a
   confident wrong answer, and a second one silently proved nothing because its
   own probe had been blocked by its own policy. This file uses the SHIPPED
   policy in a real browser and makes a request that policy genuinely refuses,
   so the event under test is one Chrome produced.

   The trick is to point AMV's backend at a host the real connect-src does not
   permit. Everything downstream is then exactly what the owner hit: a request
   refused before it left, an empty site key, and - now - a page that says so. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: '' });
const { page } = app;

/* Not in connect-src. The shipped policy allows 'self', a short list of named
   third parties, and https://*.workers.dev - and this is none of them. */
const FORBIDDEN = 'https://blocked.example.com';

section('The shipped policy really does refuse an unlisted host');
{
  const r = await page.evaluate(async (base) => {
    const seen = [];
    const h = (e) => seen.push({ d: e.violatedDirective, uri: e.blockedURI });
    document.addEventListener('securitypolicyviolation', h);
    let err = '';
    try { await fetch(base + '/v1/public-config'); } catch (e) { err = String(e.message || e); }
    await new Promise(r => setTimeout(r, 200));
    document.removeEventListener('securitypolicyviolation', h);
    return { seen, err };
  }, FORBIDDEN);
  ok(r.seen.length > 0, 'the browser reports a violation', r);
  ok(/connect-src/.test((r.seen[0] || {}).d || ''),
     'and names connect-src, which is what the listener keys on', r.seen[0]);
  ok(String((r.seen[0] || {}).uri || '').indexOf(FORBIDDEN) === 0,
     'and the blocked URI really does start with the backend origin', r.seen[0]);
}

section('So the page says what happened, from a real refusal');
{
  const got = await page.evaluate(async (base) => {
    /* The state the owner was in: a configured backend this network refuses. */
    AMV_API.base = base;
    localStorage.removeItem('amv_turnstile_site');
    window.__AMV_TURNSTILE_SITE_KEY__ = '';
    _publicConfigDone = false; _publicConfigFail = '';
    const bar = document.getElementById('offline-bar');
    if (bar) { bar.classList.remove('show'); delete bar.dataset.sticky; }

    await window._loadPublicConfig();
    await new Promise(r => setTimeout(r, 300));

    const b = document.getElementById('offline-bar');
    const cs = b ? getComputedStyle(b) : null;
    const rect = b ? b.getBoundingClientRect() : null;
    return {
      reason: configUnreachable(),
      visible: !!(b && cs.display !== 'none' && rect.height > 0),
      text: b ? (b.textContent || '').trim() : '',
    };
  }, FORBIDDEN);

  ok(!!got.reason, 'the refusal is recorded as a reason', got.reason);
  ok(/security policy/i.test(got.reason),
     'identified as a policy block rather than a guess at the network', got.reason);
  ok(got.visible, 'and the page-level bar is on the screen', got);
  ok(/blocking AMV from reaching its own server/i.test(got.text),
     'saying what is actually wrong', got.text.slice(0, 140));
  ok(/different network|mobile data/i.test(got.text),
     'and what to try', got.text.slice(0, 220));
}

section('And the sign-up form stops blaming the person');
{
  const html = await page.evaluate(() => {
    let b = document.getElementById('a-turnstile');
    if (!b) { b = document.createElement('div'); b.id = 'a-turnstile'; document.body.appendChild(b); }
    b.innerHTML = ''; b.style.display = ''; delete b.dataset.failed;
    _mountTurnstile();
    return b.innerHTML;
  });
  ok(/could not reach its own server/i.test(html),
     'the captcha slot explains itself', html.slice(0, 160));
  ok(!/complete the verification/i.test(html),
     'and never asks for a verification that cannot be shown');
}

await app.close();
if (report('a-real-refusal-reaches-the-person') > 0) process.exitCode = 1;
done();
