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

section('The examples are on the cards, not behind them');
{
  const r = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#vc .cw-job')];
    const strips = [...document.querySelectorAll('#vc .cw-job-out')];
    return {
      cards: cards.length,
      strips: strips.length,
      lines: strips.slice(0, 3).map(s => (s.querySelector('.cw-job-out-l') || {}).textContent || ''),
      labelled: strips.every(s => !!s.querySelector('.cw-job-out-k')),
    };
  });
  ok(r.cards > 20, 'there is a catalogue to look at', String(r.cards));
  ok(r.strips > 10, 'and a real share of it shows what it sends you', r.strips + '/' + r.cards);
  ok(r.strips < r.cards, 'only the jobs that HAVE an example show one - none is invented',
     r.strips + '/' + r.cards);
  ok(r.labelled, 'each is labelled as output rather than read as more description');
  ok(r.lines.every(l => l.trim().length > 10), 'and carries a real line', JSON.stringify(r.lines));
}

section('One line, and the card’s own facts do not move');
{
  const r = await page.evaluate(() => {
    /* A card that unfolds into five lines of output is a card nobody scans
       past, so the example is clamped. And two cards side by side whose
       footers disagree read as broken before anybody works out why - so the
       measurement is of a REAL ROW holding one card of each kind, not of a
       CSS property: `margin-top:auto` resolves to a different used value on
       each card by design, and comparing those proves nothing. */
    const cards = [...document.querySelectorAll('#vc .cw-job')];
    const rows = new Map();
    cards.forEach(c => {
      const t = Math.round(c.getBoundingClientRect().top);
      if(!rows.has(t)) rows.set(t, []);
      rows.get(t).push(c);
    });
    let mixed = null;
    for(const g of rows.values()){
      if(g.length < 2) continue;
      const kinds = g.map(c => !!c.querySelector('.cw-job-out'));
      if(new Set(kinds).size > 1){ mixed = g; break; }
    }
    const host = cards.find(c => c.querySelector('.cw-job-out'));
    const strip = host ? host.querySelector('.cw-job-out-l') : null;
    const lh = strip ? (parseFloat(getComputedStyle(strip).lineHeight) || 20) : 20;
    return {
      hasMixedRow: !!mixed,
      stripLines: strip ? Math.round(strip.getBoundingClientRect().height / lh) : 0,
      clamped: strip ? getComputedStyle(strip).webkitLineClamp : '',
      needBottoms: mixed
        ? mixed.map(c => { const n = c.querySelector('.cw-job-need'); return n ? Math.round(n.getBoundingClientRect().bottom) : -1; })
        : [],
    };
  });
  ok(r.stripLines <= 2, 'the example is at most two lines', String(r.stripLines));
  ok(r.clamped === '2', 'because it is clamped, not because this one happened to be short', r.clamped);
  ok(r.hasMixedRow, 'there is a row holding a card with an example and one without');
  ok(r.needBottoms.length > 1 && new Set(r.needBottoms).size === 1,
     'and their facts sit on the same line as each other', JSON.stringify(r.needBottoms));
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
