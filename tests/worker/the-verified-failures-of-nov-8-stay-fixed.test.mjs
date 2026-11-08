/* THE VERIFIED FAILURES OF NOV 8 STAY FIXED (Nov 8 verified audit R01-R23).

   An independent audit reproduced twenty-three state-integrity failures -
   money, locks, deletion, the second sign-in step, agents' kept sign-ins,
   the Postgres mirror, restore freezes, and the file index - each with a
   small local scenario against the real handlers. Every one of those
   scenarios is here, with its result turned round into what must be true
   now. The counter object is the real class, one request at a time, as a
   Durable Object runs; KV, R2 and the vector index are local stand-ins that
   keep the providers' limits (one KV write a second per key, 64-byte vector
   ids). Nothing here reaches the network. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'v8fixed.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, counter, _claimOnce, _claimOnceDetail, _releaseClaim, _withWallet, _revRead, _fileIndexRemove, _recordTxn, _autoQuarantined, _pgRevNext, _pgGuarded, _pgMirror, _autoQueueConsume, _fidxSpace, signToken, libPut, libDelete, libList, _libRec, _agentJarSave, _agentJarLoad, _agentSignInsShown, _agentJarForget, _agentJarKey, _wallet, connSeal, totpConfirm, _totpNewSecret, _totpAt, _libFinishDeletes };\n');
globalThis.fetch = async () => { throw new Error('the network is not used here'); };
const W = await import(harness + '?t=' + Date.now());
const quiet = console.log; console.log = (...a) => { if (String(a[0]).startsWith('AUDIT')) return; quiet(...a); };
const originalNow = Date.now;
const fresh = () => { Date.now = originalNow; };
const copy=v=>v===undefined?undefined:structuredClone(v);
function environment(){
 const e={JWT_SECRET:'local-audit-only-'.repeat(4),CONNECT_KEY:'c'.repeat(44),APP_URL:'https://amv.test',_kv:new Map(),_meta:new Map(),_objects:new Map(),_r2:new Map(),_vectors:new Map(),_rateKeys:new Set(),_lastPut:new Map(),_rateErrors:0,_upserts:0,_deleteCalls:0,_idLengths:[]};
 e.AMV_KV={
  async get(k,opt){ const base=()=>e._kv.has(k)?e._kv.get(k):null; let val;
   if(e._get){val=await e._get(k,opt,base); if(val!==undefined)return val;}
   val=base(); return (opt==='json'||opt?.type==='json')&&val!==null?JSON.parse(val):val; },
  async put(k,v,opt){if(e._put)await e._put(k,v,opt); if(e._rateKeys.has(k)&&e._lastPut.has(k)&&Date.now()-e._lastPut.get(k)<1000){e._rateErrors++; throw new Error('429 same-key KV write limit');} e._lastPut.set(k,Date.now());e._kv.set(k,String(v)); if(opt?.metadata)e._meta.set(k,opt.metadata);},
  async delete(k){if(e._delete)await e._delete(k);e._kv.delete(k);e._meta.delete(k);},
  async list({prefix='',limit=1000,cursor}={}){const all=[...e._kv.keys()].filter(k=>k.startsWith(prefix)).sort();const offset=+(cursor||0);const keys=all.slice(offset,offset+limit).map(name=>({name,metadata:e._meta.get(name)}));return {keys,list_complete:offset+keys.length>=all.length,cursor:String(offset+keys.length)};}
 };
 e.AMV_COUNTER={idFromName:n=>n,get:n=>({async fetch(u,init){
  const b=JSON.parse(init.body||'{}');if(e._doFault){const r=await e._doFault(n,b);if(r!==undefined)return r;}
  if(!e._objects.has(n)){const store=new Map();const o=new W.AMVCounter({storage:{async get(k){return copy(store.get(k));},async put(k,v){store.set(k,copy(v));},async delete(k){return store.delete(k);},async deleteAll(){store.clear();},async setAlarm(){},async deleteAlarm(){}}},e);e._objects.set(n,{o,store,q:Promise.resolve()});}
  const rec=e._objects.get(n); const p=rec.q.then(()=>rec.o.fetch(new Request(u,init)));rec.q=p.catch(()=>{});return p;
 }})};
 e.AMV_FILES={async put(k,v){e._r2.set(k,String(v));},async head(k){return e._r2.has(k)?{size:Buffer.byteLength(e._r2.get(k))}:null;},async get(k){return e._r2.has(k)?{text:async()=>e._r2.get(k)}:null;},async delete(ks){for(const k of [].concat(ks))e._r2.delete(k);},async list({prefix=''}={}){return {objects:[...e._r2.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key})),truncated:false};}};
 e.AI={async run(m,{text}){return {data:text.map(()=>[1,0.1,0.2])};}};
 e.VECTORS={async upsert(rows){e._upserts++;e._idLengths.push(...rows.map(r=>({bytes:Buffer.byteLength(r.id),chunk:r.metadata.i})));if(e._upsertFailure)throw new Error('simulated index outage');if(e._enforceIds&&rows.some(r=>Buffer.byteLength(r.id)>64))throw new Error('vector ID exceeds 64 bytes');for(const r of rows)e._vectors.set(r.id,copy(r));return {count:rows.length};},async query(){return {matches:[]};},async deleteByIds(ids){e._deleteCalls++;if(e._vectorDeleteFailure)throw new Error('simulated vector deletion failure');for(const id of ids)e._vectors.delete(id);return {count:ids.length};}};
 return e;
}
const json=o=>new Response(JSON.stringify(o));
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const txn=(id,extra={})=>({id,ts:100,provider:'stripe',email:'payer@example.com',amount:10,currency:'USD',kind:'subscription',status:'succeeded',ref:'invoice-A',...extra});
const seed=async(e,email='audit@example.com')=>{e._kv.set('acct:'+email,JSON.stringify({email,name:'Local audit',createdAt:Date.now()}));e._kv.set('ent:'+email,JSON.stringify({plan:'pro',source:'stripe',renewedAt:Date.now(),updatedAt:Date.now()}));return W.signToken({email},e.JWT_SECRET,3600,e,'access');};
const request=(url,b,token)=>new Request('https://api.amv.test'+url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(b)});
const upload=async(e,t,b)=>{const r=await W.libPut(request('/v1/library/put',b,t),e);return {status:r.status,body:await r.json()};};
const file=(body,sig='local-signature',name='audit.txt')=>({kind:'text',name,sig,size:body.length,body});


section('Locks: a strong object that cannot answer grants nothing, and an old holder frees nobody else (R01, R02)');
{
  for (const reply of [() => new Response('{"error":"unavailable"}', { status: 503 }), () => new Response('{"claimed":tru', { status: 200 }), () => new Response('', { status: 200 }), () => { throw new Error('timeout'); }]) {
    const e = environment(); e._doFault = async (n, b) => b.op === 'claim' ? reply() : undefined;
    const claims = await Promise.all([W._claimOnce(e, 'auditlock', 'same', 900), W._claimOnce(e, 'auditlock', 'same', 900)]);
    ok(claims.every(c => c === false) && !e._kv.has('auditlock:same'), 'a broken reply grants no lock, to either contender, and writes nothing else', claims);
  }
  const e = environment(); let now = 1700000000000; Date.now = () => now;
  const A = await W._claimOnce(e, 'payment', 'same', 15); now += 16000;
  const B = await W._claimOnce(e, 'payment', 'same', 15);
  await W._releaseClaim(e, 'payment', 'same');               // A's late release, naming no owner
  const C = await W._claimOnce(e, 'payment', 'same', 15);
  ok(A && B && C === false, 'A expired, B took it, A released: C is still kept out', { A, B, C });
  await W._releaseClaim(e, 'payment', 'same');               // B's own
  ok(await W._claimOnce(e, 'payment', 'same', 15), 'and once B gives it back, the next one gets it');
  fresh();
}

section('A wallet is changed from its strong copy, and a stalled writer cannot overwrite the next (R03, R04)');
{
  const e = environment(), key = 'wallet:seller@example.com', base = JSON.stringify({ balance: 100, lifetime: 100, holds: [] });
  e._kv.set(key, base);
  await W._withWallet(e, 'seller@example.com', w => { w.balance += 10; });
  let once = true; e._get = async k => { if (k === key && once) { once = false; return base; } };
  await W._withWallet(e, 'seller@example.com', w => { w.balance += 20; });
  ok((await W._withWallet(e, 'seller@example.com', w => ({ commit: false, b: w.balance }))).b === 130, 'a stale KV copy is never what a credit is applied to: 130', 130);
  once = true; e._get = async k => { if (k === key && once) { once = false; return base; } };
  ok((await W._wallet(e, 'seller@example.com')).balance === 130, 'and the balance shown is the strong one too, not the stale copy');
}
{
  const e = environment(), key = 'wallet:slow@example.com';
  e._kv.set(key, JSON.stringify({ balance: 100, lifetime: 100, holds: [] }));
  let now = 1700000000000; Date.now = () => now;
  const entered = gate(), resume = gate(); let once = true;
  e._put = async (k) => { if (k === key && once) { once = false; entered.resolve(); await resume.promise; } };
  const a = W._withWallet(e, 'slow@example.com', w => { w.balance += 10; });
  await entered.promise; now += 16000;
  await W._withWallet(e, 'slow@example.com', w => { w.balance += 20; });
  resume.resolve(); await a.catch(() => {});
  ok(JSON.parse(e._kv.get(key)).balance === 130, 'the stalled write lands and is put right: 130, not 110', JSON.parse(e._kv.get(key)).balance);
  ok((await W._withWallet(e, 'slow@example.com', w => ({ commit: false, b: w.balance }))).b === 130, 'and the balance itself is 130');
  fresh();
}

section('A deleted record is not answered from a stale copy when the authority cannot be asked (R05)');
{
  const e = environment(); e._doFault = async (n, b) => b.op === 'revGet' ? json({ unavailable: true }) : undefined;
  let threw = null; try { await W._revRead(e, 'data', 'deleted@example.com', JSON.stringify({ _rev: 1, chats: ['previously-deleted-content'] })); } catch (x) { threw = x; }
  ok(threw && threw.name === 'RecordSettlingError', 'refused as a short wait, never the old content', threw && threw.name);
  ok(await W._revRead(e, 'data', 'nobody@example.com', null) === null, 'with nothing stored, absent is still an answer');
}

section('One transaction id is one transaction (R08, R09, R16)');
{
  const e = environment();
  const a = await W._recordTxn(e, txn('same-event'));
  ok(a && (await W._recordTxn(e, txn('same-event'))).ref === 'invoice-A', 'the same event again is answered with what was recorded');
  ok(await W._recordTxn(e, txn('same-event', { ref: 'invoice-B' })) === null, 'the same id with another invoice is refused');
}
{
  const e = environment(); let fail = true;
  e._put = async (k, v) => { if (fail && k === 'txn:id:partial-event') { fail = false; throw new Error('interrupted final write'); } };
  const first = await W._recordTxn(e, txn('partial-event', { ts: 100 }));
  let hidden = true; e._get = async k => k === 'txn:id:partial-event' && hidden ? null : undefined;
  const second = await W._recordTxn(e, txn('partial-event', { ts: 200 })); hidden = false;
  const rows = [...e._kv.keys()].filter(k => k.startsWith('txn:e:'));
  ok(first === null && second && second.ts === 100 && rows.length === 1, 'a retry after a half-done write, reading a stale copy, finishes the one line at the first time', { rows, ts: second && second.ts });
}
{
  const e = environment(); e._rateKeys.add('txn:id:rate-limit-event');
  const r = await W._recordTxn(e, txn('rate-limit-event'));
  ok(r && e._rateErrors === 0 && [...e._kv.keys()].filter(k => k.startsWith('txn:e:')).length === 1, 'one event is one write to its id: inside KV’s one-a-second limit', { rateErrors: e._rateErrors });
}

section('Holds and switches that cannot be read hold (R10, R17)');
{
  const e = environment(); e._doFault = async (n, b) => { if (n === 'autoquar:held@example.com' && b.op === 'get') throw new Error('strong-store outage'); };
  ok(await W._autoQuarantined(e, 'held@example.com') === true, 'a quarantine that cannot be read is a hold');
}
{
  const e = environment(); let frozen = false, secondAck = false, secondRetry = false;
  e._doFault = async (n, b) => { if (b.op === 'swGet') return json({ map: frozen ? { 'feature:writes': { off: true } } : {}, wgen: frozen ? 1 : 0 }); };
  await W._autoQueueConsume({ messages: [{ body: { kind: 'outbox' }, ack() { frozen = true; }, retry() {} }, { body: { kind: 'outbox' }, ack() { secondAck = true; }, retry() { secondRetry = true; } }] }, e);
  ok(!secondAck && secondRetry, 'a restore switched on between two messages holds the second', { secondAck, secondRetry });
}

section('The Postgres mirror never writes without a revision from its own authority (R11, R12, R13)');
{
  const e = environment();
  await W.counter(e, 'pgrev:acct:held@example.com', { op: 'incr', amount: 10, keep: true });
  e._doFault = async (n) => { if (n === 'pgrev:acct:held@example.com') throw new Error('revision authority outage'); };
  const r = await W._pgRevNext(e, 'acct', 'acct:held@example.com');
  ok(r === null, 'an allocator outage gives no revision - never a count that starts again at one', r);
  e._doFault = null;
  ok(await W._pgRevNext(e, 'acct', 'acct:held@example.com') === 11, 'and once it answers, the next is above every one before');
}
{
  let wrote = false, began = false;
  const sql = { begin: async (fn) => { began = true; return fn(async () => [{ rev: 10 }]); } };
  let threw = false; try { await W._pgGuarded(sql, 'acct', 'user', null, async () => { wrote = true; }); } catch (x) { threw = true; }
  ok(threw && !wrote && !began, 'no revision: nothing is written and the mirror fails onto the repair list', { threw, wrote, began });
}
{
  let committed = false, rolledBack = false;
  const tx = (parts, ...values) => { if (!Array.isArray(parts) || !Object.hasOwn(parts, 'raw')) return { list: parts }; const q = parts.join('?').replace(/\s+/g, ' ').trim();
    if (q.includes('mirror_revisions')) return Promise.resolve([{ rev: 1 }]); if (q === 'SELECT id FROM accounts WHERE email = ?') return Promise.resolve([{ id: 'owner-id' }]);
    if (q.includes('SELECT id, email')) return Promise.resolve([{ id: 'owner-id', email: 'owner@example.com' }]); if (q.includes('INSERT INTO organizations')) return Promise.resolve([{ id: 'org-id' }]); return Promise.resolve([]); };
  tx.json = x => x; tx.begin = async fn => { try { const r = await fn(tx); committed = true; return r; } catch (x) { rolledBack = true; throw x; } }; tx.end = async () => {};
  let error; try { await W._pgMirror({}, 'team', 'team-1', { name: 'Test team', ownerEmail: 'owner@example.com', members: [{ email: 'owner@example.com', role: 'owner' }, { email: 'missing@example.com', role: 'member' }] }, tx, 1); } catch (x) { error = x.message; }
  ok(rolledBack && !committed && error === 'member_without_account_row', 'a member with no account row rolls the whole team back', { committed, rolledBack, error });
}

section('Files: kept with every passage, deleted only when everything is gone, same only when the bytes are (R07, R15, R19, R20, R22, R23)');
{
  const e = environment(); delete e.AI;
  e._vectors.set('x', {});
  const r = await W._fileIndexRemove(e, 'audit@example.com', [{ id: 'f1', vec: 1 }]);
  ok(r === true && e._deleteCalls === 1, 'with the meaning model off, passages are still deleted from the index', { r, calls: e._deleteCalls });
  const none = environment(); delete none.VECTORS;
  ok(await W._fileIndexRemove(none, 'audit@example.com', [{ id: 'f1', vec: 1 }]) === false, 'and with no index to delete from, it says not done');
}
{
  const e = environment(); e._enforceIds = true; const t = await seed(e);
  const r = await upload(e, t, file('a'.repeat(1400 * 12), 'twelve-chunks'));
  ok(r.status === 200 && e._idLengths.every(x => x.bytes <= 64) && e._vectors.size === 12, 'a twelve-passage file: every id within 64 bytes, every passage indexed', { status: r.status, max: Math.max(...e._idLengths.map(x => x.bytes)), stored: e._vectors.size });
}
{
  const e = environment(); const t = await seed(e); e._rateKeys.add('lib:audit@example.com');
  const r = await upload(e, t, file('hello', 'kv-rate'));
  const rec = await W._libRec(e, 'audit@example.com');
  ok(r.status === 200 && e._r2.size === 1 && (rec.files || []).length === 1 && !rec.files[0].pending, 'two changes in a moment to the list: kept, and not left pending', { status: r.status, files: rec.files });
}
{
  const e = environment(), t = await seed(e); e._upsertFailure = true;
  const a = await upload(e, t, file('the landlord lease', 'retry-index'));
  e._upsertFailure = false;
  const b = await upload(e, t, file('the landlord lease', 'retry-index'));
  ok(a.status === 200 && b.body.existed === true && e._vectors.size === 1, 'sending the same file again repairs its index', { stored: e._vectors.size, upserts: e._upserts });
  await upload(e, t, file('the landlord lease', 'retry-index'));
  ok(e._upserts === 2 && e._vectors.size === 1, 'and once it is indexed, sending it again indexes nothing twice', e._upserts);
}
{
  const e = environment(), t = await seed(e);
  const a = 'A'.repeat(10000), b = 'AB' + a.slice(2);
  await upload(e, t, file(a, 'sampled-same', 'same.txt'));
  const second = await upload(e, t, file(b, 'sampled-same', 'same.txt'));
  ok(second.body.existed !== true && [...e._r2.values()].includes(b), 'two different files with one sampled signature are two files', second.body.existed);
  const third = await upload(e, t, file(b, 'sampled-same', 'same.txt'));
  ok(third.body.existed === true, 'and the same bytes again are the same file');
}
{
  const e = environment(), t = await seed(e);
  const first = await upload(e, t, file('private body', 'delete-index'));
  e._vectorDeleteFailure = true;
  const r = await W.libDelete(request('/v1/library/delete', { ids: [first.body.file.id] }, t), e);
  const rec = await W._libRec(e, 'audit@example.com');
  const listed = await (await W.libList(new Request('https://api.amv.test/v1/library', { headers: { Authorization: 'Bearer ' + t } }), e)).json();
  ok(r.status !== 200 && rec.files.length === 1 && rec.files[0].deleting, 'passages that would not delete: not reported done, and the entry stays as the record of what is owed', { status: r.status, files: rec.files.length });
  ok((listed.files || []).length === 0, 'while the file stays hidden from the list');
  e._vectorDeleteFailure = false;
  await W._libFinishDeletes(e, 'audit@example.com');
  ok(e._vectors.size === 0 && (await W._libRec(e, 'audit@example.com')).files.length === 0, 'once the index answers, the passages and then the entry go');
}

section('An agent’s kept sign-ins (R06, R14, R21)');
const agentEmail = 'agent@example.com';
const newAgent = () => ({ id: 'agent-local', name: 'Local audit', browser: { keep: true, sites: ['a.example.com', 'b.example.com', 'base.example.com'] } });
const cookie = (domain, value) => ({ name: 'sid', value, domain, path: '/', secure: true, httpOnly: true });
const storeAgent = (e, a) => e._kv.set('agents:' + agentEmail, JSON.stringify({ list: [a] }));
const readAgent = e => JSON.parse(e._kv.get('agents:' + agentEmail)).list[0];
const values = async e => (await W._agentJarLoad(e, agentEmail, readAgent(e))).map(c => c.value);
{
  const e = environment(); let now = 1794170000000; Date.now = () => now; storeAgent(e, newAgent());
  const old = readAgent(e); await W._agentJarLoad(e, agentEmail, old);
  const atPostCheck = gate(), resume = gate(); let genReads = 0, intercept = true;
  e._doFault = async (n, b) => { if (intercept && n === 'agentgen:' + agentEmail + ':agent-local' && b.op === 'tallyFields') { genReads++; if (genReads === 2) { intercept = false; atPostCheck.resolve(); await resume.promise; } } };
  const stale = W._agentJarSave(e, agentEmail, old, [cookie('a.example.com', 'OLD')]);
  await atPostCheck.promise; now += 10;
  await W._agentJarForget(e, agentEmail, 'agent-local', ''); now += 10;
  const freshA = readAgent(e); await W._agentJarLoad(e, agentEmail, freshA);
  await W._agentJarSave(e, agentEmail, freshA, [cookie('b.example.com', 'NEW')]);
  resume.resolve(); await stale;
  const after = await values(e);
  ok(after.includes('NEW') && !after.includes('OLD'), 'a late cleanup takes back only its own stale save: the newer run’s sign-in stays', after);
  fresh();
}
{
  const e = environment(); storeAgent(e, newAgent()); let a = readAgent(e); await W._agentJarLoad(e, agentEmail, a);
  await W._agentJarSave(e, agentEmail, a, [cookie('a.example.com', 'ORIGINAL')]);
  const key = W._agentJarKey(agentEmail, 'agent-local');
  /* Damaged where it is read: the strong copy. */
  await W.counter(e, 'agentjarv:' + agentEmail + ':agent-local', { op: 'revReset', rev: 99, digest: 'dek1.invalid.ciphertext' });
  a = readAgent(e); await W._agentJarLoad(e, agentEmail, a);
  let unknown = false; try { await W._agentSignInsShown(e, agentEmail, a); } catch (x) { unknown = /unknown/.test(x.message); }
  ok(unknown, 'a jar that will not open under the agent’s own key is "could not be checked", not "no sign-ins"');
  const kept = await W._agentJarSave(e, agentEmail, a, [cookie('b.example.com', 'REPLACEMENT')]);
  const g = await W.counter(e, 'agentjarv:' + agentEmail + ':agent-local', { op: 'revGet' });
  ok(kept.length === 0 && g.digest === 'dek1.invalid.ciphertext', 'and it is not silently replaced', kept);
  const f = await W._agentJarForget(e, agentEmail, 'agent-local', '');
  ok(f.held && (await W.counter(e, 'agentjarv:' + agentEmail + ':agent-local', { op: 'revGet' })).absent, 'a deliberate forget still erases it');
}
{
  const e = environment(); storeAgent(e, newAgent()); let a = readAgent(e); await W._agentJarLoad(e, agentEmail, a);
  await W._agentJarSave(e, agentEmail, a, [cookie('base.example.com', 'BASE')]);
  const key = W._agentJarKey(agentEmail, 'agent-local'), base = e._kv.get(key);
  const first = readAgent(e), second = readAgent(e); await W._agentJarLoad(e, agentEmail, first); await W._agentJarLoad(e, agentEmail, second);
  const kept1 = await W._agentJarSave(e, agentEmail, first, [cookie('a.example.com', 'FIRST')]);
  let once = true; e._get = async k => { if (k === key && once) { once = false; return base; } };
  const kept2 = await W._agentJarSave(e, agentEmail, second, [cookie('b.example.com', 'SECOND')]); e._get = null;
  const final = await values(e);
  ok(kept1.includes('a.example.com') && kept2.includes('b.example.com') && ['BASE', 'FIRST', 'SECOND'].every(v => final.includes(v)), 'a stale copy handed to the next save loses nothing anybody was told was kept', final);
}

section('The second sign-in step is on only when the account says so (R18)');
{
  const e = environment(), email = 'audit@example.com', token = await seed(e, email), secret = W._totpNewSecret();
  e._kv.set('totpset:' + email, await W.connSeal(e, { t: 'totpset', s: secret }));
  const code = await W._totpAt(secret, Math.floor(Date.now() / 30000)); const entered = gate(), resume = gate(); let once = true;
  e._put = async (k) => { if (k === 'acct:' + email && once) { once = false; entered.resolve(); await resume.promise; throw new Error('simulated account commit failure'); } };
  const first = W.totpConfirm(request('/auth/totp/confirm', { code }, token), e); await entered.promise;
  const replay = await W.totpConfirm(request('/auth/totp/confirm', { code }, token), e); const body = await replay.json();
  resume.resolve(); const original = await first;
  ok(replay.status !== 200 && !body.ok && !body.recovery, 'a replay while the account is still being written is not told the app is on', { status: replay.status, code: body.code });
  ok(original.status === 503 && !JSON.parse(e._kv.get('acct:' + email)).totp, 'and the failed write leaves the app off');
}

section('What already worked still works');
{
  const e = environment(), key = 'wallet:control@example.com'; e._kv.set(key, JSON.stringify({ balance: 100, lifetime: 100, holds: [] }));
  await W._withWallet(e, 'control@example.com', w => { w.balance += 10; }); await W._withWallet(e, 'control@example.com', w => { w.balance += 20; });
  ok(JSON.parse(e._kv.get(key)).balance === 130, 'two credits in turn: 130');
  let now = 1700000000000; Date.now = () => now;
  const f1 = await W._claimOnceDetail(e, 'control', 'lock', 15); now += 16000;
  const f2 = await W._claimOnceDetail(e, 'control', 'lock', 15);
  await W._releaseClaim(e, 'control', 'lock', f1.owner);
  ok(f1.claimed && f2.claimed && !(await W._claimOnceDetail(e, 'control', 'lock', 15)).claimed, 'a release naming an expired owner frees nothing');
  fresh();
  const s = environment(); s._enforceIds = true; const tk = await seed(s);
  const r = await upload(s, tk, file('A short passage.', 'short-control'));
  ok(r.status === 200 && s._vectors.size === 1, 'a short file is kept and indexed');
}

console.log = quiet;
report();
done();
