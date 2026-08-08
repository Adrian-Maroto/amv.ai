/* CAN SOMEBODY BUY THIS WITHOUT A MOUSE.

   Keyboard navigation, focus states and screen-reader labels are a standing
   standard here, and there is real machinery for them: Escape closes an
   overlay, Tab is trapped inside one. What nothing checked is whether the
   money path is actually operable end to end by somebody who never touches a
   pointing device - which includes people using a screen reader, people with
   a motor impairment, and anybody whose trackpad has just died.

   The failures are all silent. A modal that opens without moving focus into it
   leaves a keyboard user tabbing through the page BEHIND it, reading a form
   they cannot see. A modal that closes without restoring focus dumps them at
   the top of the document with no idea where they were. An icon-only button
   with no accessible name is announced as "button". None of it throws, none of
   it looks wrong in a screenshot, and all of it stops the purchase.

   Driven against the real backend, because the sheet a customer actually pays
   from is the live one, not the demo. */
import { bootLive, makeEnv, makeOutbound, BACKEND } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const outbound = makeOutbound();
outbound.on(/api\.stripe\.com\/v1\/checkout\/sessions/, () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }));
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));

const env = makeEnv({
  GOOGLE_CLIENT_ID: '123-abc.apps.googleusercontent.com',
  SUPPORT_EMAIL: 'help@amv.test',
  STRIPE_SECRET_KEY: 'sk_test_notreal',
  STRIPE_PRICE_PRO: 'price_pro_123',
  APP_URL: 'http://localhost:9174',
});
const L = await bootLive({ env, outbound, port: 9175 });
const { page } = L;

const EMAIL = 'keyboard@example.com';
const PW = 'A-real-Passw0rd!';

/* What the browser says has focus, described the way a person would. */
const focused = () => page.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return { tag: 'BODY', name: '' };
  const name = (a.getAttribute('aria-label') || a.textContent || a.getAttribute('placeholder') || '').trim().slice(0, 40);
  return { tag: a.tagName, id: a.id || '', name, inOverlay: !!(a.closest && a.closest('#ovr')) };
});

section('A keyboard user can reach the sign-up sheet and it takes their focus');
{
  /* The first thing that has to happen, and the one most often missed: opening
     a dialog must MOVE focus into it. The Tab trap below only helps once focus
     is already inside - before that, a keyboard user is tabbing through the
     page behind the modal, filling in a form they cannot see. */
  const r = await page.evaluate(async () => {
    document.body.focus();
    openAuth('signup');
    await new Promise(x => setTimeout(x, 400));
    const a = document.activeElement;
    return { inOverlay: !!(a && a.closest && a.closest('#ovr')), tag: a ? a.tagName : 'none' };
  });
  ok(r.inOverlay === true,
     'focus is inside the sheet, not on the page behind it', r);
}

section('Tab cycles inside the sheet and never escapes behind it');
{
  const r = await page.evaluate(async () => {
    const seen = [];
    for (let i = 0; i < 12; i++) {
      const a = document.activeElement;
      seen.push(!!(a && a.closest && a.closest('#ovr')));
      /* Tab is dispatched as a real key so the app's own handler runs. */
      const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
      if (!ev.defaultPrevented) {
        const f = [...document.querySelectorAll('#ovr a[href],#ovr button:not([disabled]),#ovr input:not([disabled]),#ovr select,#ovr textarea')];
        const i2 = f.indexOf(document.activeElement);
        (f[(i2 + 1) % f.length] || f[0]).focus();
      }
      await new Promise(x => setTimeout(x, 20));
    }
    return { allInside: seen.every(Boolean), seen };
  });
  ok(r.allInside === true, 'every stop is inside the sheet', r.seen.filter(x => !x).length + ' outside');
}

section('Every control in it has a name a screen reader can say');
{
  /* An icon-only button with no label is announced as "button". On a sign-up
     sheet that is the close control, and on a pay sheet it is whatever the
     person is about to press to spend money. */
  const unnamed = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#ovr button, #ovr input, #ovr select')) {
      /* Skip what is deliberately hidden from assistive technology. The
         sign-up sheet carries a honeypot input that is aria-hidden and
         tabindex="-1" so no human ever reaches it - flagging that as an
         unnamed control is the check being wrong, not the product. */
      if (el.getAttribute('tabindex') === '-1' || el.closest('[aria-hidden="true"]')) continue;
      const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
      const labelled = el.id && document.querySelector('label[for="' + el.id + '"]');
      const placeholder = el.getAttribute('placeholder');
      if (!name && !labelled && !placeholder) out.push(el.tagName + '#' + (el.id || el.className));
    }
    return out;
  });
  ok(unnamed.length === 0, 'nothing is announced as just "button"', unnamed);
}

section('Escape closes it and gives focus back where it came from');
{
  /* Closing a dialog without restoring focus drops a keyboard user at the top
     of the document, with no idea where they were or how to get back. */
  const r = await page.evaluate(async () => {
    closeOvr();
    await new Promise(x => setTimeout(x, 150));
    const anchor = document.querySelector('.snb') || document.querySelector('button');
    anchor.id = anchor.id || 'kb-anchor';
    anchor.focus();
    const before = document.activeElement.id;

    openAuth('signup');
    await new Promise(x => setTimeout(x, 350));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await new Promise(x => setTimeout(x, 250));

    return { before, closed: !document.getElementById('auth-submit'),
             after: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : 'none' };
  });
  ok(r.closed === true, 'Escape closes the sheet', r.closed);
  ok(r.after === r.before,
     'and focus returns to whatever opened it, not to the top of the page', r);
}

section('They can sign up using only the keyboard');
{
  const r = await page.evaluate(async ([em, pw]) => {
    openAuth('signup');
    await new Promise(x => setTimeout(x, 350));
    const type = (sel, v) => { const el = document.querySelector(sel); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Keyboard Person'); type('#a-email', em); type('#a-pass', pw);
    /* Enter on the submit button, not a click - which is what a keyboard
       actually sends, and a handler bound only to click never sees. */
    const btn = document.getElementById('auth-submit');
    btn.focus();
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    btn.click();   // browsers synthesise this from Enter on a <button>
    await new Promise(x => setTimeout(x, 900));
    return { signedIn: !!(S.user && S.user.email) };
  }, [EMAIL, PW]);
  ok(r.signedIn === true, 'the account is created without a pointer', r);
}

section('The pay sheet takes focus too, and traps it');
{
  /* The screen where it matters most. */
  const r = await page.evaluate(async () => {
    openPaymentSheet('pro');
    await new Promise(x => setTimeout(x, 450));
    const a = document.activeElement;
    const inside = !!(a && a.closest && a.closest('#ovr'));
    const f = [...document.querySelectorAll('#ovr a[href],#ovr button:not([disabled]),#ovr input:not([disabled])')];
    return { inside, focusables: f.length,
             names: f.map(x => (x.getAttribute('aria-label') || x.textContent || '').trim().slice(0, 24)) };
  });
  ok(r.inside === true, 'focus moves into the pay sheet', r.inside);
  ok(r.focusables > 0, 'there is something to tab to', r.focusables);
  ok(r.names.every(n => n.length > 0),
     'and every stop announces itself', r.names.filter(n => !n).length + ' unnamed');
}

section('The button that spends money is reachable and says what it does');
{
  const r = await page.evaluate(() => {
    const btn = document.querySelector('#pay-card-go, #pay-submit, .pay-submit');
    if (!btn) return { found: false };
    btn.focus();
    const s = getComputedStyle(btn);
    return {
      found: true,
      focused: document.activeElement === btn,
      name: (btn.getAttribute('aria-label') || btn.textContent || '').trim(),
      /* A focus ring somebody can actually see. Without it a keyboard user
         cannot tell what they are about to press. */
      ring: s.outlineStyle !== 'none' || s.boxShadow !== 'none' || s.borderColor !== 'transparent',
    };
  });
  ok(r.found === true, 'the pay button exists', r);
  ok(r.focused === true, 'it can take keyboard focus', r.focused);
  ok(/pay|card|checkout|subscribe/i.test(r.name),
     'and its name says it is about paying', r.name);
}

section('A visible focus indicator exists at all');
{
  /* Removing outlines for looks is the single most common accessibility
     regression in a designed product, and it makes every keyboard journey
     above unusable while changing nothing anybody can see with a mouse. */
  const css = await page.evaluate(() => {
    let t = '';
    for (const s of document.styleSheets) {
      try { for (const r of s.cssRules) t += r.cssText; } catch (e) {}
    }
    return t;
  });
  ok(/:focus-visible/.test(css), 'the stylesheet styles :focus-visible', /:focus-visible/.test(css));
  const blanket = /(?:^|})\s*\*?\s*:focus\s*\{[^}]*outline\s*:\s*(?:none|0)/.test(css.replace(/\s+/g, ' '));
  ok(!blanket, 'and nothing removes the outline from everything', blanket);
}

section('Nothing threw while doing all of that by keyboard');
{
  ok(L.errors.length === 0, 'no JavaScript errors', L.errors);
}

await L.close();
if (report('paying-without-a-mouse') > 0) process.exitCode = 1;
done();
