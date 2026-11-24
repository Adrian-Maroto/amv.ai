/* UP TO TWENTY PHOTOS, SHOWN AS PHOTOS (owner, Nov 24: "the plus ... just
   Research and Upload from device ... show the photos clean ...
   no more than 20 photos").

   A message used to carry one picture; the rest were named in a toast and
   dropped, and the one that went was a file name on a chip. Held, through the
   real chat box:
     · the "+" menu offers exactly Upload from this device and Research;
     · several photos attach together as thumbnails, each with its own remove;
     · photos added later join the ones already there;
     · more than twenty is refused whole, with the reason, and nothing changes;
     · sending carries every photo to the engine as its own picture, and the
       sent message shows them above the words. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ viewport: { width: 1280, height: 900 }, user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;
await page.waitForTimeout(500);
await page.evaluate(() => { document.querySelectorAll('.cc-banner').forEach(b => b.remove()); newChat(); });
await page.waitForTimeout(300);

/* Real PNGs, drawn here, so every step reads actual image bytes. */
const make = (n, start = 0) => page.evaluate(async ({ n, start }) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas'); c.width = 40; c.height = 30;
    const g = c.getContext('2d'); g.fillStyle = 'hsl(' + ((start + i) * 37 % 360) + ',70%,50%)'; g.fillRect(0, 0, 40, 30);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    out.push(new File([blob], 'photo-' + (start + i + 1) + '.png', { type: 'image/png' }));
  }
  window.__files = out; return out.length;
}, { n, start });
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast, [role="status"], [role="alert"]')].map(t => t.textContent).join(' | '));

section('The "+" menu: Upload and Research, nothing else');
await page.click('#att-btn');
await page.waitForTimeout(150);
const items = await page.evaluate(() => [...document.querySelectorAll('.ctxm .ctxi')].map(b => b.textContent.trim()));
ok(items.length === 2 && /Upload from this device/.test(items[0]) && /Research/.test(items[1]), 'exactly two items', items);
await page.keyboard.press('Escape');

section('Three photos attach together, as thumbnails');
await make(3);
await page.evaluate(() => handleFiles(window.__files));
await page.waitForFunction(() => document.querySelectorAll('#ac .att-ph img').length === 3, null, { timeout: 8000 });
const t1 = await page.evaluate(() => ({ kind: S.att && S.att.kind, n: S.att && S.att.items && S.att.items.length,
  loaded: [...document.querySelectorAll('#ac .att-ph img')].every(i => i.complete && i.naturalWidth > 0),
  xs: document.querySelectorAll('#ac .att-ph-x').length }));
ok(t1.kind === 'imgs' && t1.n === 3, 'three photos on the box', t1);
ok(t1.loaded, 'each thumbnail is the picture itself, drawn', t1);
ok(t1.xs === 3, 'each has its own remove', t1);

section('Removing one leaves the others; adding more joins them');
await page.click('#ac .att-ph-x[data-ph="1"]');
ok(await page.evaluate(() => S.att.items.length === 2 && S.att.items.map(p => p.name).join() === 'photo-1.png,photo-3.png'), 'the second one went, the others stayed');
await make(2, 3);
await page.evaluate(() => handleFiles(window.__files));
await page.waitForFunction(() => document.querySelectorAll('#ac .att-ph img').length === 4, null, { timeout: 8000 });
ok(true, 'two more joined them: four');

section('More than twenty is refused whole');
await make(17, 10);
await page.evaluate(() => handleFiles(window.__files));
await page.waitForTimeout(400);
const r = await page.evaluate(() => S.att.items.length);
ok(r === 4, 'nothing was added - still the four', r);
ok(/up to 20 photos/.test(await toasts()), 'and it says why', await toasts());

section('Sending carries every photo, and the message shows them');
const sent = await page.evaluate(async () => {
  let seen = null;
  _callAI = async (msgs) => { seen = msgs[msgs.length - 1]; S.busy = false; };
  document.getElementById('mta').value = 'Which of these is the sharpest?';
  await sendMsg();
  await new Promise(r => setTimeout(r, 200));
  const c = seen && seen.c;
  return { images: Array.isArray(c) ? c.filter(b => b.type === 'image').length : 0,
           text: Array.isArray(c) ? (c.find(b => b.type === 'text') || {}).text : '',
           bubble: document.querySelectorAll('#cm .mb.u .msg-ph').length,
           words: ((document.querySelector('#cm .mb.u') || {}).textContent || '').trim(),
           cleared: !S.att };
});
ok(sent.images === 4, 'four pictures reach the engine, each its own', sent);
ok(sent.text === 'Which of these is the sharpest?', 'with the words', sent.text);
ok(sent.bubble === 4 && sent.words === 'Which of these is the sharpest?', 'the sent message shows the four photos above the words', sent);
ok(sent.cleared, 'and the box is clear for the next message', sent.cleared);

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors);

report();
await app.close();
done();
