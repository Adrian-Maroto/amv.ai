/* Every element on every screen, and what it actually computes to. A removed
   rule that turns out to be live does not throw - it silently un-styles
   something. Comparing rendered computed styles is the only way to see that. */
import { bootApp } from '/home/user/amv.ai/tests/lib/harness.mjs';
import { writeFileSync } from 'fs';

const OUT = process.argv[2];
const TABS = ['chat','dashboard','workspaces','memory','usage','billing','plans','settings',
              'help','apps','tasks','integrations','extensions','crew','market','team','handoff','prompts'];
const PROPS = ['display','position','color','background-color','border-color','border-width',
               'font-size','font-weight','padding','margin','width','height','flex-direction',
               'gap','border-radius','opacity','visibility','text-align','box-shadow','z-index'];

const app = await bootApp({ tab: 'chat', user: { name: 'Snap', email: 'snap@x.com', ini: 'S' } });
const { page } = app;
/* STOP THE ANIMATIONS BEFORE MEASURING. The first run of this reported 29
   changed elements across three screens, every one of them an opacity partway
   through a fade or a pulse - two captures taken at different moments of the
   same animation. Noise that looks exactly like a finding is worse than no
   check, so the clock is stopped rather than the differences excused. */
await page.addStyleTag({ content: '*,*::before,*::after{animation:none !important;transition:none !important}' });
await page.waitForTimeout(300);
const snap = {};
for (const tab of TABS) {
  try {
    await page.evaluate((t) => { try { setTab(t); } catch (e) {} }, tab);
    await page.waitForTimeout(500);
    snap[tab] = await page.evaluate((props) => {
      const rows = [];
      for (const el of document.querySelectorAll('#app *')) {
        if (!el.className || typeof el.className !== 'string') continue;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        rows.push([el.tagName, el.className,
                   Math.round(r.width), Math.round(r.height),
                   props.map(p => cs.getPropertyValue(p)).join('|')].join('~'));
      }
      return rows;
    }, PROPS);
  } catch (e) { snap[tab] = ['ERROR: ' + String(e && e.message)]; }
}
writeFileSync(OUT, JSON.stringify(snap, null, 0));
const n = Object.values(snap).reduce((a, b) => a + b.length, 0);
console.log('screens:', Object.keys(snap).length, 'elements captured:', n);
if (n < 500) throw new Error('captured too little to be a real comparison: ' + n);
await app.close();
