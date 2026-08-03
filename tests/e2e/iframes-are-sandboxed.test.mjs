/* UNTRUSTED CONTENT RENDERS IN A BOX, OR IT IS NOT UNTRUSTED AT ALL.

   This product puts a lot of content it did not write inside an iframe: pages
   the model built, code somebody pasted, a shared artifact decoded from a URL
   fragment a stranger sent. Every one of those frames carries `sandbox`, and
   without `allow-same-origin` the frame gets a unique opaque origin - its
   scripts cannot read this page's DOM, its storage, or the auth token in it.

   Two ways that protection disappears, both one word wide:

   A frame written without a sandbox attribute at all. The approval preview -
   the screen where somebody reviews AI-generated work BEFORE it goes out - had
   exactly this. It renders model HTML into srcdoc, same-origin with the page,
   so a script in content the model was fed could read the token out of
   localStorage. Prompt injection to account takeover in one hop.

   Or a sandbox that gains `allow-same-origin`, which hands back everything the
   sandbox was for. A blob: or srcdoc frame with that flag inherits this origin.

   So: every frame is sandboxed, and no sandbox may hold the flags that undo it.
   Both halves are computed from the shipped bundle rather than trusted. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundle = readFileSync(join(ROOT, 'app.js'), 'utf8');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

/* Flags that give a framed document power over the page that framed it. */
const UNSAFE = ['allow-same-origin', 'allow-top-navigation', 'allow-popups-to-escape-sandbox'];

const framesIn = (src) => [...src.matchAll(/<iframe[^>]*/g)].map(m => m[0]);
const frames = framesIn(bundle).concat(framesIn(html));

section('The frames were found');
{
  ok(frames.length >= 6, 'iframes in the shipped markup', frames.length);
  const dynamic = [...bundle.matchAll(/createElement\('iframe'\)/g)].length;
  ok(dynamic >= 2, 'and the ones built in script', dynamic);
}

section('Every frame is sandboxed');
{
  const bare = frames.filter(f => !/sandbox/.test(f)).map(f => f.slice(0, 90));
  ok(bare.length === 0,
     'no untrusted document renders same-origin with the page', bare);
}

section('And a frame built in script is sandboxed before it is used');
{
  /* An element created with createElement has no sandbox until one is assigned,
     and assigning it AFTER the src is set is too late in some browsers. */
  const assigns = [...bundle.matchAll(/\.sandbox\s*=\s*'([^']*)'/g)].map(m => m[1]);
  ok(assigns.length >= 2, 'the script-built frames set a sandbox', assigns);
  assigns.forEach(v => {
    UNSAFE.forEach(flag => ok(v.indexOf(flag) < 0, 'and it does not include ' + flag, v));
  });
}

section('No sandbox holds a flag that undoes it');
{
  const values = [...new Set([
    ...[...bundle.matchAll(/sandbox=["']([^"']*)["']/g)].map(m => m[1]),
    ...[...html.matchAll(/sandbox=["']([^"']*)["']/g)].map(m => m[1]),
  ])];
  ok(values.length > 0, 'sandbox values were read', values);
  const bad = values.filter(v => UNSAFE.some(f => v.indexOf(f) >= 0));
  ok(bad.length === 0,
     'nothing grants a framed document the origin of the page that framed it', bad);
}

section('The approval preview specifically');
{
  /* Named, because this is the one that was wrong, and it is the screen where
     somebody reviews work that has NOT yet been trusted. */
  const at = bundle.indexOf('pvw-web-if');
  ok(at > 0, 'the website preview frame is present', at > 0);
  const frag = bundle.slice(at - 120, at + 200);
  ok(/sandbox="allow-scripts"/.test(frag),
     'and it renders model-written HTML inside a sandbox', frag.slice(0, 120));
}

if (report('iframes-are-sandboxed') > 0) process.exitCode = 1;
done();
