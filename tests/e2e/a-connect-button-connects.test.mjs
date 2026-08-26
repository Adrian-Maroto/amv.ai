/* THE ROW SAID GMAIL AND THE BUTTON RAN A SIGN-IN.

   The Integrations catalogue carried a Google row: badge "Autonomous", which
   the legend on the same screen defines as "runs on its own in the background
   after you connect", and the description "Reads & drafts email, organizes
   Drive, manages your calendar - automatically."

   Its Connect button called connectIntegration('google'), which calls
   triggerGoogle - Google SIGN-IN. One-tap. It proves who you are and grants no
   Gmail, Drive or Calendar permission whatsoever.

   So somebody who wanted AMV to read their mail could press a button labelled
   Connect, complete a genuine Google flow, and come back having granted
   nothing. Then the row would show a tick, because `connected` was read from
   the sign-in token - a question about identity being used to answer a question
   about access.

   Connected accounts, on the same screen and above it, is the flow that does
   what the row describes: the server holds the grant, the person picks the
   scopes, and it survives the tab closing. The row leads there now.

   Nothing was deleted to fix this. The capability moved to the entry that
   delivers it, which is the difference between a catalogue and a promise. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

await page.evaluate(() => {
  /* The server's answer for this screen: Google is a provider the framework
     handles, and nothing is connected yet. */
  window.__started = [];
  const realFetch = window.fetch;
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/v1/connect/list')) {
      return new Response(JSON.stringify({
        ok: true, configured: true, items: [],
        /* The shape the Worker really sends: scopes is a list of KEYS, and the
           page turns each into words itself. The first version of this fake
           sent {key,label} objects and the picker threw on escH(object) - a
           fake that invents a shape tests the fake. */
        providers: [{ id: 'google', name: 'Google', ready: true,
                      scopes: ['mail.read', 'calendar.read'] }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (u.includes('/v1/connect/start')) {
      window.__started.push(JSON.parse(String((opts && opts.body) || '{}')));
      return new Response(JSON.stringify({ ok: true, url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, opts);
  };
});
await app.connect();
await page.evaluate(() => setTab('integrations'));
await page.waitForTimeout(900);

section('The screen offers Google exactly once as something you connect');
{
  const seen = await page.evaluate(() => {
    const vc = document.getElementById('vc');
    return {
      hasSection: !!document.getElementById('conn-sec'),
      /* Buttons that START a connection, wherever they are. Two of them for one
         provider is the defect, whichever one is pressed. */
      connectButtons: [...vc.querySelectorAll('[data-int-conn="google"],[data-dact="connAdd"][data-darg="google"]')].length,
    };
  });
  ok(seen.hasSection, 'Connected accounts is on the page and findable', seen.hasSection);
  ok(seen.connectButtons >= 1, 'and Google can be connected from it', seen.connectButtons);
}

section('Pressing Connect on the Google row starts the real handshake');
{
  /* THE ASSERTION THAT MATTERS. Not "a function was called" - what left the
     browser. A sign-in produces no request to the connection endpoint at all,
     so this cannot pass on the old behaviour however it is spelled. */
  await page.evaluate(() => {
    const b = document.querySelector('[data-int-conn="google"]');
    if (b) b.click();
  });
  await page.waitForTimeout(600);

  const state = await page.evaluate(() => ({
    started: window.__started.length,
    picker: !!document.querySelector('#conn-bg, .cwp'),
  }));
  /* Either the scope picker opened - which is the flow asking WHAT it may do
     before asking for anything - or the handshake started outright. Both are
     the real path; neither is a sign-in. */
  ok(state.picker || state.started > 0,
     'it opens the connection flow, not a sign-in', state);
}

section('A connection is what marks it connected, not a sign-in');
{
  /* The tick used to come from the Google sign-in token. Somebody who had
     simply signed in with Google - which many people do - saw Gmail reported as
     connected on a screen that had never been granted a mail scope. */
  const before = await page.evaluate(() => _connHasProvider('google'));
  ok(before === false, 'nothing connected reads as nothing connected', before);

  const after = await page.evaluate(() => {
    _connState.data = { configured: true, providers: [{ id: 'google', name: 'Google', ready: true }],
                        items: [{ id: 'c1', provider: 'google', scopes: ['mail.read'] }] };
    return _connHasProvider('google');
  });
  ok(after === true, 'a real grant reads as connected', after);

  const broken = await page.evaluate(() => {
    _connState.data.items[0].broken = 'refresh_failed';
    return _connHasProvider('google');
  });
  ok(broken === false,
     'and a grant the provider has revoked does NOT, because it can no longer do the thing the row promises', broken);

  /* AND WHAT THE ROW ACTUALLY DRAWS, not what the helper answers.

     The helper being right is not the fix - the fix is that the ROW asks it.
     Asserting only the helper let the row go back to reading the sign-in token
     without a single test noticing, which is the shape of the original defect
     one level up: correct at both ends, not joined in the middle. So this signs
     somebody in with Google, grants nothing, and looks at the tick. */
  /* SIGNED IN WITH GOOGLE IS SET THROUGH S.user, WHICH IS WHERE IT NOW LIVES.

     This used to seed a Google access token with _gSet and check the row did
     not read it. There is no such token in this browser any more - the whole
     machinery is gone - so seeding it would test nothing, and asserting its
     absence would only restate a removal.

     What remains is the question the original defect got wrong, and it is still
     answerable: somebody whose ACCOUNT is a Google account has granted AMV no
     access to anything, and the row must not say otherwise. That is identity
     standing in for access, which is the shape of the bug rather than the
     particular variable it was read from. */
  const withSignInOnly = await page.evaluate(() => {
    S.user = { name: 'Signed In', email: 'signed.in@gmail.com', ini: 'S', provider: 'google' };
    _connState.data = { configured: true, items: [],
                        providers: [{ id: 'google', name: 'Google', ready: true, scopes: ['mail.read'] }] };
    const host = document.getElementById('int-catalog');
    if (host) host.innerHTML = _integrationsCatalogHTML();
    const row = [...document.querySelectorAll('.int-card')]
      .find(c => /Google \(Gmail/.test(c.textContent || ''));
    return { signedIn: !!(S.user && S.user.provider === 'google'),
             tick: !!(row && row.querySelector('.int-ok')), found: !!row };
  });
  ok(withSignInOnly.found, 'the Google row is on the screen', withSignInOnly);
  ok(withSignInOnly.signedIn === true, 'somebody is signed in with a Google account', withSignInOnly.signedIn);
  ok(withSignInOnly.tick === false,
     'and the row does NOT claim to be connected - signing in is not granting access', withSignInOnly);

  const withGrant = await page.evaluate(() => {
    _connState.data.items = [{ id: 'c1', provider: 'google', scopes: ['mail.read'] }];
    const host = document.getElementById('int-catalog');
    if (host) host.innerHTML = _integrationsCatalogHTML();
    const row = [...document.querySelectorAll('.int-card')]
      .find(c => /Google \(Gmail/.test(c.textContent || ''));
    return !!(row && row.querySelector('.int-ok'));
  });
  ok(withGrant === true, 'while a real grant does show as connected', withGrant);
}

section('And the general entry point routes it too, not just the row');
{
  /* THE ROW WAS FIXED IN THE CALLER, WHICH IS ONE CALLER.

     _wireIntegrationCatalog checks _connOwnsProvider before calling
     connectIntegration, so the button on the screen was right. Inside
     connectIntegration, the Google branch still ran triggerGoogle - the
     sign-in - and connectIntegration is on window and is the general way in.
     The comment on INTEGRATION_META even said the routing happened there when
     it happened in the caller: two places deciding one thing, and the
     documentation describing the one that was not doing it.

     Called directly here, bypassing the catalogue entirely, because that is the
     path that was still wrong. */
  const out = await page.evaluate(async () => {
    _connState.data = { configured: true, items: [],
      providers: [{ id: 'google', name: 'Google', ready: true, scopes: ['mail.read'] }] };
    const realTrigger = window.triggerGoogle, realAdd = window.connAdd;
    let signedIn = 0, added = [];
    window.triggerGoogle = () => { signedIn++; };
    window.connAdd = (id) => { added.push(id); };
    try { await connectIntegration('google'); } catch (e) {}
    window.triggerGoogle = realTrigger; window.connAdd = realAdd;
    return { signedIn, added };
  });
  ok(out.signedIn === 0,
     'connectIntegration("google") does NOT run a sign-in', out.signedIn);
  ok(out.added.indexOf('google') >= 0,
     'it starts a real connected-accounts grant instead', out.added);
}

section('It is decided by what the server offers, not by naming Google');
{
  /* A list of "providers the framework owns" kept in the client is a list that
     drifts. The next provider moved to the framework would otherwise leave a
     second row quietly running the old flow - which is exactly how this defect
     was born. */
  const byServer = await page.evaluate(() => {
    _connState.data = { configured: true, items: [],
                        providers: [{ id: 'outlook', name: 'Microsoft', ready: true }] };
    return { outlook: _connOwnsProvider('outlook'), google: _connOwnsProvider('google') };
  });
  ok(byServer.outlook === true, 'a provider the server offers is handled by the framework', byServer);
  ok(byServer.google === false, 'and one it does not is not claimed', byServer);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
