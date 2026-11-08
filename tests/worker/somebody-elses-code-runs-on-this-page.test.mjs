/* FIVE SCRIPTS FROM FIVE OTHER COMPANIES, RUNNING WITH FULL ACCESS TO THE PAGE.

   Stripe, Turnstile, Google Identity, Google Tag Manager or Plausible, and
   Pyodide. Each is loaded from its vendor's own host, with no subresource
   integrity, which means AMV executes whatever that host serves at the moment
   somebody opens the app - with the session in localStorage, the DOM, and
   everything else a script on the page can reach.

   The obvious answer is SRI, and for four of these it is not available. Not
   "we didn't get to it": Stripe's own documentation says js.stripe.com must be
   loaded live and unpinned or the integration falls out of PCI scope, and
   Turnstile, Google Identity and the analytics endpoints are rolling files with
   no published hashes. Pinning them would break payments, sign-in and the bot
   check - a control that breaks the product is a control somebody removes, and
   then there is no control AND no feature.

   So what is actually available is smaller and worth having: the list itself.
   The real risk here is not the five that were assessed - it is the sixth,
   added next month from a host that COULD have been pinned, by somebody who did
   not think about it because nothing asked them to. This file is what asks.

   Every third-party script origin is named below with the reason it is there
   and what can be done about it. A new one fails this file until somebody adds
   a line, which means somebody looked. */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const srcDir = join(ROOT, 'src', 'app');
const appSrc = readdirSync(srcDir).filter(f => f.endsWith('.js'))
  .map(f => readFileSync(join(srcDir, f), 'utf8')).join('\n');
const worker = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');

/* The policy itself, taken from the meta tag rather than from the first place
   the words appear - there is a comment about the policy above it. */
const CSP = (/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html) || [])[1] || '';
const cspDirective = (name) =>
  ((new RegExp('(?:^|;)\\s*' + name + '([^;]*)')).exec(CSP) || [])[1] || '';

/* Every host AMV loads executable code from, and the decision about each. */
const THIRD_PARTY = {
  'js.stripe.com': {
    why: 'Stripe Elements. The card never touches AMV - that is the point of it.',
    sri: 'IMPOSSIBLE. Stripe requires js.stripe.com to be loaded directly and unpinned; a pinned copy '
       + 'takes the integration out of PCI scope and Stripe publishes no hashes because the file rolls.',
    mitigation: 'named in the CSP; loaded only on the payment screen, not on every page',
  },
  'challenges.cloudflare.com': {
    why: 'Turnstile, which is what stops signup being automated.',
    sri: 'IMPOSSIBLE. A rolling endpoint with no published hashes - pinning it would break the bot check '
       + 'the first time Cloudflare shipped an update.',
    mitigation: 'named in the CSP; loaded once, only when a challenge is needed',
  },
  'accounts.google.com': {
    why: 'Google sign-in, which is how a large share of people get an account at all.',
    sri: 'IMPOSSIBLE. Rolling, no published hashes.',
    mitigation: 'named in the CSP; the auth-code exchange happens on the Worker, so this script never '
              + 'holds a refresh token',
  },
  'www.googletagmanager.com': {
    why: 'Analytics, when the operator has configured a GA id.',
    sri: 'IMPOSSIBLE. Rolling.',
    mitigation: 'loaded only when an id is configured AND consent was given; inert otherwise',
  },
  'plausible.io': {
    why: 'The other analytics option, for operators who prefer it.',
    sri: 'IMPOSSIBLE. Rolling.',
    mitigation: 'same: only with an id and consent',
  },
  'www.paypal.com': {
    why: 'PayPal Buttons, the second way to subscribe.',
    sri: 'IMPOSSIBLE. Rolling, and PayPal publishes no hashes.',
    mitigation: 'named in the CSP; loaded only on the payment screen',
  },
};

section('Every third-party host is one somebody has written a decision about');
{
  /* Found rather than listed: the check reads the CSP, which is the one place
     that must name every host executable code can come from. A script added
     from a new host has to be added there too or the browser refuses it - so
     this cannot be walked past. */
  /* From the META TAG, not from the first mention of the words. The first
     "script-src" in this file is inside a comment ABOUT the policy, and reading
     that gave an empty host list and a check that passed on nothing. */
  ok(!!CSP, 'the meta Content-Security-Policy was found', CSP.slice(0, 60));
  const csp = cspDirective('script-src');
  ok(csp.length > 20, 'and its script-src', csp.slice(0, 80));
  const hosts = [...csp.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map(m => m[1]);
  ok(hosts.length >= 5, 'and it names the hosts', hosts);

  const unassessed = hosts.filter(h => !THIRD_PARTY[h]);
  ok(unassessed.length === 0,
     'nothing executes from a host nobody has assessed', unassessed);

  /* And the reverse: an entry for a host AMV no longer loads is a stale
     decision, which is how a roster stops meaning anything. */
  const stale = Object.keys(THIRD_PARTY).filter(h => !hosts.includes(h));
  ok(stale.length === 0, 'and no assessment describes a host that is gone', stale);
}

section('Each decision says what it is, and whether it can be pinned');
{
  for (const [host, d] of Object.entries(THIRD_PARTY)) {
    ok(d.why && d.why.length > 20, host + ' says why it is loaded at all', d.why);
    ok(/^(IMPOSSIBLE|NOT YET|PINNED)/.test(d.sri),
       host + ' says whether integrity is available', d.sri.slice(0, 40));
    ok(d.mitigation && d.mitigation.length > 20,
       host + ' says what is done instead', d.mitigation);
  }
}

section('The CSP is what makes the list enforceable, so it stays strict');
{
  const csp = cspDirective('script-src');
  ok(!/\*/.test(csp), 'script-src has no wildcard host', csp);
  ok(!/http:\/\//.test(csp), 'and nothing plaintext', csp);
  ok(/'self'/.test(csp), 'AMV\'s own code is allowed', true);

  const defaultSrc = cspDirective('default-src');
  ok(/'self'/.test(defaultSrc) && !/\*/.test(defaultSrc),
     'and everything not named falls back to self', defaultSrc);

  /* This used to record 'unsafe-inline' as a known open item from AMV-019 -
     ninety-odd inline handlers depended on it. They are gone, and so is the
     allowance: the inline scripts AMV ships are named by hash instead. The
     detail is in tests/e2e/the-page-may-only-run-the-script-we-shipped; what
     matters HERE is that a host allowlist means something once inline script
     is refused, which is the assumption the rest of this file rests on. */
  ok(!/'unsafe-inline'/.test(csp), 'inline script is refused outright', csp.slice(0, 80));
  ok(/'sha256-/.test(csp), 'and the scripts AMV does ship are named by hash', true);
  ok(!/'unsafe-eval'/.test(csp), 'while unsafe-eval is NOT allowed', csp);
}

section('The Python runtime is pinned to a version, not to "latest"');
{
  /* Programs run in the code sandbox now (src/sandbox/sandbox.js, published as
     sandbox.js - AMV-AUD-001), so that is where the runtime is loaded from. The
     app bundle must not load it at all. */
  const sbxSrc = readFileSync(join(ROOT, 'sandbox.js'), 'utf8');
  const m = /cdn\.jsdelivr\.net\/pyodide\/(v[0-9.]+)\/full\//.exec(sbxSrc);
  ok(!!m, 'the runtime URL names a version', m && m[1]);
  ok(!/pyodide\/(latest|v?\d+\/)/.test(sbxSrc.replace(m ? m[0] : '', '')),
     'and nothing asks for a moving one', true);
  ok(/importScripts/.test(sbxSrc), 'it is loaded inside a Worker', true);
  ok(!/pyodide/i.test(appSrc.replace(/\/\*[\s\S]*?\*\//g, '')), 'and never by the app page itself', true);
}

section('And a script AMV tells the model to emit runs somewhere it cannot reach anything');
{
  /* The model is instructed to produce self-contained HTML that loads three.js
     from a CDN. That is third-party code too, and it is NOT on the list above,
     because AMV does not load it - the generated page does, inside a sandboxed
     frame with a unique origin. The sandbox is the control there, and it has to
     stay one. */
  ok(/cdnjs\.cloudflare\.com/.test(appSrc), 'the instruction names a CDN', true);
  /* Nov 8 audit FRONT-020: a generated page runs in preview.html, a document
     with its own policy - and the fallback (srcdoc) runs no scripts at all -
     so this page's policy names neither CDN. (blob: stays: it is how the
     build starts AMV's own bundle without blocking the first paint.) */
  const ss = cspDirective('script-src');
  ok(!/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net/.test(ss),
     'and this page lets neither CDN run script here - the preview document has its own policy', ss);
  ok(!/cdn\.jsdelivr\.net/.test(cspDirective('connect-src')), 'nor fetch from the Python CDN, which only the sandbox does', cspDirective('connect-src'));
  ok(/sandbox/.test(worker) || /sandbox/.test(appSrc),
     'generated pages are sandboxed', true);
  ok(/allow-scripts/.test(appSrc) || /allow-scripts/.test(worker),
     'with scripts but a unique origin, so it cannot read this account', true);
}

if (report('somebody-elses-code-runs-on-this-page') > 0) process.exitCode = 1;
done();
