/* "MAKE A COPY OF THIS DOC AND SHARE IT WITH ME" IS MOST OF SECONDARY SCHOOL.

   And AMV could not read the assignment, let alone act on it. Two separate
   dead ends, both of which made everything downstream pointless:

     - the Canvas call went out FROM THE BROWSER, to whatever host the school
       uses. The page's Content-Security-Policy names every host AMV may reach,
       no school is on it, and none can be - so the browser refused the request
       before it left, for every student, on every run. Canvas is read through
       the Worker now, which has no CSP;

     - and the assignment description was put through
       `.replace(/<[^>]*>/g,' ')` before anything read it. That strips tags, and
       the Google Doc lives inside one, as an href. So the single thing the
       assignment was about was deleted before the model ever saw it.

   What this file pins is the second one, plus the boundaries that make reading
   somebody's school account safe to do at all: an address that is not a school
   cannot be reached, a token that does not work is not stored as if it did, and
   the token is deleted with the account. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'school.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, _docLinksFrom, _assignmentText, _canvasBase, PER_USER_KINDS, BACKUP_NEVER };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

/* A faithful stub of the two Canvas calls this uses. Faithful matters: the
   shape below is what Canvas really answers, including the description arriving
   as HTML with the doc as an anchor - which is the whole point. */
const DOC_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345678';
const DESCRIPTION =
  '<p>Read chapter 4, then <strong>make a copy</strong> of '
  + '<a href="https://docs.google.com/document/d/' + DOC_ID + '/edit?usp=sharing">this worksheet</a>'
  + ' and share it with me when you are done.</p>';
let canvasCalls = [];
let canvasStatus = 200;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (/school\.instructure\.com/.test(u)) {
    canvasCalls.push(u);
    if (canvasStatus !== 200) return new Response('no', { status: canvasStatus });
    if (/users\/self/.test(u)) return new Response(JSON.stringify({ name: 'A Student' }), { status: 200 });
    if (/\/courses\?/.test(u)) return new Response(JSON.stringify([{ id: 77, name: 'English 10' }]), { status: 200 });
    if (/\/assignments/.test(u)) return new Response(JSON.stringify([
      { id: 5, name: 'Chapter 4 worksheet', due_at: '2026-09-01T04:00:00Z',
        html_url: 'https://school.instructure.com/courses/77/assignments/5',
        description: DESCRIPTION, has_submitted_submissions: false },
    ]), { status: 200 });
    if (/users\?enrollment_type=teacher/.test(u)) return new Response(JSON.stringify([
      { name: 'Ms Alvarez', email: 'alvarez@school.edu' },
    ]), { status: 200 });
    return new Response('[]', { status: 200 });
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

function mkEnv() {
  const m = new Map(); const n = new Map(); canvasCalls = []; canvasStatus = 200;
  return {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    /* The Canvas token is a credential and is encrypted at rest like a mailbox
       password, so connecting needs the key that does it. Without one the
       connect refuses rather than storing the token in the clear (AMV-014),
       which is the behaviour a separate test asserts. */
    MAIL_CRED_KEY: 'a-long-enough-key-for-tests-0123456789',
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: all.slice(0, limit || 1000), list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (x) => x,
      get: (x) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = n.get(x) || 0;
        if (b.op === 'claim') { if (n.has('c:' + x)) return new Response(JSON.stringify({ claimed: false })); n.set('c:' + x, 1); return new Response(JSON.stringify({ claimed: true })); }
        if (b.op === 'release') { n.delete('c:' + x); return new Response(JSON.stringify({ ok: true })); }
        if (b.op === 'rateCheck') { n.set(x, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '12.12.12.12',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b, t) => { const r = await call(env, p, b, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const signup = async (env, email) => (await (await call(env, '/auth/signup', { email, name: 'S', password: 'A-real-Passw0rd!' })).json()).token;
const connect = (env, tok, base) => post(env, '/v1/school/connect',
  { baseUrl: base || 'https://school.instructure.com', token: 'canvas~aVeryLongLookingAccessToken123' }, tok);

section('The link survives the stripping that used to delete it');
{
  /* The defect in one line. Everything else here is downstream of it. */
  const links = W._docLinksFrom(DESCRIPTION);
  ok(links.length === 1, 'the document in the assignment is found', links.length);
  ok(links[0].id === DOC_ID, 'with the id Drive needs to copy it', links[0].id);
  ok(links[0].kind === 'doc', 'and what kind of thing it is', links[0].kind);

  const text = W._assignmentText(DESCRIPTION);
  ok(!/</.test(text), 'the instructions read as text, not markup', text.slice(0, 60));
  ok(/make a copy/i.test(text), 'the instructions are still there', text.slice(0, 60));
  ok(text.includes(DOC_ID), 'and the document is NAMED in them rather than deleted', text.slice(-90));
}

section('Slides and sheets count too, and a stray link does not');
{
  const many = W._docLinksFrom(
    '<a href="https://docs.google.com/presentation/d/AAAAAAAAAAAAAAAAAAAA/edit">deck</a> '
    + '<a href="https://docs.google.com/spreadsheets/d/BBBBBBBBBBBBBBBBBBBB/edit">sheet</a> '
    + '<a href="https://example.com/notes">notes</a>');
  ok(many.length === 2, 'both Google documents are found and nothing else is', many.map(l => l.kind));
  ok(many.some(l => l.kind === 'slides') && many.some(l => l.kind === 'sheet'),
     'a deck is a deck and a sheet is a sheet', many.map(l => l.kind));

  const dupes = W._docLinksFrom('<a href="https://docs.google.com/document/d/' + DOC_ID + '/edit">a</a>'
                              + '<a href="https://docs.google.com/document/d/' + DOC_ID + '/view">a again</a>');
  ok(dupes.length === 1, 'the same document linked twice is one document', dupes.length);
}

section('Only a school address can be reached');
{
  /* The Worker fetching whatever address somebody types is how a server becomes
     a way to reach the inside of its own network. */
  const bad = ['http://localhost/api', 'https://127.0.0.1/', 'https://169.254.169.254/',
               'http://school.instructure.com', 'https://10.0.0.5/'];
  const refused = bad.filter(u => !W._canvasBase(u).ok);
  ok(refused.length === bad.length, 'internal and insecure addresses are all refused', bad.length - refused.length);
  ok(W._canvasBase('https://school.instructure.com').ok, 'and a real school address is accepted', true);
  ok(!W._canvasBase('https://school.instructure.com/courses/77/assignments/5').ok,
     'a link to one assignment is not a school address, and says so', true);
}

section('A token that does not work is not stored as if it did');
{
  const env = mkEnv();
  const tok = await signup(env, 'student@example.com');
  canvasStatus = 401;
  const r = await connect(env, tok);
  ok(r.status === 400, 'connecting is refused', r.status);
  ok(/did not accept that token/i.test(r.body.error || ''), 'in words that name the problem', r.body.error);
  ok(!(await W.DB.get(env, 'school', 'student@example.com')), 'and nothing was saved', 'none');
}

section('What is due, with the document attached to it');
{
  const env = mkEnv();
  const tok = await signup(env, 'student@example.com');
  const c = await connect(env, tok);
  ok(c.body.ok === true, 'the school connects', c.body.error || 'ok');
  ok(c.body.host === 'school.instructure.com', 'to the host they gave', c.body.host);

  const w = await post(env, '/v1/school/work', {}, tok);
  ok(w.body.connected === true, 'the work reads', w.body.error || 'ok');
  const item = (w.body.work || [])[0] || {};
  ok(item.name === 'Chapter 4 worksheet', 'the assignment is there', item.name);
  ok(item.course === 'English 10', 'with its course', item.course);
  ok((item.docs || []).length === 1, 'and the document it points at', (item.docs || []).length);
  ok((item.docs || [])[0].id === DOC_ID, 'ready to be copied', (item.docs || [])[0]);
  ok(/make a copy/i.test(item.instructions || ''), 'and the instructions a person would read', (item.instructions || '').slice(0, 50));
}

section('The teacher comes from the course, never from a guess');
{
  const env = mkEnv();
  const tok = await signup(env, 'student@example.com');
  await connect(env, tok);
  const t = await post(env, '/v1/school/teachers', { courseId: 77 }, tok);
  ok((t.body.teachers || []).length === 1, 'the teacher is read from Canvas', t.body.teachers);
  ok(t.body.teachers[0].email === 'alvarez@school.edu', 'with the address the school holds', t.body.teachers[0]);
  ok(t.body.askUser === false, 'so there is nothing to ask', t.body.askUser);
}

section('And when the school hides addresses, it asks instead of inventing one');
{
  /* Sharing a document with a guessed address is sharing it with a stranger. */
  const env = mkEnv();
  const tok = await signup(env, 'student@example.com');
  await connect(env, tok);
  const saved = globalThis.fetch;
  globalThis.fetch = async (u, i) => /enrollment_type=teacher/.test(String(u))
    ? new Response(JSON.stringify([{ name: 'Ms Alvarez' }]), { status: 200 })
    : saved(u, i);
  const t = await post(env, '/v1/school/teachers', { courseId: 77 }, tok);
  globalThis.fetch = saved;
  ok((t.body.teachers || []).length === 0, 'no address is invented', t.body.teachers);
  ok(t.body.askUser === true, 'and the student is asked for it', t.body.askUser);
}

section('Nobody else can read a student’s school work');
{
  const env = mkEnv();
  const mine = await signup(env, 'student@example.com');
  await connect(env, mine);
  const theirs = await signup(env, 'stranger@example.com');
  const r = await post(env, '/v1/school/work', {}, theirs);
  ok(r.body.connected !== true, 'a different account gets nothing', r.body);
  ok(r.body.code === 'not_connected', 'it is simply not their school', r.body.code);
  const anon = await post(env, '/v1/school/work', {}, null);
  ok(anon.status === 401, 'and signed out gets nothing at all', anon.status);
}

section('The school token is deleted with the account, and never exported');
{
  /* It is a live credential to a minor's school record. Both of these are the
     same promise, made in two places. */
  ok(W.PER_USER_KINDS.includes('school'), 'erasure reaches it', W.PER_USER_KINDS.includes('school'));
  ok(W.BACKUP_NEVER.includes('school:'),
     'and a downloadable backup file never contains it', W.BACKUP_NEVER.includes('school:'));

  const env = mkEnv();
  const tok = await signup(env, 'leaving@example.com');
  await connect(env, tok);
  ok(!!(await W.DB.get(env, 'school', 'leaving@example.com')), 'the token is stored while connected', true);
  await post(env, '/auth/delete', { confirm: 'DELETE' }, tok);
  ok(!(await W.DB.get(env, 'school', 'leaving@example.com')), 'and gone when the account is', 'gone');
}

section('Disconnecting really removes it');
{
  const env = mkEnv();
  const tok = await signup(env, 'quitter@example.com');
  await connect(env, tok);
  const r = await post(env, '/v1/school/disconnect', {}, tok);
  ok(r.body.ok === true, 'it disconnects', r.body);
  ok(!(await W.DB.get(env, 'school', 'quitter@example.com')), 'and the token is gone', 'gone');
}

section('Canvas is read by the WORKER, never by the browser');
{
  /* The first dead end, stated so it cannot come back. A fetch to a school host
     from app.js is blocked by the page's own CSP - it can never work, and it
     fails in a way that looks like AMV being broken. */
  const app = readFileSync(join(ROOT, 'app.js'), 'utf8');
  /* The first version of this rule looked for the word `instructure` near a
     fetch, and for `loadStr('amv_canvas_url') +`. The real code was
     `fetchDeadline(baseUrl+'/api/v1/courses...')`, with baseUrl read three
     lines earlier - so the rule passed while the dead code was still shipping.

     The base address now lives on the server, so the honest rule is that the
     BROWSER has no school address at all: no way to build such a URL, nothing
     to read it from, and no `/api/v1/` of somebody else's to call. */
  const browserCanvas = []
    .concat(app.match(/amv_canvas_url/g) || [])
    .concat(app.match(/fetch(?:Deadline)?\([^)]*instructure/g) || [])
    .concat(app.match(/baseUrl\s*\+\s*'\/api\/v1/g) || []);
  ok(browserCanvas.length === 0,
     'the browser holds no school address and calls no school host', browserCanvas.slice(0, 3));

  const csp = readFileSync(join(ROOT, 'index.html'), 'utf8').match(/connect-src [^;]*/);
  ok(!!csp, 'the page states which hosts it may reach', !!csp);
  ok(!/instructure/.test(csp[0]),
     'and a school host is not one of them, which is why the Worker does it', true);
}

globalThis.fetch = realFetch;
if (report('the-assignment-is-actually-readable') > 0) process.exitCode = 1;
done();
