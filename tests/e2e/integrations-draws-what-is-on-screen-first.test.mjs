/* INTEGRATIONS DRAWS WHAT IS ON SCREEN FIRST (speed pass, Nov 25). The screen
   holds 32 topics, ~3,100 elements, 2,800 of them two screens or more below
   the fold - and every visit laid all of them out: 362ms to open at 4x CPU.
   Topics now wait until they near the screen (content-visibility), 136ms.
   Held: every topic is deferred that way, the ones far below are really
   skipped, and a topic scrolled to is drawn - its rows are there to click. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ viewport: { width: 1280, height: 860 }, user: { name: 'Ana', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;
await page.waitForTimeout(400);
await page.evaluate(() => { document.querySelectorAll('.cc-banner').forEach(b => b.remove()); setTab('integrations'); });
await page.waitForFunction(() => document.querySelectorAll('#int-catalog > .ss2').length > 10, null, { timeout: 15000 });

section('Topics far below the fold are not laid out until needed');
const r = await page.evaluate(() => {
  const secs = [...document.querySelectorAll('#int-catalog > .ss2')];
  return { n: secs.length, auto: secs.every(s => getComputedStyle(s).contentVisibility === 'auto'),
    lastSkipped: (() => { const c = secs.at(-1).firstElementChild; return c && c.checkVisibility ? !c.checkVisibility({ contentVisibilityAuto: true }) : null; })() };
});
ok(r.n >= 20 && r.auto, 'every topic is deferred', r);
ok(r.lastSkipped !== false, 'and the last one is really skipped while off screen', r);

section('A topic scrolled to is drawn and usable');
const s = await page.evaluate(async () => {
  const last = [...document.querySelectorAll('#int-catalog > .ss2')].at(-1);
  last.scrollIntoView(); await new Promise(r => setTimeout(r, 300));
  const btn = last.querySelector('button, a');
  const b = btn && btn.getBoundingClientRect();
  return { drawn: last.firstElementChild.checkVisibility ? last.firstElementChild.checkVisibility({ contentVisibilityAuto: true }) : true, h: Math.round(last.getBoundingClientRect().height), btn: !!(b && b.height > 0) };
});
ok(s.drawn && s.h > 100 && s.btn, 'it is drawn, with its controls', s);

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
report();
await app.close();
done();
