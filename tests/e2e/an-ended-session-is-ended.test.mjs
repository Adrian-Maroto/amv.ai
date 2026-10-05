/* AN ENDED SESSION IS ENDED.

   Asked for: "every time I refresh it logs me out and makes me sign in, but
   when I click X it closes and I can use it regardless".

   When the server says this device's session is over, the page asks for a
   sign-in. Closing that used to leave everything as it was - name in the
   corner, chats on screen - looking signed in to an account the server no
   longer recognised, so every reload asked again. Now closing it signs this
   device out, the way an ended session is handled by the large assistants;
   going on to "Forgot password" is still deciding, and signing in keeps you
   signed in. Why sessions were ending is the server's half:
   tests/worker/a-renewal-is-not-a-theft. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Valeria', email: 'v@test.com', ini: 'V' } });
const { page, errors } = app;

const STUB = `
  const R = (o, ok = true, status = 200) => ({ ok, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => o });
  window.fetch = async (u, opts) => {
    const url = String(u);
    if (url.includes('/auth/login')) return R({ ok: true, token: 'jwt', refreshToken: 'rt', user: { name: 'Valeria', email: 'v@test.com' } });
    if (url.includes('/auth/')) return R({ ok: true });
    return R({ ok: true });
  };
`;
const ask = () => page.evaluate((stub) => {
  document.getElementById('cookie-consent-banner')?.remove();
  AMV_API.base = 'https://amv-stub.workers.dev'; eval(stub);
  AMV_API.token = '';
  if (!(S.user && S.user.email)) S.user = { name: 'Valeria', email: 'v@test.com', ini: 'V' };
  _askToSignInAgain(null, true);
  return !!document.getElementById('auth-bg');
}, STUB);
const until = async (fn, ms = 10000) => { const s = Date.now(); while (Date.now() - s < ms) { if (await page.evaluate(fn)) return true; await page.waitForTimeout(100); } return false; };

section('Closing "Sign in to continue" signs this device out');
{
  ok(await ask(), 'the question is asked');
  await page.click('#auth-x');
  const out = await until(() => !(S.user && S.user.email));
  const r = await page.evaluate(() => ({ user: !!(S.user && S.user.email), stored: localStorage.getItem('amv_user'),
    toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ') }));
  ok(out && !r.user && !r.stored, 'you are signed out - not left looking signed in', r);
  ok(/signed out/i.test(r.toast), 'and told why', r.toast);
}

section('Esc is the same answer as X');
{
  await ask();
  await page.keyboard.press('Escape');
  ok(await until(() => !(S.user && S.user.email)), 'Esc signs out too');
}

section('Going on to "Forgot password" is still deciding');
{
  await ask();
  await page.click('#auth-forgot');
  await until(() => !!document.querySelector('.fp-modal'));
  const r = await page.evaluate(() => ({ user: !!(S.user && S.user.email), forgot: !!document.querySelector('.fp-modal') }));
  ok(r.forgot && r.user, 'the reset opens, and you are not signed out underneath it', r);
  await page.evaluate(() => { const x = document.getElementById('fp-x'); if (x) x.click(); });
  await until(() => !!document.getElementById('auth-bg'));
  ok(await page.evaluate(() => !!document.getElementById('auth-bg') && !!(S.user && S.user.email)), 'closing the reset goes back to the sign-in, still deciding');
  await page.keyboard.press('Escape');
  ok(await until(() => !(S.user && S.user.email)), 'and closing that without signing in ends it');
}

section('The sheet closed by code on the way somewhere else is not the person\u2019s answer');
{
  /* A Connect, a reset, any flow that replaces what is on screen closes it
     first. Only the X and Escape - the person - count as "no". */
  await ask();
  await page.evaluate(() => closeOvr());
  await page.waitForTimeout(600);   /* a negative: nothing may happen, so this waits out the settle tick and more */
  ok(await page.evaluate(() => !!(S.user && S.user.email)), 'nobody is signed out by a close they did not make');
}

section('Signing in keeps you signed in');
{
  await ask();
  await page.evaluate(() => {
    document.getElementById('a-pass').value = 'A-real-Passw0rd!';
    return doLoginForm();
  });
  await until(() => !!(AMV_API.token && S.user && S.user.email));
  const r = await page.evaluate(() => ({ user: !!(S.user && S.user.email), token: !!AMV_API.token, flag: _sessionEndedAsk }));
  ok(r.user && r.token && !r.flag, 'signed in, and nothing signs you back out', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
if (report('an-ended-session-is-ended') > 0) process.exitCode = 1;
done();
