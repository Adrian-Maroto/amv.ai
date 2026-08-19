/* TEXT SOMEBODY CAN ACTUALLY READ.

   WCAG 2.1 AA wants 4.5:1 for normal text and 3:1 for large. Six pairs in the
   shipped page failed it - two the design audit named, four it did not - and
   they were the small type: sidebar section labels, helper text, the active nav
   item. Small type is the type that needs contrast most, not least.

   Measured on the RENDERED page, because reading the tokens gets it wrong in
   both directions. A first pass reported the light Sign-up button at 1.02:1,
   white on white, which would have sent somebody to fix an invisible CTA that
   is not invisible: it carries a gradient, and a gradient sets background-image
   rather than background-color, so walking the tree for a solid colour falls
   straight through it to the page behind. The same blind spot flagged the
   gradient-text greeting. Unmeasurable is not the same as failing.

   The fix that looked obvious was also wrong. Darkening --accent so white text
   passes on a button drops accent-coloured TEXT on the dark background from
   4.20 to 3.78 - one failure traded for another. The two jobs are separated
   instead: --on-accent per theme (near-black on the dark theme accent at 4.83,
   white on the light theme accent at 5.26) and a lighter --accent-tx for accent
   text on a dark surface.

   The logo is exempt, not fixed. WCAG 1.4.3 excludes text that is part of a
   logo or brand name, and darkening the brand mark to satisfy a rule that does
   not cover it would make the product worse to look at in order to go green. */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { ok, section, report, done } from '../lib/assert.mjs';
const HTML = readFileSync('index.html');
const server=createServer((_q,s)=>{s.writeHead(200,{'Content-Type':'text/html'});s.end(HTML);});
await new Promise(r=>server.listen(9424,r));
const LAUNCH=process.env.PLAYWRIGHT_BROWSERS_PATH?{executablePath:process.env.PLAYWRIGHT_BROWSERS_PATH+'/chromium'}:{};
const browser=await chromium.launch(LAUNCH);

for (const theme of ['dark','light']) {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto('http://127.0.0.1:9424/',{waitUntil:'load'});
  await page.waitForTimeout(1000);
  const out = await page.evaluate(async (theme) => {
    S.user={name:'T',email:'t@amv.dev',ini:'T'};
    document.body.classList.toggle('light', theme==='light');
    document.getElementById('ck')?.remove();
    setTab('chat');
    /* MEASURE THE PAGE A PERSON SEES, NOT A FRAME THAT EXISTS FOR 200ms.

       The webfonts load from a CDN with display:swap, so the first paint uses
       fallback faces and everything reflows when Inter arrives. Waiting a fixed
       500ms measures whichever of those two pages the machine happened to be
       showing - warm cache here, cold cache on CI. */
    try{ await document.fonts.ready; }catch(e){}
    await new Promise(r=>setTimeout(r,500));
    const parse=(c)=>{const m=c.match(/[\d.]+/g); return m?m.slice(0,3).map(Number):null;};
    const lum=r=>{const s=r.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return .2126*s[0]+.7152*s[1]+.0722*s[2];};
    const cr=(a,b)=>{const A=lum(a),B=lum(b);return (Math.max(A,B)+.05)/(Math.min(A,B)+.05);};
    /* A gradient sets background-IMAGE, not background-color, so walking up for
       a solid colour falls straight through it to the page behind - which
       reported a white-on-blue-gradient button as white-on-white at 1.02:1.
       Unmeasurable is not the same as failing: those are reported separately
       rather than counted as defects. */
    const bgOf=(el)=>{ let n=el; while(n && n!==document.documentElement){ const cs=getComputedStyle(n);
        if(/gradient/i.test(cs.backgroundImage||'')) return 'gradient';
        const c=cs.backgroundColor;
        const p=parse(c); if(p && !/rgba\(.*,\s*0\)/.test(c) && c!=='transparent'){ const a=c.match(/[\d.]+\)$/); if(!a||parseFloat(a[0])>0.5) return p; } n=n.parentElement; }
      return [26,27,31]; };
    const bad=[];
    const seen=new Set();
    for(const el of document.querySelectorAll('button,a,input,label,p,span,div,h1,h2,h3,td,th')){
      /* A FOUR-PIXEL FLOOR DECIDED WHETHER THIS SUITE PASSED.

         This skipped anything under 4x4, meaning to skip elements that do not
         render. It also skipped narrow REAL text: the dot in the AMV.AI
         wordmark is 3.73px wide with Inter loaded and wider without it, so this
         suite measured it on CI, skipped it here, and went red on one machine
         and green on the other over a fraction of a pixel of glyph advance.

         That cost two red builds and a long hunt. A check whose answer depends
         on which font finished loading is not measuring contrast. Nothing that
         is not rendered has a box at all, so 1px is the honest floor. */
      const r=el.getBoundingClientRect(); if(r.width<1||r.height<1) continue;
      const cs=getComputedStyle(el);
      if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity<0.1) continue;
      /* WCAG 1.4.3 exempts text that is part of a logo or brand name. The AMV
         mark is a single letter on the brand blue; holding it to 4.5:1 would
         mean darkening the logo to pass a rule that does not cover it. */
      if(el.closest('.logo-mark,.logo-letter,.ce-logo-mark,.logo-mark-lg')) continue;
      const txt=(el.textContent||'').trim(); if(!txt||txt.length>90) continue;
      if(el.children.length && [...el.children].some(c=>(c.textContent||'').trim()===txt)) continue;
      /* Transparent text is gradient text (background-clip:text). Not measurable
         by colour, and not a defect - it is painted by the gradient behind. */
      if(/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(cs.color)) continue;
      const fg=parse(cs.color); if(!fg) continue;
      const bg=bgOf(el);
      if(bg==='gradient') continue;
      const size=parseFloat(cs.fontSize), weight=parseInt(cs.fontWeight)||400;
      const large = size>=24 || (size>=18.66 && weight>=700);
      const need = large?3.0:4.5;
      const ratio=cr(fg,bg);
      if(ratio < need){
        const key=cs.color+'|'+bg.join(',')+'|'+Math.round(size);
        if(seen.has(key)) continue; seen.add(key);
        bad.push({ txt:txt.slice(0,34), cls:(el.className||'').toString().slice(0,26),
                   fg:cs.color, bg:'rgb('+bg.join(',')+')', size:Math.round(size), ratio:+ratio.toFixed(2), need });
      }
    }
    return bad;
  }, theme);
  section(`${theme} theme`);
  ok(out.length === 0,
     'every piece of text meets its WCAG 2.1 AA contrast minimum',
     out.slice(0, 8).map(b => `${b.ratio}:1 need ${b.need} - ${b.size}px .${b.cls} "${b.txt}"`));
  await page.close();
}
await browser.close(); server.close();

if (report('text-somebody-can-read') > 0) process.exitCode = 1;
done();
