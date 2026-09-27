/* THE HEAD IS THE PART OF AMV A STRANGER READS FIRST, AND NOBODY READ IT.

   Search results, link previews and the address a crawler files AMV under all
   come from a dozen lines at the top of index.html that no screen renders. So
   they drifted while everything visible was kept honest:

     - the description, the keywords and the structured data still sold "video"
       and "image generation" - both removed from AMV end to end;
     - the canonical address and og:url named https://amv.ai/, while every
       other line of this repository treats https://amv.homes as production.
       A canonical tells search engines which address is the real one, so the
       live site was telling them it was a copy of somewhere else;
     - og:image and twitter:image named og-image.png, a file that does not
       exist anywhere - every shared link previewed with a broken picture;
     - connect-src allowed an image-generation host and seven provider APIs the
       page no longer calls. A permission nothing uses is only useful to
       whatever gets onto the page and wants to send something out.

   Each of those is checked below, against the thing it describes rather than
   a copy of it. */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const head = html.slice(0, html.indexOf('</head>'));
const app = readFileSync(join(ROOT, 'app.js'), 'utf8');

const meta = (attr, name) => {
  const m = head.match(new RegExp('<meta ' + attr + '="' + name + '" content="([^"]*)"'));
  return m ? m[1] : null;
};
const ld = (head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1] || '';

section('It does not sell what AMV removed');
{
  const said = {
    description: meta('name', 'description'),
    keywords: meta('name', 'keywords'),
    'og:description': meta('property', 'og:description'),
    'twitter:description': meta('name', 'twitter:description'),
    'json-ld': ld,
  };
  for (const [k, v] of Object.entries(said)) {
    ok(typeof v === 'string' && v.length > 0, k + ' is present', v);
    ok(!/\bvideo\b|image generation|generat\w* (images?|pictures?|art)|text[- ]to[- ](image|video)/i.test(v || ''),
       k + ' does not offer image or video generation', v);
  }
  let parsed = null;
  try { parsed = JSON.parse(ld); } catch (e) {}
  ok(parsed && parsed['@type'] === 'SoftwareApplication', 'the structured data is valid JSON', !!parsed);
}

section('It names the address AMV is actually served from');
{
  /* The production origin, read from the backend base the build bakes in:
     api.amv.homes is served for amv.homes. */
  const apiBase = (head.match(/<meta name="amv-api-base" content="([^"]*)"/) || [])[1] || '';
  const site = apiBase ? 'https://' + new URL(apiBase).hostname.replace(/^api\./, '') : '';
  ok(site === 'https://amv.homes', 'the site origin is derivable from the page', site);
  const canonical = (head.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
  const urls = {
    canonical,
    'og:url': meta('property', 'og:url'),
    'og:image': meta('property', 'og:image'),
    'twitter:image': meta('name', 'twitter:image'),
  };
  for (const [k, v] of Object.entries(urls)) {
    ok(typeof v === 'string' && v.startsWith(site + '/'), k + ' is on ' + site, v);
  }
  /* An image a preview asks for has to be one the host publishes. */
  for (const k of ['og:image', 'twitter:image']) {
    const path = String(urls[k] || '').slice(site.length + 1);
    ok(path && existsSync(join(ROOT, 'public', path)), k + ' is a file the host serves', path);
  }
  /* A large-image card with a square icon crops it; the small card is the
     honest pairing until a real wide image exists. */
  ok(meta('name', 'twitter:card') === 'summary', 'the card type matches a square image', meta('name', 'twitter:card'));
}

section('It lets the page reach only what the page reaches');
{
  const csp = meta('http-equiv', 'Content-Security-Policy') || '';
  const dir = (name) => ((csp.match(new RegExp('(?:^|[;\\s])' + name + '\\s+([^;]*)')) || [])[1] || '')
    .trim().split(/\s+/).filter(Boolean);
  const connect = dir('connect-src');
  const loaded = new Set([...dir('script-src'), ...dir('frame-src')]);
  const apiBase = (head.match(/<meta name="amv-api-base" content="([^"]*)"/) || [])[1] || '';
  const apiOrigin = apiBase ? new URL(apiBase).origin : '';
  ok(connect.length > 3, 'connect-src is a real list', connect);
  const unused = connect.filter(h => {
    if (/^'|^http:\/\/(127\.0\.0\.1|localhost):\*$|^https:\/\/\*\.workers\.dev$/.test(h)) return false;
    if (h === apiOrigin) return false;          // the backend the build baked in
    if (loaded.has(h)) return false;            // a script or frame we load calls home
    /* Named with its caller: Stripe.js, loaded from js.stripe.com, runs in
       this page and calls api.stripe.com from here. */
    if (h === 'https://api.stripe.com' && loaded.has('https://js.stripe.com')) return false;
    return !app.includes(h.replace(/^https:\/\//, ''));
  });
  ok(unused.length === 0, 'every other host in connect-src is one the page calls', unused);
  ok(!/pollinations/i.test(csp), 'and no image-generation host is allowed', true);
}

report();
done();
