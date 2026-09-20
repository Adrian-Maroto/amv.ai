/* THE UPGRADE BLOCK WAS SHOUTING, AND THE ROW BELOW IT WAS WHISPERING.

   Billing offered the next plan as a full-width filled accent panel carrying
   three lines of white text, and the plan after that as a plain bordered box.
   Two rows offering the same kind of thing in two completely different visual
   languages, one of them the loudest object on the page - on a screen somebody
   opens to find out what they are being charged, not to be sold to.

   THE REASON IT WAS FILLED IS RECORDED AND IT IS A REAL ONE. Somebody had
   already tried the quiet version: a TINTED panel measured 3.03:1 for its own
   text, and a recommendation nobody can read is not one. That argument is
   about a tint. A plain raised surface with an accent BORDER has no such
   problem, because the text then sits on the same surface as every other row
   on the page. So the recommendation is carried by a border and a tag.

   WHICH IS ONLY AN IMPROVEMENT IF IT IS MEASURED. This renders the page in
   both themes and reads the contrast of what is actually in that row, rather
   than trusting that moving the colour around worked - the failure mode of
   this exact change, twice now, is text that inherits a colour chosen for a
   background it no longer has. That is how the "/mo" after the price came to
   be #fff on a near-white surface: 1.05:1, which is not low contrast, it is
   invisible.

   And the four plan facts are a grid rather than a column with a 132px label
   gutter, which is a lot of screen for four short answers. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;
await page.waitForTimeout(300);

const read = (light) => page.evaluate(async (l) => {
  document.body.classList.toggle('light', l);
  saveStr('amv_plan', 'pro');
  setTab('billing');
  await new Promise(r => setTimeout(r, 700));

  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = (s) => { const m = String(s).match(/-?[\d.]+/g) || [];
    return 0.2126 * lin(+m[0] || 0) + 0.7152 * lin(+m[1] || 0) + 0.0722 * lin(+m[2] || 0); };
  /* THE BACKGROUND HAS TO BE COMPOSITED, NOT READ.

     The first version of this walked up to the first non-transparent
     background and used it as-is. A tint is rgba(...,.16), and treating that
     as an opaque colour compares the text against the FULL-STRENGTH accent -
     which is not on the screen anywhere. It reported the recommendation tag
     at 1.0:1 and 1.21:1, a defect that does not exist, on a check whose whole
     job is to notice ones that do.

     Each translucent layer is blended over what is behind it, the way the
     browser paints it. */
  const parse = (v) => { const m = (String(v).match(/-?[\d.]+/g) || []).map(Number);
    return { r: m[0] || 0, g: m[1] || 0, b: m[2] || 0, a: m.length > 3 ? m[3] : 1 }; };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a),
                            g: f.g * f.a + b.g * (1 - f.a),
                            b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c.a > 0) stack.push(c);
      if (c.a >= 1) break;
    }
    if (!stack.length) stack.push({ r: 255, g: 255, b: 255, a: 1 });
    let out = stack[stack.length - 1];
    for (let i = stack.length - 2; i >= 0; i--) out = over(stack[i], out);
    return 'rgb(' + Math.round(out.r) + ', ' + Math.round(out.g) + ', ' + Math.round(out.b) + ')';
  };
  const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  const lead = document.querySelector('.bill-plan-row.lead');
  const rows = [...document.querySelectorAll('.bill-plan-row')];
  /* Every piece of text inside the recommended row, measured against what is
     actually painted behind it. */
  const inLead = lead ? [...lead.querySelectorAll('*')]
    .filter(e => e.children.length === 0 && (e.textContent || '').trim())
    .map(e => ({ t: e.textContent.trim().slice(0, 18),
                 r: +ratio(getComputedStyle(e).color, bgOf(e)).toFixed(2) })) : [];

  return {
    rows: rows.length,
    leadBg: lead ? getComputedStyle(lead).backgroundColor : '',
    rowBg: rows[1] ? getComputedStyle(rows[1]).backgroundColor : '',
    leadBorder: lead ? getComputedStyle(lead).borderTopColor : '',
    rowBorder: rows[1] ? getComputedStyle(rows[1]).borderTopColor : '',
    tag: !!(lead && lead.querySelector('.bill-swap-tag')),
    worst: inLead.sort((a, b) => a.r - b.r)[0] || null,
    inLead,
    factCols: (() => { const f = document.querySelector('.vi-bill .bill-facts');
      return f ? getComputedStyle(f).gridTemplateColumns.split(' ').length : 0; })(),
    facts: document.querySelectorAll('.vi-bill .bill-facts > div').length,
  };
}, light);

for (const light of [false, true]) {
  const name = light ? 'light' : 'dark';
  const r = await read(light);

  section(`The recommendation is marked, not shouted [${name}]`);
  {
    ok(r.rows >= 2, 'there is more than one plan offered', r.rows);
    ok(r.tag, 'the recommended one carries a tag');
    /* THE DEFECT: one row filled with accent, the other a plain box. */
    ok(r.leadBg === r.rowBg,
       'and it sits on the same surface as the row below it, not a wall of colour',
       { lead: r.leadBg, other: r.rowBg });
    ok(r.leadBorder !== r.rowBorder,
       'while still being distinguishable from it', { lead: r.leadBorder, other: r.rowBorder });
  }

  section(`Everything in that row can be read [${name}]`);
  {
    ok(r.inLead.length >= 3, 'there is text in it to measure', r.inLead.length);
    ok(r.worst && r.worst.r >= 4.5,
       'the least legible thing in it still clears 4.5:1', r.worst);
  }

  section(`The plan facts are a grid, not a column [${name}]`);
  {
    ok(r.facts === 4, 'four facts', r.facts);
    ok(r.factCols === 2, 'laid out in two columns', r.factCols);
  }
}

await page.evaluate(() => document.body.classList.remove('light'));
ok(errors.length === 0, 'and none of it raised an error', errors);
await app.close();
process.exit(report() === 0 ? (done(), 0) : 1);
