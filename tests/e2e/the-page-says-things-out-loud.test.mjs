/* AMV NEVER SAID ANYTHING OUT LOUD.

   Swept the whole product for live regions and found ZERO. Not too few - none.
   Every toast, every status change, and every answer AMV streamed back happened
   in silence as far as a screen reader was concerned: the page changed and
   nothing announced it, so somebody using one had no way to know their message
   had sent, their settings had saved, or an answer had arrived.

   Two more from the same sweep:

     - The settings pane TITLE was a <div>. Not a wrong heading level, no heading
       at all, so heading navigation skipped the pane name entirely and landed on
       a bare h3 further down. Every other tab starts at h2; settings started at
       h3 with nothing above it.
     - The engine pickers had no accessible name. A bare <select> announces only
       its value, so a reader heard "Core, balanced" with no clue what it
       governed. Every caller had the gap, including the two added for Studio.

   The stream itself deliberately is NOT a live region: that would read every
   partial token aloud, which is unusable. The start and the finish are announced
   instead, from the render function rather than the completion paths, because
   there are four of those and hooking each is how you miss the fifth. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Ada', email: 'ada@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => document.getElementById('ck')?.remove());

section('There is a region, and it can actually be heard');
{
  const r = await page.evaluate(() => {
    const live = document.getElementById('sr-live');
    if (!live) return { missing: true };
    const cs = getComputedStyle(live);
    return {
      politeness: live.getAttribute('aria-live'),
      /* display:none and visibility:hidden are not announced at all, which is the
         classic way to ship a live region that does nothing. It has to be moved
         off-screen instead. */
      readable: cs.display !== 'none' && cs.visibility !== 'hidden',
      offScreen: live.getBoundingClientRect().width < 5 || cs.position === 'absolute',
    };
  });
  ok(!r.missing, 'the live region exists');
  ok(r.politeness === 'polite', 'it is polite, so it waits rather than interrupting', r.politeness);
  ok(r.readable, 'and it is not display:none, which would silence it entirely');
}

section('A toast is spoken, and saying the same thing twice still speaks');
{
  const r = await page.evaluate(async () => {
    const live = document.getElementById('sr-live');
    toast('Saved your changes', 'success');
    await new Promise(s => setTimeout(s, 140));
    const first = live.textContent;
    /* Assigning an identical string is not a DOM change, so a repeated message
       announces once and then goes quiet forever. The helper clears first. */
    toast('Saved your changes', 'success');
    await new Promise(s => setTimeout(s, 140));
    return { first, second: live.textContent };
  });
  ok(r.first.includes('Saved your changes'), 'a toast reaches the region', r.first);
  ok(r.second.includes('Saved your changes'), 'and the same toast again still reaches it', r.second);
}

section('An answer arriving is announced at both ends');
{
  const r = await page.evaluate(async () => {
    const live = document.getElementById('sr-live');
    setMsgs([{ r: 'u', c: 'hi' }, { r: 'a', c: '', streaming: true }]);
    renderChatMsgs();
    await new Promise(s => setTimeout(s, 140));
    const start = live.textContent;
    setMsgs([{ r: 'u', c: 'hi' }, { r: 'a', c: 'Here is the answer.', streaming: false }]);
    renderChatMsgs();
    await new Promise(s => setTimeout(s, 140));
    return { start, finish: live.textContent };
  });
  ok(/answering/i.test(r.start), 'the start of a response is announced', r.start);
  ok(/answered/i.test(r.finish) && /Here is the answer/.test(r.finish),
     'and the finished answer is read out, not just the fact that one arrived', r.finish);
}

section('Headings describe the page, on every tab');
{
  const TABS = ['chat', 'images', 'crew', 'dev', 'market', 'plans', 'settings', 'help', 'usage', 'team'];
  /* Clear the conversation the section above left behind. With messages present
     chat shows the transcript instead of its home screen, which is where its h1
     lives - so this reported chat as having no headings at all, and the finding
     was entirely my own leftover state. */
  await page.evaluate(() => { setMsgs([]); renderChatMsgs(); });
  await page.waitForTimeout(250);

  const r = await page.evaluate(async (tabs) => {
    const skips = [], empty = [];
    for (const t of tabs) {
      try { setTab(t); } catch (e) { continue; }
      await new Promise(s => setTimeout(s, 320));
      const vc = document.getElementById('vc'); if (!vc) continue;
      const hs = [...vc.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(e => {
        const b = e.getBoundingClientRect();
        return b.width > 1 && b.height > 1 && (e.textContent || '').trim();
      });
      if (!hs.length) { empty.push(t); continue; }
      const first = +hs[0].tagName[1];
      if (first > 2) skips.push(t + ' starts at h' + first);
      let prev = 0;
      hs.forEach(h => {
        const lvl = +h.tagName[1];
        if (prev && lvl > prev + 1) skips.push(t + ': h' + prev + ' jumps to h' + lvl);
        prev = lvl;
      });
    }
    return { skips, empty };
  }, TABS);
  ok(r.empty.length === 0, 'every tab has at least one heading to navigate by', r.empty);
  ok(r.skips.length === 0, 'and none of them skips a level or starts too deep', r.skips);
}

section('Every field says what it is for');
{
  const r = await page.evaluate(async (tabs) => {
    const bad = [];
    for (const t of tabs) {
      try { setTab(t); } catch (e) { continue; }
      await new Promise(s => setTimeout(s, 300));
      const vc = document.getElementById('vc'); if (!vc) continue;
      vc.querySelectorAll('input,select,textarea').forEach(e => {
        const b = e.getBoundingClientRect();
        if (b.width < 2 || b.height < 2 || e.type === 'hidden') return;
        const named = e.getAttribute('aria-label') || e.getAttribute('aria-labelledby')
          || (e.id && document.querySelector('label[for="' + CSS.escape(e.id) + '"]'))
          || e.closest('label') || e.getAttribute('placeholder') || e.getAttribute('title');
        if (!named) bad.push(t + '|' + (e.id || e.className || e.tagName));
      });
    }
    return bad;
  }, ['chat', 'images', 'crew', 'dev', 'market', 'plans', 'settings', 'help', 'team']);
  ok(r.length === 0, 'no field is announced as nothing but its own value', r.slice(0, 6));
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
