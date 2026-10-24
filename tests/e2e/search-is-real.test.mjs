/* IF THE SCREEN SAYS "SEARCHING THE WEB", A SEARCH HAS TO BE POSSIBLE.

   Asking about today's news showed "Searching the web…" then "Reading
   sources…" while the answer streamed. Whether a search could happen was
   decided separately, from S.model - the value in the model picker - and only
   the Apex entry matched it. The picker defaults to Auto. So in the
   out-of-the-box configuration no turn ever carried the search tool, and every
   turn about current events narrated a search that was not offered and then
   answered from training data.

   That is the worst failure available to this product. A stale answer labelled
   as a fresh one is more damaging than no answer, because the label is what
   makes somebody trust it.

   Two properties, and they are separate:

   1. The search tool is offered based on the engine that actually RUNS the
      turn, so Auto behaves like whatever Auto picked.
   2. The status labels are derived from that same decision, so the words on
      screen cannot outrun what was sent.

   The second is what makes the first honest when it says no. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const SROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

/* Capture the request AMV would send, without letting it leave. Returns the
   parsed payload plus the status labels the bubble showed. */
await page.evaluate(() => {
  window.__sent = null;
  window.__statuses = [];
  const realFetch = window.fetch;
  /* Every status the bubble shows, as it shows it - recorded off the message
     itself, so a label set and replaced within one tick is still counted. */
  const realSet = window.setMsgs || setMsgs;
  window.__statuses = [];
  window.setMsgs = setMsgs = function (m) {
    try { const l = m && m[m.length - 1]; if (l && l._status && window.__statuses[window.__statuses.length - 1] !== l._status) window.__statuses.push(l._status); } catch (e) {}
    return realSet.apply(this, arguments);
  };
  window.__stream = null;   // a scripted stream: [[delayMs, event], ...]
  window.fetch = async (url, opts) => {
    if (opts && opts.body && String(url).includes('/v1/') && window.__stream) {
      try { window.__sent = JSON.parse(opts.body); } catch (e) { window.__sent = 'unparsed'; }
      const steps = window.__stream; window.__stream = null;
      const enc = new TextEncoder();
      const body = new ReadableStream({ async start(c) {
        for (const [ms, ev] of steps) { if (ms) await new Promise(r => setTimeout(r, ms)); c.enqueue(enc.encode('data: ' + JSON.stringify(ev) + '\n\n')); }
        c.close();
      } });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (opts && opts.body && String(url).includes('/v1/')) {
      try { window.__sent = JSON.parse(opts.body); } catch (e) { window.__sent = 'unparsed'; }
      /* An empty, well-formed SSE stream: the turn ends immediately with no
         text, so nothing here depends on a model actually answering. */
      const sse = 'data: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n' +
                  'data: {"type":"message_stop"}\n\n';
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return realFetch(url, opts);
  };
});

/* Drive one turn and hand back what was sent. */
async function turn(text, setup) {
  await page.evaluate((o) => {
    window.__sent = null;
    /* Each case is a fresh turn: a previous one still marked busy, or a rate
       gate tripped by sending several in a row, would silently return before
       building a request at all. */
    S.busy = false;
    if (typeof quotaUnlock === 'function') quotaUnlock();
    try { AEGIS.check = () => ({ ok: true }); } catch (e) {}
    S.convs = []; S.cur = null;
    newChat();
    S.model = o.model;
    S._researchDepth = o.depth || null;
    saveStr('amv_cap_websearch', o.websearch === false ? '0' : '1');
    saveStr('amv_plugin_web', '1');
    saveStr('amv_plan', o.plan || 'ultra');
  }, setup || {});
  await page.evaluate((t) => {
    const ta = document.getElementById('mta');
    ta.value = t;
    return sendMsg();
  }, text);
  await page.waitForTimeout(400);
  return page.evaluate(() => window.__sent);
}

/* The engine must be reachable or every turn short-circuits on "not connected". */
await page.evaluate(() => {
  saveStr('amv_api_base', 'https://engine.test');
  saveStr('amv_api_token', 'tok');
});

section('The harness really intercepts a turn');
{
  const sent = await turn('what is the latest news about the election', { model: 'smart' });
  ok(sent && sent.messages, 'a request payload was captured', sent ? Object.keys(sent) : sent);
}

section('Apex offers web search, as it always did');
{
  const sent = await turn('what is the latest news about the election', { model: 'smart' });
  const ws = (sent.tools || []).find(t => t.name === 'web_search');
  ok(!!ws, 'the search tool is on the request', (sent.tools || []).map(t => t.name));
  ok(ws.max_uses > 0, 'with a budget', ws && ws.max_uses);
}

section('And so does Auto, which is what everybody actually has');
{
  /* This is the regression. Auto routes the turn to a real engine and that
     engine's turn used to go out with no search tool at all. */
  const sent = await turn('what is the latest news about the election', { model: 'auto' });
  const ws = (sent.tools || []).find(t => t.name === 'web_search');
  ok(!!ws, 'the default configuration can search', (sent.tools || []).map(t => t.name));
}

section('The number of searches is bounded, and scales with the tier');
{
  const forModel = async (m) => {
    const sent = await turn('find the latest figures', { model: m });
    const ws = (sent.tools || []).find(t => t.name === 'web_search');
    return ws ? ws.max_uses : 0;
  };
  const fast = await forModel('fast');
  const smart = await forModel('smart');
  ok(fast > 0, 'the cheap engine can still search', fast);
  ok(fast <= smart, 'but not as widely as the expensive one', { fast, smart });
  ok(smart <= 10, 'and no ordinary turn is allowed to search like a research run', smart);
}

section('Research mode gets its own budget, from the tier the person chose');
{
  const deep = await turn('research the history of the transistor', { model: 'auto', depth: 'deep' });
  const dws = (deep.tools || []).find(t => t.name === 'web_search');
  ok(dws && dws.max_uses === 30, 'deep research searches deeply', dws && dws.max_uses);

  const max = await turn('research the history of the transistor', { model: 'auto', depth: 'max' });
  const mws = (max.tools || []).find(t => t.name === 'web_search');
  ok(mws && mws.max_uses === 60, 'and exhaustive more so', mws && mws.max_uses);

  /* The routed engine must not quietly shrink an explicit request for depth. */
  const cheap = await turn('research this', { model: 'fast', depth: 'deep' });
  const cws = (cheap.tools || []).find(t => t.name === 'web_search');
  ok(cws && cws.max_uses === 30, 'whatever engine runs it', cws && cws.max_uses);
}

section('Turning it off in Settings turns it off');
{
  const sent = await turn('what is the latest news', { model: 'smart', websearch: false });
  const ws = (sent.tools || []).find(t => t.name === 'web_search');
  ok(!ws, 'no search tool when the person said no', (sent.tools || []).map(t => t.name));
}

section('And with it off, nothing on screen claims a search');
{
  /* The half that makes the refusal honest. The status labels are chosen from
     the same decision that builds the tools array, so they cannot disagree. */
  await page.evaluate(() => {
    S.model = 'smart'; S._researchDepth = null;
    saveStr('amv_cap_websearch', '0');
  });
  const claims = await page.evaluate(() => {
    /* Re-derive the labels the way _callAI does, for a search-shaped question. */
    const on = (loadStr('amv_cap_websearch') !== '0') && (loadStr('amv_plugin_web') !== '0');
    return on;
  });
  ok(claims === false, 'search is off for this turn', claims);

  const sent = await turn('what is the latest news today', { model: 'smart', websearch: false });
  ok(!(sent.tools || []).some(t => t.name === 'web_search'), 'and none was requested', true);

  const shown = await page.evaluate(() => window.__statuses);
  ok(!(shown || []).some(s => /searching the web|reading sources/i.test(s)),
     'and no label said otherwise', shown);
}

/* One turn with a scripted stream, run to the end; returns what was shown. */
async function streamed(text, steps) {
  await page.evaluate((st) => { window.__statuses = []; window.__stream = st; }, steps);
  await turn(text, { model: 'smart' });
  await page.waitForFunction(() => S.busy === false, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(300);
  return page.evaluate(() => { const m = getMsgs(); const l = m[m.length - 1] || {}; return { statuses: window.__statuses.slice(), research: l._research || '' }; });
}
const START = { type: 'message_start', message: { usage: { input_tokens: 1 } } };
const textAt = (i, t, cites) => [[0, { type: 'content_block_start', index: i, content_block: { type: 'text', text: '', citations: cites || [] } }],
  [0, { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: t } }], [0, { type: 'content_block_stop', index: i }]];

section('A question about today, with no search run, never says it is searching');
{
  /* Search was ON and the question was search-shaped, and the engine took four
     seconds and searched nothing. The timer used to fill those seconds with
     "Searching the web…", "Reading sources…", "Cross-checking what they say…". */
  const r = await streamed('what is the latest news today', [[0, START], [4200, null]].filter(x => x[1]).concat(textAt(0, 'From what I know already.'), [[0, { type: 'message_stop' }]]).map((x, i) => i === 1 ? [4200, x[1]] : x));
  ok(r.statuses.length >= 2, 'the wait was long enough for the timer to say several things', r.statuses);
  ok(!r.statuses.some(x => /search|reading sources|cross-check|composing|rendering/i.test(x)), 'and none of them claimed a search, a source or an image', r.statuses);
  ok(!r.research, 'and no research panel appeared', r.research.slice(0, 80));
}

section('A search that really runs is shown as it runs: its own query, then what it found');
{
  const urls = ['https://www.booking.com/kyoto', 'https://www.japan-guide.com/kyoto', 'https://reddit.com/r/japantravel/kyoto'];
  const r = await streamed('best hotels near kyoto station', [
    [0, START],
    [300, { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: {} } }],
    [0, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"hotels near ' } }],
    [0, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'Kyoto Station"}' } }],
    [0, { type: 'content_block_stop', index: 0 }],
    [600, { type: 'content_block_start', index: 1, content_block: { type: 'web_search_tool_result', tool_use_id: 'srv1',
      content: urls.map((u, i) => ({ type: 'web_search_result', url: u, title: 'Result ' + i })) } }],
    [0, { type: 'content_block_stop', index: 1 }],
    [600, null],
  ].filter(x => x[1]).concat(textAt(2, 'The Granvia sits on top of the station.',
      [{ type: 'web_search_result_location', url: urls[1], title: 'Kyoto hotels', cited_text: 'Hotel Granvia is inside the station building.' }]),
    [[0, { type: 'message_stop' }]]));
  ok(r.statuses.includes('Searching “hotels near Kyoto Station”…'), 'it said the query it actually searched, word for word', r.statuses);
  ok(r.statuses.includes('Found 3 results'), 'then how many results came back', r.statuses);
  ok(r.statuses.indexOf('Found 3 results') > r.statuses.indexOf('Searching “hotels near Kyoto Station”…'), 'in that order', r.statuses);
  ok(!r.statuses.some(x => /reading sources|cross-check/i.test(x)), 'and nothing it could not know', r.statuses);
  ok(/“hotels near Kyoto Station”/.test(r.research) && /3 results/.test(r.research), 'the finished panel keeps the search: its query and what it found', r.research.slice(0, 400));
  ok(/1 cited/.test(r.research) && /class="rsrc-chip cited"[^>]*href="https:\/\/www\.japan-guide\.com\/kyoto"/.test(r.research),
     'and marks the one source the answer cited as cited', r.research.slice(0, 600));
}

section('The words on screen come from the same decision as the tool');
{
  /* Read it from the bundle too: the label branch and the tools branch must be
     driven by one variable, or they will drift apart again. */
  /* app.js, not String(_callAI): the shipped page is minified, so a local like
     _webSearchOn has no name there. This section asks how the source is
     written - whether the label and the tool come off ONE decision - and the
     unminified bundle is where that question has an answer. Every assertion
     above drives the real page. */
  const fn = readFileSync(join(SROOT, 'app.js'), 'utf8');
  const src = await page.evaluate((fn) => {
    return {
      one: /_webSearchOn\s*=/.test(fn),
      /* No search label on a timer: the only "Searching" comes from a search. */
      labelsGuarded: !/_statusPhases\s*=[^;]*Search/.test(fn) && /server_tool_use[\s\S]{0,600}Searching/.test(fn),
      toolsGuarded: /if\(_webSearchOn\)\s*tools\.push/.test(fn),
      noPickerCheck: !/S\.model===['"]smart['"]/.test(fn),
    };
  }, fn);
  ok(src.one, 'there is a single named decision', src);
  ok(src.labelsGuarded, 'no timer claims a search; the label comes from the search itself', src.labelsGuarded);
  ok(src.toolsGuarded, 'and so does the tool', src.toolsGuarded);
  ok(src.noPickerCheck, 'and nothing keys off the picker value any more', src.noPickerCheck);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('search-is-real') > 0) process.exitCode = 1;
done();
