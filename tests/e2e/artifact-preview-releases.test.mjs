/* A PREVIEW THAT IS CLOSED HAS TO ACTUALLY BE LET GO.

   WHY THIS FILE EXISTS. The artifact panel used to preview model-written HTML
   by wrapping it in a Blob and pointing an iframe at the resulting blob: URL.
   A blob URL is a hard reference: the browser keeps the whole document alive
   until someone revokes it, and nothing collects it for you. Nothing revoked.
   Every render made a new one - every Preview/Code switch, every reopen - so a
   long session that built a few pages and toggled between code and preview
   accumulated megabytes that could never come back. Invisible in every
   screenshot, never throws, which is why it survived so long. And the easy
   mistake in the other direction is revoking the URL the frame is CURRENTLY
   showing, which trades the leak for a blank box.

   WHY IT NOW READS DIFFERENTLY. Previews no longer make a blob URL at all. A
   blob: document inherits the embedding page's Content-Security-Policy, and
   AMV pins script-src to hashes, so every script inside an artifact was
   refused and anything that built its own content rendered as an empty box.
   Previews load a real document instead and receive the page by postMessage.

   So the mechanism is gone and both properties still matter - they are simply
   asserted against what the panel DOES rather than against its bookkeeping.
   Nothing accumulates is now the stronger claim that nothing is pinned at all,
   and "not a blank box" is now read off the rendered page rather than off a
   URL that happens to still resolve. The markup-lifecycle cases below are
   unchanged: they were never about blobs. */
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

/* What the preview actually rendered. The parent cannot look inside a
   sandboxed frame, and should not be able to; Playwright reaches it over the
   debugging protocol. */
const rendered = async () => {
  for (const fr of page.frames()) {
    /* The main frame is skipped explicitly. AMV's own page has an h1 too, so a
       search across every frame found the app's heading first and reported it
       as the preview's - a test looking at the wrong document and blaming the
       right one. */
    if (fr === page.mainFrame()) continue;
    try { const h = await fr.evaluate(() => { const e = document.querySelector('h1'); return e ? e.textContent : null; }); if (h) return h; }
    catch (e) { /* not the preview */ }
  }
  return null;
};

section('Opening a preview pins nothing, and shows the page');
{
  await page.evaluate(() => openArtifact(window.__art.id));
  /* The preview document has to load and then be handed the page, which is a
     round trip more than setting srcdoc was. Waited on the content rather than
     guessed at with a fixed delay. */
  for (let i = 0; i < 40 && await rendered() === null; i++) await page.waitForTimeout(100);
  ok(await live() === 0,
     'no blob document is held at all - the leak this file was written for cannot happen now', await live());
  const src = await frameSrc();
  ok(src.split('?')[0] === 'preview.html', 'the frame loads the preview document', src.split('?')[0]);
  ok(await rendered() === 'hello',
     'and the page is really on screen, which is the half a leak fix can break', await rendered());
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
  for (let i = 0; i < 40 && await rendered() === null; i++) await page.waitForTimeout(100);
  ok(await live() === 0, 'and returning to it still pins nothing', await live());
  ok(await rendered() === 'hello',
     'while the preview is a preview and not a blank box', await rendered());
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
  ok(await live() === 0, 'and still holds nothing it would have to release', await live());
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
