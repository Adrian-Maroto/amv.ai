/* THE SECOND HALF OF "QUIET BY DEFAULT", AND A CORRECTION TO ITS NAME.

   The milestone calls this "interruption scoring". A score is the wrong shape
   twice over. A model asked how urgent something is returns a confident number
   with nothing behind it, and a number nobody can trace is worse than none,
   because it gets acted on. A RULE-based score is barely better: it still hides
   a threshold the person cannot see, so somebody who asked to be emailed daily
   and was not has no way to find out why.

   What a run knows for free, with nothing to guess about, is whether it said
   the same thing as last time. And the honest use of that is an OFFER, not an
   override: a person said "email me daily", and deciding on their behalf that
   they did not mean it is how an account is lost. One boring email is not.

   So what this suite holds is a bargain with three halves:

     - AMV counts, and asks, after the job has repeated itself enough times to
       be past coincidence.
     - Nothing is suppressed until they say yes, and nothing is suppressed for a
       job that said something new.
     - A job running quietly says so ON ITS ROW, so it can never be mistaken for
       a job that has quietly stopped working. That is the whole of what they
       were promised when they accepted. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'samething.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `
export { runDueAutomations, _runDigest, _offerFor, OFFER_AFTER_SAME, autoUpdate };
export function __setSendEmail(fn){ _sendEmail = fn; }
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'owner@test.com';
const sent = [];
W.__setSendEmail(async (env, to, subject, html, text) => {
  sent.push({ to, subject, html, text }); return true;
});
W.__setRequireUser(async () => ({ email: ME, plan: 'ultra' }));

const store = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', EMAIL_API_KEY: 'k',
  APP_URL: 'https://amv.test', AMV_KV: {
  async get(k){ return store.has(k) ? store.get(k) : null; },
  async put(k, v){ store.set(k, v); },
  async delete(k){ store.delete(k); },
  async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
} };

const job = (over) => Object.assign({ id: 'j0', detail: 'weekly note', repeat: 'daily',
  interval: 86400000, next: Date.now() - 60000, kind: 'task', approval: 'auto',
  notify: 'email', active: true, runs: 0, uses: [] }, over || {});

const seed = (items) => {
  store.clear();
  store.set('ent:' + ME, JSON.stringify({ plan: 'ultra' }));
  store.set('auto:' + ME, JSON.stringify({ items, results: [] }));
};
/* A DISTINCT MORNING EACH TIME, WHICH IS NOT A DETAIL.

   `_claimOnce` leases a run slot keyed by `email:jobId:next`, so two overlapping
   cron invocations cannot both execute the same due job - one model call, one
   email. Real mornings are a day apart and never collide. Ticks in a test fire
   within the same millisecond, so reusing `Date.now() - 60000` for each one
   asks for the SAME slot and the lease refuses every run after the first,
   nondeterministically depending on how fast the process is going. That is the
   lease working. Each tick therefore gets its own due-time, a day further back,
   which is what a sequence of mornings actually looks like. */
let _morning = 0;
/* One tick is one morning: the jobs are daily, so `next` is pulled back the
   way a day passing would do it. `say` is what the model returns this time. */
const tick = async (say) => {
  const rec = JSON.parse(store.get('auto:' + ME) || '{}');
  _morning++;
  for(const it of (rec.items || [])) it.next = Date.now() - (_morning * 86400000);
  store.set('auto:' + ME, JSON.stringify(rec));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    content: [{ text: say }], usage: { input_tokens: 5, output_tokens: 5 } }), { status: 200 });
  await W.runDueAutomations(env);
  globalThis.fetch = realFetch;
  return JSON.parse(store.get('auto:' + ME) || '{}');
};
const SAME = 'Nothing is due this week.';

section('The digest answers one question and does not overreach');
{
  ok(W._runDigest('abc') === W._runDigest('abc'), 'the same text digests the same', true);
  ok(W._runDigest('abc') !== W._runDigest('abd'), 'different text does not', true);
  ok(W._runDigest('  abc\n\n def ') === W._runDigest('abc def'),
     'whitespace alone is not a change', true);
  /* A run stamps the day it ran into its own output. Two runs that differ only
     by that stamp have not said anything new. */
  ok(W._runDigest('Run: 2026-09-11\nAll clear.') === W._runDigest('Run: 2026-09-12\nAll clear.'),
     'and neither is the date the run stamped on itself', true);
  /* THE DANGEROUS DIRECTION. Normalising harder would make two genuinely
     different answers look identical, and a suppressed real change is the
     error that matters here - a missed repeat only costs an offer. */
  ok(W._runDigest('Due: 2026-09-11') !== W._runDigest('Due: 2026-09-11 and one more thing'),
     'a real change alongside a date is still a change', true);
  ok(W._runDigest('$40 due') !== W._runDigest('$4,000 due'),
     'and a number is content, never noise', true);
}

section('It counts, and says nothing until it has asked');
{
  seed([job()]);
  sent.length = 0;
  let rec = null;
  for(let i = 0; i <= W.OFFER_AFTER_SAME; i++) rec = await tick(SAME);
  const it = rec.items[0];
  ok(it.sameRuns >= W.OFFER_AFTER_SAME, 'the repeats are counted', it.sameRuns);
  ok(sent.length === W.OFFER_AFTER_SAME + 1,
     'and every one of those mornings was still emailed, because nobody has agreed to anything',
     sent.length);
  const off = W._offerFor(rec, it);
  ok(off && off.kind === 'quiet', 'now there is an offer', off && off.kind);
  /* THE FLOOR, IN LITERAL NUMBERS. Every assertion around this one is written
     against `OFFER_AFTER_SAME`, so lowering the constant to 1 changes what the
     suite asks for and nothing fails - which is how a threshold chosen to be
     past coincidence quietly becomes a threshold that fires on a coincidence.
     Four repeats is five identical mornings; three is not enough. */
  ok(W.OFFER_AFTER_SAME >= 4,
     'and it takes five identical mornings, not two, so it cannot fire on a coincidence',
     W.OFFER_AFTER_SAME);
  ok(W._offerFor(rec, Object.assign({}, it, { sameRuns: 3 })) === null,
     'three repeats is not yet a habit worth interrupting somebody about', true);
  ok(W._offerFor(rec, Object.assign({}, it, { sameRuns: 4 })) !== null,
     'four is', true);
  ok(/same thing/i.test(String(off.say)), 'that says what it noticed', off && off.say);
  ok(/lose nothing/i.test(String(off.say)),
     'and what they keep, which is the part that makes it answerable', off && off.say);
  ok(off.accept !== off.decline && String(off.decline).length > 0,
     'with a real second answer, not a dismiss', [off.accept, off.decline]);
}

section('A job that keeps changing is never offered this');
{
  seed([job()]);
  let rec = null;
  for(let i = 0; i <= W.OFFER_AFTER_SAME + 2; i++) rec = await tick('Something new: ' + i);
  ok((rec.items[0].sameRuns || 0) === 0, 'nothing repeated, so nothing counted', rec.items[0].sameRuns);
  ok(W._offerFor(rec, rec.items[0]) === null, 'and nothing is proposed', true);
}

section('A job nobody asked to be emailed about is never offered it either');
{
  /* There is no interruption to trade away - the result was always going to sit
     in the app - so proposing the trade would be asking for a yes that buys
     them nothing. */
  seed([job({ notify: 'app' })]);
  let rec = null;
  for(let i = 0; i <= W.OFFER_AFTER_SAME + 1; i++) rec = await tick(SAME);
  ok((rec.items[0].sameRuns || 0) >= W.OFFER_AFTER_SAME,
     'the repeats are still counted', rec.items[0].sameRuns);
  ok(W._offerFor(rec, rec.items[0]) === null, 'and no offer is made', true);
}

section('Once they say yes, a repeat stops arriving - and says where it went');
{
  seed([job()]);
  let rec = null;
  for(let i = 0; i <= W.OFFER_AFTER_SAME; i++) rec = await tick(SAME);

  /* THROUGH THE ENDPOINT, not by writing the flag. Setting `quietUnchanged` by
     hand tests the tick and leaves the half that turns a tap into that flag
     completely unmeasured - which is exactly how a button that posts to a route
     nobody implemented ships looking fine. */
  const res = await W.autoUpdate(new Request('https://x/v1/auto/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'offer', job: 'j0', accept: true }),
  }), env);
  const body = await res.json();
  ok(body.applied === 'quiet', 'accepting is reported back', body);
  rec = JSON.parse(store.get('auto:' + ME));
  ok(rec.items[0].quietUnchanged === true, 'and really written', rec.items[0].quietUnchanged);
  ok(rec.items[0].active !== false && rec.items[0].notify === 'email',
     'without switching the job off or changing what it is for', rec.items[0]);

  sent.length = 0;
  rec = await tick(SAME);
  ok(sent.length === 0, 'the repeat is not emailed', sent.length);
  const results = rec.results || [];
  ok(results.length >= 3, 'but the run still happened and is still in AMV', results.length);
  ok(String(results[results.length - 1].out).includes('Nothing is due'),
     'in full, not as a note saying something was withheld',
     results[results.length - 1].out);
  ok(rec.items[0].quietSince > 0,
     'and the job records the day it went quiet, so its row can say so',
     rec.items[0].quietSince);
  ok(!rec.items[0].lastError,
     'without calling it an error, because nothing went wrong', rec.items[0].lastError);
}

section('And the moment it changes, it arrives again');
{
  sent.length = 0;
  const rec = await tick('Two things are due this week.');
  ok(sent.length === 1, 'the new answer is emailed', sent.length);
  ok(/Two things are due/.test(String(sent[0].html || '') + String(sent[0].text || '')),
     'and it is the new answer, not a notice about one', true);
  ok((rec.items[0].sameRuns || 0) === 0, 'the streak resets', rec.items[0].sameRuns);
  ok(!rec.items[0].quietSince,
     'and the row stops saying it is quiet, because it is not', rec.items[0].quietSince);
}

section('Saying no means it is never asked again');
{
  seed([job()]);
  let rec = null;
  for(let i = 0; i <= W.OFFER_AFTER_SAME; i++) rec = await tick(SAME);
  ok(W._offerFor(rec, rec.items[0]) !== null, 'the offer is there to decline', true);
  rec.tally = { j0: { yes: 0, no: 0, offered: true } };
  ok(W._offerFor(rec, rec.items[0]) === null,
     'and once answered it is gone, whichever way they answered', true);
  ok(!rec.items[0].quietUnchanged,
     'with nothing suppressed by the asking itself', rec.items[0].quietUnchanged);
}

if (report('a-job-that-keeps-saying-the-same-thing') > 0) process.exitCode = 1;
done();
