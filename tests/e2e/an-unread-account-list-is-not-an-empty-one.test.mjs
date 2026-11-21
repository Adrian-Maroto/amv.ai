/* AN UNREAD ACCOUNT LIST IS NOT AN EMPTY ONE (Build 16 audit D16-08, Nov 21).

   Settings → Connectors said "Nothing is connected yet." whenever it had no
   connected row to draw - while the list was still loading, and when it
   could not be read at all. Integrations hid the Connected accounts block
   when the server was not switched on to hold account keys, which looked
   exactly like having none. Each of those is now said as what it is, and
   the line follows the list as it loads. Empty and read stays as the owner
   asked: no block on Integrations, "Nothing is connected yet." in Settings. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;
await page.evaluate(() => {
  try { Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true }); } catch (e) {}
  window.__list = { hold: true };
  AMV_API.connectList = () => new Promise((res, rej) => { window.__answer = { res, rej }; if (!window.__list.hold) res(window.__list.value); });
});
const settings = () => page.evaluate(async () => {
  _connState = { state: 'idle', data: null, err: '' }; _connTried = '';
  S.settingsPane = 'integrations'; S.tab = 'settings'; setTab('settings');
  for (let i = 0; i < 100 && !document.getElementById('set-conn-none'); i++) await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, 100));
});
const line = () => page.evaluate(() => { const n = document.getElementById('set-conn-none'); return n ? n.textContent.replace(/\s+/g, ' ').trim() : null; });

section('Settings, while the list is loading');
{
  await settings();
  const t = await line();
  ok(/Checking what is connected/.test(t || '') && !/Nothing is connected/.test(t || ''), 'it says it is checking, not that nothing is connected', t);
}

section('Settings, when the list cannot be read');
{
  await page.evaluate(() => { const e = new Error('Server error'); window.__answer.rej(e); });
  await page.waitForTimeout(200);
  const t = await line();
  ok(/could not be loaded/.test(t || '') && /have not been disconnected/.test(t || '') && !/Nothing is connected/.test(t || ''), 'it says the list could not be read, and nothing was disconnected', t);
  ok(await page.evaluate(() => !!document.querySelector('#set-conn-none [data-dact="connReload"]')), 'with a way to try again');
}

section('Settings, when the list is read and empty');
{
  await page.evaluate(() => { window.__list = { hold: false, value: { configured: true, items: [] } }; connReload(); });
  await page.waitForTimeout(300);
  const t = await line();
  ok(/^Nothing is connected yet\./.test(t || '') && /when a job needs one/.test(t || ''), 'now, and only now, it says nothing is connected', t);
}

section('Integrations, when the server is not switched on to hold account keys');
{
  const r = await page.evaluate(async () => {
    window.__list = { hold: false, value: { configured: false, items: [] } };
    _connState = { state: 'idle', data: null, err: '' }; _connTried = '';
    setTab('chat'); setTab('integrations');
    await new Promise(r => setTimeout(r, 400));
    const sec = document.getElementById('conn-sec');
    return { shown: sec && !sec.hidden, text: sec ? sec.textContent.replace(/\s+/g, ' ') : '' };
  });
  ok(r.shown && /Not switched on yet/.test(r.text), 'the block is shown and says so - not hidden as if empty', r);
}

section('Integrations, read and empty: as the owner asked, no block');
{
  const r = await page.evaluate(async () => {
    window.__list = { hold: false, value: { configured: true, items: [] } };
    connReload(); await new Promise(r => setTimeout(r, 300));
    return !document.getElementById('conn-sec').hidden;
  });
  ok(r === false, 'hidden, with each app\'s Connect on its own row below', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
