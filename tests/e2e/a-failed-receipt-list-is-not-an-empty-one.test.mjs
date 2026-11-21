/* A FAILED RECEIPT LIST IS NOT AN EMPTY ONE (Build 16 audit D16-02, Nov 21).

   What AMV bought in its browser comes from the server's receipts. The
   section used to stay hidden when the request failed, which looked exactly
   like "nothing bought", and only the first 25 were ever shown. Driven on the
   Spending tab with the server's answer chosen by the test. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'chat' });
const { page, errors } = app;
await page.evaluate(() => {
  Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true });
  Object.defineProperty(AMV_API, 'hasSession', { configurable: true, get: () => true });
  window.__buys = { status: 503, body: { error: 'down' } };
  const real = AMV_API._fetch.bind(AMV_API);
  AMV_API._fetch = async (path, o) => {
    if (/\/v1\/spend\/buys/.test(path)) return new Response(JSON.stringify(window.__buys.body), { status: window.__buys.status, headers: { 'Content-Type': 'application/json' } });
    if (/\/v1\/spend/.test(path)) return new Response(JSON.stringify({ ok: true, limits: { enabled: false, perPurchase: 50, monthlyCap: 500, autoUnder: 0, currency: 'USD' }, spentThisMonth: 0, remaining: 500 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return real(path, o);
  };
});
const open = () => page.evaluate(async () => {
  setTab('chat'); await new Promise(r => setTimeout(r, 50));
  setTab('spend');
  for (let i = 0; i < 100 && !document.getElementById('mf-buys-b'); i++) await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, 500));
  const b = document.getElementById('mf-buys-b');
  return b ? { text: b.textContent.replace(/\s+/g, ' ').trim(), rows: b.querySelectorAll('tbody tr').length, retry: !!document.getElementById('mf-buys-retry'), more: !!document.getElementById('mf-buys-more'), shown: !document.getElementById('mf-buys').hidden } : null;
});

section('The server could not answer');
{
  const r = await open();
  ok(r && r.shown && /could not load/.test(r.text) && /not the same as nothing bought/.test(r.text), 'it says so, and that it is not "nothing bought"', r);
  ok(r && r.retry, 'with a way to try again', r);
}

section('Nothing bought yet');
{
  await page.evaluate(() => { window.__buys = { status: 200, body: { ok: true, buys: [] } }; });
  const r = await open();
  ok(r && /Nothing has been bought/.test(r.text) && r.rows === 0, 'said as nothing, which it now is', r);
}

section('Every receipt is reachable');
{
  await page.evaluate(() => { window.__buys = { status: 200, body: { ok: true, buys: Array.from({ length: 30 }, (_, i) => ({ id: 'r' + i, at: Date.now() - i * 1000, store: 'shop.example.com', item: 'Thing ' + i, total: 10 + i, currency: 'USD', order: 'A-' + i, verified: true })) } }; });
  let r = await open();
  ok(r && r.rows === 25 && r.more, 'the first 25, and a button for the rest', r);
  await page.click('#mf-buys-more');
  r = await page.evaluate(() => ({ rows: document.querySelectorAll('#mf-buys-b tbody tr').length, more: !!document.getElementById('mf-buys-more') }));
  ok(r.rows === 30 && !r.more, 'and then all thirty', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
