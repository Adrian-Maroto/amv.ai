// Independent local fault-injection tests. Never contacts a real provider.
// Pass ROOT OUTPUT as arguments. A pass means the desired safe behavior holds.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]), output=process.argv[3];
const dir=path.join(root,'tests/audit/.build');fs.mkdirSync(dir,{recursive:true});
const harness=path.join(dir,'build15-independent-'+process.pid+'.mjs');
fs.writeFileSync(harness,fs.readFileSync(path.join(root,'amv-backend.js'),'utf8')+'\nexport {DB,counter,_withKind,fetchGuarded,fetchDeadline,_webHostAllowed,issueTokens,requireUser,_revocationMustBeSure,apiKeyRevoke,_userFromApiKey,_sha256Hex,backupExport,runNightlyBackup,_nightlyBackupSlice};\n');
const W=await import(pathToFileURL(harness));
const origFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('External network is disabled by the audit harness');};
const log=console.log; console.log=(...args)=>{if(!String(args[0]).startsWith('AUDIT'))log(...args);};
const results=[];
async function check(id,title,fn){try{const o=await fn();results.push({id,title,pass:!!o.pass,...o});}catch(e){results.push({id,title,pass:false,error:e.message,stack:e.stack?.split('\n').slice(0,4)});}log(id,results.at(-1).pass?'PASS':'FAIL',title);}
function fixture(){
 const live=new Map(),writes=[],objects=new Map(),queues=new Map();
 const f={live,writes,objects,failMain:false,frozen:null,failOp:null,replyOp:null};
 const kv={async get(k){const m=f.frozen||live;return m.has(k)?m.get(k):null;},async put(k,v,o){if(f.failMain&&k.startsWith('data:'))throw new Error('injected main copy write failure');writes.push({key:k,options:o});live.set(k,String(v));},async delete(k){live.delete(k);},async list({prefix='',cursor}={}){return {keys:[...live.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true,cursor:''};}};
 const ns={idFromName:n=>n,get:n=>({fetch:(_u,init)=>{const p=JSON.parse(init.body);const run=async()=>{
 if(f.failOp?.(n,p))throw new Error('injected authority unavailable');
 const reply=f.replyOp?.(n,p);if(reply!==undefined)return new Response(JSON.stringify(reply),{status:200});
 if(!objects.has(n)){const m=new Map();const state={storage:{async get(k){return structuredClone(m.get(k));},async put(k,v){m.set(k,structuredClone(v));},async delete(k){m.delete(k);},async deleteAll(){m.clear();},async setAlarm(){},async deleteAlarm(){}}};objects.set(n,{obj:new W.AMVCounter(state,{}),store:m});}
 return objects.get(n).obj.fetch(new Request('https://do/counter',init));};const prev=queues.get(n)||Promise.resolve(),out=prev.then(run,run);queues.set(n,out.catch(()=>{}));return out;}})};
 f.env={AMV_KV:kv,AMV_COUNTER:ns,JWT_SECRET:'audit-synthetic-secret-never-a-real-credential-123456789'};return f;
}
const EM='audit@example.invalid';

function bucket(f){const m=new Map();f.env.AMV_BACKUPS={async put(k,v){m.set(k,String(v));},async get(k){return m.has(k)?{text:async()=>m.get(k)}:null;},async delete(k){m.delete(k);},async list({prefix='',delimiter}={}){return {objects:[...m.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key})),delimitedPrefixes:[],truncated:false};}};return m;}
function admin(f){f.env.ADMIN_TOKEN='synthetic-admin-secret-audit-only-not-real-123456';return new Request('https://audit.invalid/admin/backup/export',{method:'POST',headers:{Authorization:'Bearer '+f.env.ADMIN_TOKEN,'CF-Connecting-IP':'192.0.2.10'}});}
await check('B15-15','Backup export reads the committed revision, not a stale main KV copy',async()=>{
 const f=fixture();await W.DB.putIfRev(f.env,'data',EM,{_rev:1,text:'old'},0);f.failMain=true;const ack=await W.DB.putIfRev(f.env,'data',EM,{_rev:2,text:'acknowledged new'},1);f.failMain=false;
 const r=await W.backupExport(admin(f),f.env);const back=await r.json();const saved=JSON.parse(back.data?.['data:'+EM]||'null');const read=await W.DB.get(f.env,'data',EM);
 return {pass:ack.ok&&saved?.text===read.text,evidence:{ack,verifiedRead:read,exported:saved,complete:back.complete}};
});
await check('B15-15b','Nightly backup reads the committed revision, not a stale main KV copy',async()=>{
 const f=fixture(),b=bucket(f);await W.DB.putIfRev(f.env,'data',EM,{_rev:1,text:'old'},0);f.failMain=true;const ack=await W.DB.putIfRev(f.env,'data',EM,{_rev:2,text:'acknowledged new'},1);f.failMain=false;
 const outcome=await W._nightlyBackupSlice(f.env,Date.parse('2026-11-15T02:00:00Z'));const entries=[...b].filter(([k])=>k.endsWith('.ndjson')).flatMap(([,v])=>v.trim().split('\n').map(x=>JSON.parse(x)));const record=entries.find(x=>x.k==='data:'+EM);const saved=JSON.parse(record?.v||'null');
 return {pass:ack.ok&&saved?.text==='acknowledged new',evidence:{outcome,saved}};
});
await check('B15-16','Nightly backup progresses under the actual same-key KV write rate',async()=>{
 const f=fixture(),b=bucket(f);f.live.set('acct:'+EM,JSON.stringify({email:EM}));const put=f.env.AMV_KV.put,last=new Map();let blocked=0,error,outcome;
 f.env.AMV_KV.put=async(k,v,o)=>{if(k.startsWith('bkrun:')){const now=Date.now();if(last.has(k)&&now-last.get(k)<1000){blocked++;throw new Error('KV 429 same-key write');}last.set(k,now);}return put(k,v,o);};
 try{outcome=await W._nightlyBackupSlice(f.env,Date.parse('2026-11-15T02:00:00Z'));}catch(e){error=e.message;}
 return {pass:!!outcome?.done&&!blocked,evidence:{outcome,error,rateLimitedCheckpointWrites:blocked,objects:[...b.keys()]}};
});
await check('B15-17','Manual backup honors backpressure before consuming an entire store',async()=>{
 const f=fixture();for(let i=0;i<500;i++)f.live.set('acct:u'+i,JSON.stringify({name:'a'.repeat(4096)}));let reads=0;const get=f.env.AMV_KV.get;f.env.AMV_KV.get=async k=>{if(k.startsWith('acct:'))reads++;return get(k);};
 const r=await W.backupExport(admin(f),f.env);await new Promise(resolve=>setTimeout(resolve,200));const before=reads;await r.body.cancel();
 return {pass:before<500,evidence:{totalRecords:500,recordsReadWithoutConsumer:before,bodyConsumed:false,scope:'eager read count, not an out-of-memory experiment'}};
});

await check('B15-18','A backup discovers a committed record whose main copy was never written',async()=>{
 const f=fixture();f.failMain=true;const ack=await W.DB.putIfRev(f.env,'data',EM,{_rev:1,text:'only in committed snapshot'},0);f.failMain=false;
 const r=await W.backupExport(admin(f),f.env),d=await r.json();const b=bucket(f);const n=await W._nightlyBackupSlice(f.env,Date.parse('2026-11-15T02:00:00Z'));
 const manualHas=!!d.data?.['data:'+EM],nightlyHas=[...b.values()].some(x=>x.includes('only in committed snapshot'));
 return {pass:ack.ok&&manualHas&&nightlyHas,evidence:{ack,mainCopyExists:f.live.has('data:'+EM),manualComplete:d.complete,manualKeyCount:d.keyCount,manualHas,nightly:n,nightlyHas}};
});
await check('B15-19','A stale checkpoint retry cannot corrupt an already complete nightly backup',async()=>{
 const f=fixture(),b=bucket(f),day='2026-11-15';f.live.set('acct:'+EM,JSON.stringify({name:'saved original'}));const first=await W._nightlyBackupSlice(f.env,Date.parse(day+'T02:00:00Z'));const manKey='backups/'+day+'/manifest.json',partKey='backups/'+day+'/part-000000.ndjson';
 const manifest=JSON.parse(b.get(manKey));const get=f.env.AMV_KV.get;f.env.AMV_KV.get=async k=>k==='bkrun:'+day?null:get(k);f.live.set('acct:'+EM,JSON.stringify({name:'later state'}));const put=f.env.AMV_BACKUPS.put;f.env.AMV_BACKUPS.put=async(k,v,o)=>{if(k===manKey)throw new Error('injected manifest outage');return put(k,v,o);};let error;
 try{await W._nightlyBackupSlice(f.env,Date.parse(day+'T02:05:00Z'));}catch(e){error=e.message;}
 const stillMatches=(await W._sha256Hex(b.get(partKey)))===manifest.partSha[0];return {pass:first.done&&stillMatches,evidence:{originalComplete:first.done,oldManifestUnchanged:JSON.stringify(JSON.parse(b.get(manKey)))===JSON.stringify(manifest),partStillMatchesCompletedManifest:stillMatches,error}};
});
globalThis.fetch=origFetch;console.log=log;
const summary={generatedAt:new Date().toISOString(),scope:'local independent fault injection against actual Worker source; real counter class with in-memory serialized storage, no cloud/providers',checks:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};fs.writeFileSync(output,JSON.stringify(summary,null,2));log(JSON.stringify({checks:summary.checks,passed:summary.passed,failed:summary.failed}));process.exitCode=summary.failed?1:0;
