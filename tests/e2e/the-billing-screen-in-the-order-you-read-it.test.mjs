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

const headings = (plan) => page.evaluate((pl) => {
  saveStr('amv_plan', pl);
  S.tab = 'settings'; S.settingsPane = 'billing';
  renderSettingsView();
  const pane = document.getElementById('set-pane');
  return [...pane.querySelectorAll('h2,h3')].map(h => h.textContent.trim()).filter(Boolean);
}, plan);
const at = (hs, re) => hs.findIndex(h => re.test(h));

section('The billing pane reads in the order somebody uses it');
{
  for (const plan of ['free', 'elite']) {
    const hs = await headings(plan);
    const current = at(hs, /^Current plan$/);
    const usage   = at(hs, /^Usage$/);
    const change  = at(hs, /^Change plan$/);
    const secure  = at(hs, /protect your payment/i);

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
    const picked = document.querySelector('.plnc-picked');
    const vis = (el) => { const c = getComputedStyle(el), q = el.getBoundingClientRect();
                          return c.display !== 'none' && c.visibility !== 'hidden' && q.width > 0 && q.height > 0; };
    const rect = picked ? picked.getBoundingClientRect() : null;
    return {
      label, tab: S.tab,
      tier: picked ? picked.querySelector('.plntier').textContent.trim() : null,
      visible: picked ? vis(picked) : false,
      inViewport: rect ? (rect.top < innerHeight && rect.bottom > 0) : false,
      inAppView: !!(picked && picked.closest('#vc')),
      totalCards: document.querySelectorAll('.plnc').length,
    };
  });
  ok(!r.missing, 'the Change plan list offers Elite', r);
  ok(/Upgrade to Elite/.test(r.label), 'and says so plainly', r.label);
  ok(r.tab === 'plans', 'clicking it opens the plans screen', r.tab);
  ok(r.tier === 'Elite', 'with the Elite card marked', r.tier);
  ok(r.visible && r.inViewport, 'and that card is on screen, not scrolled past', r);
  /* The landing page carries its own set of plan cards in the same markup, so
     an unscoped lookup can mark a hidden one - which would do nothing at all,
     silently, and look like the button was broken. */
  ok(r.totalCards > 4, 'there really are duplicate cards in the document', r.totalCards);
  ok(r.inAppView, 'and the one marked is the visible one, not the landing copy', r);
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
