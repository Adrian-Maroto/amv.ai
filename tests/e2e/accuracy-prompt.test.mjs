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

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
