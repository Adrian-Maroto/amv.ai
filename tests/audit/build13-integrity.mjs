// Independent, offline regression checks. Executes actual source functions in VM contexts.
// No real accounts, credentials, purchases, DNS or provider traffic.
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';
const root=path.resolve(process.argv[2]||'.'), out=process.argv[3];
const results=[];
function context(file,names,extra={}){
 const c=vm.createContext({console,URL,Response,Request,Date,Math,JSON,Number,Set,Map,Uint8Array,window:{},...extra});
 vm.runInContext(fs.readFileSync(path.join(root,file),'utf8')+'\n;globalThis.__test={'+names.join(',')+'};',c,{timeout:2000});
 return {c,...c.__test};
}
async function test(id,name,fn){try{const r=await fn();results.push({id,name,pass:!!r.pass,evidence:r.evidence});}catch(e){results.push({id,name,pass:false,error:String(e.message)});}}
let store={};
function spendClient(api){return context('src/app/23-spend.js',['AMVSpend'],{load:()=>store,store:(k,v)=>{store=v;},AMV_API:api});}
const L={autoUnder:10,perPurchase:50,monthlyCap:100,enabled:true};
await test('N01','Authenticated session restoration remains server-backed',async()=>{
 const {AMVSpend}=spendClient({live:true,hasSession:true,base:'https://offline.invalid',token:''});
 const actual=AMVSpend.serverBacked();return {pass:actual===true,evidence:{serverBacked:actual}};
});
await test('N02','Malformed account totals cannot overwrite local verified state',async()=>{
 store={...L,spent:23,month:'2026-11'};
 const {AMVSpend}=spendClient({live:true,hasSession:true,base:'https://offline.invalid',token:'synthetic',spendLimits:async()=>({limits:L})});
 let rejected=false;try{await AMVSpend.pull();}catch(e){rejected=true;}
 return {pass:rejected&&store.spent===23,evidence:{rejected,storedTotal:store.spent}};
});
function worker(extra={}){return context('src/worker/18-web-agent.js',['spendGet','_spendReserve','_spendRelease','_webIsMoney','_webIsConsequential', ...(fs.readFileSync(path.join(root,'src/worker/18-web-agent.js'),'utf8').includes('function _webNeedsHumanCommit')?['_webNeedsHumanCommit']:[])],{
 requireUser:async()=>({email:'synthetic@example.invalid'}),DB:{get:async()=>L},monthKey:()=> '2026-11',
 counter:async()=>({value:0}),json:(data,status=200)=>({data,status}),...extra});}
await test('N03','An unavailable spending authority returns unavailable, not zero',async()=>{
 const {spendGet}=worker({counter:async()=>({unavailable:true})});const r=await spendGet({},{});
 return {pass:r.status===503&&!('spentThisMonth' in r.data),evidence:r};
});
await test('N04','Malformed numeric counter responses do not become valid totals',async()=>{
 const cases=[{}, {value:'13'}, {value:NaN}, {value:Infinity},{value:-1}];let refused=0;
 for(const c of cases){const w=worker({counter:async()=>c});if((await w.spendGet({},{})).status===503)refused++;}
 return {pass:refused===cases.length,evidence:{refused,total:cases.length}};
});
await test('C01','Verified zero and positive totals still work',async()=>{
 let accepted=0;for(const value of [0,15.75]){const r=await worker({counter:async()=>({value})}).spendGet({},{});if(r.status===200&&r.data.spentThisMonth===value)accepted++;}
 return {pass:accepted===2,evidence:{accepted}};
});
await test('N05','Month rollover releases the original reservation bucket',async()=>{
 let month='2026-11';const released=[];
 const w=worker({monthKey:()=>month,_reserveUSD:async()=>({allowed:true}),_releaseUSD:async(_env,key,amount)=>released.push({key,amount})});
 const booked=await w._spendReserve({},'synthetic@example.invalid',10,50);month='2026-12';
 await w._spendRelease({},'synthetic@example.invalid',10,booked.ledgerKey);
 return {pass:released.length===1&&released[0].key==='spendmo:synthetic@example.invalid:2026-11',evidence:{booked,released}};
});
await test('N06','A release cannot name another account or invent its month',async()=>{
 const released=[];const w=worker({_releaseUSD:async(...x)=>released.push(x)});let rejects=0;
 for(const key of [undefined,'spendmo:someone@example.invalid:2026-11','spendmo:synthetic@example.invalid:2026-99']){
 try{await w._spendRelease({},'synthetic@example.invalid',10,key);}catch(e){rejects++;}}
 return {pass:rejects===3&&!released.length,evidence:{rejects,releaseCalls:released.length}};
});
await test('N07','Generic browser write boundary is independent of action language',async()=>{
 const w=worker();const labels=['Buy now','Comprar','Payer','\u8cfc\u5165','\u4ed8\u6b3e','OK','Continue'];
 const oldMisses=labels.filter(l=>!w._webIsMoney('click',l,''));
 const verbs=['click','type','select','press','submit'];
 const protectedAll=typeof w._webNeedsHumanCommit==='function'&&verbs.every(v=>w._webNeedsHumanCommit(v));
 const src=fs.readFileSync(path.join(root,'src/worker/25-linked-accounts.js'),'utf8');
 return {pass:protectedAll&&src.indexOf('if(_webNeedsHumanCommit(decision')<src.indexOf('const v = _webValidateAction(decision')&&src.includes("code:'human_commit_required'"),evidence:{labelHeuristicMisses:oldMisses,protectedAll,boundary:'Human completion for all generic browser writes; native account APIs are separate'}};
});
await test('C02','Read-only browser operations are not blocked by the write boundary',async()=>{
 const w=worker();return {pass:typeof w._webNeedsHumanCommit==='function'&&['goto','scroll','extract','done'].every(v=>!w._webNeedsHumanCommit(v)),evidence:{operations:['goto','scroll','extract','done']}};
});
const registry=context('src/worker/37-connector-directory.js',['_mcpRegMap']);
function pkg(extra){return {server:{name:'io.example/offline-test',title:'Offline test',version:'1.2.3',packages:[{registryType:'npm',identifier:'@example/offline-test',version:'1.2.3',transport:{type:'stdio'},...extra}]}};}
await test('N08','Registry prototype names cannot produce malformed connector entries',async()=>{
 let value;try{value=registry._mcpRegMap(pkg({registryType:'constructor'}));}catch(e){return {pass:false,evidence:{threw:e.message}};}
 return {pass:value===null,evidence:{result:value}};
});
await test('N09','Registry package coordinates cannot contain runtime switches or URLs',async()=>{
 const bad=[{identifier:'--yes'},{identifier:'https://example.invalid/pkg.tgz'}, {version:'latest'}, {identifier:'safe;echo injected'}];
 const accepted=bad.filter(p=>registry._mcpRegMap(pkg(p)));return {pass:!accepted.length,evidence:{rejected:bad.length-accepted.length,total:bad.length}};
});
await test('N10','Unreviewed runtime arguments and process-control environment are refused',async()=>{
 const bad=[{registryType:'oci',identifier:'example/image@sha256:'+'a'.repeat(64),runtimeArguments:[{type:'positional',value:'--host=tcp://example.invalid'}]}, {environmentVariables:[{name:'NODE_OPTIONS',isRequired:true}]}, {environmentVariables:[{name:'PATH'}]}];
 const accepted=bad.filter(p=>registry._mcpRegMap(pkg(p)));return {pass:!accepted.length,evidence:{rejected:bad.length-accepted.length,total:bad.length}};
});
await test('C03','Pinned normal package metadata still maps with an unreviewed warning',async()=>{
 const r=registry._mcpRegMap(pkg({environmentVariables:[{name:'SERVICE_API_KEY',isRequired:true,isSecret:true}]}));
 return {pass:!!r&&r.command==='npx'&&r.args[1]==='@example/offline-test@1.2.3'&&r.reviewStatus==='unreviewed',evidence:r};
});
await test('N11','Server scheduling forwards time zone and exact schedule',async()=>{
 const src=fs.readFileSync(path.join(root,'src/app/14-engine.js'),'utf8');const a=src.indexOf('async function _scheduleTask(t){'),b=src.indexOf('\n}',a)+2;
 let payload;const c=vm.createContext({refuseSecrets:()=>true,_AUTO_EMAIL_READY:false,_AUTOS:[],_AUTO_CAN_SCHEDULE:false,_autoApi:async(_p,p)=>{payload=p;return {item:{id:'synthetic-job'}}},toast:()=>{},_myTimeZone:()=> 'Europe/Madrid',_cwCountryGuess:()=> 'ES',window:{}});
 vm.runInContext(src.slice(a,b)+';globalThis.run=_scheduleTask;',c);
 try{await c.run({detail:'Synthetic read-only research',repeat:'daily',notify:'app',sched:{cad:'daily',hour:9,minute:30},tz:'Asia/Tokyo'});}catch(e){}
 return {pass:payload?.sched?.hour===9&&payload?.tz==='Asia/Tokyo',evidence:{sched:payload?.sched,tz:payload?.tz}};
});
await test('N12','Browser action execution errors are not silently swallowed',async()=>{
 const src=fs.readFileSync(path.join(root,'src/worker/25-linked-accounts.js'),'utf8');
 const swallowed=/page\.(?:click|type|select)\([^\n]*\.catch\(\(\) => \{\}\)/g;const found=src.match(swallowed)||[];
 return {pass:found.length===0,evidence:{remainingSwallowedActionErrors:found.length}};
});

function functionVM(file,start,end,extra={}){
 const src=fs.readFileSync(path.join(root,file),'utf8');const a=src.indexOf(start),b=src.indexOf(end,a);
 if(a<0||b<0)throw new Error('Function boundary missing');
 const c=vm.createContext({console,window:{},...extra});vm.runInContext(src.slice(a,b),c,{timeout:2000});return c;
}
await test('N13','The shared agent runner preserves an explicit tool failure',async()=>{
 let result;
 const c=functionVM('src/app/11c-agentic-chat.js','async function runAgentic(', 'try{ window.runAgentic',{
 _toolsFor:()=>[{name:'synthetic'}],_sectionModel:()=> 'synthetic',neverRunRefusal:()=>null,_toolNeedsConsent:()=>false,
 _amvRunTool:async()=>({ok:false,text:'Synthetic failure'}),
 aiAgentLoop:async(o)=>{result=await o.runTool('synthetic',{});return {text:'',rounds:1,steps:[{ok:result.ok}],why:'done'};}
 });
 const out=await c.runAgentic('crew','Synthetic request');
 return {pass:result?.ok===false&&out.steps?.[0]?.ok===false,evidence:{toolResult:result,returnedSteps:out.steps}};
});
await test('N14','Crew custom tasks use tools rather than a text-only completion claim',async()=>{
 let textCalls=0,agentCalls=0;
 const c=functionVM('src/app/14-engine.js','async function crewRun(', 'window.crewRun=',{
 _CREW_RESULTS:[],_crewRender:()=>{},$:()=>null,aiComplete:async()=>{textCalls++;return 'Done';},
 runAgentic:async()=>{agentCalls++;return {text:'Unavailable',steps:[{name:'synthetic',ok:false}],why:'done'};}
 });
 const out=await c.crewRun('custom','Synthetic',{detail:'Synthetic action, no external services'});
 return {pass:agentCalls===1&&textCalls===0&&out.status==='failed',evidence:{agentCalls,textCalls,status:out.status}};
});
await test('N15','Malformed mailbox data is not reported as an empty inbox',async()=>{
 const c=functionVM('src/app/14-engine.js','async function crewRun(', 'window.crewRun=',{
 _CREW_RESULTS:[],_crewRender:()=>{},$:()=>null,_connActRun:async()=>({error:'upstream failure'})
 });const out=await c.crewRun('gmail','Synthetic');
 return {pass:out.status==='failed'&&!out.body.includes('Inbox clear'),evidence:{status:out.status,body:out.body}};
});
await test('C04','A verified empty mailbox remains a successful empty result',async()=>{
 const c=functionVM('src/app/14-engine.js','async function crewRun(', 'window.crewRun=',{
 _CREW_RESULTS:[],_crewRender:()=>{},$:()=>null,_connActRun:async()=>[]
 });const out=await c.crewRun('gmail','Synthetic');
 return {pass:out.status==='done'&&out.body.includes('Inbox clear'),evidence:{status:out.status}};
});
await test('N16','Connector and command failures retain machine-readable failure status',async()=>{
 const src=fs.readFileSync(path.join(root,'src/app/11c-agentic-chat.js'),'utf8');
 const c=vm.createContext({console,window:{},isMcpTool:n=>n==='mcp__test',mcpToolIdentity:()=>null,runMcpTool:async()=>({ok:false,text:'denied'}),runBridgeTool:async()=>({exitCode:2,timedOut:false,ms:1,stdout:'',stderr:'failed'}),escH:s=>s,T:s=>s});
 vm.runInContext(src.slice(src.indexOf('async function _amvRunTool(')),c,{timeout:2000});
 const mcp=await c._amvRunTool('mcp__test',{},null),command=await c._amvRunTool('run_command',{command:'synthetic'},null);
 return {pass:mcp.ok===false&&command.ok===false,evidence:{mcpOk:mcp.ok,commandOk:command.ok}};
});

function directory(fetcher){
 return context('src/worker/38-connector-logos.js',['connectorDirectory'],{
  _rlIp:()=> 'synthetic',guardAction:async()=>null,_mcpRegText:(x,n)=>String(x||'').slice(0,n).trim(),
  MCPREG_MAX:50,MCPREG_PAGES:6,MCPREG_BASE:'https://offline.invalid/v0.1/servers',MCPREG_TIMEOUT:8000,MCPREG_TTL:21600,
  _mcpRegMap:x=>x.accepted===false?null:x,fetchDeadline:fetcher,json:(d,status=200)=>new Response(JSON.stringify(d),{status})
 });
}
await test('N17','Connector pagination does not skip accepted entries or discard a scan cursor',async()=>{
 const all=Array.from({length:12},(_,i)=>({id:'synthetic-'+i}));const sizes=[];
 const w=directory(async url=>{const u=new URL(url),start=Number(u.searchParams.get('cursor')||0),n=Number(u.searchParams.get('limit'));sizes.push(n);return new Response(JSON.stringify({servers:all.slice(start,start+n),metadata:{nextCursor:start+n<all.length?String(start+n):''}}));});
 const env={AMV_KV:{get:async()=>null,put:async()=>{}}};let cursor='',seen=[];
 for(let i=0;i<5;i++){const d=await(await w.connectorDirectory(new Request('https://offline.invalid/v1/connectors?limit=3'+(cursor?'&cursor='+cursor:'')),env)).json();seen.push(...d.servers.map(x=>x.id));cursor=d.cursor;if(!cursor)break;}
 let calls=0;const filtered=directory(async()=>new Response(JSON.stringify({servers:[{accepted:false}],metadata:{nextCursor:'scan-'+(++calls)}})));
 const scanned=await(await filtered.connectorDirectory(new Request('https://offline.invalid/v1/connectors?limit=3'),env)).json();
 return {pass:seen.length===12&&new Set(seen).size===12&&scanned.cursor==='scan-6',evidence:{seen,requestedPageSizes:sizes,boundedScanCursor:scanned.cursor}};
});
await test('N18','A short registry search is a client validation error, not a false outage',async()=>{
 let calls=0;const w=directory(async()=>{calls++;throw new Error('unneeded');});
 const r=await w.connectorDirectory(new Request('https://offline.invalid/v1/connectors?q=xy'),{AMV_KV:{get:async()=>null,put:async()=>{}}});const d=await r.json();
 return {pass:r.status===400&&d.code==='search_too_short'&&calls===0,evidence:{status:r.status,code:d.code,upstreamCalls:calls}};
});
await test('N19','Deprecated or deleted registry entries are not offered as connectable',async()=>{
 const accepted=[];for(const status of ['deleted','deprecated']){const r=pkg({});r._meta={'io.modelcontextprotocol.registry/official':{status}};if(registry._mcpRegMap(r))accepted.push(status);}
 return {pass:!accepted.length,evidence:{incorrectlyAcceptedStatuses:accepted}};
});


await test('N20','Bank-link refresh cannot turn missing or malformed authority into not linked',async()=>{
 let base='',reply={},calls=0;const cache={amv_fin_ready:'1',amv_fin_linked:'1'};
 const f=context('src/app/22-finance.js',['AMVFinance'],{loadStr:k=>cache[k]||'',saveStr:(k,v)=>{cache[k]=v;},apiBase:()=>base,fetchDeadline:async()=>{calls++;return new Response(JSON.stringify(reply));}}).AMVFinance;
 const absent=await f.refresh();base='https://offline.invalid';const bad=[];
 for(reply of [{},{ok:true,ready:'yes',linked:0},{ok:false,ready:false,linked:false}])bad.push(await f.refresh());
 const preserved=cache.amv_fin_linked==='1';reply={ok:true,ready:true,linked:false};const valid=await f.refresh();
 return {pass:absent.ok===false&&bad.every(x=>x.ok===false&&x.stale)&&preserved&&valid.ok===true&&!valid.linked,evidence:{absent,bad,preserved,valid,calls}};
});

const data={root,method:'actual source in isolated VM with synthetic dependencies; no live providers',passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
if(out)fs.writeFileSync(out,JSON.stringify(data,null,2));
console.log(JSON.stringify(data,null,2));process.exitCode=data.failed?1:0;
