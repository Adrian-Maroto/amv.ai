// Independent local fault-injection tests. Never contacts a real provider.
// Pass ROOT OUTPUT as arguments. A pass means the desired safe behavior holds.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]), output=process.argv[3];
const dir=path.join(root,'tests/audit/.build');fs.mkdirSync(dir,{recursive:true});
const harness=path.join(dir,'build15-independent-'+process.pid+'.mjs');
fs.writeFileSync(harness,fs.readFileSync(path.join(root,'amv-backend.js'),'utf8')+'\nexport {DB,counter,_withKind,fetchGuarded,fetchDeadline,_webHostAllowed,issueTokens,requireUser,_revocationMustBeSure,apiKeyRevoke,_userFromApiKey,_sha256Hex};\n');
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
await check('B15-01','A rejected competing revision does not destroy a committed recovery blob',async()=>{
 const f=fixture();f.failMain=true;
 const a=await W.DB.putIfRev(f.env,'data',EM,{_rev:1,text:'acknowledged winner'},0);
 const b=await W.DB.putIfRev(f.env,'data',EM,{_rev:1,text:'rejected loser'},0);
 f.failMain=false;let value,error;try{value=await W.DB.get(f.env,'data',EM);}catch(e){error=e.name;}
 return {pass:a.ok&&!b.ok&&value?.text==='acknowledged winner',evidence:{winner:a,loser:b,read:value||null,error}};
});
await check('B15-02','A committed fallback is durable after a main-copy failure without rewriting the staged key',async()=>{
 const f=fixture();f.failMain=true;const put=f.env.AMV_KV.put,seen=new Set();
 f.env.AMV_KV.put=async(k,v,o)=>{if(k.startsWith('revblob:')){if(seen.has(k))throw new Error('same-key write limit');seen.add(k);}return put(k,v,o);};
 const a=await W.DB.putIfRev(f.env,'data',EM,{_rev:1,text:'durable'},0);
 const snapshots=f.writes.filter(x=>x.key.startsWith('revblob:'));
 return {pass:a.ok&&snapshots.length===1&&!snapshots[0].options?.expirationTtl,evidence:{commit:a,snapshotWrites:snapshots}};
});
await check('B15-03','A commit response lost after persistence retains its recoverable bytes',async()=>{
 const f=fixture(),get=f.env.AMV_COUNTER.get;let lost=false;
 f.env.AMV_COUNTER.get=n=>{const stub=get(n);return {fetch:async(u,init)=>{const r=await stub.fetch(u,init);if(JSON.parse(init.body).op==='revCommit'&&!lost){lost=true;throw new Error('response lost AFTER commit');}return r;}};};
 const a=await W.DB.putIfRev(f.env,'data',EM,{_rev:1,text:'committed before lost response'},0);
 let value,error;try{value=await W.DB.get(f.env,'data',EM);}catch(e){error=e.name;}
 return {pass:!a.ok&&value?.text==='committed before lost response',evidence:{response:a,value:value||null,error}};
});
await check('B15-C01','Ordinary revision writes, stale rejection and legacy blob reading still work',async()=>{
 const f=fixture();await W.DB.putIfRev(f.env,'data',EM,{_rev:1,text:'one'},0);
 const a=await W.DB.putIfRev(f.env,'data',EM,{_rev:2,text:'two'},1),b=await W.DB.putIfRev(f.env,'data',EM,{_rev:2,text:'old'},1);
 const text=JSON.stringify({_rev:2,text:'two'});f.live.delete('data:'+EM);for(const k of f.live.keys())if(k.startsWith('revblob:'))f.live.delete(k);f.live.set('revblob:data:'+EM+':2',text);
 const value=await W.DB.get(f.env,'data',EM);return {pass:a.ok&&!b.ok&&value.text==='two',evidence:{legacyRead:value.text}};
});
await check('B15-04','Strict record reads reject stored null, scalar, array and empty JSON',async()=>{
 const values=['null','[]','"account"','true','23',''];const observed=[];
 for(const raw of values){const f=fixture();f.live.set('acct:'+EM,raw);let value,error;try{value=await W.DB.getStrict(f.env,'acct',EM);}catch(e){error=e.name;}observed.push({raw,value,error});}
 return {pass:observed.every(x=>x.error==='UnreadableRecordError'),evidence:observed};
});
await check('B15-C02','Strict absence and valid object remain distinct normal answers',async()=>{
 const f=fixture();const missing=await W.DB.getStrict(f.env,'acct',EM);f.live.set('acct:'+EM,JSON.stringify({email:EM}));const value=await W.DB.getStrict(f.env,'acct',EM);return {pass:missing===null&&value.email===EM};
});
await check('B15-05','Malformed authoritative revision response is not accepted',async()=>{
 const f=fixture();f.live.set('data:'+EM,JSON.stringify({_rev:1,text:'old'}));f.replyOp=(n,p)=>p.op==='revGet'?{}:undefined;
 let value,error;try{value=await W.DB.get(f.env,'data',EM);}catch(e){error=e.name;}
 return {pass:error==='RecordSettlingError',evidence:{value:value||null,error}};
});
await check('B15-06','Strict security counters reject malformed or nonnumeric responses',async()=>{
 const bad=[{}, {error:'oops'},{value:'0'},{value:null},{value:-1}];const answers=[];
 for(const reply of bad){const f=fixture();f.replyOp=(n,p)=>p.op==='get'?reply:undefined;let threw=false;try{await W.counter(f.env,'apikeyrev:synthetic',{op:'get',strict:true});}catch(e){threw=true;}answers.push({reply,threw});}
 return {pass:answers.every(x=>x.threw),evidence:answers};
});
await check('B15-07','External-action routes refuse an unconfirmed session revocation epoch',async()=>{
 const paths=['/v1/connect/act','/v1/connect/undo','/v1/connect/api','/v1/computer/exec','/v1/computer/write','/api/approvals/act','/v1/mail/send','/v1/telegram/send'];
 const f=fixture();f.live.set('acct:'+EM,JSON.stringify({email:EM,name:'Audit'}));const t=await W.issueTokens(f.env,EM,'Audit');f.failOp=(n,p)=>p.op==='authGet';const observed=[];
 for(const url of paths){let admitted=false,code;try{admitted=!!await W.requireUser(new Request('https://audit.invalid'+url,{method:'POST',headers:{Authorization:'Bearer '+t.token}}),f.env);}catch(e){code=e.amvRefusal?.body?.code||e.message;}observed.push({url,admitted,code});}
 return {pass:observed.every(x=>!x.admitted&&x.code==='auth_unconfirmed'),evidence:observed};
});
await check('B15-08','API revocation is not reported complete when its strong write fails',async()=>{
 const f=fixture();f.live.set('acct:'+EM,JSON.stringify({email:EM,name:'Audit'}));const t=await W.issueTokens(f.env,EM,'Audit');
 f.live.set('apikeys:'+EM,JSON.stringify({items:[{id:'synthetic-key',hash:'a'.repeat(64),created:1}]}));f.failOp=(n,p)=>n.startsWith('apikeyrev:')&&p.op==='incr';
 const r=await W.apiKeyRevoke(new Request('https://audit.invalid/v1/keys/revoke',{method:'POST',headers:{Authorization:'Bearer '+t.token,'Content-Type':'application/json'},body:JSON.stringify({id:'synthetic-key'})}),f.env);const body=await r.json();const listed=JSON.parse(f.live.get('apikeys:'+EM)).items[0];return {pass:r.status===503&&body.ok!==true&&!listed.revoked,evidence:{status:r.status,body,listIncorrectlyMarkedRevoked:!!listed.revoked}};
});
await check('B15-09','Generic account mutations do not lose an earlier change on a stale KV read',async()=>{
 const f=fixture();const original=JSON.stringify({email:EM,name:'before',security:{totp:false}});f.live.set('acct:'+EM,original);
 await W._withKind(f.env,'acct',EM,r=>{r.security={totp:true};return true;});const afterFirst=JSON.parse(f.live.get('acct:'+EM));
 const get=f.env.AMV_KV.get;f.env.AMV_KV.get=async k=>k==='acct:'+EM?original:get(k);
 await W._withKind(f.env,'acct',EM,r=>{r.name='after';return true;});const actual=JSON.parse(f.live.get('acct:'+EM));
 return {pass:actual.security.totp&&actual.name==='after',evidence:{afterFirst,actual,scope:'real generic mutation helper and serialized real counter logic; stale KV test double'}};
});
async function redirects(init,status=307){const requests=[];globalThis.fetch=async(url,opts)=>{const u=String(url);if(u.startsWith('https://cloudflare-dns.com/'))return new Response('{"Answer":[]}');requests.push({url:u,method:opts.method||'GET',body:opts.body?String(opts.body):null,headers:Object.fromEntries(new Headers(opts.headers)),aborted:opts.signal?.aborted});return requests.length===1?new Response('',{status,headers:{location:'https://other-public.example.invalid/receive'}}):new Response('ok');};try{const result=await W.fetchGuarded('https://source-public.example.invalid/token',init);return {result,requests};}finally{globalThis.fetch=async()=>{throw new Error('network disabled');};}}
await check('B15-10','Credential-bearing POST bodies do not follow cross-origin redirects',async()=>{
 const o=await redirects({method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'client_secret=SYNTHETIC_NOT_A_REAL_SECRET&refresh_token=SYNTHETIC'},307);
 return {pass:o.result.blocked&&o.requests.length===1,evidence:{blocked:o.result.blocked,requests:o.requests}};
});
await check('B15-11','Custom credential headers do not cross an origin boundary',async()=>{
 const o=await redirects({headers:{'X-API-Key':'SYNTHETIC_ONLY','Proxy-Authorization':'SYNTHETIC_ONLY','X-Custom-Secret':'SYNTHETIC_ONLY',Accept:'text/plain'}},302);const last=o.requests.at(-1);return {pass:o.result.blocked||(!last.headers['x-api-key']&&!last.headers['proxy-authorization']&&!last.headers['x-custom-secret']),evidence:o.requests};
});
await check('B15-12','Public-address gate blocks whole IPv6 link-local range and trailing-dot local names',async()=>{
 const urls=['http://[fe81::1]/','http://[fe90::1]/','http://[febf::1]/','http://[ff02::1]/','http://localhost./','http://a.local./','https://user:password@public.example.invalid/'];const observed=urls.map(url=>({url,...W._webHostAllowed(url)}));return {pass:observed.every(x=>!x.ok),evidence:observed};
});
await check('B15-C03','Public IPv4, IPv6 and DNS hosts remain admissible',async()=>{
 const urls=['https://1.1.1.1/','https://[2606:4700:4700::1111]/','https://www.example.com/'];return {pass:urls.every(x=>W._webHostAllowed(x).ok)};
});
await check('B15-13','Outbound deadline retains a caller cancellation signal',async()=>{
 const controller=new AbortController();controller.abort();let aborted=false;globalThis.fetch=async(u,opts)=>{aborted=opts.signal.aborted;return new Response('synthetic');};try{await W.fetchDeadline('https://offline.invalid/',{signal:controller.signal},15000);}finally{globalThis.fetch=async()=>{throw new Error('network disabled');};}return {pass:aborted,evidence:{callerAborted:true,providerSignalAborted:aborted}};
});
await check('B15-14','Revision commit refuses rollback and guessed future bases',async()=>{
 const attempts=[];for(const bad of [{expect:1,set:1},{expect:1,set:0},{expect:9,set:10}]){const f=fixture();await W.counter(f.env,'audit-rev',{op:'revCommit',expect:0,set:1,digest:'one'});const result=await W.counter(f.env,'audit-rev',{op:'revCommit',...bad,digest:'bad'});attempts.push({bad,result});}return {pass:attempts.every(x=>!x.result.ok),evidence:attempts};
});

await check('B15-20','Generic mutation refuses unreadable existing records rather than replacing them',async()=>{
 const cases=[];for(const raw of ['{broken','null','false','23']){const f=fixture();f.live.set('apikeys:'+EM,raw);let error;try{await W._withKind(f.env,'apikeys',EM,r=>{r.items.push({id:'new'});return true;},{items:[]});}catch(e){error=e.name;}
 cases.push({raw,error,unchanged:f.live.get('apikeys:'+EM)===raw});}
 return {pass:cases.every(x=>x.error==='UnreadableRecordError'&&x.unchanged),evidence:cases};
});
await check('B15-C04','Mutation guards preserve legitimate array records and create truly absent objects',async()=>{
 const f=fixture();f.live.set('teamtasks:team1',JSON.stringify([{id:'a'}]));await W._withKind(f.env,'teamtasks','team1',r=>{r.push({id:'b'});return true;},[]);
 await W._withKind(f.env,'apikeys',EM,r=>{r.items.push({id:'first'});return true;},{items:[]});
 return {pass:JSON.parse(f.live.get('teamtasks:team1')).length===2&&JSON.parse(f.live.get('apikeys:'+EM)).items.length===1};
});
await check('B15-C05','A confirmed API-key revocation really disables a still-cached key',async()=>{
 const f=fixture();f.live.set('acct:'+EM,JSON.stringify({email:EM}));const pair=await W.issueTokens(f.env,EM,'Audit');const raw='amv_sk_'+'b'.repeat(48);const hash=await W._sha256Hex(raw);
 f.live.set('apikeys:'+EM,JSON.stringify({items:[{id:'good-key',hash}]}));const res=await W.apiKeyRevoke(new Request('https://audit.invalid/v1/keys/revoke',{method:'POST',headers:{Authorization:'Bearer '+pair.token,'Content-Type':'application/json'},body:JSON.stringify({id:'good-key'})}),f.env);
 const data=await res.json();f.live.set('apikey:'+hash,JSON.stringify({email:EM,id:'good-key'}));const restoredList=JSON.stringify({items:[{id:'good-key',hash,created:1,lastUsed:Date.now()}]});const savedList=f.live.get('apikeys:'+EM);f.live.set('apikeys:'+EM,restoredList);const cached=await W._userFromApiKey(new Request('https://audit.invalid/v1/messages',{headers:{Authorization:'Bearer '+raw}}),f.env);f.live.set('apikeys:'+EM,savedList);const rev=await W.counter(f.env,'apikeyrev:'+hash,{op:'get',strict:true});const row=JSON.parse(f.live.get('apikeys:'+EM));
 return {pass:res.status===200&&data.revoked===true&&cached===null&&rev.value>=1&&row.items[0].revoked>0,evidence:{status:res.status,data,revocationCounter:rev.value,cachedKeyAdmitted:!!cached}};
});
globalThis.fetch=origFetch;console.log=log;
const summary={generatedAt:new Date().toISOString(),scope:'local independent fault injection against actual Worker source; real counter class with in-memory serialized storage, no cloud/providers',checks:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};fs.writeFileSync(output,JSON.stringify(summary,null,2));log(JSON.stringify({checks:summary.checks,passed:summary.passed,failed:summary.failed}));process.exitCode=summary.failed?1:0;
