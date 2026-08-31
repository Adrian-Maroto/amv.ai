/* "I NEED IT TO BE LIKE CLAUDE - YOU LITERALLY SEE THE PREVIEW. NOT JUST
   WHITE BACKGROUND AND BLACK TEXT."

   It was not a styling bug, which is why it was hard to describe. Every
   preview in the product was an <iframe srcdoc>, and an iframe whose document
   comes from a LOCAL SCHEME - about:srcdoc, blob:, data: - inherits the
   embedding page's Content-Security-Policy. AMV pins script-src to three
   hashes on purpose, so the browser answered every generated app with
   "Refused to execute inline script".

   Styling came through untouched, which is the cruel part: a page with inline
   CSS looked nearly right and did nothing at all, and a page that builds its
   own content in JavaScript - a to-do app, a game, a dashboard, most of what
   "build an app" produces - drew as a white page with black text. Exactly as
   reported.

   Measured before choosing a fix: srcdoc and blob: are refused identically,
   because the inheritance rule covers both. A document fetched from a real
   URL gets its own policy, so previews now load preview.html and receive the
   page by postMessage.

   The frame stays sandboxed WITHOUT allow-same-origin. That is the whole
   safety argument, and it is asserted below by what the preview can actually
   do rather than by what it says about itself: it cannot read AMV's storage,
   reach the parent document, or read the address of the page it sits in, even
   though the file is served from AMV's own origin.

   Playwright reaches into the frame over the debugging protocol, so these can
   check what the page became - which the parent, correctly, cannot. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
const refusals = [];
page.on('console', m => { const t = m.text(); if (/Refused to/i.test(t)) refusals.push(t.slice(0, 140)); });

/* An app that builds itself in script, because that is the case that used to
   render as nothing. Styling alone would have passed the whole time. */
const APP = `<!doctype html><html><head><style>
 body{margin:0;background:#0b1020;color:#e6ecff;font-family:system-ui}
 .box{padding:24px}
</style></head><body>
<div class="box"><h1 id="h">…</h1><p id="p">…</p><button id="b">Clicked 0</button></div>
<script>
  document.getElementById('h').textContent='The app is running';
  document.getElementById('p').textContent='its own script built this line';
  var n=0,b=document.getElementById('b');
  b.onclick=function(){ n++; b.textContent='Clicked '+n; };
</scr` + `ipt></body></html>`;

const previewFrame = async () => {
  for (const fr of page.frames()) {
    try {
      const has = await fr.evaluate(() => !!document.getElementById('h'));
      if (has) return fr;
    } catch (e) { /* not this one */ }
  }
  return null;
};

section('The preview runs the app, it does not draw a picture of it');
{
  await page.evaluate((html) => {
    const host = document.createElement('div');
    host.id = 'probe';
    host.style.cssText = 'position:fixed;left:0;top:0;width:620px;height:360px;z-index:99999';
    document.body.appendChild(host);
    _previewMount(host, html, 'dev-prev-frame');
    host.querySelector('iframe').style.cssText = 'width:620px;height:360px;border:0';
  }, APP);
  await page.waitForTimeout(1200);

  const fr = await previewFrame();
  ok(!!fr, 'the preview document loaded', !!fr);
  const inside = fr ? await fr.evaluate(() => ({
    h: document.getElementById('h').textContent,
    p: document.getElementById('p').textContent,
    bg: getComputedStyle(document.body).backgroundColor,
  })) : {};
  ok(inside.h === 'The app is running',
     'the page ran its own script - this is the assertion the old preview failed', inside.h);
  ok(/its own script/.test(inside.p || ''), 'and script-written content is on screen', inside.p);
  ok(inside.bg === 'rgb(11, 16, 32)', 'with its styling applied too', inside.bg);
  ok(refusals.length === 0,
     'and the browser refused nothing, where it used to refuse every script', refusals.slice(0, 2));
}

section('It is interactive, which is what "running" means');
{
  const fr = await previewFrame();
  await fr.click('#b');
  await fr.click('#b');
  const label = await fr.evaluate(() => document.getElementById('b').textContent);
  ok(label === 'Clicked 2', 'clicking inside the preview does what the app says it does', label);
}

section('And it still cannot touch anything of yours');
{
  /* The safety half. Served from AMV's origin, but sandboxed without
     allow-same-origin, so it is an opaque origin: no storage, no cookies, no
     reaching the parent document. If someone ever adds allow-same-origin to
     make something convenient work, this fails. */
  const fr = await previewFrame();
  const walled = await fr.evaluate(() => {
    const out = { storage: 'reachable', parentDom: 'reachable', sibling: 'reachable' };
    try { void window.localStorage.length; } catch (e) { out.storage = 'blocked'; }
    try { void window.parent.document.title; } catch (e) { out.parentDom = 'blocked'; }
    try { void window.top.location.href; } catch (e) { out.sibling = 'blocked'; }
    return out;
  });
  /* Asserted by what it can DO, not by what location.origin says. A sandboxed
     frame still reports the URL's origin string while its effective origin is
     opaque - a first draft of this checked the string, and read a correctly
     walled-off frame as a breach. The three below are the wall itself. */
  ok(walled.storage === 'blocked', 'it cannot read localStorage', walled.storage);
  ok(walled.parentDom === 'blocked', 'nor reach the parent document', walled.parentDom);
  ok(walled.sibling === 'blocked', 'nor read the address of the page it sits in', walled.sibling);

  const attrs = await page.evaluate(() => {
    const f = document.querySelector('#probe iframe');
    return { sandbox: f.getAttribute('sandbox'), src: (f.getAttribute('src') || '').split('?')[0] };
  });
  ok(attrs.sandbox === 'allow-scripts',
     'the sandbox grants scripts and nothing else - no allow-same-origin', attrs.sandbox);
  ok(attrs.src === 'preview.html', 'and it loads the preview document by a real URL', attrs.src);
}

section('The page AMV itself runs on keeps its strict policy');
{
  /* The fix must not have been "turn the CSP off". script-src is untouched
     and still hash-pinned; the only change is 'self' in frame-src, which lets
     AMV frame AMV. frame-ancestors stays 'none', so nobody frames AMV. */
  const csp = await page.evaluate(() => {
    const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return m ? m.content : '';
  });
  ok(/script-src[^;]*sha256-/.test(csp), 'script-src is still pinned to hashes', /sha256-/.test(csp));
  ok(!/script-src[^;]*'unsafe-inline'/.test(csp),
     'and inline script is still refused for AMV itself', true);
  ok(/frame-src[^;]*'self'/.test(csp), 'frame-src allows our own preview document', true);
  ok(/frame-ancestors\s+'none'/.test(csp), 'and nobody may frame AMV', true);
}

section('If the preview document is not served, it degrades and says so');
{
  /* preview.html is a second file, and a host that does not serve it - or
     answers unknown paths with index.html - would otherwise leave the frame
     showing AMV inside AMV, or nothing at all. Before today the preview at
     least DREW the page; an error message alone would make a hosting mistake
     worse than the bug it replaced. So the old path stays as the degraded
     one, with a line naming what is missing.

     Simulated by pointing the frame at a path that does not exist, which is
     exactly what a missing file looks like from here. */
  const shown = await page.evaluate(async () => {
    document.getElementById('probe').remove();
    const host = document.createElement('div');
    host.id = 'probe2';
    host.style.cssText = 'position:fixed;left:0;top:0;width:500px;height:300px;z-index:99999';
    document.body.appendChild(host);
    const f = document.createElement('iframe');
    f.className = 'dev-prev-frame';
    f.sandbox = 'allow-scripts';
    host.appendChild(f);
    _previewSend(f, '<h1 id="deg">drawn without scripts</h1>');
    /* Repointed at a path that does not exist, AFTER _previewSend has set its
       own src - so the greeting never arrives and the timeout is reached, the
       same as a host that does not serve the file. The note still names the
       real preview document, because that is what somebody has to go and fix. */
    f.src = 'no-such-preview-file.html';
    await new Promise(r => setTimeout(r, 5200));
    const note = host.querySelector('.prev-degraded');
    return { note: note ? note.textContent : '', frames: host.querySelectorAll('iframe').length,
             srcdoc: !!(host.querySelector('iframe') || {}).getAttribute && !!host.querySelector('iframe').getAttribute('srcdoc') };
  });
  ok(/not being served/i.test(shown.note),
     'it says the preview document is missing rather than failing silently', shown.note.slice(0, 80));
  ok(/JavaScript will not run/i.test(shown.note),
     'and says exactly what is lost, so the page is not mistaken for a working one', shown.note.slice(-60));
  ok(shown.frames === 1 && shown.srcdoc,
     'and still draws the page the old way rather than showing nothing', shown);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('the-preview-runs-the-app') > 0) process.exitCode = 1;
done();
