/* "WHEN I LOG INTO MY ACCOUNT ON ONE DEVICE IT DOESN'T SAVE IT FROM THE
   OTHER. IT HAS TO SAVE EVERYTHING NO MATTER WHERE I LOG IN. ALL PAST CHATS."

   That reads as sync being broken. It isn't - sync works, and driving it
   directly showed a chat made on one device arriving on another. What was
   broken is three separate holes around it, each of which loses work on an
   ordinary day and none of which looks like a bug while you are watching:

   1. SYNC WAS NEVER SWITCHED ON for a returning visit. `AMVSync.start()` was
      called in exactly one place, the end of loginUser - which runs when
      somebody types their password, and not when they simply open AMV again
      with a session already restored from storage. So on every visit after
      the first, nothing subscribed to changes and no pull ever ran. This is
      the big one, and it is why the fault looks intermittent: it DID work in
      the session where you signed in.

   2. NOTHING PUSHED AT SIGN-IN. A push is only ever scheduled by a change,
      through those same subscriptions - which are installed last. Everything
      already on the device when they signed in was therefore never sent. On a
      new account, where the server has nothing, the first device's entire
      history stayed on the first device.

   3. THE LAST 1.2 SECONDS WERE ALWAYS LOST. Every change schedules a push
      1.2s later so a burst of edits is one request. Close the tab, switch
      apps or lock the phone inside that window and the timer dies with the
      page. On a phone that is not an edge case, it is how sessions normally
      end.

   WHY THIS SUITE RUNS A REAL SERVER instead of page.route, which every other
   suite here uses. The fix for (3) sends that last push with `keepalive`,
   which is the only thing that lets a request outlive the page that started
   it. Playwright's request interception DOES NOT SEE keepalive requests -
   measured: routed through page.route the handler is never reached and the
   request fails ERR_TUNNEL_CONNECTION_FAILED against the real internet. A
   suite built on page.route would report this dead while it worked, or - the
   way round that actually ships - go green on a nearby non-keepalive path
   while the real one was never exercised once. So the backend here is an http
   server on a real port and the assertion is that BYTES ARRIVED AT IT.

   connect-src in the shipped policy permits http://127.0.0.1:*, so this is
   the page's own CSP doing what it does in production, not a relaxed one.

   WHAT IS NOT SHOWN, said plainly: that `keepalive` carries a request past
   the page's death. Demonstrating that needs the tab to be destroyed with the
   request in flight, and driving that from here was not reliable. What IS
   shown is the thing the fix adds - that the request is SENT when the tab is
   backgrounded or hidden, instead of waiting for a timer that will not run. */
import { createServer } from 'node:http';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

/* ---- a backend that records what it is actually sent -------------------- */
const state = { data: null, rev: 0, pushes: [], pulls: 0 };

function cors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
}

const api = createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  cors(res, req.headers.origin);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (path === '/auth/login') {
      return json({ ok: true, token: 'tok-' + Date.now(), refreshToken: 'ref',
                    exp: Date.now() + 3e6, user: { email: 'a@amv.dev', name: 'Adrian', plan: 'pro' } });
    }
    if (path === '/sync/pull') { state.pulls++; return json({ ok: true, data: state.data, rev: state.rev }); }
    if (path === '/sync/push') {
      let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) {}
      state.pushes.push({ at: Date.now(), keepalive: true, titles: titlesOf(b.data) });
      state.data = b.data; state.rev++;
      return json({ ok: true, rev: state.rev });
    }
    return json({ ok: true });
  });
});
function titlesOf(d) {
  try { return (d && Array.isArray(d.sessions)) ? d.sessions.map(s => s.title) : []; } catch (e) { return []; }
}
/* The kernel picks the port, for the reason the harness does it: two suites
   running at once must not fight over a number somebody typed. */
await new Promise(r => api.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + api.address().port;

async function device(name) {
  const app = await bootApp({ apiBase: BASE, tab: 'chat',
                              user: { name: 'Adrian', email: 'a@amv.dev', ini: 'A' } });
  await app.page.evaluate(() => document.getElementById('ck')?.remove());
  await app.page.evaluate(async () => {
    await AMV_API.login('a@amv.dev', { password: 'correct horse battery staple' });
    loginUser({ email: 'a@amv.dev', name: 'Adrian' });
    await new Promise(r => setTimeout(r, 400));
  });
  return app;
}

section('The device is really signed in to a real server');
const A = await device('A');
{
  const r = await A.page.evaluate(() => ({
    live: AMV_API.live, hasSession: AMV_API.hasSession,
    enabled: AMVSync.enabled(), flush: typeof AMVSync.flush,
  }));
  ok(r.live && r.hasSession, 'the app has a session against the test backend');
  ok(r.enabled, 'sync is switched on for it');
  ok(r.flush === 'function', 'and there is a flush to call');
  ok(state.pulls > 0, 'signing in pulled from the server', 'pulls=' + state.pulls);
}

section('Work typed inside the debounce, then the tab goes away');
{
  state.pushes.length = 0;
  await A.page.evaluate(() => {
    const c = newConvObj('Typed then closed');
    c.msgs = [{ r: 'u', c: 'the last thing somebody wrote before locking the phone' }];
    _SESSIONS.unshift(c); _persistSessions(); AMVSync.push();
  });
  await A.page.waitForTimeout(250);

  /* The control. If this is not empty the debounce is not what the fix is
     for, and every assertion after it would be measuring nothing. */
  ok(state.pushes.length === 0, 'a quarter second in, the server has heard nothing yet',
     'pushes=' + state.pushes.length);

  await A.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await A.page.waitForTimeout(600);

  ok(state.pushes.length > 0, 'backgrounding the tab sent it anyway',
     'pushes=' + state.pushes.length);
  ok(titlesOf(state.data).includes('Typed then closed'),
     'and what arrived is the work, not an empty shell', JSON.stringify(titlesOf(state.data)));

  /* THE TAB IS NOW CLOSED, and closed before 1.2 seconds have passed since
     the edit. This is the point of the whole suite: with the browser gone the
     debounced timer is gone with it and can never fire, so anything the next
     device sees arrived because of the flush and for no other reason. Left
     open, the timer fires a second later and the cross-device assertion below
     passes whether the fix exists or not - which is what it did, measured,
     while the flush was removed. */
  await A.close();
}

section('A second device signing in finds it there');
const B = await device('B');
{
  const r = await B.page.evaluate(async () => {
    await AMVSync.pull();
    return { titles: (_SESSIONS || []).map(s => s.title) };
  });
  ok(r.titles.includes('Typed then closed'),
     'the other device has the chat that was never explicitly saved', JSON.stringify(r.titles));
}

section('Closing the page outright does the same thing');
{
  state.pushes.length = 0;
  await B.page.evaluate(() => {
    const c = newConvObj('Closed outright');
    c.msgs = [{ r: 'u', c: 'and then the tab was closed' }];
    _SESSIONS.unshift(c); _persistSessions(); AMVSync.push();
  });
  await B.page.waitForTimeout(250);
  ok(state.pushes.length === 0, 'still inside the debounce');
  await B.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await B.page.waitForTimeout(600);
  ok(titlesOf(state.data).includes('Closed outright'),
     'pagehide flushes too', JSON.stringify(titlesOf(state.data)));
}

section('A flush with nothing pending does not talk to the server');
{
  state.pushes.length = 0;
  const said = await B.page.evaluate(() => AMVSync.flush());
  await B.page.waitForTimeout(400);
  ok(said === false, 'flush says it had nothing to send');
  ok(state.pushes.length === 0, 'and sends nothing', 'pushes=' + state.pushes.length);
}

section('The FIRST sign-in sends up what this device already has');
{
  /* The other half of the same complaint, and it is not about timing.

     A push is only ever scheduled by a change, through subscriptions that
     AMVSync.start() installs - and start() runs at the END of sign-in, after
     the session list has already been loaded. So on the first sign-in of a
     page load there is nothing listening when this device's work goes past,
     and nothing schedules a push for it. On a new account the server has
     nothing, and it stays that way.

     THE FIRST sign-in is the whole point, and getting this wrong is how the
     first version of this section passed with the fix deleted: it called
     loginUser a second time, by which point start() had already subscribed
     and an unrelated key write pushed for it. Measured, both ways. */
  const C = await bootApp({ apiBase: BASE, tab: 'chat',
                            user: { name: 'Adrian', email: 'c@amv.dev', ini: 'A' } });
  await C.page.evaluate(() => document.getElementById('ck')?.remove());

  state.data = null; state.rev = 0; state.pushes.length = 0;

  // Work on the device before it has ever talked to the server.
  const seeded = await C.page.evaluate(() => {
    const c = newConvObj('Here before the account was');
    c.msgs = [{ r: 'u', c: 'written on this device with nobody signed in' }];
    _SESSIONS.unshift(c); _persistSessions();
    return { titles: _SESSIONS.map(s => s.title), syncing: AMVSync.enabled() };
  });
  ok(seeded.titles.includes('Here before the account was'), 'the device has work');
  ok(!seeded.syncing, 'and no sync running that could have sent it', String(seeded.syncing));
  await C.page.waitForTimeout(1500);
  ok(state.pushes.length === 0, 'the server has heard nothing', 'pushes=' + state.pushes.length);

  await C.page.evaluate(async () => {
    await AMV_API.login('c@amv.dev', { password: 'correct horse battery staple' });
    loginUser({ email: 'c@amv.dev', name: 'Adrian' });
  });
  await C.page.waitForTimeout(2600);

  ok(titlesOf(state.data).includes('Here before the account was'),
     'signing in is enough to put it on the server', JSON.stringify(titlesOf(state.data)));
  ok(C.errors.length === 0, 'no page errors on the new device', C.errors.join(' | '));
  await C.close();
}

section('A returning visit - nobody signs in - syncs at all');
{
  /* THE ONE THAT MATTERS MOST, and the one everything above was hiding.

     Sync was started in exactly one place: the end of loginUser. That runs
     when somebody types their password. It does not run when they simply open
     AMV again, because a returning session is restored straight out of
     storage. So on every visit after the first, nothing subscribed to changes
     and no pull ever ran: the laptop's work never left it and the phone's
     work never arrived.

     This device never calls loginUser. It boots with a stored session, the
     way a second visit does, and nothing else. */
  state.data = { sessions: [{ id: 'from-elsewhere', title: 'Written on the other device',
                              msgs: [{ r: 'u', c: 'hello from the phone' }], created: Date.now() }] };
  state.rev = 9;
  state.pushes.length = 0;

  const D = await bootApp({ apiBase: BASE, tab: 'chat',
                            user: { name: 'Adrian', email: 'd@amv.dev', ini: 'A' } });
  await D.page.evaluate(() => document.getElementById('ck')?.remove());

  /* A stored session, and then the boot restore - exactly what a reload does.
     No loginUser anywhere in this section. */
  const booted = await D.page.evaluate(async () => {
    AMV_API.token = 'restored-token';
    const c = newConvObj('Written on this device');
    c.msgs = [{ r: 'u', c: 'hello from the laptop' }];
    _SESSIONS.unshift(c); _persistSessions();
    await _ensureBackendSession();
    await new Promise(r => setTimeout(r, 2600));
    return { titles: (_SESSIONS || []).map(s => s.title) };
  });

  ok(booted.titles.includes('Written on the other device'),
     'the other device\'s work arrived without anyone signing in',
     JSON.stringify(booted.titles));
  ok(titlesOf(state.data).includes('Written on this device'),
     'and this device\'s work went up', JSON.stringify(titlesOf(state.data)));
  ok(D.errors.length === 0, 'no page errors on the returning device', D.errors.join(' | '));
  await D.close();
}

section('Signing out and back in on the same tab pulls again');
{
  /* THE FLAG THAT SWITCHES SYNC ON HAS TO BE SWITCHED BACK OFF.

     Both doors into sync now go through one bootstrap that runs once per
     session, which is what stops a fresh sign-in and a restored session from
     each installing their own set of subscriptions. "Once" is held by a flag,
     and a flag that is never cleared is a feature that works exactly one time.

     The case that makes it matter is not exotic: sign out, hand the laptop to
     somebody else, they sign in. Same page load, so the flag is still set from
     the first account - and the second account never pulls. They open AMV,
     their own chats are not there, and the product looks broken on the first
     screen they ever see of it.

     signOut clears it. signOutAndErase reaches the same function rather than
     repeating it, which is a call-graph fact and does not need measuring - but
     the clear itself does, because nothing else in this file would notice it
     being deleted. */
  const E = await device('E');
  await E.page.waitForTimeout(600);
  const before = state.pulls;

  await E.page.evaluate(() => { signOut(); });
  await E.page.waitForTimeout(300);
  const afterOut = await E.page.evaluate(() => ({
    signedOut: !(S.user && S.user.email),
    syncing: AMVSync.enabled(),
  }));
  ok(afterOut.signedOut, 'they are signed out');
  ok(!afterOut.syncing, 'and sync is off, because there is no session to sync');

  /* A DIFFERENT PERSON, on the same page load and the same tab. */
  await E.page.evaluate(async () => {
    await AMV_API.login('second@amv.dev', { password: 'correct horse battery staple' });
    loginUser({ email: 'second@amv.dev', name: 'Somebody else' });
  });
  await E.page.waitForTimeout(1200);

  ok(state.pulls > before,
     'the second account pulls its own data instead of inheriting a flag',
     before + ' -> ' + state.pulls);
  ok(E.errors.length === 0, 'no page errors on the shared tab', E.errors.join(' | '));
  await E.close();
}

ok(B.errors.length === 0, 'no page errors', B.errors.join(' | '));
await B.close();
api.close();
report();
done();
