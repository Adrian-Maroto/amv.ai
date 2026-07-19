/* FORGOT PASSWORD — the 3-step code flow, from the user's side.
     email -> 6-digit code -> new password -> signed in

   Guards two specific failures that already happened:
     - The old flow said "Couldn't send the reset email. Check your connection."
       when the REAL cause was that no backend was connected at all. Blaming the
       user's wifi for our config is not acceptable.
     - The auto sign-in silently never fired, because AMV_API._fetch returns a
       raw Response (not parsed JSON) and the code checked `r.token`. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: null, tab: 'chat' });
const { page, errors } = app;

/* A faithful Response stub. A bare {ok,json} object is NOT enough — _fetch
   touches headers, and a lying stub produces false test results. */
const STUB = `
  window.__calls = [];
  const R = (o, ok = true, status = 200) => ({
    ok, status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => o
  });
  window.fetch = async (u, opts) => {
    const url = String(u);
    const body = JSON.parse((opts && opts.body) || '{}');
    window.__calls.push(url.replace('https://api.test', ''));
    if (url.includes('/auth/reset/code'))
      return R({ ok: true, sent: window.__emailOn !== false, emailConfigured: window.__emailOn !== false });
    if (url.includes('/auth/reset/verify'))
      return body.code === '123456'
        ? R({ ok: true, token: 'reset-tok' })
        : R({ error: 'That code isn\\u2019t right. 4 attempts left.' }, false, 400);
    if (url.includes('/auth/reset/confirm')) return R({ ok: true });
    if (url.includes('/auth/login'))
      return R({ ok: true, token: 'jwt', user: { name: 'Valeria', email: 'v@test.com' } });
    return R({ ok: true });
  };
`;

section('Step 1 — enter your email');

await page.evaluate((stub) => {
  AMV_API.base = 'https://api.test';
  eval(stub);
  openForgot('v@test.com');
}, STUB);
await page.waitForTimeout(300);

let s = await page.evaluate(() => {
  const m = document.querySelector('.fp-modal');
  const r = m ? m.getBoundingClientRect() : null;
  return {
    title: m?.querySelector('.share-title')?.textContent,
    onScreen: !!r && r.top >= 0 && r.bottom <= window.innerHeight + 2 && r.height > 0,
    email: document.getElementById('fp-email')?.value
  };
});
ok(/reset your password/i.test(s.title || ''), 'the reset modal opens', s.title);
ok(s.onScreen, 'and it is actually visible on screen');
ok(s.email === 'v@test.com', 'the email typed on the login screen carries over', s.email);

section('Step 2 — the 6-digit code');

await page.evaluate(() => document.getElementById('fp-send').click());
await page.waitForTimeout(400);

s = await page.evaluate(() => ({
  title: document.querySelector('.fp-modal .share-title')?.textContent,
  hasCodeInput: !!document.getElementById('fp-code'),
  calledCodeEndpoint: window.__calls.some(c => c.includes('/auth/reset/code'))
}));
ok(/check your email/i.test(s.title || ''), 'it moves to "Check your email"', s.title);
ok(s.hasCodeInput, 'a 6-digit code input is shown');
ok(s.calledCodeEndpoint, 'it really asked the server to send a code');

const wrong = await page.evaluate(async () => {
  const c = document.getElementById('fp-code');
  c.value = '999999';
  c.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  return document.getElementById('fp-msg')?.textContent || '';
});
ok(/isn.t right|attempts left/i.test(wrong), 'a wrong code is rejected with a real reason', wrong);

section('Step 3 — set the new password');

await page.evaluate(async () => {
  const c = document.getElementById('fp-code');
  c.value = '123456';
  c.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 500));
});

s = await page.evaluate(() => ({
  title: document.querySelector('.fp-modal .share-title')?.textContent,
  fields: !!document.getElementById('fp-pw') && !!document.getElementById('fp-pw2')
}));
ok(/set a new password/i.test(s.title || ''), 'the correct code advances to the password step', s.title);
ok(s.fields, 'both password fields are present');

const mismatch = await page.evaluate(async () => {
  document.getElementById('fp-pw').value = 'newpassword123';
  document.getElementById('fp-pw2').value = 'somethingelse';
  document.getElementById('fp-save').click();
  await new Promise(r => setTimeout(r, 300));
  return document.getElementById('fp-msg')?.textContent || '';
});
ok(/don.t match/i.test(mismatch), 'mismatched passwords are caught', mismatch);

const short = await page.evaluate(async () => {
  document.getElementById('fp-pw').value = 'abc';
  document.getElementById('fp-pw2').value = 'abc';
  document.getElementById('fp-save').click();
  await new Promise(r => setTimeout(r, 300));
  return document.getElementById('fp-msg')?.textContent || '';
});
ok(/8 characters/i.test(short), 'a too-short password is caught', short);

section('It signs you straight in (no retyping what you just set)');

const finished = await page.evaluate(async () => {
  document.getElementById('fp-pw').value = 'newpassword123';
  document.getElementById('fp-pw2').value = 'newpassword123';
  document.getElementById('fp-save').click();
  await new Promise(r => setTimeout(r, 1200));
  return {
    modalGone: !document.querySelector('.fp-modal'),
    // NOTE: `S` is a script-scope const — it is NOT on window. Checking
    // window.S here produced a false negative for a while.
    signedIn: (typeof S !== 'undefined') && !!(S.user && S.user.email),
    calls: window.__calls
  };
});
ok(finished.modalGone, 'the modal closes');
ok(finished.signedIn, 'you are signed straight into the account', finished.calls);
ok(finished.calls.some(c => c.includes('/auth/reset/confirm')), 'the password was actually saved');
ok(finished.calls.some(c => c.includes('/auth/login')), 'and a real login followed');

section('HONESTY: never blame the user"s wifi for our config');

const noBackend = await page.evaluate(async () => {
  AMV_API.base = '';                        // engine not connected
  openForgot('v@test.com');
  await new Promise(r => setTimeout(r, 200));
  document.getElementById('fp-send').click();
  await new Promise(r => setTimeout(r, 400));
  return document.getElementById('fp-msg')?.textContent || '';
});
ok(/engine|connect/i.test(noBackend),
   'with no backend it says the ENGINE isn"t connected', noBackend);
ok(!/check your connection/i.test(noBackend),
   'it does NOT blame the user"s connection', noBackend);

const noEmail = await page.evaluate(async (stub) => {
  AMV_API.base = 'https://api.test';
  window.__emailOn = false;                 // Worker up, but no email provider
  eval(stub);
  window.__emailOn = false;
  openForgot('v@test.com');
  await new Promise(r => setTimeout(r, 200));
  document.getElementById('fp-send').click();
  await new Promise(r => setTimeout(r, 400));
  return document.getElementById('fp-msg')?.textContent || '';
}, STUB);
ok(/isn.t set up|no email/i.test(noEmail),
   'with no email provider it says so plainly, instead of "check your inbox"', noEmail);

/* ────────────────────────────────────────────────────────────────────────
   With NO backend, the account lives in this browser. The flow used to
   dead-end ("AMV isn't connected to its engine") and the only way back into
   your own account was to open devtools and call a function by hand. That is
   not a real answer for a paying user.
   ──────────────────────────────────────────────────────────────────────── */
section('No backend: you can still reset on this device');

const localReset = await page.evaluate(async () => {
  AMV_API.base = '';                                   // no Worker at all
  await createAccount('Valeria', 'local@test.com', 'forgottenPass');
  S.user = findAccount('local@test.com');
  S.convs = [{ id: 'c1', title: 'REAL CONVERSATION', msgs: [] }];
  store('amv_convs', S.convs);
  _SESSIONS.length = 0;
  _SESSIONS.push({ id: 's1', kind: 'dev', title: 'REAL PROJECT', updated: Date.now(), state: {} });
  _persistSessions();
  S.user = null;

  openForgot('local@test.com');
  await new Promise(r => setTimeout(r, 200));
  document.getElementById('fp-send').click();
  await new Promise(r => setTimeout(r, 350));

  const offersReset = !!document.getElementById('fp-pw');
  const sub = document.querySelector('.fp-sub')?.textContent || '';

  document.getElementById('fp-pw').value = 'brandNewPass1';
  document.getElementById('fp-pw2').value = 'brandNewPass1';
  document.getElementById('fp-save').click();
  await new Promise(r => setTimeout(r, 900));

  _loadSessions();
  return {
    offersReset, sub,
    signedIn: (typeof S !== 'undefined') && !!(S.user && S.user.email),
    newWorks: !!(await verifyLogin('local@test.com', 'brandNewPass1')),
    oldDead: !(await verifyLogin('local@test.com', 'forgottenPass')),
    convs: (load('amv_convs') || []).map(c => c.title),
    sessions: (_SESSIONS || []).map(x => x.title)
  };
});

ok(localReset.offersReset, 'it offers to reset on this device instead of dead-ending');
ok(/this device/i.test(localReset.sub), 'and explains why', localReset.sub.slice(0, 60));
ok(localReset.newWorks, 'the new password works');
ok(localReset.oldDead, 'the forgotten password is dead');
ok(localReset.signedIn, 'you are signed straight in');
ok(localReset.convs.includes('REAL CONVERSATION'), 'YOUR CHATS SURVIVE the reset', localReset.convs);
ok(localReset.sessions.includes('REAL PROJECT'), 'your projects survive too', localReset.sessions);

/* THE SECURITY QUESTION: the device-local reset must switch OFF the moment a
   real server exists. Otherwise a local override could bypass the server's
   password — which would make the whole email flow pointless. */
section('With a Worker connected, the SERVER is the only source of truth');

const serverWins = await page.evaluate(async (stub) => {
  // an account exists locally with a known password...
  await createAccount('Valeria', 'both@test.com', 'localPass123');
  const localExists = !!findAccount('both@test.com');

  // ...but now a Worker IS connected
  AMV_API.base = 'https://api.test';
  AMV_API.token = 'tok';
  window.__emailOn = true;          // a properly configured workspace
  eval(stub);
  window.__emailOn = true;

  const localOffered = _localResetPossible('both@test.com');

  openForgot('both@test.com');
  await new Promise(r => setTimeout(r, 200));
  document.getElementById('fp-send').click();
  await new Promise(r => setTimeout(r, 400));

  return {
    localExists,
    localOffered,                                  // must be false
    askedForCode: !!document.getElementById('fp-code'),
    hitServer: window.__calls.some(c => c.includes('/auth/reset/code')),
    title: document.querySelector('.fp-modal .share-title')?.textContent
  };
}, STUB);

ok(serverWins.localExists, 'a local account exists on this device');
ok(serverWins.localOffered === false,
   'the device-local reset is REFUSED once a server is connected', serverWins.localOffered);
ok(serverWins.askedForCode, 'it asks for the emailed 6-digit code instead', serverWins.title);
ok(serverWins.hitServer, 'and it really went to the server for that code');

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
