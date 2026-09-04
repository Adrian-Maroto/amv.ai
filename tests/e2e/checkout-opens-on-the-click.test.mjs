/* THE CHECKOUT TAB WAS OPENED AFTER THE AWAIT, SO BROWSERS BLOCKED IT.

   Every payment button was written this way:

       onclick -> await AMV_API.stripeCheckout(...) -> window.open(url)

   A browser only permits window.open while the page still holds "transient
   user activation" from the click. Awaiting a network round trip spends it.
   Safari refuses the result outright, Firefox refuses it by default, and
   Chrome refuses it once the request is slow enough - so the person who
   pressed Pay waits, and then reads "Allow pop-ups to open the secure
   checkout." on the one screen where hesitation costs the sale. Card, Stripe,
   PayPal, Venmo, team seats and marketplace purchases were all affected: every
   way AMV takes money.

   The tab is opened EMPTY during the click now, while the activation is still
   valid, and pointed at the real URL when it arrives. The test is about
   ORDERING, because that is the whole bug: open must happen before the promise
   settles, not after. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const app = await bootApp({ tab: 'plans', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

/* Record the order of events: when the tab was opened, and when the network
   call that produces the URL resolved. A slow resolve makes the difference
   unmistakable - and mirrors the real world, where the round trip is what
   spends the activation. */
async function trace(run) {
  return page.evaluate(async ({ run }) => {
    const order = [];
    const realOpen = window.open, realToast = window.toast;
    const realCheckout = AMV_API.stripeCheckout, realSub = AMV_API.paypalSubscribe;
    const realLive = AMV_API.live, realBase = AMV_API.base, realTok = AMV_API.token;
    const opened = [];
    window.toast = () => {};
    AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 't';
    try { AMV_API.live = true; } catch (e) {}
    window.open = (url) => {
      order.push('open:' + (url || '(blank)'));
      const w = { closed: false, opener: {}, location: { replace(u) { opened.push(u); } },
                  document: { write() {} }, close() { this.closed = true; } };
      return w;
    };
    const slow = async () => {
      await new Promise(r => setTimeout(r, 120));
      order.push('resolved');
      return 'https://checkout.stripe.test/session';
    };
    AMV_API.stripeCheckout = slow;
    AMV_API.paypalSubscribe = slow;

    await (new Function('return (' + run + ')'))()();
    await new Promise(r => setTimeout(r, 400));

    window.open = realOpen; window.toast = realToast;
    AMV_API.stripeCheckout = realCheckout; AMV_API.paypalSubscribe = realSub;
    try { AMV_API.live = realLive; } catch (e) {}
    AMV_API.base = realBase; AMV_API.token = realTok;
    return { order, opened };
  }, { run: run.toString() });
}

section('The card button opens its tab before the request comes back');
{
  const r = await trace(async () => {
    openPaymentSheet('pro');
    await new Promise(r => setTimeout(r, 150));
    const b = document.getElementById('pay-card-go') || document.getElementById('pay-submit');
    if (b) b.click();
  });
  const openAt = r.order.findIndex(x => x.startsWith('open:'));
  const doneAt = r.order.indexOf('resolved');
  ok(openAt >= 0, 'a tab was opened', r.order);
  ok(doneAt >= 0, 'and the request did resolve', r.order);
  ok(openAt < doneAt,
     'the tab is opened first, while the click still counts', r.order);
  ok(r.opened.some(u => /checkout\.stripe\.test/.test(u)),
     'and it is then pointed at the real checkout', r.opened);
}

section('So does the Stripe tab');
{
  const r = await trace(async () => {
    openPaymentSheet('pro');
    await new Promise(r => setTimeout(r, 150));
    const t = [...document.querySelectorAll('.pay-tab')].find(x => x.dataset.pt === 'stripe');
    if (t) t.click();
    await new Promise(r => setTimeout(r, 120));
    const b = document.getElementById('pay-stripe-go');
    if (b) b.click();
  });
  const openAt = r.order.findIndex(x => x.startsWith('open:'));
  const doneAt = r.order.indexOf('resolved');
  ok(openAt >= 0 && doneAt >= 0 && openAt < doneAt,
     'opened on the click, navigated after', r.order);
}

section('And PayPal');
{
  const r = await trace(async () => {
    openPaymentSheet('pro');
    await new Promise(r => setTimeout(r, 150));
    const t = [...document.querySelectorAll('.pay-tab')].find(x => x.dataset.pt === 'paypal');
    if (t) t.click();
    await new Promise(r => setTimeout(r, 120));
    const b = document.getElementById('pay-pp-sub');
    if (b) b.click();
  });
  const openAt = r.order.findIndex(x => x.startsWith('open:'));
  const doneAt = r.order.indexOf('resolved');
  ok(openAt >= 0 && doneAt >= 0 && openAt < doneAt,
     'opened on the click, navigated after', r.order);
}

section('A failed request does not leave a tab saying "Opening…"');
{
  const r = await page.evaluate(async () => {
    const realOpen = window.open, realToast = window.toast, realCheckout = AMV_API.stripeCheckout;
    const realLive = AMV_API.live, realBase = AMV_API.base, realTok = AMV_API.token;
    let closed = false;
    window.toast = () => {};
    /* base and token as well as live: the card tab picks its branch from
       whether a backend is reachable, and without them it renders the
       "not connected yet" panel, whose button has a different id. Setting only
       `live` made this section test a screen that was not the one under test. */
    AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 't';
    try { AMV_API.live = true; } catch (e) {}
    window.open = () => ({ closed: false, opener: {}, location: { replace() {} },
                           document: { write() {} }, close() { closed = true; } });
    AMV_API.stripeCheckout = async () => { throw new Error('stripe is down'); };
    openPaymentSheet('pro');
    await new Promise(r => setTimeout(r, 150));
    const b = document.getElementById('pay-card-go');
    if (b) b.click();
    await new Promise(r => setTimeout(r, 300));
    window.open = realOpen; window.toast = realToast;
    AMV_API.stripeCheckout = realCheckout;
    AMV_API.base = realBase; AMV_API.token = realTok;
    try { AMV_API.live = realLive; } catch (e) {}
    return { closed, hadButton: !!b };
  });
  ok(r.hadButton, 'the card button was there', r.hadButton);
  ok(r.closed, 'the placeholder is closed again', r.closed);
}

section('Every money button pre-opens, not just the ones tested above');
{
  /* The property. Team seats and marketplace purchases go through the same
     shape and were affected identically - a check on three buttons would leave
     the largest sale AMV makes uncovered. */
  const files = ['09-checkout-plans.js', '06-team-market.js', '07-workspace-memory.js',
                 '08-admin-fraud.js', '22-finance.js'];
  const bad = [];
  for (const f of files) {
    const s = readFileSync(join(ROOT, 'src', 'app', f), 'utf8');
    /* An _openExternalPay reached after an await must carry a pre-opened tab.
       Static links opened straight from the click do not need one. */
    s.split('\n').forEach((l, i) => {
      if (!/_openExternalPay\(/.test(l)) return;
      if (/function _openExternalPay/.test(l)) return;
      const awaited = /await /.test(l);
      const carries = /,\s*pre\)/.test(l);
      if (awaited && !carries) bad.push(`${f}:${i + 1}  ${l.trim().slice(0, 90)}`);
    });
  }
  ok(bad.length === 0,
     'no payment opened after an await goes without a pre-opened tab', bad);
}

section('And nothing else opens a window after an await');
{
  /* The property beyond payments. The same rule governs the billing portal -
     where a paying customer changes their card or cancels - and connecting a
     bank. A blocked cancel button is the shortest path there is to a
     chargeback, which costs more than the subscription it ends.

     Finding the enclosing FUNCTION matters, and getting it wrong is why the
     first version of this check passed over a deliberately broken billing
     portal: the open sits inside an `if`, and the await is a level or two
     above it, so stopping at the nearest block finds nothing. Comments are
     stripped first, because the note explaining all this quotes the very call
     it is looking for. */
  const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
                        .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p);
  const lateOpens = (raw) => {
    const src = strip(raw); const out = [];
    let i = -1;
    while ((i = src.indexOf('window.open(', i + 1)) >= 0) {
      let k = i, guard = 0, found = false;
      while (k > 0 && guard++ < 40) {
        let d = 0, j = k;
        while (j > 0) {
          const c = src[j];
          if (c === '}') d++;
          else if (c === '{') { if (d === 0) break; d--; }
          j--;
        }
        if (j <= 0) break;
        if (/\bawait\s/.test(src.slice(j, i))) { found = true; break; }
        const head = src.slice(Math.max(0, j - 60), j);
        if (/=>\s*$|function[^{]*\)\s*$|\)\s*$/.test(head) && /=>|function/.test(head)) break;
        k = j - 1;
      }
      if (found) out.push(src.slice(0, i).split('\n').length);
    }
    return out;
  };
  const bad = [];
  for (const f of ['06-team-market.js', '08-admin-fraud.js', '22-finance.js',
                   '09-checkout-plans.js', '07-workspace-memory.js', '03-sessions.js',
                   '12-handoff.js', '11-design-code.js']) {
    const lines = lateOpens(readFileSync(join(ROOT, 'src', 'app', f), 'utf8'));
    lines.forEach(n => bad.push(`${f}:${n}`));
  }
  ok(bad.length === 0,
     'every window opened from a handler is opened before its await', bad);
}

section('The pre-opened tab cannot reach back into AMV');
{
  /* window.open with 'noopener' is not available for a tab we navigate
     ourselves, so the reference is cut by hand instead. */
  const src = readFileSync(join(ROOT, 'src', 'app', '09-checkout-plans.js'), 'utf8');
  const at = src.indexOf('function _preopenPay');
  const body = src.slice(at, at + 900);
  ok(at > 0, 'the opener was located', at > 0);
  ok(/w\.opener\s*=\s*null/.test(body), 'the opener reference is cleared', true);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('checkout-opens-on-the-click') > 0) process.exitCode = 1;
done();
