/* WHILE YOU WERE AWAY - the half of the loop that was missing.

   Automations already ran on the server, produced real answers and stored
   them. What happened next was a toast that vanished in six seconds and a
   number on a nav item. So the one thing that makes a product worth returning
   to - it did something for you while you were gone - was the least visible
   thing in it.

   These assertions are mostly about restraint: it must not appear when there
   is nothing, must not appear when the load failed, and must never mark
   something read just because it rendered. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Alice', email: 'alice@x.com', ini: 'A' } });
const { page, errors } = app;

const now = Date.now();
const RESULTS = [
  { id: 'r1', autoId: 'a1', detail: 'Brief me on the semiconductor market',
    out: 'Demand is up **12%** quarter on quarter.\n\nTaiwan capacity is the constraint everyone is watching.', at: now - 3600000, read: false, kind: 'research' },
  { id: 'r2', autoId: 'a2', detail: 'Summarise my unread email',
    out: 'Three things need you today: the lease renewal, an invoice past due, and a reschedule request.', at: now - 1800000, read: false, kind: 'task' },
  { id: 'r0', autoId: 'a1', detail: 'An older one already seen',
    out: 'old', at: now - 86400000, read: true, kind: 'task' },
];

/* `_AUTO_RESULTS` is a top-level `let`, so it is a script binding and not a
   window property - it is set the way the app sets it, through _autoRefresh. */
const serve = (results) => page.evaluate(rs => {
  window.__markedRead = 0;
  window._autoApi = async (path) => {
    if (path === '/auto/read') { window.__markedRead++; return { ok: true }; }
    return { ok: true, items: [], results: rs, emailReady: true, canSchedule: true };
  };
  saveStr('amv_away_seen', '');
  return _autoRefresh();
}, results);

const openChat = () => page.evaluate(() => { S.tab = 'chat'; setTab('chat'); renderChatMsgs(); });
const card = () => page.evaluate(() => {
  const c = document.querySelector('.away-card');
  return c ? { text: c.textContent, items: c.querySelectorAll('.away-item').length } : null;
});

section('Work done in the background is the first thing on the screen');
{
  await serve(RESULTS);
  await openChat();
  await page.waitForSelector('.away-card', { timeout: 15000 });
  const c = await card();
  ok(c.items === 2, 'only the unread results are listed', c.items);
  ok(/AMV finished 2 scheduled tasks/.test(c.text), 'with a real count, not a vague badge', c.text.slice(0, 60));
  ok(/semiconductor market/.test(c.text), 'each one named by what was asked');
  ok(/Demand is up/.test(c.text), 'and previewed, so it is worth opening');
  ok(!/An older one already seen/.test(c.text), 'anything already read stays out of it');

  const above = await page.evaluate(() => {
    const a = document.querySelector('.away-card');
    const g = document.querySelector('.chome') || document.querySelector('.mr');
    return !!(a && g && (a.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  ok(above, 'it sits above the conversation, not buried under it');
}

section('Rendering it marks NOTHING read');
{
  const v = await page.evaluate(() => ({ marked: window.__markedRead, unread: _awayUnread().length }));
  ok(v.marked === 0, 'no read call was made just by showing the card', v.marked);
  ok(v.unread === 2, 'and the results are still unread', v.unread);
  await openChat(); await openChat();
  ok(await page.evaluate(() => window.__markedRead) === 0, 're-rendering does not change that either');
}

section('The whole answer is readable in place');
{
  await page.evaluate(() => document.querySelector('[data-away-open]').click());
  await page.waitForFunction(() => {
    const f = document.querySelector('.away-full');
    return f && !f.hidden && f.textContent.length > 0;
  }, { timeout: 15000 });
  const v = await page.evaluate(() => {
    const f = document.querySelector('.away-full');
    return { html: f.innerHTML, expanded: document.querySelector('[data-away-open]').getAttribute('aria-expanded'),
             snipHidden: document.querySelector('.away-snip').hidden };
  });
  ok(/Three things need you today/.test(v.html), 'the full text is shown without leaving the page', v.html.slice(0, 60));
  ok(!/\*\*/.test(v.html), 'markdown markers are never shown to the user as literal characters', v.html.slice(0, 60));

  /* And the one that DOES contain formatting is formatted - a scheduled result
     has to read exactly like an answer AMV just wrote, or it looks second
     class next to the thing it is meant to replace. */
  const rich = await page.evaluate(() => {
    document.querySelector('[data-away-open="r1"]').click();
    return document.querySelector('[data-away-id="r1"] .away-full').innerHTML;
  });
  ok(/<b>|<strong>/.test(rich), 'bold in the result renders as bold', rich.slice(0, 80));
  ok(/12%/.test(rich), 'with the content intact', rich.slice(0, 80));
  ok(v.expanded === 'true', 'and the control reports its state to a screen reader');
  ok(v.snipHidden === true, 'the preview gives way to the full answer rather than repeating it');

  await page.evaluate(() => document.querySelector('[data-away-open]').click());
  const collapsed = await page.evaluate(() => ({
    hidden: document.querySelector('.away-full').hidden,
    expanded: document.querySelector('[data-away-open]').getAttribute('aria-expanded'),
  }));
  ok(collapsed.hidden === true && collapsed.expanded === 'false', 'and it closes again');
  ok(await page.evaluate(() => window.__markedRead) === 0, 'reading one still marks nothing read on its own');
}

section('Dismissing says what it does, and does it');
{
  // Read the label BEFORE clicking - dismissing removes the card.
  const dismissLabel = await page.evaluate(() => document.querySelector('[data-away-dismiss]').textContent);
  await page.evaluate(() => document.querySelector('[data-away-dismiss]').click());
  await page.waitForFunction(() => !document.querySelector('.away-card'), { timeout: 15000 });
  ok(await page.evaluate(() => window.__markedRead) === 1, 'the results are marked read on the server, once');
  ok(/Mark all as read/.test(dismissLabel), 'the button said it would mark them ALL, which is what it did', dismissLabel);

  await openChat();
  ok((await card()) === null, 'and the card stays gone on the next render');
}

section('A new result brings it back');
{
  await serve(RESULTS.concat([{ id: 'r3', autoId: 'a1', detail: 'A brief for tomorrow', out: 'Something new happened.', at: Date.now(), read: false }]));
  await openChat();
  await page.waitForSelector('.away-card', { timeout: 15000 });
  const c = await card();
  ok(/Something new happened/.test(c.text), 'a genuinely new result is a new batch, so it shows', c.text.slice(0, 80));
}

section('Nothing unread, nothing shown');
{
  await serve(RESULTS.map(r => ({ ...r, read: true })));
  await openChat();
  ok((await card()) === null, 'no card at all - not an empty one saying "nothing new"');
}

section('A failed load shows nothing rather than a false all-clear');
{
  await page.evaluate(() => {
    window._autoApi = async () => { throw new Error('offline'); };
    saveStr('amv_away_seen', '');
    return _autoRefresh();
  });
  await openChat();
  ok((await card()) === null, 'a card claiming nothing is new would be a lie when nothing was loaded');
}

section('It reads on a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await serve(RESULTS);
  await openChat();
  await page.waitForSelector('.away-card', { timeout: 15000 });
  const m = await page.evaluate(() => {
    const c = document.querySelector('.away-card');
    const r = c.getBoundingClientRect();
    const btn = document.querySelector('[data-away-dismiss]').getBoundingClientRect();
    return {
      fits: r.right <= window.innerWidth + 1,
      overflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      tap: btn.height,
      labelled: c.getAttribute('aria-label'),
    };
  });
  ok(m.fits, 'the card fits the screen');
  ok(m.overflow, 'and the page does not scroll sideways');
  ok(m.tap >= 22, 'the actions are real tap targets', Math.round(m.tap));
  ok(/away/i.test(m.labelled || ''), 'the region is named for screen readers', m.labelled);
  await page.setViewportSize({ width: 1280, height: 900 });
}

ok(errors.length === 0, 'no console errors', errors.slice(0, 3));
report('away');
done();
