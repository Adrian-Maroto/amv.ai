/* EACH SETTINGS SECTION OPENS AT ITS TOP.

   Asked for: "when I scroll down on one tab it auto scrolls on another - if I
   scroll down on Account it shouldn't scroll anywhere else".

   The sections share one scrolling panel, so the position followed you from
   section to section. Now a section opens at its top - and a redraw of the
   SAME section, which happens after saving something in it, keeps the place. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;

for (const [w, h, tag] of [[1280, 800, 'desktop'], [390, 844, 'phone']]) {
  section('On a ' + tag);
  await page.setViewportSize({ width: w, height: h });
  const r = await page.evaluate(async () => {
    document.getElementById('cookie-consent-banner')?.remove();
    try { closeSettings(); } catch (e) {}
    S.settingsPane = 'account'; setTab('settings');
    await new Promise(r => setTimeout(r, 400));
    const panel = document.querySelector('.settings-content');
    const scrolls = panel.scrollHeight > panel.clientHeight + 50;
    panel.scrollTop = 400;
    const down = panel.scrollTop;
    renderSetPane();                                   // the same section, redrawn
    const kept = panel.scrollTop;
    /* Through the section list, the way a person changes section. */
    const btn = [...document.querySelectorAll('.sn-btn')].find(b => b.dataset.sp === 'privacy');
    if (btn) btn.click(); else { S.settingsPane = 'privacy'; renderSetPane(); }
    await new Promise(r => setTimeout(r, 200));
    return { scrolls, down, kept, other: document.querySelector('.settings-content').scrollTop };
  });
  ok(r.scrolls && r.down > 0, 'Account is long enough to scroll, and was scrolled', r);
  ok(r.kept === r.down, 'redrawing the same section keeps the place', r);
  ok(r.other === 0, 'and the next section opens at its top', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
if (report('each-settings-section-opens-at-its-top') > 0) process.exitCode = 1;
done();
