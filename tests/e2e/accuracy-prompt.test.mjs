/* ACCURACY CONTRACT — AMV's core promise is that it does not make things up.
   These rules live in the system prompt, so they are invisible and easy to
   delete by accident. This suite pins them: if someone strips an accuracy rule,
   this goes red before it reaches users. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp();
const { page, errors } = app;

const sys = await page.evaluate(() => {
  const s = (typeof SYS !== 'undefined') ? (Array.isArray(SYS) ? SYS.join('\n') : String(SYS)) : '';
  const crew = (typeof _AMVSYS !== 'undefined') ? String(_AMVSYS) : '';
  return { s, crew, len: s.length };
});
ok(sys.len > 0, 'the chat system prompt is present', sys.len);

section('Never fabricate');
ok(/NEVER invent facts, sources, quotations, statistics, links/i.test(sys.s), 'forbids inventing facts, sources, quotes, statistics and links');
ok(/fake citation|citation must directly support/i.test(sys.s), 'forbids fake citations and requires citations to support their claim');
ok(/Never pretend to see content you do not have/i.test(sys.s), 'forbids pretending to see files/pages it was not given');

section('Never claim work it did not do (the trust-critical rule)');
ok(/NEVER claim to have opened, searched, read, tested, calculated, run, contacted, submitted, sent, uploaded, booked, or completed/i.test(sys.s),
  'forbids claiming completed actions that did not actually happen');
ok(/If a tool, search, or action FAILS, say it failed/i.test(sys.s), 'requires admitting tool/search failures instead of inventing results');
ok(/never state that you opened, searched, tested, sent, submitted, booked, or completed/i.test(sys.crew),
  'the same rule binds AUTONOMOUS crew work, where nobody reviews before it sends');

section('Verification and currency');
ok(/two independent reliable sources/i.test(sys.s), 'requires corroboration for important claims');
ok(/primary sources|authoritative sources/i.test(sys.s), 'prefers primary/authoritative sources');
ok(/if reliable sources disagree, explain the disagreement/i.test(sys.s), 'surfaces source disagreement instead of silently picking one');
ok(/time-sensitive|outdated/i.test(sys.s), 'flags time-sensitive and potentially outdated knowledge');

section('Calibrated uncertainty, not false confidence');
ok(/Confirmed \/ Likely \/ Uncertain \/ Unable to verify/i.test(sys.s), 'defines explicit confidence labels');
ok(/Separate verified facts from assumptions/i.test(sys.s), 'separates fact from assumption');
ok(/Do NOT agree just to sound helpful/i.test(sys.s), 'forbids sycophantic agreement and requires correcting false premises');
ok(/Accuracy is more important than speed/i.test(sys.s), 'states the priority order explicitly');

section('Rigor on calculation, code, and high-stakes topics');
ok(/RE-CHECK important totals/i.test(sys.s), 'requires re-checking calculations');
ok(/carry correct units/i.test(sys.s), 'requires correct units');
ok(/Do not present untested code as guaranteed to work/i.test(sys.s), 'forbids presenting untested code as guaranteed');
ok(/medical, legal, financial, or safety/i.test(sys.s), 'applies extra care to high-stakes questions');

section('Final self-check before answering');
ok(/BEFORE SENDING, silently check/i.test(sys.s), 'requires a pre-send verification pass');
ok(/Remove any statement you cannot support/i.test(sys.s), 'requires stripping unsupportable claims');

section('The disclaimer is always visible to users');
const disc = await page.evaluate(() => {
  const el = document.querySelector('.amv-disclaimer');
  return el ? { text: el.textContent, visible: getComputedStyle(el).display !== 'none' } : null;
});
ok(!!disc, 'a disclaimer is rendered under the composer');
ok(/AMV is an AI and can make mistakes/i.test(disc.text), 'it says AMV is an AI that can make mistakes', disc.text);
ok(/check important answers/i.test(disc.text), 'and tells people to check important answers');
ok(disc.visible, 'and it is actually visible, not hidden');

section('Independent verification layer (measurable accuracy, not just a promise)');
const v = await page.evaluate(() => {
  const V = window.AMVVerify;
  if (!V) return { missing: true };
  return {
    missing: false,
    money: V.shouldVerify('15% tip on $84?', 'That is $12.60'),
    medical: V.shouldVerify('ibuprofen dosage', '200 mg every 6 hours'),
    calc: V.shouldVerify('calculate the total', 'the sum is 480'),
    creative: V.shouldVerify('write me a haiku about rain', 'soft rain falls down'),
    agreeSame: V.agree('The total is 12.60', 'I get 12.60').agree,
    agreeDiff: V.agree('The total is 12.60', 'I calculate 15.40').agree,
    chipOk: V.chipHTML({ status: 'agreed', note: 'x' }),
    chipConflict: V.chipHTML({ status: 'conflict', note: 'x' }),
    chipNone: V.chipHTML(null)
  };
});
ok(!v.missing, 'the verification layer is live');
ok(!!v.money && !!v.medical && !!v.calc, 'money, medical and calculations are flagged for independent re-checking');
ok(v.creative === null, 'creative writing is NOT re-checked, so normal chat stays fast');
ok(v.agreeSame === true, 'two independent solves that match are recognised as agreeing');
ok(v.agreeDiff === false, 'a disagreement between independent solves is caught', v.agreeDiff);
ok(/Double-checked/.test(v.chipOk), 'agreement shows a "Double-checked" chip');
ok(/disagreed/i.test(v.chipConflict), 'a conflict is surfaced to the user, never hidden');
ok(v.chipNone === '', 'no chip is shown when nothing was verified (never a badge we did not earn)');

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
