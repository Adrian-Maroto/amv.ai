/* AUTOMATION CATALOG - the standing services that make Crew worth paying for.
   Each must be REAL: a concrete instruction the autonomous runner can execute,
   an honest statement of what access it needs, and a working toggle. A pretty
   list that does nothing would be the exact "fake feature" the product forbids. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'crew', user: { name: 'Owner', email: 'owner@amv.dev', ini: 'O' } });
const { page, errors } = app;

/* Crew is a paid capability - a job runs on a schedule whether or not anybody
   is watching, which is the one thing a free tier cannot carry. Everything
   below is about what the tool DOES, so it runs on a plan that has it. */
await page.evaluate(() => {
  try { localStorage.removeItem('u:owner@amv.dev|amv_cw_jobs'); } catch (e) {}
  saveStr('amv_plan', 'pro');
  renderCrewView();
});
await page.waitForTimeout(350);

const r = await page.evaluate(() => {
  const jobs = _cwJobs();
  const ids = jobs.map(j => j.id);
  return {
    count: jobs.length, ids,
    dupes: ids.filter((v, i) => ids.indexOf(v) !== i),
    missingCopy: jobs.filter(j => !j.title || !j.desc).map(j => j.id),
    missingNeeds: jobs.filter(j => !j.needs).map(j => j.id),
    withPrompt: jobs.filter(j => j.prompt && j.prompt.length > 40).map(j => j.id),
    allOff: jobs.every(j => j.on === false),
    toggles: document.querySelectorAll('.cw-toggle').length,
    radar: jobs.find(j => j.id === 'opportunity_radar')
  };
});

section('A deep catalog of standing services');
ok(r.count >= 20, `there are ${r.count} automations to choose from`, r.count);
ok(r.dupes.length === 0, 'no duplicate ids (a collision would break toggling)', r.dupes);
ok(r.missingCopy.length === 0, 'every automation explains what it does', r.missingCopy);

section('Autonomy is a paid capability, said once and calmly');
{
  /* Two things the owner asked for together. The risk chooser - Low / Medium /
     Any, with warnings like "this task could spend money" - is gone: it asked
     people to make a safety decision they cannot evaluate, at the exact moment
     they are deciding whether to trust the product, and its "Any" setting was
     the one thing that could actually cost them money. The protection did not
     go with it; it is fixed now, so there is nothing to configure and nothing
     to warn about.

     And a free account is not shown a control that would refuse it.

     That used to mean showing them no jobs at all. It now means showing them
     the whole catalogue with no switches on it - because the person deciding
     whether to pay is exactly the person who needs to see what they would be
     paying for, and a paragraph describing eighty-nine jobs is a far weaker
     pitch than the eighty-nine jobs. The property that mattered is unchanged
     and is still asserted: nothing on that screen is a control that does
     nothing when pressed. */
  const free = await page.evaluate(() => {
    saveStr('amv_plan', 'free');
    renderCrewView();
    const t = document.getElementById('vc').textContent;
    return { text: t, jobs: document.querySelectorAll('.cw-job').length,
             toggles: document.querySelectorAll('.cw-toggle').length,
             openable: document.querySelectorAll('[data-dact="cwPeek"]').length,
             cta: !!document.querySelector('[data-stab="plans"]') };
  });
  ok(!/\brisk\b/i.test(free.text), 'no talk of risk anywhere on the screen');
  /* The plan name and the seat count used to be pasted across the top of this
     screen in a stats band, and it was removed on purpose - three numbers and
     a price standing in front of the catalogue that does the actual
     convincing. They did not disappear: every locked card opens onto the plan,
     the price and the button, which is where somebody is when the question
     "what does this cost" is finally the question they have.
     the-catalogue-sells-it walks that path and checks what is on it. */
  ok(free.toggles === 0, 'and no switch underneath it that would refuse them', free.toggles);
  ok(free.jobs > 50 && free.openable === free.jobs,
     'while every job is there to be opened and read, which is what they are deciding about',
     { jobs: free.jobs, openable: free.openable });
  ok(free.cta, 'with the one control that resolves it');

  const paid = await page.evaluate(() => {
    saveStr('amv_plan', 'pro');
    renderCrewView();
    const t = document.getElementById('vc').textContent;
    return { risk: /\brisk\b/i.test(t), allowance: /of 5 background jobs/.test(t),
             jobs: document.querySelectorAll('.cw-job').length };
  });
  ok(!paid.risk, 'and an entitled account is not warned about risk either');
  ok(paid.allowance, 'it is told how many jobs it has, before it hits the limit');
  ok(paid.jobs > 0, 'and gets the actual tool', paid.jobs);
}

section('A job that runs every day does not read as finished');
{
  /* The bug: every RUN marked itself done and fell into the Completed pile, so
     a 9am daily check showed as "Completed" after its first morning while it
     kept running every morning after that. The schedule and the run lived in
     two separate lists and nothing joined them. */
  const r = await page.evaluate(() => {
    saveStr('amv_plan', 'pro');
    /* Through _saveSched, which scopes to the signed-in account. Writing the
       raw key put it where nothing reads any more - and real code has always
       gone through this helper. */
    _saveSched([
      { id: 'a1', goal: 'Check my bank balance', sched: { cad: 'daily', hour: 9 },
        next: Date.now() + 86400000, created: Date.now() - 172800000 },
    ]);
    _bgQueue.tasks.length = 0;
    _bgQueue.tasks.push({ id: 'bg1', title: 'Check my bank balance', status: 'done',
                          created: Date.now() - 3600000, schedId: 'a1' });
    _bgQueue.tasks.push({ id: 'bg2', title: 'A one-off thing', status: 'done',
                          created: Date.now() - 7200000, schedId: null });
    const st = _mcState();
    renderCrewView();
    const t = document.getElementById('vc').textContent;
    return { done: st.done.length, runs: st.runsOfJobs.length, sched: st.sched.length,
             lastRan: /last ran/.test(t), next: /next /.test(t), goal: /Check my bank balance/.test(t) };
  });
  ok(r.done === 1, 'only the genuinely finished one-off is in Completed', r.done);
  ok(r.runs === 1, 'the daily run is filed against its job instead', r.runs);
  ok(r.sched === 1, 'and the job itself is still a running job', r.sched);
  ok(r.goal, 'named on screen');
  ok(r.lastRan, 'saying when it last ran, so it is visibly alive');
  ok(r.next, 'and when it runs next');

  /* Cancel the schedule and the run becomes what it now is: history. */
  const after = await page.evaluate(() => {
    _saveSched([]);
    const st = _mcState();
    return { done: st.done.length, runs: st.runsOfJobs.length };
  });
  ok(after.done === 2, 'once the job is cancelled its runs are history like anything else', after.done);
  ok(after.runs === 0, 'and nothing is left pointing at a job that no longer exists', after.runs);
}

section('Each one is honest about what it needs');
ok(r.missingNeeds.length === 0, 'every automation states the access it requires', r.missingNeeds);
ok(/Email|Calendar|Web research/.test(r.radar.needs), 'requirements name real integrations', r.radar.needs);

section('They are executable, not decorative');
ok(r.withPrompt.length >= 14, `${r.withPrompt.length} carry a concrete instruction the runner executes`, r.withPrompt.length);
ok(r.radar.prompt.length > 100, 'the instruction is specific enough to actually run', r.radar.prompt.length);
ok(/say so plainly|If you find nothing/i.test(r.radar.prompt), 'and instructs honesty when there is nothing to report');

section('Nothing runs until the user turns it on');
ok(r.allOff, 'every automation ships OFF - AMV never starts acting uninvited');
ok(r.toggles >= 20, 'each one has a real toggle in the UI', r.toggles);

section('The signature services are present');
['opportunity_radar', 'change_digest', 'money_leaks', 'forgot_check', 'renewal_watchdog',
 'followups', 'travel_guardian', 'meeting_prep', 'goal_tracker', 'job_hunt'].forEach(id => {
  ok(r.ids.includes(id), `${id} is available`, r.ids.length);
});

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
