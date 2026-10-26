/* A SEARCH FINDS IT IN OTHER WORDS, AND A PROJECT CAN BE SEARCHED AGAIN.

   Audit #18. Search over somebody's files and chats is by words, on their
   device. Words miss a document that says it differently: "sales growth"
   finds nothing in a report that says "top-line revenue expansion". The
   engine calling the search already knows the other ways it could be said,
   so each search takes them as `also` - in the same call, with nothing sent
   anywhere but the words it chose - and a search that finds nothing says to
   try once more that way before telling anybody their file is silent.

   And a project too large for one message used to carry only the passages
   matching the latest message, with the engine told to "say which part" it
   needed. It can now look for that part itself: project_search, offered only
   while the files are too large to send whole.

   Through the real page, the real server and the real send path:
   - project_search is offered for a large project and not for a small one;
   - the words alone find nothing, and the answer says to try other words;
   - the same call with `also` finds the passage, and says what it searched;
   - the person's own wording still outranks an alternative's;
   - and the past-chat search takes `also` the same way.

   Sending a large project through the real server is also what found that
   the server refused it: AMV's instructions plus the 120,000 characters a
   project may carry were over its 100,000-character bound on a system
   prompt, so every project past about 80,000 characters failed with "system
   prompt too large". The first section here sends one whole, at the edge. */
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
  APP_URL: 'http://localhost:9252', AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
  AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0; const r = o => new Response(JSON.stringify(o));
    if (b.op === 'reserve') { vals.set(n, cur + b.amount); return r({ allowed: true, value: vals.get(n) }); }
    if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur });
  } }) },
});
const L = await bootLive({ env, outbound, port: 9252 });
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
section('Signed in, in a project whose files are larger than one message');
{
  await signUp();
  await page.evaluate(() => {
    const W = 'harbour lantern meadow quarry ribbon saddle timber velvet willow anchor blossom candle dolphin ember falcon glacier hollow island jasmine kettle'.split(' ');
    let n = 11;
    const filler = (chars) => { let s = ''; while (s.length < chars) { n = (n * 1103515245 + 12345) % 2147483648; s += W[n % W.length] + (n % 9 === 0 ? '.\n' : ' '); } return s; };
    window.__big = [
      { id: 'b2', name: 'board-pack.txt', text: filler(70000) + '\nTop-line revenue expansion reached 14 percent in the third quarter, led by Iberia.\n' + filler(60000), added: 2 },
      { id: 'b1', name: 'minutes.txt', text: filler(30000) + '\nThe chair noted sales growth as the first agenda item for next year.\n' + filler(10000), added: 1 },
    ];
    const ws = { id: 'wsQ', name: 'Quarterly', icon: '📈', desc: '', created: Date.now(), convs: [] };
    S.workspaces = [ws].concat(S.workspaces || []);
    _saveWorkspaces(S.workspaces);
    _projSaveFiles('wsQ', [{ id: 's1', name: 'short.txt', text: 'Revenue rose a little.', added: 1 }]);
    const c = newConvObj('t'); c.wsId = 'wsQ'; S.convs.unshift(c); S.cur = c.id;
  });
  ok(await page.evaluate(() => projectToolsOffered().length === 0), 'a project small enough to send whole is not offered a search - there is nothing to find', true);
  await page.evaluate(() => _projSaveFiles('wsQ', window.__big));
  ok(await page.evaluate(() => projectToolsOffered().map(t => t.name).join()) === 'project_search', 'a large one is', true);
}

section('A project at the edge of what goes whole reaches the engine');
{
  await page.evaluate(() => _projSaveFiles('wsQ', [{ id: 'e1', name: 'edge.txt', text: window.__big[0].text.slice(0, PROJ_CTX_CHARS - 500), added: 1 }]));
  nextTurns = [text('Read it.')];
  await say('Summarise the file.');
  const raw = (modelSaw[modelSaw.length - 1] || {}).system || '';
  /* Sent as blocks, so the stable part can be cached. */
  const sys = Array.isArray(raw) ? raw.map(b => b && b.text || '').join('') : String(raw);
  ok(sys.length > PROJ_CTX && /=== edge\.txt ===/.test(sys), 'the files, whole, are in what the engine received', sys.length);
  const err = await page.evaluate(() => (getCurConv().msgs.slice(-1)[0] || {})._error || '');
  ok(!err, 'and nothing was refused on the way', err);
  await page.evaluate(() => _projSaveFiles('wsQ', window.__big));
}

section('The words alone find nothing, and the engine is told to try other words');
{
  nextTurns = [toolUse('project_search', { query: 'annual earnings' }), text('Nothing.')];
  await say('How much did annual earnings improve?');
  const first = modelSaw[modelSaw.length - 2];
  ok(names(first).includes('project_search'), 'the request offers project_search', names(first).filter(n => /search/.test(n)));
  const ps = (first.tools || []).find(t => t.name === 'project_search') || {};
  ok(ps.input_schema && ps.input_schema.properties && ps.input_schema.properties.also, 'and it takes other phrasings as "also"', Object.keys((ps.input_schema || {}).properties || {}));
  const said = lastToolResult();
  ok(/nothing in them matches/.test(said) && /search once more with those as "also"/.test(said), 'the result says nothing matched and to try other words before concluding', said.slice(0, 260));
  ok(!/14 percent/.test(said), 'and hands back nothing pretending to be a match', true);
}

section('The same search with other phrasings finds the passage');
{
  nextTurns = [toolUse('project_search', { query: 'annual earnings', also: ['revenue expansion', 'top-line', 'ingresos'] }), text('14 percent.')];
  await say('Try again.');
  const said = lastToolResult();
  ok(/Top-line revenue expansion reached 14 percent/.test(said), 'the passage that said it differently is found', said.slice(0, 200));
  ok(/for "annual earnings" \(and "revenue expansion", "top-line", "ingresos"\)/.test(said), 'and the result says exactly what was searched for', said.slice(0, 200));
  ok(/=== board-pack\.txt - passage \d+ of \d+ ===/.test(said), 'named by file and passage', true);
  ok(!/search once more/.test(said), 'with no advice to retry once it has', true);
}

section('The person’s own words still come first');
{
  const order = await page.evaluate(async () => {
    const out = await window.amvProjectFileSearch({ query: 'sales growth', also: ['revenue expansion'] });
    return [out.indexOf('sales growth as the first agenda item'), out.indexOf('revenue expansion reached')];
  });
  ok(order[0] > -1 && order[1] > -1, 'both passages are found', order);
  const best = await page.evaluate(() => amvProjectSearch(window.__big, [{ text: 'sales growth', weight: 1 }, { text: 'revenue expansion', weight: 0.6 }], 1700).passages.map(p => p.name));
  ok(best.join() === 'minutes.txt', 'with room for one passage, it is the one in the person’s own words', best);
  const capped = await page.evaluate(() => window.amvProjectFileSearch({ query: 'x', also: Array.from({ length: 20 }, (_, i) => 'alt' + i) }));
  ok(/"alt5"/.test(capped) && !/"alt6"/.test(capped), 'at most six alternatives are searched', capped.slice(0, 200));
}

section('Past chats take other phrasings the same way');
{
  await page.evaluate(() => {
    const c = newConvObj('t'); c.wsId = 'wsQ'; c.title = 'Pricing'; c.msgs = [{ r: 'u', c: 'We agreed the monthly subscription fee is 19 euros.' }, { r: 'a', c: 'Noted: 19 euros a month.' }];
    S.convs.push(c);
  });
  const r = await page.evaluate(async () => [await window.amvChatSearch({ query: 'what does it cost' }), await window.amvChatSearch({ query: 'what does it cost', also: ['subscription fee'] })]);
  ok(/none of them matches/.test(r[0]) && /"also"/.test(r[0]), 'the words alone find nothing, and it says to try others', r[0].slice(0, 200));
  ok(/19 euros/.test(r[1]) && /\(and "subscription fee"\)/.test(r[1]), 'with them, the conversation is found', r[1].slice(0, 200));
}

ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 3));
await L.close();
if (report('a-search-finds-it-in-other-words') > 0) process.exitCode = 1;
done();
