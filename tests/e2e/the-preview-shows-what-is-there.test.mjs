/* "MAKE SURE YOU CAN ACTUALLY SEE THE PREVIEW."

   You could not. The pane existed, it was the right size, and it said "Your
   live result appears here" - and for code that was already in the project it
   went on saying that forever.

   The preview was filled in exactly one place: the tail of _devShowResult,
   behind `if(pb && run)`. So it was the output of a RUN, never a view of what
   was there. Upload a folder, open the file, press Preview: nothing.

   What makes it worse than an oversight is that the machinery was finished.
   _devProjectPreviewHTML bundles the html, css and js into one document, and
   both "Open in browser" and "Deploy" already called it - so the same project
   would open correctly in a new tab and deploy correctly to a live URL while
   showing nothing on the screen somebody was actually looking at.

   Design had the same shape. The canvas was only ever reached from the moment
   a design was generated, so a session restored with finished designs opened
   on "What should we make?" with the work sitting in _STUDIO.artifacts,
   invisible - and sessions save those artifacts on purpose.

   These assert the preview against what is IN the project, never against a
   run, because a run is the one path that already worked. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

const PAGE = '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head>'
  + '<body><h1 id="t">Hello from the project</h1></body></html>';
const CSS = 'h1{color:rgb(1,2,3)}';

const frame = () => page.evaluate(() => {
  const f = document.querySelector('#dev-prev-body .dev-prev-frame');
  if (!f) return null;
  const r = f.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});

/* WHAT THE FRAME RENDERED, NOT WHAT IT WAS HANDED.

   These used to read the srcdoc attribute, which stopped existing when
   previews moved to a real document that receives the page by postMessage -
   srcdoc could never run a script, because such a frame inherits AMV's
   hash-pinned policy. Reading the rendered result is what the assertions
   meant all along, and it is stronger: an inlined stylesheet that arrives but
   does not apply now fails, where a string match on the attribute passed. */
const inPreview = async (fn) => {
  for (const fr of page.frames()) {
    try { const v = await fr.evaluate(fn); if (v !== null && v !== undefined) return v; }
    catch (e) { /* not the preview frame */ }
  }
  return null;
};
const settleFrame = async () => { await page.waitForTimeout(700); };

section('A project that is already there previews without being run');
{
  await page.evaluate(([html, css]) => {
    setTab('build');
    setBuildMode('code');
    /* Through the real file API, not by assigning to _DEV.project - entries
       carry {content,lang,ts} and a plain string silently breaks the bundler.
       A first draft of this test did exactly that and blamed the product. */
    _devSetFile('index.html', html);
    _devSetFile('style.css', css);
    _DEV.activePath = 'index.html';
    /* A log entry only because the workspace shows its chooser until the
       conversation starts. Nothing here is a run: no result is ever handed in. */
    _DEV.log = [{ role: 'user', text: 'a page' }];
    renderBuildView();
  }, [PAGE, CSS]);
  await page.waitForTimeout(500);

  const f = await frame();
  ok(f !== null, 'the preview pane holds a real frame, not a promise that one is coming', f);
  ok(f && f.w > 200 && f.h > 200, 'and it is a size somebody can see', f && { w: f.w, h: f.h });

  await settleFrame();
  const shown = await inPreview(() => {
    const h = document.getElementById('t');
    return h ? { text: h.textContent, colour: getComputedStyle(h).color,
                 links: document.querySelectorAll('link[rel=stylesheet]').length } : null;
  });
  ok(shown && /Hello from the project/.test(shown.text), 'showing the page from the project', shown);
  /* The bundler is what is being exercised: the stylesheet is a separate file
     and has to be pulled in, or an uploaded site previews unstyled, which
     looks broken rather than empty. Asserted by the colour actually applied. */
  ok(shown && shown.colour === 'rgb(1, 2, 3)',
     'with the separate stylesheet inlined and applied, not left as a link that cannot resolve', shown && shown.colour);
  ok(shown && shown.links === 0, 'and no unresolvable link tag left behind', shown && shown.links);
}

section('Asking to see the preview is the moment it has to be there');
{
  await page.evaluate(() => document.getElementById('dev-tab-prev').click());
  await settleFrame();
  const after = await inPreview(() => {
    const h = document.getElementById('t');
    return h ? h.textContent : null;
  });
  ok(after && /Hello from the project/.test(after), 'switching to the Preview tab shows the project', after);
}

section('A project with nothing to draw says so, rather than promising');
{
  const txt = await page.evaluate(async () => {
    _DEV.project = {}; _DEV.activePath = ''; _DEV.lastHTML = '';
    _devSetFile('main.py', 'print("hi")');
    _DEV.activePath = 'main.py';
    renderBuildView();
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('dev-tab-prev').click();
    await new Promise(r => setTimeout(r, 300));
    return (document.querySelector('#dev-prev-body') || {}).textContent || '';
  });
  ok(/no web page/i.test(txt), 'it says there is no page in these files', txt.slice(0, 70));
  ok(/output appears here|run them/i.test(txt),
     'and says what would put something there instead', txt.slice(0, 90));
  ok(!/Your live result appears here/.test(txt),
     'not the generic line, which for a Python file is a promise nothing keeps', txt.slice(0, 70));
}

section('A run owns its own output and the project does not paint over it');
{
  /* Running a Python file produces stdout. That IS the result for that file,
     so repainting a web page over it would be losing the answer. */
  const kept = await page.evaluate(async () => {
    const pb = document.getElementById('dev-prev-body');
    pb.innerHTML = '<div class="dev-prev-out ok"><pre>hi</pre></div>';
    _devSetFile('index.html', '<h1>a page appeared</h1>');
    _devPaintPreview();
    await new Promise(r => setTimeout(r, 150));
    return (document.getElementById('dev-prev-body') || {}).textContent || '';
  });
  ok(/hi/.test(kept) && !/a page appeared/.test(kept),
     'the run output stays on screen', kept.slice(0, 60));
}

section('Designs you already made are on screen when you come back');
{
  const seen = await page.evaluate(async () => {
    setBuildMode('design');
    _STUDIO.artifacts = [{ id: 'art_x', name: 'Pricing page', type: 'page',
                           html: '<h1>a finished design</h1>', brief: 'a pricing page', history: [] }];
    _STUDIO.activeId = 'art_x';
    _STUDIO.atHome = false;
    renderBuildView();
    await new Promise(r => setTimeout(r, 400));
    return { canvas: !!document.querySelector('.studio-canvas'),
             hero: !!document.querySelector('.dsn-hero'),
             hasFrame: !!document.getElementById('studio-frame') };
  });
  ok(seen.canvas && !seen.hero,
     'returning to Design opens the work, not the blank "what should we make"', seen.canvas);
  await settleFrame();
  const drawn = await inPreview(() => {
    const h = document.querySelector('h1');
    return h && /a finished design/.test(h.textContent) ? h.textContent : null;
  });
  ok(!!drawn, 'and the design is rendered in the canvas frame', drawn);
}

section('And Studio home still goes home');
{
  /* The reason this needs an explicit intent rather than "are there designs":
     that button re-renders this view, so without it the canvas would reopen
     immediately and there would be no way to start something new. */
  const home = await page.evaluate(async () => {
    document.getElementById('studio-back').click();
    await new Promise(r => setTimeout(r, 400));
    const first = { hero: !!document.querySelector('.dsn-hero'), canvas: !!document.querySelector('.studio-canvas') };
    setBuildMode('design');
    await new Promise(r => setTimeout(r, 300));
    return { first, stays: { hero: !!document.querySelector('.dsn-hero'), canvas: !!document.querySelector('.studio-canvas') } };
  });
  ok(home.first.hero && !home.first.canvas, 'it returns to the hero', home.first);
  ok(home.stays.hero && !home.stays.canvas, 'and stays there rather than bouncing back', home.stays);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('the-preview-shows-what-is-there') > 0) process.exitCode = 1;
done();
