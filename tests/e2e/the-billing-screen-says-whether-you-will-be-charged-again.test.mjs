/* THE ONE QUESTION A BILLING SCREEN EXISTS TO ANSWER.

   "Will I be charged again, and when." This screen answered it with
   arithmetic: the day THIS BROWSER recorded a payment, plus thirty days. That
   number is not a fact about the subscription. It is absent on a second device,
   wrong after any plan change, wrong by a day in half the months of the year,
   and - now that a plan can be bought by the year - wrong by eleven months for
   anybody who chose Yearly. It was printed as "renews 4 Oct" beside a green dot,
   which is the most confident a page can be about something it made up.

   So the date comes from the processor or it does not appear, and the word in
   front of it says which fact it is: a subscription with auto-renew off ENDS on
   that date, and calling that "renews" is the opposite of the truth to the one
   person most likely to be reading the line.

   The control is held to the same rule. Nothing local is set on the way to
   Stripe; the screen redraws from what the server read back. A call that fails
   leaves the screen saying exactly what it said before, because that is still
   what is true. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'billing', apiBase: 'https://backend.example.workers.dev',
                            user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

const MONTH = 30 * 86400000;

/* Put the screen in a known state and report what it says. `renewal` is what
   the server answered with; null is a deployment whose webhook has not
   delivered a subscription event yet. */
const bill = (renewal, plan) => page.evaluate((o) => {
  saveStr('amv_plan', o.plan || 'pro');
  /* The device's own record of when it paid. It exists and is deliberately
     NOT what the date comes from. */
  saveStr('amv_plan_since', String(Date.now() - 12 * 86400000));
  S.renewal = o.renewal;
  S.tab = 'billing';
  renderBillingView();
  const row = document.querySelector('.bill-ar');
  const sub = document.querySelector('.bill-sum-sub');
  const btn = document.getElementById('bill-ar-go');
  return {
    status: sub ? sub.textContent.trim() : '',
    hasRow: !!row,
    state: row ? (row.querySelector('.bill-ar-s') || {}).textContent : '',
    words: row ? (row.querySelector('.bill-ar-w') || {}).textContent : '',
    btn: btn ? btn.textContent.trim() : '',
    off: !!(row && row.classList.contains('off')),
  };
}, { renewal, plan });

const IN_A_MONTH = () => Date.now() + MONTH;

section('A date it does not have is not a date it prints');
{
  const r = await bill(null);
  ok(r.status.length > 0, 'the status line is there', r.status);
  ok(!/renews/i.test(r.status),
     'and claims no renewal, because the server has not said there is one', r.status);
  ok(r.hasRow === false,
     'and there is no auto-renew control, because there is nothing to change', r.hasRow);
}

section('When the processor has answered, the screen says what it said');
{
  const at = IN_A_MONTH();
  const r = await bill({ autoRenew: true, renewsAt: at, cycle: 'month', manageable: true });
  const day = await page.evaluate((t) => new Date(t).toLocaleDateString(undefined,
    { year: 'numeric', month: 'short', day: 'numeric' }), at);
  ok(r.status.indexOf(day) >= 0,
     'the renewal date on the screen is the processor’s, to the day', { status: r.status, day });
  ok(/renews/i.test(r.status), 'and it is called a renewal, which it is', r.status);
  ok(r.hasRow && /on/i.test(r.state), 'auto-renew is shown as on', r);
  ok(/charged again/i.test(r.words) && r.words.indexOf(day) >= 0,
     'stated as what it means - you will be charged again, on this day', r.words);
  ok(/turn off/i.test(r.btn), 'and the button says what pressing it does', r.btn);
}

section('With auto-renew off, the same date is the opposite fact');
{
  const at = IN_A_MONTH();
  const r = await bill({ autoRenew: false, renewsAt: at, cycle: 'month', manageable: true });
  ok(/ends/i.test(r.status) && !/renews/i.test(r.status),
     'the plan ENDS on that day - the word is the whole difference', r.status);
  ok(r.off && /off/i.test(r.state), 'the row says off, and is marked', r);
  ok(/stays fully active|stays active/i.test(r.words),
     'and says what they keep, which is what somebody is afraid of here', r.words);
  ok(/back on/i.test(r.btn), 'with the way back', r.btn);
}

section('A control that could not act is not drawn');
{
  /* No subscription id on the record means nothing to write to. A switch wired
     to nothing, on the screen holding somebody's money, is worse than no
     switch - the portal button below stays the answer. */
  const r = await bill({ autoRenew: true, renewsAt: IN_A_MONTH(), cycle: 'month', manageable: false });
  ok(r.hasRow === false, 'no row', r.hasRow);
  ok(!!(await page.evaluate(() => !!document.getElementById('portal-open-btn'))),
     'while Manage billing, which always works, is still there', true);
}

/* Press the control with the server stubbed, and report what was sent and what
   the screen became. */
async function press(opts) {
  return page.evaluate(async (o) => {
    saveStr('amv_plan', 'pro');
    S.renewal = { autoRenew: o.from, renewsAt: Date.now() + 2592000000, cycle: 'month', manageable: true };
    S.tab = 'billing'; renderBillingView();

    window.__sent = [];
    AMV_API.autoRenew = async (on) => {
      window.__sent.push(on);
      if (o.fail) throw Object.assign(new Error(o.fail.message || 'nope'), { code: o.fail.code });
      return { ok: true, renewal: { autoRenew: o.becomes, renewsAt: Date.now() + 2592000000,
                                    cycle: 'month', manageable: true } };
    };

    document.getElementById('bill-ar-go').click();
    await new Promise(r => setTimeout(r, 120));

    /* Turning it OFF ends something somebody is paying for, so it is asked
       first. Whether it was asked is itself the assertion. */
    const ovr = document.getElementById('ovr');
    const asked = !!(ovr && ovr.textContent && /auto-renew/i.test(ovr.textContent) && ovr.children.length);
    const askText = ovr ? ovr.textContent : '';
    if (asked && !o.cancel) {
      const go = [...ovr.querySelectorAll('button')]
        .find(b => /turn it off/i.test(b.textContent));
      if (go) go.click();
    } else if (asked && o.cancel) {
      const no = [...ovr.querySelectorAll('button')]
        .find(b => /keep auto-renew/i.test(b.textContent));
      if (no) no.click();
    }
    await new Promise(r => setTimeout(r, 300));

    const row = document.querySelector('.bill-ar');
    return {
      sent: window.__sent, asked, askText,
      state: row ? (row.querySelector('.bill-ar-s') || {}).textContent : '',
      btn: (document.getElementById('bill-ar-go') || {}).textContent || '',
    };
  }, opts);
}

section('Turning it off is asked about before anything is sent');
{
  const r = await press({ from: true, becomes: false, cancel: true });
  ok(r.asked, 'the question is put', r.askText.slice(0, 120));
  ok(/nothing more will be charged/i.test(r.askText),
     'and states the consequence plainly', r.askText.slice(0, 200));
  ok(/keep/i.test(r.askText), 'with a way out that is not the scary one', r.askText.slice(0, 200));
  ok(r.sent.length === 0,
     'saying no sends nothing, which is the entire job of asking', r.sent);
  ok(/on/i.test(r.state), 'and the screen is unchanged', r.state);
}

section('Saying yes sends it, and the screen becomes what came back');
{
  const r = await press({ from: true, becomes: false });
  ok(r.sent.length === 1 && r.sent[0] === false, 'one call, saying off', r.sent);
  ok(/off/i.test(r.state), 'and the row now reads off', r.state);
  ok(/back on/i.test(r.btn), 'with the way back on the button', r.btn);
}

section('Turning it back on costs nothing, so it is not interrogated');
{
  const r = await press({ from: false, becomes: true });
  ok(r.asked === false, 'no confirmation for the harmless direction', r.asked);
  ok(r.sent.length === 1 && r.sent[0] === true, 'it just goes', r.sent);
  ok(/on/i.test(r.state), 'and the row reads on', r.state);
}

section('The screen never gets ahead of the server');
{
  /* THE ONE THAT WOULD BE WORST. A screen that flips optimistically and then
     fails tells somebody their billing has stopped when it has not, and the
     next charge arrives anyway. */
  const r = await press({ from: true, becomes: false, fail: { message: 'card problem' } });
  ok(r.sent.length === 1, 'the call was made', r.sent);
  ok(/on/i.test(r.state),
     'and after it failed the row still reads ON, because that is what is true', r.state);
  ok(/turn off/i.test(r.btn), 'the button is usable again', r.btn);

  /* A deployment with no processor is not a failed change - nothing was
     attempted - and it is not somebody's fault. */
  const n = await press({ from: true, becomes: false, fail: { code: 'needs_service' } });
  ok(/on/i.test(n.state), 'same for a deployment that has no processor connected', n.state);
}

ok(errors.length === 0, 'no console errors', errors);

await app.close();
if (report('the-billing-screen-says-whether-you-will-be-charged-again') > 0) process.exitCode = 1;
done();
