/* "SESSION EXPIRED - SIGN IN AGAIN", TO SOMEBODY WHO NEVER HAD A SESSION.

   A signed-out visitor could go the whole way. Pick a plan, read its page,
   press Proceed to payment, get the payment sheet, press Pay by card - and be
   told their session had expired.

   Nothing was charged and nothing was granted: stripeCheckout and
   paypalSubscribe both requireUser, so the server refused. But it refused with
   a 401, and 01-core reads a 401 on any non-/auth call as an expired session.
   So the last screen before paying blamed the visitor for a step they had
   simply not been asked to take, and it read as a fault in AMV rather than a
   missing account.

   The account is asked for BEFORE the sheet now, and only when the server is
   the one that would take the payment:

   - a hosted payment link collects the email at the processor, so it needs no
     account here;
   - with no backend at all the sheet's own panels already say that nothing can
     be charged.

   Putting a sign-up wall in front of either would be demanding an account for
   something that does not need one, which is its own kind of wrong.

   And what somebody came for is kept. The plan is remembered, and finishing
   sign-up puts them back on its page - the same idea as _sendPendingMessage,
   for a message typed before signing up. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const seen = [];

section('Signed out, with a live backend, the account is asked for first');
{
  const app = await bootApp({ user: null });
  await app.connect();
  const r = await app.page.evaluate(async () => {
    const toasts = [];
    const real = window.toast;
    window.toast = (m, k, d) => { toasts.push(String(m)); try { return real(m, k, d); } catch (e) {} };
    openUpgrade('elite');
    await new Promise(r => setTimeout(r, 320));
    const cta = document.getElementById('upg-pay');
    if (!cta) return { noCta: true };
    cta.click();
    await new Promise(r => setTimeout(r, 420));
    return {
      sheet: !!document.querySelector('.pay-modal'),
      authOpen: !!document.getElementById('auth-submit'),
      pending: (() => { try { return sessionStorage.getItem('amv_pending_upgrade'); } catch (e) { return 'ERR'; } })(),
      toasts,
    };
  });
  ok(!r.noCta, 'the upgrade page offers Proceed to payment', r);
  ok(r.sheet === false, 'no payment sheet opens for somebody with no account', r);
  ok(r.authOpen === true, 'the sign-up sheet opens instead', r);
  ok(r.pending === 'elite', 'and the plan they picked is remembered', r);
  ok(r.toasts.some(t => /account/i.test(t)),
     'they are told an account is what is needed', r.toasts);
  /* THE SENTENCE THEY USED TO GET. It must not appear anywhere in this flow -
     it is the whole reason this exists. */
  ok(!r.toasts.some(t => /session expired/i.test(t)),
     'nobody is told their session expired when they never had one', r.toasts);

  const after = await app.page.evaluate(async () => {
    _completeIntroLogin({ name: 'New', email: 'new@amv.dev', ini: 'N' });
    await new Promise(r => setTimeout(r, 520));
    return {
      tab: S.tab,
      onUpgrade: !!document.getElementById('upg-pay'),
      text: (document.getElementById('vc').innerText || '').trim().slice(0, 60),
      pending: (() => { try { return sessionStorage.getItem('amv_pending_upgrade'); } catch (e) { return 'ERR'; } })(),
    };
  });
  ok(after.tab === 'upgrade', 'finishing sign-up puts them back on the plan page', after);
  ok(after.onUpgrade === true, 'with the payment button waiting', after);
  ok(/Elite/i.test(after.text), 'and it is the plan they picked, not a default', after);
  ok(!after.pending, 'the remembered plan is cleared once it has been used', after);
  ok(app.errors.length === 0, 'no uncaught page errors', app.errors.slice(0, 3));
  await app.close();
}

section('Signed in, nothing changes');
{
  const app = await bootApp({});
  await app.connect();
  const r = await app.page.evaluate(async () => {
    openUpgrade('elite');
    await new Promise(r => setTimeout(r, 320));
    document.getElementById('upg-pay').click();
    await new Promise(r => setTimeout(r, 420));
    return { sheet: !!document.querySelector('.pay-modal'),
             authOpen: !!document.getElementById('auth-submit') };
  });
  ok(r.sheet === true, 'an account holder still gets the payment sheet', r);
  ok(r.authOpen === false, 'and is not asked to sign up again', r);
  await app.close();
}

section('With no backend the sheet is not walled off');
{
  const app = await bootApp({ user: null });
  const r = await app.page.evaluate(async () => {
    openUpgrade('elite');
    await new Promise(r => setTimeout(r, 320));
    document.getElementById('upg-pay').click();
    await new Promise(r => setTimeout(r, 420));
    return { live: !!(window.AMV_API && AMV_API.live),
             sheet: !!document.querySelector('.pay-modal'),
             authOpen: !!document.getElementById('auth-submit') };
  });
  ok(r.live === false, 'this case is the one with no server to ask', r);
  ok(r.sheet === true,
     'the sheet still opens, because its own panels say nothing can be charged', r);
  ok(r.authOpen === false,
     'no account is demanded for a payment nothing is going to take', r);
  await app.close();
}

section('The plans that do not go through the card are untouched');
{
  const app = await bootApp({ user: null });
  await app.connect();
  const r = await app.page.evaluate(async () => {
    const before = S.tab;
    openCheckout('team');
    await new Promise(r => setTimeout(r, 320));
    const team = { tab: S.tab, authOpen: !!document.getElementById('auth-submit') };
    try { const r2 = document.getElementById('ovr'); if (r2) r2.innerHTML = ''; } catch (e) {}
    return { before, team, needs: { free: _needsAccountToPay('free'),
                                    team: _needsAccountToPay('team'),
                                    pro: _needsAccountToPay('pro'),
                                    custom: _needsAccountToPay('custom') } };
  });
  ok(r.needs.pro === true, 'a card plan needs an account', r.needs);
  /* The custom plan reaches openPaymentSheet exactly like the rest, so it
     reached the same card button and the same 401. The first version of this
     excused it and repeated the bug for one plan. */
  ok(r.needs.custom === true, 'and so does the custom plan', r.needs);
  ok(r.needs.free === false, 'Free does not', r.needs);
  ok(r.needs.team === false, 'and the per-seat plan asks its own question first', r.needs);
  ok(r.team.tab === 'team', 'so Team still goes to the seat screen', r.team);
  await app.close();
}

report();
done();
