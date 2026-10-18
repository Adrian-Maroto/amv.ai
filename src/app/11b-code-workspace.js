/* ============================================================
   CODE  - AI coding workspace entry
   ============================================================ */
/* WHAT AMV KNOWS ABOUT THIS PROJECT, ON THE SCREEN WHERE IT IS USED.

   Collapsed by default, and absent entirely when there is no connected
   folder, because a memory of nothing is a heading over nothing. The reason
   it is visible at all is that it goes into a prompt: something AMV believes
   about your project that you cannot see and cannot correct is how a helpful
   memory becomes a confidently wrong one. */
function _devRenderProject(){
  const el = $('dev-proj'); if(!el) return;
  try{
    el.innerHTML = (typeof projPanelHTML === 'function') ? projPanelHTML() : '';
    if(typeof projWirePanel === 'function') projWirePanel(el);
  }catch(e){ el.innerHTML = ''; }
}
try{ window._devRenderProject=_devRenderProject; }catch(e){}

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
/* ONE ANSWER TO "IS DEV SHOWING ITS HOME PAGE".

   There were two. renderCodeView decided it when building the markup, and the
   log renderer decided it again on every turn with `!_DEV.log.length` - so the
   moment anything re-rendered the log, the second one overwrote the first.
   That is how "All builds" appeared to do nothing: the flag was set, the view
   was rebuilt correctly, and then the class was recomputed from the log alone
   and put straight back.

   Two places computing the same fact will disagree eventually. This is the
   fact; both ask it. */
function _devIsHome(){
  return !_DEV.log.length || !!_DEV.atHome;
}
try{ window._devIsHome=_devIsHome; }catch(e){}

function renderCodeView(){
  const vc=$('vc'); if(!vc) return;
  /* `atHome` is what makes "All builds" mean anything. Without it the only
     states were "no work" and "the work", so the way out of a project was to
     start a new one - which does not open the old one, it replaces it. Studio
     has had this since it was built; Dev is catching up. */
  const blank = _devIsHome();
  vc.innerHTML = `<div class="dev-shell${blank?' dev-blank':''}" id="dev-shell">
    <div class="dev-chat-pane">
      ${_buildEntryHeadHTML('dev','What should we build?')}
      ${/* Always rendered, hidden by the class. `_devRenderLog()` drops
            `dev-blank` when the first reply lands, so a button gated on the
            render-time value was absent for the whole session that followed. */ ''}
      ${_buildBarHTML('code', true, blank)}

      <div id="dev-hero" class="dev-hero">
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

      <div id="dev-log" class="dev-log" data-no-i18n></div>

      <div id="dev-proj"></div>
      <div id="ctx-dev"></div>
      <div class="dev-input dev-input-v2">
        <select id="dev-lang" class="lab-sel" style="display:none"><option value="js">JavaScript</option><option value="python">Python</option></select>
        <div class="dvq" id="dev-queue" hidden></div>
        <textarea id="dev-msg" rows="1" placeholder="Describe what to build\u2026"></textarea>
        <div class="dvp" id="dev-paste-offer" hidden></div>
        ${_devComposerBarHTML()}
        <input type="file" id="dev-files" multiple style="display:none">
        <input type="file" id="dev-folderinput" webkitdirectory directory multiple style="display:none">
      </div>
      ${blank ? _buildRecentsHTML('dev') : ''}
    </div>

    <div class="dev-split" id="dev-split" role="separator" tabindex="0"
         aria-orientation="vertical" aria-label="Resize the preview"
         title="Drag to resize \u00b7 double-click to reset"></div>

    <div class="dev-preview">
      ${_resultBarHTML({ id:'dev-rb', statusId:'dev-prev-s',
        tabs:[{id:'dev-tab-prev',key:'preview',label:'Preview'},
              {id:'dev-tab-code',key:'code',label:'Code'}],
        actions: _vpSwitchHTML('dev-vp') + `<button class="dev-openext" id="dev-download-proj" title="Download the project"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
          <button class="dev-openext" id="dev-github" title="Push this project to GitHub"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg></button>
          <button class="dev-openext" id="dev-deploy" title="Deploy a shareable page"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h8l-1 8 10-12h-8z"/></svg></button>
          <button class="dev-openext" id="dev-open-ext" title="Open in a new tab"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>` })}
      <div id="dev-prev-body" class="dev-prev-body"><div class="lab-placeholder">Your live result appears here.</div></div>
      <div id="dev-code-body" class="dev-code-body" style="display:none"><div class="dev-code-layout"><div class="dev-tree" id="dev-tree"></div><div class="dev-code-main" id="dev-code-main"><div class="lab-placeholder">The code appears here as AMV writes it.</div></div></div></div>
    </div>
  </div>`;
  _wireBuildModes(vc);
  // hero chips fill the composer
  vc.querySelectorAll('#dev-hero-chips [data-dq]').forEach(c=>on(c,'click',()=>{
    const t=$('dev-msg'); if(t){ t.value=c.dataset.dq; t.focus(); t.style.height='auto'; t.style.height=Math.min(t.scrollHeight,140)+'px'; }
  }));
  _devRenderQueue();
  _devRenderLog();
  _devRenderProject();
  const ta=$('dev-msg');
  on(ta,'input',()=>{ ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,140)+'px';
    /* The offer goes away as soon as what it describes does. */
    if(!_looksLikeCode(ta.value)){ const h=$('dev-paste-offer'); if(h && !h.hidden){ h.innerHTML=''; h.hidden=true; } }
  });
  /* Read AFTER the paste has landed, so this sees the text rather than the
     clipboard - which is also the only way it works for drag-and-drop and
     for a middle-click paste. */
  on(ta,'paste',()=>{ setTimeout(()=>_devOfferPaste(ta.value), 0); });
  on(ta,'keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); _devSend(); } });
  on($('dev-send'),'click',_devSend);
  /* Whichever turn is running. The agent's stop lands between steps; the
     in-browser one lands between continuations. Both say so on the busy line
     rather than appearing to do nothing until the current piece of work is
     over, because a Stop with no acknowledgement gets pressed again. */
  on($('dev-stop'),'click',()=>{
    _DEV.stop=true;
    /* And the round in the air: named to the server, then cut (_aiStopLink). */
    try{ if(_DEV.ctrl) _DEV.ctrl.abort(); }catch(e){}
    try{ if(typeof _AGENT!=='undefined' && _AGENT && _AGENT.running) _agentStop(); }catch(e){}
    try{ _devBusy(true,'Stopping'); }catch(e){}
    try{ _devRenderQueue(); }catch(e){}
  });
  /* The two composer decisions that are not the message itself. Both persist,
     because somebody who has said "just apply it" once should not have to say
     it again every time they open Build. */
  on($('dev-apply-mode'),'change',function(){
    const m=_devSetApplyMode(this.value);
    toast(m==='auto' ? 'Changes will be applied as soon as they are ready.'
                     : 'You will be asked before any change is applied.','info',3000);
  });
  on($('dev-effort'),'change',function(){ _devSetEffort(this.value); });
  on($('dev-lang'),'change',()=>{ _DEV.lang=$('dev-lang').value; });
  $('dev-lang').value=_DEV.lang;
  // section model picker + live usage note
  const devUsage=()=>{ const n=$('dev-usage-note'); if(n){ n.textContent=''; } };
  devUsage();
  on($('dev-model'),'change',function(){ _setSectionModel('code', this.value); devUsage(); toast('Code model set to '+MODELS[this.value].label,'info',2500); });
  // Code/Preview toggle (Terminal removed - Dev is a build-and-preview surface)
  /* Selection state and aria live in _wireResultTabs now, so this only does the
     part that is Dev's: which body is on screen. */
  const showPV=(pv)=>{ const pb=$('dev-prev-body'),cb=$('dev-code-body');
    if(cb) cb.style.display = pv==='code' ? 'block' : 'none';
    if(pb) pb.style.display = pv==='code' ? 'none' : 'flex';
    /* Switching TO the preview is somebody asking to see it, which is the
       moment it has to be there - not the moment a run happens to end.

       AND THE SAME IS TRUE OF THE CODE, which it was not. Only a build turn
       ever filled the code pane, so arriving at Code with a project already
       loaded - from an upload, from a restored session, from a paste - gave
       you "The code appears here as AMV writes it" above a project full of
       files. The file is right there; the pane just never asked for it. */
    if(pv==='code'){ try{ _devRenderTree(); _devShowActive(); }catch(e){} }
    else { try{ _devPaintPreview(); }catch(e){} } };
  _wireVpSwitch('dev-vp', ()=>document.querySelector('#dev-prev-body .dev-prev-frame'));
  _wireResultTabs('dev-rb', showPV);
  /* And on arrival, so re-opening Build with a project already in it shows the
     project rather than an empty promise - on both panes, for the same
     reason. */
  try{ _devPaintPreview(); }catch(e){}
  try{ if(_devProjectFiles().length){ _devRenderTree(); _devShowActive(); } }catch(e){}
  on($('dev-open-ext'),'click',()=>_devOpenExternal());
  _wireBuildRecents(vc);
  _wireSplit('dev-split', 'dev-shell');
  /* Back to the page that lists the builds. The work is already saved and stays
     listed, so this is a navigation rather than a discard - which is the
     difference between it and the new-build control beside it. */
  /* LEAVE, NOT JUST SAVE. This called `_sessFlush`, which writes the work to
     Recents and LEAVES IT BOUND as the active session, and it never cleared the
     working state. So the next thing you built carried the last conversation
     with it: "go back then go to build again and make another - it should not
     be part of the same chat". It was, and it also wrote itself over the
     session you had just left.

     `_sessLeave` is the primitive that already meant this - flush, then unbind -
     and the state is reset behind it so the next build starts empty. Nothing is
     lost: the flush happens first, the session is listed, and opening it from
     Recents restores it exactly. */
  on($('bld-home'),'click',()=>{
    try{ _sessLeave('dev'); }catch(e){}
    try{ _resetToolState('dev'); }catch(e){}
    _DEV.atHome=true;
    renderBuildView();
  });
  on($('dev-download-proj'),'click',()=>_devDownloadProject());
  on($('dev-deploy'),'click',()=>_devDeploy());
  on($('dev-github'),'click',()=>_devPushToGitHub());
  /* Falls back through the project rather than trusting one pointer: the file
     that is open, else the entry file, else anything in the project, else
     whatever is in the editor. Refusing while holding the code is the failure
     this is guarding against. */
  on($('dev-tolab'),'click',()=>{ const code=(_DEV.activePath && _DEV.project[_DEV.activePath]?.content)
      || _DEV.project[_devEntryFile()]?.content
      || (_devProjectFiles().map(p=>_DEV.project[p]?.content).find(Boolean))
      || _DEV.curCode; if(code){ _LAB_HANDOFF=code; setTab('lab'); toast('Sent to Lab for debugging','info'); } else { toast('Build something first, then send it to Lab','info'); } });
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
    /* WHAT WAS NOT LOADED, AND WHY, INSTEAD OF A SUCCESS MESSAGE ABOUT NOTHING.

       The ceiling was 800,000 bytes and a file over it was skipped by an `if`
       with no else - so nothing was recorded, nothing was said, and the toast
       underneath reported "Loaded 0 files" as a SUCCESS. Measured: a
       10,000-line file with normal line lengths is 544KB and loads; the same
       10,000 lines at ninety columns is 1MB and vanished, cheerfully.

       A success message about zero files is worse than an error, because it
       tells somebody the thing they just did worked. */
    let added=0; const tooBig=[], notText=[];
    for(const file of Array.from(fileList||[])){
      const isText=/\.(txt|md|csv|json|js|mjs|ts|jsx|tsx|html|css|py|java|c|cpp|go|rs|rb|php|sql|sh|xml|yml|yaml|vue|svelte|scss|less)$/i.test(file.name)||(file.type||'').startsWith('text');
      if(!isText){ notText.push(file.name); continue; }
      if(file.size>=DEV_MAX_FILE_BYTES){ tooBig.push(file.name); continue; }
      const text=await file.text(); const path=file.webkitRelativePath||file.name; _devSetFile(path, text); added++;
    }
    _DEV.activePath=_DEV.activePath||_devEntryFile(); _devRenderTree(); _devShowActive();
    /* Uploading a site and seeing it is one action, not two. */
    try{ _devPaintPreview(); }catch(e){}
    const total=_devProjectFiles().length;
    const plural=(n,w)=>n+' '+w+(n===1?'':'s');
    if(added){
      _devPushSys('Loaded '+plural(added,'file')+' - project now has '+total+'. Ask me to build, fix, or refactor across them.');
      _devRenderLog();
    }
    const skipped=[];
    if(tooBig.length) skipped.push(plural(tooBig.length,'file')+' over '+Math.round(DEV_MAX_FILE_BYTES/1e6)+'MB ('+tooBig.slice(0,3).join(', ')+(tooBig.length>3?', …':'')+')');
    if(notText.length) skipped.push(plural(notText.length,'file')+' that is not text ('+notText.slice(0,3).join(', ')+(notText.length>3?', …':'')+')');
    if(added && !skipped.length) toast('Loaded '+plural(added,'file'),'success',3500);
    else if(added) toast('Loaded '+plural(added,'file')+'. Skipped '+skipped.join(' and ')+'.','info',7000);
    else toast('Nothing was loaded: '+skipped.join(' and ')+'.','error',7000);
    if(skipped.length){ _devPushSys('Not loaded: '+skipped.join('; ')+'.'); _devRenderLog(); }
  };
  const addMenu=$('dev-add-menu');
  on($('dev-add'),'click',(e)=>{ e.stopPropagation();
    if(!addMenu) return;
    const open = addMenu.style.display==='none';
    addMenu.style.display = open ? 'block' : 'none';
    /* The button says whether the menu is open, so a screen reader is not
       told there is a menu and left to guess. */
    try{ e.currentTarget.setAttribute('aria-expanded', open ? 'true' : 'false'); }catch(_e){}
  });
  // The hero's obvious upload button opens the same menu.
  on($('dev-hero-add'),'click',(e)=>{ e.stopPropagation(); if(addMenu) addMenu.style.display=addMenu.style.display==='none'?'block':'none'; });
  /* ONE listener, not one per render.

     This added an anonymous document-level handler every time the Dev view
     rendered, and removed none of them - so switching to Dev fifty times left
     fifty handlers running on every click in the product for the rest of the
     session. Named and de-duplicated: the handler closes over nothing but the
     id, so a single one does the job for every render. */
  if(!window._devAddMenuCloser){
    window._devAddMenuCloser=()=>{ const mnu=document.getElementById('dev-add-menu'); if(mnu) mnu.style.display='none'; };
    document.addEventListener('click',window._devAddMenuCloser);
  }
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
/* AMV IN VS CODE. The dialog lives in api-keys.js beside the download it
   offers (`_vscDialog`), fetched the first time somebody asks - most people
   never do, so the page does not carry it. */
function _devConnectVSCode(){
  return _apiKeysLoad().then(ok => {
    if(ok && typeof window._vscDialog === 'function'){ window._vscDialog(); return true; }
    toast(T('The extension could not be loaded. Check your connection and try again.'), 'error', 6000);
    return false;
  });
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
function _devSetFile(path, content, lang){ path=_safePath(path)||('file'+Date.now()); _DEV.project[path]={ content, lang:lang||_devLangFor(path), ts:Date.now() }; /* AN ACTIVE PATH THAT NAMES NOTHING IS WORSE THAN NONE.

     This only claimed the path when there was no active one, so a project
     cleared and refilled - which is what "New session" and every import does -
     left activePath pointing at a file that no longer exists. Everything that
     reads the active file then gets undefined and behaves as if the project is
     empty: "Send to Lab" refuses with "Build something first, then send it to
     Lab" while a file sits in the list beside it.

     So: claim it when nothing is active, and also when whatever IS active is
     no longer in the project. */
  if(!_DEV.activePath || !_DEV.project[_DEV.activePath]) _DEV.activePath=path; try{ _sessTouch('dev'); }catch(e){} }
function _devLangFor(path){ const e=(path.split('.').pop()||'').toLowerCase(); return ({js:'js',mjs:'js',jsx:'js',ts:'js',tsx:'js',py:'python',html:'html',css:'css',json:'json',md:'md'})[e]||'txt'; }
function _devEntryFile(){
  const files=_devProjectFiles();
  return files.find(p=>/index\.html$/i.test(p)) || files.find(p=>/\.html$/i.test(p)) ||
         files.find(p=>/(index|main|app)\.(js|mjs|py)$/i.test(p)) || files.find(p=>/\.(js|py)$/i.test(p)) || files[0] || '';
}
/* WHAT THE MODEL ACTUALLY GETS TO READ.

   Two things were wrong here, and together they meant a large file was
   uploaded, accepted, confirmed on screen - and then not read at all.

   THE BUDGET. 16,000 characters is about 4,000 tokens. The product declares a
   usable context of 180,000 tokens and draws the user a meter against that
   number, so this was spending two per cent of the budget it advertises. It
   is derived from the same constant now, so the two cannot drift apart.

   THE ALL-OR-NOTHING. Each file was one chunk, and a chunk that did not fit
   was not shortened - the loop appended "[...truncated...]" and BROKE. So a
   single file bigger than the budget contributed nothing whatsoever, and
   every file after it was dropped too. Measured on a 544KB upload that had
   just been confirmed as loaded: the model received 71 characters, which was
   the file list and the word truncated.

   A file too big to include whole now contributes its beginning and says how
   much was left out, which is what somebody reading a large file would do. */
function _devProjectContext(maxChars){
  /* Derived, not restated: a bit over half the declared budget goes to the
     project, leaving the rest for the conversation, memory and the request. */
  maxChars = maxChars || Math.floor(CTX_LIMIT_TOKENS * 0.55) * 4;
  const files=_devProjectFiles();
  if(!files.length) return '';
  let out='CURRENT PROJECT ('+files.length+' files):\n'+files.map(p=>'- '+p).join('\n')+'\n\nFILE CONTENTS:\n';
  let shown=0;
  for(const p of files){
    const room = maxChars - out.length;
    /* Not enough left for a header and anything under it, so stop and say how
       many files never made it rather than implying the list was complete. */
    if(room < 300){ out += '\n[...'+(files.length-shown)+' more file(s) not included - the project is larger than one request can carry...]\n'; break; }
    const body = String((_DEV.project[p] && _DEV.project[p].content) || '');
    const head = '\n===== '+p+' =====\n';
    if(head.length + body.length + 1 <= room){ out += head + body + '\n'; }
    else {
      const keep = Math.max(0, room - head.length - 140);
      out += head + body.slice(0, keep)
          + '\n[...'+(body.length-keep).toLocaleString()+' more characters of this file not included...]\n';
    }
    shown++;
  }
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
/* THE CODE PANE IS WHERE YOUR CODE IS, SO IT IS WHERE YOU EDIT IT.

   This was a `<pre>`. You could read the file AMV wrote and copy it, and to
   change one character you had to ask the model to do it for you - which
   costs a turn, costs money, and can come back having rewritten three other
   things. A build surface whose code you cannot touch is a demo of a build
   surface.

   Edits go straight into the project and the preview follows them, debounced
   so a fast typist is not re-assembling the whole page on every keystroke.
   No changelist card: this change is the person's own, they are looking
   right at it, and a card telling somebody what they just typed is noise. */
let _devEditTimer = null;
function _devShowActive(){
  const main=$('dev-code-main'); if(!main) return;
  const p=_DEV.activePath; const f=p&&_DEV.project[p];
  if(!f){ main.innerHTML='<div class="lab-placeholder">Select a file.</div>'; return; }
  main.innerHTML='<div class="dev-code-wrap"><div class="dev-code-h">'+escH(p)
    +'<span class="dev-code-saved" id="dev-code-saved" role="status" aria-live="polite"></span>'
    +'<button class="dev-copy" data-code="'+encodeURIComponent(f.content)+'">copy</button></div>'
    +'<textarea class="dev-code-ed" id="dev-code-ed" spellcheck="false" autocapitalize="off" autocorrect="off"'
    +' aria-label="'+escH(p)+' - editable"></textarea></div>';
  const ed=$('dev-code-ed');
  /* Set as a VALUE, never as markup: this is somebody's file and it is very
     often HTML. */
  if(ed) ed.value=f.content;
  main.querySelectorAll('.dev-copy').forEach(btn=>on(btn,'click',()=>{navigator.clipboard&&navigator.clipboard.writeText(decodeURIComponent(btn.dataset.code));btn.textContent='copied';setTimeout(()=>btn.textContent='copy',1200);}));
  on(ed,'input',()=>{
    const path=_DEV.activePath; const file=path&&_DEV.project[path];
    if(!file) return;
    file.content=ed.value; file.ts=Date.now();
    const note=$('dev-code-saved'); if(note) note.textContent='editing\u2026';
    clearTimeout(_devEditTimer);
    _devEditTimer=setTimeout(async ()=>{
      try{ _devPaintPreview(); }catch(e){}
      try{ _sessTouch('dev'); }catch(e){}
      /* A connected folder is a folder somebody expects to match what they
         see. Leaving hand edits out of it is how the two drift apart. */
      let saved=false;
      try{
        if(AMVWorkspace.dirHandle){ await AMVWorkspace.writeFile(path, file.content); saved=true; }
      }catch(e){}
      const n=$('dev-code-saved'); if(n) n.textContent=saved?'saved to folder':'preview updated';
      setTimeout(()=>{ const x=$('dev-code-saved'); if(x) x.textContent=''; }, 2200);
    }, 300);
  });
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
      const name=p.split('/').pop()||'file.txt';
      amvDownload(name, f.content||'', 'text/plain');
      toast('Downloaded '+name,'success',2500); return;
    }
    // Multiple files: build a single self-describing bundle with clear separators.
    let bundle='/* AMV project export - '+paths.length+' files.\n';
    bundle+='   Each file is delimited by a ==== FILE: path ==== header. */\n\n';
    paths.forEach(p=>{ bundle+='/* ==== FILE: '+p+' ==== */\n'+(files[p].content||'')+'\n\n'; });
    amvDownload('amv-project.txt', bundle, 'text/plain');
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
  const d = await _autoApi(path, body);
  /* A first publish comes back with a way to take it down again, from every
     surface that publishes - the code workspace, Dev's own tools and chat all
     come through here. An update says it cannot be, and offers nothing. */
  const u = path === '/deploy' && d && d.receipt && d.receipt.undo;
  if(u && u.slug){
    try{
      toastAction(T('Page published'), T('Undo'), async () => {
        try{
          await _autoApi('/deploy/delete', { slug: u.slug });
          if(_DEV && _DEV.deploySlug === u.slug) _DEV.deploySlug = null;
          toast(T('Page taken down'), 'success', 5000);
        }catch(e){ toast(e.message || T('That could not be undone.'), 'error', 8000); }
      }, 30000);
    }catch(e){}
  }
  return d;
}

/* THE MOMENT SOMEBODY MOST WANTS TO PAY.

   Publishing to a live URL is an Elite feature, and the server enforces that
   with code:'plan_required'. The client turned that into "Deploy failed: ..."
   in a red error toast - which is wrong twice. It is not a failure, and the
   person hitting it has just finished building something and wants it on the
   internet. That is the highest-intent second in the whole product, and it was
   being answered with an error and no way forward.

   So a plan refusal is answered as a tier, with the way to lift it one tap
   away. Everything else stays an error, because everything else IS one - and
   the two are told apart by the machine-readable code rather than by matching
   on prose, which is how that goes wrong the first time the wording changes. */
function _deployRefusal(e, what){
  const code = e && e.code;
  if(code === 'plan_required'){
    const msg = String((e && e.message) || 'Publishing to a live URL is part of Elite.');
    try{ toastAction(msg, 'See plans', ()=>{ try{ setTab('plans'); }catch(_){} }, 9000); }
    catch(_){ toast(msg, 'info', 7000); }
    return true;
  }
  if(e && e.message === 'not-connected'){
    toast('Connect the AMV engine in Settings to publish a live URL. You can still download '+(what||'it')+'.','error',6000);
    return true;
  }
  return false;
}
try{ window._deployRefusal = _deployRefusal; }catch(e){}

/* One card for "this is a tier, not a fault", wherever the refusal surfaces.
   The button is `data-stab`, the delegated route to a tab that already exists,
   so it keeps working inside panes that are re-rendered wholesale. */
function _planUpsellCardHTML(title, msg){
  return '<div class="deploy-tier"><b>'+escH(title||'Part of Elite')+'</b>'+
         '<p>'+escH(String(msg||''))+'</p>'+
         '<button class="btn bp" data-stab="plans">See plans \u2192</button></div>';
}
try{ window._planUpsellCardHTML = _planUpsellCardHTML; }catch(e){}

async function _devDeploy(){
  let html='';
  try{ html=_devProjectPreviewHTML()||_DEV.lastHTML||''; }catch(e){ html=_DEV.lastHTML||''; }
  if(!html||!html.trim()){ toast('Build something first - then Deploy puts it live at a real URL.','info',4000); return; }

  const title=(_DEV.activePath?_DEV.activePath.split('/').pop().replace(/\.\w+$/,''):'My app')||'My app';

  if(!(window.AMV_API && AMV_API.live && AMV_API.hasSession)){
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
    if(!_deployRefusal(e, 'the file')) toast('Deploy failed: '+e.message,'error',5000);
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
    '<input id="er-tok" class="inp" type="password" placeholder="ADMIN_TOKEN" autocomplete="new-password">'+
    '<p class="share-sub" style="margin-top:8px;font-size:var(--t-xs)">Kept in memory for this tab only - never written to this device.</p>'+
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

/* A PREVIEW THAT ACTUALLY RUNS THE THING.

   Every preview in the product was an <iframe srcdoc>, and every one of them
   silently refused to run a single line of the app's JavaScript. An iframe
   whose document comes from a local scheme - about:srcdoc, blob:, data: -
   INHERITS the embedding page's Content-Security-Policy, and AMV's policy
   pins script-src to three hashes on purpose. So the browser answered every
   generated app with "Refused to execute inline script".

   Styling was unaffected, which is what made it so confusing to report: a
   page with its CSS inline looked almost right and did nothing, and a page
   that builds its own content in JavaScript - a to-do app, a game, a
   dashboard, most of what "build an app" produces - drew as a white page with
   black text. That is exactly how it was described, and it was not a styling
   bug at all.

   Measured before deciding: srcdoc and blob: are refused identically, because
   the inheritance rule covers both. A document fetched from a REAL URL gets
   its own policy instead, so previews now load preview.html - a real file,
   carrying no policy of its own - and receive the page by postMessage.

   The frame stays sandboxed WITHOUT allow-same-origin, so the preview runs in
   an opaque origin and cannot reach AMV's cookies, storage or DOM even though
   the file is served from AMV's origin. The only CSP change is 'self' added
   to frame-src, which lets AMV frame AMV and nothing else; frame-ancestors
   stays 'none', so nobody can frame AMV. script-src is untouched. */
const PREVIEW_DOC = 'preview.html';
/* Handed the html up front and posted on load, so there is no window in which
   the frame is up and empty. A fresh src per render because the preview
   document becomes the page it was given - the listener goes with it, and a
   reload is what "show me this instead" honestly means. */
function _previewSend(frame, html){
  if(!frame) return frame;
  const body = String(html == null ? '' : html);
  /* A frame can be handed a second page later. Clear any note an earlier
     degraded render left beside it, or they stack up one per render. */
  try{
    const h = frame.parentNode;
    if(h){
      [...h.querySelectorAll('.prev-degraded')].forEach(n => n.remove());
      h.classList.remove('prev-degraded-host');
    }
  }catch(e){}
  const send = () => { try{ frame.contentWindow.postMessage({ __amv:'preview', html:body }, '*'); }catch(e){} };
  /* IF THE PREVIEW DOCUMENT IS NOT THERE, SAY SO.

     preview.html is a second file, and a host that answers an unknown path
     with index.html would frame AMV inside AMV - which looks like a bizarre
     rendering bug rather than a missing file, and would have been very hard
     to diagnose from a screenshot. The document announces itself on load, so
     its silence is the signal: no greeting, no preview, and a sentence naming
     the file instead of a picture of the app looking at itself. */
  let settled = false;
  const hear = (e) => {
    if(!frame.contentWindow || e.source !== frame.contentWindow) return;
    if(e.data && e.data.__amv === 'preview-ready'){ settled = true; try{ window.removeEventListener('message', hear); }catch(_e){} }
  };
  try{ window.addEventListener('message', hear); }catch(e){}
  const degrade = () => {
    if(settled) return;
    settled = true;
    try{ window.removeEventListener('message', hear); }catch(e){}
    /* FALL BACK TO WHAT WORKED YESTERDAY, AND SAY WHAT IS MISSING.

       An error message and nothing else would make a hosting mistake worse
       than the bug it replaced: before today the preview at least DREW the
       page, it only refused to run it. So the old path is still here as the
       degraded one - srcdoc, which renders the markup and the styling under
       the page's own policy - with one line saying scripts are not running
       and naming the file that would fix it.

       Honest rather than quiet: somebody gets a preview, and knows exactly
       why it is the lesser one.

       THE SAME FRAME, NOT A REPLACEMENT. An earlier version emptied the host
       and appended a fresh iframe, which quietly threw away everything the
       rest of the product had attached to the element: Studio finds its
       canvas by id, and the viewport switcher styles the element it finds -
       so a degraded preview silently broke the phone and tablet buttons. The
       degradation is about where the page comes from, and nothing else about
       the frame should change. */
    try{
      const host = frame.parentNode; if(!host) return;
      const note = document.createElement('div');
      note.className = 'prev-degraded';
      note.textContent = 'Showing this without scripts: ' + PREVIEW_DOC + ' is not being served, '
        + 'so anything the page builds or does in JavaScript will not run here.';
      /* Both hosts are flex ROWS, so a plain sibling lands beside the frame
         rather than above it. The class lets them wrap for as long as they
         are degraded; the note claims a whole line. */
      try{ host.classList.add('prev-degraded-host'); }catch(_e){}
      host.insertBefore(note, frame);
      frame.removeAttribute('src');
      frame.srcdoc = body;
    }catch(e){}
  };
  /* WHEN TO STOP WAITING, AND WHY IT TAKES TWO ANSWERS.

     The only real signal is the greeting: preview.html says hello, or nothing
     is serving it. Everything else here is a deadline, and the deadline was
     a flat four seconds - a guess about how fast somebody else's machine and
     network are, which on a slow connection declares a preview missing while
     it is still on its way.

     Arming from the frame's own load is the better question, and on its own
     it is not enough. Measured rather than assumed: a host that answers an
     unknown path with the app itself frames a 1.3MB document whose load event
     waits on its subresources, and in that case load had not fired after five
     seconds - so a load-only rule leaves an empty rectangle for as long as
     that takes.

     So both. A short grace after load answers quickly in the common case,
     where whatever came back instead is small and lands immediately, and a
     ceiling covers the case where the wrong document is heavy or the response
     never completes at all. Whichever comes first. */
  frame.addEventListener('load', () => { send(); setTimeout(degrade, 1500); }, { once:true });
  setTimeout(degrade, 8000);
  frame.removeAttribute('srcdoc');
  frame.src = PREVIEW_DOC + '?r=' + Date.now().toString(36);
  return frame;
}
/* Fills a host element with a preview frame. Replaces innerHTML the way the
   old srcdoc line did, so call sites read the same. */
function _previewMount(host, html, cls){
  if(!host) return null;
  host.innerHTML='';
  const f=document.createElement('iframe');
  f.className=cls||'dev-prev-frame';
  /* Set through the property, which is what every other frame in the codebase
     uses and what the sandbox check reads - and set BEFORE any src, because
     assigning it afterwards is too late in some browsers. */
  f.sandbox='allow-scripts';
  host.appendChild(f);
  return _previewSend(f, html);
}
/* SOME PREVIEWS ARE BUILT AS HTML STRINGS, NOT AS ELEMENTS.

   The live cards in chat are assembled into a string and dropped into the
   document, so there is no element to hand a page to at the time it is
   written. They carry the page in data-amv-preview instead, and this turns
   each one into a real preview once it is in the DOM.

   An observer rather than a call after each render, because the cards are
   written from several places and a hydrator wired into four of five is the
   same silent half-failure this whole change is about. */
function _previewHydrate(root){
  let list=[];
  try{ list=(root||document).querySelectorAll('iframe[data-amv-preview]'); }catch(e){ return; }
  list.forEach(f=>{
    const html=f.getAttribute('data-amv-preview')||'';
    f.removeAttribute('data-amv-preview');
    _previewSend(f, html);
  });
}
try{
  const _mo=new MutationObserver(()=>{ try{ _previewHydrate(document); }catch(e){} });
  const _start=()=>{ try{ _mo.observe(document.body,{ childList:true, subtree:true }); _previewHydrate(document); }catch(e){} };
  if(document.body) _start(); else document.addEventListener('DOMContentLoaded', _start, { once:true });
}catch(e){}
try{ window._previewMount=_previewMount; window._previewSend=_previewSend; window._previewHydrate=_previewHydrate; }catch(e){}

/* SHOW THE PREVIEW OF WHAT IS ALREADY HERE, NOT ONLY OF WHAT WAS JUST RUN.

   The preview pane was filled in exactly one place - the tail of
   _devShowResult, guarded by `if(pb && run)`. So it appeared only as the
   result of a run, and never from code that was simply present. Open a
   project, upload a folder, click Preview: the pane said "Your live result
   appears here" and went on saying it, with a complete web page sitting in
   the project three feet away.

   The maddening part is that the machinery was already finished.
   _devProjectPreviewHTML bundles the html, css and js into one document, and
   BOTH "Open in browser" and "Deploy" already call it - so the same project
   would open correctly in a new tab and deploy correctly to a real URL while
   showing nothing at all on the screen somebody is looking at. Correct at
   both ends, never joined in the middle.

   It refuses to overwrite the output of a run: a Python file's stdout is the
   result for that file, and repainting a web page over it would be losing the
   answer. And a project with no page in it says so, rather than leaving a
   promise that nothing is going to keep. */
function _devPaintPreview(){
  const pb=$('dev-prev-body'); if(!pb) return false;
  /* A run's own output stays. Only a placeholder or an existing frame is
     replaced, which is read off the DOM rather than tracked in a flag that
     could drift out of step with what is on screen. */
  if(pb.querySelector('.dev-prev-out')) return false;
  let html='';
  try{ html=_devProjectPreviewHTML()||_DEV.lastHTML||''; }catch(e){ html=_DEV.lastHTML||''; }
  if(html && html.trim()){
    _previewMount(pb, html, 'dev-prev-frame');
    return true;
  }
  let files=[]; try{ files=_devProjectFiles(); }catch(e){}
  pb.innerHTML = files.length
    ? '<div class="lab-placeholder">There is no web page in these '+files.length+' file'+(files.length>1?'s':'')
      +', so there is nothing for a browser to draw. Run them and the output appears here.</div>'
    : '<div class="lab-placeholder">Your live result appears here.</div>';
  return false;
}
try{ window._devPaintPreview=_devPaintPreview; }catch(e){}
function _devShowResult(code,lang,run){
  // remember the latest runnable HTML so "Open in browser" can use it
  try{ if(run && run.html) _DEV.lastHTML = run.html; }catch(e){}
  // Code pane
  const cb=$('dev-code-body');
  if(cb){ cb.innerHTML='<div class="dev-code-wrap"><div class="dev-code-h">'+escH(lang||'code')+'<button class="dev-copy" data-code="'+encodeURIComponent(code)+'">copy</button></div><pre>'+escH(code)+'</pre></div>'; cb.querySelectorAll('.dev-copy').forEach(btn=>on(btn,'click',()=>{navigator.clipboard&&navigator.clipboard.writeText(decodeURIComponent(btn.dataset.code));btn.textContent='copied';setTimeout(()=>btn.textContent='copy',1200);})); }
  // Preview pane
  const pb=$('dev-prev-body');
  if(pb && run){
    if(run.html){ _previewMount(pb, run.html, 'dev-prev-frame'); }
    else pb.innerHTML='<div class="dev-prev-out '+(run.ok?'ok':'err')+'"><pre>'+escH(run.ok?(run.stdout||run.result||'(no output)'):run.stderr)+'</pre></div>';
  }
}
function _devRenderLog(){
  try{ const sh=$('dev-shell'); if(sh){ const wasBlank=sh.classList.contains('dev-blank'); const nowBlank=_devIsHome(); sh.classList.toggle('dev-blank', nowBlank); if(wasBlank && !nowBlank){ try{ _mountMobilePaneToggle('dev'); _mobileShowOutput('dev'); }catch(e){} } } }catch(e){}
  try{ _ctxRenderMeter('ctx-dev','dev'); }catch(e){}
  const el=$('dev-log'); if(!el) return;
  el.innerHTML=_DEV.log.map(m=>{
    if(m.role==='user') return '<div class="dev-msg-u">'+escH(m.text)+'</div>';
    if(m.role==='sys') return '<div class="dev-msg-sys">'+escH(m.text)+'</div>';
    if(m._snag){
      /* Retry answers a hiccup. A plan boundary gets the plan, on the same
         card, because retrying a tier is a loop with no exit. */
      const r=m._snagRoute||'';
      const act = r==='plans' ? '<button class="ai-snag-retry" data-stab="plans" type="button">See plans</button>'
                : r==='team'  ? '<button class="ai-snag-retry" data-stab="team" type="button">Manage seats</button>'
                :               '<button class="ai-snag-retry" data-dev-retry="1" type="button">Retry</button>';
      return '<div class="dev-msg-ai"><div class="ai-snag'+(r?' ai-snag-tier':'')+'"><div class="ai-snag-row"><span class="ai-snag-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg></span><span class="ai-snag-msg">'+escH(m._snag)+'</span></div>'+act+'</div></div>';
    }
    let h='<div class="dev-msg-ai">';
    if(m.text) h+='<div class="dev-ai-txt">'+(typeof md==='function'?md(m.text):escH(m.text))+'</div>';
    /* Tool results carry a rendered card - the image that was generated, the
       tier card when publishing needs a plan. Callers have been pushing `html`
       onto the log since Dev learned to use tools; this renderer never read it,
       so every one of those cards was built and thrown away. It is our own
       markup, same provenance as md(m.text) on the line above. */
    if(m.html) h+='<div class="dev-ai-embed">'+m.html+'</div>';
    if(m.code) h+='<div class="dev-code"><div class="dev-code-h">'+escH(m.lang||'code')+' <button class="dev-copy" data-code="'+encodeURIComponent(m.code)+'">copy</button></div><pre>'+escH(m.code.length>800?m.code.slice(0,800)+'\n…':m.code)+'</pre></div>';
    if(m.run) h+='<div class="dev-run '+(m.run.ok?'ok':'err')+'"><div class="dev-run-h">'+(m.run.ok?'✓ ran ('+m.run.ms+'ms)':'✗ error')+'</div><pre>'+escH(m.run.ok?(m.run.stdout||m.run.result||'(no output)'):m.run.stderr)+'</pre></div>';
    /* The changelist goes last, under whatever was said about the change,
       which is the order somebody reads it in: what happened, then what
       moved, then the way back. */
    /* Through safeUrl, like every other attribute in the product. The value
       comes from AMV's own server and is built from a repo name AMV
       validated - but "it is ours" is exactly the reasoning that puts an
       unchecked value in an href, and this one crosses two systems on its
       way here. */
    if(m.gh) h+='<div class="ghd"><a class="ghd-l" href="'+escH(safeUrl(m.gh.url))+'" target="_blank" rel="noopener noreferrer">'
      +escH(m.gh.repo)+' &middot; '+escH(m.gh.branch)+'</a>'
      +'<button class="ghd-pr" type="button" data-ghpr="'+encodeURIComponent(JSON.stringify(m.gh))+'">Open a pull request</button></div>';
    /* What it did on the machine goes ABOVE what changed, because the
       commands are the story and the files are the result. */
    if(m.steps && m.steps.length) h+=_agentStepsHTML(m);
    if(m.verify) h+=_devVerifyHTML(m);
    if(m.changes) h+=_devChangeCardHTML(m);
    h+='</div>'; return h;
  }).join('');
  try{ _devWireChangeCards(el); }catch(e){}
  el.querySelectorAll('[data-ghpr]').forEach(b=>on(b,'click',()=>{
    let gh=null; try{ gh=JSON.parse(decodeURIComponent(b.dataset.ghpr)); }catch(e){}
    b.disabled=true; _devOpenPR(gh);
  }));
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
/* Does this Dev request want a TOOL - shipping it - rather than code? Dev used
   to be able to do neither: you had to leave and find another tab.

   There was a second branch here returning 'image'. Nothing read it after image
   generation came out, so it matched a request, named an intent, and the caller
   below fell through to writing code anyway. A classifier whose answer nobody
   acts on is worse than no classifier: it reads as a decision being made. */
function _devToolIntent(msg){
  const t=String(msg||'').toLowerCase();
  if(/\b(deploy|publish|ship it|put it live|go live|make it live|host it|give me a (live )?(url|link))\b/.test(t)) return 'deploy';
  return null;
}

/* WHAT HAPPENS AFTER FILES LAND, WHEREVER THEY LANDED FROM.

   An automatic turn and an approved one have to do the same thing next -
   repaint the preview, run the entry script for a project that is not a
   page, and save to a connected folder. Having that written out twice is
   how the approved path comes to quietly skip the folder save. */
async function _devAfterWrite(changed, stat){
  /* Returns what it DID, because the verification line above the changelist
     may only report things that really happened, and the only place that
     knows is here. */
  const out={ previewed:false, run:null, saved:false };
  const previewHTML=_devProjectPreviewHTML();
  const pb=$('dev-prev-body');
  if(pb){
    if(previewHTML){ _previewMount(pb, previewHTML, 'dev-prev-frame'); out.previewed=true; }
    else {
      const entryP=_devEntryFile(); const lang=_devLangFor(entryP);
      if((lang==='js'||lang==='python') && _DEV.project[entryP]){
        const run=await runCode(_DEV.project[entryP].content, lang, s=>{ if(stat) stat.textContent=s; });
        out.run=run;
        pb.innerHTML='<div class="dev-prev-out '+(run.ok?'ok':'err')+'"><pre>'+escH(run.ok?(run.stdout||run.result||'(no output)'):run.stderr)+'</pre></div>';
        if(stat) stat.textContent=run.ok?'\u2713 ran':'\u2717 error';
      }
    }
  }
  if(AMVWorkspace.dirHandle && changed && changed.length){
    for(const p of changed){ try{ if(_DEV.project[p]) await AMVWorkspace.writeFile(p, _DEV.project[p].content); }catch(e){} }
    out.saved=true;
    if(stat) stat.textContent='\u2713 saved to folder';
  }
  return out;
}
try{ window._devAfterWrite=_devAfterWrite; }catch(e){}

/* WHAT TO DO WITH WORDS TYPED WHILE AMV IS ALREADY WORKING.

   `_devSend` opened with `if(_DEV.busy) return;`, so pressing Enter during a
   turn did nothing at all - no send, no queue, no message, and the text left
   sitting in the box looking like it had been sent. The one thing somebody
   always wants to do while watching a build is say the next thing, and the
   product's answer was silence.

   A turn here can run for a minute and rewrite a project, so it is not
   interrupted just because somebody typed. The message waits, visibly, and
   goes the moment the turn ends. If they want it to land sooner there is a
   button that says so - which stops the turn first, because sending a second
   instruction into a build that is still writing files is how two turns end up
   editing the same file with different ideas about what is in it.

   A list rather than one slot: queueing a second thought must not silently
   replace the first. */
function _devQueue(){ if(!Array.isArray(_DEV.queue)) _DEV.queue=[]; return _DEV.queue; }

function _devRenderQueue(){
  const host=$('dev-queue'); if(!host) return;
  const q=_devQueue();
  if(!q.length){ host.hidden=true; host.innerHTML=''; return; }
  host.hidden=false;
  /* Send now is offered ONLY when there is something that can actually be
     stopped. The agent turn checks a flag between steps, so asking it to stop
     means something; an in-browser turn is a single model call with nothing to
     interrupt, and a button that quietly did nothing there would be worse than
     no button. Where it cannot be offered the line still says what will
     happen, which is the honest half of the same sentence. */
  let canStop=false;
  try{ canStop = !!(typeof _AGENT!=='undefined' && _AGENT && _AGENT.running); }catch(e){}
  host.innerHTML='<div class="dvq-head">'
      + '<span class="dvq-n">'+q.length+' queued</span>'
      + '<span class="dvq-w">'+escH(T('Sends when this turn finishes'))+'</span>'
      + (canStop ? '<button class="dvq-now" id="dev-queue-now" type="button">'+escH(T('Stop and send now'))+'</button>' : '')
    + '</div>'
    + q.map((t,i)=>'<div class="dvq-item"><span class="dvq-t">'+escH(t)+'</span>'
        + '<button class="dvq-x" data-dvq="'+i+'" type="button" aria-label="'+escH(T('Remove this queued message'))+'">\u2715</button></div>').join('');
  on($('dev-queue-now'),'click',_devQueueNow);
  host.querySelectorAll('[data-dvq]').forEach(b=>on(b,'click',()=>{
    const i=+b.dataset.dvq; const list=_devQueue();
    if(i>=0 && i<list.length){ list.splice(i,1); _devRenderQueue(); }
  }));
}
try{ window._devRenderQueue=_devRenderQueue; }catch(e){}

/* Stop what is running, then let the drain below send the first queued
   message. Not "send alongside": a build mid-write and a new instruction are
   two turns editing the same files. */
function _devQueueNow(){
  if(!_devQueue().length) return;
  try{ if(typeof _agentStop==='function') _agentStop(); }catch(e){}
  /* If nothing was actually running, stopping changes nothing and the drain
     would never fire - so ask for it directly. */
  if(!_DEV.busy) _devDrainQueue();
}
try{ window._devQueueNow=_devQueueNow; }catch(e){}

/* ONE PLACE DECIDES A TURN IS OVER.

   Five call sites set `_DEV.busy=false` and cleared the busy line. A queue
   drained from four of them is a queue that hangs on the fifth, so they all
   go through here. */
function _devIdle(){
  _DEV.busy=false;
  _DEV.stop=false;
  try{ _devBusy(false); }catch(e){}
  /* Only when nothing else is running - the agent path owns the button while
     it is going, and taking it down under a live agent turn would leave Stop
     unavailable for the one turn that most needs it. */
  try{ if(!(typeof _AGENT!=='undefined' && _AGENT && _AGENT.running)) _devShowStop(false); }catch(e){}
  _devDrainQueue();
}
try{ window._devIdle=_devIdle; }catch(e){}

function _devDrainQueue(){
  const q=_devQueue();
  if(!q.length || _DEV.busy) return;
  const next=q.shift();
  _devRenderQueue();
  const ta=$('dev-msg');
  if(ta){ ta.value=next; }
  /* A tick later, so the log and the composer have finished the render that
     ended the turn before the next one starts changing them. */
  setTimeout(()=>{ try{ _devSend(); }catch(e){} }, 0);
}
try{ window._devDrainQueue=_devDrainQueue; }catch(e){}

async function _devSend(){
  const ta=$('dev-msg');
  if(_DEV.busy){
    /* Queued, not dropped. See _devQueue above. */
    const q=ta?ta.value.trim():'';
    if(!q) return;
    _devQueue().push(q);
    ta.value=''; ta.style.height='auto';
    _devRenderQueue();
    return;
  }
  const msg=ta?ta.value.trim():''; if(!msg) return;
  ta.value=''; ta.style.height='auto';
  /* Cleared at the START of a turn, not the end: a Stop pressed during the
     previous one must not silently cancel this one. */
  _DEV.stop=false;
  _DEV.ctrl=(typeof AbortController!=='undefined') ? new AbortController() : null;
  /* Asking for something is leaving home, the same way opening a design is in
     Studio - otherwise the hero would stay up over the answer. */
  _DEV.atHome=false;
  _DEV.log.push({role:'user',text:msg}); _devRenderLog(); _DEV.busy=true;
  try{ _devBusy(true,'Building'); }catch(e){}
  try{ _sessTouch('dev'); }catch(e){}
  const stat=$('dev-prev-s'); if(stat) stat.textContent='building…';
  /* THERE IS A COMPUTER CONNECTED, SO THE COMPUTER IS THE PROJECT.

     Not a mode somebody picks. When a bridge is paired, the folder it was
     started in is the real thing being worked on, and building a copy of it
     in a browser tab beside it would leave two versions of every file and
     no answer to which one is true. */
  if(_agentReady()){
    try{ await _devSendAgent(msg, stat); }
    catch(err){
      _DEV.log.push({role:'ai',text:'',_snag:_errText(err),
                     _snagRoute:(typeof _refusalRoute==='function'?_refusalRoute(err&&err.code):'')});
      _devRenderLog();
      try{ _agentSetRunning(false); }catch(e){}
    }
    if(stat) stat.textContent='';
    _devIdle();
    return;
  }
  /* The agent path raises this itself through _agentSetRunning; this is the
     in-browser turn, which had no Stop at all - Send was simply disabled and
     there was nothing to press for however long the run took. */
  try{ _devShowStop(true); }catch(e){}
  const hasProject=_devProjectFiles().length>0;
  /* Taken before anything is written, so the changelist at the end of the
     turn is measured rather than assembled from what the model claimed. */
  const before=_devSnapshot();

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
      /* Third deploy caller, third place a plan limit can land. This one goes
         through _deployApi and DOES throw, so the code arrives on the error. */
      const isPlan = !!(e && e.code === 'plan_required');
      const why = isPlan
        ? String(e.message||'Publishing to a live URL is part of Elite.')
        : e.message==='not-connected'
          ? 'Connect the AMV engine in Settings and I can publish this to a live URL.'
          : 'Couldn\u2019t publish: '+e.message;
      _DEV.log.push({ role:'ai', text:why,
                      html: isPlan ? _planUpsellCardHTML('Publishing is part of Elite', why) : '' });
      _devRenderLog();
      if(stat) stat.textContent='';
    }
    _devIdle();
    return;
  }
  try{
    if(hasProject){
      // ---- MULTI-FILE PROJECT MODE ----
      const sys='You are AMV Forge - a principal-level software engineer working in a multi-file project. '+
        'Make the requested change with production quality: complete, correct, secure, performant, well-structured. '+
        'You may create or edit ANY files. For EACH file you write, output a fenced block whose FIRST line is "WRITE_FILE: <path>" followed by the COMPLETE file contents (never fragments/diffs). '+
        'Only include files you actually changed or added. Before the file blocks, give a one or two sentence summary of what you changed. '+
        'When starting a NEW project, scaffold it as a REAL multi-file project the way a senior engineer would - separate files for markup, styles, scripts, components, config and a README - rather than cramming everything into one file. Use clear, conventional paths (index.html, styles/main.css, scripts/app.js, components/<name>.js). '+
        'If any UI is involved, it must look like a top design agency built it.'+_userStyle();
      const _isUI=Object.keys(_DEV.project).some(p=>/\.(html|css|jsx|tsx)$/i.test(p))||/\b(html|css|ui|page|component|design|frontend)\b/i.test(msg);
      /* The conversation, which Dev never sent. Without it "make the button
         bigger" arrives as a request about a button the model has never
         heard of. */
      const _hist=await _ctxDevHistory();
      const prompt=(_isUI?dnaPromptBlock()+'\n\nApply the DESIGN DNA above to any UI.\n\n':'')+_hist+_devProjectContext()+'\n\nCHANGE REQUEST: '+msg;
      const resp=await aiCompleteLong(prompt, sys+_handoffContext('dev'), {max_tokens:16000, model:_sectionModel('code'),
        effort:_devEffort(),
        /* Stop is real on this path too: a long completion is a run of
           continuations, so this is asked between them. See aiCompleteLong. */
        shouldStop:()=>_DEV.stop===true,
        signal:_DEV.ctrl ? _DEV.ctrl.signal : undefined,
        onProgress:(p)=>_devProgress(p)});
      /* THE WRITES ARE PARSED ONCE, AND THE PATH IS SETTLED THERE.

         Both the card and the apply step have to agree about which file a
         block names, and `_devSetFile` sanitises the path on the way in. So
         it is sanitised here, once, and the same list is what gets measured
         and what gets written - rather than the card describing one path and
         the write landing on another. */
      const writes=[...resp.matchAll(/```[a-z]*\s*\n?WRITE_FILE:\s*([^\n`]+)\n([\s\S]*?)```/gi)]
        .map(m=>{ const raw=m[1].trim();
                  return { path:(typeof _safePath==='function' ? (_safePath(raw)||raw) : raw),
                           body:m[2].replace(/\n$/,'') }; })
        .filter(w=>!!w.path);
      const summary=resp.split('```')[0].trim();
      try{ _devDeriveName(msg); }catch(e){}   // name the project from the first request
      /* THE TURN ENDS WITH A CHANGELIST, MEASURED RATHER THAN CLAIMED.

         The list of paths used to be appended to the summary as a sentence,
         which says which files moved and nothing about how much, whether
         they were created, or how to put them back. This diffs the proposed
         project against what it was before the turn, so a file the model
         rewrote byte-identically does not appear - it was not changed, and
         counting it pads the number people are trusting. */
      const proposed=Object.assign({}, before);
      for(const w of writes) proposed[w.path]=w.body;
      const rows=_devChangeSet(before, proposed);
      const entry={role:'ai',text:(summary||'Updated the project.')};
      /* ASK BEFORE CHANGES MEANS NOTHING HAS MOVED YET.

         Not a confirmation on top of a change that already happened - the
         files are untouched, the preview still shows what it showed, and the
         card carries Apply. That is the whole difference between a setting
         that means something and a label. */
      if(rows.length && _devApplyMode()==='ask'){
        entry.changes=rows;
        entry.chgId=_devStageTurn(before, proposed, writes);
        _DEV.log.push(entry); _devRenderLog();
        if(stat) stat.textContent='waiting for you';
        _devIdle();
        return;
      }
      for(const w of writes) _devSetFile(w.path, w.body);
      if(writes.length) _DEV.activePath=writes[0].path;
      const after=_devSnapshot();
      const rows2=_devChangeSet(before, after);
      if(rows2.length){ entry.changes=rows2; entry.chgId=_devRecordTurn(before, after); }
      _DEV.log.push(entry); _devRenderLog(); _devRenderTree(); _devShowActive();
      const outcome=await _devAfterWrite(rows2.map(r=>r.path), stat);
      /* Attached AFTER the work, from what the work reported. Written before
         it would be a claim rather than a result. */
      entry.verify=_devVerify(rows2.map(r=>r.path), outcome);
      _devRenderLog();
      _devIdle();
      return;
    }
    // ---- SINGLE-FILE MODE (unchanged behavior) ----
    const hasCurrent=!!_DEV.curCode;
    const sys='You are AMV Forge - a principal-level '+_DEV.lang+' engineer in a live code workspace. Your code must be the best version possible: production-ready, complete error handling, performance-aware, secure by default, elegantly structured. '+
      (hasCurrent?'You are EDITING existing code. Apply the user\u2019s requested change to the current code and return the COMPLETE updated program - never a fragment. ':'Write complete, runnable '+_DEV.lang+' code for the request. ')+
      'If the request is UI, it must look like a top design agency built it - real hierarchy, deliberate spacing, polished interactions. Briefly explain what you did in one or two sentences, then give ONE fenced '+_DEV.lang+' code block with the full program. Keep it self-contained so it runs directly.'+_userStyle();
    const _isUI=/\b(html|css|ui|page|site|landing|component|button|form|card|layout|design|style|frontend|web ?app|dashboard)\b/i.test(msg)||/html/i.test(_DEV.curLang||'');
    const prompt=(_isUI?dnaPromptBlock()+'\n\nApply the DESIGN DNA above to any UI/visual output.\n\n':'')+
      (hasCurrent?('Current '+(_DEV.curLang||_DEV.lang)+' code:\n```\n'+_DEV.curCode+'\n```\n\nChange request: '+msg+'\n\nReturn the full updated program.'):msg);
    let resp=await aiCompleteLong(prompt, sys+_handoffContext('dev'), {max_tokens:16000, model:_sectionModel('code'),
      effort:_devEffort(),
      shouldStop:()=>_DEV.stop===true,
      signal:_DEV.ctrl ? _DEV.ctrl.signal : undefined,
      onProgress:(p)=>_devProgress(p)});
    /* Stopped part way: a program cut off mid-block is not a program, so it is
       neither run nor shown as code - the log says it was stopped instead. */
    if(_DEV.stop===true){
      if(((resp.match(/```/g)||[]).length % 2) === 1) resp=resp.slice(0, resp.lastIndexOf('```')).trim();
      resp=(resp ? resp+'\n\n' : '')+'Stopped before it finished.';
    }
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
  }catch(err){ _DEV.log.push({role:'ai',text:'',_snag:_errText(err),_snagRoute:(typeof _refusalRoute==='function'?_refusalRoute(err&&err.code):'')}); _devRenderLog(); if(stat) stat.textContent=''; }
  _devIdle();
}
window.renderCodeView=renderCodeView;

/* codeStart lived here, exported and referenced by nothing. */



