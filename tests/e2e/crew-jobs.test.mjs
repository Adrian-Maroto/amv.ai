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
  /* THE CONTRACT CHANGED, AND THE REASON IT EXISTS DID NOT.

     This used to require that every defined job was on the screen, because a
     job defined and rendered nowhere is the failure this screen has had twice.
     The catalogue is now a SAMPLE - a hundred of a larger pool, asked for
     directly ("i don't want all, just show 100 random examples around the
     world"), because two hundred cards is a wall and a wall reads as less
     capable than a shelf.

     So "rendered === defined" is no longer the property to hold. The property
     that still matters, and is the whole point of the original check, is that
     nothing AMV can run is UNREACHABLE. A sample plus a search that only
     searched the sample would have broken exactly that - which is what this
     now asserts instead, by looking for jobs that are deliberately not in the
     hundred. */
  ok(n.rendered === 100, 'a hundred examples are shown, not the whole pool', n);
  const reach = await page.evaluate(() => {
    const shown = new Set(_cwShowcase().map(j => j.id));
    const hidden = _cwAllJobs().filter(j => !shown.has(j.id));
    if (!hidden.length) return { hidden: 0 };
    /* Take one that is genuinely not on the screen and go and find it. */
    const target = hidden[0];
    cwFind(target.title);
    const found = [...document.querySelectorAll('.cw-job-t')].some(e => e.textContent === target.title);
    cwFind('');
    return { hidden: hidden.length, title: target.title, found };
  });
  ok(reach.hidden > 0, 'the pool is genuinely bigger than what is shown', reach.hidden);
  ok(reach.found === true,
     'and a job NOT in the hundred is still reachable by searching for it', reach);
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
  /* Compared against what is SHOWN, not against the whole catalogue. The
     screen is a hundred-item sample of a larger pool now, so "every Money job
     that exists" is the wrong number to expect on a filtered screen - and the
     property being tested was never that anyway. It is that the filter shows
     that category and nothing else. */
  const r = await page.evaluate(async () => {
    document.querySelector('[data-darg="Money"]').click();
    await new Promise(r => setTimeout(r, 300));
    const titles = [...document.querySelectorAll('.cw-job-t')].map(e => e.textContent);
    const money = _cwShowcase().filter(j => j.cat === 'Money');
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
  /* "All" means no category filter, which is the whole SHOWN catalogue - the
     screen is a hundred-item sample now, so comparing it to every job that
     exists would be asserting the sample does not exist. */
  ok(back === (await page.evaluate(() => _cwShowcase().length)),
     'and All brings the whole shown catalogue back', back);
}

section('A job that cannot run says so rather than looking active');
{
  /* Nothing is connected in this session, so everything needing Gmail or a bank
     is genuinely unable to run. That is the state the card has to admit to. */
  const r = await page.evaluate(() => {
    /* Derived from CW_NEEDS_CHECK, which is what the product actually consults,
       rather than from a list of requirement names retyped here. The retyped
       version went stale the moment a job needed something new - it counted 53
       where the screen blocked 54 - and a check that has to be maintained in
       step with the thing it watches is not watching it. */
    const known = Object.keys(CW_NEEDS_CHECK);
    const needsAcct = _cwShowcase().filter(j =>
      String(j.needs || '').split(',').map(x => x.trim()).some(n => known.includes(n)));
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
    /* A job that works from what the person told it now asks for that first,
       so switching one on is no longer fire-and-forget. Answer the real
       dialog. */
    const answering = setInterval(() => {
      const box = document.getElementById('modal-input');
      if (!box) return;
      box.value = 'MY-OWN-DETAILS';
      const okBtn = document.getElementById('modal-ok');
      if (okBtn) okBtn.click();
    }, 50);
    cwToggle(j.id);
    await new Promise(r => setTimeout(r, 1400));
    clearInterval(answering);
    return { asked, said, saved: (_cwJobs().find(x => x.id === j.id) || {}),
             prompt: j.prompt || '', asks: !!(j.asks && j.asks.q) };
  });
  ok(r.asked.length === 1, 'a real automation is asked for', r.asked);
  /* Defensive: with nothing scheduled this used to throw and take the file
     down, so a real regression exited without reporting a single failure. */
  const first = r.asked[0] || {};
  ok(first.kind === 'research',
     'as a research job, so it actually gets to search the live web', first.kind);
  ok(String(first.detail || '').startsWith(r.prompt) && r.prompt.length > 60,
     'carrying the job\'s real instruction rather than just its title', String(first.detail || '').slice(0, 80));
  ok(!r.asks || /MY-OWN-DETAILS/.test(String(first.detail || '')),
     'and what the person typed, because that is the only thing telling it about them',
     String(first.detail || '').slice(-90));
  ok(/^(daily|weekly|hourly)$/.test(first.repeat), 'on a real cadence', first.repeat);
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
    /* Not job_hunt: it has its own setup flow and the toggle opens that first
       when the profile is incomplete, so it is the one job that does not
       schedule on a single click. Picking "the first match" quietly selected it
       the moment it gained a prompt. */
    const j = _cwDefaultJobs().find(x => /Email/.test(x.needs) && x.prompt && x.id !== 'job_hunt');
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
  /* A MAILBOX JOB NO LONGER NEEDS THIS TAB, AND SAYING IT DOES WAS THE BUG.

     This required the card to read "while AMV is open" for anything needing
     Email. That was true when a mailbox grant lived in the browser. It does
     not: 'mail.read' is a Connected-account scope the Worker holds and is
     listed in AUTO_USES_ALLOWED, so the job really does run overnight once
     Gmail is connected. Forty-nine of a hundred and six cards were telling
     people the opposite, which is what "there are so many that should say run
     when amv is closed but it says run when amv is open" was about.

     Both halves are still asserted, because the card must not overpromise
     either: it says it runs closed AND names the connection it is waiting on. */
  const r = await page.evaluate(() => {
    const web = _cwDefaultJobs().find(j => j.needs === 'Web research');
    const mail = _cwDefaultJobs().find(j => /Email/.test(j.needs));
    return { web: _cwWhereLabel(web), mail: _cwWhereLabel(mail),
             text: document.body.textContent };
  });
  ok(/with AMV closed/.test(r.web), 'a web research job runs unattended', r.web);
  ok(!/once .*connected/i.test(r.web),
     'and says so flatly, because it needs nothing connected first', r.web);
  ok(/with AMV closed/.test(r.mail),
     'a mailbox job also runs unattended - the grant is held by the server', r.mail);
  ok(/once .*connected/i.test(r.mail),
     'but names the connection it is waiting on, so it is not an overpromise', r.mail);
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
    /* Jobs that work from what the person told them now ask for it before
       they are created, so switching one on is no longer fire-and-forget.
       Answer the real dialog rather than avoiding those jobs - the property
       under test is the plan limit, and it has to hold on the real path. */
    const answering = setInterval(() => {
      const box = document.getElementById('modal-input');
      if (!box) return;
      box.value = 'Test details for this job.';
      const okBtn = document.getElementById('modal-ok');
      if (okBtn) okBtn.click();
    }, 40);
    /* One at a time, one more than the plan allows. */
    for (const id of free.slice(0, allow + 1)) { cwToggle(id); await new Promise(r => setTimeout(r, 220)); }
    await new Promise(r => setTimeout(r, 500));
    clearInterval(answering);
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

section('Job Hunt promises only what it does');
{
  /* Nothing anywhere calls AMVJobs.run(), planBatch() or dailyReport(), and
     run() returned {ok:true, staged:true} having done nothing - no search, no
     draft, no send. Meanwhile it was the first card in the catalogue, promised
     to apply and email a morning report, and the setup modal collected a resume
     and work authorisation to do it with. ok:true on a no-op is the worst
     available answer, because every caller reads it as "it ran". */
  const r = await page.evaluate(async () => {
    const c = AMVJobs.cfg();
    c.on = true; c.contact = { name: 'A', email: 'a@x.com' };
    c.targets = { roles: ['Designer'], locations: [], remote: 'any', salaryMin: 0 };
    c.resumes = [{ id: 'r1', name: 'R', text: 'resume text' }];
    AMVJobs.save(c);
    window._aiBackendReady = () => true;
    const out = await AMVJobs.run();
    const card = _cwDefaultJobs().find(j => j.id === 'job_hunt');
    return { out, desc: card.desc, title: card.title, prompt: card.prompt || '' };
  });
  ok(r.out.ok === false, 'a fully configured run does not report success it did not have', r.out);
  ok(r.out.code === 'not_wired', 'with a code rather than a cheerful sentence', r.out.code);
  ok(/not switched on/.test(r.out.reason), 'saying plainly what is not available', r.out.reason);
  ok(/prepares|review/i.test(r.out.reason), 'and what genuinely is', r.out.reason);

  ok(!/applies on its own|it submits/i.test(r.desc),
     'the card no longer claims it applies by itself', r.desc);
  ok(/without you|review/i.test(r.desc), 'and says nothing reaches an employer without you', r.desc);
  ok(r.prompt.length > 80, 'and it carries a real instruction, so scheduling it does the research half',
     r.prompt.length);
  ok(/[Dd]o not submit/.test(r.prompt), 'which is explicitly told not to submit anything', true);
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

section('A job says where it will actually run');
{
  /* "Added to Running jobs - Autonomous" is a promise that AMV completes and
     sends it on its own each time. That is only true once the SERVER knows
     about it: the local schedule is walked by _runDueAuto in this browser, so a
     job that never reached the server runs when AMV happens to be open and not
     otherwise. The registration was fired and forgotten and the success message
     went out either way. */
  const r = await page.evaluate(async () => {
    const realBase = AMV_API.base, realTok = AMV_API.token, realFetch = AMV_API._fetch;
    const out = {};

    // 1. No backend at all: nothing was registered anywhere.
    AMV_API.base = '';
    out.noBackend = _mcWhereItRuns(await _mcScheduleServer({ goal: 'x', freq: 'daily' }));

    // 2. Backend present but refusing.
    AMV_API.base = 'https://api.test'; AMV_API.token = 't';
    AMV_API._fetch = async () => ({ ok: false, json: async () => ({ error: 'scheduler off' }) });
    out.refused = _mcWhereItRuns(await _mcScheduleServer({ goal: 'x', freq: 'daily' }));

    // 3. Registered for real.
    AMV_API._fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
    const good = await _mcScheduleServer({ goal: 'x', freq: 'daily' });
    out.okRes = good.ok; out.okText = _mcWhereItRuns(good);

    AMV_API.base = realBase; AMV_API.token = realTok; AMV_API._fetch = realFetch;
    return out;
  });

  ok(/only while AMV is open/i.test(r.noBackend),
     'with no engine connected, it says the job runs only while AMV is open', r.noBackend);
  ok(/not connected/i.test(r.noBackend), 'and why', r.noBackend);
  ok(/could NOT be registered/i.test(r.refused),
     'a refused registration is stated, not swallowed', r.refused);
  ok(/scheduler off/.test(r.refused), 'with the reason the server gave', r.refused);
  ok(r.okRes === true && r.okText === '',
     'and a job that really registered adds no caveat at all', r);
}

section('Turning an approval into a recurring job answers the same question');
{
  /* Three callers read _apvRegisterRecur, and one checked it for truthiness.
     Once it became async, a bare promise would be truthy every time - so every
     caller would have claimed the job was scheduled, including when there was
     nothing recurring to schedule. */
  const r = await page.evaluate(async () => {
    const none = await _apvRegisterRecur({ title: 'no recurrence here' });
    return { ok: none.ok, code: none.code, isObject: typeof none === 'object' };
  });
  ok(r.isObject === true, 'it always answers with a result, never a bare boolean', r);
  ok(r.ok === false && r.code === 'none',
     'and nothing recurring is reported as nothing, not as scheduled', r);
}

section('The emergency stop does not claim a stop it never made');
{
  /* Pausing sets a local flag, which halts the schedule THIS browser walks.
     Server-side jobs run on the worker's cron and keep going until the server
     is told. The request was fired and forgotten and "nothing runs until you
     resume" went out regardless - so a failed call left somebody believing
     their autonomous work had stopped while it carried on doing things.

     A safety control is the last place to report an outcome it did not wait
     for. */
  const r = await page.evaluate(async () => {
    const said = [];
    const realToast = window.toast; window.toast = (m, kind) => said.push({ m: String(m), kind });
    const realBase = AMV_API.base, realTok = AMV_API.token, realPause = AMV_API.pauseAutonomy;
    const out = {};

    AMV_API.base = 'https://api.test'; AMV_API.token = 't';
    AMV_API.pauseAutonomy = async () => { throw new Error('server unreachable'); };
    said.length = 0;
    await pauseAllAutonomous();
    out.failed = said.slice();
    out.localPaused = _autonomyPaused();

    AMV_API.pauseAutonomy = async () => true;
    said.length = 0;
    await pauseAllAutonomous();
    out.worked = said.slice();

    AMV_API.base = ''; 
    said.length = 0;
    await pauseAllAutonomous();
    out.noBackend = said.slice();

    AMV_API.base = realBase; AMV_API.token = realTok; AMV_API.pauseAutonomy = realPause;
    window.toast = realToast;
    return out;
  });

  const failedMsg = (r.failed[0] || {}).m || '';
  ok(!/nothing runs until you resume/i.test(failedMsg),
     'a failed pause never claims nothing is running', failedMsg);
  ok(/STILL RUNNING/.test(failedMsg),
     'it says what is still running, in those words', failedMsg);
  ok(/server unreachable/.test(failedMsg), 'with the reason', failedMsg);
  ok((r.failed[0] || {}).kind === 'error', 'and it is an error, not a confirmation', r.failed[0]);
  ok(r.localPaused === true,
     'while this device really is paused, because that half always works', r.localPaused);

  ok(/nothing runs until you resume/i.test((r.worked[0] || {}).m || ''),
     'a pause that reached the server says so plainly', r.worked[0]);

  const nb = (r.noBackend[0] || {}).m || '';
  ok(/not connected to a backend/i.test(nb),
     'and with no backend it says there is no server-side work to stop', nb);
  ok(!/STILL RUNNING/.test(nb), 'rather than inventing an alarm', nb);
}

section('Approving says "Sent" only when something was sent');
{
  /* Approving is what actually sends the thing. It fired the request, forgot
     it, removed the draft from the queue and said "Sent" - so a failed call
     meant nothing went out, the draft was gone, and the person believed their
     email had been sent. With no engine connected nothing was even attempted,
     and it still said "Sent". */
  const r = await page.evaluate(async () => {
    const said = [];
    const realToast = window.toast; window.toast = (m, kind) => said.push({ m: String(m), kind });
    const realBase = AMV_API.base, realTok = AMV_API.token, realAct = AMV_API.actApproval;
    const out = {};
    const seed = () => _cwSaveApprovals([{ id: 'ap1', title: 'Email the client', preview: 'the draft',
                                           result: { type: 'email', subject: 'Hi', to: 'c@x.com' } }]);

    // 1. Nothing connected: nothing can be sent.
    AMV_API.base = ''; seed(); said.length = 0;
    out.noBackend = await _apvDoApprove(_cwApprovals()[0]);
    out.noBackendSaid = (said[0] || {}).m || '';
    out.noBackendKept = _cwApprovals().length;

    // 2. Connected but the send fails.
    AMV_API.base = 'https://api.test'; AMV_API.token = 't';
    AMV_API.actApproval = async () => { throw new Error('mail server refused'); };
    seed(); said.length = 0;
    out.failed = await _apvDoApprove(_cwApprovals()[0]);
    out.failedSaid = (said[0] || {}).m || '';
    out.failedKind = (said[0] || {}).kind;
    out.failedKept = _cwApprovals().length;

    // 3. It really sends. The confirmation is the past tense of THIS item's
    //    action, so the expected word is computed the same way the code does.
    AMV_API.actApproval = async () => ({ ok: true });
    seed(); said.length = 0;
    const item = _cwApprovals()[0];
    out.expected = _APV_PAST[_apvAction(item).verb] || 'Done';
    out.okRes = await _apvDoApprove(item);
    out.okSaid = (said[0] || {}).m || '';
    out.okKind = (said[0] || {}).kind;
    out.okKept = _cwApprovals().length;

    AMV_API.base = realBase; AMV_API.token = realTok; AMV_API.actApproval = realAct;
    window.toast = realToast;
    return out;
  });

  ok(r.noBackend.ok === false, 'with no backend, approving does not report success', r.noBackend);
  ok(/nowhere to send/i.test(r.noBackendSaid), 'it says there is nowhere to send it', r.noBackendSaid);
  ok(r.noBackendKept === 1, 'and the draft is still waiting', r.noBackendKept);

  ok(r.failed.ok === false, 'a refused send is a failure', r.failed);
  ok(/was NOT/.test(r.failedSaid), 'said in those words', r.failedSaid);
  ok(/mail server refused/.test(r.failedSaid), 'with the reason', r.failedSaid);
  ok(r.failedKind === 'error', 'as an error, not a confirmation', r.failedKind);
  /* The one thing worse than not sending is not sending and losing the draft. */
  ok(r.failedKept === 1, 'and the draft is KEPT, so it can be retried', r.failedKept);

  ok(r.okRes.ok === true, 'a real send succeeds', r.okRes);
  ok(r.okSaid === r.expected && r.okKind === 'success',
     'and confirms in the past tense of what it did, as a success',
     { said: r.okSaid, expected: r.expected, kind: r.okKind });
  ok(!/NOT|nowhere/i.test(r.okSaid), 'with none of the failure wording', r.okSaid);
  ok(r.okKept === 0, 'and only then does it leave the queue', r.okKept);
}

await app.close();
if (report('crew-jobs') > 0) process.exitCode = 1;
done();
