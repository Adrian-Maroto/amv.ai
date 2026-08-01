/* THE INVESTING CHECK-IN, ON SCREEN.

   The finance layer had been complete and read-only for a long time with no
   screen at all - nothing in the app referenced it, so the only way to reach it
   was to ask AMV in chat. This is that surface.

   Every assertion here is really the same one: it must be unable to lie about
   somebody's money. A first check-in has nothing to compare against and says so
   rather than reporting no change. A failure shows the failure rather than the
   last figure it happened to have. And each state of "not set up yet" says
   which one it is, because "link an account" shown to somebody with no backend
   sends them looking for a button that cannot work. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { overflowingElement } from '../lib/layout.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'U', email: 'u@x.com', ini: 'U' } });
const { page, errors } = app;

const open = () => page.evaluate(async () => {
  S.settingsPane = 'investing'; S.tab = 'settings'; setTab('settings');
  await new Promise(r => setTimeout(r, 180));
  return document.getElementById('vc').textContent;
});
const redraw = () => page.evaluate(async () => {
  _renderInvestPane(document.getElementById('set-pane') || document.getElementById('vc'));
  await new Promise(r => setTimeout(r, 120));
  return document.getElementById('vc').textContent;
});

section('It says which kind of "not yet" you are in');
{
  const t = await open();
  ok(/Not connected yet/.test(t), 'with no backend it names the backend', /Not connected/.test(t));
  /* The BUTTON, not the phrase - the pane's own subtitle contains those words
     while describing the feature, and an assertion that matches your own copy
     is not an assertion. */
  const btn = await page.evaluate(() => !!document.getElementById('inv-link'));
  ok(!btn, 'and does not offer a link button that could not work', btn);

  const linked = await page.evaluate(async () => {
    saveStr('amv_api_base', 'https://x.test');
    _renderInvestPane(document.getElementById('set-pane') || document.getElementById('vc'));
    await new Promise(r => setTimeout(r, 120));
    return document.getElementById('vc').textContent;
  });
  ok(/Link an investment account/.test(linked), 'with a backend it offers to link one');
  ok(/never sees your username or password/i.test(linked),
     'saying where the sign-in actually happens, which is the thing people worry about');
}

section('What it is, before what it shows');
{
  const t = await redraw();
  ok(/can only look/i.test(t), 'it states it cannot move money');
  ok(/cannot buy, sell, or move/i.test(t), 'in those words');
  ok(/Investment accounts only/i.test(t),
     'and that a current account is deliberately excluded');
  ok(/No number is ever guessed/i.test(t), 'and that nothing is estimated');
}

section('The first check-in does not claim the market stood still');
{
  const t = await page.evaluate(async () => {
    saveStr('amv_fin_linked', '1'); saveStr('amv_api_token', 't');
    window.AMVFinance.checkin = async () => ({ ok: true, first: true, total: 12345.67, currency: 'USD' });
    _renderInvestPane(document.getElementById('set-pane') || document.getElementById('vc'));
    await new Promise(r => setTimeout(r, 120));
    document.getElementById('inv-now').click();
    await new Promise(r => setTimeout(r, 160));
    return document.getElementById('vc').textContent;
  });
  ok(/nothing to compare it against/.test(t),
     'it says this is the first one rather than reporting no change');
  ok(/12,345\.67|12345\.67/.test(t), 'while still showing the real total', /12,345/.test(t));
  ok(!/0%/.test(t), 'and no percentage is invented from a comparison it cannot make');
}

section('A loss is shown as a loss');
{
  const t = await page.evaluate(async () => {
    window.AMVFinance.checkin = async () => ({
      ok: true, first: false, total: 11000, currency: 'USD',
      changeUSD: -1345.67, changePct: -10.9, direction: 'down',
      byAccount: [{ name: 'Brokerage', balance: 7000, change: -1000 },
                  { name: 'Roth', balance: 4000, isNew: true }] });
    document.getElementById('inv-now').click();
    await new Promise(r => setTimeout(r, 160));
    return document.getElementById('vc').textContent;
  });
  ok(/-10\.9%/.test(t), 'the percentage is negative, not an absolute value', /-10\.9/.test(t));
  ok(/Brokerage/.test(t), 'each account is broken out');
  ok(/new/.test(t), 'and one seen for the first time is marked new rather than credited with a gain');

  const cls = await page.evaluate(() => (document.querySelector('.inv-change') || {}).className || '');
  ok(/down/.test(cls), 'and it is coloured as a loss, not left to a minus sign', cls);
}

section('A failure never falls back to the last number');
{
  /* The dangerous version of this screen shows a remembered figure when the
     institution cannot be reached, which is indistinguishable from a current
     one and is the single most damaging thing it could do. */
  const t = await page.evaluate(async () => {
    window.AMVFinance.checkin = async () => { throw new Error('Could not reach your institution.'); };
    document.getElementById('inv-now').click();
    await new Promise(r => setTimeout(r, 160));
    return document.getElementById('vc').textContent;
  });
  ok(/Could not reach your institution/.test(t), 'the failure is stated');

  /* The figures from the previous check are still on screen, which is useful -
     but unlabelled next to an error they are indistinguishable from current
     ones, and on a screen about savings that is the same as being wrong. */
  const stamped = await page.evaluate(() => {
    const s = document.querySelector('.inv-stale');
    return { marked: !!s, text: s ? s.textContent : '', stillThere: !!document.querySelector('.inv-change') };
  });
  ok(stamped.stillThere, 'the last known figures are not thrown away');
  ok(stamped.marked, 'but they are stamped rather than left looking current', stamped);
  ok(/not current/i.test(stamped.text), 'in words that say exactly that', stamped.text);

  const once = await page.evaluate(() => document.querySelectorAll('.inv-stale').length);
  ok(once === 1, 'and a second failure does not stack another stamp on top', once);

  const btn = await page.evaluate(() => document.getElementById('inv-now').disabled);
  ok(btn === false, 'with the button usable again rather than stuck', btn);
}

section('Scheduling it creates real background work');
{
  const r = await page.evaluate(async () => {
    const calls = [];
    window.AMV_API._fetch = async (path, init) => {
      calls.push({ path, body: init && init.body });
      return { json: async () => ({ ok: true, item: { id: 'a1' } }) };
    };
    document.querySelector('[data-inv-when="daily"]').click();
    await new Promise(r => setTimeout(r, 200));
    return { calls, said: document.getElementById('inv-when-say').textContent,
             saved: loadStr('amv_inv_when') };
  });
  const created = r.calls.find(c => c.path === '/auto/create');
  ok(!!created, 'a real scheduled job is created on the server', r.calls.map(c => c.path));
  ok(/investment accounts/i.test(created.body), 'asking for the check-in itself', created.body.slice(0, 60));
  /* The kind is the whole safety property. A job filed as a plain task is handed
     to a model that cannot read an account, so it would have to guess at
     somebody's savings; 'invest' routes it to the real check-in instead. */
  ok(/"kind":"invest"/.test(created.body),
     'filed as a real check-in, not as text for a model that cannot see the accounts',
     created.body);
  ok(r.saved === 'daily', 'the choice is remembered', r.saved);
  ok(/each morning/.test(r.said), 'and confirmed in words', r.said);
  ok(/Tasks/.test(r.said), 'saying where the result will actually be', r.said);
}

section('Changing your mind replaces the job rather than adding one');
{
  /* Picking daily and then weekly used to create two server jobs and delete
     neither, so you were checked twice on a schedule you never asked for - and
     the buttons showed one choice while two were running. */
  const r = await page.evaluate(async () => {
    const calls = [];
    window.AMV_API._fetch = async (path, init) => {
      calls.push({ path, body: init && init.body });
      return { json: async () => ({ ok: true, item: { id: 'a2' } }) };
    };
    /* Redraw so the buttons reflect the schedule that now exists - that is also
       what puts the Stop button on screen. */
    _renderInvestPane(document.getElementById('set-pane') || document.getElementById('vc'));
    await new Promise(r => setTimeout(r, 120));
    calls.length = 0;
    document.querySelector('[data-inv-when="weekly"]').click();
    await new Promise(r => setTimeout(r, 220));
    return { calls, saved: loadStr('amv_inv_when'), job: loadStr('amv_inv_auto') };
  });
  const del = r.calls.find(c => c.path === '/auto/update');
  ok(!!del, 'the job that was already running is deleted', r.calls.map(c => c.path));
  ok(/"id":"a1"/.test(del.body) && /"action":"delete"/.test(del.body),
     'by its real id, which means the id was kept when it was created', del.body);
  ok(r.calls.filter(c => c.path === '/auto/create').length === 1, 'and exactly one new job replaces it');
  ok(r.saved === 'weekly' && r.job === 'a2', 'with the new one remembered', r);
}

section('Stop actually stops it on the server');
{
  /* "Stopped. AMV will not check on its own." was previously written after
     clearing one key in this browser, while the server carried on checking. On
     a screen about somebody's savings, a false "stopped" is the worst of the
     three states to be wrong about. */
  const r = await page.evaluate(async () => {
    const calls = [];
    window.AMV_API._fetch = async (path, init) => {
      calls.push({ path, body: init && init.body });
      return { json: async () => ({ ok: true }) };
    };
    _renderInvestPane(document.getElementById('set-pane') || document.getElementById('vc'));
    await new Promise(r => setTimeout(r, 120));
    calls.length = 0;
    document.querySelector('[data-inv-when=""]').click();
    await new Promise(r => setTimeout(r, 220));
    return { calls, said: document.getElementById('inv-when-say').textContent,
             saved: loadStr('amv_inv_when'), job: loadStr('amv_inv_auto') };
  });
  const del = r.calls.find(c => c.path === '/auto/update');
  ok(!!del && /"action":"delete"/.test(del.body), 'the server job is deleted', r.calls.map(c => c.path));
  ok(/"id":"a2"/.test(del.body), 'the one that was actually running', del.body);
  ok(/Stopped/.test(r.said), 'and only then does it say stopped', r.said);
  ok(r.saved === '' && r.job === '', 'with nothing left pointing at a job', r);
}

section('A stop that fails does not claim to have stopped');
{
  const r = await page.evaluate(async () => {
    saveStr('amv_inv_when', 'daily'); saveStr('amv_inv_auto', 'a9');
    _renderInvestPane(document.getElementById('set-pane') || document.getElementById('vc'));
    await new Promise(r => setTimeout(r, 120));
    window.AMV_API._fetch = async () => { throw new Error('engine down'); };
    document.querySelector('[data-inv-when=""]').click();
    await new Promise(r => setTimeout(r, 220));
    return { said: document.getElementById('inv-when-say').textContent, saved: loadStr('amv_inv_when') };
  });
  ok(!/Stopped/.test(r.said), 'it does not say stopped', r.said);
  ok(/still scheduled/i.test(r.said), 'it says the check-in is still running', r.said);
  ok(r.saved === 'daily', 'and the screen still shows the schedule that really exists', r.saved);
}

section('If scheduling fails, nothing is claimed');
{
  const r = await page.evaluate(async () => {
    /* No job running, so this is purely about the create failing. */
    saveStr('amv_inv_when', ''); saveStr('amv_inv_auto', '');
    _renderInvestPane(document.getElementById('set-pane') || document.getElementById('vc'));
    await new Promise(r => setTimeout(r, 120));
    window.AMV_API._fetch = async () => { throw new Error('engine down'); };
    document.querySelector('[data-inv-when="weekly"]').click();
    await new Promise(r => setTimeout(r, 200));
    return { said: document.getElementById('inv-when-say').textContent, saved: loadStr('amv_inv_when') };
  });
  ok(/nothing is scheduled|could not/i.test(r.said), 'the failure is stated', r.said);
  ok(r.saved === '', 'and the setting is not left looking as though it took', r.saved);
}

section('It fits on a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await redraw();
  const bad = await overflowingElement(page);
  ok(!bad, 'nothing pushes the page sideways at 390px', bad);
  await page.setViewportSize({ width: 1280, height: 900 });
}

ok(errors.length === 0, 'no console errors along the way', errors.slice(0, 3));

await app.close();
if (report('investing') > 0) process.exitCode = 1;
done();
