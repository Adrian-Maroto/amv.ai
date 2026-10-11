/* OUT OF USAGE? A PAID PLAN CAN BUY MORE, RIGHT THERE.

   The page's half of extra usage, in a real browser with AMV's server stood
   in for at the network:

   - a paid plan's "out of usage" card offers extra usage beside the upgrade;
     the top plan, with nothing above it, offers only extra usage; a free plan
     is offered the upgrade, not a pack;
   - the five-hour window and the best engine's week now get that card too,
     and the week does not lock the whole composer;
   - the packs are fetched on demand, show the balance, and pressing one asks
     AMV's server for a checkout and goes to it;
   - a deployment without card payments says so instead of offering packs;
   - coming back from paying says the credit is arriving - it does not claim
     an amount the address bar cannot know. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const API = 'https://api.example.workers.dev';
const PAY = 'https://checkout.stripe.test';
const app = await bootApp({ tab: 'chat', user: { name: 'Pat', email: 'pat@example.com', ini: 'P' }, apiBase: API, blockServiceWorkers: true });
const { page, errors } = app;
const appUrl = page.url().split('?')[0];

let info = { ok: true, balance: 3.5, eligible: true, available: true, packs: [10, 25, 50], max: 500 };
const posted = [];
await page.route(API + '/**', async (route) => {
  const req = route.request(); const path = new URL(req.url()).pathname;
  let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
  const reply = (status, d) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(d) });
  if (path === '/v1/credit') return reply(200, info);
  if (path === '/v1/credit/checkout') { posted.push(body); return reply(200, { ok: true, url: PAY + '/pay/' + body.usd }); }
  return reply(200, { ok: true });
});
await page.route(PAY + '/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Pay</title>' }));

const card = (plan, code) => page.evaluate(([plan, code]) => {
  saveStr('amv_plan', plan);
  const c = newConvObj('t'); S.convs.unshift(c); S.cur = c.id;
  setMsgs([{ r: 'u', c: 'hi' }, { r: 'a', c: '', _quota: true, _resetAt: Date.now() + 3600000, _quotaCode: code, _quotaMsg: 'x' }]);
  renderChatMsgs();
  const el = document.querySelector('.quota-card');
  return { text: el ? el.innerText : '', up: !!document.querySelector('[data-action="quota-upgrade"]'), credit: !!document.querySelector('[data-action="credit-buy"]') };
}, [plan, code]);

section('Who is offered what, on the out-of-usage card');
{
  const pro = await card('pro', 'quota_window');
  ok(pro.up && pro.credit && /or add extra usage/.test(pro.text), 'Pro: upgrade or add extra usage', pro);
  const ultra = await card('ultra', 'quota_month');
  ok(!ultra.up && ultra.credit, 'Ultra, with nothing above it: extra usage only', ultra);
  const free = await card('free', 'quota_day');
  ok(free.up && !free.credit, 'Free: the upgrade, not a pack', free);
}

section('The windows reach the card, and the best engine’s week does not lock the composer');
{
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app.js'), 'utf8');
  ok(/srvCode==='quota_window'\|\|srvCode==='quota_top_week'/.test(src), 'both window refusals are handled as limits, not errors');
  ok(/if\(srvCode!=='quota_top_week'\) quotaLock\(/.test(src), 'and the weekly one leaves the composer open');
}

section('The packs load on demand, show the balance, and go to checkout');
{
  await card('pro', 'quota_window');
  await page.click('[data-action="credit-buy"]');
  await page.waitForSelector('.cr-pack');
  const text = await page.evaluate(() => document.getElementById('cr-body').innerText);
  const packs = await page.$$eval('.cr-pack b', els => els.map(e => e.textContent));
  ok(/\$3\.50/.test(text) && packs.join() === '$10,$25,$50', 'balance and three packs', { text: text.slice(0, 120), packs });
  ok(await page.evaluate(() => typeof window._creditPicker === 'function'), 'fetched from credit.js');
  await Promise.all([page.waitForURL(PAY + '/**'), page.click('.cr-pack >> nth=1')]);
  ok(posted.length === 1 && posted[0].usd === 25 && page.url() === PAY + '/pay/25', 'the $25 pack asked AMV for a checkout and went to it', { posted, url: page.url() });
}

section('Without card payments, it says so');
{
  await page.goto(appUrl);
  await page.waitForTimeout(500);
  info = Object.assign({}, info, { available: false });
  await page.evaluate(() => { S.user = { name: 'Pat', email: 'pat@example.com', ini: 'P' }; goApp(); _creditOpen(); });
  await page.waitForFunction(() => /not switched on/.test((document.getElementById('cr-body') || {}).innerText || ''));
  ok((await page.$$('.cr-pack')).length === 0, 'no packs are offered');
}

section('Back from paying: it says the credit is arriving');
{
  await page.goto(appUrl + '?credit=1');
  await page.waitForFunction(() => /extra usage will be on your balance/.test(document.body.innerText), null, { timeout: 15000 });
  ok(await page.evaluate(() => location.search === ''), 'and the address bar is clean');
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('out-of-usage-you-can-buy-more') > 0) process.exitCode = 1;
done();
