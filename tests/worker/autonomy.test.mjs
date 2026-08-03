/* AUTONOMY WIRING - proves the Auto Approve backend behaves honestly:
     - "Pause all autonomous" genuinely stops the cron from running due work.
     - Require-approval scheduled tasks enqueue a real approval item (the
       finished work waits) instead of being delivered.
   These lock in the server side of the Mission Control redesign. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'autonomy.harness.mjs');
writeFileSync(harness, src + `
export { runDueAutomations, _enqueueApproval, autoPause, _autoKey, autoUpdate, AUTO_INTERVALS, crewApprovalAct };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = {
  JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx',
  AMV_KV: {
    async get(k){ return store.has(k) ? store.get(k) : null; },
    async put(k,v){ store.set(k,v); },
    async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys:[...store.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})), list_complete:true }; }
  }
};
// DB stores JSON strings under `${kind}:${id}`
const putRec = async (kind,id,val)=>store.set(kind+':'+id, JSON.stringify(val));
const getRec = (kind,id)=>{ const v=store.get(kind+':'+id); return v?JSON.parse(v):null; };

/* ── Pause guard: a paused user's due automation must NOT run ─────────────── */
section('Pause-all genuinely stops due autonomous work');
const dueItem = { id:'a1', detail:'daily brief', repeat:'daily', interval:86400000,
  next: Date.now()-1000 /* overdue */, kind:'task', notify:'app', approval:'require',
  active:true, runs:0, lastError:null };
await putRec('auto','victim@x.com', { items:[ dueItem ], results:[], paused:true });
await putRec('ent','victim@x.com', { plan:'pro' });
let r = await W.runDueAutomations(env);
let rec = getRec('auto','victim@x.com');
ok(rec.items[0].runs === 0, 'a paused user\'s overdue job did not run (runs still 0)');
ok(rec.items[0].next < Date.now(), 'its next-run was not advanced while paused');
ok(rec.items[0].lastError == null, 'no execution was even attempted (no error recorded)');
ok(!getRec('approvals','victim@x.com'), 'nothing was enqueued for a paused user');

/* ── Require-approval: finished work waits in the approval queue ──────────── */
section('Require-approval results enqueue a real approval item');
const item = { id:'a2', detail:'Weekly customer update', kind:'task', notify:'email', approval:'require' };
await W._enqueueApproval(env, 'user@x.com', item, 'Hi there - here is the finished update. Thanks!');
const arec = getRec('approvals','user@x.com');
ok(arec && arec.items && arec.items.length === 1, 'an approval item was enqueued');
const ap = arec.items[0];
ok(ap.title === 'Weekly customer update', 'the approval carries the task title');
ok(ap.actionType === 'send', 'an email task maps to the "send" final action');
ok(ap.autoApprove === false, 'the enqueued item requires approval (autoApprove false)');
ok(ap.result && ap.result.body.includes('finished update'), 'the finished result is attached for preview');
ok(!!ap.readyAt && !!ap.startedAt, 'it carries ready/started timestamps for the Preview timeline');

/* a review-only (app-notify) task maps to a review action, not send */
await W._enqueueApproval(env, 'user2@x.com', { detail:'Research watch', kind:'research', notify:'app', approval:'require' }, 'findings');
const ap2 = getRec('approvals','user2@x.com').items[0];
ok(ap2.actionType === 'review', 'an app-only task maps to "review", not "send"');

section('The pause BUTTON writes where the cron reads');
{
  /* The cron's guard is tested by seeding paused:true directly, which proves
     the guard and nothing about the route that sets it. If the endpoint ever
     wrote under a different key - a different case, a prefix, a per-device
     scope - the guard would keep passing while the button did nothing, and the
     screen would confidently say all autonomous work had stopped.

     This is the emergency stop. Its chain has to be checked end to end. */
  store.clear();
  W.__setRequireUser(async () => ({ email: 'Owner@X.com' }));

  const due = { id:'j1', active:true, next: Date.now() - 1000, interval: 86400000,
                detail:'do a thing', kind:'task', approval:'auto' };
  /* Stored the way the product stores it: under the normalised key. */
  await putRec('auto', W._autoKey('Owner@X.com'), { items:[due], results:[] });

  const res = await W.autoPause(new Request('https://w/auto/pause',
    { method:'POST', body: JSON.stringify({ paused:true }) }), env);
  const body = await res.json();
  ok(body.ok === true && body.paused === true, 'the route reports it paused', body);

  await W.runDueAutomations(env);
  const rec = getRec('auto', W._autoKey('Owner@X.com'));
  ok(rec.paused === true, 'the flag landed on the record the cron reads', rec.paused);
  ok(rec.items[0].runs === undefined || rec.items[0].runs === 0,
     'and the overdue job really did not run', rec.items[0].runs);

  /* And unpausing lets it through again, so the control is not one-way. */
  await W.autoPause(new Request('https://w/auto/pause',
    { method:'POST', body: JSON.stringify({ paused:false }) }), env);
  const after = getRec('auto', W._autoKey('Owner@X.com'));
  ok(after.paused === false, 'resuming clears it on the same record', after.paused);
}

section('A running job can actually be changed');
{
  /* The screen offered editing a scheduled job and posted to /api/schedule/edit
     - a route the worker has never had. So the edit was accepted locally, the
       server carried on with the old schedule, and nothing said so.

     autoUpdate could delete, pause, resume and flip approval, but had no way to
     change what a job does or how often. Deleting and recreating would lose the
     run history and the claim keys that stop a job double-firing, so it edits
     in place. */
  store.clear();
  W.__setRequireUser(async () => ({ email: 'o@x.com' }));
  const key = W._autoKey('o@x.com');
  await putRec('auto', key, { items:[{ id:'j1', active:true, detail:'old goal',
    repeat:'daily', interval: W.AUTO_INTERVALS.daily, next: Date.now() + 1000, approval:'require' }], results:[] });

  const edit = (body) => W.autoUpdate(new Request('https://w/auto/update',
    { method:'POST', body: JSON.stringify(Object.assign({ id:'j1', action:'edit' }, body)) }), env);

  const r = await (await edit({ detail:'new goal', repeat:'weekly', approval:'auto' })).json();
  ok(r.ok === true, 'the edit is accepted', r);
  const it = getRec('auto', key).items[0];
  ok(it.detail === 'new goal', 'what it does really changed', it.detail);
  ok(it.interval === W.AUTO_INTERVALS.weekly, 'and how often', it.interval);
  ok(it.approval === 'auto', 'and whether it asks first', it.approval);
  /* Changing to weekly must move the next run, or "make it weekly" still fires
     tomorrow on the time the old cadence picked. */
  ok(it.next > Date.now() + W.AUTO_INTERVALS.daily,
     'and the next run moves with the new interval', it.next - Date.now());

  const bad = await edit({ repeat:'every-other-tuesday' });
  ok(bad.status === 400, 'an interval the scheduler cannot run is refused', bad.status);
  ok(getRec('auto', key).items[0].interval === W.AUTO_INTERVALS.weekly,
     'and the job is left as it was', getRec('auto', key).items[0].interval);

  const empty = await edit({ detail:'   ' });
  ok(empty.status === 400, 'and so is emptying what it does', empty.status);
  ok(getRec('auto', key).items[0].detail === 'new goal', 'leaving the goal intact');

  const gone = await W.autoUpdate(new Request('https://w/auto/update',
    { method:'POST', body: JSON.stringify({ id:'nope', action:'edit', detail:'x' }) }), env);
  ok(gone.status === 404, 'a job that does not exist cannot be edited', gone.status);
}

section('Approving a held result actually delivers it');
{
  /* The require-approval flow is "the finished work waits until you say go".
     Approving removed the item and returned ok:true - for approve and reject
     alike - so nothing was ever behind the go. The screen said "Sent" on top of
     a server that had sent nothing. */
  store.clear();
  W.__setRequireUser(async () => ({ email: 'o@x.com' }));

  const sent = [];
  const envMail = Object.assign({}, env, { EMAIL_API_KEY: 'k' });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    sent.push({ url: String(url), body: String((opts && opts.body) || '') });
    return new Response(JSON.stringify({ id: 'e1' }), { status: 200 });
  };

  const act = (e, id, action) => W.crewApprovalAct(new Request('https://w/api/approvals/act',
    { method:'POST', body: JSON.stringify({ id, action }) }), e);

  const seed = async () => putRec('approvals','o@x.com', { items: [
    { id:'ap-send',   actionType:'send',   title:'Email the brief', result:{ type:'doc', body:'the finished brief' } },
    { id:'ap-review', actionType:'review', title:'Look at this',    result:{ type:'doc', body:'reading only' } },
  ] });

  await seed();
  const r1 = await (await act(envMail, 'ap-send', 'approve')).json();
  ok(r1.ok === true && r1.delivered === true, 'a send-type approval is delivered', r1);
  ok(sent.length === 1, 'exactly one message went out', sent.length);
  ok(/the finished brief/.test(sent[0].body), 'carrying the finished work', sent[0].body.slice(0,60));
  ok(!getRec('approvals','o@x.com').items.some(x=>x.id==='ap-send'), 'and it leaves the queue');

  /* Rejecting must never send. */
  sent.length = 0;
  await seed();
  const r2 = await (await act(envMail, 'ap-send', 'reject')).json();
  ok(r2.delivered === null, 'rejecting delivers nothing', r2.delivered);
  ok(sent.length === 0, 'and sends nothing', sent.length);

  /* A review-only item has nothing to send - approving it is just reading it. */
  sent.length = 0;
  await seed();
  const r3 = await (await act(envMail, 'ap-review', 'approve')).json();
  ok(r3.delivered === null, 'a review-only approval is resolved, not sent', r3.delivered);
  ok(sent.length === 0, 'with nothing emailed', sent.length);

  /* No email provider: approved, but honestly not delivered. */
  sent.length = 0;
  await seed();
  const r4 = await (await act(env, 'ap-send', 'approve')).json();
  ok(r4.delivered === false, 'with no provider it says it was NOT delivered', r4.delivered);
  ok(sent.length === 0, 'because nothing could be', sent.length);

  /* A send that fails keeps the work, or there is nothing left to retry. */
  globalThis.fetch = async () => { throw new Error('mail down'); };
  await seed();
  const r5 = await act(envMail, 'ap-send', 'approve');
  ok(r5.status === 502, 'a failed send is an error', r5.status);
  ok(getRec('approvals','o@x.com').items.some(x=>x.id==='ap-send'),
     'and the finished work is still in the queue', true);

  /* An approval that only ever existed on the client is not an error. */
  globalThis.fetch = realFetch;
  await seed();
  const r6 = await (await act(envMail, 'a1730000000000', 'approve')).json();
  ok(r6.ok === true && r6.found === false,
     'resolving something the server never had is fine, not a failure', r6);
}

if (report() > 0) process.exitCode = 1;
done();
