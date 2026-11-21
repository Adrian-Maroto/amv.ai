/* BUILD 16 AUDIT - STATE REPRODUCTIONS (Nov 18 audit, imported Nov 20).

   The auditors' own script (AMV16_AUDIT/evidence/state/reproduce.mjs), kept
   as they wrote it except for where it reads and writes: the Worker from the
   repository given, its results to the file given. Run inside the gate by
   tests/worker/the-build-16-audit-stays-fixed.test.mjs - an audit's
   reproduction is a suite, not a folder beside the suites (LESSONS 636).
   A finding "reproduced: true" is the defect still present; a control
   "controlPassed: true" is the behaviour that must keep working.

   node tests/audit/build16-state.mjs <repo root> <results.json> */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root = process.argv[2];
const resultsFile = process.argv[3];
const out = path.join(path.dirname(new URL(import.meta.url).pathname), '.build');
fs.mkdirSync(out, { recursive: true });
const h = path.join(out,'build16-state-harness.' + process.pid + '.mjs');
fs.writeFileSync(h, fs.readFileSync(path.join(root,'amv-backend.js'),'utf8')+'\nexport {DB,counter,_withKind,_withAuto,_withWallet,_wallet,_creditGrant,_creditReverse,_creditState,backupExport,_nightlyBackupSlice,_sha256Hex,_backupCommittedKey,REV_KINDS,issueTokens,spendHold,spendRelease,spendSettle,spendBuys,spendGet,spendSet,_spendMonthKey};\n');
const realFetch = globalThis.fetch;
globalThis.fetch = async ()=> { throw Error('Audit network disabled'); };
const W = await import(pathToFileURL(h));
const log=console.log; console.log=(...x)=>{ if(!String(x[0]).startsWith('AUDIT')) log(...x); };
const results=[];
async function test(id,title,fn) { try { const evidence=await fn(); results.push({id,title,...evidence}); } catch(e) { results.push({id,title,harnessError:e.message,stack:e.stack}); } log(id, JSON.stringify(results.at(-1))); }
const EM='synthetic@example.invalid';
function fixture() {
 const f={live:new Map(),writes:[],objects:new Map(),queues:new Map(),r2:new Map(),counterCalls:[]};
 f.env={JWT_SECRET:'synthetic-audit-secret-never-deployed-123456789',ADMIN_TOKEN:'synthetic-admin-secret-never-deployed-123456789'};
 f.env.AMV_KV={
  async get(k){ if(f.getOverride){const x=await f.getOverride(k); if(x!==undefined)return x;} return f.live.has(k)?f.live.get(k):null; },
  async put(k,v,o){ if(f.beforePut)await f.beforePut(k,v,o); f.writes.push({k,v:String(v),o});f.live.set(k,String(v)); },
  async delete(k){f.live.delete(k);},
  async list({prefix='',cursor,limit}={}){ const a=[...f.live.keys()].filter(k=>k.startsWith(prefix)).sort();return {keys:a.map(name=>({name})),list_complete:true,cursor:''};}
 };
 f.env.AMV_COUNTER={idFromName:n=>n,get:n=>({fetch:async(u,init)=>{
  const p=JSON.parse(init.body);f.counterCalls.push({n,...p});
  const run=async()=>{
   if(f.failCounter && f.failCounter(n,p))throw Error('injected authoritative counter failure');
   if(!f.objects.has(n)){const store=new Map();const state={storage:{async get(k){return structuredClone(store.get(k));},async put(k,v){store.set(k,structuredClone(v));},async delete(k){store.delete(k);},async deleteAll(){store.clear();},async setAlarm(){},async deleteAlarm(){}}};f.objects.set(n,{store,obj:new W.AMVCounter(state,{})});}
   return f.objects.get(n).obj.fetch(new Request('https://counter.invalid',init));
  };
  const prev=f.queues.get(n)||Promise.resolve();const pending=prev.then(run,run);f.queues.set(n,pending.catch(()=>{}));
  const r=await pending;if(f.afterCounter)await f.afterCounter(n,p,r);return r;
 }})};
 f.env.AMV_BACKUPS={async put(k,v,o){if(f.beforeR2)await f.beforeR2(k,v,o);f.r2.set(k,String(v));},async get(k){return f.r2.has(k)?{text:async()=>f.r2.get(k)}:null;},async delete(k){f.r2.delete(k);},async list({prefix='',delimiter}={}){return {objects:[...f.r2.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key})),delimitedPrefixes:[],truncated:false};}};
 return f;
}
function admin(f){return new Request('https://audit.invalid/admin/backup/export',{method:'POST',headers:{Authorization:'Bearer '+f.env.ADMIN_TOKEN,'CF-Connecting-IP':'192.0.2.1'}});}
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

await test('STATE16-01','Expired account mutation rebases its stale whole record over a newer security change',async()=>{
 const f=fixture();await W.DB.put(f.env,'acct',EM,{email:EM,name:'before',security:{totp:false}});
 const oldNow=Date.now;let now=oldNow();Date.now=()=>now;
 try{
  let reads=0;const paused=defer(),resume=defer();
  f.afterCounter=async(n,p)=>{if(n==='rev:acct:'+EM&&p.op==='revGet'&&++reads===2){paused.resolve();await resume.promise;}};
  const a=W._withKind(f.env,'acct',EM,r=>{r.name='writer A';return true;});
  await paused.promise;now+=16000;
  const b=await W._withKind(f.env,'acct',EM,r=>{r.security.totp=true;return true;});
  const afterB=await W.DB.getStrict(f.env,'acct',EM);resume.resolve();
  /* Imported Nov 20: the late writer being REFUSED (record_busy) is the fixed
     behaviour the finding asks for, so a refusal is recorded, not a harness error. */
  let aResult,aRefused=null;try{aResult=await a;}catch(e){aRefused=e.message;}const final=await W.DB.getStrict(f.env,'acct',EM);
  return {reproduced:b===true&&aResult===true&&afterB.security.totp&&!final.security.totp,afterB,final,writerAReportedSuccess:aResult,writerARefused:aRefused,writerBReportedSuccess:b,newerChangeKept:!!(final&&final.security&&final.security.totp),elapsedInjectedMs:16000};
 }finally{Date.now=oldNow;}
});
await test('STATE16-C1','Ordinary sequential account writes survive stale main KV reads',async()=>{
 const f=fixture();const initial=JSON.stringify({email:EM,name:'before',security:{totp:false}});f.live.set('acct:'+EM,initial);
 await W._withKind(f.env,'acct',EM,r=>{r.security.totp=true;return true;});f.getOverride=k=>k==='acct:'+EM?initial:undefined;
 await W._withKind(f.env,'acct',EM,r=>{r.name='after';return true;});const final=await W.DB.getStrict(f.env,'acct',EM);
 return {controlPassed:final.security.totp&&final.name==='after',final};
});
await test('STATE16-02','Nonrevision Crew automation mutations lose an acknowledged scheduled job on a stale KV read',async()=>{
 const f=fixture();const initial=JSON.stringify({items:[{id:'base',active:true,next:1}]});f.live.set('auto:'+EM,initial);
 await W._withAuto(f.env,EM,r=>{r.items.push({id:'job-A',active:true,next:2});return {ok:true};});const first=JSON.parse(f.live.get('auto:'+EM));
 f.getOverride=k=>k==='auto:'+EM?initial:undefined;
 const second=await W._withAuto(f.env,EM,r=>{r.items.push({id:'job-B',active:true,next:3});return {ok:true};});const final=JSON.parse(f.live.get('auto:'+EM));
 return {reproduced:first.items.some(x=>x.id==='job-A')&&!final.items.some(x=>x.id==='job-A')&&second.ok,first,final,second};
});
await test('STATE16-03','Partial then larger refund over-debits credit when the creditpay record is stale',async()=>{
 const f=fixture();const ref='synthetic-pack';await W._creditGrant(f.env,{subject:EM,email:EM,usd:50,ref});
 const initial=f.live.get('creditpay:'+ref);await W._creditReverse(f.env,ref,'refund',10);const afterFirst=await W._creditState(f.env,EM);
 f.getOverride=k=>k==='creditpay:'+ref?initial:undefined;
 const second=await W._creditReverse(f.env,ref,'refund',20);const final=await W._creditState(f.env,EM);
 return {reproduced:afterFirst.bought===40&&final.bought===20,expectedBought:30,afterFirst,final,second,excessDeduction:30-final.bought};
});
await test('STATE16-C2','Refund progression without stale metadata takes only the cumulative difference',async()=>{
 const f=fixture();const ref='control-pack';await W._creditGrant(f.env,{subject:EM,email:EM,usd:50,ref});await W._creditReverse(f.env,ref,'refund',10);await W._creditReverse(f.env,ref,'refund',20);await W._creditReverse(f.env,ref,'refund',20);const final=await W._creditState(f.env,EM);return {controlPassed:final.bought===30,final};
});
await test('STATE16-04','A stale existing checkpoint overwrites a completed backup part in the same generation',async()=>{
 const f=fixture();const day='2026-11-18';let now=Date.parse(day+'T02:00:00Z');const oldNow=Date.now;Date.now=()=>now;
 try{
  f.live.set('acct:'+EM,JSON.stringify({name:'first account'}));f.live.set('ent:'+EM,JSON.stringify({plan:'free',label:'original entitlement'}));
  let firstWrite=true;f.beforeR2=async k=>{if(k.endsWith('.ndjson')&&firstWrite){firstWrite=false;now+=21000;}};
  const first=await W._nightlyBackupSlice(f.env,now);const checkpoint=f.live.get('bkrun:'+day);f.beforeR2=null;now+=10000;
  const completed=await W._nightlyBackupSlice(f.env,now);const manKey='backups/'+day+'/manifest.json';const oldManifest=f.r2.get(manKey);const man=JSON.parse(oldManifest);
  f.getOverride=k=>k==='bkrun:'+day?checkpoint:undefined;f.live.set('ent:'+EM,JSON.stringify({plan:'free',label:'later entitlement'}));f.beforeR2=async k=>{if(k===manKey)throw Error('injected manifest publication failure');};now+=10000;
  let error;try{await W._nightlyBackupSlice(f.env,now);}catch(e){error=e.message;}
  const mismatches=[];for(let i=0;i<man.parts;i++){const k='backups/'+day+'/'+man.gen+'/part-'+String(i).padStart(6,'0')+'.ndjson';if(await W._sha256Hex(f.r2.get(k))!==man.partSha[i])mismatches.push(k);}
  return {reproduced:first.more&&completed.done&&mismatches.length>0,first,completed,checkpoint:JSON.parse(checkpoint),oldManifestUnchanged:f.r2.get(manKey)===oldManifest,mismatches,error};
 }finally{Date.now=oldNow;}
});
await test('STATE16-C3','A missing checkpoint does not restart a completed signed generation',async()=>{
 const f=fixture();const day='2026-11-18',now=Date.parse(day+'T02:00:00Z');f.live.set('acct:'+EM,JSON.stringify({name:'saved'}));const first=await W._nightlyBackupSlice(f.env,now);const old=new Map(f.r2);f.getOverride=k=>k==='bkrun:'+day?null:undefined;f.live.set('acct:'+EM,JSON.stringify({name:'later'}));const second=await W._nightlyBackupSlice(f.env,now+300000);return {controlPassed:first.done&&second.done&&[...old].every(([k,v])=>f.r2.get(k)===v),first,second};
});
await test('STATE16-05','Unreadable committed orphan bytes are silently skipped by complete manual and nightly backups',async()=>{
 const f=fixture();f.beforePut=async k=>{if(k==='data:'+EM)throw Error('injected cache-copy write failure');};const ack=await W.DB.putIfRev(f.env,'data',EM,{_rev:1,text:'acknowledged content'},0);f.beforePut=null;
 f.getOverride=k=>k.startsWith('revblob:data:')?null:undefined;
 /* Imported Nov 20: both exports REFUSING (the stream errors, the night
    throws and publishes no manifest) is the fixed behaviour, so a refusal is
    recorded rather than taken for a harness error. */
 let manual={},manualRefused=null,nightly={},nightlyRefused=null;
 try{manual=await (await W.backupExport(admin(f),f.env)).json();}catch(e){manualRefused=e.message;}
 try{nightly=await W._nightlyBackupSlice(f.env,Date.parse('2026-11-18T02:00:00Z'));}catch(e){nightlyRefused=e.message;}
 const manRaw=f.r2.get('backups/2026-11-18/manifest.json');const man=manRaw?JSON.parse(manRaw):{};
 return {reproduced:!!(ack.ok&&manual.complete&&!(manual.data||{})['data:'+EM]&&nightly.done&&man.keyCount===0),manualRefused,nightlyRefused,manifestPublished:!!manRaw,ack,manualComplete:manual.complete,manualKeyCount:manual.keyCount,manualHasRecord:!!(manual.data||{})['data:'+EM],nightly,manifestKeyCount:man.keyCount,listedSnapshotKeys:[...f.live.keys()].filter(k=>k.startsWith('revblob:'))};
});
await test('STATE16-C4','Readable committed orphan records are included in both backup paths',async()=>{
 const f=fixture();f.beforePut=async k=>{if(k==='data:'+EM)throw Error('cache copy unavailable');};const ack=await W.DB.putIfRev(f.env,'data',EM,{_rev:1,text:'recovered orphan'},0);f.beforePut=null;const manual=await(await W.backupExport(admin(f),f.env)).json();const nightly=await W._nightlyBackupSlice(f.env,Date.parse('2026-11-18T02:00:00Z'));return {controlPassed:ack.ok&&!!manual.data['data:'+EM]&&nightly.done&&[...f.r2.values()].some(v=>v.includes('recovered orphan')),manualKeyCount:manual.keyCount,nightly};
});


async function buySetup(){const f=fixture();await W.DB.put(f.env,'acct',EM,{email:EM,name:'Synthetic'});const token=(await W.issueTokens(f.env,EM,'Synthetic')).token;f.request=(route,body)=>new Request('https://audit.invalid'+route,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});await W.spendSet(f.request('/v1/spend/set',{enabled:true,perPurchase:200,monthlyCap:1000,autoUnder:100,currency:'USD'}),f.env);return f;}
async function hold(f,amount=50,currency='USD'){const r=await W.spendHold(f.request('/v1/spend/hold',{amount,currency,store:'shop.example.invalid',item:'synthetic item',key:'k'+crypto.randomUUID().replace(/-/g,'')}),f.env);const body=await r.json();if(!body.ok)throw Error(JSON.stringify(body));return body.hold;}
async function spendValue(f,key){return (await W.counter(f.env,key||W._spendMonthKey(EM),{op:'get',strict:true})).value;}
await test('STATE16-06','Retrying a released purchase against stale hold state subtracts another purchase reservation',async()=>{
 const f=await buySetup();const a=await hold(f),b=await hold(f);const key='buyhold:'+a.id,stale=f.live.get(key);const before=await spendValue(f);
 const first=await(await W.spendRelease(f.request('/v1/spend/release',{hold:a.id}),f.env)).json();const afterFirst=await spendValue(f);
 f.getOverride=k=>k===key?stale:undefined;const second=await(await W.spendRelease(f.request('/v1/spend/release',{hold:a.id}),f.env)).json();const final=await spendValue(f);
 return {reproduced:before===100&&afterFirst===50&&final===0,before,afterFirst,final,expectedFinal:50,first,second,otherHoldStillHeld:JSON.parse(f.live.get('buyhold:'+b.id)).status==='held'};
});
await test('STATE16-07','A failed hold-record write leaks its monthly reservation with no recoverable hold identifier',async()=>{
 const f=await buySetup();f.beforePut=async k=>{if(k.startsWith('buyhold:'))throw Error('injected hold persistence failure');};let error;try{await hold(f);}catch(e){error=e.message;}
 const total=await spendValue(f);const holds=[...f.live.keys()].filter(k=>k.startsWith('buyhold:'));
 return {reproduced:total===50&&holds.length===0,error,spentAndReserved:total,holdRecords:holds,expectedReservedOnRefusal:0};
});
await test('STATE16-08','An authoritative settlement-counter failure is hidden by a KV fallback and a successful receipt',async()=>{
 const f=await buySetup();const a=await hold(f);f.failCounter=(n,p)=>n.startsWith('spendmo:')&&p.op==='incr';
 const response=await W.spendSettle(f.request('/v1/spend/settle',{hold:a.id,total:70,order:'synthetic-order',verified:true}),f.env);const body=await response.json();f.failCounter=null;const actual=await spendValue(f);
 return {reproduced:response.status===200&&body.ok&&actual===50,expected:70,actual,response:body,fallbackEntries:[...f.live].filter(([k])=>k.startsWith('ctr:spendmo:'))};
});
await test('STATE16-09','Changing limit currency mixes different currencies into the same monthly counter',async()=>{
 const f=await buySetup();await hold(f,50,'USD');await W.spendSet(f.request('/v1/spend/set',{enabled:true,perPurchase:200,monthlyCap:1000,autoUnder:100,currency:'EUR'}),f.env);await hold(f,10,'EUR');
 const summary=await(await W.spendGet(f.request('/v1/spend/get',{}),f.env)).json();
 return {reproduced:summary.limits.currency==='EUR'&&summary.spentThisMonth===60,summary,actualComposition:[{amount:50,currency:'USD'},{amount:10,currency:'EUR'}],conversionPerformed:false};
});
/* Adapted Nov 21 (Build 17 audit B17-003/004/008): the receipt list this
   reproduced is gone - each purchase is its own record, listed through the
   person's index. The defect was a list that did not keep what it said it
   kept; the same question asked of what replaced it: every settled purchase
   is listed, and no shared list is written. */
await test('STATE16-10','Receipt retention limit does not limit the persisted list',async()=>{
 const f=await buySetup();const ids=[];for(let i=0;i<3;i++){const h=await hold(f,5);ids.push(h.id);await W.spendSettle(f.request('/v1/spend/settle',{hold:h.id,total:5,order:'ORD-'+i}),f.env);}
 const r=await(await W.spendBuys(new Request('https://audit.invalid/v1/spend/buys',{headers:f.request('/x',{}).headers}),f.env)).json();
 const listed=(r.buys||[]).map(x=>x.id);
 return {reproduced:!(ids.every(id=>listed.includes(id))&&!f.live.has('buys:'+EM)),listed:listed.length,sharedListWritten:f.live.has('buys:'+EM)};
});
await test('STATE16-C5','A normal single release frees only its own reservation',async()=>{
 const f=await buySetup();const a=await hold(f),b=await hold(f);await W.spendRelease(f.request('/v1/spend/release',{hold:a.id}),f.env);const final=await spendValue(f);return {controlPassed:final===50&&JSON.parse(f.live.get('buyhold:'+b.id)).status==='held',final};
});

console.log=log;globalThis.fetch=realFetch;
const result={source:root,generatedAt:new Date().toISOString(),scope:'Actual Worker code with serialized real AMVCounter and synthetic KV/R2 fault injection; no live cloud/provider calls',findings:results.filter(r=>r.reproduced).length,controlsPassed:results.filter(r=>r.controlPassed).length,results};
fs.writeFileSync(resultsFile,JSON.stringify(result,null,2));
try { fs.unlinkSync(h); } catch (e) {}
log('SUMMARY',JSON.stringify({findings:result.findings,controlsPassed:result.controlsPassed,harnessErrors:results.filter(r=>r.harnessError).length}));
