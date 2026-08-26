/* THE ONE THING THIS PRODUCT PROMISES: ASK, AND IT IS DONE.

   Not described. Done. That is the whole difference between a chat box and
   AMV, and it rests on a loop with four links:

     the model is offered AMV's tools -> it asks for one
     -> the browser actually runs it
     -> the RESULT goes back up, through AMV's own backend, to the model
     -> the model's final answer, written with that result in hand, appears

   Break any link and nothing throws. The person gets a paragraph about what
   AMV would do, which is exactly what the competition gives away. That failure
   already happened here once, on the first link: the backend allowed tools by
   `t.type`, AMV's own tools are custom tools and have none, so every one of
   them was dropped on every turn since the day they were written. The system
   prompt promised them, the client believed it had sent them, and the model was
   handed nothing.

   The tools are tested in isolation elsewhere and the round limit is tested
   elsewhere. What nothing covered is the LOOP, end to end, through the real
   Worker in a real browser - which is the only place all four links are true at
   once. So: a real sign-in, a real model turn that asks for a tool, and then
   the questions that decide whether this is a product.

   The last section is about money, because a second model call is a second
   bill. A round trip that is not metered is compute AMV pays for and nobody
   is charged - and it is invisible, because the answer looks perfect. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

/* Server-sent events in the shape the client parses. */
function sse(events) {
  return events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n';
}
function stream(body) {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/* Turn one: a sentence, then a request to run code. Turn two: the answer,
   written using what came back. */
const TURN_ONE = sse([
  { type: 'message_start', message: { usage: { input_tokens: 120 } } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me work that out.' } },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_round1', name: 'run_code' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"code":"console.log(6*7)","lang":"js"}' } },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 40 } },
]);
const TURN_TWO = sse([
  { type: 'message_start', message: { usage: { input_tokens: 260 } } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'It comes to 42.' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 25 } },
]);

const upstream = [];
const outbound = makeOutbound();
outbound.on(/model\.example/, (_u, opts) => {
  const body = JSON.parse(String(opts.body || '{}'));
  upstream.push(body);
  return stream(upstream.length === 1 ? TURN_ONE : TURN_TWO);
});
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));

const env = makeEnv({ AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
                      APP_URL: 'http://localhost:9199' });
const L = await bootLive({ env, outbound, port: 9199 });
const { page } = L;

const PW = 'A-real-Passw0rd!';
const USER = 'doer@example.com';

const KV = env.AMV_KV;

section('A real account, on a plan that can do the work');
{
  await page.evaluate(async ([em, pw]) => {
    openAuth('signup');
    await __amvAuthOpen();
    const type = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Doer'); type('#a-email', em); type('#a-pass', pw);
    document.getElementById('auth-submit').click();
    await __amvSignedIn();
  }, [USER, PW]);
  await KV.put('ent:' + USER, JSON.stringify({
    plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  await page.evaluate(async () => { try { await syncEntitlement(); } catch (e) {} await new Promise(x => setTimeout(x, 500)); });
  const plan = await page.evaluate(() => loadStr('amv_plan') || 'free');
  ok(plan === 'ultra', 'signed in against the real backend, on a plan that can work', plan);
  ok(L.hit(/\/auth\/signup/).length === 1, 'and the account was created over the wire', L.hit(/\/auth\/signup/).length);
}

section('AMV asks, and the tool actually runs');
{
  await page.evaluate(async (t) => {
    setTab('chat');
    await new Promise(x => setTimeout(x, 300));
    const box = document.getElementById('mta');
    box.value = t;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    sendMsg();
  }, 'what is six times seven');
  await page.waitForFunction(() => typeof S !== 'undefined' && S.busy === true, null, { timeout: 8000 }).catch(() => {});

  /* THE LOOP GOES THROUGH A PERSON, and that is deliberate: running code on
     somebody's device because a model asked is exactly the thing a page it
     read could talk it into. So the turn stops here and waits.

     Approved by CLICKING the real dialog rather than stubbing the confirm,
     because the dialog is part of the product - if it stopped appearing, or
     appeared without a working button, a stub would never notice. */
  const asked = await page.waitForSelector('#modal-ok', { timeout: 12000 }).then(() => true).catch(() => false);
  ok(asked, 'AMV asked before running code on the device', asked);
  const said = await page.evaluate(() => {
    const t = document.querySelector('#modal-box h2');
    const b = document.querySelector('#modal-box .ob-sub');
    return { title: t ? t.textContent : '', body: b ? b.textContent : '' };
  });
  ok(/run js on your device/i.test(said.title), 'naming what it wants to do, not "run a tool"', said.title);
  ok(/console\.log\(6\*7\)/.test(said.body), 'and showing the exact code it would run', said.body.slice(-120));
  /* Only if it is there. A build where the gate has gone missing must FAIL the
     assertion above and carry on reporting - not die clicking a button that no
     longer exists, which hides the finding behind a stack trace. */
  if (asked) await page.click('#modal-ok');

  /* Wait for the turn to FINISH. A tool turn is two model round trips with
     real execution in between, so a fixed wait reads the conversation before
     the second one has landed. */
  await page.waitForFunction(() => typeof S !== 'undefined' && S.busy === false, null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(600);
  await L.settle();

  const out = await page.evaluate(() => getMsgs().map(m => ({
    r: m.r, c: m.c,
    tools: (m._toolContent || []).map(x => x.type),
    results: (m._toolResults || []).map(x => x.type),
  })));
  const last = out[out.length - 1] || {};
  ok(out.length >= 2, 'it is a real exchange, not a single bubble', out.length);
  ok(/42/.test(String(last.c || '')), 'the final answer is the one written AFTER the tool ran', last.c);
  const ranIt = out.some(m => (m.results || []).includes('tool_result'));
  ok(ranIt, 'and the browser recorded actually running it', out.map(m => m.results));
}

section('The model was offered AMV’s own tools, not just a search box');
{
  /* The first link, at the level that matters. A unit test on the allowlist
     passes while the wiring around it drops everything - that is precisely how
     this went unnoticed. */
  ok(upstream.length >= 1, 'the backend called the model', upstream.length);
  const names = (upstream[0].tools || []).map(t => t.name || t.type);
  ok(names.includes('run_code'), 'run_code reached the model', names);
  ok(names.length > 1, 'and it was not the only one', names);
}

section('The result of the work went BACK up, to the same request');
{
  const second = upstream[1];
  ok(!!second, 'a second turn happened at all - the loop continued', upstream.length);
  /* Guarded, because a broken loop is the case this file exists to REPORT. An
     unguarded index throws here and the run dies with a stack trace instead of
     the sentence saying which link came apart, which is the one thing somebody
     reading a red gate needs. */
  const msgs = (second && second.messages) || [];
  const flat = JSON.stringify(msgs);

  const used = msgs.flatMap(m => Array.isArray(m.content) ? m.content : [])
                   .filter(b => b && b.type === 'tool_use');
  const results = msgs.flatMap(m => Array.isArray(m.content) ? m.content : [])
                      .filter(b => b && b.type === 'tool_result');
  ok(used.length === 1 && used[0].name === 'run_code',
     'the assistant turn that asked for the tool is in the history', used.map(u => u.name));
  ok(results.length === 1, 'and exactly one result went back for it', results.length);
  ok(!!results[0] && results[0].tool_use_id === 'toolu_round1',
     'tied to the call it answers, which is what makes it usable', results[0] && results[0].tool_use_id);
  ok(!!results[0] && /42/.test(String(results[0].content || '')),
     'carrying what the code REALLY printed, not a placeholder', String((results[0] || {}).content || '').slice(0, 80));

  /* The failure this section exists for: a backend that sanitises what the
     client sends could strip an unfamiliar block on the way through, and the
     model would answer the question a second time with no idea it had already
     been done. Nothing would error. */
  ok(/tool_result/.test(flat), 'the backend passed it through rather than dropping it', true);
}

section('The person is charged for BOTH calls, because AMV pays for both');
{
  /* A second model call is a second bill. One that nobody meters is compute
     AMV buys and gives away, and it is invisible - the answer looks perfect,
     nothing errors, and the loss only shows up on the provider invoice.

     Read from the Worker's OWN counters rather than from a screen, because the
     screen could be reporting an estimate. The two turns declared 120 and 260
     input tokens; metering one and not the other is the defect, so the total
     has to exceed the larger single turn. */
  await L.settle();
  /* With no Durable Object bound the Worker keeps counters in KV under `ctr:`,
     which is where the real numbers are. Reading the screen instead would read
     an estimate the client computed, and an estimate cannot catch a turn that
     was never billed. */
  const month = new Date().toISOString().slice(0, 7);
  const num = async (k) => { try { return parseFloat(await KV.get(k)) || 0; } catch (e) { return 0; } };
  /* Found by PREFIX rather than by guessing the window.

     An allowance is counted over the billing period now, not the calendar
     month, so `ctr:usg:someone@x.com:2026-08` is the right key only for a free
     account. Hardcoding either one makes this file report a broken meter every
     time the window changes - and a test that says "nothing was billed" when
     everything was billed is worse than no test. What is being checked is that
     the Worker wrote this account's usage somewhere, so it looks for that. */
  const sumByPrefix = async (prefix) => {
    const all = await KV.list({ prefix });
    let n = 0;
    for (const k of (all.keys || [])) n += await num(k.name);
    return n;
  };
  const tokens = await sumByPrefix(`ctr:usg:${USER}:`);
  const spend  = await sumByPrefix(`ctr:cost:${USER}:`);
  const house  = await num(`ctr:costtotal:${month}`);

  ok(tokens > 0, 'the account\u2019s token usage was written by the Worker', tokens);
  /* 120 and 260 input tokens were declared across the two turns. Billing one
     and not the other is the defect this exists for, so the total has to
     exceed the larger single turn rather than merely be non-zero. */
  ok(tokens > 260, 'and it covers BOTH turns, not just the first', tokens);
  ok(spend > 0, 'the dollar cost of the work is on the account', spend);
  ok(house > 0, 'and on AMV\u2019s own running total, which is what the cap reads', house);
}

section('Nothing broke');
{
  ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 4));
}

await L.close();
outbound.restore();
if (report('the-work-actually-gets-done') > 0) process.exitCode = 1;
done();
