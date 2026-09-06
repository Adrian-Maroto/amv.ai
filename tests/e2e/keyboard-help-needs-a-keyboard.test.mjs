/* THE COMPOSER GAVE KEYBOARD INSTRUCTIONS TO A PHONE.

   `.input-hint` reads "Enter to send - Shift+Enter for new line - Drag & drop
   files". On a touch device all three are false, not merely unhelpful: Enter
   inserts a newline on a phone keyboard (the send button sends), there is no
   Shift key to hold, and there is nothing to drag. The first clause is the
   worst of them - it describes the wrong behaviour for the control it sits
   under.

   It also costs real room. At 390x844 it wraps to two lines immediately above
   the composer, on the screen with the least space to give.

   Matched on the INPUT rather than on width, which is the part worth
   protecting: a 420px browser window on a laptop still has a keyboard and all
   three sentences are true there. A width breakpoint would have hidden it
   from that person too, and this suite is what stops somebody "simplifying"
   the media query into one. */
import { serveApp, LAUNCH } from '../lib/harness.mjs';
import { chromium } from 'playwright';
import { ok, section, report, done } from '../lib/assert.mjs';

const srv = await serveApp();
const browser = await chromium.launch(LAUNCH);
const look = async (opts) => {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto(srv.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  const r = await page.evaluate(() => {
    const h = document.querySelector('.input-hint');
    return { exists: !!h, shown: h ? getComputedStyle(h).display !== 'none' : false,
             text: h ? (h.textContent || '').trim().slice(0, 40) : '' };
  });
  await ctx.close();
  return r;
};

section('On a phone, keyboard help is not shown');
{
  const r = await look({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  ok(r.exists, 'the hint is still in the markup, not deleted for everybody', r.exists);
  ok(!r.shown, 'and it is hidden where none of it is true', r);
}

section('On a NARROW window with a keyboard, it still is');
{
  /* The case a width breakpoint would have broken. 420px is narrower than the
     phone above, and every word of the hint applies. */
  const r = await look({ viewport: { width: 420, height: 820 }, isMobile: false, hasTouch: false });
  ok(r.shown, 'a small laptop window keeps its keyboard help', r);
  ok(/Shift\+Enter/.test(r.text), 'with the shortcut still named', r.text);
}

section('And on a desktop, unchanged');
{
  const r = await look({ viewport: { width: 1280, height: 900 } });
  ok(r.shown, 'the hint is where it always was', r);
}

await browser.close();
try { await (srv.close ? srv.close() : srv.stop()); } catch (e) {}
if (report('keyboard-help-needs-a-keyboard') > 0) process.exitCode = 1;
done();
