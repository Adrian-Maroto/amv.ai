/* EDITING AN APPROVAL BEFORE YOU APPROVE IT.

   The client has always sent this - fire and forget, with `.catch(()=>{})` - and
   no route existed, so every edit 404'd silently and lived only in the browser
   that made it. Approving from a second device then sent the ORIGINAL text to
   the original recipients, which is the worst possible outcome for a queue whose
   entire job is "check this before it goes".

   An approval is a pending action against real accounts, so the patch is
   whitelisted rather than merged: a caller must not be able to set fields the
   UI never offers, and above all must not be able to make one approve itself. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'apvedit.harness.mjs');
writeFileSync(harness, src + `
export { crewApprovalEdit, crewApprovals, crewApprovalAct, DB };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40),
  AMV_KV: {
    async get(k){ return store.has(k) ? store.get(k) : null; },
    async put(k, v){ store.set(k, String(v)); },
    async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys:[...store.keys()].filter(k=>k.startsWith(prefix||'')).map(name=>({name})), list_complete:true }; },
  },
};
W.__setRequireUser(async () => ({ email: 'a@x.com', plan: 'pro' }));
const req = (body) => new Request('https://x/api/approvals/edit', { method:'POST', body: JSON.stringify(body || {}) });

const seed = async () => {
  store.clear();
  await W.DB.put(env, 'approvals', 'a@x.com', { items: [
    { id:'A1', title:'Monthly update', destination:'42 customers', recipients:42,
      autoApprove:false, result:{ subject:'Original', body:'Original body' } },
    { id:'A2', title:'Other', destination:'nobody', recipients:0, autoApprove:false },
  ]});
};

section('An edit is actually saved');
{
  await seed();
  const r = await W.crewApprovalEdit(req({ id:'A1', patch:{ title:'Edited update', recipients:7,
    result:{ subject:'Edited', body:'Edited body' } } }), env);
  const d = await r.json();
  ok(d.ok === true, 'it saves', d);

  const rec = await W.DB.get(env, 'approvals', 'a@x.com');
  const a1 = rec.items.find(a => a.id === 'A1');
  ok(a1.title === 'Edited update', 'the new title is what will be used', a1.title);
  ok(a1.recipients === 7, 'and the new recipient count', a1.recipients);
  ok(a1.result.subject === 'Edited', 'and the edited content itself', a1.result);
}

section('Editing one does not disturb the other');
{
  const rec = await W.DB.get(env, 'approvals', 'a@x.com');
  ok(rec.items.length === 2, 'the queue still has both', rec.items.length);
  const a2 = rec.items.find(a => a.id === 'A2');
  ok(a2.title === 'Other', 'and the untouched one is untouched', a2.title);
}

section('Fields the patch did not mention are kept');
{
  /* A patch is not a replacement. Dropping unmentioned fields would quietly
     strip the destination off a pending email. */
  await seed();
  await W.crewApprovalEdit(req({ id:'A1', patch:{ title:'Only the title' } }), env);
  const rec = await W.DB.get(env, 'approvals', 'a@x.com');
  const a1 = rec.items.find(a => a.id === 'A1');
  ok(a1.destination === '42 customers', 'the destination survives', a1.destination);
  ok(a1.result && a1.result.body === 'Original body', 'and so does the content', a1.result);
}

section('An approval cannot be made to approve itself');
{
  /* The one thing this route must never allow. Everything in the queue is there
     precisely because a person has not agreed to it yet. */
  await seed();
  await W.crewApprovalEdit(req({ id:'A1', patch:{
    autoApprove:true, approved:true, status:'approved', id:'A9', sent:true } }), env);
  const rec = await W.DB.get(env, 'approvals', 'a@x.com');
  const a1 = rec.items.find(a => a.id === 'A1');
  ok(a1.autoApprove === false, 'autoApprove is not settable through a patch', a1.autoApprove);
  ok(a1.approved === undefined, 'nor an approved flag', a1.approved);
  ok(a1.status === undefined, 'nor a status', a1.status);
  ok(a1.sent === undefined, 'nor anything claiming it was sent', a1.sent);
  ok(a1.id === 'A1', 'and the id cannot be rewritten to point at another item', a1.id);
}

section('A runaway edit cannot fill the record');
{
  await seed();
  const r = await W.crewApprovalEdit(req({ id:'A1', patch:{ result:{ body:'x'.repeat(200000) } } }), env);
  const d = await r.json();
  ok(r.status === 413 && d.code === 'too_big', 'an oversized edit is refused', d.code);

  const rec = await W.DB.get(env, 'approvals', 'a@x.com');
  const a1 = rec.items.find(a => a.id === 'A1');
  ok(a1.result.body === 'Original body', 'and nothing was written', a1.result.body);
}

section('Long text is bounded rather than refused outright');
{
  await seed();
  await W.crewApprovalEdit(req({ id:'A1', patch:{ title:'t'.repeat(9000) } }), env);
  const rec = await W.DB.get(env, 'approvals', 'a@x.com');
  const a1 = rec.items.find(a => a.id === 'A1');
  ok(a1.title.length <= 4000, 'a long title is trimmed, not rejected', a1.title.length);
}

section('A nonsense recipient count cannot be stored');
{
  await seed();
  await W.crewApprovalEdit(req({ id:'A1', patch:{ recipients:-5 } }), env);
  let rec = await W.DB.get(env, 'approvals', 'a@x.com');
  ok(rec.items.find(a => a.id === 'A1').recipients === 0, 'a negative count becomes zero',
     rec.items.find(a => a.id === 'A1').recipients);

  await W.crewApprovalEdit(req({ id:'A1', patch:{ recipients:'many' } }), env);
  rec = await W.DB.get(env, 'approvals', 'a@x.com');
  ok(rec.items.find(a => a.id === 'A1').recipients === 0, 'and so does a non-number',
     rec.items.find(a => a.id === 'A1').recipients);
}

section('It refuses what it should refuse');
{
  await seed();
  const missing = await W.crewApprovalEdit(req({ id:'NOPE', patch:{ title:'x' } }), env);
  ok(missing.status === 404, 'an approval that is not yours is simply not found', missing.status);

  const noId = await W.crewApprovalEdit(req({ patch:{ title:'x' } }), env);
  ok(noId.status === 400, 'an edit with no id is rejected', noId.status);

  const noPatch = await W.crewApprovalEdit(req({ id:'A1' }), env);
  ok(noPatch.status === 400, 'and one with no patch', noPatch.status);

  W.__setRequireUser(async () => null);
  const anon = await W.crewApprovalEdit(req({ id:'A1', patch:{ title:'x' } }), env);
  ok(anon.status === 401, 'and a caller who is not signed in', anon.status);
  W.__setRequireUser(async () => ({ email:'a@x.com', plan:'pro' }));
}

section('The route the client has always called now exists');
{
  ok(src.includes("case '/api/approvals/edit'"), 'it is routed', true);
  const body = src.slice(src.indexOf('async function crewApprovalEdit'),
                         src.indexOf('async function crewApprovalAct'));
  ok(/requireUser\(request, env\)/.test(body), 'behind a signed-in user');
  ok(/guardAction\(env, 'apvedit:/.test(body), 'and a rate limit');
}

if (report('approval-edit') > 0) process.exitCode = 1;
done();
