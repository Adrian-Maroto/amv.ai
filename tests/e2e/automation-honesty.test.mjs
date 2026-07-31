/* SCHEDULING, FROM THE USER'S SIDE.

   The activation offer says the answer will be waiting "even with AMV closed".
   That is only true if it arrives somewhere they look while AMV is closed - so
   the app has to ask for email delivery where the deployment can send it, tell
   the truth where it cannot, and never report success for an automation the
   account is not able to run. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Alice', email: 'alice@x.com', ini: 'A' } });
const { page, errors } = app;

/* Stand in for /auto/*. Records what the app ASKED for, which is the thing
   under test - the server's own half is covered in the worker suite. */
/* `_AUTO_EMAIL_READY` is a top-level `let`, so it is a script binding and NOT a
   property of window - assigning window._AUTO_EMAIL_READY would create a second
   variable and quietly test nothing. It is set the way the app sets it: by
   running a real /auto/list through the stub. */
await page.evaluate(() => { window.__realAutoApi = _autoApi; });

const wireApi = async ({ emailReady, canSchedule = true, refuse = false }) => {
  await page.evaluate(cfg => {
  window.__calls = [];
  window.__toasts = [];
  window.toast = (m, k) => { window.__toasts.push({ m, k }); };
  window._autoApi = async (path, body) => {
    window.__calls.push({ path, body });
    if (path === '/auto/list') return { ok: true, items: [], results: [], emailReady: cfg.emailReady, canSchedule: cfg.canSchedule, plan: cfg.canSchedule ? 'pro' : 'free' };
    if (cfg.refuse) {
      const e = new Error('Background automations run on AMV’s servers while you are away, so they need a paid plan. Upgrade and this will run on schedule.');
      e.code = 'plan_required';
      throw e;
    }
    return { ok: true, emailReady: cfg.emailReady, deliveryDowngraded: body.notify === 'email' && !cfg.emailReady,
             item: { id: 'a1', detail: body.detail, repeat: body.repeat, active: true,
                     notify: (body.notify === 'email' && cfg.emailReady) ? 'email' : 'app' } };
  };
  }, { emailReady, canSchedule, refuse });
  // Teach the app its capabilities through the real code path.
  await page.evaluate(() => _autoRefresh());
  await page.evaluate(() => { window.__calls = []; window.__toasts = []; });
};

const last = () => page.evaluate(() => ({
  calls: window.__calls, toasts: window.__toasts, tab: S.tab,
}));

section('Where email can be sent, the daily step asks for email');
{
  await wireApi({ emailReady: true });
  const item = await page.evaluate(() => _nextStepRun('daily', 'brief me on the semiconductor market every morning'));
  const v = await last();
  const create = v.calls.find(c => c.path === '/auto/create');
  ok(!!create, 'an automation is really created - the offer is not a message');
  ok(create.body.notify === 'email', 'and it asks for email delivery', create.body.notify);
  ok(create.body.repeat === 'daily', 'on a daily schedule', create.body.repeat);
  ok(/emailed to you/i.test(v.toasts.map(t => t.m).join(' ')),
     'the confirmation says the result is emailed, which is the promise that was made',
     v.toasts.map(t => t.m).join(' | ').slice(0, 90));
}

section('Where it cannot, it says the other true thing instead');
{
  await wireApi({ emailReady: false });
  await page.evaluate(() => _nextStepRun('daily', 'brief me on the semiconductor market every morning'));
  const v = await last();
  const msg = v.toasts.map(t => t.m).join(' | ');
  ok(/waiting in Tasks/i.test(msg), 'it promises what actually happens - the result waits in Tasks', msg.slice(0, 90));
  ok(!/emailed/i.test(msg), 'and does NOT claim an email that will never arrive');
}

section('An account that cannot run background work is not told it worked');
{
  await wireApi({ emailReady: true, canSchedule: false, refuse: true });
  const item = await page.evaluate(() => _scheduleTask({ detail: 'daily market brief', repeat: 'daily' }));
  const v = await last();
  const msg = v.toasts.map(t => t.m).join(' | ');
  ok(item === null, 'nothing is returned, so no caller can act as though it scheduled', item);
  ok(!/Scheduled/i.test(msg), 'no success message is shown', msg.slice(0, 90));
  ok(/paid plan/i.test(msg), 'the reason is given', msg.slice(0, 90));
  ok(v.tab === 'plans', 'and the user is taken to the one screen that can fix it', v.tab);
}

section('The capability is learned from the server, not assumed');
{
  /* Driven entirely through /auto/list, because that is the only way the app
     ever learns this - and because the flags are script bindings that no test
     can reach from window anyway. */
  await wireApi({ emailReady: false, canSchedule: false });
  const off = await page.evaluate(() => ({ email: _AUTO_EMAIL_READY, sched: _AUTO_CAN_SCHEDULE }));
  ok(off.email === false, 'a deployment with no email provider is known to have none', off.email);
  ok(off.sched === false, 'and an account that cannot schedule is known before it tries', off.sched);

  await wireApi({ emailReady: true, canSchedule: true });
  const on = await page.evaluate(() => ({ email: _AUTO_EMAIL_READY, sched: _AUTO_CAN_SCHEDULE }));
  ok(on.email === true, 'and the answer changes when the server\u2019s answer changes', on.email);
  ok(on.sched === true, 'for both capabilities', on.sched);
}

section('An error code survives the trip, so behaviour does not hinge on wording');
{
  const e = await page.evaluate(async () => {
    window._autoApi = window.__realAutoApi;      // the stub is out of the way now
    const realFetch = window.fetchDeadline;
    window.fetchDeadline = async () => ({ ok: false, status: 402, json: async () => ({ error: 'nope', code: 'plan_required' }) });
    AMV_API.base = 'https://api.test'; AMV_API.token = 't';
    let caught = null;
    try { await _autoApi('/auto/create', {}); } catch (err) { caught = { code: err.code, status: err.status, msg: err.message }; }
    window.fetchDeadline = realFetch;
    return caught;
  });
  ok(e && e.code === 'plan_required', 'the machine-readable code comes through', e);
  ok(e && e.status === 402, 'along with the status', e && e.status);
}

ok(errors.length === 0, 'no console errors', errors.slice(0, 3));
report('automation-honesty-ui');
done();
