/* BILLING OPENS IN ITS FINAL SHAPE (owner, Nov 24: "when I click on it it
   shows something and then quickly changes it to something else ... I have
   to go straight to billing").

   Measured with the server answering the way it does live - a beat later
   than the first paint. The Refund section used to arrive last and land
   between the plan and Usage, shoving Usage 170px down a third of a second
   after the page appeared; the usage meters opened empty and grew. Held:
     · from the first frame to the last, the Usage card does not move;
     · the Refund section sits in the Payment card, after Usage;
     · the meters paint from the answer the tab already holds;
     · and the plan has room under the "Billing" title. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: 'https://backend.example.workers.dev', viewport: { width: 1280, height: 900 },
                            user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;
await page.waitForTimeout(600);

const r = await page.evaluate(async () => {
  saveStr('amv_plan', 'pro');
  try { Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true }); } catch (e) {}
  try { Object.defineProperty(AMV_API, 'hasSession', { configurable: true, get: () => true }); } catch (e) {}
  const slow = (v, ms) => new Promise(res => setTimeout(() => res(v), ms));
  const U = { plan: 'pro', day: { used: 1000, limit: 200000, resetAt: Date.now() + 3e6 }, month: { used: 50000, limit: 2300000, resetAt: Date.now() + 9e8 },
    window5h: { used: 3, limit: 1000, resetAt: Date.now() + 1e6 }, topEngineWeek: { used: 1, limit: 100, resetAt: Date.now() + 5e8 }, messages: { used: 40 } };
  AMV_API.usage = () => slow(U, 220);
  AMV_API.refundState = () => slow({ ok: true, auto: false, why: ['over_14_days'], charge: { amount: 15, currency: 'USD', paidAt: Date.now() - 20 * 864e5 },
    daysLeft: 0, usedPercent: 4, refunded: false, request: null, answered: null }, 300);
  const of = AMV_API._fetch.bind(AMV_API);
  AMV_API._fetch = (p, o) => /credit/.test(p) ? slow(new Response(JSON.stringify({ ok: true, balance: 3, mode: 'auto' })), 250) : of(p, o);
  /* The tab has read usage before (the sidebar does, on every load). */
  _srvUsage = U; _srvUsageAt = Date.now(); _srvUsageWho = S.user.email;
  await _usageLoad();
  const tops = [];
  const top = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().top) : null; };
  S.settingsPane = 'billing'; setTab('settings');
  let firstMeters = null;
  for (let i = 0; i < 24; i++) {
    tops.push(top('#set-sec-usage'));
    if (firstMeters === null) firstMeters = !!document.querySelector('#srv-usage .srv-row');
    await new Promise(res => setTimeout(res, 25));
  }
  const rf = document.getElementById('bill-refund');
  const order = (a, b) => { const x = document.querySelector(a), y = document.querySelector(b); return !!(x && y && (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING)); };
  const h = document.querySelector('.vi-bill .bill-h'), n = document.querySelector('.vi-bill .bill-sum-n');
  return { tops, firstMeters, refundShown: !!rf && !rf.hidden, refundInPayment: !!(rf && rf.closest('.bill-pm')),
    usageBeforeRefund: order('#set-sec-usage', '#bill-refund'),
    gap: h && n ? Math.round(n.getBoundingClientRect().top - h.getBoundingClientRect().bottom) : -1 };
});

section('Nothing you are reading moves after the page appears');
{
  const seen = [...new Set(r.tops.filter(t => t !== null))];
  ok(seen.length === 1, 'the Usage card is in the same place in every frame of the first 600ms', r.tops);
  ok(r.firstMeters, 'and its meters are there in the first frame, from the answer the tab already had', r.firstMeters);
}

section('Refunds belong with payment, below what you came to read');
{
  ok(r.refundShown, 'the Refund section still appears', r.refundShown);
  ok(r.refundInPayment && r.usageBeforeRefund, 'in the Payment card, after Usage', r);
}

section('The plan has room under the title');
ok(r.gap >= 28, 'at least 28px between "Billing" and the plan', r.gap);

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors);

report();
await app.close();
done();
