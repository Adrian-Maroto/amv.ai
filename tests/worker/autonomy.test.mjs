/* AUTONOMY WIRING — proves the Auto Approve backend behaves honestly:
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
writeFileSync(harness, src + '\nexport { runDueAutomations, _enqueueApproval };\n');
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
await W._enqueueApproval(env, 'user@x.com', item, 'Hi there — here is the finished update. Thanks!');
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

if (report() > 0) process.exitCode = 1;
done();
