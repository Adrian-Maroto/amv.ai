/* ============================================================
   COMMAND PALETTE (#7)  - ⌘K / Ctrl+K
   Fuzzy launcher for navigation + actions. Keyboard-first:
   type to filter, ↑/↓ to move, Enter to run, Esc to close.
   ============================================================ */
function _paletteCommands(){
  const nav=(id,label,tab,kw)=>({id,label,group:'Go to',kw:kw||label.toLowerCase(),run:()=>setTab(tab),icon:'nav'});
  const setNav=(id,label,pane,kw)=>({id,label,group:'Settings',kw:kw||label.toLowerCase(),run:()=>{ S.settingsPane=pane; setTab('settings'); },icon:'nav'});
  const cmds=[
    // Actions first (most common)
    {id:'new-chat',label:'New chat',group:'Actions',kw:'new chat conversation start',icon:'plus',run:()=>{ try{ newChat(); }catch(e){} }},
    {id:'new-dev',label:'New Dev session',group:'Actions',kw:'new dev build code session',icon:'code',run:()=>{ try{ _sessNew('dev'); _resetToolState&&_resetToolState('dev'); }catch(e){} setTab('dev'); }},
    {id:'new-lab',label:'New Lab session',group:'Actions',kw:'new lab run code session',icon:'lab',run:()=>{ try{ _sessNew('lab'); _resetToolState&&_resetToolState('lab'); }catch(e){} setTab('lab'); }},
    {id:'toggle-theme',label:'Toggle light / dark theme',group:'Actions',kw:'theme dark light mode toggle appearance',icon:'theme',run:()=>{ document.body.classList.toggle('light'); try{ saveStr('amv_theme',document.body.classList.contains('light')?'light':'dark'); }catch(e){} }},
    {id:'errors',label:'Errors - what\u2019s breaking for your users',group:'Actions',kw:'errors bugs crashes reports monitoring bugs dashboard',icon:'nav',run:()=>{ try{ openErrors(); }catch(e){} }},
    {id:'mysites',label:'My live sites - view or take down',group:'Actions',kw:'sites deploy live url hosting published apps',icon:'nav',run:()=>{ try{ openMySites(); }catch(e){} }},
    {id:'handoffs',label:'Context handoffs - download or resume',group:'Actions',kw:'handoff context download resume paste transfer continue new chat',icon:'nav',run:()=>{ try{ openHandoffManager(); }catch(e){} }},
    {id:'shortcuts',label:'Keyboard shortcuts',group:'Actions',kw:'keyboard shortcuts cheat sheet hotkeys help keys',icon:'nav',run:()=>{ try{ openShortcutSheet(); }catch(e){} }},
    // Navigation
    nav('go-chat','Chat','chat','chat home talk'),
    nav('go-images','Images','images','image picture generate art'),
    nav('go-video','Video','video','video clip generate'),
    nav('go-studio','Studio','studio','studio design page website'),
    nav('go-dev','Dev','dev','dev build code app engineer'),
    nav('go-lab','Lab','lab','lab run execute code'),
    nav('go-crew','Crew','crew','crew agents team autonomous'),
    nav('go-tasks','Tasks','tasks','tasks todo schedule automation'),
    nav('go-projects','Projects','workspaces','projects workspace files'),
    nav('go-memory','Memory','memory','memory remember facts'),
    nav('go-team','Team','team','team seats members invite colleagues shared workspace collaborate'),
    nav('go-marketplace','Marketplace','market','marketplace agents store'),
    nav('go-plans','Plans','plans','plans pricing upgrade subscription'),
    nav('go-help','Help','help','help support docs guide'),
    // Settings panes (deep links)
    setNav('set-account','Settings: Account','account','account profile name instructions'),
    setNav('set-privacy','Settings: Privacy','privacy','privacy data export delete location'),
    setNav('set-billing','Settings: Billing','billing','billing invoices credits payment subscription'),
    setNav('set-usage','Settings: Usage','usage','usage limits tokens'),
    setNav('set-capabilities','Settings: Capabilities','capabilities','capabilities web search memory toggles'),
    setNav('set-spending','Settings: Spending','spending','spending limits money budget purchases cap allowance'),
    setNav('set-api','Settings: API keys','api','api key developer integration programmatic token'),
    setNav('set-invite','Settings: Invite','invite','invite referral refer friend share link bonus tokens'),
    setNav('set-family','Settings: Family & linked accounts','family','family linked accounts parent child share access permissions'),
    setNav('set-appearance','Settings: Appearance','appearance','appearance theme accent font motion'),
    setNav('set-skills','Settings: Skills','skills','skills presets instructions'),
    setNav('set-connectors','Settings: Connectors','integrations','connectors integrations connect apps gmail drive github'),
  ];
  return cmds;
}
let _palSel=0, _palList=[];
function openCommandPalette(){
  const r=$('ovr'); if(!r) return;
  if(document.getElementById('cmdk-bg')){ return; } // already open
  r.insertAdjacentHTML('beforeend',
    '<div class="ov cmdk-ov" id="cmdk-bg"><div class="cmdk">'+
      '<div class="cmdk-inp-wrap">'+
        '<svg class="cmdk-search-ic" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>'+
        '<input id="cmdk-inp" class="cmdk-inp" placeholder="Search commands\u2026 (type a page or action)" autocomplete="off" spellcheck="false">'+
        '<kbd class="cmdk-esc">esc</kbd>'+
      '</div>'+
      '<div class="cmdk-results" id="cmdk-results"></div>'+
    '</div></div>');
  _palSel=0;
  _renderPalette('');
  const inp=$('cmdk-inp');
  inp.addEventListener('input',()=>{ _palSel=0; _renderPalette(inp.value); });
  inp.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'){ e.preventDefault(); _palSel=Math.min(_palList.length-1,_palSel+1); _highlightPalette(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); _palSel=Math.max(0,_palSel-1); _highlightPalette(); }
    else if(e.key==='Enter'){ e.preventDefault(); _runPalette(_palSel); }
    else if(e.key==='Escape'){ e.preventDefault(); closeCommandPalette(); }
  });
  onBackdrop($('cmdk-bg'),closeCommandPalette);
  setTimeout(()=>inp.focus(),30);
}
function closeCommandPalette(){ const el=$('cmdk-bg'); if(el) el.remove(); }
function _fuzzyScore(q, kw, label){
  q=q.toLowerCase().trim(); if(!q) return 1;
  const hay=(label+' '+kw).toLowerCase();
  if(hay.includes(q)) return 100 - hay.indexOf(q);   // substring match ranks high
  // subsequence match (fuzzy)
  let qi=0; for(let i=0;i<hay.length&&qi<q.length;i++){ if(hay[i]===q[qi]) qi++; }
  return qi===q.length ? 20 : -1;
}
function _renderPalette(query){
  const all=_paletteCommands();
  _palList = all.map(c=>({c,s:_fuzzyScore(query,c.kw,c.label)}))
                .filter(x=>x.s>=0)
                .sort((a,b)=>b.s-a.s)
                .map(x=>x.c);
  const box=$('cmdk-results'); if(!box) return;
  if(!_palList.length){ box.innerHTML='<div class="cmdk-empty">No commands match \u201c'+escH(query)+'\u201d</div>'; return; }
  const ic=(k)=>({
    plus:'<path d="M12 5v14M5 12h14"/>',
    code:'<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
    lab:'<path d="M10 2h4M12 2v6.5L7 19a1 1 0 0 0 .9 1.5h8.2A1 1 0 0 0 17 19l-5-10.5"/>',
    theme:'<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
    nav:'<path d="M5 12h14M13 6l6 6-6 6"/>'
  }[k]||'<circle cx="12" cy="12" r="9"/>');
  box.innerHTML=_palList.map((c,i)=>
    '<button class="cmdk-item'+(i===_palSel?' on':'')+'" data-pi="'+i+'">'+
      '<span class="cmdk-item-ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+ic(c.icon)+'</svg></span>'+
      '<span class="cmdk-item-label">'+escH(c.label)+'</span>'+
      '<span class="cmdk-item-group">'+escH(c.group)+'</span>'+
    '</button>').join('');
  box.querySelectorAll('[data-pi]').forEach(b=>{
    b.addEventListener('click',()=>_runPalette(parseInt(b.dataset.pi)));
    b.addEventListener('mousemove',()=>{ _palSel=parseInt(b.dataset.pi); _highlightPalette(); });
  });
}
function _highlightPalette(){
  const box=$('cmdk-results'); if(!box) return;
  box.querySelectorAll('.cmdk-item').forEach((el,i)=>el.classList.toggle('on',i===_palSel));
  const on=box.querySelector('.cmdk-item.on'); if(on) on.scrollIntoView({block:'nearest'});
}
function _runPalette(i){
  const c=_palList[i]; if(!c) return;
  closeCommandPalette();
  try{ c.run(); }catch(e){}
}
try{ window.openCommandPalette=openCommandPalette; window.closeCommandPalette=closeCommandPalette; }catch(e){}

/* ============================================================
   KEYBOARD SHORTCUT CHEAT SHEET (#19)  - press ?
   ============================================================ */
const _SHORTCUTS=[
  { group:'General', items:[
    { keys:['⌘','K'], alt:['Ctrl','K'], label:'Open command palette' },
    { keys:['?'], label:'Show this cheat sheet' },
    { keys:['Esc'], label:'Stop generating / focus the message box' },
    { keys:['⌘',','], alt:['Ctrl',','], label:'Open settings' },
    { keys:['⌘','/'], alt:['Ctrl','/'], label:'Open help' },
  ]},
  { group:'Actions', items:[
    { keys:['⌘','⇧','O'], alt:['Ctrl','⇧','O'], label:'New chat' },
    { keys:['⌘','⇧','L'], alt:['Ctrl','⇧','L'], label:'Toggle light / dark theme' },
    /* Bound in setupKeyboard and absent from this list, so the sheet that is
       meant to BE the list did not mention a shortcut that works. Two keys do
       the same thing; both are documented rather than one quietly omitted. */
    { keys:['⌘','B'], alt:['Ctrl','B'], label:'Collapse / expand sidebar' },
    { keys:['⌘','⇧','D'], alt:['Ctrl','⇧','D'], label:'Collapse / expand sidebar' },
    { keys:['⌘','⇧','V'], alt:['Ctrl','⇧','V'], label:'Toggle voice mode' },
  ]},
  { group:'Chat', items:[
    { keys:['Enter'], label:'Send message' },
    { keys:['⌘','Enter'], alt:['Ctrl','Enter'], label:'Send (even from a new line)' },
    { keys:['⇧','Enter'], label:'New line' },
  ]},
];
function _isMac(){ try{ return /Mac|iPhone|iPad/.test(navigator.platform)||/Mac/.test(navigator.userAgent); }catch(e){ return false; } }
/* The same list as flat rows, for the About screen - which had its own
   hand-written copy of six of these, with Ctrl printed on Macs. One list, two
   presentations, so a binding cannot be documented two different ways. */
function _shortcutRowsHTML(){
  const mac=_isMac();
  return _SHORTCUTS.map(sec=>sec.items.map(it=>{
    const keys=(!mac && it.alt) ? it.alt : it.keys;
    return '<div class="kbsr"><span>'+escH(it.label)+'</span><div>'+
      keys.map(k=>'<kbd>'+escH(k)+'</kbd>').join('+')+'</div></div>';
  }).join('')).join('');
}
try{ window._shortcutRowsHTML=_shortcutRowsHTML; }catch(e){}
function openShortcutSheet(){
  const r=$('ovr'); if(!r) return;
  if($('ksheet-bg')) { closeShortcutSheet(); return; }
  const mac=_isMac();
  const kbd=(keys)=>keys.map(k=>'<kbd class="ks-key">'+escH(k)+'</kbd>').join('<span class="ks-plus">+</span>');
  const sections=_SHORTCUTS.map(sec=>
    '<div class="ks-sec"><div class="ks-sec-h">'+escH(sec.group)+'</div>'+
      sec.items.map(it=>{
        const keys = (!mac && it.alt) ? it.alt : it.keys;
        return '<div class="ks-row"><span class="ks-label">'+escH(it.label)+'</span><span class="ks-keys">'+kbd(keys)+'</span></div>';
      }).join('')+
    '</div>'
  ).join('');
  r.insertAdjacentHTML('beforeend',
    '<div class="ov cmdk-ov" id="ksheet-bg"><div class="ksheet">'+
      '<div class="ks-head"><div class="ks-title">Keyboard shortcuts</div>'+
        '<button class="art-x" id="ks-x" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>'+
      '<div class="ks-body">'+sections+'</div>'+
      '<div class="ks-foot">Press <kbd class="ks-key">?</kbd> anytime to open this. <kbd class="ks-key">Esc</kbd> to close.</div>'+
    '</div></div>');
  $('ks-x')?.addEventListener('click',closeShortcutSheet);
  onBackdrop($('ksheet-bg'),closeShortcutSheet);
  const esc=(ev)=>{ if(ev.key==='Escape'){ closeShortcutSheet(); document.removeEventListener('keydown',esc); } };
  document.addEventListener('keydown',esc);
}
function closeShortcutSheet(){ const el=$('ksheet-bg'); if(el) el.remove(); }
try{ window.openShortcutSheet=openShortcutSheet; }catch(e){}

/* ============================================================
   AUTO APPROVE  (Phase 3) - visible during task setup, never buried
   in Settings. The user chooses, before the task begins, whether AMV
   must wait for approval or may complete the final action on its own,
   scoped by run, risk level, and an optional end date. Consequences are
   always stated explicitly; high-risk actions still stop and ask unless
   the risk cap is set to "Any".
   ============================================================ */
/* The risk cap is no longer something the user sets.

   It used to be three buttons - Low / Medium / Any - with warnings underneath
   like "this task could spend money". That reads as a threat at exactly the
   moment somebody is deciding to trust the product, and it asked them to make a
   safety decision they have no way to evaluate. It also let them choose "Any",
   which is the one setting that could actually cost them money.

   The rule is now fixed and simply true: anything that spends money, deletes
   information, publishes, or sends on your behalf ALWAYS stops and asks. There
   is nothing to configure, so there is nothing to warn about, and no way to
   turn the protection off by accident. */
const AUTO_APPROVE_RISK_CAP = 'low';
let _AUTOAPP={mode:'require', run:'every', risk:AUTO_APPROVE_RISK_CAP, until:null};
/* The goal-text risk classifier lived here and only ever fed the warning
   banners. The real protection was never this regex - it is the approval gate
   on the server, which stops on the ACTION being taken rather than on a guess
   about what the user typed. Guessing from the wording produced both false
   alarms and false calm, so it is gone rather than kept as a second, weaker
   opinion sitting next to the real one. */
function _aaRefresh(){
  const cfg=document.getElementById('aa-config'); if(!cfg) return;
  const on=_AUTOAPP.mode==='auto';
  cfg.style.display=on?'block':'none';
  if(!on) return;
  const permit=document.getElementById('aa-permit');
  const when = (typeof _SCHED!=='undefined' && _SCHED.cad!=='once') ? _schedHuman().toLowerCase() : 'each time it runs';
  const runTxt=_AUTOAPP.run==='once'?'the first run only':'every run';
  const untilTxt=_AUTOAPP.until?(' until '+new Date(_AUTOAPP.until+'T00:00:00').toLocaleDateString()):'';
  /* One calm sentence about what will happen, and one about what will not.
     No warnings that change as the user types - a box that starts flashing at
     the word "buy" makes the product feel dangerous rather than careful. */
  if(permit) permit.innerHTML='<b>Auto Approve enabled.</b> AMV may finish this '+escH(when)+
    ' on its own - for '+runTxt+untilTxt+'. Anything that spends money, deletes, publishes or sends '+
    'on your behalf still comes to you first. Turn this off anytime in Mission Control.';
}
function _aaInit(){
  _AUTOAPP={mode:'require', run:'every', risk:AUTO_APPROVE_RISK_CAP, until:null};
  document.querySelectorAll('input[name="aa-mode"]').forEach(r=>on(r,'change',()=>{ _AUTOAPP.mode=r.value; document.querySelectorAll('.aa-opt').forEach(o=>o.classList.remove('on')); const l=r.closest('.aa-opt'); if(l) l.classList.add('on'); _aaRefresh(); }));
  document.querySelectorAll('#aa-run button').forEach(b=>on(b,'click',()=>{ document.querySelectorAll('#aa-run button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); _AUTOAPP.run=b.dataset.aarun; _aaRefresh(); }));
  const u=document.getElementById('aa-until'); if(u) on(u,'change',()=>{ _AUTOAPP.until=u.value||null; _aaRefresh(); });
  const uc=document.getElementById('aa-until-clear'); if(uc) on(uc,'click',()=>{ _AUTOAPP.until=null; if(u) u.value=''; _aaRefresh(); });
  _aaRefresh();
}

function openCowork(){
  const r=$('ovr'); if(!r) return;
  r.innerHTML = `<div class="ov tp-ov" id="cw-bg"><div class="tp-modal cowork-modal">
    <div class="tp-head"><div><div class="eyebrow">AMV Autonomous</div><h2 class="tp-title">Give AMV an outcome</h2></div><button class="tp-x" id="cw-close">✕</button></div>
    <div class="tp-body" id="cw-step1">
      <p class="trip-sub">Describe the result you want - not the steps. AMV plans the work, executes each step itself, and brings back a finished deliverable. You approve anything that sends or shares.</p>
      <label class="tp-f"><span>What outcome do you want?</span><textarea id="cw-goal" rows="4" placeholder="e.g. 'Analyze the sales numbers in this file and write an executive summary with the top 3 insights' or 'Rename and sort every file in this folder, then write a summary of what's inside'"></textarea></label>
      <div class="tp-f"><span>Add files <span class="cw-opt-tag">Optional</span></span>
        <div class="cw-ws" id="cw-ws">
          <div class="cw-ws-lead">AMV can do this with or without files. Adding files (a spreadsheet, PDF, doc - anything) just lets it work on your actual content. <b>Not sure? Skip this</b> - just describe what you want above.</div>
          <div class="cw-ws-actions">
            <button type="button" class="btn bs" id="cw-upload">📎 Add files</button>
            <button type="button" class="btn bs" id="cw-folder">📁 Use a whole folder</button>
            <input type="file" id="cw-files" multiple style="display:none">
          </div>
          <div class="cw-ws-note" id="cw-ws-note"></div>
          <div class="cw-ws-list" id="cw-ws-list"></div>
        </div>
      </div>
      <div class="sched-panel">
        <div class="sched-label">Schedule</div>
        <div class="sched-cad" id="cw-cad">
          ${['once','daily','weekly','monthly'].map(v=>`<button type="button" class="sched-cad-b${v==='once'?' on':''}" data-cad="${v}">${({once:'Once',daily:'Daily',weekly:'Weekly',monthly:'Monthly'})[v]}</button>`).join('')}
        </div>
        <div class="sched-days" id="cw-days" style="display:none">
          <span class="sched-sub">On these days</span>
          <div class="sched-dayrow">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i)=>`<button type="button" class="sched-day${i===0?' on':''}" data-day="${(i+1)%7}">${d}</button>`).join('')}</div>
        </div>
        <div class="sched-dom" id="cw-dom" style="display:none">
          <span class="sched-sub">Day of month</span>
          <select id="cw-dom-sel">${Array.from({length:28},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('')}</select>
        </div>
        <div class="sched-time" id="cw-time" style="display:none">
          <span class="sched-sub">At</span>
          <select id="cw-hour">${Array.from({length:24},(_,h)=>`<option value="${h}"${h===9?' selected':''}>${((h%12)||12)}:00 ${h<12?'AM':'PM'}</option>`).join('')}</select>
        </div>
        <div class="cw-freq-note" id="cw-freq-note"></div>
      </div>
      <div class="aa-panel">
        <div class="sched-label">Final action</div>
        <div class="aa-opts">
          <label class="aa-opt on"><input type="radio" name="aa-mode" value="require" checked><span class="aa-radio"></span><span class="aa-opt-b"><b>Require my approval</b><span>AMV does the work, then waits. Nothing sends, publishes, or changes until you approve it.</span></span></label>
          <label class="aa-opt"><input type="radio" name="aa-mode" value="auto"><span class="aa-radio"></span><span class="aa-opt-b"><b>Auto approve &amp; complete automatically</b><span>AMV finishes and performs the final action itself - no approval each time.</span></span></label>
        </div>
        <div class="aa-config" id="aa-config" style="display:none">
          <div class="aa-permit" id="aa-permit"></div>
          <div class="aa-scope">
            <div class="aa-scope-row"><span class="aa-scope-k">Applies to</span><div class="aa-seg" id="aa-run"><button type="button" data-aarun="every" class="on">Every run</button><button type="button" data-aarun="once">First run only</button></div></div>
            <div class="aa-scope-row"><span class="aa-scope-k">Until</span><input type="date" id="aa-until" class="aa-date"><button type="button" class="aa-clear" id="aa-until-clear">No end date</button></div>
          </div>
        </div>
      </div>
      <div class="tp-foot"><span class="tp-hint">AMV works continuously until the goal is met.</span><button class="btn bp" id="cw-go">Start working →</button></div>
    </div>
    <div class="tp-body" id="cw-step2" style="display:none">
      <div class="rr">
        <div class="rr-top">
          <div class="rr-status"><span class="rr-dot" id="rr-dot"></span><span id="auto-status" class="auto-status">Working…</span></div>
          <div class="rr-prog"><div class="rr-prog-bar"><span id="rr-bar"></span></div><span id="rr-prog-lbl"></span></div>
          <div class="rr-controls">
            <button type="button" id="rr-pause" data-dact="_rrTogglePause">⏸ Pause</button>
            <button type="button" id="rr-add" data-dact="_rrAddInstruction">Add instruction</button>
            <button type="button" class="btn" id="auto-stop">Cancel</button>
          </div>
        </div>
        <div class="rr-stages" id="rr-stages"></div>
        <div class="rr-artifacts" id="rr-artifacts"></div>
        <div class="rr-approve" id="rr-approve"></div>
        <details class="rr-activity"><summary>Activity</summary><div id="auto-feed" class="auto-feed"></div></details>
      </div>
      <div id="auto-deliverable" class="auto-deliverable" style="display:none"></div>
    </div>
  </div></div>`;
  on($('cw-close'),'click',()=>{ stopAutonomous(); const x=$('ovr'); if(x) x.innerHTML=''; });
  onBackdrop($('cw-bg'),()=>{ if(!_AUTO.running){ const x=$('ovr'); if(x) x.innerHTML=''; } });
  on($('cw-go'),'click',_coworkStart);
  _SCHED={cad:'once', days:[1], dom:1, hour:9};
  const updNote=()=>{ const n=$('cw-freq-note'); if(!n) return; n.textContent = _SCHED.cad==='once' ? '' : (_schedHuman()+' - runs automatically when due while AMV is open. You still approve any send/post step.'); };
  const showFor=cad=>{ $('cw-days').style.display = cad==='weekly'?'block':'none'; $('cw-dom').style.display = cad==='monthly'?'block':'none'; $('cw-time').style.display = cad==='once'?'none':'block'; };
  document.querySelectorAll('#cw-cad .sched-cad-b').forEach(btn=>on(btn,'click',()=>{ document.querySelectorAll('#cw-cad .sched-cad-b').forEach(b=>b.classList.remove('on')); btn.classList.add('on'); _SCHED.cad=btn.dataset.cad; showFor(_SCHED.cad); updNote(); }));
  document.querySelectorAll('#cw-days .sched-day').forEach(btn=>on(btn,'click',()=>{ const d=+btn.dataset.day; btn.classList.toggle('on'); if(btn.classList.contains('on')){ if(!_SCHED.days.includes(d)) _SCHED.days.push(d); } else { _SCHED.days=_SCHED.days.filter(x=>x!==d); } updNote(); }));
  on($('cw-dom-sel'),'change',()=>{ _SCHED.dom=+$('cw-dom-sel').value; updNote(); });
  on($('cw-hour'),'change',()=>{ _SCHED.hour=+$('cw-hour').value; updNote(); });
  on($('auto-stop'),'click',stopAutonomous);
  // ---- workspace wiring ----
  AMVWorkspace.clear();
  const drawWs=()=>{
    const el=$('cw-ws-list'); const note=$('cw-ws-note'); if(!el) return;
    if(!AMVWorkspace.files.length){ el.innerHTML=''; if(note) note.innerHTML=''; return; }
    const n=AMVWorkspace.files.length;
    const held=AMVWorkspace.withheld().length;
    if(note) note.innerHTML='<span class="cw-ws-ok">✓ AMV can see '+n+' file'+(n>1?'s':'')+' - it’ll use '+(n>1?'them':'it')+' for this task.</span> <button type="button" class="cw-ws-clear" id="cw-ws-clear">Remove all</button>'+
      /* Shown rather than assumed. Holding a file back quietly would be the same
         kind of dishonesty as sending it quietly. */
      (held?'<div class="cw-ws-held">'+held+' file'+(held>1?'s':'')+' look'+(held>1?'':'s')+' like credentials, so '+(held>1?'their':'its')+' contents stay on this device. Tap “Send anyway” on one if the task needs it.</div>':'');
    el.innerHTML=AMVWorkspace.files.slice(0,40).map(f=>{
      const hold=f.secret&&f.secretOk!==true;
      return '<div class="cw-ws-file'+(hold?' held':'')+'"><span class="sl-file-ic">'+_fileIcon(f.type,f.name)+'</span>'+
        '<span class="sl-file-n">'+escH(f.path)+'</span>'+
        (f.secret?('<button type="button" class="cw-ws-hold" data-ws-allow="'+escH(f.path)+'" title="'+(hold?'Its contents are not being sent':'Its contents will be sent')+'">'+(hold?'Held back · Send anyway':'Being sent · Hold back')+'</button>'):'')+
        '<span class="sl-file-sz">'+_fmtBytes(f.size||0)+'</span></div>';
    }).join('')+
      (n>40?'<div class="cw-ws-more">+'+(n-40)+' more</div>':'');
    el.querySelectorAll('[data-ws-allow]').forEach(b=>on(b,'click',()=>{
      const p=b.dataset.wsAllow, f=AMVWorkspace.files.find(x=>x.path===p);
      AMVWorkspace.allowSecret(p, !(f&&f.secretOk===true)); drawWs();
    }));
    const clr=$('cw-ws-clear'); if(clr) on(clr,'click',()=>{ AMVWorkspace.clear(); drawWs(); });
  };
  on($('cw-folder'),'click',async()=>{
    if(!AMVWorkspace.supported()){ toast('Folder access needs Chrome or Edge on desktop. Use “Upload files” instead - it works everywhere.','info',6000); return; }
    if(!window.isSecureContext){ toast('Folder access needs a secure (https) page. Use “Upload files” instead - same result.','info',7000); return; }
    try{ await AMVWorkspace.connectFolder(); drawWs(); toast('Folder connected - AMV can read and write these files.','success',4000); }
    catch(e){ if(e.message==='cancelled') return; if(e.message==='insecure'){ toast('Folder access needs a secure (https) page. Use “Upload files” instead.','info',7000); return; } toast('Could not open that folder. Try “Upload files” instead.','error',5000); }
  });
  on($('cw-upload'),'click',()=>$('cw-files')&&$('cw-files').click());
  on($('cw-files'),'change',async function(){ const before=AMVWorkspace.files.length; await AMVWorkspace.addUploads(this.files); drawWs(); const added=AMVWorkspace.files.length-before; this.value=''; if(added>0) toast('Added '+added+' file'+(added>1?'s':'')+' - AMV will use '+(added>1?'them':'it'),'success',3000); });
  _aaInit();
}
let _coworkClarified=false;
/* Show clarifying questions inside the cowork modal before the run starts. */
function _cwShowClarify(questions){
  const host=$('cw-step1'); if(!host) return;
  let panel=$('cw-clarify');
  if(!panel){ panel=document.createElement('div'); panel.id='cw-clarify'; panel.className='cw-clarify'; const foot=host.querySelector('.tp-foot'); if(foot) host.insertBefore(panel, foot); else host.appendChild(panel); }
  panel.innerHTML='<div class="cw-clarify-h">Before I start, a couple of details so I get it right:</div>'+
    '<ul class="cw-clarify-qs">'+questions.map(q=>'<li>'+escH(q)+'</li>').join('')+'</ul>'+
    '<textarea id="cw-clarify-input" rows="2" placeholder="Answer here"></textarea>'+
    '<div class="cw-clarify-act"><button class="btn bp" id="cw-clarify-go">Continue</button></div>';
  _coworkClarified=true;   // a second Start-working click (or Continue) proceeds
  on($('cw-clarify-go'),'click',()=>{ const a=($('cw-clarify-input')||{}).value||''; if(a.trim()){ const g=$('cw-goal'); if(g) g.value=(g.value.trim()+'\n\nDetails: '+a.trim()); } panel.remove(); _coworkStart(); });
  const inp=$('cw-clarify-input'); if(inp) inp.focus();
}
async function _coworkStart(){
  const goal=$('cw-goal')?$('cw-goal').value.trim():'';
  if(!goal){ toast('Describe the outcome you want','error'); $('cw-goal')&&$('cw-goal').focus(); return; }
  // Scan for missing details and ask BEFORE any work starts.
  if(!_coworkClarified){
    const goBtn=$('cw-go'); if(goBtn){ goBtn.disabled=true; goBtn.textContent='Reading…'; }
    let c={ok:true,questions:[]};
    try{ c=await _clarifyCheck(goal); }catch(e){}
    if(goBtn){ goBtn.disabled=false; goBtn.textContent='Start working →'; }
    if(!c.ok){ _cwShowClarify(c.questions); return; }
  }
  _coworkClarified=false;   // reset for the next task
  const cad=(_SCHED&&_SCHED.cad)||'once';
  let _schedId=null;
  if(cad!=='once'){ _schedId=_scheduleAuto2(goal, Object.assign({},_SCHED), {approval:(_AUTOAPP&&_AUTOAPP.mode)||'require', scope:_AUTOAPP?{run:_AUTOAPP.run,risk:_AUTOAPP.risk,until:_AUTOAPP.until}:null}); }
  $('cw-step1').style.display='none'; $('cw-step2').style.display='block';
  if(cad!=='once'){ _autoLog('<div class="auto-ev plan"><b>Scheduled</b><div>'+_schedHuman()+'. Running the first one now. AMV runs this automatically when due (and catches up when you return). Connect the backend for true 24/7.</div></div>'); }
  const ws=AMVWorkspace.files.length?AMVWorkspace:null;
  if(ws){ _autoLog('<div class="auto-ev plan"><b>Workspace</b><div>Working across '+ws.files.length+' file'+(ws.files.length>1?'s':'')+(ws.dirHandle?' in your connected folder. Results will be written back to disk.':'. Results will be offered as downloads.')+'</div></div>'); }
  runAutonomous(goal, Object.assign({ schedId:_schedId }, ws?{ workspace:ws, fileContent:ws.contextText() }:{}));
}
function _freqLabel(f){ return {daily:'Every day',weekdays:'Every weekday',weekly_mon:'Every Monday morning',weekly:'Every week',hourly:'Every hour'}[f]||f; }
function _freqNext(f, from){
  const d=new Date(from||Date.now());
  if(f==='hourly') return from+36e5;
  if(f==='daily'||f==='weekdays'){ d.setDate(d.getDate()+1); d.setHours(8,0,0,0); if(f==='weekdays'){ while(d.getDay()===0||d.getDay()===6) d.setDate(d.getDate()+1); } return d.getTime(); }
  if(f==='weekly') return from+6048e5;
  if(f==='weekly_mon'){ d.setDate(d.getDate()+((8-d.getDay())%7||7)); d.setHours(8,0,0,0); return d.getTime(); }
  return from+864e5;
}
/* _scheduleAuto lived here. Its only caller was the chat intent router, which
   created a recurring background job from a regex on the user's sentence with
   nobody asked and the raw message as the instruction - see the note where that
   branch used to be. Chat now lets the model use crew_add instead, which writes
   a real instruction and shows what will run before it runs.

   Deleted rather than left orphaned: a function that quietly creates recurring
   spend from a string, sitting unused next to the schedulers that are in use,
   is the sort of thing that gets wired back up by somebody looking for exactly
   that signature. _scheduleAuto2 below is a different function and is live. */
/* load/store, not raw localStorage: raw bypasses _scopeKey, so this list was
   shared by every account on the device. Signing in as somebody else showed
   their scheduled jobs - goals that often carry personal detail - and
   _runDueAuto then executed them under whoever happened to be signed in,
   spending their quota on another person's work. */
function _loadSched(){ try{ const v = load('amv_autosched'); return Array.isArray(v) ? v : []; }catch(e){ return []; } }
function _saveSched(l){ try{ store('amv_autosched', l); }catch(e){} }
async function _runDueAuto(){
  if(typeof _autonomyPaused==='function' && _autonomyPaused()) return;
  const list=_loadSched(); if(!list.length) return;
  const now=Date.now(); let changed=false; let ranAny=false;
  // If the AI backend isn't connected, scheduled work can't actually run.
  // Roll overdue tasks forward silently (no misleading "running" toast).
  const canRun = (typeof _aiBackendReady==='function') ? _aiBackendReady() : false;
  for(const t of list){
    if(t.paused) continue;
    if(t.next<=now){
      // always advance the schedule so a past-due task can't re-fire every load
      t.lastRun=now; t.next=(t.sched?_schedNext(t.sched,now):_freqNext(t.freq,now)); changed=true;
      if(!canRun) continue;                    // can't run without the engine - just reschedule
      ranAny=true;
      try{
        if(t.approval==='auto'){ await runAutonomous(t.goal,{silent:true}); }   // autonomous: runs and (backend) sends
        else { await _recurMakeApproval(t); }                                    // ask-first: prepare a fresh draft to approve
      }catch(e){ _logErr('scheduledTask', e); }
    }
  }
  if(ranAny && typeof toast==='function') toast('A running job just ran','info',2500);
  if(changed) _saveSched(list);
}
/* Short, clean title for a job's generated draft. */
function _recurTitle(t){ const g=(t.goal||'Task').replace(/\s+/g,' ').trim(); return g.length>60?g.slice(0,60).trim()+'…':g; }
/* An "ask first" running job just came due: generate the finished content and
   drop it into "Needs your approval" so the user reviews a fresh draft each run.
   Nothing is sent until they approve. */
async function _recurMakeApproval(t){
  const emailMatch=(t.goal||'').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const to = emailMatch?emailMatch[0]:'';
  const sys=_AMVSYS+' Produce the finished result exactly as it should be sent, with flawless spelling, grammar, and punctuation. No placeholders. If it is an email, write only the body (no subject line).';
  let body='';
  try{ body=_noDash(await aiComplete((t.goal||'')+'\n\nProduce the finished, ready-to-send result now.', sys, {max_tokens:1500})); }catch(e){ body=''; }
  if(!body) return;
  const title=_recurTitle(t);
  const schedLabel = t.sched?(typeof _schedHumanOf==='function'?_schedHumanOf(t.sched):''):(typeof _freqLabel==='function'?_freqLabel(t.freq):'');
  const ap=_cwApprovals();
  ap.unshift({
    id:'a'+Date.now(), icon: to?'📧':'📄',
    title,
    requesting:'Prepared by your running job. Review, edit anything, then send.',
    actionType: to?'send':'submit',
    resultType: to?'email':'doc',
    destination: to||'', recipients: to?1:null,
    account:(S.user&&S.user.email)||'', autoApprove:false,
    readyAt:Date.now(), fromJob:t.id, jobTitle:title, jobSchedule:schedLabel,
    result: to?{type:'email',from:(S.user&&S.user.email)||'',to,subject:title,body}:{type:'doc',body}
  });
  _cwSaveApprovals(ap);
  if(S.tab==='crew'){ try{ renderCrewView(); }catch(e){} }
  if(typeof toast==='function') toast('A running job prepared a draft for your approval','info',4200);
}
/* ============================================================
   SCHEDULED AUTONOMOUS MANAGEMENT  (Phase 5)
   A real control surface for recurring work: cadence, next/last run,
   approval mode, and per-task pause/resume - plus switching a task
   between "require approval" and "auto-approve" without recreating it.
   All values are real (from the schedule record); nothing is invented.
   ============================================================ */
/* Refresh whichever surface the job list is showing: the manager modal if it's
   open, and the Crew page if that's the current tab. Never pops the modal open
   when it wasn't already. */
function _schedRefreshViews(){ if($('sm-bg')) openSchedManager(); if(S.tab==='crew'){ try{ renderCrewView(); }catch(e){} } }
function _schedTogglePause(id){
  const l=_loadSched(); const t=l.find(x=>x.id===id);
  if(t){ t.paused=!t.paused; _saveSched(l); if(typeof toast==='function') toast(t.paused?'Job paused':'Job resumed','info'); }
  _schedRefreshViews();
}
function _schedToggleApproval(id){
  const l=_loadSched(); const t=l.find(x=>x.id===id);
  if(t){ t.approval=(t.approval==='auto')?'require':'auto'; _saveSched(l); if(typeof toast==='function') toast(t.approval==='auto'?'Now autonomous - AMV sends this automatically, it will not appear in Needs your approval':'Now asks first - AMV will drop a draft in Needs your approval each time','info',4200); }
  _schedRefreshViews();
}
function _schedCancel(id){
  _saveSched(_loadSched().filter(t=>t.id!==id)); if(typeof toast==='function') toast('Job cancelled','info');
  _schedRefreshViews();
}
window._schedTogglePause=_schedTogglePause; window._schedToggleApproval=_schedToggleApproval; window._schedCancel=_schedCancel;

/* Full editor for a scheduled task: change what it does, how often, when, and
   its approval mode. Saving recomputes the next run and persists the record
   (and the backend schedule when connected), so the edit is really in effect. */
function _schedEdit(id){
  const l=_loadSched(); const t=l.find(x=>x.id===id); if(!t){ if(typeof toast==='function') toast('That task is no longer scheduled','info'); return; }
  const r=$('ovr'); if(!r) return;
  const cad = t.sched ? t.sched.cad : ({daily:'daily',weekdays:'daily',weekly:'weekly',weekly_mon:'weekly',hourly:'hourly'}[t.freq]||'daily');
  const hour = (t.sched&&t.sched.hour!=null)?t.sched.hour:8;
  const days = (t.sched&&t.sched.days)?t.sched.days:[1];
  const dom = (t.sched&&t.sched.dom)||1;
  const appr = t.approval==='auto'?'auto':'require';
  const hourOpts = Array.from({length:24},(_,h)=>`<option value="${h}"${h===hour?' selected':''}>${_hourLabel(h)}</option>`).join('');
  const dayChk = _DOWNAMES.map((d,i)=>`<label class="ape-day"><input type="checkbox" data-schday="${i}"${days.includes(i)?' checked':''}> ${d}</label>`).join('');
  const domOpts = Array.from({length:28},(_,i)=>`<option value="${i+1}"${(i+1)===dom?' selected':''}>${i+1}</option>`).join('');
  r.innerHTML=`<div class="ov ape-ov" id="sce-bg"><div class="ape" role="dialog" aria-label="Edit scheduled work">
    <header class="ape-top">
      <button class="pvw-back ape-back" data-dact="apvClose" aria-label="Back">← <span>Back</span></button>
      <div class="ape-top-t">Edit scheduled work</div>
    </header>
    <div class="ape-body">
      <label class="ape-f"><span>What AMV should do</span><textarea id="sce-goal" rows="4">${escH(t.goal||'')}</textarea></label>
      <label class="ape-f"><span>How often</span><select id="sce-cad">
        <option value="daily"${cad==='daily'?' selected':''}>Every day</option>
        <option value="weekly"${cad==='weekly'?' selected':''}>Weekly</option>
        <option value="monthly"${cad==='monthly'?' selected':''}>Monthly</option>
        <option value="hourly"${cad==='hourly'?' selected':''}>Every hour</option>
      </select></label>
      <label class="ape-f" id="sce-hour-f"><span>Time</span><select id="sce-hour">${hourOpts}</select></label>
      <div class="ape-f" id="sce-days-f"><span>Days</span><div class="ape-days">${dayChk}</div></div>
      <label class="ape-f" id="sce-dom-f"><span>Day of month</span><select id="sce-dom">${domOpts}</select></label>
      <label class="ape-f"><span>Approval</span><select id="sce-appr">
        <option value="require"${appr==='require'?' selected':''}>Wait for my approval</option>
        <option value="auto"${appr==='auto'?' selected':''}>Auto-approve</option>
      </select></label>
    </div>
    <footer class="ape-foot">
      <button class="btn ape-del" data-dact="_schedEditDelete" data-darg="${t.id}">Delete</button>
      <div class="ape-foot-r">
        <button class="btn pvw-approve ape-save" data-dact="_schedEditSave" data-darg="${t.id}">Save</button>
      </div>
    </footer>
  </div></div>`;
  onBackdrop($('sce-bg'),apvClose);
  const sync=()=>{ const c=$('sce-cad').value; const hf=$('sce-hour-f'),df=$('sce-days-f'),mf=$('sce-dom-f'); if(hf)hf.style.display=(c==='hourly')?'none':'flex'; if(df)df.style.display=(c==='weekly')?'block':'none'; if(mf)mf.style.display=(c==='monthly')?'flex':'none'; };
  on($('sce-cad'),'change',sync); sync();
  setTimeout(()=>{ try{ $('sce-goal').focus(); }catch(e){} },30);
}
function _schedEditSave(id){
  const l=_loadSched(); const t=l.find(x=>x.id===id); if(!t){ apvClose(); return; }
  const goal=$('sce-goal'); if(goal) t.goal=goal.value.trim()||t.goal;
  const cad=($('sce-cad')||{}).value||'daily';
  t.approval=($('sce-appr')||{}).value==='auto'?'auto':'require';
  if(cad==='hourly'){ delete t.sched; t.freq='hourly'; t.next=_freqNext('hourly',Date.now()); }
  else{
    const hour=parseInt(($('sce-hour')||{}).value,10)||8;
    const s={cad,hour};
    if(cad==='weekly'){ s.days=[...document.querySelectorAll('[data-schday]:checked')].map(x=>+x.dataset.schday); if(!s.days.length) s.days=[1]; }
    if(cad==='monthly'){ s.dom=parseInt(($('sce-dom')||{}).value,10)||1; }
    t.sched=s; delete t.freq; t.next=_schedNext(s,Date.now());
  }
  _saveSched(l);
  apvClose();
  /* The server keeps its own copy and runs from it. This edit was sent and
     forgotten, and "Schedule updated" went out regardless - so somebody who
     moved a daily job to weekly, or changed the hour it runs, was told it had
     changed while the server carried on with the old one. */
  (async()=>{
    let res = { ok:false, code:'needs_service' };
    if(window.AMV_API && AMV_API.live && typeof AMV_API._fetch==='function'){
      /* A job only exists on the server if it was registered there, and the id
         it was given is the only way to name it. Without one there is nothing
         to edit remotely, and saying "updated" would be a claim about a job the
         server has never heard of. */
      if(!t.autoId){ res = { ok:false, code:'local_only' }; }
      else{
        try{
          const r = await AMV_API._fetch('/auto/update',{method:'POST',
            body:JSON.stringify({ id:t.autoId, action:'edit', detail:t.goal,
              repeat:(typeof _mcRepeatFor==='function'?_mcRepeatFor(t):'daily'),
              approval:t.approval })});
          const d = await r.json().catch(()=>({}));
          res = (!r.ok || d.error) ? { ok:false, code:'failed', error:d.error||'' } : { ok:true };
        }catch(e){ res = { ok:false, code:'failed', error:(e&&e.message)||'' }; }
      }
    }
    if(typeof toast!=='function') return;
    if(res.ok){ toast('Schedule updated','success'); return; }
    if(res.code==='needs_service'){ toast('Updated on this device. It applies to background runs once AMV is connected to a backend.','info',6000); return; }
    if(res.code==='local_only'){ toast('Updated. This job only ever ran while AMV is open, so there is nothing on the server to change.','info',6000); return; }
    toast('Updated here, but the server was NOT told'+(res.error?' ('+res.error+')':'')+
          ' - it is still running on the old schedule. Try again.','error',7000);
  })();
  if(S.tab==='crew'){ try{ renderCrewView(); }catch(e){} }
}
function _schedEditDelete(id){ if(!confirm('Delete this scheduled task?')) return; apvClose(); _schedCancel(id); }
window._schedEdit=_schedEdit; window._schedEditSave=_schedEditSave; window._schedEditDelete=_schedEditDelete;

function _smRow(t){
  const cadence = t.sched ? _schedHumanOf(t.sched) : ((typeof _freqLabel==='function')?_freqLabel(t.freq):'');
  let nextTxt='';
  try{ nextTxt = t.paused ? 'Paused' : new Date(t.next).toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }catch(e){ nextTxt = t.paused?'Paused':''; }
  const lastTxt = t.lastRun ? new Date(t.lastRun).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'Not run yet';
  const auto = t.approval==='auto';
  const mode = t.paused
    ? '<span class="mc-sched-mode paused">Paused</span>'
    : (auto ? '<span class="mc-sched-mode auto">Autonomous - sends automatically</span>' : '<span class="mc-sched-mode req">Ask first - you approve each one</span>');
  return `<div class="smr${t.paused?' paused':''}">
    <div class="smr-top"><div class="smr-goal">${escH(t.goal||'Running job')}</div>${mode}</div>
    <div class="smr-meta">
      <span><b>Runs</b> ${escH(cadence)}</span>
      <span><b>Next</b> ${escH(nextTxt)}</span>
      <span><b>Last run</b> ${escH(lastTxt)}</span>
      ${t.localOnly?'<span class="smr-local">Runs while AMV is open</span>':''}
    </div>
    <div class="smr-act">
      <button class="btn mc-mini ghost" data-dact="_schedEdit" data-darg="${t.id}">Edit</button>
      <button class="btn mc-mini ghost" data-dact="_schedTogglePause" data-darg="${t.id}">${t.paused?'Resume':'Pause'}</button>
      <button class="btn mc-mini ${auto?'ghost':'bp'}" data-dact="_schedToggleApproval" data-darg="${t.id}">${auto?'Make me approve first':'Make autonomous'}</button>
      <button class="btn mc-mini ghost smr-cancel" data-dact="_schedCancel" data-darg="${t.id}">Cancel</button>
    </div>
  </div>`;
}

/* Scheduled work manager */
function openSchedManager(){
  const r=$('ovr'); if(!r) return;
  const list=_loadSched();
  const anyPaused = (typeof _autonomyPaused==='function') && _autonomyPaused();
  const rows = list.length ? list.map(_smRow).join('') : '<div class="lab-placeholder">No running jobs yet. Start an autonomous task and choose how often it should repeat.</div>';
  r.innerHTML=`<div class="ov tp-ov" id="sm-bg"><div class="tp-modal">
    <div class="tp-head"><div><div class="eyebrow">AMV Autonomous</div><h2 class="tp-title">Running jobs</h2></div><button class="tp-x" id="sm-close" aria-label="Close">\u2715</button></div>
    <div class="tp-body">
      <p class="trip-sub">Recurring work AMV runs for you. Each run makes fresh content. <b>Autonomous</b> jobs send automatically and never appear in Needs your approval; <b>Ask first</b> jobs drop a draft there every time so you review before it sends. They run when due while AMV is open and catch up when you return - connect the backend for true 24/7. Pause, switch the mode, or cancel anytime.</p>
      ${anyPaused?'<div class="mc-paused-banner" style="margin-bottom:14px"><b>All autonomous work is paused.</b> Individual schedules won\u2019t run until you resume from Mission Control.</div>':''}
      <div class="sched-list">${rows}</div>
    </div>
  </div></div>`;
  on($('sm-close'),'click',()=>{ const x=$('ovr'); if(x) x.innerHTML=''; });
  onBackdrop($('sm-bg'),()=>{ const x=$('ovr'); if(x) x.innerHTML=''; });
  setTimeout(()=>{ try{ $('sm-close').focus(); }catch(e){} },30);
}
window.openSchedManager=openSchedManager;
window.openCowork=openCowork; window.runAutonomous=runAutonomous;


setTimeout(function(){ try{ if(typeof _runDueAuto==="function") _runDueAuto(); }catch(e){} }, 3500);
// Localize any prices on the landing page for logged-out visitors, too.
setTimeout(function(){ try{ if(typeof _localizePrices==="function") _localizePrices(document); }catch(e){} }, 400);

let _SCHED={cad:'once', days:[1], dom:1, hour:9};
function _hourLabel(h){ return ((h%12)||12)+':00 '+(h<12?'AM':'PM'); }
const _DOWNAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function _schedHuman(){
  const t='at '+_hourLabel(_SCHED.hour);
  if(_SCHED.cad==='daily') return 'Every day '+t;
  if(_SCHED.cad==='weekly'){ const ds=_SCHED.days.slice().sort().map(d=>_DOWNAMES[d]); return (ds.length?ds.join(', '):'(pick days)')+' '+t; }
  if(_SCHED.cad==='monthly') return 'Day '+_SCHED.dom+' of each month '+t;
  return '';
}
function _schedNext(s, from){
  const now=new Date(from||Date.now());
  if(s.cad==='daily'){ const d=new Date(now); d.setHours(s.hour,0,0,0); if(d<=now) d.setDate(d.getDate()+1); return d.getTime(); }
  if(s.cad==='weekly'){ const days=(s.days&&s.days.length)?s.days:[1]; let best=null; for(let i=0;i<14;i++){ const d=new Date(now); d.setDate(d.getDate()+i); d.setHours(s.hour,0,0,0); if(days.includes(d.getDay()) && d>now){ best=d.getTime(); break; } } return best||(from+6048e5); }
  if(s.cad==='monthly'){ const d=new Date(now); d.setDate(s.dom); d.setHours(s.hour,0,0,0); if(d<=now){ d.setMonth(d.getMonth()+1); d.setDate(s.dom); } return d.getTime(); }
  return from+864e5;
}


function _scheduleAuto2(goal, s, appr){
  appr=appr||{};
  const list=_loadSched();
  const id='a'+Date.now();
  list.push({id, goal, sched:s, next:_schedNext(s, Date.now()), created:Date.now(), lastRun:null, approval:appr.approval||'require', scope:appr.scope||null});
  _saveSched(list);
  const modeTxt=(appr.approval==='auto')?' · Auto-approve':'';
  if(typeof toast==='function') toast('Scheduled - '+_schedHumanOf(s)+modeTxt,'success');
  /* Returned so the run that starts immediately afterwards can be TAGGED with
     the job it belongs to. Without that link a finished run looks exactly like
     a finished job, which is how a daily 9am check ended up filed under
     "Completed" while it was still running every morning. */
  return id;
}
function _schedHumanOf(s){
  const t='at '+_hourLabel(s.hour);
  if(s.cad==='daily') return 'Every day '+t;
  if(s.cad==='weekly'){ const ds=(s.days||[]).slice().sort().map(d=>_DOWNAMES[d]); return ds.join(', ')+' '+t; }
  if(s.cad==='monthly') return 'Day '+s.dom+' of each month '+t;
  return s.cad;
}


function openCoworkWith(goal){ openCowork(); setTimeout(()=>{ const g=$('cw-goal'); if(g){ g.value=goal; g.focus(); } const wk=document.querySelector('[data-cad="weekly"]'); }, 60); }
window.openCoworkWith=openCoworkWith;