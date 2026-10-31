/* NOTIFY THIS DEVICE - THE SWITCH.

   Settings > Account, beside "Email me when AMV is done". Through the real
   page and the real Worker (81-web-push.js has the server's half): with no
   keys on the deployment the switch is off and says why; with keys it is
   offered; a browser that refuses permission leaves it off and says so; and
   a subscription the browser cannot make (no push service reachable here)
   is reported, not shown as on. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';
import { webcrypto as C } from 'crypto';

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const vk = await C.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const KEYS = { VAPID_PUBLIC_KEY: b64u(new Uint8Array(await C.subtle.exportKey('raw', vk.publicKey))), VAPID_PRIVATE_KEY: (await C.subtle.exportKey('jwk', vk.privateKey)).d };

const vals = new Map();
const env = makeEnv({
  APP_URL: 'http://localhost:9261',
  AMV_COUNTER: withAuthOps({ idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0; const r = o => new Response(JSON.stringify(o));
    if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return r({ value: vals.get(n) }); }
    return r({ allowed: true, value: cur });
  } }) }),
});
const L = await bootLive({ env, outbound: makeOutbound(), port: 9261 });
const { page } = L;
await page.evaluate(() => document.getElementById('cookie-consent-banner')?.remove());
await page.evaluate(async () => {
  openAuth('signup'); await __amvAuthOpen();
  const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  document.getElementById('a-use-pw')?.click();
  type('#a-name', 'Ines'); type('#a-email', 'ines@example.com'); type('#a-pass', 'A-real-Passw0rd-long!');
  document.getElementById('auth-submit').click(); await __amvSignedIn();
});
const openAccount = async () => {
  await page.evaluate(() => { setTab('settings'); S.settingsPane = 'account'; renderSetPane(); });
  await page.waitForSelector('#acct-push', { state: 'attached', timeout: 20000 });
  await page.waitForFunction(() => (document.getElementById('acct-push-msg')?.textContent || '').length > 0 || !document.getElementById('acct-push').disabled, null, { timeout: 20000 });
  return page.evaluate(() => ({ disabled: document.getElementById('acct-push').disabled, checked: document.getElementById('acct-push').checked, msg: document.getElementById('acct-push-msg').textContent }));
};

section('No keys on the deployment: off, and it says why');
{
  const s = await openAccount();
  ok(s.disabled && !s.checked && /not switched on for this AMV/.test(s.msg), 'the switch is off and cannot be turned on', s);
}

section('With keys: offered');
{
  Object.assign(env, KEYS);
  const s = await openAccount();
  ok(!s.disabled && !s.checked, 'the switch can be turned on', s);
}

section('The browser says no: it stays off, and says where to change that');
{
  await page.context().clearPermissions();
  await page.evaluate(() => { Notification.requestPermission = async () => 'denied'; });
  await page.click('label.sw:has(#acct-push)');
  await page.waitForFunction(() => /not given permission/.test(document.getElementById('acct-push-msg').textContent), null, { timeout: 15000 });
  ok(!(await page.isChecked('#acct-push')), 'off, with the reason');
}

section('A subscription the browser cannot make is reported, not shown as on');
{
  await page.evaluate(() => {
    Notification.requestPermission = async () => 'granted';
    PushManager.prototype.subscribe = async () => { throw new Error('push service not available'); };
  });
  await page.click('label.sw:has(#acct-push)');
  await page.waitForFunction(() => /Nothing changed/.test(document.getElementById('acct-push-msg').textContent), null, { timeout: 15000 });
  const s = await page.evaluate(() => ({ checked: document.getElementById('acct-push').checked, msg: document.getElementById('acct-push-msg').textContent }));
  ok(!s.checked && /push service not available/.test(s.msg), 'off again, and the browser’s own reason is shown', s);
  const stored = await env.AMV_KV.get('push:ines@example.com');
  ok(!stored || JSON.parse(stored).devices.length === 0, 'and nothing was stored on the server', stored);
}

section('No JavaScript errors');
ok(L.errors.length === 0, 'zero uncaught page errors', L.errors.slice(0, 3));

await L.close();
if (report('notify-this-device') > 0) process.exitCode = 1;
done();
