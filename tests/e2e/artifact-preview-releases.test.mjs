/* A PREVIEW THAT IS CLOSED HAS TO ACTUALLY BE LET GO.

   The artifact panel previews model-written HTML by wrapping it in a Blob and
   pointing an iframe at the resulting blob: URL. A blob URL is a hard reference:
   the browser keeps the whole document alive until someone revokes it, and
   nothing in the page's lifetime collects it for you.

   Nothing revoked. Every render made a new one - every Preview/Code tab switch,
   every reopen of the same artifact - and each left the previous document
   pinned in memory permanently. A long chat session that built a few pages and
   toggled between code and preview a handful of times accumulated megabytes
   that could never come back. It is invisible in every screenshot and it never
   throws, which is why it survived this long.

   The half that is easy to get wrong in the other direction: revoking the URL
   the frame is CURRENTLY showing. Then the leak is gone and so is the preview.
   So both properties are asserted here - nothing accumulates, and what is on
   screen still resolves. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

/* Count blob URLs the way the browser does: created minus revoked. Installed
   before anything opens, so every URL the panel makes passes through it. */
await page.evaluate(() => {
  window.__live = new Set();
  const mk = URL.createObjectURL.bind(URL), rv = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (b) => { const u = mk(b); window.__live.add(u); return u; };
  URL.revokeObjectURL = (u) => { window.__live.delete(u); return rv(u); };
  window.__art = _artifactStore('<h1>hello</h1><script>1<\/script>', 'html', true);
});

const live = () => page.evaluate(() => window.__live.size);
const frameSrc = () => page.evaluate(() =>
  document.querySelector('#art-panel .art-frame')?.getAttribute('src') || '');

section('Opening a preview holds exactly one document');
{
  await page.evaluate(() => openArtifact(window.__art.id));
  ok(await live() === 1, 'one blob URL for the one thing being shown', await live());
  const src = await frameSrc();
  ok(/^blob:/.test(src), 'and the frame points at it', src.slice(0, 24));
  ok(await page.evaluate(s => window.__live.has(s), src),
     'which has not been revoked out from under it', true);
}

section('Switching to Code lets the preview go');
{
  await page.evaluate(() => { _artifactActiveTab = 'code'; _renderArtifactPanel(window.__art); });
  ok(await live() === 0, 'nothing is held while nothing is previewed', await live());
  ok(await frameSrc() === '', 'and there is no frame left to hold it', true);
}

section('Toggling back and forth does not accumulate');
{
  /* The real usage pattern, and the one that leaked worst: a person reading the
     code, checking the render, reading the code again. */
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => { _artifactActiveTab = 'preview'; _renderArtifactPanel(window.__art); });
    await page.evaluate(() => { _artifactActiveTab = 'code'; _renderArtifactPanel(window.__art); });
  }
  ok(await live() === 0, 'twelve renders later, nothing is still held', await live());

  await page.evaluate(() => { _artifactActiveTab = 'preview'; _renderArtifactPanel(window.__art); });
  ok(await live() === 1, 'and the one on screen is the only one', await live());
  ok(await page.evaluate(s => window.__live.has(s), await frameSrc()),
     'still resolvable, so the preview is a preview and not a blank box', true);
}

section('Closing releases it');
{
  await page.evaluate(() => closeArtifact());
  ok(await live() === 0, 'a closed panel holds nothing', await live());
}

section('Closing does not blank the panel while it is still sliding out');
{
  /* The panel animates away over .34s. Emptying it at the moment of the click
     would show a white rectangle sliding off instead of the artifact. So the
     URL goes immediately - its document is already loaded - and the markup goes
     after the transition. */
  await page.evaluate(() => openArtifact(window.__art.id));
  await page.waitForTimeout(60);
  await page.evaluate(() => closeArtifact());
  const during = await page.evaluate(() =>
    (document.getElementById('art-panel')?.innerHTML || '').length);
  ok(during > 200, 'the content is still there mid-animation', during);

  await page.waitForTimeout(600);
  const after = await page.evaluate(() =>
    (document.getElementById('art-panel')?.innerHTML || '').length);
  ok(after === 0, 'and is dropped once the panel is off screen', after);
  ok(await live() === 0, 'with nothing held either way', await live());
}

section('Reopening during the slide-out is not wiped by the pending cleanup');
{
  /* Somebody closes the panel and immediately opens another artifact. The
     timer armed by the close must not empty the panel that has since reopened. */
  await page.evaluate(() => openArtifact(window.__art.id));
  await page.evaluate(() => closeArtifact());
  await page.evaluate(() => openArtifact(window.__art.id));
  await page.waitForTimeout(700);
  const len = await page.evaluate(() =>
    (document.getElementById('art-panel')?.innerHTML || '').length);
  ok(len > 200, 'the reopened panel still has its content', len);
  ok(await live() === 1, 'and holds exactly the one preview it is showing', await live());
}

section('Many open/close cycles settle at nothing');
{
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => openArtifact(window.__art.id));
    await page.evaluate(() => closeArtifact());
  }
  await page.waitForTimeout(600);
  ok(await live() === 0, 'eight cycles, nothing retained', await live());
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('artifact-preview-releases') > 0) process.exitCode = 1;
done();
