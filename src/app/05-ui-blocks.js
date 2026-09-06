/* ============================================================
   GENERATIVE UI BLOCKS (#4)
   The model can emit fenced blocks (stats/compare/steps/choices)
   that render as real interactive components instead of plain
   markdown. All values are HTML-escaped - safe by construction.
   ============================================================ */
// stats: a row of key-metric cards
function _guiStats(spec){
  const items=Array.isArray(spec.items)?spec.items:(Array.isArray(spec)?spec:[]);
  if(!items.length) return '';
  const cards=items.slice(0,6).map(it=>{
    const trend=it.trend?('<span class="gui-stat-trend '+((''+it.trend).trim().startsWith('-')?'down':'up')+'">'+escH(''+it.trend)+'</span>'):'';
    return '<div class="gui-stat"><div class="gui-stat-val">'+escH(''+(it.value??''))+trend+'</div><div class="gui-stat-label">'+escH(''+(it.label??''))+'</div></div>';
  }).join('');
  return '<div class="gui-stats">'+cards+'</div>';
}
// compare: side-by-side comparison table with a highlighted "best"/recommended column
function _guiCompare(spec){
  const cols=Array.isArray(spec.columns)?spec.columns:[];
  const rows=Array.isArray(spec.rows)?spec.rows:[];
  if(!cols.length||!rows.length) return '';
  const hi = Number.isInteger(spec.highlight)?spec.highlight:-1;
  const title=spec.title?'<div class="gui-cmp-title">'+escH(spec.title)+'</div>':'';
  let head='<div class="gui-cmp-row gui-cmp-head"><div class="gui-cmp-c gui-cmp-lbl"></div>'+
    cols.map((c,i)=>'<div class="gui-cmp-c'+(i===hi?' gui-cmp-hi':'')+'">'+escH(''+c)+(i===hi?'<span class="gui-cmp-badge">Best</span>':'')+'</div>').join('')+'</div>';
  let bodyRows=rows.map(r=>{
    const vals=Array.isArray(r.values)?r.values:[];
    return '<div class="gui-cmp-row"><div class="gui-cmp-c gui-cmp-lbl">'+escH(''+(r.label??''))+'</div>'+
      cols.map((_,i)=>{
        let v=vals[i]; let cls='';
        if(v===true||v==='true'||v==='yes'){ v='✓'; cls=' gui-cmp-yes'; }
        else if(v===false||v==='false'||v==='no'){ v='✕'; cls=' gui-cmp-no'; }
        return '<div class="gui-cmp-c'+(i===hi?' gui-cmp-hi':'')+cls+'">'+escH(''+(v??'-'))+'</div>';
      }).join('')+'</div>';
  }).join('');
  return '<div class="gui-cmp">'+title+'<div class="gui-cmp-grid" style="--cmp-cols:'+cols.length+'">'+head+bodyRows+'</div></div>';
}
// steps: a vertical numbered process/timeline
function _guiSteps(spec){
  const steps=Array.isArray(spec.steps)?spec.steps:(Array.isArray(spec)?spec:[]);
  if(!steps.length) return '';
  const title=spec.title?'<div class="gui-steps-title">'+escH(spec.title)+'</div>':'';
  const items=steps.map((s,i)=>{
    const st=typeof s==='string'?{title:s}:s;
    return '<div class="gui-step"><div class="gui-step-num">'+(i+1)+'</div><div class="gui-step-body">'+
      '<div class="gui-step-title">'+escH(''+(st.title??''))+'</div>'+
      (st.detail?'<div class="gui-step-detail">'+escH(''+st.detail)+'</div>':'')+'</div></div>';
  }).join('');
  return '<div class="gui-steps">'+title+items+'</div>';
}
// choices: tappable option chips that send the picked option as a follow-up
function _guiChoices(spec){
  const opts=Array.isArray(spec.options)?spec.options:(Array.isArray(spec)?spec:[]);
  if(!opts.length) return '';
  const prompt=spec.prompt?'<div class="gui-choices-prompt">'+escH(spec.prompt)+'</div>':'';
  const chips=opts.slice(0,8).map(o=>{
    const label=typeof o==='string'?o:(o.label||o.value||'');
    const send=typeof o==='string'?o:(o.send||o.value||o.label||'');
    return '<button class="gui-choice" data-guichoice="'+escH(''+send)+'">'+escH(''+label)+'</button>';
  }).join('');
  return '<div class="gui-choices">'+prompt+'<div class="gui-choices-row">'+chips+'</div></div>';
}

function renderChartSVG(spec){
  const type=(spec.type||'bar').toLowerCase();
  const all=Array.isArray(spec.data)?spec.data:[];
  /* A point whose value is not a number produces NaN coordinates, and an SVG
     element with NaN geometry simply does not draw. The chart then showed four
     of five bars with nothing to say one was missing - a picture of the data
     that is quietly wrong, which is worse than refusing to draw it.

     Non-numeric points are dropped ON PURPOSE and counted, and the count is
     shown under the chart. */
  /* Not `isFinite(+v)`: `+null`, `+''` and `+false` are all 0, so a MISSING
     value was drawn as a real zero - a gap in the data shown as a measurement,
     which is the same lie this is meant to stop, pointing the other way. Only
     an actual number, or a string that is one, counts. */
  const _num = (v) => {
    if(v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    const n = +v;
    return isFinite(n) ? n : null;
  };
  const data=all.filter(d => d && _num(d.value) !== null);
  const dropped=all.length-data.length;
  if(!data.length) return '';
  const title=spec.title?'<div class="cht-title">'+escH(spec.title)+'</div>':'';
  const W=560, H=300, padL=46, padR=16, padT=16, padB=46;
  const vals=data.map(d=>+d.value);
  const max=Math.max(...vals, 0), min=Math.min(...vals, 0);
  const range=(max-min)||1;
  const iw=W-padL-padR, ih=H-padT-padB;
  const colors=['#5590ff','#5590ff','#4ade80','#e0b341','#ff4d4d','#5590ff','#ff7eb6'];
  const x0=padL, y0=H-padB;
  let svg='<svg viewBox="0 0 '+W+' '+H+'" class="cht-svg" xmlns="http://www.w3.org/2000/svg">';
  // gridlines + y labels
  for(let i=0;i<=4;i++){
    const yy=padT+ih*(i/4);
    const v=(max-(range*(i/4))).toFixed(range<10?1:0);
    svg+='<line x1="'+padL+'" y1="'+yy+'" x2="'+(W-padR)+'" y2="'+yy+'" stroke="rgba(255,255,255,.07)"/>';
    svg+='<text x="'+(padL-8)+'" y="'+(yy+4)+'" text-anchor="end" class="cht-ax">'+v+'</text>';
  }
  if(type==='line'){
    const step=data.length>1?iw/(data.length-1):0;
    let pts=data.map((d,i)=>{ const x=x0+step*i; const y=padT+ih*(1-((+d.value-min)/range)); return [x,y]; });
    let path=pts.map((pt,i)=>(i?'L':'M')+pt[0]+' '+pt[1]).join(' ');
    svg+='<path d="'+path+'" fill="none" stroke="#5590ff" stroke-width="2.5"/>';
    pts.forEach((pt,i)=>{ svg+='<circle cx="'+pt[0]+'" cy="'+pt[1]+'" r="3.5" fill="#5590ff"/>';
      svg+='<text x="'+pt[0]+'" y="'+(y0+18)+'" text-anchor="middle" class="cht-ax">'+escH((data[i].label||'')+'')+'</text>'; });
  } else {
    const n=data.length, gap=10, bw=(iw/n)-gap;
    data.forEach((d,i)=>{
      const h=ih*((+d.value-min)/range);
      const x=x0+i*(iw/n)+gap/2;
      const y=y0-h;
      const col=colors[i%colors.length];
      svg+='<rect x="'+x+'" y="'+y+'" width="'+Math.max(bw,2)+'" height="'+Math.max(h,0)+'" rx="4" fill="'+col+'"><title>'+escH((d.label||'')+': '+d.value)+'</title></rect>';
      svg+='<text x="'+(x+bw/2)+'" y="'+(y0+18)+'" text-anchor="middle" class="cht-ax">'+escH((d.label||'')+'')+'</text>';
      svg+='<text x="'+(x+bw/2)+'" y="'+(y-6)+'" text-anchor="middle" class="cht-val">'+escH(d.value+'')+'</text>';
    });
  }
  svg+='</svg>';
  const note=dropped?'<div class="cht-src">'+dropped+' point'+(dropped===1?'':'s')+
    ' could not be read as a number and '+(dropped===1?'is':'are')+' not shown.</div>':'';
  return '<div class="cht">'+title+svg+note+(spec.source?'<div class="cht-src">Source: '+escH(spec.source)+'</div>':'')+'</div>';
}

/* ============================================================
   INLINE ARTIFACTS (#3)
   Substantial AI output (code files, full HTML pages, documents) is
   captured as an "artifact" and shown in the chat as a compact card.
   Clicking the card opens a rich side panel with Preview/Code tabs,
   copy, download, and "Open in Dev". Small snippets stay inline.
   ============================================================ */
window._artifacts = window._artifacts || {};
let _artifactSeq = 0;
// Human title + friendly type label from the content.
function _artifactMeta(raw, lang, isHtml){
  let type, title, icon;
  if(isHtml){
    type='Web page'; icon='page';
    const m=raw.match(/<title[^>]*>([^<]+)<\/title>/i) || raw.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    title=m?m[1].trim().slice(0,48):'Web page';
  } else {
    const L=(lang||'').toLowerCase();
    const langName={js:'JavaScript',jsx:'React',ts:'TypeScript',tsx:'React',py:'Python',python:'Python',html:'HTML',css:'CSS',json:'JSON',sql:'SQL',sh:'Shell',bash:'Shell',go:'Go',rust:'Rust',rs:'Rust',java:'Java',cpp:'C++',c:'C',rb:'Ruby',php:'PHP',swift:'Swift',kt:'Kotlin'}[L]||(lang?lang.toUpperCase():'Code');
    type=langName+' file'; icon='code';
    // try to name it from a function/class/component/def
    const nm=raw.match(/(?:function|class|const|def|component)\s+([A-Za-z_$][\w$]*)/) || raw.match(/([A-Za-z_$][\w$]*)\s*=\s*\(/);
    title=nm?nm[1]:(langName+' snippet');
  }
  return { type, title, icon };
}
// Store an artifact, returning its record. Dedupes identical content within a
// render pass so re-renders don't multiply artifacts.
function _artifactStore(raw, lang, isHtml){
  window._artifacts = window._artifacts || {};
  // reuse an existing artifact with identical content (stable across re-renders)
  for(const k in window._artifacts){ if(window._artifacts[k].raw===raw) return window._artifacts[k]; }
  const id='art'+(++_artifactSeq)+Math.random().toString(36).slice(2,5);
  const meta=_artifactMeta(raw, lang, isHtml);
  const lines=raw.split('\n').length;
  const rec={ id, raw, lang:lang||'', isHtml:!!isHtml, ...meta, lines };
  window._artifacts[id]=rec;
  return rec;
}
// The compact card shown inline in the chat.
function _artifactCardHTML(art){
  const icon = art.isHtml
    ? '<path d="M3 9h18M3 9l0 10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9M3 9V5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v4"/><circle cx="6" cy="6.5" r=".6" fill="currentColor"/><circle cx="8.2" cy="6.5" r=".6" fill="currentColor"/>'
    : '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>';
  const sub = art.isHtml ? (art.type) : (art.type+' · '+art.lines+' lines');
  return '<button class="art-card" data-artopen="'+art.id+'">'+
      '<span class="art-card-ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+icon+'</svg></span>'+
      '<span class="art-card-txt"><span class="art-card-title">'+escH(art.title)+'</span><span class="art-card-sub">'+escH(sub)+'</span></span>'+
      '<span class="art-card-open"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M8 7h9v9"/></svg></span>'+
    '</button>';
}

// ── Artifact side panel ───────────────────────────────────────
// Opens a slide-in panel on the right showing the artifact with Preview/Code
// tabs (Preview only for HTML), plus copy, download, and Open in Dev.
let _artifactPanelOpen=false, _artifactActiveTab='code';
/* The blob URL currently behind the preview frame. Each render made a new one
   and none were ever released, so every tab switch and every reopen left
   another full HTML document pinned in memory for the life of the page. Held so
   the PREVIOUS one can be released - never the current one, which the frame is
   still displaying. */
let _artFrameUrl='';
function _artReleaseFrameUrl(){
  if(!_artFrameUrl) return;
  try{ URL.revokeObjectURL(_artFrameUrl); }catch(e){}
  _artFrameUrl='';
}
function openArtifact(id){
  const art=window._artifacts && window._artifacts[id];
  if(!art) return;
  let panel=document.getElementById('art-panel');
  if(!panel){
    panel=document.createElement('div');
    panel.id='art-panel';
    panel.className='art-panel';
    document.body.appendChild(panel);
  }
  _artifactActiveTab = art.isHtml ? 'preview' : 'code';
  _renderArtifactPanel(art);
  // allow layout to settle, then slide in + shift chat
  requestAnimationFrame(()=>{ panel.classList.add('on'); document.body.classList.add('art-open'); });
  _artifactPanelOpen=true;
}
let _artCloseSeq=0;
function closeArtifact(){
  const panel=document.getElementById('art-panel');
  /* The frame is leaving and its document has already loaded, so the URL can be
     released now. The markup stays until the slide-out finishes, or the panel
     would blank out mid-animation instead of sliding away with its content. */
  _artReleaseFrameUrl();
  if(panel) panel.classList.remove('on');
  document.body.classList.remove('art-open');
  _artifactPanelOpen=false;
  const seq=++_artCloseSeq;
  setTimeout(()=>{
    if(seq!==_artCloseSeq || _artifactPanelOpen) return;   // reopened while it was sliding out
    const p=document.getElementById('art-panel');
    if(p) p.innerHTML='';
  }, 400);   // the .34s transform transition, plus a margin
}
function _renderArtifactPanel(art){
  const panel=document.getElementById('art-panel'); if(!panel) return;
  const tabs = art.isHtml
    ? '<button class="art-tab'+(_artifactActiveTab==='preview'?' on':'')+'" data-arttab="preview">Preview</button>'+
      '<button class="art-tab'+(_artifactActiveTab==='code'?' on':'')+'" data-arttab="code">Code</button>'
    : '';
  let body;
  if(art.isHtml && _artifactActiveTab==='preview'){
    /* THE PANEL THAT IS SUPPOSED TO SHOW THE PRODUCT, SHOWING NOTHING.

       This built the preview from a blob: URL, and a blob: document inherits
       the embedding page's Content-Security-Policy exactly as srcdoc does -
       measured, both refused identically. AMV pins script-src to hashes, so
       every script in every artifact was refused here. A page whose content is
       written by JavaScript - which is most of what "build me an app"
       produces - drew as nothing, and the only thing left to look at was the
       Code tab.

       That is the surface somebody actually uses to see what was built, and it
       was missed when the Build previews were converted: same defect, one
       screen over. It goes through the preview document now, like the rest.

       The frame is created empty and filled by _previewSend, which points it
       at a real URL whose own policy allows the page to run. */
    _artReleaseFrameUrl();          // nothing creates one here now, but a stale one must not outlive the panel
    body='<iframe class="art-frame" sandbox="allow-scripts"></iframe>';
  } else {
    _artReleaseFrameUrl();          // switching to the code tab drops the preview entirely
    body='<pre class="art-code"><code>'+escH(art.raw)+'</code></pre>';
  }
  panel.innerHTML=
    '<div class="art-head">'+
      '<div class="art-head-l">'+
        '<span class="art-head-ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+(art.isHtml?'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>':'<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>')+'</svg></span>'+
        '<div class="art-head-txt"><div class="art-head-title">'+escH(art.title)+'</div><div class="art-head-sub">'+escH(art.type+(art.isHtml?'':' · '+art.lines+' lines'))+'</div></div>'+
      '</div>'+
      '<button class="art-x" id="art-x" aria-label="Close">'+
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'+
      '</button>'+
    '</div>'+
    (tabs?'<div class="art-tabs">'+tabs+'</div>':'')+
    '<div class="art-body">'+body+'</div>'+
    '<div class="art-foot">'+
      '<button class="btn" id="art-copy">Copy</button>'+
      '<button class="btn" id="art-download">Download</button>'+
      '<button class="btn" id="art-share">Share</button>'+
      (art.isHtml||/^(js|javascript|jsx|ts|typescript|tsx|html|css|py|python|react)$/i.test(art.lang)?'<button class="btn bp" id="art-dev">Open in Dev</button>':'')+
    '</div>';
  /* Filled after the markup is in the document, because the frame has to exist
     before it can be handed a page. */
  if(art.isHtml && _artifactActiveTab==='preview'){
    try{ _previewSend(panel.querySelector('.art-frame'), art.raw); }catch(e){}
  }
  // wire controls
  panel.querySelector('#art-x')?.addEventListener('click', closeArtifact);
  panel.querySelectorAll('[data-arttab]').forEach(b=>b.addEventListener('click',()=>{ _artifactActiveTab=b.dataset.arttab; _renderArtifactPanel(art); }));
  panel.querySelector('#art-copy')?.addEventListener('click',()=>{ try{ navigator.clipboard.writeText(art.raw); toast('Copied','success',1500); }catch(e){} });
  panel.querySelector('#art-download')?.addEventListener('click',()=>_artifactDownload(art));
  panel.querySelector('#art-share')?.addEventListener('click',()=>_shareArtifact(art));
  panel.querySelector('#art-dev')?.addEventListener('click',()=>{
    try{
      _sessNew('dev');
      _DEV.log=[]; _DEV.project={}; _DEV.activePath='';
      const ext = art.isHtml?'html':({js:'js',javascript:'js',jsx:'jsx',ts:'ts',typescript:'ts',tsx:'tsx',py:'py',python:'py',css:'css',json:'json'}[art.lang.toLowerCase()]||'txt');
      const fname=(art.title.replace(/[^\w.-]+/g,'_')||'file')+'.'+ext;
      _devSetFile(fname, art.raw, art.lang);
      _DEV.activePath=fname;
      closeArtifact();
      setTab('dev');
      toast('Opened in Dev','info',2000);
    }catch(e){}
  });
}
// Share an artifact as a clean, branded page. The artifact is encoded into the
// link itself (no server storage), and opens a read-only branded view.
function _shareArtifact(art){
  const ovr=$('ovr'); if(!ovr) return;
  let link='';
  try{
    const payload={ k:'art', t:art.title||'AMV artifact', l:art.lang||'', h:!!art.isHtml, c:art.raw };
    const b64=btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    link=location.origin+location.pathname+'#art='+b64;
  }catch(e){ link=''; }
  const tooBig=link.length>18000;
  ovr.innerHTML=
    '<div class="share-modal">'+
      '<div class="share-title">Share this '+(art.isHtml?'page':'artifact')+'</div>'+
      '<p class="share-sub">Anyone with the link sees a clean, branded '+(art.isHtml?'live preview':'view')+'. It\u2019s encoded in the link - nothing is stored on a server.</p>'+
      (tooBig?'<div class="share-warn">This artifact is large, so the link is long and may not work in every app. Downloading the file may work better.</div>':'')+
      '<div class="share-link-row"><input id="art-share-link" class="inp" readonly value="'+escH(link)+'"><button class="btn bp" id="art-share-copy">Copy</button></div>'+
      '<div class="share-actions">'+
        '<button class="btn bs" id="art-share-native">Share via\u2026</button>'+
        '<button class="btn bs" id="art-share-open">Open preview</button>'+
        '<button class="btn bs" id="art-share-dl">Download file</button>'+
      '</div>'+
    '</div>';
  ovr.classList.add('on');
  on($('art-share-copy'),'click',()=>{ _copyText(link).then(()=>{ const b=$('art-share-copy'); if(b){b.textContent='Copied!';setTimeout(()=>b.textContent='Copy',1500);} }); });
  on($('art-share-native'),'click',()=>{ if(navigator.share){ navigator.share({title:art.title||'AMV artifact',url:link}).catch(()=>{}); } else { _copyText(link).then(()=>toast('Link copied','success')); } });
  on($('art-share-open'),'click',()=>{ try{ window.open(link,'_blank','noopener'); }catch(e){} });
  on($('art-share-dl'),'click',()=>{ closeOvr(); _artifactDownload(art); });
}
// Render a shared artifact as a branded read-only page (from #art=... in the URL).
function _checkSharedArtifact(){
  try{
    const m=(location.hash||'').match(/#art=(.+)$/);
    if(!m) return false;
    const data=JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    _renderSharedArtifact(data);
    return true;
  }catch(e){ return false; }
}
function _renderSharedArtifact(data){
  const isHtml=!!data.h;
  let bodyHTML;
  if(isHtml){
    /* Same defect as the artifact panel: a blob: document inherits this page's
       policy, so a shared artifact opened by its link ran none of its own
       script. Filled below, once the frame is in the document. */
    bodyHTML='<iframe class="shared-art-frame" sandbox="allow-scripts"></iframe>';
  } else {
    bodyHTML='<pre class="shared-art-code"><code>'+escH(data.c||'')+'</code></pre>';
  }
  document.body.innerHTML=
    '<div class="shared-view">'+
      '<div class="shared-head"><div class="shared-brand">'+(typeof amvMark==='function'?amvMark(22):'')+'<span>AMV.AI</span></div>'+
        '<a class="btn bp" href="'+location.origin+location.pathname+'">Try AMV free \u2192</a></div>'+
      '<div class="shared-art-container">'+
        '<h1 class="shared-art-h1">'+escH(data.t||'Shared artifact')+'</h1>'+
        '<div class="shared-art-meta">'+escH(isHtml?'Web page':((data.l||'code').toUpperCase()+' \u00b7 shared from AMV.AI'))+'</div>'+
        '<div class="shared-art-body">'+bodyHTML+'</div>'+
        '<div class="shared-foot">Made with <b>AMV.AI</b> - the AI workforce that does the work. <a href="'+location.origin+location.pathname+'">Start free</a></div>'+
      '</div>'+
    '</div>';
  document.title=(data.t||'Shared artifact')+' - AMV.AI';
  /* The frame exists now, so it can be given the page. Through the preview
     document, or the shared artifact renders without its own script - which
     for anything built in JavaScript means an empty box with a title above
     it, shown to somebody who followed a link expecting to see the thing. */
  if(isHtml){ try{ _previewSend(document.querySelector('.shared-art-frame'), data.c||''); }catch(e){} }
}
try{ window._shareArtifact=_shareArtifact; }catch(e){}

function _artifactDownload(art){  try{
    const ext = art.isHtml?'html':({js:'js',javascript:'js',jsx:'jsx',ts:'ts',typescript:'ts',tsx:'tsx',py:'py',python:'py',css:'css',json:'json',sql:'sql'}[art.lang.toLowerCase()]||'txt');
    const fname=(art.title.replace(/[^\w.-]+/g,'_')||'artifact')+'.'+ext;
    const blob=new Blob([art.raw],{type:'text/plain'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=fname; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),2000);
    toast('Downloaded '+fname,'success',2000);
  }catch(e){}
}
try{ window.openArtifact=openArtifact; window.closeArtifact=closeArtifact; }catch(e){}

/* Escape a value for safe insertion into a double-quoted HTML attribute inside
   md(). md() has already entity-escaped < > & across the whole string, so here
   we only neutralize the attribute-delimiter characters that could otherwise
   terminate a href/src/alt value early and inject an inline event handler
   (onerror/onmouseover) - the DOM-XSS vector from the security audit (AMV-004). */
function _mdAttr(s){ return String(s==null?'':s).replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/`/g,'&#96;'); }
function md(text) {  if(!text) return '';
  let t = _noDash(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Full HTML pages become an artifact (opens in the side panel with a live
  // Preview + Code tabs), instead of a cramped inline iframe.
  t = t.replace(/```(?:html)?\n?(&lt;!DOCTYPE html&gt;[\s\S]*?)```/gi, (match, code) => {
    const html=code.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
    if(typeof _artifactStore==='function'){
      const art=_artifactStore(html, 'html', true);
      return _artifactCardHTML(art);
    }
    return match;
  });

  // Chart blocks: ```chart {"type":"bar","title":"..","data":[{"label":"A","value":10}]}```
  t = t.replace(/```chart\n?([\s\S]*?)```/gi, (match, body) => {
    try{
      const raw=body.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').trim();
      const spec=JSON.parse(raw);
      return renderChartSVG(spec);
    }catch(e){ return match; }
  });

  // ── Generative UI blocks ──────────────────────────────────
  // Rendered as rich interactive blocks unless the user turned them off in
  // Settings → Capabilities (then they fall back to plain code blocks).
  if(typeof loadStr==='function' && loadStr('amv_cap_suggestions')!=='0'){
  // stats: {"items":[{"value":"$2.4M","label":"Revenue","trend":"+12%"}]}
  t = t.replace(/```stats\n?([\s\S]*?)```/gi, (match, body) => {
    try{ return _guiStats(JSON.parse(body.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').trim())); }catch(e){ return match; }
  });
  // compare: {"title":"..","columns":["A","B"],"rows":[{"label":"Price","values":["$9","$19"]}]}
  t = t.replace(/```compare\n?([\s\S]*?)```/gi, (match, body) => {
    try{ return _guiCompare(JSON.parse(body.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').trim())); }catch(e){ return match; }
  });
  // steps: {"title":"..","steps":[{"title":"..","detail":".."}]}
  t = t.replace(/```steps\n?([\s\S]*?)```/gi, (match, body) => {
    try{ return _guiSteps(JSON.parse(body.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').trim())); }catch(e){ return match; }
  });
  // choices: {"prompt":"Pick one","options":["A","B","C"]} - tappable, sends a follow-up
  t = t.replace(/```choices\n?([\s\S]*?)```/gi, (match, body) => {
    try{ return _guiChoices(JSON.parse(body.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').trim())); }catch(e){ return match; }
  });
  }

  // Code blocks. Substantial ones (long code, full HTML pages, documents)
  // become an ARTIFACT CARD that opens in the side panel; short snippets stay
  // inline so the conversation reads naturally.
  t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const raw=code.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
    const lines=raw.split('\n').length;
    const isFullHtml=/^\s*<(!doctype|html)[\s>]/i.test(raw);
    // Artifact-worthy: full HTML page, or a real code file (>=14 lines or >600
    // chars). Short snippets, one-liners, and shell commands stay inline.
    const worthy = isFullHtml || ((lines>=14 || raw.length>600) && lang && lang!=='text' && lang!=='');
    if(worthy && typeof _artifactStore==='function'){
      const art=_artifactStore(raw, lang, isFullHtml);
      return _artifactCardHTML(art);
    }
    const id='cc'+Math.random().toString(36).slice(2,8);
    const lb=lang?'<span>'+escH(lang.toUpperCase())+'</span>':'';
    window._codeBlocks=window._codeBlocks||{};
    window._codeBlocks[id]=raw;
    return '<pre><div class="chdr">'+lb+'<button class="ccopy" data-cid="'+id+'">Copy</button></div><code>'+code+'</code></pre>';
  });

  // Tables
  t = t.replace(/(\|.+\|\n)((?:[\s\S]*?\|.+\|(?:\n|$))+)/g, (match) => {
    const rows=match.trim().split('\n').filter(r=>r.trim()&&!r.match(/^\|[-: |]+\|$/));
    return '<table>'+rows.map((row,i)=>{
      const cells=row.split('|').filter((_,ci,a)=>ci>0&&ci<a.length-1);
      const tag=i===0?'th':'td';
      return '<tr>'+cells.map(c=>'<'+tag+'>'+c.trim()+'</'+tag+'>').join('')+'</tr>';
    }).join('')+'</table>';
  });

  t = t.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>');
  t = t.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  t = t.replace(/\*([^*\n]+?)\*/g,'<em>$1</em>');
  t = t.replace(/^#### (.+)$/gm,'<h4>$1</h4>');
  t = t.replace(/^### (.+)$/gm,'<h3>$1</h3>');
  t = t.replace(/^## (.+)$/gm,'<h2>$1</h2>');
  t = t.replace(/^# (.+)$/gm,'<h1>$1</h1>');
  t = t.replace(/^&gt; (.+)$/gm,'<blockquote>$1</blockquote>');
  t = t.replace(/^---+$/gm,'<hr>');
  /* A NUMBERED LIST CAME OUT WITH NO NUMBERS, AND NO LIST.

     These three lines used to run in this order: bullets to `<li>`, wrap the
     run in `<ul>`, THEN numbered items to `<li>`. The wrap had already
     happened, so an ordered list became bare `<li>` elements with no parent
     at all - measured, in the browser:

         md('1. one\n2. two')  ->  '<li>one</li><li>two</li>'

     A browser renders a parentless `<li>` as a plain block: no marker, no
     indent. So every numbered list the model wrote - steps, rankings, "do
     this then that" - arrived as flat lines that read as unrelated
     sentences. That is the most common shape in an answer, and the one where
     order carries the meaning.

     The second bug was underneath the first: `md` only ever emitted `<ul>`,
     so even correctly wrapped, a numbered list would have shown bullets.
     `.mb ul,.mb ol` has been styled the whole time - the CSS was ready and
     nothing ever produced the tag.

     Both kinds are converted BEFORE anything is wrapped, and an ordered item
     is marked as it is converted so the wrapper can tell the runs apart. The
     marker is safe because the text was HTML-escaped at the top of this
     function: a literal `<li` cannot come from what somebody typed.

     A run is ordered if its FIRST item is, which is how markdown behaves when
     the two are mixed without a blank line between them. */
  t = t.replace(/^[\-\*] (.+)$/gm,'<li>$1</li>');
  t = t.replace(/^\d+\. (.+)$/gm,'<li data-o>$1</li>');
  t = t.replace(/(?:<li(?: data-o)?>.*<\/li>\n?)+/g, m => {
    const ordered = m.slice(0, 11) === '<li data-o>';
    const items = m.replace(/<li data-o>/g, '<li>');
    return ordered ? '<ol>'+items+'</ol>' : '<ul>'+items+'</ul>';
  });
  t = t.replace(/`([^`\n]+)`/g,'<code>$1</code>');
  t = t.replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, (m,alt,url)=>'<img src="'+_mdAttr(url)+'" alt="'+_mdAttr(alt)+'" class="chat-img" loading="lazy">');
  // Link TEXT ($1) is intentionally left as already-rendered inline HTML (bold/
  // italic/code were applied above); only the href URL is attribute-escaped.
  t = t.replace(/\[(.+?)\]\((https?:\/\/[^)]+)\)/g, (m,txt,url)=>'<a href="'+_mdAttr(url)+'" target="_blank" rel="noopener noreferrer" style="color:var(--accent-txt)">'+txt+'</a>');
  t = t.replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>');
  // Newline->\<br\> is fine for prose, but it also injects stray breaks INSIDE
  // block elements (between list items, around headings, around code blocks),
  // which is invalid HTML and produces huge dead gaps. Strip those.
  t = t
    .replace(/(<\/li>)\s*(?:<br>\s*)+/g, '$1')
    .replace(/(<[uo]l>)\s*(?:<br>\s*)+/g, '$1')
    .replace(/(?:<br>\s*)+(<\/[uo]l>)/g, '$1')
    .replace(/(?:<br>\s*)+(<[uo]l>)/g, '<br>$1')
    .replace(/(<\/[uo]l>)\s*(?:<br>\s*)+/g, '$1')
    .replace(/(<\/h[1-6]>)\s*(?:<br>\s*)+/g, '$1')
    .replace(/(?:<br>\s*)+(<h[1-6]>)/g, '$1')
    .replace(/(<\/pre>)\s*(?:<br>\s*)+/g, '$1')
    .replace(/(?:<br>\s*)+(<pre)/g, '$1')
    .replace(/(<\/blockquote>)\s*(?:<br>\s*)+/g, '$1')
    .replace(/(<\/table>)\s*(?:<br>\s*)+/g, '$1')
    .replace(/(?:<br>\s*)+(<table)/g, '$1');
  return t;
}
function copyCode(id){
  const raw=window._codeBlocks?.[id];
  if(raw) navigator.clipboard?.writeText(raw).then(()=>toast('Code copied','success')).catch(()=>toast('Copy failed','error'));
}


/* ── Unified chat intent router ──────────────────────────────────
   Lets the user do ANYTHING from the main chat. Detects a confident
   intent and routes to the right capability (image, video, app/code,
   scheduled/background task, multi-step autonomous work). Returns true
   if it handled the message; false to fall through to normal chat.
   Conservative by design: ambiguous messages just chat normally. */
async function _routeChatIntent(txt){
  if(!txt) return false;
  const t=txt.toLowerCase();
  const pushUser=()=>{ const m=getMsgs(); m.push({r:'u',c:txt,d:txt}); const cv=getCurConv(); if(cv&&cv.title==='New Conversation') cv.title=txt.slice(0,44)+(txt.length>44?'\u2026':''); return m; };

  /* Image and video generation were branches 1 and 2 here. Both are gone:
     AMV is chat, Crew and Build now. A router that offered to make a picture
     and then had nowhere to send anybody would be worse than not offering. */

  // 1) APP / CODE / WEBSITE - build it in the Dev sandbox
  if(/\b(build|make|create|code|develop|write)\b[^.!?]{0,40}\b(app|application|website|web ?app|web ?site|landing page|game|tool|component|dashboard|calculator|clone|script|program|api|bot)\b/i.test(txt)){
    const m=pushUser();
    m.push({r:'a',c:'This is a build - taking you to **Dev**, where I\u2019ll write it, run it in a live sandbox, and show you the result and the code. You can keep iterating there in plain English.',model:S.model});
    setMsgs(m); renderChatMsgs(); renderHist();
    setTab('dev');
    try{ const dm=$('dev-msg'); if(dm){ dm.value=txt; if(typeof _devSend==='function') _devSend(); } }catch(e){}
    return true;
  }

  /* 4) SCHEDULED / RECURRING / BACKGROUND
     Deliberately NOT handled here any more - it falls through to the model,
     which has crew_add.

     This branch used to create a real recurring background job from a regex on
     the sentence, with the raw message as the instruction, and answer "Done -
     scheduled to run daily." Nobody was asked. A background job spends money
     unattended for as long as it exists, and the trigger was any sentence
     containing "every morning" - including a question. "Do I need to water
     these every day?" created a daily job, forever, and the only sign was one
     line in a conversation the person scrolled past.

     It was also the reason chat could not do what it now can. Matching here
     returns before the model is ever called, so the model never got the chance
     to use crew_add - and crew_add writes a proper instruction, asks first, and
     shows exactly what will run and how often before anything is created.

     Letting it through costs one model turn and replaces a guess with an
     answer. If the engine is not connected the person is told so honestly,
     which is the same thing the old branch could only pretend about. */

  // 2) MULTI-STEP / AGENTIC - "analyze X and email me", "research X and write a report and save it"
  const multiStep = /\b(and then|then|after that|,)\b/i.test(txt) &&
    /\b(email|send|save|download|write|create|analyz|research|summariz|compile|export|publish|post|schedule)\b/i.test(txt);
  const clearlyAgentic = /\b(analyze|research|compile|gather|organize|plan)\b[^.!?]{0,60}\b(and|then)\b[^.!?]{0,40}\b(email|send|save|report|summary|write|export)\b/i.test(txt);
  if((multiStep && txt.length>40) || clearlyAgentic){
    if(typeof runAutonomousTask==='function'){ await runAutonomousTask(txt); return true; }
  }

  return false; // nothing matched → normal chat
}
try{ window._routeChatIntent=_routeChatIntent; }catch(e){}

let _pendingMessage = '';
/* THE QUESTION SOMEBODY TYPED BEFORE THEY HAD AN ACCOUNT.

   Sending it after they sign in lived in two places - loginUser() for a return
   visit and the signup path for a new one - because signup does not go through
   loginUser. Both were four identical lines, which is a second definition
   waiting to drift: fix a bug in one and the other keeps it, and the half that
   keeps it is the NEW users, who are the only people this exists for.

   One definition. Both callers use it. */
function _sendPendingMessage(){
  if(!_pendingMessage) return;
  const pm = _pendingMessage;
  _pendingMessage = '';   // cleared FIRST, so it can never fire twice
  setTimeout(()=>{
    try{
      if(typeof setTab==='function') setTab('chat');
      const ta = document.getElementById('mta');
      if(ta){ ta.value = pm; ta.dispatchEvent(new Event('input')); }
      sendMsg();
    }catch(e){}
  }, 300);
}
try{ window._sendPendingMessage=_sendPendingMessage; }catch(e){}
/* How many times AMV will run tools and hand the results back to the model
   within one user message. Named so the limit and the sentence that explains
   hitting it cannot drift apart. */
const _TOOL_ROUND_MAX = 4;
let _toolRound = 0;
async function sendMsg(_opts) {
  _opts = _opts || {};
  const ta=$('mta');
  if(!ta) return;
  if(S.busy && !_opts._continueTools) return;
  const txt = _opts._continueTools ? '' : ta.value.trim();
  const att = _opts._continueTools ? null : S.att;
  // A tool-continuation has no new user text - it resumes with tool results.
  if(!_opts._continueTools && !txt && !att) return;
  // Sign-up gate: you can explore the app freely, but sending a message requires
  // an account. Preserve what they typed so it sends right after they sign up.
  if(!S.user || !S.user.email){
    _pendingMessage = txt;
    try{ openAuth('signup'); }catch(e){}
    if(typeof toast==='function') toast('Create a free account to start chatting','info',3500);
    return;
  }
  // Out-of-usage: the chat stops here - BEFORE any routing or
  // clearing, so nothing is consumed and the user's text stays in the box.
  try{
    if(quotaLocked()){ _renderQuotaNotice(); return; }
    if(typeof AMVUsage!=='undefined'){
      const _qst=AMVUsage.status();
      if(_qst.remaining<=0){
        quotaLock(_qst.resetsAt);
        const _qm=getMsgs();
        if(!_qm.some(m=>m._quota)){ _qm.push({r:'a',c:'',_quota:true,_resetAt:_qst.resetsAt}); setMsgs(_qm); renderChatMsgs(); }
        return;
      }
    }
  }catch(e){}
  /* Sent, so there is nothing left to recover. Cleared before the box is, so a
     failure between the two cannot leave a draft of a message that already
     went. */
  try{ clearTimeout(_draftTimer); }catch(e){}
  _draftClear();
  ta.value=''; ta.style.height='auto'; S.att=null;
  const ab2=$('ab2'); if(ab2) ab2.style.display='none';

  // ── Unified intent router: do ANYTHING from chat ──
  // Only routes on a confident match with no attachment; otherwise normal chat.
  if(!att){
    const routed=await _routeChatIntent(txt);
    if(routed) return;
  }

  let display=txt, apiContent=txt;
  if(att) {
    if(att.kind==='img') {
      const msgs2=getMsgs();
      msgs2.push({r:'u',c:[{type:'image',source:{type:'base64',media_type:att.mime,data:att.b64}},{type:'text',text:txt||'Analyze this image in detail.'}],d:(txt?txt+' ':'')+'[Image: '+att.name+']'});
      const cv=getCurConv(); if(cv&&cv.title==='New Conversation'&&txt) cv.title=txt.slice(0,44)+(txt.length>44?'…':'');
      setMsgs(msgs2); S.busy=true; renderChatMsgs(); renderHist();
      await _callAI(msgs2); return;
    } else if(att.kind==='pdf') {
      const msgs2=getMsgs();
      msgs2.push({r:'u',c:[{type:'document',source:{type:'base64',media_type:'application/pdf',data:att.b64}},{type:'text',text:txt||'Analyze this PDF thoroughly.'}],d:(txt?txt+' ':'')+'[PDF: '+att.name+']'});
      const cv=getCurConv(); if(cv&&cv.title==='New Conversation'&&txt) cv.title=txt.slice(0,44)+(txt.length>44?'…':'');
      setMsgs(msgs2); S.busy=true; renderChatMsgs(); renderHist();
      await _callAI(msgs2); return;
    } else {
      const max=20000, trunc=att.data.length>max;
      apiContent='[File: "'+att.name+'"\n```\n'+att.data.slice(0,max)+(trunc?'\n...[truncated]':'')+'"\n```\n\nUser: '+(txt||'Please analyze this file thoroughly.');
      display=(txt?txt+' ':'')+'['+att.name+']';
    }
  }

  const msgs=getMsgs();
  if(!_opts._continueTools) msgs.push({r:'u',c:apiContent,d:display});
  const cv=getCurConv();
  if(cv&&cv.title==='New Conversation'&&txt) cv.title=txt.slice(0,44)+(txt.length>44?'…':'');
  setMsgs(msgs); S.busy=true; renderChatMsgs(); renderHist();
  await _callAI(msgs, _opts);
}

/* Stop generating - lets the user halt a streaming response mid-way. Keeps
   whatever text arrived so far, cleanly, and never leaves the UI stuck busy. */
let _activeStreamCtrl=null, _userStopped=false;
function stopGenerating(){
  _userStopped=true;
  try{ if(_activeStreamCtrl) _activeStreamCtrl.abort('user-stop'); }catch(e){}
}
try{ window.stopGenerating=stopGenerating; }catch(e){}

/* Mark an Error whose message was written for a person to read, so nothing
   downstream tries to improve it. */
function _saidPlainly(err){ try{ err._saidPlainly = true; }catch(e){} return err; }

/* WHICH REFUSALS A PLAN ACTUALLY LIFTS, AND WHERE THAT IS DONE.

   Every refusal in chat rendered the same card: a warning triangle, the
   server's sentence, and a Retry button. For a provider hiccup that is exactly
   right. For a plan limit it is wrong twice - it invites somebody to hammer a
   decision that will not change, and the one thing it does not offer is the
   thing the sentence just told them about.

   The worst of them is `free_capacity`. The server says, honestly, "AMV is at
   capacity for free accounts today. Paid plans are running normally." and the
   only button offers to try the thing that will keep failing until tomorrow.

   `global_cap` is deliberately NOT in this table. When the day's ceiling is
   reached everybody is refused, paid included, so offering a plan there would
   be selling a way past a door that is shut for everyone. Retry is the honest
   answer to that one, and it keeps it. */
const REFUSAL_LIFTED_BY = {
  plan_required: 'plans', plan_limit: 'plans', job_limit: 'plans',
  quota_day: 'plans', quota_month: 'plans',
  free_capacity: 'plans', team_full: 'team',
};
function _refusalRoute(code){ return REFUSAL_LIFTED_BY[String(code || '')] || ''; }
/* "Is this a tier rather than a fault?" - asked of the table above rather than
   of a list of codes written out again at each call site. Three of those lists
   existed, all three named plan_required and plan_limit, and all three had
   missed `job_limit` - which is the one a PAYING account gets when it reaches
   its automation cap. So an Elite customer scheduling a twenty-sixth job was
   told "Could not schedule", in red, as though the product were broken.

   The prose fallback stays for callers whose errors predate the code being
   carried at all; it is a safety net, not the check. */
function _isPlanRefusal(e){
  try{ if(_refusalRoute(e && e.code)) return true; }catch(_){}
  return /paid plan/i.test((e && e.message) || '');
}
try{ window._isPlanRefusal = _isPlanRefusal; }catch(e){}
try{ window._refusalRoute = _refusalRoute; }catch(e){}

async function _callAI(msgs, _opts) {
  _opts = _opts || {};
  /* The tool budget resets here rather than in sendMsg, because Regenerate,
     Retry, and editing a message all call _callAI directly. Resetting only in
     sendMsg meant a turn that had spent its four rounds carried the spent
     counter into the next one, so regenerating it could not use tools at all. */
  if(!_opts._continueTools) _toolRound = 0;
  _userStopped=false; _activeStreamCtrl=null;
  try{
    if(!loadStr('amv_first_msg_sent')){ saveStr('amv_first_msg_sent','1'); AEGIS.log('first_message',{}); }
  }catch(e){}
  if(!_aiBackendReady()) {
    msgs.push({r:'a',c:'**AMV isn\u2019t connected yet.** The AMV engine needs to be switched on before I can respond. If you\u2019re the workspace owner, enable it in Settings; otherwise reach out to your administrator.'});
    setMsgs(msgs); S.busy=false; renderChatMsgs(); return;
  }
  // A tool-continuation is not a new user send - it must not trip the rate gate.
  const _gate = _opts._continueTools ? {ok:true} : AEGIS.check();
  if(!_gate.ok){
    AEGIS.log('ratelimit_block',{reason:_gate.reason});
    msgs.push({r:'a',c:'**Hold on.** '+_gate.reason});
    setMsgs(msgs); S.busy=false; renderChatMsgs();
    if(typeof toast==='function') toast(_gate.reason,'error',4000);
    return;
  }
  AEGIS.noteSend();
  // Out-of-usage: the chat stops. Show one quota card with a
  // live reset countdown, lock the composer, and never stack duplicates.
  try{
    if(quotaLocked()){ S.busy=false; _renderQuotaNotice(); return; }
    if(typeof AMVUsage!=='undefined'){
      const st=AMVUsage.status();
      if(st.remaining <= 0){
        S.busy=false;
        quotaLock(st.resetsAt);
        if(!msgs.some(m=>m._quota)){                     // one card only
          msgs.push({r:'a',c:'',_quota:true,_resetAt:st.resetsAt});
          setMsgs(msgs); renderChatMsgs();
        }
        return;
      }
    }
  }catch(e){}
  // RULE 7+8: route to the cheapest capable model when on Auto (saves ~5-20x on simple tasks)
  let _routeKey=S.model;
  if(S.model==='auto'){ _routeKey=_routeModel(msgs); }
  AEGIS.log('request',{model:(MODELS[_routeKey]||MODELS.core).model, msgCount:msgs.length, routed:S.model==='auto'});
  let _inTok=0,_outTok=0;
  // Record usage exactly once, no matter how the stream ends (success, error, or
  // user-stop). Prevents lost usage accounting when a stream is interrupted after
  // tokens were already consumed.
  let _usageRecorded=false;
  const _recordUsageOnce=()=>{
    if(_usageRecorded) return; _usageRecorded=true;
    if(!_inTok && !_outTok) return; // nothing consumed
    /* The same fallback the REQUEST uses, so what is billed matches what ran.
       Both used to fall back to smart, which is apex - so an unrecognised route
       both sent the dearest engine and then priced the turn at its rate. */
    try{ AEGIS.recordUsage((MODELS[_routeKey]||MODELS.core).model, _inTok, _outTok); }catch(e){}
    try{ AMVUsage.record((_inTok||0)+(_outTok||0)); }catch(e){}
  };
  const mdl=MODELS[_routeKey]||MODELS.core;
  const _mems=(loadStr('amv_cap_memory')!=='0')?_relevantMemories(msgs):[];
  const _agenticSys = '\n\nYOU CAN ACTUALLY DO THINGS - you are not limited to describing them. You have real tools:\n'+
    '\u2022 run_code - when code should be executed, tested, or verified, RUN it and report the real output. Use it to check your own work too.\n'+
    '\u2022 fix_code - when their code is broken, actually run it, fix it, and re-run until it passes.\n'+
    '\u2022 build_app - when they ask you to build/make/create something interactive (a page, a game, a dashboard, a tool), BUILD it and show them a live working version.\n'+
    /* The Crew is the one part of AMV that keeps working when the person is not
       here, so it is the part they most often want to change in passing -
       "actually make that weekly", "stop the news one". Without these the
       answer was a description of which tab to open, which is the product
       telling somebody to go and do it themselves. */
    '\u2022 crew_list / crew_add / crew_update / crew_pause / crew_resume / crew_remove - their BACKGROUND jobs, the ones that run on a schedule while they are away. Any question about what AMV is running for them is answered with crew_list, not from memory. Any request to start, change, stop or delete recurring work is done with these, not described. ALWAYS crew_list first so you act on a real job.\n'+
    '\u2022 crew_ceiling - how far ANY background job may go without them: suggest only (nothing runs until asked, nothing is spent), ask first (the work is done but nothing goes out until they approve), or let it run. It is a safety setting enforced on the server and it caps every job regardless of that job\u2019s own setting, including jobs created later. Use it for "never do anything without asking me".\n'+
    '\u2022 crew_standing - how they want ALL their background work done ("think harder", "always check two sources", "keep it short"). This genuinely reaches every future run.\n'+
    '\u2022 memory_list / memory_add / memory_forget - what AMV permanently knows about them. A memory is included in EVERY future conversation, so add one only for a durable fact they meant to persist, never for a detail of the task in hand and never for anything secret.\n'+
    '\u2022 approvals_list / approval_act - the finished work waiting for them. APPROVING IS WHAT SENDS IT. Read them what it will do before you ask.\n'+
    '\u2022 account_status - their real plan, usage and what background work has cost. Never estimate any of that from memory; look.\n'+
    'Never claim a background job was created, changed or removed unless the tool said so - if it failed, tell them exactly what failed. These jobs run unattended and cost money on a timer, so they are worth being precise about.\n'+
    'Prefer doing over explaining. Don\u2019t say "here is code you could run" - run it. Don\u2019t say "you could draft that" - draft it. After a tool runs, briefly tell them what you did and what they got.';
  /* "Keep this chat motivational" has to actually take, and has to say so.
     Set BEFORE the prompt is built, so it applies to the very turn that asked
     for it rather than only to the next one - which would look like it was
     ignored. */
  try{
    if(typeof _detectChatTone==='function'){
      /* The message as typed, not the lowercased copy made further down for
         routing - the tone is echoed back to the user and should read the way
         they wrote it. */
      const _said=(msgs.filter(m=>m.r==='u').slice(-1)[0]||{});
      const _tone=_detectChatTone(typeof _said.c==='string'?_said.c:(_said.d||''));
      if(_tone && typeof _setChatTone==='function' && _setChatTone(_tone)){
        toast('This chat will stay '+_tone+'. A new chat starts fresh.','success',4000);
      }
    }
  }catch(e){}
  const sysPrompt=(MODEL_SYSTEMS[_routeKey]||SYS)+_agenticSys+_profileContext()+_chatToneContext()+_skillsContext()+_pluginContext()+_localeContext()+_handoffContext('chat')+_langInstruction()+(_mems&&_mems.length?' Memory about you: '+_mems.join('; '):'')+_integrationStatusPrompt()+(_dnaShouldApply(msgs)?('\n\n'+dnaPromptBlock()+'\nApply this DESIGN DNA to any website, app, UI, HTML, or visual output you produce.'):'');

  // Add streaming placeholder message
  _streamBubbleReset();
  msgs.push({r:'a',c:'',streaming:true,model:S.model,_status:'Thinking…'});
  setMsgs(msgs); renderChatMsgs();
  const streamIdx=msgs.length-1;

  /* Whether this turn can actually search the web, decided BEFORE the status
     labels, because one of those labels claims it is happening.

     This used to read S.model - the model in the picker - and only the Apex
     entry matched. The default picker value is Auto, so the default
     configuration never searched at all, while still showing "Searching the
     web…" and "Reading sources…" to anybody who asked about today. A stale
     answer presented as a fresh one is the worst thing this product can do,
     and it was the out-of-the-box behaviour.

     It now reads the engine that actually RUNS the turn, so Auto behaves like
     whatever it picked, and search is offered on every tier the toggle in
     Settings promises it on - with the number of searches scaled to the tier,
     so a quick question on the cheap engine cannot spend like a research run.
     The searches themselves are metered into the spend ledger server-side and
     sit under the same per-plan dollar backstop as tokens. */
  /* One gate, not two. This used to be ANDed with `loadStr('amv_plugin_web')
     !== '0'`, and no screen in the product has ever written amv_plugin_web -
     so that half was permanently true and looked like a second control that
     somebody might go and switch. Settings -> Capabilities -> Web search is
     the switch, and it writes amv_cap_websearch. */
  const _webAllowed = (loadStr('amv_cap_websearch')!=='0');
  const _searchBudget = { fast:2, core:3, coding:5, smart:5 };
  const _researchBudget = { normal:5, deep:30, max:60 };
  /* Research mode is an explicit request for depth, so its budget comes from the
     tier the person chose rather than from whichever engine got routed. */
  const _webMaxUses = S._researchDepth ? (_researchBudget[S._researchDepth] || 5)
                                       : (_searchBudget[_routeKey] || 0);
  const _webSearchOn = _webAllowed && _webMaxUses > 0;

  // Working status: cycle contextual labels until the first token
  // arrives, so the user always sees what AMV is doing.
  const _lastUser=(msgs.filter(m=>m.r==='u').slice(-1)[0]||{});
  const _uTxt=(typeof _lastUser.c==='string'?_lastUser.c:(_lastUser.d||'')).toLowerCase();
  /* WHAT IT SAYS WHILE YOU WAIT.

     Longer runs than before, because these used to run out after three lines
     and then sit on the last one - a label that stops moving reads as a product
     that has stopped, which is the opposite of what a status is for.

     Every line still has to be TRUE. There is no "Searching the web" when
     search is off this turn, no "Writing code" on a turn that is not about
     code, and nothing claiming a step AMV is not taking. The variety is in how
     the same real work is described, not in inventing work. */
  const _statusPhases=(()=>{
    if(/\b(search|latest|news|current|today|who is|what is|find)\b/.test(_uTxt))
      return _webSearchOn
        ? ['Thinking…','Searching the web…','Reading sources…','Cross-checking what they say…','Pulling it together…','Writing…']
        : ['Thinking…','Working through it…','Getting it straight…','Writing…'];   // no search this turn, so do not say there is one
    if(/\b(code|build|function|app|bug|fix|script|debug)\b/.test(_uTxt))
      return ['Thinking…','Reading the problem…','Working out the approach…','Writing code…','Checking it over…'];
    if(/\b(analyz|summar|explain|compare|review)\b/.test(_uTxt))
      return ['Thinking…','Reading it through…','Working out the shape of it…','Organizing…','Writing…'];
    if(/\b(image|picture|photo|draw|generate)\b/.test(_uTxt))
      return ['Thinking…','Composing the image…','Rendering…'];
    if(/\b(plan|schedule|book|organi[sz]e|remind|every (morning|day|week))\b/.test(_uTxt))
      return ['Thinking…','Working out the steps…','Putting it in order…','Writing…'];
    if(/\b(recipe|cook|meal|dinner|ingredient)\b/.test(_uTxt))
      return ['Thinking…','Working through what you have…','Cooking something up…','Writing…'];
    return ['Thinking…','Working through it…','Getting it straight…','Writing…'];
  })();
  let _phaseIdx=0;
  const _statusTimer=setInterval(()=>{
    _phaseIdx++;
    if(_phaseIdx<_statusPhases.length && msgs[streamIdx] && msgs[streamIdx].streaming && !(msgs[streamIdx].c&&msgs[streamIdx].c.length)){
      msgs[streamIdx]={...msgs[streamIdx],_status:_statusPhases[_phaseIdx]};
      setMsgs(msgs); renderChatMsgs();
    }
  }, 1400);
  const _clearStatus=()=>{ try{ clearInterval(_statusTimer); }catch(e){} };

  try {
    // Web search, decided above from the engine that actually runs this turn.
    let tools=[];
    if(_webSearchOn) tools.push({ type:'web_search_20250305', name:'web_search', max_uses:_webMaxUses });
    // AMV's own tools - chat can actually DO the work, not just describe it.
    try{ if(Array.isArray(AMV_TOOLS)) tools = tools.concat(AMV_TOOLS); }catch(e){}
    /* THE MACHINE'S TOOLS, ONLY WHILE THERE IS A MACHINE.

       Offered when a bridge is connected and withheld when it is not. A tool
       that is always present and always fails teaches the model to stop
       trying it and teaches the person that AMV is broken; appearing with
       the thing it needs is the honest shape. */
    try{ if(BRIDGE.connected && Array.isArray(BRIDGE_TOOLS)) tools = tools.concat(BRIDGE_TOOLS); }catch(e){}
    /* And whatever connectors are running on that machine. Same rule, one
       level out: a tool appears when the thing behind it exists. */
    try{ if(BRIDGE.connected && typeof mcpTools === 'function') tools = tools.concat(mcpTools()); }catch(e){}
    if(!tools.length) tools = undefined;

    const _endpoint = _aiBase();        // backend-only; never the browser key
    /* An id for this turn. If the connection dies after the model has already
       produced the answer, the server has it parked under this id and we can
       fetch it back instead of paying to generate the whole thing again
       (AMV-070). */
    const _turnId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const _headers = Object.assign({}, _aiHeaders(), { 'X-AMV-Request-Id': _turnId });
    /* WHAT THE MODEL ACTUALLY GETS TO REMEMBER.

       This used to be `.slice(-20)`: twenty turns, whatever they weighed,
       and everything older gone with nothing said. Now the split is by
       tokens, and the turns that fall outside it are compressed into a
       brief that travels in the system prompt - so a long chat keeps going
       in place instead of being declared full. */
    const _conv = (typeof getCurConv === 'function') ? getCurConv() : null;
    const _ctx = _conv ? await _ctxPrepare(_conv, streamIdx) : { from: 0, brief: '' };
    const _payload = JSON.stringify({
        model:mdl.model,
        max_tokens:mdl.tokens,
        system:sysPrompt + (_ctx.brief || ''),
        stream:true,
        ...(tools?{tools}:{}),
        messages:(()=>{
          // Turn our internal messages into the wire format. Any turn where AMV
          // actually used a tool becomes: assistant[text + tool_use] -> user[tool_result].
          const out=[];
          msgs.slice(_ctx.from, streamIdx).forEach(m=>{
            if(m.r==='a' && m._toolContent && m._toolResults){
              out.push({ role:'assistant', content:m._toolContent });
              out.push({ role:'user', content:m._toolResults });
            } else {
              out.push({ role:m.r==='u'?'user':'assistant', content:m.c });
            }
          });
          // The conversation has to start with a user turn.
          while(out.length && out[0].role!=='user') out.shift();
          return out;
        })()
      });
    // offline guard
    if(typeof navigator!=='undefined' && navigator.onLine===false){
      throw _saidPlainly(new Error('You appear to be offline. Check your connection and retry.'));
    }
    // fetch with timeout + automatic retry on transient failures (429/5xx/network)
    let res, _attempt=0, _maxRetries=2;
    while(true){
      const _ctrl=new AbortController();
      _activeStreamCtrl=_ctrl;               // expose so the user can Stop
      const _to=setTimeout(()=>_ctrl.abort('timeout'), 45000); // 45s timeout
      try{
        res=await fetch(_endpoint,{method:'POST',headers:_headers,body:_payload,signal:_ctrl.signal});
        clearTimeout(_to);
        if(res.ok) break;
        /* READ THE BODY BEFORE DECIDING ANYTHING - including whether to retry.

           AMV's envelope is {error:"<a sentence written for a person>", code}.
           This read `err?.error?.message`, which is the shape of an upstream
           PROVIDER's error object, not AMV's. `error` is a string, so `.message`
           was undefined every single time and `raw` was always empty - so every
           refusal the backend had carefully worded came out of
           aegisErrorMessage as "The AI service had a temporary error (503)".

           The person shed for capacity was told AMV was broken instead of that
           free accounts are busy today and paid ones are not. The person who
           needed a higher plan was told to retry. Both are the exact moment the
           wording was written for, and neither ever saw it. */
        const err=await res.json().catch(()=>({}));
        const srvCode=String((err&&err.code)||'');
        const srvMsg=(typeof (err&&err.error)==='string' ? err.error : (err?.error?.message||''));
        /* A code means AMV itself decided this, in its own words. Anything else
           - an upstream provider's message, an empty body - still goes through
           the guesser below, which now at least receives the text. */
        const fromAMV=!!srvCode && !!srvMsg;

        // A quota 429 is NOT transient. If the server says we're out of usage,
        // stop the chat with the quota card + live countdown instead of
        // retrying or showing a generic error.
        if(res.status===429 && (srvCode==='quota_day'||srvCode==='quota_month'||srvCode==='family_cap')){
          /* AN HOUR WAS NOT A GUESS, IT WAS AN ANSWER, AND IT WAS WRONG.

             This read `err.resetAt || (Date.now()+3600000)`. Two of the four
             monthly refusals sent no resetAt at all, so somebody who had used
             their whole BILLING CYCLE was shown a live countdown saying their
             usage came back in 59 minutes - with the server's own sentence
             ("It resets next month") thrown away to make room for it. An hour
             later `quotaUnlock` fired a green toast saying "Your usage has
             reset - you're good to go", re-enabled the composer, and the next
             thing they sent was refused again.

             That is on the one screen where somebody decides whether to pay.

             So there is no fallback now. A reset time the server did not send
             is a reset time nobody knows, and the card says what it does know
             - the server's sentence - instead of a number it made up. */
          const resetAt = +err.resetAt || 0;
          quotaLock(resetAt, srvMsg);
          msgs[streamIdx]={r:'a',c:'',_quota:true,_resetAt:resetAt,
                           _quotaCode:srvCode,_quotaMsg:srvMsg};
          setMsgs(msgs); S.busy=false; renderChatMsgs();
          _recordUsageOnce();
          return;
        }
        if(_userStopped) break;          // Stop means stop, not "try again"
        /* A DECISION DOES NOT CHANGE IN 700ms.

           Retrying a refusal AMV meant makes the person wait through two more
           round trips before they are told the same thing - and each of those
           round trips reserves and refunds their allowance again on the server.
           Only the codes that really are a passing condition are retried.
           Anything else, INCLUDING a code added later, is answered at once:
           that default is the safe one, because the cost of not retrying a
           transient error is one manual retry, and the cost of retrying a
           settled one is silence followed by the wrong message. */
        const _transient=/^(provider_error|rate_limited|not_ready|acct_busy)$/;
        const _settled=fromAMV && !_transient.test(srvCode);
        if(!_settled && (res.status===429||res.status>=500) && _attempt<_maxRetries){
          _attempt++;
          const wait=Math.min(8000, 700*Math.pow(2,_attempt));
          msgs[streamIdx]={...msgs[streamIdx],c:'',streaming:true,_retrying:'Busy right now - retrying ('+_attempt+'/'+_maxRetries+')…'};
          setMsgs(msgs); renderChatMsgs();
          await new Promise(r=>setTimeout(r,wait));
          continue;
        }
        const raw=srvMsg;
        AEGIS.log('api_error',{status:res.status,raw:raw.slice(0,200)}); AEGIS.recordError();
        /* Already turned into a sentence for a human, from the REAL status.
           Tagged so the handler below does not run it through the guesser a
           second time - see the comment there. */
        /* The code travels with the sentence. Without it every refusal arrived
           at the renderer as prose, so the only way to tell a plan limit from a
           dropped connection was to match on wording - which is wrong the first
           time the wording changes, and was already wrong for the four codes
           nothing on the client had ever heard of. */
        const _refusal = _saidPlainly(new Error(fromAMV ? srvMsg : aegisErrorMessage(res.status, raw)));
        try{
          if(srvCode) _refusal.code = srvCode;
          if(err && err.minPlan) _refusal.minPlan = err.minPlan;
          _refusal.status = res.status;
        }catch(e){}
        throw _refusal;
      }catch(fe){
        clearTimeout(_to);
        /* The user pressing Stop aborts this same controller, so an AbortError
           is EITHER a timeout or a deliberate stop - and they were treated
           identically. Pressing Stop therefore showed "Taking a while -
           retrying" and issued the request again, up to the retry limit,
           spending tokens on answers nobody was waiting for. Checked first,
           because a Stop that does not stop is worse than no Stop button. */
        if(_userStopped || fe === 'user-stop' || String((fe && fe.message) || fe).includes('user-stop')) throw fe;
        // network drop / timeout → retry a couple times
        const transient = fe.name==='AbortError' || /network|failed to fetch|load failed/i.test(fe.message||'');
        if(transient && _attempt<_maxRetries){
          _attempt++;
          const wait=Math.min(8000, 700*Math.pow(2,_attempt));
          msgs[streamIdx]={...msgs[streamIdx],c:'',streaming:true,_retrying:(fe.name==='AbortError'?'Taking a while - retrying':'Connection hiccup - retrying')+' ('+_attempt+'/'+_maxRetries+')…'};
          setMsgs(msgs); renderChatMsgs();
          await new Promise(r=>setTimeout(r,wait));
          continue;
        }
        if(fe.name==='AbortError') throw _saidPlainly(new Error('The request timed out. The server may be busy - please retry.'));
        throw fe;
      }
    }

    /* When the model is AMV Auto the server decides which engine runs, and says
       which one in a response header. Show THAT, not "Auto" - a label that
       names no engine tells the user nothing about what answered them. */
    let _ranEngine='', _ranWhy='';
    try{
      _ranEngine=res.headers.get('X-AMV-Engine')||'';
      _ranWhy=res.headers.get('X-AMV-Engine-Why')||'';
    }catch(e){}

    // Read the SSE stream
    const reader=res.body.getReader();
    const decoder=new TextDecoder();
    let fullText='';
    let buffer='';

    const _toolBlocks={}; let _stopReason='';
    // Live research tracking - real searches and real sources, surfaced as they happen.
    const _research={ active:false, searches:0, sources:new Map(), done:false };

    /* AMV-062: a stream can stall without ever ending. The 45s timeout above
       covers getting the response; once it arrives, reader.read() has no
       deadline at all. If the connection dies mid-answer - phone leaving wifi,
       a proxy dropping an idle socket - the socket stays open, no bytes ever
       arrive, and read() never settles. AMV would sit there with a blinking
       cursor forever, and whatever it had already written would be stuck in a
       message that is still "streaming".
       So: if nothing arrives for IDLE_MS, stop waiting. Anything already
       written is KEPT and marked as cut off with a Retry, because a partial
       answer the user can read beats a spinner or an empty error card. */
    // window.__amvStreamIdleMs exists so the stall path can be exercised in a
    // test without a 30-second wait. Nothing in the product sets it.
    const IDLE_MS=(typeof window!=='undefined'&&window.__amvStreamIdleMs)||30000;
    let _stalled=false, _recovered=false;
    const _readOnce=()=>new Promise((resolve,reject)=>{
      const t=setTimeout(()=>reject(Object.assign(new Error('stream-stalled'),{_stall:true})),IDLE_MS);
      reader.read().then(v=>{ clearTimeout(t); resolve(v); },e=>{ clearTimeout(t); reject(e); });
    });

    while(true){
      if(_userStopped){ try{ reader.cancel(); }catch(e){} break; }
      let _chunk;
      try{ _chunk=await _readOnce(); }
      catch(re){
        if(!(re&&re._stall)) throw re;
        try{ reader.cancel(); }catch(e){}
        try{ _activeStreamCtrl&&_activeStreamCtrl.abort(); }catch(e){}
        /* Before treating this as a loss: the model may have finished on the
           server after our connection died. Those tokens are already paid for,
           so recovering them costs nothing and saves the user a regeneration. */
        const _saved = await _recoverAnswer(_turnId);
        if(_saved && _saved.length > fullText.length){ fullText = _saved; _recovered = true; break; }
        if(fullText){ _stalled=true; break; }
        throw _saidPlainly(new Error(navigator.onLine===false
          ? 'You went offline before AMV could answer. Reconnect and retry.'
          : 'The connection stalled before AMV could answer. Please retry.'));
      }
      const {done,value}=_chunk;
      if(done) break;
      buffer+=decoder.decode(value,{stream:true});
      const lines=buffer.split('\n');
      buffer=lines.pop()||'';
      for(const line of lines){
        if(!line.startsWith('data:')) continue;
        const data=line.slice(5).trim();
        if(data==='[DONE]') continue;
        try{
          const evt=JSON.parse(data);
          if(evt.type==='message_start'&&evt.message?.usage){ _inTok=evt.message.usage.input_tokens||0; }
          if(evt.type==='message_delta'&&evt.usage){ _outTok=evt.usage.output_tokens||_outTok; }
          // ── Tool use: the model is asking AMV to actually DO something ──
          if(evt.type==='content_block_start' && evt.content_block?.type==='tool_use'){
            _toolBlocks[evt.index]={ id:evt.content_block.id, name:evt.content_block.name, json:'' };
            const t=_toolBlocks[evt.index];
            if(t.name && !String(t.name).startsWith('web_search')){
              const _lbl=({run_code:'Running the code\u2026',fix_code:'Debugging\u2026',build_app:'Building it\u2026',
                           crew_list:'Checking your background jobs\u2026',crew_add:'Setting up the job\u2026',crew_update:'Updating the job\u2026',
                           crew_pause:'Pausing it\u2026',crew_resume:'Starting it again\u2026',crew_remove:'Removing it\u2026',
                           crew_standing:'Updating your crew instructions\u2026'})[t.name] || 'Working\u2026';
              msgs[streamIdx]={...msgs[streamIdx], _status:_lbl};
              setMsgs(msgs); renderChatMsgs();
            }
          }
          // ── Web search: the searches run server-side, and AMV streams
          //    back the queries (server_tool_use) and the sources it found
          //    (web_search_tool_result). We surface that live so the user SEES
          //    the research happening - real counts, real queries, no faking. ──
          if(evt.type==='content_block_start' && evt.content_block?.type==='server_tool_use'
             && String(evt.content_block.name||'').startsWith('web_search')){
            _research.active=true;
            _research.searches++;
            _renderResearch(msgs, streamIdx, _research);
          }
          if(evt.type==='content_block_start' && evt.content_block?.type==='web_search_tool_result'){
            const results = evt.content_block.content;
            if(Array.isArray(results)){
              for(const r of results){
                const url = r && (r.url || r.page_url);
                if(url && !_research.sources.has(url)){
                  _research.sources.set(url, { url, title: (r.title||r.page_title||url).slice(0,120) });
                }
              }
            }
            _renderResearch(msgs, streamIdx, _research);
          }
          // capture the query text as it streams, to show what's being searched
          if(evt.type==='content_block_delta' && evt.delta?.type==='input_json_delta'){
            const t=_toolBlocks[evt.index];
            if(t) t.json += (evt.delta.partial_json||'');
          }
          if(evt.type==='message_delta' && evt.delta?.stop_reason){ _stopReason=evt.delta.stop_reason; }
          if(evt.type==='content_block_delta'&&evt.delta?.type==='text_delta'){
            _clearStatus();
            fullText+=evt.delta.text;
            msgs[streamIdx]={...msgs[streamIdx],c:fullText,_status:null};
            // Fast path: update ONLY the streaming bubble in place rather than
            // re-rendering the whole conversation on every token. This keeps the
            // reveal buttery-smooth even on long, fast responses. We fall back to
            // a full render if the bubble isn't found (e.g. first token).
            if(!_streamBubbleUpdate(streamIdx, fullText)){
              setMsgs(msgs); renderChatMsgs();
            } else {
              setMsgs(msgs);   // keep state in sync without a full DOM rebuild
            }
          }
        }catch{}
      }
    }

    // Finalize
    _clearStatus();
    _streamBubbleReset();
    // Freeze the research panel into its "done" state so it persists with the answer.
    if(_research.active){
      _research.done=true;
      const _finishedPanel=_buildResearchPanel(_research, true);
      if(msgs[streamIdx]) msgs[streamIdx]={...msgs[streamIdx], _research:_finishedPanel};
    }
    if(_userStopped){
      /* Spread rather than replace: the frozen research panel was just written
         onto this message and a wholesale replacement threw away the sources
         AMV had already found and shown. streaming/_status are cleared
         explicitly, since spreading would otherwise keep the bubble spinning. */
      msgs[streamIdx]={...msgs[streamIdx],r:'a',c:(fullText||'')+ (fullText?' _(stopped)_':'_(stopped)_'),
                       model:S.model,streaming:false,_status:null,_retrying:null,_stopped:true};
      _recordUsageOnce();
      setMsgs(msgs); S.busy=false; renderChatMsgs();
      return;
    }
    // ── The model asked AMV to DO something. Run it, then let the model continue. ──
    const _pending = Object.values(_toolBlocks).filter(t=>t && t.name && !String(t.name).startsWith('web_search'));
    if(_pending.length && !_userStopped && _toolRound < _TOOL_ROUND_MAX){
      const assistantContent=[];
      if(fullText) assistantContent.push({type:'text', text:fullText});
      const results=[];
      let renderedExtras='';
      for(const t of _pending){
        let input={};
        try{ input = t.json ? JSON.parse(t.json) : {}; }catch(e){ input={}; }
        assistantContent.push({type:'tool_use', id:t.id, name:t.name, input});
        // AMV-007: a model-requested side-effecting/code-executing tool needs the
        // user's explicit approval before it runs, so injected instructions can't
        // silently deploy sites or execute code.
        let out;
        if(_toolNeedsConsent(t.name)){
          const allowed = await _confirmModelTool(t.name, input);
          if(!allowed){
            out = { text:'The user DENIED permission to run "'+t.name+'". Do not attempt it again unless they explicitly ask for it. Continue helping without it.', render:null };
            try{ if(typeof AEGIS!=='undefined') AEGIS.log('tool_denied',{tool:t.name}); }catch(e){}
          }
        }
        if(!out) out = await _amvRunTool(t.name, input, (msg)=>{
          msgs[streamIdx]={...msgs[streamIdx], c:fullText, _status:msg};
          setMsgs(msgs); renderChatMsgs();
        });
        results.push({type:'tool_result', tool_use_id:t.id, content:String(out.text||'').slice(0,8000)});
        if(out.render) renderedExtras += out.render;
      }
      // Record what actually happened so it survives re-render and reload.
      msgs[streamIdx]={ r:'a', c:fullText, model:S.model, _status:null,
                        _toolContent:assistantContent, _toolResults:results, _rendered:renderedExtras };
      setMsgs(msgs); renderChatMsgs();
      _recordUsageOnce();
      S.busy=false;
      // Continue the conversation with the tool results in hand.
      _toolRound++;
      return sendMsg({ _continueTools:true });
    }
    /* The model asked for another tool and the per-turn budget is spent. The
       branch above simply did not run, so the request vanished: the person got
       whatever text preceded it, or "(no response)", with nothing to say a
       limit had been reached. Silently doing less than was asked is the failure
       this codebase keeps finding; say it instead. */
    if(_pending.length && !_userStopped && _toolRound >= _TOOL_ROUND_MAX){
      fullText = (fullText ? fullText + '\n\n' : '') +
        '_I stopped here after '+_TOOL_ROUND_MAX+' rounds of tool use on this message, so it could not loop. Say "keep going" if there is more to do._';
    }
    if(!fullText) fullText='(no response)';
    const _base={r:'a',c:fullText,model:S.model};
    if(_ranEngine && S.model==='auto'){ _base._engine=_ranEngine; _base._engineWhy=_ranWhy; }
    if(_recovered) _base._recovered=true;   // complete, just not delivered live
    msgs[streamIdx]=_stalled ? Object.assign(_base,{_interrupted:true}) : _base;
    _recordUsageOnce();
    // Auto-title chat
    const cv=getCurConv();
    if(cv&&cv.title==='New Conversation'&&fullText.length>20){
      cv.title=fullText.slice(0,44).replace(/[#*`]/g,'').trim()+(fullText.length>44?'…':'');
      renderHist();
    }

  } catch(e) {
    _clearStatus();
    // a user-initiated stop is not an error - keep whatever streamed
    if(_userStopped || (e && (e.name==='AbortError' || String(e.message||e).includes('user-stop')))){
      /* Stop lands here, not on the clean path above, whenever the connection
         was idle at the moment it was pressed: the abort rejects the read that
         was waiting and throws instead of letting the loop break. This branch
         only re-rendered, so the message kept streaming:true and its bubble
         span with a blinking cursor for the rest of the session - a Stop button
         that visibly did not stop. Finalize it the same way the other path
         does, spreading so the research panel survives. */
      _streamBubbleReset();
      const _m=msgs[streamIdx];
      if(_m && _m.streaming){
        const _t=typeof _m.c==='string'?_m.c:'';
        msgs[streamIdx]= _userStopped
          ? {..._m, r:'a', c:_t+(_t?' _(stopped)_':'_(stopped)_'), model:S.model,
             streaming:false, _status:null, _retrying:null, _stopped:true}
          /* Aborted without anybody pressing Stop: say the connection went, and
             do not put words in their mouth about having stopped it. */
          : {..._m, r:'a', c:_t, model:S.model, streaming:false, _status:null,
             _retrying:null, _interrupted:true};
      }
      _recordUsageOnce();
      setMsgs(msgs); S.busy=false; renderChatMsgs(); _userStopped=false; return;
    }
    /* A message that was ALREADY written for a human is used as it stands.

       This used to decide by looking for certain words in the prose, and the
       words did not cover what aegisErrorMessage actually writes. A 500 came
       back as "The AI service had a temporary error (500)", matched none of
       them, and was rewritten by the fallback - which is called with status 0
       and therefore always produces "Network error - could not reach the API.
       Check your connection, ad-blockers, or CORS/extension interference."

       So a server that was reached, and answered, sent the person off to
       debug their own browser. The tag says which errors already know what
       they are; the word list stays only as a guess for the ones that do
       not. */
    const friendly = (e && e._saidPlainly) ? e.message
      : (/api error|rejected|forbidden|rate-limit|malformed|too long|server error|network|timed out|stalled|offline|busy/i.test(e.message)
          ? e.message : aegisErrorMessage(0, e.message));
    AEGIS.log('exception',{msg:String(e.message).slice(0,200)}); AEGIS.recordError();
    _recordUsageOnce();   // record any tokens consumed before the failure
    _streamBubbleReset();
    // friendly inline error card with a Retry action
    /* THE SENTENCE AMV WROTE, KEPT.

       `friendly` above is already the finished sentence when AMV itself decided
       this - that is what the _saidPlainly tag means, and the comment above it
       says so. The tag is a property of the ERROR, and this record kept only
       the string, so the renderer ran it through the guesser a second time and
       the guesser rewrote it.

       What that cost, exactly: the server answers a free account at capacity
       with "AMV is at capacity for free accounts today. Paid plans are running
       normally." The guesser sees the word "capacity", and the person reads
       "AMV had a brief hiccup. Please try again in a moment." - which is not
       what happened, and trying again in a moment will not work. A plan
       boundary fared worse still: "That engine is part of Elite" matched
       nothing and came out as "AMV hit a snag."

       The most important sentences in the product were the ones being
       overwritten, because they are the ones AMV writes on purpose. */
    msgs[streamIdx]={r:'a',c:'',model:S.model,_error:friendly,
                     _errCode:(e&&e.code)||'',_errPlain:!!(e&&e._saidPlainly)};
  }
  _recordUsageOnce();   // final safety net - never lose usage accounting

  setMsgs(msgs); S.busy=false; renderChatMsgs();
  // learn durable facts from this exchange (best-effort, runs in background)
  try{ if(!msgs[streamIdx]||!msgs[streamIdx]._error){ setTimeout(()=>_maybeExtractMemory(msgs),300); AMVValue.record('message'); if(!loadStr('amv_activated')){ saveStr('amv_activated','1'); track('activated_first_message'); } track('message_sent'); } }catch(e){}
}
/* Ask the server for an answer this device lost. The model may have finished
   after the connection dropped - those tokens are already paid for, so getting
   them back costs nothing and saves the user waiting through a regeneration.
   Polls briefly because the answer is only parked once generation ends. */
async function _recoverAnswer(turnId){
  if(!turnId) return '';
  try{
    if(!(window.AMV_API && AMV_API.live && AMV_API.hasSession)) return '';
    for(let attempt=0; attempt<3; attempt++){
      const r = await AMV_API._fetch('/v1/resume?id='+encodeURIComponent(turnId), { method:'GET', timeout:8000 });
      const d = await r.json().catch(()=>null);
      if(d && d.ok && d.text) return d.text;
      // not finished yet - give it a moment, but do not make the user wait long
      await new Promise(res=>setTimeout(res, 900));
    }
  }catch(e){ /* recovery is a bonus; never turn its failure into the error */ }
  return '';
}
try{ window._recoverAnswer=_recoverAnswer; }catch(e){}

/* Retry the last AI turn after a failure. */
function retryLastAI(){
  const msgs=getMsgs();
  while(msgs.length && msgs[msgs.length-1].r==='a') msgs.pop();
  if(!msgs.length) return;
  setMsgs(msgs); S.busy=true; renderChatMsgs();
  _callAI(msgs);
}
window.retryLastAI=retryLastAI;


async function regenerateMsg() {
  const msgs=getMsgs();
  if(!msgs.length) return;
  // Remove last AI message
  while(msgs.length&&msgs[msgs.length-1].r==='a') msgs.pop();
  if(!msgs.length) return;
  setMsgs(msgs); S.busy=true; renderChatMsgs();
  await _callAI(msgs);
}

async function editMsg(idx) {
  const msgs=getMsgs();
  const msg=msgs[idx];
  if(!msg||msg.r!=='u') return;
  const text=await showTextPromptAsync('Edit your message:', msg.d||msg.c);
  if(!text||!text.trim()) return;
  msgs[idx]={...msg, c:text.trim(), d:text.trim()};
  // Remove all messages after this
  msgs.splice(idx+1);
  setMsgs(msgs); S.busy=true; renderChatMsgs();
  _callAI(msgs);
}

function likeMsg(idx, type) {
  const msgs=getMsgs();
  if(!msgs[idx]) return;
  msgs[idx].like=msgs[idx].like===type?null:type;
  setMsgs(msgs); renderChatMsgs();
  toast(type==='up'?'Feedback: helpful!':'Feedback: not helpful','success');
}

function copyMsg(text) {
  navigator.clipboard?.writeText(text).then(()=>toast('Copied to clipboard','success')).catch(()=>toast('Copy failed','error'));
}


function renderChatView() {
  const vc=$('vc'); if(!vc) return;
  // Current model info
  const mdl=MODELS[S.model]||MODELS.core;
  vc.innerHTML=
    '<div id="cv">'+
      '<div id="cm" data-no-i18n></div>'+
      '<div id="cia">'+
        '<div id="cib">'+
          '<div id="ab2"><div id="ac"></div></div>'+
          '<textarea id="mta" data-i18n-ph placeholder="Ask anything - essays, 3D models, code, research…" rows="1"></textarea>'+
          '<div id="itb">'+
            '<div class="il">'+
              '<button class="atb" id="att-btn" title="Attach file">'+
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>'+
              '</button>'+
              '<button class="atb" id="voice-btn" title="Voice input">'+
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>'+
              '</button>'+
              '<button class="atb" id="voicemode-btn" title="Hands-free voice mode">'+
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3"/></svg>'+
              '</button>'+
              '<button class="atb atb-research" id="research-btn" title="Research mode - search many sources and write a sourced report">'+
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'+
                '<span class="atb-research-lbl">Research</span>'+
              '</button>'+
            '</div>'+
            '<div style="display:flex;align-items:center;gap:7px">'+
              '<button class="inp-model-sel" id="inp-mdl-btn">'+
                '<span class="inp-model-dot" style="background:'+mdl.color+'"></span>'+
                '<span>'+mdl.label+'</span>'+
                '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>'+
              '</button>'+
              '<button id="snd">'+
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'+
              '</button>'+
            '</div>'+
          '</div>'+
        '</div>'+
        '<p class="input-hint">Enter to send &bull; Shift+Enter for new line &bull; Drag &amp; drop files</p>'+
        '<p class="amv-disclaimer">AMV is an AI and can make mistakes. Check important answers.</p>'+
        '<div id="ctx-chat"></div>'+
      '</div>'+
      '<div id="chome-chips" class="chome-chips"></div>'+
    '</div>';

  renderChatMsgs();
  bindChatEvents();
  // If the user is out of usage, the lock persists across tab switches/reloads:
  // re-render the composer notice (and pick up a still-exhausted local window).
  try{
    if(quotaLocked()) _renderQuotaNotice();
    else if(typeof AMVUsage!=='undefined'){ const st=AMVUsage.status(); if(st.remaining<=0) quotaLock(st.resetsAt); }
  }catch(e){}
  // Model selector popup
  on($('inp-mdl-btn'),'click',showModelPicker);
}

/* THE MENU OPENED OFF THE TOP OF THE SCREEN.

   This anchored the menu's BOTTOM eight pixels above the button and let it grow
   upward, with nothing saying how tall it may be. On a phone the composer sits
   near the bottom, the list is a heading, five engines and a footnote, and the
   result measured at 390x844 was a top edge at -61px: the first engines were
   off the screen, and a `position:fixed` element cannot be scrolled back into
   view, so they could not be reached at all. Shorter phones lose more.

   It is now told the space it actually has. The side with more room wins -
   above, in practice, because the button lives in the composer - the height is
   clamped to that space less a margin, and the list scrolls inside itself. A
   menu that scrolls is a menu somebody can use; a menu above the viewport is
   not there.

   Deliberately not a bottom sheet on small screens. That is a different control
   with different dismissal behaviour, and this list is short enough to fit once
   it is allowed to scroll. */
function showModelPicker(){
  const btn=$('inp-mdl-btn'); if(!btn) return;
  const rect=btn.getBoundingClientRect();
  document.querySelectorAll('.model-picker').forEach(m=>m.remove());
  const menu=document.createElement('div');
  menu.className='model-picker';
  const GAP=8, EDGE=12;
  const above=Math.max(0, rect.top - GAP - EDGE);
  const below=Math.max(0, window.innerHeight - rect.bottom - GAP - EDGE);
  const up=above>=below;
  const room=Math.max(140, up?above:below);   // never so small it is useless
  /* AND THE OTHER EDGE, WHICH WAS WRONG IN THE SAME WAY.

     `right` was the distance from the viewport's right edge to the button's,
     which lines the menu up under the button and says nothing about where its
     LEFT edge lands. The button sits in the middle of the composer, so on a
     390px screen right came out at 104, the menu is 340 wide, and its left edge
     was at -54: cut off on the side as well as the top. Same control, same
     class of mistake - a position computed from one anchor with no reference to
     the box it has to fit inside.

     The width here mirrors the stylesheet's (340, capped at the viewport less
     its margins) so the arithmetic is about the box that will actually exist. */
  const width=Math.min(340, Math.max(0, window.innerWidth - EDGE*2));
  let right=Math.max(EDGE, window.innerWidth - rect.right);
  right=Math.max(EDGE, Math.min(right, window.innerWidth - EDGE - width));
  menu.style.cssText=
    (up ? 'bottom:'+(window.innerHeight-rect.top+GAP)+'px'
        : 'top:'+(rect.bottom+GAP)+'px')+
    ';right:'+right+'px'+
    ';max-height:'+room+'px;overflow-y:auto';
  const bars=(c)=>{ if(c===0) return '<span class="mp-auto">\u21c6</span>'; let h=''; for(let i=1;i<=4;i++) h+='<span class="mp-bar'+(i<=c?' on':'')+'"></span>'; return h; };
  menu.innerHTML=
    '<div class="mp-head">Choose a model</div>'+
    MODEL_ORDER.map(k=>{ const v=MODELS[k]; const sel=k===S.model;
      return '<button class="mp-item'+(sel?' sel':'')+'" data-mk="'+k+'">'+
        '<span class="mp-dot" style="background:'+v.color+'"></span>'+
        '<span class="mp-body"><span class="mp-name">'+v.label+(sel?'<span class="mp-check">✓</span>':'')+'</span>'+
        '<span class="mp-desc">'+v.desc+'</span></span>'+
        '<span class="mp-meta"><span class="mp-bars" title="'+COST_LABEL[v.cost]+'">'+bars(v.cost)+'</span>'+
        '<span class="mp-cost">'+COST_LABEL[v.cost]+'</span></span>'+
      '</button>';
    }).join('')+
    '<div class="mp-foot">Every AMV model is high quality. Faster models use less of your usage; the most capable use more - upgrade for more room to run them.</div>';
  document.body.appendChild(menu);
  menu.querySelectorAll('[data-mk]').forEach(item=>{
    item.addEventListener('click',()=>{
      if(!_planAllowsModel(item.dataset.mk)){
        menu.remove();
        openUpgradeModal(item.dataset.mk);
        return;
      }
      S.model=item.dataset.mk;
      menu.remove();
      const mdlNow=MODELS[S.model];
      const mdlBtn=$('inp-mdl-btn');
      if(mdlBtn){
        const lab=mdlBtn.querySelector('span:last-of-type'); if(lab) lab.textContent=mdlNow.label;
        const dot=mdlBtn.querySelector('.inp-model-dot'); if(dot) dot.style.background=mdlNow.color;
      }
    });
  });
  const close=e=>{if(!menu.contains(e.target)){menu.remove();document.removeEventListener('click',close);}};
  setTimeout(()=>document.addEventListener('click',close),50);
}

/* ── WHAT SOMEBODY HAS TYPED AND NOT SENT ───────────────────────────────────

   A half-written message did not survive a reload. Measured before fixing:
   492 characters typed, 0 after refreshing the page.

   That is somebody's work, and it is the most valuable text in the product at
   the moment it is lost - a long prompt is usually the thing they opened AMV to
   write. It goes on an accidental refresh, a back gesture, a crashed tab, and
   on a phone it goes whenever the browser decides to evict a background tab,
   which it does routinely and without warning.

   Kept per conversation, because a draft belongs to the thread it was being
   written in - restoring it into a different chat would be worse than losing
   it. Written on a short debounce rather than on every keystroke, cleared the
   moment the message is actually sent, and capped so a pasted novel cannot fill
   somebody's storage quota and break the things that matter more. */
const DRAFT_MAX = 12000;
const DRAFT_KEEP = 12;                       // how many conversations keep a draft
let _draftTimer = null;

function _draftKey(){
  try{ return 'amv_draft_' + (S.cur || 'new'); }catch(e){ return 'amv_draft_new'; }
}
function _draftSave(text){
  try{
    const t = String(text || '');
    const k = _draftKey();
    if(!t.trim()){ saveStr(k, ''); _draftIndexDrop(k); return; }
    saveStr(k, t.slice(0, DRAFT_MAX));
    _draftIndexTouch(k);
  }catch(e){}
}
function _draftLoad(){
  try{ return loadStr(_draftKey()) || ''; }catch(e){ return ''; }
}
function _draftClear(){
  try{ const k=_draftKey(); saveStr(k, ''); _draftIndexDrop(k); }catch(e){}
}
/* An index, so old drafts are pruned rather than accumulating one row per
   conversation somebody once opened. Without it this leaks storage quietly and
   for ever, which is how a well-meant feature becomes the reason the app stops
   being able to save anything. */
function _draftIndexTouch(k){
  try{
    let ix = load('amv_draft_ix') || [];
    ix = ix.filter(x => x !== k); ix.push(k);
    while(ix.length > DRAFT_KEEP){ const old = ix.shift(); try{ saveStr(old, ''); }catch(e){} }
    store('amv_draft_ix', ix);
  }catch(e){}
}
function _draftIndexDrop(k){
  try{ store('amv_draft_ix', (load('amv_draft_ix') || []).filter(x => x !== k)); }catch(e){}
}
/* Put it back, and only when the box is empty - never over something somebody
   is already typing.

   THE PART THAT MADE THE FIRST VERSION USELESS.

   A draft keyed to its conversation is the right shape, and on its own it never
   restored anything: S.cur is deliberately not persisted, so every reload lands
   in a NEW conversation (that is how amv.homes opens straight into a fresh
   chat). The key on the way back never matched the key on the way out, and the
   feature was a storage write nobody ever read.

   So a reload is handled as what it is. If the chat being opened is empty, the
   draft worth restoring is the most recent one whose own conversation never
   received a message - somebody was typing, nothing was sent, and here they are
   in an empty box again. A draft from a conversation that DID go on to have
   messages stays with that conversation and is offered only there, because
   dropping it into an unrelated thread is worse than losing it. */
function _draftConvEmpty(convId){
  try{
    const c = (S.convs || []).find(x => x && x.id === convId);
    return !c || !(c.msgs && c.msgs.length);
  }catch(e){ return false; }
}
function _draftRestore(){
  try{
    const ta = $('mta'); if(!ta || ta.value) return;
    let d = _draftLoad();
    if(!d && _draftConvEmpty(S.cur)){
      const ix = load('amv_draft_ix') || [];
      for(let i = ix.length - 1; i >= 0; i--){
        const k = ix[i];
        const id = String(k).replace(/^amv_draft_/, '');
        if(!_draftConvEmpty(id)) continue;      // it belongs to a real thread
        const v = loadStr(k);
        if(v){ d = v; try{ saveStr(k, ''); }catch(e){} _draftIndexDrop(k); _draftSave(d); break; }
      }
    }
    if(!d) return;
    ta.value = d;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 130) + 'px';
  }catch(e){}
}
try{ window._draftSave=_draftSave; window._draftLoad=_draftLoad; window._draftClear=_draftClear;
     window._draftRestore=_draftRestore; }catch(e){}

function bindChatEvents() {
  const ta=$('mta');
  on(ta,'keydown',e=>{ if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();sendMsg();return;} if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();} });
  on(ta,'input',()=>{
    ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,130)+'px';
    /* Debounced: a keystroke is not worth a write, and losing the last 400ms of
       typing is not the failure this is here to prevent. */
    try{ clearTimeout(_draftTimer); }catch(e){}
    _draftTimer = setTimeout(()=>{ _draftSave(ta.value); }, 400);
  });
  _draftRestore();
  on($('snd'),'click',()=>{ if(S.busy) stopGenerating(); else sendMsg(); });
  // All message action buttons via delegation (avoids inline onclick quote escaping)
  on($('cm'),'click',e=>{
    const btn=e.target.closest('[data-action]');
    if(!btn) {
      const choice=e.target.closest('[data-guichoice]');
      if(choice){ const ta=$('mta'); if(ta) ta.value=choice.dataset.guichoice; sendMsg(); return; }
      const artBtn=e.target.closest('[data-artopen]');
      if(artBtn){ openArtifact(artBtn.dataset.artopen); return; }
      const cpbtn=e.target.closest('.ccopy');
      if(cpbtn&&cpbtn.dataset.cid) copyCode(cpbtn.dataset.cid);
      return;
    }
    const action=btn.dataset.action, idx=parseInt(btn.dataset.idx);
    const msgs=getMsgs();
    if(action==='edit') editMsg(idx);
    else if(action==='copy-u'||action==='copy-a'){
      const m=msgs[idx];
      if(m) copyMsg(m.d||(typeof m.c==='string'?m.c:''));
    }
    else if(action==='like-up') likeMsg(idx,'up');
    else if(action==='like-down') likeMsg(idx,'down');
    else if(action==='react'){ _openReactPicker(idx, btn); }
    else if(action==='react-toggle'){ _toggleReaction(idx, btn.dataset.emoji); }
    else if(action==='regen') regenerateMsg();
    else if(action==='retry-ai') retryLastAI();
    else if(action==='speak') speakMessage(idx);
    else if(action==='quota-upgrade'){ setTab('plans'); }
    else if(action==='seats-upgrade'){ setTab('team'); }
    else if(action==='quota-later'){ const m2=getMsgs(); if(m2[idx]&&m2[idx]._quota){ m2.splice(idx,1); setMsgs(m2); renderChatMsgs(); } }
  });
  on($('att-btn'),'click',()=>$('fi').click());
  on($('voice-btn'),'click',toggleVoice);
  on($('voicemode-btn'),'click',toggleVoiceMode);
  on($('research-btn'),'click',_toggleResearch);
  try{ _syncResearchBtn(); }catch(e){}

  /* The conversation-tab strip (#tabs) and the model bar (#mdl-bar) were
     replaced by the sidebar history and the composer's model picker. Their
     handlers stayed, bound to elements and attributes that nothing renders -
     the same silent shape that made the Admin tab unreachable. Removed rather
     than left as no-ops that read like live wiring. */

  // Drag and drop
  const cib=$('cib');
  on(cib,'dragover',e=>{e.preventDefault();cib.style.borderColor='var(--indigo)';});
  on(cib,'dragleave',()=>{cib.style.borderColor='';});
  on(cib,'drop',e=>{ e.preventDefault(); cib.style.borderColor=''; if(e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
}


/* ---------------- Message reactions ----------------
   Quick emoji reactions on AI messages. Reactions are stored on the message
   object (m.reactions = {'👍':1, ...}) so they persist with the conversation
   via the existing auto-save. Each user toggles their own single reaction per
   message (this is a single-user client, so a reaction is on/off). */
const _REACTION_SET = ['👍','❤️','🎉','🔥','😂','🤔','👎'];
function _reactionsHTML(m, i){
  const r = m.reactions;
  if(!r) return '';
  const chips = Object.keys(r).filter(k=>r[k]>0);
  if(!chips.length) return '';
  return '<div class="mreacts">'+chips.map(e=>
    '<button class="mreact-chip'+((m.myReacts&&m.myReacts[e])?' on':'')+'" data-action="react-toggle" data-emoji="'+escH(e)+'" data-idx="'+i+'">'+e+' <span>'+r[e]+'</span></button>'
  ).join('')+'</div>';
}
function _openReactPicker(idx, anchorBtn){
  // close any existing picker
  document.querySelectorAll('.react-picker').forEach(p=>p.remove());
  const pick=document.createElement('div');
  pick.className='react-picker';
  pick.innerHTML=_REACTION_SET.map(e=>'<button class="react-opt" data-emoji="'+escH(e)+'" data-idx="'+idx+'">'+e+'</button>').join('');
  document.body.appendChild(pick);
  const rect=anchorBtn.getBoundingClientRect();
  pick.style.left=Math.max(8,Math.min(rect.left, window.innerWidth-pick.offsetWidth-8))+'px';
  pick.style.top=(rect.top-pick.offsetHeight-6+window.scrollY)+'px';
  pick.querySelectorAll('.react-opt').forEach(b=>{
    b.addEventListener('click',(ev)=>{ ev.stopPropagation(); _toggleReaction(parseInt(b.dataset.idx), b.dataset.emoji); pick.remove(); });
  });
  // close on outside click / escape
  const close=(ev)=>{ if(!pick.contains(ev.target)){ pick.remove(); document.removeEventListener('mousedown',close); document.removeEventListener('keydown',esc); } };
  const esc=(ev)=>{ if(ev.key==='Escape'){ pick.remove(); document.removeEventListener('mousedown',close); document.removeEventListener('keydown',esc); } };
  setTimeout(()=>{ document.addEventListener('mousedown',close); document.addEventListener('keydown',esc); },0);
}
/* AMV-095: a thumb on an answer is the only quality signal AMV has, and it was
   only ever stored on the message. Report the SIGNAL to the server - engine,
   feature, direction - and nothing else. No prompt, no answer, not a snippet:
   storing conversations to measure quality trades the thing being measured for
   the measurement. */
function _reportAnswerRating(m, emoji, on){
  try{
    if(!on) return;                                  // removing a reaction says nothing
    const up = /\u{1F44D}|\u{2764}|\u{1F525}|\u{1F389}/u.test(emoji);
    const down = /\u{1F44E}/u.test(emoji);
    if(!up && !down) return;                         // only the two that mean good/bad
    if(!(window.AMV_API && AMV_API.live && AMV_API.hasSession)) return;
    const engine = m._engine || (typeof MODELS!=='undefined' && MODELS[m.model] ? MODELS[m.model].model : '');
    AMV_API._fetch('/v1/feedback', { method:'POST', body: JSON.stringify({
      rating: up ? 'up' : 'down',
      engine, feature: 'chat',
    })}).catch(()=>{});
    /* A thumbs-down says an answer was bad and nothing about WHY, which is the
       half that lets it be fixed. One optional tap, never a required form -
       most people will not answer, and the rating already counted without it. */
    if(down) _askWhyBad(engine);
  }catch(e){ /* a rating must never break the message it is on */ }
}

/* The reason chips. Shown once, dismissed by answering or by ignoring - they
   disappear on the next render either way, because a nag after a complaint is
   its own complaint. */
function _askWhyBad(engine){
  try{
    const host = document.getElementById('cm'); if(!host) return;
    document.querySelectorAll('.whybad').forEach(x=>x.remove());
    const REASONS = [['wrong','Wrong'],['incomplete','Incomplete'],
                     ['ignored_instructions','Ignored what I asked'],['too_slow','Too slow']];
    const box = document.createElement('div');
    box.className = 'whybad';
    box.setAttribute('data-i18n','');
    box.innerHTML = '<span class="whybad-q">Thanks - what was wrong with it?</span>'+
      REASONS.map(([v,l])=>'<button class="whybad-b" type="button" data-why="'+v+'">'+escH(l)+'</button>').join('')+
      '<button class="whybad-x" type="button" aria-label="Dismiss">&#215;</button>';
    host.appendChild(box);
    host.scrollTop = host.scrollHeight;
    const send = (reason) => {
      try{
        if(reason && window.AMV_API && AMV_API.live && AMV_API.hasSession){
          AMV_API._fetch('/v1/feedback', { method:'POST', body: JSON.stringify({
            rating:'down', engine, feature:'chat', reason })}).catch(()=>{});
        }
      }catch(e){}
      box.remove();
    };
    box.querySelectorAll('[data-why]').forEach(b=>b.addEventListener('click',()=>send(b.dataset.why)));
    box.querySelector('.whybad-x').addEventListener('click',()=>send(''));
  }catch(e){ /* never let feedback break the conversation */ }
}
try{ window._askWhyBad=_askWhyBad; }catch(e){}

function _toggleReaction(idx, emoji){
  const msgs=getMsgs();
  const m=msgs[idx];
  if(!m) return;
  if(!m.reactions) m.reactions={};
  if(!m.myReacts) m.myReacts={};
  if(m.myReacts[emoji]){
    // remove my reaction
    m.reactions[emoji]=Math.max(0,(m.reactions[emoji]||1)-1);
    if(m.reactions[emoji]===0) delete m.reactions[emoji];
    delete m.myReacts[emoji];
  } else {
    m.reactions[emoji]=(m.reactions[emoji]||0)+1;
    m.myReacts[emoji]=1;
    _reportAnswerRating(m, emoji, true);
  }
  setMsgs(msgs);
  try{ _autoSave&&_autoSave(); }catch(e){}
  renderChatMsgs();
}

// A subtle starter chip for the clean chat home: label the user sees, full
// prompt inserted into the composer on click.
// Small pill chip with an icon - sits under the composer on the home screen.
function _chip(kind, label, prompt){
  const ic={
    build:'<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
    write:'<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    create:'<path d="m2 12 5-5 9 9-5 5z"/><circle cx="17" cy="7" r="2"/><path d="M14 4 20 10"/>',
    research:'<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    automate:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  }[kind]||'<circle cx="12" cy="12" r="9"/>';
  return '<button class="chome-chip" data-q="'+escH(prompt)+'">'+
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+ic+'</svg>'+
    escH(label)+'</button>';
}
// A capability card for the home - icon, title, one-line what-it-does. Reads as
// "pick a job for your AI workforce," not a generic chat suggestion pill.
// Build a grounded "Jump back in" section for the chat home from the most
// recent work sessions (Dev/Lab/Studio) and conversations. Returns '' when
// there's nothing meaningful yet, so new/empty accounts keep the minimal home.

// Update ONLY the streaming assistant bubble in place (no full re-render), so
// token reveal stays smooth on long/fast responses. The streaming bubble is the
// last .mb.ai in the message list. Returns true if it updated, false if it
// couldn't find the bubble (caller then does a full render).
let _streamBubbleEl=null, _streamRAF=null, _streamPending=null;
/* ── Research mode: pick a depth, then AMV searches broadly and writes a
   sourced report. Depth maps to how many searches the model may run. Honest
   labels - "50+ sources" is a realistic range, not a fixed promise. ── */
const _RESEARCH_TIERS = {
  quick: { label:'Quick research', sub:'~10-20 sources, under a minute', depth:'normal' },
  deep:  { label:'Deep research',  sub:'50+ sources, a few minutes',     depth:'deep' },
  max:   { label:'Exhaustive',     sub:'Hundreds of sources, several minutes', depth:'max' },
};

function _toggleResearch(){
  if(S._researchDepth){ S._researchDepth=null; S._researchTier=null; _syncResearchBtn(); return; }
  _openResearchMenu();
}

function _openResearchMenu(){
  document.querySelectorAll('.research-menu').forEach(m=>m.remove());
  const btn=$('research-btn'); if(!btn) return;
  const menu=document.createElement('div');
  menu.className='research-menu';
  menu.innerHTML=
    '<div class="rm-title">Research mode</div>'+
    '<div class="rm-sub">AMV searches many sources and writes a report with citations.</div>'+
    Object.entries(_RESEARCH_TIERS).map(([k,v])=>
      '<button class="rm-opt" data-tier="'+k+'">'+
        '<span class="rm-opt-l">'+escH(v.label)+'</span>'+
        '<span class="rm-opt-s">'+escH(v.sub)+'</span>'+
      '</button>'
    ).join('');
  document.body.appendChild(menu);
  const r=btn.getBoundingClientRect();
  menu.style.left=r.left+'px';
  menu.style.bottom=(window.innerHeight-r.top+8)+'px';
  menu.querySelectorAll('[data-tier]').forEach(o=>on(o,'click',(e)=>{
    e.stopPropagation();
    S._researchDepth=_RESEARCH_TIERS[o.dataset.tier].depth;
    S._researchTier=o.dataset.tier;
    menu.remove();
    _syncResearchBtn();
    const ta=$('mta'); if(ta) ta.focus();
  }));
  setTimeout(()=>{
    const close=(e)=>{ if(!menu.contains(e.target) && e.target!==btn && !btn.contains(e.target)){ menu.remove(); document.removeEventListener('click',close); } };
    document.addEventListener('click',close);
  },0);
}

function _syncResearchBtn(){
  const btn=$('research-btn'); if(!btn) return;
  const on_=!!S._researchDepth;
  btn.classList.toggle('on', on_);
  const lbl=btn.querySelector('.atb-research-lbl');
  if(lbl){
    const tier=S._researchTier && _RESEARCH_TIERS[S._researchTier];
    lbl.textContent = on_ ? (tier?tier.label.replace(' research',''):'Research') : 'Research';
  }
}
try{ window._toggleResearch=_toggleResearch; window._syncResearchBtn=_syncResearchBtn; }catch(e){}

/* Build the live research panel from REAL search activity: the queries the
   model actually ran and the sources it actually found. Stored on the message
   as _research so it renders above the answer. */
function _renderResearch(msgs, streamIdx, state){
  try{
    if(!state || !msgs || streamIdx==null) return;
    if(!state.active) return;
    msgs[streamIdx] = { ...msgs[streamIdx], _research: _buildResearchPanel(state, !!state.done) };
    setMsgs(msgs);
    renderChatMsgs();
  }catch(e){}
}

function _buildResearchPanel(state, finished){
  const n = state.sources.size;
  const searches = state.searches;
  const sources = [...state.sources.values()];
  const host = (u)=>{ try{ return new URL(u).hostname.replace(/^www\./,''); }catch(e){ return u; } };

  // dedupe display hosts, keep first 12 for the chips
  const shown = sources.slice(0, 12);
  const chips = shown.map(s=>
    '<a class="rsrc-chip" href="'+escH(safeUrl(s.url))+'" target="_blank" rel="noopener noreferrer" title="'+escH(s.title)+'">'+
      '<span class="rsrc-fav"></span>'+escH(host(s.url))+
    '</a>'
  ).join('');

  const head = finished
    ? '<span class="rsrc-check">\u2713</span> Researched '+n+' source'+(n===1?'':'s')+' across '+searches+' search'+(searches===1?'':'es')
    : '<span class="rsrc-spin"></span> Researching\u2026 '+searches+' search'+(searches===1?'':'es')+', '+n+' source'+(n===1?'':'s')+' so far';

  return '<div class="rsrc-panel'+(finished?' done':'')+'">'+
    '<div class="rsrc-head">'+head+'</div>'+
    (chips?'<div class="rsrc-chips">'+chips+(sources.length>12?'<span class="rsrc-more">+'+(sources.length-12)+' more</span>':'')+'</div>':'')+
  '</div>';
}

function _streamBubbleUpdate(streamIdx, text){
  const cm=$('cm'); if(!cm) return false;
  // locate (and cache) the streaming bubble - last assistant bubble in the list
  if(!_streamBubbleEl || !_streamBubbleEl.isConnected){
    const bubbles=cm.querySelectorAll('.mr:not(.u) .mb.ai');
    _streamBubbleEl=bubbles.length?bubbles[bubbles.length-1]:null;
  }
  if(!_streamBubbleEl) return false;
  _streamPending=text;
  // coalesce rapid tokens into one paint per frame
  if(_streamRAF) return true;
  _streamRAF=requestAnimationFrame(()=>{
    _streamRAF=null;
    const el=_streamBubbleEl;
    if(!el || !el.isConnected){ _streamBubbleEl=null; return; }
    if(!el.classList.contains('mb-streaming')) el.classList.add('mb-streaming');
    el.innerHTML = md(_streamPending) + '<span class="stream-cursor"></span>';
    // keep pinned to bottom only if the user is already near the bottom
    const nearBottom = cm.scrollHeight - cm.scrollTop - cm.clientHeight < 120;
    if(nearBottom) cm.scrollTop=cm.scrollHeight;
  });
  return true;
}
function _streamBubbleReset(){ _streamBubbleEl=null; if(_streamRAF){cancelAnimationFrame(_streamRAF);_streamRAF=null;} _streamPending=null; }

/* An answer arriving is the single most important thing that happens in AMV, and
   it was the least announced. The stream cannot be a live region itself - that
   would read every partial token aloud, which is unusable - so the START and the
   FINISH are announced instead, from here rather than from the completion paths,
   because there are four of those (finished, stopped, interrupted, retried) and
   hooking each one is how you miss the fifth. */
let _srLastStreaming = false;
function _announceChatTurn(msgs){
  try{
    const last = msgs[msgs.length-1];
    const streaming = !!(last && last.r==='a' && last.streaming);
    if(streaming && !_srLastStreaming) announce('AMV is answering');
    else if(!streaming && _srLastStreaming){
      const t = (last && typeof last.c==='string') ? last.c.trim() : '';
      announce(t ? 'AMV answered. ' + t : 'AMV finished answering');
    }
    _srLastStreaming = streaming;
  }catch(e){}
}

function renderChatMsgs() {
  const cm=$('cm');
  if(!cm) return;
  const msgs=getMsgs();
  _announceChatTurn(msgs);
  const ini=S.user?.ini||'?';

  if(!msgs.length) {
    const fname=S.user?.name?.split(' ')[0]||'';
    const hour=new Date().getHours();
    const greet=hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';
    const title = fname ? (greet+', '+escH(fname)) : 'What should we build?';
    cm.classList.add('cm-empty');
    const cv=$('cv'); if(cv) cv.classList.add('cv-home');
    // Greeting sits above the composer; the starter chips render BELOW it.
    cm.innerHTML=
      /* Work finished in the background goes ABOVE the greeting - it is the
         reason they opened the app, and it is the one thing a chat box cannot
         tell them (AMV-083). Usually renders nothing. */
      (typeof _awayCardHTML==='function' ? _awayCardHTML() : '')+
      '<div class="chome">'+
        '<h1 class="chome-title"><span class="chome-greet">'+title+'</span></h1>'+
      '</div>'+
      /* THE NEW CHAT IS A GREETING AND SOME SMALL CHIPS, AND NOTHING ELSE.

         There was one more thing here: _firstRunHTML, a card headed "AMV does
         the work, not just the talking" with three examples inside it, shown
         once to a new account. 640x144 of panel sitting between the greeting
         and the chips.

         Removed at the owner's direction - they want the quiet shape, a
         greeting and the small suggestions under the box, and nothing that
         needs dismissing before you can start typing. The three examples it
         carried are not lost: the chips below say the same things in the form
         somebody can actually click into the composer.

         _firstRunHTML and _wireFirstRun stay in 31-firstrun.js rather than
         being deleted - they are a coherent piece of onboarding and this is a
         placement decision, not a judgement that the content is wrong. */
      '';
    try{ if(typeof _wireAwayCard==='function') _wireAwayCard(cm); }catch(e){}
    const chips=$('chome-chips');
    if(chips){
      chips.innerHTML=
        _chip('build','Build','Build a full-stack web app with React, a clean UI, and auth. Then run it so I can see it working.')+
        _chip('write','Write','Write a clear, well-structured article. Ask me what it should be about if you need to.')+
        _chip('create','Create','Design a landing page for a premium coffee brand - a clear headline, one product shot slot, and a sign-up form. Then run it so I can see it.')+
        _chip('research','Research','Research a topic thoroughly and write a sourced report with a clear takeaway.')+
        _chip('automate','Automate','Every morning at 7am, research overnight news and have a concise brief ready for me.');
      chips.querySelectorAll('[data-q]').forEach(p=>p.addEventListener('click',()=>{
        const ta=$('mta');
        if(ta){ta.value=p.dataset.q;ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,160)+'px';ta.focus();}
      }));
      document.querySelectorAll('.chome-recent').forEach(e=>e.remove());
    }
    return;
  }

  cm.classList.remove('cm-empty');
  try{ _ctxRenderMeter('ctx-chat','chat'); }catch(e){}
  const _cv=$('cv'); if(_cv) _cv.classList.remove('cv-home');
  const _ch=$('chome-chips'); if(_ch) _ch.innerHTML='';
  document.querySelectorAll('.chome-recent').forEach(e=>e.remove());
  cm.innerHTML=
  /* Same card as the home screen, at the top of an open conversation - a
     returning user is just as likely to land in yesterday's chat. */
  (typeof _awayCardHTML==='function' ? _awayCardHTML() : '')+
  msgs.map((m,i)=>{
    const isU=m.r==='u';
    const rawText=m.d||(typeof m.c==='string'?m.c:'');
    let content;
    if(!isU && m._quota){
      const plan=(loadStr('amv_plan')||'free');
      const nextPlan=plan==='free'?'Pro':plan==='pro'?'Elite':'Ultra';
      /* THREE THINGS THIS CARD USED TO GET WRONG, ALL AT ONCE.

         It always drew a countdown, falling back to `Date.now()` when no reset
         time was known - which renders as "under a minute" for a limit that
         comes back next month. It always offered Upgrade, including to a child
         whose PARENT set the limit, for whom upgrading is not an available
         action and buying a bigger plan would not lift it. And it always said
         "I'll wait", which is advice about an hour, not about a billing cycle.

         The server's own sentence is the fallback now, because it was written
         for this and was being discarded. */
      const isFamily = m._quotaCode === 'family_cap';
      const when = +m._resetAt || 0;
      const whenTxt = when > Date.now()
        ? 'Your usage resets in <b class="quota-reset-live">' + escH(_fmtResetIn(when - Date.now())) + '</b>. '
        : (m._quotaMsg ? escH(m._quotaMsg) + ' ' : '');
      content='<div class="quota-card"><div class="quota-ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>'+
        '<div class="quota-body"><b>You\u2019re out of usage for now.</b>'+
        (isFamily
          ? '<span>'+whenTxt+'Whoever manages your family can raise this limit - a bigger plan will not lift it.</span>'+
            '<div class="quota-actions"><button class="quota-later" data-action="quota-later" data-idx="'+i+'">Got it</button></div>'
          : '<span>'+whenTxt+'Upgrade to '+nextPlan+' for much higher limits and keep going right now.</span>'+
            '<div class="quota-actions"><button class="quota-upgrade" data-action="quota-upgrade" data-idx="'+i+'">Upgrade to '+nextPlan+'</button>'+
            '<button class="quota-later" data-action="quota-later" data-idx="'+i+'">'+(when>Date.now()?'I\u2019ll wait':'Got it')+'</button></div>')+
        '</div></div>';
    } else if(!isU && m._error){
      /* Retry is the right offer for a hiccup and the wrong one for a
         decision. A refusal a plan lifts gets the plan instead. */
      const _route=_refusalRoute(m._errCode);
      const _act=_route==='plans'
        ? '<button class="ai-snag-retry" data-action="quota-upgrade" type="button">See plans</button>'
        : _route==='team'
          ? '<button class="ai-snag-retry" data-action="seats-upgrade" type="button">Manage seats</button>'
          : '<button class="ai-snag-retry" data-action="retry-ai" type="button">Retry</button>';
      content='<div class="ai-snag'+(_route?' ai-snag-tier':'')+'"><div class="ai-snag-row"><span class="ai-snag-ic">'+
        (_route
          ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 15 9l7 .5-5.5 4.6L18.5 21 12 17.3 5.5 21l1.9-6.9L2 9.5 9 9z"/></svg>'
          : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>')+
        '</span>'+
        '<span class="ai-snag-msg">'+escH(m._errPlain ? m._error : _aiFriendly(m._error))+'</span></div>'+
        _act+'</div>';
    } else if(!isU && m._retrying){
      content='<div class="ai-retrying"><div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div><span>'+escH(m._retrying)+'</span></div>';
    } else if(!isU && m.streaming && !(typeof m.c==='string' && m.c.length)){
      // working - show a live status label before the first token.
      // If offline, show a skeleton loader + a clear note instead.
      if(typeof navigator!=='undefined' && navigator.onLine===false){
        content='<div class="skl-msg"><div class="skl skl-line w1"></div><div class="skl skl-line w4"></div><div class="skl skl-line w2"></div><div class="skl skl-line w3"></div>'+
          '<div class="skl-offline-note"><span class="skl-offline-dot"></span>Waiting for your connection\u2026 this will send when you\u2019re back online.</div></div>';
      } else {
        content=(m._research?m._research:'')+'<div class="ai-working"><span class="ai-think-orb"></span><span class="ai-working-shimmer">'+escH(m._status||'Working…')+'</span></div>';
      }
    } else {
      content=isU?escH(rawText).replace(/\n/g,'<br>'):((m._research?m._research:'')+md(typeof m.c==='string'?m.c:rawText)+(m._rendered?('<div class="chat-tool-out">'+m._rendered+'</div>'):'')+(m.streaming?'<span class="stream-cursor"></span>':'')+
        // The answer above is real but incomplete - say so rather than letting it
        // look like AMV simply stopped mid-sentence on purpose.
        (m._interrupted?'<div class="ai-cut"><span>The connection dropped partway through. What you see above is what arrived.</span><button class="ai-snag-retry" data-action="retry-ai" type="button">Retry</button></div>':'')+
        // A complete answer that simply could not be delivered live.
        (m._recovered?'<div class="ai-recovered"><span>Your connection dropped, so AMV recovered this answer rather than making you wait for it again.</span></div>':''));
    }
    /* Name the engine that ACTUALLY answered. On Auto, the server routes the
       turn, so "AMV Auto Model" would tell the user nothing about what ran. */
    const _engLabel=(!isU && m._engine && ENGINE_LABEL[m._engine]) ? ENGINE_LABEL[m._engine] : (!isU&&m.model?(MODELS[m.model]?.label||''):'');
    /* A LABEL WITH NO NAME IN IT SAID NOTHING, AND SAID IT ON EVERY REPLY.

       This was gated on `m.model` alone, but `_engLabel` above resolves to ''
       whenever the stored model id is not in the client's catalogue - which
       is not an edge case, it is what happens to every message already in a
       thread when an engine is renamed or retired. The span then rendered as
       a leading space and the bare word "Model", in small grey type above the
       answer, which reads as something half-drawn.

       Seen in a screenshot rather than in a check: it throws nothing, styles
       correctly, and is a perfectly valid element that happens to be empty of
       the one thing it exists to carry.

       So the name is what the label is conditional on. No name, no label -
       the reply is unchanged and nothing pretends to identify it. */
    const mdlLabel=!isU&&m.model&&_engLabel?'<span class="msg-engine" title="'+escH(m._engineWhy||'')+'">'+escH(_engLabel)+' Model'+
      (m._engineWhy?'<span class="msg-engine-why">'+escH(m._engineWhy)+'</span>':'')+'</span>':'';
        const actions=(!isU && (m._error||m._retrying||m._quota))? '' : (isU?
      '<div class="macts mact-bar">'+
        '<button class="mact" data-action="edit" data-idx="'+i+'" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>'+
        '<button class="mact" data-action="copy-u" data-idx="'+i+'" title="Copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>'+
      '</div>':
      '<div class="macts mact-bar">'+
        '<button class="mact '+(m.like==='up'?'liked':'')+'" data-action="like-up" data-idx="'+i+'" title="Good response"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88z"/></svg></button>'+
        '<button class="mact '+(m.like==='down'?'disliked':'')+'" data-action="like-down" data-idx="'+i+'" title="Bad response"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88z"/></svg></button>'+
        '<button class="mact" data-action="copy-a" data-idx="'+i+'" title="Copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>'+
        '<button class="mact" data-action="speak" data-idx="'+i+'" title="Read aloud"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/></svg></button>'+
        '<button class="mact mact-react" data-action="react" data-idx="'+i+'" title="React"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></button>'+
        (i===msgs.length-1?'<button class="mact" data-action="regen" title="Regenerate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v5h-5"/></svg></button>':'')+
      '</div>'+
      _reactionsHTML(m,i));    return '<div class="mr '+(isU?'u':'')+'"><div class="mav '+(isU?'u':'ai')+'">'+(isU?ini:'A')+'</div>'+
      '<div class="mwrap">'+(mdlLabel?mdlLabel:'')+
      '<div class="mb '+(isU?'u':'ai')+(m.streaming&&typeof m.c==='string'&&m.c.length?' mb-streaming':'')+'">'+content+'</div>'+actions+'</div></div>';
  }).join('')+
  (S.busy?'<div class="mr"><div class="mav ai">A</div><div class="mwrap"><div class="mb ai"><div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div></div></div>':'')+
  // One earned next step after a complete answer (AMV-073). Usually nothing.
  (typeof _nextStepHTML==='function'? _nextStepHTML(msgs) : '');

  // Wire it. Both actions do real work; the dismissal is permanent.
  /* ON A PHONE, THE ACTION BAR IS BIGGER THAN THE MESSAGE.

     Every turn carries edit/copy/like/speak/react underneath it, and once the
     buttons were sized for a thumb (44px, as they must be) the bar measured
     55px against a 46px bubble. A one-word "Thanks" became 131px of screen,
     most of it buttons nobody had asked for - which is what made the thread
     read as stretched out and unfinished on a phone.

     Desktop is unaffected: there is a pointer there, the bar is small, and it
     sits quietly under each turn.

     On a narrow screen the bar shows for the LAST turn - the one anybody
     actually acts on - and any other message reveals its own when tapped.
     Nothing is removed and nothing needs discovering: the gesture is tapping
     the thing you want to act on, which is what a phone user tries first.

     Bound once. renderChatMsgs runs on every keystroke of a streaming reply,
     and a listener added each time would stack up hundreds deep. */
  if(!cm._actsTapWired){
    cm._actsTapWired = 1;
    cm.addEventListener('click', (e)=>{
      try{
        if(!window.matchMedia || !window.matchMedia('(max-width:720px)').matches) return;
        /* A press on a control is that control's business, not a request to
           reveal the bar it lives in. */
        if(e.target.closest('.macts, button, a, input, textarea, select')) return;
        const row = e.target.closest('.mr'); if(!row) return;
        const wasOpen = row.classList.contains('acts-open');
        cm.querySelectorAll('.mr.acts-open').forEach(r=>r.classList.remove('acts-open'));
        if(!wasOpen) row.classList.add('acts-open');
      }catch(_){}
    });
  }

  cm.querySelectorAll('[data-next-go]').forEach(b=>b.addEventListener('click',()=>{
    const kind=b.dataset.nextGo;
    try{
      const conv=getCurConv(); if(conv){ conv._nextShown=(conv._nextShown||[]).concat(kind); }
      const all=getMsgs();
      const lastUser=[...all].reverse().find(m=>m.r==='u');
      /* The answer travels with it - "Open this in Dev" has to carry THIS code,
         and the run function cannot reach it otherwise. */
      const lastAns=[...all].reverse().find(m=>m.r==='a' && typeof m.c==='string');
      _nextStepRun(kind, (lastUser&&(lastUser.d||lastUser.c))||'', (lastAns&&lastAns.c)||'');
    }catch(e){}
  }));
  cm.querySelectorAll('[data-next-off]').forEach(b=>b.addEventListener('click',()=>{
    try{ saveStr('amv_nextstep_off','1'); }catch(e){}
    // Dismissing the welcome offer also retires it, so it is asked once.
    try{ if(typeof _nextStepFirstSeen==='function') _nextStepFirstSeen(); }catch(e){}
    b.closest('.next-step')?.remove();
    try{ toast('Fine - no more suggestions.','info',2500); }catch(e){}
  }));
  try{ if(typeof _wireAwayCard==='function') _wireAwayCard(cm); }catch(e){}

  cm.scrollTop=cm.scrollHeight;
  const snd=$('snd'); if(snd) snd.disabled=S.busy;
}


let _voiceRec=null, _isRecording=false;
function toggleVoice(){
  const btn=$('voice-btn');
  if(!('webkitSpeechRecognition' in window)&&!('SpeechRecognition' in window)){
    toast('Voice input not supported in this browser. Use Chrome.','error'); return;
  }
  if(_isRecording){ try{_voiceRec&&_voiceRec.stop();}catch(e){} return; }
  if(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){
    navigator.mediaDevices.getUserMedia({audio:true})
      .then(s=>{s.getTracks().forEach(t=>t.stop());_amvBeginRec();})
      .catch(err=>{ if(err&&err.name==='NotAllowedError') toast('Microphone blocked - allow it in your browser address bar','error',5000); else _amvBeginRec(); });
    return;
  }
  _amvBeginRec();
}
function _amvBeginRec(){
  const btn=$('voice-btn');
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  _voiceRec=new SR();
  _voiceRec.continuous=false; _voiceRec.interimResults=true; _voiceRec.lang='en-US';
  _voiceRec.onstart=()=>{
    _isRecording=true;
    if(btn) btn.classList.add('rec');
    toast('Listening… speak now','info',5000);
  };
  _voiceRec.onresult=e=>{
    const t=Array.from(e.results).map(r=>r[0].transcript).join('');
    const ta=$('mta'); if(ta){ ta.value=t; ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,130)+'px'; }
  };
  _voiceRec.onend=()=>{
    _isRecording=false;
    if(btn) btn.classList.remove('rec');
  };
  _voiceRec.onerror=e=>{ _isRecording=false; if(btn) btn.classList.remove('rec'); toast('Voice error: '+e.error,'error'); };
  _voiceRec.start();
}

/* ── Voice OUTPUT: read AMV's answers aloud + hands-free voice mode ──
   Uses the browser's built-in speech synthesis (no backend). Picks the best
   available natural voice, strips markdown so it reads cleanly, and offers a
   full hands-free loop: listen → answer → speak → listen again. */
const AMVSpeech = {
  speaking:false, _utter:null, _voice:null, _boundIdx:null,
  supported(){ return typeof window!=='undefined' && 'speechSynthesis' in window; },
  _pickVoice(){
    if(this._voice) return this._voice;
    const vs=speechSynthesis.getVoices()||[];
    if(!vs.length) return null;
    // prefer a natural, English voice (Google/Natural/Samantha), else first en, else first
    const pref=vs.find(v=>/natural|google us english|samantha|aria|jenny/i.test(v.name)&&/^en/i.test(v.lang))
      || vs.find(v=>/^en-US/i.test(v.lang)) || vs.find(v=>/^en/i.test(v.lang)) || vs[0];
    this._voice=pref; return pref;
  },
  _clean(text){
    return String(text||'')
      .replace(/```[\s\S]*?```/g,' (code block) ')      // don't read code char-by-char
      .replace(/!\[[^\]]*\]\([^)]*\)/g,' ')             // images
      .replace(/\[([^\]]*)\]\([^)]*\)/g,'$1')           // links → text
      .replace(/[#>*_`~|]/g,'')                          // md symbols
      .replace(/\n{2,}/g,'. ').replace(/\n/g,' ')
      .replace(/\s{2,}/g,' ').trim();
  },
  speak(text, opts){
    if(!this.supported()){ toast('Read-aloud isn\u2019t supported in this browser. Try Chrome.','error'); return false; }
    this.stop();
    const clean=this._clean(text); if(!clean) return false;
    const u=new SpeechSynthesisUtterance(clean);
    const v=this._pickVoice(); if(v) u.voice=v;
    u.rate=parseFloat(loadStr('amv_voice_rate'))||1.0; u.pitch=1.0; u.lang=(v&&v.lang)||'en-US';
    u.onstart=()=>{ this.speaking=true; if(opts&&opts.onstart) opts.onstart(); };
    u.onend=()=>{ this.speaking=false; this._boundIdx=null; _syncSpeakButtons(); if(opts&&opts.onend) opts.onend(); };
    u.onerror=()=>{ this.speaking=false; this._boundIdx=null; _syncSpeakButtons(); if(opts&&opts.onerror) opts.onerror(); };
    this._utter=u; speechSynthesis.speak(u); return true;
  },
  stop(){ try{ if(this.supported()){ speechSynthesis.cancel(); } }catch(e){} this.speaking=false; this._boundIdx=null; },
  toggle(text, idx, opts){
    if(this.speaking && this._boundIdx===idx){ this.stop(); _syncSpeakButtons(); return false; }
    this._boundIdx=idx; const ok=this.speak(text, opts); _syncSpeakButtons(); return ok;
  }
};
try{ if(AMVSpeech.supported()){ speechSynthesis.onvoiceschanged=()=>{ AMVSpeech._voice=null; AMVSpeech._pickVoice(); }; } }catch(e){}
try{ window.AMVSpeech=AMVSpeech; }catch(e){}

// keep every message's speak button in sync with what's actually playing
function _syncSpeakButtons(){
  try{
    document.querySelectorAll('[data-action="speak"]').forEach(b=>{
      const on=AMVSpeech.speaking && String(AMVSpeech._boundIdx)===b.dataset.idx;
      b.classList.toggle('speaking', on);
      b.title = on ? 'Stop' : 'Read aloud';
    });
  }catch(e){}
}

// read a specific chat message aloud (by index)
function speakMessage(idx){
  const msgs=getMsgs(); const m=msgs[idx]; if(!m) return;
  const text=typeof m.c==='string' ? m.c : (Array.isArray(m.c)? m.c.map(x=>x.text||'').join(' ') : '');
  AMVSpeech.toggle(text, idx);
}

/* ── Hands-free voice mode: listen → send → speak the reply → listen again ── */
let _voiceMode=false;
// ── Voice mode showcase overlay ───────────────────────────────
// A focused, premium interface shown while hands-free voice mode is active.
// The orb reflects the current state: listening / thinking / speaking.
function _voiceOverlay(){
  let el=document.getElementById('voice-ov');
  if(!el){
    el=document.createElement('div');
    el.id='voice-ov';
    el.className='voice-ov';
    el.innerHTML=
      '<div class="voice-stage">'+
        '<div class="voice-orb" id="voice-orb">'+
          '<div class="voice-orb-core"></div>'+
          '<div class="voice-ring voice-ring-1"></div>'+
          '<div class="voice-ring voice-ring-2"></div>'+
          '<div class="voice-ring voice-ring-3"></div>'+
        '</div>'+
        '<div class="voice-state" id="voice-state">Listening\u2026</div>'+
        '<div class="voice-transcript" id="voice-transcript"></div>'+
        '<button class="voice-exit" id="voice-exit">'+
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'+
          '<span>End voice</span>'+
        '</button>'+
      '</div>';
    document.body.appendChild(el);
    el.querySelector('#voice-exit').addEventListener('click',()=>{ if(_voiceMode) toggleVoiceMode(); });
  }
  return el;
}
function _voiceSetState(state, transcript){
  const orb=document.getElementById('voice-orb');
  const label=document.getElementById('voice-state');
  const tr=document.getElementById('voice-transcript');
  if(orb){ orb.classList.remove('is-listening','is-thinking','is-speaking'); orb.classList.add('is-'+state); }
  if(label){ label.textContent = state==='listening'?'Listening\u2026' : state==='thinking'?'Thinking\u2026' : 'Speaking\u2026'; }
  if(tr && transcript!=null){ tr.textContent=transcript; }
}
function _showVoiceOverlay(){ const el=_voiceOverlay(); requestAnimationFrame(()=>el.classList.add('on')); _voiceSetState('listening',''); }
function _hideVoiceOverlay(){ const el=document.getElementById('voice-ov'); if(el) el.classList.remove('on'); }

function toggleVoiceMode(){
  if(!AMVSpeech.supported() || (!('webkitSpeechRecognition' in window)&&!('SpeechRecognition' in window))){
    toast('Voice mode needs Chrome (speech recognition + synthesis).','error',5000); return;
  }
  _voiceMode=!_voiceMode;
  const btn=$('voicemode-btn'); if(btn) btn.classList.toggle('on',_voiceMode);
  if(_voiceMode){ _showVoiceOverlay(); _voiceModeListen(); }
  else { _hideVoiceOverlay(); AMVSpeech.stop(); try{ _voiceRec&&_voiceRec.stop(); }catch(e){} }
}
function _voiceModeListen(){
  if(!_voiceMode) return;
  _voiceSetState('listening','');
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition; if(!SR) return;
  try{ _voiceRec&&_voiceRec.stop(); }catch(e){}
  _voiceRec=new SR(); _voiceRec.continuous=false; _voiceRec.interimResults=true; _voiceRec.lang='en-US';
  _voiceRec.onresult=e=>{
    const t=Array.from(e.results).map(r=>r[0].transcript).join('').trim();
    _voiceSetState('listening', t);   // live transcript feedback
    const isFinal=Array.from(e.results).some(r=>r.isFinal);
    if(isFinal && t){ const ta=$('mta'); if(ta){ ta.value=t; } _voiceModeSend(t); }
  };
  _voiceRec.onerror=()=>{ if(_voiceMode) setTimeout(_voiceModeListen, 800); };
  try{ _voiceRec.start(); }catch(e){}
}
async function _voiceModeSend(text){
  _voiceSetState('thinking', text);
  try{ await sendMsg(); }catch(e){}
  // wait for the assistant reply to finish, then speak it and resume listening
  let tries=0;
  const check=()=>{
    if(!_voiceMode) return;
    const msgs=getMsgs(); const last=msgs[msgs.length-1];
    if(last && last.r==='a' && !last.streaming && last.c && !last._error){
      _voiceSetState('speaking','');
      AMVSpeech.speak(typeof last.c==='string'?last.c:'', { onend:()=>{ if(_voiceMode){ _voiceSetState('listening',''); setTimeout(_voiceModeListen, 400); } } });
    } else if(tries++ < 120){ setTimeout(check, 500); }
    else if(_voiceMode){ setTimeout(_voiceModeListen, 400); }
  };
  setTimeout(check, 600);
}
try{ window.speakMessage=speakMessage; window.toggleVoiceMode=toggleVoiceMode; }catch(e){}


function handleFiles(files){
  // Global file limit applies to chat too.
  if(typeof _ctxFileGuard==='function' && !_ctxFileGuard('chat', files&&files.length||1)) return;
  try{ for(const f of (files||[])) _ctxFileTrack('chat', f.name); }catch(e){}
  if(!files||!files.length) return;
  if(files.length===1){ handleFile(files[0]); return; }
  // Multiple: combine text files
  const all=Array.from(files);
  Promise.all(all.map(f=>new Promise(res=>{
    const cat=getFileCat(f);
    const r=new FileReader();
    if(cat==='image'){r.onload=e=>res({kind:'img',name:f.name,b64:e.target.result.split(',')[1],mime:f.type||'image/jpeg',size:f.size});r.readAsDataURL(f);}
    else if(cat==='pdf'){r.onload=e=>res({kind:'pdf',name:f.name,b64:e.target.result.split(',')[1],mime:'application/pdf',size:f.size});r.readAsDataURL(f);}
    else{r.onload=e=>res({kind:'text',name:f.name,data:e.target.result,size:f.size});r.onerror=()=>res({kind:'text',name:f.name,data:'[unreadable]',size:0});r.readAsText(f);}
  }))).then(results=>{
    const imgs=results.filter(r=>r.kind==='image');
    if(imgs.length){ S.att=imgs[0]; }
    else{
      const combined=results.map(r=>'=== '+r.name+' ===\n'+(r.data||'[binary]')).join('\n\n');
      S.att={kind:'text',name:results.map(r=>r.name).join(', '),data:combined,size:0};
    }
    showAttChip();
  });
}
function getFileCat(file){
  const t=file.type;
  if(t.startsWith('image/')) return 'image';
  if(t==='application/pdf') return 'pdf';
  const ext=file.name.split('.').pop().toLowerCase();
  if(['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) return 'image';
  if(ext==='pdf') return 'pdf';
  return 'text';
}
function handleFile(file){
  if(!file) return;
  const cat=getFileCat(file);
  const reader=new FileReader();
  if(cat==='image'){
    reader.onload=e=>{S.att={kind:'img',name:file.name,size:file.size,b64:e.target.result.split(',')[1],mime:file.type||'image/jpeg'};showAttChip();};
    reader.readAsDataURL(file);
  } else if(cat==='pdf'){
    reader.onload=e=>{S.att={kind:'pdf',name:file.name,size:file.size,b64:e.target.result.split(',')[1],mime:'application/pdf'};showAttChip();};
    reader.readAsDataURL(file);
  } else {
    reader.onload=e=>{S.att={kind:'text',name:file.name,size:file.size,data:e.target.result};showAttChip();};
    reader.readAsText(file);
  }
  reader.onerror=()=>toast('Could not read file: '+file.name,'error');
}
/* Is this attachment something the spreadsheet editor can open? Extension and
   MIME both, because a CSV exported by a spreadsheet app often arrives as
   text/csv and one saved by hand often arrives as nothing at all. */
function _attIsSheet(att){
  if(!att || att.kind!=='text' || !att.name) return false;
  const ext=String(att.name).split('.').pop().toLowerCase();
  return ext==='csv' || ext==='tsv';
}
function showAttChip(){
  if(!S.att) return;
  const ab2=$('ab2'),ac=$('ac');
  if(!ab2||!ac) return;
  const icons={img:'🖼',pdf:'📄',text:'📎'};
  const sz=S.att.size?(' ('+fmtSize(S.att.size)+')'):'';
  ac.innerHTML='<span>'+(icons[_attIsSheet(S.att)?'sheet':S.att.kind]||(_attIsSheet(S.att)?'📊':'📎'))+' <strong>'+escH(S.att.name)+'</strong><span style="color:var(--dim);font-size:var(--t-2xs)">'+sz+'</span></span>';

  /* THE SPREADSHEET EDITOR HAD NO DOOR.

     openSheetEditor parses a CSV into a real table with an AI toolbar - analyse
     trends, find duplicates, add totals, download - and handleSheetFile is the
     only thing that opens it. Nothing called handleSheetFile. No file input
     anywhere in the product accepted a spreadsheet, so a working feature with
     its own tests was unreachable, exactly like the Google front door was.

     Attaching stays the default, because asking a question about a file is what
     most people want and what the chat box is for. This is offered ALONGSIDE
     it: the file is on the chip either way, and a CSV also gets a way into the
     editor. Nothing is taken away by adding it. */
  if(_attIsSheet(S.att) && typeof handleSheetFile==='function' && S.att.data!=null){
    const open=document.createElement('button');
    open.type='button';
    open.className='att-open';
    open.textContent=T('Open as table');
    open.title=T('Open this file in the spreadsheet editor');
    open.onclick=()=>{
      /* handleSheetFile takes a File because that is what a file input hands
         it. The text is already read here, so it is handed back in the same
         shape rather than reading it twice or forking the parser - one path
         into the editor, and it is the one the tests already cover. */
      try{
        const name=S.att.name, text=String(S.att.data||'');
        handleSheetFile({ name, text: () => Promise.resolve(text) });
      }catch(e){ try{ toast(T('That file could not be opened as a table.'),'error',4500); }catch(_){} }
    };
    ac.appendChild(open);
  }

  const btn=document.createElement('button');
  btn.textContent='×'; btn.setAttribute('aria-label', T('Remove attachment'));
  btn.style.cssText='background:none;border:none;color:var(--mu);cursor:pointer;font-size:var(--t-base);line-height:1;margin-left:4px';
  btn.onclick=()=>{S.att=null;ab2.style.display='none';};
  ac.appendChild(btn);
  ab2.style.display='flex';
}
function fmtSize(b){ if(b<1024) return b+'B'; if(b<1024*1024) return (b/1024).toFixed(1)+'KB'; return (b/(1024*1024)).toFixed(1)+'MB'; }


/* ── IMAGE AND VIDEO GENERATION LIVED HERE ──────────────────────────────────

   Removed on the owner's instruction: AMV is chat, Crew and Build.

   The costing is why it is worth recording rather than just deleting. Image
   allowances were the dominant term in every plan's economics - 100/day on a
   $15 Pro plan is $120 of exposure, 800% of the price, and Ultra's 2,000/day
   was 1,200%. Removing generation takes the worst case for Pro from $153 to
   $23 and for Ultra from $3,168 to $468, which is the difference between plans
   that cannot be honoured and plans that can.

   Attaching a picture to a chat message is NOT this and stays: it is an input,
   it costs nothing to produce, and it makes chat better. showAttChip and
   fmtSize above are that path. */

/* AMVCurrency sat inside the span that image and video generation were cut
   from, and went with them. _localizePrices survived because it is not part of
   that feature - it is every price on the pricing page - so the removal left a
   function calling an object that no longer existed. It throws inside a
   try/catch, which is the worst version of this: no error anybody sees, and
   every local-currency estimate silently blank for everyone outside the US.
   Deleting a feature means deleting the feature, not the lines near it. */
/* ── LOCAL CURRENCY (display only, USD-pegged) ─────────────────────────────
   Prices are always denominated and CHARGED in US dollars. We show a local-
   currency ESTIMATE for convenience, computed from the USD price at an
   indicative FX rate. Crucially there are NO regional/country discounts: the
   amount is the same real value everywhere, so switching region (VPN, spoofed
   locale) changes only the label, never what you pay. That removes the
   "cheap-country storefront" arbitrage (the Argentina-priced-store trick) and
   keeps billing simple and compliant. Location is inferred from the browser
   locale only - no GPS permission, no precise-location tracking. */
const AMVCurrency = {
  // Indicative USD -> local rates. DISPLAY ONLY.
  FX:{USD:1,EUR:0.92,GBP:0.79,CAD:1.36,AUD:1.52,INR:83,JPY:157,BRL:5.1,MXN:17,ZAR:18.5,AED:3.67,SGD:1.35,CHF:0.88,SEK:10.5,NOK:10.7,DKK:6.9,PLN:4,TRY:32,NZD:1.64,HKD:7.8,KRW:1350,CNY:7.2,PHP:57,IDR:15800,THB:36,MYR:4.7,VND:25000,NGN:1500,EGP:48,ARS:900,CLP:950,COP:3900,SAR:3.75,ILS:3.7,CZK:23,HUF:360,RON:4.6,UAH:40},
  CUR_BY_REGION:{AT:'EUR',BE:'EUR',HR:'EUR',CY:'EUR',EE:'EUR',FI:'EUR',FR:'EUR',DE:'EUR',GR:'EUR',IE:'EUR',IT:'EUR',LV:'EUR',LT:'EUR',LU:'EUR',MT:'EUR',NL:'EUR',PT:'EUR',SK:'EUR',SI:'EUR',ES:'EUR',GB:'GBP',CA:'CAD',AU:'AUD',IN:'INR',JP:'JPY',BR:'BRL',MX:'MXN',ZA:'ZAR',AE:'AED',SG:'SGD',CH:'CHF',SE:'SEK',NO:'NOK',DK:'DKK',PL:'PLN',TR:'TRY',NZ:'NZD',HK:'HKD',KR:'KRW',CN:'CNY',PH:'PHP',ID:'IDR',TH:'THB',MY:'MYR',VN:'VND',NG:'NGN',EG:'EGP',AR:'ARS',CL:'CLP',CO:'COP',SA:'SAR',IL:'ILS',CZ:'CZK',HU:'HUF',RO:'RON',UA:'UAH',US:'USD'},
  region(){ try{ const langs=(navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||'en-US']); for(const l of langs){ const p=String(l).split('-'); if(p[1]) return p[1].toUpperCase(); } }catch(e){} return ''; },
  currency(){ try{ const o=loadStr('amv_currency'); if(o&&this.FX[o]) return o; }catch(e){} const c=this.CUR_BY_REGION[this.region()]; return (c&&this.FX[c])?c:'USD'; },
  isLocal(){ return this.currency()!=='USD'; },
  fmt(usd){ const c=this.currency(); const amt=usd*(this.FX[c]||1); const zero=['JPY','INR','KRW','IDR','VND','CLP','COP','NGN','HUF','ARS'].includes(c)||amt>=1000; try{ return new Intl.NumberFormat(undefined,{style:'currency',currency:c,maximumFractionDigits:zero?0:2}).format(amt);}catch(e){ return c+' '+(zero?Math.round(amt):amt.toFixed(2)); } }
};
try{ window.AMVCurrency=AMVCurrency; }catch(e){}

function _localizePrices(root){
  try{
    root=root||document;
    const local=window.AMVCurrency&&AMVCurrency.isLocal();
    root.querySelectorAll('.px-note').forEach(e=>{ e.style.display=local?'':'none'; });
    root.querySelectorAll('[data-usd]').forEach(el=>{
      const usd=parseFloat(el.getAttribute('data-usd'));
      if(!local || !(usd>0)){ el.textContent=''; el.style.display='none'; return; }
      el.style.display='';
      el.textContent='≈ '+AMVCurrency.fmt(usd)+(el.dataset.per?(' /'+el.dataset.per):'')+' in your currency';
    });
  }catch(e){}
}
try{ window._localizePrices=_localizePrices; }catch(e){}

/* === PLANS === */
function planCards(inApp){
  /* Every tier has to end up with a button that does something.

     `ultra` had no branch, so it fell to the last line - a <button> with no
     handler of any kind. The $200 plan's only in-app buy button did nothing
     when clicked, silently, and it looked identical to the ones that worked.
     The default now routes to checkout, so a tier added later cannot be dead
     by omission; the named branches only exist for the two operator-configured
     payment links. */
  function pBtn(label, cls, plan, isLand){
    if(isLand) return '<button class="plnbtn pbs" data-auth="signup">'+label+'</button>';
    if(plan==='free'){
      /* Nothing to buy. Saying so beats a button that appears to sell the plan
         they are already on - and beats calling openCheckout('free'), which
         would quietly downgrade a paying customer on a single click. */
      const onFree=(loadStr('amv_plan')||'free')==='free';
      return onFree
        ? '<button class="plnbtn pbs" disabled aria-disabled="true">Your current plan</button>'
        : '<button class="plnbtn pbs" data-gs="billing">Manage plan</button>';
    }
    if(plan==='pro' && S.sp) return '<button class="plnbtn pbp" data-dact="_openPlanLink" data-darg="pro">'+label+'</button>';
    if(plan==='elite' && S.se) return '<button class="plnbtn pbs" data-dact="_openPlanLink" data-darg="elite">'+label+'</button>';
    return '<button class="plnbtn '+(plan==='pro'?'pbp':'pbs')+'" data-dact="openCheckout" data-darg="'+escH(plan)+'">'+label+'</button>';
  }
  const isLand=!inApp;
  return [
    '<div class="plnc">'+
      '<div class="plntier">Free</div>'+
      '<div class="plnprice"><sup>$</sup>0</div>'+
      '<div class="plnper">No card required</div>'+
      '<div class="plnanchor">Everything you need to explore</div>'+
      '<div class="plndiv"></div>'+
      '<ul class="plnfl">'+
        '<li><span class="fck">\u2713</span>A monthly allowance, yours to spend how you like</li>'+
        /* Not "images": image generation is gone, and the free card was the
           last place still selling it. 3D stays because it is real - AMV
           writes the interactive model as code and runs it in the preview. */
        '<li><span class="fck">\u2713</span>Chat, code &amp; interactive 3D models</li>'+
        '<li><span class="fck">\u2713</span>File analysis - PDF, images, code</li>'+
        '<li><span class="fck">\u2713</span>Essays, code, math &amp; research</li>'+
        '<li><span class="fxx">\u2717</span>Autonomous agents &amp; Crew</li>'+
        '<li><span class="fxx">\u2717</span>Connected accounts (Gmail, Calendar)</li>'+
      '</ul>'+
      pBtn('Get started free','pbs','free',isLand)+
      '<div class="plnreassure">&nbsp;</div>'+
    '</div>',
    '<div class="plnc feat">'+
      '<div class="plnpop">Most Popular</div>'+
      '<div class="plntier">Pro</div>'+
      '<div class="plnprice"><sup>$</sup>'+PLANS.pro.price+'</div>'+
      '<div class="plnper">per month &middot; cancel anytime</div>'+
      '<div class="plnlocal px-local" data-usd="'+PLANS.pro.price+'" data-per="mo"></div>'+
      '<div class="plnanchor">Replaces $60+/mo of separate AI tools</div>'+
      '<div class="plndiv"></div>'+
      '<ul class="plnfl">'+
        '<li><span class="fck">\u2713</span><b>5× the usage</b>, all models included</li>'+
        '<li><span class="fck">\u2713</span>Autonomous agents &amp; Crew, run from <b>Mission Control</b></li>'+
        '<li><span class="fck">\u2713</span><b>Preview &amp; approve</b> every action before it runs</li>'+
        '<li><span class="fck">\u2713</span><b>Auto Approve</b> for trusted recurring tasks</li>'+
        '<li><span class="fck">\u2713</span>Build &amp; ship real apps in Dev</li>'+
        '<li><span class="fck">\u2713</span>Connect Gmail, Calendar &amp; files</li>'+
        '<li><span class="fck">\u2713</span>Scheduled &amp; background automation</li>'+
      '</ul>'+
      pBtn('Start Pro - $'+PLANS.pro.price+'/mo','pbp','pro',isLand)+
      '<div class="plnreassure">Everything below, one price, cancel anytime</div>'+
    '</div>',
    '<div class="plnc feat feat-elite">'+
      '<div class="plnpop plnpop-elite">Best Value</div>'+
      '<div class="plntier">Elite</div>'+
      '<div class="plnprice"><sup>$</sup>'+PLANS.elite.price+'</div>'+
      '<div class="plnper">per month &middot; cancel anytime</div>'+
      '<div class="plnlocal px-local" data-usd="'+PLANS.elite.price+'" data-per="mo"></div>'+
      '<div class="plnanchor">For founders, builders &amp; power users</div>'+
      '<div class="plndiv"></div>'+
      '<ul class="plnfl">'+
        '<li><span class="fck">\u2713</span><b>Everything in Pro</b>, plus:</li>'+
        '<li><span class="fck">\u2713</span><b>20× the usage</b> - work all day</li>'+
        '<li><span class="fck">\u2713</span><b>AMV Apex first</b> - our most capable engine</li>'+
        '<li><span class="fck">\u2713</span><b>Full-stack app builder</b> + one-click deploy</li>'+
        '<li><span class="fck">\u2713</span>Run up to <b>5 agents in parallel</b></li>'+
        '<li><span class="fck">\u2713</span>Multi-file projects, code review &amp; auto-debug</li>'+
        '<li><span class="fck">\u2713</span>Priority speed &amp; 24/7 support</li>'+
      '</ul>'+
      pBtn('Go Elite - $'+PLANS.elite.price+'/mo','pbs','elite',isLand)+
      '<div class="plnreassure">Full-power engines and agents, without a per-seat bill</div>'+
    '</div>',
    '<div class="plnc">'+
      '<div class="plntier">Ultra</div>'+
      '<div class="plnprice"><sup>$</sup>'+PLANS.ultra.price+'</div>'+
      '<div class="plnper">per month &middot; cancel anytime</div>'+
      '<div class="plnlocal px-local" data-usd="'+PLANS.ultra.price+'" data-per="mo"></div>'+
      '<div class="plnanchor">For serious operators</div>'+
      '<div class="plndiv"></div>'+
      '<ul class="plnfl">'+
        '<li><span class="fck">\u2713</span><b>Everything in Elite</b>, plus:</li>'+
        '<li><span class="fck">\u2713</span><b>50× the usage</b> - effectively unlimited</li>'+
        '<li><span class="fck">\u2713</span><b>Highest throughput</b> - '+_rpmLabel('ultra')+'</li>'+
        '<li><span class="fck">\u2713</span><b>Longest context</b> - whole codebases at once</li>'+
        '<li><span class="fck">\u2713</span>Hand off a goal, get a finished result</li>'+
        '<li><span class="fck">\u2713</span>Deploy &amp; host multiple live apps</li>'+
        '<li><span class="fck">\u2713</span>👥 Team workspaces, roles &amp; shared projects</li>'+
      '</ul>'+
      pBtn('Go Ultra - $'+PLANS.ultra.price+'/mo','pbs','ultra',isLand)+
      '<div class="plnreassure">The highest limits AMV offers</div>'+
    '</div>',
  ].join('');
}
/* Custom plan as a slim full-width banner below the four core tiers. */
/* Teams on the pricing page.

   The per-seat plan is not a step on the four-card ladder - it has no single
   price, because the total depends on how many people are on it - so it gets a
   banner of its own, the same shape Custom uses for the same reason. Without
   this the product had exactly one entry point, on a tab most people never open,
   which is a strange place to keep the thing that makes a company pay you ten
   times as much. */
function _teamPlanBanner(inApp){
  const P=(typeof PLANS!=='undefined'&&PLANS.team)||{price:20};
  const min=(typeof TEAM_SEAT_MIN!=='undefined')?TEAM_SEAT_MIN:3;
  const btn = inApp
    ? '<button class="btn pbp plnbtn cpb-btn" data-stab="team">Set up Teams \u2192</button>'
    : '<button class="btn pbp plnbtn cpb-btn" data-auth="signup">Set up Teams \u2192</button>';
  return '<div class="cpb">'+
    '<div class="cpb-l"><div class="cpb-tier">Teams \u00b7 $'+P.price+' per person / mo</div>'+
      '<div class="cpb-t">Working with other people?</div>'+
      '<div class="cpb-d">Every seat brings its own full allowance into one shared pool, plus Apex for everyone, '+
        'shared projects, a prompt library and roles. Ten people get ten plans\u2019 worth of capacity and one bill - '+
        'not one plan split ten ways. From '+min+' seats, prorated by the day when you add or remove somebody.</div></div>'+
    '<div class="cpb-r">'+btn+'</div>'+
  '</div>';
}
try{ window._teamPlanBanner=_teamPlanBanner; }catch(e){}

function _customPlanBanner(inApp){
  const btn = inApp
    ? '<button class="btn pbp plnbtn cpb-btn" data-dact="openCustomPlan">Build your plan \u2192</button>'
    : '<button class="btn pbp plnbtn cpb-btn" data-auth="signup">Build your plan \u2192</button>';
  return '<div class="cpb">'+
    '<div class="cpb-l"><div class="cpb-tier">Custom \u00b7 from $10/mo</div>'+
      '<div class="cpb-t">Want a plan sized exactly to you?</div>'+
      '<div class="cpb-d">Pick your budget and pay for what you use - all models including Apex, agents and the app sandbox. Hard-capped, so it\u2019s never a surprise charge. Resize or cancel anytime.</div></div>'+
    '<div class="cpb-r">'+btn+'</div>'+
  '</div>';
}




/* === SIDEBAR === */
/* Show or hide the "Recents" heading.

   Three places needed this and all three set style.display directly, which
   `#sb .sbl{display:block!important}` outranked - so the heading sat above an
   empty list and none of the three could do anything about it. One function,
   one class, and the rule that decides it lives in LAYER A117. */
function setHistHeader(show){
  try{ const h=$('hist-header'); if(h) h.classList.toggle('hh-off', !show); }catch(e){}
}
try{ window.setHistHeader=setHistHeader; }catch(e){}
function renderHist(){
  const area=$('hist'); if(!area) return;
  const hdr=$('hist-header');
  const search=($('hist-search')?.value||'').toLowerCase().trim();
  let convs=Array.isArray(S.convs)?S.convs:[];
  if(S.starFilter) convs=convs.filter(c=>c.starred);
  if(search) convs=convs.filter(c=>{
    const inTitle=(c.title||'').toLowerCase().includes(search);
    const inMsgs=c.msgs&&c.msgs.some(m=>typeof m.c==='string'&&m.c.toLowerCase().includes(search));
    return inTitle||inMsgs;
  });
  // Work sessions (Dev/Lab/Studio) appear alongside conversations, unless a
  // star filter is active (sessions aren't starrable).
  let sessions = (!S.starFilter && Array.isArray(_SESSIONS)) ? _SESSIONS.slice() : [];
  if(search) sessions = sessions.filter(s=>(s.title||'').toLowerCase().includes(search) || (SESSION_KINDS[s.kind]?.label||'').toLowerCase().includes(search));
  if(hdr) setHistHeader(!(!search&&!S.starFilter&&!S.convs.length&&!sessions.length));
  if(!convs.length && !sessions.length){
    area.innerHTML = search
      ? '<div class="nh">No results for &ldquo;'+escH(search)+'&rdquo;</div>'
      : S.starFilter
      ? emptyState({svg:'<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',title:'No starred chats yet',sub:'Star a conversation to keep it close - they\u2019ll gather here for quick access.'})
      : emptyState({svg:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',title:'No conversations yet',sub:'Ask AMV anything to get started - your chats and work sessions will show up here.'});
    return;
  }
  // Build a unified, recency-sorted list of rows.
  const convTime=(c)=>c._t||c.updated||c.ts||0;
  const rows=[];
  convs.forEach(c=>rows.push({type:'conv', t:convTime(c), c}));
  sessions.forEach(s=>rows.push({type:'sess', t:s.updated||0, s}));
  // conversations without a timestamp keep their existing array order at the top;
  // if no timestamps exist at all, preserve conv order then sessions.
  const anyConvT=convs.some(c=>convTime(c)>0);
  if(anyConvT || sessions.length){
    rows.sort((a,b)=>(b.t||0)-(a.t||0));
  }

  const sessItemHTML=(s)=>{
    const k=SESSION_KINDS[s.kind]||{label:'Session',icon:''};
    return '<div class="hi hi-sess" data-sid="'+s.id+'">'+
      '<svg class="hiic" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+k.icon+'</svg>'+
      '<span class="hit">'+escH(s.title||k.label)+'</span>'+
      '<span class="hi-kind">'+escH(k.label)+'</span>'+
      '<button class="hidots" title="More" data-sact="menu" data-sid="'+s.id+'" aria-label="Options">'+
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>'+
      '</button>'+
    '</div>';
  };
  const itemHTML=(cv)=>
    '<div class="hi '+(cv.id===S.cur?'on':'')+(cv.starred?' star':'')+'" data-id="'+cv.id+'" data-cid="'+cv.id+'">'+
      '<svg class="hiic" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">'+
        (cv.starred?'<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>':'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>') +
      '</svg>'+
      '<span class="hit">'+escH(cv.title||'New Conversation')+'</span>'+
      '<button class="hidots" title="More" data-hact="menu" data-hid="'+cv.id+'" aria-label="Options">'+
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>'+
      '</button>'+
    '</div>';
  const rowHTML=(r)=> r.type==='sess' ? sessItemHTML(r.s) : itemHTML(r.c);
  const bind=()=>{
    area.querySelectorAll('.hi').forEach(el=>{
      if(el._b) return; el._b=1;
      el.addEventListener('click',e=>{
        const dots=e.target.closest('.hidots');
        if(el.dataset.sid){ // work session row
          if(dots){ e.stopPropagation(); _showSessMenu(dots.getBoundingClientRect(), el.dataset.sid); return; }
          _sessResume(el.dataset.sid); return;
        }
        if(dots){ e.stopPropagation(); const r=dots.getBoundingClientRect(); showConvMenu({preventDefault(){},clientX:r.right,clientY:r.bottom}, dots.dataset.hid); return; }
        loadConv(el.dataset.id);
      });
    });
  };
  /* Every row is rendered. There used to be a threshold here and a second
     branch commented as virtualization for long lists - both branches did the
     same thing, so the only working part was the claim. Saying what the code
     does is worth more than a note describing what it does not: if this ever
     needs windowing, it needs writing, not selecting. */
  area.innerHTML=rows.map(rowHTML).join('');
  bind();
}

// Small menu for a work-session row in Recents: resume or delete.
function _showSessMenu(rect, id){
  document.querySelectorAll('.ctxm').forEach(m=>m.remove());
  const menu=document.createElement('div');
  menu.className='ctxm';
  menu.style.left=Math.min(rect.right, window.innerWidth-200)+'px';
  menu.style.top=(rect.bottom)+'px';
  menu.innerHTML=
    '<div class="ctxi" id="sm-open">↗ Resume</div>'+
    '<div class="ctxi ctxi-danger" id="sm-del">🗑 Delete</div>';
  document.body.appendChild(menu);
  const close=()=>{ menu.remove(); document.removeEventListener('click',close); };
  document.getElementById('sm-open').addEventListener('click',()=>{ close(); _sessResume(id); });
  document.getElementById('sm-del').addEventListener('click',()=>{ close(); _sessDelete(id); toast('Session removed','info'); });
  setTimeout(()=>document.addEventListener('click',close),30);
}

function showConvMenu(e,id){
  e.preventDefault();
  document.querySelectorAll('.ctxm').forEach(m=>m.remove());
  const menu=document.createElement('div');
  menu.className='ctxm';
  menu.style.left=Math.min(e.clientX,window.innerWidth-200)+'px';
  menu.style.visibility='hidden';
  menu.style.top='0px';
  const c=S.convs.find(x=>x.id===id);
  menu.innerHTML=
    '<div class="ctxi" id="cm-open">📂 Open</div>'+
    '<div class="ctxi" id="cm-rename">✏ Rename</div>'+
    '<div class="ctxi" id="cm-star">'+(c?.starred?'☆ Unstar':'★ Star')+'</div>'+
    '<div class="ctxi" id="cm-proj">📁 Add to project</div>'+
    '<div class="ctxi" id="cm-export">⬇ Export as Markdown</div>'+
    '<div class="ctxi" id="cm-share">🔗 Share</div>'+
    '<div class="ctxd"></div>'+
    '<div class="ctxi danger" id="cm-del">🗑 Delete</div>';
  document.body.appendChild(menu);
  (function(){
    const mh=menu.offsetHeight;
    let top=e.clientY;
    if(top+mh > window.innerHeight-8){ top=Math.max(8, e.clientY-mh); }
    menu.style.top=top+'px';
    menu.style.visibility='visible';
  })();
  on($('cm-open'),'click',()=>{ loadConv(id); menu.remove(); });
  on($('cm-rename'),'click',()=>{ renameConv(id); menu.remove(); });
  on($('cm-star'),'click',()=>{ starConv(id); menu.remove(); });
  on($('cm-proj'),'click',()=>{ addToProject(id); menu.remove(); });
  on($('cm-export'),'click',()=>{ exportConv(id); menu.remove(); });
  on($('cm-share'),'click',()=>{ shareConv(id); menu.remove(); });
  on($('cm-del'),'click',()=>{ deleteConv(id); menu.remove(); });
  const close=e2=>{ if(!menu.contains(e2.target)){ menu.remove(); document.removeEventListener('click',close); } };
  setTimeout(()=>document.addEventListener('click',close),50);
}


/* === PROFILE DROPDOWN MENU === */
function showProfMenu(trigger) {
  document.querySelectorAll('.prof-menu').forEach(m=>m.remove());
  const rect=trigger.getBoundingClientRect();
  const u=S.user||{name:'Guest',email:'',ini:'?'};
  const pfp=u.email?loadStr('amv_pfp_'+u.email):'';
  const menu=document.createElement('div');
  menu.className='prof-menu';
  menu.style.cssText='top:'+(rect.bottom+8)+'px;right:'+(window.innerWidth-rect.right)+'px';
  
  const _pk=loadStr('amv_plan')||'free';
  const plan=(PLANS[_pk]&&PLANS[_pk].name)||'Free';
  menu.innerHTML=
    '<div class="prof-header">'+
      '<div style="display:flex;align-items:center;gap:9px;margin-bottom:6px">'+
        '<div style="width:36px;height:36px;border-radius:50%;overflow:hidden;flex-shrink:0">'+
          _avatarInner(u.email)+
        '</div>'+
        '<div>'+
          '<div class="prof-name">'+escH(u.name||'User')+'</div>'+
          '<div class="prof-email">'+escH(u.email||'')+'</div>'+
        '</div>'+
      '</div>'+
      '<span class="badge bb prof-plan">'+plan+' Plan</span>'+
    '</div>'+
    '<button class="prof-item upgrade" id="pm-upgrade">'+
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'+
      'Upgrade Plan</button>'+
    '<button class="prof-item" id="pm-learn">'+
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'+
      'Help &amp; Learn More</button>'+
    '<button class="prof-item" id="pm-settings">'+
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'+
      'Settings</button>'+
    '<button class="prof-item" id="pm-billing">'+
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>'+
      'Manage Subscription</button>'+
    '<button class="prof-item" id="pm-apps">'+
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="2" width="9" height="9" rx="1"/><rect x="13" y="2" width="9" height="9" rx="1"/><rect x="2" y="13" width="9" height="9" rx="1"/><rect x="13" y="13" width="9" height="9" rx="1"/></svg>'+
      'Apps &amp; Extensions</button>'+
    '<div class="prof-divider"></div>'+
    /* Two clearly different exits, plus the shared-computer case in between:
       - Sign out: reversible, your work is waiting when you return.
       - Erase this device: for a school or family computer. Account intact.
       - Delete account: irreversible, removes it from the servers too. */
    '<button class="prof-item" id="pm-signout" title="You can sign back in any time. Your chats and settings will be waiting.">'+
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'+
      '<span>Sign Out<small class="prof-note">You can sign back in</small></span></button>'+
    '<button class="prof-item" id="pm-signout-erase" title="Leave nothing behind on a shared or public computer. Your account stays.">'+
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>'+
      '<span>Sign out &amp; erase this device<small class="prof-note">For a shared or school computer</small></span></button>'+
    '<div class="prof-divider"></div>'+
    '<button class="prof-item danger" id="pm-delete-account" title="Permanently deletes your account. This cannot be undone.">'+
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'+
      '<span>Delete account<small class="prof-note">Permanent. Cannot be undone</small></span></button>';
  document.body.appendChild(menu);
  
  // Wire items
  const close=()=>menu.remove();
  document.getElementById('pm-upgrade')?.addEventListener('click',()=>{ close(); setTab('plans'); });
  document.getElementById('pm-learn')?.addEventListener('click',()=>{ close(); setTab('help'); });
  document.getElementById('pm-settings')?.addEventListener('click',()=>{ close(); S.settingsPane='account'; setTab('settings'); });
  document.getElementById('pm-billing')?.addEventListener('click',()=>{ close(); setTab('billing'); });
  document.getElementById('pm-apps')?.addEventListener('click',()=>{ close(); setTab('apps'); });
  document.getElementById('pm-signout')?.addEventListener('click',()=>{ close(); signOut(); });
  document.getElementById('pm-signout-erase')?.addEventListener('click',()=>{ close(); signOutAndErase(); });
  document.getElementById('pm-delete-account')?.addEventListener('click',()=>{ close(); _confirmDeleteAccount(); });
  setTimeout(()=>document.addEventListener('click',function h(e){if(!menu.contains(e.target)){close();document.removeEventListener('click',h);}},50));
}
/* Show Sign up / Log in in the header ONLY when signed out.
   They sit to the left of New chat and disappear the moment you have an account. */
function _updateHdrAuth(){
  try{
    const signedIn = !!(S.user && S.user.email);
    const su=document.getElementById('hdr-signup');
    const li=document.getElementById('hdr-login');
    if(su) su.hidden = signedIn;
    if(li) li.hidden = signedIn;
  }catch(e){}
}
try{ window._updateHdrAuth=_updateHdrAuth; }catch(e){}

function updateSbUser(){
  try{ _updateHdrAuth(); }catch(e){}
  const u=S.user;
  const pfp=u&&u.email?loadStr('amv_pfp_'+u.email):'';
  const av=$('sb-av')||$('ir-av-inner'),nav=$('nav-av'),nm=$('sb-name'),em=$('sb-email');
  const avInner=$('ir-av-inner');
  if(nm) nm.textContent=u&&u.name?u.name:'Guest';
  if(em){ const _pk=loadStr('amv_plan')||'free'; const _pn=(PLANS&&PLANS[_pk]&&PLANS[_pk].name)||'Free'; em.textContent=(u&&u.email?u.email:'')+(u&&u.email?'  ·  '+_pn:''); }
  [av,avInner,nav].filter(Boolean).forEach(el=>{
    if(!el) return;
    el.style.background=''; el.style.overflow='hidden';
    el.innerHTML=_avatarInner(u&&u.email);
  });
  // Show/hide hist header
  setHistHeader(!!(S.convs&&S.convs.length>0));
  renderHist();
  _renderSbUsage();
}
/* Sidebar usage meter - shows how much of the current window is used, so a user
   sees their limit approaching (and can upgrade before hitting the wall). */
function _renderSbUsage(){
  const el=$('sb-usage'); if(!el) return;
  if(typeof AMVUsage==='undefined'){ el.style.display='none'; return; }
  let st; try{ st=AMVUsage.status(); }catch(e){ el.style.display='none'; return; }
  const pct=Math.min(100, Math.round((st.used/st.cap)*100)||0);
  const plan=(loadStr('amv_plan')||'free');
  const near=pct>=80, full=pct>=100;
  el.style.display='';
  el.innerHTML=
    '<div class="sb-usage-top"><span>'+(full?'Usage full':near?'Usage running low':'Usage')+'</span><span class="sb-usage-pct">'+pct+'%</span></div>'+
    '<div class="sb-usage-bar"><div class="sb-usage-fill" style="width:'+pct+'%;background:'+(full?'#ff4d4d':near?'#e0b341':'var(--accent)')+'"></div></div>'+
    (near&&plan!=='ultra' ? '<button class="sb-usage-upg" data-sb-upgrade="1">Upgrade for more</button>'
      : '<div class="sb-usage-reset">Resets in '+escH(AMVUsage.resetLabel())+'</div>');
  const up=el.querySelector('[data-sb-upgrade]');
  if(up) up.addEventListener('click',()=>{ setTab('plans'); });
}
try{ window._renderSbUsage=_renderSbUsage; }catch(e){}


/* === DASHBOARD === */
function renderDashboard(){
  const vc=$('vc'); if(!vc) return;
  const mc=getMsgs().length,cc=S.convs.length;
  const recent=S.convs.slice(0,5);
  vc.innerHTML=
    '<div class="sv fi"><div class="dash-wrap" style="max-width:1000px;margin:0 auto;display:flex;flex-direction:column;gap:22px">'+
      '<div>'+
        '<h2 style="font-size:var(--t-xl);font-weight:700;letter-spacing:-.4px;margin-bottom:3px">Good '+greeting()+', '+escH(S.user?.name?.split(' ')[0]||'there')+'.</h2>'+
        '<p style="font-size:var(--t-base);color:var(--mu)">Here&#39;s what&#39;s happening with your AMV.AI account.</p>'+
      '</div>'+
      '<div class="dg">'+
        '<div class="dc"><div class="dicon" style="background:rgba(85,144,255,.1)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--indigo)" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><div class="dn">'+cc+'</div><div class="dl">Conversations</div></div>'+
        '<div class="dc"><div class="dicon" style="background:rgba(16,185,129,.1)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round"><path d="M12 2a5 5 0 1 0 5 5H7a5 5 0 0 0 5-5z"/><path d="M12 12v10"/></svg></div><div class="dn">'+S.memory.length+'</div><div class="dl">Memories Saved</div></div>'+
      '</div>'+
      '<div class="ss2"><h3>Quick Actions</h3>'+
        '<div class="qa-g">'+
          '<button class="qab" data-qa="chat"><div class="qai">💬</div><div class="qat">New Chat</div><div class="qad">Start a conversation</div></button>'+
          '<button class="qab" data-qa="prompts"><div class="qai">📚</div><div class="qat">Prompt Library</div><div class="qad">Browse saved prompts</div></button>'+
          '<button class="qab" data-qa="workspaces"><div class="qai">📁</div><div class="qat">Workspaces</div><div class="qad">Organize projects</div></button>'+
          '<button class="qab" data-qa="memory"><div class="qai">🧠</div><div class="qat">AI Memory</div><div class="qad">View saved facts</div></button>'+
        '</div>'+
      '</div>'+
      (recent.length?
        '<div class="ss2"><h3>Recent Conversations</h3>'+
          '<div style="display:flex;flex-direction:column">'+
                        recent.map(c=>'<div class="ait" style="cursor:pointer" data-lcid="'+c.id+'">'+
              '<div class="aiic" style="background:rgba(85,144,255,.1)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--indigo)" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>'+
              '<div><div class="aiit">'+escH(c.title||'New Conversation')+'</div><div class="aitm">'+c.msgs.length+' messages · '+(c.starred?'⭐ Starred · ':'')+new Date(c.created).toLocaleDateString()+'</div></div>'+
            '</div>').join('')+
          '</div>'+
        '</div>':'')+ 
      (isAdmin()?'<div class="ss2"><h3>Platform Status</h3>'+
        '<div class="br2"><span style="color:var(--mu)">AI Engine</span><span style="color:'+(_aiBackendReady()?'var(--green)':'var(--red)')+';font-size:var(--t-sm);font-weight:500">'+(_aiBackendReady()?'✓ Online':'⚠ Backend required')+'</span></div>'+
        /* THE VIDEO ROW IS GONE, AND IT WAS TWO FAULTS IN ONE LINE.

           Video generation was removed from AMV end to end, and this status row
           survived the removal - so the owner's own dashboard carried a
           permanent line for a capability the product does not have, directly
           under the AI engine, which is the one place a status panel must be
           trustworthy.

           It was also unable to say anything else. The row read `S.rl`, and
           `S.rl` is assigned NOWHERE in the bundle - measured, zero writes - so
           it was always undefined, always falsy, always "Not configured", in
           grey, for ever. A status that cannot change is not a status; it is a
           label pretending to be one. */
        (isAdmin()&&!_aiBackendReady()?'<button class="btn bs" data-gs="apikeys" style="margin-top:10px;font-size:var(--t-sm)">Connect backend</button>':'')+
      '</div>':'')+ 
    '</div></div>';
  vc.querySelectorAll('.qab[data-qa]').forEach(b=>on(b,'click',()=>{ if(b.dataset.qa==='chat')newChat(); else setTab(b.dataset.qa); }));
  // Recent conv clicks
  vc.querySelectorAll('[data-lcid]').forEach(el=>on(el,'click',()=>loadConv(el.dataset.lcid)));
}
function greeting(){ const h=new Date().getHours(); return h<12?'morning':h<17?'afternoon':'evening'; }

/* ONE MODAL SHELL, BECAUSE THERE WERE ABOUT TO BE FIVE.

   The mail connect screen, the inbox, the job boards, the coverage board and
   the Telegram connect screen all open the same overlay with the same header
   and the same two ways to close. Four of them had already been written out
   longhand before the duplicate check caught it, and the fifth would have
   been copied from the fourth.

   The close handling is the part worth sharing rather than repeating: the
   backdrop is guarded with `e.target === e.currentTarget` instead of
   stopPropagation, because stopping propagation inside a dialog kills every
   delegated handler on every button in it - which is LESSONS #5, learned once
   already and easy to reintroduce by copying a modal that got it right. */
function _ovShell(o){
  const id = o.id;
  return '<div class="ov" id="'+id+'-bg"><div class="ml-modal'+(o.wide?' cv-modal':'')+
      '" role="dialog" aria-modal="true" aria-labelledby="'+id+'-h">'+
    '<div class="ml-head"><div><div class="eyebrow">'+escH(o.eyebrow||'')+'</div>'+
      '<h2 id="'+id+'-h">'+escH(o.title||'')+'</h2></div>'+
      '<button class="tp-x" id="'+id+'-x" aria-label="Close">\u2715</button></div>'+
    '<div id="'+id+'-body">'+(o.body||'')+'</div>'+
  '</div></div>';
}
function _ovWire(id){
  const r=$('ovr'); if(!r) return;
  onBackdrop($(id+'-bg'),()=>{ r.innerHTML=''; });
  on($(id+'-x'),'click',()=>{ r.innerHTML=''; });
}
window._ovShell=_ovShell; window._ovWire=_ovWire;

