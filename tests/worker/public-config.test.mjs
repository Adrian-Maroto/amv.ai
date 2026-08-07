/* THE SIGN-UP SHEET'S FIRST BUTTON WAS DEAD FOR EVERY VISITOR.

   The Worker holds GOOGLE_CLIENT_ID. The browser did not - it read `amv_gauth`
   out of localStorage, which the owner had filled in once from their own
   Settings screen. So "Continue with Google" worked on exactly one machine and
   told everybody else it was not switched on. The same shape as the backend
   URL: configuration living in one person's browser that every visitor needs.

   /v1/public-config serves the handful of values that are public BY DESIGN - a
   Google client id, a PayPal client id, a support address - each of which
   appears in plain sight in ordinary use, in the OAuth URL, in the PayPal SDK
   tag, on a contact page.

   The assertions that matter most here are the negative ones. This endpoint is
   unauthenticated, so anything it leaks is leaked to the world: no secret key,
   no signing secret, and no way to learn which secrets a deployment holds. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'pubcfg.harness.mjs');
writeFileSync(harness, src + `
export { publicConfig, PUBLIC_CONFIG_KEYS };
`);
const W = await import(harness + '?t=' + Date.now());

const counters = new Map();
const envWith = (extra) => ({
  AMV_KV: {
    async get() { return null; }, async put() {}, async delete() {},
    async list() { return { keys: [], list_complete: true }; },
  },
  AMV_COUNTER: {
    idFromName: (n) => n,
    get: (n) => ({
      async fetch(_u, init) {
        const b = JSON.parse(init.body);
        const k = b.name || n;
        const c = (counters.get(k) || 0) + 1;
        counters.set(k, c);
        if (b.op === 'rateCheck') return new Response(JSON.stringify({ allowed: c <= (b.limit || 30) }));
        return new Response(JSON.stringify({ allowed: true, value: c }));
      },
    }),
  },
  ...extra,
});
const req = (ip = '1.2.3.4') => new Request('https://api.amv.dev/v1/public-config', {
  headers: { 'CF-Connecting-IP': ip },
});

section('A fully configured deployment tells a visitor what it can use');
{
  counters.clear();
  const r = await W.publicConfig(req(), envWith({
    GOOGLE_CLIENT_ID: '123-abc.apps.googleusercontent.com',
    TURNSTILE_SITE_KEY: '0x4AAAAAAAsiteKey',
    SUPPORT_EMAIL: 'help@amv.test',
  }));
  const d = await r.json();
  ok(r.status === 200 && d.ok === true, 'it answers', d);
  ok(d.googleClientId === '123-abc.apps.googleusercontent.com',
     'the Google client id is served, so sign-in works for everybody', d.googleClientId);
  ok(d.turnstileSiteKey === '0x4AAAAAAAsiteKey',
     'and the captcha site key, without which the widget can never render', d.turnstileSiteKey);
  ok(d.supportEmail === 'help@amv.test', 'and the support address', d.supportEmail);
}

section('It never serves anything that can sign, spend or authenticate');
{
  counters.clear();
  const r = await W.publicConfig(req(), envWith({
    GOOGLE_CLIENT_ID: 'pub-id',
    /* Set, so the assertion below that it is NOT served means something. */
    PAYPAL_CLIENT_ID: 'AYpaypalclientid',
    GOOGLE_CLIENT_SECRET: 'SHOULD-NEVER-APPEAR',
    STRIPE_SECRET_KEY: 'sk_live_SHOULD-NEVER-APPEAR',
    STRIPE_WEBHOOK_SECRET: 'whsec_SHOULD-NEVER-APPEAR',
    TURNSTILE_SECRET: 'SHOULD-NEVER-APPEAR',
    JWT_SECRET: 'SHOULD-NEVER-APPEAR',
    ADMIN_TOKEN: 'SHOULD-NEVER-APPEAR',
    AMV_MODEL_KEY: 'SHOULD-NEVER-APPEAR',
    EMAIL_API_KEY: 'SHOULD-NEVER-APPEAR',
    FINANCE_SECRET: 'SHOULD-NEVER-APPEAR',
    TWILIO_AUTH_TOKEN: 'SHOULD-NEVER-APPEAR',
    PAYPAL_SECRET: 'SHOULD-NEVER-APPEAR',
  }));
  const body = await r.text();
  ok(!/SHOULD-NEVER-APPEAR/.test(body),
     'not one secret reaches the response', body.slice(0, 200));
  ok(!/sk_live|whsec_/.test(body), 'no key material of any shape', body.slice(0, 200));
  const d = JSON.parse(body);
  const allowed = new Set(['ok', 'googleClientId', 'supportEmail', 'turnstileSiteKey']);
  const extra = Object.keys(d).filter(k => !allowed.has(k));
  ok(extra.length === 0, 'and no field beyond the three it is allowed to serve', extra);

  /* The PayPal client id used to be served here. It stopped being served when
     the browser-side PayPal SDK was removed - the browser no longer has any
     use for it, and a public value with no consumer is surface for nothing.
     PAYPAL_CLIENT_ID stays a Worker secret and PayPal runs server-side. */
  ok(!('paypalClientId' in d),
     'a value no browser uses is not served just because it is harmless', Object.keys(d));
}

section('An unset value is absent, not reported as unset');
{
  /* Otherwise this becomes a way for anybody to inventory which secrets a
     deployment holds - which is what the admin readiness endpoint is for, and
     that one is behind a token. */
  counters.clear();
  const r = await W.publicConfig(req(), envWith({ SUPPORT_EMAIL: 'help@amv.test' }));
  const d = await r.json();
  ok(!('googleClientId' in d), 'a missing Google id is simply not there', Object.keys(d));
  ok(!('turnstileSiteKey' in d), 'nor a missing captcha site key', Object.keys(d));
  ok(d.supportEmail === 'help@amv.test', 'while what is set is served', d.supportEmail);
}

section('An empty deployment answers honestly rather than failing');
{
  counters.clear();
  const r = await W.publicConfig(req(), envWith({}));
  const d = await r.json();
  ok(r.status === 200 && d.ok === true, 'still a clean answer', d);
  ok(Object.keys(d).length === 1, 'carrying nothing at all', Object.keys(d));
}

section('It is bounded, because it is open to the world');
{
  counters.clear();
  const env = envWith({ SUPPORT_EMAIL: 'help@amv.test' });
  let refused = 0;
  for (let i = 0; i < 40; i++) {
    const r = await W.publicConfig(req('9.9.9.9'), env);
    if (r.status === 429) refused++;
  }
  ok(refused > 0, 'a flood from one address is throttled', refused);
}

section('The answer is cacheable, so it costs one request per visitor');
{
  counters.clear();
  const r = await W.publicConfig(req(), envWith({ SUPPORT_EMAIL: 'help@amv.test' }));
  const cc = r.headers.get('Cache-Control') || '';
  ok(/max-age=\d+/.test(cc), 'it carries a max-age', cc);
  ok(/public/.test(cc), 'and may be cached by the edge', cc);
}

if (report('public-config') > 0) process.exitCode = 1;
done();
