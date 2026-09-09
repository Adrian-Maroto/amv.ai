/* THE DOCTRINE WAS IN ONE FILE AND THE ENFORCEMENT IN ANOTHER.

   `docs/AUTONOMY.md` says it plainly: an approval that expires is a denial, an
   approval nobody answered is a denial. The web-agent path enforces exactly
   that - a ticket lives ten minutes, with a comment saying an old approval left
   in a tab is not a standing licence.

   The crew queue enforced nothing. That is the queue holding finished work
   which SENDS EMAIL when approved, and an item could sit in it for a month and
   go out on a click, carrying facts that were true when it was written. A
   client who was dropped a fortnight ago still gets the weekly update.

   What is asserted here is that the deadline lives on the SERVER. The card
   draws a countdown, and the card is also the half a stale tab controls - so
   "may this still go out" has to be answered by the thing that does the
   sending. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'apvexpiry.harness.mjs');
writeFileSync(harness, src + `
export { crewApprovalAct, _enqueueApproval, _apvExpired, _apvExpiresAt, AUTO_APPROVAL_TTL_MS };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const EMAIL = 'o@x.com';
const store = new Map();
const env = {
  JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx',
  EMAIL_API_KEY: 'k',
  AMV_KV: {
    async get(k){ return store.has(k) ? store.get(k) : null; },
    async put(k, v){ store.set(k, v); },
    async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
  }
};
W.__setRequireUser(async () => ({ email: EMAIL }));

let sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { sent.push(1); return new Response('{}', { status: 200 }); };

/* A FRESH ID PER CASE, because the send-once claim is permanent on success.

   Approving twice with the same id is refused as a duplicate - that is the
   guard against a double press sending somebody's draft twice, and it is
   correct. Reusing one id across sections made the second successful approve
   look like an expiry failure, which is the test tripping over a real
   protection rather than a defect. */
let _n = 0;
const nextId = () => 'a' + (++_n);
let ID = 'a0';
const put = (item) => { ID = item.id; store.set('approvals:' + EMAIL, JSON.stringify({ items: [item] })); };
const base = (over) => Object.assign({
  id: nextId(), title: 'Your weekly client update', actionType: 'send',
  result: { type: 'doc', title: 't', body: 'b' }, preview: 'p',
  startedAt: 0, readyAt: 0, autoApprove: false,
}, over || {});
const act = async (action) => {
  sent = [];
  const r = await W.crewApprovalAct(new Request('https://x/v1/crew/approval', {
    method: 'POST', body: JSON.stringify({ id: ID, action }),
  }), env);
  return { status: r.status, body: await r.json().catch(() => ({})), sent: sent.length };
};

const DAY = 86400000;

section('A fresh approval still sends, so the bound did not break the feature');
{
  put(base({ readyAt: Date.now() - 60_000, expiresAt: Date.now() + 6 * DAY }));
  const r = await act('approve');
  ok(r.status === 200, 'it is accepted', r);
  ok(r.sent === 1, 'and the thing actually goes out', r);
}

section('An approval past its date does NOT send');
{
  put(base({ readyAt: Date.now() - 30 * DAY, expiresAt: Date.now() - 23 * DAY }));
  const r = await act('approve');
  ok(r.status === 409, 'it is refused', r);
  ok(r.body.error === 'approval_expired', 'by name, so the client can say something true', r.body);
  ok(r.sent === 0, 'and NOTHING was sent - which is the whole point', r);
}

section('The refusal says what to do next, not just that it failed');
{
  put(base({ readyAt: Date.now() - 30 * DAY, expiresAt: Date.now() - 23 * DAY }));
  const r = await act('approve');
  ok(/run the job again/i.test(r.body.message || ''),
     'it names the way out - the recurring job will make a fresh one', r.body.message);
  ok(/may have moved on|facts/i.test(r.body.message || ''),
     'and why refusing is the right answer rather than an obstacle', r.body.message);
}

section('The work is refused, not destroyed');
{
  put(base({ readyAt: Date.now() - 30 * DAY, expiresAt: Date.now() - 23 * DAY }));
  await act('approve');
  const rec = JSON.parse(store.get('approvals:' + EMAIL));
  ok((rec.items || []).length === 1,
     'an expired draft stays visible - binning somebody’s work to enforce a deadline is the worse outcome', rec.items);
}

section('You can always say no');
{
  put(base({ readyAt: Date.now() - 30 * DAY, expiresAt: Date.now() - 23 * DAY }));
  const r = await act('reject');
  ok(r.status === 200, 'rejecting an expired item is accepted', r);
  ok(r.sent === 0, 'and sends nothing, obviously', r);
  const rec = JSON.parse(store.get('approvals:' + EMAIL));
  ok((rec.items || []).length === 0, 'and it leaves the queue', rec.items);
}

section('An item too old to date is refused, not trusted');
{
  /* The direction that matters. An undateable approval could be from this
     morning or from March; refusing costs one re-run, and the other way sends
     something of unknown age. */
  put(base({ readyAt: 0, expiresAt: 0 }));
  const r = await act('approve');
  ok(r.status === 409, 'no date means no send', r);
  ok(r.sent === 0, 'nothing went out', r);
  ok(/cannot tell how old/i.test(r.body.message || ''),
     'and it says so honestly rather than inventing an expiry', r.body.message);
}

section('An item written before any of this existed is still dated');
{
  /* No `expiresAt` at all, because it was enqueued by the old code. It is aged
     from when it was ready, so the queue that already exists gets the bound
     rather than being grandfathered out of it. */
  const fresh = base({ readyAt: Date.now() - 2 * DAY });   delete fresh.expiresAt;
  put(fresh);
  ok((await act('approve')).sent === 1, 'two days old, derived from readyAt: sends', true);

  const stale = base({ readyAt: Date.now() - 30 * DAY });  delete stale.expiresAt;
  put(stale);
  const r = await act('approve');
  ok(r.status === 409 && r.sent === 0, 'thirty days old, derived the same way: refused', r);
}

section('Enqueuing writes the deadline down rather than leaving it to be derived');
{
  store.delete('approvals:' + EMAIL);
  const before = Date.now();
  await W._enqueueApproval(env, EMAIL, { kind: 'task', detail: 'weekly note', notify: 'email' }, 'the finished text');
  const rec = JSON.parse(store.get('approvals:' + EMAIL));
  const it = rec.items[0];
  ok(Number(it.expiresAt) >= before + W.AUTO_APPROVAL_TTL_MS - 5000,
     'the deadline shown to a person is the one enforced, even if the default changes later', it.expiresAt);
  ok(it.reversible === false,
     'and an emailed result is marked as what it is: not undoable', it);
}

section('A result nobody emails has something to undo');
{
  store.delete('approvals:' + EMAIL);
  await W._enqueueApproval(env, EMAIL, { kind: 'task', detail: 'a draft', notify: 'app' }, 'text');
  const it = JSON.parse(store.get('approvals:' + EMAIL)).items[0];
  ok(it.reversible === true,
     'so the card can stop describing a draft and a send in the same words', it);
}

globalThis.fetch = realFetch;
if (report('an-approval-that-expires-is-a-denial') > 0) process.exitCode = 1;
done();
