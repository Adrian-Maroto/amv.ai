/* NOTHING DISAPPEARS IN THE MERGE.

   AMV-D007 folds Studio, Dev and Lab into one Build surface. The failure a merge
   like that actually has is not a crash - it is a button that quietly stopped
   being anywhere, on a screen nobody opened, noticed weeks later by the one
   person who used it.

   So the inventory is taken FIRST, against the build before any of the work, by
   driving the real app rather than reading its markup. It has to pass before
   and after, and the step that finishes the merge is the step that re-runs it.

   Taking it this way immediately found the gap that would have made it useless:
   a first pass drove Studio's hero and stopped, because reaching the canvas
   behind it normally needs a model call. That inventoried seven controls and
   left eight - back, add, refine, download, export, code, history - outside the
   baseline. The entire canvas, which is where Studio's work happens, could have
   been deleted with every check still green. It is mounted directly now.

   Design DNA needed the same treatment for the same reason: twelve sections,
   one mounted at a time, 217 controls between them. Snapshotting the open tab
   would have covered a twelfth of Studio and reported a pass.

   Five controls cannot be reached by driving at all - three hidden file inputs,
   a hidden language select, and Save, which appears only once a folder is
   connected. Those are checked against the built bundle instead, because "I
   could not click it" and "it is gone" have to stay different answers. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/build-surface-controls.json'), 'utf8'));

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

/* The same identity the fixture was captured with. An id is already unique and
   already stable, so it stands alone - appending the label made #dev-model carry
   the whole model picker's option text, and a wording change would then read as
   a deleted control. */
const IDENTITY = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const idOf = (e) => {
    if (e.id) return '#' + e.id;
    const label = (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)
      || e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('placeholder') || '';
    const hooks = ['data-dact','data-go','data-an','data-pv','data-add','data-s','data-r','data-dq','data-sld','data-pill','data-val'];
    const parts = [];
    for (const a of hooks) if (e.hasAttribute(a)) parts.push(a.replace('data-', '') + '=' + e.getAttribute(a));
    if (e.hasAttribute('data-darg')) parts.push('darg=' + e.getAttribute('data-darg'));
    if (parts.length) return '[' + parts.join(' ') + ']' + (label ? ' "' + label + '"' : '');
    const c = (e.className || '').toString().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    return (c ? '.' + c : e.tagName.toLowerCase()) + (label ? ' "' + label + '"' : '');
  };
  return { vis, idOf };
};

const snap = (root) => page.evaluate((ROOT_SEL) => {
  const { vis, idOf } = window.__identity();
  const out = [];
  const scope = document.querySelector(ROOT_SEL);
  if (scope) for (const e of scope.querySelectorAll('button, select, input, textarea, a[href], [role=button], [data-dact]')) {
    if (vis(e)) out.push(idOf(e));
  }
  return [...new Set(out)];
}, root);

await page.evaluate(`window.__identity = ${IDENTITY.toString()};`);
await page.evaluate(() => { S.user = { name: 'T', email: 't@amv.dev', ini: 'T' }; saveStr('amv_plan', 'ultra'); });

const found = new Set();
const walk = async (setup, root = '#vc', settle = 500) => {
  await page.evaluate(setup);
  await page.waitForTimeout(settle);
  for (const c of await snap(root)) found.add(c);
};

section('Every state of every Build surface is opened');
{
  await walk(() => { setTab('studio'); });
  await walk(() => { setTab('studio'); _studioNewArtifact('Test design', 'page', 'a brief'); _studioShowCanvas('a brief'); });
  await walk(() => { _DEV.log = []; _DEV.project = {}; setTab('dev'); });
  await walk(() => { _DEV.log = [{ role: 'sys', text: 'built' }]; _devSetFile('index.html', '<h1>hi</h1>', 'html'); setTab('dev'); renderCodeView(); });
  await walk(() => { _LAB.code = ''; setTab('lab'); });
  await walk(() => { _LAB.code = 'console.log(1)'; renderLabView(); });

  await page.evaluate(() => { setTab('studio'); openDNA(); });
  await page.waitForTimeout(600);
  for (const c of await snap('#ovr')) found.add(c);
  await page.click('#dna-intro-go').catch(() => {});
  await page.waitForTimeout(500);
  const sections = await page.evaluate(() =>
    [...document.querySelectorAll('#ovr .dna-nav-b')].map(b => (b.textContent || '').trim()));
  ok(sections.length >= 10, 'Design DNA still has all of its sections', sections.length);
  for (const name of sections) {
    await page.evaluate((n) => {
      const b = [...document.querySelectorAll('#ovr .dna-nav-b')].find(x => (x.textContent || '').trim() === n);
      if (b) b.click();
    }, name);
    await page.waitForTimeout(260);
    for (const c of await snap('#ovr')) found.add(c);
  }
  ok(found.size > 200, 'the walk reached a realistic number of controls', found.size);
}

section('Every control that existed before the merge is still reachable');
{
  const missing = FIX.rendered.filter(c => !found.has(c));
  ok(missing.length === 0,
     `all ${FIX.rendered.length} controls captured before AMV-D007 are still there`,
     missing.length + ' gone: ' + missing.slice(0, 12).join(' | '));
}

section('The five that cannot be clicked are still in the bundle');
{
  /* Hidden by design, so driving cannot find them - and "I could not click it"
     must not be allowed to read as "it is gone". */
  const bundle = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const goneFromSource = FIX.operable_ids.filter(id => !bundle.includes('id="' + id + '"'));
  ok(goneFromSource.length === 0,
     `all ${FIX.operable_ids.length} operable ids the three surfaces create still exist`,
     goneFromSource.join(', '));
}

section('The baseline itself cannot be quietly trimmed');
{
  /* Without this, the cheapest way to make the check above pass is to delete the
     line that fails it. Lowering these counts is then a deliberate edit that
     shows up in the diff beside whatever was removed. */
  ok(FIX.rendered.length >= FIX.expected_rendered_count,
     'the rendered baseline has not shrunk',
     `${FIX.rendered.length} vs ${FIX.expected_rendered_count}`);
  ok(FIX.operable_ids.length >= FIX.expected_operable_id_count,
     'and neither has the operable-id baseline',
     `${FIX.operable_ids.length} vs ${FIX.expected_operable_id_count}`);
}

ok(errors.length === 0, 'no console errors while opening every Build state', errors.slice(0, 3));
await app.close();
if (report('the-build-surfaces-keep-every-control') > 0) process.exitCode = 1;
done();
