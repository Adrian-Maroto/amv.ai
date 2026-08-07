/* THERE WAS NOWHERE FOR A BUG REPORT TO GO.

   The in-app report wrote to localStorage and only transmitted if
   `amv_feedback_endpoint` was set - a key no screen in the product could
   write. And there was no server route to write to either: /v1/feedback is the
   thumbs up/down counter, which deliberately stores no content and would have
   refused a sentence. So somebody reporting a broken payment was thanked, told
   the team had it, and their words sat in their own browser for ever.

   The screen was fixed first, to stop claiming a delivery that never happened.
   That left the real problem: a product taking money with no way to be told it
   is broken. Every problem that could have been a reply becomes a refund, a
   chargeback, or a public review.

   The assertions that matter here are the two nobody asks for. A support inbox
   fills up with other people's words about their own accounts, so it has to be
   erased with the account and appear in their export - which is why a ticket is
   stored under the reporter's email rather than a ticket id. And reaching a
   human is worth money, which makes it worth abusing. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'support.harness.mjs');
writeFileSync(harness, src +
  '\nexport { DB, supportSubmit, supportInbox, PER_USER_KINDS, BACKUP_PREFIXES };' +
  '\nexport function __setRequireUser(fn){ requireUser = fn; }\n');
const W = await import(harness + '?t=' + Date.now());

let notified = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  notified.push(String((opts && opts.body) || ''));
  return { ok: true, status: 200, json: async () => ({}) };
};

function mkEnv(extra) {
  const m = new Map();
  notified = [];
  return Object.assign({
    ADMIN_TOKEN: 'admintok',
    JWT_SECRET: 'jwtsecret',
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        let keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        if (limit) keys = keys.slice(0, limit);
        return { keys, list_complete: true };
      },
    },
  }, extra || {});
}
const req = (body, email) => new Request('https://api.amv.dev/v1/support', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer t:' + (email || 'a@x.com'),
             'CF-Connecting-IP': '1.2.3.4' },
  body: JSON.stringify(body || {}),
});
/* requireUser is exercised exhaustively in worker/auth; here the caller is
   stated directly so each case is about the support route itself. */
W.__setRequireUser(async (request) => {
  const h = request.headers.get('Authorization') || '';
  const em = h.startsWith('Bearer t:') ? h.slice(9) : '';
  return em ? { email: em } : null;
});

section('A report is really stored, on the server');
{
  const env = mkEnv({ ALERT_WEBHOOK: 'https://hooks.example/x' });
  const r = await W.supportSubmit(req({ kind: 'bug', text: 'Checkout spins forever on the Pro plan.' }), env);
  const d = await r.json();
  ok(r.status === 200 && d.ok === true, 'it is accepted', d);
  ok(d.stored === true, 'and says so', d.stored);

  const rec = await W.DB.get(env, 'support', 'a@x.com');
  ok(rec && rec.tickets.length === 1, 'the ticket exists in storage the server owns', rec && rec.tickets.length);
  ok(/Checkout spins forever/.test(rec.tickets[0].text),
     'with what they actually wrote', rec.tickets[0].text);
}

section('And the operator is told now, not whenever they think to look');
{
  const env = mkEnv({ ALERT_WEBHOOK: 'https://hooks.example/x' });
  const r = await W.supportSubmit(req({ kind: 'billing', text: 'I was charged twice this month.' }), env);
  const d = await r.json();
  ok(d.notified === true, 'the answer reports a real delivery', d.notified);
  ok(notified.some(n => /charged twice/.test(n)), 'and one really went out', notified.length);
  ok(notified.some(n => /a@x\.com/.test(n)), 'carrying who to reply to', true);
}

section('With no webhook it stores it and does NOT claim anybody was told');
{
  /* The whole reason this route exists is that the old one claimed a delivery
     it had not made. Repeating that here would be the same defect one layer
     down, and the client shows a different sentence for each. */
  const env = mkEnv({});
  const r = await W.supportSubmit(req({ kind: 'bug', text: 'The export button does nothing at all.' }), env);
  const d = await r.json();
  ok(d.ok === true && d.stored === true, 'it is still kept', d);
  ok(d.notified === false, 'and it does not pretend a person has seen it', d.notified);
  const rec = await W.DB.get(env, 'support', 'a@x.com');
  ok(rec.tickets.length === 1, 'the operator will find it in the inbox', rec.tickets.length);
}

section('It is bounded, because reaching a human is worth abusing');
{
  const env = mkEnv({});
  let refused = 0;
  for (let i = 0; i < 12; i++) {
    const r = await W.supportSubmit(req({ kind: 'bug', text: 'spam number ' + i }), env);
    if (r.status === 429) refused++;
  }
  ok(refused > 0, 'a flood from one account is throttled', refused);
  const rec = await W.DB.get(env, 'support', 'a@x.com');
  ok(rec.tickets.length <= 20, 'and one account cannot grow without limit', rec.tickets.length);
}

section('Signing in is required, and refused honestly');
{
  const env = mkEnv({});
  const anon = new Request('https://api.amv.dev/v1/support', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'bug', text: 'something is broken' }),
  });
  const r = await W.supportSubmit(anon, env);
  const d = await r.json();
  ok(r.status === 401, 'an anonymous report is refused', r.status);
  ok(/email support directly/i.test(d.error || ''),
     'and the refusal names the other way to reach a person', d.error);
}

section('An empty report is not a ticket');
{
  const env = mkEnv({});
  const r = await W.supportSubmit(req({ kind: 'bug', text: '  ' }), env);
  ok(r.status === 400, 'nothing to act on is rejected', r.status);
  ok(!(await W.DB.get(env, 'support', 'a@x.com')), 'and nothing is stored', true);
}

section('It carries context, and NOT the conversation');
{
  /* Somebody reporting that chat is broken has not agreed to send us what they
     were chatting about. */
  const env = mkEnv({});
  await W.supportSubmit(req({ kind: 'bug', text: 'chat broke',
    plan: 'pro', tab: 'chat', messages: [{ role: 'user', content: 'MY PRIVATE MESSAGE' }] }), env);
  const rec = await W.DB.get(env, 'support', 'a@x.com');
  const t = rec.tickets[0];
  ok(t.plan === 'pro' && t.tab === 'chat', 'the useful context is kept', { plan: t.plan, tab: t.tab });
  ok(!/PRIVATE MESSAGE/.test(JSON.stringify(rec)),
     'and nothing they did not choose to send', JSON.stringify(rec).slice(0, 120));
}

section('The inbox is the operator’s, behind the admin token');
{
  const env = mkEnv({});
  await W.supportSubmit(req({ kind: 'bug', text: 'first report' }, 'one@x.com'), env);
  await W.supportSubmit(req({ kind: 'idea', text: 'second report' }, 'two@x.com'), env);

  const bad = await W.supportInbox(new Request('https://api.amv.dev/v1/admin/support', {
    headers: { 'Authorization': 'Bearer wrong' } }), env);
  ok(bad.status === 403, 'a wrong token reads nobody’s messages', bad.status);

  const good = await W.supportInbox(new Request('https://api.amv.dev/v1/admin/support', {
    headers: { 'Authorization': 'Bearer admintok' } }), env);
  const d = await good.json();
  ok(good.status === 200, 'the operator can read them', good.status);
  ok(d.tickets.length === 2, 'both accounts’ reports are there', d.tickets.length);
  ok(d.tickets.every(t => !!t.email), 'each says who to reply to', true);
  ok(d.tickets[0].at >= d.tickets[1].at, 'newest first, which is the one waiting', true);
}

section('A support inbox does not outlive the person who wrote into it');
{
  /* The assertion nobody asks for. Other people's words about their own
     accounts accumulate here faster than anywhere else in the product, and a
     record that erasure does not know about survives the account silently.
     Keying tickets by the reporter's email is what puts them on the one list
     that both deletion and export walk. */
  ok(W.PER_USER_KINDS.includes('support'),
     'support is erased with the account, and included in their export', W.PER_USER_KINDS.includes('support'));
  ok(W.BACKUP_PREFIXES.includes('support:'),
     'and a restore does not lose the customers waiting on a reply', true);
}

section('The old dead end is gone from the product');
{
  const client = readFileSync(join(ROOT, 'src', 'app', '01-core.js'), 'utf8');
  ok(/'\/v1\/support'/.test(client), 'the app has a method that posts a report', true);
  const ui = readFileSync(join(ROOT, 'src', 'app', '12-handoff.js'), 'utf8');
  ok(/AMV_API\.support\(/.test(ui), 'and the Send feedback button calls it', true);
  /* And still only claims what the answer says. */
  ok(/sent\.notified/.test(ui),
     'the thank-you is conditioned on a real delivery, not on the request returning', true);
}

globalThis.fetch = realFetch;
if (report('support-reaches-a-human') > 0) process.exitCode = 1;
done();
