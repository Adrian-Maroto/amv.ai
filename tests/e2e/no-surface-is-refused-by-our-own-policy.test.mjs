/* THE BROWSER REFUSING SOMETHING IS A FEATURE HALF-WORKING, AND IT IS SILENT.

   Two of the worst bugs found this week were the same thing wearing different
   clothes, and neither threw, logged to a user, or showed up in a screenshot:

     Every preview refused every script. An iframe whose document comes from a
     local scheme inherits the page's Content-Security-Policy, and AMV pins
     script-src to hashes on purpose - so a generated app rendered its markup
     and did nothing. An app that writes its own content drew as a white page
     with black text, which is exactly how it was reported.

     Every API call to a custom backend was refused. AMV_API_BASE bakes a host
     into the page; connect-src decides what may be contacted; nothing made
     them agree. A production build on a custom domain would have failed
     totally, on the first request, for every visitor.

   In both cases the browser said precisely what was wrong, in the console,
   where nobody was looking. So this walks the product and listens.

   THE TRAP THIS FILE HAD TO AVOID. A sweep that finds nothing passes whether
   it swept everything or nothing at all - and the first draft did exactly
   that: its settings-pane loop used a selector that matched no elements, so
   it visited zero panes and reported clean. A check that is green about the
   wrong subject is the second most common defect in this codebase. So
   coverage is asserted too: how many surfaces were actually opened, and that
   the panes really were found. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

const refusals = [];
page.on('console', m => {
  const t = m.text();
  if (/Refused to|violates the following Content Security/i.test(t)) {
    refusals.push(t.replace(/\s+/g, ' ').slice(0, 180));
  }
});

const TABS = ['chat', 'crew', 'handoff', 'build', 'memory', 'tasks', 'integrations',
              'market', 'team', 'prompts', 'apps', 'extensions', 'workspaces'];
const MODES = ['design', 'code', 'lab'];

let visited = 0;

section('Every tab opens without the browser refusing anything');
{
  for (const t of TABS) {
    await page.evaluate(x => setTab(x), t);
    await page.waitForTimeout(220);
    visited++;
  }
  ok(visited === TABS.length, 'every tab was actually opened', visited);
  ok(refusals.length === 0, 'and nothing was refused on any of them', refusals.slice(0, 3));
}

section('Every build mode too');
{
  const before = refusals.length;
  for (const m of MODES) {
    await page.evaluate(x => { setTab('build'); setBuildMode(x); }, m);
    await page.waitForTimeout(260);
    visited++;
  }
  const mode = await page.evaluate(() => _buildMode());
  ok(mode === 'lab', 'the modes really switched', mode);
  ok(refusals.length === before, 'and none of them was refused', refusals.slice(before, before + 3));
}

section('Every settings pane');
{
  const before = refusals.length;
  await page.evaluate(() => setTab('settings'));
  await page.waitForTimeout(300);
  /* data-sp, which is what the pane buttons actually carry. The first draft
     guessed at data-setpane and found nothing, then reported success. */
  const panes = await page.evaluate(() =>
    [...document.querySelectorAll('.sn-btn[data-sp]')].map(b => b.dataset.sp));
  ok(panes.length >= 5, 'the settings panes were found, not silently missed', panes.length);

  for (const p of panes) {
    await page.evaluate((k) => {
      const b = document.querySelector('.sn-btn[data-sp="' + k + '"]');
      if (b) b.click();
    }, p);
    await page.waitForTimeout(200);
    visited++;
  }
  ok(refusals.length === before, 'and no pane was refused anything', refusals.slice(before, before + 3));
}

section('And the surfaces that render somebody else’s HTML');
{
  const before = refusals.length;
  await page.evaluate(() => {
    const a = _artifactStore('<h1>a</h1><scr' + 'ipt>document.title="ran"</scr' + 'ipt>', 'html', true);
    openArtifact(a.id);
  });
  await page.waitForTimeout(1200);
  /* The one that was actually broken: a script inside a preview. If this ever
     goes back to srcdoc or blob:, the refusal lands here. */
  ok(refusals.length === before,
     'an artifact runs its own script without being refused', refusals.slice(before, before + 2));

  const ran = await (async () => {
    for (const fr of page.frames()) {
      if (fr === page.mainFrame()) continue;
      try { const t = await fr.evaluate(() => document.title); if (t) return t; } catch (e) {}
    }
    return '';
  })();
  ok(ran === 'ran', 'and the script really ran, so the check has a subject', ran);
}

section('The sweep covered enough to mean something');
{
  /* Guards against the whole file passing because it walked nothing. */
  ok(visited >= 20, 'a real number of surfaces were opened', visited);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('no-surface-is-refused-by-our-own-policy') > 0) process.exitCode = 1;
done();
