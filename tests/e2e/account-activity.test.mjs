/* THE SECURITY SCREEN - it used to be a picture of one.

   The Sessions block was a single hardcoded row, "This browser - Active now",
   with a green Active badge and no data behind it. It looked identical whether
   the account was healthy or had been signed into from three countries. These
   assertions are mostly about that: every line on the screen has to come from
   the server, an empty log has to look empty, and a failed load has to say so
   rather than showing a reassuring blank. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { overflowingElement } from '../lib/layout.mjs';

const app = await bootApp({ tab: 'settings', user: { name: 'Alice', email: 'alice@x.com', ini: 'A' } });
const { page, errors } = app;

const openSecurity = () => page.evaluate(() => { S.settingsPane = 'security'; renderSetPane(); });
const serve = events => page.evaluate(evs => {
  AMV_API.base = 'https://api.test';
  AMV_API.token = 'test-token';
  AMV_API.activity = async () => ({ ok: true, events: evs, kept: 100, retentionDays: 400 });
}, events);
const paneText = () => page.evaluate(() => document.querySelector('.set-pane').textContent);

const now = Date.now();
const LOG = [
  { at: now - 120000, kind: 'signed_in', dev: 'Chrome on Mac', country: 'GB' },
  { at: now - 3600000, kind: 'plan_changed', plan: 'pro' },
  { at: now - 7200000, kind: 'sign_in_failed', dev: 'Firefox on Windows', country: 'RU', reason: 'wrong password' },
  { at: now - 7300000, kind: 'sign_in_failed', dev: 'Firefox on Windows', country: 'RU', reason: 'wrong password' },
  { at: now - 7400000, kind: 'sign_in_failed', dev: 'Firefox on Windows', country: 'RU', reason: 'wrong password' },
  { at: now - 86400000 * 2, kind: 'password_changed', dev: 'Chrome on Mac', country: 'GB' },
  { at: now - 86400000 * 3, kind: 'account_created', dev: 'Chrome on Mac', country: 'GB' },
];

section('The screen shows the real log, not a hardcoded row');
{
  await serve(LOG);
  await openSecurity();
  await page.waitForSelector('.act-row', { timeout: 4000 });
  const v = await page.evaluate(() => ({
    rows: document.querySelectorAll('.act-row').length,
    txt: document.querySelector('.set-pane').textContent,
    warn: document.querySelectorAll('.act-row.warn').length,
  }));
  ok(v.rows === 7, 'every event is listed', v.rows);
  ok(/Signed in/.test(v.txt), 'sign-ins are named in plain language');
  ok(/Plan changed to pro/.test(v.txt), 'a plan change says which plan');
  ok(/Chrome on Mac/.test(v.txt), 'with the browser family that a person would recognise');
  ok(/GB/.test(v.txt) && /RU/.test(v.txt), 'and the country, which is the signal that something is wrong');
  ok(v.warn === 4, 'the entries worth a second look are marked - the failures and the password change', v.warn);
  ok(!/Active now/.test(v.txt), 'the old hardcoded "Active now" row is gone');
}

section('A run of failed sign-ins is called out, not just listed');
{
  const txt = await paneText();
  ok(/3 failed sign-in attempts/.test(txt), 'the count is stated up front', txt.match(/\d+ failed[^.]*/)?.[0]);
  ok(/change your password/i.test(txt), 'together with what to do about it');
}

section('Signing out of this device says it leaves the others alone');
{
  const txt = await paneText();
  ok(/Sign out of this device/.test(txt), 'the per-device sign-out is still there');
  ok(/other devices signed in/i.test(txt), 'and now states its real scope, which it did not honour before');
  ok(/Sign out of all devices/.test(txt), 'and the everywhere button exists for when it is needed');
}

section('Signing out everywhere is confirmed, and honest about failing');
{
  await page.evaluate(() => {
    window.__signedOut = false;
    window.__logoutArg = null;
    AMV_API.logout = async (everywhere) => { window.__logoutArg = everywhere; return false; };
    window.signOut = () => { window.__signedOut = true; };
    window.confirmModal = (t, b, go) => { window.__confirmBody = b; go(); };
  });
  await page.evaluate(() => document.getElementById('act-signout-all').click());
  await page.waitForFunction(() => /Could not reach/.test(document.getElementById('act-say').textContent), { timeout: 4000 });
  const v = await page.evaluate(() => ({
    said: document.getElementById('act-say').textContent,
    out: window.__signedOut, arg: window.__logoutArg, body: window.__confirmBody,
  }));
  ok(/including this one/i.test(v.body), 'the confirmation says this device goes too', v.body.slice(0, 70));
  ok(v.arg === true, 'the request really asks for every device');
  ok(/nothing was signed out/i.test(v.said), 'a failure is reported as a failure', v.said);
  ok(v.out === false, 'and the app does NOT pretend it worked by signing out locally');
}

section('A successful sign-out everywhere actually signs out');
{
  await page.evaluate(() => { AMV_API.logout = async () => true; });
  await page.evaluate(() => document.getElementById('act-signout-all').click());
  await page.waitForFunction(() => window.__signedOut === true, { timeout: 4000 });
  ok(await page.evaluate(() => window.__signedOut), 'the local session ends too');
}

section('The log can be taken away as a file');
{
  await serve(LOG);
  await openSecurity();
  await page.waitForSelector('#act-export', { timeout: 4000 });
  const dl = await page.evaluate(async () => {
    let captured = null;
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function(){ captured = { name: this.download, href: this.href }; };
    document.getElementById('act-export').click();
    await new Promise(r => setTimeout(r, 100));
    HTMLAnchorElement.prototype.click = realClick;
    return { captured, said: document.getElementById('act-say').textContent };
  });
  ok(dl.captured && /\.json$/.test(dl.captured.name), 'a JSON file is produced', dl.captured && dl.captured.name);
  ok(dl.captured && dl.captured.href.startsWith('blob:'), 'built locally from what is on screen, so the two cannot disagree');
  ok(/Downloaded/.test(dl.said), 'and the user is told it happened');
}

section('An empty history looks empty, and a broken one says so');
{
  await serve([]);
  await openSecurity();
  await page.waitForFunction(() => /Nothing recorded yet/.test(document.querySelector('.set-pane').textContent), { timeout: 4000 });
  const empty = await paneText();
  ok(/Nothing recorded yet/.test(empty), 'the empty state is stated');
  ok(!/Active now/.test(empty), 'and nothing is invented to fill the space');

  await page.evaluate(() => { AMV_API.activity = async () => { throw new Error('offline'); }; });
  await openSecurity();
  await page.waitForFunction(() => /out of date|unavailable/i.test(document.querySelector('.set-pane').textContent), { timeout: 4000 });
  const broken = await paneText();
  ok(/out of date|unavailable/i.test(broken), 'a failed load is reported rather than shown as a clean record');

  await page.evaluate(() => { AMV_API.base = ''; });
  await openSecurity();
  const off = await paneText();
  ok(/Sign in to your AMV account/.test(off), 'and with no server it explains why, instead of showing nothing');
}

section('It states what is recorded, and what is not');
{
  await serve(LOG);
  await openSecurity();
  await page.waitForSelector('.act-fine', { timeout: 4000 });
  const fine = await page.evaluate(() => document.querySelector('.act-fine').textContent);
  ok(/never your IP/i.test(fine), 'the page says the IP address is not kept', fine);
  ok(/last 100 events/.test(fine) && /400 days/.test(fine), 'and how much is kept, for how long');
}

section('It works on a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await openSecurity();
  await page.waitForSelector('.act-row', { timeout: 4000 });
  const m = await page.evaluate(() => ({
        btn: document.getElementById('act-signout-all').getBoundingClientRect().width,
    live: document.getElementById('act-say').getAttribute('aria-live'),
    alert: document.querySelector('.act-alert')?.getAttribute('role'),
  }));
  ok((await overflowingElement(page)) === null, 'nothing overflows the screen', await overflowingElement(page));
  ok(m.btn > 200, 'the sign-out button is a full-width target, not a tap-sized sliver', Math.round(m.btn));
  ok(m.live === 'polite', 'results are announced to screen readers');
  ok(m.alert === 'alert', 'and the failed-sign-in warning is announced as one');
  await page.setViewportSize({ width: 1280, height: 900 });
}

ok(errors.length === 0, 'no console errors on the security screen', errors.slice(0, 3));
report('account-activity-ui');
done();
