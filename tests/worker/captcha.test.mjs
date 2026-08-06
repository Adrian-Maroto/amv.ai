/* BOT PROTECTION on auth - honeypot + optional Turnstile CAPTCHA.
   Proves: a filled honeypot is rejected (bot), signup/login work normally with
   no captcha configured (honest degradation), and when Turnstile is FULLY
   configured a missing/invalid token is rejected while a valid one passes.

   And the state this file used to get wrong. Turnstile has two halves:
   TURNSTILE_SITE_KEY renders the widget in the browser, TURNSTILE_SECRET
   verifies the token it produces. This suite only ever set the secret, and
   asserted that a missing token was refused - which looked like enforcement
   and was actually a description of a site-wide outage, because with no site
   key no browser can produce a token at all. GO-LIVE listed the secret on its
   own under "optional, add anytime", so setting it would have taken down every
   sign-up and every sign-in on the site.

   Both halves are set below wherever enforcement is the thing being tested,
   and the half-configured state has its own section. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'captcha.harness.mjs');
writeFileSync(harness, src + '\nexport { authSignup, authLogin, _verifyCaptcha };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const baseEnv = { JWT_SECRET: 'x'.repeat(40), AMV_KV: {
  async get(k){ return store.has(k)?store.get(k):null; },
  async put(k,v){ store.set(k,v); },
  async delete(k){ store.delete(k); },
  async list({prefix}){ return { keys:[...store.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})), list_complete:true }; }
}};
const req = (body) => new Request('https://x',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

/* ── Honeypot ─────────────────────────────────────────────────────────────── */
section('A filled honeypot is treated as a bot and blocked');
store.clear();
let r = await W.authSignup(req({ email:'bot@x.com', name:'Bot', password:'Str0ngPass!88', company:'Acme Inc' }), baseEnv);
ok(r.status === 400, 'signup with a filled honeypot is rejected', r.status);
ok(!store.has('acct:bot@x.com'), 'and no account is created for the bot');

r = await W.authLogin(req({ email:'bot@x.com', password:'Str0ngPass!88', website:'http://spam' }), baseEnv);
ok(r.status === 400, 'login with a filled honeypot is rejected', r.status);

/* ── Honest degradation with no captcha configured ───────────────────────── */
section('With no TURNSTILE_SECRET, real signup/login still work');
store.clear();
r = await W.authSignup(req({ email:'real@x.com', name:'Real', password:'Str0ngPass!88' }), baseEnv);
ok(r.status === 200, 'a normal signup succeeds when captcha is not configured', r.status);
ok(store.has('acct:real@x.com'), 'the real account is created');

r = await W.authLogin(req({ email:'real@x.com', password:'Str0ngPass!88', provider:'email' }), baseEnv);
ok(r.status === 200, 'and they can log in', r.status);

/* ── Turnstile enforced when configured ──────────────────────────────────── */
section('When Turnstile is fully set up, a token is required and verified');
const capEnv = { ...baseEnv, TURNSTILE_SECRET: 'secret', TURNSTILE_SITE_KEY: '0x4AAAsitekey' };
const halfEnv = { ...baseEnv, TURNSTILE_SECRET: 'secret' };   // secret, no site key
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if(String(url).includes('siteverify')){
    const body = String(opts.body);
    // treat token "good" as valid, anything else invalid
    return { ok:true, status:200, json: async () => ({ success: /response=good/.test(body) }) };
  }
  return origFetch(url, opts);
};

store.clear();
r = await W.authSignup(req({ email:'nocap@x.com', name:'N', password:'Str0ngPass!88' }), capEnv);
ok(r.status === 400, 'signup with NO captcha token is rejected when captcha is on', r.status);

r = await W.authSignup(req({ email:'badcap@x.com', name:'N', password:'Str0ngPass!88', captchaToken:'bad' }), capEnv);
ok(r.status === 400, 'an INVALID captcha token is rejected', r.status);

r = await W.authSignup(req({ email:'goodcap@x.com', name:'N', password:'Str0ngPass!88', captchaToken:'good' }), capEnv);
ok(r.status === 200, 'a VALID captcha token lets a real user through', r.status);
ok(store.has('acct:goodcap@x.com'), 'and the account is created');

section('_verifyCaptcha helper: unset secret passes, fully set + missing fails');
ok(await W._verifyCaptcha(baseEnv, null, req({})) === true, 'no secret configured → passes (do not block before setup)');
ok(await W._verifyCaptcha(capEnv, null, req({})) === false, 'both halves set + no token → fails');

/* ── The half-configured state ────────────────────────────────────────────── */
section('A secret with no site key does NOT take the whole site down');
{
  /* The widget cannot render without a site key, so demanding its token is
     demanding something no visitor can give. Refusing them would turn one
     missing environment variable into a total outage of sign-up and sign-in,
     reported to the operator as if their users were failing a checkbox. */
  ok(await W._verifyCaptcha(halfEnv, null, req({})) === true,
     'a visitor with no token is let through rather than locked out', true);

  store.clear();
  let r2 = await W.authSignup(req({ email: 'half@x.com', name: 'H', password: 'Str0ngPass!88' }), halfEnv);
  ok(r2.status === 200, 'signup still works', r2.status);
  ok(store.has('acct:half@x.com'), 'and the account is really created');

  r2 = await W.authLogin(req({ email: 'half@x.com', password: 'Str0ngPass!88', provider: 'email' }), halfEnv);
  ok(r2.status === 200, 'and they can sign back in', r2.status);
}

section('But it is never silent - skipping a security control is shouted about');
{
  /* Allowing everybody through IS a downgrade. It is the right one, and it
     still has to be visible, or the deployment sits unprotected for months
     while the readiness screen claims bot protection is on. */
  const logged = [];
  const realLog = console.log;
  console.log = (...a) => { logged.push(a.join(' ')); };
  const paged = [];
  const alertEnv = { ...halfEnv, ALERT_WEBHOOK: 'https://hooks.example/alert' };
  const realFetch2 = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    paged.push(String(url) + ' ' + String((opts && opts.body) || ''));
    return { ok: true, status: 200, json: async () => ({}) };
  };
  store.clear();
  await W._verifyCaptcha(alertEnv, null, req({}));
  console.log = realLog;
  globalThis.fetch = realFetch2;

  ok(logged.some(l => /captcha_misconfigured/.test(l)),
     'an audit event records that the captcha was skipped', logged.filter(l => /AUDIT/.test(l)).length);
  ok(logged.some(l => /TURNSTILE_SITE_KEY/.test(l)),
     'naming the variable that is missing, not just "misconfigured"', true);
  ok(paged.some(p => /TURNSTILE_SITE_KEY/.test(p)),
     'and the operator is paged, because they think this is switched on', paged.length);
}

section('Readiness reports HALF SET UP rather than on');
{
  /* This line used to read TURNSTILE_SECRET alone, so the one state that needs
     attention was the one it called ready. */
  const rd = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
  const item = rd.slice(rd.indexOf("id: 'captcha'"), rd.indexOf("id: 'captcha'") + 1200);
  ok(/TURNSTILE_SECRET'\)\s*&&\s*_has\(env,\s*'TURNSTILE_SITE_KEY'\)/.test(item),
     'it is only "on" when BOTH halves are set', true);
  ok(/HALF SET UP/.test(item), 'and the half state says so in words', true);
  ok(/SKIPPED/.test(item), 'and says the captcha is being skipped', true);
}

section('The site key reaches the browser, or the widget can never render');
{
  /* The whole failure came from the site key having no route to the browser.
     public-config is that route; if it stops carrying the key, the widget goes
     back to hiding itself and enforcement silently means outage again. */
  const rd = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
  const keys = rd.slice(rd.indexOf('PUBLIC_CONFIG_KEYS'), rd.indexOf('PUBLIC_CONFIG_KEYS') + 600);
  ok(/turnstileSiteKey'\s*,\s*'TURNSTILE_SITE_KEY'/.test(keys),
     '/v1/public-config serves the site key', true);

  const client = readFileSync(join(ROOT, 'src', 'app', '03-sessions.js'), 'utf8');
  ok(/loadStr\('amv_turnstile_site'\)/.test(client),
     'and the widget reads what public-config stored', true);

  /* Both directives. script-src loads api.js; the widget itself is an iframe,
     so frame-src has to allow the same host or the box renders empty. */
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const csp = (html.match(/content="([^"]*default-src[^"]*)"/) || [])[1] || '';
  const dir = (name) => (csp.match(new RegExp(name + '([^;]*)')) || [])[1] || '';
  ok(/challenges\.cloudflare\.com/.test(dir('script-src')),
     'CSP lets the Turnstile script load', dir('script-src').slice(0, 120));
  ok(/challenges\.cloudflare\.com/.test(dir('frame-src')),
     'and lets its iframe render, which is the widget itself', dir('frame-src').slice(0, 120));
}

globalThis.fetch = origFetch;
if (report('captcha') > 0) process.exitCode = 1;
done();
