/* "DISCONNECT" MEANT "THIS TAB FORGETS".  (AMV-AUD-003)

   `_bridgeForget` cleared the browser's copy of the pairing token and made no
   request at all. The daemon kept the session valid, kept running connectors
   alive, and kept accepting work from anything that still held that token from
   an allowed origin - while the screen said "Disconnected. AMV can no longer
   reach that folder."

   Re-pairing replaced the token and stopping the daemon ended it. The button
   did neither, so the only way to actually end a session was to know that the
   button did not.

   The daemon half - that a revoked token is dead, and that revoking kills what
   is running - is measured against a real bridge in
   `closing-the-bridge-stops-what-it-started`. What is measured HERE is the
   browser's side of the same promise, and the part of it that is easy to get
   wrong: what the person is told when the machine could not be reached.

   Clearing local state only on a successful revoke would be worse than the
   original defect - somebody would stay paired in a tab they had just told to
   disconnect. So the local state always goes, and the SENTENCE changes. Those
   are two different facts about somebody's computer and only one of them is
   what the button promises. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

/* A paired bridge, and every outbound call recorded. BRIDGE is a top-level
   object, so its FIELDS are set rather than the binding replaced. */
const arm = (handler) => page.evaluate((src) => {
  window.__calls = [];
  Object.assign(BRIDGE, { port: 51234, token: 'TOK-123', folder: 'proj', root: '/p/proj', connected: true });
  try { sessionStorage.setItem('amv_bridge', JSON.stringify({ port: 51234, token: 'TOK-123' })); } catch (e) {}
  if (typeof MCP !== 'undefined') MCP.live = { srv: true };
  window.fetchDeadline = new Function('return ' + src)();
}, handler);

section('Disconnect asks the daemon to end the session');
{
  await arm(`async (url, init) => {
    window.__calls.push({ url: String(url), token: (init && init.headers || {})['X-AMV-Bridge-Token'] });
    return { ok: true, status: 200, json: async () => ({ revoked: true, wasPaired: true, stopped: { jobs: 2, servers: 1 } }) };
  }`);
  const r = await page.evaluate(async () => {
    const out = await bridgeDisconnect();
    return { out, calls: window.__calls, connected: BRIDGE.connected, token: BRIDGE.token,
             stored: (() => { try { return sessionStorage.getItem('amv_bridge'); } catch (e) { return 'err'; } })(),
             live: Object.keys((typeof MCP !== 'undefined' && MCP.live) || {}) };
  });
  ok(r.calls.length === 1, 'exactly one request goes out', JSON.stringify(r.calls));
  ok(/\/amv-bridge\/revoke$/.test(r.calls[0].url), 'to the revoke route', r.calls[0].url);
  ok(r.calls[0].token === 'TOK-123',
     'carrying the token it is about to destroy, so only that session can end it', r.calls[0].token);
  ok(r.out.revoked === true, 'and it reports the session really was ended', JSON.stringify(r.out));
  ok(r.out.stopped && r.out.stopped.jobs === 2,
     'carrying what the daemon says it stopped, rather than assuming', JSON.stringify(r.out.stopped));
  ok(r.connected === false && r.token === '', 'the browser state is cleared', JSON.stringify(r));
  ok(r.stored === null, 'including the stored pairing', String(r.stored));
  ok(r.live.length === 0,
     'and the connectors are no longer listed as live, because they ran on that machine', JSON.stringify(r.live));
}

section('A daemon that cannot be reached is not reported as disconnected');
{
  /* THE ASSERTION THE WHOLE FINDING IS ABOUT. Local state still goes - leaving
     somebody paired in a tab they told to disconnect would be worse than the
     defect - but the machine still holds a live session, and only the person
     can do anything about that. */
  await arm(`async () => { window.__calls.push({ url: 'attempted' }); throw new Error('connection refused'); }`);
  const r = await page.evaluate(async () => {
    const out = await bridgeDisconnect();
    return { out, connected: BRIDGE.connected, token: BRIDGE.token, tried: window.__calls.length };
  });
  ok(r.tried === 1, 'it tried', String(r.tried));
  ok(r.out.revoked === false,
     'and does NOT claim the session was ended, because nothing observed that', JSON.stringify(r.out));
  ok(!!r.out.why, 'it says why it could not tell', r.out.why);
  ok(r.connected === false && r.token === '',
     'while the browser state is cleared anyway - staying paired in a tab you told to disconnect is worse',
     JSON.stringify(r));
}

section('A token the daemon has already forgotten is not a failure');
{
  /* Two tabs pressing Disconnect, or a daemon that restarted. There is nothing
     left to revoke, which is the state being asked for - reporting that as an
     unresolved machine-side session would send somebody to check something
     that is already fine. */
  await arm(`async () => ({ ok: false, status: 401, json: async () => ({ error: 'not_paired' }) })`);
  const r = await page.evaluate(async () => (await bridgeDisconnect()));
  ok(r.revoked === true, 'counted as revoked', JSON.stringify(r));
  ok(!r.why, 'with nothing to warn about', String(r.why));
}

section('A refusal that is not 401 is still unresolved');
{
  /* The other side of the line above. A 500 means the daemon is there and did
     not do it, which is exactly the case somebody needs to know about. */
  await arm(`async () => ({ ok: false, status: 500, json: async () => ({ error: 'failed' }) })`);
  const r = await page.evaluate(async () => (await bridgeDisconnect()));
  ok(r.revoked === false, 'not counted as revoked', JSON.stringify(r));
  ok(/failed/.test(r.why || ''), 'and it carries what the daemon said', r.why);
}

section('With no bridge connected, nothing is asked and nothing is claimed');
{
  const r = await page.evaluate(async () => {
    window.__calls = [];
    BRIDGE.connected = false; BRIDGE.token = '';
    const out = await bridgeDisconnect();
    return { out, calls: window.__calls.length };
  });
  ok(r.calls === 0, 'no request is made when there is nothing to disconnect from', String(r.calls));
  ok(r.out.revoked === false, 'and no revocation is claimed', JSON.stringify(r.out));
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
