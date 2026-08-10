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

section('EVERY href and src built by concatenation is guarded, or named here');
{
  /* This used to be a roster: sixteen call sites, each asserted to call
     safeUrl. A roster cannot notice a seventeenth, and by the time anybody
     looked there were four - the deploy URL that came back over the wire, and
     three in the school screens, one of them rendering whatever html_url the
     connected Canvas returned. Every one of them passed this file, because
     this file was only ever asked about the sixteen somebody had remembered.

     So it is a sweep now. Find every href/src assembled by string
     concatenation in the shipped bundle, and require each to go through the
     allowlist - or to be named below with the reason it needs no allowlist,
     which is always "the value did not come from outside".

     The reasons are checked too: an exemption that no longer matches anything
     is deleted rather than left to excuse the next thing that looks like it. */
  const EXEMPT = [
    ['the app’s own address on the share card',
     /^location\.origin\s*\+\s*location\.pathname/,
     'built from where the page already is - there is no outside value in it'],
    ['a blob: preview of an artifact',
     /^url\+'" sandbox=/,
     'URL.createObjectURL of a Blob this page just made; sandboxed, and no string from anywhere else reaches it'],
    ['the widget install snippet',
     /^host\+'\/widget\.js/,
     'shown as text to copy, from the operator’s own backend base - it is not a link this page follows'],
    ['a markdown link or image',
     /^_mdAttr\((url|alt)\)/,
     'the scheme is pinned by the pattern that matched it: md() only rewrites [text](https://...) and ![alt](https://...), so no other scheme can reach the attribute'],
  ];

  /* href="' + EXPR  /  src="' + EXPR, in either spacing the codebase uses. */
  const sites = [...bundle.matchAll(/(href|src)\s*=\s*"'\s*\+\s*([^;\n]{1,80})/g)]
    .map(m => ({ attr: m[1], expr: m[2].trim() }));

  ok(sites.length > 15, 'the bundle really does assemble links this way', sites.length);

  /* Guarded means the allowlist produced the value that reaches the attribute.
     Usually that is inline - escH(safeUrl(x)). It is also allowed to hold the
     result in a const first, which is what a site does when an unsafe value
     should fall back to something rather than render an empty attribute; in
     that case the const's initialiser has to be the guard, and this looks for
     exactly that declaration. Nothing else counts: a value that merely passed
     near a guard is not a value the guard returned. */
  const inlineGuard = /^(escH\(\s*)?(safeUrl|safeMediaSrc)\s*\(/;
  const heldGuard = (expr) => {
    const m = expr.match(/^escH\(\s*([A-Za-z_$][\w$]*)\s*\)/);
    if (!m) return false;
    return new RegExp('const\\s+' + m[1] + '\\s*=[^;\\n]*\\b(safeUrl|safeMediaSrc)\\s*\\(').test(bundle);
  };
  const GUARDED = (expr) => inlineGuard.test(expr) || heldGuard(expr);
  const unguarded = sites
    .filter(s => !GUARDED(s.expr))
    .filter(s => !EXEMPT.some(([, re]) => re.test(s.expr)))
    .map(s => s.attr + '="\'+' + s.expr.slice(0, 50));
  ok(unguarded.length === 0,
     'nothing reaches an href or src without passing the allowlist first',
     [...new Set(unguarded)].slice(0, 6));

  const stale = EXEMPT.filter(([, re]) => !sites.some(s => re.test(s.expr))).map(([name]) => name);
  ok(stale.length === 0, 'and every exemption still describes something that exists', stale);
}

section('The four that were found unguarded stay guarded, by name');
{
  /* The sweep above would catch these again, but it would catch them as a
     count. Named individually so a regression says WHICH one, and because
     each is a different kind of outside: the wire, Google, and a school. */
  [['the deployed-site address, which came back over the wire', /live at <a href="'\+escH\(safeUrl\(url\)\)/],
   ['the copy Drive just made',                                 /escH\(safeUrl\(link\)\)/],
   ['the assignment link the connected Canvas returned',        /escH\(safeUrl\(a\.url\)\)/],
   ['the original document an assignment points at',            /escH\(safeUrl\(d\.url\)\)/]]
    .forEach(([name, re]) => ok(re.test(bundle), name, re.test(bundle)));
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
