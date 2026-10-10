/* PARTNER ENGINES: OTHER COMPANIES' MODELS, SOLD AS AMV ENGINES.

   A partner is an endpoint speaking the shared chat-completions protocol,
   configured by AMV_PARTNER_URL, AMV_PARTNER_KEY and AMV_PARTNER_ENGINES.
   Driven through the Worker's /v1/engines and /v1/messages with the partner
   stood in for:

   - with nothing configured, no partner engine is listed and asking for one
     is refused as unavailable - never silently answered by another engine;
   - an engine whose model the partner does not list is not offered;
   - a live engine is listed with its AMV name, never the partner's model id;
   - the request is translated: AMV's identity first, the person's system
     text, tool results as tool messages, tools as functions, the partner's
     own token parameter, and the model id the partner knows;
   - the partner's stream comes back as AMV's own event stream - text, a
     tool call with its arguments, the stop reason - and the turn is settled
     at the engine's own prices;
   - the plan floor holds;
   - a malformed engine entry (no price) is dropped, not guessed at. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'partner.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, _partnerEngineDefs, _partnerRequest };\n');
const W = await import(harness + '?t=' + Date.now());

const PARTNER = 'https://partner.example/v1';
const ENGINES_CFG = JSON.stringify([
  { key: 'amv-vega', model: 'vendor-large-2', label: 'AMV Vega', minPlan: 'pro', inCost: 3, outCost: 12, maxOut: 16000, tools: true },
  { key: 'amv-lyra', model: 'vendor-not-listed', label: 'AMV Lyra', minPlan: 'pro', inCost: 1, outCost: 4, maxOut: 8000 },
  { key: 'amv-bad', model: 'vendor-x', label: 'No price', minPlan: 'pro', maxOut: 8000 },
]);
let partnerCalls = [], modelCalls = 0, listed = ['vendor-large-2', 'vendor-small-1'];
const chunk = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u === PARTNER + '/models') return new Response(JSON.stringify({ data: listed.map(id => ({ id })) }), { status: 200 });
  if (u === PARTNER + '/chat/completions') {
    partnerCalls.push({ body: JSON.parse(init.body), auth: (init.headers || {}).Authorization });
    const s = chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: 'Let me ' } }] })
      + chunk({ choices: [{ index: 0, delta: { content: 'check.' } }] })
      + chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'crew_list', arguments: '{"q":' } }] } }] })
      + chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"weather"}' } }] } }] })
      + chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
      + chunk({ choices: [], usage: { prompt_tokens: 2000, completion_tokens: 500 } })
      + 'data: [DONE]\n\n';
    return new Response(s, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (/model\.example/.test(u)) { modelCalls++; return new Response('data: {"type":"message_stop"}\n\n', { status: 200 }); }
  return new Response('{}', { status: 200 });
};

function mkEnv(partner) {
  const m = new Map(), vals = new Map();
  return Object.assign({
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example', JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    GLOBAL_DAILY_USD_CAP: '100000', _vals: vals,
    AMV_KV: { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
    AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body || '{}'); const cur = vals.get(n) || 0; const r = (o) => new Response(JSON.stringify(o));
      if (b.op === 'reserve') { vals.set(n, cur + Number(b.amount || 0)); return r({ allowed: true, value: vals.get(n) }); }
      if (b.op === 'incr') { vals.set(n, cur + Number(b.amount || 0)); return r({ value: vals.get(n) }); }
      if (b.op === 'get') return r({ value: cur });
      return r({ allowed: true, value: cur, count: 1 });
    } }) },
  }, partner ? { AMV_PARTNER_URL: PARTNER, AMV_PARTNER_KEY: 'pk-test', AMV_PARTNER_ENGINES: ENGINES_CFG } : {});
}
const waits = [];
const ctx = { waitUntil(p) { waits.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {} };
const settle = async () => { await Promise.all(waits.splice(0)); };
const req = (env, path, body, tok, method) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: method || 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: method === 'GET' ? undefined : JSON.stringify(body) }), env, ctx);
async function account(env, plan) {
  const email = plan + '-p' + Math.random().toString(36).slice(2, 6) + '@example.com';
  const tok = (await (await req(env, '/auth/signup', { email, name: 'P', password: 'A-real-Passw0rd!' })).json()).token;
  if (plan !== 'free') await W.DB.put(env, 'ent', email, { plan, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return { tok, email };
}
const TURN = {
  model: 'amv-vega', max_tokens: 4000, system: 'Answer in Spanish.',
  tools: [{ name: 'crew_list', description: 'List the person\'s background jobs', input_schema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } }],
  messages: [
    { role: 'user', content: 'Weather in Madrid?' },
    { role: 'assistant', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'call_0', name: 'crew_list', input: { q: 'madrid weather' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_0', content: '22C and sunny' }, { type: 'text', text: 'And tomorrow?' }] },
  ],
};

section('Nothing configured: no partner engine, and asking for one is refused honestly');
{
  const env = mkEnv(false);
  const a = await account(env, 'pro');
  const list = await (await req(env, '/v1/engines', null, a.tok, 'GET')).json();
  ok(list.ok && Array.isArray(list.engines) && !list.engines.some(e => e.key === 'amv-vega'), 'the engine list has no partner engine', list);
  modelCalls = 0;
  const r = await req(env, '/v1/messages', TURN, a.tok);
  const d = await r.json().catch(() => ({}));
  ok(r.status === 503 && d.code === 'engine_unavailable' && modelCalls === 0, 'asking for it is refused as unavailable, and no other engine answers instead', { status: r.status, d, modelCalls });
}

section('Configured: only engines whose model the partner lists are offered');
{
  const env = mkEnv(true);
  const a = await account(env, 'pro');
  const list = await (await req(env, '/v1/engines', null, a.tok, 'GET')).json();
  const keys = list.engines.map(e => e.key);
  ok(keys.includes('amv-vega') && !keys.includes('amv-lyra') && !keys.includes('amv-bad'), 'Vega is live; Lyra (not listed) and the priceless entry are not', keys);
  const vega = list.engines.find(e => e.key === 'amv-vega');
  ok(vega.label === 'AMV Vega' && !JSON.stringify(list).includes('vendor-'), 'listed by its AMV name; the partner’s model id never leaves the server', vega);
  ok(W._partnerEngineDefs(env).every(d => d.key !== 'amv-bad'), 'an entry with no price is dropped, not guessed at');
}

section('A turn is translated there and back, and settled at the engine’s prices');
{
  const env = mkEnv(true);
  const a = await account(env, 'pro');
  partnerCalls = [];
  const r = await req(env, '/v1/messages', TURN, a.tok);
  const body = await r.text(); await settle();
  ok(r.status === 200 && r.headers.get('X-AMV-Engine') === 'amv-vega', 'answered by Vega', r.status);
  const sent = partnerCalls[0] && partnerCalls[0].body;
  ok(sent && sent.model === 'vendor-large-2' && partnerCalls[0].auth === 'Bearer pk-test' && sent.stream === true, 'sent to the partner, as its model, with its key, streaming', sent && sent.model);
  ok(sent.messages[0].role === 'system' && /AMV/.test(sent.messages[0].content) && /Answer in Spanish\./.test(sent.messages[0].content), 'AMV’s identity comes first, with the person’s instructions', sent.messages[0].content.slice(0, 120));
  const roles = sent.messages.map(m => m.role).join(',');
  ok(roles === 'system,user,assistant,tool,user', 'the conversation keeps its order, with the tool result as a tool message', roles);
  ok(sent.messages[2].tool_calls[0].function.name === 'crew_list' && JSON.parse(sent.messages[2].tool_calls[0].function.arguments).q === 'madrid weather', 'the earlier tool call is carried over');
  ok(sent.messages[3].tool_call_id === 'call_0' && sent.messages[3].content === '22C and sunny', 'and its result answers it');
  ok(sent.tools[0].type === 'function' && sent.tools[0].function.name === 'crew_list' && sent.max_completion_tokens === 4000, 'tools as functions, and the partner’s token parameter', sent.tools[0]);
  ok(/"text_delta","text":"Let me "/.test(body) && /"text":"check\."/.test(body), 'the text streams back in AMV’s events');
  ok(/"type":"tool_use","id":"call_1","name":"crew_list"/.test(body) && /"partial_json":"\{\\"q\\":"/.test(body), 'the tool call comes back as a tool use with its arguments');
  ok(/"stop_reason":"tool_use"/.test(body), 'and the stop reason says a tool was asked for');
  const usd = [...env._vals.entries()].filter(([k]) => k.startsWith('cost:')).reduce((n, [, v]) => n + v, 0);
  ok(Math.abs(usd - (2000 * 3 + 500 * 12) / 1e6) < 0.002, 'settled at Vega’s own prices: 2k in at $3/M + 500 out at $12/M = $0.012', usd);
}

section('A tool AMV does not offer never reaches a partner either');
{
  const env = mkEnv(true);
  const a = await account(env, 'pro');
  partnerCalls = [];
  const turn = Object.assign({}, TURN, { tools: TURN.tools.concat([{ name: 'wire_money', description: 'x', input_schema: { type: 'object', properties: {} } }]) });
  const r = await req(env, '/v1/messages', turn, a.tok); await r.text(); await settle();
  const names = ((partnerCalls[0] && partnerCalls[0].body.tools) || []).map(t => t.function.name);
  ok(names.length === 1 && names[0] === 'crew_list', 'only the tools on AMV’s own list are passed on', names);
}

section('The plan floor holds');
{
  const env = mkEnv(true);
  const a = await account(env, 'free');
  partnerCalls = [];
  const r = await req(env, '/v1/messages', TURN, a.tok);
  const d = await r.json().catch(() => ({}));
  ok(r.status === 402 && d.code === 'plan_required' && partnerCalls.length === 0, 'a free account is refused before the partner is called', { status: r.status, d });
}

if (report('partner-engines') > 0) process.exitCode = 1;
done();
