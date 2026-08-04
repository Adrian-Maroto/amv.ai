/* ESCAPING A URL IS NOT THE SAME AS CHECKING IT.

   Every URL in this app goes through escH before it reaches an attribute, and
   that was the wrong question answered carefully. escH stops a value breaking
   OUT of the attribute. It says nothing about whether the value is dangerous
   INSIDE one. `javascript:alert(1)` contains not a single character escH
   touches: no quote, no angle bracket, no ampersand. It arrives intact, and
   script-src carries 'unsafe-inline', so nothing downstream stops it either.

   That matters because a lot of these URLs are not ours. A research chip's href
   is a web search result. An image src is whatever the provider CDN answered
   with. A shared artifact came out of a link a stranger sent. A checkout
   redirect came back over the wire. Each is a string from outside becoming a
   thing that runs on click.

   One allowlist, in one function: http, https, a same-origin path, mailto, and
   for media a base64 data URL of a named media type. Everything else returns
   empty - a dead link, which is a bug report rather than a lost account.

   This asserts the function behaves, and that the places handling outside URLs
   actually call it. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundle = readFileSync(join(ROOT, 'app.js'), 'utf8');

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

section('What fetches is allowed through');
{
  const r = await page.evaluate(() => [
    safeUrl('https://example.com/a?b=c#d'),
    safeUrl('http://example.com'),
    safeUrl('/deploy/site'),
    safeUrl('mailto:a@b.com'),
    safeUrl('  https://example.com/pad  '),
  ]);
  ok(r[0] === 'https://example.com/a?b=c#d', 'https, with query and fragment intact', r[0]);
  ok(r[1] === 'http://example.com', 'http', r[1]);
  ok(r[2] === '/deploy/site', 'a same-origin path', r[2]);
  ok(r[3] === 'mailto:a@b.com', 'and mailto, which the support links use', r[3]);
  ok(r[4] === 'https://example.com/pad', 'surrounding whitespace is trimmed, not a reason to refuse', r[4]);
}

section('What executes is not');
{
  const bad = await page.evaluate(() => ({
    js:      safeUrl('javascript:alert(1)'),
    jsCase:  safeUrl('JaVaScRiPt:alert(1)'),
    jsSpace: safeUrl('  javascript:alert(1)'),
    jsTab:   safeUrl('java\tscript:alert(1)'),
    data:    safeUrl('data:text/html,<script>alert(1)</script>'),
    vb:      safeUrl('vbscript:msgbox(1)'),
    proto:   safeUrl('//evil.example.com/x'),
    empty:   safeUrl(''),
    nul:     safeUrl(null),
    obj:     safeUrl({ toString(){ return 'javascript:alert(1)'; } }),
  }));
  Object.entries(bad).forEach(([k, v]) => ok(v === '', k + ' does not survive', JSON.stringify(v)));
}

section('A protocol-relative URL is refused, because it is not same-origin');
{
  /* `//evil.com/x` looks like a path and is not one - it inherits the scheme
     and goes wherever it likes. This is the one that reads as safe. */
  const r = await page.evaluate(() => [safeUrl('//evil.example.com'), safeUrl('/real/path')]);
  ok(r[0] === '' && r[1] === '/real/path', 'a path is a path; two slashes is a host', r);
}

section('Media may also be base64 bytes, of a named type only');
{
  const r = await page.evaluate(() => ({
    png:   safeMediaSrc('data:image/png;base64,iVBORw0KGgo='),
    mp4:   safeMediaSrc('data:video/mp4;base64,AAAA'),
    http:  safeMediaSrc('https://cdn.test/a.png'),
    html:  safeMediaSrc('data:text/html;base64,PHNjcmlwdD4='),
    svg:   safeMediaSrc('data:image/svg+xml;base64,PHN2Zz4='),
    plain: safeMediaSrc('data:image/png,notbase64'),
    js:    safeMediaSrc('javascript:alert(1)'),
  }));
  ok(r.png.startsWith('data:image/png'), 'a png data URL is a picture', r.png);
  ok(r.mp4.startsWith('data:video/mp4'), 'and an mp4 one is a video', r.mp4);
  ok(r.http === 'https://cdn.test/a.png', 'a normal link still works', r.http);
  ok(r.html === '', 'data:text/html is not a picture', r.html);
  ok(r.svg === '', 'and neither is svg, which can carry script', r.svg);
  ok(r.plain === '', 'the shape has to match, not merely start with data:', r.plain);
  ok(r.js === '', 'and it inherits the refusals', r.js);
}

section('A search result cannot put an executable link on screen');
{
  /* The live case: the research panel is built from whatever the web search
     tool returned. */
  const html = await page.evaluate(() => _buildResearchPanel({
    searches: 1, done: true,
    sources: new Map([
      ['javascript:alert(1)', { url: 'javascript:alert(1)', title: 'bad' }],
      ['https://good.example.com/a', { url: 'https://good.example.com/a', title: 'good' }],
    ]),
  }, true));
  ok(!/href="javascript:/i.test(html), 'the executable one is not linked', html.slice(0, 300));
  ok(/href="https:\/\/good\.example\.com\/a"/.test(html), 'the real one still is', true);
}

section('And an artifact shared by link cannot either');
{
  /* Someone can craft the #art= fragment, so the title, and anything else
     rendered from it, is attacker-controlled by definition. */
  const r = await page.evaluate(() => {
    const before = document.body.innerHTML;
    _renderSharedArtifact({ h: false, t: '<img src=x onerror=alert(1)>', l: 'js', c: 'x' });
    /* Ask the DOM, not the string. The escaped form still contains the letters
       "onerror=" as text, and a substring match on the markup would fail on
       correct behaviour - which is how a check ends up loosened to pass. */
    const injected = document.querySelectorAll('img[onerror], img[src="x"]').length;
    const title = (document.querySelector('.shared-art-h1') || {}).textContent || '';
    const html = document.body.innerHTML;
    document.body.innerHTML = before;
    return { injected, title, escaped: /&lt;img/.test(html) };
  });
  ok(r.injected === 0, 'the fragment produces no element of its own', r.injected);
  ok(r.title.indexOf('<img') === 0, 'it is shown as the text it is', r.title.slice(0, 40));
  ok(r.escaped, 'entity-escaped in the markup', r.escaped);
}

section('The places that handle an outside URL call it');
{
  /* Computed, so the next one is covered too. A URL that came from a provider,
     a search, a share link or the wire, going into an href/src/window.open,
     must pass through the allowlist. */
  const OUTSIDE = [
    ['the research chips',        /rsrc-chip" href="'\+escH\(safeUrl\(/],
    ['the site list',             /site-u" href="'\+escH\(safeUrl\(/],
    ['the deployed-site link',    /'\+escH\(safeUrl\(d\.url\)\)\+'/],
    ['a generated image',         /<img src="'\+escH\(safeMediaSrc\(/],
    ['a generated video',         /<video src="'\+escH\(safeMediaSrc\(/],
    ['the video card',            /vvid" src="'\+escH\(safeMediaSrc\(v\.url\)\)/],
    ['the video download',        /vdl" href="'\+escH\(safeMediaSrc\(v\.url\)\)/],
    ['the premium image',         /safeMediaSrc\(await _premiumImageSrc\(/],
    ['a shared session item',     /shr-u" href="'\+escH\(safeUrl\(i\.url\)\)/],
    ['a Stripe receipt',          /safeUrl\(tx\.receipt\)/],
    ['an invoice PDF',            /safeUrl\(v\.pdf\)/],
    ['the checkout redirect',     /safeUrl\(await AMV_API\.stripeCheckout\(/],
    ['the billing portal',        /safeUrl\(await AMV_API\.portal\(/],
    ['the external pay window',   /const safe=safeUrl\(url\)/],
    ['opening a live site',       /safeUrl\(b\.dataset\.open\)/],
    ['opening a generated image', /safeMediaSrc\(b\.dataset\.url\)/],
  ];
  const missing = OUTSIDE.filter(([, re]) => !re.test(bundle)).map(([name]) => name);
  ok(missing.length === 0, 'every one of them is guarded', missing);
}

section('And the guard is one function, not a pattern people retype');
{
  const at = bundle.indexOf('function safeUrl(');
  ok(at > 0, 'it exists once', at > 0);
  const body = bundle.slice(at, at + 500);
  ok(/\^https\?:/.test(body), 'as an allowlist of schemes', true);
  ok(!/javascript/i.test(body),
     'not a blocklist of the ones somebody thought of, which is the version that gets bypassed', true);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('links-cannot-execute') > 0) process.exitCode = 1;
done();
