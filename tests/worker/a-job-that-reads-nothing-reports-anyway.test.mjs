/* TWO ANSWERS TO "WHAT DOES THIS JOB NEED", AND ONLY ONE WAS FILLED IN.

   `_autoAccountContext` walks `item.uses` to decide what to open. An empty
   list means it returns immediately and the model is handed the job's
   instruction and NO DATA AT ALL.

   The Crew screen fills `uses` in from the catalogue entry. The chat tool did
   not: `crew_add` posts detail, repeat, kind, approval and notify. So a job
   somebody set up by asking for it - "summarise my inbox each morning", the
   headline way to create one - ran every morning, spent real money, and
   summarised an empty string while its own instruction told the model to
   report an inbox. A model handed nothing does not report nothing; it reports
   something.

   And the permission gate said the job was READY, because the gate reads the
   DETAIL while the runner reads `uses`. Same question, two matchers, and the
   one that decides whether anything is actually fetched was the one nobody was
   filling in. Measured before the fix: gate ready, 0 characters of context;
   the identical job with `uses` got 2,460.

   This is the third instance of the shape in two days (quiet hours enforced in
   one of two places, the permission gate reading a store nothing writes). What
   is different here is that both halves were working exactly as written. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'usesderive.harness.mjs');
writeFileSync(harness, src + `
export { autoCreate, _autoUsesFromText, _autoNeedsFor, _autoConnected, _autoAccountContext,
         AUTO_USES_ALLOWED, AUTO_CAPABILITIES, AUTO_USES_FROM_TEXT };
export function __setRequireUser(fn){ requireUser = fn; }
export function __setConnUse(fn){ connUse = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'owner@test.com';
const store = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', AMV_KV: {
  async get(k){ return store.has(k) ? store.get(k) : null; },
  async put(k, v){ store.set(k, v); },
  async delete(k){ store.delete(k); },
  async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
} };
W.__setRequireUser(async () => ({ email: ME, plan: 'ultra' }));
W.__setConnUse(async () => ({ ok: true, token: 'tok' }));

/* Exactly the body `crew_add` sends - detail, repeat, kind, approval, notify.
   Written out rather than imported so a change to the tool has to agree with a
   separate statement of what it sends, instead of agreeing with itself. */
const createFromChat = async (detail) => {
  store.clear();
  store.set('conn:' + ME, JSON.stringify({ c1: {
    provider: 'google', unattended: true, sealed: 'x',
    scopes: ['mail.read', 'calendar.read', 'school.read'] } }));
  const res = await W.autoCreate(new Request('https://x/v1/auto/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ detail, repeat: 'daily', kind: 'task', approval: 'auto', notify: 'app' }),
  }), env);
  return (await res.json().catch(() => ({}))).item || {};
};

section('A job created the way chat creates one asks for what it needs');
{
  const it = await createFromChat('Summarise my inbox each morning');
  ok(Array.isArray(it.uses) && it.uses.includes('mail.read'),
     'the mailbox job asks to read the mailbox, without the caller having to say so', it.uses);
}

section('Each kind of job derives the one thing it actually reads');
{
  const cases = [
    ['Summarise my inbox each morning', 'mail.read'],
    ['Check my Gmail for bills', 'mail.read'],
    ['Tell me about unread messages', 'mail.read'],
    ['Plan my week from my calendar', 'calendar.read'],
    ['What meetings do I have tomorrow', 'calendar.read'],
    /* The phrasings people actually use, each of which is a separate
       alternative in the table. A mutation deleting these two survived the
       first version of this section, because the cases below covered only the
       words "calendar" and "meetings" - an alternative nothing exercises is an
       alternative somebody can delete. */
    ['Check my diary each morning', 'calendar.read'],
    ['Tell me what\u2019s on today', 'calendar.read'],
    ['What is on this week', 'calendar.read'],
    ['Tell me what is due in my classes', 'school.read'],
    ['Check Canvas for new coursework', 'school.read'],
    ['What deadlines do I have', 'school.read'],
    ['Read my emails and tell me what needs a reply', 'mail.read'],
  ];
  for(const [detail, want] of cases){
    const got = W._autoUsesFromText(detail);
    ok(got.includes(want), JSON.stringify(detail) + ' asks for ' + want, got);
  }
}

section('And a job that reads nothing asks for nothing');
{
  /* The derivation must not become "ask for everything just in case". An
     unattended run holding a scope it has no use for is a permission nobody
     chose to give.

     Asserted on a CREATED JOB, not only on the matcher: a mutation making
     `autoCreate` hand every job the whole allow-list survived the
     matcher-level version of this, because the matcher was never the thing
     that changed. */
  ok(W._autoUsesFromText('Write me a haiku about Tuesdays').length === 0,
     'a job with no account data in it asks for none', W._autoUsesFromText('Write me a haiku about Tuesdays'));
  ok(W._autoUsesFromText('Research the top AI news and write a brief').length === 0,
     'nor does a research job, which reads the web and not the person', true);

  const haiku = await createFromChat('Write me a haiku about Tuesdays');
  ok(Array.isArray(haiku.uses) && haiku.uses.length === 0,
     'and the job that gets created holds no scopes at all', haiku.uses);
  const brief = await createFromChat('Research the top AI news and write a brief');
  ok(Array.isArray(brief.uses) && brief.uses.length === 0,
     'nor does the research one', brief.uses);
}

section('The table itself cannot name a scope an unattended run may not hold');
{
  /* The invariant the runtime filter in `_autoUsesFromText` is guarding. That
     filter is belt-and-braces - every row today is already allowed, so
     removing it changes nothing, which a mutation confirmed by surviving
     inertly (LESSONS 434). The risk it covers is somebody ADDING a row, and
     that is what this asserts: the table, not the filter. */
  ok(Array.isArray(W.AUTO_USES_FROM_TEXT) && W.AUTO_USES_FROM_TEXT.length >= 3,
     'the table was read from the worker', W.AUTO_USES_FROM_TEXT && W.AUTO_USES_FROM_TEXT.length);
  const bad = W.AUTO_USES_FROM_TEXT.filter(([, use]) => !W.AUTO_USES_ALLOWED.includes(use));
  ok(bad.length === 0,
     'every row names a scope an unattended run is allowed to hold',
     bad.map(([, u]) => u));
  const writes = W.AUTO_USES_FROM_TEXT.filter(([, use]) => !/\.read$/.test(String(use)));
  ok(writes.length === 0,
     'and every one of them is a read - nothing here can derive a way to act',
     writes.map(([, u]) => u));
}

section('It never derives a scope an unattended run may not hold');
{
  /* A detail about Drive must derive NOTHING rather than a calendar it never
     asked for - answering a different question quietly is worse than saying
     what could not be read. */
  ok(W._autoUsesFromText('Tidy up my Drive folders').length === 0,
     'Drive derives nothing, because no unattended scope covers it',
     W._autoUsesFromText('Tidy up my Drive folders'));
  const all = new Set();
  for(const d of ['inbox', 'calendar', 'canvas', 'drive', 'docs', 'sheets', 'anything'])
    W._autoUsesFromText(d).forEach(u => all.add(u));
  ok([...all].every(u => W.AUTO_USES_ALLOWED.includes(u)),
     'nothing derivable falls outside the allowed list', [...all]);
}

section('The gate and the runner now agree about the same job');
{
  /* THE ASSERTION THE DEFECT WOULD HAVE FAILED. The gate reads the detail; the
     runner reads `uses`. A job the gate says needs a mailbox must be a job the
     runner will actually open a mailbox for. */
  const conn = await W._autoConnected(env, ME);
  for(const detail of [
    'Summarise my inbox each morning',
    'Plan my week from my calendar',
    'Tell me what is due in my classes',
  ]){
    const it = await createFromChat(detail);
    const gate = W._autoNeedsFor(it, conn, []);
    ok(gate.ready === true, JSON.stringify(detail) + ': the gate lets it run', gate.missing);
    ok(Array.isArray(it.uses) && it.uses.length > 0,
       'and it will actually open something - a run that passes the gate and reads nothing is the defect',
       it.uses);
  }
}

section('An explicit list still wins, and a crafted one still cannot');
{
  store.clear();
  store.set('conn:' + ME, JSON.stringify({ c1: {
    provider: 'google', unattended: true, sealed: 'x', scopes: ['mail.read'] } }));
  const res = await W.autoCreate(new Request('https://x/v1/auto/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ detail: 'Summarise my inbox', repeat: 'daily', kind: 'task',
                           approval: 'auto', notify: 'app',
                           uses: ['calendar.read', 'drive.write', 'mail.send'] }),
  }), env);
  const it = ((await res.json().catch(() => ({}))).item) || {};
  ok(it.uses.includes('calendar.read'), 'what the caller asked for is kept', it.uses);
  ok(it.uses.includes('mail.read'), 'and what the job plainly needs is added', it.uses);
  ok(!it.uses.some(u => !W.AUTO_USES_ALLOWED.includes(u)),
     'while a scope outside the allow-list is dropped, however it was asked for', it.uses);
  ok(!it.uses.includes('mail.send'),
     'and mail.send in particular cannot be conjured by naming it', it.uses);
}

section('The run really does get the mail now');
{
  /* The end of it: not "the field is set" but "the model is handed the
     inbox". The field being set is what the defect looked like from the
     inside. */
  const it = await createFromChat('Summarise my inbox each morning');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if(!/googleapis\.com$/.test(u.hostname))
      return new Response(JSON.stringify({ content: [{ text: 'x' }], usage: {} }), { status: 200 });
    if(u.pathname.endsWith('/messages'))
      return new Response(JSON.stringify({ messages: [{ id: 'm1' }] }), { status: 200 });
    return new Response(JSON.stringify({ id: 'm1', internalDate: String(Date.now()),
      snippet: 'We charged you $9.00 monthly', labelIds: ['INBOX'],
      payload: { headers: [{ name: 'From', value: 'Acme <billing@acme.com>' },
                           { name: 'Subject', value: 'Your subscription renews' },
                           { name: 'Date', value: new Date().toUTCString() }] } }), { status: 200 });
  };
  const ctx = await W._autoAccountContext(env, it, ME);
  globalThis.fetch = realFetch;
  ok(ctx.text.length > 200,
     'the model is handed the actual inbox rather than an empty string', ctx.text.length);
  ok(/Acme|subscription renews/i.test(ctx.text),
     'and the message that is really in it', ctx.text.slice(0, 160));
}

if (report('a-job-that-reads-nothing-reports-anyway') > 0) process.exitCode = 1;
done();
