/* THE CHECKOUT TOOK A CARD, CHARGED NOTHING, AND SAID "YOU'RE NOW ON PRO".

   A Stripe PUBLISHABLE key cannot charge a card. It tokenises one. The charge
   happens at /v1/subscribe, on the server. openPaymentSheet mounted Stripe
   Elements on the publishable key alone, with no check that a server existed -
   so with a key and no backend the card tab rendered a full card form, took a
   real card number, tokenised it against real Stripe, charged nobody anything,
   skipped the server call because AMV_API.live was false, and finished with
   _setPlan(plan) and "You're now on Pro!".

   Somebody has entered their card and been told they have paid. They have not.
   No money moved, no record exists, and the plan is a local flag that vanishes
   on their next device.

   The PayPal tab, with no backend, was worse, because there the money was real.
   It loaded the PayPal SDK, built the order IN THE BROWSER with the amount read
   out of PLANS - which the payer can edit - captured it in the browser,
   swallowed any capture failure, and granted the plan either way. A customer
   who really paid had no receipt and no entitlement anywhere but that tab; a
   customer who edited the amount got the plan for pennies; and a one-time
   capture was unlocking a MONTHLY plan for ever.

   Forty lines below the card form, _payCard has always got this right:

       // No processor connected - do NOT pretend to charge.

   That is the rule. These cases hold the other two money paths to it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

/* Served as a deployment nobody has connected a backend to, which is the whole
   subject of this file. Clearing the localStorage override is not enough - that
   correctly falls back to the address the build shipped with, so once a real one
   was baked in this suite was testing a live deployment while asserting about a
   dead one. The tag itself is what has to be empty. */
const app = await bootApp({ tab: 'billing', apiBase: '',
                            user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

/* Stripe.js is stood up ONCE, before anything runs, and never fetched.

   Not just for speed. _mountStripe appends the real https://js.stripe.com/v3/
   whenever window.Stripe is absent, and that script can land mid-suite and
   replace a per-case stub - which made the submit case below pass or fail
   depending on how fast the network was that minute. A stub in place before
   the first case cannot be raced, and no payment test should depend on
   reaching Stripe at all. */
await page.evaluate(() => {
  window.__stripeCalls = [];
  window.Stripe = () => ({
    elements: () => ({ create: () => ({ mount(){}, on(){} }) }),
    createPaymentMethod: async () => {
      window.__stripeCalls.push('createPaymentMethod');
      return { paymentMethod: { id: 'pm_123', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } } };
    },
  });
});

/* Put the app in a chosen backend state, then open the payment sheet on a tab
   and report what was actually rendered. */
async function sheet(opts) {
  return page.evaluate(async (o) => {
    saveStr('amv_api_base', o.live ? 'https://backend.example.workers.dev' : '');
    saveStr('amv_stripe_pk', o.pk || '');
    saveStr('amv_pay_cfg', JSON.stringify(o.payCfg || {}));
    if (o.live) { saveStr('amv_api_token', 'tok'); saveStr('amv_token_exp', String(Date.now() + 3e6)); }
    else { saveStr('amv_api_token', ''); }

    openPaymentSheet('pro');
    if (o.method && o.method !== 'card') _payRenderMethod(o.method, 'pro');

    const body = document.getElementById('pay-body');
    return {
      live: !!(window.AMV_API && AMV_API.live),
      text: body ? body.textContent : '',
      hasCardField: !!document.getElementById('stripe-card-element'),
      hasPayPalHost: !!document.getElementById('paypal-buttons'),
      ppDisabled: (() => { const b = document.getElementById('pay-pp'); return b ? b.getAttribute('aria-disabled') : 'no-button'; })(),
      vmDisabled: (() => { const b = document.getElementById('pay-vm'); return b ? b.getAttribute('aria-disabled') : 'no-button'; })(),
      plan: loadStr('amv_plan') || 'free',
    };
  }, opts);
}

section('A publishable key alone does not put a card form on the screen');
{
  /* The exact configuration that used to take a card and charge nothing: a
     real-shaped publishable key, no backend. */
  const r = await sheet({ live: false, pk: 'pk_test_51AbCdEfGhIjKlMnOpQrStUv' });
  ok(r.live === false, 'there is no backend', r.live);
  ok(r.hasCardField === false,
     'no card field is rendered, because nothing here could charge it', r.hasCardField);
  ok(/not connected/i.test(r.text),
     'and the screen says checkout is not connected', r.text.slice(0, 160));
  ok(r.plan === 'free', 'nobody has been given a plan', r.plan);
}

section('With a server behind it, the card form is exactly where it was');
{
  /* The fix must not cost the working path. This is the owner's live
     deployment, and Elements is the best checkout AMV has. */
  const r = await sheet({ live: true, pk: 'pk_test_51AbCdEfGhIjKlMnOpQrStUv' });
  ok(r.live === true, 'the backend is live', r.live);
  ok(r.hasCardField === true,
     'Stripe Elements mounts, so the card never touches AMV', r.hasCardField);
}

section('And a live backend with no key still reaches hosted checkout');
{
  const r = await sheet({ live: true, pk: '' });
  ok(r.hasCardField === false, 'no Elements without a key', r.hasCardField);
  ok(/Pay by card/i.test(r.text),
     'but the hosted card checkout is offered, which does charge', r.text.slice(0, 160));
}

section('The card form refuses to report a payment it could not make');
{
  /* The second lock. Even if this form is reached some other way, the submit
     path must not grant a plan when there was no server to charge the card.
     Driven through the real handler with Stripe.js stubbed, because the point
     is what happens AFTER a token comes back. */
  const r = await page.evaluate(async () => {
    saveStr('amv_api_base', '');
    saveStr('amv_api_token', '');
    saveStr('amv_plan', 'free');
    window.__stripeCalls = [];
    const ovr = document.getElementById('ovr');
    ovr.innerHTML = '<div id="pay-body"><div id="stripe-card-element"></div>' +
                    '<div id="stripe-card-errors"></div>' +
                    '<button id="pay-submit">Pay</button></div>';
    _mountStripe('pk_test_51AbCdEfGhIjKlMnOpQrStUv', 'pro');
    document.getElementById('pay-submit').click();
    await new Promise(r => setTimeout(r, 400));
    return {
      err: (document.getElementById('stripe-card-errors') || {}).textContent || '',
      plan: loadStr('amv_plan') || 'free',
      pm: loadStr('amv_pm_display') || '',
      /* _setPlan writes a transaction marked "paid" into the billing history
         on an upgrade. So the old bug did not just grant the plan - it filed a
         receipt for a charge that never happened. */
      txns: JSON.stringify(load('amv_txns') || {}),
      sheetStillOpen: !!document.getElementById('pay-submit'),
      /* Proof the handler really ran. Without it, a form that failed to mount
         at all would satisfy every assertion below for the wrong reason. */
      tokenised: window.__stripeCalls.includes('createPaymentMethod'),
    };
  });
  ok(r.tokenised === true, 'the card was tokenised, so the submit path really ran', r.tokenised);
  ok(r.plan === 'free', 'no plan is granted', r.plan);
  ok(/NOT been charged/i.test(r.err),
     'and it says the card was not charged, in those words', r.err);
  ok(r.pm === '', 'no card is saved as a payment method either', r.pm);
  ok(!/"status":"paid"/.test(r.txns),
     'and no "paid" line is written into their billing history', r.txns.slice(0, 200));
  ok(r.sheetStillOpen === true,
     'the sheet stays open rather than closing on a success that did not happen', r.sheetStillOpen);
}

section('PayPal with no server does not load an SDK that can take money');
{
  /* The SDK path built and captured the order in the browser. With no server
     to state the amount or confirm the capture, there must be no SDK host to
     render into and no script fetched. */
  const r = await sheet({ live: false, method: 'paypal', payCfg: {} });
  ok(r.hasPayPalHost === false,
     'there is nowhere for the SDK buttons to mount', r.hasPayPalHost);
  const scripts = await page.evaluate(() =>
    [...document.querySelectorAll('script')].filter(s => /paypal\.com\/sdk/.test(s.src)).length);
  ok(scripts === 0, 'and the PayPal SDK was never fetched', scripts);
  ok(/not connected/i.test(r.text),
     'the tab says PayPal is not connected here', r.text.slice(0, 200));
}

section('Its buttons stay reachable and say what is missing');
{
  /* Removing them would leave an empty panel explaining nothing. They are
     aria-disabled rather than disabled, so a keyboard or a screen reader can
     still get to the explanation. */
  const r = await sheet({ live: false, method: 'paypal', payCfg: {} });
  ok(r.ppDisabled === 'true', 'the PayPal button is marked unavailable', r.ppDisabled);
  ok(r.vmDisabled === 'true', 'and the Venmo one', r.vmDisabled);
  const said = await page.evaluate(async () => {
    document.getElementById('pay-pp').click();
    await new Promise(r => setTimeout(r, 250));
    return document.body.textContent;
  });
  ok(/nothing has been charged/i.test(said),
     'pressing it says plainly that nothing was charged', /nothing has been charged/i.test(said));
  const plan = await page.evaluate(() => loadStr('amv_plan') || 'free');
  ok(plan === 'free', 'and no plan appears out of it', plan);
}

section('A hosted PayPal link the operator set is still a real payment');
{
  /* This is the part that must survive. A hosted link is somebody else's
     secure page taking real money - it is the SDK capture that had to go, not
     the operator's own checkout. */
  const r = await sheet({ live: false, method: 'paypal',
                          payCfg: { paypalLink: 'https://www.paypal.com/paypalme/amv/20' } });
  ok(r.ppDisabled === null,
     'with a link the button is live', r.ppDisabled);
  ok(!/not connected/i.test(r.text),
     'and the panel does not claim PayPal is unavailable', r.text.slice(0, 160));
}

section('No JavaScript errors');
{
  ok(errors.length === 0, 'nothing threw while all of that ran', errors);
}

await app.close();
if (report('money-needs-a-server') > 0) process.exitCode = 1;
done();
