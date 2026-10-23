/* A MESSAGE IN SLACK STARTS A JOB.

   "When somebody posts an order in #orders, summarise it" needs no Slack app
   registered by AMV: the person's own Slack app sends its events to a job's
   address, signed with the app's Signing Secret (70-hooks.js). This drives
   that whole conversation with Slack's real shapes, signed the way Slack signs:

     - Slack's set-up question is answered, so the address can be saved in
       the app's Event Subscriptions;
     - a message event that matches the job's words is queued, and the run
       reads the message - fenced, as material;
     - one that does not match costs nothing and is not kept;
     - Slack's retry of the same event (X-Slack-Retry-Num) is one event;
     - a message posted by a bot - including anything the job itself causes
       to be posted - is the app's own echo, and starts nothing;
     - and a request without the app's signature starts nothing. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHmac } from 'crypto';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'slackhooks.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `
export { runDueAutomations, issueTokens };
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'slack@test.com';
const store = new Map();
const vals = new Map();
let rateCap = 1000;
let afterRead = null;
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
  CONNECT_KEY: 'a-connect-key-for-sealing-at-least-32-chars',
  AMV_MODEL_KEY: 'k', AMV_KV: {
    async get(k){
      const v = store.has(k) ? store.get(k) : null;
      /* A request that lands just after the tick has read the job, before
         its run has begun: in the record, not in the tick's copy. */
      if (k === 'auto:' + ME && afterRead) { const f = afterRead; afterRead = null; f(); }
      return v;
    },
    async put(k, v){ store.set(k, v); },
    async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: {
    idFromName: (n) => n,
    get: (n) => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
      if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: n.startsWith('act:hook:') ? cur + 1 <= rateCap : true })); }
      if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: vals.get(n) })); }
      if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
      return new Response(JSON.stringify({ allowed: true, ok: true, value: cur }));
    } }),
  } };
const ctx = { waitUntil(){}, passThroughOnException(){} };
store.set('ent:' + ME, JSON.stringify({ plan: 'ultra', renewedAt: Date.now() }));
const pair = await W.issueTokens(env, ME, 'Slack');

let prompts = [];
let duringRun = null;
globalThis.fetch = async (url, init) => {
  let b = {}; try { b = JSON.parse(String((init && init.body) || '{}')); } catch (e) {}
  const m = (b.messages || [])[(b.messages || []).length - 1];
  prompts.push(typeof (m && m.content) === 'string' ? m.content : JSON.stringify(m && m.content));
  if (duringRun) { const f = duringRun; duringRun = null; await f(); }
  return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Order 1042 is for two lamps.' }], stop_reason: 'end_turn',
    usage: { input_tokens: 900, output_tokens: 40 } }), { status: 200 });
};
let ip = 1;
const post = async (path, body, e = env) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + pair.token, Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.6.' + (ip++ % 250) },
    body: JSON.stringify(body) }), e, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
/* A request from the other service: no sign-in, no Origin, just the address. */
const send = async (url, body, headers = {}, method = 'POST') => {
  const r = await W.default.fetch(new Request(url, { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '7.7.7.7', ...headers },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
const rec = () => JSON.parse(store.get('auto:' + ME) || '{"items":[],"results":[]}');
const job = (id) => rec().items.find(x => x.id === id);
const tickAt = async (t) => { await W.runDueAutomations(env, t); return rec(); };


const hmacHex = (key, text) => createHmac('sha256', key).update(text).digest('hex');
const nowS = () => Math.floor(Date.now() / 1000);
let n = 0;
const make = async (words) => {
  const r = await post('/auto/create', { detail: 'Summarise what arrived.', repeat: '10min', approval: 'auto', when: { source: 'hook', ...(words ? { words } : {}) } });
  return { url: r.d.hookUrl, id: r.d.item && r.d.item.id };
};
const sign = (id, kind, secret) => post('/auto/hook', { id, action: 'sign', kind, ...(secret ? { secret } : {}) });
const payload = (tag) => JSON.stringify({ event: 'order.created', order: { id: tag, n: ++n } });


const SECRET = '8f742231b10e8888abcd99yyyzzz85a5'.replace(/[yz]/g, '0');
const slackHead = (b, t = Math.floor(Date.now() / 1000), k = SECRET) => ({ 'Content-Type': 'application/json',
  'X-Slack-Request-Timestamp': String(t), 'X-Slack-Signature': 'v0=' + createHmac('sha256', k).update('v0:' + t + ':' + b).digest('hex') });
const event = (text, extra = {}) => JSON.stringify({ token: 'x', team_id: 'T1', api_app_id: 'A1', type: 'event_callback',
  event_id: 'Ev' + (++n), event_time: Math.floor(Date.now() / 1000),
  event: { type: 'message', channel: 'C1', user: 'U1', text, ts: String(Date.now() / 1000), ...extra } });

let url = '', id = '';
section('Set up: the address passes Slack’s check');
{
  const r = await post('/auto/create', { detail: 'Summarise the new order posted in Slack.', repeat: '10min', approval: 'auto', when: { source: 'hook', words: ['order'] } });
  url = r.d.hookUrl; id = r.d.item.id;
  const s = await post('/auto/hook', { id, action: 'sign', kind: 'slack', secret: SECRET });
  ok(s.status === 200 && s.d.signed === 'slack', 'the job takes the app’s Signing Secret', s.d);
  const ch = JSON.stringify({ token: 'x', challenge: 'c-7781', type: 'url_verification' });
  const v = await send(url, ch, slackHead(ch));
  ok(v.status === 200 && v.d.challenge === 'c-7781', 'Slack’s question is answered, so the Request URL saves', v.d);
}

section('A matching message starts it, read as material');
{
  const b = event('New order 5521: two lamps for Kim');
  const r = await send(url, b, slackHead(b));
  ok(r.status === 202 && r.d.queued === 1, 'it is accepted and queued', r);
  prompts = [];
  await tickAt(Date.now() + 60e3);
  ok(prompts.length === 1 && /New order 5521/.test(prompts[0]) && /Summarise the new order/.test(prompts[0]), 'the run reads the message and the job’s instruction', (prompts[0] || '').slice(0, 200));
  const last = (rec().results || []).slice(-1)[0] || {};
  ok(last.outcome !== 'needs_access', 'and does not stop to ask for a Slack connection: the message is already in hand, and nothing is being posted', last.outcome);
}

section('Slack’s retry is the same event');
{
  const b = event('Order 6001 for Ana');
  const one = await send(url, b, slackHead(b));
  const again = await send(url, b, { ...slackHead(b), 'X-Slack-Retry-Num': '1', 'X-Slack-Retry-Reason': 'http_timeout' });
  ok(one.status === 202 && again.status === 200 && again.d.duplicate, 'sent twice, kept once', [one.status, again.status, again.d]);
}

section('What does not match, and what a bot posted, start nothing');
{
  const before = (job(id).hookIn || []).length;
  const chat = event('lunch at noon?');
  const c = await send(url, chat, slackHead(chat));
  ok(c.status === 202 && c.d.matched === false, 'a message without the words is acknowledged and not kept', c.d);
  const bot = event('Order summary: 6001 for Ana', { bot_id: 'B1', subtype: 'bot_message', user: undefined });
  const bb = await send(url, bot, slackHead(bot));
  ok(bb.status === 202 && bb.d.matched === false && bb.d.bot === true, 'a bot’s message - the job’s own echo included - starts nothing', bb.d);
  ok((job(id).hookIn || []).length === before, 'and neither is kept', (job(id).hookIn || []).length);
}

section('Without the app’s signature, nothing');
{
  const b = event('Order 7000 forged');
  const f = await send(url, b, slackHead(b, undefined, 'ffffffffffffffffffffffffffffffff'));
  ok(f.status === 401, 'a forged message is refused', f);
  const plain = await send(url, b, { 'Content-Type': 'application/json' });
  ok(plain.status === 401 && plain.d.code === 'signature_required', 'and so is the address alone', plain.d);
}

if (report('a-slack-message-starts-a-job') > 0) process.exitCode = 1;
done();
