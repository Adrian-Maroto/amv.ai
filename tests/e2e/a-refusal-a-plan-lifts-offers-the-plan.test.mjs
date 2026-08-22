/* THE STRONGEST MOMENT TO BUY, ANSWERED WITH A DEAD END.

   The chat error card rendered the same three things for every failure: a
   warning triangle, the server's sentence, and a Retry button. For a provider
   hiccup that is exactly right. For a plan limit it is wrong twice - it invites
   somebody to hammer a decision that will not change, and the one thing it does
   not offer is the thing the sentence just told them about.

   The worst of them: the server answers `free_capacity` with "AMV is at
   capacity for free accounts today. Paid plans are running normally." Below
   that sentence sat a button offering to try the thing that will keep failing
   until tomorrow.

   Four of these codes had no client handling at all, and could not have had
   any: the fetch threw `new Error(message)` and dropped the code, so telling a
   plan limit from a dropped connection meant matching on wording.

   Each case below drives a REAL refusal through the real chat path and reads
   what the person is left looking at. The last two are the ones that keep this
   honest: a transient failure must still say Retry, and `global_cap` - where
   everybody is refused, paid included - must NOT be sold a plan, because that
   would be selling a way past a door that is shut for everyone. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

await page.evaluate(() => {
  saveStr('amv_api_base', 'https://engine.test');
  saveStr('amv_api_token', 'tok');
  /* Connected for real, not just configured. Without this the app never
     reaches the network at all and every case below reads back the "turn on
     the AMV engine" card - a suite that fails for a reason unrelated to the
     thing it is about. */
  window.AMV_API.live = true;
  window.AMV_API.base = 'https://engine.test';
  window.AMV_API.token = 'tok';
  window.__refusal = null;
  const rf = window.fetch;
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('engine.test') && window.__refusal) {
      const r = window.__refusal;
      return new Response(JSON.stringify({ error: r.error, code: r.code, minPlan: r.minPlan }),
                          { status: r.status, headers: { 'Content-Type': 'application/json' } });
    }
    return rf(url, opts);
  };
});

/* Send one message and report the card the person is left with. Read out of
   the DOM rather than out of the message record: what matters is what they are
   looking at, and a record nobody renders is the defect this file exists for. */
async function refuse(refusal) {
  return page.evaluate(async (r) => {
    window.__refusal = r;
    try { setMsgs([]); } catch (e) {}
    renderChatMsgs();
    /* AMV throttles its own composer - a minimum gap between sends, which is
       correct and which eight cases back to back walk straight into. Half of
       this file passed silently on "Slow down a moment before sending again"
       with the network never touched. The gap is respected rather than
       disabled, because disabling it would be testing a product that does not
       exist. */
    try { AEGIS._lastSend = 0; AEGIS._times = []; } catch (e) {}
    const ta = document.getElementById('mta');
    if (!ta) return { noComposer: true };
    ta.value = 'hello';
    try { await sendMsg(); } catch (e) {}
    for (let i = 0; i < 40 && S.busy; i++) await new Promise(res => setTimeout(res, 250));
    await new Promise(res => setTimeout(res, 300));
    const snag = document.querySelector('#cm .ai-snag');
    const btn = snag && snag.querySelector('.ai-snag-retry');
    return {
      shown: !!snag,
      tier: !!(snag && snag.classList.contains('ai-snag-tier')),
      msg: snag ? snag.textContent : '',
      label: btn ? btn.textContent.trim() : '',
      action: btn ? (btn.dataset.action || '') : '',
    };
  }, refusal);
}

section('The code reaches the card at all');
{
  const r = await refuse({ status: 402, code: 'plan_required', minPlan: 'elite',
                           error: 'That engine is part of Elite.' });
  ok(!r.noComposer, 'the composer is there to send from', !r.noComposer);
  ok(r.shown, 'a refusal produces a card', r.shown);
  ok(/That engine is part of Elite/.test(r.msg),
     'carrying the sentence the server wrote, not a guess about it', r.msg.slice(0, 110));
  /* The table itself, so a routing decision cannot be inferred from one case. */
  const routes = await page.evaluate(() => ({
    plan: _refusalRoute('plan_required'), cap: _refusalRoute('free_capacity'),
    team: _refusalRoute('team_full'), global: _refusalRoute('global_cap'),
    hiccup: _refusalRoute('provider_error'), unknown: _refusalRoute('something_new'),
  }));
  ok(routes.plan === 'plans' && routes.cap === 'plans', 'the plan-liftable codes route to the plans', JSON.stringify(routes));
  ok(routes.team === 'team', 'a seat limit routes to the team', routes.team);
  ok(routes.global === '' && routes.hiccup === '' && routes.unknown === '',
     'and a code nothing lifts - including one nobody has added yet - routes nowhere',
     JSON.stringify(routes));
}

section('Every refusal a plan lifts offers the plan');
{
  const cases = [
    ['plan_required', 402, 'That engine is part of Elite.'],
    ['plan_limit',    402, 'The free plan runs one job in the background, weekly.'],
    ['job_limit',     429, 'Your plan runs 25 background jobs. Remove one or upgrade.'],
    ['img_quota',     429, 'You have used today’s images on this plan.'],
    ['free_capacity', 503, 'AMV is at capacity for free accounts today. Paid plans are running normally.'],
  ];
  for (const [code, status, error] of cases) {
    const r = await refuse({ status, code, error });
    ok(r.label === 'See plans', code + ' offers the plan rather than a retry', code + ' -> "' + r.label + '"');
    ok(r.action === 'quota-upgrade', 'and the button is wired to the route that exists', r.action);
    ok(r.tier, 'and it reads as a door, not a fault', r.tier);
  }
}

section('The sentence that sells is the sentence they read')
{
  /* The one that mattered most and was worst affected. The server writes a
     true, useful sentence; the client's error guesser saw the word "capacity"
     and replaced it with "AMV had a brief hiccup. Please try again in a
     moment" - which is not what happened and will not work. */
  const r = await refuse({ status: 503, code: 'free_capacity',
                           error: 'AMV is at capacity for free accounts today. Paid plans are running normally.' });
  ok(/at capacity for free accounts today/.test(r.msg),
     'the reason survives to the screen', r.msg.slice(0, 120));
  ok(/Paid plans are running normally/.test(r.msg),
     'including the half that says what to do about it', r.msg.slice(0, 120));
  ok(!/hiccup|hit a snag/i.test(r.msg),
     'and is not overwritten with a guess that says the opposite', r.msg.slice(0, 120));
}

section('A seat limit sends them where seats are bought');
{
  const r = await refuse({ status: 402, code: 'team_full', error: 'This team is full on your plan.' });
  ok(r.label === 'Manage seats', 'team_full goes to the team, not to the plans page', r.label);
  ok(r.action === 'seats-upgrade', 'on its own action', r.action);
}

section('A hiccup still says Retry');
{
  /* The failure that would be worse than the bug: everything becomes a sales
     pitch, and a real transient error stops offering the one thing that fixes
     it. */
  const r = await refuse({ status: 500, code: 'provider_error', error: 'The engine had a temporary error.' });
  ok(r.label === 'Retry', 'a provider error keeps its retry', r.label);
  ok(!r.tier, 'and is still styled as a fault, because it is one', r.tier);
}

section('A door shut for everyone is not sold as a door');
{
  /* global_cap refuses PAID accounts too. Offering a plan here would be selling
     a way past something no plan gets past. */
  const r = await refuse({ status: 503, code: 'global_cap', error: 'Service is at capacity for today.' });
  ok(r.label === 'Retry', 'global_cap is not turned into an upgrade', r.label);
  ok(!r.tier, 'nor dressed as one', r.tier);
}

section('The button actually arrives');
{
  const r = await page.evaluate(async () => {
    window.__refusal = { status: 503, code: 'free_capacity',
                         error: 'AMV is at capacity for free accounts today. Paid plans are running normally.' };
    try { setMsgs([]); } catch (e) {}
    renderChatMsgs();
    try { AEGIS._lastSend = 0; AEGIS._times = []; } catch (e) {}
    const ta = document.getElementById('mta'); if (ta) ta.value = 'hi';
    try { await sendMsg(); } catch (e) {}
    for (let i = 0; i < 40 && S.busy; i++) await new Promise(res => setTimeout(res, 250));
    await new Promise(res => setTimeout(res, 300));
    const btn = document.querySelector('#cm .ai-snag .ai-snag-retry');
    if (!btn) return { missing: true };
    const before = S.tab;
    btn.click();
    await new Promise(res => setTimeout(res, 400));
    return { before, after: S.tab };
  });
  ok(!r.missing, 'the card has a button', !r.missing);
  ok(r.after === 'plans', 'pressing it reaches the plans', r.before + ' -> ' + r.after);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
