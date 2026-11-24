/* THE BELL SAYS WHAT HAPPENED (owner, Nov 24: "a bell in the top left ...
   anything that happened ... you're all caught up, unread, mark all as read").

   Every row comes from something real - a Crew result the server stored, work
   somebody handed over, an approval a job is holding for, a security event on
   the account - and the bell's number is the count of those still unread.
   Held, through the real top bar:
     · signed out there is no bell; signed in there is, with the right number;
     · the list shows each kind, the one that stops work first;
     · "Mark all as read" tells the server about Crew results and clears the rest;
     · only then does it say "You're all caught up" - and a source that could
       not be read is said, never shown as nothing new;
     · Escape closes it and gives focus back to the bell. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: 'https://backend.example.workers.dev', user: null, viewport: { width: 1280, height: 900 } });
const { page, errors } = app;
await page.waitForTimeout(500);

section('Signed out, there is no bell');
ok(await page.evaluate(() => { const b = document.getElementById('notif-btn'); return !!b && b.hidden; }), 'the bell is hidden');

const setup = async (failActivity) => page.evaluate(async (failActivity) => {
  S.user = { name: 'A', email: 'a@x.com', ini: 'A' };
  try { Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true }); } catch (e) {}
  try { Object.defineProperty(AMV_API, 'hasSession', { configurable: true, get: () => true }); } catch (e) {}
  const now = Date.now();
  saveStr('amv_notif_seen', String(now - 3600e3)); store('amv_notif_seen_ids', []);
  _AUTO_LOADED = true;
  /* The server's side of Crew results: a list, and a read flag it keeps. */
  window.__results = [{ id: 'r1', at: now - 60e3, read: false, detail: 'Three emails need you today: the landlord, the dentist and the bank.' },
                      { id: 'r0', at: now - 86400e3, read: true, detail: 'Inbox clear.' }];
  _AUTO_RESULTS = window.__results.map(r => ({ ...r }));
  window.__readCalls = 0;
  _autoApi = async (path) => {
    if (path === '/auto/read') { window.__readCalls++; window.__results.forEach(r => r.read = true); return { ok: true }; }
    if (path === '/auto/list') return { ok: true, items: [], results: window.__results.map(r => ({ ...r })) };
    return { ok: true };
  };
  AMV_API.listHandoff = async () => ({ ok: true, incoming: [{ id: 'h1', from_email: 'sam@x.com', title: 'Q3 budget chat', status: 'pending', at: now - 120e3 }], sent: [] });
  AMV_API.activity = failActivity ? async () => { throw new Error('offline'); }
    : async () => ({ ok: true, events: [{ kind: 'password_changed', at: now - 300e3 }, { kind: 'signed_in', at: now - 400e3 }] });
  store('amv_cw_approvals', [{ id: 'ap1', title: 'Send the rent reminder to Sam' }]);
  await _notifView();
  await window._notifRefresh();
  updateSbUser();
}, failActivity);

section('Signed in, the bell counts what is unread');
await setup(false);
await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
const b1 = await page.evaluate(() => { const b = document.getElementById('notif-btn'), n = b.querySelector('.notif-n');
  const r = b.getBoundingClientRect(); return { hidden: b.hidden, n: n.hidden ? '' : n.textContent, label: b.getAttribute('aria-label'), left: r.left }; });
ok(!b1.hidden, 'the bell is shown', b1);
ok(b1.left < 400, 'in the top left', b1.left);
ok(b1.n === '4', 'it counts the Crew result, the handoff, the approval and the security event', b1);
ok(/4 unread/.test(b1.label), 'and a screen reader hears the number', b1.label);

section('The list shows each kind, waiting-on-you first');
await page.click('#notif-btn');
await page.waitForSelector('.ntf-row');
await page.waitForTimeout(200);
const l1 = await page.evaluate(() => [...document.querySelectorAll('.ntf-row')].map(r => ({ t: r.querySelector('.ntf-t').textContent, unread: r.classList.contains('unread') })));
ok(l1.length === 5, 'five rows: four unread and one Crew result already read', l1);
ok(/waiting for your OK/.test(l1[0].t), 'the approval is first', l1[0]);
ok(l1.some(r => /Crew finished/.test(r.t) && r.unread) && l1.some(r => /sam@x\.com handed you work/.test(r.t)) && l1.some(r => /Password changed/.test(r.t)), 'each kind is there', l1);
ok(!l1.some(r => /^Signed in/.test(r.t)), 'an ordinary sign-in is not a notification', l1);
ok(!(await page.evaluate(() => !!document.querySelector('.ntf-caught'))), 'and it does not claim to be caught up');

section('Mark all as read');
await page.click('#ntf-all');
await page.waitForTimeout(200);
const m = await page.evaluate(() => ({ calls: window.__readCalls, caught: (document.querySelector('.ntf-caught') || {}).textContent || '',
  unread: document.querySelectorAll('.ntf-row.unread').length, n: document.querySelector('#notif-btn .notif-n').hidden,
  disabled: document.getElementById('ntf-all').disabled }));
ok(m.calls === 1, 'the server is told the Crew results are read', m.calls);
ok(m.unread === 0 && m.n, 'nothing is unread and the number is gone', m);
ok(/all caught up/.test(m.caught), 'and now it says "You’re all caught up"', m.caught);
ok(m.disabled, 'the button has nothing left to do', m.disabled);

section('Escape closes it and gives focus back');
await page.keyboard.press('Escape');
const e1 = await page.evaluate(() => ({ open: !!document.getElementById('ntf-panel'), focus: document.activeElement && document.activeElement.id,
  exp: document.getElementById('notif-btn').getAttribute('aria-expanded') }));
ok(!e1.open && e1.focus === 'notif-btn' && e1.exp === 'false', 'closed, focus on the bell', e1);

section('A source that could not be read is said, not hidden');
await setup(true);
/* Everything that could be read is read, so the gap is the only thing left. */
await page.evaluate(() => { saveStr('amv_notif_seen', String(Date.now())); store('amv_notif_seen_ids', ['ap1']);
  window.__results.forEach(r => r.read = true); _AUTO_RESULTS.forEach(r => r.read = true); });
await page.click('#notif-btn');
await page.waitForSelector('.ntf-warn');
const f = await page.evaluate(() => ({ warn: document.querySelector('.ntf-warn').textContent, caught: !!document.querySelector('.ntf-caught') }));
ok(/Could not check: Security/.test(f.warn), 'it names what it could not check', f.warn);
ok(!f.caught, 'and never says "all caught up" over a gap', f);
await page.keyboard.press('Escape');

section('On a phone the list fits the screen');
await page.setViewportSize({ width: 390, height: 844 });
await page.click('#notif-btn');
await page.waitForSelector('.ntf-panel');
const ph = await page.evaluate(() => { const r = document.querySelector('.ntf-panel').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
ok(ph.l >= 0 && ph.r <= ph.w, 'inside the screen', ph);
await page.keyboard.press('Escape');

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors);

report();
await app.close();
done();
