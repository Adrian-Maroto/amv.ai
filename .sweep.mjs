import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';
import { LAUNCH, armGeom } from './tests/lib/harness.mjs';
const PUB='/home/user/amv.ai/public';
const T={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webmanifest':'application/manifest+json'};
const srv=createServer((q,r)=>{const p=(q.url||'/').split('?')[0];const f=join(PUB,p==='/'?'index.html':p.replace(/^\/+/,''));
 if(f.startsWith(PUB)&&existsSync(f)&&statSync(f).isFile()){r.writeHead(200,{'Content-Type':T[extname(f)]||'application/octet-stream'});return r.end(readFileSync(f));}
 r.writeHead(200,{'Content-Type':'text/html'});r.end(readFileSync(join(PUB,'index.html')));});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));
const URL_='http://127.0.0.1:'+srv.address().port+'/';
const TABS=['chat','build','crew','handoff','billing','plans','settings','help','apps','tasks','integrations','extensions','market','memory','usage','workspaces','prompts','dashboard'];
const b=await chromium.launch(LAUNCH);

for(const W of [1280, 390]){
  const page=await b.newPage({viewport:{width:W,height:W===390?844:900}});
  const errs=[];
  page.on('pageerror',e=>errs.push(String(e.message).slice(0,110)));
  page.on('console',m=>{ if(m.type()==='error') errs.push('console: '+String(m.text()).slice(0,110)); });
  await armGeom(page); await page.goto(URL_,{waitUntil:'load'}); await page.waitForTimeout(800);
  await page.evaluate(()=>{localStorage.setItem('amv_cookie_consent',JSON.stringify({essential:true}));
    S.user={name:'T',email:'t@amv.dev',ini:'T'};goApp();saveStr('amv_plan','pro');
    document.getElementById('ck')?.remove();document.querySelector('.cc-banner')?.remove();});
  console.log('\n===== viewport '+W+'px =====');
  for(const tab of TABS){
    errs.length=0;
    const r=await page.evaluate(async(t)=>{
      try{ setTab(t); }catch(e){ return {fatal:String(e.message).slice(0,90)}; }
      await new Promise(x=>setTimeout(x,1100));
      const vc=document.getElementById('vc');
      const de=document.documentElement;
      const txt=(vc.innerText||'').trim();
      // controls that look interactive but have nothing behind them
      const dead=[...vc.querySelectorAll('button')].filter(btn=>{
        if(btn.disabled) return false;
        if(btn.dataset.dact||btn.dataset.pay||btn.dataset.tab||btn.dataset.go||btn.id) return false;
        if(btn.closest('form')) return false;
        return !btn.onclick;
      }).map(btn=>(btn.textContent||'').trim().slice(0,28)).filter(Boolean);
      // anything wider than the viewport
      const wide=[...vc.querySelectorAll('*')].filter(e=>{
        const q=e.getBoundingClientRect();
        return q.width>de.clientWidth+2 && q.height>0;
      }).slice(0,3).map(e=>((e.className||e.tagName)+'').toString().slice(0,32));
      return { empty: txt.length<20, chars:txt.length,
               hScroll: de.scrollWidth>de.clientWidth+2,
               scrollW: de.scrollWidth, clientW: de.clientWidth,
               dead: [...new Set(dead)].slice(0,4), wide };
    },tab);
    const flags=[];
    if(r.fatal) flags.push('FATAL '+r.fatal);
    if(r.empty) flags.push('EMPTY ('+r.chars+' chars)');
    if(r.hScroll) flags.push('H-SCROLL '+r.scrollW+'>'+r.clientW+(r.wide.length?' ['+r.wide.join(', ')+']':''));
    if(r.dead&&r.dead.length) flags.push('DEAD BUTTONS: '+r.dead.join(' | '));
    if(errs.length) flags.push('ERRORS: '+[...new Set(errs)].slice(0,2).join(' ;; '));
    if(flags.length) console.log('  '+tab.padEnd(13)+flags.join('  //  '));
  }
  await page.close();
}
await b.close();srv.close();
