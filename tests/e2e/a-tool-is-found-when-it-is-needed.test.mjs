/* A TOOL IS FOUND WHEN IT IS NEEDED, NOT SENT WITH EVERY MESSAGE.

   Every tool offered is read by the engine on every request. AMV's own are
   cached and named in its instructions, so they always go; a person's
   connectors can bring hundreds, and the server takes at most 128 tools and
   silently drops the rest - so past a dozen, connector tools are found by
   tool_search instead. Driven through the real composer and the real Worker
   (which must forward tool_search at all), with the model's choices scripted:

   - with many connector tools, the request carries AMV's own tools and
     tool_search - naming each connector and how many tools it has - and not
     the connectors' tools;
   - searching switches on the matching tools, which the next round of the
     same turn carries, and they stay on for the conversation;
   - a connector tool that was not switched on cannot run: the model is told
     to search for it;
   - with only a few connector tools, they are all sent and there is no
     search. */
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
  APP_URL: 'http://localhost:9249', AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
  AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0; const r = o => new Response(JSON.stringify(o));
    if (b.op === 'reserve') { vals.set(n, cur + b.amount); return r({ allowed: true, value: vals.get(n) }); }
    if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur });
  } }) },
});
const L = await bootLive({ env, outbound, port: 9249 });
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
/* Two connected apps with their own tools, as the page holds them. */
const connect = (counts) => page.evaluate((counts) => {
  window.remoteRefreshTools = async () => {};
  for (const id of Object.keys(MCP.remote)) delete MCP.remote[id];
  for (const [slug, name, n, verbs] of counts) {
    MCP.remote['app-' + slug] = { slug, name, kind: 'app', at: Date.now(), error: '',
      tools: Array.from({ length: n }, (_, i) => ({ name: verbs[i % verbs.length] + '_' + i, description: name + ' ' + verbs[i % verbs.length].replace(/_/g, ' ') + ' number ' + i,
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } } })) };
  }
}, counts);

section('Signed in, with two connected apps bringing 33 tools');
{
  await page.evaluate(async () => {
    openAuth('signup'); await __amvAuthOpen();
    const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Tools'); type('#a-email', 'tools@example.com'); type('#a-pass', 'A-real-Passw0rd!');
    document.getElementById('auth-submit').click(); await __amvSignedIn();
  });
  await env.AMV_KV.put('ent:tools@example.com', JSON.stringify({ plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  await page.evaluate(async () => { try { await syncEntitlement(); } catch (e) {} });
  await connect([['bigcrm', 'BigCRM', 30, ['list_contacts', 'create_deal', 'update_deal', 'export_report', 'delete_contact']], ['notes', 'Notes', 3, ['create_note']]]);
  ok(true, 'ready');
}

section('The request carries AMV’s tools and tool_search, not the connectors’');
{
  nextTurns = [toolUse('tool_search', { query: 'create a deal in BigCRM' }), text('Found it.')];
  await say('make a deal for Acme in my CRM');
  const first = modelSaw[modelSaw.length - 2], second = modelSaw[modelSaw.length - 1];
  const n1 = names(first);
  ok(n1.includes('tool_search') && n1.includes('crew_add') && n1.includes('memory_add'), 'AMV’s own tools and tool_search are there', n1.length);
  ok(!n1.some(n => /^mcp__/.test(n)), 'and none of the 33 connector tools', n1.filter(n => /^mcp__/.test(n)).length);
  const ts = (first.tools || []).find(t => t.name === 'tool_search') || {};
  ok(/BigCRM \(30\)/.test(ts.description) && /Notes \(3\)/.test(ts.description), 'the search names each app and how many tools it has', ts.description && ts.description.slice(0, 260));
  ok(String(ts.description || '').length <= 1200, 'within what the server forwards', String(ts.description || '').length);
  const n2 = names(second);
  const crm = n2.filter(n => /^mcp__/.test(n));
  ok(crm.length > 0 && crm.length <= 8 && crm.some(n => /create_deal/.test(n)), 'the next round of the same turn carries the matching tools - only those', crm);
  ok(/Switched on/.test(lastToolResult()) && /create_deal/.test(lastToolResult()), 'and the model was told what was switched on', lastToolResult().slice(0, 160));
}

section('What was switched on stays on for the conversation');
{
  nextTurns = [text('Sure.')];
  await say('and another one');
  const crm = names(modelSaw[modelSaw.length - 1]).filter(n => /^mcp__/.test(n));
  ok(crm.some(n => /create_deal/.test(n)) && crm.length <= 8, 'the next message still carries them', crm);
}

section('A connector tool that was not switched on cannot run');
{
  const del = await page.evaluate(() => mcpTools({ remote: true }).map(t => t.name).find(n => /delete_contact/.test(n)));
  nextTurns = [toolUse(del, { id: 'c1' }), text('I could not.')];
  await say('delete contact c1');
  const said = lastToolResult();
  ok(/not switched on yet/.test(said) && /tool_search/.test(said), 'the model is told to search for it, and it did not run', said.slice(0, 160));
  const asked = await page.evaluate(() => !!document.getElementById('modal-ok'));
  ok(!asked, 'nobody was asked to approve a tool that was not offered');
}

section('With only a few connector tools, all are sent and there is no search');
{
  await connect([['notes', 'Notes', 3, ['create_note']]]);
  await page.evaluate(() => newChat());
  nextTurns = [text('Hi.')];
  await say('hello');
  const n = names(modelSaw[modelSaw.length - 1]);
  ok(n.filter(x => /^mcp__/.test(x)).length === 3 && !n.includes('tool_search'), 'three tools, sent whole', n.filter(x => /^mcp__|tool_search/.test(x)));
}

ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 3));
await L.close();
if (report('a-tool-is-found-when-it-is-needed') > 0) process.exitCode = 1;
done();
