/* THE GATE RAN AFTER THE CONNECTION IT WAS GUARDING.

   Every check on where the browser goes was a check on where it HAD GONE.
   `page.goto` follows redirects itself, so a perfectly ordinary public address
   answering 302 to http://169.254.169.254/ meant the browser opened the
   connection, sent the request, received the credentials and rendered them -
   and only then did the next line read page.url() and stop the run. The stop
   was real, and it was after the fact. The response had already been fetched,
   and on the step before it had already been put in front of the model.

   Navigation was also the only part anybody looked at. A page makes requests
   nobody instructed: an image, a stylesheet, a script, an XHR, a form post, a
   frame. None of those change page.url(), so none of them was checked at all -
   `<img src="http://192.168.1.1/reboot">` is a request from inside the
   operator's network past a gate that never sees it, and one line of script
   reads an internal answer and posts it back out.

   The only place that can be true is before the connection. This file drives
   the isolation layer with a page that reports exactly what a real one reports
   and asks what happens to each request - because the difference between
   "aborted" and "allowed, then complained about" is the entire finding, and
   both look identical in a trace. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'webisolate.harness.mjs');
writeFileSync(harness, src + '\nexport { _webIsolate };\n');
const W = await import(harness + '?t=' + Date.now());

/* An unhandled rejection anywhere in here is a failure, not a warning: this
   code runs inside a request handler the browser calls, and a rejection there
   ends the run for a reason nobody can see. */
const rejections = [];
process.on('unhandledRejection', (e) => rejections.push(String(e && e.message || e)));

/* A page as puppeteer presents one. `continue` and `abort` are async and both
   really can reject - a request that has already finished, a frame that has
   gone away - so they do here too, in the case that asks for it. */
function fakePage(opts = {}) {
  const p = {
    intercepting: false,
    handlers: {},
    seen: [],
    async setRequestInterception(v) { p.intercepting = v; },
    on(evt, fn) { p.handlers[evt] = fn; },
    /* Deliver a request the way the browser would, and report what was done. */
    fire(url, kind = 'document', o = {}) {
      const rec = { url, kind, verdict: null };
      p.seen.push(rec);
      p.handlers.request({
        url: () => { if (o.urlThrows) throw new Error('detached'); return url; },
        resourceType: () => { if (o.typeThrows) throw new Error('detached'); return kind; },
        continue: () => { rec.verdict = 'continued'; return opts.rejects ? Promise.reject(new Error('too late')) : Promise.resolve(); },
        abort: () => { rec.verdict = 'aborted'; return opts.rejects ? Promise.reject(new Error('too late')) : Promise.resolve(); },
      });
      return rec.verdict;
    },
  };
  return p;
}

const INTERNAL = [
  ['http://169.254.169.254/latest/meta-data/iam/security-credentials/', 'cloud metadata, which is the credentials'],
  ['http://127.0.0.1:8787/admin', 'the worker itself on loopback'],
  ['http://localhost/admin', 'loopback by name'],
  ['http://10.0.0.5/', 'a private 10/8 address'],
  ['http://192.168.1.1/reboot', 'the router on the other side'],
  ['http://172.16.0.9/', 'private 172.16/12'],
  ['http://100.64.0.1/', 'carrier-grade NAT'],
  ['http://[::1]/', 'IPv6 loopback'],
  ['http://kv.internal/', 'an internal TLD'],
  ['http://metadata.google.internal/', 'the other cloud metadata'],
  ['file:///etc/passwd', 'a file on disk'],
  ['gopher://x/', 'a scheme that is not the web'],
];

section('Interception is on before anything can be requested');
{
  const page = fakePage();
  const on = await W._webIsolate(page, () => {});
  ok(on === true, 'the layer reports that it is in place', on);
  ok(page.intercepting === true, 'and the browser is actually intercepting', page.intercepting);
  ok(typeof page.handlers.request === 'function', 'with a handler on every request', typeof page.handlers.request);
}

section('An internal address is aborted, not fetched and then complained about');
{
  /* The difference this file exists for. Under the old code every one of these
     was CONTINUED - the connection made, the answer read - and the run stopped
     on the next line. */
  const page = fakePage();
  const blocked = [];
  await W._webIsolate(page, (url, why, kind) => blocked.push({ url, why, kind }));
  for (const [url, what] of INTERNAL) {
    const verdict = page.fire(url, 'document');
    ok(verdict === 'aborted', 'never reaches ' + what, { url, verdict });
  }
  ok(blocked.length === INTERNAL.length, 'and every one of them is reported', blocked.length);
  ok(blocked[0].why && blocked[0].why.length > 5, 'with a reason', blocked[0].why);
  ok(blocked[0].url === INTERNAL[0][0], 'and the address it was aimed at', blocked[0].url);
}

section('A redirect hop is a request, and is checked like one');
{
  /* The case the after-the-fact check could never catch: the caller's URL is
     genuinely fine, and the answer is a 302. Puppeteer raises a fresh request
     for the hop, which is the moment the gate now gets. */
  const page = fakePage();
  const blocked = [];
  await W._webIsolate(page, (u, w, k) => blocked.push(u));
  ok(page.fire('https://harmless.example.com/go', 'document') === 'continued',
     'the address the person actually typed loads');
  ok(page.fire('http://169.254.169.254/latest/meta-data/', 'document') === 'aborted',
     'and the place it redirects to does not');
  ok(blocked.length === 1 && blocked[0].includes('169.254'), 'with the hop named', blocked);
}

section('And so is everything the page asks for that nobody instructed');
{
  /* None of these ever changed page.url(), so before interception not one of
     them was looked at. */
  const page = fakePage();
  await W._webIsolate(page, () => {});
  const kinds = [
    ['image', 'http://192.168.1.1/status.png', 'an image tag'],
    ['script', 'http://10.1.2.3/x.js', 'a script tag'],
    ['stylesheet', 'http://kv.internal/x.css', 'a stylesheet'],
    ['xhr', 'http://127.0.0.1:8787/v1/admin/users', 'a fetch from a script'],
    ['fetch', 'http://169.254.169.254/latest/api/token', 'a fetch for the metadata token'],
    ['document', 'http://192.168.0.1/', 'an iframe'],
    ['websocket', 'http://[::1]:9000/', 'a websocket'],
  ];
  for (const [kind, url, what] of kinds)
    ok(page.fire(url, kind) === 'aborted', what + ' cannot reach an internal address', { kind, url });

  /* And the ordinary web still loads, or this is not isolation, it is an
     outage. */
  for (const [kind, url] of [['image', 'https://cdn.example.com/logo.png'],
                             ['script', 'https://example.com/app.js'],
                             ['xhr', 'https://api.example.com/v1/items'],
                             ['document', 'https://example.com/next']])
    ok(page.fire(url, kind) === 'continued', 'a normal ' + kind + ' still loads', url);
}

section('What never leaves the browser is left alone');
{
  /* An inline image, a generated blob, a blank frame. Refusing these would
     break ordinary pages and protect nothing, and a control that breaks the
     product is a control somebody switches off. */
  const page = fakePage();
  await W._webIsolate(page, () => {});
  for (const url of ['data:image/png;base64,iVBORw0KGgo=', 'blob:https://example.com/abc-123',
                     'about:blank', 'about:srcdoc'])
    ok(page.fire(url, 'other') === 'continued', 'passes through: ' + url.slice(0, 28));
}

section('A page cannot end the run by malforming a request');
{
  /* Everything here runs inside a handler the browser calls. A throw or an
     unhandled rejection in it takes the session down, which makes an isolation
     layer into a denial of service any page can trigger. */
  const page = fakePage();
  await W._webIsolate(page, () => {});
  ok(page.fire('', 'document') === 'aborted', 'an empty URL is refused rather than allowed');
  ok(page.fire('http://', 'document') === 'aborted', 'and so is an unparseable one');

  const t = fakePage();
  await W._webIsolate(t, () => {});
  let threw = null;
  try { t.fire('https://example.com/', 'document', { urlThrows: true }); }
  catch (e) { threw = e; }
  ok(threw === null, 'a request whose URL cannot be read does not throw out of the handler', threw && threw.message);
  ok(t.seen[t.seen.length - 1].verdict === 'aborted',
     'and is refused, because unknown is not the same as allowed', t.seen[t.seen.length - 1].verdict);

  let typeThrew = null;
  try { t.fire('http://10.0.0.1/', 'document', { typeThrows: true }); }
  catch (e) { typeThrew = e; }
  ok(typeThrew === null, 'nor does one whose kind cannot be read', typeThrew && typeThrew.message);
  ok(t.seen[t.seen.length - 1].verdict === 'aborted', 'and it is still refused');

  /* A reporter that throws is the caller's bug, and it must not become the
     page's weapon. */
  const r = fakePage();
  await W._webIsolate(r, () => { throw new Error('reporter is broken'); });
  let repThrew = null;
  try { r.fire('http://127.0.0.1/', 'document'); } catch (e) { repThrew = e; }
  ok(repThrew === null, 'a broken reporter does not reach the browser', repThrew && repThrew.message);
  ok(r.seen[0].verdict === 'aborted', 'and the request is still refused', r.seen[0].verdict);
}

section('And neither continue nor abort can leave a rejection behind');
{
  const page = fakePage({ rejects: true });
  await W._webIsolate(page, () => {});
  page.fire('https://example.com/', 'document');
  page.fire('http://169.254.169.254/', 'document');
  await new Promise(r => setTimeout(r, 30));
  ok(rejections.length === 0, 'nothing was left unhandled', rejections);
}

section('A driver that cannot intercept is refused, not quietly downgraded');
{
  /* The honest-degradation case. Without interception the only isolation
     available is the after-the-fact kind this finding is about - and a run that
     reports the same success either way cannot tell anybody which one they
     got. */
  ok(await W._webIsolate({ on() {} }, () => {}) === false, 'a page with no interception reports false');
  ok(await W._webIsolate(null, () => {}) === false, 'and so does no page at all');

  const run = codeOnly(functionBody(src, 'browserRun') || '');
  ok(run.length > 2000, 'the handler was read', run.length);
  ok(/if\(!isolated\)/.test(run), 'the run checks the answer', true);
  ok(/code:'needs_service'/.test(run.slice(run.indexOf('if(!isolated)'))),
     'and refuses with something the app can explain rather than running anyway', true);
  ok(/web_agent_no_isolation/.test(run), 'and it is on the record', true);
}

section('It is armed before the first request, not after it');
{
  /* The ordering IS the fix. Interception set up after the opening goto leaves
     exactly the hole the finding describes, and every behavioural check above
     would still pass. */
  const run = codeOnly(functionBody(src, 'browserRun') || '');
  const iIsolate = run.indexOf('_webIsolate(page');
  const iGoto = run.indexOf('page.goto(gate.url');
  const iNewPage = run.indexOf('browser.newPage()');
  ok(iIsolate > -1 && iGoto > -1, 'both were found', { isolate: iIsolate, goto: iGoto });
  ok(iIsolate > iNewPage && iIsolate < iGoto,
     'isolation is in place before the first page is loaded', { newPage: iNewPage, isolate: iIsolate, goto: iGoto });

  /* The after-the-fact check stays as well. It catches what interception
     cannot: a same-origin navigation that ends somewhere the gate refuses, and
     anything a future driver change lets slip. Two controls, not one replacing
     the other. */
  ok(/_landedSomewhereBlocked/.test(run), 'and the check on where it ended up is still there too', true);
}

if (report('nothing-is-fetched-before-it-is-allowed') > 0) process.exitCode = 1;
done();
