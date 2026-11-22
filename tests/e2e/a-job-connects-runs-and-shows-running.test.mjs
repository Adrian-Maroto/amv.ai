/* A JOB CONNECTS, RUNS AND SHOWS AS RUNNING (Nov 22).

   The owner's flow, step by step: "I want a job done but I need to connect.
   AMV opens a thing saying this job will do this and needs this. If I am not
   connected, I click Connect and it connects. If I am already connected I
   click Run and it runs - and I see it in Crew as running every day, or
   every morning at 7."

   Driven in a real browser. The provider's own sign-in page is the one step
   that cannot run here, so the connection it produces is set the way the
   connection list reports it on return; everything either side is the app. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'crew' });
const p = app.page;
await p.evaluate(() => { saveStr('amv_plan', 'pro'); });
await p.waitForTimeout(2500);
/* AMV's server, answered here: a scheduled job is created there and listed
   back, which is what makes it run with AMV closed. */
await p.evaluate(() => {
  window.__made = [];
  window._autoApi = async (path, body) => {
    if (path === '/auto/list') return { ok: true, items: window.__made.slice(), results: [], emailReady: true, canSchedule: true, plan: 'pro' };
    if (path === '/auto/create' || /create|schedule|add/.test(path)) {
      const item = { id: 'a' + (window.__made.length + 1), detail: body.detail, repeat: body.repeat, sched: body.sched, active: true, notify: 'app', srcId: body.srcId, created: Date.now() };
      window.__made.push(item);
      return { ok: true, emailReady: true, item };
    }
    return { ok: true };
  };
});
await p.evaluate(() => _autoRefresh());

/* An inbox job: it needs a mailbox. */
const jobId = await p.evaluate(() => {
  const all = (typeof _cjList === 'function') ? _cjList() : [];
  const j = all.find(x => /inbox digest/i.test(x.title || '') && _cwNeedsList(x).indexOf('Email') >= 0);
  return j ? j.id : '';
});
ok(!!jobId, 'there is an inbox job that needs a mailbox', jobId);
const panel = () => p.evaluate(() => {
  const d = document.querySelector('#ovr .cwp'); if (!d) return null;
  return { text: d.innerText, connect: !!d.querySelector('[data-cwp-connect]'), connected: /Connected/.test(d.innerText),
           run: (d.querySelector('#cwp-go') || {}).textContent || '', need: !!d.querySelector('#cwp-need-go2') };
});

section('The panel says what the job does and what it needs');
{
  await p.evaluate((id) => cwPeek(id), jobId);
  const s = await panel();
  ok(!!s && /Connects to/i.test(s.text) && /Email/.test(s.text), 'it names what it connects to', s && s.text.slice(0, 200));
  ok(s && s.connect && s.need && !s.run, 'with Connect, and no Run while the mailbox is missing', s);
}

section('Connect, come back: the same panel, connected, with Run');
{
  /* Pressing Connect remembers the job before leaving for the provider. */
  await p.evaluate(() => { window.openCrewConnect = () => {}; });
  await p.click('#ovr [data-cwp-connect]');
  ok(await p.evaluate((id) => _cwResumeJob() === id, jobId), 'the job is remembered for the way back', jobId);
  /* The provider's page: the connection it makes, as the list reports it. */
  await p.evaluate(() => { closeOvr(); _connState.data = { items: [{ id: 'google', unattended: true, scopes: ['mail.read', 'calendar.read'] }] }; });
  await p.evaluate(() => cwResumeIfAny());
  const s = await panel();
  ok(!!s, 'coming back opens the job’s own panel again', s);
  ok(s && s.connected && !s.connect, 'the mailbox is shown as connected', s && s.text.slice(0, 300));
  ok(s && /^Run$/.test(s.run.trim()), 'and the button is Run', s && s.run);
}

section('Run: it is on, on the schedule chosen, and Crew shows it running');
{
  await p.selectOption('#cwp-cad', 'daily');
  await p.fill('#cwp-time', '07:00');
  await p.dispatchEvent('#cwp-time', 'change');
  await p.click('#cwp-go');
  await p.waitForTimeout(1500);
  ok(await p.evaluate(() => window.__made.length === 1 && !!window.__made[0].sched && window.__made[0].sched.hour === 7), 'one scheduled job is created on the server, at 7', await p.evaluate(() => window.__made));
  const job = await p.evaluate((id) => { const j = _cwJobs().find(x => x.id === id || x.from === id || x.src === id); return j ? { on: !!j.on, when: _cwJobWhen(j) } : null; }, jobId);
  ok(job && job.on, 'the job is switched on', job);
  ok(job && job.when && job.when.cad === 'daily' && job.when.hour === 7 && (job.when.minute || 0) === 0, 'every day at 7:00', job && job.when);
  await p.evaluate(() => { closeOvr(); setTab('crew'); });
  await p.waitForTimeout(1200);
  const now = await p.evaluate(() => { const s = document.getElementById('crew-now') || document.querySelector('[aria-labelledby="crew-now-h"]'); return s ? s.innerText : ''; });
  ok(/inbox digest/i.test(now), 'Crew lists it under Running now', now.slice(0, 300));
  ok(/7:00|07:00/.test(now) && /day/i.test(now), 'with when it runs: every day at 7', now.slice(0, 300));
  ok(/\b1 switched on\b/.test(now), 'counted once - the job and its schedule are one job', now.slice(0, 120));
  const listed = await p.evaluate(() => { const s = document.getElementById('mc-sched'); return s ? [...s.querySelectorAll('.mc-sched-goal')].map(e => e.textContent) : []; });
  ok(listed.filter(x => /inbox digest/i.test(x)).length === 1 && !listed.some(x => /^Each evening/.test(x)), 'listed once under its own name, not twice and not as its instruction', listed);
}

await app.close();
if (report('a-job-connects-runs-and-shows-running') > 0) process.exitCode = 1;
done();
