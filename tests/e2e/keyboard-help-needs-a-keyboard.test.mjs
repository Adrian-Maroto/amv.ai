/* UNDER THE BOX, ONE SMALL LINE (owner, Nov 24: remove "Enter to send,
   Shift+Enter for a new line - it's too compact, too smushed. All I want is,
   all the way below in very small text, that AMV is an AI and can make
   mistakes").

   The keyboard hint used to be hidden on phones only (where none of it was
   true); it is now gone everywhere. What is held, on a phone, a narrow
   window and a desktop: no keyboard hint, and the disclaimer is there, small. */
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
    const d = document.querySelector('.amv-disclaimer');
    return { hint: !!h, hintText: /Shift\+Enter/.test(document.body.innerText),
             disc: d ? (d.textContent || '').trim() : '', discPx: d ? parseFloat(getComputedStyle(d).fontSize) : 0,
             discShown: d ? getComputedStyle(d).display !== 'none' : false };
  });
  await ctx.close();
  return r;
};

for (const [name, opts] of [['a phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
                            ['a narrow window with a keyboard', { viewport: { width: 420, height: 820 } }],
                            ['a desktop', { viewport: { width: 1280, height: 900 } }]]) {
  section('On ' + name);
  const r = await look(opts);
  ok(!r.hint && !r.hintText, 'no keyboard hint under the box', r);
  ok(r.discShown && /can make mistakes/.test(r.disc), 'the one line that must be there is', r.disc);
  ok(r.discPx > 0 && r.discPx <= 13, 'in small text', r.discPx);
}

await browser.close();
try { srv.server.close(); } catch (e) {}
report();
done();
