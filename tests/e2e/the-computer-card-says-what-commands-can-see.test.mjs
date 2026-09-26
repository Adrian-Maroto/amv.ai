/* THE COMPUTER CARD SAYS WHAT COMMANDS CAN SEE.  (AMV-AUD-005)

   A bridge started normally gives commands a short allowed list of settings
   and none of the terminal's keys or tokens; one started with
   --share-environment gives them everything. Somebody looking at AMV should
   be able to tell which they are connected to - it is the difference between
   "a command can read my cloud keys" and "it cannot". The bridge reports it
   when pairing, and this checks the card says it, both ways, and that it
   survives a reload of the page like the rest of the pairing.

   The same for FILES: on Linux with bubblewrap the bridge hides keys and
   logins from commands, and it reports whether that fence is on - or why not -
   so the card can say which. A bridge too old to report is taken as unfenced. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

const card = (shares, fence) => page.evaluate(([sh, fe]) => {
  Object.assign(BRIDGE, { connected: true, port: 45678, token: 't', folder: 'proj', sharesEnv: sh, fence: fe });
  const d = document.createElement('div'); d.innerHTML = _bridgeCardHTML();
  return { text: d.textContent, warns: [...d.querySelectorAll('.brg-warn')].map(x => x.textContent) };
}, [shares, fence === undefined ? 'on' : fence]);

section('A normal bridge: basics only, said plainly');
{
  const r = await card(false);
  ok(/none of the keys\s+or tokens/.test(r.text) && !r.warns.length, 'the card says commands do not get the terminal’s keys', r.text.slice(-200));
}

section('A bridge sharing everything: said as a warning');
{
  const r = await card(true);
  ok(r.warns.some(w => /Sharing everything/.test(w)) && /--share-environment/.test(r.text),
     'the card warns that every command can read the terminal’s keys and tokens', r.text.slice(-240));
}

section('Files: the fence on, said plainly; off, said as a warning, with the reason');
{
  const on = await card(false, 'on');
  ok(/keys, cloud logins/.test(on.text) && /hidden from commands and connectors/.test(on.text) && !on.warns.length, 'fenced: keys are hidden, no warning', on.text.slice(-260));
  const why = { off: /--no-fence/, missing: /Install bubblewrap/, failed: /would not start the fence/, unsupported: /Only ask for work/ };
  for (const k of Object.keys(why)) {
    const r = await card(false, k);
    ok(r.warns.some(w => /Commands and connectors can read every file you can/.test(w)) && why[k].test(r.text), 'unfenced (' + k + '): a warning that says why', r.warns);
  }
}

section('The fence is read from the pairing, and an old bridge counts as unfenced');
{
  const pair = (answer) => page.evaluate(async (a) => {
    const real = window.fetch;
    window.fetch = async (url, init) => /\/amv-bridge\/pair/.test(String(url))
      ? new Response(JSON.stringify(a), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : real(url, init);
    try { await _bridgePair(45679, 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA'); } finally { window.fetch = real; }
    return BRIDGE.fence;
  }, answer);
  ok(await pair({ token: 't2', folder: 'p', fence: 'on' }) === 'on', 'a bridge that fences says so', true);
  ok(await pair({ token: 't3', folder: 'p', fence: 'missing' }) === 'missing', 'and one that cannot says why', true);
  ok(await pair({ token: 't4', folder: 'p' }) === 'unsupported', 'a bridge that says nothing is not assumed to fence', true);
  ok(await pair({ token: 't5', folder: 'p', fence: '<b>on</b>' }) === 'unsupported', 'nor one that says something unrecognised', true);
}

section('It survives a reload with the rest of the pairing');
{
  const r = await page.evaluate(() => {
    Object.assign(BRIDGE, { connected: true, port: 45678, token: 't', folder: 'proj', root: '/p', sharesEnv: true, fence: 'on' });
    _bridgeRemember();
    return JSON.parse(sessionStorage.getItem('amv_bridge') || '{}');
  });
  ok(r.sharesEnv === true && r.fence === 'on', 'what the bridge said is kept with the pairing', r);
  await page.evaluate(() => { _bridgeForget(); });
  const after = await page.evaluate(() => ({ s: BRIDGE.sharesEnv, f: BRIDGE.fence }));
  ok(after.s === false && after.f === '', 'and forgotten with it', after);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
