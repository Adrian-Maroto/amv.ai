/* AN ATTRIBUTE IS A SCRIPT, AND A HUNDRED OF THEM WERE THE HEADER.

   `script-src 'unsafe-inline'` says: run any inline script on this page. It is
   the one header that decides what an XSS anywhere in AMV is worth. With it,
   a single injected `<script>` reads the access token out of localStorage and
   the session is somebody else's. Without it, the same injection does nothing,
   because the browser has a list of exactly which scripts this page ships and
   an injected one is not on it.

   AMV-019 moved the refresh token to an HttpOnly cookie - the half that could
   be done without touching the UI - and left this half open, correctly, with
   the reason written down: about a hundred onclick attributes depended on
   'unsafe-inline', and there is no partial credit. Removing the directive with
   one attribute left does not harden anything; it breaks that button. On a
   payment screen that is a worse product than the one with the weaker header.

   So this file is about the whole of it at once, and it checks the two things
   that have to be true together:

     - script-src does not allow inline script, and names the scripts it does
       allow by hash;
     - nothing in the shipped page carries an event-handler attribute, so
       there is no button whose behaviour the header just deleted.

   The second is the one that rots. `onclick="..."` is the shortest way to wire
   a button and it will be reached for again; the check is on the built
   artifact rather than the sources so it cannot be routed around by writing
   the attribute in a template.

   It is also the reason a real bug shipped: an inline handler on an element
   that ALSO carries data-dact runs during the bubble and kills the delegated
   dispatch, so the button does nothing at all, silently. That is LESSONS #5,
   it shipped on the recent-chats row, and there were thirty-seven more
   elements written the same way. Removing the attributes removes that class.

   Booted in a real browser at the end, because a CSP that blocks the app's own
   bundle is exactly the failure this change could cause and it does not show
   up in any amount of string matching. */
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { chromium } from 'playwright';
import { serveApp, LAUNCH } from '../lib/harness.mjs';
import { codeOnly } from '../lib/source.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([\s\S]*?)">/) || [, ''])[1];
const scriptSrc = (csp.match(/(?:^|\n)\s*script-src\s([^;]*);/) || [, ''])[1].trim();

section('The header does not allow inline script');
{
  ok(!!csp, 'the page carries a Content-Security-Policy');
  ok(!!scriptSrc, 'with a script-src directive', scriptSrc.slice(0, 60));
  ok(!/'unsafe-inline'/.test(scriptSrc),
     "THE FINDING: script-src does not allow 'unsafe-inline'", scriptSrc);
  ok(!/'unsafe-eval'/.test(scriptSrc), "nor 'unsafe-eval'", scriptSrc);
  /* 'unsafe-hashes' would re-admit event-handler attributes by hash, which is
     the same hole with more steps. The point is that the attributes are gone. */
  ok(!/'unsafe-hashes'/.test(scriptSrc), "nor 'unsafe-hashes'", scriptSrc);
}

section('It names what it does allow, by hash');
{
  const hashes = scriptSrc.split(/\s+/).filter(t => /^'sha256-/.test(t));
  ok(hashes.length >= 3,
     'script-src pins the inline scripts by sha256', hashes.length);

  /* Every executable inline script on the page must be one of them. A script
     with no hash is a script that will not run - and the way to find that out
     should not be a blank page in production. */
  const missing = [];
  const RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = RE.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = (attrs.match(/\btype\s*=\s*["']([^"']*)["']/i) || [, ''])[1].toLowerCase();
    if (type && !/^(text|application)\/(java|ecma)script$/.test(type)) continue;
    const h = "'sha256-" + createHash('sha256').update(Buffer.from(m[2], 'utf8')).digest('base64') + "'";
    if (hashes.indexOf(h) < 0) missing.push(attrs.slice(0, 40) || '(no attributes)');
  }
  ok(missing.length === 0,
     'and every inline script the browser would execute is covered by one', missing);

  /* The launcher falls back to running the bundle inline when a blob URL
     cannot be created. Its hash has to be there too or that fallback is a
     blocked script and the app does not start at all on those browsers. */
  const app = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const inert = (html.match(/<script id="amv-app-code" type="text\/plain">\n([\s\S]*?)\n<\/script>/) || [, ''])[1];
  const restored = inert.split('<\\/scr_AMV_ipt').join('</script');
  ok(!!restored, 'the bundle is embedded as an inert block');
  const bundleHash = "'sha256-" + createHash('sha256').update(Buffer.from(restored, 'utf8')).digest('base64') + "'";
  ok(hashes.indexOf(bundleHash) >= 0,
     'the inline fallback for the bundle is allowed rather than silently blocked');
  ok(app.length > 0, 'and the readable bundle is written beside it', app.length);
}

section('THE OTHER HALF: nothing on the page is wired by attribute');
{
  /* Any of these in the shipped artifact is a control that the header above
     has just turned off. Searched over the whole file, which includes the
     bundle - so a template that emits one is caught the same as markup. */
  const EVENTS = ['click', 'dblclick', 'mousedown', 'mouseup', 'mouseenter', 'mouseleave',
                  'mouseover', 'mouseout', 'focus', 'blur', 'change', 'input', 'submit',
                  'load', 'error', 'keydown', 'keyup', 'keypress', 'contextmenu',
                  'touchstart', 'touchend', 'wheel', 'scroll', 'drop', 'dragover'];
  const found = [];
  for (const ev of EVENTS) {
    const re = new RegExp('\\son' + ev + '\\s*=\\s*["\'`]', 'gi');
    const hits = html.match(re);
    if (hits) found.push(ev + ' x' + hits.length);
  }
  ok(found.length === 0,
     'no event-handler attribute survives anywhere in the built page', found);

  /* javascript: in an href is inline script by another spelling, and is the
     one form CSP still blocks only when unsafe-inline is absent. */
  ok(!/(href|src|action)\s*=\s*["']\s*javascript:/i.test(html),
     'and no attribute smuggles one in as a javascript: URL');
}

section('And the delegation that replaced them is still the only dispatcher');
{
  /* Comments stripped first. Both of these patterns are WRITTEN OUT in prose
     right beside the code that removed them - the LESSONS #5 note quotes the
     dispatcher, and two headers quote the attribute they are about - so a raw
     match counts the explanation as an instance and fails on correct code.
     That is the proxy-assertion class from LESSONS #255; it went red here on
     the first run. */
  const app = codeOnly(readFileSync(join(ROOT, 'app.js'), 'utf8'));

  /* One listener on document, resolving with closest() - the design the
     attributes were fighting. If a second dispatcher appears the guarantee
     above stops meaning what it says. */
  const dispatchers = app.match(/closest\('\[data-dact\]'\)/g) || [];
  ok(dispatchers.length === 1,
     'exactly one place resolves a data-dact element', dispatchers.length);

  /* A backdrop asks "did the click land on me". Nothing asks it by stopping
     the click on the panel, because that kills every delegated button inside. */
  const panelGuards = app.match(/onclick="event\.stopPropagation\(\)"/g) || [];
  ok(panelGuards.length === 0,
     'no overlay panel cancels the click its own buttons need', panelGuards.length);
  ok(/const onBackdrop\s*=/.test(app),
     'the backdrop rule lives in one helper');
}

section('The one directive a meta tag cannot deliver is not left as a claim');
{
  /* Found by this file, on its first run, in the browser: Chromium says
     `frame-ancestors` is IGNORED when delivered via <meta>. Not "on some
     browsers" - the spec says a meta policy must drop it, so it has never
     applied anywhere. A directive that never applies is a defence on paper,
     which is the thing AMV is not allowed to ship.

     The API sends X-Frame-Options and frame-ancestors as real headers, so the
     Worker is covered. The static page cannot, and it is the surface with the
     approve-a-payment and delete-my-account buttons on it. So the page checks
     for itself, in code that runs: framed by somebody else, and not the
     embeddable widget being framed on purpose, means it refuses to render. */
  const app = codeOnly(readFileSync(join(ROOT, 'app.js'), 'utf8'));
  ok(/_framedWithoutPermission/.test(app),
     'the page decides for itself whether being framed is allowed', true);
  ok(/embed=1/.test(app.slice(app.indexOf('function _framedWithoutPermission'),
                              app.indexOf('function _framedWithoutPermission') + 900)),
     'and the widget, which is framed on purpose, is the exception', true);
}

section('The app still starts, in a browser, under that header');
{
  /* The whole point of doing this properly. A CSP is enforced by the browser
     and by nothing else, so a wrong hash reads as green everywhere above and
     as a blank page to a customer. */
  /* Booted by hand rather than through bootApp, because the refusal this is
     looking for happens DURING the load - a listener attached afterwards sees
     a clean console and a dead page. */
  const { url, server } = await serveApp();
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });

  /* REFUSALS, not every line that mentions the policy. Chromium also prints a
     delivery warning about frame-ancestors in a meta tag, which is a true
     statement about CSP rather than something this page did wrong - it is
     handled in its own section above. Matching it here would have made this
     assertion fail for ever on a correct page, which is how a check stops
     being read. */
  const violations = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (/Refused to (execute|load|apply|connect|frame|run)/i.test(t) ||
        /violates the following Content Security Policy directive/i.test(t)) {
      violations.push(t.slice(0, 200));
    }
  });
  page.on('pageerror', (e) => {
    if (/violates the following Content Security Policy/i.test(e.message)) {
      violations.push(e.message.slice(0, 200));
    }
  });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(900);

  const booted = await page.evaluate(() => ({
    hasState: typeof S === 'object' && S !== null,
    hasDispatch: typeof closeOvr === 'function',
    hasBackdrop: typeof onBackdrop === 'function',
    painted: !!document.querySelector('#app, #land'),
  }));
  ok(booted.hasState, 'the bundle ran and the app state exists', booted);
  ok(booted.hasDispatch && booted.hasBackdrop, 'its functions are on the page', booted);
  ok(booted.painted, 'and something is rendered', booted);
  ok(violations.length === 0, 'with no CSP violation reported by the browser', violations);

  /* One delegated button, end to end, because "the attributes are gone" and
     "the buttons work" are different claims and only the second one matters. */
  const closed = await page.evaluate(async () => {
    const r = document.getElementById('ovr');
    if (!r) return 'no overlay root';
    r.innerHTML = '<div class="ov" id="t-bg"><div class="ob">' +
                  '<button class="oc" id="t-x" data-dact="closeOvr">x</button></div></div>';
    document.getElementById('t-x').click();
    await new Promise((res) => setTimeout(res, 60));
    return r.innerHTML === '' ? 'closed' : 'still open';
  });
  ok(closed === 'closed', 'a close button wired by data-dact still closes', closed);

  /* AND THE FRAME GUARD, REALLY FRAMED.

     Source matching proved the function exists. This proves it fires, from a
     genuinely different origin - a second server on a second port, which is a
     different origin to the browser in every way that matters. A guard nobody
     has watched refuse anything is not a guard. */
  const outer = createServer((req, res) => {
    const target = url + (String(req.url || '').indexOf('embed') >= 0 ? '/#embed=1&k=pk_test' : '/');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>not amv</title><iframe id="f" src="' + target +
            '" style="width:900px;height:700px"></iframe>');
  });
  await new Promise((r) => outer.listen(9188, r));

  const framed = await page.goto('http://127.0.0.1:9188/', { waitUntil: 'load' })
    .then(() => page.waitForTimeout(1400))
    .then(() => page.frames().length > 1 ? page.frames()[1].evaluate(() => ({
      refused: !!document.querySelector('.fstop'),
      body: (document.body.textContent || '').slice(0, 90),
    })) : { refused: null, body: 'no frame' });
  ok(framed.refused === true,
     'framed by another origin, AMV refuses to render', framed);
  ok(/does not run inside another site/i.test(framed.body || ''),
     'and says why, rather than showing a blank rectangle', framed.body);

  /* The widget is the exception and has to keep working, or this traded
     clickjacking for a broken product on every customer site that embeds it. */
  const widget = await page.goto('http://127.0.0.1:9188/?embed', { waitUntil: 'load' })
    .then(() => page.waitForTimeout(1400))
    .then(() => page.frames().length > 1 ? page.frames()[1].evaluate(() => ({
      refused: !!document.querySelector('.fstop'),
      widget: !!document.querySelector('.emb-root'),
    })) : { refused: null, widget: null });
  ok(widget.refused === false, 'the embeddable widget is still allowed to be framed', widget);
  ok(widget.widget === true, 'and renders the chat panel', widget);

  outer.close();
  await browser.close();
  server.close();
}

if (report('the-page-may-only-run-the-script-we-shipped') > 0) process.exitCode = 1;
done();
