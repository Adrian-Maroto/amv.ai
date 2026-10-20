/* DESIGN DNA - the editor. Fetched the first time somebody opens it (openDNA
   in 11a-design-dna.js), so nobody who never edits their style guide carries
   it. A classic script in the page's own scope: it reads and writes the same
   _DNA the page keeps, and the page's dnaPromptBlock reads what it saved. */
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
function _openDNANow(){
  const r=$('ovr'); if(!r) return;
  _DNA._sec=_DNA._sec||'colors';
  const seen=loadStr('amv_dna_intro')==='1';
  r.innerHTML=`<div class="dna-ov" id="dna-bg"><div class="dna-modal">
    <div class="dna-head">
      <div><h2>Design DNA</h2><p>Your reusable style guide. Set it once - every design AMV makes follows it.</p></div>
      <div style="display:flex;align-items:center;gap:4px">
        <button class="dna-x" id="dna-help" title="What is this?" style="font-size:var(--t-prose)">?</button>
        <button class="dna-x" id="dna-x" aria-label="Close">✕</button>
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
  onBackdrop($('dna-bg'),closeDNA);
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

function _sld(label,obj,key){ const v=obj[key]; return `<div class="dna-slider"><div class="dna-slider-h"><span>${label}</span><span>${v}</span></div><input type="range" min="0" max="100" value="${v}" data-sld="${key}" aria-label="${escH(label)}" aria-valuetext="${v}"></div>`; }
function _opt(key,current){ return (DNA_OPTS[key]||[]).map(o=>`<button class="dna-pill ${o===current?'on':''}" data-pill="${key}" data-val="${o}">${String(o).replace(/_/g,' ')}</button>`).join(''); }

function _dnaRenderSection(sec){
  const c=$('dna-content'); if(!c) return;
  if(sec==='identity'){
    c.innerHTML=`<div class="dna-sec-t">Identity</div><div class="dna-sec-d">What you're building and for whom. This frames every decision.</div>
      <div class="dna-field"><label>Project name</label><input aria-label="Project name" type="text" data-txt="projectName" value="${escH(_DNA.projectName)}" placeholder="e.g. Northwind Analytics"></div>
      <div class="dna-grid2">
        <div class="dna-field"><label>Project type</label><select aria-label="Project type" data-sel="projectType">${DNA_OPTS.projectType.map(o=>`<option ${o===_DNA.projectType?'selected':''}>${o}</option>`).join('')}</select></div>
        <div class="dna-field"><label>Industry</label><input aria-label="Industry" type="text" data-txt="industry" value="${escH(_DNA.industry)}" placeholder="Technology, Finance, Health…"></div>
      </div>
      <div class="dna-field"><label>Target audience</label><input aria-label="Target audience" type="text" data-txt="audience" value="${escH(_DNA.audience)}" placeholder="e.g. enterprise IT buyers, Gen-Z gamers"></div>`;
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
            <div class="dna-swatch-c" style="background:${c2.hex}"><input type="color" aria-label="${escH(c2.role.replace(/_/g," "))} colour" value="${/^#[0-9a-f]{6}$/i.test(c2.hex)?c2.hex:'#000000'}" data-cidx="${i}"></div>
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
        <div class="dna-field"><label>Heading font</label><select aria-label="Heading font" data-sel="headingFont">${DNA_OPTS.headingFont.map(o=>`<option ${o===_DNA.headingFont?'selected':''}>${o}</option>`).join('')}</select></div>
        <div class="dna-field"><label>Body font</label><select aria-label="Body font" data-sel="bodyFont">${DNA_OPTS.bodyFont.map(o=>`<option ${o===_DNA.bodyFont?'selected':''}>${o}</option>`).join('')}</select></div>
      </div>
      <div class="dna-grid2">
        <div class="dna-field"><label>Heading weight</label><select aria-label="Heading weight" data-sel="headingWeight">${['400','500','600','700','800'].map(o=>`<option ${o===_DNA.headingWeight?'selected':''}>${o}</option>`).join('')}</select></div>
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
        <div class="dna-field"><label>Max width</label><input aria-label="Max width" type="text" data-txt="maxWidth" value="${escH(_DNA.maxWidth)}" placeholder="1200px"></div>
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

try{ window._openDNANow = _openDNANow; window.resetDNA = resetDNA; }catch(e){}
