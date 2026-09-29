/* ONE JOB RUNS ONCE, AND CANCEL MEANS CANCEL - ON THE SERVER TOO.

   A scheduled job made in the browser is kept in two places: the server,
   which runs it overnight with everything closed, and a copy on this device
   that draws its row. Three things were wrong with that arrangement:

   1. The page's own runner ran every due entry, including those the server
      runs. With AMV open at 8, the job ran twice: two model calls against
      the person's allowance, and two drafts or deliveries.
   2. Automations made from the Cowork panel were saved on this device only,
      even with a server connected, so they ran only while AMV was open.
   3. Cancel, pause and "make autonomous" in the schedule manager changed only
      the copy here. Somebody cancelled a job, read "Job cancelled", and the
      server kept running it every morning.

   Each is driven through the real functions, with the engine and the server
   replaced at their seams so what is asserted is exactly what AMV asks for. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'crew' });
const { page, errors } = app;
await app.connect();

await page.evaluate(() => {
  AMV_API.hasSession = true;
  window.__ai = 0; window.__auto = 0; window.__server = [];
  window.aiComplete = async () => { window.__ai++; return 'The draft.'; };
  window.runAutonomous = async () => { window.__auto++; };
  window._aiBackendReady = () => true;
  window.__serverFails = '';
  window._autoApi = async (path, body) => {
    window.__server.push({ path, body });
    if (window.__serverFails) throw new Error(window.__serverFails);
    return { items: [] };
  };
});

section('A job the server runs is not run again by the page');
{
  const r = await page.evaluate(async () => {
    const past = Date.now() - 60000;
    _saveSched([
      { id: 'L1', goal: 'news digest (server runs this)', autoId: 'srv1', sched: { cad: 'daily', hour: 8, minute: 0 }, next: past, approval: 'require' },
      { id: 'L2', goal: 'local-only reminder', sched: { cad: 'daily', hour: 8, minute: 0 }, next: past, approval: 'require' },
    ]);
    await _runDueAuto();
    const l = _loadSched();
    return { ai: window.__ai, l1next: l.find(x => x.id === 'L1').next, l2ran: !!l.find(x => x.id === 'L2').lastRun, now: Date.now() };
  });
  ok(r.ai === 1, 'only the job that exists nowhere else was run here - once', r.ai);
  ok(r.l2ran, 'the local-only job did run', r.l2ran);
  ok(r.l1next > r.now, 'and the server’s job still moves on to its next time, so its row reads right', new Date(r.l1next).toISOString());
}

section('An automation made in Cowork is registered where it runs overnight');
{
  const r = await page.evaluate(async () => {
    let sent = null;
    const real = AMV_API._fetch;
    AMV_API._fetch = async (path, o) => { sent = { path, body: JSON.parse(o.body) }; return new Response(JSON.stringify({ item: { id: 'srv9' } }), { status: 200 }); };
    _saveSched([]);
    const id = _scheduleAuto2('check the council planning portal', { cad: 'weekly', days: [1, 3], hour: 7, minute: 30 }, { approval: 'auto' });
    for (let i = 0; i < 40 && !(_loadSched().find(x => x.id === id) || {}).autoId; i++) await new Promise(res => setTimeout(res, 25));
    AMV_API._fetch = real;
    return { sent, autoId: (_loadSched().find(x => x.id === id) || {}).autoId };
  });
  ok(r.sent && r.sent.path === '/auto/create', 'it is sent to the scheduler the cron runs', r.sent && r.sent.path);
  ok(r.sent && r.sent.body.sched && r.sent.body.sched.days.join() === '1,3' && r.sent.body.sched.hour === 7 && r.sent.body.sched.minute === 30 && r.sent.body.tz,
     'with its days, its time and the zone', r.sent && r.sent.body);
  ok(r.autoId === 'srv9', 'and the copy here knows the server has it, so it is not run twice', r.autoId);
}

section('Cancel, pause and approval reach the server first');
{
  const run = (fn) => page.evaluate(async (fn) => {
    window.__server = [];
    _saveSched([{ id: 'L9', goal: 'weekly plan', autoId: 'srv9', sched: { cad: 'weekly', days: [0], hour: 18, minute: 0 }, next: Date.now() + 3600e3, approval: 'require' }]);
    await window[fn]('L9');
    const t = _loadSched().find(x => x.id === 'L9');
    return { calls: window.__server.map(c => c.body), kept: !!t, paused: t && t.paused, approval: t && t.approval };
  }, fn);

  const cancel = await run('_schedCancel');
  ok(cancel.calls.length === 1 && cancel.calls[0].id === 'srv9' && cancel.calls[0].action === 'delete', 'cancel deletes the server’s job', cancel.calls);
  ok(!cancel.kept, 'and then the copy here', cancel.kept);

  const pause = await run('_schedTogglePause');
  ok(pause.calls[0] && pause.calls[0].action === 'pause' && pause.paused === true, 'pause pauses it on the server', pause);

  const appr = await run('_schedToggleApproval');
  ok(appr.calls[0] && appr.calls[0].action === 'edit' && appr.calls[0].approval === 'auto' && appr.approval === 'auto',
     '"make autonomous" changes the server’s job, not only the row', appr);

  const mc = await run('_mcCancelSched');
  ok(mc.calls[0] && mc.calls[0].action === 'delete' && !mc.kept, 'the Crew row’s Cancel does the same', mc);
}

section('If the server cannot be reached, nothing changes and they are told');
{
  await page.evaluate(() => { window.__serverFails = 'network error'; });
  const r = await page.evaluate(async () => {
    _saveSched([{ id: 'L7', goal: 'digest', autoId: 'srv7', sched: { cad: 'daily', hour: 8, minute: 0 }, next: Date.now() + 3600e3, approval: 'require' }]);
    await _schedCancel('L7');
    const kept = !!_loadSched().find(x => x.id === 'L7');
    const said = [...document.querySelectorAll('.toast, #toasts > *, [role=status]')].map(t => t.textContent).join(' | ');
    return { kept, said };
  });
  ok(r.kept, 'the job is not removed here while the server still runs it', r.kept);
  ok(/could not be reached/.test(r.said) && /still runs there/.test(r.said), 'and the message says it still runs, not "cancelled"', r.said);

  await page.evaluate(() => { window.__serverFails = 'not found'; });
  const gone = await page.evaluate(async () => {
    _saveSched([{ id: 'L8', goal: 'digest', autoId: 'srv-gone', next: Date.now() + 3600e3 }]);
    await _schedCancel('L8');
    return !_loadSched().find(x => x.id === 'L8');
  });
  ok(gone, 'a job the server no longer has is already cancelled, so the row goes too', gone);
  await page.evaluate(() => { window.__serverFails = ''; });
}

ok(errors.length === 0, 'and nothing threw on the way', errors);

await app.close();
if (report('one-job-runs-once-and-cancel-means-cancel') > 0) process.exitCode = 1;
done();
