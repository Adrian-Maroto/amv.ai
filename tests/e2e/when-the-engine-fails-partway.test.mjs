/* WHEN THE ENGINE FAILS PARTWAY, THE PERSON IS TOLD WHAT HAPPENED - IN THEIR LANGUAGE.

   An engine that is overloaded says so inside a stream that has already
   begun: an `error` event, then nothing. Chat read only the events it knew,
   so with nothing written it showed "(no response)" - no reason, no Retry -
   and with part of an answer it blamed the person's connection. And the
   chat's own error cards ("Retry", "See plans", "The connection dropped...")
   were English in all seventeen languages: none of it was in the dictionary.

   Through the real page and server:
   - overloaded before a word: an error that says the engines are busy, with
     Retry;
   - overloaded partway: the part is kept and marked as cut off by the
     engine, not by the connection;
   - in Spanish, the card and its button are in Spanish. */
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
  APP_URL: 'http://localhost:9254', AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
  AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0; const r = o => new Response(JSON.stringify(o));
    if (b.op === 'reserve') { vals.set(n, cur + b.amount); return r({ allowed: true, value: vals.get(n) }); }
    if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur });
  } }) },
});
const L = await bootLive({ env, outbound, port: 9254 });
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

const start = ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } });
const overloaded = 'event: error\ndata: ' + JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }) + '\n\n';
const partial = start + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The first half of the answer' } }) + overloaded;
const last = () => page.evaluate(() => {
  const m = (getMsgs() || []).slice(-1)[0] || {};
  const b = [...document.querySelectorAll('.mr:not(.u)')].slice(-1)[0];
  return { m: { c: m.c, err: m._error, cut: m._interrupted }, text: b ? b.innerText : '', retry: b ? [...b.querySelectorAll('[data-action="retry-ai"]')].map(x => x.textContent) : [] };
});

await signUp();

section('Overloaded before a word: an error that says so, with Retry');
{
  nextTurns = [start + overloaded];
  await say('What is the capital of Peru?');
  const r = await last();
  ok(/very busy/.test(r.m.err || '') && r.m.c !== '(no response)', 'the engines are said to be busy - not "(no response)"', r.m);
  ok(r.retry.length === 1, 'and a Retry is offered', r.retry);
}

section('Overloaded partway: the part is kept, and the engine is named as what stopped');
{
  nextTurns = [partial];
  await say('Tell me about Lima.');
  const r = await last();
  ok(/The first half of the answer/.test(r.text) && r.m.cut === 'engine', 'what arrived is kept, marked as cut off by the engine', r.m);
  ok(/The engine stopped partway through/.test(r.text) && !/connection dropped/.test(r.text), 'and the banner says the engine stopped, not the connection', r.text.slice(-200));
}

section('In Spanish, the card and its button are in Spanish');
{
  await page.evaluate(async () => {
    saveStr('amv_lang', 'es'); _translateUI();
    for (let i = 0; i < 50 && !_i18nPackHave('es'); i++) await new Promise(s => setTimeout(s, 100));
  });
  nextTurns = [start + overloaded];
  await say('¿Cuál es la capital de Chile?');
  const r = await last();
  ok(/muy ocupados/.test(r.text), 'the reason is in Spanish', r.text.slice(0, 200));
  ok(r.retry[0] === 'Reintentar', 'and so is the button', r.retry);
  await page.evaluate(() => { saveStr('amv_lang', 'en'); _translateUI(); });
}

ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 3));
await L.close();
if (report('when-the-engine-fails-partway') > 0) process.exitCode = 1;
done();
