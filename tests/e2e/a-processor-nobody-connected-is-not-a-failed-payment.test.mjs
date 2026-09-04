/* PRESSING UPGRADE ON A DEPLOYMENT WITH NO STRIPE KEY SAID "payments not
   configured".

   Three faults met on the one screen that takes money.

   The server said it. /v1/stripe/checkout, the billing portal, the PayPal
   subscribe route and the marketplace buy route all answered
   `json({error:'payments not configured'}, 503)` - no code, and a phrase
   written for whoever deployed it rather than for whoever pressed the button.
   The subscribe route a few hundred lines away already did this properly, with
   a sentence and `code:'needs_service'`, so the standard existed and four
   routes had not been brought to it.

   The client rendered it raw. A rejected checkout goes to
   `toast('Card: ' + e.message)`, so the person saw a red error toast reading
   "Card: payments not configured" - which says they did something wrong, on a
   screen where they did not, about a thing they cannot fix.

   And the panel that says this properly was unstyled. The markup for "Secure
   checkout is not connected yet" already existed for the NO-BACKEND case, but
   .pay-setup, .pay-setup-t and .pay-setup-s had no CSS rule at all - the title
   measured 14px at weight 400, the same as body text - and neither did
   .pay-body, the container every payment method renders into.

   A processor nobody has connected is not a failed payment. Nothing was
   attempted, nothing was charged, and there is nothing to retry. So it is
   stated in the sheet, in AMV's own panel, and a REAL failure still gets the
   toast - which is the line this suite exists to hold. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = await bootApp({ tab: 'plans', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

/* Drives the real card button with a stubbed API, and reports what the person
   is left looking at. `code` null means an ordinary failure. */
const press = (code, message) => page.evaluate(async ({ code, message }) => {
  const realOpen = window.open, realToast = window.toast, realCheckout = AMV_API.stripeCheckout;
  const realLive = AMV_API.live, realBase = AMV_API.base, realTok = AMV_API.token;
  const toasts = [];
  window.toast = (m, kind) => { toasts.push({ m: String(m), kind: String(kind || '') }); };
  window.open = () => ({ closed:false, opener:{}, location:{ replace(){} },
                         document:{ write(){} }, close(){} });
  AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 't';
  try { AMV_API.live = true; } catch (e) {}
  AMV_API.stripeCheckout = async () => {
    const e = new Error(message); if (code) e.code = code; throw e;
  };
  openPaymentSheet('pro');
  await new Promise(r => setTimeout(r, 150));
  const btn = document.getElementById('pay-card-go');
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 300));

  const panel = document.querySelector('.pay-setup');
  const title = document.querySelector('.pay-setup-t');
  const sub   = document.querySelector('.pay-setup-s');
  const num = x => parseFloat(x) || 0;
  const out = {
    hadButton: !!btn, toasts,
    panelText: panel ? panel.textContent : '',
    style: null,
  };
  if (panel && title && sub) {
    const ps = getComputedStyle(panel), ts = getComputedStyle(title), ss = getComputedStyle(sub);
    out.style = {
      panelFramed: num(ps.borderTopWidth) > 0 || ps.backgroundColor !== 'rgba(0, 0, 0, 0)',
      panelPad: num(ps.paddingTop),
      titleSize: num(ts.fontSize), titleWeight: num(ts.fontWeight),
      subSize: num(ss.fontSize), subMuted: ss.color !== ts.color,
      bodyW: Math.round(document.getElementById('pay-body').getBoundingClientRect().width),
    };
  }
  window.open = realOpen; window.toast = realToast;
  AMV_API.stripeCheckout = realCheckout;
  AMV_API.base = realBase; AMV_API.token = realTok;
  try { AMV_API.live = realLive; } catch (e) {}
  try { closePaySheet(); } catch (e) {}
  return out;
}, { code, message });

section('A deployment with no processor is answered in the sheet, not in an error toast');
{
  const r = await press('needs_service',
    'Payments are not connected on this deployment yet, so checkout cannot open. Nothing has been charged.');
  ok(r.hadButton, 'the card button is the one under test', r.hadButton);
  ok(r.toasts.length === 0, 'nothing is thrown at them in an error colour',
     r.toasts.map(t => t.kind + ':' + t.m).join(' | '));
  ok(/not connected/i.test(r.panelText), 'the sheet says the processor is not connected',
     r.panelText.slice(0, 70));
  ok(/nothing has been charged/i.test(r.panelText),
     'and says the thing somebody actually wants to know', true);
}

section('And that panel is designed, which is what it was missing');
{
  const r = await press('needs_service', 'Payments are not connected on this deployment yet.');
  ok(!!r.style, 'the panel rendered', !!r.style);
  ok(r.style.panelFramed && r.style.panelPad > 0,
     'it is a surface with padding rather than loose text in the sheet',
     'framed:' + r.style.panelFramed + ' pad:' + r.style.panelPad);
  ok(r.style.titleWeight >= 600 && r.style.titleSize > r.style.subSize,
     'its title reads as a title, not as another line of body copy',
     r.style.titleSize + '/' + r.style.titleWeight + ' vs sub ' + r.style.subSize);
  ok(r.style.subMuted, 'and the explanation is subordinate to it', r.style.subMuted);
  ok(r.style.bodyW > 0, 'the sheet body it sits in has a width of its own', r.style.bodyW);
}

section('A real failure is still a failure, and still says so');
{
  /* The line this holds. Declines, dropped networks and accounts on hold ARE
     the person's business to retry, and quietly swallowing them into a calm
     panel would be the opposite mistake to the one being fixed. */
  const r = await press(null, 'stripe is down');
  ok(r.toasts.length > 0, 'it is toasted', r.toasts.length);
  ok(r.toasts.some(t => t.kind === 'error'), 'in the error colour', r.toasts.map(t => t.kind));
  ok(r.toasts.some(t => /stripe is down/.test(t.m)), 'naming what went wrong',
     r.toasts.map(t => t.m).join(' | '));
  ok(!/not connected/i.test(r.panelText),
     'and it does NOT get the calm not-connected panel', r.panelText.slice(0, 60));
}

section('No money route still answers with a phrase written for a deploy log');
{
  /* The property rather than the four instances: every 503 on a route that
     takes money has to carry a sentence and a code the sheet can route. */
  const w = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
  const code = w.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  /* The defect was a lowercase FRAGMENT where a sentence belongs - 'payments
     not configured'. The subscribe route's 'Payments are not configured on this
     deployment.' is the same fact said properly and must keep passing, so the
     test is the shape of the string, not the words in it: no capital at the
     front and no stop at the end is a log line, whoever wrote it. */
  const terse = [...code.matchAll(/error:\s*'([^']*not configured[^']*)'/g)]
                  .map(m => m[1])
                  .filter(t => !/^[A-Z]/.test(t) || !/[.!?]$/.test(t));
  ok(terse.length === 0,
     'no money route answers with a fragment instead of a sentence', terse.join(' | '));

  const noCode = [];
  for (const m of code.matchAll(/return json\(\{([^}]*not connected on this deployment[^}]*)\}/gi))
    if (!/code:\s*'needs_service'/.test(m[1])) noCode.push(m[1].slice(0, 60));
  ok(noCode.length === 0, 'and each carries needs_service, so the sheet can route it', noCode.join(' | '));
}

ok(errors.length === 0, 'no console errors', errors.slice(0, 3));
if (report('a-processor-nobody-connected-is-not-a-failed-payment') > 0) process.exitCode = 1;
done();
await app.close();
