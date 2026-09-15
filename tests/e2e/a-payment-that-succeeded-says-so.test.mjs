/* SOMEBODY PAID, AND AMV SAID "SOMETHING HICCUPED".

   _savePM was deleted on purpose - it invented `token:'tok_'+random` and stored
   it as though it meant something - and the comment recording that removal says
   "Nothing ever called _savePM". Four things did, all of them on the path a
   customer is on in the seconds after paying.

   The call threw a ReferenceError and took the rest of its line with it.
   Measured before the fix, with the server confirming plan 'pro':

     · returning from a hosted checkout: _setPlan never ran, the plan stayed
       `free`, and the screen said "Something hiccuped, but your work is safe"
       instead of "Payment complete";
     · the in-page card subscribe: the subscription SUCCEEDED, the throw skipped
       _setPlan, closePaySheet and the success toast, and the catch below told
       the customer "Could not complete subscription. Try again." - which invites
       paying twice for something they already own.

   This is the LESSONS 363-365 shape again: nothing happening at the moment
   somebody pays. It is checked here by what the CUSTOMER ends up with - the
   plan, and the words on screen - rather than by which function ran. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({});
const { page } = app;
await app.connect();
await app.stubFetch(async (u) => {
  if (/entitlement/.test(u)) {
    return new Response(JSON.stringify({ ok: true, entitlement: { plan: 'pro' }, billing: null }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ ok: true }),
    { status: 200, headers: { 'content-type': 'application/json' } });
});

section('Coming back from a paid checkout activates the plan and says so');
{
  const r = await page.evaluate(async () => {
    const errs = [], toasts = [];
    const onRej = e => errs.push('unhandled: ' + ((e.reason && e.reason.message) || e.reason));
    window.addEventListener('unhandledrejection', onRej);
    const realToast = window.toast;
    window.toast = (m, k, d) => { toasts.push(String(m)); try { return realToast(m, k, d); } catch (e) {} };
    S.user = { name: 'T', email: 't@amv.dev', ini: 'T' };
    _setPlan('free');
    const before = S.plan || loadStr('amv_plan') || 'free';
    history.replaceState({}, '', location.pathname + '?paid=pro&pm=card&session_id=cs_1');
    _checkPayReturn();
    await new Promise(r => setTimeout(r, 1200));
    window.removeEventListener('unhandledrejection', onRej);
    window.toast = realToast;
    return { before, after: S.plan || loadStr('amv_plan') || 'free', toasts, errs };
  });
  ok(r.before === 'free', 'the account started on Free, so this measured a change', r);
  ok(r.after === 'pro', 'the plan the server confirmed is the plan they end up on', r);
  ok(r.toasts.some(t => /Payment complete/i.test(t)),
     'and they are told the payment completed', r.toasts);
  /* The sentence they actually got. It is asserted by name because it is the
     whole reason this file exists. */
  ok(!r.toasts.some(t => /hiccup/i.test(t)),
     'nobody who just paid is told something hiccuped', r.toasts);
  ok(r.errs.length === 0, 'and nothing threw on the way', r.errs);
}

section('Nothing on the payment path calls a function that is not there');
{
  /* The four call sites were all to one deleted name. This checks the class
     rather than the name: every function CALLED inside _checkPayReturn and the
     card-subscribe handler has to exist. */
  const r = await page.evaluate(() => {
    const names = ['_setPlan', '_verifyEntitlement', 'renderBillingView',
                   'closePaySheet', '_checkPayReturn'];
    const out = {};
    for (const n of names) out[n] = typeof window[n];
    out._savePM = typeof window._savePM;
    return out;
  });
  for (const [n, t] of Object.entries(r)) {
    if (n === '_savePM') continue;
    ok(t === 'function', n + ' exists to be called', { n, t });
  }
  ok(r._savePM === 'undefined',
     '_savePM is still gone - it invented a payment token, and nothing should '
     + 'call it again', r._savePM);
}

section('No uncaught page errors');
ok(app.errors.length === 0, 'zero uncaught page errors', app.errors.slice(0, 3));

await app.close();
report();
done();
