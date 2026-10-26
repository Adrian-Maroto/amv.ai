/* A SOURCE IS FOUND, READ, AND CITED - THREE THINGS, SHOWN AS THREE.

   Oct 26 audit #10. The research trail showed what a search FOUND and what
   the answer CITED, and nothing in between: AMV had no way to open a page, so
   it could not honestly say it had read one. Chat now offers the engine
   web_fetch (run on the provider's side), and a source is marked read only
   when the page's own content came back. Through the real page and server:
   - the request carries web_fetch, bounded by the server in count and size,
     whatever the page asked for;
   - a page that was opened is marked read, in the trail and on its chip;
   - a page that could not be opened says so, and is not marked read;
   - a source only found says so on hover - found, not read. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ev = (t, d) => 'event: ' + t + '\ndata: ' + JSON.stringify(d) + '\n\n';
function toolUse(name, input) {
  return ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } })
    + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_' + Math.random().toString(36).slice(2, 9), name } })
    + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input || {}) } })
    + ev('content_block_stop', { type: 'content_block_stop', index: 0 })
    + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } })
    + ev('message_stop', { type: 'message_stop' });
}
function text(t) {
  return ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } })
    + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })
    + ev('content_block_stop', { type: 'content_block_stop', index: 0 })
    + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } })
    + ev('message_stop', { type: 'message_stop' });
}

let nextTurns = [];
const modelSaw = [];
const outbound = makeOutbound();
outbound.on(/model\.example/, (_u, opts) => {
  let body = {}; try { body = JSON.parse(String(opts.body || '{}')); } catch (e) {}
  const chat = Array.isArray(body.tools) && body.tools.length > 0;
  if (chat) modelSaw.push(body);
  return new Response(chat && nextTurns.length ? nextTurns.shift() : text('Done.'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
});
const vals = new Map();
const env = makeEnv({
  APP_URL: 'http://localhost:9256', AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
  AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0; const r = o => new Response(JSON.stringify(o));
    if (b.op === 'reserve') { vals.set(n, cur + b.amount); return r({ allowed: true, value: vals.get(n) }); }
    if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur });
  } }) },
});
const L = await bootLive({ env, outbound, port: 9256 });
const { page } = L;

async function say(t) {
  await page.waitForFunction(() => S.busy === false, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const n = modelSaw.length;
  await page.evaluate((t) => { setTab('chat'); const box = document.getElementById('mta'); box.value = t; box.dispatchEvent(new Event('input', { bubbles: true })); sendMsg(); }, t);
  for (let i = 0; i < 80 && modelSaw.length === n; i++) await page.waitForTimeout(100);
  await page.waitForFunction(() => S.busy === false, null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(600); await L.settle();
}
const names = (b) => (b && b.tools || []).map(t => t.name);
const lastToolResult = () => {
  for (const b of [...modelSaw].reverse()) for (const m of [...(b.messages || [])].reverse()) {
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    const r = m.content.find(c => c && c.type === 'tool_result');
    if (r) return typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
  }
  return '';
};

async function signUp() {
  await page.evaluate(async () => {
    openAuth('signup'); await __amvAuthOpen();
    const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Rui'); type('#a-email', 'rui@example.com'); type('#a-pass', 'A-real-Passw0rd!');
    document.getElementById('auth-submit').click(); await __amvSignedIn();
  });
  await env.AMV_KV.put('ent:rui@example.com', JSON.stringify({ plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  await page.evaluate(async () => { try { await syncEntitlement(); } catch (e) {} });
}

const PROJ_CTX = 119000;

const sse = (blocks) => ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } })
  + blocks.map(b => b.map(([t, d]) => ev(t, d)).join('')).join('')
  + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 30 } })
  + ev('message_stop', { type: 'message_stop' });
const A = 'https://www.ecb.europa.eu/press/rates.html', B = 'https://www.reuters.com/markets/ecb', C = 'https://blocked.example.com/paywall';
const turn = sse([
  [['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'ECB rates' } } }],
   ['content_block_stop', { type: 'content_block_stop', index: 0 }]],
  [['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'web_search_tool_result', tool_use_id: 's1', content: [
     { type: 'web_search_result', url: A, title: 'Key ECB interest rates' }, { type: 'web_search_result', url: B, title: 'ECB holds' }, { type: 'web_search_result', url: C, title: 'Paywalled' }] } }],
   ['content_block_stop', { type: 'content_block_stop', index: 1 }]],
  [['content_block_start', { type: 'content_block_start', index: 2, content_block: { type: 'server_tool_use', id: 'f1', name: 'web_fetch', input: {} } }],
   ['content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ url: A }) } }],
   ['content_block_stop', { type: 'content_block_stop', index: 2 }]],
  [['content_block_start', { type: 'content_block_start', index: 3, content_block: { type: 'web_fetch_tool_result', tool_use_id: 'f1', content: { type: 'web_fetch_result', url: A, content: { type: 'document', title: 'Key ECB interest rates', source: { type: 'text', media_type: 'text/plain', data: 'The deposit facility rate is 2.00%.' } } } } }],
   ['content_block_stop', { type: 'content_block_stop', index: 3 }]],
  [['content_block_start', { type: 'content_block_start', index: 4, content_block: { type: 'server_tool_use', id: 'f2', name: 'web_fetch', input: { url: C } } }],
   ['content_block_stop', { type: 'content_block_stop', index: 4 }]],
  [['content_block_start', { type: 'content_block_start', index: 5, content_block: { type: 'web_fetch_tool_result', tool_use_id: 'f2', content: { type: 'web_fetch_tool_error', error_code: 'url_not_accessible' } } }],
   ['content_block_stop', { type: 'content_block_stop', index: 5 }]],
  [['content_block_start', { type: 'content_block_start', index: 6, content_block: { type: 'text', text: '' } }],
   ['content_block_delta', { type: 'content_block_delta', index: 6, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: A, title: 'Key ECB interest rates', cited_text: 'The deposit facility rate is 2.00%.' } } }],
   ['content_block_delta', { type: 'content_block_delta', index: 6, delta: { type: 'text_delta', text: 'The ECB deposit rate is 2.00%.' } }],
   ['content_block_stop', { type: 'content_block_stop', index: 6 }]],
]);

await signUp();
nextTurns = [turn];
await say('What is the ECB deposit rate today?');

section('The engine is offered a way to open pages - bounded by the server');
{
  const req = modelSaw[modelSaw.length - 1] || {};
  const f = (req.tools || []).find(t => t.type === 'web_fetch_20250910');
  ok(f && f.name === 'web_fetch', 'web_fetch is offered alongside web search', (req.tools || []).filter(t => t.type).map(t => t.type));
  ok(f && f.max_uses <= 20 && f.max_content_tokens <= 20000, 'with how many pages and how much of each bounded', f);
}

section('Found, read and cited are three things, shown as three');
{
  const r = await page.evaluate(([A, B, C]) => {
    const p = document.querySelector('#cm .rsrc-panel.done') || document.querySelector('#cm .rsrc-panel');
    const chip = (u) => [...p.querySelectorAll('.rsrc-chip')].find(a => a.getAttribute('href') === u);
    return { head: p.querySelector('.rsrc-head').textContent,
      trail: [...p.querySelectorAll('.rsrc-q')].map(l => l.textContent),
      aRead: chip(A) && chip(A).classList.contains('read'), aTitle: chip(A) && chip(A).title,
      bRead: chip(B) && chip(B).classList.contains('read'), bTitle: chip(B) && chip(B).title,
      cRead: chip(C) && chip(C).classList.contains('read') };
  }, [A, B, C]);
  ok(/1 read/.test(r.head) && /1 cited/.test(r.head), 'the summary counts what was read and what was cited', r.head);
  ok(r.trail.some(t => /^Read\s+ecb\.europa\.eu/.test(t)), 'the trail says which page was opened', r.trail);
  ok(r.trail.some(t => /^Could not open\s+blocked\.example\.com/.test(t)) && !r.cRead, 'a page that could not be opened says so, and is not marked read', r.trail);
  ok(r.aRead && /opened and read by AMV/.test(r.aTitle) && /cited in the answer/.test(r.aTitle), 'the opened page is marked read, and cited', r.aTitle);
  ok(!r.bRead && /found in search results/.test(r.bTitle), 'one only found says found - not read', r.bTitle);
}

ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 3));
await L.close();
if (report('a-source-is-found-read-and-cited') > 0) process.exitCode = 1;
done();
