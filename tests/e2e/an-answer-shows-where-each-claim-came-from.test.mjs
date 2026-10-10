/* AN ANSWER SHOWS WHERE EACH CLAIM CAME FROM.

   When an answer used the web, the stream carries, for each sentence that
   relied on a source, the exact passage relied on. AMV used to drop those on
   the floor and show only a row of site names - "researched 6 sources" - so
   nobody could check which source said what.

   Driven through the real send path with a recorded-shape stream: a search,
   its results, a cited sentence, an uncited one. Then the cards under the
   answer are read: title, the quoted passage, the sentence it supports. And
   the two things a source must never do to the page: a javascript: link, and
   markup inside a quote. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

const ev = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
const STREAM = [
  ev({ type: 'message_start', message: { usage: { input_tokens: 10 } } }),
  ev({ type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 's1', name: 'web_search', input: {} } }),
  ev({ type: 'content_block_stop', index: 0 }),
  ev({ type: 'content_block_start', index: 1, content_block: { type: 'web_search_tool_result', tool_use_id: 's1', content: [
    { type: 'web_search_result', url: 'https://www.ecb.europa.eu/press/pr/date/2026/html/rates.en.html', title: 'Monetary policy decisions' },
    { type: 'web_search_result', url: 'https://www.reuters.com/markets/ecb-holds', title: 'ECB holds rates' } ] } }),
  ev({ type: 'content_block_stop', index: 1 }),
  ev({ type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } }),
  ev({ type: 'content_block_delta', index: 2, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location',
    url: 'https://www.ecb.europa.eu/press/pr/date/2026/html/rates.en.html', title: 'Monetary policy decisions',
    cited_text: 'The Governing Council today decided to keep the three key ECB interest rates unchanged.' } } }),
  ev({ type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'The **ECB kept its rates unchanged** this month.' } }),
  ev({ type: 'content_block_stop', index: 2 }),
  ev({ type: 'content_block_start', index: 3, content_block: { type: 'text', text: '' } }),
  ev({ type: 'content_block_delta', index: 3, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location',
    url: 'https://www.reuters.com/markets/ecb-holds', title: 'ECB holds rates', cited_text: 'Markets now price <b>one cut</b> by March.<img src=x onerror=alert(1)>' } } }),
  ev({ type: 'content_block_delta', index: 3, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location',
    url: 'javascript:alert(document.cookie)', title: 'Evil', cited_text: 'click me' } } }),
  ev({ type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: ' Traders expect one cut by March.' } }),
  ev({ type: 'content_block_stop', index: 3 }),
  ev({ type: 'content_block_start', index: 4, content_block: { type: 'text', text: '' } }),
  ev({ type: 'content_block_delta', index: 4, delta: { type: 'text_delta', text: ' Ask me if you want the detail.' } }),
  ev({ type: 'content_block_stop', index: 4 }),
  ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40 } }),
  ev({ type: 'message_stop' }),
].join('');

await page.evaluate((sse) => {
  localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
  document.getElementById('cookie-consent-banner')?.remove();
  window._aiBackendReady = () => true;
  try { AMVUsage.status = () => ({ remaining: 9999, resetsAt: Date.now() + 3600e3 }); } catch (e) {}
  try { AEGIS.check = () => ({ ok: true }); } catch (e) {}
  const real = window.fetch;
  window.fetch = async (url, opts) => {
    if (opts && opts.body && String(url).includes('/v1/')) return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    return real(url, opts);
  };
}, STREAM);

await page.evaluate(async () => {
  S.busy = false; newChat();
  saveStr('amv_cap_websearch', '1');
  document.getElementById('mta').value = 'Did the ECB change rates?';
  await sendMsg();
});
await page.waitForFunction(() => { const m = getMsgs(); const a = m[m.length - 1]; return a && a.r === 'a' && !a.streaming && /detail/.test(a.c || ''); }, null, { timeout: 15000 });

section('The answer keeps which passage backs which sentence');
{
  const cites = await page.evaluate(() => { const m = getMsgs(); return m[m.length - 1].cites || []; });
  ok(cites.length === 3, 'every citation the stream carried is kept, the dangerous one included for now', cites.length);
  ok(cites[0].quote === 'The Governing Council today decided to keep the three key ECB interest rates unchanged.' && /ECB kept its rates unchanged/.test(cites[0].claim) && !/\*/.test(cites[0].claim),
     'with the exact passage and the sentence it supports, markdown stripped', cites[0]);
  const ans = await page.evaluate(() => { const m = getMsgs(); return m[m.length - 1].c; });
  ok(!/Governing Council/.test(ans), 'and the answer text itself is untouched', ans);
}

section('The research panel stays with the finished answer');
{
  /* It was frozen into its "done" state and then dropped when the finished
     message was built fresh; it only survived a Stop. */
  const r = await page.evaluate(() => { const m = getMsgs(); return { stored: !!m[m.length - 1]._research, shown: !!document.querySelector('#cm .rsrc-panel.done') }; });
  ok(r.stored && r.shown, '"Researched 2 sources" is still there once the answer is complete', r);
}

section('Under the answer: one card per source');
{
  const r = await page.evaluate(() => {
    const box = [...document.querySelectorAll('#cm .cite-box')].pop();
    if (!box) return null;
    return {
      open: box.open, summary: box.querySelector('summary').textContent,
      cards: [...box.querySelectorAll('.cite-card')].map(c => ({ title: c.querySelector('.cite-t').textContent, href: c.querySelector('.cite-t').getAttribute('href'), quote: (c.querySelector('.cite-q') || {}).textContent || '', for: (c.querySelector('.cite-for') || {}).textContent || '' })),
      injected: !!box.querySelector('img, b, script'),
    };
  });
  ok(!!r, 'a Sources box is drawn under the answer');
  ok(r && r.open === false && /Sources · 2/.test(r.summary) && /ecb\.europa\.eu, reuters\.com/.test(r.summary), 'closed, naming the sites on its summary line', r && r.summary);
  ok(r && r.cards.length === 2 && r.cards[0].title === 'Monetary policy decisions' && /^https:\/\/www\.ecb\.europa\.eu\//.test(r.cards[0].href), 'two cards, titled and linked', r && r.cards);
  ok(r && /“The Governing Council today decided/.test(r.cards[0].quote) && /Supports: The ECB kept its rates unchanged/.test(r.cards[0].for), 'each with the quote and the claim it backs', r && r.cards[0]);
  ok(r && !r.cards.some(c => /^javascript:/i.test(c.href)), 'a javascript: link from a source never becomes a link');
  ok(r && !r.injected && /<b>one cut<\/b>/.test(r.cards[1].quote), 'markup inside a quote is shown as text, never run', r && r.cards[1]);
}

section('It survives a reload of the conversation');
{
  const again = await page.evaluate(() => { renderChatMsgs(); return document.querySelectorAll('#cm .cite-card').length; });
  ok(again === 2, 'the cards are drawn from what was stored, not from the stream', again);
}

section('An answer that used no sources has no box');
{
  const n = await page.evaluate(() => { setMsgs([{ r: 'u', c: 'hi' }, { r: 'a', c: 'Hello!' }]); renderChatMsgs(); return document.querySelectorAll('#cm .cite-box').length; });
  ok(n === 0, 'nothing is drawn', n);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('an-answer-shows-where-each-claim-came-from') > 0) process.exitCode = 1;
done();
