/* THE PAGE SOLD A RATIO. THE SERVER COUNTS MESSAGES.

   The plan cards led with "5x / 20x / 50x the usage", computed from token
   caps. Two things were wrong with it and only the first was noticed.

   It was ARITHMETICALLY stale: the multiple was calibrated when every tier ran
   the same engine, and the paid floor now runs one costing five times per
   token what the free one does, so the same money buys a far smaller multiple
   of tokens. Funded honestly, Pro is about 1.5x Free.

   And it was the WRONG UNIT anyway. A ratio of token counts across engines of
   different cost is a ratio of two things that are not the same thing, and
   "2.3M tokens" answers no question somebody walking up to a pricing page is
   asking. What the server actually counts, and refuses on, is messages - in a
   five-hour window, in a week for the top engines, and in a month.

   So the cards print those three numbers, and this is what stops them from
   becoming the next "5x": every figure the page shows is read from a table
   mirrored out of PLAN_LIMITS, and this lifts BOTH and compares them plan by
   plan. The same arrangement AUTO_MAX_BY_PLAN and PLAN_RPM already have, for
   the same reason - a claim and its enforcement in two files with nothing
   tying them together is the defect, not any particular number.

   IT ALSO CHECKS A SENTENCE. "The cheapest paid plan gets the same model as
   the most expensive one" was in the Help Center, and it is not true: Forge
   and Apex are distinct engines. What IS true - and what the engine ladder is
   built to hold - is that they bill the same per token. That is a different
   promise, and the difference is exactly the kind that reads as a rounding
   error right up until somebody checks.

   BROKEN FOUR WAYS. Drifting the page's Pro month, and separately lowering the
   SERVER's weekly top-engine cap, each fail the mirror line for that exact
   plan and field - both directions, which matters, because the drift that
   actually happens is usually the server moving while the page stays put.
   Putting a usage multiple back on a card fails the multiple line. Restoring
   the Help Center sentence fails the engine-claim line. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const server = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const client = readFileSync(join(ROOT, 'app.js'), 'utf8');

/* PLAN_LIMITS is nested, so it cannot be read with the flat matcher the other
   mirror tests use. Imported instead: the Worker is a module, and importing it
   reads the object the request path actually consults rather than a regex's
   opinion of it. */
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'planlimits.harness.mjs');
writeFileSync(harness, server + `
export { PLAN_LIMITS, ENGINES, PLAN_RANK };
`);
const W = await import(harness + '?t=' + Date.now());
const { PLAN_LIMITS, ENGINES, PLAN_RANK } = W;

/* The client tables, out of the bundle the browser runs. */
function clientTable(name) {
  const m = codeOnly(client).match(new RegExp(name + '\\s*=\\s*\\{([^}]*)\\}'));
  if (!m) return null;
  const out = {};
  for (const [, k, v] of m[1].matchAll(/([a-z]+)\s*:\s*(\d+)/g)) out[k] = Number(v);
  return out;
}

const TIERS = ['free', 'pro', 'elite', 'ultra'];
const MIRRORS = [
  ['PLAN_MONTH_MESSAGES', 'monthMessages', 'how many messages a month'],
  ['PLAN_MESSAGES_5H',    'messages5h',    'how many in a five-hour window'],
  ['PLAN_TOP_WEEK',       'topMessagesWeek', 'how many top-engine messages a week'],
];

section('Every number the cards print is the number the server refuses on');
for (const [table, field, what] of MIRRORS) {
  const c = clientTable(table);
  ok(!!c, `the app carries ${table} - ${what}`, c);
  if (!c) continue;
  for (const p of TIERS) {
    const s = PLAN_LIMITS[p] && PLAN_LIMITS[p][field];
    ok(s !== undefined && c[p] === s,
       `[${p}] ${table} agrees with PLAN_LIMITS.${p}.${field}`,
       { page: c[p], server: s });
  }
}

section('And the window the page names is the window the server opens');
{
  const code = codeOnly(client);
  const hours = (code.match(/USAGE_WINDOW_HOURS\s*=\s*(\d+)/) || [])[1];
  ok(hours === '5', 'the page says five hours', hours);
  const ms = (codeOnly(server).match(/WINDOW_5H_MS\s*=\s*([^;]+);/) || [])[1];
  ok(!!ms && /5\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(ms),
     'and the server counts in a five-hour window', ms && ms.trim());
  /* A weekly key exists at all - the top-engine number is meaningless without
     one, and it would be a plausible thing to advertise before building. */
  ok(/function\s+weekKey|const\s+weekKey/.test(codeOnly(server)),
     'and there is a weekly key for the top-engine count to reset against');
}

section('Nothing on the page sells a multiple of somewhere else any more');
{
  const code = codeOnly(client);
  const bad = [
    /\d+\s*(?:&times;|×|x)\s*the usage/i,
    /\d+\s*(?:&times;|×|x)\s*the free allowance/i,
  ].filter(re => re.test(code));
  ok(bad.length === 0, 'no card or table quotes a usage multiple', bad.map(String));
}

section('The engine claim is the one the ladder can keep');
{
  const code = codeOnly(client);
  /* Written as one negated literal rather than a match stored in a variable,
     and the difference is not style. `a-check-anchored-on-prose-is-not-a-check`
     skips a negated pattern on purpose - stripping comments can only make an
     absence MORE true - but it reads the source, so a negation split across two
     statements looks to it like an ordinary positive match on a phrase that
     now survives only in the comment below. It said so. One expression says
     what this actually asserts. */
  ok(!/same model as the most expensive/i.test(code),
     'the page does not claim the cheapest paid plan runs the same MODEL');

  const paid = Object.values(ENGINES).filter(e => PLAN_RANK[e.minPlan] > 0)
    .sort((a, b) => PLAN_RANK[a.minPlan] - PLAN_RANK[b.minPlan]);
  const floor = paid[0], top = paid[paid.length - 1];
  ok(floor.model !== top.model, 'because they are genuinely different engines',
     [floor.model, top.model]);
  ok(floor.inCost === top.inCost && floor.outCost === top.outCost,
     'while billing the same per token, which is the claim that IS true',
     { floor: [floor.inCost, floor.outCost], top: [top.inCost, top.outCost] });
  ok(/buys MORE of the best engine rather than a better one|more of it<\/b>, not a better one|more of the best, not a better one/i.test(code),
     'and the page makes that claim in those terms');
}

section('A tier is not sold a top engine its plan floor refuses');
{
  /* Forge is Pro and above, Apex is Elite and above, and the cards say so. The
     cheap way to get this wrong is to promise Apex on the Pro card because the
     sentence sounds better. */
  const forge = Object.values(ENGINES).find(e => /forge/i.test(e.model) || false);
  const apexRung = Object.entries(ENGINES).find(([k]) => k === 'amv-apex');
  const forgeRung = Object.entries(ENGINES).find(([k]) => k === 'amv-forge');
  ok(!!apexRung && !!forgeRung, 'both named rungs exist',
     Object.keys(ENGINES));
  if (apexRung && forgeRung) {
    ok(forgeRung[1].minPlan === 'pro', 'Forge opens at Pro', forgeRung[1].minPlan);
    ok(PLAN_RANK[apexRung[1].minPlan] > PLAN_RANK[forgeRung[1].minPlan],
       'and Apex is above it, so the Pro card may not promise Apex alone',
       { apex: apexRung[1].minPlan, forge: forgeRung[1].minPlan });
  }
  const code = codeOnly(client);
  const proBlock = (code.match(/pro:\s*\{\s*anchor:[\s\S]{0,1400}?reassure:/) || [''])[0];
  ok(proBlock.length > 100, 'the Pro pitch is readable in the bundle', proBlock.length);
  ok(/AMV Forge/.test(proBlock), 'and it names Forge', proBlock.slice(0, 200));
}

process.exit(report() === 0 ? (done(), 0) : 1);
