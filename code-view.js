/* ═════════════════════════════════════════════════
   THE CODE WORKSPACE SCREEN - published as code-view.js (see build.mjs) and
   fetched the first time the workspace is drawn, or when the browser is idle.

   Moved out of the page, unchanged, by following what the rest of the app
   calls (audit #40): everything here is reached only from the workspace
   itself. What other parts of the app call stays in
   src/app/11b-code-workspace.js, beside a stand-in renderCodeView that this
   file's real one replaces when it loads. A classic script, like the page.
   ═════════════════════════════════════════════════ */
/* A starting point is a card, the same .dsn-tile Design's are (Nov 23: the
   owner found the pills too small to read and hit). The prompt it fills is
   unchanged; the card adds a line saying what it makes. */
function _devChip(prompt,label,ic,desc){
  return '<button class="dsn-tile dev-start" type="button" data-dq="'+escH(prompt)+'">'
    + '<span class="dsn-tile-ic" aria-hidden="true">'+_lineIcon(ic)+'</span> '
    + '<span class="dsn-tile-body"><span class="dsn-tile-t">'+escH(label)+'</span> <span class="dsn-tile-d">'+escH(desc)+'</span></span>'
    + '</button>';
}

function renderCodeView(){
  const vc=$('vc'); if(!vc) return;
  /* `atHome` is what makes "All builds" mean anything. Without it the only
     states were "no work" and "the work", so the way out of a project was to
     start a new one - which does not open the old one, it replaces it. Studio
     has had this since it was built; Dev is catching up. */
  const blank = _devIsHome();
  vc.innerHTML = `<div class="dev-shell${blank?' dev-blank':''}" id="dev-shell">
    <div class="dev-chat-pane">
      ${_buildEntryHeadHTML('dev','What should we create?')}
      ${/* Always rendered, hidden by the class. `_devRenderLog()` drops
            `dev-blank` when the first reply lands, so a button gated on the
            render-time value was absent for the whole session that followed. */ ''}
      ${_buildBarHTML('code', true, blank)}

      <div id="dev-hero" class="dev-hero">
        <div class="dsn-starts dev-starts" id="dev-hero-chips">
          ${_devChip('A landing page for a coffee brand - hero, pricing, and a signup form','Landing page','monitor','Hero, pricing and a signup form')}
          ${_devChip('A to-do app with add, complete, delete, and saved state','To-do app','check','Add, complete and delete, saved as you go')}
          ${_devChip('A snake game I can play with the arrow keys','Snake game','game','Play it with the arrow keys')}
          ${_devChip('A dashboard with a revenue chart and summary cards','Dashboard','chart','A revenue chart and summary cards')}
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
              {id:'dev-tab-code',key:'code',label:'Code'},
              /* What is wrong in the running app, and what to do next (owner,
                 Nov 24: "preview, bugs, suggestions on the right"). */
              {id:'dev-tab-prob',key:'problems',label:'Problems'},
              {id:'dev-tab-next',key:'next',label:'Next steps'}],
        actions: _vpSwitchHTML('dev-vp') + `<button class="dev-openext" id="dev-download-proj" title="Download the project"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
          <button class="dev-openext" id="dev-github" title="Push this project to GitHub"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg></button>
          <button class="dev-openext" id="dev-deploy" title="Deploy a shareable page"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h8l-1 8 10-12h-8z"/></svg></button>
          <button class="dev-openext" id="dev-open-ext" title="Open in a new tab"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>` })}
      <div id="dev-prev-body" class="dev-prev-body"><div class="lab-placeholder">Your live result appears here.</div></div>
      <div id="dev-prob-body" class="dev-side-body" hidden></div>
      <div id="dev-next-body" class="dev-side-body" hidden></div>
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
  /* Settings folds the three choices (changes, engine, effort) into one
     control: three dropdowns in a row read as a form before anything is typed. */
  on($('dev-opts'),'click',function(){
    const bar=this.closest('.dvi-bar'); if(!bar) return;
    const open=bar.classList.toggle('opts-open');
    this.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
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
  const showPV=(pv)=>{ const pb=$('dev-prev-body'),cb=$('dev-code-body'),prb=$('dev-prob-body'),nb=$('dev-next-body');
    if(cb) cb.style.display = pv==='code' ? 'block' : 'none';
    /* The preview stays mounted behind Problems and Next steps, so the app
       keeps running - and keeps reporting - while somebody reads them. */
    if(pb) pb.style.display = (pv==='code'||pv==='problems'||pv==='next') ? 'none' : 'flex';
    if(prb){ prb.hidden = pv!=='problems'; if(pv==='problems') _devRenderProblems(); }
    if(nb){ nb.hidden = pv!=='next'; if(pv==='next') _devRenderNext(); }
    if(pv==='problems'||pv==='next') return;
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
/* Open the current live preview in a real new browser tab. Uses a Blob URL
   (never a custom protocol, so it can't blank the page). Falls back to a
   helpful toast if there's nothing built yet or the tab is blocked. */
/* ── PROBLEMS: what went wrong in the running preview ─────────────────────
   preview.html passes each uncaught error, failed promise and console.error
   of the page it shows; they are accepted here only from the frame in the
   preview pane, kept as text (never markup), and cleared when a new page is
   mounted. "Fix this" sends the error to AMV as the next message - through
   the same send as typing it, so it queues behind a turn that is running. */
function _devProblemsReset(){ _DEV.problems = []; _devProblemsBadge(); if(!$('dev-prob-body')?.hidden) _devRenderProblems(); }
function _devProblemsBadge(){
  const t = $('dev-tab-prob'); if(!t) return;
  const n = (_DEV.problems || []).length;
  t.textContent = n ? T('Problems') + ' (' + n + ')' : T('Problems');
  t.classList.toggle('rb-tab-warn', !!n);
}
if(!window.__devProbListen){
  window.__devProbListen = true;
  window.addEventListener('message', e => {
    const d = e && e.data; if(!d || d.__amv !== 'preview-error') return;
    const f = document.querySelector('#dev-prev-body .dev-prev-frame');
    if(!f || e.source !== f.contentWindow) return;
    const m = String(d.m || '').slice(0, 600).trim(); if(!m) return;
    const list = _DEV.problems || (_DEV.problems = []);
    const had = list.find(p => p.m === m);
    if(had) had.n++; else if(list.length < 50) list.push({ m, n: 1, at: Date.now() });
    _devProblemsBadge();
    if(!$('dev-prob-body')?.hidden) _devRenderProblems();
  });
}
function _devRenderProblems(){
  const host = $('dev-prob-body'); if(!host) return;
  const list = _DEV.problems || [];
  const running = !!document.querySelector('#dev-prev-body .dev-prev-frame');
  if(!list.length){
    host.innerHTML = '<div class="dev-side-empty">' + escH(running
      ? T('No problems in the running preview. Errors from the app appear here as it runs.')
      : T('Open the preview to run the app; anything that goes wrong in it appears here.')) + '</div>';
    return;
  }
  host.innerHTML = '<div class="dev-side-h">' + escH(T('Problems in the running preview')) + '</div><ul class="dev-prob-list">' +
    list.map((p, i) => '<li class="dev-prob"><code class="dev-prob-m">' + escH(p.m) + '</code>' +
      (p.n > 1 ? '<span class="dev-prob-n">' + escH(T('{0} times').replace('{0}', p.n)) + '</span>' : '') +
      '<button type="button" class="btn bs dev-prob-fix" data-prob="' + i + '">' + escH(T('Fix this')) + '</button></li>').join('') + '</ul>';
  host.querySelectorAll('[data-prob]').forEach(b => b.addEventListener('click', () => {
    const p = list[+b.getAttribute('data-prob')]; const t = $('dev-msg'); if(!p || !t) return;
    t.value = T('Fix this error from the running preview:') + '\n' + p.m;
    _devSend();
  }));
}
/* ── NEXT STEPS: three things worth doing next, asked for, not invented ────
   Nothing is shown until somebody asks, because the suggestions come from
   AMV reading this project, and that is a message from their allowance - the
   button says so. Each suggestion goes into the box to edit or send. */
let _devNextBusy = false;
function _devRenderNext(){
  const host = $('dev-next-body'); if(!host) return;
  const s = _DEV.next || null;
  const files = (() => { try{ return _devProjectFiles(); }catch(e){ return []; } })();
  const have = files.length || (_DEV.lastHTML || '').trim();
  host.innerHTML = '<div class="dev-side-h">' + escH(T('Next steps')) + '</div>' +
    (!have ? '<div class="dev-side-empty">' + escH(T('Build something first; then AMV can suggest what to do next.')) + '</div>'
    : (s && s.list && s.list.length
        ? '<ul class="dev-next-list">' + s.list.map((x, i) => '<li><button type="button" class="dev-next" data-next="' + i + '">' + escH(x) + '</button></li>').join('') + '</ul>'
        : (s && s.err ? '<div class="dev-side-empty" role="alert">' + escH(s.err) + '</div>' : '')) +
      '<button type="button" class="btn bs dev-next-ask" id="dev-next-ask"' + (_devNextBusy ? ' disabled' : '') + '>' +
        escH(_devNextBusy ? T('Thinking\u2026') : (s && s.list ? T('Suggest again') : T('Suggest next steps'))) + '</button>' +
      '<div class="dev-side-note">' + escH(T('Uses one message from your allowance.')) + '</div>');
  host.querySelectorAll('[data-next]').forEach(b => b.addEventListener('click', () => {
    const t = $('dev-msg'); const x = s.list[+b.getAttribute('data-next')]; if(!t || !x) return;
    t.value = x; t.focus(); try{ t.dispatchEvent(new Event('input')); }catch(e){}
  }));
  const ask = $('dev-next-ask'); if(ask) ask.addEventListener('click', _devAskNext);
}
async function _devAskNext(){
  if(_devNextBusy) return;
  _devNextBusy = true; _devRenderNext();
  try{
    let files = []; try{ files = _devProjectFiles(); }catch(e){}
    const asked = (_DEV.log || []).filter(m => m.role === 'user').slice(-4).map(m => '- ' + String(m.text || '').slice(0, 300)).join('\n');
    const page = String(_DEV.lastHTML || '').slice(0, 6000);
    const prob = (_DEV.problems || []).slice(0, 5).map(p => '- ' + p.m).join('\n');
    const prompt = 'Files: ' + (files.map(f => f.path || f.name).filter(Boolean).slice(0, 60).join(', ') || '(single page)') +
      '\n\nWhat the person asked for so far:\n' + (asked || '(nothing yet)') +
      (prob ? '\n\nErrors in the running preview:\n' + prob : '') +
      (page ? '\n\nThe current page (start):\n' + page : '');
    const sys = 'You review a small app someone is building and suggest the three most valuable next changes. ' +
      'Each is one short instruction they could send as-is (under 15 words), concrete to THIS app, most valuable first; fix any listed error first. ' +
      'Answer with a JSON array of exactly three strings and nothing else.';
    const r = await aiComplete(prompt, sys, { max_tokens: 300 });
    const txt = String((r && (r.text || r.content || r)) || '');
    const m = txt.match(/\[[\s\S]*\]/);
    const list = m ? JSON.parse(m[0]).map(x => String(x || '').trim()).filter(Boolean).slice(0, 3) : [];
    if(!list.length) throw new Error('empty');
    _DEV.next = { list, at: Date.now() };
  }catch(e){
    _DEV.next = { err: T('AMV could not suggest anything just now. Try again in a moment.') };
    try{ console.error('AMV: next steps failed', e); }catch(_){}
  }finally{ _devNextBusy = false; _devRenderNext(); }
}
try{ Object.assign(window, { _devProblemsReset, _devRenderProblems, _devRenderNext }); }catch(e){}

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
window._devDownloadProject=_devDownloadProject;
window._devDeploy=_devDeploy;
window.renderCodeView=renderCodeView;
