/* Current public route contract. Legacy commerce tests use a separate test-only router. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {ok,section,report,done} from '../lib/assert.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=join(here,'../..');
mkdirSync(join(here,'.build'),{recursive:true});
const file=join(here,'.build','market-retired.harness.mjs');
writeFileSync(file,readFileSync(join(root,'amv-backend.js'),'utf8'));
const W=await import(file+'?t='+Date.now());
const rows=JSON.parse(readFileSync(join(root,'tests/audit/contract-changes.json'),'utf8')).retiredRoutes;
const writes=[];const map=new Map();let external=0;
const old=globalThis.fetch;globalThis.fetch=async()=>{external++;throw new Error('No external services in this test');};
const env={JWT_SECRET:'synthetic-test-only-secret-not-for-production-1111',APP_URL:'https://amv.test',ALLOWED_ORIGIN:'https://amv.test',AMV_KV:{get:async k=>map.get(k)||null,put:async(k,v)=>{writes.push(k);map.set(k,v);},delete:async k=>map.delete(k),list:async()=>({keys:[],list_complete:true})}};
section('Removed Marketplace actions stay retired at the real public router');
for(const path of rows){
 const req=new Request('https://api.amv.test'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://amv.test','CF-Connecting-IP':'192.0.2.20'},body:'{}'});
 const res=await W.default.fetch(req,env,{waitUntil(){}});const data=await res.json();
 ok(res.status===410&&data.code==='marketplace_retired',path+' returns 410, not a working commerce action',{status:res.status,data});
}
ok(external===0,'retired actions make no external provider calls',external);
ok(writes.every(k=>!/^market:|^txn:|^wallet:|^payout:/.test(k)),'retired actions create no commerce records',writes);
section('Legacy financial access is still authenticated');
for(const path of ['/v1/market/purchases','/v1/market/earnings','/v1/market/withdraw']){
 const res=await W.default.fetch(new Request('https://api.amv.test'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://amv.test'},body:'{}'}),env,{waitUntil(){}});
 ok(res.status===401,path+' does not reveal legacy account data anonymously',res.status);
}
globalThis.fetch=old;report();done();
