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

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
if (report('a-wrong-password-does-not-spend-the-next-try') > 0) process.exitCode = 1;
done();
