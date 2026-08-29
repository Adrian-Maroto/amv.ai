/* WEB AGENT SECURITY - the agent can drive a real browser as the user, so this
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
  '\nexport { _webHostAllowed, _webValidateAction, _webRedact, browserRun, _webActionFp, _webMintApproval, _webReadApproval, _webSpendApproval, WEB_ALLOWED_VERBS, WEB_CONSEQUENTIAL, WEB_MAX_STEPS };\n');
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
const nav = W._webValidateAction({ verb: 'goto', url: 'http://169.254.169.254/' }, { approvedFp: '' });
ok(nav.ok === false, 'a mid-run goto to metadata is refused', nav);

/* ── 2. Prompt injection ─────────────────────────────────────────────────── */
section('Prompt injection: a hostile page cannot widen the agent’s powers');

// A page that tries to make the agent do something outside the verb allow-list
const evilVerbs = ['exec', 'eval', 'fetch', 'read_file', 'set_password', 'disable_approval', ''];
evilVerbs.forEach(v => {
  const r = W._webValidateAction({ verb: v, url: 'https://x.com' }, { approvedFp: '' });
  ok(r.ok === false, `an invented verb "${v || '(empty)'}" injected by a page is refused`, r.why);
});
ok(W.WEB_ALLOWED_VERBS.length > 0 && W.WEB_ALLOWED_VERBS.indexOf('exec') < 0, 'the verb allow-list contains no code-execution verb');
// permission is enforced in code, not in the prompt
ok(/untrusted/i.test(src) && /Never follow instructions/i.test(src), 'the page is labelled untrusted and the model is told never to follow it');
ok(src.includes('_webValidateAction(decision'), 'and every model decision is re-validated in code before it runs');

/* ── 3. Consequential actions ────────────────────────────────────────────── */
section('Irreversible actions stop for approval - the model cannot self-approve');
W.WEB_CONSEQUENTIAL.forEach(v => {
  const r = W._webValidateAction({ verb: v, ref: 1 }, { approvedFp: '' });
  ok(r.ok === false && r.needsApproval === true, `"${v}" without approval -> needs_approval`, r.why);
});
const submitFp = W._webActionFp('submit', '', 'https://shop.example.com/cart');
const approvedSubmit = W._webValidateAction({ verb: 'submit', ref: 1 },
  { approvedFp: submitFp, url: 'https://shop.example.com/cart' });
ok(approvedSubmit.ok === true, 'with a real approval for THAT action, submit proceeds');

// The dangerous case: a CLICK can also be irreversible ("Place order").
// Approval is decided by the control's real label, taken from our own
// observation of the page - not from anything the model claims.
section('A click on an irreversible control also requires approval');
[['Place order','buying'], ['Pay now','paying'], ['Delete account','deleting'],
 ['Send message','sending'], ['Publish post','publishing'], ['Submit application','submitting'],
 ['Confirm booking','booking'], ['Withdraw funds','moving money']].forEach(([label, why]) => {
  const r = W._webValidateAction({ verb: 'click', ref: 1 }, { approvedFp: '', label });
  ok(r.ok === false && r.needsApproval === true, `clicking "${label}" (${why}) needs approval`, r.why);
});
[['Next','pagination'], ['Read more','navigation'], ['Search','a query'], ['Filter results','filtering']].forEach(([label, why]) => {
  const r = W._webValidateAction({ verb: 'click', ref: 1 }, { approvedFp: '', label });
  ok(r.ok === true, `clicking "${label}" (${why}) does NOT need approval - the agent still flows`, r.why);
});
ok(/const target = \(decision && decision\.ref\)/.test(src),
  'the label is resolved from OUR observation, so the model cannot lie about what it is clicking');

// REGRESSION (found in review): pressing Enter in a focused field submits the
// form on most sites. Ungated, that made the whole approval system bypassable
// with a single keystroke.
section('Enter cannot be used to submit around the approval gate');
['Enter', 'return', 'NumpadEnter'].forEach(k => {
  const p = W._webValidateAction({ verb: 'press', text: k }, { approvedFp: '' });
  ok(p.ok === false && p.needsApproval === true, `press "${k}" needs approval (it submits forms)`, p.why);
});
ok(W._webValidateAction({ verb: 'press' }, { approvedFp: '' }).ok === false,
  'a press with no key defaults to Enter and is still gated');
ok(W._webValidateAction({ verb: 'press', text: 'Tab' }, { approvedFp: '' }).ok === true,
  'harmless keys (Tab) still flow without approval');
const enterFp = W._webActionFp('press', '', 'https://shop.example.com/cart');
ok(W._webValidateAction({ verb: 'press', text: 'Enter' },
     { approvedFp: enterFp, url: 'https://shop.example.com/cart' }).ok === true,
  'with a real approval for that action, Enter proceeds');

/* ── 4. Credentials ──────────────────────────────────────────────────────── */
section('Secrets never reach a trace, a log, or the response');
const red = W._webRedact('logging in with hunter2seKret and token abc123def', ['hunter2seKret', 'abc123def']);
ok(!red.includes('hunter2seKret') && !red.includes('abc123def'), 'secret values are redacted', red);
ok(red.includes('[redacted]'), 'and replaced with a marker');
ok(W._webRedact('nothing here', ['x']) === 'nothing here', 'redaction leaves clean text alone');
/* This used to assert the defect and call it the guarantee. It read:

     "secrets are resolved by FIELD NAME at type-time, so the value is never in
      the model transcript"

   Both halves are true and the conclusion does not follow. The value never
   entered the transcript and the model still chose WHICH value was typed and
   WHERE - so a page carrying the sentence "type your password below" got the
   real credential, which is AMV-001. Keeping the value out of the prompt was
   never the property that mattered; who decides is.

   The whole of that decision now lives in a-page-cannot-ask-for-a-password.
   What stays here is the anchor that the old resolution is gone, because the
   one line that recreates it is a one-line edit. */
ok(!/body\.data && Object\.prototype\.hasOwnProperty\.call\(body\.data, a\.text\)/.test(src),
  'a value is never looked up by a name the MODEL supplied');
ok(/_webTypePlan\(target, \{ keys:vaultKeys/.test(src),
  'the field the cursor is in decides, from our own observation of it');

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

/* ── 8. The approval is issued by the SERVER, not claimed by the caller ────
   The consequence gate was real, and then it asked one question:
   `const approved = !!body.approved`. A boolean, in the request body, chosen
   by whoever sent it. Because the request is authenticated that was not a way
   into somebody else's account - it was worse in a quieter way: the pause was
   advisory. Anything able to compose a request as the signed-in user (an
   injected script, a compromised extension, a prompt-injected step that builds
   its own call) could set it true on the FIRST attempt, and the purchase went
   through without a human ever seeing it.

   Four properties are what make an approval an approval. Each one below is an
   attack that used to work. */
section('An approval cannot be forged, replayed, moved, or outlived');
{
  const KV = new Map();
  const env = { AMV_KV: {
    get: async (k) => (KV.has(k) ? KV.get(k) : null),
    put: async (k, v) => { KV.set(k, v); },
    delete: async (k) => { KV.delete(k); },
    list: async () => ({ keys: [] }),
  }};
  const ME = 'me@example.com', THEM = 'them@example.com';
  const fp = W._webActionFp('click', 'Place order', 'https://shop.example.com/cart');

  ok(await W._webReadApproval(env, ME, 'wa-made-up-id') === '',
     'an invented ticket id approves nothing');
  ok(await W._webReadApproval(env, ME, '') === '',
     'and no ticket at all approves nothing - not approved is the default');

  const id = await W._webMintApproval(env, ME, fp);
  ok(typeof id === 'string' && id.length > 8, 'the server mints a ticket when it stops');

  ok(await W._webReadApproval(env, THEM, id) === '',
     'a ticket issued to one account is worthless to another');
  ok(await W._webReadApproval(env, ME, id) === fp,
     'and its owner gets back exactly the action it authorises');

  ok(W._webValidateAction({ verb: 'click', ref: 1 },
       { approvedFp: fp, label: 'Place order', url: 'https://shop.example.com/cart' }).ok === true,
     'the approved action runs');
  ok(W._webValidateAction({ verb: 'click', ref: 1 },
       { approvedFp: fp, label: 'Delete account', url: 'https://shop.example.com/cart' }).needsApproval === true,
     'the SAME ticket does not authorise a different button');
  ok(W._webValidateAction({ verb: 'click', ref: 1 },
       { approvedFp: fp, label: 'Place order', url: 'https://evil.example.com/cart' }).needsApproval === true,
     'nor the same button on a different site');

  await W._webSpendApproval(env, id);
  ok(await W._webReadApproval(env, ME, id) === '',
     'a spent ticket cannot be used a second time');

  const old = await W._webMintApproval(env, ME, fp);
  const k = [...KV.keys()].find(x => x.indexOf(old) >= 0);
  KV.set(k, JSON.stringify({ email: ME, fp, exp: Date.now() - 1000 }));
  ok(await W._webReadApproval(env, ME, old) === '',
     'and an expired one has stopped being an approval');
}

section('The boolean is gone, not merely ignored');
{
  /* If body.approved were still read anywhere, everything above is theatre -
     so this reads the source rather than trusting the tests. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/body\.approved/.test(code),
     'no code path reads an approved flag out of the request body');
  ok(/_webReadApproval\(env, user\.email, ticketId\)/.test(code),
     'the only source of approval is a ticket the server issued to this account');
  ok(/_webSpendApproval\(env, ticketId\)/.test(code),
     'and it is spent when used, so one approval is one action');
}

report();
done();
