/* A WRITE IS READ BACK BEFORE IT IS CALLED DONE.

   Sending a mail, adding a calendar event, copying and sharing a file, pushing
   a branch, opening an issue or a pull request: each used to report success
   because the provider's answer had a 200 on it. A 200 is the provider saying
   it accepted the request, not that the thing exists - and AMV saying "sent"
   or "shared" on the strength of it is AMV claiming something it never looked
   at.

   So every write on a connected account now reads its own result back and
   says `verified`: true when the change is there, null when it could not be
   checked, false when the provider said yes and the change is not there. And
   the route treats false as a failure and a missing answer as one too, so a
   write added later without a read-back cannot report success at all.

   Every case below is a provider that ANSWERS - the whole point is the gap
   between what it answered and what is there. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'readback.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { CONN_ACTIONS, CONN_KV, DB, connSeal };\n');
const W = await import(harness + '?t=' + Date.now());

/* The provider. `honest` answers the read-back with what was made; otherwise
   every create succeeds and the read-back finds nothing - the provider that
   says yes and does nothing. */
let honest = true;
const sent = [];
const J = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init) => {
  const u = String(url), m = (init && init.method) || 'GET';
  sent.push(m + ' ' + u);
  const body = init && init.body ? JSON.parse(init.body) : {};
  if (m === 'POST' && /gmail\/v1\/users\/me\/messages\/send$/.test(u))
    return J(honest ? { id: 'm1', labelIds: ['SENT'] } : { id: 'm1', labelIds: [] });
  if (/calendar\/v3\/calendars\/primary\/events$/.test(u) && m === 'POST') return J({ id: 'e1', status: 'confirmed', htmlLink: 'https://cal/e1' });
  if (/calendar\/v3\/calendars\/primary\/events\/e1$/.test(u)) return honest ? J({ id: 'e1', status: 'confirmed' }) : J({ error: {} }, 404);
  if (/drive\/v3\/files\/[^/]+\/copy/.test(u)) return J({ id: 'copy1', name: 'Copy', webViewLink: 'https://drive/copy1' });
  if (/drive\/v3\/files\/copy1\?/.test(u)) return honest ? J({ id: 'copy1', trashed: false }) : J({ error: {} }, 404);
  if (/drive\/v3\/files\/[^/]+\/permissions\?/.test(u) && m === 'POST') return J({ id: 'p1', role: body.role });
  if (/drive\/v3\/files\/[^/]+\/permissions\/p1/.test(u))
    return honest ? J({ id: 'p1', role: 'writer', emailAddress: 'Friend@Example.com' }) : J({ id: 'p1', role: 'reader', emailAddress: 'someone@else.com' });
  if (/\/git\/ref\/heads\/main$/.test(u)) return J({ object: { sha: 'base0' } });
  if (/\/git\/ref\/heads\/amv-change$/.test(u)) return honest ? J({ object: { sha: 'commit0000000' } }) : J({ message: 'Not Found' }, 404);
  if (/\/git\/blobs$/.test(u)) return J({ sha: 'blob0' });
  if (/\/git\/trees$/.test(u)) return J({ sha: 'tree0' });
  if (/\/git\/commits$/.test(u)) return J({ sha: 'commit0000000' });
  if (/\/git\/refs$/.test(u)) return J({ ref: 'refs/heads/amv-change' });
  if (/\/issues$/.test(u) && m === 'POST') return J({ number: 5, html_url: 'https://github.com/o/r/issues/5' });
  if (/\/issues\/5$/.test(u)) return honest ? J({ number: 5, title: 'A bug' }) : J({ message: 'Not Found' }, 404);
  if (/\/pulls$/.test(u) && m === 'POST') return J({ number: 9, html_url: 'https://github.com/o/r/pull/9' });
  if (/\/pulls\/9$/.test(u)) return honest ? J({ number: 9, state: 'open', head: { ref: 'amv-change' } }) : J({ number: 9, state: 'closed', head: { ref: 'amv-change' } });
  if (/slack\.com\/api\/chat\.postMessage$/.test(u)) return J({ ok: true, ts: '1.2', channel: 'C1' });
  if (/slack\.com\/api\/chat\.getPermalink/.test(u)) return J(honest ? { ok: true, permalink: 'https://x.slack.com/p12' } : { ok: false, error: 'message_not_found' });
  return J({});
};

const ARGS = {
  'gmail.send': { to: 'friend@example.com', subject: 'Hi', body: 'Hello' },
  'calendar.create': { title: 'Lunch', start: '2026-11-01T12:00:00Z', end: '2026-11-01T13:00:00Z' },
  'drive.copy': { fileId: 'teacherdoc1', title: 'Copy' },
  'drive.share': { fileId: 'copy1', email: 'friend@example.com', role: 'writer' },
  'github.push': { repo: 'o/r', base: 'main', branch: 'amv-change', message: 'm', files: [{ path: 'a.txt', content: 'x' }] },
  'github.issue.create': { repo: 'o/r', title: 'A bug', body: '' },
  'github.pr': { repo: 'o/r', head: 'amv-change', base: 'main', title: 't' },
  'slack.post': { channel: '#team', text: 'hello' },
};
/* docs.edit and sheets.write read back already and have a suite of their own
   (a-google-doc-is-edited-where-it-is); they are held to the same route rule. */
const OWN_SUITE = ['docs.edit', 'sheets.write'];
const writes = Object.keys(W.CONN_ACTIONS).filter(n => W.CONN_ACTIONS[n].writes);

section('Every write on a connected account is covered here or by its own suite');
{
  const uncovered = writes.filter(n => !ARGS[n] && !OWN_SUITE.includes(n));
  ok(writes.length >= 9, 'the set of writes was really read', writes);
  ok(uncovered.length === 0, 'no write is left without a read-back test - add it to ARGS', uncovered);
}

section('When the provider did it, the write says verified');
{
  honest = true;
  for (const n of Object.keys(ARGS)) {
    sent.length = 0;
    const r = await W.CONN_ACTIONS[n].run('tok', JSON.parse(JSON.stringify(ARGS[n])));
    ok(r && r.verified === true, n + ' is read back and confirmed', r);
    if (n !== 'gmail.send') ok(sent.some(s => s.startsWith('GET ')), n + ' really asked the provider afterwards', sent);
  }
}

section('When the provider said yes and it is not there, the write says so');
{
  honest = false;
  for (const n of Object.keys(ARGS)) {
    const r = await W.CONN_ACTIONS[n].run('tok', JSON.parse(JSON.stringify(ARGS[n])));
    ok(r && r.verified === false, n + ' reports that it is not there', r);
  }
  honest = true;
}

/* ── Through the route, which is where the rule is enforced ─────────────── */
function mkEnv() {
  const m = new Map();
  return {
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
    },
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0 })); } }) },
    JWT_SECRET: 'j'.repeat(40), ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    CONNECT_KEY: 'test-connect-key', GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsec',
  };
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
const req = (env, path, body, tok) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '44.44.44.44', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body),
}), env, ctx);
const jsonOf = async (r) => { try { return await r.json(); } catch (e) { return {}; } };
const ME = 'me@example.com';
async function signedInWithGoogle() {
  const env = mkEnv();
  const tok = (await jsonOf(await req(env, '/auth/signup', { email: ME, name: 'Me', password: 'A-real-Passw0rd!' }))).token;
  const sealed = await W.connSeal(env, { access: 'google-token', exp: Date.now() + 3600e3 });
  await W.DB.put(env, W.CONN_KV, ME, { c1: { provider: 'google', scopes: ['mail.send', 'calendar.write'], sealed, unattended: false } });
  return { env, tok };
}

section('Through the route: confirmed is done, unconfirmed is not');
{
  const { env, tok } = await signedInWithGoogle();
  ok(!!tok, 'signed in', !!tok);
  honest = true;
  let r = await req(env, '/v1/connect/act', { action: 'gmail.send', args: ARGS['gmail.send'] }, tok);
  let d = await jsonOf(r);
  ok(r.status === 200 && d.ok === true && d.result.verified === true, 'a mail Gmail filed as sent comes back as done', [r.status, d]);

  honest = false;
  r = await req(env, '/v1/connect/act', { action: 'calendar.create', args: ARGS['calendar.create'] }, tok);
  d = await jsonOf(r);
  ok(r.status === 502 && d.error === 'not_confirmed' && d.ok !== true,
     'an event Google accepted and then could not find is a failure, not a success', [r.status, d]);
  ok(/checked/i.test(d.message || '') && !/Nothing was changed/i.test(d.message || ''),
     'and it says it checked - never "nothing was changed", which AMV cannot know', d.message);
  honest = true;
}

section('A write that cannot say whether it happened cannot report success');
{
  /* The rule binds the next write too, not only these. A new action that
     forgets the read-back must fail loudly here rather than ship a "done". */
  W.CONN_ACTIONS['test.blind'] = { need: 'mail.send', writes: true, async run() { return { sent: true }; } };
  const { env, tok } = await signedInWithGoogle();
  const r = await req(env, '/v1/connect/act', { action: 'test.blind', args: {} }, tok);
  const d = await jsonOf(r);
  ok(r.status !== 200 && d.ok !== true && d.error === 'not_verifiable', 'a write with no verified answer is refused as done', [r.status, d]);
  delete W.CONN_ACTIONS['test.blind'];
}

if (report('a-write-is-read-back-before-it-is-done') > 0) process.exitCode = 1;
done();
