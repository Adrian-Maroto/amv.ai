/* THE JOB YOU SWITCHED ON, AND THE ACCOUNT IT NEEDS.

   Turning on a job that needs a mailbox used to produce a toast - "Saved, but
   this cannot run until you connect Gmail" - and a Connect button that dropped
   you on the Connectors tab in front of every provider AMV supports, with no
   mention of the job that sent you. Two screens away from the thing you asked
   for, and the reason you were there was on neither of them.

   Asked for: a screen that says connect X to your AMV, a dialog that asks for
   what the connection needs, and then it is connected.

   The security half is the more important half, and it is the opposite of what
   the words suggest. AMV must NEVER render a field asking for somebody's
   Google or Microsoft password - a product that does that has taught its own
   users to type their credentials into whatever looks like it next, and it is
   how one person ends up reading another's mail. The sign-in happens at the
   provider; what returns is a scoped grant held against the signed-in AMV
   account. So this file checks for the ABSENCE of a credential field as
   carefully as it checks for the presence of the screen.

   And the intent is checked in both directions: the job that sent somebody to
   connect gets finished when they come back, and a connection made for its own
   sake switches nothing on. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

/* A deployment with real providers registered, answered from here. `.live` is
   a getter over `.base`, so the base is what has to be set. */
await page.evaluate(() => {
  saveStr('amv_plan', 'pro');
  AMV_API.base = 'https://stub.amv.dev';
  AMV_API.token = 'test-token';
  window.__connected = [];
  AMV_API.connectList = async () => ({
    configured: true,
    items: window.__connected,
    providers: [
      { id: 'google', name: 'Google', ready: true,
        scopes: ['mail.read', 'mail.send', 'calendar.read', 'drive.read'] },
      { id: 'microsoft', name: 'Microsoft', ready: true, scopes: ['mail.read', 'calendar.read'] },
      { id: 'github', name: 'GitHub', ready: false, scopes: ['repo.read'] },
    ],
  });
  AMV_API.toggleJob = async () => ({ ok: true });
  window.__started = [];
  AMV_API.connectStart = async (provider, scopes) => {
    window.__started.push({ provider, scopes });
    return {};                       // no url: stay on the page so the test can read it
  };
});

const openIt = async (id) => {
  await page.evaluate(async (jid) => {
    setTab('crew');
    await new Promise(r => setTimeout(r, 600));
    cwToggle(jid);
    await new Promise(r => setTimeout(r, 350));
  }, id);
};

section('Switching on a job that needs a mailbox asks for the mailbox');
{
  await openIt('inbox_digest');
  const r = await page.evaluate(() => {
    const el = document.querySelector('.cwc');
    return {
      shown: !!el,
      title: (document.querySelector('.cwc-t') || {}).textContent || '',
      lead: (document.querySelector('.cwc-lead') || {}).textContent || '',
      ways: [...document.querySelectorAll('.cwk-row')].map(x => x.querySelector('.cwk-n').textContent + ':' + x.querySelector('.cwk-go').textContent),
      primary: document.querySelectorAll('.cwk-go.bp').length,
      jobOn: !!(_cwJobs().find(j => j.id === 'inbox_digest') || {}).on,
    };
  });
  ok(r.shown, 'a screen opens rather than a toast');
  /* The heading names what the job needs; the rows name who can grant it. */
  ok(/^Connect a mailbox$/.test(r.title.trim()), 'naming what it needs, not one vendor', r.title);
  ok(!/gmail/i.test(r.title), 'and not a provider the person may not use', r.title);
  ok(/Daily inbox digest/.test(r.lead), 'and the job that asked for it', r.lead.slice(0, 90));
  /* Nov 27, the owner: "connect either Google, iCloud, Outlook etc. and simply
     show Connect for all options - only one is needed". */
  const names = r.ways.map(w => w.split(':')[0]);
  ok(['Gmail', 'Outlook and Hotmail', 'iCloud Mail', 'Yahoo Mail'].every(n => names.includes(n)) && /Another email account/.test(names.join('|')),
     'offering Gmail, Outlook, iCloud, Yahoo and any other mailbox', names.join(', '));
  ok(r.ways.every(w => /:Connect$/.test(w)), 'each with the same one word: Connect', r.ways.join(' | '));
  ok(r.primary === 1, 'one of them is the offer, the rest are alternatives', String(r.primary));
  ok(r.jobOn, 'and the job stays on, waiting', r.jobOn);
}

section('It never asks for the provider’s password');
{
  const r = await page.evaluate(() => {
    const el = document.querySelector('.cwc');
    const t = (el.textContent || '').replace(/\s+/g, ' ');
    return {
      inputs: [...el.querySelectorAll('input,textarea')].map(i => (i.type || '') + ':' + (i.name || i.id || '')),
      passwords: el.querySelectorAll('input[type="password"]').length,
      saysSo: /never sees your password/i.test(t),
      saysWhere: /sign in on their own page/i.test(t),
    };
  });
  ok(r.passwords === 0, 'there is no password field on it', r.inputs.join(' | '));
  ok(r.inputs.length === 0, 'there is no field of any kind - nothing to phish', r.inputs.join(' | '));
  ok(r.saysSo, 'and it says plainly that AMV never sees it');
  ok(r.saysWhere, 'and where the sign-in actually happens');
}

section('Connect goes straight to the provider, asking only for what the job needs');
{
  const r = await page.evaluate(async () => {
    const row = [...document.querySelectorAll('.cwk-row')].find(x => x.querySelector('.cwk-n').textContent === 'Gmail');
    row.querySelector('.cwk-go').click();
    await new Promise(x => setTimeout(x, 300));
    return { picker: document.querySelectorAll('[data-scope]').length, started: window.__started, want: load('amv_cw_conn_want'),
             still: !!document.querySelector('.cwk') };
  });
  /* Nov 27: "when you press connect it should NOT show this screen" - no
     permission picker in between. The job decides the permission: reading
     mail, and nothing a reading job does not need. */
  ok(r.picker === 0, 'no second screen of permissions in between', String(r.picker));
  ok(r.started.length === 1 && r.started[0].provider === 'google' && JSON.stringify(r.started[0].scopes) === '["mail.read"]',
     'the sign-in starts with Google for reading mail, and nothing else', JSON.stringify(r.started));
  ok(!!r.want && r.want.job === 'inbox_digest', 'remembering which job sent us, so the trip can be finished', JSON.stringify(r.want));
  ok(!r.still, 'and the screen is gone - the next thing is the provider’s own page', r.still);
}

section('Drawn before the list of sign-ins arrives, it never says there is nothing to connect');
{
  /* The screen the owner photographed: opened cold, it was drawn before the
     list came back and said "this copy of AMV cannot hold an account key" on
     a deployment with Google set up. */
  const r = await page.evaluate(async () => {
    const real = AMV_API.connectList;
    AMV_API.connectList = async () => { await new Promise(x => setTimeout(x, 600)); return real(); };
    _connState = { state: 'idle', data: null, err: '' };
    openCrewConnect('inbox_digest');
    const t = (document.querySelector('.cwc') || {}).textContent || '';
    const rows = document.querySelectorAll('.cwk-go').length;
    closeOvr(); AMV_API.connectList = real; connReload();
    await new Promise(x => setTimeout(x, 400));
    return { rows, nothing: /cannot hold an account key|nothing to connect/i.test(t) };
  });
  ok(r.rows >= 4 && !r.nothing, 'every way is offered at once, with Connect', r);
}

/* Resuming is checked by WHICH JOB IT ACTS ON, not by whether that job ends up
   scheduled. Turning on a job that can now run unattended goes through the
   server - a setup question, a created automation, a plan allowance - and that
   whole path has suites of its own. Asserting the end state here would pass or
   fail for reasons that have nothing to do with the trip somebody just made to
   their provider, which is the thing this file is about.

   `cwToggle` is a top-level function declaration in a classic script, so the
   identifier and the window property are the same binding - replacing it is
   what the bare call inside `cwConnectResume` then reaches. */
const resume = (setup) => page.evaluate(async (o) => {
  const jobs = _cwJobs(); const j = jobs.find(x => x.id === 'inbox_digest');
  j.on = false; _cwSaveJobs(jobs);
  window.__connected = o.connected
    ? [{ id: 'c1', provider: 'google', name: 'Google', unattended: true,
         scopes: ['mail.read'], at: Date.now(), lastUsed: 0 }]
    : [];
  connReload();
  await new Promise(x => setTimeout(x, 400));
  store('amv_cw_conn_want', o.want);
  const seen = [];
  const real = window.cwToggle;
  window.cwToggle = (id) => { seen.push(id); };
  try { cwConnectResume(); await new Promise(x => setTimeout(x, 200)); }
  finally { window.cwToggle = real; }
  return { seen, cleared: !load('amv_cw_conn_want'), tab: S.tab };
}, setup);

section('Coming back connected finishes the job that asked');
{
  const r = await resume({ connected: true,
    want: { job: 'inbox_digest', cap: 'mail.read', at: Date.now() } });
  ok(r.seen.join(',') === 'inbox_digest', 'the job that sent us is the job resumed', r.seen.join(','));
  ok(r.cleared, 'and the note about it is spent, so it cannot fire twice', r.cleared);
  ok(r.tab === 'crew', 'landing back on the screen it came from', r.tab);
}

section('A connection made for its own sake switches nothing on');
{
  const r = await resume({ connected: true, want: null });
  ok(r.seen.length === 0, 'nothing starts without a job having asked', r.seen.join(','));
}

section('A stale intent is not permission');
{
  const r = await resume({ connected: true,
    want: { job: 'inbox_digest', cap: 'mail.read', at: Date.now() - 2 * 3600000 } });
  ok(r.seen.length === 0, 'an hours-old note does not start a job by itself', r.seen.join(','));
}

section('Coming back still not connected resumes nothing');
{
  const r = await resume({ connected: false,
    want: { job: 'inbox_digest', cap: 'mail.read', at: Date.now() } });
  ok(r.seen.length === 0,
     'backing out at the provider leaves the job exactly where it was', r.seen.join(','));
}

section('A sign-in this deployment has not set up says so, and the other ways stay');
{
  const r = await page.evaluate(async () => {
    AMV_API.connectList = async () => ({ configured: true, items: [], providers:
      [{ id: 'google', name: 'Google', ready: false, scopes: ['mail.read'] }] });
    connReload();
    await new Promise(x => setTimeout(x, 400));
    const jobs = _cwJobs(); const j = jobs.find(x => x.id === 'inbox_digest');
    j.on = false; _cwSaveJobs(jobs);
    window.__started = [];
    openCrewConnect('inbox_digest');
    await new Promise(x => setTimeout(x, 100));
    const said = []; const realToast = window.toast; window.toast = (m) => { said.push(String(m)); };
    try{
      [...document.querySelectorAll('.cwk-row')].find(x => x.querySelector('.cwk-n').textContent === 'Gmail').querySelector('.cwk-go').click();
      await new Promise(x => setTimeout(x, 400));
    } finally { window.toast = realToast; }
    const out = { started: window.__started.length, said: said.join(' | '), open: !!document.querySelector('.cwk'),
                  others: [...document.querySelectorAll('.cwk-n')].map(n => n.textContent).join(',') };
    closeOvr();
    return out;
  });
  ok(r.started === 0, 'nothing is started that cannot work', String(r.started));
  ok(/not set up/i.test(r.said), 'it says why, to the person who pressed it', r.said);
  ok(r.open && /iCloud Mail/.test(r.others), 'and the screen stays, with the other ways to connect', r.others);
}

ok(errors.length === 0, 'and none of it raised a page error', errors.slice(0, 3).join(' | '));

await app.close();
if (report('a-job-that-needs-an-account-asks-for-it') > 0) process.exitCode = 1;
done();
