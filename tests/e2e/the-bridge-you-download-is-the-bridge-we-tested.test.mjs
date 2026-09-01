/* A COPY THAT HAS DRIFTED IS WORSE THAN NO COPY.

   The bridge is a program somebody runs on their own computer, and it is now
   served beside the page so they can actually get it - no registry, no
   second host, the same origin and connection AMV itself arrives on.

   That creates one new way to be wrong, and it is a bad one. There are two
   copies of the daemon: `bridge/amv-bridge.mjs`, which the bridge suite
   drives over real HTTP and checks the confinement and refusals of, and the
   one at the root of the deployment, which is what people actually download
   and run. If those ever differ, every assurance made about the first is
   being made about a file nobody runs, and what is handed out is untested.

   Nothing else would notice. The build would succeed, the card would work,
   the download would arrive, and the bridge suite would go on passing about
   the wrong file.

   The other half is what a host does with a path it does not have. Plenty
   answer an unknown path with index.html, and a single-page app is exactly
   the kind that configures them to - so somebody would save a WEB PAGE
   called amv-bridge.mjs, run it, and get something incomprehensible out of
   node about a `<` character. So the download is checked before it is handed
   over, and this checks that the check works. */
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(ROOT, 'bridge', 'amv-bridge.mjs'));
const served = readFileSync(join(ROOT, 'amv-bridge.mjs'));

section('What the deployment serves is what the bridge suite tested');
{
  ok(served.length > 8000, 'the served copy is a whole file', served.length);
  /* THE ONE THAT MATTERS. Byte for byte, because "looks like the bridge" is
     what a truncation, a re-encoding and a stale build all look like. */
  ok(served.equals(source),
     'byte for byte the same file the bridge suite drives',
     createHash('sha256').update(served).digest('hex').slice(0, 16));

  const text = served.toString('utf8');
  ok(/^#!\/usr\/bin\/env node/.test(text), 'and it starts as something you can run', text.slice(0, 24));
  ok(/createServer/.test(text) && /127\.0\.0\.1/.test(text),
     'it is the loopback server, not something else that fit the pattern', true);
  ok(/ALLOWED_ORIGINS/.test(text) && /PAIR_CODE/.test(text),
     'with the pairing and origin checks still in it', true);
}

section('And it costs the page nothing to be there');
{
  /* The first attempt embedded it as base64 and blew the weight ceiling.
     A file only developers download must not be paid for by every visitor,
     so it must not be in the bundle at all. */
  const page = readFileSync(join(ROOT, 'index.html'), 'utf8');
  ok(!/__AMV_BRIDGE_B64/.test(page),
     'the daemon is not carried inside index.html', !/__AMV_BRIDGE_B64/.test(page));
}

const A = await bootApp({ tab: 'chat' });
const { page } = A;
await page.evaluate(() => {
  document.getElementById('cookie-consent-banner')?.remove();
  setTab('integrations');
});
await page.waitForSelector('.brg', { timeout: 8000 });

section('The card hands it over instead of naming a command nobody published');
{
  const card = await page.evaluate(() => {
    const el = document.querySelector('.brg');
    return { text: el.textContent,
             steps: [...el.querySelectorAll('.brg-steps li')].map(l => l.textContent.trim()),
             dl: !!document.getElementById('brg-dl'),
             cmds: [...el.querySelectorAll('.brg-cmd')].map(c => c.textContent.trim()) };
  });
  ok(card.dl === true, 'there is a way to get the file', card.dl);
  ok(card.steps.length === 3, 'in three steps, which is what it really takes', card.steps.length);
  ok(!/npx amv-bridge/.test(card.text),
     'and it no longer tells anybody to run a package that does not exist',
     card.cmds.join(' | '));
  ok(card.cmds.some(c => /node amv-bridge\.mjs/.test(c)),
     'the command it does name is the one that works', card.cmds);
  /* The bridge refuses `curl … | sh` as a shape. Telling people to install it
     that way would teach the habit while claiming to forbid it. */
  ok(!/\|\s*(ba)?sh\b/.test(card.text),
     'and nothing here pipes a download into a shell', true);
}

section('Pressing it fetches the real file and saves it');
{
  const got = await page.evaluate(async () => {
    const text = await window._bridgeFetchSource();
    const bytes = new TextEncoder().encode(text);
    const h = await crypto.subtle.digest('SHA-256', bytes);
    return { hash: [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join(''),
             len: bytes.length };
  });
  ok(got.hash === createHash('sha256').update(source).digest('hex'),
     'what the browser fetched is the file on disk', got.hash.slice(0, 16));

  const saved = await page.evaluate(async () => {
    const clicks = [];
    const real = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function(){ clicks.push({ name: this.download, href: this.href }); };
    try{ await window._bridgeDownload(); }
    finally{ HTMLAnchorElement.prototype.click = real; }
    return clicks;
  });
  ok(saved.length === 1, 'the button really starts a download', saved.length);
  ok(saved[0].name === 'amv-bridge.mjs',
     'under a name somebody can then run', saved[0] && saved[0].name);
  ok(/^blob:/.test(saved[0].href || ''),
     'from bytes it has already checked, rather than a link it hopes resolves',
     saved[0] && saved[0].href.slice(0, 5));
}

section('A host that answers with a web page does not hand somebody a web page');
{
  /* The failure this is really about: a single-page app is commonly
     configured to answer every unknown path with index.html. Downloading
     that under the name amv-bridge.mjs and running it is a confusing few
     minutes for somebody who did nothing wrong. */
  const r = await page.evaluate(async () => {
    const real = window.fetch;
    window.fetch = async () => new Response('<!doctype html><title>AMV</title>',
      { status: 200, headers: { 'Content-Type': 'text/html' } });
    const errs = [];
    const toasts = [];
    const realToast = window.toast;
    window.toast = (m, kind) => toasts.push({ m, kind });
    let saved = 0;
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function(){ saved++; };
    let ok2 = null;
    try{ ok2 = await window._bridgeDownload(); }
    catch(e){ errs.push(String(e.message || e)); }
    finally{
      window.fetch = real; window.toast = realToast;
      HTMLAnchorElement.prototype.click = realClick;
    }
    return { ok2, saved, toasts, errs };
  });
  ok(r.ok2 === false, 'the download is refused', r.ok2);
  ok(r.saved === 0, 'so nothing is saved to disk', r.saved);
  ok(r.toasts.length === 1 && r.toasts[0].kind === 'error',
     'and it is reported as a failure rather than passing quietly', r.toasts[0]);
  ok(/repository/i.test((r.toasts[0] || {}).m || ''),
     'naming somewhere the file can actually be got', (r.toasts[0] || {}).m);
}

section('No JavaScript errors');
{
  ok(A.errors.length === 0, 'zero uncaught page errors', A.errors.slice(0, 3));
}

await A.close();
if (report('the-bridge-you-download-is-the-bridge-we-tested') > 0) process.exitCode = 1;
done();
