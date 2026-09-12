/* THE QUIETEST FAILURE IN THE WHOLE TICK.

   A job that comes due and finds it has no access to what it needs writes a
   "connect this first" result and returns BEFORE the notify branch. So
   somebody who set up "inbox digest, email me daily" and never connected a
   mailbox got nothing. Not an email saying what to do - nothing, every
   morning, for ever, while a result they asked not to have to go and look for
   piled up in a screen they were not opening.

   Silence there reads as the product doing nothing. It is also the one failure
   the person can fix themselves in under a minute, which makes it the worst
   possible thing to be quiet about.

   The fix is a sentence, not a subscription: tell them the FIRST time, and
   again only if what the job is waiting for changes. A daily "still not
   connected" is a nag, they already know by the second one, and this milestone
   is about removing interruptions rather than inventing a new one. It rides in
   the same batch as that morning's real results for the same reason. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'waitsonce.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `
export { runDueAutomations };
export function __setSendEmail(fn){ _sendEmail = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'owner@test.com';
const sent = [];
W.__setSendEmail(async (env, to, subject, html, text) => {
  sent.push({ to, subject, html, text }); return true;
});

const store = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', EMAIL_API_KEY: 'k',
  APP_URL: 'https://amv.test', AMV_KV: {
  async get(k){ return store.has(k) ? store.get(k) : null; },
  async put(k, v){ store.set(k, v); },
  async delete(k){ store.delete(k); },
  async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
} };

/* "inbox digest" is not decoration here, unlike in the batching suite where it
   was the bug: `_autoNeedsFor` derives what a job needs from its own words, so
   this is how a job comes to be waiting on a mailbox in the first place. */
const job = (id, detail, over) => Object.assign({ id, detail, repeat: 'daily',
  interval: 86400000, next: Date.now() - 60000, kind: 'task', approval: 'auto',
  notify: 'email', active: true, runs: 0, uses: [] }, over || {});

const seed = (items) => {
  store.clear();
  store.set('ent:' + ME, JSON.stringify({ plan: 'ultra' }));
  store.set('auto:' + ME, JSON.stringify({ items, results: [] }));
};
/* Each tick is a separate morning: the jobs are daily, so `next` is pulled back
   into the past the way a day passing would do it. */
const tick = async () => {
  const rec = JSON.parse(store.get('auto:' + ME) || '{}');
  for(const it of (rec.items || [])) it.next = Date.now() - 60000;
  store.set('auto:' + ME, JSON.stringify(rec));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    content: [{ text: 'The result.' }], usage: { input_tokens: 5, output_tokens: 5 } }), { status: 200 });
  await W.runDueAutomations(env);
  globalThis.fetch = realFetch;
  return JSON.parse(store.get('auto:' + ME) || '{}');
};

section('The first morning it is blocked, it says so');
{
  seed([job('j0', 'inbox digest')]);
  sent.length = 0;
  const rec = await tick();
  ok(sent.length === 1, 'one email went out', sent.length);
  /* Guarded, because the mutation worth catching most here is the shipped bug:
     nothing sent at all. A suite that throws on `sent[0]` still fails, but it
     stops reporting at the throw and says nothing about the rest. */
  const mail = sent[0] || {};
  ok(/permission/i.test(String(mail.text || '') + String(mail.html || '')),
     'and it says AMV needs permission before it can finish', true);
  ok(/inbox digest/.test(String(mail.text || '') + String(mail.html || '')),
     'naming the job, so somebody with several knows which one', true);
  const it = (rec.items || [])[0] || {};
  ok(Array.isArray(it.lastNeeds) && it.lastNeeds.length > 0,
     'and the job records what it is waiting for', it.lastNeeds);
  ok(!it.lastError,
     'without calling it a failure - it is waiting, and it has not broken anything',
     it.lastError);
}

section('And then it stops, because they already know');
{
  for(const n of [2, 3, 4]){
    sent.length = 0;
    await tick();
    ok(sent.length === 0, 'morning ' + n + ' is silent', sent.length);
  }
}

section('Unless what it is waiting for changes');
{
  /* A job whose instruction grows a second requirement is a different ask, and
     somebody who connected the first thing needs telling the second. */
  const rec = JSON.parse(store.get('auto:' + ME));
  rec.items[0].detail = 'inbox digest and what is on my calendar';
  store.set('auto:' + ME, JSON.stringify(rec));
  sent.length = 0;
  const after = await tick();
  ok(sent.length === 1, 'the new requirement is told', sent.length);
  ok((after.items[0].lastNeeds || []).length >= 2,
     'and both are recorded, so the next morning is silent again',
     after.items[0].lastNeeds);
  sent.length = 0;
  await tick();
  ok(sent.length === 0, 'which it is', sent.length);
}

section('A job that did not ask for email is not emailed');
{
  seed([job('j0', 'inbox digest', { notify: 'app' })]);
  sent.length = 0;
  const rec = await tick();
  ok(sent.length === 0, 'nothing is sent', sent.length);
  ok(((rec.results || []).filter(r => r.kind === 'needs_access')).length === 1,
     'and the result is still there to be read in the app, which is where they asked for it',
     (rec.results || []).map(r => r.kind));
}

section('It rides in the same email as that morning results');
{
  seed([job('j0', 'weekly note'), job('j1', 'inbox digest'), job('j2', 'stretch reminder')]);
  sent.length = 0;
  await tick();
  ok(sent.length === 1, 'still one email, not two', sent.length);
  const body = String((sent[0] || {}).html || '') + String((sent[0] || {}).text || '');
  ok(/weekly note/.test(body) && /stretch reminder/.test(body),
     'carrying the results that did run', true);
  ok(/inbox digest/.test(body) && /permission/i.test(body),
     'and the one that is waiting on them, in the same place', true);
  ok(/3 updates/.test((sent[0] || {}).subject || ''),
     'counted with the rest, because it is one of the things that happened',
     sent[0].subject);
}

section('Connecting it produces a result, not another notice');
{
  /* The signal that it is working again is the work arriving. A second email
     to announce good news is the interruption this milestone exists to remove. */
  seed([job('j0', 'inbox digest')]);
  sent.length = 0;
  await tick();
  ok(sent.length === 1, 'blocked, and told once', sent.length);

  /* `conn:<email>` holds ALL of somebody's connections keyed by id - one
     record, not one per connection. Seeding the per-connection spelling makes
     this section pass for the wrong reason: the gate simply stays shut and the
     silence is the suppression, not the clearing. */
  store.set('conn:' + ME, JSON.stringify({
    'google-1': { provider: 'google', scopes: ['mail.read'], email: ME } }));
  sent.length = 0;
  const rec = await tick();
  const results = rec.results || [];
  ok(results[results.length - 1].kind !== 'needs_access',
     'the next run is a real run, not another request', results[results.length - 1].kind);
  ok(sent.length === 1, 'and there is exactly one email, which is the result itself', sent.length);
  ok(!/permission/i.test(String((sent[0] || {}).text || '')),
     'with nothing in it asking them to connect something they just connected', true);
  ok((rec.items[0].lastNeeds || []).length === 0,
     'and the job is no longer recorded as waiting', rec.items[0].lastNeeds);
}

if (report('a-job-waiting-on-you-says-so-once') > 0) process.exitCode = 1;
done();
