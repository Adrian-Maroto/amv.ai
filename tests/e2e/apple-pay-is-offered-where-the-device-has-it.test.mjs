/* THE CARD FIELD IS THE SLOWEST WAY TO PAY ON THE DEVICE MOST PEOPLE USE.

   The card tab mounts a processor-hosted card FIELD: a number, an expiry and a
   CVC, typed on a phone, at the moment somebody has decided to spend money.
   Apple Pay is one authentication and the card details never exist as text.
   Offering the field and not the wallet on a device that has the wallet is a
   purchase lost to typing.

   Two things have to be true for it to be offered honestly.

   It must be asked of the BROWSER. A user-agent guess draws a button that does
   nothing on half the devices it appears on, and a missing button on the rest.

   And it must go where Apple Pay actually works. A Payment Request Button on
   AMV's own domain needs that domain registered with the processor first -
   an owner step whose only symptom, when skipped, is a button that never
   renders. The processor's HOSTED checkout is on their domain, already
   verified, and offers Apple Pay with no configuration. So AMV does not claim
   to take an Apple Pay payment; it takes somebody to the page that does - and
   with the cycle they chose, because a fast path to the wrong charge is not a
   fast path. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'billing', apiBase: '',
                            user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

/* Elements is stubbed before anything runs. _mountStripe fetches the real
   js.stripe.com when window.Stripe is absent, and a script landing mid-suite
   is a race no payment test should have. */
await page.evaluate(() => {
  window.Stripe = () => ({
    elements: () => ({ create: () => ({ mount(){}, on(){} }) }),
    createPaymentMethod: async () => ({ paymentMethod: { id: 'pm_1' } }),
  });
});

/* Render the card tab with the device's Apple Pay capability set to `has`, and
   report what was drawn and where pressing it went. */
async function cardTab(opts) {
  return page.evaluate(async (o) => {
    saveStr('amv_api_base', 'https://backend.example.workers.dev');
    saveStr('amv_api_token', 'tok');
    saveStr('amv_token_exp', String(Date.now() + 3e6));
    saveStr('amv_stripe_pk', 'pk_test_51AbCdEfGhIjKlMnOpQrStUv');

    if (o.has === null) { delete window.ApplePaySession; }
    else { window.ApplePaySession = { canMakePayments: () => { if (o.throws) throw new Error('blocked'); return o.has; } }; }

    window.__ck = [];
    window._preopenPay = () => null;
    window._closePay = () => {};
    window._openExternalPay = (url, plan, kind) => { window.__ck.push({ url, plan, kind }); };
    AMV_API.stripeCheckout = async (plan, email, seats, cycle) => {
      window.__ck.push({ plan, cycle });
      return 'https://checkout.stripe.com/c/pay_test';
    };

    openPaymentSheet(o.plan || 'pro', o.cycle || 'month');
    const btn = document.getElementById('pay-ap');
    const out = {
      offered: !!btn,
      label: btn ? btn.textContent.trim() : '',
      /* The card form must still be there. Apple Pay is an addition, not a
         replacement - a card that is not in a Wallet still has to be usable. */
      card: !!document.getElementById('stripe-card-element'),
      submit: !!document.getElementById('pay-submit'),
      first: !!(btn && document.getElementById('stripe-card-element')
        && btn.compareDocumentPosition(document.getElementById('stripe-card-element'))
           & Node.DOCUMENT_POSITION_FOLLOWING),
      wide: btn ? Math.round(btn.getBoundingClientRect().width) : 0,
      tall: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
    };
    if (btn) { btn.click(); await new Promise(r => setTimeout(r, 200)); }
    out.calls = window.__ck;
    return out;
  }, opts);
}

section('It is offered only where the browser says the device has it');
{
  const yes = await cardTab({ has: true });
  ok(yes.offered, 'a device set up for Apple Pay is offered it', yes.offered);

  const no = await cardTab({ has: false });
  ok(no.offered === false,
     'a device that has the API but is not set up is not', no.offered);

  const absent = await cardTab({ has: null });
  ok(absent.offered === false,
     'and a browser with no Apple Pay at all sees nothing invented for it', absent.offered);

  /* Touching ApplePaySession can throw in an insecure context or a sandboxed
     frame. Taking the payment sheet down with it would be the worst possible
     trade for an optional button. */
  const threw = await cardTab({ has: true, throws: true });
  ok(threw.offered === false, 'a browser that refuses the question is taken at its word', threw.offered);
  ok(threw.card && threw.submit,
     'and the card form is still there, so nothing was lost to asking', threw);
}

section('The card form keeps its place underneath');
{
  const r = await cardTab({ has: true });
  ok(r.card && r.submit, 'the card field and its button are still rendered', r);
  ok(r.first, 'with Apple Pay above it, which is the faster path on a phone', r.first);
  ok(r.wide > 200 && r.tall >= 44,
     'drawn full width and big enough for a thumb', { w: r.wide, h: r.tall });
}

section('Pressing it goes to the checkout that can actually do it');
{
  const r = await cardTab({ has: true });
  const sent = r.calls.find(c => c.cycle !== undefined);
  ok(!!sent && sent.plan === 'pro',
     'the processor-hosted session is requested, for the plan on the sheet', r.calls);
  const opened = r.calls.find(c => c.url);
  ok(opened && /checkout\.stripe\.com/.test(opened.url),
     'and the page opened is the processor’s own, where Apple Pay is already verified', opened);
  ok(opened && opened.kind === 'applepay',
     'recorded as the path it was, not as a card payment', opened);
}

section('A fast path to the wrong charge is not a fast path');
{
  /* The card tab is not offered for a yearly purchase at all - Elements can
     only charge a month - so this is the monthly sheet carrying its cycle
     through, and the guarantee is that Apple Pay never sends a different one
     from the button beside it. */
  const r = await cardTab({ has: true, cycle: 'month' });
  const sent = r.calls.find(c => c.cycle !== undefined);
  ok(sent && sent.cycle === 'month',
     'the cycle on the sheet is the cycle sent', sent);
}

ok(errors.length === 0, 'no console errors', errors);

await app.close();
if (report('apple-pay-is-offered-where-the-device-has-it') > 0) process.exitCode = 1;
done();
