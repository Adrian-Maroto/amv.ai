/* THE ONE DIALOG THAT ASKS FOR MONEY HAS TO BE TELLING THE TRUTH.

   The upgrade nudge counts how often somebody uses a feature and quotes the
   number back at them beside a price. It was counted by `setTab`, so it
   recorded TAB OPENS - and then said "You have been using Crew a lot. 15 times
   in the last two weeks", which reads as fifteen jobs. Opening the tab to look
   at yesterday's results counted.

   The offer beside it is "Pro lets you run jobs in the background", so the
   evidence for it has to be jobs run. Crew has one place where a job really
   starts, so it counts runs. Build, Studio and Lab have no equivalent single
   action, so they still count opens and say "Opened it" - true, and weaker on
   purpose.

   What is pinned here is the COUPLING: the sentence is built from what was
   actually measured, so the two cannot drift apart again. A future feature
   added to the table with `counts:'opens'` cannot quietly claim runs. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp();
const page = app.page;

section('Every counted feature declares what its number means');
{
  const out = await page.evaluate(() => {
    /* Read BARE. Top-level `const` in this bundle is a script binding, so
       `window.HABIT_FEATURES` is undefined - the gate has a stage for exactly
       this mistake and caught it here. */
    const f = (typeof HABIT_FEATURES !== 'undefined') ? HABIT_FEATURES : {};
    const bad = Object.keys(f).filter(k => f[k].counts !== 'runs' && f[k].counts !== 'opens');
    return { keys: Object.keys(f), bad, crew: f.crew && f.crew.counts };
  });
  ok(out.keys.length > 0, 'the feature table is reachable', out.keys.join(','));
  ok(out.bad.length === 0, 'and every entry says whether it counts runs or opens', out.bad.join(','));
  ok(out.crew === 'runs', 'Crew counts real runs, because the offer beside it is about jobs', out.crew);
}

section('Opening a tab is not recorded as running a job');
{
  const out = await page.evaluate(() => {
    const key = 'u:' + String((S.user && S.user.email) || 'guest').toLowerCase() + '|amv_habit';
    const before = String(localStorage.getItem(key) || '');
    /* Crew is counted by runs, so navigation must leave it alone. */
    for (let i = 0; i < 5; i++) { try { _habitTouch('crew'); } catch (e) {} }
    const afterOpens = String(localStorage.getItem(key) || '');
    /* A real run is what counts. */
    for (let i = 0; i < 3; i++) { try { _habitAction('crew'); } catch (e) {} }
    const afterRuns = String(localStorage.getItem(key) || '');
    return { unchangedByOpens: before === afterOpens, changedByRuns: afterOpens !== afterRuns };
  });
  ok(out.unchangedByOpens === true,
     'five tab opens add nothing to a run-counted feature', out.unchangedByOpens);
  ok(out.changedByRuns === true,
     'while a real run does', out.changedByRuns);
}

section('A run is not recorded against a feature counted by opens');
{
  const out = await page.evaluate(() => {
    const key = 'u:' + String((S.user && S.user.email) || 'guest').toLowerCase() + '|amv_habit';
    const before = String(localStorage.getItem(key) || '');
    try { _habitAction('dev'); } catch (e) {}
    return { unchanged: before === String(localStorage.getItem(key) || '') };
  });
  ok(out.unchanged === true, 'the two counters do not leak into each other', out.unchanged);
}

section('The count belongs to the account, not the browser');
{
  /* localStorage is per-device, so two people sharing a browser were adding to
     one number and each being told it was theirs. */
  const out = await page.evaluate(() => {
    const realUser = S.user;
    try {
      /* `store`/`load` prefix every non-global key with `u:<email>|`, so the
         separation is the storage layer's, not the nudge's. Asserted through
         the real keys rather than by trusting that. */
      S.user = { email: 'one@x.com', name: 'One' };
      _habitAction('crew'); _habitAction('crew');
      S.user = { email: 'two@x.com', name: 'Two' };
      const one = JSON.parse(localStorage.getItem('u:one@x.com|amv_habit') || '{}');
      const two = JSON.parse(localStorage.getItem('u:two@x.com|amv_habit') || '{}');
      return { oneHas: (one.crew || []).length, twoHas: (two.crew || []).length };
    } finally { S.user = realUser; }
  });
  ok(out.oneHas >= 2, 'the first account has its own runs', out.oneHas);
  ok(out.twoHas === 0, 'and the second account starts from nothing', out.twoHas);
}

await app.close();
if (report('the-nudge-says-what-it-counted') > 0) process.exitCode = 1;
done();
