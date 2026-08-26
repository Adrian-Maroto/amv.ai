/* A LIVE BEARER TOKEN TO SOMEBODY'S MAIL, SITTING IN localStorage.

   `amv_gtoken` was a working key to Gmail, Calendar and Drive, kept on disk,
   readable by any script that ended up on the page, and still there long after
   the tab was closed.

   What made it easy to remove is that it was never needed there. The server
   already holds the refresh token and already mints a fresh access token on
   demand, so persisting the access token bought one saved round trip on load
   and cost a stored credential.

   It also closes a case sign-out cannot. `amv_gtoken` is a GLOBAL key, cleared
   by _SIGNOUT_CLEAR_GLOBAL when somebody signs out properly - the right fix for
   the path it covers, and it covers only that path. A closed laptop, a crashed
   tab, a browser quit: none run sign-out, and the token stayed for whoever
   opened AMV next on that machine. A token in memory dies with the page.

   The blast radius was checked before any of this was touched: `amv_gtoken` is
   the GOOGLE token. AMV's own session is `amv_api_token`, a different key. So
   the worst case here is Google integrations breaking, not anybody being locked
   out of their account - which is why this was safe to do at all. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Adrian', email: 'a@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => {
  document.getElementById('ck')?.remove();
  /* ESTABLISHED ONCE, BEFORE ANYTHING IS STORED.

     The connected marker is scoped per account, and _scopeKey resolves the
     account from S.user or, on a cold load, from `amv_user` in storage. A real
     sign-in writes that key; bootApp only sets S.user in memory. Without this
     the marker is written under the signed-in scope and read back under
     "guest" after a reload, and the test fails on its own setup rather than on
     anything the product did. */
  localStorage.setItem('amv_user', JSON.stringify({ name:'Adrian', email:'a@amv.dev', ini:'A' }));
});

const onDisk = () => page.evaluate(() => {
  const hits = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    const v = localStorage.getItem(k) || '';
    if (/gtoken/i.test(k) || /^ya29\.|^gho_|^ATZ/.test(v)) hits.push(k + '=' + v.slice(0, 24));
  }
  return hits;
});

section('A token handed to AMV never reaches the disk');
{
  const r = await page.evaluate(() => {
    _gSet('ya29.a-real-looking-google-token', Date.now() + 3600000);
    return { inHand: getGToken(), marker: loadStr('amv_google_connected') };
  });
  ok(r.inHand === 'ya29.a-real-looking-google-token', 'it is usable in memory', String(r.inHand).slice(0, 20));
  const disk = await onDisk();
  ok(disk.length === 0, 'and nothing resembling it is in storage', disk);
  ok(r.marker === '1', 'only a boolean marker is stored', r.marker);
}

section('The marker is not a credential');
{
  const v = await page.evaluate(() => loadStr('amv_google_connected'));
  ok(v === '1', 'it is the string 1', v);
  ok(v.length < 4, 'nothing usable could be hidden in it', v.length);
}

section('Closing the tab takes the token with it');
{
  /* The case the sign-out list cannot reach. A fresh page is a fresh memory,
     and what survives is the marker, which is worth nothing to anybody. */
  const before = await page.evaluate(() => !!getGToken());
  ok(before, 'a token is in hand before the reload');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    tok: (typeof getGToken === 'function') ? getGToken() : 'no-fn',
    marker: loadStr('amv_google_connected'),
  }));
  ok(after.tok === null, 'and no token survives the reload', String(after.tok).slice(0, 20));
  /* Asserted on the stored RECORD rather than on loadStr, deliberately. The
     marker is scoped per account, and this harness signs in by setting S.user
     in memory - a cold load has no session, so _scopeKey resolves to "guest"
     and reads nothing. That is the harness, not the product: what matters here
     is that the fact of the connection is still written down while the
     credential is not, and that is exactly what the raw key shows. */
  const kept = await page.evaluate(() =>
    Object.keys(localStorage).filter(k => /amv_google_connected$/.test(k))
          .map(k => k + '=' + localStorage.getItem(k)));
  ok(kept.length === 1 && /=1$/.test(kept[0]),
     'while the fact of the connection is still written down', kept);
  const disk = await onDisk();
  ok(disk.length === 0, 'still nothing token-shaped on disk', disk);
}

section('A fresh tab still knows Google is connected');
{
  /* The regression this change invites: everything that decided "connected" by
     looking for the token would report disconnected on every single reload,
     and send somebody to connect an account they already had. */
  await page.evaluate(() => {
    S.user = { name: 'Adrian', email: 'a@amv.dev', ini: 'A' };
    goApp();
  });
  const r = await page.evaluate(() => ({
    crew: _cwHasGoogle(),
    tokenInHand: !!getGToken(),
  }));
  ok(r.tokenInHand === false, 'with no token in hand at all', r.tokenInHand);
  ok(r.crew === true, 'signing in with Google still reads as signed in', r.crew);
}

section('But being signed in is not being connected, and the two stopped agreeing');
{
  /* THIS ASSERTION USED TO SAY THE OPPOSITE, AND IT WAS THE DEFECT.

     It required all three Google capabilities to report connected off the
     sign-in marker - which is what the product did, and what made a screen tell
     somebody Gmail was connected on an account that had granted no mail scope
     at all. A question about identity answering a question about access.

     They ask the grant now, so a sign-in with nothing granted reads as nothing
     granted, and a grant reads as connected whether or not anybody signed in
     with Google. The suite still owns the first half - the sign-in token is in
     memory and survives a reload - and this is the boundary it must not cross
     back over. */
  const r = await page.evaluate(() => {
    const caps = () => TASK_CAPABILITIES.filter(c => c.connectId === 'google').map(c => c.isConnected());
    const signedInOnly = caps();
    /* Now grant mail and calendar on the server's list, and nothing else. */
    _connState.data = { configured: true, providers: [{ id: 'google', name: 'Google', ready: true }],
      items: [{ id: 'c1', provider: 'google', unattended: true, scopes: ['mail.read', 'calendar.read'] }] };
    return { signedInOnly, granted: caps(), stillSignedIn: _cwHasGoogle() };
  });
  ok(r.signedInOnly.every(v => v === false),
     'a sign-in with nothing granted reads as nothing connected', JSON.stringify(r.signedInOnly));
  ok(r.granted[0] === true && r.granted[1] === true,
     'the capabilities that WERE granted read as connected', JSON.stringify(r.granted));
  ok(r.granted[2] === false,
     'and the one that was not still reads as not - per capability, not per provider', JSON.stringify(r.granted));
  ok(r.stillSignedIn === true,
     'while the sign-in is untouched by any of it, because it answers a different question', r.stillSignedIn);
}

section('Disconnecting clears the memory, not just the storage');
{
  const r = await page.evaluate(() => {
    _gSet('ya29.another-token', Date.now() + 3600000);
    _gClear();
    return { tok: getGToken(), marker: loadStr('amv_google_connected'), crew: _cwHasGoogle() };
  });
  ok(r.tok === null, 'the token is gone from memory', String(r.tok));
  ok(!r.marker, 'the marker is cleared', JSON.stringify(r.marker));
  ok(r.crew === false, 'and nothing reports Google as connected', r.crew);
}

section('An expired token is never handed out');
{
  const r = await page.evaluate(() => {
    _gSet('ya29.stale', Date.now() - 1000);
    return { got: getGToken(), after: getGToken() };
  });
  ok(r.got === null, 'a token past its expiry is refused', String(r.got));
  ok(r.after === null, 'and stays refused rather than reappearing', String(r.after));
}

section('Somebody upgrading has theirs taken off the disk');
{
  /* Without this the change protects new connections only, and every existing
     one keeps exactly the exposure it was meant to lose. */
  /* Driven, not grepped. The migration is a named function expression and the
     minifier renames it, so looking for the name would have tested the build
     rather than the behaviour - and would have started failing for a reason
     that has nothing to do with whether anybody's token gets cleaned up. */
  await page.evaluate(() => {
    localStorage.setItem('amv_gtoken', 'ya29.left-over-from-an-older-build');
    localStorage.setItem('amv_gtoken_exp', String(Date.now() + 3600000));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => ({
    stillOnDisk: localStorage.getItem('amv_gtoken'),
    expOnDisk: localStorage.getItem('amv_gtoken_exp'),
    inHand: (typeof getGToken === 'function') ? getGToken() : null,
  }));
  ok(m.stillOnDisk === null, 'a token left by an older build is removed from disk', String(m.stillOnDisk));
  ok(m.expOnDisk === null, 'and its expiry with it', String(m.expOnDisk));
  ok(m.inHand === 'ya29.left-over-from-an-older-build',
     'while the connection keeps working, in memory', String(m.inHand).slice(0, 24));
}

section('The account session was not touched');
{
  /* The reason this was safe: a mistake here breaks Gmail, not sign-in. */
  /* The safety argument, stated as something checkable rather than as a mood.
     Whether this harness happens to still hold a session after two reloads is
     not the point - the point is that the key this change touched and the key
     that holds an AMV session are different keys, so the worst outcome of
     getting this wrong is Gmail breaking, not somebody locked out. */
  /* A first attempt here checked that the two key names never appear near each
     other in the bundle. They do, legitimately - both are listed in
     _GLOBAL_KEYS and in the sign-out clear list - so it was measuring proximity
     in a roster and calling it a safety property. Driven instead: the only
     claim worth making is that clearing one does not disturb the other, and
     that is a thing you can do rather than a thing you can grep. */
  const sessionUntouched = await page.evaluate(() => {
    saveStr('amv_api_token', 'session-value');
    _gSet('ya29.something', Date.now() + 3600000);
    _gClear();
    return loadStr('amv_api_token');
  });
  ok(sessionUntouched === 'session-value',
     'and clearing the Google token leaves the AMV session exactly as it was', sessionUntouched);
}

section('Nothing reads the token off disk any more');
{
  const src = await page.evaluate(() => (document.getElementById('amv-app-code') || {}).textContent || '');
  /* One read survives on purpose - the migration, which exists to empty it. */
  const reads = (src.match(/loadStr\("amv_gtoken"\)|loadStr\('amv_gtoken'\)/g) || []).length;
  ok(reads <= 1, 'at most the migration reads it', reads);
  const writes = (src.match(/saveStr\("amv_gtoken"|saveStr\('amv_gtoken'/g) || []).length;
  ok(writes === 0, 'and nothing writes it back', writes);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
