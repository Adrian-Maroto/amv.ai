/* THE ONE JOURNEY NOBODY HAD EVER TESTED: A STRANGER, ALL THE WAY THROUGH.

   Eighty e2e files, and every one of them stubs the network and boots the app
   with a backend already configured. That is right for testing a screen, and
   it is exactly why three separate defects shipped that made AMV unusable for
   everybody who was not the owner:

     the API base lived only in the owner's localStorage
     so did the Google client id, so the first sign-up button was dead
     the captcha site key had no route to the browser at all, so setting
       TURNSTILE_SECRET would have refused every sign-up on the site

   None of them is findable with a stub, because a stub answers what the test
   already expects. And none is findable by using the product, because the
   person using it is the person who typed the configuration in.

   So this runs amv-backend.js - the file wrangler deploys - behind a real
   Chromium, over real cross-origin requests with real CORS and real tokens,
   and walks the whole thing end to end: land with empty storage, sign up, be
   refused a plan you have not paid for, pay, have the WEBHOOK grant it, and
   then find it on a second device that has never heard of you.

   The second device is the point of the last part. A plan the client granted
   itself looks identical to a plan the server granted, right up until you open
   the app somewhere else. */
import { bootLive, makeEnv, makeOutbound, BACKEND } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const outbound = makeOutbound();
const env = makeEnv({
  GOOGLE_CLIENT_ID: '123-abc.apps.googleusercontent.com',
  SUPPORT_EMAIL: 'help@amv.test',
  STRIPE_SECRET_KEY: 'sk_test_notreal',
  STRIPE_WEBHOOK_SECRET: 'whsec_testsecret',
  STRIPE_PRICE_PRO: 'price_pro_123',
  APP_URL: 'http://localhost:9160',
});

/* The outside world. Stripe is the only thing this journey needs from it. */
outbound.on(/api\.stripe\.com\/v1\/checkout\/sessions/, () => ({
  id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1',
}));
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));

const L = await bootLive({ env, outbound, port: 9161 });
const { page } = L;

const EMAIL = 'stranger@example.com';
const PASSWORD = 'A-real-Passw0rd!';

section('A visitor who has never been here arrives fully live');
{
  /* Nothing typed, nothing stored. This is the state every real customer is
     in and the one no other test has ever run in. */
  const r = await page.evaluate(() => ({
    stored: (() => { try { return localStorage.getItem('amv_api_base'); } catch (e) { return null; } })(),
    base: AMV_API.base,
    live: !!AMV_API.live,
  }));
  ok(r.stored === null, 'they have configured nothing', r.stored);
  ok(r.base === BACKEND, 'and the app still knows where its backend is', r.base);
  ok(r.live === true, 'so it is a real product to them, not a demo', r.live);
}

section('The backend tells their browser what it needs to sign in');
{
  await L.settle();
  ok(L.hit(/\/v1\/public-config/).length > 0,
     'public-config was really fetched over the wire', L.hit(/\/v1\/public-config/).length);
  const r = await page.evaluate(() => ({
    google: loadStr('amv_gauth') || '',
    support: loadStr('amv_support_email') || '',
  }));
  ok(r.google === '123-abc.apps.googleusercontent.com',
     'Continue with Google has an id, on a machine that never pasted one', r.google);
  ok(r.support === 'help@amv.test', 'and support has an address', r.support);
}

section('The status indicator says the backend is healthy, because it is');
{
  /* It asked /health and the Worker serves /v1/health, so every healthy
     deployment answered 404 and the indicator read "Some services degraded"
     permanently. Found by pointing this harness at the real routes. */
  const r = await page.evaluate(async () => {
    const s = await _checkStatus();
    return { backend: s.backend, dot: (document.getElementById('sb-status-dot') || {}).className || '' };
  });
  ok(r.backend === 'ok', 'the health check reaches a route that exists', r.backend);
  ok(!/degraded/.test(r.dot), 'and the indicator is not stuck on degraded', r.dot);
  ok(L.hit(/\/v1\/health/).length > 0, 'over the wire, at the real path', L.hit(/\/v1\/health/).length);
}

section('They can create a real account, and it exists on the server');
{
  const r = await page.evaluate(async ([em, pw]) => {
    const res = await AMV_API.signup(em, 'Stranger', pw);
    return { ok: !!res, token: (loadStr('amv_api_token') || '').slice(0, 12),
             user: (JSON.parse(loadStr('amv_user') || 'null') || {}).email || '' };
  }, [EMAIL, PASSWORD]);
  await L.settle();
  ok(r.token.length > 0, 'the browser was issued a real token', r.token.length);

  /* And the account is in storage the server owns, not in the browser's. A
     local-only account is exactly what the demo mode produces, and it looks
     identical from the screen. */
  const acct = await env.AMV_KV.get('acct:' + EMAIL);
  ok(!!acct, 'the account really exists in the backend', !!acct);
  ok(!/A-real-Passw0rd/.test(String(acct)),
     'and the password is not sitting in it', String(acct).slice(0, 80));
}

section('A brand new account is Free, whatever the browser might like to think');
{
  const r = await page.evaluate(async () => {
    const ent = await AMV_API.entitlement((S.user && S.user.email) || '');
    return { plan: (ent.entitlement || {}).plan || ent.plan || 'free' };
  });
  ok(r.plan === 'free', 'the server says free', r.plan);
}

section('Asking for a paid plan they have not paid for changes nothing');
{
  /* The most valuable thing a server can refuse. If the browser could talk
     itself into a plan, none of the rest of this matters. */
  const before = await env.AMV_KV.get('ent:' + EMAIL);
  const r = await page.evaluate(async () => {
    try { _setPlan('ultra'); } catch (e) {}
    const ent = await AMV_API.entitlement((S.user && S.user.email) || '');
    return { localSaid: loadStr('amv_plan'), serverSaid: (ent.entitlement || {}).plan || 'free' };
  });
  ok(r.localSaid === 'ultra', 'the browser was told to believe it', r.localSaid);
  ok(r.serverSaid === 'free', 'and the server is unmoved', r.serverSaid);
  const after = await env.AMV_KV.get('ent:' + EMAIL);
  ok(String(before || '') === String(after || ''),
     'nothing was written to the entitlement record', { before, after });
}

section('Checkout is a real Stripe session, created by the server');
{
  const r = await page.evaluate(async () => {
    try { return { url: await AMV_API.stripeCheckout('pro', (S.user && S.user.email) || '') }; }
    catch (e) { return { err: e.message }; }
  });
  ok(/checkout\.stripe\.com/.test(r.url || ''),
     'the browser gets a processor URL it did not invent', r.url || r.err);
  const calls = outbound.sentTo(/checkout\/sessions/);
  ok(calls.length === 1, 'and the server is what called Stripe', calls.length);
  ok(/price_pro_123/.test(calls[0].body),
     'with the price id from the Worker, not one sent by the browser', /price_pro_123/.test(calls[0].body));
  /* AMV-025: the redirect a customer is sent back to comes from the server's
     APP_URL, never from the request. A reflected Origin here is a phishing
     redirect handed out by AMV's own checkout. */
  const sent = decodeURIComponent(calls[0].body);
  ok(/success_url=http:\/\/localhost:9160/.test(sent),
     'and the return URL is the one the SERVER is configured with', (sent.match(/success_url=[^&]*/) || [])[0]);
  ok(/client_reference_id=stranger%40example\.com/.test(calls[0].body),
     'tied to the account that asked, so the webhook knows who paid', true);
}

section('The WEBHOOK is what grants the plan');
{
  /* Not the redirect, not the browser, not the URL parameter. This is the only
     thing in the entire product that may turn money into access. */
  const payload = JSON.stringify({
    id: 'evt_1', type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', status: 'active', metadata: { email: EMAIL },
                      items: { data: [{ price: { id: 'price_pro_123' }, quantity: 1 }] } } },
  });
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('whsec_testsecret'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  const sig = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');

  const res = await L.worker.fetch(new Request(BACKEND + '/v1/stripe/webhook', {
    method: 'POST', headers: { 'Stripe-Signature': `t=${t},v1=${sig}` }, body: payload,
  }), env, { waitUntil() {}, passThroughOnException() {} });
  ok(res.status === 200, 'the signed event is accepted', res.status);

  const ent = JSON.parse(await env.AMV_KV.get('ent:' + EMAIL) || '{}');
  ok(ent.plan === 'pro', 'and the account is now on Pro, server-side', ent.plan);
  ok(typeof ent.renewedAt === 'number',
     'stamped as paid-for, so the renewal sweep knows it is current', ent.renewedAt);
}

section('A FORGED webhook grants nothing');
{
  const payload = JSON.stringify({
    id: 'evt_forged', type: 'customer.subscription.updated',
    data: { object: { id: 'sub_x', status: 'active', metadata: { email: EMAIL },
                      items: { data: [{ price: { id: 'price_ultra_999' }, quantity: 1 }] } } },
  });
  const res = await L.worker.fetch(new Request(BACKEND + '/v1/stripe/webhook', {
    method: 'POST', headers: { 'Stripe-Signature': 't=1,v1=deadbeef' }, body: payload,
  }), env, { waitUntil() {}, passThroughOnException() {} });
  ok(res.status === 400, 'an unsigned event is refused', res.status);
  const ent = JSON.parse(await env.AMV_KV.get('ent:' + EMAIL) || '{}');
  ok(ent.plan === 'pro', 'and the plan is untouched', ent.plan);
}

section('The plan is really theirs: it is there on a device that has never seen them');
{
  /* Everything above could be true of a plan the browser granted itself. This
     is where that stops being true. A second browser context shares nothing
     with the first - no storage, no token, no session - only the server. */
  const d2 = await L.otherDevice();
  const r = await d2.page.evaluate(async ([em, pw]) => {
    const fresh = (localStorage.getItem('amv_plan') || 'none');
    await AMV_API.login(em, { password: pw, provider: 'email' });
    const ent = await AMV_API.entitlement(em);
    return { fresh, plan: (ent.entitlement || {}).plan || 'free' };
  }, [EMAIL, PASSWORD]);
  await d2.context.close();
  ok(r.fresh === 'none', 'the new device starts knowing nothing', r.fresh);
  ok(r.plan === 'pro',
     'and the plan they paid for is waiting for them on it', r.plan);
}

section('Nothing in the whole journey threw');
{
  ok(L.errors.length === 0, 'no JavaScript errors', L.errors);
  const failed = L.served.filter(s => s.status >= 500);
  ok(failed.length === 0, 'and no request made the Worker fall over', failed);
}

section('And every request really went over the wire to the real routes');
{
  /* Cheap insurance against the whole file passing because a stub crept back
     in and nothing was ever actually asked. */
  const paths = [...new Set(L.served.map(s => s.path))];
  ok(paths.includes('/auth/signup'), 'signup was a real request', paths.length);
  ok(paths.includes('/v1/entitlement'), 'so was the entitlement read', paths.length);
  ok(paths.includes('/v1/stripe/checkout'), 'so was checkout', paths.length);
  ok(L.served.every(s => s.status < 500), 'and all of them were answered', paths.length);
}

await L.close();
if (report('the-whole-funnel') > 0) process.exitCode = 1;
done();
