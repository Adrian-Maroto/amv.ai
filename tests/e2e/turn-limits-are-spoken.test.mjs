/* A TURN THAT DOES LESS THAN IT WAS ASKED HAS TO SAY SO.

   Two places where AMV quietly did less and told nobody.

   A chat turn will run tools and hand the results back to the model at most
   four times, so a confused model cannot loop forever. Reasonable. But when the
   fifth request arrived, the branch that runs tools simply did not execute, and
   the code fell through to "finalize the message". The person got whatever text
   happened to precede the tool call - often nothing, which renders as
   "(no response)" - with no indication that AMV had stopped partway through
   work it was in the middle of.

   And the counter that enforces it was reset in sendMsg, while Regenerate,
   Retry and editing a message all call _callAI directly. So a turn that spent
   its four rounds handed the spent counter to the next one: regenerating it
   could not use tools at all, from the first request.

   The second is why the first matters. Silently doing less is the failure this
   codebase keeps turning up, and a limit nobody is told about is
   indistinguishable from a bug. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

await page.evaluate(() => {
  saveStr('amv_api_base', 'https://engine.test');
  saveStr('amv_api_token', 'tok');
  /* Several turns in a few seconds is exactly what the client rate gate exists
     to stop. It is tested elsewhere; here it would answer every case with
     "Hold on" and measure nothing. */
  try { AEGIS.check = () => ({ ok: true }); } catch (e) {}

  /* Every model turn asks for a tool. memory_list needs no consent, reads what
     AMV already remembers, changes nothing and - the part that matters here -
     makes no request of its own. It was generate_image until image generation
     was removed. The first replacement tried was account_status, which reads
     the plan and the background jobs, and reading the jobs is a POST to the
     same host this stub counts: five tool rounds became ten "turns" and the
     runaway guard looked broken. A counter that counts the thing it is
     measuring PLUS something else is not a counter, so the tool the loop uses
     has to be one that stays inside the browser. */
  window.__turns = 0;
  const realFetch = window.fetch;
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (opts && opts.method === 'POST' && u.includes('engine.test')) {
      window.__turns++;
      const sse =
        'data: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n' +
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t' + window.__turns + '","name":"memory_list"}}\n\n' +
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n' +
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":2}}\n\n' +
        'data: {"type":"message_stop"}\n\n';
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return realFetch(url, opts);
  };
});

const send = async (text) => {
  await page.evaluate((t) => {
    const ta = document.getElementById('mta');
    ta.value = t;
    return sendMsg();
  }, text);
  await page.waitForTimeout(1200);
};

const lastText = () => page.evaluate(() => {
  const m = getMsgs();
  return String((m[m.length - 1] || {}).c || '');
});

section('A model that keeps asking for tools is stopped');
{
  await page.evaluate(() => { S.convs = []; S.cur = null; newChat(); window.__turns = 0; });
  await send('draw me something');
  const turns = await page.evaluate(() => window.__turns);
  ok(turns > 1, 'the tool loop really ran more than once', turns);
  ok(turns <= 6, 'and did not run away', turns);
}

section('And the person is told, rather than left with "(no response)"');
{
  const t = await lastText();
  ok(!/^\(no response\)$/.test(t.trim()),
     'the turn does not end as a blank', t.slice(0, 80));
  ok(/rounds of tool use/i.test(t),
     'it says a limit was reached', t.slice(-160));
  ok(/keep going/i.test(t), 'and what to do about it', t.slice(-160));
}

section('The budget is per message, not per session');
{
  /* The regression: the counter was reset in sendMsg, so any path that calls
     _callAI directly - Regenerate, Retry, editing a message - inherited a spent
     counter and could not use tools at all. */
  await page.evaluate(() => { window.__turns = 0; });
  await page.evaluate(() => regenerateMsg());
  await page.waitForTimeout(1500);
  const turns = await page.evaluate(() => window.__turns);
  ok(turns > 1, 'regenerating gets a fresh tool budget', turns);

  const t = await lastText();
  ok(/rounds of tool use/i.test(t), 'and reaches the same honest ending', t.slice(-120));
}

section('A second message also starts fresh');
{
  await page.evaluate(() => { window.__turns = 0; });
  await send('draw me another thing');
  const turns = await page.evaluate(() => window.__turns);
  ok(turns > 1, 'the next message is not punished for the last one', turns);
}

section('Stopping keeps the research AMV had already shown');
{
  /* The stop branch replaced the message wholesale, which threw away the frozen
     panel of sources written a few lines above it - so pressing Stop during a
     search erased the sources already on screen. */
  await page.evaluate(() => {
    S.convs = []; S.cur = null; newChat();
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (opts && opts.method === 'POST' && u.includes('engine.test')) {
        return new Response(new ReadableStream({
          start(c) {
            const enc = new TextEncoder();
            c.enqueue(enc.encode('data: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n'));
            c.enqueue(enc.encode('data: {"type":"content_block_start","index":0,"content_block":{"type":"server_tool_use","name":"web_search"}}\n\n'));
            c.enqueue(enc.encode('data: {"type":"content_block_start","index":1,"content_block":{"type":"web_search_tool_result","content":[{"url":"https://example.com/a","title":"A source"}]}}\n\n'));
            c.enqueue(enc.encode('data: {"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"Partial answer"}}\n\n'));
            /* Deliberately not closed - the turn is still going when Stop is
               pressed. Aborting the signal errors the stream, which is what a
               real fetch does and what makes reader.read() reject instead of
               parking until the idle timeout. */
            const sig = opts && opts.signal;
            if (sig) sig.addEventListener('abort', () => {
              try { c.error(new DOMException('aborted', 'AbortError')); } catch (e) {}
            });
          }
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return realFetch(url, opts);
    };
  });

  await page.evaluate(() => {
    const ta = document.getElementById('mta');
    ta.value = 'what happened today';
    sendMsg();
  });
  await page.waitForTimeout(700);

  const during = await page.evaluate(() => {
    const m = getMsgs();
    return !!(m[m.length - 1] || {})._research;
  });
  ok(during, 'the live research panel appeared', during);

  await page.evaluate(() => stopGenerating());
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => {
    const m = getMsgs()[getMsgs().length - 1] || {};
    return { research: !!m._research, streaming: !!m.streaming, stopped: !!m._stopped, c: String(m.c || '') };
  });
  ok(after.stopped, 'the message is marked stopped', after);
  ok(after.research, 'and the sources AMV found are still there', after.research);
  ok(!after.streaming, 'and the bubble is not left spinning forever', after.streaming);
  ok(/Partial answer/.test(after.c), 'with the text that had arrived', after.c.slice(0, 60));
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('turn-limits-are-spoken') > 0) process.exitCode = 1;
done();
