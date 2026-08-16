/* THE THINGS PEOPLE ALREADY DO, AND THE NINETY-SIX THAT MUST SURVIVE IT.

   Two questions, and the second one is the one that would actually cost
   something.

   The first: does the everyday catalogue reach the countries AMV is promoted
   in, with jobs specific to each rather than one list translated twenty times.

   The second, and the reason this file is written the way it is: adding a
   hundred and ten job definitions must not remove ONE of the ninety-six that
   were already there. Those are the jobs that start working the moment a key
   is pasted, and losing one would be invisible - it is an entry missing from
   a list of a hundred and forty, in a product where nobody has all of them
   switched on. So every existing id is pinned here by name. A rename, a
   deletion, or a merge that drops one fails this file loudly.

   There is a live trap underneath that: the server sync REBUILDS the saved
   job list from the definitions on every run. A job appended to somebody's
   list rather than to the definitions is deleted the next time they open AMV,
   which is why the everyday jobs go into _cwDefaultJobs and why that is
   asserted rather than assumed. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const app = readFileSync(join(ROOT, 'app.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'everyday.harness.mjs');
writeFileSync(harness, src +
  '\nexport { EVERYDAY_UNIVERSAL, EVERYDAY_BY_COUNTRY, JOB_BOARDS, _coverage, COUNTRY_NAME };\n');
const W = await import(harness + '?t=' + Date.now());

const PROMOTED = {
  US: 'United States', CA: 'Canada', MX: 'Mexico', BR: 'Brazil', AR: 'Argentina',
  DE: 'Germany', GB: 'United Kingdom', FR: 'France', IT: 'Italy', RU: 'Russia',
  CN: 'China', IN: 'India', JP: 'Japan', ID: 'Indonesia', SA: 'Saudi Arabia', KR: 'South Korea',
  NG: 'Nigeria', EG: 'Egypt', ZA: 'South Africa', AU: 'Australia',
};

/* Every job that existed before the everyday catalogue was added. Pinned by
   name because a count would pass while a rename quietly broke somebody's
   saved switch.

   Ninety-three, not the ninety-six a loose grep first reported: `suggest`,
   `require` and `auto` are the three approval LEVELS, and they happen to be
   written in the same object shape a few hundred lines away. A snapshot taken
   by pattern rather than by scope picked them up, and the check then failed
   for the wrong reason. The list below is scoped to _cwDefaultJobs. */
const PINNED = [
  'job_hunt', 'morning_brief', 'inbox_digest', 'competitor_watch', 'weekly_report', 'content_calendar',
  'opportunity_radar', 'change_digest', 'money_leaks', 'forgot_check', 'renewal_watchdog', 'followups',
  'deal_watch', 'travel_guardian', 'meeting_prep', 'bills_due', 'site_monitor', 'goal_tracker',
  'deliveries', 'life_admin', 'vip_alerts', 'recurring_email', 'calendar_brief', 'conflict_watch',
  'meeting_docs', 'project_pulse', 'overdue_escalation', 'forum_watch', 'groceries', 'chores',
  'coupons', 'hotel_watch', 'ambient', 'money_morning', 'unusual_spend', 'low_balance',
  'credit_watch', 'budget_trend', 'target_buy', 'price_protect', 'bill_negotiate', 'tax_catch',
  'rate_watch', 'insurance_reshop', 'salary_bench', 'recruiter_triage', 'employer_health', 'interview_pack',
  'portfolio_fresh', 'churn_signals', 'review_watch', 'lead_triage', 'rank_watch', 'pricing_diff',
  'ad_waste', 'regulation_watch', 'breach_watch', 'tool_advisories', 'person_watch', 'brand_watch',
  'paper_digest', 'deadline_radar', 'study_drill', 'reading_queue', 'health_admin', 'appt_prep',
  'habit_pulse', 'home_seasonal', 'car_admin', 'flight_watch', 'move_watch', 'gift_radar',
  'doc_expiry', 'school_week', 'deadline_rescue', 'work_check', 'study_coach', 'exam_prep',
  'morning_brief_student', 'evening_brief_student', 'application_help', 'group_project', 'reading_digest', 'life_admin_student',
  'wellbeing_check', 'money_student', 'opportunity_student', 'inbox_cleanup', 'social_plan', 'creative_ideas',
  'creative_check', 'creative_repurpose', 'school_auto',
];

section('Every job that already worked still exists');
{
  const defs = functionBody(app, '_cwDefaultJobs');
  const have = new Set([...defs.matchAll(/\{ id:'([a-z_0-9]+)'/g)].map((m) => m[1]));
  const lost = PINNED.filter((id) => !have.has(id));
  ok(lost.length === 0, 'not one of the ninety-three was removed or renamed', lost);
  ok(PINNED.length === 93, 'and the pin covers all of them', PINNED.length);

  /* The trap: the sync rebuilds the saved list from the DEFINITIONS, so a job
     added to the list instead is deleted on the next run. */
  ok(/\]\.concat\(_everydayDefs\(\)\)/.test(codeOnly(app)),
     'the everyday jobs join the definitions, which is what survives a sync', true);
  ok(/function _everydayDefs\(\)/.test(codeOnly(app)), 'from a cache that is read there', true);
}

section('No registry entry silently overwrites another');
{
  /* THE ONE THAT COST SOMETHING. Kalibrr operates in the Philippines and in
     Indonesia; GulfTalent in the UAE and in Saudi Arabia. Both were already in
     the registry under the short key, so adding the second country under the
     same key did not add a board - a duplicate key in an object literal keeps
     the LAST value and reports nothing. Two countries silently stayed one
     board short, and the file looked exactly right in review.

     A registry keyed by hand needs this check permanently, because the failure
     mode is a value quietly disappearing rather than an error. */
  const dupes = (name) => {
    const i = src.indexOf('const ' + name + ' = {');
    const body = src.slice(i, src.indexOf('\n};', i));
    /* Object OR array values - EVERYDAY_BY_COUNTRY maps a code to a list, and
       a pattern that only accepted `{` read zero keys from it and reported no
       duplicates for a registry it had never parsed. That is why the count is
       asserted above: a sweep that finds nothing looks exactly like a clean
       one. */
    const keys = [...body.matchAll(/^  ([a-zA-Z_0-9]+):\s*[{[]/gm)].map((m) => m[1]);
    const seen = new Set(), dup = [];
    for (const k of keys) { if (seen.has(k)) dup.push(k); seen.add(k); }
    return { keys: keys.length, dup };
  };
  for (const reg of ['JOB_BOARDS', 'MAIL_PROVIDERS', 'EVERYDAY_BY_COUNTRY']) {
    const d = dupes(reg);
    ok(d.keys > 10, reg + ' was actually read', d.keys);
    ok(d.dup.length === 0, 'and no key in ' + reg + ' is written twice', d.dup);
  }
}

section('Everyday life reaches every country AMV is promoted in');
{
  ok(W.EVERYDAY_UNIVERSAL.length >= 10, 'there are jobs that are true everywhere', W.EVERYDAY_UNIVERSAL.length);
  const thin = Object.entries(PROMOTED).filter(([c]) => (W.EVERYDAY_BY_COUNTRY[c] || []).length < 5)
    .map(([c, n]) => n + ':' + (W.EVERYDAY_BY_COUNTRY[c] || []).length);
  ok(thin.length === 0, 'and at least five specific to each promoted country', thin);
}

section('Every country AMV reaches has an everyday life, not just the promoted ones');
{
  /* THE UNIVERSALITY INVARIANT, and the reason it is asserted rather than
     counted. The coverage board is computed from the mail and board
     registries, so it will happily tell somebody in Lisbon or Taipei that AMV
     works in their country. For twenty-five of the forty-five it did that
     while the everyday half - the part that is used every week rather than
     twice a year - was empty for them.

     A count would not have caught it: "twenty countries have everyday jobs"
     reads as progress. What matters is that the set of countries AMV CLAIMS
     is the same set it actually serves, so this compares the two directly and
     names any country on the wrong side. */
  const cov = W._coverage();
  const have = new Set(Object.keys(W.EVERYDAY_BY_COUNTRY));
  const claimed = cov.countries.map((c) => c.code);
  const hollow = claimed.filter((c) => !have.has(c));
  ok(hollow.length === 0,
     'no country is listed as reached while having no everyday jobs', hollow);

  /* And the reverse: a country with everyday jobs that the board never shows
     is content nobody can find. */
  const orphan = [...have].filter((c) => !claimed.includes(c));
  ok(orphan.length === 0, 'and none has jobs the coverage board never surfaces', orphan);

  ok(claimed.length >= 45, 'across every country the board lists', claimed.length);
  const thin = [...have].filter((c) => W.EVERYDAY_BY_COUNTRY[c].length < 5);
  ok(thin.length === 0, 'each with at least five of its own', thin);
}

section('They are specific to a country, not one list translated twenty times');
{
  /* The failure this guards against is a catalogue that looks local and is
     not: the same job with the country name substituted. Two countries whose
     jobs read the same are twenty countries of the same product. */
  const sig = (c) => (W.EVERYDAY_BY_COUNTRY[c] || []).map((j) => j.title).sort().join('|');
  const seen = new Map();
  const clones = [];
  /* EVERY country, not the promoted twenty. Checking only the twenty would
     have let the other twenty-five be copies of each other, which is exactly
     the shortcut that gets taken when a list grows from twenty to forty-five. */
  for (const c of Object.keys(W.EVERYDAY_BY_COUNTRY)) {
    const s = sig(c);
    if (seen.has(s)) clones.push(seen.get(s) + '=' + c);
    seen.set(s, c);
  }
  ok(clones.length === 0, 'no two countries have an identical set of jobs', clones);

  const all = Object.values(W.EVERYDAY_BY_COUNTRY).flat();
  const ids = all.map((j) => j.id);
  ok(new Set(ids).size === ids.length, 'and every job has its own id', ids.length - new Set(ids).size);
  ok(all.length + W.EVERYDAY_UNIVERSAL.length >= 110, 'across this many in total',
     all.length + W.EVERYDAY_UNIVERSAL.length);
}

section('Each one could actually run');
{
  /* AMV has mail, a calendar, the live web and somewhere to send a message.
     It has no bank connection and no government login. A job that says it will
     pay, file or renew something is a promise the product cannot keep, and
     that is worse than not offering it. */
  const all = W.EVERYDAY_UNIVERSAL.concat(Object.values(W.EVERYDAY_BY_COUNTRY).flat());
  const KNOWN = ['Email', 'Calendar', 'Web research'];
  const bad = all.filter((j) => !String(j.needs || '').split(',').map((x) => x.trim())
    .every((n) => KNOWN.includes(n))).map((j) => j.id + ':' + j.needs);
  ok(bad.length === 0, 'every one declares only access AMV actually has', bad);

  const noPrompt = all.filter((j) => !j.prompt || j.prompt.length < 250).map((j) => j.id);
  ok(noPrompt.length === 0, 'and carries a real instruction rather than a title', noPrompt);

  /* Named, because this is the line between a useful product and a lawsuit. */
  const overclaim = all.filter((j) =>
    /\b(we will pay|will pay it|pays your|files your|renews your|submits your|on your behalf)\b/i
      .test(j.prompt + ' ' + j.desc)).map((j) => j.id);
  ok(overclaim.length === 0, 'and none of them claims to pay, file or renew anything', overclaim);
}

section('A worldwide board belongs to everybody, not to a country called nothing');
{
  const globals = Object.values(W.JOB_BOARDS).filter((b) => b.global);
  ok(globals.length >= 10, 'there are boards that work from anywhere', globals.length);

  const cov = W._coverage();
  const nameless = cov.countries.filter((c) => !c.code || !c.name).map((c) => JSON.stringify(c.code));
  ok(nameless.length === 0, 'and none of them created a country with no code', nameless);
  ok(cov.totals.jobBoardsGlobal === globals.length, 'they are counted once, globally',
     { said: cov.totals.jobBoardsGlobal, real: globals.length });

  const short = Object.keys(PROMOTED).filter((c) => {
    const row = cov.countries.find((x) => x.code === c);
    return !row || row.jobs.boards < 5;
  });
  ok(short.length === 0, 'and every promoted country has five of its own', short);
}

if (report('everyday-life-where-you-live') > 0) process.exitCode = 1;
done();
