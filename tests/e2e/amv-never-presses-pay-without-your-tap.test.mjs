/* AMV NEVER PRESSES PAY WITHOUT YOUR TAP (Nov 16, buying phase 1 -
   docs/BUYING.md, shopping.js).

   AMV's browser is replaced by a stand-in page, so what is checked is the
   rule, exactly. Held:
     · one approval per store trip - asked once, not per click; another store
       asks again;
     · a pay / place-order button is refused until a purchase is approved,
       read from the page's own label, not from what the model calls it; so
       are Enter and a submitted form on a page that shows one;
     · the purchase card is refused when the browser is on another store or
       the total is not on the page; a "Not now" holds nothing;
     · an approval is held on the server first, unlocks ONE press, and a
       refused hold unlocks nothing;
     · the confirmation is checked on the page and sent as seen or not seen. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', apiBase: 'https://backend.example.workers.dev', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

await page.evaluate(async () => {
  MCP.live[MCP_BROWSER.id] = { tools: [] };
  window.__s = { page: '', modals: [], answer: true, hold: { ok: true, hold: { id: 'bh_' + 'a'.repeat(24) } }, sent: [] };
  window.runMcpTool = async () => ({ ok: true, text: window.__s.page });
  window._showModalAsync = async (o) => { window.__s.modals.push(o.title); return window.__s.answer; };
  try { Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true }); } catch (e) {}
  AMV_API._fetch = async (path, o) => { window.__s.sent.push({ path, body: JSON.parse((o && o.body) || '{}') });
    const d = /hold$/.test(path) ? window.__s.hold : { ok: true, receipt: { total: 1234.5, currency: 'EUR', over: 0 } };
    return new Response(JSON.stringify(d), { status: d.ok ? 200 : 400 }); };
  await _lazyLoad('shopping.js', () => !!window.amvShop);
});
const N = (tool) => page.evaluate((t) => _mcpAliasFor(MCP_BROWSER.id, t), tool);
const CHECKOUT = 'Page URL: https://www.shop.example.com/checkout\n- button "Continue shopping" [ref=e1]\n- button "Place your order" [ref=e2] [cursor=pointer]\n- text: Order total EUR 1.234,50';
const setPage = (t) => page.evaluate((x) => { window.__s.page = x; window.amvShop._state.snap.at = 0; }, t);
const shop = (fn, ...a) => page.evaluate(([f, args]) => window.amvShop[f](...args), [fn, a]);

section('One approval per shopping trip');
{
  await setPage(CHECKOUT);
  const click = await N('browser_click');
  const a = await shop('consent', click, { ref: 'e1' });
  const b = await shop('consent', click, { ref: 'e1' });
  const m = await page.evaluate(() => window.__s.modals.slice());
  ok(a === true && b === true && m.length === 1 && /shop\.example\.com/.test(m[0]), 'asked once for the store, then not per click', m);
  await setPage(CHECKOUT.replace('shop.example.com', 'other.example.org'));
  await shop('consent', click, { ref: 'e1' });
  ok((await page.evaluate(() => window.__s.modals.length)) === 2, 'another store is asked again', '');
}

section('The pay button stays locked until a purchase is approved');
{
  await setPage(CHECKOUT);
  const click = await N('browser_click'), key = await N('browser_press_key'), type = await N('browser_type');
  ok(await shop('check', click, { ref: 'e1', element: 'Place order' }) === null, 'an ordinary button is pressed, whatever the model calls it', '');
  const r = await shop('check', click, { ref: 'e2', element: 'Continue' });
  ok(r && r.ok === false && /propose_purchase/.test(r.text), 'the real "Place your order" is refused, even named as something else', r);
  const k = await shop('check', key, { key: 'Enter' });
  ok(k && k.ok === false, 'and Enter on a page that shows one', k);
  const t = await shop('check', type, { ref: 'e1', text: 'x', submit: true });
  ok(t && t.ok === false, 'and a form sent with submit', t);
}

section('The purchase card reads the store’s own page');
{
  await setPage(CHECKOUT.replace('shop.example.com', 'other.example.org'));
  let r = await shop('run', 'propose_purchase', { store: 'shop.example.com', item: 'Kettle', total: 1234.5, currency: 'EUR' });
  ok(r.ok === false && /not shop\.example\.com/.test(r.text), 'refused on another store', r.text);
  await setPage(CHECKOUT);
  r = await shop('run', 'propose_purchase', { store: 'shop.example.com', item: 'Kettle', total: 999, currency: 'EUR' });
  ok(r.ok === false && /does not appear/.test(r.text), 'refused when that total is not on the page', r.text);
  await page.evaluate(() => { window.__s.answer = false; window.__s.sent = []; });
  r = await shop('run', 'propose_purchase', { store: 'shop.example.com', item: 'Kettle', total: 1234.5, currency: 'EUR' });
  ok(r.ok === false && (await page.evaluate(() => window.__s.sent.length)) === 0, '"Not now" holds nothing', r.text);
}

section('A refused hold unlocks nothing');
{
  await page.evaluate(() => { window.__s.answer = true; window.__s.hold = { ok: false, code: 'spending_off', need: 'Spending is switched off on your account.' }; });
  const r = await shop('run', 'propose_purchase', { store: 'shop.example.com', item: 'Kettle', total: 1234.5, currency: 'EUR' });
  ok(r.ok === false && /switched off/.test(r.text), 'the reason reaches the model and the person', r.text);
  const c = await shop('check', await N('browser_click'), { ref: 'e2' });
  ok(c && c.ok === false, 'and the pay button stays locked', c);
}

section('An approval is held first, then unlocks ONE press');
{
  await page.evaluate(() => { window.__s.hold = { ok: true, hold: { id: 'bh_' + 'b'.repeat(24) } }; window.__s.sent = []; });
  const r = await shop('run', 'propose_purchase', { store: 'shop.example.com', item: 'Kettle', total: 1234.5, currency: 'EUR' });
  const sent = await page.evaluate(() => window.__s.sent);
  ok(r.ok && sent.length === 1 && sent[0].path === '/v1/spend/hold' && sent[0].body.amount === 1234.5 && sent[0].body.currency === 'EUR', 'the amount is held on the server first', sent);
  const click = await N('browser_click');
  ok(await shop('check', click, { ref: 'e2' }) === null, 'then the place-order button can be pressed', '');
  const again = await shop('check', click, { ref: 'e2' });
  ok(again && again.ok === false, 'once', again);
}

section('The confirmation is read back from the page');
{
  await setPage('Page URL: https://www.shop.example.com/thanks\n- heading "Thank you" [ref=e9]\n- text: Order A-77812, total EUR 1.234,50');
  await page.evaluate(() => { window.__s.sent = []; });
  const r = await shop('run', 'confirm_purchase', { order: 'A-77812', total: 1234.5 });
  const sent = await page.evaluate(() => window.__s.sent);
  ok(r.ok && sent[0].path === '/v1/spend/settle' && sent[0].body.verified === true && sent[0].body.order === 'A-77812', 'seen on the page, and recorded as seen', sent);
  ok(/class="chat-buy done"/.test(r.render || ''), 'with a receipt in chat', (r.render || '').slice(0, 120));
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
