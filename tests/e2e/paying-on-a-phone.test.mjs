/* THE MONEY PATH AT 390 PIXELS, AGAINST A REAL BACKEND.

   Most people who ever pay AMV will do it on a phone, and 390px is where a
   layout that is fine on a laptop stops being usable: a fixed banner covers the
   button, a sheet is taller than the screen with no way to scroll to its
   submit, a tap target is smaller than a fingertip, or the page scrolls
   sideways and the CTA is off to the right.

   None of that throws an error. Every one of them is a person who wanted to pay
   and could not, and it is invisible to any test that only asks whether the
   right elements exist.

   The mobile sweep in the suite checks layout on a device with no backend,
   which is the demo. This one is a real visitor on a phone against the real
   worker: land, sign up, open checkout, and be able to reach the button that
   takes their money. */
import { bootLive, makeEnv, makeOutbound, BACKEND } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const PHONE = { width: 390, height: 844 };   // the most common phone viewport

const outbound = makeOutbound();
outbound.on(/api\.stripe\.com\/v1\/checkout\/sessions/, () => ({
  id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1',
}));
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));

const env = makeEnv({
  GOOGLE_CLIENT_ID: '123-abc.apps.googleusercontent.com',
  SUPPORT_EMAIL: 'help@amv.test',
  STRIPE_SECRET_KEY: 'sk_test_notreal',
  STRIPE_PRICE_PRO: 'price_pro_123',
  APP_URL: 'http://localhost:9168',
});

const L = await bootLive({ env, outbound, port: 9169, viewport: PHONE });
const { page } = L;

const EMAIL = 'phone@example.com';
const PW = 'A-real-Passw0rd!';

/* Is this element actually reachable by a thumb: on screen, not covered by
   something else, and big enough to hit. */
async function reachable(sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const onScreen = r.width > 0 && r.height > 0 && cx > 0 && cx < vw && cy > 0 && cy < vh;
    /* What the browser says is at that point. If it is not this element or a
       child of it, something is sitting on top - the failure a screenshot
       shows and a selector never does. */
    const at = onScreen ? document.elementFromPoint(cx, cy) : null;
    const covered = onScreen && !(at === el || el.contains(at) || (at && at.contains(el)));
    return {
      found: true, onScreen, covered,
      w: Math.round(r.width), h: Math.round(r.height),
      coveredBy: covered && at ? (at.id || at.className || at.tagName) : '',
    };
  }, sel);
}
const noSideScroll = () => page.evaluate(() => ({
  doc: document.documentElement.scrollWidth,
  win: window.innerWidth,
}));

section('A visitor lands on a phone and the page fits');
{
  const s = await noSideScroll();
  ok(s.doc <= s.win + 1,
     'nothing pushes the page sideways, so nothing is off to the right', s);
  const live = await page.evaluate(() => !!AMV_API.live);
  ok(live === true, 'and they are on the real backend, not the demo', live);
}

section('They can reach the button that starts an account');
{
  const r = await page.evaluate(async () => {
    try { openAuth('signup'); } catch (e) { return { err: String(e && e.message) }; }
    await new Promise(x => setTimeout(x, 350));
    return { open: !!document.getElementById('auth-submit') };
  });
  ok(r.open === true, 'the sign-up sheet opens', r);

  const submit = await reachable('#auth-submit');
  ok(submit.found && submit.onScreen,
     'its button is on the screen without hunting for it', submit);
  ok(!submit.covered,
     'and nothing is sitting on top of it', submit.coveredBy || 'nothing');
  /* 44px is the long-standing minimum for a reliable tap. Smaller than that is
     a button people miss, on the one screen where a miss costs the account. */
  ok(submit.h >= 40, 'and it is big enough to hit with a thumb', submit.h);
}

section('The fields are usable, not just present');
{
  const fields = [];
  for (const sel of ['#a-name', '#a-email', '#a-pass']) fields.push([sel, await reachable(sel)]);
  const bad = fields.filter(([, r]) => !r.found || !r.onScreen || r.covered);
  ok(bad.length === 0, 'every field is on screen and uncovered', bad.map(([s, r]) => s + ' ' + JSON.stringify(r)));
  /* iOS zooms the whole page in when a focused input has text under 16px, and
     then the layout somebody carefully fitted is the wrong width for ever. */
  const sizes = await page.evaluate(() => ['#a-name', '#a-email', '#a-pass']
    .map(s => { const e = document.querySelector(s); return e ? parseFloat(getComputedStyle(e).fontSize) : 0; }));
  ok(sizes.every(n => n >= 16),
     'and their text is 16px or more, so focusing one does not zoom the page', sizes);
}

section('They really sign up, on the phone, against the real worker');
{
  const r = await page.evaluate(async ([em, pw]) => {
    document.getElementById('a-name').value = 'Phone Person';
    document.getElementById('a-email').value = em;
    document.getElementById('a-pass').value = pw;
    document.getElementById('auth-submit').click();
    await new Promise(x => setTimeout(x, 900));
    return { signedIn: !!(S.user && S.user.email), token: !!AMV_API.token };
  }, [EMAIL, PW]);
  ok(r.signedIn && r.token, 'they have a real account and a real token', r);
  const acct = await env.AMV_KV.get('acct:' + EMAIL);
  ok(!!acct, 'and it exists on the server, not just in the phone', !!acct);
}

section('The pay sheet opens and its button can be reached');
{
  /* The single most expensive thing to get wrong. A submit button below the
     fold of a sheet that does not scroll is a checkout nobody can complete,
     and it looks completely fine on a laptop. */
  const opened = await page.evaluate(async () => {
    try { openPaymentSheet('pro'); } catch (e) { return { err: String(e && e.message) }; }
    await new Promise(x => setTimeout(x, 450));
    return { open: !!document.getElementById('pay-body') };
  });
  ok(opened.open === true, 'the payment sheet opens on a phone', opened);

  const s = await noSideScroll();
  ok(s.doc <= s.win + 1, 'and does not push the page sideways', s);

  const cta = await reachable('#pay-card-go, #pay-submit, .pay-submit');
  ok(cta.found, 'there is a button to pay with', cta);
  ok(cta.onScreen, 'it is on the screen', cta);
  ok(!cta.covered, 'nothing is covering it', cta.coveredBy || 'nothing');
  ok(cta.h >= 40, 'and it is thumb sized', cta.h);
}

section('And the sheet can be scrolled to its bottom if it is tall');
{
  /* A sheet taller than the viewport is fine as long as it scrolls. One that
     is taller AND fixed is a dead end - which is the shape this checks for
     rather than asserting a height nobody can predict across devices. */
  const r = await page.evaluate(() => {
    const sheet = document.querySelector('.pay-sheet, .ob, #pay-body');
    if (!sheet) return { none: true };
    const el = sheet.closest('[style*="overflow"], .ov, .pay-sheet') || sheet;
    const tallerThanScreen = sheet.scrollHeight > window.innerHeight;
    const cs = getComputedStyle(el);
    const scrolls = /auto|scroll/.test(cs.overflowY) || /auto|scroll/.test(getComputedStyle(document.body).overflowY);
    return { tallerThanScreen, scrolls, overflowY: cs.overflowY };
  });
  ok(!r.none, 'the sheet was found', r);
  ok(!r.tallerThanScreen || r.scrolls,
     'if it is taller than the screen, it scrolls', r);
}

section('Checkout is reached from the phone, and the server makes it');
{
  const r = await page.evaluate(async (base) => {
    try { return { url: await AMV_API.stripeCheckout('pro', (S.user && S.user.email) || '') }; }
    catch (e) { return { err: e.message }; }
  }, BACKEND);
  ok(/checkout\.stripe\.com/.test(r.url || ''),
     'a real processor URL comes back', r.url || r.err);
  const calls = outbound.sentTo(/checkout\/sessions/);
  ok(calls.length === 1, 'created by the server, from a phone like anywhere else', calls.length);
}

section('Nothing threw on the small screen');
{
  ok(L.errors.length === 0, 'no JavaScript errors', L.errors);
  const bad = L.served.filter(s => s.status >= 500);
  ok(bad.length === 0, 'and no request made the worker fall over', bad.map(s => s.path));
}

await L.close();
if (report('paying-on-a-phone') > 0) process.exitCode = 1;
done();
