/* ANSWERS READ LIKE A WELL-SET DOCUMENT (owner, Nov 25: "the responses have
   to be [the leading assistants'] level. No misspell ... paragraphs, bold
   letters, big letters ... reasoning, correctness").

   The leaders' published guidance agrees: answer first, paragraphs by
   default, headings and lists only where they help, bold sparingly. AMV told
   its engines the opposite ("rich markdown: ## headers, **bold**, lists" on
   everything, and "go further than asked"), and drew headings barely bigger
   than the text. Held:
     · what is sent on every message carries the writing rules - answer first,
       length matched to the question, paragraphs, headings/lists/bold only
       where they help, flawless spelling, no filler - and no longer asks for
       formatting everywhere;
     · on screen, headings step clearly above the body (h2 > 1.3x, h3 > 1.1x),
       list items are the size of the text around them, and a blank table
       header carries no sort arrow. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ viewport: { width: 1100, height: 1400 }, user: { name: 'Ana', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;
await page.waitForTimeout(400);

section('What every message carries');
const sys = await page.evaluate(async () => {
  AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 'tok';
  window._aiBackendReady = () => true; window.__sent = null;
  const real = window.fetch;
  window.fetch = async (url, init) => {
    if (/\/v1\/messages/.test(String(url))) {
      try { window.__sent = JSON.parse(init.body); } catch (e) {}
      const ev = (d) => 'event: ' + d.type + '\ndata: ' + JSON.stringify(d) + '\n\n';
      const body = [ev({ type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 1 } } }),
        ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
        ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Yes.' } }),
        ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }),
        ev({ type: 'message_stop' })].join('');
      return new Response(new TextEncoder().encode(body), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return real(url, init);
  };
  document.querySelectorAll('.cc-banner').forEach(b => b.remove());
  newChat(); document.getElementById('mta').value = 'Is water wet?'; sendMsg();
  for (let i = 0; i < 100 && !window.__sent; i++) await new Promise(r => setTimeout(r, 50));
  for (let i = 0; i < 60 && S.busy; i++) await new Promise(r => setTimeout(r, 50));
  const s = (window.__sent || {}).system; return typeof s === 'string' ? s : JSON.stringify(s || '');
});
ok(/LEAD WITH THE ANSWER/.test(sys) && /MATCH LENGTH TO THE QUESTION/.test(sys), 'answer first, and length matched to the question', sys.length);
ok(/PARAGRAPHS FIRST/.test(sys) && /HEADINGS only when/.test(sys) && /LISTS for things that really are lists/.test(sys) && /BOLD sparingly/.test(sys), 'paragraphs by default; headings, lists and bold only where they help');
ok(/SPELLING AND GRAMMAR must be flawless/.test(sys) && /Proofread before sending/.test(sys), 'flawless spelling, proofread');
ok(/NO FILLER/.test(sys), 'no filler openers or repeated summaries');
ok(/Reason step by step INTERNALLY/.test(sys) && /verify your result/.test(sys), 'and the reasoning and checking rules are still there');
ok(!/Use rich markdown: ## headers/.test(sys) && !/Go further than asked/.test(sys), 'and it no longer asks for formatting everywhere or for padding');

section('How an answer is drawn');
const t = await page.evaluate(async () => {
  setMsgs([{ r: 'u', c: 'Roth or traditional?' }, { r: 'a', c: 'Short version: **it depends on your tax rate**.\n\n## How they differ\n\nA paragraph of text here.\n\n### When a Roth wins\n\n1. **Early career.** Income likely to rise.\n2. Flexibility.\n\n| | A | B |\n|---|---|---|\n| x | 1 | 2 |' }]);
  renderChatMsgs(); await new Promise(r => setTimeout(r, 200));
  const b = [...document.querySelectorAll('.mr:not(.u) .mb.ai')].at(-1);
  const px = (sel) => parseFloat(getComputedStyle(b.querySelector(sel)).fontSize);
  const th = b.querySelector('.mtbl-t th');
  return { body: parseFloat(getComputedStyle(b).fontSize), h2: px('h2'), h3: px('h3'), li: px('li'),
    blankArrow: getComputedStyle(th, '::after').content };
});
ok(t.h2 > t.body * 1.3, 'h2 stands clearly above the text', t);
ok(t.h3 > t.body * 1.1 && t.h3 < t.h2, 'h3 sits between', t);
ok(Math.abs(t.li - t.body) < 0.5, 'list items are the size of the text around them', t);
ok(t.blankArrow === '""' || t.blankArrow === 'none' || t.blankArrow === 'normal', 'a blank table header carries no sort arrow', t.blankArrow);

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
report();
await app.close();
done();
