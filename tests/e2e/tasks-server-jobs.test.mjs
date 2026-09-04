/* THE JOBS THAT RUN WHILE AMV IS SHUT, ON THE SCREEN THAT CLAIMS THEM.

   The background half of the product worked and was invisible. Automations ran
   on the server, produced real answers, and were fetched into the client - and
   then the Tasks screen rendered a queue held in this browser and nothing else.
   Meanwhile the unread badge was pinned to the Tasks nav item and every
   scheduling confirmation said the result would be waiting there.

   So three things pointed at one screen and the screen did not have them. This
   suite is about the pointing being true: the jobs are listed, their results are
   readable, a job that failed says so, and the controls act on the server rather
   than on the picture. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { overflowingElement } from '../lib/layout.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'U', email: 'u@x.com', ini: 'U' } });
const { page, errors } = app;

const seed = () => page.evaluate(async () => {
  _AUTOS = [
    { id: 'j1', detail: 'Check my investment accounts', kind: 'invest', repeat: 'daily',
      next: Date.now() + 3600000, runs: 4, active: true, lastError: null },
    { id: 'j2', detail: 'Watch competitor pricing', kind: 'research', repeat: 'weekly',
      next: Date.now() + 86400000, runs: 2, active: false, lastError: 'institution down' },
  ];
  _AUTO_RESULTS = [
    { id: 'r1', autoId: 'j1', detail: 'Check my investment accounts', at: Date.now() - 60000,
      read: false, out: 'Investment check-in\n\nTotal: $12,000.00 USD\n\nUp $500.00 (4.35%) since the last check-in.' },
    { id: 'r2', autoId: 'j2', detail: 'Watch competitor pricing', at: Date.now() - 8000000,
      read: true, out: 'Nothing changed this week.' },
  ];
  S.tab = 'tasks'; setTab('tasks');
  await new Promise(r => setTimeout(r, 200));
  return document.getElementById('vc').textContent;
});

section('The scheduled jobs are actually on the screen that counts them');
{
  const t = await seed();
  ok(/Running on the server/.test(t), 'the server-side work has its own section');
  ok(/Check my investment accounts/.test(t), 'a job is listed by what it does', t.slice(0, 120));
  ok(/Watch competitor pricing/.test(t), 'and so is the second one');
  ok(/whether or not AMV is open/i.test(t),
     'saying the thing that makes it different from the local queue');
}

section('Each job says what it is and whether it is running');
{
  const t = await page.evaluate(() => document.getElementById('vc').textContent);
  /* An investing check-in reads accounts directly. Calling that "an AI task"
     would misdescribe the one job whose provenance matters most. */
  ok(/Reads your accounts/.test(t), 'a check-in says it reads the accounts');
  ok(/Searches the web/.test(t), 'a research watch says it searches');
  ok(/Active/.test(t) && /Paused/.test(t), 'and running is distinguished from paused', t.slice(0, 200));
  ok(/run 4 times/.test(t), 'with how many times it has run', /run 4 times/.test(t));
  ok(/institution down/.test(t),
     'a job that could not complete says why rather than looking healthy');
}

section('The results are readable in place');
{
  const t = await page.evaluate(() => document.getElementById('vc').textContent);
  ok(/Up \$500\.00/.test(t), 'the answer itself is on screen, not just a count', t.slice(0, 200));
  ok(/Nothing changed this week/.test(t), 'including older ones');
  const marks = await page.evaluate(() => ({
    offer: !!document.querySelector('[data-auto-act="markread"]'),
    unreadRows: document.querySelectorAll('.asrv-res.unread').length,
    readRows: document.querySelectorAll('.asrv-res:not(.unread)').length,
  }));
  ok(marks.offer, 'an unread one is offered to be marked read', marks);
  ok(marks.unreadRows === 1 && marks.readRows === 1,
     'and unread is shown differently from already-seen', marks);
}

section('Nothing is marked read just by looking at it');
{
  /* A result that disappears because it rendered was never delivered. */
  const still = await page.evaluate(() => _AUTO_RESULTS.filter(r => !r.read).length);
  ok(still === 1, 'rendering the screen left the unread one unread', still);
}

section('The controls act on the server, not on the picture');
{
  const r = await page.evaluate(async () => {
    const calls = [];
    window._autoAction = async (id, action) => { calls.push({ id, action }); return true; };
    window.confirm = () => true;
    const btn = [...document.querySelectorAll('[data-auto-act="pause"]')][0];
    btn.click();
    await new Promise(r => setTimeout(r, 150));
    return calls;
  });
  ok(r.length === 1 && r[0].action === 'pause', 'pausing sends a pause to the server', r);
  ok(r[0].id === 'j1', 'for the job that was actually clicked', r[0].id);
}

section('Deleting a running job asks first');
{
  const r = await page.evaluate(async () => {
    const calls = [];
    let asked = false;
    window._autoAction = async (id, action) => { calls.push({ id, action }); return true; };
    window.confirm = () => { asked = true; return false; };
    const btn = [...document.querySelectorAll('[data-auto-act="delete"]')][0];
    btn.click();
    await new Promise(r => setTimeout(r, 150));
    return { calls, asked, disabled: btn.disabled };
  });
  ok(r.asked, 'it asks before stopping something that is running');
  ok(r.calls.length === 0, 'and saying no deletes nothing', r.calls);
  ok(r.disabled === false, 'with the button usable again rather than stuck', r.disabled);
}

section('A failed update says so instead of redrawing as though it worked');
{
  const r = await page.evaluate(async () => {
    window._autoAction = async () => { throw new Error('engine down'); };
    let said = '';
    window.toast = (m) => { said = m; };
    const btn = [...document.querySelectorAll('[data-auto-act="pause"]')][0];
    btn.click();
    await new Promise(r => setTimeout(r, 150));
    return { said, disabled: btn.disabled };
  });
  ok(/engine down/.test(r.said), 'the failure reaches the user', r.said);
  ok(r.disabled === false, 'and the control is left usable', r.disabled);
}

section('With nothing on the server the section does not appear at all');
{
  /* An empty "Running on the server" box implies the feature is set up and idle.
     Nothing scheduled is a different state and should look like one. */
  const t = await page.evaluate(async () => {
    _AUTOS = []; _AUTO_RESULTS = [];
    renderTasksView();
    await new Promise(r => setTimeout(r, 120));
    return document.getElementById('vc').textContent;
  });
  ok(!/Running on the server/.test(t), 'no section, no empty promise', t.slice(0, 120));
}

section('It fits on a phone');
{
  await seed();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => renderTasksView());
  await page.waitForTimeout(150);
  const bad = await overflowingElement(page);
  ok(!bad, 'nothing pushes the page sideways at 390px', bad);
  await page.setViewportSize({ width: 1280, height: 900 });
}

ok(errors.length === 0, 'no console errors along the way', errors.slice(0, 3));

section('"Could not check" is not the same nothing as "you have none"');
{
  /* The panel renders nothing when there is nothing, deliberately - an empty
     "Running on the server" box reads as set-up-and-idle. But a failed READ
     produced that identical nothing, so somebody with jobs running was shown
     the same blank as somebody who had never scheduled one, and the obvious
     next move is to schedule a duplicate. */
  const r = await page.evaluate(async () => {
    const realBase = AMV_API.base, realTok = AMV_API.token, realFetch = window.fetch;
    AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 't';
    window.fetch = async () => { throw new Error('network down'); };
    _AUTOS = []; _AUTO_RESULTS = [];
    await _autoRefresh();
    window.fetch = realFetch;
    const st = _autoLoadState();
    const html = _autoServerHTML();
    AMV_API.base = realBase; AMV_API.token = realTok;
    return { err: st.error, html };
  });
  ok(!!r.err, 'a failed read is recorded as a failure', r.err);
  ok(r.html.length > 0, 'and the panel is not silently absent', r.html.length);
  ok(/could not check/i.test(r.html), 'it says AMV could not check', r.html.slice(0, 160));
  ok(/still running/i.test(r.html),
     'and that anything already scheduled is unaffected', r.html.slice(0, 220));
  ok(/not a list of nothing/i.test(r.html),
     'making the distinction explicit rather than leaving it to be inferred', true);
  ok(/data-asrv-retry/.test(r.html), 'with a retry, so it is a control not a sentence', true);
}

section('Never scheduling anything still shows nothing at all');
{
  /* The fix must not invent a problem for the ordinary case. */
  const r = await page.evaluate(async () => {
    const realBase = AMV_API.base, realTok = AMV_API.token, realFetch = window.fetch;
    AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 't';
    window.fetch = async () => ({ ok: true, status: 200, headers: new Headers(),
      json: async () => ({ ok: true, items: [], results: [] }) });
    await _autoRefresh();
    window.fetch = realFetch;
    const out = { err: _autoLoadState().error, html: _autoServerHTML() };
    AMV_API.base = realBase; AMV_API.token = realTok;
    return out;
  });
  ok(!r.err, 'a successful empty read is not an error', r.err);
  ok(r.html === '', 'and renders no section at all, as before', r.html.slice(0, 80));
}

await app.close();
if (report('tasks-server-jobs') > 0) process.exitCode = 1;
done();
