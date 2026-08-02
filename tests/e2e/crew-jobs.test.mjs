/* THE STANDING JOBS: MANY MORE, AND HONEST ABOUT EACH.

   The Crew catalogue is the argument for paying. It grew from a handful to
   seventy, which creates two problems that pull against each other: seventy
   cards in one flat grid reads as a wall rather than as range, and seventy
   toggles that flip a flag without checking anything multiplies a bug that was
   survivable at six.

   That second one is the important half. Every preset always declared what it
   needs, and nothing ever read it - so switching on a job that needs a mailbox
   nobody connected produced an active-looking card that did nothing, forever,
   silently. This suite holds both properties: the catalogue is browsable, and a
   job that cannot run says so instead of pretending. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { overflowingElement } from '../lib/layout.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'U', email: 'u@x.com', ini: 'U' } });
const { page, errors } = app;

const openCrew = () => page.evaluate(async () => {
  saveStr('amv_plan', 'elite');
  S.tab = 'crew'; setTab('crew');
  await new Promise(r => setTimeout(r, 350));
  return document.getElementById('vc').textContent;
});

section('There is a lot of it, and every one is reachable');
{
  const t = await openCrew();
  const n = await page.evaluate(() => ({
    defined: _cwDefaultJobs().length,
    rendered: document.querySelectorAll('.cw-job').length,
    cats: document.querySelectorAll('.cw-cat').length,
  }));
  ok(n.defined >= 70, 'the catalogue is genuinely large', n.defined);
  /* The count that matters is not how many exist but how many a person can
     actually see - a job defined and rendered nowhere is the failure this
     screen has had twice. */
  ok(n.rendered === n.defined, 'and every defined job is on the screen', n);
  ok(n.cats >= 6, 'grouped under headings rather than one flat wall', n.cats);
  ok(/Refund chaser/.test(t) && /Salary benchmark/.test(t),
     'including the newly added ones', t.length);
}

section('Every job is filed somewhere');
{
  const stray = await page.evaluate(() =>
    _cwDefaultJobs().filter(j => !j.cat).map(j => j.id));
  ok(stray.length === 0, 'no job is left without a category', stray);

  const dupes = await page.evaluate(() => {
    const seen = {}, out = [];
    _cwDefaultJobs().forEach(j => { if (seen[j.id]) out.push(j.id); seen[j.id] = 1; });
    return out;
  });
  ok(dupes.length === 0, 'and no id is defined twice', dupes);
}

section('Filtering by category shows that category and only that category');
{
  const r = await page.evaluate(async () => {
    document.querySelector('[data-darg="Money"]').click();
    await new Promise(r => setTimeout(r, 300));
    const titles = [...document.querySelectorAll('.cw-job-t')].map(e => e.textContent);
    const money = _cwDefaultJobs().filter(j => j.cat === 'Money');
    return { shown: titles.length, expected: money.length,
             allMoney: titles.every(t => money.some(j => j.title === t)) };
  });
  ok(r.shown === r.expected, 'the count matches the category', r);
  ok(r.allMoney, 'and nothing from another category leaks in', r);

  const back = await page.evaluate(async () => {
    document.querySelector('[data-darg="all"]').click();
    await new Promise(r => setTimeout(r, 300));
    return document.querySelectorAll('.cw-job').length;
  });
  ok(back === (await page.evaluate(() => _cwDefaultJobs().length)),
     'and All brings the whole catalogue back', back);
}

section('A job that cannot run says so rather than looking active');
{
  /* Nothing is connected in this session, so everything needing Gmail or a bank
     is genuinely unable to run. That is the state the card has to admit to. */
  const r = await page.evaluate(() => {
    const needsAcct = _cwDefaultJobs().filter(j => /Email|Calendar|Drive|Bank/.test(j.needs));
    return { needsAcct: needsAcct.length,
             blocked: document.querySelectorAll('.cw-job.blocked').length,
             text: document.body.textContent };
  });
  ok(r.blocked === r.needsAcct,
     'every job needing an account nobody connected is marked', r.blocked + ' of ' + r.needsAcct);
  ok(/not connected/.test(r.text), 'in words on the card itself');
  ok(/Gmail not connected/.test(r.text), 'naming the actual account, not "an integration"');
  ok(/a bank connection not connected/.test(r.text), 'including the bank ones');
}

section('A job needing nothing but the server is not marked at all');
{
  /* Web research runs server-side. Warning about it would train people to
     ignore the warning that matters. */
  const clean = await page.evaluate(() => {
    const j = _cwDefaultJobs().find(x => x.needs === 'Web research');
    return { id: j.id, missing: _cwNeedsMissing(j) };
  });
  ok(clean.missing.length === 0, 'no false requirement is invented', clean);
}

section('Switching one on without the account does not claim it is running');
{
  const r = await page.evaluate(async () => {
    let said = '';
    window.toast = (m) => { said = m; };
    const j = _cwDefaultJobs().find(x => /Bank connection/.test(x.needs));
    cwToggle(j.id);
    await new Promise(r => setTimeout(r, 250));
    const saved = (_cwJobs().find(x => x.id === j.id) || {}).on;
    return { said, saved, title: j.title };
  });
  ok(/cannot run until you connect/.test(r.said),
     'it says plainly that it will not run yet', r.said);
  ok(/bank connection/.test(r.said), 'naming what to connect', r.said);
  ok(r.saved === true,
     'while still saving the choice, so it starts the moment the account is linked', r.saved);
}

section('Turning on a background job creates REAL scheduled work');
{
  /* This is the one that mattered most. The toggle wrote a boolean into a
     record the cron has never read, so every standing job on this screen was a
     switch attached to nothing: it looked on, it reported on, and no work was
     ever scheduled anywhere. */
  const r = await page.evaluate(async () => {
    saveStr('amv_plan', 'elite');
    const jobs = _cwJobs(); jobs.forEach(j => j.on = false); _cwSaveJobs(jobs);
    const asked = [];
    let said = '';
    window.toast = (m) => { said = m; };
    window._scheduleTask = async (t) => { asked.push(t); return { id: 'auto1' }; };
    const j = _cwDefaultJobs().find(x => x.needs === 'Web research' && x.prompt);
    cwToggle(j.id);
    await new Promise(r => setTimeout(r, 400));
    return { asked, said, saved: (_cwJobs().find(x => x.id === j.id) || {}),
             prompt: j.prompt || '' };
  });
  ok(r.asked.length === 1, 'a real automation is asked for', r.asked);
  ok(r.asked[0].kind === 'research',
     'as a research job, so it actually gets to search the live web', r.asked[0].kind);
  ok(r.asked[0].detail === r.prompt && r.prompt.length > 60,
     'carrying the job\'s real instruction rather than just its title', r.asked[0].detail);
  ok(/^(daily|weekly|hourly)$/.test(r.asked[0].repeat), 'on a real cadence', r.asked[0].repeat);
  ok(r.saved.autoId === 'auto1',
     'and the id is kept, which is the only way it can ever be switched off again', r.saved.autoId);
  ok(r.saved.on === true, 'the switch moves once the server has agreed', r.saved.on);
  ok(/with AMV closed/.test(r.said), 'and it says the thing that makes it worth paying for', r.said);
}

section('If the server refuses, the switch does not move');
{
  /* An on-looking card with nothing behind it is exactly the state this whole
     section exists to remove. */
  const r = await page.evaluate(async () => {
    const jobs = _cwJobs(); jobs.forEach(j => j.on = false); _cwSaveJobs(jobs);
    window._scheduleTask = async () => null;          // plan limit, or offline
    const j = _cwDefaultJobs().find(x => x.needs === 'Web research');
    cwToggle(j.id);
    await new Promise(r => setTimeout(r, 400));
    const a = (_cwJobs().find(x => x.id === j.id) || {}).on;

    window._scheduleTask = async () => { throw new Error('engine down'); };
    cwToggle(j.id);
    await new Promise(r => setTimeout(r, 400));
    return { refused: a, threw: (_cwJobs().find(x => x.id === j.id) || {}).on };
  });
  ok(r.refused !== true, 'it stays off when nothing was scheduled', r.refused);
  ok(r.threw !== true, 'and a thrown failure is not treated as success either', r.threw);
}

section('Turning it off stops it on the server too');
{
  const r = await page.evaluate(async () => {
    const acts = [];
    window._autoAction = async (id, action) => { acts.push({ id, action }); return true; };
    const j = _cwDefaultJobs().find(x => x.needs === 'Web research');
    const jobs = _cwJobs();
    const row = jobs.find(x => x.id === j.id);
    row.on = true; row.autoId = 'auto2'; _cwSaveJobs(jobs);
    cwToggle(j.id);
    await new Promise(r => setTimeout(r, 400));
    return { acts, saved: (_cwJobs().find(x => x.id === j.id) || {}) };
  });
  ok(r.acts.length === 1 && r.acts[0].action === 'delete', 'the scheduled job is deleted', r.acts);
  ok(r.acts[0].id === 'auto2', 'the one this card actually created', r.acts[0].id);
  ok(r.saved.on === false, 'and only then does the switch go off', r.saved.on);
  ok(!r.saved.autoId, 'with no stale id left pointing at a job that is gone', r.saved.autoId);
}

section('A stop that fails leaves the switch on, because it is still running');
{
  const r = await page.evaluate(async () => {
    let said = '';
    window.toast = (m) => { said = m; };
    window._autoAction = async () => false;
    const j = _cwDefaultJobs().find(x => x.needs === 'Web research');
    const jobs = _cwJobs();
    const row = jobs.find(x => x.id === j.id);
    row.on = true; row.autoId = 'auto3'; _cwSaveJobs(jobs);
    cwToggle(j.id);
    await new Promise(r => setTimeout(r, 400));
    return { said, on: (_cwJobs().find(x => x.id === j.id) || {}).on };
  });
  ok(r.on === true, 'the switch stays on', r.on);
  ok(/still running/.test(r.said), 'and it says why', r.said);
}

section('A job needing this tab is really scheduled here');
{
  /* The other fifty jobs cannot use the server runner, so they go on the local
     schedule that `_runDueAuto` actually walks. Without this the switch was
     decorative for them too: a card reading "runs while AMV is open" with
     nothing scheduled anywhere. */
  const r = await page.evaluate(async () => {
    _saveSched([]);
    const j = _cwDefaultJobs().find(x => /Email/.test(x.needs) && x.prompt);
    const jobs = _cwJobs(); jobs.forEach(x => x.on = false); _cwSaveJobs(jobs);
    cwToggle(j.id);
    await new Promise(r => setTimeout(r, 250));
    const on = _loadSched();
    cwToggle(j.id);
    await new Promise(r => setTimeout(r, 250));
    return { on, off: _loadSched(), prompt: j.prompt };
  });
  ok(r.on.length === 1, 'switching it on puts a real entry on the schedule', r.on.length);
  ok(r.on[0].goal === r.prompt, 'carrying the job\'s actual instruction', (r.on[0] || {}).goal);
  ok(r.on[0].next > 0, 'with a real next run time', (r.on[0] || {}).next);
  ok(r.on[0].approval === 'require',
     'and asking first, because these reach a real mailbox', (r.on[0] || {}).approval);
  ok(r.off.length === 0, 'switching it off takes it back off the schedule', r.off.length);
}

section('Each card says where it can actually run');
{
  /* The server has no mailbox, calendar or browser session, so a Gmail job
     genuinely cannot run with AMV closed. Presenting both as the same kind of
     background work is the promise this product cannot keep. */
  const r = await page.evaluate(() => {
    const web = _cwDefaultJobs().find(j => j.needs === 'Web research');
    const mail = _cwDefaultJobs().find(j => /Email/.test(j.needs));
    return { web: _cwWhereLabel(web), mail: _cwWhereLabel(mail),
             text: document.body.textContent };
  });
  ok(/with AMV closed/.test(r.web), 'a web research job runs unattended', r.web);
  ok(/while AMV is open/.test(r.mail),
     'and one needing your mailbox says it needs this tab', r.mail);
  ok(/Runs with AMV closed/.test(r.text), 'and it is on the card, not just in a function', true);
}

section('The plan\'s job number is enforced, not just displayed');
{
  /* The header reads "X of N background jobs in use" and the plans page sells N.
     Nothing enforced it, so all seventy could be switched on under a plan that
     runs five, and the monthly spend ceiling rather than the plan would have
     silently decided which ones actually ran. */
  const r = await page.evaluate(async () => {
    saveStr('amv_plan', 'pro');
    const jobs = _cwJobs(); jobs.forEach(j => j.on = false); _cwSaveJobs(jobs);
    const free = _cwDefaultJobs().filter(j => j.needs === 'Web research').map(j => j.id);
    const allow = _crewJobAllowance();
    let said = '';
    window.toast = (m) => { said = m; };
    let n = 0;
    window._scheduleTask = async () => ({ id: 'a' + (++n) });
    /* One at a time, one more than the plan allows. */
    for (const id of free.slice(0, allow + 1)) { cwToggle(id); await new Promise(r => setTimeout(r, 60)); }
    await new Promise(r => setTimeout(r, 300));
    return { allow, on: _cwJobs().filter(j => j.on).length, said };
  });
  ok(r.on === r.allow, 'it stops at exactly the number the plan sells', r);
  ok(/runs \d+ background job/.test(r.said), 'and says what that number is', r.said);
  ok(/upgrade/i.test(r.said), 'with the way to get more', r.said);
}

section('The fix is one tap from the card');
{
  const went = await page.evaluate(async () => {
    document.querySelector('.cw-job-fix').click();
    await new Promise(r => setTimeout(r, 300));
    return S.tab;
  });
  ok(went === 'integrations', 'Connect goes to where the account is linked', went);
}

section('Syncing with the server does not eat the catalogue');
{
  /* The server holds a row only for jobs that have ever been switched on, and
     the sync REPLACED the list with those rows. So the catalogue collapsed from
     seventy-odd to the handful the user had touched, and every field the mapping
     did not name went with it: the category, the instruction, and the id of the
     automation the job had created. */
  const r = await page.evaluate(async () => {
    const jobs = _cwJobs();
    const web = _cwDefaultJobs().find(j => j.needs === 'Web research' && j.prompt);
    const row = jobs.find(j => j.id === web.id);
    row.on = true; row.autoId = 'auto7'; _cwSaveJobs(jobs);

    window.AMV_API.live = true;
    window.AMV_API.jobs = async () => ([{ key: web.id, title: web.title, needs: web.needs, on_flag: true }]);
    window.AMV_API.approvals = async () => ([]);
    await _crewSyncLive();
    await new Promise(r => setTimeout(r, 200));

    const after = _cwJobs();
    const mine = after.find(j => j.id === web.id);
    return { count: after.length, defined: _cwDefaultJobs().length,
             on: mine && mine.on, autoId: mine && mine.autoId,
             cat: mine && mine.cat, prompt: (mine && mine.prompt || '').length,
             withCat: after.filter(j => j.cat).length };
  });
  ok(r.count === r.defined, 'the whole catalogue survives the sync', r);
  ok(r.withCat === r.defined, 'every job keeps its category, so the grouping still works', r.withCat);
  ok(r.prompt > 60, 'and its real instruction, not just a title', r.prompt);
  ok(r.autoId === 'auto7',
     'the handle on the scheduled work is kept, so it can still be switched off', r.autoId);
  ok(r.on === true, 'while the server remains the authority on what is ON', r.on);
}

section('It fits on a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await openCrew();
  const bad = await overflowingElement(page);
  ok(!bad, 'nothing pushes the page sideways at 390px', bad);
  await page.setViewportSize({ width: 1280, height: 900 });
}

ok(errors.length === 0, 'no console errors along the way', errors.slice(0, 3));

await app.close();
if (report('crew-jobs') > 0) process.exitCode = 1;
done();
