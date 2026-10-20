/* A LOCKED API, AS A BROWSER ENFORCES IT.

   The Worker suite checks the headers. This checks what the headers are FOR:
   a real browser, a real AMV API locked to AMV's own site (ALLOWED_ORIGIN),
   and a customer's page on an origin of its own, making real requests - so
   what is readable is decided by Chromium's CORS rules, not by an assertion
   about a header:

   - the website widget, embedded on the customer's page, reads its settings
     and its answer;
   - a page calling with an API key reads its answer (a refusal for a fake key,
     here - readable is the point);
   - that same page cannot read anybody's session route. */
import { createServer } from 'http';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { LAUNCH } from '../lib/harness.mjs';
import { makeEnv } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const W = await import(join(ROOT, 'amv-backend.js') + '?lock=' + Date.now());
const worker = W.default;

const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => /model\.example/.test(String(u))
  ? new Response('data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":0}}}\n\n'
      + 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"We open at nine."}}\n\ndata: {"type":"message_stop"}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  : realFetch(u, o);

const listen = (handler) => new Promise(r => { const s = createServer(handler); s.listen(0, () => r(s)); });
let env;
const api = await listen(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
  const r = await worker.fetch(new Request('http://localhost:' + api.address().port + req.url, { method: req.method, headers,
    body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : Buffer.concat(chunks) }), env, { waitUntil() {}, passThroughOnException() {} });
  const out = {}; r.headers.forEach((v, k) => { out[k] = v; });
  res.writeHead(r.status, out); res.end(Buffer.from(await r.arrayBuffer()));
});
/* The customer's own site: a plain page on an origin of its own. */
const shop = await listen((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Shop</title><p>Our shop</p>'); });
const API = 'http://localhost:' + api.address().port;
const SITE = 'http://127.0.0.1:' + api.address().port;            /* AMV's own site, a different origin */
const SHOP = 'http://localhost:' + shop.address().port;

env = makeEnv({ APP_URL: SITE, ALLOWED_ORIGIN: SITE, AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example' });
const KEY = 'pk_shopwidget';
const w = { key: KEY, owner: 'shop@example.com', enabled: true, model: 'amv-core', origins: ['localhost:' + shop.address().port],
  dailyMsgCap: 0, dailySpendCapUSD: 0, maxOut: 256, systemPrompt: 'Answer about the shop.', title: 'Chat', greeting: 'Hi' };
await env.AMV_KV.put('widget:' + KEY, JSON.stringify(w));
await env.AMV_KV.put('widget_owner:shop@example.com', JSON.stringify(w));
await env.AMV_KV.put('ent:shop@example.com', JSON.stringify({ plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));

const browser = await chromium.launch(LAUNCH);
const page = await (await browser.newContext()).newPage();
await page.goto(SHOP, { waitUntil: 'load' });
const read = (fn, arg) => page.evaluate(fn, arg).catch(e => ({ threw: String(e && e.message || e) }));

section('On the customer’s site, the widget works against a locked AMV');
{
  const cfg = await read(async ([api, key]) => { try { const r = await fetch(api + '/v1/widget/config-public?k=' + key); return { status: r.status, body: await r.json() }; } catch (e) { return { blocked: String(e) }; } }, [API, KEY]);
  ok(cfg.status === 200 && !cfg.blocked, 'its settings are readable', cfg);
  const ans = await read(async ([api, key]) => { try {
    const r = await fetch(api + '/v1/widget/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, messages: [{ role: 'user', content: 'When do you open?' }] }) });
    return { status: r.status, text: await r.text() }; } catch (e) { return { blocked: String(e) }; } }, [API, KEY]);
  ok(ans.status === 200 && /nine/.test(ans.text || ''), 'and so is its answer', ans.blocked || (ans.text || '').slice(0, 80));
}

section('A page calling with an API key can read the answer');
{
  const r = await read(async (api) => { try {
    const x = await fetch(api + '/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer amv_sk_' + 'x'.repeat(40) },
      body: JSON.stringify({ model: 'amv-core', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }) });
    return { status: x.status }; } catch (e) { return { blocked: String(e) }; } }, API);
  ok(!r.blocked && r.status === 401, 'a fake key is refused - and the refusal is readable, which is the point', r);
}

section('The same page cannot read a session route');
{
  const r = await read(async (api) => { try {
    const x = await fetch(api + '/v1/entitlement', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return { status: x.status }; } catch (e) { return { blocked: String(e) }; } }, API);
  ok(!!r.blocked, 'the browser refuses to hand it over', r);
}

await browser.close(); api.close(); shop.close(); globalThis.fetch = realFetch;
if (report('a-locked-api-in-a-real-browser') > 0) process.exitCode = 1;
done();
