/* THREE THINGS WRONG WITH THE SCREEN SOMEBODY OPENS TO SPEND MONEY.

   1. IT WAS STILL SELLING IMAGES. Image generation was removed from the
      product, and the copy that asks for money had not caught up: the free
      plan card listed "Chat, images & 3D generation", the apps card promised
      "full chat, images, agents", the status panel reported an "Image
      generation" service as Operational with its own green dot, and the
      upgrade nudge was ready to offer "a far larger daily allowance and HD
      output" for it. The last one is the worst of them - it is the single
      moment the product asks somebody for money, and it was prepared to ask
      on the strength of a thing they could never receive.

   2. THE SECURITY BLOCK SAT IN THE MIDDLE. In Settings this pane is followed
      by two appended sections, the retired Usage and Spending panes. Appended
      means appended, so they landed after everything - which put a block of
      payment-security reassurance between somebody and the two numbers they
      opened the screen for. The order that makes sense is what you are on,
      what you have used, what you could move to, and only then the
      reassurance.

   3. "UPGRADE TO ELITE - $75/MO" WENT STRAIGHT TO CHECKOUT. Six words and a
      number is not enough to decide on, and the list cannot hold what each
      plan actually gives you without becoming the plans screen. So it goes
      there, landing on the card that was picked. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src', 'app');

const app = await bootApp({ apiBase: '' });
const { page, errors } = app;

/* SECTIONS, NOT HEADINGS.

   This read the h2s and h3s and looked for one called "Current plan". That
   heading is gone on purpose: it labelled a card whose first word was the plan
   and whose second was the price, which is a label for something already
   labelled - and five headed, bordered panels down one page is what made this
   screen read as a settings form rather than a product.

   The promise has not changed and is what is still checked: what you are on,
   then what you have used, then what you could move to, then the
   payment-security block, last and out of the way. Anchoring on the SECTIONS
   rather than on the words inside them is what makes it survive the next time
   somebody rewrites a heading, which is exactly what happened here. */
const headings = (plan) => page.evaluate((pl) => {
  saveStr('amv_plan', pl);
  S.tab = 'settings'; S.settingsPane = 'billing';
  renderSettingsView();
  const pane = document.getElementById('set-pane');
  return [...pane.querySelectorAll('.ss2, h2, h3, .bill-sec-line')].map((el) => {
    if (el.classList.contains('bill-sum')) return 'SECTION:current-plan';
    /* The payment-security block used to be four emoji cards under a heading.
       It is one line now and has no heading, so anchoring on its words would
       find nothing - which is what happened, and the failure read as "the
       block is missing" when what had changed was its SHAPE. The claim this
       file makes is about ORDER: reassurance last, out of the way. That claim
       is unchanged and is what is still checked; the block just got smaller,
       which if anything is more out of the way than before. */
    if (el.classList.contains('bill-sec-line')) return 'SECTION:payment-security';
    /* Same reasoning one section up. "Change plan" is called "Upgrade your
       plan" now, and pinning the regex to the old words made four assertions
       report the section as ABSENT when it had only been renamed - the exact
       failure this file's own note says anchoring on sections avoids. */
    if (el.classList.contains('bill-up')) return 'SECTION:upgrade';
    if (el.classList.contains('ss2')) {
      const h = el.querySelector('h3');
      return h ? h.textContent.trim() : '';
    }
    /* A section's own heading would otherwise be counted twice - once as the
       section and once as itself - which made the last entry a duplicate and
       "is it last" impossible to answer. Headings OUTSIDE a section still
       count: the usage panes are appended as bare blocks. */
    if (el.tagName === 'H3' && el.closest('.ss2')) return '';
    return el.textContent.trim();
  }).filter(Boolean);
}, plan);
const at = (hs, re) => hs.findIndex(h => re.test(h));

section('The billing pane reads in the order somebody uses it');
{
  for (const plan of ['free', 'elite']) {
    const hs = await headings(plan);
    const current = at(hs, /^SECTION:current-plan$/);
    const usage   = at(hs, /^Usage$/);
    const change  = at(hs, /^SECTION:upgrade$/);
    const secure  = at(hs, /^SECTION:payment-security$/);

    ok(current >= 0 && usage >= 0 && change >= 0 && secure >= 0,
       `[${plan}] all four sections are present`, hs);
    ok(current < usage,  `[${plan}] the plan you are on comes before what you have used`, hs);
    ok(usage < change,   `[${plan}] and usage comes before what you could move to`, hs);
    ok(change < secure,  `[${plan}] and the payment-security block is after all of it`, hs);
    ok(secure === hs.length - 1,
       `[${plan}] in fact it is last, so it is available without being in the way`, hs.slice(-3));
  }
}

section('Upgrading opens the plans screen, on the plan that was picked');
{
  /* REDUCED MOTION, SO THIS MEASURES A PLACE AND NOT A MOMENT.

     The click scrolls smoothly and rings the card for 2.4 seconds, and the
     first version of this waited a fixed 700ms before measuring - a bet that a
     smooth scroll finishes in under 700ms on whatever machine is running, with
     a 2.4s window closing behind it. The sibling suite made exactly that bet
     about a 220ms slide-in and lost it twice in CI while passing every time
     locally.

     Asking the page for reduced motion removes the race rather than out-waiting
     it: the scroll becomes instant and the keyframes are skipped, because the
     code under test honours the preference. What is asserted - which card is
     marked, and that it is the visible one - is unchanged, and the
     reduced-motion path gets covered for free. */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const r = await page.evaluate(async () => {
    saveStr('amv_plan', 'pro');
    S.tab = 'settings'; S.settingsPane = 'billing'; renderSettingsView();
    const b = document.querySelector('#set-pane [data-pay="elite"]');
    if (!b) return { missing: true };
    const label = b.textContent.trim();
    b.click();
    /* Still a wait, because the handler defers by 60ms so the plans view has
       rendered - but with motion off there is nothing animating to wait out. */
    await new Promise(r => setTimeout(r, 400));
    const vis = (el) => { if(!el) return false;
                          const c = getComputedStyle(el), q = el.getBoundingClientRect();
                          return c.display !== 'none' && c.visibility !== 'hidden' && q.width > 0 && q.height > 0; };
    const cta = document.getElementById('upg-pay');
    const feats = document.querySelector('.upg-feats');
    return {
      label, tab: S.tab,
      onPage: !!document.querySelector('.upg'),
      title: (document.querySelector('.upg-t') || {}).textContent || '',
      feats: document.querySelectorAll('.upg-feats .plnfl li').length,
      ctaText: cta ? cta.textContent.trim() : '',
      ctaVisible: vis(cta),
      ctaAfterFeats: (cta && feats)
        ? cta.getBoundingClientRect().top > feats.getBoundingClientRect().top : false,
      back: vis(document.getElementById('upg-back')),
    };
  });
  ok(!r.missing, 'the Change plan list offers Elite', r);
  ok(/Upgrade to Elite/.test(r.label), 'and says so plainly', r.label);
  /* ITS OWN PAGE NOW, NOT A RING AROUND A CARD.

     This used to assert the plans tab opened with the Elite card marked and
     scrolled into view, and the marking had to be scoped to #vc because the
     landing page carries a second set of the same cards. That was all true of
     a design that has been replaced: picking a plan left it sitting beside
     three you did not pick, at the same size, with what it actually gives you
     a scroll away inside a box.

     The claim is the same one at heart - picking a plan must take you somewhere
     that makes the decision, not somewhere you have to hunt - and it is
     stronger here, because a page cannot be scrolled past or marked on the
     wrong copy. What it must carry: the plan's name, what you get, and one
     button, placed AFTER the argument rather than above it. */
  ok(r.tab === 'upgrade', 'clicking it opens that plan\u2019s own page', r.tab);
  ok(r.onPage && /Elite/.test(r.title), 'for the plan that was picked', r.title);
  ok(r.feats >= 5, 'with what you actually get on it', String(r.feats));
  ok(/payment|checkout/i.test(r.ctaText) && r.ctaVisible,
     'and one control that goes to payment', r.ctaText);
  ok(r.ctaAfterFeats, 'placed after the argument, not above it', r);
  ok(r.back, 'and a way back to Billing', r.back);
  await page.emulateMedia({ reducedMotion: null });
}

section('Nothing on the paying screens sells image generation any more');
{
  const files = readdirSync(SRC).filter(f => f.endsWith('.js'));
  const offenders = [];
  for (const f of files) {
    const text = readFileSync(join(SRC, f), 'utf8');
    /* Comments strip out: several of them explain the removal, and an
       explanation of a deletion must not read as the deletion not happening. */
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    /* Only generation. Reading an image somebody uploads is a real feature and
       "File analysis - PDF, images, code" is true. */
    for (const re of [
      /Image generation/g,
      /images?\s*&amp;\s*3D generation/gi,
      /chat,\s*images,/gi,
      /label:\s*'Images'/g,
    ]) {
      const m = code.match(re);
      if (m) offenders.push(f + ': ' + m[0]);
    }
  }
  ok(offenders.length === 0,
     'no plan card, apps card, status panel or upgrade nudge offers it', offenders);
}

section('And the status panel does not report a service that does not exist');
{
  const svcs = await page.evaluate(async () => {
    try { openStatusPanel(); } catch (e) { return { threw: String(e) }; }
    await new Promise(r => setTimeout(r, 400));
    const box = document.getElementById('st-svcs');
    const names = box ? [...box.querySelectorAll('.st-svc-name')].map(n => n.textContent.trim()) : [];
    try { closeStatusPanel(); } catch (e) {}
    return { names };
  });
  ok(Array.isArray(svcs.names) && svcs.names.length > 0, 'the panel lists services', svcs);
  ok(!svcs.names.some(n => /image/i.test(n)),
     'and none of them is image generation', svcs.names);
  ok(svcs.names.some(n => /chat|agent/i.test(n)),
     'while the ones that are real are still there', svcs.names);
}

ok(errors.length === 0, 'no console errors', errors);

await app.close();
if (report('the-billing-screen-in-the-order-you-read-it') > 0) process.exitCode = 1;
done();
