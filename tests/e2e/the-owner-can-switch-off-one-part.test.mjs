/* THE OWNER CAN SWITCH OFF ONE PART, FROM THE CONSOLE.

   Scale audit #70. The server side is one-part-of-amv-can-be-switched-off;
   this is the surface the owner actually uses, through the real page and
   the real Worker: the Founder Dashboard lists every feature with a switch,
   switching one off asks first, the screen changes only after the server's
   answer says it happened, the record says why and since when, and turning it
   back on works. A refused token changes nothing and says so. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const env = makeEnv({ ADMIN_TOKEN: 'the-admin-secret-0123456789', OWNER_EMAIL: 'owner@example.com' });
const L = await bootLive({ env, outbound: makeOutbound() });
const { page } = L;
/* Signed in for real, as the deployment's owner - the console is owner-only,
   and the server's session is what says who the owner is. */
await page.evaluate(async () => {
  document.getElementById('cookie-consent-banner')?.remove();
  openAuth('signup'); await __amvAuthOpen();
  const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  type('#a-name', 'Owner'); type('#a-email', 'owner@example.com'); type('#a-pass', 'A-real-Passw0rd!');
  document.getElementById('auth-submit').click(); await __amvSignedIn();
});
const openDash = async (tok) => {
  await page.evaluate(() => goSettings('dashboard'));
  await page.waitForSelector('#fd-token', { timeout: 20000 });
  await page.fill('#fd-token', tok);
  await page.click('#fd-load');
};
const switches = async () => JSON.parse((await env.AMV_KV.get('switches')) || '{}');

section('The console lists every feature, each with a switch');
{
  await openDash('the-admin-secret-0123456789');
  await page.waitForSelector('#fd-switches [data-fd-sw="feature:library"]', { timeout: 20000 });
  const n = await page.evaluate(() => document.querySelectorAll('#fd-switches [data-fd-sw^="feature:"]').length);
  ok(n >= 10, 'every feature has its own switch', n);
}

section('Switching one off asks first, and the screen follows the server');
{
  await page.fill('#fd-sw-why', 'storage incident');
  await page.click('#fd-switches [data-fd-sw="feature:library"]');
  await page.waitForSelector('#modal-ok', { timeout: 10000 });
  ok(/Switch off feature:library/.test(await page.textContent('body')), 'it asks, naming the switch');
  await page.click('#modal-ok');
  await page.waitForFunction(() => document.querySelector('#fd-switches [data-fd-sw="feature:library"]')?.textContent === 'Turn back on', null, { timeout: 15000 });
  const rec = (await switches())['feature:library'];
  ok(rec && rec.off === true && rec.why === 'storage incident', 'the server holds it, with why', rec);
  ok(/Off since .* - storage incident/.test(await page.textContent('#fd-switches')), 'and the console says since when and why');
}

section('Turning it back on');
{
  await page.click('#fd-switches [data-fd-sw="feature:library"]');
  await page.waitForFunction(() => document.querySelector('#fd-switches [data-fd-sw="feature:library"]')?.textContent === 'Switch off', null, { timeout: 15000 });
  ok(!(await switches())['feature:library'], 'it is gone from the record');
}

section('An engine by name, from the box');
{
  await page.fill('#fd-sw-name', 'model:amv-core');
  await page.click('#fd-switches [data-fd-sw-new]');
  await page.waitForSelector('#modal-ok', { timeout: 10000 });
  await page.click('#modal-ok');
  await page.waitForFunction(() => !!document.querySelector('#fd-switches [data-fd-sw="model:amv-core"]'), null, { timeout: 15000 });
  ok((await switches())['model:amv-core']?.off === true, 'switched off on the server, and listed');
}

section('A refused token changes nothing, and says so');
{
  const before = JSON.stringify(await switches());
  await page.evaluate(() => { const b = document.querySelector('#fd-switches [data-fd-sw="feature:widget"]'); window.__swBtn = !!b; });
  await page.evaluate(() => { _setAdminToken('wrong-token'); });
  /* The card holds the token it was drawn with; redraw it with the wrong one. */
  await page.evaluate(() => _fdSwitches(apiBase(), 'wrong-token'));
  await page.waitForFunction(() => /Invalid admin token/.test(document.querySelector('#fd-switches')?.textContent || ''), null, { timeout: 15000 });
  ok(JSON.stringify(await switches()) === before, 'nothing changed on the server');
}

section('It fits a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await openDash('the-admin-secret-0123456789');
  await page.waitForSelector('#fd-switches [data-fd-sw="feature:library"]', { timeout: 20000 });
  const fit = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
  ok(fit.sw <= fit.vw + 1, 'nothing runs off the side at 390 pixels', fit);
}

ok(L.errors.length === 0, 'no page errors', L.errors.slice(0, 3));
await L.close();
if (report('the-owner-can-switch-off-one-part') > 0) process.exitCode = 1;
done();
