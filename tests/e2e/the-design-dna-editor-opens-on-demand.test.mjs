/* THE DESIGN DNA EDITOR IS FETCHED WHEN IT IS OPENED.

   The editor moved out of the page into dna-editor.js to make room under the
   page's weight ceiling. What every design request reads - the saved DNA and
   dnaPromptBlock - stayed. This checks the seam between the two: nothing is
   fetched until somebody opens it, it opens, an edit made in it is what the
   next design request is told, and Reset reaches both. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Dee', email: 'dee@example.com', ini: 'D' } });
const { page, errors } = app;

section('Nothing is fetched until it is opened');
ok(await page.evaluate(() => typeof window._openDNANow === 'undefined' && !document.querySelector('script[src="dna-editor.js"]') && /=== DESIGN DNA/.test(dnaPromptBlock())),
   'the editor is not in the page, and the block chat reads still is', true);

section('It opens, and an edit in it is what the next design request is told');
{
  await page.evaluate(() => openDNA());
  /* The first time, it explains itself; "Set up my DNA" shows the editor. */
  await page.waitForSelector('#dna-intro-go', { timeout: 8000 });
  await page.click('#dna-intro-go');
  await page.click('#dna-nav [data-sec]:nth-child(2)');
  await page.waitForSelector('#dna-content [data-pill]', { timeout: 5000 });
  const pill = await page.$('[data-pill]:not(.on)');
  const want = pill ? await pill.evaluate(p => ({ k: p.dataset.pill, v: p.dataset.val })) : null;
  ok(!!want, 'it shows its choices', want);
  if (pill) await pill.click();
  const r = await page.evaluate(({ k }) => ({ v: _DNA[k], saved: (load('amv_dna') || {})[k], block: dnaPromptBlock() }), want || {});
  ok(want && r.v === want.v && r.saved === want.v, 'the choice is kept and saved', r);
}

section('Reset reaches what the page reads');
{
  await page.evaluate(() => { _DNA.projectName = 'Lumen Labs'; _saveDNA(); });
  ok(/Lumen Labs/.test(await page.evaluate(() => dnaPromptBlock())), 'a project name is in the block');
  /* Visible to a person - on screen, a real size, nothing above it hidden -
     checked here directly; then pressed through the page, because the
     browser driver's own visibility wait disagrees with that under this
     dialog's entrance animation. */
  const seen = await page.evaluate(() => {
    const b = document.getElementById('dna-reset'), r = b.getBoundingClientRect();
    let hidden = false; for (let e = b; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.visibility !== 'visible' || cs.display === 'none') hidden = true; }
    return { on: r.width > 0 && r.height > 0 && r.bottom <= innerHeight && r.right <= innerWidth, hidden };
  });
  ok(seen.on && !seen.hidden, 'Reset is on screen', seen);
  await page.evaluate(() => document.getElementById('dna-reset').click());
  ok(!/Lumen Labs/.test(await page.evaluate(() => dnaPromptBlock())), 'and after Reset it is gone from it', true);
}

ok(errors.length === 0, 'no page errors', errors);
await app.close();
if (report('the-design-dna-editor-opens-on-demand') > 0) process.exitCode = 1;
done();
