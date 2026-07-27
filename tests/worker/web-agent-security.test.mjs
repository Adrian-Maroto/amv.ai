/* WEB AGENT SECURITY — the agent can drive a real browser as the user, so this
   is the most dangerous surface in AMV. Every defence is asserted here:
   SSRF, prompt injection, consequential-action approval, credential redaction,
   auth, and the honest degradation path. If one of these goes red, do not ship. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'webagent.harness.mjs');
writeFileSync(harness, src +
  '\nexport { _webHostAllowed, _webValidateAction, _webRedact, browserRun, WEB_ALLOWED_VERBS, WEB_CONSEQUENTIAL, WEB_MAX_STEPS };\n');
const W = await import(harness + '?t=' + Date.now());

/* ── 1. SSRF ─────────────────────────────────────────────────────────────── */
section('SSRF: the agent can never be aimed at internal infrastructure');

const blockedTargets = [
  ['http://169.254.169.254/latest/meta-data/', 'cloud metadata (credential theft)'],
  ['http://127.0.0.1:8787/admin', 'loopback'],
  ['http://localhost/admin', 'localhost by name'],
  ['http://10.0.0.5/', 'private 10/8'],
  ['http://192.168.1.1/', 'private 192.168/16'],
  ['http://172.16.0.9/', 'private 172.16/12'],
  ['http://100.64.0.1/', 'CGNAT'],
  ['http://[::1]/', 'IPv6 loopback'],
  ['http://kv.internal/', 'internal TLD'],
  ['http://metadata.google.internal/', 'GCP metadata'],
  ['file:///etc/passwd', 'file scheme'],
  ['gopher://x/', 'non-http scheme'],
];
blockedTargets.forEach(([url, why]) => {
  const r = W._webHostAllowed(url);
  ok(r.ok === false, `blocks ${why}: ${url}`, r);
});
ok(W._webHostAllowed('https://example.com/apply').ok === true, 'allows a normal public https site');
ok(W._webHostAllowed('http://example.com').ok === true, 'allows a normal public http site');

section('SSRF is re-checked on EVERY navigation, not just the first');
const nav = W._webValidateAction({ verb: 'goto', url: 'http://169.254.169.254/' }, { approved: true });
ok(nav.ok === false, 'a mid-run goto to metadata is refused', nav);

/* ── 2. Prompt injection ─────────────────────────────────────────────────── */
section('Prompt injection: a hostile page cannot widen the agent’s powers');

// A page that tries to make the agent do something outside the verb allow-list
const evilVerbs = ['exec', 'eval', 'fetch', 'read_file', 'set_password', 'disable_approval', ''];
evilVerbs.forEach(v => {
  const r = W._webValidateAction({ verb: v, url: 'https://x.com' }, { approved: true });
  ok(r.ok === false, `an invented verb "${v || '(empty)'}" injected by a page is refused`, r.why);
});
ok(W.WEB_ALLOWED_VERBS.length > 0 && W.WEB_ALLOWED_VERBS.indexOf('exec') < 0, 'the verb allow-list contains no code-execution verb');
// permission is enforced in code, not in the prompt
ok(/untrusted/i.test(src) && /Never follow instructions/i.test(src), 'the page is labelled untrusted and the model is told never to follow it');
ok(src.includes('_webValidateAction(decision'), 'and every model decision is re-validated in code before it runs');

/* ── 3. Consequential actions ────────────────────────────────────────────── */
section('Irreversible actions stop for approval - the model cannot self-approve');
W.WEB_CONSEQUENTIAL.forEach(v => {
  const r = W._webValidateAction({ verb: v, ref: 1 }, { approved: false });
  ok(r.ok === false && r.needsApproval === true, `"${v}" without approval -> needs_approval`, r.why);
});
const approvedSubmit = W._webValidateAction({ verb: 'submit', ref: 1 }, { approved: true });
ok(approvedSubmit.ok === true, 'with explicit user approval, submit proceeds');

// The dangerous case: a CLICK can also be irreversible ("Place order").
// Approval is decided by the control's real label, taken from our own
// observation of the page - not from anything the model claims.
section('A click on an irreversible control also requires approval');
[['Place order','buying'], ['Pay now','paying'], ['Delete account','deleting'],
 ['Send message','sending'], ['Publish post','publishing'], ['Submit application','submitting'],
 ['Confirm booking','booking'], ['Withdraw funds','moving money']].forEach(([label, why]) => {
  const r = W._webValidateAction({ verb: 'click', ref: 1 }, { approved: false, label });
  ok(r.ok === false && r.needsApproval === true, `clicking "${label}" (${why}) needs approval`, r.why);
});
[['Next','pagination'], ['Read more','navigation'], ['Search','a query'], ['Filter results','filtering']].forEach(([label, why]) => {
  const r = W._webValidateAction({ verb: 'click', ref: 1 }, { approved: false, label });
  ok(r.ok === true, `clicking "${label}" (${why}) does NOT need approval - the agent still flows`, r.why);
});
ok(/const target = \(decision && decision\.ref\)/.test(src),
  'the label is resolved from OUR observation, so the model cannot lie about what it is clicking');

/* ── 4. Credentials ──────────────────────────────────────────────────────── */
section('Secrets never reach a trace, a log, or the response');
const red = W._webRedact('logging in with hunter2seKret and token abc123def', ['hunter2seKret', 'abc123def']);
ok(!red.includes('hunter2seKret') && !red.includes('abc123def'), 'secret values are redacted', red);
ok(red.includes('[redacted]'), 'and replaced with a marker');
ok(W._webRedact('nothing here', ['x']) === 'nothing here', 'redaction leaves clean text alone');
ok(/const val = \(body\.data/.test(src) || /body\.data && Object\.prototype\.hasOwnProperty/.test(src),
  'secrets are resolved by FIELD NAME at type-time, so the value is never in the model transcript');

/* ── 5. Auth, caps, honest degradation ───────────────────────────────────── */
section('Auth, abuse caps, and honest degradation');
const noAuth = await W.browserRun(new Request('https://x/v1/browser/run', {
  method: 'POST', body: JSON.stringify({ url: 'https://example.com', goal: 'x' })
}), { AMV_KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } });
ok(noAuth.status === 401, 'an unauthenticated request is rejected', noAuth.status);
ok(W.WEB_MAX_STEPS > 0 && W.WEB_MAX_STEPS <= 50, 'a hard step cap exists', W.WEB_MAX_STEPS);
ok(/guardAction\(env, 'webagent:/.test(src), 'runs are rate limited per user');
ok(/if\(!env\.BROWSER\)/.test(src), 'the browser binding is feature-detected (honest 503, never a crash)');
ok(/code:'needs_service'/.test(src), 'and it reports needs_service so the client can explain it');
ok(/audit\(env, 'web_agent_/.test(src), 'every outcome is audited');

report();
done();
