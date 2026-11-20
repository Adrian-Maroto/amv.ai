/* AMV NEVER PRESSES PAY (Nov 16, buying phase 1; contained Nov 20 after the
   build 16 audit, AG-01..AG-04 - docs/BUYING.md, shopping.js).

   AMV's browser is replaced at its lowest door (mcpCall), so the REAL
   runMcpTool runs - the one every surface goes through - and what is checked
   is the rule, exactly:
     · AMV never presses a pay or place-order button itself, approved or not,
       read from the page's own label in many languages; Enter, a submitted
       form and an accepted dialog on a checkout are refused too; a control it
       cannot read on a checkout is not pressed; a page it cannot read at all
       means nothing that writes is done;
     · the guard is at the door every surface uses, so Build's path is held
       the same as chat's;
     · one approval per store, for this request in this conversation;
     · the purchase card is refused on another store, a parent domain or a
       public suffix, in the wrong currency, or for an amount that is not the
       page's total (a shipping line); "Not now" holds nothing;
     · an approval is held on the server first, and the person presses;
     · only an order number and total found on the store's page is Bought -
       a declined page is "Not confirmed", never Bought. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', apiBase: 'https://backend.example.workers.dev', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

const TOOLS = ['browser_snapshot', 'browser_click', 'browser_press_key', 'browser_type', 'browser_fill_form', 'browser_handle_dialog', 'browser_navigate'];
await page.evaluate(async (tools) => {
  MCP.live[MCP_BROWSER.id] = { tools: tools.map(name => ({ name, inputSchema: { type: 'object' } })), error: '' };
  window.__s = { page: '', unreadable: false, writes: [], modals: [], bodies: [], answer: true, hold: { ok: true, hold: { id: 'bh_' + 'a'.repeat(24) } }, sent: [] };
  /* The lowest door: the bridge call. Everything above it is real. */
  window.mcpCall = async (id, method, params) => {
    if (params.name === 'browser_snapshot') return window.__s.unreadable ? { isError: true, content: [{ type: 'text', text: 'Error: no page' }] } : { content: [{ type: 'text', text: window.__s.page }] };
    window.__s.writes.push(params.name); return { content: [{ type: 'text', text: 'done' }] };
  };
  window._showModalAsync = async (o) => { window.__s.modals.push(o.title); window.__s.bodies.push(o.body); return window.__s.answer; };
  try { Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true }); } catch (e) {}
  AMV_API._fetch = async (path, o) => { window.__s.sent.push({ path, body: JSON.parse((o && o.body) || '{}') });
    const d = /hold$/.test(path) ? window.__s.hold : { ok: true, receipt: { total: 1234.5, currency: 'EUR', over: 0 } };
    return new Response(JSON.stringify(d), { status: d.ok ? 200 : 400 }); };
  await _lazyLoad('shopping.js', () => !!window.amvShop);
}, TOOLS);
const N = (tool) => page.evaluate((t) => _mcpAliasFor(MCP_BROWSER.id, t), tool);
const CHECKOUT = 'Page URL: https://www.shop.example.com/checkout\n- button "Continue shopping" [ref=e1]\n- button "Place your order" [ref=e2] [cursor=pointer]\n- button [ref=e9]\n- text: Subtotal EUR 1.200,00\n- text: Delivery EUR 34,50\n- text: Order total EUR 1.234,50';
const setPage = (t) => page.evaluate((x) => { window.__s.page = x; window.__s.unreadable = false; window.amvShop._state.snap.at = 0; }, t);
const shop = (fn, ...a) => page.evaluate(([f, args]) => window.amvShop[f](...args), [fn, a]);
/* Through the real door, the way chat and Build both reach the browser. */
const run = (tool, args) => page.evaluate(async ([t, a]) => { const before = window.__s.writes.length;
  const r = await runMcpTool(_mcpAliasFor(MCP_BROWSER.id, t), a); return { ok: r.ok, text: r.text, wrote: window.__s.writes.length > before }; }, [tool, args]);
const newRequest = () => page.evaluate(() => { window.__amvReq = (window.__amvReq || 0) + 1; });

section('One approval per store, for this request only');
{
  await setPage(CHECKOUT);
  const click = await N('browser_click');
  const a = await shop('consent', click, { ref: 'e1' });
  const b = await shop('consent', click, { ref: 'e1' });
  let m = await page.evaluate(() => window.__s.modals.slice());
  ok(a === true && b === true && m.length === 1 && /shop\.example\.com/.test(m[0]), 'asked once for the store, then not per click', m);
  await setPage(CHECKOUT.replace('shop.example.com', 'other.example.org'));
  await shop('consent', click, { ref: 'e1' });
  ok((await page.evaluate(() => window.__s.modals.length)) === 2, 'another store is asked again', '');
  await setPage(CHECKOUT); await newRequest();
  await shop('consent', click, { ref: 'e1' });
  ok((await page.evaluate(() => window.__s.modals.length)) === 3, 'a new request asks again - "for this request" means this one', '');
  await page.evaluate(() => { S.cur = 'another-conversation'; });
  await shop('consent', click, { ref: 'e1' });
  ok((await page.evaluate(() => window.__s.modals.length)) === 4, 'and so does another conversation', '');
}

section('AMV never presses a pay button - through the one door every surface uses');
{
  await setPage(CHECKOUT);
  let r = await run('browser_click', { ref: 'e1', element: 'Place order' });
  ok(r.ok && r.wrote, 'an ordinary button is pressed, whatever the model calls it', r);
  r = await run('browser_click', { ref: 'e2', element: 'Continue' });
  ok(!r.ok && !r.wrote && /never presses/.test(r.text), 'the real "Place your order" is refused, even named as something else', r);
  r = await run('browser_press_key', { key: 'Enter' });
  ok(!r.ok && !r.wrote, 'and Enter on a checkout', r);
  r = await run('browser_type', { ref: 'e1', text: 'x', submit: true });
  ok(!r.ok && !r.wrote, 'and a form sent with submit', r);
  r = await run('browser_handle_dialog', { accept: true });
  ok(!r.ok && !r.wrote, 'and accepting a dialog on a checkout ("Confirm payment?")', r);
  r = await run('browser_click', { ref: 'e9' });
  ok(!r.ok && !r.wrote && /could not read what that control is/.test(r.text), 'a button with no name on a checkout is not pressed', r);
  r = await run('browser_click', { ref: 'e404' });
  ok(!r.ok && !r.wrote, 'nor a reference that is not on the page', r);
  await page.evaluate(() => { window.__s.unreadable = true; window.amvShop._state.snap.at = 0; });
  r = await run('browser_click', { ref: 'e1' });
  ok(!r.ok && !r.wrote && /could not read the page/.test(r.text), 'a page that cannot be read means nothing that writes is done', r);
  await setPage(CHECKOUT);
  /* Build's own tool runner (37-build-agent.js), which never asked the
     shopping check before: held at the same door now. */
  const build = await page.evaluate(async () => { const before = window.__s.writes.length;
    const r = await _agentRunTool(_mcpAliasFor(MCP_BROWSER.id, 'browser_click'), { ref: 'e2', element: 'Pay now' }, {});
    return { ok: r && r.ok, text: r && r.text, wrote: window.__s.writes.length > before }; });
  ok(build.ok === false && !build.wrote, 'Build’s own tool runner cannot press it either', build);
}

section('Pay buttons in other languages are pay buttons');
{
  const labels = ['Pagar ahora', 'Finalizar compra', 'Jetzt kaufen', 'Zahlungspflichtig bestellen', 'Commander', 'Passer la commande', 'Acquista ora',
    'Satın al', 'Thanh toán', 'Bayar sekarang', 'Оплатить', 'Оформить заказ', 'ادفع', 'إتمام الطلب', 'अभी खरीदें', '立即购买', '提交订单', '注文を確定する', '결제하기', 'Comprar'];
  const r = await page.evaluate((ls) => ls.map(l => [l, window.amvShop._isMoney(l)]), labels);
  ok(r.every(x => x[1]), 'every one is recognised', r.filter(x => !x[1]));
  const plain = await page.evaluate(() => ['Continue shopping', 'Payment details', 'Buyer reviews', 'Add to basket', 'Seguir comprando', 'Details zur Zahlung', 'Back'].map(l => [l, window.amvShop._isMoney(l)]));
  ok(plain.every(x => !x[1]), 'and ordinary buttons are not', plain.filter(x => x[1]));
  await setPage(CHECKOUT.replace('"Place your order"', '"Pagar ahora"'));
  const c = await run('browser_click', { ref: 'e2' });
  ok(!c.ok && !c.wrote, 'a Spanish pay button is refused at the door', c);
}

section('The purchase card says exactly what the store’s page says');
{
  await setPage(CHECKOUT);
  let r = await shop('run', 'propose_purchase', { store: 'other.example.com', item: 'Desk', total: 1234.5, currency: 'EUR' });
  ok(r.ok === false && /not other\.example\.com/.test(r.text), 'refused on another store', r.text);
  await setPage(CHECKOUT.replace('www.shop.example.com', 'merchant-b.co.uk'));
  r = await shop('run', 'propose_purchase', { store: 'co.uk', item: 'Desk', total: 1234.5, currency: 'EUR' });
  ok(r.ok === false && /not a store/.test(r.text), 'a public suffix is not a store', r.text);
  r = await shop('run', 'propose_purchase', { store: 'merchant-a.co.uk', item: 'Desk', total: 1234.5, currency: 'EUR' });
  ok(r.ok === false, 'and merchant-a.co.uk does not reach merchant-b.co.uk', r.text);
  const same = await page.evaluate(() => [window.amvShop._same('pay.shop.example.com', 'shop.example.com'), window.amvShop._same('example.com', 'shop.example.com')]);
  ok(same[0] === true && same[1] === false, 'a subdomain of the store is the store; its parent is not', same);
  await setPage(CHECKOUT);
  r = await shop('run', 'propose_purchase', { store: 'shop.example.com', item: 'Desk', total: 34.5, currency: 'EUR' });
  ok(r.ok === false && /does not appear/.test(r.text), 'a shipping line cannot pass as the total', r.text);
  r = await shop('run', 'propose_purchase', { store: 'shop.example.com', item: 'Desk', total: 1234.5, currency: 'USD' });
  ok(r.ok === false && /does not appear/.test(r.text), 'nor the right number in the wrong currency', r.text);
  await page.evaluate(() => { window.__s.answer = false; window.__s.sent = []; });
  r = await shop('run', 'propose_purchase', { store: 'shop.example.com', item: 'Desk', total: 1234.5, currency: 'EUR' });
  ok(r.ok === false && (await page.evaluate(() => window.__s.sent.length)) === 0, '"Not now" holds nothing', r.text);
}

section('A refused hold approves nothing');
{
  await page.evaluate(() => { window.__s.answer = true; window.__s.hold = { ok: false, code: 'auto_off', need: 'Buying is switched off.', message: 'Turn it on in Spending.' }; });
  const r = await shop('run', 'propose_purchase', { store: 'shop.example.com', item: 'Desk', total: 1234.5, currency: 'EUR' });
  ok(r.ok === false && /switched off/.test(r.text) && /Not bought/.test(r.render || ''), 'the reason reaches the model and the person', r.text);
}

section('An approval is held first; then the PERSON presses the store’s button');
{
  await page.evaluate(() => { window.__s.hold = { ok: true, hold: { id: 'bh_' + 'a'.repeat(24) } }; window.__s.sent = []; });
  const r = await shop('run', 'propose_purchase', { store: 'shop.example.com', item: 'Desk', total: 1234.5, currency: 'EUR' });
  const sent = await page.evaluate(() => window.__s.sent.slice());
  ok(r.ok && sent.length === 1 && sent[0].path === '/v1/spend/hold' && sent[0].body.amount === 1234.5 && sent[0].body.currency === 'EUR', 'the amount is held on the server first', sent);
  const body = await page.evaluate(() => window.__s.bodies[window.__s.bodies.length - 1]);
  ok(/never presses it/.test(body), 'and the card says who presses the button', body);
  const c = await run('browser_click', { ref: 'e2' });
  ok(!c.ok && !c.wrote && /ask the person to press/.test(c.text), 'even approved, AMV does not press it - it asks the person to', c);
}

section('Only what the store’s page confirms is Bought');
{
  await setPage('Page URL: https://www.shop.example.com/checkout\n- heading "Payment was declined"\n- text: Try another card. EUR 1.234,50');
  await page.evaluate(() => { window.__s.sent = []; });
  let r = await shop('run', 'confirm_purchase', { order: 'A-99999', total: 1234.5, currency: 'EUR' });
  let sent = await page.evaluate(() => window.__s.sent.slice());
  ok(sent[0] && sent[0].body.verified === false, 'a declined page with an invented order is recorded as not seen', sent);
  ok(!/Bought/.test(r.render || '') && /Not confirmed/.test(r.render || '') && /NOT confirmed/.test(r.text), 'and is never shown as Bought', (r.render || '').slice(0, 160));
  /* Approved again, and this time the store confirms it. */
  await setPage(CHECKOUT);
  await shop('run', 'propose_purchase', { store: 'shop.example.com', item: 'Desk', total: 1234.5, currency: 'EUR' });
  await setPage('Page URL: https://www.shop.example.com/thanks\n- heading "Thank you"\n- text: Order A-77812 · Total EUR 1.234,50');
  await page.evaluate(() => { window.__s.sent = []; });
  r = await shop('run', 'confirm_purchase', { order: 'A-77812', total: 1234.5, currency: 'EUR' });
  sent = await page.evaluate(() => window.__s.sent.slice());
  ok(r.ok && sent[0].path === '/v1/spend/settle' && sent[0].body.verified === true && sent[0].body.order === 'A-77812', 'seen on the page, and recorded as seen', sent);
  ok(/class="chat-buy done"/.test(r.render || '') && /Bought/.test(r.render || ''), 'with a Bought receipt in chat', (r.render || '').slice(0, 120));
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
