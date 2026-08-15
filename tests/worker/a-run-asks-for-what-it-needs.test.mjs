/* A SCHEDULED RUN COULD NOT ASK FOR ANYTHING.

   "Every day at 7pm check Canvas and do my work" needs different things on
   different days. Monday's quiz needs the Canvas token and nothing else.
   Tuesday's essay needs Drive, to make a copy of the worksheet. Thursday's
   group project needs an address to send it to. The job was set up once, on a
   Monday, and from then on it discovered what it needed while it was running -
   with no way to say so.

   What happened instead was the worst of the available options: it half-did
   the work, recorded that it had run, and the person found out by looking.

   The check that existed lived in the browser, matched keywords once against
   the instruction, and read connection state out of localStorage. All three
   are wrong for this: the cron has no browser, the instruction is not what
   changes from day to day, and localStorage is not where the server keeps
   anything.

   So it is asked per run, on the server, before a penny is spent. And a run
   stopped for a missing permission is deliberately not a failure - five
   failures switch a job off, and somebody who has not pasted a token yet has
   not broken anything. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'needs.harness.mjs');
writeFileSync(harness, src +
  '\nexport { DB, AUTO_CAPABILITIES, _autoConnected, _autoNeedsFor, _autoNeedsMessage,' +
  ' runDueAutomations, _wallet };\n');
const W = await import(harness + '?t=' + Date.now());

section('Every capability says what it wants, what it needs, and where');
{
  ok(W.AUTO_CAPABILITIES.length >= 5, 'the registry exists', W.AUTO_CAPABILITIES.length);
  const bad = W.AUTO_CAPABILITIES.filter((c) =>
    !c.id || !c.label || !c.needs || !c.where || !c.match || typeof c.has !== 'function');
  ok(bad.length === 0, 'and none of them is half-described', bad.map((c) => c.id));

  /* `needs` is what a person reads and acts on. A field name is not an
     instruction, so it has to be a sentence. */
  const terse = W.AUTO_CAPABILITIES.filter((c) => String(c.needs).length < 20).map((c) => c.id);
  ok(terse.length === 0, 'each one is written as something somebody can act on', terse);
}

section('It only claims what the server can actually check');
{
  /* The honest half. Google, mail and Canvas are held on the server and are
     genuinely verifiable; GitHub and Slack are connected in the browser and
     nowhere else, so a scheduled run cannot reach them at all. Before this,
     such a job produced text every night that went nowhere. */
  const browserOnly = W.AUTO_CAPABILITIES.filter((c) => c.browserOnly).map((c) => c.id);
  ok(browserOnly.includes('github') && browserOnly.includes('slack'),
     'the browser-only integrations are marked as such rather than pretended', browserOnly);
  const gh = W.AUTO_CAPABILITIES.find((c) => c.id === 'github');
  ok(/browser/i.test(gh.needs),
     'and say plainly why a scheduled run cannot use them', gh.needs);
}

section('What a person has connected is read from where the server keeps it');
{
  const store = new Map();
  const env = { AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true }; } } };

  let c = await W._autoConnected(env, 'a@t.com');
  ok(!c.google && !c.mail && !c.school, 'a fresh account has nothing connected', c);

  store.set('goauth:a@t.com', JSON.stringify({ refresh_token: 'r' }));
  store.set('mailcfg:a@t.com', JSON.stringify({ secret: 'enc' }));
  store.set('school:a@t.com', JSON.stringify({ token: 't', base: 'https://x.instructure.com' }));
  c = await W._autoConnected(env, 'a@t.com');
  ok(c.google && c.mail && c.school, 'and each one is seen once it is', c);

  /* A mail record with no ciphertext is a record, not a connection. */
  store.set('mailcfg:a@t.com', JSON.stringify({ address: 'x@qq.com' }));
  c = await W._autoConnected(env, 'a@t.com');
  ok(!c.mail, 'a half-written record does not count as connected', c.mail);
}

section('The same job asks for different things on different days');
{
  /* THE WHOLE POINT. One job, one instruction, three runs. */
  const item = { id: 'j1', detail: 'Check Canvas and do my assignments for today' };
  const nothing = { google: false, mail: false, school: false };
  const canvasOnly = { google: false, mail: false, school: true };

  const monday = W._autoNeedsFor(item, nothing, []);
  ok(!monday.ready && monday.missing.some((m) => m.id === 'school'),
     'with nothing connected it asks for Canvas', monday.missing.map((m) => m.id));

  const mondayOk = W._autoNeedsFor(item, canvasOnly, []);
  ok(mondayOk.ready, 'with Canvas connected, Monday’s quiz needs nothing else', mondayOk.missing);

  /* Tuesday: the run reads today's assignment, finds it is an essay, and says
     so. The instruction has not changed by a single character. */
  const tuesday = W._autoNeedsFor(item, canvasOnly, ['google']);
  ok(!tuesday.ready && tuesday.missing.some((m) => m.id === 'google'),
     'but a run that discovers it needs Drive asks for Drive', tuesday.missing.map((m) => m.id));
  ok(tuesday.missing.find((m) => m.id === 'google').why === 'discovered',
     'and records that the run found it, not the instruction', true);

  /* Thursday: it has to go to a person. */
  const send = { id: 'j2', detail: 'Do my Canvas work and submit it to my teacher' };
  const thu = W._autoNeedsFor(send, { google: true, mail: true, school: false }, []);
  ok(thu.missing.some((m) => m.id === 'recipient'),
     'and a job told to send its work somewhere asks who to', thu.missing.map((m) => m.id));

  const withAddr = { id: 'j3', detail: 'Do my Canvas work and email it to ms.diaz@school.edu' };
  const thuOk = W._autoNeedsFor(withAddr, { google: true, mail: true, school: true }, []);
  ok(thuOk.ready, 'and stops asking once the address is in the instruction', thuOk.missing);
}

section('The request names the day and the job, because a job runs every day');
{
  const msg = W._autoNeedsMessage(
    { detail: 'Check Canvas and do my assignments' },
    [{ id: 'google', label: 'use your Google account', needs: 'your Google account connected', where: 'Integrations' }],
    Date.parse('2026-08-18T19:00:00Z'));
  ok(/2026-08-18/.test(msg), 'the run it applies to is dated', true);
  ok(/Check Canvas/.test(msg), 'the job is named', true);
  ok(/Google account connected/.test(msg), 'and what is needed is spelled out', true);
  ok(/nothing was charged/i.test(msg),
     'and it says nothing was charged, which is the first thing somebody wonders', true);
}

/* ── and now through the cron, which is where it matters ───────────────── */

function mkEnv() {
  const m = new Map(), vals = new Map();
  return {
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example', GLOBAL_DAILY_USD_CAP: '500',
    _map: m, _vals: vals,
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: all.slice(0, limit || 1000), list_complete: true };
      },
    },
    AMV_COUNTER: { idFromName: (x) => x, get: (x) => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body); const cur = vals.get(x) || 0;
      if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: cur < b.cap, value: cur }));
      if (b.op === 'incr') { vals.set(x, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(x) })); }
      if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
      if (b.op === 'claim') return new Response(JSON.stringify({ claimed: true }));
      if (b.op === 'release') return new Response(JSON.stringify({ released: true }));
      return new Response(JSON.stringify({ allowed: true, value: cur }));
    } }) },
  };
}

let MODEL_CALLS = 0;
globalThis.fetch = async () => {
  MODEL_CALLS++;
  return new Response('data: {"type":"message_stop"}\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

section('A due run that is missing something stops, and says so, and charges nothing');
{
  const env = mkEnv();
  const EMAIL = 'student@test.com';
  const due = Date.now() - 60000;
  await W.DB.put(env, 'ent', EMAIL, { plan: 'pro', updatedAt: Date.now() });
  await W.DB.put(env, 'auto', EMAIL, { items: [{
    id: 'canvasjob', detail: 'Check Canvas and do my assignments for today',
    kind: 'task', repeat: 'daily', active: true, next: due,
    approval: 'auto', notify: 'app', runs: 0, errors: 0,
  }], results: [] });

  MODEL_CALLS = 0;
  await W.runDueAutomations(env, Date.now());

  const rec = await W.DB.get(env, 'auto', EMAIL);
  const res = (rec.results || [])[0];
  ok(!!res, 'the run produced a record', !!res);
  ok(res.outcome === 'needs_access', 'saying it needs access', res.outcome);
  ok(Array.isArray(res.needs) && res.needs.some((n) => n.id === 'school'),
     'and naming Canvas specifically, as data the interface can act on', res.needs && res.needs.map(n => n.id));
  ok(res.costUSD === 0, 'nothing was charged', res.costUSD);
  ok(MODEL_CALLS === 0,
     'and the model was never called, so the refusal cost nothing at all', MODEL_CALLS);

  /* A missing token is not a broken job. Five failures switch a job off, and
     counting this as one would switch off the job of anybody who set it up
     before connecting their school. */
  const item = rec.items[0];
  ok(!item.errors, 'it is not counted as a failure', item.errors);
  ok(item.active === true, 'so the job is still on', item.active);
  ok(item.next > due, 'and it is scheduled to try again', item.next > due);
}

section('Connect the thing, and the next run just goes');
{
  const env = mkEnv();
  const EMAIL = 'student2@test.com';
  const due = Date.now() - 60000;
  await W.DB.put(env, 'ent', EMAIL, { plan: 'pro', updatedAt: Date.now() });
  await W.DB.put(env, 'school', EMAIL, { token: 't', base: 'https://x.instructure.com' });
  await W.DB.put(env, 'auto', EMAIL, { items: [{
    id: 'canvasjob', detail: 'Check Canvas and summarise what is due today',
    kind: 'task', repeat: 'daily', active: true, next: due,
    approval: 'auto', notify: 'app', runs: 0, errors: 0, lastNeeds: ['school'],
  }], results: [] });

  MODEL_CALLS = 0;
  await W.runDueAutomations(env, Date.now());

  const rec = await W.DB.get(env, 'auto', EMAIL);
  const res = (rec.results || [])[0];
  ok(res && res.outcome !== 'needs_access',
     'with Canvas connected the run is no longer blocked', res && res.outcome);
  ok(!(rec.items[0].lastNeeds || []).length,
     'and yesterday’s request is cleared rather than left on screen', rec.items[0].lastNeeds);
}

section('The check happens before the money, not after');
{
  /* Order asserted against the source, because the behaviour above would look
     identical if the run spent first and refused afterwards - and the whole
     value of this is that a run which cannot finish costs nothing. */
  const tick = codeOnly(functionBody(src, 'runDueAutomations'));
  const needsAt = tick.indexOf('_autoNeedsFor');
  const execAt = tick.indexOf('_autoExecute');
  ok(needsAt > 0 && execAt > needsAt,
     'the needs are resolved before the run is executed', { needsAt, execAt });

  /* And resolved once per person, not once per job: the tick walks every due
     item and this must not add a lookup to each one. */
  const connAt = tick.indexOf('_autoConnected');
  ok(connAt > 0 && connAt < needsAt,
     'and what they have connected is read once for the whole account', { connAt, needsAt });
}

section('Asking is not the same as blocking everything that says "email"');
{
  /* A permission check that fires too often is worse than none: people learn
     to route around it. "Email me a summary" is a DELIVERY instruction,
     already handled by the job's notify setting, and an earlier version of
     this matched the bare word and stopped jobs that never needed a mailbox.
     The existing crew suite caught it, which is what that suite is for. */
  const none = { google: false, mail: false, school: false };
  const deliver = W._autoNeedsFor({ detail: 'Email me a summary of my week' }, none, []);
  ok(deliver.ready,
     'a job that asks to be emailed a result does not need your mailbox', deliver.missing.map(m => m.id));

  const draft = W._autoNeedsFor({ detail: 'Draft a note to the client about the deadline' }, none, []);
  ok(draft.ready, 'and nor does drafting something', draft.missing.map(m => m.id));

  /* But reading somebody's actual mail does. */
  const read = W._autoNeedsFor({ detail: 'Check my inbox and tell me what needs a reply' }, none, []);
  ok(!read.ready && read.missing.some((m) => m.id === 'mail'),
     'while reading the inbox asks for the mailbox', read.missing.map(m => m.id));

  /* And this is the behaviour that changed: a job told to send something to a
     named person used to produce a draft and a note that it could not send it.
     Now it says what it would need in order to actually do the thing. */
  const send = W._autoNeedsFor({ detail: 'Email my teacher about the deadline' }, none, []);
  ok(!send.ready, 'and a job told to email a person asks before drafting into a void', send.missing.map(m => m.id));
  ok(send.missing.some((m) => m.id === 'recipient'),
     'naming the address it does not have', true);
}

section('Everything a run changes about a job actually survives being written back');
{
  /* THE BUG THIS FILE FOUND ON ITS WAY IN, AND THE ONE THAT WAS ALREADY THERE.

     The tick works on its own copy and merges back under the lock field by
     field, so a change somebody made in the app mid-run is not overwritten.
     Right - and it copied FOUR fields while the run set SIX. `lastNeeds` was
     about to join the two that vanished, and `lastLevel` had been vanishing
     since the day it was written: the suggest branch records which permission
     level a run really executed at, exactly so it cannot be guessed wrong
     later, and it never once reached storage.

     Computed, not listed. A seventh field added next year is covered without
     anybody remembering this file exists. */
  const tick = codeOnly(functionBody(src, 'runDueAutomations'));
  const assigned = new Set([...tick.matchAll(/\bitem\.(\w+)\s*=(?!=)/g)].map((m) => m[1]));
  ok(assigned.size >= 6, 'the fields a run changes were found', [...assigned].sort());

  const carry = (src.match(/AUTO_CARRY_KEYS\s*=\s*\[([^\]]*)\]/) || [])[1] || '';
  const carried = new Set([...carry.matchAll(/'(\w+)'/g)].map((m) => m[1]));

  /* `active` is deliberately not carried wholesale: a job the RUN switched off
     stays off, but a job the PERSON switched back on must not be switched off
     again by a stale copy. It is merged one way, on purpose. */
  const oneWay = new Set(['active']);
  const lost = [...assigned].filter((f) => !carried.has(f) && !oneWay.has(f));
  ok(lost.length === 0,
     'no field a run sets is dropped on the way back to storage', lost);

  ok(carried.has('lastLevel'),
     'including the one that had been silently dropped since it was written', true);
  ok(carried.has('lastNeeds'),
     'and the one this feature adds', true);

  /* And the exclusion is real rather than an oversight dressed up. */
  ok(/if\(after\.active === false\) item\.active = false;/.test(tick.replace(/\s+/g, ' ')) ||
     /after\.active === false/.test(tick),
     'active is merged one way, deliberately', true);
}

if (report('a-run-asks-for-what-it-needs') > 0) process.exitCode = 1;
done();
