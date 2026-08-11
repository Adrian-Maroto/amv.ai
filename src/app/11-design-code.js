/* ============================================================
   AMV DESIGN  - visual canvas: generate & iterate UI / graphics
   ============================================================ */
function renderDesignView(){
  const vc=$('vc'); if(!vc) return;
  const starts=[
    ['\uD83D\uDDA5\uFE0F','Landing page','A hero, features and a call-to-action'],
    ['\uD83D\uDCF1','App screen','A clean mobile or web UI mockup'],
    ['\uD83C\uDFA8','Poster / graphic','Social post, banner or flyer'],
    ['\uD83E\uDDE9','Component','A single button, card or form']
  ];
  vc.innerHTML = `<div class="sv fi"><div class="dsn-wrap">
    <section class="dsn-hero">
      <div class="dsn-eyebrow">AMV Design</div>
      <h1 class="dsn-h1">Describe it.<br><span class="dsn-grad">Watch it build.</span></h1>
      <p class="dsn-lead">Landing pages, UI mockups, posters and graphics - created on a live canvas and refined just by chatting. &ldquo;Make it darker.&rdquo; &ldquo;Add a pricing section.&rdquo; Export when it&rsquo;s right.</p>
      <div class="dsn-input-wrap">
        <textarea id="dsn-prompt" rows="1" placeholder="A sleek dark pricing page for an AI startup, three tiers, purple accents&hellip;"></textarea>
        <button class="dsn-go" data-dact="designGo" aria-label="Generate design">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>
      </div>
      <div class="dsn-hint">Press generate, or pick a starting point below</div>
      <div style="margin-top:22px;display:flex;align-items:center;justify-content:flex-start;gap:10px;flex-wrap:wrap">
        <button class="dna-btn" data-dact="openDNA"><span class="dna-dot"></span>Design DNA</button>
        <span class="dna-active-chip">${_DNA.colors.length} colors · ${escH(_DNA.themeFamily)} · ${escH(_DNA.theme)}</span>
      </div>
      <p class="dsn-dna-explain">Design DNA is your reusable style guide - set your colors, fonts, shapes and vibe once, and everything AMV designs follows it. Optional: skip it and AMV picks tasteful defaults.</p>
      <div style="margin-top:12px;display:flex;height:22px;width:min(420px,80%);border-radius:7px;overflow:hidden;border:1px solid var(--hair)">${_DNA.colors.map(c2=>`<span style="flex:1;background:${c2.hex}"></span>`).join('')}</div>
    </section>

    <section class="dsn-starts">
      ${starts.map(([ic,t,d],n)=>`<button class="dsn-tile${n===0?' feat':''}" data-dact="designStart" data-darg="${escH(t)}">
        <span class="dsn-tile-ic">${ic}</span>
        <span class="dsn-tile-body"><span class="dsn-tile-t">${t}</span><span class="dsn-tile-d">${escH(d)}</span></span>
      </button>`).join('')}
    </section>

    <section class="dsn-callout">
      <div class="dsn-callout-text">
        <h3>It&rsquo;s a conversation, not a form</h3>
        <p>Every design stays editable. Keep chatting and AMV reshapes the canvas live - tweak copy, swap layouts, change the whole vibe in a sentence.</p>
      </div>
      <div class="dsn-callout-orb"></div>
    </section>
    ${_ownedMarketHTML('studio')}
  </div></div>`;
  // auto-grow the hero textarea
  const ta=$('dsn-prompt');
  if(ta){ on(ta,'input',()=>{ ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,220)+'px'; }); }
}

function designGo(){ const t=$('dsn-prompt'); const v=t?t.value.trim():''; if(!v){ toast('Describe what to design first','error'); return; } _studioCreate(v); }
function designStart(kind){ _studioCreate('A '+String(kind).toLowerCase()); }

/* ===== STUDIO - standalone multi-artifact design canvas (never touches chat) =====
   A Studio PROJECT holds many designs (pages, screens, slides). Each artifact
   has its own version history you can revert. Export one or the whole project
   to a real folder (File System Access) or as downloads. Real design-tool
   parity + AMV's Design DNA on top. */
const _STUDIO = { html:'', prompt:'', history:[],
  artifacts:[],        // [{id,name,type,html,history:[{brief,html,ts}]}]
  activeId:'' };
function _studioActive(){ return _STUDIO.artifacts.find(a=>a.id===_STUDIO.activeId)||null; }
function _studioNewArtifact(name, type, brief){
  const id='art_'+Date.now().toString(36)+Math.random().toString(36).slice(2,4);
  const a={ id, name:name||('Design '+(_STUDIO.artifacts.length+1)), type:type||'page', html:'', brief:brief||'', history:[] };
  _STUDIO.artifacts.push(a); _STUDIO.activeId=id;
  // Land in Recents IMMEDIATELY. This used to wait for the AI to return HTML,
  // so if generation errored - or you navigated away mid-design - the Studio
  // session was never saved and never appeared in Recents.
  try{ _sessTouch('studio'); }catch(e){}
  return a;
}
function _studioSetHTML(html, brief){
  const a=_studioActive(); if(!a) return;
  a.html=html; if(brief) a.brief=brief;
  try{ _sessTouch('studio'); }catch(e){}
  a.history.push({brief:brief||'', html, ts:Date.now()});
  if(a.history.length>30) a.history=a.history.slice(-30);
  _STUDIO.html=html; // keep legacy field in sync
}
async function _studioCreate(brief){
  _STUDIO.prompt=brief;
  // detect the kind of deliverable
  const type=/\b(slide|deck|presentation|pitch)\b/i.test(brief)?'slides':/\b(component|button|card|form|widget)\b/i.test(brief)?'component':/\b(poster|graphic|banner|flyer|social)\b/i.test(brief)?'graphic':'page';
  const name=brief.slice(0,40)+(brief.length>40?'…':'');
  _studioNewArtifact(name, type, brief);
  _studioShowCanvas(brief);
  const typeGuide = type==='slides'
    ? 'Build a self-contained HTML slide deck: each slide is a full-viewport section (100vh) with keyboard arrow navigation between slides, a subtle slide counter, and a cohesive template applied across all slides. 6-10 slides with real, convincing content.'
    : type==='component' ? 'Build a polished, self-contained component demo - the component centered on a tasteful backdrop, with real states (hover/active) and a couple of variants shown.'
    : type==='graphic' ? 'Build a single high-impact graphic/poster as a self-contained HTML page sized like a social/print asset, with striking type and composition.'
    : 'Build a complete, multi-section responsive web page - every section finished with real convincing copy, no placeholders.';
  const sys='You are AMV Design - the most talented design AI ever built. Your output must look like a $50k agency deliverable that wins design awards: a distinctive concept (never a template), confident typography with real hierarchy, a cohesive intentional palette, generous deliberate whitespace, editorial layout, tasteful micro-interactions, pixel-perfect alignment. '+typeGuide+' Output a COMPLETE self-contained HTML document (inline <style>, no external assets except Google Fonts) - fully responsive, production-quality. The DESIGN DNA below is the sole source of truth for style. Return ONLY the HTML in a single ```html code block.';
  try{
    _studioStatus('Designing…');
    const resp=await aiComplete(dnaPromptBlock()+'\n\nDesign this, obeying the DESIGN DNA exactly. Make it breathtaking - award-tier, finished:\n'+brief, sys, {max_tokens:16000, model:_sectionModel('design')});
    const html=extractCode(resp,'html')||extractCode(resp)||resp;
    _studioSetHTML(html, brief);
    _studioRenderPreview(html); _studioRenderArtifacts();
    _studioStatus('');
  }catch(err){ _studioStatus(_aiFriendly(err&&err.message)); }
}
async function _studioRefine(){
  const inp=$('studio-refine'); const msg=inp?inp.value.trim():''; if(!msg) return;
  const a=_studioActive(); if(!a){ toast('Create a design first','error'); return; }
  if(inp) inp.value='';
  _studioStatus('Refining…');
  const sys='You are AMV Design, an expert design AI. Apply the user\u2019s change request to the existing HTML exactly and completely - do what they asked, even if it changes the style. Keep everything they did NOT ask to change intact. Maintain high visual quality and the DESIGN DNA where it doesn\u2019t conflict with their request. Return the COMPLETE updated HTML in one ```html block only, nothing else.';
  try{
    const resp=await aiComplete(dnaPromptBlock()+'\n\nCurrent design HTML:\n```html\n'+a.html+'\n```\n\nChange request: '+msg+'\n\nReturn the full updated HTML, staying true to the DESIGN DNA.', sys, {max_tokens:16000, model:_sectionModel('design')});
    const html=extractCode(resp,'html')||extractCode(resp)||resp;
    _studioSetHTML(html, msg);
    _studioRenderPreview(html); _studioRenderArtifacts(); _studioStatus('');
  }catch(err){ _studioStatus(_aiFriendly(err&&err.message)); }
}
function _studioShowCanvas(brief){
  const vc=$('vc'); if(!vc) return;
  vc.innerHTML = `<div class="studio-canvas">
    <div class="studio-side">
      <button class="btn" id="studio-back">← Studio home</button>
      <div class="studio-arts-h">Designs in this project</div>
      <div class="studio-arts" id="studio-arts"></div>
      <button class="btn bs studio-add" id="studio-add">+ Add a design</button>
      <div class="studio-refine-wrap">
        <textarea id="studio-refine" placeholder="Refine it… e.g. 'make it darker', 'add a pricing section'" rows="3"></textarea>
        <button class="btn bp" id="studio-refine-go">Apply change</button>
      </div>
      <div class="studio-actions">
        <button class="btn" id="studio-history">History</button>
        <button class="btn" id="studio-code">View code</button>
      </div>
      <div class="studio-actions">
        <button class="btn" id="studio-download">Download this</button>
        <button class="btn" id="studio-export">Export project</button>
      </div>
      <div id="studio-status" class="studio-status"></div>
    </div>
    <div class="studio-stage">
      <div class="studio-frame-bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="studio-frame-t" id="studio-frame-t">Live preview</span>
        <div class="studio-vp" id="studio-vp"><button class="studio-vp-b on" data-vp="desktop" title="Desktop">🖥️</button><button class="studio-vp-b" data-vp="tablet" title="Tablet">📱</button><button class="studio-vp-b" data-vp="phone" title="Phone">📲</button></div>
      </div>
      <div class="studio-stage-inner" id="studio-stage-inner"><iframe id="studio-frame" class="studio-frame" sandbox="allow-scripts"></iframe></div>
    </div>
  </div>`;
  on($('studio-back'),'click',()=>setTab('studio'));
  on($('studio-refine-go'),'click',_studioRefine);
  on($('studio-add'),'click',_studioAddPrompt);
  on($('studio-history'),'click',_studioHistory);
  on($('studio-code'),'click',()=>{ const a=_studioActive(); if(!a) return; const w=window.open('','_blank'); if(w){ w.document.write('<pre style="white-space:pre-wrap;font:13px monospace;padding:20px">'+(a.html.replace(/</g,'&lt;'))+'</pre>'); } });
  on($('studio-download'),'click',()=>{ const a=_studioActive(); if(!a) return; _studioDownload(a); });
  on($('studio-export'),'click',_studioExportProject);
  // viewport toggles
  document.querySelectorAll('#studio-vp .studio-vp-b').forEach(b=>on(b,'click',()=>{
    document.querySelectorAll('#studio-vp .studio-vp-b').forEach(x=>x.classList.remove('on')); b.classList.add('on');
    const f=$('studio-frame'); if(!f) return; const vp=b.dataset.vp;
    f.style.width = vp==='phone'?'390px':vp==='tablet'?'768px':'100%';
    f.style.margin = vp==='desktop'?'0':'0 auto';
  }));
  _studioRenderArtifacts();
}
function _studioDownload(a){ const blob=new Blob([a.html],{type:'text/html'}); const el=document.createElement('a'); el.href=URL.createObjectURL(blob); el.download=(a.name||'design').replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'.html'; document.body.appendChild(el); el.click(); document.body.removeChild(el); URL.revokeObjectURL(el.href); }
// artifacts strip - switch between designs in the project
function _studioRenderArtifacts(){
  const el=$('studio-arts'); if(!el) return;
  const typeIc={page:'🖥️',slides:'🎞️',component:'🧩',graphic:'🎨'};
  el.innerHTML=_STUDIO.artifacts.map(a=>'<div class="studio-art'+(a.id===_STUDIO.activeId?' on':'')+'" data-art="'+a.id+'"><span class="studio-art-ic">'+(typeIc[a.type]||'🖥️')+'</span><span class="studio-art-n">'+escH(a.name||'Design')+'</span></div>').join('');
  el.querySelectorAll('[data-art]').forEach(x=>on(x,'click',()=>{ _STUDIO.activeId=x.dataset.art; const a=_studioActive(); if(a){ _studioRenderPreview(a.html); const t=$('studio-frame-t'); if(t)t.textContent=a.name; } _studioRenderArtifacts(); }));
}
function _studioAddPrompt(){
  const r=$('ovr'); if(!r) return;
  r.innerHTML='<div class="ov" id="sa-bg"><div class="ob" onclick="event.stopPropagation()" style="max-width:440px"><button class="oc" onclick="closeOvr()">×</button>'+
    '<h2 style="margin-bottom:6px">Add a design</h2><p class="ob-sub" style="margin-bottom:12px">Describe another page, screen, slide deck, or graphic. It joins this project so your whole set stays consistent.</p>'+
    '<textarea id="sa-brief" rows="3" placeholder="e.g. \'an about page matching this style\' or \'a pitch deck of 6 slides\'" style="width:100%;font-size:13px"></textarea>'+
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn bs" onclick="closeOvr()">Cancel</button><button class="btn bp" id="sa-go">Design it</button></div></div></div>';
  on($('sa-bg'),'click',closeOvr);
  const go=()=>{ const v=$('sa-brief')?.value.trim(); if(!v){ toast('Describe the design','error'); return; } closeOvr(); _studioCreate(v); };
  on($('sa-go'),'click',go);
  setTimeout(()=>$('sa-brief')?.focus(),50);
}
// version history with revert
function _studioHistory(){
  const a=_studioActive(); if(!a||!a.history.length){ toast('No history yet','info'); return; }
  const r=$('ovr'); if(!r) return;
  const rows=a.history.slice().reverse().map((h,i)=>{ const realIdx=a.history.length-1-i; return '<div class="studio-hrow"><div class="studio-hrow-b"><div class="studio-hrow-t">'+(i===0?'Current':('Version '+(realIdx+1)))+'</div><div class="studio-hrow-d">'+escH(h.brief||'(initial)')+' · '+_timeAgo(h.ts||Date.now())+'</div></div>'+(i===0?'':'<button class="btn bs" data-revert="'+realIdx+'">Revert</button>')+'</div>'; }).join('');
  r.innerHTML='<div class="ov" id="sh-bg"><div class="ob" onclick="event.stopPropagation()" style="max-width:460px"><button class="oc" onclick="closeOvr()">×</button><h2 style="margin-bottom:12px">Version history</h2><div class="studio-hlist">'+rows+'</div></div></div>';
  on($('sh-bg'),'click',closeOvr);
  r.querySelectorAll('[data-revert]').forEach(b=>on(b,'click',()=>{ const idx=+b.dataset.revert; const h=a.history[idx]; if(h){ a.html=h.html; a.history.push({brief:'reverted to v'+(idx+1),html:h.html,ts:Date.now()}); _STUDIO.html=h.html; _studioRenderPreview(h.html); closeOvr(); toast('Reverted','success'); } }));
}
// export the whole project - folder write-back or downloads
async function _studioExportProject(){
  if(!_STUDIO.artifacts.length){ toast('Nothing to export yet','info'); return; }
  const nameFor=a=>(a.name||'design').replace(/[^a-z0-9]+/gi,'-').toLowerCase().replace(/^-|-$/g,'')||'design';
  if(AMVWorkspace.supported() && window.isSecureContext){
    try{
      await AMVWorkspace.connectFolder();
      let n=0; const seen={};
      for(const a of _STUDIO.artifacts){ let fn=nameFor(a); if(seen[fn]) fn=fn+'-'+(++seen[fn]); else seen[fn]=1; await AMVWorkspace.writeFile(fn+'.html', a.html); n++; }
      toast('Exported '+n+' designs to your folder','success',4000); return;
    }catch(e){ if(e.message==='cancelled') return; /* fall through to downloads */ }
  }
  let n=0; const seen={};
  for(const a of _STUDIO.artifacts){ let fn=nameFor(a); if(seen[fn]) fn=fn+'-'+(++seen[fn]); else seen[fn]=1; _studioDownload({name:fn,html:a.html}); n++; }
  toast('Downloading '+n+' designs','info');
}
window._studioExportProject=_studioExportProject;
function _studioRenderPreview(html){ const f=$('studio-frame'); if(f) f.srcdoc=html; }
function _studioStatus(t){ const s=$('studio-status'); if(s) s.textContent=t||''; }

window.designStart=designStart;window.designGo=designGo;

/* ============================================================
   DESIGN DNA - universal design-system engine
   Every visual decision (color, type, shape, motion, layout,
   psychology, effects) is configurable and drives generation.
   ============================================================ */
const DNA_DEFAULT = {
  // identity
  projectName:'', projectType:'Landing page', industry:'Technology', audience:'',
  // theme
  theme:'dark', themeFamily:'linear',
  // colors - array of {role,hex}
  colors:[
    {role:'primary',hex:'#5590ff'},
    {role:'accent',hex:'#5590ff'},
    {role:'background',hex:'#0c0d10'},
    {role:'surface',hex:'#15181d'},
    {role:'text',hex:'#e9edf2'},
    {role:'muted',hex:'#8b939e'},
  ],
  saturation:60, contrast:75, temperature:'cool',
  // personality 0-100
  personality:{ professionalism:70, luxury:40, minimalism:75, creativity:55, playfulness:25, futurism:60, trust:80, authority:65, friendliness:55, exclusivity:45, sophistication:70, boldness:55, elegance:65, energy:50 },
  // psychology 0-100
  psychology:{ trust:80, authority:65, excitement:50, exclusivity:45, warmth:50, safety:70, urgency:30, confidence:75 },
  // typography
  headingFont:'Newsreader', bodyFont:'Inter', codeFont:'JetBrains Mono',
  headingWeight:'600', fontScale:'balanced', letterSpacing:'normal', lineHeight:'comfortable',
  // layout
  structure:'landing_page', maxWidth:'1200px', whitespace:'generous', density:'balanced',
  // shapes
  borderRadius:'medium', cornerStyle:'rounded', geometricness:60,
  // borders / shadows
  borderWidth:'hairline', shadowStyle:'soft', shadowDepth:50,
  // effects
  glassmorphism:false, brutalism:false, glow:30, noise:0, grain:false,
  // backgrounds
  bgStyle:'solid',
  // buttons / cards / forms
  buttonStyle:'solid', buttonRadius:'medium', cardStyle:'soft', cardElevation:'low', formStyle:'outlined',
  // icons / images
  iconStyle:'line', imageStyle:'photographic', imageRealism:80,
  // motion
  motionLevel:'subtle', motionStyle:'smooth', easing:'ease-out',
  // navigation / hero / sections
  navigation:'topbar', hero:'centered', sections:'cards',
  // content
  tone:'professional', readingLevel:'general', emojiUsage:'minimal',
  copy:{ persuasive:60, educational:55, entertaining:30, emotional:40 },
  // ai generation
  creativity:60, originality:70, predictability:45, experimentation:50,
  // constraints
  strictColors:true, strictTypography:false, strictSpacing:false, allowExperiments:true,
};
let _DNA = _loadDNA();
function _loadDNA(){ try{ const d=load('amv_dna'); if(d&&d.colors) return Object.assign(JSON.parse(JSON.stringify(DNA_DEFAULT)), d); }catch(e){} return JSON.parse(JSON.stringify(DNA_DEFAULT)); }
function _saveDNA(){ try{ store('amv_dna', _DNA); }catch(e){} }
function resetDNA(){ _DNA=JSON.parse(JSON.stringify(DNA_DEFAULT)); _saveDNA(); if($('dna-content')) _dnaRenderSection(_DNA._sec||'colors'); toast('Design DNA reset to defaults','info'); }

/* ---- Color parsing: paste ANY palette format ---- */
function parseColorsFromText(text){
  if(!text) return [];
  const out=[]; const seen=new Set();
  const add=h=>{ h=h.toLowerCase(); if(!seen.has(h)){ seen.add(h); out.push(h); } };
  // hex: require leading # for 3-digit; allow bare only for 6/8-digit hex tokens
  const hexHashRe=/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  const hexBareRe=/(?<![\w#])([0-9a-fA-F]{6})(?![\w])/g;
  // rgb / rgba
  const rgbRe=/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+[\d.%]+)?\s*\)/gi;
  // hsl / hsla
  const hslRe=/hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:[,\s/]+[\d.%]+)?\s*\)/gi;
  let m;
  while((m=rgbRe.exec(text))){ add(_rgbToHex(+m[1],+m[2],+m[3])); }
  while((m=hslRe.exec(text))){ add(_hslToHex(+m[1],+m[2],+m[3])); }
  // strip rgb()/hsl() so their digits aren't re-parsed as hex
  const cleaned=text.replace(rgbRe,' ').replace(hslRe,' ');
  while((m=hexHashRe.exec(cleaned))){ let h=m[1]; if(h.length===3) h=h.split('').map(c=>c+c).join(''); if(h.length===8) h=h.slice(0,6); add('#'+h.toLowerCase()); }
  // bare 6-digit hex only if it contains at least one letter (avoids pure-number keys/dates)
  while((m=hexBareRe.exec(cleaned))){ const h=m[1]; if(/[a-fA-F]/.test(h)) add('#'+h.toLowerCase()); }
  return out;
}
function _rgbToHex(r,g,b){ const c=n=>Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,'0'); return '#'+c(r)+c(g)+c(b); }
function _hslToHex(h,s,l){ s/=100; l/=100; const k=n=>(n+h/30)%12; const a=s*Math.min(l,1-l); const f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1))); return _rgbToHex(255*f(0),255*f(8),255*f(4)); }
function _hexLum(hex){ const h=hex.replace('#',''); const r=parseInt(h.slice(0,2),16)/255,g=parseInt(h.slice(2,4),16)/255,b=parseInt(h.slice(4,6),16)/255; const a=[r,g,b].map(v=>v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)); return .2126*a[0]+.7152*a[1]+.0722*a[2]; }

/* ---- Auto-assign pasted colors to roles intelligently ---- */
function applyPalette(hexes){
  if(!hexes||!hexes.length) return;
  const sorted=hexes.slice().sort((a,b)=>_hexLum(a)-_hexLum(b)); // dark -> light
  const darkest=sorted[0], lightest=sorted[sorted.length-1];
  const mids=sorted.slice(1,-1);
  // most saturated = primary/accent
  const sat=h=>{ const x=h.replace('#',''); const r=parseInt(x.slice(0,2),16),g=parseInt(x.slice(2,4),16),b=parseInt(x.slice(4,6),16); const mx=Math.max(r,g,b),mn=Math.min(r,g,b); return mx===0?0:(mx-mn)/mx; };
  const bySat=hexes.slice().sort((a,b)=>sat(b)-sat(a));
  const dark=_DNA.theme!=='light';
  _DNA.colors=[
    {role:'primary', hex:bySat[0]||'#5590ff'},
    {role:'accent', hex:bySat[1]||bySat[0]||'#5590ff'},
    {role:'background', hex:dark?darkest:lightest},
    {role:'surface', hex:dark?(sorted[1]||darkest):(sorted[sorted.length-2]||lightest)},
    {role:'text', hex:dark?lightest:darkest},
    {role:'muted', hex:mids[Math.floor(mids.length/2)]||'#8b939e'},
  ];
  // keep any extras as accent_2, accent_3...
  let ai=2;
  bySat.slice(2,5).forEach(h=>{ if(!_DNA.colors.some(c=>c.hex===h)){ _DNA.colors.push({role:'accent_'+(ai++),hex:h}); } });
  _saveDNA();
}

/* ---- Preset palettes (named, famous, every vibe) ---- */
const DNA_PALETTES=[
  {name:'Linear Dark', colors:['#5e6ad2','#8a91f5','#08090a','#16181d','#f7f8f8','#8a8f98']},
  {name:'Stripe', colors:['#635bff','#00d4ff','#0a2540','#1a2b4a','#ffffff','#adbdcc']},
  {name:'Vercel', colors:['#0070f3','#7928ca','#000000','#111111','#ffffff','#888888']},
  {name:'GitHub Dark', colors:['#2f81f7','#4ade80','#0d1117','#161b22','var(--tx)','var(--mu)']},
  {name:'Apple', colors:['#0071e3','#5e5ce6','#000000','#1d1d1f','#f5f5f7','#86868b']},
  {name:'Tesla', colors:['#e31937','#393c41','#000000','#171a20','#ffffff','#5c5e62']},
  {name:'Notion', colors:['#2383e2','#eb5757','#191919','#252525','#ffffff','#9b9a97']},
  {name:'Figma', colors:['#a259ff','#1abcfe','#0d0d0d','#1e1e1e','#ffffff','#b3b3b3']},
  {name:'Cyberpunk', colors:['#fcee0a','#ff003c','#0a0e14','#12161f','#00f0ff','#7b8496']},
  {name:'Sunset', colors:['#ff5e62','#ff9966','#1a1423','#2a2233','#fff3e6','#b8a99c']},
  {name:'Forest', colors:['#2d6a4f','#74c69d','#0b1a12','#16261d','#e8f3ec','#8fa99a']},
  {name:'Royal Luxury', colors:['#c9a227','#1a1a2e','#0a0a14','#16162a','#f5f0e1','#a89b7a']},
  {name:'Ocean', colors:['#0496ff','#00b4d8','#03045e','#0a1647','#caf0f8','#7a93b8']},
  {name:'Mono Slate', colors:['#64748b','#94a3b8','#0f172a','#1e293b','#f1f5f9','#94a3b8']},
  {name:'Candy Pop', colors:['#ff61d2','#fe9090','#1a0e1a','#2a1a2a','#fff0fb','#c89ec0']},
  {name:'Editorial Cream', colors:['#c0392b','#e67e22','#fdf6e3','#f4ecd8','#2c2416','#6b5d4a']},
];

/* ---- Theme families & option sets ---- */
const DNA_OPTS={
  themeFamily:['apple','linear','notion','stripe','vercel','github','tesla','figma','framer','material','swiss','brutalist','cyberpunk','luxury','startup','editorial','enterprise','academic','healthcare','legal'],
  projectType:['Landing page','Web app','SaaS dashboard','Portfolio','E-commerce','Blog / Magazine','Marketing site','Mobile app UI','Poster / Graphic','Component'],
  structure:['landing_page','dashboard','app','magazine','portfolio','ecommerce','enterprise'],
  borderRadius:['none','small','medium','large','pill'],
  shadowStyle:['none','soft','sharp','layered','glow'],
  bgStyle:['solid','gradient','mesh','aurora','dots','grid','waves'],
  buttonStyle:['solid','outline','ghost','gradient','glow','brutalist'],
  cardStyle:['flat','soft','bordered','elevated','glass'],
  formStyle:['outlined','filled','underline','floating'],
  iconStyle:['line','solid','duotone','minimal'],
  imageStyle:['photographic','illustration','3d_render','abstract','editorial','minimal'],
  motionLevel:['none','subtle','moderate','expressive'],
  motionStyle:['smooth','snappy','bouncy','dramatic'],
  navigation:['topbar','sidebar','mega_menu','command_palette','floating'],
  hero:['centered','split_screen','image','video','dashboard_preview','interactive'],
  sections:['bento','cards','timeline','comparison','masonry','tabs','accordion'],
  tone:['professional','friendly','bold','playful','luxurious','technical','inspirational'],
  fontScale:['compact','balanced','generous','dramatic'],
  whitespace:['tight','balanced','generous','airy'],
  density:['compact','balanced','spacious'],
  headingFont:['Newsreader','Inter','Playfair Display','Space Grotesk','Sora','Manrope','DM Serif Display','Archivo','Syne','Instrument Serif'],
  bodyFont:['Inter','Manrope','Roboto','Source Sans 3','DM Sans','Work Sans','IBM Plex Sans','Geist'],
};

/* ---- DNA configurator modal ---- */
const DNA_SECTIONS=[
  ['identity','🧬','Identity'],
  ['colors','🎨','Color system'],
  ['theme','🌓','Theme & family'],
  ['personality','✨','Personality'],
  ['psychology','🧠','Psychology'],
  ['typography','🔤','Typography'],
  ['layout','📐','Layout & space'],
  ['shape','⬡','Shape & depth'],
  ['effects','🌀','Effects & bg'],
  ['components','🧩','Components'],
  ['motion','🎞️','Motion'],
  ['content','✍️','Content & AI'],
];
function openDNA(){
  const r=$('ovr'); if(!r) return;
  _DNA._sec=_DNA._sec||'colors';
  const seen=loadStr('amv_dna_intro')==='1';
  r.innerHTML=`<div class="dna-ov" id="dna-bg"><div class="dna-modal" onclick="event.stopPropagation()">
    <div class="dna-head">
      <div><h2>Design DNA</h2><p>Your reusable style guide. Set it once - every design AMV makes follows it.</p></div>
      <div style="display:flex;align-items:center;gap:4px">
        <button class="dna-x" id="dna-help" title="What is this?" style="font-size:15px">?</button>
        <button class="dna-x" id="dna-x">✕</button>
      </div>
    </div>
    <div class="dna-intro" id="dna-intro" style="${seen?'display:none':''}">
      <div class="dna-intro-inner">
        <div class="dna-intro-badge">🧬</div>
        <h3>What is Design DNA?</h3>
        <p>It's a style guide AMV remembers and applies to everything it designs for you - so your sites, apps, decks and graphics all look like <em>they belong to the same brand</em>, automatically.</p>
        <div class="dna-intro-points">
          <div class="dna-ip"><span>🎨</span><div><b>Set your look once</b><br>Paste any color palette, pick fonts, shapes, and a vibe.</div></div>
          <div class="dna-ip"><span>♾️</span><div><b>Applied everywhere</b><br>Studio, Dev, and Chat all obey it when they build visuals.</div></div>
          <div class="dna-ip"><span>⚡</span><div><b>Totally optional</b><br>Skip it and AMV picks tasteful defaults. Come back anytime.</div></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn bp" id="dna-intro-go">Set up my DNA</button>
          <button class="btn" id="dna-intro-skip">Skip - use defaults</button>
        </div>
      </div>
    </div>
    <div class="dna-body" id="dna-body-main" style="${seen?'':'display:none'}">
      <div class="dna-nav" id="dna-nav">${DNA_SECTIONS.map(s=>`<button class="dna-nav-b ${s[0]===_DNA._sec?'on':''}" data-sec="${s[0]}"><span class="ic">${s[1]}</span><span class="lbl">${s[2]}</span></button>`).join('')}</div>
      <div class="dna-content" id="dna-content"></div>
    </div>
    <div class="dna-foot" id="dna-foot-main" style="${seen?'':'display:none'}">
      <span class="dna-foot-l" id="dna-foot-l"></span>
      <div style="display:flex;gap:8px">
        <button class="btn" id="dna-reset">Reset</button>
        <button class="btn bp" id="dna-done">Save DNA</button>
      </div>
    </div>
  </div></div>`;
  const showMain=()=>{ saveStr('amv_dna_intro','1'); const i=$('dna-intro'); if(i)i.style.display='none'; const bm=$('dna-body-main'); if(bm)bm.style.display=''; const fm=$('dna-foot-main'); if(fm)fm.style.display='flex'; _dnaRenderSection(_DNA._sec); _dnaFoot(); $('dna-nav').querySelectorAll('.dna-nav-b').forEach(b=>on(b,'click',()=>{ _DNA._sec=b.dataset.sec; $('dna-nav').querySelectorAll('.dna-nav-b').forEach(x=>x.classList.toggle('on',x===b)); _dnaRenderSection(b.dataset.sec); })); };
  on($('dna-bg'),'click',closeDNA);
  on($('dna-x'),'click',closeDNA);
  on($('dna-help'),'click',()=>{ const i=$('dna-intro'); if(i)i.style.display=''; const bm=$('dna-body-main'); if(bm)bm.style.display='none'; const fm=$('dna-foot-main'); if(fm)fm.style.display='none'; });
  on($('dna-intro-go'),'click',showMain);
  on($('dna-intro-skip'),'click',()=>{ saveStr('amv_dna_intro','1'); closeDNA(); });
  on($('dna-reset'),'click',resetDNA);
  on($('dna-done'),'click',()=>{ _saveDNA(); closeDNA(); toast('Design DNA saved - it now drives every design','success'); if(S.tab==='studio') renderDesignView(); });
  if(seen) showMain();
}
function closeDNA(){ const r=$('ovr'); if(r) r.innerHTML=''; }
function _dnaFoot(){ const el=$('dna-foot-l'); if(el) el.textContent=(_DNA.colors.length)+' colors · '+_DNA.themeFamily+' · '+_DNA.theme+' theme'; }

function _sld(label,obj,key){ const v=obj[key]; return `<div class="dna-slider"><div class="dna-slider-h"><span>${label}</span><span>${v}</span></div><input type="range" min="0" max="100" value="${v}" data-sld="${key}"></div>`; }
function _opt(key,current){ return (DNA_OPTS[key]||[]).map(o=>`<button class="dna-pill ${o===current?'on':''}" data-pill="${key}" data-val="${o}">${String(o).replace(/_/g,' ')}</button>`).join(''); }

function _dnaRenderSection(sec){
  const c=$('dna-content'); if(!c) return;
  if(sec==='identity'){
    c.innerHTML=`<div class="dna-sec-t">Identity</div><div class="dna-sec-d">What you're building and for whom. This frames every decision.</div>
      <div class="dna-field"><label>Project name</label><input type="text" data-txt="projectName" value="${escH(_DNA.projectName)}" placeholder="e.g. Northwind Analytics"></div>
      <div class="dna-grid2">
        <div class="dna-field"><label>Project type</label><select data-sel="projectType">${DNA_OPTS.projectType.map(o=>`<option ${o===_DNA.projectType?'selected':''}>${o}</option>`).join('')}</select></div>
        <div class="dna-field"><label>Industry</label><input type="text" data-txt="industry" value="${escH(_DNA.industry)}" placeholder="Technology, Finance, Health…"></div>
      </div>
      <div class="dna-field"><label>Target audience</label><input type="text" data-txt="audience" value="${escH(_DNA.audience)}" placeholder="e.g. enterprise IT buyers, Gen-Z gamers"></div>`;
  }
  else if(sec==='colors'){
    c.innerHTML=`<div class="dna-sec-t">Color system</div><div class="dna-sec-d">Paste ANY palette - hex, rgb, hsl, GitHub lists, Tailwind, CSS variables. AMV extracts every color and maps it to roles. Or pick a preset, or set each swatch by hand.</div>
      <div class="dna-field"><label>Paste a palette (any format)</label>
        <textarea class="dna-paste-box" id="dna-paste" placeholder="#5e6ad2  #8a91f5  rgb(8,9,10)
or paste a whole CSS / Tailwind / GitHub palette - AMV finds the colors"></textarea>
        <div style="display:flex;gap:8px;margin-top:9px;flex-wrap:wrap">
          <button class="btn bp" id="dna-extract">Extract & apply</button>
          <button class="btn" id="dna-extract-add">Add as accents</button>
        </div>
        <div class="dna-extracted" id="dna-extracted"></div>
        <div class="dna-mini">Tip: works with anything - paste from Coolors, GitHub, a screenshot's hex list, Tailwind config, or your brand guide.</div>
      </div>
      <div class="dna-field"><label>Current roles</label>
        <div class="dna-preview-strip">${_DNA.colors.map(c2=>`<span style="background:${c2.hex}"></span>`).join('')}</div>
        <div class="dna-swatches" id="dna-swatches">${_DNA.colors.map((c2,i)=>`
          <div class="dna-swatch">
            <div class="dna-swatch-c" style="background:${c2.hex}"><input type="color" value="${/^#[0-9a-f]{6}$/i.test(c2.hex)?c2.hex:'#000000'}" data-cidx="${i}"></div>
            <div class="dna-swatch-meta"><div class="dna-swatch-role">${c2.role.replace(/_/g,' ')}</div><div class="dna-swatch-hex">${c2.hex}</div></div>
          </div>`).join('')}</div>
        <button class="dna-add-btn" id="dna-add-color">+ Add color</button>
      </div>
      <div class="dna-field"><label>Preset palettes</label>
        <div class="dna-pal-grid">${DNA_PALETTES.map((p,i)=>`<div class="dna-pal-card" data-pal="${i}"><div class="dna-pal-name">${p.name}</div><div class="dna-pal-row">${p.colors.map(h=>`<span style="background:${h}"></span>`).join('')}</div></div>`).join('')}</div>
      </div>
      <div class="dna-grid3">
        ${_sld('Saturation',_DNA,'saturation')}
        ${_sld('Contrast',_DNA,'contrast')}
        <div class="dna-field"><label>Temperature</label><div class="dna-pills">${['warm','cool','neutral'].map(t=>`<button class="dna-pill ${_DNA.temperature===t?'on':''}" data-pill="temperature" data-val="${t}">${t}</button>`).join('')}</div></div>
      </div>`;
    on($('dna-extract'),'click',()=>{ const t=$('dna-paste').value; const hx=parseColorsFromText(t); if(!hx.length){ toast('No colors found in that text','error'); return; } applyPalette(hx); _dnaRenderSection('colors'); _dnaFoot(); toast('Applied '+hx.length+' colors','success'); });
    on($('dna-extract-add'),'click',()=>{ const t=$('dna-paste').value; const hx=parseColorsFromText(t); if(!hx.length){ toast('No colors found','error'); return; } let ai=_DNA.colors.filter(c2=>c2.role.startsWith('accent')).length+1; hx.forEach(h=>{ if(!_DNA.colors.some(c2=>c2.hex===h)) _DNA.colors.push({role:'accent_'+(ai++),hex:h}); }); _saveDNA(); _dnaRenderSection('colors'); toast('Added '+hx.length+' accent colors','success'); });
    on($('dna-paste'),'input',()=>{ const hx=parseColorsFromText($('dna-paste').value); const e=$('dna-extracted'); if(e) e.innerHTML=hx.slice(0,40).map(h=>`<span class="dna-extracted-c"><i style="background:${h}"></i>${h}</span>`).join(''); });
    on($('dna-add-color'),'click',()=>{ _DNA.colors.push({role:'accent_'+(_DNA.colors.length),hex:'#888888'}); _saveDNA(); _dnaRenderSection('colors'); });
    c.querySelectorAll('[data-cidx]').forEach(inp=>on(inp,'input',()=>{ _DNA.colors[+inp.dataset.cidx].hex=inp.value; _saveDNA(); _dnaRenderSection('colors'); _dnaFoot(); }));
    c.querySelectorAll('[data-pal]').forEach(card=>on(card,'click',()=>{ applyPalette(DNA_PALETTES[+card.dataset.pal].colors); _DNA.themeFamily=DNA_PALETTES[+card.dataset.pal].name.toLowerCase().split(' ')[0]||_DNA.themeFamily; _dnaRenderSection('colors'); _dnaFoot(); toast('Applied '+DNA_PALETTES[+card.dataset.pal].name,'success'); }));
  }
  else if(sec==='theme'){
    c.innerHTML=`<div class="dna-sec-t">Theme & family</div><div class="dna-sec-d">Choose the overall aesthetic. AMV follows the design language of these systems.</div>
      <div class="dna-field"><label>Mode</label><div class="dna-pills">${['light','dark','auto'].map(t=>`<button class="dna-pill ${_DNA.theme===t?'on':''}" data-pill="theme" data-val="${t}">${t}</button>`).join('')}</div></div>
      <div class="dna-field"><label>Theme family</label><div class="dna-pills">${_opt('themeFamily',_DNA.themeFamily)}</div></div>`;
  }
  else if(sec==='personality'){
    c.innerHTML=`<div class="dna-sec-t">Brand personality</div><div class="dna-sec-d">Dial in the character. These traits steer tone, color intensity, spacing, and motion.</div>
      <div class="dna-grid2">${Object.keys(_DNA.personality).map(k=>_sld(k.charAt(0).toUpperCase()+k.slice(1),_DNA.personality,'p:'+k)).join('')}</div>`;
  }
  else if(sec==='psychology'){
    c.innerHTML=`<div class="dna-sec-t">Psychology</div><div class="dna-sec-d">What should visitors feel? AMV uses color theory, layout and copy to evoke these.</div>
      <div class="dna-grid2">${Object.keys(_DNA.psychology).map(k=>_sld(k.charAt(0).toUpperCase()+k.slice(1),_DNA.psychology,'y:'+k)).join('')}</div>`;
  }
  else if(sec==='typography'){
    c.innerHTML=`<div class="dna-sec-t">Typography</div><div class="dna-sec-d">Fonts and rhythm. Heading + body pairing defines the whole feel.</div>
      <div class="dna-grid2">
        <div class="dna-field"><label>Heading font</label><select data-sel="headingFont">${DNA_OPTS.headingFont.map(o=>`<option ${o===_DNA.headingFont?'selected':''}>${o}</option>`).join('')}</select></div>
        <div class="dna-field"><label>Body font</label><select data-sel="bodyFont">${DNA_OPTS.bodyFont.map(o=>`<option ${o===_DNA.bodyFont?'selected':''}>${o}</option>`).join('')}</select></div>
      </div>
      <div class="dna-grid2">
        <div class="dna-field"><label>Heading weight</label><select data-sel="headingWeight">${['400','500','600','700','800'].map(o=>`<option ${o===_DNA.headingWeight?'selected':''}>${o}</option>`).join('')}</select></div>
        <div class="dna-field"><label>Font scale</label><div class="dna-pills">${_opt('fontScale',_DNA.fontScale)}</div></div>
      </div>
      <div class="dna-grid2">
        <div class="dna-field"><label>Letter spacing</label><div class="dna-pills">${['tight','normal','wide'].map(t=>`<button class="dna-pill ${_DNA.letterSpacing===t?'on':''}" data-pill="letterSpacing" data-val="${t}">${t}</button>`).join('')}</div></div>
        <div class="dna-field"><label>Line height</label><div class="dna-pills">${['tight','comfortable','loose'].map(t=>`<button class="dna-pill ${_DNA.lineHeight===t?'on':''}" data-pill="lineHeight" data-val="${t}">${t}</button>`).join('')}</div></div>
      </div>`;
  }
  else if(sec==='layout'){
    c.innerHTML=`<div class="dna-sec-t">Layout & space</div><div class="dna-sec-d">Structure, width and breathing room.</div>
      <div class="dna-field"><label>Structure</label><div class="dna-pills">${_opt('structure',_DNA.structure)}</div></div>
      <div class="dna-grid2">
        <div class="dna-field"><label>Max width</label><input type="text" data-txt="maxWidth" value="${escH(_DNA.maxWidth)}" placeholder="1200px"></div>
        <div class="dna-field"><label>Navigation</label><div class="dna-pills">${_opt('navigation',_DNA.navigation)}</div></div>
      </div>
      <div class="dna-grid2">
        <div class="dna-field"><label>Whitespace</label><div class="dna-pills">${_opt('whitespace',_DNA.whitespace)}</div></div>
        <div class="dna-field"><label>Density</label><div class="dna-pills">${_opt('density',_DNA.density)}</div></div>
      </div>
      <div class="dna-grid2">
        <div class="dna-field"><label>Hero</label><div class="dna-pills">${_opt('hero',_DNA.hero)}</div></div>
        <div class="dna-field"><label>Sections</label><div class="dna-pills">${_opt('sections',_DNA.sections)}</div></div>
      </div>`;
  }
  else if(sec==='shape'){
    c.innerHTML=`<div class="dna-sec-t">Shape & depth</div><div class="dna-sec-d">Corners, borders and shadows define how soft or sharp everything feels.</div>
      <div class="dna-grid2">
        <div class="dna-field"><label>Border radius</label><div class="dna-pills">${_opt('borderRadius',_DNA.borderRadius)}</div></div>
        <div class="dna-field"><label>Border width</label><div class="dna-pills">${['none','hairline','thin','bold'].map(t=>`<button class="dna-pill ${_DNA.borderWidth===t?'on':''}" data-pill="borderWidth" data-val="${t}">${t}</button>`).join('')}</div></div>
      </div>
      <div class="dna-field"><label>Shadow style</label><div class="dna-pills">${_opt('shadowStyle',_DNA.shadowStyle)}</div></div>
      <div class="dna-grid2">${_sld('Shadow depth',_DNA,'shadowDepth')}${_sld('Geometric vs organic',_DNA,'geometricness')}</div>`;
  }
  else if(sec==='effects'){
    c.innerHTML=`<div class="dna-sec-t">Effects & background</div><div class="dna-sec-d">Surface treatments and the page backdrop.</div>
      <div class="dna-field"><label>Background style</label><div class="dna-pills">${_opt('bgStyle',_DNA.bgStyle)}</div></div>
      <div class="dna-field"><label>Surface effects</label><div class="dna-pills">
        ${[['glassmorphism','Glassmorphism'],['brutalism','Brutalism'],['grain','Film grain']].map(t=>`<button class="dna-pill ${_DNA[t[0]]?'on':''}" data-bool="${t[0]}">${t[1]}</button>`).join('')}
      </div></div>
      <div class="dna-grid2">${_sld('Glow',_DNA,'glow')}${_sld('Noise',_DNA,'noise')}</div>`;
  }
  else if(sec==='components'){
    c.innerHTML=`<div class="dna-sec-t">Components</div><div class="dna-sec-d">How buttons, cards, forms, icons and imagery look.</div>
      <div class="dna-grid2">
        <div class="dna-field"><label>Button style</label><div class="dna-pills">${_opt('buttonStyle',_DNA.buttonStyle)}</div></div>
        <div class="dna-field"><label>Card style</label><div class="dna-pills">${_opt('cardStyle',_DNA.cardStyle)}</div></div>
      </div>
      <div class="dna-grid2">
        <div class="dna-field"><label>Form style</label><div class="dna-pills">${_opt('formStyle',_DNA.formStyle)}</div></div>
        <div class="dna-field"><label>Icon style</label><div class="dna-pills">${_opt('iconStyle',_DNA.iconStyle)}</div></div>
      </div>
      <div class="dna-field"><label>Image style</label><div class="dna-pills">${_opt('imageStyle',_DNA.imageStyle)}</div></div>
      ${_sld('Image realism',_DNA,'imageRealism')}`;
  }
  else if(sec==='motion'){
    c.innerHTML=`<div class="dna-sec-t">Motion</div><div class="dna-sec-d">How alive the interface feels.</div>
      <div class="dna-grid2">
        <div class="dna-field"><label>Motion level</label><div class="dna-pills">${_opt('motionLevel',_DNA.motionLevel)}</div></div>
        <div class="dna-field"><label>Motion style</label><div class="dna-pills">${_opt('motionStyle',_DNA.motionStyle)}</div></div>
      </div>
      <div class="dna-field"><label>Easing</label><div class="dna-pills">${['ease-out','ease-in-out','spring','linear'].map(t=>`<button class="dna-pill ${_DNA.easing===t?'on':''}" data-pill="easing" data-val="${t}">${t}</button>`).join('')}</div></div>`;
  }
  else if(sec==='content'){
    c.innerHTML=`<div class="dna-sec-t">Content & AI</div><div class="dna-sec-d">Voice, and how creative AMV should be.</div>
      <div class="dna-grid2">
        <div class="dna-field"><label>Tone</label><div class="dna-pills">${_opt('tone',_DNA.tone)}</div></div>
        <div class="dna-field"><label>Emoji usage</label><div class="dna-pills">${['none','minimal','moderate','liberal'].map(t=>`<button class="dna-pill ${_DNA.emojiUsage===t?'on':''}" data-pill="emojiUsage" data-val="${t}">${t}</button>`).join('')}</div></div>
      </div>
      <div class="dna-grid2">${_sld('Creativity',_DNA,'creativity')}${_sld('Originality',_DNA,'originality')}</div>
      <div class="dna-grid2">${_sld('Predictability',_DNA,'predictability')}${_sld('Experimentation',_DNA,'experimentation')}</div>
      <div class="dna-field" style="margin-top:6px"><label>Brand locking</label><div class="dna-pills">
        ${[['strictColors','Lock colors'],['strictTypography','Lock fonts'],['allowExperiments','Allow experiments']].map(t=>`<button class="dna-pill ${_DNA[t[0]]?'on':''}" data-bool="${t[0]}">${t[1]}</button>`).join('')}
      </div></div>`;
  }
  // wire common controls
  c.querySelectorAll('[data-txt]').forEach(inp=>on(inp,'input',()=>{ _DNA[inp.dataset.txt]=inp.value; _saveDNA(); }));
  c.querySelectorAll('[data-sel]').forEach(sel=>on(sel,'change',()=>{ _DNA[sel.dataset.sel]=sel.value; _saveDNA(); }));
  c.querySelectorAll('[data-sld]').forEach(sl=>on(sl,'input',()=>{ const k=sl.dataset.sld; if(k.startsWith('p:'))_DNA.personality[k.slice(2)]=+sl.value; else if(k.startsWith('y:'))_DNA.psychology[k.slice(2)]=+sl.value; else _DNA[k]=+sl.value; const h=sl.closest('.dna-slider')?.querySelector('.dna-slider-h span:last-child'); if(h)h.textContent=sl.value; _saveDNA(); }));
  c.querySelectorAll('[data-pill]').forEach(p=>on(p,'click',()=>{ const k=p.dataset.pill; _DNA[k]=p.dataset.val; c.querySelectorAll(`[data-pill="${k}"]`).forEach(x=>x.classList.toggle('on',x===p)); _saveDNA(); _dnaFoot(); }));
  c.querySelectorAll('[data-bool]').forEach(b=>on(b,'click',()=>{ const k=b.dataset.bool; _DNA[k]=!_DNA[k]; b.classList.toggle('on',_DNA[k]); _saveDNA(); }));
}

/* ---- Serialize DNA into a generation directive ---- */
function dnaPromptBlock(){
  const d=_DNA;
  const cols=d.colors.map(c=>c.role+': '+c.hex).join(', ');
  const persona=Object.entries(d.personality).filter(([k,v])=>v>=65||v<=25).map(([k,v])=>k+' '+v).join(', ');
  const psych=Object.entries(d.psychology).filter(([k,v])=>v>=65).map(([k])=>k).join(', ');
  const fx=[d.glassmorphism&&'glassmorphism',d.brutalism&&'brutalism',d.grain&&'film grain'].filter(Boolean).join(', ')||'none';
  const lock=[d.strictColors&&'use ONLY the exact colors above',d.strictTypography&&'use ONLY the specified fonts'].filter(Boolean).join('; ');
  return [
"=== DESIGN DNA (authoritative - every visual decision derives from this) ===",
d.projectName?("Project: "+d.projectName+(d.industry?(" - "+d.industry):"")):"",
d.audience?("Audience: "+d.audience):"",
"Type: "+d.projectType+" | Structure: "+d.structure+" | Theme: "+d.theme+" ("+d.themeFamily+" design language)",
"COLORS - "+cols+". Saturation "+d.saturation+"/100, contrast "+d.contrast+"/100, "+d.temperature+" temperature.",
"TYPOGRAPHY - Headings: "+d.headingFont+" "+d.headingWeight+"; Body: "+d.bodyFont+"; scale "+d.fontScale+", "+d.lineHeight+" line-height, "+d.letterSpacing+" tracking. Load via Google Fonts.",
"LAYOUT - max-width "+d.maxWidth+", "+d.whitespace+" whitespace, "+d.density+" density, "+d.navigation+" nav, "+d.hero+" hero, "+d.sections+" section pattern.",
"SHAPE - "+d.borderRadius+" radius, "+d.borderWidth+" borders, "+d.shadowStyle+" shadows (depth "+d.shadowDepth+"/100).",
"EFFECTS - background "+d.bgStyle+"; surface effects: "+fx+"; glow "+d.glow+"/100.",
"COMPONENTS - "+d.buttonStyle+" buttons, "+d.cardStyle+" cards, "+d.formStyle+" forms, "+d.iconStyle+" icons. Imagery: "+d.imageStyle+".",
"MOTION - "+d.motionLevel+" level, "+d.motionStyle+" feel, "+d.easing+" easing.",
persona?("PERSONALITY - "+persona+"."):"",
psych?("EVOKE - "+psych+"."):"",
"VOICE - "+d.tone+" tone, "+d.emojiUsage+" emoji. Creativity "+d.creativity+"/100, originality "+d.originality+"/100.",
lock?("CONSTRAINTS - "+lock+"."):"",
"Output must look like a top-tier agency built it. Never generic. Perfect consistency across the whole design.",
"=== END DESIGN DNA ==="
].filter(Boolean).join("\n");
}
window.openDNA=openDNA;window.resetDNA=resetDNA;
function _dnaShouldApply(msgs){
  try{
    const last=[...msgs].reverse().find(m=>m.r==='u');
    const t=last?(typeof last.c==='string'?last.c:(last.d||'')):'';
    return /\b(website|web ?app|landing|page|site|ui|interface|html|css|design|component|button|form|card|dashboard|portfolio|hero|layout|build me|make me|create a|3d|mockup|frontend)\b/i.test(t);
  }catch(e){ return false; }
}
window._dnaShouldApply=_dnaShouldApply;

/* Task #1: tell the chat model EXACTLY which action-integrations are connected,
   so it never claims to send an email / post to Slack / etc. when it can't. */
function _integrationStatusPrompt(){
  try{
    if(typeof TASK_CAPABILITIES==='undefined') return '';
    const connected=[], missing=[];
    TASK_CAPABILITIES.forEach(c=>{
      (c.isConnected()?connected:missing).push(c.integration+' ('+c.api+')');
    });
    // de-dupe by integration name
    const uniq=a=>[...new Set(a)];
    let s='\n\nINTEGRATION REALITY (critical - never violate): You can only take real actions through integrations the user has actually connected. ';
    s+= uniq(connected).length ? 'Currently CONNECTED and usable: '+uniq(connected).join(', ')+'. ' : 'The user has NOT connected any action integrations yet. ';
    if(uniq(missing).length) s+='NOT connected: '+uniq(missing).join(', ')+'. ';
    s+='If the user asks you to perform an action that needs an integration that is NOT connected, do NOT claim you did it. Instead, state plainly that it requires the specific API (name it) and that they need to connect it in Integrations first. Be specific and honest.';
    return s;
  }catch(e){ return ''; }
}
window._integrationStatusPrompt=_integrationStatusPrompt;


/* ============================================================
   CODE  - AI coding workspace entry
   ============================================================ */
// Live build progress - shows Dev writing past a single response's limit.
function _devProgress(p){
  try{
    const el=$('dev-prev-s'); if(!el) return;
    if(p.round>1 || p.truncated){
      el.innerHTML='<span class="dev-gen">Writing\u2026 '+p.lines.toLocaleString()+' lines'+(p.round>1?' \u00b7 pass '+p.round:'')+'</span>';
    } else {
      el.innerHTML='<span class="dev-gen">Writing\u2026 '+p.lines.toLocaleString()+' lines</span>';
    }
  }catch(e){}
}
function _devChip(prompt,label){
  return '<button class="dev-chip" data-dq="'+escH(prompt)+'">'+escH(label)+'</button>';
}
function renderCodeView(){
  const vc=$('vc'); if(!vc) return;
  const blank = !_DEV.log.length;
  vc.innerHTML = `<div class="dev-shell${blank?' dev-blank':''}" id="dev-shell">
    <div class="dev-chat-pane">
      <div class="dev-bar">
        <div class="dev-bar-l">
          <span class="dev-badge">Dev</span>
          ${_sectionModelSelect('code','dev-model')}
          <span class="sec-usage-note" id="dev-usage-note"></span>
        </div>
        <div class="dev-bar-r">
          <div class="dev-addwrap">
            <button class="dev-ico" id="dev-add" title="Add existing code (optional)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
            <div class="dev-add-menu" id="dev-add-menu" style="display:none">
              <button data-add="files"><b>Files</b><span>One or a few files</span></button>
              <button data-add="folder"><b>Folder</b><span>A whole project</span></button>
              <button data-add="connect"><b>Connect folder</b><span>Also save edits back &middot; Chrome/Edge</span></button>
            </div>
          </div>
          <button class="dev-ico" id="dev-tolab" title="Debug in Lab"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4M12 2v6.5L7 19a1 1 0 0 0 .9 1.5h8.2A1 1 0 0 0 17 19l-5-10.5"/></svg></button>
          <button class="dev-ico" id="dev-save" style="display:none" title="Save to your folder"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg></button>
          <button class="dev-ico" id="dev-new" title="New session"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
          <input type="file" id="dev-files" multiple style="display:none">
          <input type="file" id="dev-folderinput" webkitdirectory directory multiple style="display:none">
        </div>
      </div>

      <div id="dev-hero" class="dev-hero">
        <h2>What should we build?</h2>
        <p>Describe it in plain English. AMV writes the code, runs it, and shows you the live result.</p>
        <div class="dev-hero-chips" id="dev-hero-chips">
          ${_devChip('A landing page for a coffee brand - hero, pricing, and a signup form','Landing page')}
          ${_devChip('A to-do app with add, complete, delete, and saved state','To-do app')}
          ${_devChip('A snake game I can play with the arrow keys','Snake game')}
          ${_devChip('A dashboard with a revenue chart and summary cards','Dashboard')}
        </div>
        <div class="dev-hero-upload">
          <button class="dev-upload-btn" id="dev-hero-add">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload files or a folder
          </button>
          <span class="dev-hero-or">to work on code you already have</span>
        </div>
        ${_ownedMarketHTML('dev')}
      </div>

      <div id="dev-log" class="dev-log"></div>

      <div id="ctx-dev"></div>
      <div class="dev-input">
        <select id="dev-lang" class="lab-sel" style="display:none"><option value="js">JavaScript</option><option value="python">Python</option></select>
        <textarea id="dev-msg" rows="1" placeholder="Describe what to build\u2026"></textarea>
        <button class="dev-send" id="dev-send" title="Build (Enter)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
      </div>
    </div>

    <div class="dev-preview">
      <div class="dev-prev-bar">
        <div class="dev-prev-tabs">
          <button class="dev-pt on" id="dev-tab-prev" data-pv="preview">Preview</button>
          <button class="dev-pt" id="dev-tab-code" data-pv="code">Code</button>
        </div>
        <div class="dev-prev-acts"><span id="dev-prev-s"></span>
          <button class="dev-openext" id="dev-download-proj" title="Download the project"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
          <button class="dev-openext" id="dev-deploy" title="Deploy a shareable page"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h8l-1 8 10-12h-8z"/></svg></button>
          <button class="dev-openext" id="dev-open-ext" title="Open in a new tab"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>
        </div>
      </div>
      <div id="dev-prev-body" class="dev-prev-body"><div class="lab-placeholder">Your live result appears here.</div></div>
      <div id="dev-code-body" class="dev-code-body" style="display:none"><div class="dev-code-layout"><div class="dev-tree" id="dev-tree"></div><div class="dev-code-main" id="dev-code-main"><div class="lab-placeholder">The code appears here as AMV writes it.</div></div></div></div>
    </div>
  </div>`;
  // hero chips fill the composer
  vc.querySelectorAll('#dev-hero-chips [data-dq]').forEach(c=>on(c,'click',()=>{
    const t=$('dev-msg'); if(t){ t.value=c.dataset.dq; t.focus(); t.style.height='auto'; t.style.height=Math.min(t.scrollHeight,140)+'px'; }
  }));
  _devRenderLog();
  const ta=$('dev-msg');
  on(ta,'input',()=>{ ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,140)+'px'; });
  on(ta,'keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); _devSend(); } });
  on($('dev-send'),'click',_devSend);
  on($('dev-lang'),'change',()=>{ _DEV.lang=$('dev-lang').value; });
  $('dev-lang').value=_DEV.lang;
  // section model picker + live usage note
  const devUsage=()=>{ const n=$('dev-usage-note'); if(n){ n.textContent=''; } };
  devUsage();
  on($('dev-model'),'change',function(){ _setSectionModel('code', this.value); devUsage(); toast('Code model set to '+MODELS[this.value].label,'info',2500); });
  // Code/Preview toggle (Terminal removed - Dev is a build-and-preview surface)
  const showPV=(pv)=>{ const pb=$('dev-prev-body'),cb=$('dev-code-body'); const tp=$('dev-tab-prev'),tc=$('dev-tab-code'); [pb,cb].forEach(x=>{if(x)x.style.display='none';}); [tp,tc].forEach(x=>x&&x.classList.remove('on')); if(pv==='code'){ if(cb)cb.style.display='block'; tc&&tc.classList.add('on'); } else { if(pb)pb.style.display='flex'; tp&&tp.classList.add('on'); } };
  on($('dev-tab-prev'),'click',()=>showPV('preview'));
  on($('dev-tab-code'),'click',()=>showPV('code'));
  on($('dev-open-ext'),'click',()=>_devOpenExternal());
  on($('dev-download-proj'),'click',()=>_devDownloadProject());
  on($('dev-deploy'),'click',()=>_devDeploy());
  on($('dev-tolab'),'click',()=>{ const code=_DEV.activePath?_DEV.project[_DEV.activePath]?.content:_DEV.curCode; if(code){ _LAB_HANDOFF=code; setTab('lab'); toast('Sent to Lab for debugging','info'); } else { toast('Build something first, then send it to Lab','info'); } });
  on($('dev-new'),'click',()=>{
    _sessNew('dev');
    _DEV.log=[]; _DEV.project={}; _DEV.activePath=''; _DEV.curCode=''; _DEV.curLang='';
    _devPushSys("Tell me what to build. I'll write it, run it, and show you both the result and the code. Ask for changes anytime.");
    renderCodeView();
    toast('New Dev session','info',2000);
  });
  // ---- Add code: single dropdown → files / folder / connect ----
  const connectFolderFlow=async()=>{
    if(!AMVWorkspace.supported()||!window.isSecureContext){ toast('Saving back to a folder needs Chrome or Edge on the live (https) site. Use Files or Folder instead - works everywhere.','info',6000); return; }
    try{
      await AMVWorkspace.connectFolder();
      _DEV.usingWorkspace=true; _DEV.project={}; _DEV.activePath='';
      /* The second door onto the same folder. A Dev project is sent to the
         engine on every build, so pulling every file in here would post the
         credentials the workspace itself holds back - the guard has to be on
         what leaves, not on one route to it. AMVWorkspace.sends is that test. */
      const held=[];
      AMVWorkspace.files.forEach(f=>{
        if(!f.isText||f.text==null) return;
        if(!AMVWorkspace.sends(f)){ held.push(f.path); return; }
        _devSetFile(f.path, f.text);
      });
      _DEV.activePath=_devEntryFile(); _devRenderTree(); _devShowActive(); const sv=$('dev-save'); if(sv) sv.style.display='';
      _devPushSys('Project connected - '+_devProjectFiles().length+' files. I can edit any of them and save straight back.'
        +(held.length?(' '+held.length+' file'+(held.length>1?'s were':' was')+' left out because '+(held.length>1?'they look':'it looks')+' like credentials: '+held.join(', ')+'.'):'')); _devRenderLog();
      toast(held.length
        ? ('Connected - '+_devProjectFiles().length+' files. '+held.length+' left out as credentials.')
        : ('Connected - '+_devProjectFiles().length+' files'),'success',held.length?6000:4000);
    }catch(e){ if(e.message==='cancelled') return; toast('Couldn’t open that folder. Try Files or Folder instead.','error',5000); }
  };
  const ingestFiles=async(fileList)=>{
    // Context guard: a project can hold at most CTX_MAX_FILES files.
    try{
      const have=Object.keys(_DEV.project||{}).length;
      const incoming=(fileList&&fileList.length)||0;
      if(have+incoming > CTX_MAX_FILES){
        toast('A project can hold up to '+CTX_MAX_FILES+' files (you have '+have+'). Remove some, or start a new session and carry a handoff across.','error',6500);
        return;
      }
    }catch(e){}
    let added=0;
    for(const file of Array.from(fileList||[])){
      const isText=/\.(txt|md|csv|json|js|mjs|ts|jsx|tsx|html|css|py|java|c|cpp|go|rs|rb|php|sql|sh|xml|yml|yaml|vue|svelte|scss|less)$/i.test(file.name)||(file.type||'').startsWith('text');
      if(isText && file.size<800000){ const text=await file.text(); const path=file.webkitRelativePath||file.name; _devSetFile(path, text); added++; }
    }
    _DEV.activePath=_DEV.activePath||_devEntryFile(); _devRenderTree(); _devShowActive();
    const total=_devProjectFiles().length;
    _devPushSys('Loaded '+added+' file'+(added>1?'s':'')+' - project now has '+total+'. Ask me to build, fix, or refactor across them.'); _devRenderLog();
    toast('Loaded '+added+' file'+(added>1?'s':''),'success',3500);
  };
  const addMenu=$('dev-add-menu');
  on($('dev-add'),'click',(e)=>{ e.stopPropagation(); if(addMenu) addMenu.style.display=addMenu.style.display==='none'?'block':'none'; });
  // The hero's obvious upload button opens the same menu.
  on($('dev-hero-add'),'click',(e)=>{ e.stopPropagation(); if(addMenu) addMenu.style.display=addMenu.style.display==='none'?'block':'none'; });
  document.addEventListener('click',()=>{ if(addMenu) addMenu.style.display='none'; });
  if(addMenu){ addMenu.querySelectorAll('[data-add]').forEach(b=>on(b,'click',(e)=>{ e.stopPropagation(); addMenu.style.display='none'; const k=b.dataset.add; if(k==='files') $('dev-files')&&$('dev-files').click(); else if(k==='folder') $('dev-folderinput')&&$('dev-folderinput').click(); else connectFolderFlow(); })); }
  // Drag & drop files straight onto Dev.
  const devShell=$('dev-shell');
  if(devShell){
    on(devShell,'dragover',(e)=>{ e.preventDefault(); devShell.classList.add('dev-drop'); });
    on(devShell,'dragleave',(e)=>{ if(e.target===devShell) devShell.classList.remove('dev-drop'); });
    on(devShell,'drop',async(e)=>{
      e.preventDefault(); devShell.classList.remove('dev-drop');
      const fs=e.dataTransfer&&e.dataTransfer.files;
      if(fs&&fs.length) await ingestFiles(fs);
    });
  }
  on($('dev-files'),'change',async function(){ await ingestFiles(this.files); this.value=''; });
  on($('dev-folderinput'),'change',async function(){ await ingestFiles(this.files); this.value=''; });
  on($('dev-save'),'click',async()=>{
    if(!AMVWorkspace.dirHandle){ let n=0; const proj=_devProjectName(); _devProjectFiles().forEach(p=>{ try{ const blob=new Blob([_DEV.project[p].content],{type:'text/plain'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); // name downloads after the project so they are identifiable
      a.download=(proj?proj+'-':'')+p.split('/').pop(); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),800); n++; }catch(e){} }); toast('Downloaded '+n+' files'+(proj?' ('+proj+')':''),'info'); return; }
    let n=0; for(const p of _devProjectFiles()){ try{ await AMVWorkspace.writeFile(p, _DEV.project[p].content); n++; }catch(e){} }
    toast('Saved '+n+' files to your folder','success',4000);
  });
  _devRenderTree();
  if(_devProjectFiles().length){ const sv=$('dev-save'); if(sv&&AMVWorkspace.dirHandle) sv.style.display=''; _devShowActive(); }
  else if(_DEV.curCode) _devShowResult(_DEV.curCode,_DEV.curLang,_DEV.curRun);
}
let _LAB_HANDOFF='';
function _devConnectVSCode(){
  const r=$('ovr'); if(!r) return;
  r.innerHTML='<div class="ov" id="vsc-bg"><div class="tp-modal" style="max-width:480px" onclick="event.stopPropagation()">'+
    '<button class="dna-x" id="vsc-x" style="position:absolute;top:14px;right:14px">\u2715</button>'+
    '<h2 style="font-family:var(--fdisplay);font-weight:500;font-size:21px;margin:0 0 6px">Use AMV in VS Code</h2>'+
    '<p style="font-size:13px;color:var(--mu);line-height:1.6;margin:0 0 18px">Run these two commands in your project folder. That\u2019s it - AMV opens in your editor and can read, write, and run your code.</p>'+
    '<div class="vsc-cmd"><code>npm install -g @amv/cli</code><button class="vsc-copy" data-c="npm install -g @amv/cli">Copy</button></div>'+
    '<div class="vsc-cmd" style="margin-top:8px"><code>amv code .</code><button class="vsc-copy" data-c="amv code .">Copy</button></div>'+
    '<p style="font-size:11px;color:var(--dim);margin:16px 0 0;line-height:1.5">Your code stays on your machine - the CLI just links this account to your editor.</p>'+
  '</div></div>';
  const close=()=>{ r.innerHTML=''; };
  on($('vsc-bg'),'click',close); on($('vsc-x'),'click',close);
  r.querySelectorAll('.vsc-copy').forEach(btn=>on(btn,'click',()=>{ try{ navigator.clipboard.writeText(btn.dataset.c); btn.textContent='Copied'; setTimeout(()=>btn.textContent='Copy',1200); }catch(e){} }));
}
const _DEV={ log:[], lang:'js', busy:false, curCode:'', curLang:'', curRun:null,
  // multi-file project: files keyed by path. activePath = file shown in Code pane.
  project:{}, activePath:'', usingWorkspace:false,
  name:'' };   // the project's name - exports and saved files are named after it
// project helpers
function _devProjectFiles(){ return Object.keys(_DEV.project).sort(); }

/* The project name. Everything AMV exports is named after the project rather
   than a generic "file1", so a build you come back to is identifiable. */
function _devProjectName(){
  if(_DEV.name) return _DEV.name;
  try{ const s=loadStr('amv_dev_name'); if(s){ _DEV.name=s; return s; } }catch(e){}
  return '';
}
function _devSetName(name){
  const clean=String(name||'').trim().replace(/[^\w\s-]/g,'').replace(/\s+/g,'-').toLowerCase().slice(0,48);
  if(!clean) return _DEV.name;
  _DEV.name=clean;
  try{ saveStr('amv_dev_name', clean); }catch(e){}
  return clean;
}
/* Derive a project name from what the user asked for, the first time they build.
   "build me a portfolio site for a photographer" -> "portfolio-site". */
function _devDeriveName(request){
  if(_devProjectName()) return _DEV.name;
  const t=String(request||'').toLowerCase()
    .replace(/^(build|make|create|write|generate|code)\s+(me\s+)?(a|an|the)?\s*/,'')
    .replace(/\b(app|site|website|page|tool|for|with|that|using|in|please)\b.*$/,'$&');
  const words=(t.match(/[a-z0-9]+/g)||[]).filter(w=>!/^(a|an|the|me|for|with|that|using|in|please|and|to|of)$/.test(w));
  const name=words.slice(0,3).join('-')||'project';
  return _devSetName(name);
}
window._devProjectName=_devProjectName; window._devSetName=_devSetName;
function _devSetFile(path, content, lang){ path=_safePath(path)||('file'+Date.now()); _DEV.project[path]={ content, lang:lang||_devLangFor(path), ts:Date.now() }; if(!_DEV.activePath) _DEV.activePath=path; try{ _sessTouch('dev'); }catch(e){} }
function _devLangFor(path){ const e=(path.split('.').pop()||'').toLowerCase(); return ({js:'js',mjs:'js',jsx:'js',ts:'js',tsx:'js',py:'python',html:'html',css:'css',json:'json',md:'md'})[e]||'txt'; }
function _devEntryFile(){
  const files=_devProjectFiles();
  return files.find(p=>/index\.html$/i.test(p)) || files.find(p=>/\.html$/i.test(p)) ||
         files.find(p=>/(index|main|app)\.(js|mjs|py)$/i.test(p)) || files.find(p=>/\.(js|py)$/i.test(p)) || files[0] || '';
}
function _devProjectContext(maxChars){
  maxChars=maxChars||16000; const files=_devProjectFiles();
  if(!files.length) return '';
  let out='CURRENT PROJECT ('+files.length+' files):\n'+files.map(p=>'- '+p).join('\n')+'\n\nFILE CONTENTS:\n';
  for(const p of files){ const chunk='\n===== '+p+' =====\n'+_DEV.project[p].content+'\n'; if(out.length+chunk.length>maxChars){ out+='\n[...truncated...]'; break; } out+=chunk; }
  return out;
}
function _devPushSys(t){ _DEV.log.push({role:'sys',text:t}); }
// render the file tree in the Code pane
function _devRenderTree(){
  const el=$('dev-tree'); if(!el) return;
  const files=_devProjectFiles();
  if(!files.length){ el.innerHTML='<div class="dev-tree-empty">No project files yet.<br>Build something, open a folder, or upload files.</div>'; return; }
  el.innerHTML='<div class="dev-tree-h">'+escH(_devProjectName()||'Files')+'<span class="dev-tree-n">'+files.length+' file'+(files.length===1?'':'s')+'</span></div>'+files.map(p=>'<div class="dev-tree-f'+(p===_DEV.activePath?' on':'')+'" data-path="'+encodeURIComponent(p)+'"><span class="dev-tree-ic">'+_fileIcon('',p)+'</span>'+escH(p)+'</div>').join('');
  el.querySelectorAll('[data-path]').forEach(f=>on(f,'click',()=>{ _DEV.activePath=decodeURIComponent(f.dataset.path); _devRenderTree(); _devShowActive(); }));
}
// show the active file's code in the Code pane
function _devShowActive(){
  const main=$('dev-code-main'); if(!main) return;
  const p=_DEV.activePath; const f=p&&_DEV.project[p];
  if(!f){ main.innerHTML='<div class="lab-placeholder">Select a file.</div>'; return; }
  main.innerHTML='<div class="dev-code-wrap"><div class="dev-code-h">'+escH(p)+'<button class="dev-copy" data-code="'+encodeURIComponent(f.content)+'">copy</button></div><pre>'+escH(f.content)+'</pre></div>';
  main.querySelectorAll('.dev-copy').forEach(btn=>on(btn,'click',()=>{navigator.clipboard&&navigator.clipboard.writeText(decodeURIComponent(btn.dataset.code));btn.textContent='copied';setTimeout(()=>btn.textContent='copy',1200);}));
}
/* Open the current live preview in a real new browser tab. Uses a Blob URL
   (never a custom protocol, so it can't blank the page). Falls back to a
   helpful toast if there's nothing built yet or the tab is blocked. */
function _devOpenExternal(){
  let html='';
  try{ html = _devProjectPreviewHTML() || _DEV.lastHTML || ''; }catch(e){ html = _DEV.lastHTML || ''; }
  if(!html || !html.trim()){ toast('Build something first - then you can open the live preview in a browser tab.','info',4000); return; }
  try{
    const blob=new Blob([html],{type:'text/html'});
    const url=URL.createObjectURL(blob);
    const w=window.open(url,'_blank','noopener');
    if(!w){ toast('Allow pop-ups to open the preview in a new tab.','error',4000); URL.revokeObjectURL(url); return; }
    setTimeout(()=>{ try{ URL.revokeObjectURL(url); }catch(e){} }, 60000);
  }catch(e){ toast('Couldn\u2019t open the preview in a new tab.','error',3000); }
}
window._devOpenExternal=_devOpenExternal;
// Download the whole project. Single file → that file; multiple → a combined
// bundle the user can split, plus each file offered. Keeps it dependency-free.
function _devDownloadProject(){
  const files=_DEV.project||{};
  const paths=Object.keys(files);
  if(!paths.length){ toast('Build something first - then you can download the project.','info',3500); return; }
  try{
    if(paths.length===1){
      const p=paths[0], f=files[p];
      const blob=new Blob([f.content||''],{type:'text/plain'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=p.split('/').pop()||'file.txt'; a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),2000);
      toast('Downloaded '+a.download,'success',2500); return;
    }
    // Multiple files: build a single self-describing bundle with clear separators.
    let bundle='/* AMV project export - '+paths.length+' files.\n';
    bundle+='   Each file is delimited by a ==== FILE: path ==== header. */\n\n';
    paths.forEach(p=>{ bundle+='/* ==== FILE: '+p+' ==== */\n'+(files[p].content||'')+'\n\n'; });
    const blob=new Blob([bundle],{type:'text/plain'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='amv-project.txt'; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),2000);
    toast('Downloaded project ('+paths.length+' files)','success',3000);
  }catch(e){ toast('Couldn\u2019t download the project.','error',3000); }
}
// Deploy: publish the built app as a branded, shareable live page (reuses the
// share-artifact infrastructure so it opens as a clean hosted-looking page).
/* Deploy = publish to a REAL, live, public URL.
   This used to base64 the page into a URL fragment ("nothing is stored on a
   server"), which isn't a deployment and broke past ~18KB. Now it actually
   hosts the site and returns a shareable link that works for anyone. */
/* AMV-188: this was a byte-for-byte copy of _autoApi with one difference, and
   the difference was the bug.

   That one carries `code` and `status` onto the error, with a comment saying
   why: a caller has to be able to tell "this needs a paid plan" from "the
   network failed", and matching on prose breaks the first time the wording
   changes. This copy threw a bare Error, so every deploy failure arrived
   indistinguishable - a plan limit, a quota, a dead connection, all the same
   sentence with nothing to branch on.

   The fix was applied to one of the two copies. That is what duplication does,
   and it had already happened here with the reasoning written down next to the
   half that got it. One definition now. */
async function _deployApi(path, body){
  return _autoApi(path, body);
}

async function _devDeploy(){
  let html='';
  try{ html=_devProjectPreviewHTML()||_DEV.lastHTML||''; }catch(e){ html=_DEV.lastHTML||''; }
  if(!html||!html.trim()){ toast('Build something first - then Deploy puts it live at a real URL.','info',4000); return; }

  const title=(_DEV.activePath?_DEV.activePath.split('/').pop().replace(/\.\w+$/,''):'My app')||'My app';

  if(!(window.AMV_API && AMV_API.live && AMV_API.token)){
    toast('Connect the AMV engine in Settings to publish a live URL. You can still download the file.','error',6000);
    return;
  }

  const btn=$('dev-deploy'); const old=btn?btn.innerHTML:'';
  if(btn){ btn.disabled=true; btn.textContent='Publishing\u2026'; }
  try{
    const d = await _deployApi('/deploy', { html, title, slug:_DEV.deploySlug||undefined });
    _DEV.deploySlug = d.slug;                       // re-deploys update the same URL
    _showDeployed(d.url, title, !!_DEV.deployedOnce);
    _DEV.deployedOnce = true;
    try{ _sessTouch('dev'); }catch(e){}
  }catch(e){
    if(e.message==='not-connected') toast('Connect the AMV engine in Settings to publish.','error',5000);
    else toast('Deploy failed: '+e.message,'error',5000);
  }finally{
    if(btn){ btn.disabled=false; btn.innerHTML=old; }
  }
}

/* The "it's live" moment - a real URL they can open and share. */
function _showDeployed(url, title, wasUpdate){
  const ovr=$('ovr'); if(!ovr) return;
  ovr.innerHTML=
    '<div class="share-modal deploy-modal">'+
      '<div class="deploy-live"><span class="deploy-dot"></span>'+(wasUpdate?'Updated':'Live')+'</div>'+
      '<div class="share-title">'+escH(title)+' is live</div>'+
      '<p class="share-sub">Anyone with this link can open it - it\u2019s hosted, not a temporary preview. Deploying again updates this same URL.</p>'+
      '<div class="share-link-row"><input id="dep-url" class="inp" readonly value="'+escH(url)+'"><button class="btn bp" id="dep-copy">Copy</button></div>'+
      '<div class="share-actions">'+
        '<button class="btn bs" id="dep-open">Open site</button>'+
        '<button class="btn bs" id="dep-sites">My sites</button>'+
        '<button class="btn bs" id="dep-close">Done</button>'+
      '</div>'+
    '</div>';
  ovr.classList.add('on');
  on($('dep-copy'),'click',()=>{ _copyText(url).then(()=>{ const b=$('dep-copy'); if(b){ b.textContent='Copied!'; setTimeout(()=>b.textContent='Copy',1500); } }); });
  on($('dep-open'),'click',()=>window.open(url,'_blank','noopener'));
  on($('dep-sites'),'click',()=>{ closeOvr(); openMySites(); });
  on($('dep-close'),'click',closeOvr);
}

/* "Host multiple live apps" - the place you manage them. */
async function openMySites(){
  const ovr=$('ovr'); if(!ovr) return;
  ovr.innerHTML='<div class="share-modal"><div class="share-title">My live sites</div><p class="share-sub">Loading\u2026</p></div>';
  ovr.classList.add('on');
  let sites=[];
  try{ const d=await _deployApi('/deploy/list',{}); sites=d.sites||[]; }
  catch(e){
    ovr.innerHTML='<div class="share-modal"><div class="share-title">My live sites</div>'+
      '<p class="share-sub">'+(e.message==='not-connected'?'Connect the AMV engine in Settings to publish sites.':escH(e.message))+'</p>'+
      '<div class="share-actions"><button class="btn bs" id="ms-close">Close</button></div></div>';
    on($('ms-close'),'click',closeOvr); return;
  }
  const rows = sites.length
    ? sites.map(s=>'<div class="site-row">'+
        '<div class="site-l"><div class="site-t">'+escH(s.title||s.slug)+'</div>'+
          '<a class="site-u" href="'+escH(safeUrl(s.url))+'" target="_blank" rel="noopener noreferrer">'+escH(String(s.url||'').replace(/^https?:\/\//,''))+'</a>'+
          '<div class="site-m">'+(s.views||0)+' view'+((s.views||0)===1?'':'s')+' \u00b7 '+Math.max(1,Math.round((s.bytes||0)/1024))+'KB</div></div>'+
        '<div class="site-r">'+
          '<button class="btn bs" data-open="'+escH(s.url)+'">Open</button>'+
          '<button class="btn bs site-del" data-del="'+escH(s.slug)+'">Delete</button>'+
        '</div></div>').join('')
    : '<p class="share-sub">No live sites yet. Build something in Dev and hit Deploy.</p>';
  ovr.innerHTML='<div class="share-modal"><div class="share-title">My live sites</div>'+
    '<div class="site-list">'+rows+'</div>'+
    '<div class="share-actions"><button class="btn bs" id="ms-close">Close</button></div></div>';
  ovr.querySelectorAll('[data-open]').forEach(b=>on(b,'click',()=>{ const u=safeUrl(b.dataset.open); if(u) window.open(u,'_blank','noopener'); }));
  ovr.querySelectorAll('[data-del]').forEach(b=>on(b,'click',async()=>{
    b.disabled=true; b.textContent='\u2026';
    try{ await _deployApi('/deploy/delete',{slug:b.dataset.del}); toast('Site taken down.','success',3000); openMySites(); }
    catch(e){ toast('Could not delete: '+e.message,'error',4000); b.disabled=false; b.textContent='Delete'; }
  }));
  on($('ms-close'),'click',closeOvr);
}
try{ window.openMySites=openMySites; }catch(e){}

/* ── Error dashboard: what is actually breaking for your users ──────────── */
async function openErrors(){
  const ovr=$('ovr'); if(!ovr) return;
  // In memory for this tab only (AMV-082) - it used to be written to disk.
  const token = (typeof _adminToken==='function') ? _adminToken() : '';
  ovr.innerHTML='<div class="share-modal err-modal"><div class="share-title">Errors</div><p class="share-sub">Loading\u2026</p></div>';
  ovr.classList.add('on');

  if(!(window.AMV_API && AMV_API.live)){
    ovr.innerHTML='<div class="share-modal err-modal"><div class="share-title">Errors</div>'+
      '<p class="share-sub">Connect the AMV engine in Settings to collect error reports.</p>'+
      '<div class="share-actions"><button class="btn bs" id="er-x">Close</button></div></div>';
    on($('er-x'),'click',closeOvr); return;
  }
  if(!token){ _errAskToken(); return; }

  let data=null;
  try{
    const r=await fetchDeadline(AMV_API.base.replace(/\/$/,'')+'/errors/list',{
      method:'POST', headers:{'Content-Type':'application/json','X-Admin-Token':token},
      body: JSON.stringify({})
    });
    data = await r.json();
    if(data.error) throw new Error(data.error);
  }catch(e){
    if(/unauthorized/i.test(e.message||'')){ try{ _clearAdminToken(); }catch(_){} _errAskToken('That admin token was rejected.'); return; }
    ovr.innerHTML='<div class="share-modal err-modal"><div class="share-title">Errors</div>'+
      '<p class="share-sub">Couldn\u2019t load: '+escH(e.message)+'</p>'+
      '<div class="share-actions"><button class="btn bs" id="er-x">Close</button></div></div>';
    on($('er-x'),'click',closeOvr); return;
  }

  const groups=data.groups||[];
  const ago=(t)=>{ const s=Math.floor((Date.now()-t)/1000);
    if(s<60) return s+'s ago'; if(s<3600) return Math.floor(s/60)+'m ago';
    if(s<86400) return Math.floor(s/3600)+'h ago'; return Math.floor(s/86400)+'d ago'; };

  const rows = groups.length
    ? groups.map(g=>'<div class="err-row" data-fp="'+escH(g.fp)+'">'+
        '<div class="err-main">'+
          '<div class="err-msg">'+escH(g.msg)+'</div>'+
          '<div class="err-meta">'+
            '<span class="err-tag '+(g.kind==='worker'?'srv':'')+'">'+escH(g.kind)+'</span>'+
            '<span>'+escH(g.where||'unknown')+'</span>'+
            '<span>\u00b7 last '+ago(g.last)+'</span>'+
          '</div>'+
        '</div>'+
        '<div class="err-nums">'+
          '<div class="err-count">'+g.count+'</div>'+
          '<div class="err-users">'+(g.users||0)+' user'+((g.users||0)===1?'':'s')+'</div>'+
        '</div>'+
        '<button class="btn bs err-fix" data-fix="'+escH(g.fp)+'">Resolve</button>'+
      '</div>').join('')
    : '<div class="err-none"><b>No errors reported</b><span>Nothing has broken for your users. This is the good outcome.</span></div>';

  ovr.innerHTML='<div class="share-modal err-modal">'+
    '<div class="share-title">Errors</div>'+
    '<div class="err-stats">'+
      '<div><b>'+(data.distinct||0)+'</b><span>distinct bugs</span></div>'+
      '<div><b>'+(data.total||0)+'</b><span>total events</span></div>'+
      '<div><b>'+(data.active24h||0)+'</b><span>active today</span></div>'+
    '</div>'+
    '<div class="err-list">'+rows+'</div>'+
    '<div class="share-actions">'+
      '<button class="btn bs" id="er-refresh">Refresh</button>'+
      (groups.length?'<button class="btn bs" id="er-all">Resolve all</button>':'')+
      '<button class="btn bs" id="er-x">Close</button>'+
    '</div></div>';

  ovr.querySelectorAll('[data-fix]').forEach(b=>on(b,'click',async()=>{
    b.disabled=true; b.textContent='\u2026';
    try{
      await fetchDeadline(AMV_API.base.replace(/\/$/,'')+'/errors/resolve',{
        method:'POST', headers:{'Content-Type':'application/json','X-Admin-Token':token},
        body: JSON.stringify({ fp:b.dataset.fix })});
      openErrors();
    }catch(e){ b.disabled=false; b.textContent='Resolve'; }
  }));
  on($('er-all'),'click',async()=>{
    try{ await fetchDeadline(AMV_API.base.replace(/\/$/,'')+'/errors/resolve',{
      method:'POST', headers:{'Content-Type':'application/json','X-Admin-Token':token},
      body: JSON.stringify({ all:true })}); openErrors(); }catch(e){}
  });
  on($('er-refresh'),'click',openErrors);
  on($('er-x'),'click',closeOvr);
}

function _errAskToken(msg){
  const ovr=$('ovr'); if(!ovr) return;
  ovr.innerHTML='<div class="share-modal err-modal">'+
    '<div class="share-title">Admin access</div>'+
    '<p class="share-sub">'+(msg?escH(msg)+' ':'')+'Enter your ADMIN_TOKEN (the secret you set on the Worker) to see what\u2019s breaking for your users.</p>'+
    '<input id="er-tok" class="inp" type="password" placeholder="ADMIN_TOKEN" autocomplete="off">'+
    '<p class="share-sub" style="margin-top:8px;font-size:11px">Kept in memory for this tab only - never written to this device.</p>'+
    '<div class="share-actions">'+
      '<button class="btn bp" id="er-go">View errors</button>'+
      '<button class="btn bs" id="er-x">Cancel</button>'+
    '</div></div>';
  ovr.classList.add('on');
  on($('er-go'),'click',()=>{
    const v=($('er-tok')||{}).value||'';
    if(!v.trim()) return;
    // Session memory, not localStorage - a secret at rest is a secret an
    // injected script can read tomorrow (AMV-082).
    _setAdminToken(v);
    openErrors();
  });
  on($('er-x'),'click',closeOvr);
}
try{ window.openErrors=openErrors; }catch(e){}
window._devDownloadProject=_devDownloadProject;
window._devDeploy=_devDeploy;
// build a runnable preview from the whole project (bundles html+css+js)
function _devProjectPreviewHTML(){
  const files=_devProjectFiles();
  const htmlPath=files.find(p=>/\.html$/i.test(p));
  if(!htmlPath) return null;
  let doc=_DEV.project[htmlPath].content;
  // helper: find a tag containing `needle`, from `open` to `close`, replace with `repl`
  const swap=(open, needleName, closeStr, repl)=>{
    let idx=0;
    while(true){
      const start=doc.toLowerCase().indexOf(open, idx);
      if(start<0) break;
      const end=doc.indexOf(closeStr, start);
      if(end<0) break;
      const tag=doc.slice(start, end+closeStr.length);
      if(tag.indexOf(needleName)>=0){ doc=doc.slice(0,start)+repl+doc.slice(end+closeStr.length); idx=start+repl.length; }
      else idx=end+closeStr.length;
    }
  };
  files.filter(p=>/\.css$/i.test(p)).forEach(p=>{ const name=p.split('/').pop(); swap('<link', name, '>', '<style>\n'+_DEV.project[p].content+'\n</style>'); });
  files.filter(p=>/\.js$/i.test(p)).forEach(p=>{ const name=p.split('/').pop(); swap('<script', name, '</scr'+'ipt>', '<script>\n'+_DEV.project[p].content+'\n</scr'+'ipt>'); });
  return doc;
}
function _devShowResult(code,lang,run){
  // remember the latest runnable HTML so "Open in browser" can use it
  try{ if(run && run.html) _DEV.lastHTML = run.html; }catch(e){}
  // Code pane
  const cb=$('dev-code-body');
  if(cb){ cb.innerHTML='<div class="dev-code-wrap"><div class="dev-code-h">'+escH(lang||'code')+'<button class="dev-copy" data-code="'+encodeURIComponent(code)+'">copy</button></div><pre>'+escH(code)+'</pre></div>'; cb.querySelectorAll('.dev-copy').forEach(btn=>on(btn,'click',()=>{navigator.clipboard&&navigator.clipboard.writeText(decodeURIComponent(btn.dataset.code));btn.textContent='copied';setTimeout(()=>btn.textContent='copy',1200);})); }
  // Preview pane
  const pb=$('dev-prev-body');
  if(pb && run){
    if(run.html){ pb.innerHTML='<iframe class="dev-prev-frame" sandbox="allow-scripts" srcdoc="'+run.html.replace(/"/g,'&quot;')+'"></iframe>'; }
    else pb.innerHTML='<div class="dev-prev-out '+(run.ok?'ok':'err')+'"><pre>'+escH(run.ok?(run.stdout||run.result||'(no output)'):run.stderr)+'</pre></div>';
  }
}
function _devRenderLog(){
  try{ const sh=$('dev-shell'); if(sh){ const wasBlank=sh.classList.contains('dev-blank'); const nowBlank=!_DEV.log.length; sh.classList.toggle('dev-blank', nowBlank); if(wasBlank && !nowBlank){ try{ _mountMobilePaneToggle('dev'); _mobileShowOutput('dev'); }catch(e){} } } }catch(e){}
  try{ _ctxRenderMeter('ctx-dev','dev'); }catch(e){}
  const el=$('dev-log'); if(!el) return;
  el.innerHTML=_DEV.log.map(m=>{
    if(m.role==='user') return '<div class="dev-msg-u">'+escH(m.text)+'</div>';
    if(m.role==='sys') return '<div class="dev-msg-sys">'+escH(m.text)+'</div>';
    if(m._snag) return '<div class="dev-msg-ai"><div class="ai-snag"><div class="ai-snag-row"><span class="ai-snag-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg></span><span class="ai-snag-msg">'+escH(m._snag)+'</span></div><button class="ai-snag-retry" data-dev-retry="1" type="button">Retry</button></div></div>';
    let h='<div class="dev-msg-ai">';
    if(m.text) h+='<div class="dev-ai-txt">'+(typeof md==='function'?md(m.text):escH(m.text))+'</div>';
    if(m.code) h+='<div class="dev-code"><div class="dev-code-h">'+escH(m.lang||'code')+' <button class="dev-copy" data-code="'+encodeURIComponent(m.code)+'">copy</button></div><pre>'+escH(m.code.length>800?m.code.slice(0,800)+'\n…':m.code)+'</pre></div>';
    if(m.run) h+='<div class="dev-run '+(m.run.ok?'ok':'err')+'"><div class="dev-run-h">'+(m.run.ok?'✓ ran ('+m.run.ms+'ms)':'✗ error')+'</div><pre>'+escH(m.run.ok?(m.run.stdout||m.run.result||'(no output)'):m.run.stderr)+'</pre></div>';
    h+='</div>'; return h;
  }).join('');
  el.scrollTop=el.scrollHeight;
  el.querySelectorAll('.dev-copy').forEach(btn=>on(btn,'click',()=>{navigator.clipboard&&navigator.clipboard.writeText(decodeURIComponent(btn.dataset.code));btn.textContent='copied';}));
  el.querySelectorAll('[data-dev-retry]').forEach(btn=>on(btn,'click',()=>{
    // drop the snag entry, resend the most recent user message
    const lastUser=[..._DEV.log].reverse().find(x=>x.role==='user');
    _DEV.log=_DEV.log.filter(x=>!x._snag);
    if(lastUser){ const ta=$('dev-msg'); if(ta){ ta.value=lastUser.text; _devSend(); } }
    _devRenderLog();
  }));
}
/* Does this Dev request want a TOOL (ship it / make an image) rather than code?
   Dev used to be able to do neither - you had to leave and find another tab. */
function _devToolIntent(msg){
  const t=String(msg||'').toLowerCase();
  if(/\b(deploy|publish|ship it|put it live|go live|make it live|host it|give me a (live )?(url|link))\b/.test(t)) return 'deploy';
  if(/\b(generate|create|make|add)\b[^.]*\b(image|picture|photo|illustration|logo|icon|hero image|graphic)\b/.test(t)) return 'image';
  return null;
}

async function _devSend(){
  if(_DEV.busy) return;
  const ta=$('dev-msg'); const msg=ta?ta.value.trim():''; if(!msg) return;
  ta.value=''; ta.style.height='auto';
  _DEV.log.push({role:'user',text:msg}); _devRenderLog(); _DEV.busy=true;
  try{ _sessTouch('dev'); }catch(e){}
  const stat=$('dev-prev-s'); if(stat) stat.textContent='building…';
  const hasProject=_devProjectFiles().length>0;

  // ── Dev can now use AMV's real tools, not just write code ──
  const intent=_devToolIntent(msg);
  if(intent==='deploy' && hasProject){
    try{
      if(stat) stat.textContent='publishing…';
      const html=_devProjectPreviewHTML()||_DEV.lastHTML||'';
      if(!html.trim()) throw new Error('nothing to publish yet');
      const title=(_DEV.activePath?_DEV.activePath.split('/').pop().replace(/\.\w+$/,''):'My app')||'My app';
      const d=await _deployApi('/deploy',{ html, title, slug:_DEV.deploySlug||undefined });
      _DEV.deploySlug=d.slug;
      _DEV.log.push({role:'ai',text:'Published it. It\u2019s live at **'+d.url+'** - anyone with the link can open it. Deploying again updates this same URL.'});
      _devRenderLog();
      if(stat) stat.textContent='live';
      try{ _showDeployed(d.url, title, false); }catch(e){}
    }catch(e){
      const why = e.message==='not-connected'
        ? 'Connect the AMV engine in Settings and I can publish this to a live URL.'
        : 'Couldn\u2019t publish: '+e.message;
      _DEV.log.push({role:'ai',text:why}); _devRenderLog();
      if(stat) stat.textContent='';
    }
    _DEV.busy=false; return;
  }
  if(intent==='image'){
    try{
      if(stat) stat.textContent='creating image…';
      const out=await _amvRunTool('generate_image',{prompt:msg},(m)=>{ if(stat) stat.textContent=m; });
      _DEV.log.push({role:'ai',text:out.text, html:out.render||''});
      _devRenderLog();
      if(stat) stat.textContent='';
    }catch(e){
      _DEV.log.push({role:'ai',text:'Couldn\u2019t create the image: '+e.message}); _devRenderLog();
    }
    _DEV.busy=false; return;
  }

  try{
    if(hasProject){
      // ---- MULTI-FILE PROJECT MODE ----
      const sys='You are AMV Forge - a principal-level software engineer working in a multi-file project. '+
        'Make the requested change with production quality: complete, correct, secure, performant, well-structured. '+
        'You may create or edit ANY files. For EACH file you write, output a fenced block whose FIRST line is "WRITE_FILE: <path>" followed by the COMPLETE file contents (never fragments/diffs). '+
        'Only include files you actually changed or added. Before the file blocks, give a one or two sentence summary of what you changed. '+
        'When starting a NEW project, scaffold it as a REAL multi-file project the way a senior engineer would - separate files for markup, styles, scripts, components, config and a README - rather than cramming everything into one file. Use clear, conventional paths (index.html, styles/main.css, scripts/app.js, components/<name>.js). '+
        'If any UI is involved, it must look like a top design agency built it.';
      const _isUI=Object.keys(_DEV.project).some(p=>/\.(html|css|jsx|tsx)$/i.test(p))||/\b(html|css|ui|page|component|design|frontend)\b/i.test(msg);
      const prompt=(_isUI?dnaPromptBlock()+'\n\nApply the DESIGN DNA above to any UI.\n\n':'')+_devProjectContext()+'\n\nCHANGE REQUEST: '+msg;
      const resp=await aiCompleteLong(prompt, sys+_handoffContext('dev'), {max_tokens:16000, model:_sectionModel('code'),
        onProgress:(p)=>_devProgress(p)});
      const writes=[...resp.matchAll(/```[a-z]*\s*\n?WRITE_FILE:\s*([^\n`]+)\n([\s\S]*?)```/gi)];
      const summary=resp.split('```')[0].trim();
      const changed=[];
      try{ _devDeriveName(msg); }catch(e){}   // name the project from the first request
      for(const m of writes){ const path=m[1].trim(); const body=m[2].replace(/\n$/,''); _devSetFile(path, body); changed.push(path); }
      if(changed.length){ _DEV.activePath=changed[0]; }
      const entry={role:'ai',text:(summary||'Updated the project.')+(changed.length?('\n\n**Files changed:** '+changed.join(', ')):'')};
      _DEV.log.push(entry); _devRenderLog(); _devRenderTree(); _devShowActive();
      // preview whole project + auto-save if folder connected
      const previewHTML=_devProjectPreviewHTML();
      const pb=$('dev-prev-body');
      if(pb){ if(previewHTML){ pb.innerHTML='<iframe class="dev-prev-frame" sandbox="allow-scripts" srcdoc="'+previewHTML.replace(/"/g,'&quot;')+'"></iframe>'; } else {
        // run the entry script
        const entryP=_devEntryFile(); const lang=_devLangFor(entryP);
        if(lang==='js'||lang==='python'){ const run=await runCode(_DEV.project[entryP].content, lang, s=>{ if(stat) stat.textContent=s; }); pb.innerHTML='<div class="dev-prev-out '+(run.ok?'ok':'err')+'"><pre>'+escH(run.ok?(run.stdout||run.result||'(no output)'):run.stderr)+'</pre></div>'; if(stat) stat.textContent=run.ok?'✓ ran':'✗ error'; }
      } }
      if(AMVWorkspace.dirHandle && changed.length){ for(const p of changed){ try{ await AMVWorkspace.writeFile(p, _DEV.project[p].content); }catch(e){} } if(stat) stat.textContent='✓ saved to folder'; }
      _DEV.busy=false; return;
    }
    // ---- SINGLE-FILE MODE (unchanged behavior) ----
    const hasCurrent=!!_DEV.curCode;
    const sys='You are AMV Forge - a principal-level '+_DEV.lang+' engineer in a live code workspace. Your code must be the best version possible: production-ready, complete error handling, performance-aware, secure by default, elegantly structured. '+
      (hasCurrent?'You are EDITING existing code. Apply the user\u2019s requested change to the current code and return the COMPLETE updated program - never a fragment. ':'Write complete, runnable '+_DEV.lang+' code for the request. ')+
      'If the request is UI, it must look like a top design agency built it - real hierarchy, deliberate spacing, polished interactions. Briefly explain what you did in one or two sentences, then give ONE fenced '+_DEV.lang+' code block with the full program. Keep it self-contained so it runs directly.';
    const _isUI=/\b(html|css|ui|page|site|landing|component|button|form|card|layout|design|style|frontend|web ?app|dashboard)\b/i.test(msg)||/html/i.test(_DEV.curLang||'');
    const prompt=(_isUI?dnaPromptBlock()+'\n\nApply the DESIGN DNA above to any UI/visual output.\n\n':'')+
      (hasCurrent?('Current '+(_DEV.curLang||_DEV.lang)+' code:\n```\n'+_DEV.curCode+'\n```\n\nChange request: '+msg+'\n\nReturn the full updated program.'):msg);
    const resp=await aiCompleteLong(prompt, sys+_handoffContext('dev'), {max_tokens:16000, model:_sectionModel('code'),
      onProgress:(p)=>_devProgress(p)});
    const code=extractCode(resp,_DEV.lang)||extractCode(resp);
    const txt=resp.replace(/```[\s\S]*?```/g,'').trim();
    const entry={role:'ai',text:txt,code:code,lang:_DEV.lang};
    if(code){
      _DEV.curCode=code; _DEV.curLang=_DEV.lang;
      const run=await runCode(code,_DEV.lang,s=>{ if(stat) stat.textContent=s; });
      entry.run=run; _DEV.curRun=run;
      _devShowResult(code,_DEV.lang,run);
      if(stat) stat.textContent=run.ok?'✓ ran ('+run.ms+'ms)':'✗ error';
    } else { if(stat) stat.textContent=''; }
    _DEV.log.push(entry); _devRenderLog();
  }catch(err){ _DEV.log.push({role:'ai',text:'',_snag:_aiFriendly(err&&err.message)}); _devRenderLog(); if(stat) stat.textContent=''; }
  _DEV.busy=false;
}
window.renderCodeView=renderCodeView;

/* codeStart lived here, exported and referenced by nothing. */



/* ══════════════════════════════════════════════════════════════
   AGENTIC CHAT  - chat that DOES the work, not just describes it.

   Before this, chat could only search the web. Ask it to "make an image"
   or "build a landing page" or "run this and find the bug" and it would
   talk about it while you went hunting for the right tab.

   Now chat can actually reach every AMV engine. Each tool below is wired
   to a REAL function that already powers a tab - nothing here is a mock.
   ══════════════════════════════════════════════════════════════ */
const AMV_TOOLS = [
  {
    name:'generate_video',
    description:'Generate a short video clip from a text prompt. Use when the person asks for a video, clip, animation, or moving footage. Takes a minute or two; the clip is shown to them automatically when it is ready.',
    input_schema:{ type:'object', properties:{
      prompt:{type:'string', description:'A vivid description of the scene, including camera movement, lighting and action.'},
      seconds:{type:'number', description:'Clip length in seconds (5 or 10).'},
      aspect:{type:'string', description:'Aspect ratio: 16:9, 9:16 or 1:1.'}
    }, required:['prompt'] }
  },
  {
    name:'generate_image',
    description:'Generate an image from a text prompt. Use whenever the person asks for a picture, illustration, logo, poster, mockup, concept art, or any visual. Returns the image, which is shown to them automatically.',
    input_schema:{ type:'object', properties:{
      prompt:{type:'string', description:'A vivid, detailed description of the image.'},
      style:{type:'string', description:'Optional style, e.g. photorealistic, illustration, 3d, watercolor.'},
      ratio:{type:'string', description:'Optional aspect ratio: 1:1, 16:9, 9:16, 4:3.'}
    }, required:['prompt'] }
  },
  {
    name:'run_code',
    description:'Actually EXECUTE code and return its real output/errors. Use whenever the person wants code run, tested, verified, or when you want to check your own work before answering. Supports js, python, html.',
    input_schema:{ type:'object', properties:{
      code:{type:'string'},
      lang:{type:'string', enum:['js','python','html']}
    }, required:['code','lang'] }
  },
  {
    name:'fix_code',
    description:'Run code, and if it fails, automatically fix it and re-run until it passes. Use when the person has broken code or asks you to debug something.',
    input_schema:{ type:'object', properties:{
      code:{type:'string'},
      lang:{type:'string', enum:['js','python']}
    }, required:['code','lang'] }
  },
  {
    name:'build_app',
    description:'Build a complete, working app/site/page and show it running live. Use when the person asks you to build, make, or create something interactive - a landing page, a game, a dashboard, a tool. Produces a live preview they can use.',
    input_schema:{ type:'object', properties:{
      spec:{type:'string', description:'A full description of what to build, including features and style.'}
    }, required:['spec'] }
  },
  {
    name:'deploy_site',
    description:'Publish a page to a REAL, live, public URL that anyone can open. Use when the person asks to deploy, publish, ship, host, or "put it live", or when they want a shareable link. Returns the live URL.',
    input_schema:{ type:'object', properties:{
      html:{type:'string', description:'The complete HTML document to publish. If you just built something, pass that.'},
      title:{type:'string', description:'A short name for the site.'}
    }, required:['html'] }
  },
  /* ---- The Crew, from chat ----------------------------------------------
     Somebody who says "set that up to run every morning" has already
     described the job perfectly. Making them stop, find the Crew tab, and
     retype it is the product failing at the exact moment it was working.

     These call the same /auto/* routes the Crew screen calls, so a job
     created here is the same record, in the same list, running on the same
     cron - not a parallel idea of a job that chat keeps to itself.

     Reading is free. Anything that starts spending money on a schedule, or
     destroys work, asks the person first - see _TOOL_CONSENT below. */
  /* ---- The rest of the product, from chat -------------------------------
     Same rule as the Crew tools: each one calls what the section itself calls,
     so there is one copy of every fact. Reading is free; anything that
     persists, deletes, or sends asks first. */
  {
    name:'memory_list',
    description:'List what AMV has been told to remember about this person. Use before adding, so you do not store the same fact twice, and to answer "what do you know about me".',
    input_schema:{ type:'object', properties:{} }
  },
  {
    name:'memory_add',
    description:'Remember a durable fact about the person - their work, preferences, constraints, how they want to be answered. Use when they say "remember that..." or state something clearly meant to persist. NOT for one-off details of the current task, and never for a password, card number, or anything else secret.',
    input_schema:{ type:'object', properties:{
      text:{type:'string', description:'The fact, in one clear sentence, written so it still makes sense read on its own in six months.'}
    }, required:['text'] }
  },
  {
    name:'memory_forget',
    description:'Remove something AMV remembers. Call memory_list first and pass the id. Use for "forget that", "that is not true any more".',
    input_schema:{ type:'object', properties:{
      id:{type:'string', description:'The id from memory_list.'},
      match:{type:'string', description:'Only if you have no id: words from the memory. Ambiguous matches are refused rather than guessed.'}
    }, required:[] }
  },
  {
    name:'approvals_list',
    description:'List the finished work waiting for this person to approve - drafts produced by background jobs and by anything else that stops before sending. Use for "what is waiting for me", "anything need me", and before acting on one.',
    input_schema:{ type:'object', properties:{} }
  },
  {
    name:'approval_act',
    description:'Approve or reject a piece of waiting work. APPROVING IS WHAT SENDS IT - for an item that was going to be emailed, approving delivers it. Call approvals_list first, read the person the summary of what it will do, and only act when they have clearly said which one and which way.',
    input_schema:{ type:'object', properties:{
      id:{type:'string', description:'The id from approvals_list.'},
      action:{type:'string', enum:['approve','reject'], description:'"approve" delivers it. "reject" discards it.'}
    }, required:['id','action'] }
  },
  {
    name:'account_status',
    description:'What plan this person is on, what they have used this period, and what their background work has cost. Read-only. Use for "what plan am I on", "how much have I used", "am I near my limit" - never guess these from memory.',
    input_schema:{ type:'object', properties:{} }
  },
  {
    name:'crew_list',
    description:'List the person\'s background (Crew) jobs: what each one does, how often it runs, whether it is active or paused, and their standing instructions. ALWAYS call this before changing or removing a job, so you act on a real id rather than a guess. Also use it to answer any question about what AMV is running for them.',
    input_schema:{ type:'object', properties:{} }
  },
  {
    name:'crew_add',
    description:'Create a real background job that runs on a schedule without them present, and appears in the Crew tab. Use when they ask for something to happen regularly ("every morning", "each week", "keep an eye on"). Not for one-off work you can just do now.',
    input_schema:{ type:'object', properties:{
      detail:{type:'string', description:'Exactly what the job should do on each run, written as an instruction to whoever runs it. Be specific - this is all it will have.'},
      repeat:{type:'string', enum:['10min','30min','hourly','daily','weekly'], description:'How often it runs.'},
      approval:{type:'string', enum:['suggest','require','auto'], description:'How far it may go alone. "require" (default) does the work and waits for them before anything goes out. "auto" delivers on its own - only for jobs that purely produce information. "suggest" does not run the job at all, it just tells them it is due, which costs nothing.'}
    }, required:['detail'] }
  },
  {
    name:'crew_update',
    description:'Change what an existing background job does, or how often it runs. Call crew_list first to get the id.',
    input_schema:{ type:'object', properties:{
      id:{type:'string', description:'The job id from crew_list. Preferred.'},
      match:{type:'string', description:'Only if you have no id: words from the job, used to find exactly one. Ambiguous matches are refused rather than guessed.'},
      detail:{type:'string', description:'The new instruction, if it is changing.'},
      repeat:{type:'string', enum:['10min','30min','hourly','daily','weekly'], description:'The new frequency, if it is changing.'},
      approval:{type:'string', enum:['suggest','require','auto']}
    }, required:[] }
  },
  {
    name:'crew_pause',
    description:'Stop a background job from running, keeping it and its history so it can be resumed. Use for "stop", "pause", "hold off on" - it is the safe answer when they want something to stop and you are not certain they want it gone.',
    input_schema:{ type:'object', properties:{
      id:{type:'string'}, match:{type:'string', description:'Words from the job, if you have no id.'}
    }, required:[] }
  },
  {
    name:'crew_resume',
    description:'Start a paused background job running again.',
    input_schema:{ type:'object', properties:{
      id:{type:'string'}, match:{type:'string'}
    }, required:[] }
  },
  {
    name:'crew_remove',
    description:'Delete a background job permanently, along with its history. Prefer crew_pause unless they clearly want it gone.',
    input_schema:{ type:'object', properties:{
      id:{type:'string'}, match:{type:'string'}
    }, required:[] }
  },
  {
    name:'crew_ceiling',
    description:'Set the furthest ANY of their background jobs may go without them, now and for any they add later. Use for "never let anything run without asking me", "stop it doing things on its own", or the opposite. A job set further than this is held back rather than changed, so raising it later restores what each job was configured to do. This is a safety setting - always say plainly what it now means.',
    input_schema:{ type:'object', properties:{
      ceiling:{type:'string', enum:['suggest','require','auto'], description:'"suggest" nothing runs until asked and nothing is spent. "require" work is done but waits for approval before anything goes out. "auto" jobs deliver on their own.'}
    }, required:['ceiling'] }
  },
  {
    name:'crew_standing',
    description:'Set the standing instructions that apply to EVERY background job they have now and every one they add later - how much care to take, what to prefer, what to leave out. Use for "make my crew think harder", "always check two sources", "keep it shorter". This changes how the work is done; it cannot change what AMV is allowed to do. Pass an empty string to clear it.',
    input_schema:{ type:'object', properties:{
      standing:{type:'string', description:'The instruction, in the person\'s own terms. Replaces any previous one, so include anything from before that still applies.'}
    }, required:['standing'] }
  }
];

/* Which tools a given surface gets. Chat gets everything; Dev and Lab get the
   ones that make sense where they are. Before this, ONLY chat had tools at all
   - Dev couldn't ship what it built, Lab couldn't publish a fix. */
function _toolsFor(surface){
  const by = n => AMV_TOOLS.find(t=>t.name===n);
  if(surface==='dev')  return [by('generate_image'), by('deploy_site'), by('run_code')].filter(Boolean);
  if(surface==='lab')  return [by('run_code'), by('fix_code'), by('deploy_site')].filter(Boolean);
  /* The Crew surface can run the Crew. Talking to AMV on the screen that shows
     your background jobs and not being able to change one of them from there
     is the gap this whole path exists to close. */
  if(surface==='crew') return [by('generate_image'), by('run_code'), by('build_app'), by('deploy_site'),
                               by('crew_list'), by('crew_add'), by('crew_update'), by('crew_pause'),
                               by('crew_resume'), by('crew_remove'), by('crew_standing'), by('crew_ceiling')].filter(Boolean);
  return AMV_TOOLS;   // chat gets everything
}
try{ window._toolsFor=_toolsFor; }catch(e){}

/* ══════════════════════════════════════════════════════════════
   SHARED AGENTIC RUNNER - one tool-use loop, usable from ANY surface.

   Chat had its own loop baked into the streaming path, so Dev, Lab and Crew
   could never use tools at all. This is a surface-agnostic version: give it a
   prompt and a surface, it runs the full request -> tool -> result -> continue
   loop against the real engines and hands back the finished text plus anything
   that should be rendered.
   ══════════════════════════════════════════════════════════════ */
async function runAgentic(surface, userPrompt, opts){
  opts = opts || {};
  const tools = _toolsFor(surface);
  const onStatus = opts.onStatus || (()=>{});
  const maxRounds = opts.maxRounds || 4;

  const messages = [{ role:'user', content:String(userPrompt||'') }];
  let rendered = '';
  let finalText = '';

  for(let round = 0; round < maxRounds; round++){
    const body = {
      model: opts.model || _sectionModel('code'),
      max_tokens: opts.max_tokens || 8000,
      system: opts.system || 'You are AMV. You have real tools - use them to actually do the work rather than describing it.',
      messages,
      ...(tools.length ? { tools } : {})
    };

    const r = await fetchDeadline(_aiBase(), {
      method:'POST', headers:_aiHeaders(), body:JSON.stringify(body)
    }, 120000);
    if(!r.ok){
      const t = await r.text().catch(()=>'');
      throw new Error('AMV request failed ('+r.status+'): '+t.slice(0,160));
    }
    const data = await r.json();
    const blocks = data.content || [];

    const text = blocks.filter(b=>b.type==='text').map(b=>b.text).join('').trim();
    if(text) finalText = text;

    const toolUses = blocks.filter(b=>b.type==='tool_use');
    if(!toolUses.length || data.stop_reason !== 'tool_use'){
      return { text: finalText, rendered, rounds: round + 1 };
    }

    // Run every tool the model asked for, feed the REAL results back.
    const results = [];
    for(const tu of toolUses){
      /* Every name here was chosen by the MODEL, which is exactly the condition
         AMV-007 describes: the request can come from content the model read
         rather than from anything the person asked for. Chat's streaming loop
         has always asked first. This runner was written later and did not, so a
         second dispatch path could execute code on the device and publish a
         public page with no prompt at all. Same gate, same reasons. */
      let out;
      if(_toolNeedsConsent(tu.name)){
        const allowed = await _confirmModelTool(tu.name, tu.input || {});
        if(!allowed){
          out = { text:'The user DENIED permission to run "'+tu.name+'". Do not attempt it again unless they explicitly ask for it. Continue helping without it.', render:null };
          try{ if(typeof AEGIS!=='undefined') AEGIS.log('tool_denied',{tool:tu.name,surface}); }catch(e){}
        }
      }
      if(!out) out = await _amvRunTool(tu.name, tu.input || {}, onStatus);
      results.push({ type:'tool_result', tool_use_id: tu.id, content: String(out.text||'').slice(0,8000) });
      if(out.render) rendered += out.render;
    }
    messages.push({ role:'assistant', content: blocks });
    messages.push({ role:'user', content: results });
  }
  return { text: finalText, rendered, rounds: maxRounds, hitLimit:true };
}
try{ window.runAgentic = runAgentic; }catch(e){}

/* Execute a tool the model asked for. Returns a string result for the model,
   plus optional rich content rendered into the chat. */
/* AMV-007: tool authorization. When the MODEL requests a side-effecting or
   code-executing tool, the request may originate from prompt injection or from
   untrusted content the model read - not from the user's actual intent. Those
   tools require an explicit, per-call user approval that shows exactly what will
   happen. User-INITIATED calls (Dev/Lab "Run", explicit buttons) bypass this -
   they ARE the user's intent - so the gate lives only on the agentic
   model-driven dispatch path, never inside _amvRunTool itself. */
/* A background job is the highest-value thing on this list to an attacker: it
   runs unattended, on a schedule, spending money, and it persists long after
   the conversation that created it is gone. So creating one, restarting one,
   deleting one, or editing the instructions that ride along on every run all
   ask first - and the prompt says what will actually happen.

   crew_list and crew_pause do not. Reading their own jobs is not a side effect,
   and pausing STOPS the spending - putting a dialog in front of "stop doing
   that" is the one place a confirmation makes things worse. */
const _TOOL_CONSENT = { deploy_site:true, run_code:true, fix_code:true,
                        crew_add:true, crew_update:true, crew_resume:true,
                        crew_remove:true, crew_standing:true, crew_ceiling:true,
                        /* A memory is appended to EVERY future request, so writing
                           one is writing a small permanent instruction - the same
                           shape of risk as the standing instruction, and worth the
                           same question. Forgetting destroys something of theirs.
                           And approving is what SENDS. */
                        memory_add:true, memory_forget:true, approval_act:true };
function _toolNeedsConsent(name){ return !!_TOOL_CONSENT[name]; }
/* How often a job runs, in the words a person uses. */
const _CREW_EVERY = { '10min':'every 10 minutes', '30min':'every 30 minutes',
                      hourly:'every hour', daily:'every day', weekly:'every week' };
async function _confirmModelTool(name, input){
  input = input || {};
  const what = ({
    deploy_site:'publish a public web page live on the internet',
    run_code:'run '+String(input.lang||'code')+' on your device',
    fix_code:'run and edit '+String(input.lang||'code')+' on your device',
    crew_add:'set up a job that runs on its own, on a schedule',
    crew_update:'change one of your background jobs',
    crew_resume:'start one of your background jobs running again',
    crew_remove:'permanently delete one of your background jobs',
    crew_standing:'change the instructions every background job follows',
    crew_ceiling:'change how far ALL of your background jobs may go without asking you',
    memory_add:'remember something about you permanently',
    memory_forget:'permanently forget something it knows about you',
    approval_act:(input.action === 'reject' ? 'discard a piece of finished work' : 'APPROVE and send a piece of finished work')
  })[name] || ('run the "'+name+'" action');
  let detail='';
  if(name==='deploy_site') detail='Page title: '+String(input.title||'App');
  else if(name==='run_code'||name==='fix_code') detail=String(input.code||'').slice(0,600);
  /* For a job, the dialog IS the preview: the exact instruction it will follow
     and how often it will follow it. Nobody can consent to "a background job"
     in the abstract, and this is the last point before it starts costing
     money on a timer. */
  else if(name==='crew_add')
    detail = 'It will run ' + (_CREW_EVERY[String(input.repeat||'daily')] || 'every day') + ':\n\n'
           + String(input.detail||'').slice(0,600)
           + (String(input.approval||'require')==='auto'
               ? '\n\nResults go straight to you without review.'
               : '\n\nEach result waits for your approval before anything is sent.');
  else if(name==='crew_update')
    detail = [ input.detail ? 'New instruction:\n' + String(input.detail).slice(0,500) : '',
               input.repeat ? 'New frequency: ' + (_CREW_EVERY[String(input.repeat)]||input.repeat) : ''
             ].filter(Boolean).join('\n\n');
  else if(name==='memory_add')
    detail = 'It will be added to what AMV knows about you, and included in every future conversation:\n\n'
           + String(input.text||'').slice(0,500);
  else if(name==='approval_act')
    detail = input.action === 'reject'
      ? 'The waiting item will be discarded. This cannot be undone.'
      : 'Approving is what SENDS it. If it was prepared to be emailed, it goes out now.';
  else if(name==='crew_ceiling')
    detail = ({
      suggest:'From now on, no background job runs on its own. AMV will tell you when one is due and wait to be asked. Nothing is spent.',
      require:'From now on, background jobs do the work but nothing goes out until you approve it.',
      auto:'From now on, background jobs may complete and deliver their results without asking you each time.'
    })[String(input.ceiling||'')] || '';
  else if(name==='crew_standing')
    detail = String(input.standing||'').trim()
      ? 'Every background job will follow this from now on:\n\n' + String(input.standing).slice(0,600)
      : 'Your standing instructions will be cleared, and jobs go back to running the standard way.';
  const ok = await _showModalAsync({
    title:'Allow the assistant to '+what+'?',
    body:'The assistant wants to '+what+' while answering you. This can be triggered by content it read, so allow it only if you actually want this to happen.'+(detail?'\n\n'+detail:''),
    okText:'Allow once', cancelText:'Deny'
  });
  return ok===true;
}
async function _amvRunTool(name, input, onStatus){
  try{
    if(name==='generate_image'){
      /* The same content policy the Images tab enforces. The prompt here was
         written by the MODEL, which may have been steered by a page it read, so
         this is the door most in need of the check rather than least. Quota is
         not re-counted: /v1/image/generate reserves against the plan atomically
         and is the authority on it. */
      if(_imagePolicyBlocked(input.prompt))
        return { text:'Refused: '+IMG_POLICY_REFUSAL+' Tell the user plainly that AMV will not generate this.', render:null };
      onStatus && onStatus('Generating your image\u2026');
      const src = await _premiumImageSrc(input.prompt, input.style||'', input.ratio||'1:1', Math.floor(Math.random()*1e6));
      if(!src) return { text:'Image generation needs the AMV engine connected. Tell the user to enable it in Settings.', render:null };
      return {
        text:'Image generated successfully and shown to the user.',
        render:'<img src="'+escH(safeMediaSrc(src))+'" alt="'+escH(input.prompt)+'" class="chat-img" loading="lazy">'
      };
    }

    if(name==='generate_video'){
      /* Video is a JOB, not a request - it takes a minute or two. The tool call
         waits for the real provider to finish and then hands back the real file.
         It never invents progress and never returns a video that isn't there. */
      if(_imagePolicyBlocked(input.prompt))
        return { text:'Refused: '+IMG_POLICY_REFUSAL+' Tell the user plainly that AMV will not generate this.', render:null };
      onStatus && onStatus('Starting the video\u2026');
      try{
        const d = await _vidApi('/v1/video/generate', {
          prompt: input.prompt,
          seconds: Math.min(10, Math.max(1, parseInt(input.seconds)||5)),
          aspect: ['16:9','9:16','1:1'].includes(input.aspect) ? input.aspect : '16:9'
        });
        if(d.configured === false)
          return { text:'No video engine is connected to this workspace, so video cannot be generated. Tell the user plainly - do not pretend.', render:null };

        onStatus && onStatus('Generating your video\u2026 this takes a minute or two.');
        // poll until the provider is actually done
        for(let i=0;i<120;i++){
          await new Promise(r=>setTimeout(r, i<15 ? 2000 : 5000));
          let st;
          try{ st = await _vidApi('/v1/video/status', { id: d.id }); }
          catch(e){ continue; }
          if(st.status==='succeeded' && st.url){
            // also drop it into the Video tab so it isn't stranded in the chat
            try{
              S.vids.unshift({ id:'tool_'+d.id, p:input.prompt, dur:input.seconds||5,
                               aspect:input.aspect||'16:9', status:'succeeded', url:st.url, stage:'', error:'', jobId:d.id });
              if(S.tab==='video') renderVidGrid();
            }catch(e){}
            return {
              text:'The video was generated and is shown to the user.',
              render:'<video src="'+escH(safeMediaSrc(st.url))+'" class="chat-vid" controls playsinline preload="metadata"></video>'
            };
          }
          if(st.status==='failed')
            return { text:'The video failed to generate: '+(st.error||'unknown error')+'. Tell the user honestly.', render:null };
        }
        return { text:'The video is taking unusually long. Tell the user it is still processing.', render:null };
      }catch(e){
        if(e.message==='__NOT_CONNECTED__')
          return { text:'AMV is not connected to its engine, so video cannot be generated. Say so plainly.', render:null };
        if(e.code==='plan_required')
          return { text:'Video is not included in this user\u2019s plan. Tell them they need to upgrade.', render:null };
        if(e.code==='video_quota')
          return { text:'The user has used all the video in their plan this month. Tell them.', render:null };
        return { text:'Video generation failed: '+e.message, render:null };
      }
    }

    if(name==='run_code'){
      onStatus && onStatus('Running the code\u2026');
      const r = await runCode(input.code, input.lang);
      if(r.html){
        return {
          text:'The HTML rendered successfully. A live preview is shown to the user.',
          render:'<iframe sandbox="allow-scripts" class="chat-live" srcdoc="'+escH(r.html)+'"></iframe>'
        };
      }
      const out = (r.ok ? (r.stdout || '(no output)') : (r.stderr || 'failed'));
      return {
        text:(r.ok?'Ran successfully in '+r.ms+'ms.\nOutput:\n':'Execution FAILED.\nError:\n')+out.slice(0,4000),
        render:'<div class="chat-run'+(r.ok?'':' bad')+'"><div class="chat-run-h">'+(r.ok?'Ran successfully':'Error')+'</div><pre>'+escH(out.slice(0,4000))+'</pre></div>'
      };
    }

    if(name==='fix_code'){
      onStatus && onStatus('Running it, then fixing what breaks\u2026');
      const res = await autoDebug(input.code, input.lang, 3, (st)=>{
        onStatus && onStatus((st && (st.note||st.msg)) || 'Debugging\u2026');
      }, _sectionModel('debug'));
      const fixed = res && res.code;
      return {
        text:(res && res.ok!==false) ? 'Fixed and now passing.\n\nWorking code:\n'+String(fixed||'').slice(0,6000)
                                     : 'Could not fully fix it. Last error: '+String((res&&res.stderr)||'unknown'),
        render:null
      };
    }

    if(name==='deploy_site'){
      onStatus && onStatus('Publishing it live\u2026');
      if(!(window.AMV_API && AMV_API.live && AMV_API.token))
        return { text:'Publishing needs the AMV engine connected. Tell the user to enable it in Settings.', render:null };
      let html = String(input.html||'').replace(/^```[a-z]*\n?/i,'').replace(/```\s*$/,'').trim();
      if(!html) return { text:'Nothing to publish - no HTML was given.', render:null };
      if(!/<html|<!doctype/i.test(html)) html = '<!DOCTYPE html><html><body>'+html+'</body></html>';
      try{
        const d = await _deployApi('/deploy', { html, title: input.title || 'App' });
        return {
          text:'Published successfully. It is LIVE at: '+d.url+' - give the user this exact URL.',
          render:'<div class="chat-deployed"><span class="deploy-dot"></span><div><b>Live now</b>'+
                 '<a href="'+escH(safeUrl(d.url))+'" target="_blank" rel="noopener noreferrer">'+escH(d.url)+'</a></div></div>'
        };
      }catch(e){ return { text:'Deploy failed: '+(e.message||e), render:null }; }
    }

    if(name==='build_app'){
      onStatus && onStatus('Building it\u2026');
      const sys = 'You build complete, self-contained, working web apps. Return ONE full HTML document with all CSS and JS inline. No explanation, no markdown fences - just the HTML. It must actually work when opened.';
      let html = await aiCompleteLong(input.spec, sys, {
        max_tokens:16000,
        model:_sectionModel('code'),
        onProgress:(p)=>onStatus && onStatus('Building\u2026 '+p.lines.toLocaleString()+' lines')
      });
      html = String(html||'').replace(/^```[a-z]*\n?/i,'').replace(/```\s*$/,'').trim();
      if(!/<html|<!doctype/i.test(html)) html = '<!DOCTYPE html><html><body>'+html+'</body></html>';
      // Register it as a real artifact so it gets the full side-panel treatment.
      let card='';
      try{
        const art=_artifactStore(html, 'html', true);
        card=_artifactCardHTML(art);
      }catch(e){
        card='<iframe sandbox="allow-scripts" class="chat-live" srcdoc="'+escH(html)+'"></iframe>';
      }
      return { text:'Built it. A live, working version is shown to the user - they can open, edit, and download it.', render:card };
    }

    if(name.slice(0,5) === 'crew_') return await _crewTool(name, input);
    if(name.slice(0,7) === 'memory_' || name.slice(0,8) === 'approval' || name === 'account_status')
      return await _sectionTool(name, input);
  }catch(e){
    return { text:'Tool "'+name+'" failed: '+(e.message||e), render:null };
  }
  return { text:'Unknown tool: '+name, render:null };
}

/* ══════════════════════════════════════════════════════════════
   THE CREW, RUN FROM CHAT

   Every one of these goes through the same /auto/* routes the Crew screen
   uses, so there is exactly one idea of what a background job is. A job
   created in a sentence is the same record as one created by the form: same
   list, same cron, same limits, same plan checks. Chat is a second door onto
   the feature, not a second copy of it.

   Three things the model is never allowed to do here, because each of them
   would be a plausible-looking disaster:

   - Guess which job it meant. "Remove the email one" with two email jobs
     returns both and refuses. Deleting the wrong background job is silent
     data loss the person only discovers when the thing they relied on has
     been gone for a week.
   - Claim something happened. Every failure comes back as an instruction to
     say so plainly, because the one behaviour worse than not creating the
     job is telling somebody it is running when it is not.
   - Route around a limit. Plan ceilings, the free-tier shaping, the
     permission rules for unattended runs - all of those live on the server
     and are enforced identically no matter which door the request came in.
   ══════════════════════════════════════════════════════════════ */
const _CREW_REPEATS = ['10min','30min','hourly','daily','weekly'];

/* Find the ONE job being talked about, or explain why that is not possible.
   Returns { item } or { error } - never a best guess. */
async function _crewFind(input){
  let items = [];
  try{ const d = await _autoApi('/auto/list', {}); items = d.items || []; }
  catch(e){ return { error: _crewErr(e) }; }

  const id = String((input && input.id) || '').trim();
  if(id){
    const byId = items.find(x => x.id === id);
    if(byId) return { item: byId, items };
    /* An id that is not on the list means the model invented it or the job is
       already gone. Both are worth saying rather than falling through to a
       fuzzy match that could hit something else entirely. */
    return { error:'There is no background job with that id. Call crew_list to see the real ones, and tell the user if the job they meant is not there.' };
  }

  const q = String((input && input.match) || '').trim().toLowerCase();
  if(!q) return { error:'Which job? Call crew_list, then pass the id of the one they mean.' };
  const words = q.split(/\s+/).filter(w => w.length > 2);
  const hits = items.filter(x => {
    const hay = String(x.detail || '').toLowerCase();
    return hay.includes(q) || (words.length > 0 && words.every(w => hay.includes(w)));
  });
  if(hits.length === 1) return { item: hits[0], items };
  if(hits.length === 0)
    return { error: items.length
      ? 'No background job matches that. The ones that exist are: '
        + items.map(x => x.id + ' - ' + String(x.detail||'').slice(0,70)).join(' | ')
        + '. Ask the user which they meant, or tell them it does not exist.'
      : 'They have no background jobs at all, so there is nothing to change. Say so.' };
  return { error:'That matches ' + hits.length + ' jobs, so it is not clear which one they mean: '
                 + hits.map(x => x.id + ' - ' + String(x.detail||'').slice(0,70)).join(' | ')
                 + '. Ask the user which one before doing anything.' };
}

/* A failure the model can repeat to the person truthfully, including the one
   thing they can do about it. */
function _crewErr(e){
  const msg = (e && e.message) || 'the server did not accept it';
  if(msg === 'not-connected')
    return 'AMV is not connected to its engine, so background jobs cannot be reached at all. Tell the user to connect it in Settings. Do NOT say the job was created.';
  if(e && (e.code === 'plan_required' || e.code === 'plan_limit') || /paid plan/i.test(msg))
    return 'This account\'s plan cannot run that: ' + msg + '. Tell the user exactly this and that upgrading lifts it. Do NOT say the job was created.';
  return 'That did not work: ' + msg + '. Tell the user plainly - do NOT say it worked.';
}

/* One line per job, in the terms the person thinks in. */
function _crewLine(x){
  const every = _CREW_EVERY[String(x.repeat||'')] || 'on a schedule';
  return '- [' + x.id + '] ' + (x.active === false ? 'PAUSED' : 'running ' + every)
       + ({ auto:', results delivered automatically',
            suggest:', suggest only - it does not run until asked',
            require:', each result waits for approval' }[String(x.approval||'require')] || '')
       + ': ' + String(x.detail || '').slice(0, 220);
}

/* Repaint whatever is on screen, so a job created in chat is visible in Crew
   the moment they look - rather than next time something happens to refresh. */
function _crewSynced(){
  try{ if(typeof _autoRefresh === 'function') _autoRefresh(); }catch(e){}
  try{ if(S.tab === 'crew' && typeof renderCrewView === 'function') renderCrewView(); }catch(e){}
  try{ if(S.tab === 'tasks' && typeof renderTasksView === 'function') renderTasksView(); }catch(e){}
}

async function _crewTool(name, input){
  input = input || {};

  if(name === 'crew_list'){
    let d;
    try{ d = await _autoApi('/auto/list', {}); }
    catch(e){ return { text: _crewErr(e), render:null }; }
    const items = d.items || [];
    const standing = String(d.standing || '').trim();
    const head = items.length
      ? 'Their background jobs (' + items.length + (typeof d.maxAutomations === 'number' ? ' of ' + d.maxAutomations + ' allowed' : '') + '):\n'
        + items.map(_crewLine).join('\n')
      : 'They have no background jobs set up yet.'
        + (d.canSchedule === false ? ' Their plan cannot run them - say so if they ask for one.' : '');
    const cap = String(d.ceiling || 'auto');
    const capSay = { suggest:'Their account is set so NO background job runs on its own - each one waits to be asked. Any job above says what it is configured to do, but this is what actually happens.',
                     require:'Their account is set so nothing goes out without their approval, whatever an individual job says.',
                     auto:'' }[cap] || '';
    return { text: head + (standing
      ? '\n\nStanding instructions applying to all of them: ' + standing
      : '\n\nThey have no standing instructions set.')
      + (capSay ? '\n\n' + capSay : ''), render:null };
  }

  if(name === 'crew_add'){
    const detail = String(input.detail || '').trim();
    if(!detail) return { text:'A job needs to say what it does. Ask the user what they want it to do each time it runs.', render:null };
    const repeat = _CREW_REPEATS.includes(String(input.repeat)) ? String(input.repeat) : 'daily';
    const approval = ['suggest','require','auto'].includes(input.approval) ? input.approval : 'require';
    let d;
    try{
      d = await _autoApi('/auto/create', { detail, repeat, kind:'task', approval, notify:'app' });
    }catch(e){ return { text: _crewErr(e), render:null }; }
    _crewSynced();
    /* The server is allowed to give a free account something smaller than was
       asked for. Saying "done, every 10 minutes" when it made a weekly job is
       the exact lie this whole path is built to avoid, so the model is handed
       the shaping message and told to pass it on. */
    const made = d.item || {};
    const gotRepeat = String(made.repeat || repeat);
    const shaped = gotRepeat !== repeat || d.shaped;
    return { text:'Created. It is in their Crew tab now and runs '
      + (_CREW_EVERY[gotRepeat] || 'on a schedule') + ' on its own.'
      + ({ auto:' Results are delivered without review.',
           suggest:' It will NOT run on its own - AMV tells them it is due and waits to be asked, which costs nothing.',
           require:' Each result waits for their approval.' }[String(made.approval||'require')] || '')
      + (shaped ? ' IMPORTANT - tell the user this part: ' + (d.shapedWhy || 'their plan runs it ' + (_CREW_EVERY[gotRepeat]||'less often') + ' rather than what was asked for.') : ''),
      render:null };
  }

  if(name === 'crew_ceiling'){
    const lvl = String(input.ceiling||'');
    if(!['suggest','require','auto'].includes(lvl))
      return { text:'That is not one of the three levels. They are: suggest (nothing runs until asked), require (work is done, waits for approval), auto (delivers on its own). Ask the user which they meant.', render:null };
    let d;
    try{ d = await _autoCeiling(lvl); }
    catch(e){ return { text: _crewErr(e), render:null }; }
    _crewSynced();
    const n = typeof d.restrains === 'number' ? d.restrains : 0;
    const say = { suggest:'No background job will run on its own now. AMV tells them a job is due and waits to be asked, so nothing is spent either.',
                  require:'Background jobs will do the work but nothing goes out until they approve it.',
                  auto:'Background jobs may complete and deliver on their own again.' }[lvl];
    return { text: say
      + (n ? ' ' + n + ' of their jobs ' + (n===1?'is':'are') + ' set further than this and ' + (n===1?'is':'are')
           + ' now held back - the ' + (n===1?'job keeps its':'jobs keep their') + ' own setting, so raising this later restores it.' : '')
      + ' This is enforced by the server when each job runs, not by the app.', render:null };
  }

  if(name === 'crew_standing'){
    const text = String(input.standing == null ? '' : input.standing);
    let d;
    try{ d = await _autoStanding(text); }
    catch(e){ return { text: _crewErr(e), render:null }; }
    _crewSynced();
    const n = typeof d.appliesTo === 'number' ? d.appliesTo : 0;
    if(!String(d.standing || '').trim())
      return { text:'Cleared. Their background jobs go back to running the standard way.', render:null };
    return { text:'Saved, and it is real: the server puts this in front of every background run, so the next run of '
      + (n ? 'all ' + n + ' of their jobs' : 'anything they set up') + ' follows it. '
      + 'It changes how the work is done - it does not change what AMV is allowed to do, so do not tell them it grants any new permission.', render:null };
  }

  /* Everything below acts on one specific job. */
  const found = await _crewFind(input);
  if(found.error) return { text: found.error, render:null };
  const item = found.item;
  const what = String(item.detail || '').slice(0, 90);

  try{
    if(name === 'crew_pause'){
      if(item.active === false) return { text:'That job ("' + what + '") is already paused. Nothing to do - say so.', render:null };
      await _autoApi('/auto/update', { id:item.id, action:'pause' });
      _crewSynced();
      return { text:'Paused "' + what + '". It stays in their Crew tab and will not run until they resume it.', render:null };
    }
    if(name === 'crew_resume'){
      if(item.active !== false) return { text:'That job ("' + what + '") is already running. Nothing to do - say so.', render:null };
      await _autoApi('/auto/update', { id:item.id, action:'resume' });
      _crewSynced();
      return { text:'Resumed "' + what + '". Its next run is one full interval from now, not immediately.', render:null };
    }
    if(name === 'crew_remove'){
      await _autoApi('/auto/update', { id:item.id, action:'delete' });
      _crewSynced();
      return { text:'Deleted "' + what + '" and its history. It will not run again. If they only wanted it stopped for now, tell them it can be set up again.', render:null };
    }
    if(name === 'crew_update'){
      const patch = { id:item.id, action:'edit' };
      if(typeof input.detail === 'string' && input.detail.trim()) patch.detail = input.detail.trim();
      if(_CREW_REPEATS.includes(String(input.repeat))) patch.repeat = String(input.repeat);
      if(['suggest','require','auto'].includes(input.approval)) patch.approval = input.approval;
      if(!patch.detail && !patch.repeat && !patch.approval)
        return { text:'Nothing was actually changed - no new instruction, frequency or approval setting was given. Ask the user what they want changed.', render:null };
      await _autoApi('/auto/update', patch);
      _crewSynced();
      return { text:'Updated "' + what + '".'
        + (patch.detail ? ' It now does: ' + patch.detail.slice(0,120) + '.' : '')
        + (patch.repeat ? ' It now runs ' + (_CREW_EVERY[patch.repeat] || patch.repeat) + ', starting one interval from now.' : '')
        + (patch.approval ? ({ auto:' Results are now delivered without review.',
                              suggest:' It will no longer run on its own - AMV will say it is due and wait to be asked.',
                              require:' Each result now waits for their approval.' }[patch.approval] || '') : ''),
        render:null };
    }
  }catch(e){ return { text: _crewErr(e), render:null }; }

  return { text:'Unknown crew action: ' + name, render:null };
}


/* ══════════════════════════════════════════════════════════════
   THE REST OF THE PRODUCT, FROM CHAT

   Memory, the approvals queue, and what the account has actually used. Same
   discipline as the Crew tools: each one goes through what the section itself
   uses, so a fact has one home; nothing is guessed when it is ambiguous; and
   every failure comes back as an instruction to say so rather than as silence
   the model will paper over.

   The two that deserve more care than they look like they need:

   - A MEMORY IS APPENDED TO EVERY FUTURE REQUEST. Writing one is writing a
     small permanent instruction, which is the same shape of risk as the
     standing instruction and gets the same treatment: the person is shown the
     exact words and asked, and secrets are refused outright rather than stored
     in something designed to be repeated back.
   - APPROVING IS WHAT SENDS. The approvals queue exists because something
     stopped short of acting; approving is the act. So the dialog says that in
     those words, and the model is told to read the person the summary before
     it asks.
   ══════════════════════════════════════════════════════════════ */

/* _MEM_SECRET, _MEM_CARDISH and _memLooksSecret are defined in
   07-workspace-memory.js, beside the Memory tab that also uses them. They live
   in the EARLIER module on purpose: both doors into the memory store have to
   apply the same refusal, and a shared constant declared after one of its users
   is an ordering dependency waiting to be noticed the hard way. */
const _MEM_MAX = 400;

function _memList(){
  try{ return (typeof S!=='undefined' && Array.isArray(S.memory)) ? S.memory : []; }catch(e){ return []; }
}
function _memRepaint(){
  try{ if(typeof S!=='undefined' && S.tab==='memory' && typeof renderMemoryView==='function') renderMemoryView(); }catch(e){}
}
/* One memory, or an explanation - never a best guess, because forgetting the
   wrong thing is silent and they only discover it when AMV stops knowing
   something it should. */
function _memFind(input){
  const list = _memList();
  const id = String((input && input.id) || '').trim();
  if(id){
    const hit = list.find(m => m.id === id);
    if(hit) return { item: hit };
    return { error:'There is no memory with that id. Call memory_list for the real ones and tell the user if the thing they meant is not there.' };
  }
  const q = String((input && input.match) || '').trim().toLowerCase();
  if(!q) return { error:'Which memory? Call memory_list and pass the id of the one they mean.' };
  const words = q.split(/\s+/).filter(w => w.length > 2);
  const hits = list.filter(m => {
    const hay = String(m.text||'').toLowerCase();
    return hay.includes(q) || (words.length > 0 && words.every(w => hay.includes(w)));
  });
  if(hits.length === 1) return { item: hits[0] };
  if(hits.length === 0)
    return { error: list.length
      ? 'Nothing remembered matches that. What AMV remembers is: '
        + list.map(m => m.id + ' - ' + String(m.text||'').slice(0,70)).join(' | ')
        + '. Ask the user which they meant.'
      : 'AMV does not remember anything about them yet, so there is nothing to forget. Say so.' };
  return { error:'That matches ' + hits.length + ' memories, so it is not clear which: '
                 + hits.map(m => m.id + ' - ' + String(m.text||'').slice(0,70)).join(' | ')
                 + '. Ask the user which one before removing anything.' };
}

function _sectionErr(e){
  const msg = (e && e.message) || 'the server did not accept it';
  if(msg === 'not-connected' || /not-connected/.test(msg))
    return 'AMV is not connected to its engine, so that could not be done. Tell the user plainly and do NOT say it worked.';
  return 'That did not work: ' + msg + '. Tell the user plainly - do NOT say it worked.';
}

async function _sectionTool(name, input){
  input = input || {};

  /* ---- Memory ---- */
  if(name === 'memory_list'){
    const list = _memList();
    if(!list.length) return { text:'AMV does not remember anything about them yet.', render:null };
    return { text:'What AMV remembers about them (' + list.length + '):\n'
      + list.map(m => '- [' + m.id + '] ' + String(m.text||'').slice(0,200)).join('\n')
      + '\n\nAll of these are included in every conversation.', render:null };
  }

  if(name === 'memory_add'){
    const text = String(input.text||'').trim().slice(0, _MEM_MAX);
    if(text.length < 3) return { text:'That is not enough to remember. Ask the user what exactly they want AMV to know.', render:null };
    /* Refused rather than stored. A memory is replayed into every future
       request, which makes it the worst possible place for a credential -
       and the person asking has almost certainly not thought about that. */
    if(_memLooksSecret(text))
      return { text:'Refused: that looks like a password, key, card number or other secret. AMV includes every memory in every future conversation, so it will not store one. Tell the user plainly why, and offer to remember something that is not the secret itself.', render:null };
    if(_memList().some(m => String(m.text||'').trim().toLowerCase() === text.toLowerCase()))
      return { text:'AMV already remembers exactly that. Nothing to do - say so rather than confirming a second save.', render:null };
    try{
      S.memory = [{ id:'m'+Date.now()+Math.random().toString(36).slice(2,5), text, added: Date.now() }].concat(_memList());
    }catch(e){ return { text:_sectionErr(e), render:null }; }
    _memRepaint();
    return { text:'Remembered, and it is in the Memory tab where they can edit or delete it. From now on it is included in every conversation.', render:null };
  }

  if(name === 'memory_forget'){
    const found = _memFind(input);
    if(found.error) return { text: found.error, render:null };
    const what = String(found.item.text||'').slice(0,90);
    try{
      S.memory = _memList().filter(m => m.id !== found.item.id);
    }catch(e){ return { text:_sectionErr(e), render:null }; }
    _memRepaint();
    return { text:'Forgotten: "' + what + '". It will not be included in future conversations.', render:null };
  }

  /* ---- The approvals queue ---- */
  if(name === 'approvals_list'){
    let items = [];
    try{
      items = (window.AMV_API && AMV_API.live && typeof AMV_API.approvals==='function')
        ? await AMV_API.approvals()
        : (typeof _cwApprovals==='function' ? _cwApprovals() : []);
    }catch(e){ return { text:_sectionErr(e), render:null }; }
    if(!items.length) return { text:'Nothing is waiting for them. Say they are all caught up.', render:null };
    return { text:'Waiting for their approval (' + items.length + '):\n'
      + items.map(a => '- [' + a.id + '] ' + String(a.title||'Untitled').slice(0,120)
          + (a.actionType === 'send' ? ' - APPROVING THIS SENDS IT' : ' - review only')
          + (a.preview ? '\n    ' + String(a.preview).replace(/\s+/g,' ').slice(0,200) : '')).join('\n')
      + '\n\nNothing here has been sent. Read them the summary of the one they care about before doing anything with it.', render:null };
  }

  if(name === 'approval_act'){
    const id = String(input.id||'').trim();
    const action = input.action === 'reject' ? 'reject' : 'approve';
    if(!id) return { text:'Which one? Call approvals_list and pass the id.', render:null };
    let d;
    try{
      if(!(window.AMV_API && AMV_API.live && typeof AMV_API.actApproval==='function')) throw new Error('not-connected');
      d = await AMV_API.actApproval(id, action);
    }catch(e){ return { text:_sectionErr(e), render:null }; }
    try{ if(typeof S!=='undefined' && S.tab==='crew' && typeof renderCrewView==='function') renderCrewView(); }catch(e){}
    if(action === 'reject') return { text:'Rejected and discarded. It will not be sent.', render:null };
    /* The server says whether approving actually DELIVERED it. Reporting
       "sent" when there was no way to send is the exact failure the approve
       path was rebuilt to stop, so it is repeated honestly here. */
    if(d && d.delivered === false)
      return { text:'Approved - but it could NOT be delivered, because this deployment has no email provider connected. Tell the user it is approved and still undelivered, and that connecting email in Settings is what fixes it. Do not say it was sent.', render:null };
    if(d && d.delivered === true) return { text:'Approved and sent.', render:null };
    return { text:'Approved. It was a review-only item, so there was nothing to send - it is simply resolved.', render:null };
  }

  /* ---- What the account has actually used ---- */
  if(name === 'account_status'){
    const plan = (()=>{ try{ return loadStr('amv_plan') || 'free'; }catch(e){ return 'free'; } })();
    let usage = null;
    try{ usage = (typeof AMVUsage!=='undefined') ? AMVUsage.status() : null; }catch(e){}
    let auto = null;
    try{ auto = await _autoApi('/auto/list', {}); }catch(e){ /* background work is optional context */ }

    const lines = ['Plan: ' + plan + '.'];
    if(usage && typeof usage.remaining === 'number'){
      lines.push('Usage this period: ' + usage.used + ' of ' + usage.cap
        + ' (' + usage.remaining + ' left'
        + (usage.resetsInMs ? ', resets in about ' + Math.max(1, Math.round(usage.resetsInMs/3600000)) + 'h' : '') + ').');
    }
    if(auto){
      const items = auto.items || [];
      const spent = (auto.results||[]).reduce((t,r)=>t + (Number(r.costUSD)||0), 0);
      lines.push('Background jobs: ' + items.length
        + (typeof auto.maxAutomations === 'number' ? ' of ' + auto.maxAutomations + ' allowed' : '')
        + ', ' + items.filter(x=>x.active!==false).length + ' running.');
      lines.push('Spent on background work in the visible record: $' + spent.toFixed(2) + '.');
      if(auto.ceiling && auto.ceiling !== 'auto')
        lines.push('Their account holds background work at "' + auto.ceiling + '", so jobs set further are held back.');
    } else {
      lines.push('Background work could not be read, so do not state anything about their jobs.');
    }
    return { text: lines.join(' ') + ' These are the real numbers - never estimate them.', render:null };
  }

  return { text:'Unknown action: ' + name, render:null };
}
try{ window._sectionTool = _sectionTool; }catch(e){}

try{ window.AMV_TOOLS=AMV_TOOLS; window._amvRunTool=_amvRunTool; window._crewTool=_crewTool; window._sectionTool=_sectionTool; }catch(e){}

/* ══════════════════════════════════════════════════════════════
   CONTEXT WINDOW MANAGEMENT
   A conversation has a finite context. We track it, warn as it
   fills, and when it's full you start a new chat - but you can carry a
   COMPRESSED handoff across so nothing is lost and you pick up exactly where
   you left off.
   ══════════════════════════════════════════════════════════════ */
const CTX_LIMIT_TOKENS = 180000;      // usable context budget
const CTX_MAX_FILES    = 100;         // max files in a Dev project
const CTX_WARN_AT      = 0.75;        // show a nudge
const CTX_FULL_AT      = 0.92;        // must start a new chat

// ~4 chars per token is the standard rough estimate.
function _tok(str){ return Math.ceil(String(str||'').length / 4); }

// How much context the CURRENT chat is using.
function _ctxUsage(){
  let tokens = 0, files = 0;
  try{
    const msgs = (typeof getMsgs==='function') ? (getMsgs()||[]) : [];
    msgs.forEach(m=>{ tokens += _tok(m.c||m.text||''); });
    // memory + profile + skills ride along in every request
    tokens += _tok((S.memory||[]).join(' '));
    if(typeof _profileContext==='function') tokens += _tok(_profileContext());
    if(typeof _skillsContext==='function')  tokens += _tok(_skillsContext());
  }catch(e){}
  return { tokens, files, pct: Math.min(1, tokens / CTX_LIMIT_TOKENS) };
}

// How much context a Dev session is using (conversation + all project files).
function _ctxUsageDev(){
  let tokens = 0, files = 0;
  try{
    (_DEV.log||[]).forEach(m=>{ tokens += _tok(m.text||''); tokens += _tok(m.code||''); });
    const proj = _DEV.project || {};
    Object.keys(proj).forEach(p=>{ files++; tokens += _tok((proj[p]&&proj[p].content)||''); });
  }catch(e){}
  return { tokens, files, pct: Math.min(1, tokens / CTX_LIMIT_TOKENS) };
}

// Build a COMPRESSED handoff of the current chat/session. Small enough to paste,
// complete enough that a fresh chat continues seamlessly.
async function _ctxBuildHandoff(kind){
  kind = kind || 'chat';
  let convo = '', projectManifest = '', title = '';
  if(kind === 'dev'){
    title = 'Dev session';
    convo = (_DEV.log||[]).map(m=>(m.role==='user'?'User: ':'AMV: ')+(m.text||'')).join('\n');
    const proj = _DEV.project||{};
    const paths = Object.keys(proj);
    projectManifest = paths.length
      ? '\n\nPROJECT FILES ('+paths.length+'):\n'+paths.map(p=>'- '+p+' ('+((proj[p].content||'').split('\n').length)+' lines)').join('\n')
      : '';
  } else {
    const c = (S.convs||[]).find(c=>c.id===S.cid);
    title = (c && c.title) || 'Conversation';
    convo = ((typeof getMsgs==='function'?getMsgs():[])||[]).map(m=>(m.r==='u'?'User: ':'AMV: ')+(m.c||'')).join('\n');
  }
  // Ask the model to compress it. If that's unavailable, fall back to a trim.
  let summary = '';
  try{
    summary = await aiComplete(
      'Compress this conversation into a HANDOFF BRIEF so a fresh session can continue seamlessly. Include: the goal, every decision made, the current state, open problems, and exact next steps. Keep all specifics (names, numbers, file paths, choices). Be dense - no filler.\n\n' + convo.slice(-60000),
      'You write handoff briefs that let a new session resume work with zero loss of context.',
      { max_tokens: 3000, noLang: true }
    );
  }catch(e){
    summary = convo.slice(-8000);   // offline fallback: keep the tail
  }
  return {
    v: 1,
    kind,
    title,
    createdAt: Date.now(),
    summary,
    manifest: projectManifest,
    files: kind==='dev' ? Object.keys(_DEV.project||{}) : [],
    memory: (S.memory||[]).slice(0, 40),
  };
}

// Encode a handoff into a compact, pasteable token.
function _ctxEncode(h){
  try{
    const json = JSON.stringify(h);
    // compress: deflate -> base64 (falls back to plain base64 if unsupported)
    const bytes = new TextEncoder().encode(json);
    let bin=''; bytes.forEach(b=>bin+=String.fromCharCode(b));
    return 'AMVCTX1:' + btoa(bin);
  }catch(e){ return 'AMVCTX1:' + btoa(unescape(encodeURIComponent(JSON.stringify(h)))); }
}
function _ctxDecode(str){
  try{
    const s = String(str||'').trim().replace(/^AMVCTX1:/, '');
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  }catch(e){ return null; }
}
// Render the context meter + warnings into a host element.
function _ctxRenderMeter(hostId, kind){
  const host=$(hostId); if(!host) return;
  const u = kind==='dev' ? _ctxUsageDev() : _ctxUsage();
  const pct = Math.round(u.pct*100);
  if(u.pct < 0.5 && !(kind==='dev' && u.files>=CTX_MAX_FILES*0.8)){ host.innerHTML=''; return; }
  const state = u.pct>=CTX_FULL_AT ? 'full' : u.pct>=CTX_WARN_AT ? 'warn' : 'ok';
  const fileNote = (kind==='dev' && u.files) ? ' \u00b7 '+u.files+'/'+CTX_MAX_FILES+' files' : '';
  host.innerHTML =
    '<div class="ctx-meter ctx-'+state+'">'+
      '<div class="ctx-row">'+
        '<span class="ctx-l">Context '+pct+'% full'+fileNote+'</span>'+
        (state!=='ok' ? '<button class="ctx-btn" data-ctx-new="'+kind+'">Continue in a new '+(kind==='dev'?'session':'chat')+'</button>' : '')+
      '</div>'+
      '<div class="ctx-bar"><div class="ctx-fill" style="width:'+pct+'%"></div></div>'+
      (state==='full'
        ? '<div class="ctx-note">This '+(kind==='dev'?'session':'chat')+' is full. Start a new one - AMV will carry a compressed handoff across so it picks up exactly where you left off.</div>'
        : state==='warn'
        ? '<div class="ctx-note">Getting long. When you continue in a new '+(kind==='dev'?'session':'chat')+', everything is carried over.</div>'
        : '')+
    '</div>';
  host.querySelectorAll('[data-ctx-new]').forEach(b=>on(b,'click',()=>_ctxHandoffFlow(b.dataset.ctxNew)));
}

// Compress the current context, start fresh, and resume seamlessly.
async function _ctxHandoffFlow(kind){
  const r=$('ovr'); if(!r) return;
  r.innerHTML='<div class="ovr-bg"><div class="ovr-card" style="max-width:460px" onclick="event.stopPropagation()">'+
    '<div style="font-size:15px;font-weight:600;margin-bottom:6px">Carrying your context over\u2026</div>'+
    '<div style="font-size:13px;color:var(--mu);line-height:1.6" id="ctx-step">Compressing everything important from this '+(kind==='dev'?'session':'chat')+'\u2026</div>'+
    '<div class="ctx-bar" style="margin-top:14px"><div class="ctx-fill" id="ctx-anim" style="width:15%"></div></div>'+
  '</div></div>';
  r.classList.add('on');
  try{
    const h = await _ctxBuildHandoff(kind);
    const token = _ctxEncode(h);
    const st=$('ctx-step'); const an=$('ctx-anim');
    if(an) an.style.width='100%';
    if(st) st.textContent='Done. Starting fresh with your handoff loaded.';
    // Save the handoff so it can also be downloaded / pasted later.
    try{
      const all=load('amv_handoffs')||[];
      all.unshift({ id:'h'+Date.now(), kind, title:h.title, token, at:Date.now() });
      store('amv_handoffs', all.slice(0,20));
    }catch(e){}
    await new Promise(res=>setTimeout(res,550));
    closeOvr();
    _ctxResume(h, kind, token);
  }catch(e){
    closeOvr();
    toast('Could not build the handoff: '+e.message,'error',5000);
  }
}

// Start the new chat/session pre-loaded with the handoff.
function _ctxResume(h, kind, token){
  if(kind==='dev'){
    try{ _sessLeave('dev'); _sessNew('dev'); _resetToolState('dev'); }catch(e){}
    _DEV.handoff = h;                       // rides along in the next prompt
    setTab('dev');
    try{ _devPushSys('Picked up from your last session. I have the full handoff - goal, decisions, current state, and next steps. Tell me what to do next, or say "continue".'); _devRenderLog(); }catch(e){}
  } else {
    try{ newChat(); }catch(e){}
    S._chatHandoff = h;                     // rides along in the next prompt
    setTab('chat');
    try{
      const msgs=getMsgs();
      msgs.push({r:'a', c:'**Picked up where we left off.** I have a compressed handoff of the previous chat - the goal, every decision, the current state, and the next steps.\n\nTell me what you want next, or just say "continue".\n\n*You can download this handoff or reuse it later from Handoffs (\u2318K \u2192 "handoff").*', _t:Date.now()});
      renderChatMsgs(); saveConvs();
    }catch(e){}
  }
  toast('Context carried over - you can pick up right where you left off.','success',4500);
}

// Download a handoff as a .amvctx file.
function _ctxDownload(token, title){
  try{
    const blob=new Blob([token],{type:'text/plain'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download='amv-handoff-'+String(title||'session').toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40)+'.amvctx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
    toast('Handoff downloaded. Paste it into any new chat to pick up exactly where you left off.','success',5000);
  }catch(e){ toast('Could not download: '+e.message,'error',4000); }
}
try{ window._ctxDownload=_ctxDownload; }catch(e){}

// The handoff manager: download past handoffs, or paste one in to resume.
function openHandoffManager(){
  const r=$('ovr'); if(!r) return;
  const all=(()=>{ try{ return load('amv_handoffs')||[]; }catch(e){ return []; } })();
  const rows = all.length
    ? all.map(h=>'<div class="ho-row">'+
        '<div class="ho-row-l"><div class="ho-row-t">'+escH(h.title||'Session')+'</div>'+
          '<div class="ho-row-m">'+escH(h.kind==='dev'?'Dev session':'Chat')+' \u00b7 '+new Date(h.at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+'</div></div>'+
        '<div class="ho-row-r">'+
          '<button class="btn bs" data-ho-dl="'+escH(h.id)+'" style="font-size:11.5px">Download</button>'+
          '<button class="btn bp" data-ho-use="'+escH(h.id)+'" style="font-size:11.5px">Resume</button>'+
        '</div></div>').join('')
    : '<div class="ho-empty">No handoffs yet. When a chat or Dev session fills up, AMV creates one automatically.</div>';
  r.innerHTML='<div class="ovr-bg" id="ho-bg"><div class="ovr-card" style="max-width:560px" onclick="event.stopPropagation()">'+
    '<div style="font-size:16px;font-weight:600;margin-bottom:4px">Context handoffs</div>'+
    '<div style="font-size:12.5px;color:var(--mu);line-height:1.6;margin-bottom:16px">A handoff is a compressed snapshot of a conversation - the goal, every decision, the current state, and the next steps. Load one into a fresh chat and AMV picks up exactly where you left off.</div>'+
    '<div class="ho-list">'+rows+'</div>'+
    '<div class="ho-paste">'+
      '<label class="lbl">Paste a handoff</label>'+
      '<textarea id="ho-paste-in" rows="3" placeholder="Paste an AMVCTX1:\u2026 handoff here (or the contents of a .amvctx file)" style="width:100%;resize:vertical;font-family:var(--mn,monospace);font-size:11.5px"></textarea>'+
      '<div style="display:flex;gap:8px;margin-top:9px">'+
        '<button class="btn bs" id="ho-file-btn" style="font-size:12px">Load a .amvctx file</button>'+
        '<button class="btn bp" id="ho-paste-go" style="font-size:12px">Resume from this handoff</button>'+
      '</div>'+
      '<input type="file" id="ho-file" accept=".amvctx,.txt" style="display:none">'+
    '</div>'+
    '<div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn bs" id="ho-close" style="font-size:12px">Close</button></div>'+
  '</div></div>';
  r.classList.add('on');
  on($('ho-close'),'click',closeOvr);
  on($('ho-bg'),'click',closeOvr);
  r.querySelectorAll('[data-ho-dl]').forEach(b=>on(b,'click',()=>{
    const h=all.find(x=>x.id===b.dataset.hoDl); if(h) _ctxDownload(h.token, h.title);
  }));
  r.querySelectorAll('[data-ho-use]').forEach(b=>on(b,'click',()=>{
    const h=all.find(x=>x.id===b.dataset.hoUse); if(!h) return;
    const decoded=_ctxDecode(h.token);
    if(!decoded){ toast('That handoff is corrupted.','error',4000); return; }
    closeOvr(); _ctxResume(decoded, decoded.kind||'chat', h.token);
  }));
  // paste a handoff
  on($('ho-paste-go'),'click',()=>{
    const raw=($('ho-paste-in')?.value||'').trim();
    if(!raw){ toast('Paste a handoff first.','error',3000); return; }
    const decoded=_ctxDecode(raw);
    if(!decoded || !decoded.summary){ toast('That doesn\u2019t look like a valid AMV handoff.','error',4500); return; }
    closeOvr(); _ctxResume(decoded, decoded.kind||'chat', raw);
  });
  // load from a file
  on($('ho-file-btn'),'click',()=>$('ho-file')?.click());
  on($('ho-file'),'change',function(){
    const f=this.files&&this.files[0]; if(!f) return;
    const rd=new FileReader();
    rd.onload=(e)=>{ const t=$('ho-paste-in'); if(t) t.value=String(e.target.result||'').trim(); };
    rd.readAsText(f);
    this.value='';
  });
}
try{ window.openHandoffManager=openHandoffManager; }catch(e){}

// Inject the handoff into the next request so the model actually has it.
function _handoffContext(kind){
  try{
    const h = kind==='dev' ? _DEV.handoff : S._chatHandoff;
    if(!h) return '';
    return '\n\n[Handoff from the previous '+(kind==='dev'?'session':'chat')+' - continue seamlessly]\n'+
           (h.summary||'') + (h.manifest||'');
  }catch(e){ return ''; }
}
/* ONE file limit for the whole app. Every place a file can enter - chat,
   Dev, Lab, workspaces, marketplace listings - goes through this guard, so
   the cap is real everywhere and can't be dodged by using another surface. */
function _ctxFileCount(kind){
  try{
    if(kind==='dev')  return Object.keys(_DEV.project||{}).length;
    if(kind==='chat') return (S._chatFiles||[]).length;
    if(kind==='lab')  return (S._labFiles||[]).length;
    if(kind==='workspace'){ const w=(S.workspaces||[]).find(w=>w.id===S.wsId); return (w&&w.files||[]).length; }
    return 0;
  }catch(e){ return 0; }
}
// Returns true if it's OK to add `incoming` more files; otherwise warns and returns false.
function _ctxFileGuard(kind, incoming){
  try{
    const have = _ctxFileCount(kind);
    const n = incoming || 1;
    if(have + n > CTX_MAX_FILES){
      const room = Math.max(0, CTX_MAX_FILES - have);
      toast(
        'File limit reached - '+CTX_MAX_FILES+' files per '+(kind==='chat'?'conversation':'session')+'. '+
        (room ? 'You can add '+room+' more.' : 'Start a new '+(kind==='chat'?'chat':'session')+' and carry a handoff across to keep going.'),
        'error', 6500
      );
      return false;
    }
    return true;
  }catch(e){ return true; }
}
// Track a file against the current surface's count.
function _ctxFileTrack(kind, name){
  try{
    if(kind==='chat'){ S._chatFiles = S._chatFiles||[]; S._chatFiles.push(String(name||'file')); }
    else if(kind==='lab'){ S._labFiles = S._labFiles||[]; S._labFiles.push(String(name||'file')); }
  }catch(e){}
}
try{ window._ctxFileGuard=_ctxFileGuard; window._ctxFileCount=_ctxFileCount; window._ctxFileTrack=_ctxFileTrack; }catch(e){}

try{ window._ctxRenderMeter=_ctxRenderMeter; window._ctxHandoffFlow=_ctxHandoffFlow; window._handoffContext=_handoffContext; }catch(e){}

try{ window._ctxUsage=_ctxUsage; window._ctxUsageDev=_ctxUsageDev; window._ctxBuildHandoff=_ctxBuildHandoff;
     window._ctxEncode=_ctxEncode; window._ctxDecode=_ctxDecode; window.CTX_LIMIT_TOKENS=CTX_LIMIT_TOKENS;
     window.CTX_MAX_FILES=CTX_MAX_FILES; }catch(e){}

