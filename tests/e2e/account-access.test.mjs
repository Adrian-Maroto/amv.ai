/* WHO CAN REACH YOUR ACCOUNT, AND TAKING IT BACK.

   `linkList` and `linkRevoke` were complete, careful server endpoints - revoke
   deactivates the link on BOTH sides and checks that the caller is one of them -
   and no client code had ever called either.

   The screen was worse than absent. It read the LOCAL store, so a second device
   showed nobody at all; and "Remove" wrote active:false into localStorage and
   told the server nothing, while the server is the thing that authorises a
   linked account. So the one control that exists to cut somebody off said
   "that access stopped immediately" and stopped nothing.

   A security control that reports success and does nothing is worse than one
   that is missing, because the missing one does not talk you out of checking. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { overflowingElement } from '../lib/layout.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'U', email: 'u@x.com', ini: 'U' } });
const { page, errors } = app;

const openPane = (serve) => page.evaluate(async (serveSrc) => {
  window.__calls = [];
  saveStr('amv_api_base', 'https://x.test'); saveStr('amv_api_token', 't');
  window.AMV_API.live = true; window.AMV_API.token = 't';
  window.AMV_API._fetch = async (path, init) => {
    window.__calls.push({ path, body: init && init.body });
    const fn = eval('(' + serveSrc + ')');
    return { json: async () => fn(path) };
  };
  _LINK_STATE = null; _FAM_STATE = null;
  S.settingsPane = 'family'; S.tab = 'settings'; setTab('settings');
  await new Promise(r => setTimeout(r, 400));
  return document.getElementById('vc').textContent;
}, serve);

const SERVE_TWO = `function(path){
  if(/link\\/list/.test(path)) return { ok:true,
    iCanAccess:[{ id:'L1', account:'boss@x.com', scopes:['calendar'] }],
    canAccessMe:[{ id:'L2', account:'helper@x.com', scopes:['email','calendar'] }] };
  if(/family\\/get/.test(path)) return { ok:true, parentOf:null, childOf:null };
  return { ok:true };
}`;

section('The list comes from the server, not from this browser');
{
  const t = await openPane(SERVE_TWO);
  const calls = await page.evaluate(() => window.__calls.map(c => c.path));
  ok(calls.some(p => /\/v1\/link\/list/.test(p)), 'the server is asked who has access', calls);
  ok(/helper@x\.com/.test(t), 'somebody who can act on your account is shown', /helper/.test(t));
  ok(/boss@x\.com/.test(t), 'and an account you can act on', /boss/.test(t));
}

section('Removing access tells the server, and only then says so');
{
  const r = await page.evaluate(async () => {
    window.confirmModal = (a, b, go) => go();
    window.__calls = [];
    window.AMV_API._fetch = async (path, init) => {
      window.__calls.push({ path, body: init && init.body });
      if (/link\/revoke/.test(path)) return { json: async () => ({ ok: true, revoked: true }) };
      if (/link\/list/.test(path)) return { json: async () => ({ ok: true, iCanAccess: [], canAccessMe: [] }) };
      return { json: async () => ({ ok: true, parentOf: null, childOf: null }) };
    };
    document.querySelector('.mf-revoke[data-link="L2"]').click();
    await new Promise(r => setTimeout(r, 500));
    return { calls: window.__calls, say: (document.getElementById('mf-links-say') || {}).textContent || '',
             text: document.getElementById('vc').textContent };
  });
  const rev = r.calls.find(c => /\/v1\/link\/revoke/.test(c.path));
  ok(!!rev, 'the server is told to revoke', r.calls.map(c => c.path));
  ok(/"id":"L2"/.test(rev.body), 'naming the link that was actually clicked', rev.body);
  ok(/stopped immediately/.test(r.say), 'and it says access stopped', r.say);
  ok(!/helper@x\.com/.test(r.text), 'with the person gone from the list', /helper/.test(r.text));
}

section('A revoke the server refuses does NOT claim access stopped');
{
  /* The whole point. Telling somebody they are safe when they are not is the
     one outcome this screen must never produce. */
  const r = await page.evaluate(async () => {
    _LINK_STATE = null;
    window.confirmModal = (a, b, go) => go();
    window.AMV_API._fetch = async (path) => {
      if (/link\/revoke/.test(path)) return { json: async () => ({ error: 'engine down' }) };
      if (/link\/list/.test(path)) return { json: async () => ({ ok: true, iCanAccess: [],
        canAccessMe: [{ id: 'L9', account: 'helper@x.com', scopes: ['email'] }] }) };
      return { json: async () => ({ ok: true, parentOf: null, childOf: null }) };
    };
    _renderFamilyPane(document.getElementById('set-pane') || document.getElementById('vc'));
    await new Promise(r => setTimeout(r, 400));
    document.querySelector('.mf-revoke[data-link="L9"]').click();
    await new Promise(r => setTimeout(r, 400));
    return { say: (document.getElementById('mf-links-say') || {}).textContent || '',
             text: document.getElementById('vc').textContent };
  });
  ok(!/stopped immediately/.test(r.say), 'it does not say access stopped', r.say);
  ok(/can still act/.test(r.say), 'it says the account can still act', r.say);
  ok(/helper@x\.com/.test(r.text), 'and they are still listed, because they still have access', /helper/.test(r.text));
}

section('A list that could not load does not reassure you');
{
  /* "Nobody else can touch your account" off the back of a failed request is
     the same lie as a half-loaded marketplace priced as though complete. */
  const t = await page.evaluate(async () => {
    _LINK_STATE = null; _FAM_STATE = null;
    window.AMV_API._fetch = async (path) => {
      if (/link\/list/.test(path)) return { json: async () => ({ error: 'offline' }) };
      return { json: async () => ({ ok: true, parentOf: null, childOf: null }) };
    };
    _renderFamilyPane(document.getElementById('set-pane') || document.getElementById('vc'));
    await new Promise(r => setTimeout(r, 400));
    return document.getElementById('vc').textContent;
  });
  ok(!/Nobody else can touch your account/.test(t),
     'it does not claim nobody has access', /Nobody else/.test(t));
  ok(/not complete/.test(t), 'it says the list could not be checked', /not complete/.test(t));
}

section('Asking again does not fetch forever');
{
  /* Both fetches set their state on the failure path too. Without that, every
     redraw refetches and each refetch redraws. */
  const n = await page.evaluate(async () => {
    let count = 0;
    window.AMV_API._fetch = async (path) => {
      if (/link\/list/.test(path)) { count++; return { json: async () => ({ error: 'offline' }) }; }
      return { json: async () => ({ ok: true, parentOf: null, childOf: null }) };
    };
    _LINK_STATE = null;
    _renderFamilyPane(document.getElementById('set-pane') || document.getElementById('vc'));
    await new Promise(r => setTimeout(r, 300));
    _renderFamilyPane(document.getElementById('set-pane') || document.getElementById('vc'));
    await new Promise(r => setTimeout(r, 300));
    return count;
  });
  ok(n === 1, 'the failed list is asked for once, not on every redraw', n);
}

section('An invite claims delivery only once the server confirms it');
{
  /* This used to fire the request with a swallowed catch and announce "a
     confirmation code was sent" immediately. The server can answer that email
     is not configured at all, so the person waited for a message that was never
     coming and the link could never be approved. */
  const r = await page.evaluate(async () => {
    window.AMV_API.live = true; window.AMV_API.token = 't'; window.AMV_API.base = 'https://x.test';
    window.fetch = async () => ({ ok: false, json: async () => ({ code: 'needs_service', error: 'no email' }) });
    const res = AMVFamily.invite('them@x.com', ['calendar_view'], {});
    const during = res.delivery;
    const after = await res.delivery.settled;
    return { during: { sent: during.sent, how: during.how }, after };
  });
  ok(r.during.sent === null, 'nothing is claimed while the request is in flight', r.during);
  ok(/Sending/.test(r.during.how), 'it says it is sending, not that it sent', r.during.how);
  ok(r.after.sent === false, 'and the answer is that it was not sent', r.after);
  ok(/not switched on/.test(r.after.how), 'naming why, so the wait is not silent', r.after.how);
}

section('A delivered invite says so, once');
{
  const r = await page.evaluate(async () => {
    window.fetch = async () => ({ ok: true, json: async () => ({ ok: true, delivered: true, message: 'A confirmation code was emailed to them@x.com.' }) });
    const res = AMVFamily.invite('them2@x.com', ['calendar_view'], {});
    return await res.delivery.settled;
  });
  ok(r.sent === true, 'a real delivery reports success', r);
  ok(/emailed to/.test(r.how), 'in the server\'s own words', r.how);
}

section('A send that fails is not dressed up as a send');
{
  const r = await page.evaluate(async () => {
    window.fetch = async () => ({ ok: true, json: async () => ({ ok: true, delivered: false, message: 'Could not deliver the code right now - try again shortly.' }) });
    const res = AMVFamily.invite('them3@x.com', ['calendar_view'], {});
    return await res.delivery.settled;
  });
  ok(r.sent === false, 'delivered:false is a failure', r);
  ok(/Could not deliver/.test(r.how), 'and says so', r.how);
}

section('It fits on a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => _renderFamilyPane(document.getElementById('set-pane') || document.getElementById('vc')));
  await page.waitForTimeout(200);
  const bad = await overflowingElement(page);
  ok(!bad, 'nothing pushes the page sideways at 390px', bad);
  await page.setViewportSize({ width: 1280, height: 900 });
}

ok(errors.length === 0, 'no console errors along the way', errors.slice(0, 3));

await app.close();
if (report('account-access') > 0) process.exitCode = 1;
done();
