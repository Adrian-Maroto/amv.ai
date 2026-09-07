/* THREE IDENTICAL SHOUTS ARE NOT A RECOMMENDATION.

   Every upgrade button was `btn bp` - the filled accent - so $15, $75 and
   $200 arrived as three identical full-width primary buttons stacked on each
   other. Nothing led, so the whole decision fell on the person, from a
   product that knows the ladder perfectly well.

   The one that leads is `upTargets[0]`: the NEXT STEP UP from wherever
   somebody already is. Pro from Free, Elite from Pro, Ultra from Elite. A
   rule, not a favourite - it stays correct if the ladder changes, and it
   never recommends a $200 jump to somebody who has not paid anything yet,
   which is the one recommendation a brand nobody has heard of cannot make
   credibly.

   THE BADGE HAS TO STAY TRUE, and that is most of why this file exists.
   "Most popular" is the obvious thing to write on a lead plan button and AMV
   must not write it: there are no customers yet, so it would be a claim about
   other people that nobody could stand behind. "Start here" and "Next step
   up" only describe where the button sits on the ladder, which is true on the
   first day and every day after. The last section fails if anybody ever
   reaches for the easier words. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;
await page.setViewportSize({ width: 390, height: 844 });

const chooserOn = (plan) => page.evaluate(async (p) => {
  try { S.plan = p; saveStr('amv_plan', p); } catch (e) {}
  setTab('billing');
  await new Promise(r => setTimeout(r, 900));
  return [...document.querySelectorAll('.bill-swap button')].filter(b => b.offsetParent).map(b => {
    /* Reachability is asked AFTER scrolling to it: on a phone this list sits
       below the fold, and "below the fold" is not "unreachable". */
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { text: (b.textContent || '').trim().replace(/\s+/g, ' '),
             lead: b.classList.contains('bill-swap-lead'),
             primary: b.classList.contains('bp'),
             width: Math.round(r.width),
             /* Measured with the harness comparator, not by rounding here.
                Rounding first turns 39.6 into 40 and calls it a pass, and
                `every-page-can-measure-itself` fails any suite that compares
                a rendered box to a bare integer - which the first version of
                this file did, and which is what turned the gate red. */
             height: Math.round(r.height),
             bigEnough: !__under(r.height, 40),
             owns: !!(t && (t === b || b.contains(t))) };
  });
}, plan);

section('From Free, the first paid step is the one that leads');
{
  const b = await chooserOn('free');
  ok(b.length === 3, 'three plans to move up to', b.length);
  ok(b[0].lead && b[0].primary && /Pro/.test(b[0].text), 'Pro leads', b[0]);
  ok(/Start here/.test(b[0].text), 'labelled as where to start', b[0].text);
  ok(!b[1].primary && !b[2].primary,
     'and Elite and Ultra step back to secondary - the fault was all three being primary',
     [b[1].primary, b[2].primary]);
}

section('From a paid plan, it moves up with you');
{
  const p = await chooserOn('pro');
  ok(p[0].lead && /Elite/.test(p[0].text), 'on Pro, Elite leads', p[0].text);
  ok(/Next step up/.test(p[0].text), 'labelled as the next step', p[0].text);
  ok(!/Start here/.test(p[0].text), 'not "start here", which would be false here', p[0].text);

  const e = await chooserOn('elite');
  ok(e[0].lead && /Ultra/.test(e[0].text), 'on Elite, Ultra leads', e[0].text);
  ok(e.some(x => /Switch to Pro/.test(x.text) && !x.primary),
     'and moving DOWN is still offered, quietly', e.map(x => x.text));
}

section('Nothing was hidden or made harder to press');
{
  for (const plan of ['free', 'pro', 'elite']) {
    const b = await chooserOn(plan);
    ok(b.every(x => x.owns), 'on ' + plan + ', every plan button takes its own tap',
       b.filter(x => !x.owns));
    ok(b.every(x => x.bigEnough), 'and is big enough to hit', b.map(x => x.height));
    const w = b.map(x => x.width);
    ok(Math.max(...w) - Math.min(...w) < 40,
       'the quiet ones keep their full width - demoted in weight, not in size', w);
  }
}

section('And the badge is readable in BOTH themes');
{
  /* THE BADGE WAS ADDED WITH A BACKGROUND AND NO COLOUR OF ITS OWN, twice.

     First `rgba(255,255,255,.18)`, which reads in dark theme and came out
     white-on-near-white in light. Then `rgba(0,0,0,.22)`, which fixed light
     and broke DARK - measured with real alpha compositing at 3.22 against
     the 4.5 it needs.

     The two themes put OPPOSITE text colours on this button: white on the
     light accent, near-black on the dark one. So there is no fill that is
     safe for both, and the pill now uses an outline and touches nothing
     behind the text. That is the property asserted here - not a number I
     picked, but that the badge's contrast EQUALS the button's own, which
     somebody already chose deliberately for each theme.

     Composited properly. A ratio taken without compositing alpha reported
     1.00 for a badge that was merely washed out, which is a number that
     sends somebody looking for the wrong bug. */
  const readable = (theme) => page.evaluate(async (t) => {
    try { applyTheme(t); } catch (e) { document.body.classList.toggle('light', t === 'light'); }
    setTab('billing');
    await new Promise(r => setTimeout(r, 800));
    const tag = document.querySelector('.bill-swap-tag');
    if (!tag) return { found: false };
    const btn = tag.closest('button');
    /* 0..1 components when the value came from `color-mix()`, 0..255 otherwise. */
    const k = s => /^color\(/i.test(String(s).trim()) ? 255 : 1;
    const rgb = s => (String(s).match(/[\d.]+/g) || []).slice(0, 3).map(v => +v * k(s));
    const rgba = s => { const m = (String(s).match(/[\d.]+/g) || []).map(Number);
      return { c: m.slice(0, 3).map(v => v * k(s)), a: m.length > 3 ? m[3] : 1 }; };
    const over = (f, a, b) => f.map((v, i) => v * a + b[i] * (1 - a));
    const lum = c => { const [r, g, b] = c.map(v => { v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const L1 = lum(a), L2 = lum(b);
      return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
    const btnBg = rgb(getComputedStyle(btn).backgroundColor);
    const pill = rgba(getComputedStyle(tag).backgroundColor);
    const eff = pill.a === 0 ? btnBg : over(pill.c, pill.a, btnBg);
    return { found: true,
             badge: +ratio(rgb(getComputedStyle(tag).color), eff).toFixed(2),
             button: +ratio(rgb(getComputedStyle(btn).color), btnBg).toFixed(2) };
  }, theme);

  for (const theme of ['light', 'dark']) {
    const r = await readable(theme);
    ok(r.found, theme + ': the badge is on screen', r);
    ok(r.badge >= 4.5, theme + ': it clears 4.5:1 against what is actually behind it', r);
    ok(Math.abs(r.badge - r.button) < 0.01,
       theme + ': and reads exactly as well as the button it sits on, because the pill '
       + 'changes nothing behind the text', r);
  }
  await page.evaluate(() => { try { applyTheme('dark'); } catch (e) {} });
}

section('And the badge does not invent social proof');
{
  const html = await page.evaluate(() => document.getElementById('vc').innerHTML);
  ok(!/most popular|best value|recommended by|customers choose/i.test(html),
     'no claim about what other people picked - AMV has no customers to count yet', true);
}

section('Nothing broke');
ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));

await app.close();
if (report('the-plan-chooser-recommends-one-thing') > 0) process.exitCode = 1;
done();
