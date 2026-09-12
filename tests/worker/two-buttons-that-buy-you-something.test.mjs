/* THE LAST PIECE OF "QUIET BY DEFAULT", AND THE ONE MOST LIKELY TO BE A TAX.

   Two buttons on a result - was this worth telling you about - are trivial to
   add and worthless by default. A button whose only effect is a number on
   somebody else's dashboard costs a tap and returns nothing, and people stop
   pressing it within a week, at which point the number is not even a number
   about the product any more: it is a number about the few people still
   pressing.

   So the test is not "does the click record". It is: does answering BUY the
   person something they could not otherwise get, and does it point both ways.

     - A run of "not worth it" earns an offer to make the job quieter, or to
       stop it if it was never interrupting anybody in the first place.
     - A run of "worth it" on a job AMV has been HOLDING BACK earns an offer to
       undo that. Without this the product only ever ratchets towards silence,
       and the one person who can tell it that it went too far has no way to.
     - And it is counted apart from the approval tally, because "yes, send it"
       and "that was worth telling me" are different sentences. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'feel.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `
export { autoUpdate, autoList, _offerFor, _feelOf, _feelRecord, _tallyOf, OFFER_AFTER_MEH };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'owner@test.com';
const store = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', AMV_KV: {
  async get(k){ return store.has(k) ? store.get(k) : null; },
  async put(k, v){ store.set(k, v); },
  async delete(k){ store.delete(k); },
  async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
} };
W.__setRequireUser(async () => ({ email: ME, plan: 'ultra' }));

const JOB = { id: 'j1', detail: 'weekly note', repeat: 'daily', kind: 'task',
              approval: 'auto', notify: 'email', active: true, runs: 9 };
const results = (n) => Array.from({ length: n }, (_, i) =>
  ({ id: 'r' + i, autoId: 'j1', detail: 'weekly note', at: Date.now() - i, read: true, out: 'x' }));
const seed = (job, n) => {
  store.clear();
  store.set('auto:' + ME, JSON.stringify({
    items: [Object.assign({}, JOB, job || {})], results: results(n === undefined ? 6 : n),
    tally: {}, feel: {}, ceiling: 'auto' }));
};
const rec = () => JSON.parse(store.get('auto:' + ME) || '{}');
const offer = () => W._offerFor(rec(), rec().items[0]);
const say = async (resultId, said) => {
  const res = await W.autoUpdate(new Request('https://x/v1/auto/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'feel', result: resultId, said }),
  }), env);
  return { status: res.status, body: await res.json() };
};
const answer = async (accept) => {
  const res = await W.autoUpdate(new Request('https://x/v1/auto/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'offer', job: 'j1', accept }),
  }), env);
  return await res.json();
};

section('An answer is recorded on the result and on the job');
{
  seed();
  const r = await say('r0', 'down');
  ok(r.body.ok === true, 'the answer is accepted', r.body);
  ok(rec().results.find(x => x.id === 'r0').feel === 'down',
     'and shown on the result, so the button is not blank again next time',
     rec().results.find(x => x.id === 'r0').feel);
  ok(W._feelOf(rec(), 'j1').down === 1, 'counted against the job', W._feelOf(rec(), 'j1'));
  ok(W._tallyOf(rec(), 'j1').no === 0,
     'and NOT against the approval tally - "send this" and "that was worth telling me" '
     + 'are different sentences, and mixing them makes both counts mean nothing',
     W._tallyOf(rec(), 'j1'));
}

section('People are allowed to change their minds');
{
  seed();
  await say('r0', 'down');
  await say('r0', 'up');
  ok(rec().results.find(x => x.id === 'r0').feel === 'up', 'the answer changes',
     rec().results.find(x => x.id === 'r0').feel);
  const f = W._feelOf(rec(), 'j1');
  ok(f.up === 1 && f.down === 0, 'and the streak follows, rather than counting both', f);
}

section('The same answer twice is one answer');
{
  /* Without this, somebody tapping to confirm what they already said pushes a
     streak over the line and is offered a change they never asked for. */
  seed();
  await say('r0', 'down');
  await say('r0', 'down');
  await say('r0', 'down');
  ok(W._feelOf(rec(), 'j1').down === 1, 'one result is one opinion', W._feelOf(rec(), 'j1'));
  ok(offer() === null, 'so three taps on one result earns nothing', offer());
}

section('A result that is not there is said so, not silently counted');
{
  seed();
  const r = await say('nope', 'down');
  ok(r.status === 404 && r.body.code === 'no_result',
     'because a tap that silently did nothing is worse than one that says it could not', r.body);
}

section('A result with no job behind it is still their answer');
{
  /* The first version used "no job id" to mean "no such result", so a result
     that exists but carries no job was WRITTEN TO and then reported as a 404.
     Telling somebody their tap failed after taking it is the plainest form of
     the thing this codebase is not allowed to do. There is no offer to earn
     here - there is no job to make quieter - but the answer is theirs and the
     button still has to show it. */
  seed();
  const r0 = JSON.parse(store.get('auto:' + ME));
  delete r0.results[0].autoId;
  store.set('auto:' + ME, JSON.stringify(r0));
  const r = await say('r0', 'down');
  ok(r.status === 200 && r.body.ok === true, 'the answer is accepted, not refused', r.body);
  ok(rec().results.find(x => x.id === 'r0').feel === 'down',
     'and it is on the result, which is what the button reads',
     rec().results.find(x => x.id === 'r0').feel);
}

section('A run of "not worth it" earns the smallest change that answers it');
{
  seed();
  ok(W.OFFER_AFTER_MEH >= 3,
     'it takes a run, not one bad morning - anybody can have one', W.OFFER_AFTER_MEH);
  for(let i = 0; i < 2; i++) await say('r' + i, 'down');
  ok(offer() === null, 'two is not yet a pattern', offer());
  await say('r2', 'down');
  const o = offer();
  ok(o && o.kind === 'inapp', 'the third earns an offer', o && o.kind);
  ok(/still lands in AMV/i.test(String(o.say)),
     'to stop EMAILING it rather than to stop it - the complaint was the email, and nothing '
     + 'is lost by leaving the job running', o && o.say);
  ok(o.accept !== o.decline && String(o.decline).length > 0,
     'with a real second answer', [o.accept, o.decline]);

  const body = await answer(true);
  ok(body.applied === 'inapp', 'accepting is reported', body);
  ok(rec().items[0].notify === 'app', 'and really applied', rec().items[0].notify);
  ok(rec().items[0].active !== false,
     'without switching off a job they only said they did not want emailed',
     rec().items[0].active);
}

section('A job that was never emailing anybody is offered a pause instead');
{
  /* There is no interruption left to remove, so what is left is money spent
     making something they have said three times they do not want. */
  seed({ notify: 'app' });
  for(let i = 0; i < 3; i++) await say('r' + i, 'down');
  const o = offer();
  ok(o && o.kind === 'stop', 'the offer is to pause it', o && o.kind);
  ok(/costs you money/i.test(String(o.say)), 'and says why that is the one left', o && o.say);
  const body = await answer(true);
  ok(body.applied === 'stop' && rec().items[0].active === false, 'and it really pauses', body);
}

section('And it points the other way too, which is the whole justification');
{
  /* AMV decided to hold this job back. Then the person said the results it held
     back WERE worth telling them about. That is the only evidence that matters
     and it says AMV got it wrong. */
  seed({ quietUnchanged: true, quietSince: Date.now() - 86400000 });
  for(let i = 0; i < 3; i++) await say('r' + i, 'up');
  const o = offer();
  ok(o && o.kind === 'unquiet', 'AMV offers to undo its own decision', o && o.kind);
  ok(/looks wrong/i.test(String(o.say)),
     'and says so plainly rather than burying it in a settings screen', o && o.say);
  const body = await answer(true);
  ok(body.applied === 'unquiet', 'accepting is reported', body);
  ok(rec().items[0].quietUnchanged === false, 'the suppression is lifted', rec().items[0]);
  ok(!rec().items[0].quietSince,
     'and the row stops saying it is quiet, because it is not', rec().items[0].quietSince);
}

section('Answering an offer from feedback does not silence the other questions');
{
  /* The two counts are separate, so their "already asked" flags have to be as
     well. Marking the approval tally here would mean somebody who declined one
     question is never asked the other, for ever. */
  seed();
  for(let i = 0; i < 3; i++) await say('r' + i, 'down');
  await answer(false);
  ok(offer() === null, 'the declined offer is gone for good', offer());
  ok(W._feelOf(rec(), 'j1').offered === true, 'marked on the side it came from',
     W._feelOf(rec(), 'j1'));
  ok(W._tallyOf(rec(), 'j1').offered === false,
     'and NOT on the other, so the approval question can still be asked',
     W._tallyOf(rec(), 'j1'));
}

section('An explicit answer beats an inference');
{
  /* A job can qualify for both - it repeated itself AND they said it was not
     worth telling them. What they actually said wins over what AMV noticed. */
  seed({ sameRuns: 9 });
  for(let i = 0; i < 3; i++) await say('r' + i, 'down');
  const o = offer();
  ok(o && o.kind === 'inapp',
     'what they said outranks what AMV worked out on its own', o && o.kind);
}

if (report('two-buttons-that-buy-you-something') > 0) process.exitCode = 1;
done();
