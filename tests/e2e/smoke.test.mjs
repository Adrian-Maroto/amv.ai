/* Smoke: the whole app boots, every tab and settings pane renders, nothing throws.
   This is the test that catches "one bad edit broke everything". */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const TABS = ['chat','images','video','crew','handoff','studio','dev','lab',
              'projects','memory','team','marketplace','integrations','tasks'];

const app = await bootApp();
const { page, errors } = app;

section('Boot');
ok(await page.evaluate(() => !!document.getElementById('app')?.classList.contains('on')),
   'app shell is visible after goApp()');
ok(await page.evaluate(() => !document.getElementById('land') ||
     document.getElementById('land').classList.contains('hidden')),
   'landing page is hidden once signed in');

section('Every tab renders');
for (const t of TABS) {
  const r = await page.evaluate((t) => {
    try { setTab(t); } catch (e) { return { err: e.message }; }
    const host = document.getElementById('vc') || document.getElementById('cv');
    return { html: (host?.innerHTML || '').length, err: null };
  }, t);
  ok(!r.err && r.html > 50, `${t} renders`, r.err || r.html);
}

section('Every settings pane renders');
const panes = await page.evaluate(async () => {
  const out = [];
  setTab('settings');
  await new Promise(r => setTimeout(r, 300));
  const items = [...document.querySelectorAll('[data-sp]')].map(e => e.dataset.sp);
  for (const id of items) {
    try {
      goSettings(id);                       // the real API
      await new Promise(r => setTimeout(r, 60));
      const host = document.getElementById('vc');
      out.push({ id, ok: (host?.innerHTML || '').length > 100 });
    } catch (e) {
      out.push({ id, ok: false, err: e.message });
    }
  }
  return out;
});
ok(panes.length > 0, `found ${panes.length} settings panes`);
panes.forEach(p => ok(p.ok, `settings pane: ${p.id}`, p.err));

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
