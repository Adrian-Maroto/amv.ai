/* NO SESSION WITHOUT THE CODE - FROM THE PERSON'S SIDE.

   Asked for: "make sure no one can log into anyone else's account... make sure
   they can't auto sign in, because I didn't put the code but it still signed
   me in".

   The server half is tests/worker/a-code-is-the-other-half-of-the-key. This is
   the page: when the server says a code is needed, the person is NOT signed in
   until the server accepts one - a wrong code, backing out, or closing the box
   all leave them signed out - and a device that entered a code says so next
   time, so it is not asked again. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: null, tab: 'chat' });
const { page, errors } = app;
await page.setViewportSize({ width: 390, height: 844 });

/* A faithful Response stub, as in forgot.test.mjs: _fetch reads headers. */
const STUB = `
  window.__calls = [];
  const R = (o, ok = true, status = 200) => ({
    ok, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => o,
  });
  window.fetch = async (u, opts) => {
    const url = String(u).replace('https://amv-stub.workers.dev', '');
    const body = JSON.parse((opts && opts.body) || '{}');
    window.__calls.push({ url, body });
    if (url.startsWith('/auth/login/verify'))
      return body.code === '246810' && body.challenge === 'ch1'
        ? R({ ok: true, token: 'jwt', refreshToken: 'rt', deviceToken: 'dev-1', user: { name: 'Valeria', email: 'v@test.com' } })
        : R({ error: 'That code isn\\u2019t right. 4 attempts left.', code: 'code_wrong' }, false, 400);
    if (url.startsWith('/auth/login/resend')) return R({ ok: true, sent: true });
    if (url.startsWith('/auth/login'))
      return body.deviceToken === 'dev-1'
        ? R({ ok: true, token: 'jwt2', refreshToken: 'rt2', user: { name: 'Valeria', email: 'v@test.com' } })
        : R({ ok: true, needsCode: true, challenge: 'ch1', to: 'v***@test.com', why: 'signin' });
    return R({ ok: true });
  };
`;

const signIn = () => page.evaluate(async () => {
  document.getElementById('cookie-consent-banner')?.remove();
  openAuth('login');
  for (let i = 0; i < 150 && !document.getElementById('a-email'); i++) await new Promise(r => setTimeout(r, 100));
  document.getElementById('a-email').value = 'v@test.com';
  document.getElementById('a-pass').value = 'A-real-Passw0rd!';
  window.__login = doLoginForm();
}).then(() => page.waitForSelector('#cv-code', { timeout: 15000 }));
const signedIn = () => page.evaluate(() => !!(S.user && S.user.email));

await page.evaluate((stub) => { AMV_API.base = 'https://amv-stub.workers.dev'; eval(stub); }, STUB);

section('The right password on a new device asks for the code, and signs nobody in yet');
{
  await signIn();
  const r = await page.evaluate(() => {
    const m = document.querySelector('.fp-modal'); const b = m && m.getBoundingClientRect();
    const input = document.getElementById('cv-code');
    return {
      title: (document.getElementById('cv-h') || {}).textContent || '',
      to: (m && m.textContent) || '',
      fits: !!b && b.left >= 0 && b.right <= innerWidth + 1,
      otp: input && input.getAttribute('autocomplete'), numeric: input && input.getAttribute('inputmode'),
    };
  });
  ok(/check your email/i.test(r.title), 'a "Check your email" step opens', r.title);
  ok(/v\*\*\*@test\.com/.test(r.to), 'naming the (masked) address the code went to', r.to.slice(0, 120));
  ok(r.otp === 'one-time-code' && r.numeric === 'numeric', 'the box takes the code from the phone keyboard and autofill', r);
  ok(r.fits, 'and it fits a phone screen', r);
  ok(!(await signedIn()), 'nobody is signed in on the password alone', await signedIn());
}

section('A wrong code is refused, says so, and still signs nobody in');
{
  const r = await page.evaluate(async () => {
    const ci = document.getElementById('cv-code');
    ci.value = '111111'; ci.dispatchEvent(new Event('input'));
    for (let i = 0; i < 150 && !/right/i.test((document.getElementById('cv-msg') || {}).textContent || ''); i++)
      await new Promise(r => setTimeout(r, 100));
    return { msg: (document.getElementById('cv-msg') || {}).textContent || '', cleared: document.getElementById('cv-code').value === '' };
  });
  ok(/isn.t right/i.test(r.msg) && /attempts left/i.test(r.msg), 'the server’s answer is shown', r.msg);
  ok(r.cleared, 'and the box is cleared for another try', r);
  ok(!(await signedIn()), 'still signed out', await signedIn());
}

section('Backing out leaves you signed out, on the sign-in form');
{
  const r = await page.evaluate(async () => {
    document.getElementById('cv-back').click();
    await window.__login;
    for (let i = 0; i < 150 && !document.getElementById('a-email'); i++) await new Promise(r => setTimeout(r, 100));
    return { code: !!document.getElementById('cv-code'), form: !!document.getElementById('a-email'), em: (document.getElementById('a-email') || {}).value };
  });
  ok(!r.code && r.form && r.em === 'v@test.com', 'back on the form with the email kept', r);
  ok(!(await signedIn()), 'and nobody signed in', await signedIn());
}

section('An answer with no session in it is not a sign-in, whatever this browser remembers');
{
  /* The page keeps a copy of the account for offline use, and below the server
     branch of doLoginForm is the check against it. Two things keep a server
     answer with no session from reaching it: AMV_API.login refuses such an
     answer, and doLoginForm refuses it again. Measured by removing each: either
     alone holds; with both gone this fails. */
  const r = await page.evaluate(async () => {
    await createAccount('Valeria', 'v@test.com', 'A-real-Passw0rd!');
    const real = window.fetch;
    window.fetch = async (u, o) => String(u).includes('/auth/login')
      ? { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ok: true }) }
      : real(u, o);
    openAuth('login');
    for (let i = 0; i < 150 && !document.getElementById('a-email'); i++) await new Promise(r => setTimeout(r, 100));
    document.getElementById('a-email').value = 'v@test.com';
    document.getElementById('a-pass').value = 'A-real-Passw0rd!';
    await doLoginForm();
    window.fetch = real;
    return { err: (document.querySelector('.auth-err, #auth-err') || {}).textContent || '' };
  });
  ok(!(await signedIn()), 'nobody is signed in from the copy in this browser', r);
}

section('The right code - and only then - signs you in');
{
  await signIn();
  const r = await page.evaluate(async () => {
    const ci = document.getElementById('cv-code');
    ci.value = '246810'; ci.dispatchEvent(new Event('input'));
    await window.__login;
    const v = window.__calls.filter(c => c.url.startsWith('/auth/login/verify')).pop();
    return { sent: v && v.body, modal: !!document.getElementById('cv-code') };
  });
  ok(r.sent && r.sent.challenge === 'ch1' && r.sent.code === '246810', 'the code went to the server with the sign-in it belongs to', r.sent);
  ok(!r.modal, 'the code step closes', r.modal);
  ok(await signedIn(), 'and you are signed in', await signedIn());
}

section('This device is remembered, so it is not asked again');
{
  const r = await page.evaluate(async () => {
    S.user = null; window.__calls = [];
    openAuth('login');
    for (let i = 0; i < 150 && !document.getElementById('a-email'); i++) await new Promise(r => setTimeout(r, 100));
    document.getElementById('a-email').value = 'v@test.com';
    document.getElementById('a-pass').value = 'A-real-Passw0rd!';
    await doLoginForm();
    const l = window.__calls.find(c => c.url === '/auth/login');
    return { sentDevice: l && l.body.deviceToken, asked: !!document.getElementById('cv-code') };
  });
  ok(r.sentDevice === 'dev-1', 'the sign-in says which device this is', r);
  ok(!r.asked && await signedIn(), 'and goes straight in, with no code', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
if (report('no-session-without-the-code') > 0) process.exitCode = 1;
done();
