/* CREW / HANDOFF sync endpoints - these back the Crew jobs, approvals, and
   Handoff features. They work locally; these routes persist + sync them. Proven
   here: they require auth, they round-trip data, a handoff reaches the RIGHT
   recipient, the sender can't be spoofed, and one user can't tamper another's. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'crew.harness.mjs');
writeFileSync(harness, src +
  '\nexport { crewJobs, crewApprovals, crewApprovalAct, handoffList, handoffCreate, handoffAct };' +
  '\nexport function __setRequireUser(fn){ requireUser = fn; }\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = { AMV_KV: {
  async get(k){ return store.has(k)?store.get(k):null; },
  async put(k,v){ store.set(k,v); },
  async delete(k){ store.delete(k); },
  async list({prefix}){ return { keys:[...store.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})), list_complete:true }; }
}};

let asUser = 'alice@test.com';
W.__setRequireUser(async () => asUser ? { email: asUser } : null);
const req = (body, method='POST') => new Request('https://api.amv.dev/x', {
  method, headers:{'Content-Type':'application/json'}, body: body!==undefined?JSON.stringify(body):undefined });

section('Crew jobs round-trip and require auth');
asUser = null;
let r = await W.crewJobs(new Request('https://x',{method:'GET'}), env);
ok(r.status === 401, 'no auth → 401', r.status);
asUser = 'alice@test.com';
await W.crewJobs(req({ id:'research', on:true }), env);
r = await W.crewJobs(new Request('https://x',{method:'GET'}), env);
let d = await r.json();
ok(d.jobs.some(j=>j.key==='research' && j.on_flag), 'a toggled job is saved and returned', d.jobs);

section('Approvals list + resolve');
store.set('approvals:alice@test.com', JSON.stringify({ items:[{id:'ap1',title:'Send email'},{id:'ap2',title:'Post tweet'}] }));
r = await W.crewApprovals(req(undefined,'GET'), env); d = await r.json();
ok(d.approvals.length === 2, 'pending approvals are listed', d.approvals.length);
await W.crewApprovalAct(req({ id:'ap1', action:'approve' }), env);
r = await W.crewApprovals(req(undefined,'GET'), env); d = await r.json();
ok(d.approvals.length === 1 && d.approvals[0].id==='ap2', 'acting on one resolves just that one', d.approvals);

section('Handoff reaches the right recipient, sender cannot be spoofed');
asUser = 'alice@test.com';
r = await W.handoffCreate(req({ title:'Finish the deck', context:'slides 4-6', to:'BOB@test.com', from_email:'ceo@spoof.com' }), env);
ok((await r.json()).ok, 'alice creates a handoff to bob');
// bob sees it incoming
asUser = 'bob@test.com';
r = await W.handoffList(req(undefined,'GET'), env); d = await r.json();
ok(d.incoming.length === 1, 'bob has one incoming handoff', d.incoming.length);
ok(d.incoming[0].from_email === 'alice@test.com', 'the sender is the AUTHENTICATED user, not the spoofed value', d.incoming[0].from_email);
ok(d.incoming[0].title === 'Finish the deck', 'the content arrived intact');
// alice sees it in sent
asUser = 'alice@test.com';
r = await W.handoffList(req(undefined,'GET'), env); d = await r.json();
ok(d.sent.length === 1, 'alice has it in her sent list', d.sent.length);

section('Marking one done reaches the person who sent it, and reaches nothing else');
/* This used to assert that bob's action never touched alice's records at all.
   That kept the two copies isolated and left the SENDER's view permanently
   wrong: alice went on seeing "waiting on them" for ever, including after the
   work was finished. A handoff is a thing between two people, and marking it
   done on one side only is the half the sender is not watching.

   So the rule is not "never touch the other record" - handoffCreate already
   writes into the recipient's inbox, bounded and rate limited. The rule is that
   the write is BOUNDED: a status, from a fixed set, on an entry that is in the
   actor's own inbox, belonging to the sender recorded on that entry. */
asUser = 'bob@test.com';
const hid = JSON.parse(store.get('handoff:bob@test.com')).incoming[0].id;
const beforeAlice = JSON.parse(store.get('handoff:alice@test.com'));
await W.handoffAct(req({ id:hid, action:'done' }), env);

d = JSON.parse(store.get('handoff:bob@test.com'));
ok(d.incoming[0].status === 'done', 'bob can mark his own handoff done', d.incoming[0].status);

const afterAlice = JSON.parse(store.get('handoff:alice@test.com'));
ok(afterAlice.sent[0].status === 'done', 'and alice sees that it is done', afterAlice.sent[0].status);
/* Nothing else about her record moved. */
ok(afterAlice.sent.length === beforeAlice.sent.length, 'no entry was added to her record', afterAlice.sent.length);
ok(afterAlice.sent[0].title === beforeAlice.sent[0].title, 'the title is untouched', afterAlice.sent[0].title);
ok(afterAlice.sent[0].context === beforeAlice.sent[0].context, 'and the content', true);
ok(afterAlice.sent[0].to_email === beforeAlice.sent[0].to_email, 'and who it was for', afterAlice.sent[0].to_email);
ok((afterAlice.incoming || []).length === (beforeAlice.incoming || []).length,
   'and her own inbox is not written to at all', (afterAlice.incoming||[]).length);

/* An id the actor was never handed cannot be acted on, so nobody can reach a
   record by guessing one. */
const forged = await W.handoffAct(req({ id:'h-not-mine', action:'done' }), env);
ok(forged.status === 404, 'an id that is not in your own inbox is refused', forged.status);

section('Input validation');
asUser = 'alice@test.com';
r = await W.handoffCreate(req({ title:'', to:'' }), env);
ok(r.status === 400, 'a handoff with no title/recipient is rejected', r.status);

report();
done();
