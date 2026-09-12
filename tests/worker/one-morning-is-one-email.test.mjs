/* THE FAILURE THIS MILESTONE IS NAMED AFTER.

   The tick sent from INSIDE the per-item loop, so somebody with five jobs due
   at seven in the morning got five separate emails, every morning. That is not
   five times as much information. It is one morning's information and four
   interruptions, and it is exactly how a product somebody liked at two jobs
   becomes one they mute at six.

   What this suite holds is the shape of the fix, and the two ways a "digest"
   usually goes wrong:

     - IT MUST NOT DROP ANYTHING. A digest that summarises, truncates or
       reorders is worse than four emails, because now the person has to open
       the app anyway and cannot tell which parts they are missing.
     - ONE JOB IS NOT A DIGEST. Somebody with a single job has no aggregation
       problem, and a digest wrapper around one item is a worse email for no
       reason at all. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'onemail.harness.mjs');
writeFileSync(harness, src + `
export { _autoEmailBatch, runDueAutomations };
export function __setSendEmail(fn){ _sendEmail = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'owner@test.com';
const sent = [];
W.__setSendEmail(async (env, to, subject, html, text) => {
  sent.push({ to, subject, html, text }); return true;
});

const item = (id, detail) => ({ id, detail, repeat: 'daily', interval: 86400000,
  next: Date.now() - 60000, kind: 'task', approval: 'auto', notify: 'email',
  active: true, runs: 0, uses: [] });

const store = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', EMAIL_API_KEY: 'k',
  APP_URL: 'https://amv.test', AMV_KV: {
  async get(k){ return store.has(k) ? store.get(k) : null; },
  async put(k, v){ store.set(k, v); },
  async delete(k){ store.delete(k); },
  async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
} };

const run = async (details) => {
  sent.length = 0; store.clear();
  /* A PLAN THAT CAN RUN SEVERAL JOBS. Without an entitlement the account is
     free, the free allowance is one background job, and the tick refuses the
     rest with "above your plan's job limit" before they ever run - so the
     first version of this suite measured a one-job tick and reported the
     batching as broken. The fixture has to be an account that can actually
     have the problem being fixed. */
  store.set('ent:' + ME, JSON.stringify({ plan: 'ultra' }));
  store.set('auto:' + ME, JSON.stringify({
    items: details.map((d, i) => item('j' + i, d)), results: [] }));
  const realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => {
    n++;
    return new Response(JSON.stringify({
      content: [{ text: 'Result for job ' + n + '.\n\nSecond paragraph ' + n + '.' }],
      usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200 });
  };
  await W.runDueAutomations(env);
  globalThis.fetch = realFetch;
  return { sent: sent.slice(), rec: JSON.parse(store.get('auto:' + ME) || '{}') };
};

/* THREE JOBS THAT NEED NOTHING CONNECTED.

   The first draft of this fixture used "inbox digest" and "calendar
   look-ahead", which read like the jobs somebody really has - and that is
   exactly why it measured nothing. `_autoNeedsFor` derives a job's required
   access from its own words, so those two came due, found no mailbox and no
   calendar on the account, and returned "connect this first" WITHOUT reaching
   the notify branch at all. One job made it into the batch, the suite reported
   the batching as broken, and the batching was fine.

   Access is a different question from aggregation, so the fixture keeps it out
   of the frame: three jobs that any account can actually run. */
const THREE = ['weekly note', 'stretch reminder', 'quote of the day'];

section('Three jobs due together are one email, not three');
{
  const r = await run(THREE);
  ok(r.sent.length === 1, 'one email left the building', r.sent.length);
  ok(/3 updates/.test(r.sent[0].subject),
     'and it says how many things are in it, so the subject is not a lie either way',
     r.sent[0].subject);
}

section('And it drops nothing - every job is in it, in full');
{
  const r = await run(THREE);
  const mail = r.sent[0];
  for(const d of THREE){
    ok(mail.html.includes(d), JSON.stringify(d) + ' has its own heading', d);
    ok(mail.text.includes(d), 'and is named in the plain-text part too', d);
  }
  /* The BODIES, not just the titles. A digest that lists what happened and
     makes you open the app has not saved anybody anything. */
  for(let i = 1; i <= 3; i++){
    ok(mail.html.includes('Result for job ' + i), 'result ' + i + ' is present in full', i);
    ok(mail.html.includes('Second paragraph ' + i),
       'including its second paragraph - nothing is truncated to a preview', i);
  }
}

section('One job is not a digest');
{
  const r = await run(['weekly note']);
  ok(r.sent.length === 1, 'still one email', r.sent.length);
  ok(/AMV update: weekly note/.test(r.sent[0].subject),
     'and it is exactly the mail a single job always sent - a digest wrapper around one '
     + 'item is a worse email for no reason', r.sent[0].subject);
  ok(!/\d+ updates/.test(r.sent[0].subject), 'with no count in the subject', r.sent[0].subject);
}

section('A run that emailed nobody sends nothing at all');
{
  sent.length = 0; store.clear();
  store.set('ent:' + ME, JSON.stringify({ plan: 'ultra' }));
  store.set('auto:' + ME, JSON.stringify({
    items: [Object.assign(item('j0', 'in-app only'), { notify: 'app' })], results: [] }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    content: [{ text: 'x' }], usage: {} }), { status: 200 });
  await W.runDueAutomations(env);
  globalThis.fetch = realFetch;
  ok(sent.length === 0, 'no empty digest for jobs nobody asked to be emailed', sent.length);
}

section('A refused send is told to every job that was in it');
{
  /* A refused send comes back FALSE, not as a throw. Dropping that leaves
     somebody waiting on an email that is never coming, beside three jobs all
     showing green. */
  W.__setSendEmail(async () => false);
  const r = await run(['one', 'two']);
  W.__setSendEmail(async (env, to, subject, html, text) => { sent.push({ to, subject, html, text }); return true; });
  const items = r.rec.items || [];
  ok(items.length === 2, 'both jobs are in the record', items.length);
  for(const it of items){
    ok(/could not be delivered/i.test(String(it.lastError || '')),
       JSON.stringify(it.detail) + ' is told the email did not arrive', it.lastError);
    ok(/here in AMV/i.test(String(it.lastError || '')),
       'and that the result itself is safe, because it is', it.lastError);
  }
  ok(items.every(it => /one email/i.test(String(it.lastError || ''))),
     'saying it was the one email carrying them, which is what actually failed',
     items.map(i => i.lastError));
}

section('A successful send leaves no stale failure behind');
{
  const r = await run(['one', 'two']);
  const items = r.rec.items || [];
  ok(items.every(it => !it.lastError),
     'nothing is left saying an email failed when it did not', items.map(i => i.lastError));
}

section('A warning the run produced survives being batched');
{
  /* FOUND BY MUTATION, AND IT WAS MINE. The first version of the collector
     blanked `lastError` on the way into the batch - "the outcome is not known
     yet" - which read as tidy and was not. The line above it had already set
     the field from the run's own outcome, and for an investing check-in that
     outcome carries a SOFT code when the provider read failed. Blanking it
     meant the row went green while the figures behind it came from a read that
     did not work, for every job set to email. Deleting the blanking is the fix;
     this is what stops it being re-added. */
  sent.length = 0; store.clear();
  store.set('ent:' + ME, JSON.stringify({ plan: 'ultra' }));
  store.set('auto:' + ME, JSON.stringify({ results: [], items: [
    item('j0', 'weekly note'),
    Object.assign(item('j1', 'portfolio check-in'), { kind: 'invest' })
  ] }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    content: [{ text: 'Result text.' }], usage: { input_tokens: 5, output_tokens: 5 } }), { status: 200 });
  await W.runDueAutomations(env);
  globalThis.fetch = realFetch;
  const items = JSON.parse(store.get('auto:' + ME) || '{}').items || [];
  const invest = items.find(i => i.id === 'j1') || {};
  ok(typeof invest.lastError === 'string' && invest.lastError.length > 0,
     'the check-in that could not read its provider still says so afterwards', invest.lastError);
  ok(!items.find(i => i.id === 'j0').lastError,
     'and the job that ran cleanly still says nothing, so this is not just noise',
     items.find(i => i.id === 'j0').lastError);
  ok(sent.length === 1, 'both were still in the one email', sent.length);
}

section('The batch itself will not send for a run that produced nothing');
{
  /* The tick guards this with `if(mails.length)`, so this is the SECOND line
     rather than the first - and it is the one that holds if anything else ever
     calls the batch. Asserted directly because a mutation that removes the
     guard inside the helper cannot be seen from the tick at all. */
  sent.length = 0;
  const r = await W._autoEmailBatch(env, ME, []);
  ok(r === true, 'an empty batch reports success, because nothing failed', r);
  ok(sent.length === 0, 'and sends nobody an email with nothing in it', sent.length);
}

if (report('one-morning-is-one-email') > 0) process.exitCode = 1;
done();
