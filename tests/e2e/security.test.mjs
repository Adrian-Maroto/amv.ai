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
