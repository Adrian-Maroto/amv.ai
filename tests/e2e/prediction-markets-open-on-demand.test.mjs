/* PREDICTION MARKETS OPEN - FETCHED THE FIRST TIME, AND ONLY THEN.

   The screen lives in predict.js (src/finance/predict.js), fetched the first
   time somebody opens it, so the page every visitor downloads does not carry
   it. Driven in a real browser with the server's answers stood in for: it is
   not fetched until it is opened, it opens on the first try, and each answer
   the server can give is said as itself - no venue where somebody is, no
   venue connected, and the trade form with the fixed limits. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const API = 'http://api.pm.test';
const app = await bootApp({ tab: 'chat', user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, apiBase: API });
const { page, errors } = app;
let answer = { venues: [] };
const fetched = [];
page.on('request', (r) => { if (/predict\.js(\?|$)/.test(r.url())) fetched.push(r.url()); });
let hits = 0;
await page.route('**/v1/predict/markets', (route) => { if (/predict/.test(route.request().url())) hits++; return route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(Object.assign({ ok: true }, answer)) }); });
const body = () => page.evaluate(() => (document.getElementById('pm-body') || {}).innerText || '');

section('Not loaded until it is opened');
ok(fetched.length === 0, 'the page did not fetch predict.js on its own', fetched);

section('Where nothing is available, it says so');
{
  answer = { venues: [], note: '' };
  await page.evaluate(() => openPredictionMarkets());
  await page.waitForFunction(() => /not available/.test((document.getElementById('pm-body') || {}).innerText || ''), null, { timeout: 15000 });
  ok(fetched.length === 1 && /not available in your country/.test(await body()), 'fetched once, and the answer is said as itself', [fetched.length, await body()]);
  await page.evaluate(() => closeOvr());
}

section('With no venue connected, nothing is attempted');
{
  answer = { venues: [{ id: 'v1', name: 'Venue One', ready: false }] };
  await page.evaluate(() => openPredictionMarkets());
  await page.waitForFunction(() => /No prediction venue/.test((document.getElementById('pm-body') || {}).innerText || ''), null, { timeout: 15000 });
  ok(fetched.length === 1 && hits === 2, 'and the second time it is not fetched again - only the answer is asked for', [fetched.length, hits]);
  await page.evaluate(() => closeOvr());
}

section('With a venue, the trade form and its fixed limits');
{
  answer = { venues: [{ id: 'v1', name: 'Venue One', ready: true }], caps: { perTrade: 25, perDay: 100 } };
  await page.evaluate(() => openPredictionMarkets());
  await page.waitForSelector('#pm-venue', { timeout: 15000 });
  const t = await body();
  ok(/\$25\.00/.test(t) && /\$100\.00/.test(t) && await page.evaluate(() => !!document.getElementById('pm-market')), 'the form, with the limits stated in money', t.slice(0, 200));
}

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close?.();
if (report('prediction-markets-open-on-demand') > 0) process.exitCode = 1;
done();
