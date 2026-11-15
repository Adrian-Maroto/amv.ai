/* "ADD MANY MORE VISUAL THINGS TO CREW SO PEOPLE ARE INTRIGUED BY THE EXAMPLES
   OF WHAT THEY CAN DO."

   The examples were already written and nobody ever saw them. Every good card
   in this catalogue carries a `sample` - the real output that job produces,
   line by line, specific down to the numbers - and it sat behind a link
   reading "See an example", which is a link somebody presses once they are
   already interested. So the page whose entire purpose is to MAKE them
   interested was a hundred paragraphs describing what a thing is.

   "6 needed you today. 58 did not." does more work than any description of an
   inbox digest could, and it was one line from the surface the whole time.

   And the second thing in here, because it is the same kind of omission: every
   price in AMV is a US dollar figure and nothing said so. Somebody in Berlin
   agreed to "$20/month" and met a different number on their statement plus a
   fee their bank added. No conversion is offered and that is deliberate - a
   rate hardcoded in a stylesheet-era constant would be wrong within weeks, and
   the processor would contradict it on the very next page. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'crew', user: { name: 'Adrian', email: 'a@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('ck')?.remove());
await page.waitForTimeout(900);

/* THE EXAMPLE MOVED, AND STAYED REAL (Nov 15). It was a strip on every card;
   the owner asked for the cards to be plain - a title, one line, when it runs -
   and called the extra lines on them clutter. So the example is in the job's
   panel, labelled as an example, and only where a real one exists. */
section('The example is in the job, labelled, and never invented');
{
  const r = await page.evaluate(async () => {
    const list = _cjList();
    const withS = list.find(j => Array.isArray(j.sample) && j.sample.length >= 3);
    const without = list.find(j => !(Array.isArray(j.sample) && j.sample.length));
    const look = async (j) => { cwPeek(j.id); await new Promise(r => setTimeout(r, 150));
      const o = document.getElementById('ovr');
      const out = { lines: [...o.querySelectorAll('.cwp-sample .cwp-line')].map(l => l.textContent), text: o.textContent };
      closeOvr(); return out; };
    return { cards: document.querySelectorAll('#cj-grid .cj-card').length,
             strips: document.querySelectorAll('#cj-grid .cw-job-out').length,
             a: withS ? await look(withS) : null, aN: withS ? withS.sample.length : 0,
             b: without ? await look(without) : null };
  });
  ok(r.cards > 20, 'there is a catalogue to look at', String(r.cards));
  ok(r.strips === 0, 'and its cards stay plain - no output strip on them', r.strips);
  ok(r.a && r.a.lines.length === r.aN && r.a.lines.every(l => l.trim().length > 10), 'a job with an example shows every line of it', r.a && r.a.lines.slice(0, 2));
  ok(r.a && /Example of what you get/.test(r.a.text), 'labelled as an example, not read as their result', '');
  ok(r.b && r.b.lines.length === 0, 'and a job without one shows none - nothing is invented', r.b && r.b.lines);
}

section('Cards side by side say when they run on the same line');
{
  /* Two cards in a row whose last lines disagree read as broken before anybody
     works out why - so a REAL row is measured, one whose descriptions differ
     in length. */
  const r = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#cj-grid .cj-card')];
    const rows = new Map();
    cards.forEach(c => { const t = Math.round(c.getBoundingClientRect().top); if(!rows.has(t)) rows.set(t, []); rows.get(t).push(c); });
    const multi = [...rows.values()].filter(g => g.length >= 2);
    const bad = multi.filter(g => new Set(g.map(c => Math.round((c.querySelector('.cj-card-w') || c).getBoundingClientRect().bottom))).size > 1);
    const d = cards.find(c => c.querySelector('.cj-card-d'));
    return { rows: multi.length, bad: bad.length, clamp: d ? getComputedStyle(d.querySelector('.cj-card-d')).webkitLineClamp : '' };
  });
  ok(r.rows > 2, 'there are rows of cards', r.rows);
  ok(r.bad === 0, 'and in each, when it runs sits on the same line', r);
  ok(r.clamp === '2', 'because the line of what it does is clamped, not because these happen to be short', r.clamp);
}

section('A price in dollars says it is in dollars');
{
  const r = await page.evaluate(() => {
    const seen = {};
    /* 'de' carries no region at all, which is an ordinary browser setting and
       not an exotic one. Treating that as American is the quiet version of
       this bug: the notice disappears for exactly the people who cannot tell
       it is missing. */
    const langs = ['de-DE', 'pt-BR', 'en-US', 'de'];
    for(const l of langs){
      Object.defineProperty(navigator, 'languages', { value: [l], configurable: true });
      seen[l] = _payCurrencyNote();
    }
    return seen;
  });
  ok(/US dollars/.test(r['de-DE']), 'somebody in Germany is told the currency', r['de-DE'].slice(0, 60));
  ok(/US dollars/.test(r['pt-BR']), 'and somebody in Brazil');
  ok(/converts at its own rate/.test(r['de-DE']), 'and that their bank does the converting');
  ok(/methods normally used where you are/.test(r['de-DE']),
     'and that they can pay the way they normally pay');
  ok(r['en-US'] === '', 'and it is not shown to somebody it does not apply to', JSON.stringify(r['en-US']));
  ok(/US dollars/.test(r['de']),
     'a browser that names no country is not assumed to be American', JSON.stringify(r['de']).slice(0, 40));
  /* No figure is offered in another currency, because there is no rate here to
     base one on, and a number AMV made up on a checkout screen would be
     contradicted by the processor on the next page. */
  ok(!/€|R\$|£|¥/.test(r['de-DE']), 'no converted figure is invented', r['de-DE'].slice(0, 80));
}

section('It is in the sheet somebody actually pays on');
{
  const r = await page.evaluate(() => {
    Object.defineProperty(navigator, 'languages', { value: ['fr-FR'], configurable: true });
    openPaymentSheet('pro', 'month');
    const ov = document.getElementById('ovr');
    const has = !!ov.querySelector('.pay-cur');
    const amt = ov.querySelector('.pay-amount');
    const cur = ov.querySelector('.pay-cur');
    const order = amt && cur ? (amt.compareDocumentPosition(cur) & Node.DOCUMENT_POSITION_FOLLOWING) > 0 : false;
    closePaySheet();
    return { has, order };
  });
  ok(r.has, 'the checkout sheet carries it');
  ok(r.order, 'directly under the amount it is about');
}

ok(errors.length === 0, 'no page errors', errors.join(' | '));
await app.close();
report();
done();
