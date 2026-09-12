/* THE LAST BOUND, AND THE ONLY ONE AMV PROPOSES ITSELF.

   Somebody who has approved the same job's result every morning for a week has
   answered that question. Asking an eighth time is not caution, it is a tax on
   having set the job up - and the person is the only one who can turn their
   answer into a rule.

   The reason this is a feature rather than a dark pattern is SYMMETRY. An offer
   that only ever points towards more autonomy is a growth nudge in the costume
   of helpfulness, and it would be worth more to AMV than to the person. A run
   of rejections gets the opposite offer: pause the job, because a job whose
   output you keep throwing away costs money to produce rubbish. If only one
   direction shipped, this would be the wrong feature - so the suite tests both,
   and would fail if either disappeared. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'offer.harness.mjs');
writeFileSync(harness, src + `
export { _offerFor, _tallyOf, _tallyRecord, autoUpdate, autoList, crewApprovalAct,
         OFFER_AFTER_YES, OFFER_AFTER_NO };
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
              approval: 'require', notify: 'app', active: true, runs: 9 };
const seed = (tally, job, ceiling) => {
  store.clear();
  store.set('auto:' + ME, JSON.stringify({
    items: [Object.assign({}, JOB, job || {})], results: [],
    tally: tally || {}, ceiling: ceiling === undefined ? 'auto' : ceiling }));
};
const rec = () => JSON.parse(store.get('auto:' + ME) || '{}');
const offer = () => W._offerFor(rec(), rec().items[0]);

section('A streak counts an unbroken run, not a total');
{
  const r = { tally: {} };
  for(let i = 0; i < 4; i++) W._tallyRecord(r, 'j1', 'yes');
  ok(W._tallyOf(r, 'j1').yes === 4, 'four in a row', W._tallyOf(r, 'j1'));
  W._tallyRecord(r, 'j1', 'no');
  ok(W._tallyOf(r, 'j1').yes === 0 && W._tallyOf(r, 'j1').no === 1,
     'and one "no" resets it - somebody who said no once has not said yes five times in a row',
     W._tallyOf(r, 'j1'));
  for(let i = 0; i < 2; i++) W._tallyRecord(r, 'j1', 'yes');
  ok(W._tallyOf(r, 'j1').yes === 2 && W._tallyOf(r, 'j1').no === 0,
     'and the streak starts again from there', W._tallyOf(r, 'j1'));
}

section('Nothing is offered before the answer is actually established');
{
  /* THE THRESHOLD ITSELF, not just "whatever the constant says". The loop
     below reads `OFFER_AFTER_YES`, so it would pass just as happily if somebody
     set it to 1 - a mutation proved exactly that. One or two answers the same
     way is a coincidence; offering a rule that early is the pestering this
     design is supposed to be the opposite of. The line is held here, because
     the constant is a judgement and this is the judgement. */
  ok(W.OFFER_AFTER_YES >= 4,
     'it takes a real habit, not a coincidence, before AMV offers to stop asking',
     W.OFFER_AFTER_YES);
  ok(W.OFFER_AFTER_NO >= 3,
     'and more than one bad result before it offers to pause something they set up',
     W.OFFER_AFTER_NO);

  for(let n = 0; n < W.OFFER_AFTER_YES; n++){
    seed({ j1: { yes: n, no: 0 } });
    ok(offer() === null, n + ' approvals is not yet a rule', offer());
  }
}

section('And then it offers to stop asking');
{
  seed({ j1: { yes: W.OFFER_AFTER_YES, no: 0 } });
  const o = offer();
  ok(o && o.kind === 'auto', 'the offer appears', o);
  ok(o.count === W.OFFER_AFTER_YES, 'saying how many times they answered the same way', o.count);
  ok(/put it back to asking at any time/i.test(o.say),
     'and that it is reversible, which is the fact that makes saying yes safe', o.say);
  ok(/nothing else about the job changes/i.test(o.say),
     'and that nothing else changes, so accepting is not a blank cheque', o.say);
}

section('The other direction exists, and this suite fails if it stops');
{
  /* An offer that only ever points towards more autonomy is a growth nudge. */
  seed({ j1: { yes: 0, no: W.OFFER_AFTER_NO } });
  const o = offer();
  ok(o && o.kind === 'pause', 'a run of refusals offers to pause the job instead', o);
  ok(/costing you money/i.test(o.say),
     'saying plainly why it is worth stopping - it runs whether or not you use the result', o.say);
  ok(o.accept === 'Pause it' && o.decline === 'Keep it running',
     'with both answers named, neither of them the default', o);
}

section('It never offers something the account has forbidden');
{
  /* Offering to make a job autonomous under a ceiling of "ask first" would be
     offering something that cannot happen, and somebody who accepted would
     have been lied to twice. */
  seed({ j1: { yes: 20, no: 0 } }, {}, 'require');
  ok(offer() === null, 'no autonomy offer under an ask-first ceiling', offer());
  seed({ j1: { yes: 20, no: 0 } }, { approval: 'auto' });
  ok(offer() === null, 'and none for a job that is already autonomous', offer());
  seed({ j1: { yes: 0, no: 9 } }, { active: false });
  ok(offer() === null, 'nor anything at all about a job that is already paused', offer());
}

section('Declining means it stops asking, for good');
{
  seed({ j1: { yes: 9, no: 0 } });
  ok(offer() !== null, 'there is an offer to decline', true);
  const res = await W.autoUpdate(new Request('https://x/v1/auto/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'offer', job: 'j1', accept: false }),
  }), env);
  const body = await res.json();
  ok(body.ok === true && body.applied === null, 'declining changes nothing about the job', body);
  ok(rec().items[0].approval === 'require', 'it still asks, exactly as before', rec().items[0].approval);
  ok(offer() === null,
     'and the offer is gone for good - a prompt somebody declined and then sees again is pestering',
     offer());
  for(let i = 0; i < 10; i++) W._tallyRecord(rec(), 'j1', 'yes');
  ok(offer() === null, 'ten more approvals do not bring it back', offer());
}

section('Accepting applies exactly what it offered');
{
  seed({ j1: { yes: 9, no: 0 } });
  const res = await W.autoUpdate(new Request('https://x/v1/auto/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'offer', job: 'j1', accept: true }),
  }), env);
  const body = await res.json();
  ok(body.applied === 'auto', 'the change is reported', body);
  ok(rec().items[0].approval === 'auto', 'and really made', rec().items[0]);
  ok(rec().items[0].active !== false, 'without touching anything else about the job', rec().items[0]);

  seed({ j1: { yes: 0, no: 9 } });
  await W.autoUpdate(new Request('https://x/v1/auto/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'offer', job: 'j1', accept: true }),
  }), env);
  ok(rec().items[0].active === false, 'and the pause offer really pauses', rec().items[0]);
  ok(rec().items[0].approval === 'require',
     'without quietly changing the level too', rec().items[0].approval);
}

section('A client cannot accept an offer that was never earned');
{
  /* Re-derived under the lock rather than trusted from the request, or
     "accept: make it autonomous" would be a way to raise your own job's
     permissions by asking. */
  seed({ j1: { yes: 0, no: 0 } });
  await W.autoUpdate(new Request('https://x/v1/auto/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'offer', job: 'j1', accept: true }),
  }), env);
  ok(rec().items[0].approval === 'require',
     'a job with no streak behind it is not raised by somebody asking for it',
     rec().items[0].approval);

  seed({ j1: { yes: 20, no: 0 } }, {}, 'require');
  await W.autoUpdate(new Request('https://x/v1/auto/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'offer', job: 'j1', accept: true }),
  }), env);
  ok(rec().items[0].approval === 'require',
     'and the account ceiling is not walked through by accepting an offer it forbids',
     rec().items[0].approval);
}

section('At most one offer reaches the screen');
{
  store.clear();
  store.set('auto:' + ME, JSON.stringify({
    items: [Object.assign({}, JOB, { id: 'j1' }), Object.assign({}, JOB, { id: 'j2' })],
    results: [], tally: { j1: { yes: 9 }, j2: { yes: 9 } }, ceiling: 'auto' }));
  const res = await W.autoList(new Request('https://x/v1/auto/list'), env);
  const body = await res.json();
  ok(body.offer && body.offer.job === 'j1',
     'one offer, not a settings page nobody asked for', body.offer);
}

if (report('amv-offers-the-rule-you-have-already-written') > 0) process.exitCode = 1;
done();
