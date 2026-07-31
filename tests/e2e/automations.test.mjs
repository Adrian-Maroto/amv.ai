/* AUTOMATION CATALOG - the standing services that make Crew worth paying for.
   Each must be REAL: a concrete instruction the autonomous runner can execute,
   an honest statement of what access it needs, and a working toggle. A pretty
   list that does nothing would be the exact "fake feature" the product forbids. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'crew', user: { name: 'Owner', email: 'owner@amv.dev', ini: 'O' } });
const { page, errors } = app;

await page.evaluate(() => { try { localStorage.removeItem('u:owner@amv.dev|amv_cw_jobs'); } catch (e) {} renderCrewView(); });
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
