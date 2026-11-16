/* A REFUND IS ONE PRESS, AND THE SCREEN SAYS WHAT HAPPENS (Nov 16, the
   owner: "14 days, light use").

   The Billing screen's Refund section reads out the server's answer
   (68-refunds.js decides; a-refund-is-real-money-read-back holds that). Held:
     · when the charge can be refunded, it says how much, for which charge,
       that the plan ends, and how many days are left - and the button asks
       first, naming what is lost;
     · cancelling the question refunds nothing;
     · when it cannot, it says why in a sentence, and a request can be sent -
       not empty;
     · an open request says so instead of offering a second;
     · and the section is clean on a phone. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'billing', apiBase: 'https://backend.example.workers.dev',
                            viewport: { width: 1280, height: 900 }, user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;
const DAY = 86400000;

/* The server's answer, and a record of what the screen asked of it. */
const draw = (state) => page.evaluate(async (st) => {
  saveStr('amv_plan', 'pro');
  window.__rf = { calls: [] };
  try { Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true }); } catch (e) {}
  try { Object.defineProperty(AMV_API, 'hasSession', { configurable: true, get: () => true }); } catch (e) {}
  AMV_API.refundState = async () => { window.__rf.calls.push('state'); return st; };
  AMV_API.refund = async (b) => { window.__rf.calls.push(b); if (b.mode === 'auto') return { ok: true, refund: { amount: 15, currency: 'USD', status: 'succeeded' }, planEnded: true };
    return { ok: true, request: { id: 'rr_abc', at: Date.now() } }; };
  S.renewal = { autoRenew: true, renewsAt: Date.now() + 28 * 86400000, cycle: 'month', manageable: true };
  S.tab = 'billing';
  renderBillingView();
  for (let i = 0; i < 50 && (document.getElementById('bill-refund') || {}).hidden !== false; i++) await new Promise(r => setTimeout(r, 100));
  const box = document.getElementById('bill-refund');
  return { shown: !!box && !box.hidden, text: box ? box.textContent.replace(/\s+/g, ' ').trim() : '',
    go: !!document.getElementById('bill-rf-go'), ask: !!document.getElementById('bill-rf-ask') };
}, state);

const AUTO = { ok: true, auto: true, why: [], charge: { amount: 15, currency: 'USD', paidAt: Date.now() - 2 * DAY },
  daysLeft: 12, usedPercent: 4, refunded: false, request: null, answered: null };

section('A charge that can come back: how much, which, what ends, how long');
{
  const r = await draw(AUTO);
  ok(r.shown, 'the Refund section is on Billing', r);
  ok(/\$15\.00/.test(r.text) && /plan ends/i.test(r.text) && /12 days left/.test(r.text), 'it names the amount, that the plan ends, and the days left', r.text);
  ok(r.go && !r.ask, 'with one button to refund', r);
}

section('The button asks first, and saying no refunds nothing');
{
  await page.click('#bill-rf-go');
  await page.waitForSelector('#cfm-no', { timeout: 5000 });
  const q = await page.evaluate(() => (document.getElementById('ovr') || {}).textContent.replace(/\s+/g, ' '));
  ok(/cannot be undone/i.test(q) && /moves to Free/i.test(q), 'the question says the plan ends and it cannot be undone', q.slice(0, 200));
  await page.click('#cfm-no');
  await page.waitForTimeout(300);
  const calls = await page.evaluate(() => window.__rf.calls.filter(c => typeof c === 'object'));
  ok(calls.length === 0, 'keeping the plan sends nothing', calls);
  await page.click('#bill-rf-go');
  await page.waitForSelector('#cfm-yes', { timeout: 5000 });
  await page.click('#cfm-yes');
  await page.waitForTimeout(700);
  const sent = await page.evaluate(() => window.__rf.calls.filter(c => typeof c === 'object'));
  ok(sent.length === 1 && sent[0].mode === 'auto', 'confirming asks the server for the refund, once', sent);
}

section('A charge that cannot: why, in a sentence, and a request');
{
  const r = await draw(Object.assign({}, AUTO, { auto: false, why: ['used_20_percent'], usedPercent: 40 }));
  ok(/More than 20% of this period has been used/.test(r.text) && /still ask/i.test(r.text), 'it says why and that a request can still be sent', r.text);
  ok(r.ask && !r.go, 'with Ask for a refund instead of Refund', r);
  await page.click('#bill-rf-ask');
  await page.click('#bill-rf-send');
  await page.waitForTimeout(200);
  let sent = await page.evaluate(() => window.__rf.calls.filter(c => typeof c === 'object'));
  ok(sent.length === 0, 'an empty request is not sent', sent);
  await page.fill('#bill-rf-why', 'I was charged twice');
  await page.click('#bill-rf-send');
  await page.waitForTimeout(400);
  sent = await page.evaluate(() => window.__rf.calls.filter(c => typeof c === 'object'));
  ok(sent.length === 1 && sent[0].mode === 'request' && sent[0].reason === 'I was charged twice', 'a written one is', sent);
}

section('An open request says so, instead of offering a second');
{
  const r = await draw(Object.assign({}, AUTO, { auto: false, why: ['over_14_days'], request: { id: 'rr_abc', at: Date.now() - DAY } }));
  ok(/was sent on/.test(r.text) && !r.ask && !r.go, 'it says the request was sent and offers nothing else', r.text);
}

section('On a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  const r = await draw(AUTO);
  const m = await page.evaluate(() => { const b = document.getElementById('bill-refund').getBoundingClientRect();
    const btn = document.getElementById('bill-rf-go').getBoundingClientRect();
    return { right: b.right, w: innerWidth, btnH: btn.height, over: document.documentElement.scrollWidth > innerWidth + 1 }; });
  ok(r.shown && m.right <= m.w && !m.over, 'the section fits the screen', m);
  ok(m.btnH >= 44, 'and the button is big enough to hit', m.btnH);
  await page.evaluate(() => document.getElementById('bill-refund').scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: process.env.AMV_SHOT || '/dev/null' }).catch(() => {});
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
