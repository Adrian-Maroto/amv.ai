/* THE INPUT THAT ZOOMS THE WHOLE PAGE.

   Safari on iOS zooms the page when you focus a text field whose font-size is
   under 16px, and it does not zoom back out afterwards. It is the single most
   common way a mobile web app feels broken to somebody on a phone, and it is
   invisible everywhere else - no desktop browser does it, and neither does a
   device emulator that is not actually iOS. So it cannot be found by looking;
   it has to be measured.

   Every field in the product already cleared 16px except the sidebar history
   search, at 12.5px. This keeps it that way. */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { ok, section, report, done } from '../lib/assert.mjs';
const HTML=readFileSync('index.html');
const server=createServer((_q,s)=>{s.writeHead(200,{'Content-Type':'text/html'});s.end(HTML);});
/* PORT 0 ASKS THE KERNEL FOR A FREE ONE.
   A fixed port is a suite that fails when anything else already holds it -
   another run, a leftover process, or simply the same gate started twice.
   That is not a product failure but it reads exactly like one, and a gate
   that goes red for reasons of its own is a gate people stop believing. */
await new Promise(r=>server.listen(0,r));
const BASE = 'http://127.0.0.1:' + server.address().port + '/';
const LAUNCH=process.env.PLAYWRIGHT_BROWSERS_PATH?{executablePath:process.env.PLAYWRIGHT_BROWSERS_PATH+'/chromium'}:{};
const browser=await chromium.launch(LAUNCH);
const page=await browser.newPage({viewport:{width:390,height:844}});
await page.goto(BASE,{waitUntil:'load'});
await page.waitForTimeout(900);
const r=await page.evaluate(async()=>{
  S.user={name:'T',email:'t@amv.dev',ini:'T'}; document.getElementById('ck')?.remove();
  const bad=new Set();
  for(const t of ['chat','crew','market','dashboard']){
    setTab(t); await new Promise(r=>setTimeout(r,280));
    for(const el of document.querySelectorAll('input,textarea,select')){
      const rect=el.getBoundingClientRect(); if(rect.width<2) continue;
      const fs=parseFloat(getComputedStyle(el).fontSize);
      if(fs < 16) bad.add(`${el.tagName.toLowerCase()}${el.id?'#'+el.id:''}${el.className?'.'+String(el.className).split(' ')[0]:''} = ${fs}px`);
    }
  }
  // and the auth form, which is the one that matters most
  openAuth('signup'); await new Promise(r=>setTimeout(r,320));
  for(const el of document.querySelectorAll('#ovr input,#ovr textarea,#ovr select')){
    const fs=parseFloat(getComputedStyle(el).fontSize);
    if(fs<16) bad.add(`AUTH ${el.tagName.toLowerCase()}#${el.id} = ${fs}px`);
  }
  return [...bad];
});
section('No field makes iOS zoom the page');
ok(r.length === 0,
   'every text field on a phone is at least 16px, so focusing it does not zoom',
   r.slice(0, 8));
await browser.close(); server.close();

if (report('no-field-zooms-the-page') > 0) process.exitCode = 1;
done();
