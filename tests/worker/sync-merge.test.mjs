/* SYNC — conversations are the most valuable thing a user has here, and the
   sync path could silently destroy them. Every list was stored with
   Object.assign, which REPLACES the whole key, so the last device to push won
   wholesale: a phone with a partial copy pushed 3 conversations and the
   laptop's 50 were gone from the server, then gone locally on its next pull.
   These assertions cover the merge, the revision check that decides when a
   deletion is allowed to stick, and the trimmed-upload case that could erase a
   Dev project. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'syncmerge.harness.mjs');
writeFileSync(harness, src +
  '\nexport { _mergeSyncList, _mergeSyncRecord, _syncPick, _syncWeight, SYNC_MERGE_KEYS, syncPush, syncPull, DB, signToken };\n');
const W = await import(harness + '?t=' + Date.now());

const chat = (id, n, when) => ({ id, title: 'chat ' + id, msgs: Array.from({ length: n }, (_, i) => ({ r: 'u', c: 'm' + i })), updated: when });
const ids = list => list.map(c => c.id).sort().join(',');

section('A stale device cannot delete another device’s conversations');
{
  const laptop = [chat('a', 4, 300), chat('b', 2, 200), chat('c', 6, 100)];
  const phone = [chat('d', 1, 400)];                 // only knows about its own
  const out = W._mergeSyncList(laptop, phone);
  ok(ids(out) === 'a,b,c,d', 'all four survive - nothing is dropped', ids(out));
  ok(out[0].id === 'd', 'and the newest is first, which is how they are displayed', out[0].id);
}

section('The same conversation edited on two devices keeps the newer one');
{
  const older = [chat('a', 3, 100)];
  const newer = [chat('a', 7, 500)];
  ok(W._mergeSyncList(older, newer)[0].msgs.length === 7, 'the newer edit wins');
  ok(W._mergeSyncList(newer, older)[0].msgs.length === 7, 'in either direction', true);
}

section('A trimmed upload can never erase the full copy');
/* The client sheds the heavy `state` blob off older Dev sessions to fit the 4MB
   cap. Without a tiebreak that shed copy would overwrite a 10,000-line project. */
{
  const full = { id: 's1', title: 'Dev project', updated: 900, state: { files: ['a lot of code'] } };
  const trimmed = { id: 's1', title: 'Dev project', updated: 900, state: null };
  ok(W._mergeSyncList([full], [trimmed])[0].state !== null,
     'the copy that still has its body wins on an equal timestamp');
  ok(W._mergeSyncList([trimmed], [full])[0].state !== null, 'regardless of order');
  ok(W._syncWeight(full) > W._syncWeight(trimmed), 'because substance breaks the tie', [W._syncWeight(full), W._syncWeight(trimmed)]);

  // But a genuinely newer save still wins, even if it is smaller - the user may
  // have deleted messages on purpose.
  const shorter = { id: 's1', updated: 1000, state: null };
  ok(W._mergeSyncList([full], [shorter])[0].updated === 1000,
     'a real later save still wins - shrinking on purpose is allowed');
}

section('An item with no id at all is kept, not silently dropped');
{
  const out = W._mergeSyncList([{ text: 'a note with no id' }], [chat('a', 1, 5)]);
  ok(out.length === 2, 'both survive', out.length);
  ok(out.some(x => x.text === 'a note with no id'), 'including the one that cannot be keyed');
}

section('Scalars are not merged - last write wins on a preference');
{
  const out = W._mergeSyncRecord({ model: 'core', convs: [chat('a', 1, 1)] }, { model: 'smart' }, false);
  ok(out.model === 'smart', 'a model choice is replaced, not combined', out.model);
  ok(out.convs.length === 1, 'and untouched keys are preserved');
  ok(!W.SYNC_MERGE_KEYS.has('model'), 'model is deliberately not in the merge set');
  ok(W.SYNC_MERGE_KEYS.has('convs') && W.SYNC_MERGE_KEYS.has('sessions'),
     'while the lists that hold real work are');
}

section('An up-to-date client CAN delete');
/* The whole point of the revision: merging forever would mean a deleted chat
   always came back. A client that has seen the current version is trusted. */
{
  const out = W._mergeSyncRecord({ convs: [chat('a', 1, 1), chat('b', 1, 2)] }, { convs: [chat('a', 1, 1)] }, true);
  ok(out.convs.length === 1 && out.convs[0].id === 'a',
     'when authoritative, the removal sticks', ids(out.convs));
}

/* ---- the real route, end to end ---- */
function makeEnv() {
  const kv = new Map();
  return { _kv: kv, JWT_SECRET: 'test-secret-abcdefghijklmnop',
    AMV_KV: { get: async k => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, String(v)); },
      delete: async k => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })) }) } };
}
const push = (env, token, data, baseRev) => W.syncPush(new Request('https://w/sync/push', {
  method: 'POST', headers: { Authorization: 'Bearer ' + token },
  body: JSON.stringify({ data, baseRev }) }), env);
const pull = (env, token) => W.syncPull(new Request('https://w/sync/pull', {
  method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: '{}' }), env);

section('Two devices, one account: the real failure, now fixed');
{
  const env = makeEnv();
  const token = await W.signToken({ email: 'alice@x.com' }, env.JWT_SECRET, 3600, env, 'access');

  // Laptop syncs 50 conversations.
  const laptop = Array.from({ length: 50 }, (_, i) => chat('L' + i, 3, 1000 + i));
  const first = await (await push(env, token, { convs: laptop }, 0)).json();
  ok(first.ok === true, 'the laptop pushes 50 conversations');
  ok(first.rev === 1, 'and gets a revision back', first.rev);

  // Phone signs in, knows nothing, pushes its own 2 with a stale base revision.
  const phone = [chat('P1', 1, 2000), chat('P2', 1, 2001)];
  const second = await (await push(env, token, { convs: phone }, 0)).json();
  ok(second.merged === true, 'the phone push is recognised as stale and merged', second.merged);

  const after = (await (await pull(env, token)).json()).data;
  ok(after.convs.length === 52, 'all 52 conversations are on the server', after.convs.length);
  ok(after.convs.some(c => c.id === 'L0') && after.convs.some(c => c.id === 'P1'),
     'the laptop’s work and the phone’s both survived');
}

section('And the same push with a current revision deletes properly');
{
  const env = makeEnv();
  const token = await W.signToken({ email: 'bob@x.com' }, env.JWT_SECRET, 3600, env, 'access');
  await push(env, token, { convs: [chat('a', 1, 1), chat('b', 1, 2)] }, 0);
  const rev = (await (await pull(env, token)).json()).rev;
  // The user deletes 'b' on the device that is up to date.
  await push(env, token, { convs: [chat('a', 1, 1)] }, rev);
  const after = (await (await pull(env, token)).json()).data;
  ok(after.convs.length === 1, 'deleting a chat works when the client is current', after.convs.length);
  ok(after.convs[0].id === 'a', 'and it deleted the right one', after.convs[0].id);
}

section('A merge is recorded, so a device stuck in conflict is visible');
ok(/audit\(env, 'sync_merged'/.test(src), 'a merged push is audited rather than silent');

section('The client merges on pull instead of overwriting');
{
  const client = readFileSync(join(ROOT, 'app.js'), 'utf8');
  ok(!/server wins on login/.test(client), 'the overwrite-on-login comment and behaviour are gone');
  ok(/_mergeById\(local, data\[k\]\)/.test(client), 'a pull merges list keys into what is already here');
  ok(/_mergeById\(Array\.isArray\(_SESSIONS\)/.test(client), 'including Recents, where Dev projects live');
  ok(/baseRev:this\.syncRev/.test(client), 'and every push declares the revision it was working from');
  ok(/c\.updated=Date\.now\(\)/.test(client), 'conversations are stamped on write so the merge has a real clock');
}

report();
done();
