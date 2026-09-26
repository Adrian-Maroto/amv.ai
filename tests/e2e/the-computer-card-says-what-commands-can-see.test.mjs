/* THE COMPUTER CARD SAYS WHAT COMMANDS CAN SEE.  (AMV-AUD-005)

   A bridge started normally gives commands a short allowed list of settings
   and none of the terminal's keys or tokens; one started with
   --share-environment gives them everything. Somebody looking at AMV should
   be able to tell which they are connected to - it is the difference between
   "a command can read my cloud keys" and "it cannot". The bridge reports it
   when pairing, and this checks the card says it, both ways, and that it
   survives a reload of the page like the rest of the pairing. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

const card = (shares) => page.evaluate((sh) => {
  Object.assign(BRIDGE, { connected: true, port: 45678, token: 't', folder: 'proj', sharesEnv: sh });
  const d = document.createElement('div'); d.innerHTML = _bridgeCardHTML();
  return { text: d.textContent, warn: !!d.querySelector('.brg-warn') };
}, shares);

section('A normal bridge: basics only, said plainly');
{
  const r = await card(false);
  ok(/none of the keys\s+or tokens/.test(r.text) && !r.warn, 'the card says commands do not get the terminal’s keys', r.text.slice(-200));
}

section('A bridge sharing everything: said as a warning');
{
  const r = await card(true);
  ok(r.warn && /Sharing everything/.test(r.text) && /--share-environment/.test(r.text),
     'the card warns that every command can read the terminal’s keys and tokens', r.text.slice(-240));
}

section('It survives a reload with the rest of the pairing');
{
  const r = await page.evaluate(() => {
    Object.assign(BRIDGE, { connected: true, port: 45678, token: 't', folder: 'proj', root: '/p', sharesEnv: true });
    _bridgeRemember();
    return JSON.parse(sessionStorage.getItem('amv_bridge') || '{}');
  });
  ok(r.sharesEnv === true, 'what the bridge said is kept with the pairing', r);
  await page.evaluate(() => { _bridgeForget(); });
  const after = await page.evaluate(() => BRIDGE.sharesEnv);
  ok(after === false, 'and forgotten with it', after);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
