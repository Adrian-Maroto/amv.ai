/* A SMALLER ENGINE IS NOT WORSE AT EVERYTHING - IT IS WORSE AT NOTICING.

   It produces an answer that stops mid-sentence, or still has "[insert name
   here]" in it, or is a refusal rather than an answer, and hands it over as
   the finished thing. That is the whole difference between a cheap tier and a
   cheap-FEELING one, and noticing costs nothing: every one of those faults is
   structural and visible without understanding a word of the content.

   The escalation that fixes it already existed in this codebase and was wired
   to crew runs and to nothing else. Chat, Lab, Dev, Studio and every
   automation went through one shared call that took whatever came back. So
   the floor was high in the one place almost nobody looked and absent
   everywhere they did.

   It is at the shared call now. What this file holds is that it fires on a
   real fault, that it escalates UPWARD and only once, that it does not return
   a second failure over the first, and that it cannot cost a caller who does
   the check themselves twice over. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: 'https://backend.example.workers.dev',
                            user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

/* Drive aiComplete with a scripted sequence of answers and report what the
   engine was asked for each time. Nothing reaches a network. */
async function run(opts) {
  return page.evaluate(async (o) => {
    saveStr('amv_api_base', 'https://backend.example.workers.dev');
    saveStr('amv_api_token', 'tok');
    saveStr('amv_token_exp', String(Date.now() + 3e6));
    saveStr('amv_plan', o.plan || 'pro');

    const calls = [];
    const answers = o.answers.slice();
    /* Stub the one hop aiComplete makes, so the test drives the ANSWERS and
       the real escalation logic runs untouched. */
    window.fetchDeadline = async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ model: body.model });
      const text = answers.shift();
      return {
        ok: true,
        headers: { get: () => '' },
        json: async () => ({}),
        body: null,
        __text: text,
      };
    };
    window._aiReadStream = async (res) => ({
      content: [{ text: res.__text }], usage: { input_tokens: 10, output_tokens: 10 },
    });

    const out = await aiComplete('do the thing', 'be useful', o.opts || {});
    return { out, calls, models: calls.map(c => c.model) };
  }, opts);
}

section('A sound answer is returned as it is, and costs one call');
{
  const r = await run({ answers: ['Here is the finished thing, complete and specific. It ends properly.'] });
  ok(r.calls.length === 1, 'exactly one call', r.calls.length);
  ok(/finished thing/.test(r.out), 'and the answer comes straight back', r.out.slice(0, 40));
}

section('A structurally broken answer is noticed and retried higher');
{
  const broken = {
    'left a placeholder in': 'Dear [insert name here], thank you for your message about the thing we discussed at length.',
    /* Over two hundred characters on purpose: the truncation rule ignores
       anything shorter, because a brief answer that happens to end without
       punctuation is usually just brief. A genuinely cut-off reply is long. */
    'stopped mid-sentence': 'There are three reasons this matters and the first is that the budget was committed '
      + 'back in March, before anybody had seen the revised figures or had a chance to question the '
      + 'assumptions underneath them, which means the second reason is that the',
    'refused instead of answering': 'I am sorry, I cannot help with that request.',
    'came back empty': '',
  };
  for (const [why, bad] of Object.entries(broken)) {
    const r = await run({ answers: [bad, 'A complete, specific answer that finishes its own sentence.'] });
    ok(r.calls.length === 2, `[${why}] it tries again`, r.calls.length);
    ok(r.models[1] !== r.models[0],
       `[${why}] on a different engine, not the same one twice`, r.models);
    ok(/complete, specific/.test(r.out), `[${why}] and the good answer is what comes back`, r.out.slice(0, 40));
  }
}

section('It escalates UPWARD, never down');
{
  /* Retrying a bad answer on something cheaper is worse than not retrying:
     it spends money to lower the ceiling. */
  const r = await run({ plan: 'pro', answers: ['I am sorry, I cannot help with that.', 'A real and complete answer here.'] });
  const order = await page.evaluate((ms) => {
    const cost = (m) => {
      const k = Object.keys(MODELS).find(k => MODELS[k].model === m);
      return k ? MODELS[k].cost : -1;
    };
    return ms.map(cost);
  }, r.models);
  ok(order[1] > order[0], 'the second engine costs more than the first', order);
}

section('Once. A second failure is not fixed by a third call');
{
  const r = await run({ answers: ['I am sorry, I cannot help.', 'I am sorry, I cannot help either.'] });
  ok(r.calls.length === 2, 'it stops after one retry', r.calls.length);
  /* And it does not hand back the retry just because it is newer - a better
     engine failing the same way is not an improvement worth paying for. */
  ok(/cannot help\.$/.test(r.out.trim()),
     'returning the first answer rather than a second failure', r.out);
}

section('The retry cannot re-enter the floor, however long the ladder gets');
{
  /* WHY THIS NEEDS ITS OWN CASE. Deleting `noFloor` from the retry changed
     nothing measurable, because today the ladder is two rungs and the second
     call has nowhere above it to go - so the recursion stops by accident
     rather than by design. That is fine until somebody makes escalation a
     real ladder, at which point one bad answer walks all the way up it,
     paying at every rung, and the guard that would have stopped it was
     removed because nothing complained.

     So the ladder is made longer here and the claim measured directly: one
     retry, whatever is above it. */
  const r = await page.evaluate(async () => {
    saveStr('amv_api_base', 'https://backend.example.workers.dev');
    saveStr('amv_api_token', 'tok'); saveStr('amv_token_exp', String(Date.now() + 3e6));
    const real = window._nextTierModel;
    let rung = 0;
    window._nextTierModel = () => 'amv-rung-' + (++rung);   // an endless ladder
    const calls = [];
    /* BOUNDED, SO A REGRESSION FAILS INSTEAD OF HANGING.

       Without the guard under test this recursion is endless, and an endless
       test does not go red - it stalls the whole gate and reads as a broken
       machine rather than a broken change. The stub refuses past a handful of
       calls so the failure arrives as a number, which is what somebody can
       act on. */
    window.fetchDeadline = async (_u, init) => {
      calls.push(JSON.parse(init.body).model);
      if (calls.length > 6) throw new Error('runaway escalation: ' + calls.length + ' calls');
      return { ok: true, headers: { get: () => '' }, __text: 'I am sorry, I cannot help.' };
    };
    window._aiReadStream = async (res) => ({ content: [{ text: res.__text }], usage: {} });
    let threw = '';
    try { await aiComplete('x', 'y', {}); } catch (e) { threw = String(e); }
    window._nextTierModel = real;
    return { calls, threw };
  });
  ok(r.threw === '', 'it does not blow the stack', r.threw);
  ok(r.calls.length === 2,
     'one call and exactly one retry, even with an unlimited ladder above it',
     r.calls.length + ' calls: ' + r.calls.join(' -> '));
}

section('An engine with nowhere to escalate to does not pay to find out');
{
  /* On the top plan the best engine is already in use, so there is no tier
     above it and a retry would buy the same answer at the same price. */
  const r = await run({ plan: 'ultra', opts: { model: 'amv-apex' },
                        answers: ['I am sorry, I cannot help with that.', 'unused'] });
  ok(r.calls.length === 1, 'one call, not two', r.calls.length);
}

section('A caller that checks its own work is not billed for the check twice');
{
  /* qRun runs this same guard itself and escalates on its own terms. Without
     an opt-out the shared floor fires first on the identical fault, so the
     work is done twice and paid for twice, for one answer. */
  const r = await run({ opts: { noFloor: true },
                        answers: ['I am sorry, I cannot help with that.', 'unused'] });
  ok(r.calls.length === 1, 'opting out means exactly one call', r.calls.length);

  const wired = await page.evaluate(() => String(qRun).indexOf('noFloor') > 0);
  ok(wired, 'and the caller that does its own checking opts out', wired);
}

section('The floor can never be the reason a call fails');
{
  /* It is a quality measure sitting on the path of every AI call in the
     product. If it can throw, it can take out chat. */
  const r = await page.evaluate(async () => {
    const realBad = window.qBad;
    window.qBad = () => { throw new Error('boom'); };
    window.fetchDeadline = async () => ({ ok: true, headers: { get: () => '' }, __text: 'an answer' });
    window._aiReadStream = async (res) => ({ content: [{ text: res.__text }], usage: {} });
    let out = '', threw = '';
    try { out = await aiComplete('x', 'y', {}); } catch (e) { threw = String(e); }
    window.qBad = realBad;
    return { out, threw };
  });
  ok(r.threw === '', 'a broken guard does not throw out of the call', r.threw);
  ok(/an answer/.test(r.out), 'and the answer still arrives', r.out);
}

ok(errors.length === 0, 'no console errors', errors);

await app.close();
if (report('the-cheap-engine-is-not-allowed-to-feel-cheap') > 0) process.exitCode = 1;
done();
