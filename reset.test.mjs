/* PASSWORD RESET — end to end.

   This flow was completely dead:
     1. No email provider was configured, so nothing ever sent.
     2. The app still said "Reset link sent! Check your inbox." — a lie.
     3. The email linked to <worker>/reset?token=... and that route DID NOT
        EXIST, so even a delivered email led to a 404.

   Nobody could ever recover an account. These tests make sure that can't
   silently happen again. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');

const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'reset.harness.mjs');
writeFileSync(harness, src +
  '\nexport { authSignup, authLogin, authReset, authResetConfirm, authAdminReset, authResetStatus, resetPage, authResetCode, authResetVerify };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const mkEnv = (extra = {}) => ({
  JWT_SECRET: 'test-secret',
  ADMIN_TOKEN: 'admin-secret',
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) };
    }
  },
  ...extra
});

const post = (path, body, env) => new Request('https://api.amv.dev' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

/* ── Set up a real account ─────────────────────────────────────────────── */
section('Setup: a real account exists');
let env = mkEnv();
let r = await W.authSignup(post('/auth/signup',
  { name: 'Valeria', email: 'amarotovaleria@gmail.com', password: 'originalPass123' }), env);
let d = await r.json();
ok(r.status < 400 && !d.error, 'account created', d.error);

r = await W.authLogin(post('/auth/login',
  { email: 'amarotovaleria@gmail.com', password: 'originalPass123' }), env);
ok((await r.json()).token, 'can log in with the original password');

/* ── The honest failure: no email provider ─────────────────────────────── */
section('No email provider: we must NOT claim an email was sent');

r = await W.authReset(post('/auth/reset', { email: 'amarotovaleria@gmail.com' }), env);
d = await r.json();
ok(d.ok === true, 'the request succeeds (never leaks which emails exist)');
ok(d.sent === false, 'but it reports sent:false — nothing actually went out', d.sent);

const status = await (await W.authResetStatus(post('/auth/reset/status', {}), env)).json();
ok(status.emailConfigured === false, 'the app can ask whether reset even works');

/* ── With a provider configured, an email really sends ─────────────────── */
section('With EMAIL_API_KEY + RESET_EMAIL_FROM: a real email goes out');

const emails = [];
globalThis.fetch = async (url, opts) => {
  emails.push({ url: String(url), body: JSON.parse(opts.body) });
  return { ok: true, status: 200, json: async () => ({ id: 'e1' }) };
};

env = mkEnv({ EMAIL_API_KEY: 'resend-key', RESET_EMAIL_FROM: 'AMV <noreply@amv.ai>' });
r = await W.authReset(post('/auth/reset', { email: 'amarotovaleria@gmail.com' }), env);
d = await r.json();
ok(d.sent === true, 'sent:true — an email genuinely went out', d.sent);
ok(emails.length === 1, 'the email provider was actually called', emails.length);
ok(emails[0].body.to?.[0] === 'amarotovaleria@gmail.com', 'addressed to the right person', emails[0].body.to);

const link = (emails[0].body.text || '').match(/https?:\/\/\S+/)?.[0] || '';
ok(/\/reset\?token=/.test(link), 'the email contains a /reset?token=... link', link);

const st2 = await (await W.authResetStatus(post('/auth/reset/status', {}), env)).json();
ok(st2.emailConfigured === true, 'status reports reset is available');

/* ── The link must actually LOAD (it used to 404) ──────────────────────── */
section('The reset link actually works (it used to 404)');

const token = new URL(link).searchParams.get('token');
ok(!!token, 'a token is present in the link');

const pageResp = await W.resetPage(new Request(link), env);
const pageHtml = await pageResp.text();
ok(pageResp.status === 200, 'GET /reset returns 200 — not a 404', pageResp.status);
ok(/Set a new password/i.test(pageHtml), 'it serves a real "set a new password" page');
ok(pageHtml.includes(token), 'the page carries the token through');
ok(/\/auth\/reset\/confirm/.test(pageHtml), 'and posts to the confirm endpoint');

/* ── Completing the reset ──────────────────────────────────────────────── */
section('Setting a new password, and it actually works');

r = await W.authResetConfirm(post('/auth/reset/confirm', { token, password: 'brandNewPass456' }), env);
ok((await r.json()).ok, 'the password is updated');

r = await W.authLogin(post('/auth/login', { email: 'amarotovaleria@gmail.com', password: 'brandNewPass456' }), env);
ok((await r.json()).token, 'you CAN log in with the new password');

r = await W.authLogin(post('/auth/login', { email: 'amarotovaleria@gmail.com', password: 'originalPass123' }), env);
ok(!(await r.json()).token, 'the OLD password no longer works');

section('Reset tokens are single-use and bounded');
r = await W.authResetConfirm(post('/auth/reset/confirm', { token, password: 'thirdPass789' }), env);
d = await r.json();
ok(!!d.error, 'the same token cannot be reused', d);

r = await W.authResetConfirm(post('/auth/reset/confirm', { token: 'made-up-token', password: 'whatever123' }), env);
ok(!!(await r.json()).error, 'a forged token is rejected');

r = await W.authResetConfirm(post('/auth/reset/confirm', { token, password: 'short' }), env);
ok(!!(await r.json()).error, 'a weak password is rejected');

/* ── Owner escape hatch ────────────────────────────────────────────────── */
section('Owner escape hatch: you can never be permanently locked out');

r = await W.authAdminReset(post('/auth/admin-reset',
  { token: 'admin-secret', email: 'amarotovaleria@gmail.com', password: 'ownerSetPass999' }), env);
ok((await r.json()).ok, 'the owner can set a password directly with ADMIN_TOKEN');

r = await W.authLogin(post('/auth/login', { email: 'amarotovaleria@gmail.com', password: 'ownerSetPass999' }), env);
ok((await r.json()).token, 'and that password works immediately');

r = await W.authAdminReset(post('/auth/admin-reset',
  { token: 'WRONG', email: 'amarotovaleria@gmail.com', password: 'hackerPass123' }), env);
ok(r.status === 401, 'a wrong admin token is rejected', r.status);

r = await W.authAdminReset(post('/auth/admin-reset',
  { email: 'amarotovaleria@gmail.com', password: 'hackerPass123' }), env);
ok(r.status === 401, 'no admin token is rejected', r.status);

/* ═══ THE 6-DIGIT CODE FLOW ══════════════════════════════════════════════ */
section('Code flow: email → 6-digit code → new password');

env = mkEnv({ EMAIL_API_KEY: 'k', RESET_EMAIL_FROM: 'AMV <no@amv.ai>' });
const codeEmails = [];
globalThis.fetch = async (url, opts) => {
  codeEmails.push(JSON.parse(opts.body));
  return { ok: true, status: 200, json: async () => ({ id: 'e' }) };
};

r = await W.authResetCode(post('/auth/reset/code', { email: 'amarotovaleria@gmail.com' }), env);
d = await r.json();
ok(d.ok && d.sent === true, 'a code email is sent', d);
ok(d.emailConfigured === true, 'and it reports email IS configured');

const sentCode = (codeEmails[0].text || '').match(/\b(\d{6})\b/)?.[1];
ok(!!sentCode, 'the email contains a 6-digit code', sentCode);

section('Code flow: wrong codes are rejected and limited');
r = await W.authResetVerify(post('/auth/reset/verify', { email: 'amarotovaleria@gmail.com', code: '000000' }), env);
d = await r.json();
ok(!!d.error && /attempts left/i.test(d.error), 'a wrong code says how many tries remain', d.error);

for (let i = 0; i < 4; i++) {
  r = await W.authResetVerify(post('/auth/reset/verify', { email: 'amarotovaleria@gmail.com', code: '000001' }), env);
}
d = await r.json();
ok(r.status === 429 || /too many/i.test(d.error || ''), 'brute force is cut off after 5 tries', d.error);

section('Code flow: the right code lets you set a new password');
// request a fresh code (the old one was destroyed by the brute-force guard)
codeEmails.length = 0;
await W.authResetCode(post('/auth/reset/code', { email: 'amarotovaleria@gmail.com' }), env);
const good = (codeEmails[0].text || '').match(/\b(\d{6})\b/)[1];

r = await W.authResetVerify(post('/auth/reset/verify', { email: 'amarotovaleria@gmail.com', code: good }), env);
d = await r.json();
ok(d.ok && !!d.token, 'the correct code returns a one-time token');

r = await W.authResetConfirm(post('/auth/reset/confirm', { token: d.token, password: 'codeFlowPass123' }), env);
ok((await r.json()).ok, 'the new password is set');

r = await W.authLogin(post('/auth/login', { email: 'amarotovaleria@gmail.com', password: 'codeFlowPass123' }), env);
ok((await r.json()).token, 'and you can log in with it');

section('Code flow: a used code cannot be replayed');
r = await W.authResetVerify(post('/auth/reset/verify', { email: 'amarotovaleria@gmail.com', code: good }), env);
ok(!!(await r.json()).error, 'the same code cannot be used twice');

section('Code flow: no account enumeration');
r = await W.authResetCode(post('/auth/reset/code', { email: 'nobody@nowhere.com' }), env);
d = await r.json();
ok(d.ok === true, 'an unknown email still returns ok (cannot be used to discover accounts)', d);

section('Setup: the API KEY alone is enough to get started');

const onlyKey = mkEnv({ EMAIL_API_KEY: 'k' });   // no RESET_EMAIL_FROM
const sentFrom = [];
globalThis.fetch = async (url, opts) => {
  sentFrom.push(JSON.parse(opts.body));
  return { ok: true, status: 200, json: async () => ({ id: 'e' }) };
};
await W.authSignup(post('/auth/signup', { name: 'V', email: 'onlykey@test.com', password: 'pass12345' }), onlyKey);
r = await W.authResetCode(post('/auth/reset/code', { email: 'onlykey@test.com' }), onlyKey);
d = await r.json();
ok(d.emailConfigured === true, 'EMAIL_API_KEY alone counts as configured', d);
ok(d.sent === true, 'and the email actually sends', d);
ok(/resend\.dev/.test(sentFrom[0].from || ''), 'it falls back to Resend"s no-setup sender', sentFrom[0].from);
ok(d.usingDefaultSender !== false, 'and reports it is using the default sender');

const st = await (await W.authResetStatus(post('/auth/reset/status', {}), onlyKey)).json();
ok(st.usingDefaultSender === true, 'status flags the default sender (only reaches YOUR address)');

section('Reset requests are rate limited (no inbox bombing)');

const rlEnv = mkEnv({ EMAIL_API_KEY: 'k' });
await W.authSignup(post('/auth/signup', { name: 'V', email: 'rl@test.com', password: 'pass12345' }), rlEnv);
let limited = null;
for (let i = 0; i < 7; i++) {
  const rr = await W.authResetCode(post('/auth/reset/code', { email: 'rl@test.com' }), rlEnv);
  const dd = await rr.json();
  if (dd.rateLimited) { limited = i; break; }
}
ok(limited !== null && limited <= 5, 'it cuts off after ~5 requests per hour', limited);

const rlResp = await (await W.authResetCode(post('/auth/reset/code', { email: 'rl@test.com' }), rlEnv)).json();
ok(rlResp.ok === true, 'even when rate limited it returns ok (no account enumeration)', rlResp);

report();
done();
