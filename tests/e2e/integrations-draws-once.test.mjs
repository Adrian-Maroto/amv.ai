/* INTEGRATIONS DRAWS ONCE (Nov 23).

   The owner: "you click it and it shows something then instantly changes in
   the first second". The services used worldwide arrive in a file of their
   own; read while the app is idle, Integrations draws every topic with them
   in the frame it opens, instead of growing and recounting a moment later. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', blockServiceWorkers: true });
const p = app.page;
await p.evaluate(() => _cwSetCountry('US'));
/* The idle prefetch: the country's file and the worldwide services. */
await p.waitForFunction(() => typeof window.ccFillIntegrationsNow === 'function', null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(4000);

section('Every frame from the first is the final one');
const r = await p.evaluate(async () => {
  const seen = { legal: new Set(), email: new Set() };
  setTab('integrations');
  for (let i = 0; i < 40; i++) {
    for (const t of Object.keys(seen)) {
      const s = document.querySelector('#int-catalog [data-topic="' + t + '"]');
      seen[t].add(s ? s.querySelectorAll('.int-card').length + '/' + ((s.querySelector('[data-app-more]') || {}).textContent || '').replace(/\D/g, '') : 'none');
    }
    await new Promise(r => requestAnimationFrame(r));
  }
  return Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, [...v]]));
});
ok(r.legal.length === 1 && r.legal[0] !== 'none', 'Legal is drawn once, with its services', r.legal);
ok(r.email.length === 1 && r.email[0] !== 'none', 'and so is Email', r.email);
ok(+r.legal[0].split('/')[1] > 150, 'and its count already holds the worldwide services', r.legal[0]);

await app.close();
report(); done();
