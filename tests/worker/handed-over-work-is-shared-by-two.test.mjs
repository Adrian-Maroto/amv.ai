/* HANDED-OVER WORK IS SHARED BY TWO PEOPLE, AND ONLY TWO (owner, Nov 24:
   "when you pull in your last work ... it pulls in a link ... and if the
   original person refreshes, it updates with their old work and the new").

   A handoff can carry one item - a chat, a design, a project or code - stored
   once as hoitem:<handoff id>. Held here against the real handlers:
     · it is stored with the handoff, and the inbox line says what it is;
     · the sender and the recipient can read it; anybody else is told it does
       not exist, the same answer as a wrong id;
     · a save lands only on top of the version the writer saw - two people
       saving at once cannot silently erase each other: the later one gets 409
       and the current copy, and the version does not move;
     · the shape and the size are checked, before anything is delivered;
     · erasure removes it and the data export returns it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'hoitem.harness.mjs');
writeFileSync(harness, src +
  '\nexport { handoffList, handoffCreate, handoffItemGet, handoffItemPut, DB };' +
  '\nexport function __setRequireUser(fn){ requireUser = fn; }\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = { AMV_KV: {
  async get(k){ return store.has(k) ? store.get(k) : null; },
  async put(k, v){ store.set(k, v); },
  async delete(k){ store.delete(k); },
  async list({ prefix }){ return { keys:[...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete:true }; },
} };
let asUser = 'alice@test.com';
W.__setRequireUser(async () => asUser ? { email: asUser } : null);
const call = async (fn, body) => { const r = await fn(new Request('https://api.amv.dev/x', { method:'POST',
  headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) }), env); return { status: r.status, d: await r.json() }; };

const CHAT = { msgs:[ { id:'m1', r:'u', c:'Draft the launch email' }, { id:'m2', r:'a', c:'Here is a first draft...' } ] };

section('The work goes with the handoff, and the inbox says what it is');
let r = await call(W.handoffCreate, { title:'Finish the launch email', to:'Bob@Test.com', item:{ kind:'chat', title:'Launch email', data:CHAT } });
ok(r.status === 200 && r.d.ok && /^h[a-z0-9]+$/.test(r.d.id), 'alice hands bob a chat', r);
const HID = r.d.id;
const stored = await W.DB.get(env, 'hoitem', HID);
ok(stored && stored.kind === 'chat' && stored.v === 1 && stored.from === 'alice@test.com' && stored.to === 'bob@test.com', 'stored once, version 1, between alice and bob', stored);
ok(stored.data.msgs.length === 2 && stored.data.msgs[0].id === 'm1', 'with its messages and their ids', stored && stored.data);
asUser = 'bob@test.com';
r = await call(W.handoffList, {});
ok(r.d.incoming[0].item && r.d.incoming[0].item.kind === 'chat' && r.d.incoming[0].item.title === 'Launch email', 'bob’s inbox line names the chat that came with it', r.d.incoming[0]);

section('Two people can open it; nobody else can tell it exists');
r = await call(W.handoffItemGet, { id: HID });
ok(r.status === 200 && r.d.item.data.msgs.length === 2 && r.d.item.v === 1, 'bob opens it', r.status);
asUser = 'alice@test.com';
r = await call(W.handoffItemGet, { id: HID });
ok(r.status === 200, 'alice opens it', r.status);
asUser = 'mallory@test.com';
r = await call(W.handoffItemGet, { id: HID });
const wrong = await call(W.handoffItemGet, { id: 'hzzzzzzzzzzzz' });
ok(r.status === 404 && wrong.status === 404 && JSON.stringify(r.d) === JSON.stringify(wrong.d), 'a stranger gets exactly what a wrong id gets', [r, wrong]);
r = await call(W.handoffItemPut, { id: HID, base: 1, data: CHAT });
ok(r.status === 404 && (await W.DB.get(env, 'hoitem', HID)).v === 1, 'and cannot write to it', r.status);
asUser = null;
r = await call(W.handoffItemGet, { id: HID });
ok(r.status === 401, 'signed out: 401', r.status);

section('A save lands on top of the version it saw, or not at all');
asUser = 'bob@test.com';
const BOB = { msgs: CHAT.msgs.concat({ id:'m3', r:'u', c:'Make it shorter' }) };
r = await call(W.handoffItemPut, { id: HID, base: 1, data: BOB });
ok(r.status === 200 && r.d.v === 2, 'bob saves version 2 on top of 1', r);
asUser = 'alice@test.com';
const ALICE = { msgs: CHAT.msgs.concat({ id:'m9', r:'u', c:'Add the date' }) };
r = await call(W.handoffItemPut, { id: HID, base: 1, data: ALICE });
ok(r.status === 409 && r.d.error === 'stale' && r.d.item.v === 2 && r.d.item.data.msgs.some(m => m.id === 'm3'), 'alice, still on 1, is refused and handed bob’s version', r);
const after = await W.DB.get(env, 'hoitem', HID);
ok(after.v === 2 && after.data.msgs.some(m => m.id === 'm3') && !after.data.msgs.some(m => m.id === 'm9'), 'bob’s work is not erased by the stale save', after.data.msgs.map(m => m.id));
r = await call(W.handoffItemPut, { id: HID, base: 2, data: { msgs: BOB.msgs.concat(ALICE.msgs[2]) } });
ok(r.status === 200 && r.d.v === 3, 'merged on top of 2, alice saves 3', r);
r = await call(W.handoffItemGet, { id: HID });
ok(r.d.item.data.msgs.map(m => m.id).join(',') === 'm1,m2,m3,m9' && r.d.item.by === 'alice@test.com', 'both people’s messages, in order', r.d.item.data.msgs.map(m => m.id));

section('The shape and the size are checked before anything is delivered');
/* Writes nobody waits for (an audit line) from the calls above can land at
   any time; under a loaded gate one landed between the two counts below and
   read as "a refused handoff stored something". Counted once the store is
   still, and any new key is named, so a real leak says what it was. */
const settle = async () => { let n = -1; while (n !== store.size) { n = store.size; await new Promise(x => setTimeout(x, 60)); } };
await settle();
const before = store.size, keysBefore = new Set(store.keys());
r = await call(W.handoffCreate, { title:'x', to:'bob@test.com', item:{ kind:'spreadsheet', data:{ state:{} } } });
ok(r.status === 400 && r.d.error === 'bad_item', 'an unknown kind is refused', r);
r = await call(W.handoffCreate, { title:'x', to:'bob@test.com', item:{ kind:'chat', data:{ msgs:[] } } });
ok(r.status === 400, 'a chat with no messages is refused', r.status);
r = await call(W.handoffCreate, { title:'x', to:'bob@test.com', item:{ kind:'studio', data:{ state:{ html:'x'.repeat(950000) } } } });
ok(r.status === 413 && /too large/i.test(r.d.message), 'work over the limit is refused, saying so', r.d.message);
await settle();
const added = [...store.keys()].filter(k => !keysBefore.has(k));
ok(store.size === before && !added.length, 'and none of those delivered or stored anything', added);
r = await call(W.handoffItemPut, { id: HID, base: 3, data: { state:{} } });
ok(r.status === 400 && (await W.DB.get(env, 'hoitem', HID)).v === 3, 'a save cannot change a chat into something else', r.status);
r = await call(W.handoffCreate, { title:'Just a note', context:'no work attached', to:'bob@test.com' });
ok(r.status === 200 && !(await W.DB.get(env, 'hoitem', r.d.id)), 'a handoff with no work still works, and stores no item', r.status);

section('Erasure removes it; the export returns it');
ok(/'handoff:', 'hoitem:'/.test(src), 'it is in the backup', '');
const erase = src.slice(src.indexOf('async function _eraseAccount'));
ok(/DB\.get\(env, 'handoff', email\)[\s\S]{0,400}DB\.del\(env, 'hoitem', hid\)/.test(erase), 'erasure walks the person’s handoffs and deletes each shared item', '');
ok(/records\.hoitem = items/.test(src), 'and the data export includes them', '');

report();
done();
