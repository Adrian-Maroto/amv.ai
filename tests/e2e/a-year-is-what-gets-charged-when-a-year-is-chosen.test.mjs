/* A TOGGLE THAT DOES NOT REACH THE CHARGE IS A LIE WITH A NICE SHAPE.

   The plan page now offers Monthly or Yearly. The only thing that decides what
   somebody is actually billed is the price id the SERVER picks, and it picks it
   from one field - `cycle` - on the call that creates the checkout session. So
   the choice has to survive four hops: the plan page, openCheckout, the payment
   sheet, the method panel, and only then AMV_API.stripeCheckout. Drop it at any
   one of them and the page says Yearly while the card is charged a month, which
   is the single worst thing a payment screen can do quietly.

   This file follows the value the whole way and asserts on what leaves for the
   server, not on what the buttons look like.

   It also holds the three paths that CANNOT take a yearly payment to saying so
   rather than silently taking a monthly one instead:

     - Stripe Elements charges through /v1/subscribe, which knows one price per
       plan. A yearly buyer must not be sent down it.
     - A hosted Payment Link is one price object, and AMV only ever holds the
       monthly one.
     - A PayPal subscription is its own plan id on PayPal's side, and there is
       one per plan - the monthly one.

   Each of those, offered to somebody who pressed Yearly, is a month's charge
   under a yearly label. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'billing', apiBase: '',
                            user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

const BACKEND = 'https://backend.example.workers.dev';

/* WHAT THE SERVER SAYS IS WHAT THE PAGE OFFERS.

   `_yearlyAvailable` could have been stubbed, but then this would be testing a
   stub: the defect worth catching is public config's `yearlyPlans` not reaching
   the page at all, and a stub hides exactly that. So the real endpoint is
   answered and the real reader runs. Booting with no address means the boot
   attempt returned before any request, which is what leaves the loader free to
   run once here against a route that exists. */
await page.route('**/v1/public-config', route => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ ok: true, yearlyPlans: ['pro', 'elite'] }),
}));

await page.evaluate(async (base) => {
  saveStr('amv_api_base', base);
  saveStr('amv_api_token', 'tok');
  saveStr('amv_token_exp', String(Date.now() + 3e6));
  await _loadPublicConfig();
}, BACKEND);

section('The choice is offered only where the operator actually priced it');
{
  const r = await page.evaluate(() => ({
    live: !!(window.AMV_API && AMV_API.live),
    pro: _yearlyAvailable('pro'),
    elite: _yearlyAvailable('elite'),
    ultra: _yearlyAvailable('ultra'),
  }));
  ok(r.live === true, 'the deployment has a backend', r.live);
  ok(r.pro === true && r.elite === true,
     'the two plans public config listed can be bought by the year', r);
  ok(r.ultra === false,
     'and a plan it did not list cannot, so nothing is offered that checkout would refuse', r.ultra);
}

/* Render a plan's page and report the cycle control on it. */
const upgrade = (plan) => page.evaluate((pl) => {
  openUpgrade(pl, 'billing');
  const btns = [...document.querySelectorAll('.upg-cyc')];
  return {
    tab: S.tab,
    count: btns.length,
    labels: btns.map(b => b.textContent.trim()),
    pressed: btns.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.cyc),
    note: (document.querySelector('.upg-cyc-n') || {}).textContent || '',
    /* A group of related controls has to be announced as one, or a screen
       reader reads two unrelated buttons. */
    grouped: !!document.querySelector('.upg-cycle[role="group"][aria-label]'),
  };
}, plan);

section('It is drawn as one choice, with monthly already made');
{
  const r = await upgrade('pro');
  ok(r.tab === 'upgrade', 'the plan page opened', r.tab);
  ok(r.count === 2, 'two choices, not a list', r.labels);
  ok(r.pressed.length === 1 && r.pressed[0] === 'month',
     'monthly is the one already chosen, so nobody is upsold by default', r.pressed);
  /* AMV does not know the yearly figure - the operator set it in Stripe - so
     the page must say where the number comes from rather than invent one. */
  ok(/checkout/i.test(r.note),
     'and the page says the yearly price comes from checkout', r.note);
  ok(r.grouped, 'the pair is announced as one control', r.grouped);

  const none = await upgrade('ultra');
  ok(none.count === 0,
     'a plan with no yearly price shows no toggle at all', none.count);
}

/* Follow a purchase all the way to the call that leaves for the server, with
   every window-opening step replaced so nothing is actually launched. The
   stripeCheckout stub is the measuring point: whatever it receives is what the
   server would have been asked for. */
async function buys(opts) {
  return page.evaluate(async (o) => {
    saveStr('amv_stripe_pk', o.pk || '');
    saveStr('amv_pay_links', JSON.stringify(o.links || {}));
    window.__ck = [];
    window._preopenPay = () => null;
    window._closePay = () => {};
    window._openExternalPay = (url, plan, kind) => { window.__ck.push({ opened: url, plan, kind }); };
    AMV_API.stripeCheckout = async (plan, email, seats, cycle) => {
      window.__ck.push({ plan, email, seats, cycle });
      return 'https://checkout.stripe.com/c/pay_test';
    };

    openUpgrade(o.plan, 'billing');
    if (o.cycle === 'year') {
      const y = document.querySelector('.upg-cyc[data-cyc="year"]');
      if (!y) return { noToggle: true };
      y.click();
    }
    document.getElementById('upg-pay').click();
    await new Promise(r => setTimeout(r, 120));

    const tabs = [...document.querySelectorAll('.pay-tab')].map(t => t.dataset.pt);
    const amount = (document.querySelector('.pay-amount') || {}).textContent || '';
    const elements = !!document.getElementById('stripe-card-element');
    const go = document.getElementById('pay-card-go') || document.getElementById('pay-submit');
    if (go) go.click();
    await new Promise(r => setTimeout(r, 180));

    return { calls: window.__ck, tabs, amount, elements, sheet: !!document.querySelector('.pay-modal') };
  }, opts);
}

section('Choosing Yearly is what the server is asked for');
{
  const r = await buys({ plan: 'pro', cycle: 'year' });
  ok(!r.noToggle && r.sheet, 'pressing Proceed to payment opens the sheet', r);
  const sent = r.calls.find(c => c.cycle !== undefined);
  ok(!!sent, 'a checkout session is requested', r.calls);
  ok(sent && sent.cycle === 'year',
     'and it asks for the YEAR, which is the field the price id is chosen from', sent);
  ok(sent && sent.plan === 'pro', 'for the plan that was on the screen', sent);
  /* Multiplying the monthly price by twelve would state a figure nobody agreed
     to, which checkout would then contradict on the very next screen. */
  ok(!/\$/.test(r.amount) && /year/i.test(r.amount),
     'the sheet names the cycle and invents no yearly figure', r.amount);
}

section('And Monthly still is, which is the path that must not have broken');
{
  const r = await buys({ plan: 'pro', cycle: 'month' });
  const sent = r.calls.find(c => c.cycle !== undefined);
  ok(sent && sent.cycle === 'month', 'a monthly purchase asks for the month', sent);
  ok(/\$/.test(r.amount), 'and the sheet shows the price AMV does know', r.amount);
}

section('A yearly buyer is not quietly handed a monthly path instead');
{
  /* Elements takes a card and charges it through /v1/subscribe, which has one
     price per plan. With a publishable key set this used to be the card tab. */
  const y = await buys({ plan: 'pro', cycle: 'year', pk: 'pk_test_51AbCdEfGhIjKlMnOpQrStUv' });
  ok(y.elements === false,
     'the card form that can only charge a month is not rendered', y.elements);
  const sent = y.calls.find(c => c.cycle !== undefined);
  ok(sent && sent.cycle === 'year',
     'the hosted checkout takes it instead, still by the year', sent);

  const m = await buys({ plan: 'pro', cycle: 'month', pk: 'pk_test_51AbCdEfGhIjKlMnOpQrStUv' });
  ok(m.elements === true,
     'while a monthly purchase still gets Elements, so the best path was not lost', m.elements);
}

section('PayPal is not offered for a year it cannot bill');
{
  const y = await buys({ plan: 'pro', cycle: 'year' });
  ok(y.tabs.indexOf('paypal') === -1,
     'the tab is absent rather than set up a monthly agreement under a yearly label', y.tabs);

  const m = await buys({ plan: 'pro', cycle: 'month' });
  ok(m.tabs.indexOf('paypal') >= 0, 'and it is still there for a monthly purchase', m.tabs);

  /* Reached by name, past the tabs, it refuses on its own. */
  const direct = await page.evaluate(async () => {
    _payRenderMethod('paypal', 'pro', 'year');
    const body = document.getElementById('pay-body');
    return { text: body ? body.textContent : '', subscribeBtn: !!document.getElementById('pay-pp-sub') };
  });
  ok(direct.subscribeBtn === false && /yearly/i.test(direct.text),
     'and says why, rather than presenting a button that would bill a month', direct);
}

section('A fixed-price payment link is not the path for a yearly purchase');
{
  /* THE ONE THAT IS REACHABLE ON A LIVE DEPLOYMENT.

     `S.sp` / `S.se` are payment links the operator pastes into Settings, and
     the plan page prefers them over server-side checkout when they are set -
     deliberately, because a configured link is the operator's chosen path. A
     Payment Link is ONE price object and AMV only ever holds the monthly one,
     so preferring it for somebody who pressed Yearly charges a month under a
     yearly label. This is not a hypothetical branch: a live backend and a
     pasted Pro link is an ordinary configuration.

     Measured by what window.open receives, because that is the hop the link
     path ends at and the server call never happens on it. */
  const r = await page.evaluate(async () => {
    window.__ck = []; window.__opened = [];
    window._preopenPay = () => null;
    window._closePay = () => {};
    window._openExternalPay = () => {};
    const realOpen = window.open;
    window.open = (u) => { window.__opened.push(String(u)); return null; };
    AMV_API.stripeCheckout = async (plan, email, seats, cycle) => {
      window.__ck.push({ plan, cycle });
      return 'https://checkout.stripe.com/c/pay_test';
    };
    S.sp = 'https://buy.stripe.com/test_monthly';

    /* The link path opens a window and stops; the server path opens the sheet
       and asks on the next press. Doing both is what tells them apart. */
    const press = async () => {
      document.getElementById('upg-pay').click();
      await new Promise(r => setTimeout(r, 160));
      const go = document.getElementById('pay-card-go') || document.getElementById('pay-submit');
      if (go) go.click();
      await new Promise(r => setTimeout(r, 180));
    };

    openUpgrade('pro', 'billing');
    document.querySelector('.upg-cyc[data-cyc="year"]').click();
    await press();
    const year = { opened: window.__opened.slice(), calls: window.__ck.slice() };

    window.__ck = []; window.__opened = [];
    openUpgrade('pro', 'billing');
    await press();
    const month = { opened: window.__opened.slice(), calls: window.__ck.slice() };

    window.open = realOpen; S.sp = '';
    return { year, month };
  });
  ok(!r.year.opened.some(u => /buy\.stripe\.com/.test(u)),
     'the operator\u2019s monthly link is not opened for a yearly purchase', r.year.opened);
  ok(r.year.calls.some(c => c.cycle === 'year'),
     'the server-side session, which is told the cycle, is taken instead', r.year.calls);
  /* And the operator's chosen path is still the path when it can do the job. */
  ok(r.month.opened.some(u => /buy\.stripe\.com/.test(u)),
     'while a monthly purchase still goes to the link they configured', r.month.opened);
}

ok(errors.length === 0, 'no console errors', errors);

await app.close();
if (report('a-year-is-what-gets-charged-when-a-year-is-chosen') > 0) process.exitCode = 1;
done();
