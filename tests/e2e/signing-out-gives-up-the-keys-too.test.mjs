/* SIGN-OUT ENDED THE SESSION AND LEFT THE KEYS ON THE TABLE.  (AMV-AUD-002)

   `_wipeAccountState` resets a lot: recents, the Dev project, Lab code, memory,
   the verified plan, the renewal date, the admin figures. Every one of those is
   state belonging to a SCREEN.

   What it did not touch was a different kind of thing entirely - live
   authorities that do not consult `S.user` at all, and therefore kept working
   after the user was gone:

     · the administrator token, which `isAdmin()` reads instead of the user
     · the bridge token and its stored pairing - shell access to a computer
     · connector credentials in sessionStorage
     · a granted FileSystemDirectoryHandle: read-write access to a real folder

   So Alice signs out, Bob signs in on the same browser, and the tab still holds
   Alice's administrator token, her machine, her connectors' credentials and her
   folder. The screen says nobody is signed in.

   The account switch on a shared machine is the ordinary case for this, not an
   exotic one: a family laptop, a library, a demo on somebody else's desk.

   WHAT THIS FILE IS CAREFUL ABOUT. Each holder is asserted to be gone
   INDIVIDUALLY, because a teardown that stops at the first failure would clear
   the harmless things and leave the dangerous ones - the worst possible order.
   And the bridge is asserted to be TOLD, not merely forgotten, for the same
   reason the Disconnect button is: forgetting a token locally leaves the daemon
   accepting work from anything that still has it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Alice', email: 'alice@amv.dev', ini: 'A' } });
const { page, errors } = app;

/* Everything the previous account had. Set through the real holders, not
   through a copy: `BRIDGE` and `AMVWorkspace` are top-level objects, so their
   FIELDS are assigned - replacing the binding would set something nothing
   reads, which this repository has a gate stage for. */
const arm = () => page.evaluate(() => {
  window.__revoked = [];
  window.fetchDeadline = async (url) => {
    window.__revoked.push(String(url));
    return { ok: true, status: 200, json: async () => ({ revoked: true, wasPaired: true, stopped: { jobs: 0, servers: 0 } }) };
  };
  _setAdminToken('ADMIN-SECRET-TOKEN');
  Object.assign(BRIDGE, { port: 51234, token: 'BRIDGE-TOK', folder: 'proj', root: '/p/proj', connected: true });
  try { sessionStorage.setItem('amv_bridge', JSON.stringify({ port: 51234, token: 'BRIDGE-TOK' })); } catch (e) {}
  try { sessionStorage.setItem('amv_mcp_env_github', JSON.stringify({ GITHUB_TOKEN: 'ghp_alice' })); } catch (e) {}
  try { sessionStorage.setItem('amv_mcp_env_stripe', JSON.stringify({ STRIPE_KEY: 'sk_alice' })); } catch (e) {}
  if (typeof MCP !== 'undefined') MCP.live = { github: true };
  /* A stand-in for a real directory handle. What matters is that the reference
     is dropped - holding one IS the access. */
  AMVWorkspace.dirHandle = { kind: 'directory', name: 'alices-folder' };
  AMVWorkspace.files = [{ name: 'salary.csv', path: 'salary.csv', text: 'secret' }];
});

const holders = () => page.evaluate(() => ({
  admin: _adminToken(),
  bridgeToken: BRIDGE.token,
  bridgeConnected: BRIDGE.connected,
  bridgeStored: (() => { try { return sessionStorage.getItem('amv_bridge'); } catch (e) { return 'err'; } })(),
  mcpEnv: (() => {
    const out = [];
    try { for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i); if (k && k.indexOf('amv_mcp_env_') === 0) out.push(k);
    } } catch (e) {}
    return out;
  })(),
  mcpLive: Object.keys((typeof MCP !== 'undefined' && MCP.live) || {}),
  dirHandle: AMVWorkspace.dirHandle ? AMVWorkspace.dirHandle.name : null,
  wsFiles: (AMVWorkspace.files || []).length,
  revoked: window.__revoked || [],
}));

section('Every one of them really is armed first');
{
  await arm();
  const b = await holders();
  ok(b.admin === 'ADMIN-SECRET-TOKEN', 'the administrator token is set', b.admin ? 'set' : 'missing');
  ok(b.bridgeToken === 'BRIDGE-TOK' && b.bridgeConnected === true, 'a machine is connected', JSON.stringify(b.bridgeToken));
  ok(b.mcpEnv.length === 2, 'connector credentials are stored', JSON.stringify(b.mcpEnv));
  ok(b.dirHandle === 'alices-folder', 'a folder is granted', String(b.dirHandle));
  ok(b.wsFiles === 1, 'with its contents read into memory', String(b.wsFiles));
  /* Otherwise the section below proves nothing: "it is gone" is trivially true
     of something that was never there. */
}

section('Signing out gives up every one of them');
{
  await page.evaluate(() => { _wipeAccountState(); });
  await page.waitForTimeout(150);
  const a = await holders();
  ok(a.admin === '', 'the administrator token is gone', JSON.stringify(a.admin));
  ok(a.bridgeToken === '' && a.bridgeConnected === false,
     'the bridge token is gone and the machine is not connected', JSON.stringify(a));
  ok(a.bridgeStored === null, 'and the stored pairing with it', String(a.bridgeStored));
  ok(a.mcpEnv.length === 0, 'connector credentials are gone', JSON.stringify(a.mcpEnv));
  ok(a.mcpLive.length === 0, 'and no connector is still listed as live', JSON.stringify(a.mcpLive));
  ok(a.dirHandle === null,
     'the folder handle is dropped - holding one IS the access', String(a.dirHandle));
  ok(a.wsFiles === 0, 'and the files read out of it are not left in memory', String(a.wsFiles));
}

section('The machine is TOLD, not merely forgotten');
{
  /* The same reasoning as the Disconnect button. Forgetting a token locally
     leaves the daemon accepting work from anything that still holds it - so
     signing out would end the session in the tab and leave a live one on the
     computer. */
  const a = await holders();
  ok(a.revoked.length === 1, 'exactly one request went out', JSON.stringify(a.revoked));
  ok(/\/amv-bridge\/revoke$/.test(a.revoked[0] || ''), 'to the revoke route', a.revoked[0]);
}

section('A daemon that cannot be reached does not keep the token alive here');
{
  /* Sign-out must not become conditional on a program being reachable. The
     local half goes regardless; only the sentence about the machine changes,
     and that sentence belongs to the Disconnect button, which has its own
     suite. */
  await arm();
  await page.evaluate(() => {
    window.fetchDeadline = async () => { throw new Error('connection refused'); };
    _wipeAccountState();
  });
  await page.waitForTimeout(150);
  const a = await holders();
  ok(a.bridgeToken === '' && a.bridgeConnected === false,
     'the browser gives up the token even when the daemon is gone', JSON.stringify(a));
  ok(a.admin === '' && a.mcpEnv.length === 0 && a.dirHandle === null,
     'and everything else still goes with it', JSON.stringify(a));
}

section('One failure does not skip the rest');
{
  /* The teardown wraps each holder on its own. A single try around all of them
     would clear whatever came before the throw and leave the rest - and the
     order that leaves is arbitrary, which means the dangerous ones can be the
     survivors. */
  await arm();
  await page.evaluate(() => {
    /* Make the FIRST holder's clear throw. `_clearAdminToken` is a function
       declaration, so it is a real global and can be replaced. */
    window._clearAdminToken = () => { throw new Error('boom'); };
    _wipeAccountState();
  });
  await page.waitForTimeout(150);
  const a = await holders();
  ok(a.admin === 'ADMIN-SECRET-TOKEN', 'the one that threw did not clear, as set up', a.admin ? 'still set' : 'cleared');
  ok(a.bridgeToken === '', 'but the bridge token still went', JSON.stringify(a.bridgeToken));
  ok(a.mcpEnv.length === 0, 'and the connector credentials', JSON.stringify(a.mcpEnv));
  ok(a.dirHandle === null, 'and the folder handle', String(a.dirHandle));
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
