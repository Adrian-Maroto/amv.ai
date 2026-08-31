/* THE BUILD BAKES A BACKEND IN. THE POLICY DECIDES WHAT MAY BE CONTACTED.
   NOTHING MADE THEM AGREE.

   AMV_API_BASE writes a host into a meta tag in index.html. connect-src is a
   hand-written list in the same file. Build with the backend on any host
   outside that list and the page is instructed to call an address the browser
   will refuse - so signup, sign-in, chat, Crew and payments all fail with
   "Failed to fetch", and the only explanation is a console line nobody reads.

   It hides in exactly the configurations used while developing. A build with
   no AMV_API_BASE is same-origin, and 'self' covers it. A workers.dev backend
   is covered by a wildcard already in the list. It fails for a production
   deployment on a custom domain, which is the normal thing to do - and it
   fails totally, on the first request, for every visitor.

   Measured before the fix, in a real browser: the page fetched
   https://api.amv.homes/v1/health and got "Refused to connect ... violates the
   following Content Security Policy directive: connect-src". After: zero
   refusals.

   These call the build's own function rather than running a build, because a
   test that rebuilds index.html to check index.html overwrites the artifact it
   is inspecting - and would race every other suite doing the same. */
import { ok, section, report, done } from '../lib/assert.mjs';
import { allowApiOrigin } from '../../build.mjs';

const CSP = (connect) => '<meta http-equiv="Content-Security-Policy" content="\n'
  + "  default-src 'self';\n"
  + '  connect-src ' + connect + ';\n'
  + "  frame-ancestors 'none';\n"
  + '">';
const connectOf = (html) => ((html.match(/connect-src\s([^;]*);/) || [, ''])[1] || '')
  .split(/\s+/).filter(Boolean);

section('A backend on a custom domain becomes reachable');
{
  const out = allowApiOrigin(CSP("'self' https://*.workers.dev"), 'https://api.amv.homes');
  const hosts = connectOf(out);
  ok(hosts.includes('https://api.amv.homes'),
     'the host the build just baked in is one the page may contact', hosts);
  ok(hosts.includes("'self'") && hosts.includes('https://*.workers.dev'),
     'and nothing already permitted was dropped', hosts);
}

section('A path on the base does not become part of the permission');
{
  /* connect-src takes origins. Letting a path in would either be ignored or
     widen the rule in a way nobody reading it would expect. */
  const out = allowApiOrigin(CSP("'self'"), 'https://api.amv.homes/v1/deep/path');
  ok(connectOf(out).includes('https://api.amv.homes'),
     'the origin is permitted, not the URL that was handed in', connectOf(out));
}

section('A host already covered is not added twice');
{
  const wild = allowApiOrigin(CSP("'self' https://*.workers.dev"), 'https://amv-backend.you.workers.dev');
  ok(connectOf(wild).filter(h => /workers\.dev/.test(h)).length === 1,
     'a wildcard that already reaches it is left alone', connectOf(wild));

  const exact = allowApiOrigin(CSP("'self' https://api.amv.homes"), 'https://api.amv.homes');
  ok(connectOf(exact).filter(h => h === 'https://api.amv.homes').length === 1,
     'and an exact host already present is not repeated', connectOf(exact));
}

section('Moving the backend takes the old permission away with it');
{
  /* Baking is sticky: the value lives in the committed index.html until another
     build changes it. Without this, moving from one domain to another would
     leave the old one permitted for good - an allowance for a host somebody
     else may own next year, that nobody would think to go and delete. */
  const moved = allowApiOrigin(
    CSP("'self' https://api.amv.homes"),
    'https://api.amv.dev',
    'https://api.amv.homes');
  const hosts = connectOf(moved);
  ok(hosts.includes('https://api.amv.dev'), 'the new backend is reachable', hosts);
  ok(!hosts.includes('https://api.amv.homes'), 'and the old one no longer is', hosts);
  ok(hosts.includes("'self'"), 'while the rest of the rule is untouched', hosts);
}

section('It refuses rather than guessing');
{
  let threw = '';
  try { allowApiOrigin(CSP("'self'"), 'not-a-url'); } catch (e) { threw = e.message; }
  ok(/not a usable URL/i.test(threw), 'a base that is not a URL stops the build', threw);

  let missing = '';
  try { allowApiOrigin('<html>no csp here</html>', 'https://api.amv.homes'); }
  catch (e) { missing = e.message; }
  ok(/Content-Security-Policy meta not found/i.test(missing),
     'and a page with no policy is not quietly shipped without one', missing);
}

section('No base means no change at all');
{
  const src = CSP("'self' https://*.workers.dev");
  ok(allowApiOrigin(src, '') === src,
     'a build with no backend leaves the policy exactly as written', true);
}

if (report('the-backend-it-is-told-to-use-is-one-it-may-reach') > 0) process.exitCode = 1;
done();
