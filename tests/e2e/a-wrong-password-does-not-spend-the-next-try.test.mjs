/* A WRONG PASSWORD DOES NOT SPEND THE NEXT TRY.

   Asked for: "when I put the wrong password I have to reload the page, because
   it says to do the captcha again but it doesn't show up again".

   A verification token is good for one attempt, and the server spends it
   whether the password was right or not. The widget kept its tick, so the next
   try sent the spent token, the server asked for the verification again, and
   there was nothing left on screen to complete. Every attempt now takes the
   token it has and resets the widget, so the next one has a fresh token.

   The widget itself is Cloudflare's and never runs in a test; this stands in
   for exactly the part of it the page calls: render, getResponse, reset. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: null, tab: 'chat' });
const { page, errors } = app;

const r = await page.evaluate(async () => {
  document.getElementById('cookie-consent-banner')?.remove();
  AMV_API.base = 'https://amv-stub.workers.dev';
  /* The stand-in widget: each reset issues the next token. */
  let n = 1; const resets = [];
  window.turnstile = { render: () => 'w1', getResponse: () => 't' + n, reset: (id) => { resets.push(id); n++; } };
  const sent = [];
  window.fetch = async (u, o) => {
    const url = String(u); const body = JSON.parse((o && o.body) || '{}');
    if (url.includes('/auth/login')) {
      sent.push(body.captchaToken);
      const right = body.password === 'Right-Passw0rd!';
      return { ok: right, status: right ? 200 : 401, headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => right ? { ok: true, token: 'jwt', user: { name: 'V', email: 'v@test.com' } } : { error: 'Wrong password' } };
    }
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ok: true }) };
  };
  openAuth('login');
  await new Promise(r => setTimeout(r, 200));
  /* The widget as the page leaves it once drawn. */
  const box = document.getElementById('a-turnstile') || Object.assign(document.createElement('div'), { id: 'a-turnstile' });
  if (!box.isConnected) document.body.appendChild(box);
  box.style.display = ''; box.dataset.rendered = '1'; box.dataset.wid = 'w1';

  document.getElementById('a-email').value = 'v@test.com';
  document.getElementById('a-pass').value = 'Wrong-Passw0rd!';
  await doLoginForm();
  const afterWrong = { err: (document.getElementById('auth-err') || {}).textContent || '', resets: resets.slice() };
  document.getElementById('a-pass').value = 'Right-Passw0rd!';
  await doLoginForm();
  return { sent, afterWrong, resets, signedIn: !!(S.user && S.user.email) };
});

section('The wrong password, then the right one, without reloading');
ok(r.sent.length === 2 && r.sent[0] === 't1', 'the first attempt carried a token', r.sent);
ok(r.afterWrong.resets.includes('w1'), 'and the widget was reset straight after - this widget, by its id', r.afterWrong);
ok(r.sent[1] && r.sent[1] !== r.sent[0], 'so the second attempt carried a FRESH token, not the spent one', r.sent);
ok(r.signedIn, 'and the right password signs in, no reload needed', r);

/* Oct 31: "it says do captcha even though I already did it". The reset starts
   a fresh check, which takes Cloudflare a moment; pressing Sign in again
   inside that moment sent NO token, and the server asked for the verification
   the person had already done. The page now waits for the check, and if the
   server still asks (a token that expired while they typed) redoes it once,
   quietly. And a wrong password is said as one, with the way back. */
const w = await page.evaluate(async () => {
  try { S.user = null; } catch (e) {}
  let tok = '', resets = 0;
  window.turnstile = { render: () => 'w1', getResponse: () => tok, reset: () => { resets++; tok = ''; setTimeout(() => { tok = 'fresh' + resets; }, 600); } };
  const sent = []; let askedAgain = false;
  window.fetch = async (u, o) => {
    const url = String(u); const body = JSON.parse((o && o.body) || '{}');
    const R = (ok, status, d) => ({ ok, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => d });
    if (url.includes('/auth/login')) {
      sent.push(body.captchaToken || '');
      if (!body.captchaToken) return R(false, 400, { error: 'Please complete the verification and try again.', code: 'captcha_required' });
      /* One token the server has already seen expire: it asks again, once. */
      if (body.captchaToken === 'stale') { askedAgain = true; return R(false, 400, { error: 'Please complete the verification and try again.', code: 'captcha_required' }); }
      if (body.password === 'Right-Passw0rd!') return R(true, 200, { ok: true, token: 'jwt', user: { name: 'V', email: 'v@test.com' } });
      return R(false, 401, { error: 'That email and password do not match an account.', code: 'bad_credentials' });
    }
    return R(true, 200, { ok: true });
  };
  openAuth('login');
  await new Promise(r => setTimeout(r, 200));
  const box = document.getElementById('a-turnstile') || Object.assign(document.createElement('div'), { id: 'a-turnstile' });
  if (!box.isConnected) document.body.appendChild(box);
  box.style.display = ''; box.dataset.rendered = '1'; box.dataset.wid = 'w1';
  /* Straight after a reset: no token yet. */
  tok = '';
  setTimeout(() => { tok = 'first'; }, 500);
  document.getElementById('a-email').value = 'v@test.com';
  document.getElementById('a-pass').value = 'Wrong-Passw0rd!';
  await doLoginForm();
  const wrongMsg = (document.getElementById('auth-err') || {}).textContent || '';
  /* A token the server will call stale. */
  tok = 'stale';
  document.getElementById('a-pass').value = 'Right-Passw0rd!';
  await doLoginForm();
  return { sent, wrongMsg, askedAgain, err: (document.getElementById('auth-err') || {}).textContent || '', signedIn: !!(S.user && S.user.email) };
});

section('Pressing Sign in before the check is done waits for it, instead of failing');
ok(w.sent[0] === 'first', 'the first send waited for the check and carried its token - never an empty one', w.sent);
ok(!w.sent.includes(''), 'no attempt went without a token at all', w.sent);
ok(/Wrong email or password/.test(w.wrongMsg) && /Forgot password/.test(w.wrongMsg), 'a wrong password says so, and points at Forgot password', w.wrongMsg);
ok(w.askedAgain && w.signedIn, 'a token the server called stale is redone quietly, and the right password signs in', w);
ok(!/complete the verification/i.test(w.err), 'and "complete the verification" is never put in front of them', w.err);

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
if (report('a-wrong-password-does-not-spend-the-next-try') > 0) process.exitCode = 1;
done();
