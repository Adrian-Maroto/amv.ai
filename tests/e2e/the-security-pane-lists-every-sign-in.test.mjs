/* THE SECURITY PANE LISTS EVERY SIGN-IN, AND ENDS ONE.

   The server side is tests/worker/where-you-are-signed-in. This is the screen:
   the list drawn from the server's answer, this device marked and not
   endable, Sign out on the others sending the right id, and a list the server
   could not read shown as exactly that - never as "only this device". */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Kim', email: 'kim@example.com', ini: 'K' } });
const { page, errors } = app;

const SESS = { ok: true, current: '11111111-1111-4111-8111-111111111111', sessions: [
  { id: '22222222-2222-4222-8222-222222222222', device: 'Chrome on Android', country: 'PT', created: Date.now() - 5 * 864e5, seen: Date.now() - 3 * 3600e3, current: false },
  { id: '11111111-1111-4111-8111-111111111111', device: 'Safari on Mac', country: 'ES', created: Date.now() - 864e5, seen: Date.now(), current: true },
] };

await page.evaluate((sess) => {
  localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
  document.getElementById('cookie-consent-banner')?.remove();
  /* A connected, signed-in session; the network itself is replaced below. */
  Object.defineProperty(AMV_API, 'live', { get: () => true, configurable: true });
  Object.defineProperty(AMV_API, 'hasSession', { get: () => true, configurable: true });
  try { AMV_API.token = 't'; } catch (e) {}
  window.__ended = [];
  window.__sess = sess;
  AMV_API.sessions = async () => window.__sess;
  AMV_API.endSession = async (id) => { window.__ended.push(id); window.__sess = { ...window.__sess, sessions: window.__sess.sessions.filter(s => s.id !== id) }; return { ok: true }; };
}, SESS);
const openSecurity = async () => {
  await page.evaluate(() => goSettings('account'));
  await page.waitForSelector('#sess-list');
  await page.waitForFunction(() => !/Loading/.test(document.getElementById('sess-list').textContent));
};

section('Every sign-in is listed; this one is marked and has no Sign out');
{
  await openSecurity();
  const rows = await page.evaluate(() => [...document.querySelectorAll('#sess-list .sess-row')].map(r => ({ text: r.textContent, end: !!r.querySelector('[data-sess-end]'), current: r.classList.contains('sess-current') })));
  ok(rows.length === 2, 'both sign-ins appear', rows);
  ok(/Chrome on Android/.test(rows[0].text) && /Portugal/.test(rows[0].text) && /h ago/.test(rows[0].text) && rows[0].end, 'the phone, with where and when, and a Sign out', rows[0]);
  ok(/Safari on Mac/.test(rows[1].text) && /This device/.test(rows[1].text) && !rows[1].end && rows[1].current, 'this laptop, marked, without one', rows[1]);
  ok(!/cannot list your other devices/i.test(await page.evaluate(() => document.body.innerText)), 'the old "cannot list" line is gone, because it can');
}

section('Sign out ends that one, and the list follows');
{
  await page.click('[data-sess-end="22222222-2222-4222-8222-222222222222"]');
  await page.waitForFunction(() => document.querySelectorAll('#sess-list .sess-row').length === 1);
  const r = await page.evaluate(() => ({ ended: window.__ended, msg: document.getElementById('sess-msg').textContent }));
  ok(r.ended.length === 1 && r.ended[0] === '22222222-2222-4222-8222-222222222222', 'the server is asked to end exactly that one', r.ended);
  ok(/Signed out Chrome on Android/.test(r.msg) && /within a minute/.test(r.msg), 'and the person is told, with when it takes effect', r.msg);
}

section('A list the server could not read says so, and can be retried');
{
  await page.evaluate(() => { AMV_API.sessions = async () => null; });
  await openSecurity();
  const t = await page.evaluate(() => document.getElementById('sess-list').textContent);
  ok(/could not read your sign-ins/.test(t), 'it says it could not read them', t);
  ok(await page.evaluate(() => !!document.getElementById('sess-retry') && !document.querySelector('#sess-list .sess-row')), 'and offers Try again, with no rows invented');
  await page.evaluate((sess) => { AMV_API.sessions = async () => sess; }, SESS);
  await page.click('#sess-retry');
  await page.waitForFunction(() => document.querySelectorAll('#sess-list .sess-row').length === 2);
  ok(true, 'Try again loads the list');
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('the-security-pane-lists-every-sign-in') > 0) process.exitCode = 1;
done();
