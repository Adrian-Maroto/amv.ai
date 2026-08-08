/* ============================================================
   HANDOFF  - pass any task/chat/draft to another user or to Crew.
   They get full context, continue or approve, and pass it back.
   Stored per-account; recipient sees it in their own Handoff inbox.
   (Live cross-user delivery activates with the server backend; this
   is the full UX + local record.)
   ============================================================ */
/* What the sender is told about each one. A raw status token told them nothing,
   and "waiting" for something that never left the device was the wrong word
   entirely - waiting implies it is with the other person. */
const _HO_STATUS = {
  sending:  'Sending…',
  waiting:  'Waiting on them',
  not_sent: 'Not delivered - no backend connected',
  failed:   'Not delivered',
  crew:     'With your Crew',
  seen:     'They have opened it',
  done:     'Done',
};
/* The states where the work is still sitting here, and a retry is meaningful. */
const _HO_UNSENT = ['not_sent','failed'];

function _hoOut(){ return load('amv_handoffs_out') || []; }
function _hoIn(){ return load('amv_handoffs_in') || []; }
function _hoSaveOut(a){ store('amv_handoffs_out', a); }
function _hoSaveIn(a){ store('amv_handoffs_in', a); }

async function _handoffSyncLive(){
  if(!(window.AMV_API && AMV_API.live)) return;
  try{ const d=await AMV_API.listHandoff();
    if(d.incoming) store('amv_handoffs_in', d.incoming.map(h=>({id:h.id,from:h.from_email,title:h.title,context:h.context,when:''})));
    if(d.sent){
      /* Merged, not replaced. A handoff that never reached the server is not IN
         the server's list, so overwriting wholesale deleted the undelivered
         ones - taking the pasted work with them, and leaving nothing to retry
         and no sign anything had been lost. Those are kept; everything the
         server knows about is its version. */
      const keep=_hoOut().filter(h=>h && (_HO_UNSENT.indexOf(h.status)>=0 || h.status==='crew'));
      const fromServer=d.sent.map(h=>({id:h.id,to:h.to_email,title:h.title,status:h.status,when:''}));
      const seen=new Set(fromServer.map(h=>h.id));
      store('amv_handoffs_out', fromServer.concat(keep.filter(h=>!seen.has(h.id))));
    }
    renderHandoffView();
  }catch(e){}
}
function renderHandoffView(){
  const vc=$('vc'); if(!vc) return;
  const out=_hoOut(), inb=_hoIn();
  const card=(h,dir)=>`<div class="ho-card">
      <div class="ho-h">
        <span class="ho-dir ${dir}">${dir==='in'?'Incoming':'Sent'}</span>
        <span class="ho-to">${dir==='in'?('from '+escH(h.from||'someone')):('to '+escH(h.to))}</span>
        <span class="ho-when">${h.when||''}</span>
      </div>
      <div class="ho-t">${escH(h.title)}</div>
      <div class="ho-ctx">${escH(h.context||'').slice(0,180)}${(h.context||'').length>180?'…':''}</div>
      <div class="ho-act">
        ${dir==='in'
          ? `<button class="btn bp" data-dact="hoOpen" data-darg="${h.id}">Open & continue</button><button class="btn bs" data-dact="hoDone" data-darg="${h.id}">Mark done</button>`
          : `<span class="ho-status ho-status-${escH(h.status||'waiting')}">${escH(_HO_STATUS[h.status]||_HO_STATUS.waiting)}</span>`+
            (_HO_UNSENT.indexOf(h.status)>=0
              ? `<button class="btn bs" data-dact="hoResend" data-darg="${h.id}">Send again</button>` : '')}
      </div>
    </div>`;
  vc.innerHTML=`<div class="sv fi"><div class="vi">
      <span class="eyebrow">Collaboration</span>
      <h2>Handoff</h2>
      <p class="vsub">Don\u2019t describe the work - hand over the work itself. Pull in a conversation, a Studio design, a Dev project or Lab code, or paste anything at all; your teammate or a Crew agent picks it up <b>inside AMV</b> with full context, makes the change, and hands it back.</p>
      <div class="ho-flow"><span class="ho-flow-step">You paste the work</span><span class="ho-flow-arrow">\u2192</span><span class="ho-flow-step">They pick up the baton</span><span class="ho-flow-arrow">\u2192</span><span class="ho-flow-step">Handed back</span></div>

      <div class="ss2">
        <h3>Hand something off</h3>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div><label class="lbl" style="font-size:11px;color:var(--mu)">What are you handing off?</label>
            <input id="ho-title" placeholder="e.g. Finish the Q3 report intro" style="width:100%;background:var(--glass);border:1px solid var(--glass-bd);border-radius:var(--r-md);padding:12px;color:var(--tx);font-family:var(--fn);font-size:14px"></div>
          <div><label class="lbl" style="font-size:11px;color:var(--mu)">The work itself - paste it here</label>
            <textarea id="ho-ctx" placeholder="Paste the actual content the next person (or the agent) should work on: the draft, the code, the data, the email thread, the brief - plus anything they need to know to continue. This is the baton they pick up." style="width:100%;min-height:220px;background:var(--glass);border:1px solid var(--glass-bd);border-radius:var(--r-md);padding:12px;color:var(--tx);font-family:var(--mn,ui-monospace,monospace);font-size:13px;line-height:1.6;resize:vertical;tab-size:2"></textarea>
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
              <button class="btn bs" data-dact="_hoPickChat" style="font-size:11.5px">Pull in your work…</button>
              <span style="font-size:11px;color:var(--mu);align-self:center">a conversation, a design, a project or some code - or just paste anything above</span>
            </div></div>
          <div><label class="lbl" style="font-size:11px;color:var(--mu)">Hand off to</label>
            <input id="ho-to" placeholder="teammate@email.com  - or type: crew" style="width:100%;background:var(--glass);border:1px solid var(--glass-bd);border-radius:var(--r-md);padding:12px;color:var(--tx);font-family:var(--fn);font-size:14px"></div>
          <button class="btn bp" data-dact="hoSend" style="align-self:flex-start">Send handoff</button>
        </div>
      </div>

      <div class="ss2" style="margin-top:18px">
        <h3>Incoming ${inb.length?`<span class="cw-badge">${inb.length}</span>`:''}</h3>
        ${inb.length?inb.map(h=>card(h,'in')).join(''):'<div class="cw-empty">Nothing handed to you yet.</div>'}
      </div>

      <div class="ss2" style="margin-top:18px">
        <h3>Sent</h3>
        ${out.length?out.map(h=>card(h,'out')).join(''):'<div class="cw-empty">You haven\u2019t handed anything off yet.</div>'}
      </div>
    </div></div>`;
}
/* Pick ANY of your chats to hand off (not just the last one). Selecting one
   pulls its content into the handoff and remembers which conversation it is, so
   whoever opens the handoff continues on that same chat. */
function _hoConvText(conv){
  const txt=m=>typeof m.c==='string'?m.c:(Array.isArray(m.c)?(m.c.map(x=>x&&x.text?x.text:'').join(' ')):'');
  return conv.msgs.slice(-20).map(m=>(m.r==='u'?'You: ':'AMV: ')+txt(m)).join('\n\n');
}
/* ============================================================
   AMV-103  HAND OFF THE ACTUAL WORK.

   Handoff's whole premise is "do not describe the work, hand over the work" -
   and it could only reach conversations. A design in Studio, a project in Dev, a
   script in Lab: all of it had to be copied out by hand and pasted back in,
   which is exactly the retyping the feature exists to avoid.

   Everything AMV saves as a session is now pullable, and each kind is turned
   into text the person on the other end can actually use: a design comes with
   its brief and its markup, a project with its file list and their contents, a
   script with the code and what was said about it.
   ============================================================ */
function _hoSessText(rec){
  const st=(rec&&rec.state)||{};
  const cap=(v,n)=>String(v||'').slice(0,n);
  if(rec.kind==='studio'){
    const arts=(st.artifacts||[]).filter(a=>a&&(a.html||a.brief));
    const a=arts.find(x=>x.id===st.activeId)||arts[0];
    if(!a) return '';
    return '[Studio design]\n'+
      (st.prompt?('What was asked for:\n'+cap(st.prompt,600)+'\n\n'):'')+
      (a.brief?('Brief:\n'+cap(a.brief,800)+'\n\n'):'')+
      (a.html?('Markup:\n'+cap(a.html,12000)):'');
  }
  if(rec.kind==='dev'){
    const files=Object.keys(st.project||{});
    const asked=(st.log||[]).filter(l=>l&&l.role==='user').slice(-4).map(l=>'- '+cap(l.text,200)).join('\n');
    const body=files.slice(0,12).map(f=>{
      const c=(st.project[f]&&st.project[f].content)||'';
      return '--- '+f+' ---\n'+cap(c,4000);
    }).join('\n\n');
    return '[Dev project]\n'+
      (asked?('What was asked for:\n'+asked+'\n\n'):'')+
      (files.length?('Files ('+files.length+'):\n'+files.join(', ')+'\n\n'+body):cap(st.curCode,8000));
  }
  if(rec.kind==='lab'){
    const said=(st.chat||[]).slice(-4).map(m=>(m.role==='user'?'You: ':'AMV: ')+cap(m.text||m.content,200)).join('\n');
    return '[Lab '+(st.lang||'code')+']\n'+
      (said?('What was discussed:\n'+said+'\n\n'):'')+
      'Code:\n'+cap(st.code,12000);
  }
  return '';
}

function _hoPickChat(){
  /* One picker for everything handable, grouped by what it is. Separate buttons
     per kind would have meant four buttons that are empty most of the time. */
  const convs=(S.convs||[]).filter(c=>c&&c.msgs&&c.msgs.length);
  const sess=((typeof _SESSIONS!=='undefined'&&_SESSIONS)||[])
    .filter(x=>x&&['studio','dev','lab'].indexOf(x.kind)>=0 && _hoSessText(x))
    .slice().sort((a,b)=>(b.updated||0)-(a.updated||0));

  if(!convs.length && !sess.length){
    toast('Nothing to hand off yet - start a chat, a design, a project or some code first','info',4500);
    return;
  }
  const r=$('ovr'); if(!r) return;

  const KIND={studio:'Design',dev:'Project',lab:'Code'};
  const chatRows=convs.map(c=>{
    const last=c.msgs[c.msgs.length-1];
    const prev=(typeof last.c==='string'?last.c:(Array.isArray(last.c)?last.c.map(x=>x&&x.text?x.text:'').join(' '):'')).replace(/\s+/g,' ').trim().slice(0,90);
    return '<button class="hopick-row" data-hopick="'+escH(c.id)+'"><div class="hopick-t">'+escH(c.title||'Untitled chat')+'</div><div class="hopick-p">'+escH(prev||'(no messages)')+'</div></button>';
  }).join('');
  const sessRows=sess.map(x=>{
    const prev=_hoSessText(x).replace(/\s+/g,' ').replace(/^\[[^\]]*\]\s*/,'').trim().slice(0,90);
    return '<button class="hopick-row" data-hosess="'+escH(x.id)+'">'+
      '<div class="hopick-t"><span class="hopick-kind">'+escH(KIND[x.kind]||x.kind)+'</span>'+escH(x.title||'Untitled')+'</div>'+
      '<div class="hopick-p">'+escH(prev||'(empty)')+'</div></button>';
  }).join('');

  r.innerHTML='<div class="ov" id="hopick-bg"><div class="ob hopick-modal" onclick="event.stopPropagation()" style="max-width:520px">'+
    '<button class="oc" onclick="closeOvr()">×</button>'+
    '<h2 style="margin:0 0 4px">Pull in your work</h2>'+
    '<p style="font-size:12.5px;color:var(--mu);margin:0 0 14px">A conversation, a design, a project or some code. '+
      'The actual content comes across, not a description of it.</p>'+
    (sessRows?'<div class="hopick-h">Designs, projects and code</div><div class="hopick-list">'+sessRows+'</div>':'')+
    (chatRows?'<div class="hopick-h">Conversations</div><div class="hopick-list">'+chatRows+'</div>':'')+
    '</div></div>';
  on($('hopick-bg'),'click',(e)=>{ if(e.target===$('hopick-bg')) closeOvr(); });
  r.querySelectorAll('[data-hopick]').forEach(b=>on(b,'click',()=>{ _hoPullConv(b.dataset.hopick); closeOvr(); }));
  r.querySelectorAll('[data-hosess]').forEach(b=>on(b,'click',()=>{ _hoPullSession(b.dataset.hosess); closeOvr(); }));
}

function _hoPullSession(id){
  const rec=((typeof _SESSIONS!=='undefined'&&_SESSIONS)||[]).find(x=>x&&x.id===id);
  if(!rec){ toast('That work could not be found','error'); return; }
  const text=_hoSessText(rec);
  if(!text){ toast('There is nothing in that yet','info'); return; }
  const ta=$('ho-ctx'); if(ta){ ta.value=(ta.value?ta.value+'\n\n':'')+text; ta.focus(); }
  if($('ho-title') && !$('ho-title').value) $('ho-title').value=rec.title||'Continue this work';
  /* A session is not a conversation, so the "continue on that same chat" path
     must not be armed - it would send whoever opens it to a chat that has
     nothing to do with the design they were handed. */
  try{ S._hoPulledConv=null; }catch(e){}
  toast('Pulled in \u201c'+(rec.title||'your work')+'\u201d','success');
}
try{ window._hoPullSession=_hoPullSession; window._hoSessText=_hoSessText; }catch(e){}
function _hoPullConv(convId){
  const conv=(S.convs||[]).find(c=>c.id===convId); if(!conv){ toast('Chat not found','error'); return; }
  const text=_hoConvText(conv);
  const ta=$('ho-ctx'); if(ta){ ta.value=(ta.value?ta.value+'\n\n':'')+text; ta.focus(); }
  if($('ho-title') && !$('ho-title').value) $('ho-title').value=conv.title||'Continue this conversation';
  S._hoPulledConv=convId;
  toast('Pulled in “'+(conv.title||'chat')+'”','success');
}
window._hoPickChat=_hoPickChat; window._hoPullConv=_hoPullConv;
/* Pull the most recent conversation's content into the handoff context, so a
   user can hand off real work - not just retype notes. */
function hoFromChat(){
  try{
    const convs=(S.convs||[]);
    const hasMsgs=c=>c&&c.msgs&&c.msgs.length;
    const conv=convs.find(c=>c.id===S.cur&&hasMsgs(c)) || convs.find(hasMsgs);
    if(!conv){ toast('No recent chat to pull in','info'); return; }
    const txt=m=>typeof m.c==='string'?m.c:(Array.isArray(m.c)?(m.c.map(x=>x&&x.text?x.text:'').join(' ')):'');
    const text=conv.msgs.slice(-12).map(m=>(m.r==='u'?'You: ':'AMV: ')+txt(m)).join('\n\n');
    const ta=$('ho-ctx'); if(ta){ ta.value=(ta.value?ta.value+'\n\n':'')+text; ta.focus(); }
    if($('ho-title') && !$('ho-title').value) $('ho-title').value=conv.title||'Continue this conversation';
    toast('Pulled in your last chat','success');
  }catch(e){ toast('Could not pull chat','error'); }
}
window.hoFromChat=hoFromChat;
/* Update one sent handoff in place. */
function _hoSetStatus(id, status){
  const out=_hoOut(); const rec=out.find(x=>x.id===id);
  if(rec){ rec.status=status; _hoSaveOut(out); }
  return rec;
}
/* The delivery itself. Returns the status the record should now carry, so the
   caller never has to guess whether it arrived. */
async function _hoDeliver(rec){
  if(!(window.AMV_API && AMV_API.live)) return { status:'not_sent', code:'needs_service' };
  try{
    await AMV_API.createHandoff({ title:rec.title, context:rec.context, to:rec.to });
    return { status:'waiting' };
  }catch(e){ return { status:'failed', error:(e&&e.message)||'' }; }
}

/* One send at a time. The button stays on screen while the request is in
   flight, and a second click would hand the same work over twice. */
let _HO_SENDING=false;
async function hoSend(){
  if(_HO_SENDING) return;
  const t=($('ho-title')||{}).value, ctx=($('ho-ctx')||{}).value, to=($('ho-to')||{}).value;
  if(!t||!t.trim()){ toast('Add a title for the handoff','error'); return; }
  if(!to||!to.trim()){ toast('Who are you handing off to?','error'); return; }
  const rec={ id:'h'+Date.now(), title:t.trim(), context:(ctx||'').trim(), to:to.trim(),
    from:(S.user&&S.user.email)||'you', when:new Date().toLocaleDateString(), status:'sending',
    convId:(S._hoPulledConv||null) };
  try{ S._hoPulledConv=null; }catch(e){}

  // Handing to Crew is local by design - it lands in your OWN approvals queue,
  // so there is nothing to deliver and nothing that can fail to arrive.
  if(to.trim().toLowerCase()==='crew'){
    rec.status='crew';
    const out=_hoOut(); out.unshift(rec); _hoSaveOut(out);
    const ap=_cwApprovals(); ap.unshift({id:'a'+Date.now(),icon:'\u{1F91D}',title:'Handoff: '+rec.title,preview:rec.context||'(no notes)'}); _cwSaveApprovals(ap);
    toast('Handed off to your Crew agent','info');
    renderHandoffView();
    return;
  }

  /* Saved BEFORE the attempt, so the work somebody just pasted survives a
     failure, and updated after with what actually happened. It used to say
     "Handoff sent to <person>" unconditionally - with the server call fired and
     forgotten, and with no backend connected nothing was delivered at all. The
     one thing a handoff must never do is tell you the baton was passed when
     nobody has it. */
  const out=_hoOut(); out.unshift(rec); _hoSaveOut(out);
  renderHandoffView();

  _HO_SENDING=true;
  let r;
  try{ r=await _hoDeliver(rec); }finally{ _HO_SENDING=false; }
  _hoSetStatus(rec.id, r.status);
  renderHandoffView();

  if(r.status==='waiting'){ toast('Handoff sent to '+rec.to,'success'); }
  else if(r.code==='needs_service'){
    toast('Saved here, but not delivered - handing work to another person needs the AMV backend connected. Nothing was sent to '+rec.to+'.','info',7000);
  } else {
    toast((r.error?r.error+' ':'')+'That handoff was NOT delivered. It is saved here - use Send again when you are back online.','error',7000);
  }
}
/* Retry a handoff that never left. */
async function hoResend(id){
  const rec=_hoOut().find(x=>x.id===id); if(!rec) return;
  _hoSetStatus(id,'sending'); renderHandoffView();
  const r=await _hoDeliver(rec);
  _hoSetStatus(id, r.status); renderHandoffView();
  if(r.status==='waiting') toast('Handoff sent to '+rec.to,'success');
  else if(r.code==='needs_service') toast('Still not connected to the AMV backend, so nothing was sent.','info',5000);
  else toast((r.error?r.error+' ':'')+'Still not delivered.','error',5000);
}
window.hoResend=hoResend;
function hoOpen(id){
  const h=_hoIn().find(x=>x.id===id);
  // If the handoff points at a real conversation you have, continue on that
  // SAME chat instead of starting a new one.
  if(h && h.convId && typeof loadConv==='function'){
    const conv=(S.convs||[]).find(c=>c.id===h.convId);
    if(conv){ loadConv(h.convId); toast('Continuing on the same chat','success'); return; }
  }
  setTab('chat'); setTimeout(()=>{ const ta=$('mta'); if(ta&&h){ ta.value='Continuing a handoff: '+h.title+'\n\nContext:\n'+(h.context||''); ta.focus(); } },120);
}
/* Marking one done tells the SENDER it is finished. Fired and forgotten, a
   failed call left it gone from this inbox and still showing as waiting on the
   other person's screen, with nothing to say so. */
async function hoDone(id){
  let res = { ok:false, code:'needs_service' };
  if(window.AMV_API && AMV_API.live){
    try{ await AMV_API.actHandoff(id,'done'); res = { ok:true }; }
    catch(e){ res = { ok:false, code:'failed', error:(e&&e.message)||'' }; }
  }
  if(!res.ok && res.code==='failed'){
    toast('That was NOT marked done'+(res.error?' ('+res.error+')':'')+
          ' - whoever sent it still sees it as waiting. Try again.','error',7000);
    return;
  }
  const a=_hoIn().filter(x=>x.id!==id); _hoSaveIn(a);
  toast(res.ok ? 'Marked done'
              : 'Marked done here. Whoever sent it will see that once AMV is connected to a backend.',
        'info', res.ok?2500:6000);
  renderHandoffView();
}
window.hoSend=hoSend;window.hoOpen=hoOpen;window.hoDone=hoDone;

/* === RENDER VIEW ROUTER === */
function renderView(){
  const vc=$('vc'); if(!vc) return;
  switch(S.tab){
    case 'dashboard': renderDashboard(); break;
    case 'chat': renderChatView(); break;
    case 'images': renderImgsView(); break;
    case 'video': renderVideoView(); break;
    case 'prompts': renderPromptsView(); break;
    case 'workspaces': goSettings('projects'); return;
    case 'memory': renderMemoryView(); break;
    case 'team': renderTeamView(); break;
    case 'usage': renderUsageView(); break;
    case 'billing': renderBillingView(); break;
    case 'plans': renderPlansView(); break;
    case 'settings': renderSettingsView(); break;
    case 'help': renderHelpView(); break;
    case 'apps': renderAppsView(); break;
    case 'tasks': renderTasksView(); break;
    case 'integrations': renderIntegrationsView(); break;
    case 'extensions': renderCrewView(); break;
    case 'crew': renderCrewView(); break;
    case 'studio': renderDesignView(); break;
    case 'dev': renderCodeView(); break;
    case 'lab': renderLabView(); break;
    case 'handoff': renderHandoffView(); break;
    case 'market': renderMarketView(); break;
    case 'admin': renderAdminView(); break;
    case 'notfound': render404View(); break;
    default: render404View();
  }
}

/* === PLANS VIEW === */
function renderPlansView(){
  const vc=$('vc'); if(!vc) return;
  vc.innerHTML=
    '<div class="sv fi"><div class="vi vi-plans">'+
      '<div class="plans-head"><div class="eyebrow">Pricing</div>'+
        '<h2>One subscription. Every AI tool you need.</h2>'+
        '<p class="vsub">Chat, images, video, autonomous agents, an app builder and Mission Control - in one place. Start free, upgrade any time, cancel whenever.</p></div>'+
      '<div class="pg pg-app pg-4">'+planCards(true)+'</div>'+
      _teamPlanBanner(true)+
      _customPlanBanner(true)+
      '<p class="px-note" style="display:none">Prices are in US dollars. Your local-currency amount is an estimate for convenience - you are charged the same value wherever you are, so there are no cheaper prices by country.</p>'+
      '<div class="plans-compare-row"><button class="btn bs" id="plans-compare" style="font-size:12.5px">Compare all plans in detail \u2192</button></div>'+
      '<div class="trust-bar"><div class="trust-badges">'+
        _trustBadge('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>','Bank-grade encryption','256-bit TLS on every request')+
        _trustBadge('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>','Secure payments','Processed by Stripe - we never see your card')+
        _trustBadge('<path d="M12 2 4 5v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V5z"/>','Your data, your control','Export or delete everything, any time')+
        _trustBadge('<path d="M13 2 3 14h8l-1 8 10-12h-8z"/>','No lock-in','Cancel with one click, keep your data')+
      '</div></div>'+
      '<p class="plans-foot">Payments secured by Stripe &bull; Cancel any time &bull; 30-day money-back guarantee</p>'+
    '</div></div>';
  on($('plans-compare'),'click',()=>openPlanCompare(loadStr('amv_plan')||'pro'));
  try{ _localizePrices(document); }catch(e){}
}
function _trustBadge(svg,title,sub){
  const ic='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+svg+'</svg>';
  return '<div class="trust-badge"><div class="trust-badge-ic">'+ic+'</div><div class="trust-badge-t">'+title+'</div><div class="trust-badge-s">'+sub+'</div></div>';
}

/* === HELP CENTER === */
const FAQS=[
  {q:'How do I start with AMV?', a:'Click “New chat” in the top bar and type anything - an essay, code, a 3D model, an image, deep research. AMV figures out what you need and does the work. On mobile, tap the menu icon for the full sidebar.'},
  {q:'What can AMV actually do?', a:'One place for everything: chat and research, image and video generation, interactive 3D, a design canvas (Studio), an app builder (Dev), and autonomous agents (Crew) that complete multi-step work for you and bring back a finished result to approve.'},
  {q:'What is Crew and Mission Control?', a:'Crew is AMV working autonomously in the background. Mission Control (the Crew tab) is your overview of everything it’s doing - what needs your approval, what’s running now, what’s scheduled, and what’s finished. Give it an outcome and it plans the steps, does the work, and stops before anything consequential to wait for you.'},
  {q:'How do approvals work - Preview &amp; Approve?', a:'When AMV finishes something that would send, publish, or change anything, it waits in “Needs your approval.” Press Preview to open the full workspace: the finished result, a timeline of what happened, the agents involved, and a plain-language summary of exactly what will happen. Then Approve, Edit, or Reject.'},
  {q:'What is Auto Approve?', a:'When you trust a recurring task, turn on Auto Approve while setting it up. AMV then completes and performs the final action on its own - scoped to every run or just the first, capped by risk level, with an optional end date. High-risk actions still stop and ask unless you allow them. You can pause all autonomous work anytime from Mission Control.'},
  {q:'How do I schedule recurring autonomous work?', a:'Start an autonomous task (Crew → Autonomous task) and pick a schedule - once, daily, weekly, or monthly. Manage everything under Scheduled: next run, last run, approval mode, and per-task pause or cancel. Connect the backend for true 24/7 runs even with AMV closed.'},
  {q:'How do I generate images and video?', a:'Click Images or Video in the sidebar, describe what you want, choose a style and aspect ratio, and generate. Images render in seconds; video is sent to the engine and returned when ready.'},
  {q:'How do I create interactive 3D models?', a:'Just ask in chat - e.g. “create a 3D model of a human heart.” It renders live with drag-to-rotate, scroll-to-zoom, and pan controls.'},
  {q:'What is Studio (AMV Design)?', a:'Studio is a live design canvas. Describe a landing page, UI mockup, poster, or graphic and watch it build, then refine by chatting (“make it darker,” “add a pricing section”). Set a reusable Design DNA once and everything follows your colors, fonts, and style.'},
  {q:'Can AMV build and run real apps?', a:'Yes - Dev writes the code, runs it in a live sandbox, and shows you the result. Lab lets you paste or upload existing code (any size) to run, find and fix bugs, review, refactor, or add tests. On higher plans you can deploy to a live URL.'},
  {q:'How do I upload files for analysis?', a:'Click the paperclip in the chat input or drag &amp; drop. AMV reads PDFs, images, code, Excel, CSV, and Word - and can work across a whole folder for autonomous tasks.'},
  {q:'How do I connect Gmail, Calendar, and files?', a:'Go to Settings → Connectors (or Integrations). Connect Google to let AMV read email, manage your calendar, and work with Drive files. Everything an agent wants to send still waits for your approval first.'},
  {q:'What is Handoff?', a:'Handoff lets you pass a task - with its full context - to a teammate inside AMV, or receive one from them, so work moves between people without losing the thread.'},
  {q:'What is the Marketplace?', a:'Browse and install prompts, crews, and integrations - free ones add to your Prompt Library or Crew instantly. Click any seller’s name to see their listings and reviews or message them. You can publish your own and keep 80% of every sale. Paid items always go through secure checkout.'},
  /* Priced from PLANS. Written out, this answer quoted three figures that
     nothing kept in step with the cards or with checkout, so changing a price
     left the Help Center stating the old one to the person who came here to
     ask what it costs. */
  {q:'How do plans and limits work?', a:'Free gives you daily usage to explore everything. Pro ($'+PLANS.pro.price+'/mo) unlocks autonomous agents, Mission Control, the app builder, connected accounts, and '+PLANS.pro.mult+' usage. Elite ($'+PLANS.elite.price+'/mo) adds our most capable Apex model first, one-click deploy, and parallel agents at '+PLANS.elite.mult+' usage. Ultra ($'+PLANS.ultra.price+'/mo) is '+PLANS.ultra.mult+' usage with unlimited parallel agents and team workspaces. Custom lets you set your own hard-capped budget. Limits are usage-based - just work without counting messages.'},
  {q:'What is AI Memory?', a:'Memory lets AMV remember facts about you - your role, preferences, and context - and apply them automatically in every conversation. Add or edit them under Memory in the sidebar.'},
  {q:'How do I use voice input?', a:'Click the microphone in the chat input (best in Chrome and Edge), speak, and your words appear in the box. Press Enter to send.'},
  {q:'How do I rename, star, or delete chats?', a:'Hover a chat in the sidebar for quick actions, or right-click for the full menu including Export and Share.'},
  {q:'Can I export my conversations?', a:'Yes - right-click any chat and choose “Export as Markdown” to download a .md file for Notion, Obsidian, or any editor.'},
  {q:'How is my data protected?', a:'Your data is stored in your browser and, when you connect the backend, encrypted in transit (256-bit TLS). Passwords are hashed with PBKDF2. Card details go straight to Stripe - AMV never sees them. Export or delete everything anytime.'}
]

/* A real 404 for unknown routes - instead of silently showing chat, tell the
   user the page wasn't found and give them a clear way back. */
function render404View(){
  const vc=$('vc'); if(!vc) return;
  vc.innerHTML=
    '<div class="sv fi"><div class="vi nf-wrap">'+
      '<div class="nf-code">404</div>'+
      '<h2 class="nf-title">Page not found</h2>'+
      '<p class="nf-sub">The page you\u2019re looking for doesn\u2019t exist or may have moved.</p>'+
      '<div class="nf-actions">'+
        '<button class="btn bp" onclick="setTab(\'chat\')">Go to chat</button>'+
        '<button class="btn bs" onclick="setTab(\'dashboard\')">Home</button>'+
      '</div>'+
    '</div></div>';
}
try{ window.render404View=render404View; }catch(e){}

function renderHelpView(){
  const vc=$('vc'); if(!vc) return;
  vc.innerHTML=
    '<div class="sv fi"><div class="vi">'+
      '<h2>Help Center</h2>'+
      '<p class="vsub">Answers to the most common questions.</p>'+
      '<div class="ss2">'+
        '<input type="text" id="faq-search" placeholder="Search help…" style="font-size:13px;margin-bottom:13px">'+
        '<div id="faq-list">'+
          FAQS.map((f,i)=>
            '<div class="faq-item" id="fi-'+i+'">'+
              '<div class="faq-q" data-fi="'+i+'"><span>'+f.q+'</span><span class="faq-arr">+</span></div>'+
              '<div class="faq-a">'+f.a+'</div>'+
            '</div>'
          ).join('')+
        '</div>'+
      '</div>'+
      '<div class="ss2"><h3>Share feedback</h3>'+
        '<p style="font-size:12.5px;color:var(--mu);margin-bottom:12px;line-height:1.55">Found a bug or have an idea? Tell us - real feedback shapes what we build next.</p>'+
        '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
          '<button class="btn bp" style="font-size:12px" data-dact="openFeedback" data-darg="bug">Report a bug</button>'+
          '<button class="btn bs" style="font-size:12px" data-dact="openFeedback" data-darg="idea">Suggest a feature</button>'+
        '</div>'+
      '</div>'+
      '<div class="ss2"><h3>Still need help?</h3>'+
        '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
          supportButton({label:'Email Support',cls:'btn bp',subject:'AMV Support request'})+
          '<button class="btn bs" style="font-size:12px" data-dact="askAmv" data-darg="">Ask AMV directly</button>'+
        '</div>'+
        (_supportEmail()?'<p style="font-size:11.5px;color:var(--mu);margin-top:10px">Or email us directly at <b style="color:var(--tx)">'+escH(_supportEmail())+'</b> - we reply within 24 hours.</p>':'')+
      '</div>'+
    '</div></div>';
  vc.querySelectorAll('.faq-q').forEach(q=>{
    q.addEventListener('click',()=>{
      document.getElementById('fi-'+q.dataset.fi)?.classList.toggle('open');
    });
  });
  on($('faq-search'),'input',function(){
    const s=this.value.toLowerCase();
    vc.querySelectorAll('.faq-item').forEach((item,i)=>{
      const f=FAQS[i];
      item.style.display=(!s||f.q.toLowerCase().includes(s)||f.a.toLowerCase().includes(s))?'block':'none';
    });
  });
}

/* === SETTINGS VIEW === */
const USER_SET_SECTIONS=[
  {group:'General'},
  {id:'account',label:'Account',icon:'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'},
  {id:'privacy',label:'Privacy',icon:'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'},
  {id:'security',label:'Security',icon:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'},
  {id:'billing',label:'Billing',icon:'<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>'},
  {id:'usage',label:'Usage',icon:'<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'},
  {id:'capabilities',label:'Capabilities',icon:'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'},
  {id:'spending',label:'Spending',icon:'<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'},
  {id:'investing',label:'Investing',icon:'<path d="M3 17l6-6 4 4 8-8"/><path d="M21 7h-6M21 7v6"/>'},
  {id:'teamset',label:'Team',icon:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>'},
  {id:'api',label:'API keys',icon:'<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>'},
  {id:'invite',label:'Invite',icon:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>'},
  {id:'family',label:'Family & linked accounts',icon:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'},
  {group:'Customize'},
  {id:'appearance',label:'Appearance',icon:'<circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>'},
  {id:'language',label:'Language',icon:'<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'},
  {id:'skills',label:'Skills',icon:'<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>'},
  {id:'integrations',label:'Connectors',icon:'<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/>'},
  {group:'Workspace'},
  {id:'projects',label:'Projects',icon:'<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'},
  {group:''},
  {id:'about',label:'About',icon:'<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'},
];
/* OWNER-ONLY - platform controls. Hidden from end users entirely. */
const ADMIN_SET_SECTIONS=[
  {id:'dashboard',label:'Founder Dashboard',icon:'<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>'},
  {id:'apikeys',label:'AI Connection',icon:'<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>'},
  {id:'backend',label:'Live / Backend',icon:'<path d="M5 12h14M12 5l7 7-7 7"/>'},
  {id:'widget',label:'Website Widget',icon:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'},
  {id:'platform',label:'Platform',icon:'<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>'},
];

/* AMV-089: money owed to sellers. A withdrawal used to zero a seller's balance
   and write a record nothing ever read - so this is the first screen that can
   see it, and the only place it can be settled. It leads the dashboard because
   an unpaid payout is a liability, not a statistic. */
function _payoutCardHTML(){
  return '<div class="ss2" id="fd-payouts"><h3>Payouts owed</h3>'+
    '<div class="fd-loading">Checking what is owed\u2026</div></div>';
}
async function _loadPayouts(){
  const host=$('fd-payouts'); if(!host) return;
  const base=loadStr('amv_api_base')||'';
  const tok=($('fd-token')&&$('fd-token').value||'').trim()||((typeof _adminToken==='function')?_adminToken():'');
  if(!base||!tok){ host.innerHTML='<h3>Payouts owed</h3><div class="fd-empty">Enter your admin token to see money owed to sellers.</div>'; return; }
  try{
    const r=await fetchDeadline(base.replace(/\/$/,'')+'/admin/payouts',{headers:{'Authorization':'Bearer '+tok}},15000);
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok){ host.innerHTML='<h3>Payouts owed</h3><div class="fd-empty">'+(r.status===403?'That admin token was rejected.':'Could not load payouts.')+'</div>'; return; }
    _payoutsPaint(host, d);
  }catch(e){ host.innerHTML='<h3>Payouts owed</h3><div class="fd-empty">Could not reach the backend, so this would be out of date.</div>'; }
}
function _payoutsPaint(host, d){
  const money=n=>'$'+(+n||0).toFixed(2);
  const pending=(d.payouts||[]).filter(p=>(p.status||'pending')==='pending');
  const rows=pending.map(p=>
    '<div class="po-row" data-po="'+escH(p.id)+'">'+
      '<div class="po-main"><div class="po-who">'+escH(p.seller||'')+'</div>'+
        '<div class="po-dest">'+escH(p.destination||'no destination given')+'</div></div>'+
      '<div class="po-amt">'+money(p.amount)+'</div>'+
      '<div class="po-acts">'+
        '<button class="btn bs" type="button" data-po-paid="'+escH(p.id)+'">Mark paid</button>'+
        '<button class="btn bs" type="button" data-po-rej="'+escH(p.id)+'">Reject</button>'+
      '</div>'+
    '</div>').join('');
  host.innerHTML='<h3>Payouts owed</h3>'+
    '<div class="po-total'+(d.owed>0?' owe':'')+'">'+money(d.owed)+' owed to '+pending.length+' seller'+(pending.length===1?'':'s')+
      '<span class="po-sub">'+money(d.paidTotal)+' paid out so far</span></div>'+
    (rows||'<div class="fd-empty">Nothing owed right now.</div>')+
    '<div class="po-say" id="po-say" role="status" aria-live="polite"></div>'+
    '<div class="po-fine">Rejecting returns the money to the seller\u2019s balance. Marking paid does not send anything - do that with your payment provider first.</div>';
  /* Rejecting CREDITS the seller's wallet, so sending it twice pays the same
     money out twice. The buttons stayed live for the whole round trip, which
     makes a double-click the ordinary way to do it by accident rather than an
     exotic race. Locked here AND on the server - this only stops the accident,
     the server is what makes it impossible. */
  let _poBusy=false;
  const settle=async(id,status)=>{
    if(_poBusy) return;
    const say=$('po-say');
    const what = status==='paid'
      ? 'Mark this payout as already sent? It does not transfer anything - confirm you have paid it.'
      : 'Reject this payout and return the money to the seller\u2019s balance?';
    if(typeof confirm==='function' && !confirm(what)) return;
    _poBusy=true;
    const btns=[...host.querySelectorAll('[data-po-paid],[data-po-rej]')];
    btns.forEach(b=>{ b.disabled=true; });
    if(say) say.textContent='Working\u2026';
    const base=loadStr('amv_api_base')||'';
    const tok=($('fd-token')&&$('fd-token').value||'').trim()||((typeof _adminToken==='function')?_adminToken():'');
    try{
      const r=await fetchDeadline(base.replace(/\/$/,'')+'/admin/payouts/mark',{
        method:'POST', headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
        body:JSON.stringify({ id, status })},15000);
      const d2=await r.json().catch(()=>({}));
      if(!r.ok||!d2.ok){ if(say) say.textContent = d2.error || 'That did not go through - nothing was changed.'; return; }
      if(say) say.textContent = status==='paid' ? 'Marked paid.' : 'Rejected, and the money is back with the seller.';
      _loadPayouts();
    }catch(e){ if(say) say.textContent='Could not reach the backend - nothing was changed.'; }
    finally{
      _poBusy=false;
      /* Re-enable only the ones still on screen: a successful settle repaints
         the card, and these nodes are gone. */
      btns.forEach(b=>{ if(b.isConnected) b.disabled=false; });
    }
  };
  host.querySelectorAll('[data-po-paid]').forEach(b=>on(b,'click',()=>settle(b.dataset.poPaid,'paid')));
  host.querySelectorAll('[data-po-rej]').forEach(b=>on(b,'click',()=>settle(b.dataset.poRej,'rejected')));
}
try{ window._loadPayouts=_loadPayouts; }catch(e){}

/* AMV-081: the weekly digest, on the one screen that already holds the admin
   token. Preview shows exactly what would be sent; sending is a separate,
   explicit action because it puts a message in someone's inbox. */
function _digestCardHTML(){
  return '<div class="ss2" style="margin-top:16px"><h3>Weekly digest</h3>'+
    '<p style="font-size:12px;color:var(--mu);line-height:1.6;margin:-4px 0 12px">'+
      'These figures are emailed to the owner once a week, with the change since the week before. '+
      'It needs OWNER_EMAIL and an email provider configured on the Worker.</p>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
      '<button class="btn bs" id="fd-digest-preview" type="button" style="font-size:12px">Preview this week</button>'+
      '<button class="btn bs" id="fd-digest-send" type="button" style="font-size:12px">Send it now</button>'+
    '</div>'+
    '<div id="fd-digest-out" class="fd-digest-out" role="status" aria-live="polite"></div>'+
  '</div>';
}
function _wireDigestCard(){
  const out = $('fd-digest-out');
  const say = (t, kind) => { if(out){ out.className = 'fd-digest-out' + (kind ? ' ' + kind : ''); out.textContent = t; } };
  /* Read at click time, not captured when the card was built - the operator may
     correct the token after this card exists. */
  const call = async (qs) => {
    const base = loadStr('amv_api_base')||'';
    const tok = ($('fd-token') && $('fd-token').value || '').trim()
      || ((typeof _adminToken==='function') ? _adminToken() : '');
    if(!base) throw new Error('connect your backend first');
    if(!tok) throw new Error('enter your admin token above');
    const r = await fetchDeadline(base.replace(/\/$/,'')+'/admin/digest'+qs,
      { headers:{ 'Authorization':'Bearer '+tok } }, 20000);
    const d = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error || ('failed ('+r.status+')'));
    return d;
  };
  on($('fd-digest-preview'),'click', async ()=>{
    say('Loading\u2026');
    try{
      const d = await call('');
      // The plain-text version IS what gets sent, so showing it is not a mock-up.
      if(out){ out.className='fd-digest-out'; out.textContent = d.subject + '\n\n' + d.text; }
    }catch(e){ say('Could not build the digest: ' + e.message, 'bad'); }
  });
  on($('fd-digest-send'),'click', async ()=>{
    /* Outward-facing: it puts mail in someone's inbox, so it is confirmed. */
    if(typeof confirm === 'function' && !confirm('Email this week\u2019s digest to the owner now?')) return;
    say('Sending\u2026');
    try{
      const d = await call('?send=1');
      say(d.sent ? 'Sent to the owner.' : ('Not sent: ' + (d.reason || 'unknown')), d.sent ? 'good' : 'bad');
    }catch(e){ say('Could not send: ' + e.message, 'bad'); }
  });
}

/* AMV-088: say when the per-account lists below are a sample. Reading them as
   totals is the mistake this exists to prevent. */
function _scanNoteHTML(d){
  const sc = d && d.scan;
  if(!sc || !sc.truncated) return '';
  return '<div class="fd-scan">'+escH(sc.note||'')+'</div>';
}

/* Render the founder dashboard from the /v1/admin/stats payload. */
function _founderDashHTML(d){
  const fmt=n=>(n||0).toLocaleString();
  const money=n=>'$'+(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const sp=d.spend||{}, us=d.users||{}, rev=d.revenue||{}, mg=d.margin||{};
  const byPlan=us.byPlan||{};
  const spendPct=Math.min(100, sp.pctOfCap||0);
  const spendColor = spendPct>=90?'#ff4d4d':(spendPct>=70?'#e0b341':'var(--accent)');
  const rows=(d.topSpenders||[]).slice(0,12).map(u=>
    '<div class="fd-row"><span class="fd-row-email">'+_esc(u.email)+'</span><span class="fd-row-plan">'+u.plan+'</span><span class="fd-row-cost">'+money(u.monthCostUSD)+'</span></div>').join('')
    || '<div class="fd-row"><span style="color:var(--mu)">No usage yet.</span></div>';
  const estProfit=(rev.estMRR||0)-(mg.estMonthlyCost||0);
  return ''+
    _scanNoteHTML(d)+
    // hero metrics
    '<div class="fd-grid">'+
      '<div class="fd-card"><div class="fd-n">'+money(rev.estMRR)+'</div><div class="fd-l">Est. MRR</div><div class="fd-sub">'+money(rev.estARR)+' ARR</div></div>'+
      '<div class="fd-card"><div class="fd-n">'+fmt(us.paying)+'</div><div class="fd-l">Paying users</div><div class="fd-sub">'+fmt(us.total)+' total</div></div>'+
      '<div class="fd-card"><div class="fd-n">'+money(estProfit)+'</div><div class="fd-l">Est. gross profit / mo</div><div class="fd-sub">after AI cost '+money(mg.estMonthlyCost)+'</div></div>'+
      '<div class="fd-card"><div class="fd-n">'+money(sp.today)+'</div><div class="fd-l">AI spend today</div><div class="fd-sub">cap '+money(sp.cap)+'</div></div>'+
    '</div>'+
    // spend bar + kill switch
    '<div class="ss2"><h3>Today\u2019s global spend</h3>'+
      '<div class="usage-bar"><div class="usage-bar-f" style="width:'+spendPct+'%;background:'+spendColor+'"></div></div>'+
      '<div class="usage-meta"><span>'+money(sp.today)+' of '+money(sp.cap)+' ('+spendPct+'%)</span><span>'+(sp.killed?'\u26D4 Service PAUSED':'\u2705 Service live')+'</span></div>'+
      '<button class="btn '+(sp.killed?'bp':'bs')+'" id="fd-kill" style="margin-top:12px;font-size:12px">'+(sp.killed?'Resume service':'Pause service (kill switch)')+'</button>'+
    '</div>'+
    // plan breakdown
    '<div class="ss2"><h3>Users by plan</h3><div class="fd-plans">'+
      ['free','pro','elite','ultra','custom'].map(p=>'<div class="fd-plan"><div class="fd-plan-n">'+fmt(byPlan[p]||0)+'</div><div class="fd-plan-l">'+p+'</div></div>').join('')+
    '</div></div>'+
    // top spenders (abuse / margin watch)
    '<div class="ss2"><h3>Top spenders this month <span style="font-weight:400;color:var(--mu);font-size:11px">(margin &amp; abuse watch)</span></h3>'+
      '<div class="fd-table"><div class="fd-row fd-head"><span>User</span><span>Plan</span><span>AI cost</span></div>'+rows+'</div>'+
    '</div>';
}

// Leave settings and go back where you came from.
function closeSettings(){
  const back=(S._preSettingsTab && S._preSettingsTab!=='settings') ? S._preSettingsTab : 'chat';
  S.settingsPane=null;
  setTab(back);
}
try{ window.closeSettings=closeSettings; }catch(e){}

/* The mobile settings picker: a single button showing the current section,
   which opens a popup list. Hidden on desktop (the full sidebar shows there). */
function _curSetSection(){
  const admin=isAdmin()?ADMIN_SET_SECTIONS:[];
  const all=[...USER_SET_SECTIONS,...admin].filter(s=>s.id);
  return all.find(s=>s.id===S.settingsPane) || all[0];
}
function _settingsPickerBtnHTML(){
  const s=_curSetSection(); if(!s) return '';
  return '<button class="set-picker" id="set-picker" type="button" aria-haspopup="true">'+
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+s.icon+'</svg>'+
    '<span class="set-picker-lbl">'+escH(T(s.label))+'</span>'+
    '<svg class="set-picker-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'+
  '</button>';
}
function _openSettingsPicker(){
  const r=$('ovr'); if(!r) return;
  const adminExtra=isAdmin()?[{group:'Operator'},...ADMIN_SET_SECTIONS]:[];
  const sections=[...USER_SET_SECTIONS,...adminExtra];
  const rows=sections.map(s=>{
    if(s.group!==undefined) return s.group?'<div class="setpick-group">'+escH(T(s.group))+'</div>':'';
    if(s.type==='div') return '';
    return '<button class="setpick-row '+(s.id===S.settingsPane?'on':'')+'" data-setpick="'+s.id+'" data-lbl="'+escH((s.label||'').toLowerCase())+'">'+
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+s.icon+'</svg>'+
      '<span>'+escH(T(s.label))+'</span></button>';
  }).join('');
  r.innerHTML='<div class="ov" id="setpick-bg"><div class="ob setpick-modal" onclick="event.stopPropagation()" style="max-width:460px">'+
    '<button class="oc" onclick="closeOvr()" aria-label="Close">×</button>'+
    '<h2 style="margin:0 0 12px;font-size:18px">Settings</h2>'+
    '<div class="set-search-wrap setpick-searchwrap"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'+
      '<input id="setpick-search" class="set-search" type="text" placeholder="Search settings…" autocomplete="off"></div>'+
    '<div class="setpick-list" id="setpick-list">'+rows+'</div></div></div>';
  on($('setpick-bg'),'click',(e)=>{ if(e.target===$('setpick-bg')) closeOvr(); });
  r.querySelectorAll('[data-setpick]').forEach(b=>on(b,'click',()=>{
    S.settingsPane=b.dataset.setpick; closeOvr(); renderSettingsView();
    try{ const c=document.querySelector('.settings-content'); if(c) c.scrollTop=0; }catch(e){}
  }));
  // Filter as you type. No autofocus - opening straight to the keyboard was the
  // old complaint; the list is visible first, tap search only if you want it.
  const si=$('setpick-search');
  if(si) on(si,'input',()=>{
    const query=si.value.toLowerCase().trim();
    r.querySelectorAll('.setpick-row').forEach(row=>{ row.style.display=(!query||(row.dataset.lbl||'').includes(query))?'':'none'; });
    r.querySelectorAll('.setpick-group').forEach(g=>{ g.style.display=query?'none':''; });
  });
}
window._openSettingsPicker=_openSettingsPicker;

function renderSettingsView(){
  const vc=$('vc'); if(!vc) return;
  const adminExtra=isAdmin()?[{group:'Operator'},...ADMIN_SET_SECTIONS]:[];
  const visibleSections=[...USER_SET_SECTIONS,...adminExtra];
  const q=(S._setSearch||'').toLowerCase().trim();
  const navHtml=visibleSections.map(s=>{
    if(s.group!==undefined){
      if(q) return '';                       // hide group headers while searching
      return s.group?'<div class="sn-group">'+escH(s.group)+'</div>':'<div class="sn-div"></div>';
    }
    if(s.type==='div') return q?'':'<div class="sn-div"></div>';
    if(q && !(s.label||'').toLowerCase().includes(q)) return '';   // filter
    return '<button class="sn-btn '+(s.id===S.settingsPane?'on':'')+'" data-sp="'+s.id+'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+s.icon+'</svg>'+T(s.label)+'</button>';
  }).join('');
  const noMatch = q && !visibleSections.some(s=>s.id && (s.label||'').toLowerCase().includes(q));
  vc.innerHTML=
    '<div class="settings-shell">'+
      '<button class="set-close" id="set-close" title="Close settings (Esc)" aria-label="Close settings">'+
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'+
        '<span class="set-close-lbl">Close</span>'+
      '</button>'+
      '<div class="settings-nav">'+
        _settingsPickerBtnHTML()+
        '<div class="set-search-wrap"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'+
          '<input id="set-search" class="set-search" type="text" placeholder="Search settings\u2026" value="'+escH(S._setSearch||'')+'" autocomplete="off">'+
        '</div>'+
        '<div class="settings-nav-list">'+navHtml+(noMatch?'<div class="sn-empty">No settings match \u201c'+escH(q)+'\u201d</div>':'')+'</div>'+
      '</div>'+
      '<div class="settings-content"><div class="set-pane" id="set-pane"></div></div>'+
    '</div>';
  vc.querySelectorAll('.sn-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const target=btn.dataset.sp;
      S.settingsPane=target;
      vc.querySelectorAll('.sn-btn').forEach(b=>b.classList.toggle('on',b===btn));
      renderSetPane();
    });
  });
  // Mobile: the picker button opens the section list as a popup.
  on($('set-picker'),'click',_openSettingsPicker);
  // Close settings: X button, Esc, or clicking the empty area outside the panels.
  on($('set-close'),'click',closeSettings);
  const shell=vc.querySelector('.settings-shell');
  if(shell) on(shell,'mousedown',(e)=>{ if(e.target===shell) closeSettings(); });
  const si=$('set-search');
  if(si){
    on(si,'input',()=>{ S._setSearch=si.value; const pos=si.selectionStart; renderSettingsView(); const s2=$('set-search'); if(s2){ s2.focus(); try{ s2.setSelectionRange(pos,pos); }catch(e){} } });
  }
  renderSetPane();
}

/* === SETTINGS PANE RENDERER === */

/* ---------------- Website Widget config pane (owner/admin) ----------------
   Loads the owner's widget config from the backend, lets them customize it,
   generates the copy-paste embed snippet, and (when saved) the widget goes
   live on their site. Requires the backend to be connected - the config and
   the public site key live server-side. */
let _WIDGET_CFG=null;
function _renderWidgetPane(pane){
  const live=!!(window.AMV_API && AMV_API.live && AMV_API.token);
  const base=(loadStr('amv_api_base')||'').replace(/\/+$/,'');
  if(!live){
    pane.innerHTML=
      '<div class="set-title">Website Widget</div>'+
      '<div class="set-sub">Add an AMV chat bubble to any website with one line of code.</div>'+
      '<div class="wb">Connect your backend first (Settings \u2192 AI Connection and sign in). The widget\u2019s config and public key live on your server so it works securely on the open web.</div>';
    return;
  }
  pane.innerHTML=
    '<div class="set-title">Website Widget</div>'+
    '<div class="set-sub">Add an AMV chat bubble to any website with one line of code. Your visitors chat with an AI you control - no account needed on their end.</div>'+
    '<div id="wg-body"><div class="lab-placeholder">Loading your widget\u2026</div></div>';

  const body=$('wg-body');
  (async()=>{
    let cfg=null;
    try{
      const r=await AMV_API._fetch('/v1/widget/config',{method:'POST',body:'{}'});
      const d=await r.json();
      if(d&&d.config) cfg=d.config;
    }catch(e){}
    if(!cfg){ body.innerHTML='<div class="wb">Couldn\u2019t load the widget config. Make sure your backend is deployed with the latest code, then reload.</div>'; return; }
    _WIDGET_CFG=cfg;
    _paintWidgetForm(body, cfg, base);
  })();
}
function _widgetSnippet(cfg, base){
  const host=(base||'').replace(/\/+$/,'');
  // Prefer an explicit app origin if the operator serves the app separately;
  // default to same-origin as the Worker (works for combined deploys).
  const appOrigin=location.origin;
  return '<script src="'+host+'/widget.js?k='+cfg.key+'&host='+encodeURIComponent(appOrigin)+'" async><\/script>';
}
function _paintWidgetForm(body, cfg, base){
  const snippet=_widgetSnippet(cfg, base);
  const modelOpts=[['amv-pulse','Fast (cheapest)'],['amv-core','Balanced (recommended)'],['amv-forge','Advanced'],['amv-apex','Most capable']]
    .map(m=>'<option value="'+m[0]+'"'+(cfg.model===m[0]?' selected':'')+'>'+m[1]+'</option>').join('');
  body.innerHTML=
    '<div class="ss2"><h3>Your embed code</h3>'+
      '<p style="font-size:12px;color:var(--mu);margin-bottom:10px;line-height:1.6">Paste this once, just before <code>&lt;/body&gt;</code> on any page. The chat bubble appears in the corner. Changes you save here apply everywhere instantly - no need to re-paste.</p>'+
      '<div style="position:relative"><pre id="wg-snippet" style="background:var(--surface);border:1px solid var(--hair);border-radius:8px;padding:12px 12px;font-size:11.5px;overflow:auto;margin:0;white-space:pre-wrap;word-break:break-all"><code>'+escH(snippet)+'</code></pre></div>'+
      '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">'+
        '<button class="btn bp" id="wg-copy" style="font-size:12px">Copy code</button>'+
        '<button class="btn" id="wg-preview" style="font-size:12px">Preview widget</button>'+
        '<span style="font-size:11px;color:var(--mu);align-self:center">Site key: <code>'+escH(cfg.key)+'</code></span>'+
      '</div>'+
    '</div>'+
    '<div class="ss2"><h3>Appearance</h3>'+
      '<div class="sf">'+
        '<div><label class="lbl">Header title</label><input type="text" id="wg-title" value="'+escH(cfg.title||'')+'" maxlength="60" placeholder="Chat with us"></div>'+
        '<div><label class="lbl">Greeting message</label><input type="text" id="wg-greeting" value="'+escH(cfg.greeting||'')+'" maxlength="300" placeholder="Hi! How can I help you today?"></div>'+
        '<div><label class="lbl">Accent color</label><input type="color" id="wg-accent" value="'+escH(cfg.accent||'#4f7cff')+'" style="width:60px;height:36px;padding:2px;cursor:pointer"></div>'+
      '</div>'+
    '</div>'+
    '<div class="ss2"><h3>Behavior</h3>'+
      '<div class="sf">'+
        '<div><label class="lbl">AI model</label><select id="wg-model" class="inp">'+modelOpts+'</select></div>'+
        '<div><label class="lbl">Instructions (system prompt) - tells the AI how to behave and what it knows</label><textarea id="wg-sys" rows="4" style="font-family:inherit;font-size:13px" placeholder="You are a helpful assistant for [your company]\u2026">'+escH(cfg.systemPrompt||'')+'</textarea></div>'+
      '</div>'+
    '</div>'+
    '<div class="ss2"><h3>Allowed domains <span style="font-weight:400;color:var(--mu);font-size:11px">(recommended)</span></h3>'+
      '<p style="font-size:12px;color:var(--mu);margin-bottom:10px;line-height:1.6">Lock the widget to your own sites so nobody can embed it elsewhere and use your quota. One domain per line (e.g. <code>example.com</code>). Leave empty to allow any site '+(!(cfg.origins&&cfg.origins.length)?'- <b style="color:var(--red)">currently unrestricted</b>':'')+'.</p>'+
      '<textarea id="wg-origins" rows="3" style="font-family:var(--mn);font-size:12px" placeholder="example.com&#10;www.example.com">'+escH((cfg.origins||[]).join('\n'))+'</textarea>'+
    '</div>'+
    /* ZERO MEANS UNLIMITED, AND THE LABELS SAID "MAX".
       The server reads 0 on either of these as "no ceiling" - `dailyMsgCap > 0`
       and `dailySpendCapUSD > 0` are what gate the counters. The fields said
       "Max messages per day" with a minimum of 0 and nothing else, so the
       obvious reading of typing 0 is "none", and what it actually does is
       remove the only per-widget limit on the owner's bill. Said plainly here,
       and warned about live, because a money control that means the opposite of
       how it reads is not a control. */
    '<div class="ss2"><h3>Safety limits <span style="font-weight:400;color:var(--mu);font-size:11px">(protect your costs)</span></h3>'+
      '<div class="sf">'+
        '<div><label class="lbl">Max messages per day <span class="wg-hint">0 = no limit</span></label><input type="number" id="wg-msgcap" value="'+(cfg.dailyMsgCap||0)+'" min="0" max="100000"></div>'+
        '<div><label class="lbl">Max spend per day (USD) <span class="wg-hint">0 = no limit</span></label><input type="number" id="wg-spendcap" value="'+(cfg.dailySpendCapUSD||0)+'" min="0" max="1000" step="0.5"></div>'+
        '<div><label class="lbl">Max reply length (tokens)</label><input type="number" id="wg-maxout" value="'+(cfg.maxOut||1024)+'" min="128" max="4000" step="128"></div>'+
      '</div>'+
      '<div class="wg-capwarn" id="wg-capwarn" role="status" aria-live="polite"></div>'+
    '</div>'+
    '<div class="ss2"><div style="display:flex;align-items:center;justify-content:space-between">'+
        '<div><div style="font-size:13px;font-weight:600">Widget enabled</div><div style="font-size:11px;color:var(--t2)">Turn the widget on or off across all your sites instantly.</div></div>'+
        '<label class="sw"><input type="checkbox" id="wg-enabled" '+(cfg.enabled?'checked':'')+'><span class="sw-sl"></span></label>'+
      '</div></div>'+
    '<div style="display:flex;gap:8px"><button class="btn bp" id="wg-save" style="font-size:13px">Save changes</button><span id="wg-saved" style="font-size:12px;color:var(--green);align-self:center"></span></div>';

  /* What the current settings actually expose, recomputed as they are typed
     rather than discovered on a bill. An uncapped widget on an unrestricted
     origin list is the combination that costs real money: anybody who reads the
     site key out of the page can embed it on their own site and spend against
     the owner's account until the platform-wide ceiling stops it. */
  const capWarn=()=>{
    const el=$('wg-capwarn'); if(!el) return;
    const msgs=parseInt(($('wg-msgcap')||{}).value||'0',10);
    const spend=parseFloat(($('wg-spendcap')||{}).value||'0');
    const origins=(($('wg-origins')||{}).value||'').split('\n').map(s=>s.trim()).filter(Boolean);
    const open=[];
    if(!(msgs>0)) open.push('no daily message limit');
    if(!(spend>0)) open.push('no daily spend limit');
    if(!open.length){ el.className='wg-capwarn'; el.textContent=''; return; }
    el.className='wg-capwarn on';
    el.textContent='This widget has '+open.join(' and ')+'. '+
      (origins.length
        ? 'It is locked to your own domains, so only your sites can spend against it - but a busy day still has no ceiling.'
        : 'It is also not locked to any domain, so anybody who reads the site key out of your page can embed it on their own site and spend against your account.')+
      ' Only the platform-wide daily cap would stop it.';
  };
  ['wg-msgcap','wg-spendcap','wg-origins'].forEach(id=>on($(id),'input',capWarn));
  capWarn();

  on($('wg-copy'),'click',()=>{
    const s=_widgetSnippet(_WIDGET_CFG, base);
    try{ navigator.clipboard.writeText(s); toast('Embed code copied','success'); }
    catch(e){ const ta=document.createElement('textarea'); ta.value=s; document.body.appendChild(ta); ta.select(); try{document.execCommand('copy'); toast('Embed code copied','success');}catch(_){ toast('Copy failed - select the code manually','error'); } ta.remove(); }
  });
  on($('wg-preview'),'click',()=>{
    const appOrigin=location.origin;
    window.open(appOrigin+'/#embed=1&k='+encodeURIComponent(_WIDGET_CFG.key),'amv_widget_preview','width=420,height=640');
  });
  on($('wg-save'),'click',async()=>{
    const origins=($('wg-origins').value||'').split('\n').map(s=>s.trim()).filter(Boolean);
    const payload={
      title:$('wg-title').value, greeting:$('wg-greeting').value, accent:$('wg-accent').value,
      model:$('wg-model').value, systemPrompt:$('wg-sys').value, origins,
      dailyMsgCap:parseInt($('wg-msgcap').value||'0',10),
      dailySpendCapUSD:parseFloat($('wg-spendcap').value||'0'),
      maxOut:parseInt($('wg-maxout').value||'1024',10),
      enabled:$('wg-enabled').checked
    };
    const btn=$('wg-save'); btn.disabled=true; btn.textContent='Saving\u2026';
    try{
      const r=await AMV_API._fetch('/v1/widget/save',{method:'POST',body:JSON.stringify(payload)});
      const d=await r.json();
      if(d&&d.config){ _WIDGET_CFG=d.config; const s=$('wg-saved'); if(s){ s.textContent='Saved \u2713'; setTimeout(()=>{s.textContent='';},2500); } toast('Widget updated','success'); }
      else toast(d&&d.error?d.error:'Save failed','error');
    }catch(e){ toast('Save failed - check your connection','error'); }
    btn.disabled=false; btn.textContent='Save changes';
  });
}

/* Ask the server what is configured. Needs the admin token, because the shape
   of a deployment is operator information. */
async function _loadReadiness(){
  const host = $('golive-body'); if(!host) return;
  const base = loadStr('amv_api_base')||'';
  const tok = ($('fd-token') && $('fd-token').value || '').trim()
    || ((typeof _adminToken==='function') ? _adminToken() : '');
  if(!base){ host.innerHTML = '<div class="gl-note">Connect your backend first (Settings \u2192 Live / Backend) and this reads your real configuration.</div>'; return; }
  if(!tok){
    /* Ask right here rather than sending the operator to another screen. This
       is the page they are on at the exact moment they are pasting secrets. */
    host.innerHTML =
      '<div class="gl-note">Your admin token reads this from the Worker. It is kept in memory for this tab only.</div>'+
      '<div class="adm-tokrow" style="margin-top:10px">'+
        '<label class="sr-only" for="gl-tok">Admin token</label>'+
        '<input id="gl-tok" type="password" autocomplete="off" class="inp" placeholder="Admin token">'+
        '<button class="btn bp" id="gl-tok-go" type="button">Check</button>'+
      '</div>';
    const go = () => {
      const v = ($('gl-tok') && $('gl-tok').value || '').trim();
      if(!v) return;
      try{ if(typeof _setAdminToken==='function') _setAdminToken(v); }catch(e){}
      _loadReadiness();
    };
    on($('gl-tok-go'),'click',go);
    on($('gl-tok'),'keydown',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); go(); } });
    return;
  }
  try{
    const r = await fetchDeadline(base.replace(/\/$/,'')+'/admin/readiness', { headers:{ 'Authorization':'Bearer '+tok } }, 15000);
    const d = await r.json().catch(()=>({}));
    if(!r.ok || !d.ok){ host.innerHTML = '<div class="gl-note">'+(r.status===403?'That admin token was rejected.':escH(d.error||'Could not read your configuration.'))+'</div>'; return; }
    host.innerHTML = _readinessHTML(d);
  }catch(e){
    host.innerHTML = '<div class="gl-note">Could not reach your Worker, so this would be out of date. It will load when you are back online.</div>';
  }
}
try{ window._loadReadiness=_loadReadiness; }catch(e){}

function _readinessHTML(d){
  const rows = (list) => (list||[]).map(i =>
    '<div class="gl-row '+(i.on?'gl-done':(i.blocking?'gl-block':''))+'">'+
      '<span class="gl-ic">'+(i.on?'\u2713':'\u25CB')+'</span>'+
      '<div class="gl-body">'+
        '<div class="gl-label">'+escH(i.name)+
          (i.on?' <span class="gl-tag">live</span>'
              :' <span class="gl-tag '+(i.blocking?'req':'off')+'">'+(i.blocking?'required':'not set up')+'</span>')+
        '</div>'+
        '<div class="gl-how">'+escH(i.turnsOn)+'</div>'+
        (i.on?'':'<code class="gl-cmd">'+escH(i.how)+'</code>')+
      '</div>'+
    '</div>').join('');
  const s = d.summary || {};
  return '<div class="gl-verdict '+(s.blockingMissing?'bad':'good')+'">'+escH(s.verdict||'')+
           ' <span class="gl-count">'+(s.on||0)+' of '+(s.total||0)+' configured</span></div>'+
         rows(d.items)+
         '<div class="gl-sec">Storage bindings</div>'+
         rows(d.storage);
}

/* === INTEGRATIONS: real Connect flow (OAuth-style, no key pasting) ===
   Each integration's Connect button starts the provider's own approval flow.
   The user approves in a popup and comes back connected. For this to run live,
   you (owner) register each provider's OAuth app once and add its Client ID in
   the platform settings - exactly how every big AI product does it. */
const INTEGRATION_META = {
  google:  { name:'Google',     key:'amv_gtoken',  oauth:'amv_gauth',   storeKey:'amv_google_connected' },
  outlook: { name:'Microsoft 365', key:'amv_outlook', oauth:'amv_ms_client' },
  slack:   { name:'Slack',      key:'amv_slack',   oauth:'amv_slack_client' },
  sms:     { name:'Text messages', key:'amv_sms_phone' },
  discord: { name:'Discord',    key:'amv_discord', oauth:'amv_discord_client' },
  github:  { name:'GitHub',     key:'amv_github',  oauth:'amv_gh_client' },
  vscode:  { name:'VS Code',    key:'amv_vscode' },
  linear:  { name:'Linear',     key:'amv_linear',  oauth:'amv_linear_client' },
  notion:  { name:'Notion',     key:'amv_notion',  oauth:'amv_notion_client' },
  canvas:  { name:'Canvas LMS', key:'amv_canvas' },
};
/* DEPRECATED / NEUTRALIZED: launching a custom protocol (vscode://, etc.) can
   make the browser show "a problem occurred" and blank the whole page when no
   handler is installed. We never do this anymore - integrations connect via
   OAuth popups (which can't blank the page) or via CLI/API-key guidance. This
   stub is kept so any legacy caller is a harmless no-op instead of a hazard. */
function _tryProtocol(url){ /* intentionally does nothing - see comment above */ }
async function connectIntegration(id){
  const m = INTEGRATION_META[id];
  if(!m){ return; }
  // Google has a real OAuth path already wired
  if(id==='google'){
    const cid=loadStr('amv_gauth');
    if(cid && window.google?.accounts?.id){ triggerGoogle(); return; }
    if(cid){ // OAuth configured but library not ready
      toast('Opening Google sign-in…','info'); triggerGoogle(); return;
    }
    toast('Google connection isn\u2019t switched on yet for this site. Once the operator enables it, Connect opens the Google approval popup - no keys to paste.','info',6000);
    return;
  }
  // SMS uses the phone link flow
  if(id==='sms'){ return connectSms(); }
  // VS Code: it runs through the AMV CLI/extension, not a web OAuth. Show the
  // setup instructions rather than trying to force a protocol navigation
  // (which can blank the page if the handler isn't installed).
  if(id==='vscode'){
    if(typeof _devConnectVSCode==='function'){ _devConnectVSCode(); return; }
    toast('To use AMV in VS Code, install the AMV CLI (npm i -g @amv/cli) and run "amv code ." in your project.','info',6000);
    return;
  }
  // Generic OAuth providers: open the provider's approval window if configured
  const clientId = m.oauth ? loadStr(m.oauth) : '';
  if(clientId){
    /* AND ONLY IF AMV CAN FINISH IT. See _OAUTH_COMPLETABLE below - every one
       of these redirects to /oauth/<id>, and only Google has anything waiting
       there. Sending somebody to approve real scopes on their GitHub or Notion
       account and then dropping them on a page that cannot exchange the code
       leaves them having granted access AMV never receives and they have no
       reason to think they need to revoke. Worse than a button that does
       nothing, because it changes something outside AMV. */
    if(!_OAUTH_COMPLETABLE.has(id)){
      toast(m.name+' sign-in is not finished yet, so AMV will not send you to approve it. '+
            'Approving would grant '+m.name+' access that AMV has nowhere to receive - you would be giving away permissions for nothing.','info',8000);
      return;
    }
    const url = await _oauthUrl(id, clientId);
    if(url){ _openOAuthPopup(url, id); return; }
  }
  // Not configured by the operator yet - honest message, no fake "connected"
  toast(m.name+' isn\u2019t connected yet. It needs its API key added by the operator in Settings first - once that\u2019s done, Connect opens '+m.name+'\u2019s secure approval popup (nothing for you to paste).','info',6000);
}
/* The providers whose approval AMV can actually complete: there is a callback
   that exchanges the code, and a token the tools can then use.

   Everything in _oauthUrl below builds a redirect to `/oauth/<id>`. The worker
   serves exactly one exchange route, /v1/oauth/google/exchange, and nothing
   client-side or server-side answers /oauth/github, /oauth/notion, or the rest.
   The rest of the product already knows this - 13-integrations.js files Notion,
   Linear, Discord and Outlook under PLANNED_CAPABILITIES, "no executable
   backend yet" - and this file was the one place that disagreed and would have
   launched the flow anyway the moment an operator pasted a client id.

   Add a provider here when its callback exists, not before. */
const _OAUTH_COMPLETABLE = new Set(['google']);
try{ window._OAUTH_COMPLETABLE=_OAUTH_COMPLETABLE; }catch(e){}
async function _oauthUrl(id, clientId){
  const redirect = encodeURIComponent(location.origin + '/oauth/' + id);
  // PKCE + state on every provider that supports the auth-code flow (AMV-039:
  // the transaction is bound to THIS provider so callbacks can't be mixed up)
  const pk = await _pkceChallenge(id);
  const pkce = '&code_challenge='+pk.challenge+'&code_challenge_method=S256&state='+pk.state;
  const map = {
    outlook: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id='+clientId+'&response_type=code&scope=openid%20Mail.ReadWrite%20Calendars.ReadWrite&redirect_uri='+redirect+pkce,
    slack:   'https://slack.com/oauth/v2/authorize?client_id='+clientId+'&scope=chat:write,channels:read&redirect_uri='+redirect+'&state='+pk.state,
    discord: 'https://discord.com/oauth2/authorize?client_id='+clientId+'&response_type=code&scope=identify%20bot&redirect_uri='+redirect+'&state='+pk.state,
    github:  'https://github.com/login/oauth/authorize?client_id='+clientId+'&scope=repo,read:org&redirect_uri='+redirect+'&state='+pk.state,
    linear:  'https://linear.app/oauth/authorize?client_id='+clientId+'&response_type=code&scope=read,write&redirect_uri='+redirect+'&state='+pk.state,
    notion:  'https://api.notion.com/v1/oauth/authorize?client_id='+clientId+'&response_type=code&owner=user&redirect_uri='+redirect+'&state='+pk.state,
  };
  return map[id]||'';
}
function _openOAuthPopup(url, id){
  const w=560,h=680,left=(screen.width-w)/2,top=(screen.height-h)/2;
  const pop=window.open(url,'amv_oauth_'+id,'width='+w+',height='+h+',left='+left+',top='+top);
  if(!pop){ toast('Allow popups to connect.','error'); return; }
  toast('Approve access in the popup to finish connecting.','info',5000);
  // the backend OAuth callback marks the integration connected; we poll briefly
  const meta=INTEGRATION_META[id];
  let tries=0;
  const iv=setInterval(()=>{
    tries++;
    if(loadStr(meta.key)){ clearInterval(iv); toast(meta.name+' connected!','success'); _refreshIntegrationsUI(); }
    if(tries>60 || (pop&&pop.closed)){ clearInterval(iv); _refreshIntegrationsUI(); }
  },1000);
}
async function connectSms(){
  const phone = await showTextPromptAsync('Enter your mobile number (with country code) to run AMV by text:');
  if(!phone) return;
  const clean = phone.replace(/[^\d+]/g,'');
  if(clean.replace(/\D/g,'').length<10){ showError('Enter a valid mobile number with country code.'); return; }
  if(!(window.AMV_API && AMV_API.live)){ toast('SMS needs the backend connected.','error',5000); return; }
  try{
    const r1=await AMV_API._fetch('/sms/register',{method:'POST',body:JSON.stringify({phone:clean})});
    const d1=await r1.json().catch(()=>({}));
    if(r1.status===503 || d1.code==='sms_unconfigured'){ toast('SMS is not switched on for this workspace yet.','error',5000); return; }
    if(r1.status===409){ toast(d1.error||'That number is already linked to another account.','error',5000); return; }
    if(!d1.pending){ toast(d1.error||'Could not start SMS linking.','error',5000); return; }
    const code=await showTextPromptAsync('Enter the 6-digit code AMV just texted to '+clean+':');
    if(!code) return;
    const r2=await AMV_API._fetch('/sms/register',{method:'POST',body:JSON.stringify({phone:clean, code:String(code).replace(/\D/g,'')})});
    const d2=await r2.json().catch(()=>({}));
    if(r2.status===200 && d2.verified){
      saveStr('amv_sms_phone',clean);
      toast('Number verified and linked!','success',5000);
      _refreshIntegrationsUI();
    } else { toast(d2.error||'That code did not match. Try linking again.','error',5000); }
  }catch(e){ toast('Could not link right now. SMS needs the backend connected.','error',5000); }
}
function disconnectIntegration(id){
  const m=INTEGRATION_META[id]; if(!m) return;
  try{ localStorage.removeItem(_scopeKey(m.key)); }catch(e){}
  if(id==='google'){ try{ localStorage.removeItem(_scopeKey('amv_gtoken')); localStorage.removeItem(_scopeKey('amv_gtoken_exp')); }catch(e){} }
  toast(m.name+' disconnected','info'); _refreshIntegrationsUI();
}
window.connectIntegration=connectIntegration;
window.disconnectIntegration=disconnectIntegration;

/* Export everything AMV holds for this user as a downloadable JSON file (GDPR). */
/* Delete the user's account for real. If connected to the backend, this calls
   the server to PURGE their account, chats, subscription, and automations from
   storage (the privacy policy promises this). Then it clears local data. It's
   irreversible, so we require the user to type DELETE to confirm. */
function _confirmDeleteAccount(){
  const ovr=$('ovr'); if(!ovr) return;
  const connected = !!(window.AMV_API && AMV_API.live && AMV_API.token);
  ovr.innerHTML=
    '<div class="ov" id="del-bg"><div class="ob" onclick="event.stopPropagation()">'+
      '<button class="oc" onclick="closeOvr()">&#215;</button>'+
      '<h2 style="color:var(--red)">Delete your account</h2>'+
      '<p class="ob-sub">This permanently removes '+(connected
        ? 'your account, chats, projects, automations, and subscription from AMV\u2019s servers'
        : 'all AMV data stored in this browser')+'. <b>This cannot be undone.</b></p>'+
      (connected?'':'<div class="fp-warn" style="margin-bottom:12px">\u26a0 You\u2019re not connected to the AMV engine, so only this browser\u2019s data will be cleared.</div>')+
      '<p style="font-size:12.5px;color:var(--mu);margin-bottom:6px">Tip: you can <button class="lnk-inline" id="del-export">export your data</button> first.</p>'+
      '<label class="lbl">Type <b>DELETE</b> to confirm</label>'+
      '<input type="text" id="del-confirm" placeholder="DELETE" autocomplete="off">'+
      '<div style="display:flex;gap:9px;margin-top:14px">'+
        '<button class="btn bs" onclick="closeOvr()" style="flex:1">Cancel</button>'+
        '<button class="btn bd2" id="del-go" style="flex:1" disabled>Delete account</button>'+
      '</div>'+
    '</div></div>';
  ovr.classList.add('on');
  document.getElementById('del-bg')?.addEventListener('click',closeOvr);
  const inp=$('del-confirm'), go=$('del-go');
  on(inp,'input',()=>{ if(go) go.disabled = (inp.value.trim().toUpperCase()!=='DELETE'); });
  on($('del-export'),'click',()=>{ try{ _exportUserData(); }catch(e){} });   // async; its own errors are reported inside
  on(go,'click',async()=>{
    if(inp.value.trim().toUpperCase()!=='DELETE') return;
    go.disabled=true; go.textContent='Deleting\u2026';
    // Purge server-side FIRST (while we still hold the token to authenticate it).
    if(connected){
      try{
        const r=await AMV_API._fetch('/auth/delete',{method:'POST',body:'{}'});
        if(!r.ok){ throw new Error('server delete failed'); }
      }catch(e){
        go.disabled=false; go.textContent='Delete account';
        if(typeof toast==='function') toast('Couldn\u2019t delete on the server. Please try again or contact support.','error');
        return;
      }
    }
    // Erase THIS account off the device, rather than blanking all of storage.
    // On a family or school computer, wiping everything would also destroy a
    // sibling's chats, memories and purchases - not what "delete MY account"
    // asks for, and not something they consented to.
    try{ eraseDeviceData((S.user&&S.user.email)||'guest'); }catch(e){}
    try{ localStorage.removeItem('amv_user'); }catch(e){}
    location.reload();
  });
}
try{ window._confirmDeleteAccount=_confirmDeleteAccount; }catch(e){}

/* Local-storage reads, kept OUT of the export function.

   An empty list here means "none saved", which is the honest answer for a
   local read that cannot fail any other way. Inside _exportUserData it stopped
   being obviously that: the function now also reads over the NETWORK, where an
   empty list would mean "the request failed and we are pretending it did not",
   and reads-cannot-fabricate is right to refuse to distinguish them by eye. */
function _exportSkills(){
  const readList=(k)=>{ try{ return load(k)||[]; }catch(e){ return []; } };
  return { custom: readList('amv_skills'), active: readList('amv_active_skills') };
}

async function _exportUserData(){
  try{
    const u=S.user||{};
    /* What the SERVER holds, which is most of it. This file used to contain
       only what lived in this browser and said so - honest about its scope, and
       not the answer somebody is asking for when they press this next to
       "Delete account". Automations, approvals, handoffs, purchases, the
       wallet, listings and the activity log all live on the server. */
    let server=null, serverError='';
    if(window.AMV_API && AMV_API.live && AMV_API.token){
      try{
        const r=await AMV_API._fetch('/v1/account/export', { method:'GET' });
        const d=await r.json().catch(()=>null);
        if(r.ok && d && d.ok) server=d;
        else serverError=(d && d.error) || ('the server answered '+r.status);
      }catch(e){ serverError=e.message||'the server could not be reached'; }
    }
    const collect=(k)=>{ try{ return loadStr(k); }catch(e){ return null; } };
    const data={
      export_info:{
        product:'AMV.AI',
        generated_at:new Date().toISOString(),
        account:u.email||'(not signed in)',
        scope: server ? 'Everything AMV holds for you: what is stored in this browser, and what is stored on the server.'
             : serverError ? 'This browser only. AMV could not reach the server for the rest ('+serverError+') - try again to get the complete file.'
             : 'This browser only, because this device is not connected to an AMV server. Nothing else is stored anywhere.',
        note:'AMV never stores your payment card details or self-hosting credentials. Live credentials AMV does hold are listed by name under server.withheld rather than included - an export is not a way to read a key back out.'
      },
      server: server || (serverError ? { error: serverError } : null),
      profile:{
        name:u.name||'', email:u.email||'', provider:u.provider||'email',
        nickname:collect('amv_nickname')||'', work:collect('amv_work')||'',
        instructions:collect('amv_instructions')||''
      },
      conversations:S.convs||[],
      memory:S.memory||[],
      images:S.imgs||[],
      videos:S.vids||[],
      prompts:S.prompts||[],
      workspaces:S.workspaces||[],
      skills:_exportSkills(),
      settings:{
        theme:collect('amv_theme'), accent:collect('amv_accent'), language:collect('amv_lang'),
        /* `amv_font_size` is a key nothing has ever written - setFontSize
           stores `amv_fs` - so this field exported null for every user who had
           ever changed their text size. A data export that quietly omits a
           setting is the same class of wrong as one that invents a value. */
        plan:collect('amv_plan'), fontSize:collect('amv_fs'),
        privacy:{ locationMetadata:collect('amv_location_opt')==='1', helpImproveModels:collect('amv_improve_opt')==='1', analyticsOptOut:collect('amv_analytics_opt_out')==='1' },
        capabilities:{ webSearch:collect('amv_cap_websearch')!=='0', memory:collect('amv_cap_memory')!=='0', interactiveBlocks:collect('amv_cap_suggestions')!=='0' }
      }
    };
    const json=JSON.stringify(data,null,2);
    const blob=new Blob([json],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    const stamp=new Date().toISOString().slice(0,10);
    a.href=url; a.download='amv-my-data-'+stamp+'.json';
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); },100);
    /* Say which file they actually got. Reporting a complete export over a
       partial one is the failure this whole change exists to stop. */
    const conv=(S.convs||[]).length, mem=(S.memory||[]).length;
    if(typeof toast==='function'){
      if(server) toast('Exported everything AMV holds for you - '+conv+' chats, '+mem+' memories, plus your server records.','success',4000);
      else if(serverError) toast('Exported what is on this device only - the server could not be reached. Try again for the complete file.','info',5000);
      else toast('Your data was exported - '+conv+' chats, '+mem+' memories included.','success',3500);
    }
  }catch(e){ _logErr('exportData',e); if(typeof toast==='function') toast('Couldn\u2019t export right now. Please try again.','error'); }
}
try{ window._exportUserData=_exportUserData; }catch(e){}
function renderSetPane(){ _renderSetPaneInner(); _killTokenAutofill(); try{ if(_lang()!=='auto'&&_lang()!=='en') _translateUI(); }catch(e){ console.error('Translate UI error in renderSetPane', e); } }
/* Stop browsers / password managers from autofilling API-key & token fields.
   The only field that SHOULD autofill is the real account password (#a-pass). */
function _killTokenAutofill(){
  try{
    document.querySelectorAll('input[type="password"]').forEach(inp=>{
      if(inp.id==='a-pass'||inp.id==='pw-new'||inp.id==='pw-conf'||inp.id==='pw-cur') return;
      inp.setAttribute('autocomplete','off');
      inp.setAttribute('autocorrect','off');
      inp.setAttribute('autocapitalize','off');
      inp.setAttribute('spellcheck','false');
      inp.setAttribute('data-lpignore','true');
      inp.setAttribute('data-1p-ignore','true');
      inp.setAttribute('data-form-type','other');
      if(!inp.getAttribute('name')) inp.setAttribute('name','amv-secret-'+inp.id);
      // if the browser already injected a value the user didn't type, and we have nothing saved, clear it
      if(inp.value && inp.dataset.amvExpected!=='1' && !inp.dataset.amvHadValue){ /* keep real saved values, handled at render */ }
    });
  }catch(e){}
}
// Build a compact profile context string from the user's saved profile fields.
// This is injected into the assistant so the Instructions actually take effect.
function _profileContext(){
  try{
    const nick=(loadStr('amv_nickname')||'').trim();
    const work=(loadStr('amv_work')||'').trim();
    const instr=(loadStr('amv_instructions')||'').trim();
    const parts=[];
    if(nick) parts.push('The user prefers to be called '+nick+'.');
    if(work) parts.push('Their work area: '+work+'.');
    if(instr) parts.push('User instructions to always follow: '+instr);
    return parts.length?('\n\n[About the user]\n'+parts.join(' ')):'';
  }catch(e){ return ''; }
}
try{ window._profileContext=_profileContext; }catch(e){}

/* THIS DEVICE, AND THE CONTROL THAT REVOKES THE REST.

   Two things were wrong here, and both were in the Security pane - the screen
   somebody opens when they think their account is compromised.

   The heading said "Active sessions - Devices currently signed in to your
   account" above a single row built from navigator.userAgent. There is no
   endpoint that enumerates an account's sessions, so that list was one row of
   local guesswork presented as an account-wide fact, and it can never show the
   session a worried person is actually looking for.

   And "Sign out of all other sessions" wrote a timestamp into localStorage and
   said "Signed out of all other sessions." Nothing was sent anywhere. The
   comment beside it admitted as much - "on a real backend this also revokes
   other tokens" - while /auth/logout {everywhere:true} has existed the whole
   time and revokes every refresh token on the account. A security control that
   reports success without acting is worse than no control: it ends the search
   for the one that works. */
function _activeSessionsHTML(){
  try{
    const ua=navigator.userAgent||'';
    const browser=/Edg/.test(ua)?'Edge':/Chrome/.test(ua)?'Chrome':/Firefox/.test(ua)?'Firefox':/Safari/.test(ua)?'Safari':'Browser';
    const os=/Windows/.test(ua)?'Windows':/Mac/.test(ua)?'macOS':/Android/.test(ua)?'Android':/iPhone|iPad/.test(ua)?'iOS':/Linux/.test(ua)?'Linux':'';
    const started=loadStr('amv_session_started')||Date.now();
    if(!loadStr('amv_session_started')) saveStr('amv_session_started',String(started));
    const when=new Date(Number(started)).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    const live=!!(window.AMV_API && AMV_API.live && AMV_API.token);
    return '<div class="ss2"><h3>This device</h3>'+
      '<div class="set-sub" style="margin-top:-2px;margin-bottom:12px">AMV cannot list your other devices - nothing on the server records which browsers hold a session. What it can do is end every one of them at once.</div>'+
      '<div class="sess-row sess-current">'+
        '<span class="sess-ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></span>'+
        '<div class="sess-txt"><div class="sess-name">'+escH(browser+(os?' on '+os:''))+' <span class="sess-badge">This device</span></div>'+
          '<div class="sess-meta">Signed in \u00b7 since '+escH(when)+'</div></div>'+
      '</div>'+
      '<button class="btn bs" id="signout-others" style="margin-top:12px;font-size:12px"'+(live?'':' disabled')+'>Sign out everywhere</button>'+
      '<div class="set-sub" style="margin-top:8px">'+(live
        ? 'Ends every session on your account, including this one. You will be asked to sign in again.'
        : 'Needs the AMV backend connected. Without it there are no server sessions to end, so this would do nothing.')+'</div>'+
      '<div id="sess-msg" class="set-sub" role="status" aria-live="polite" style="margin-top:8px"></div>'+
    '</div>';
  }catch(e){ return ''; }
}

// ── SKILLS ────────────────────────────────────────────────────
// User-created instruction presets. Each active skill is injected into the
// system prompt, so they genuinely change how AMV responds.
const _BUILTIN_SKILLS=[
  {id:'concise',name:'Concise answers',desc:'Skip preamble; get straight to the point.',instr:'Be concise. Skip preamble and filler. Lead with the answer, then only the details that matter.'},
  {id:'reviewer',name:'Senior code reviewer',desc:'Reviews code like a staff engineer.',instr:'When reviewing code, act as a senior/staff engineer: flag bugs, security issues, and edge cases first, suggest concrete improvements, and note anything you\u2019d block in review.'},
  {id:'eli5',name:'Explain simply',desc:'Explains things in plain language.',instr:'Explain concepts in plain, simple language with a concrete example or analogy. Avoid jargon unless you define it.'},
  {id:'brand',name:'My brand voice',desc:'Writes marketing copy in a consistent voice.',instr:'When writing marketing or customer-facing copy, keep the tone confident, warm, and clear. No hype words, no clich\u00e9s, short punchy sentences.'},
];
function _loadSkills(){ try{ return load('amv_skills')||[]; }catch(e){ return []; } }
function _saveSkills(list){ try{ store('amv_skills',list); }catch(e){} }
function _activeSkillIds(){ try{ return load('amv_active_skills')||[]; }catch(e){ return []; } }
function _setActiveSkills(ids){ try{ store('amv_active_skills',ids); }catch(e){} }
// Feed active skills into the assistant.
function _skillsContext(){
  try{
    const active=_activeSkillIds();
    if(!active.length) return '';
    const all=[..._BUILTIN_SKILLS,..._loadSkills()];
    const on=all.filter(s=>active.indexOf(s.id)>=0);
    if(!on.length) return '';
    return '\n\n[Active skills]\n'+on.map(s=>'- '+s.instr).join('\n');
  }catch(e){ return ''; }
}
try{ window._skillsContext=_skillsContext; }catch(e){}

// Tell the model which optional capabilities the user has turned OFF, so it
// doesn't offer or attempt them. Only lists disabled ones (keeps prompt short).
function _pluginContext(){ return ''; }  // no capability is ever disabled

try{ window._pluginContext=_pluginContext; }catch(e){}

// Coarse locale/timezone context - only when the user has opted in via the
// Privacy toggle. Uses browser-exposed locale info (no GPS, no tracking).
function _localeContext(){
  try{
    if(loadStr('amv_location_opt')!=='1') return '';
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';
    const loc=(navigator.language||'').trim();
    const parts=[];
    if(tz) parts.push('timezone '+tz);
    if(loc) parts.push('locale '+loc);
    if(!parts.length) return '';
    return '\n\n[User context] The user\u2019s '+parts.join(' and ')+'. Use this for time-aware and locally relevant answers when helpful.';
  }catch(e){ return ''; }
}
try{ window._localeContext=_localeContext; }catch(e){}

function _renderSkillsPane(pane){
  const custom=_loadSkills();
  const active=_activeSkillIds();
  const row=(s,isCustom)=>{
    const on=active.indexOf(s.id)>=0;
    return '<div class="skill-row"><div class="skill-info"><div class="skill-name">'+escH(s.name)+(on?' <span class="skill-on">Active</span>':'')+'</div>'+
      '<div class="skill-desc">'+escH(s.desc||'')+'</div></div>'+
      '<div class="skill-acts">'+
        (isCustom?'<button class="skill-del" data-skdel="'+escH(s.id)+'" title="Delete"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>':'')+
        '<label class="sw"><input type="checkbox" data-sktoggle="'+escH(s.id)+'" '+(on?'checked':'')+'><span class="sw-sl"></span></label>'+
      '</div></div>';
  };
  pane.innerHTML=
    '<div class="set-title">Skills</div>'+
    '<div class="set-sub">Reusable instruction presets. Turn one on and AMV follows it in every chat until you turn it off.</div>'+
    '<div class="ss2"><h3>Your skills</h3>'+
      (custom.length?'<div class="skill-list">'+custom.map(s=>row(s,true)).join('')+'</div>':'<div class="skill-empty">No custom skills yet - create one below.</div>')+
      '<div class="skill-create">'+
        '<input class="inp" id="sk-name" placeholder="Skill name (e.g. \u201cLegal tone\u201d)" maxlength="60">'+
        '<textarea id="sk-instr" rows="2" placeholder="What should AMV do? e.g. \u201cWrite in a formal, precise tone and cite sources.\u201d" style="width:100%;resize:vertical;margin-top:8px"></textarea>'+
        '<button class="btn bp" id="sk-add" style="margin-top:8px;font-size:12px">Create skill</button>'+
      '</div>'+
    '</div>'+
    '<div class="ss2"><h3>Presets</h3>'+
      '<div class="set-sub" style="margin-top:-2px;margin-bottom:12px">Ready-made skills you can switch on.</div>'+
      '<div class="skill-list">'+_BUILTIN_SKILLS.map(s=>row(s,false)).join('')+'</div>'+
    '</div>';
  // wire toggles
  pane.querySelectorAll('[data-sktoggle]').forEach(cb=>on(cb,'change',function(){
    const id=this.getAttribute('data-sktoggle');
    let a=_activeSkillIds();
    if(this.checked){ if(a.indexOf(id)<0) a.push(id); } else { a=a.filter(x=>x!==id); }
    _setActiveSkills(a); _renderSkillsPane(pane);
  }));
  pane.querySelectorAll('[data-skdel]').forEach(btn=>on(btn,'click',function(){
    const id=this.getAttribute('data-skdel');
    _saveSkills(_loadSkills().filter(s=>s.id!==id));
    _setActiveSkills(_activeSkillIds().filter(x=>x!==id));
    _renderSkillsPane(pane);
  }));
  on($('sk-add'),'click',()=>{
    const name=($('sk-name')?.value||'').trim();
    const instr=($('sk-instr')?.value||'').trim();
    if(!name||!instr){ toast('Give your skill a name and instructions.','error',3000); return; }
    const list=_loadSkills();
    list.push({id:'sk_'+Date.now(), name:name.slice(0,60), desc:instr.slice(0,80), instr:instr.slice(0,1000)});
    _saveSkills(list);
    toast('Skill created','success',2500);
    _renderSkillsPane(pane);
  });
}

// ── PLUGINS ───────────────────────────────────────────────────
// Optional capability modules the user can enable. Each maps to a real feature
// area in AMV; toggling persists and gates that area.
// Core capabilities are always available - we never silently restrict what AMV
// can do behind a toggle the user may have forgotten about.
function _pluginOn(id){ return true; }
try{ window._renderSkillsPane=_renderSkillsPane; window._pluginOn=_pluginOn; }catch(e){}

function _renderSetPaneInner(){
  const pane=$('set-pane'); if(!pane) return;
  let sp=S.settingsPane;
  // Hard gate: admin/operator panes are OWNER-ONLY. If a non-owner reaches one
  // (forced state, stale pane), refuse and fall back to Account.
  const _ADMIN_PANES=['dashboard','apikeys','backend','platform'];
  if(_ADMIN_PANES.indexOf(sp)>=0 && !isAdmin()){ S.settingsPane='account'; sp='account'; }
  // Billing renders its full content INSIDE the settings pane (stays in Settings).
  if(sp==='billing'){ if(typeof renderBillingView==='function'){ renderBillingView(pane); } return; }
  // Projects lives in Settings now - render its grid inside the pane.
  if(sp==='projects'){
    pane.innerHTML=
      '<div class="set-title">Projects</div>'+
      '<div class="set-sub">Group related chats, builds, and research into a project so AMV keeps the full context together.</div>'+
      '<button class="btn bp" id="ws-new" style="align-self:flex-start;margin-bottom:16px">+ New project</button>'+
      '<div class="wg" id="ws-grid"></div>';
    on($('ws-new'),'click',createWorkspaceModal);
    try{ renderWsGrid(); }catch(e){}
    return;
  }
  const pfp=S.user&&S.user.email?loadStr('amv_pfp_'+S.user.email):'';
  const pfpHtml=_avatarInner(S.user&&S.user.email);

  if(sp==='account'){
    pane.innerHTML=
      '<div class="set-title">Account</div>'+
      '<div class="set-sub">Manage your profile and account information.</div>'+
      '<div class="ss2">'+
        '<div style="display:flex;align-items:center;gap:17px;margin-bottom:16px;flex-wrap:wrap">'+
          '<div style="position:relative;flex-shrink:0">'+
            '<div id="pfp-c" style="width:72px;height:72px;border-radius:50%;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid rgba(255,255,255,.1);cursor:pointer;transition:all .2s">'+pfpHtml+'</div>'+
            '<div id="pfp-edit" style="position:absolute;bottom:0;right:0;width:22px;height:22px;background:var(--s2);border:1px solid var(--bd);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:11px;transition:all .12s">&#x270F;</div>'+
            '<input type="file" id="pfp-fi" accept="image/*" style="display:none">'+
          '</div>'+
          '<div><div style="font-size:16px;font-weight:700;letter-spacing:-.3px">'+escH(S.user&&S.user.name?S.user.name:'Guest')+'</div>'+
          '<div style="font-size:12px;color:var(--t2);margin-top:2px">'+escH(S.user&&S.user.email?S.user.email:'')+'</div>'+
          '<span class="badge '+(S.user&&S.user.provider==='google'?'bb':'bg3')+'" style="margin-top:7px">'+(S.user&&S.user.provider==='google'?'Google Account':'Email Account')+'</span></div>'+
        '</div>'+
        '<div class="sf">'+
          '<div><label class="lbl">Full name</label><input type="text" id="s-name" value="'+escH(S.user&&S.user.name?S.user.name:'')+'" placeholder="Your name"></div>'+
          '<div><label class="lbl">What should AMV call you?</label><input type="text" id="s-nick" value="'+escH(loadStr('amv_nickname')||'')+'" placeholder="Nickname"></div>'+
          '<div><label class="lbl">What best describes your work?</label>'+
            '<select id="s-work" class="sel" aria-label="What best describes your work">'+
              ['','Software \u0026 engineering','Design \u0026 creative','Marketing \u0026 content','Sales \u0026 business','Research \u0026 academia','Operations \u0026 admin','Finance','Founder \u2044 entrepreneur','Student','Other'].map(o=>{
                const cur=(loadStr('amv_work')||'');
                return '<option value="'+escH(o)+'"'+(o===cur?' selected':'')+'>'+(o||'Select\u2026')+'</option>';
              }).join('')+
            '</select>'+
          '</div>'+
          '<div><label class="lbl">Instructions for AMV</label>'+
            '<textarea id="s-instr" rows="3" placeholder="e.g. I primarily code in Python (not a beginner). Keep answers concise and skip the preamble." style="width:100%;resize:vertical;min-height:70px">'+escH(loadStr('amv_instructions')||'')+'</textarea>'+
            '<div class="lbl-help">AMV keeps these in mind across every chat and agent. Great for your role, preferences, and how you like answers.</div>'+
          '</div>'+
          '<div id="acct-msg" style="display:none;font-size:12px;padding:7px 11px;border-radius:7px"></div>'+
          '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
            '<button class="btn bp" id="save-profile" style="font-size:12px">Save changes</button>'+
            '<button class="btn bs" id="rm-pfp" style="font-size:12px;'+(pfp?'':'opacity:.4;pointer-events:none')+'">Remove photo</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
      _activeSessionsHTML();
    on($('pfp-c'),'click',()=>$('pfp-fi')?.click());
    on($('pfp-edit'),'click',()=>$('pfp-fi')?.click());
    on($('pfp-fi'),'change',function(){
      const file=this.files[0]; if(!file) return;
      if(file.size>5*1024*1024){toast('Image must be under 5MB','error');return;}
      const r=new FileReader();
      r.onload=e=>{const b=e.target.result;if(S.user&&S.user.email)saveStr('amv_pfp_'+S.user.email,b);updateSbUser();renderSetPane();toast('Photo updated','success');};
      r.readAsDataURL(file); this.value='';
    });
    on($('rm-pfp'),'click',()=>{if(S.user&&S.user.email)localStorage.removeItem('amv_pfp_'+S.user.email);updateSbUser();renderSetPane();});
    /* Straight to the one that already works.

       This was the second control for the same thing, and the fake one:
       _actSignOutEverywhere in 28-activity.js has always confirmed, called
       /auth/logout {everywhere:true}, checked the answer and signed the user
       out - while this button wrote a timestamp into localStorage and said
       "Signed out of all other sessions." Writing a second correct
       implementation here would leave two to keep in step; there is one. */
    on($('signout-others'),'click',()=>{
      const msg=$('sess-msg');
      if(!(window.AMV_API && AMV_API.live && AMV_API.token)){
        if(msg) msg.textContent='Not connected to the AMV backend, so there are no server sessions to end. Nothing was changed.';
        return;
      }
      _actSignOutEverywhere('sess-msg');
    });
    on($('save-profile'),'click',async()=>{
      const nm=$('s-name')?.value.trim();
      const msg=$('acct-msg');
      function sm(t,ok){if(msg){msg.textContent=t;msg.style.display='block';msg.style.background=ok?'rgba(35,209,139,.07)':'rgba(255,95,87,.07)';msg.style.border='1px solid '+(ok?'rgba(35,209,139,.2)':'rgba(255,95,87,.2)');msg.style.color=ok?'var(--green)':'var(--red)';}}
      if(!nm){sm('Name cannot be empty.',false);return;}
      // Persist the profile fields - these actually feed the assistant (see _profileContext).
      try{
        saveStr('amv_nickname', ($('s-nick')?.value||'').trim().slice(0,60));
        saveStr('amv_work', ($('s-work')?.value||''));
        saveStr('amv_instructions', ($('s-instr')?.value||'').trim().slice(0,2000));
      }catch(e){}
      if(S.user){
        const key=acctKey(S.user.email);
        const raw=localStorage.getItem(key);
        if(raw){try{const a=JSON.parse(raw);a.name=nm;a.ini=nm.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2);localStorage.setItem(key,JSON.stringify(a));}catch{}}
        S.user.name=nm; S.user.ini=nm.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2); store('amv_user',S.user); updateSbUser();
        sm('Changes saved!',true);
      }
    });

  } else if(sp==='security'){
    pane.innerHTML=
      '<div class="set-title">Security</div>'+
      '<div class="set-sub">Manage your password and account security.</div>'+
      (S.user&&S.user.provider==='google'?
        '<div class="ss2"><p style="font-size:13px;color:var(--t2)">Signed in with Google. Manage your password at <a href="https://myaccount.google.com" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">myaccount.google.com</a>.</p></div>':
        '<div class="ss2"><h3>Password</h3>'+
          '<div class="br2"><div><div class="opt-name">Reset your password</div><div class="opt-desc">We\u2019ll send a secure reset link to '+escH((S.user&&S.user.email)||'your email')+'. No need to remember your current one.</div></div>'+
          '<button class="btn bp" id="reset-pw-btn" style="font-size:12px;white-space:nowrap">Send reset link</button></div>'+
          '<div id="pw-msg" style="display:none;font-size:12px;padding:9px 12px;border-radius:8px;margin-top:12px"></div>'+
        '</div>')+
      /* Was a hardcoded "This browser - Active now" row wired to nothing. It is
         now the account's real event log; see 28-activity.js. */
      '<div class="ss2"><h3>Account activity</h3>'+
        /* Naming the screen the control is on. "Sign out everywhere" lives in
           Account, and telling somebody to do it without saying where is how a
           worried person ends up hunting for it. */
        '<div class="set-hint">Where and when this account has been used. If something here was not you: send yourself a reset link above, then use <b>Sign out everywhere</b> under Settings &rarr; Account to end every session.</div>'+
        '<div id="act-block"></div>'+
      '</div>'+
      '<div class="ss2"><h3>This device</h3>'+
        '<div class="br2"><div><div style="font-size:13px;font-weight:500">Signed in on this browser</div><div style="font-size:11px;color:var(--t2);margin-top:2px">Signing out here leaves your other devices signed in.</div></div></div>'+
        '<button class="btn bs" style="font-size:12px;margin-top:12px" onclick="signOut()">Sign out of this device</button>'+
      '</div>';
    _renderActivityBlock(document.getElementById('act-block'));
    on($('reset-pw-btn'),'click',async()=>{
      const email=(S.user&&S.user.email)||'';
      const msg=$('pw-msg');
      const sm=(t,ok)=>{if(msg){msg.textContent=t;msg.style.display='block';msg.style.background=ok?'rgba(35,209,139,.07)':'rgba(255,95,87,.07)';msg.style.border='1px solid '+(ok?'rgba(35,209,139,.2)':'rgba(255,95,87,.2)');msg.style.color=ok?'var(--green)':'var(--red)';}};
      const btn=$('reset-pw-btn'); if(btn){ btn.disabled=true; btn.textContent='Sending…'; }
      /* `if(ok)` on the RESULT OBJECT was true for every outcome this function
         has - including {ok:false} from the catch and from having no backend at
         all - so the failure message below was unreachable and the button said
         "check your inbox" whatever happened. Somebody locked out of their
         account waits for an email that was never sent. Three real outcomes,
         told apart. */
      const res=await sendPasswordReset(email) || { ok:false, sent:false };
      if(btn){ btn.disabled=false; btn.textContent='Send reset link'; }
      if(res.ok && res.sent){
        sm('Reset link sent to '+email+'. Check your inbox and follow the link to set a new password.',true);
      } else if(res.ok){
        /* The server accepted it and sent nothing, which is what it does with no
           email provider configured. Saying "check your inbox" here is the same
           lie with extra steps. */
        sm('No email was sent - this deployment has no email provider connected, so AMV has no way to deliver the link. Nothing is wrong with your account.',false);
      } else {
        sm('Couldn\u2019t send the reset email'+(res.error?' ('+res.error+')':'')+'. Nothing was sent - please try again.',false);
      }
    });

  } else if(sp==='privacy'){
    pane.innerHTML=
      '<div class="set-title">Privacy</div>'+
      '<div class="set-sub">AMV believes in transparent data practices. Here\u2019s how your information is handled, and the controls you have over it.</div>'+
      // Intro: protect / use
      '<div class="ss2"><div class="prv-cards">'+
        '<div class="prv-card"><div class="prv-card-h"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>How we protect your data</div>'+
          '<p>Everything moves over encrypted HTTPS. Your conversations are tied to your account, payment cards never touch our servers, and usage limits are enforced server-side so they can\u2019t be bypassed.</p></div>'+
        '<div class="prv-card"><div class="prv-card-h"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/></svg>How we use your data</div>'+
          '<p>We use your data to run the product and, only if you allow it, to improve our AI. Analytics are opt-in and off by default. We never sell your data.</p></div>'+
      '</div></div>'+
      // Preferences
      '<div class="ss2"><h3>Preferences</h3>'+
        '<div class="prv-pref"><div><div class="prv-pref-t">Location metadata</div><div class="prv-pref-s">Allow AMV to use coarse location (city/region) to improve results like local search and time-aware answers.</div></div><label class="sw"><input type="checkbox" id="prv-location" '+(loadStr('amv_location_opt')==='1'?'checked':'')+'><span class="sw-sl"></span></label></div>'+
        '<div class="prv-pref"><div><div class="prv-pref-t">Help improve our AI models</div><div class="prv-pref-s">Allow your chats and coding sessions to help train and improve AMV\u2019s models. Off by default.</div></div><label class="sw"><input type="checkbox" id="prv-improve" '+(loadStr('amv_improve_opt')==='1'?'checked':'')+'><span class="sw-sl"></span></label></div>'+
        '<div class="prv-pref"><div><div class="prv-pref-t">Usage analytics</div><div class="prv-pref-s">Anonymous product analytics that help improve AMV. Never sold or shared.</div></div><label class="sw"><input type="checkbox" id="prv-analytics" '+(loadStr('amv_analytics_opt_out')==='1'?'':'checked')+'><span class="sw-sl"></span></label></div>'+
      '</div>'+
      // Your data
      '<div class="ss2"><h3>Your data</h3>'+
        '<div class="prv-data-row"><div><div class="prv-pref-t">Export data</div><div class="prv-pref-s">Download everything AMV has for you as a JSON file.</div></div><button class="btn bs" id="prv-export" style="font-size:12px">Export data</button></div>'+
        '<div class="prv-data-row"><div><div class="prv-pref-t">Shared chats</div><div class="prv-pref-s">Manage conversations you\u2019ve shared with a public link.</div></div><button class="btn bs" id="prv-shared" style="font-size:12px">Manage</button></div>'+
        '<div class="prv-data-row"><div><div class="prv-pref-t">Memory preferences</div><div class="prv-pref-s">Control what AMV remembers about you across chats.</div></div><button class="btn bs" id="prv-memory" style="font-size:12px">Open memory</button></div>'+
        '<div class="prv-data-row"><div><div class="prv-pref-t">Clear all chats</div><div class="prv-pref-s">Permanently delete your conversation history.</div></div><button class="btn bs" id="prv-clrchats" style="font-size:12px">Clear chats</button></div>'+
        '<div class="prv-data-row"><div><div class="prv-pref-t" style="color:var(--red)">Delete all data</div><div class="prv-pref-s">Remove everything AMV has stored for you. This can\u2019t be undone.</div></div><button class="btn bd2" id="prv-clrall" style="font-size:12px">Delete everything</button></div>'+
      '</div>'+
      (isAdmin()?(
      '<div class="ss2"><h3>Analytics provider <span style="font-weight:400;color:var(--mu);font-size:11px">(operator setup)</span></h3>'+
        '<div style="font-size:12px;color:var(--t2);line-height:1.7;margin-bottom:12px">Connect Google Analytics (GA4) or Plausible to measure real traffic. Enter your GA4 Measurement ID (starts with <code>G-</code>) or your Plausible site domain. Analytics only fire for visitors who accept analytics cookies.</div>'+
        '<div style="display:flex;gap:8px;align-items:center"><input class="inp" id="prv-ga-id" placeholder="G-XXXXXXX  or  yoursite.com" value="'+escH(_analyticsId())+'" style="flex:1"><button class="btn bp" id="prv-ga-save" style="font-size:12px">Save</button></div>'+
        /* "configured" was the whole status, and configured is not the same as
           running. The provider script is a third-party <script> and this page's
           Content-Security-Policy script-src allows neither of the two hosts, so
           an ID that is saved and consented to still measures nothing. Saying
           "configured" over that is the same failure as any other control that
           reports an outcome it did not check. */
        '<div style="font-size:11px;color:var(--t2);margin-top:8px">Status: '+(_analyticsId()?('<span style="color:var(--grn)">configured</span> \u00b7 '+(/^G-/i.test(_analyticsId())?'Google Analytics':'Plausible')):'<span style="color:var(--mu)">not set</span>')+'</div>'+
        (_analyticsId()&&_analyticsBlocked()
          ? '<div class="wg-capwarn on" style="margin-top:8px">Saved, but <b>nothing is being measured</b>. The provider\u2019s script was blocked before it loaded - this page\u2019s Content-Security-Policy does not list '+
            (/^G-/i.test(_analyticsId())?'googletagmanager.com':'plausible.io')+
            ', and an ad-blocker would do the same. Add the host to <code>script-src</code> (and its beacon host to <code>connect-src</code>) in index.html to switch it on, or leave analytics off.</div>'
          : '')+
      '</div>'+
      (function(){ const f=_funnel(); const step=(l,n)=>'<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0"><span style="font-size:12.5px;color:var(--t2)">'+l+'</span><span style="font-size:14px;font-weight:600">'+(n||0)+'</span></div>';
        const conv=(a,b)=>b?Math.round((a/b)*100):0;
        return '<div class="ss2"><h3>Conversion funnel <span style="font-weight:400;color:var(--mu);font-size:11px">(this device)</span></h3>'+
          '<div style="font-size:11px;color:var(--t2);margin-bottom:8px">First-party aggregate counts, tracked with no third party. Full cross-device funnels live in your analytics provider.</div>'+
          step('Landing visits', f.visit)+
          '<div style="height:1px;background:var(--bd)"></div>'+
          step('Sign-ups'+(f.visit?' \u00b7 '+conv(f.signup,f.visit)+'%':''), f.signup)+
          '<div style="height:1px;background:var(--bd)"></div>'+
          step('First message'+(f.signup?' \u00b7 '+conv(f.first_msg,f.signup)+'%':''), f.first_msg)+
          '<div style="height:1px;background:var(--bd)"></div>'+
          step('Upgrades'+(f.first_msg?' \u00b7 '+conv(f.upgrade,f.first_msg)+'%':''), f.upgrade)+
        '</div>';
      })()
      ):'');
    on($('prv-clrchats'),'click',()=>{
      const btn=$('prv-clrchats');
      if(btn.dataset.c!=='yes'){btn.textContent='Confirm clear';btn.dataset.c='yes';btn.style.color='var(--red)';setTimeout(()=>{btn.textContent='Clear all chats';btn.dataset.c='';btn.style.color='';},3000);return;}
      S.convs=[newConvObj()];S.cur=S.convs[0].id;_autoSave();renderHist();btn.textContent='Done!';btn.style.color='var(--green)';setTimeout(()=>renderSetPane(),1200);
    });
    on($('prv-export'),'click',()=>_exportUserData());
    on($('prv-ga-save'),'click',()=>{
      const v=($('prv-ga-id')?$('prv-ga-id').value:'').trim();
      _analyticsSetId(v);
      if(v){ _analyticsLoaded=false; try{ if(_analyticsAllowed()) _analyticsInit(); }catch(e){} toast('Analytics ID saved','success'); }
      else toast('Analytics disabled','info');
      renderSetPane();
    });
    on($('prv-analytics'),'change',function(){ saveStr('amv_analytics_opt_out', this.checked?'':'1'); toast(this.checked?'Analytics on - thank you for helping improve AMV':'Analytics off - no product data will be collected','success'); });
    on($('prv-location'),'change',function(){ saveStr('amv_location_opt', this.checked?'1':'0'); toast(this.checked?'Location metadata on':'Location metadata off','info',2200); });
    on($('prv-improve'),'change',function(){ saveStr('amv_improve_opt', this.checked?'1':'0'); toast(this.checked?'Thanks - your data can help improve AMV\u2019s models':'Off - your chats won\u2019t be used for model training','success'); });
    on($('prv-shared'),'click',()=>{ openSharedChatsManager(); });
    on($('prv-memory'),'click',()=>{ S.settingsPane=null; setTab('memory'); });
    on($('prv-clrall'),'click',()=>{
      _confirmDeleteAccount();
    });

  } else if(sp==='appearance'){
    const isDark=!document.body.classList.contains('light');
    const curFs=parseInt(loadStr('amv_fs')||'14',10);
    const fsBtn=(px,label)=>'<button class="fs-opt'+(curFs===px?' on':'')+'" data-fs="'+px+'"><span class="fs-pv" style="font-size:'+(px+1)+'px">Aa</span><span class="fs-lbl">'+label+'</span></button>';
    pane.innerHTML=
      '<div class="set-title">Appearance</div>'+
      '<div class="set-sub">Customize how AMV.AI looks and feels. Changes apply instantly across the whole app.</div>'+
      '<div class="ss2"><h3>Theme</h3>'+
        '<div class="br2"><div><div class="opt-name">Dark Mode</div><div class="opt-desc">Deep dark, easy on the eyes</div></div>'+
          '<label class="sw"><input type="checkbox" id="dark-sw" '+(isDark?'checked':'')+' ><span class="sw-sl"></span></label>'+
        '</div>'+
      '</div>'+
      '<div class="ss2"><h3>Accent color</h3>'+
        '<div class="opt-desc" style="margin-bottom:12px">Pick the accent used across buttons, highlights, and the AMV mark.</div>'+
        '<div class="accent-picker">'+
          ACCENT_THEMES.map(a=>{
            const cur=(loadStr('amv_accent')||'')===a.id;
            return '<button class="accent-sw'+(cur?' on':'')+'" data-accent="'+a.id+'" title="'+a.name+'" style="background:'+a.dot+'"></button>';
          }).join('')+
        '</div>'+
      '</div>'+
      '<div class="ss2"><h3>Font size</h3>'+
        '<div class="opt-desc" style="margin-bottom:14px">Scales the text everywhere so it\u2019s comfortable for you.</div>'+
        '<div class="fs-row">'+fsBtn(13,'Small')+fsBtn(14,'Default')+fsBtn(16,'Large')+fsBtn(18,'Largest')+'</div>'+
      '</div>'+
      '<div class="ss2"><h3>Motion</h3>'+
        '<div class="br2"><div><div class="opt-name">Reduce animation</div><div class="opt-desc">Minimize motion in streaming responses and interface elements.</div></div>'+
          '<label class="sw"><input type="checkbox" id="motion-sw" '+(loadStr('amv_reduce_motion')==='1'?'checked':'')+'><span class="sw-sl"></span></label>'+
        '</div>'+
      '</div>'+
      /* THE CHIME SAID IT WAS MUTEABLE AND NOTHING COULD MUTE IT.
         _playDoneChime checks `amv_mute_chime === '1'` and its own comment
         calls the sound "respectful - muteable", but no screen anywhere ever
         wrote that key, so the check could never be true. A sound the person
         cannot switch off is not respectful, and the code claiming otherwise
         is the reason nobody noticed. Here is the switch. */
      '<div class="ss2"><h3>Sound</h3>'+
        '<div class="br2"><div><div class="opt-name">Completion chime</div><div class="opt-desc">A soft two-note sound when a long reply finishes, or when one finishes while you are in another tab.</div></div>'+
          '<label class="sw"><input type="checkbox" id="chime-sw" '+(loadStr('amv_mute_chime')==='1'?'':'checked')+'><span class="sw-sl"></span></label>'+
        '</div>'+
        /* Read-aloud already read `amv_voice_rate` and nothing could write it,
           so every voice was locked to 1.0x. Speaking speed is the setting
           people using read-aloud change first. */
        /* `for` on a real <label>, not a styled div. A select whose only
           visible name is a sibling div has no accessible name at all - a
           screen reader announces it as "combo box", and the mobile sweep is
           right to fail on it. */
        '<div class="br2" style="margin-top:12px"><div><label class="opt-name" for="voice-rate-sel">Read-aloud speed</label><div class="opt-desc" id="voice-rate-desc">How fast AMV speaks when you use read-aloud.</div></div>'+
          '<select class="sel" id="voice-rate-sel" aria-describedby="voice-rate-desc" style="max-width:150px">'+
            [['0.75','Slower'],['1','Normal'],['1.25','Faster'],['1.5','Fastest']]
              .map(o=>'<option value="'+o[0]+'"'+((loadStr('amv_voice_rate')||'1')===o[0]?' selected':'')+'>'+o[1]+'</option>').join('')+
          '</select>'+
        '</div>'+
      '</div>';
    on($('motion-sw'),'change',function(){ saveStr('amv_reduce_motion',this.checked?'1':'0'); _applyReduceMotion(); toast(this.checked?'Reduced motion on':'Reduced motion off','info',2000); });
    /* Checked means the chime is ON, so the stored key is the inverse - it is
       named for muting because that is what the player already reads. */
    on($('chime-sw'),'change',function(){
      saveStr('amv_mute_chime',this.checked?'0':'1');
      if(this.checked){ try{ _playDoneChime(); }catch(e){} }
      toast(this.checked?'Completion chime on':'Completion chime off','info',2000);
    });
    on($('voice-rate-sel'),'change',function(){
      saveStr('amv_voice_rate', this.value);
      /* Spoken back at the new speed, because a number in a dropdown means
         nothing until you hear it. */
      try{ if(typeof AMVSpeech!=='undefined' && AMVSpeech.speak) AMVSpeech.speak('Reading at this speed.'); }catch(e){}
    });
    on($('dark-sw'),'change',function(){ document.body.classList.toggle('light',!this.checked); saveStr('amv_theme',this.checked?'dark':'light'); });
    pane.querySelectorAll('[data-accent]').forEach(sw=>on(sw,'click',()=>{
      applyAccent(sw.dataset.accent);
      pane.querySelectorAll('.accent-sw').forEach(x=>x.classList.toggle('on',x===sw));
    }));
    pane.querySelectorAll('[data-fs]').forEach(btn=>on(btn,'click',()=>setFontSize(parseInt(btn.dataset.fs,10))));

  } else if(sp==='language'){
    const cur=_lang();
    pane.innerHTML=
      '<div class="set-title">Language</div>'+
      '<div class="set-sub">Choose the language for AMV\u2019s responses and the content it generates - chat replies, images, video, and 3D models will all use it. You can still ask for any other language inside a message.</div>'+
      /* The app's own text is translated too, but that half needs the engine.
         Without it a handful of common labels come from a built-in dictionary
         and the rest stays English - which is what somebody switching language
         actually sees, so it is said here rather than discovered. */
      (_aiBackendReady()
        ? '<div class="ss2"><h3>The app itself</h3><p style="font-size:13px;color:var(--mu);line-height:1.65;margin:0">'+
          'Every screen - chat, images, video, Studio, Dev, Lab, the marketplace, settings - switches with it. '+
          'The first screen you open in a new language takes a moment to come across, then it is remembered.</p></div>'
        : '<div class="ss2"><h3>The app itself</h3><p style="font-size:13px;color:var(--mu);line-height:1.65;margin:0">'+
          'AMV\u2019s replies will be in your language straight away. Translating <b>the app\u2019s own screens</b> '+
          'needs the AMV engine connected - until then the common labels change and the rest stays in English '+
          'rather than being half-translated into something confusing.</p></div>')+
      '<div class="ss2"><h3>Response language</h3>'+
        '<div class="lang-grid">'+
          Object.entries(LANGS).map(([code,l])=>
            '<button class="lang-opt'+(code===cur?' on':'')+'" data-lang="'+code+'">'+
              '<span class="lang-native">'+l.native+'</span>'+
              '<span class="lang-name">'+(code==='auto'?l.native2:l.name)+'</span>'+
              (code===cur?'<span class="lang-check">\u2713</span>':'')+
            '</button>'
          ).join('')+
        '</div>'+
      '</div>'+
      '<div class="ss2"><h3>How it works</h3>'+
        '<div class="lang-info">'+
          '<p>\u2022 <b>Auto-detect</b> replies in whatever language you write in.</p>'+
          '<p>\u2022 Pick a language and every reply, plus text inside generated images, videos and models, comes back in it.</p>'+
          '<p>\u2022 Override anytime - e.g. \u201cmake me a poster, but in Chinese\u201d - and AMV follows that request just for that task.</p>'+
          '<p>\u2022 Not listed? AMV speaks 95+ languages - just write to it in yours and it responds in kind.</p>'+
        '</div>'+
      '</div>';
    pane.querySelectorAll('[data-lang]').forEach(btn=>on(btn,'click',()=>{
      saveStr('amv_lang',btn.dataset.lang);
      // re-render the whole app UI, then translate - so nav, top bar, new-chat,
      // and every dynamic label switch language immediately (and revert cleanly).
      try{ _i18nRoots().forEach(r=>_restoreI18nDOM(r)); }catch(e){}
      try{ updateSbUser(); }catch(e){}
      try{ setTab(S.tab); }catch(e){}
      _translateUI();
      setTimeout(_translateUI, 60);
      toast('Language set to '+(btn.dataset.lang==='auto'?'Auto-detect':_langName(btn.dataset.lang)),'success');
      renderSettingsView();
      setTimeout(()=>{ try{ _translateUI(); }catch(e){} }, 120);
    }));

  } else if(sp==='dashboard'){
    pane.innerHTML=
      '<div class="set-title">Founder Dashboard</div>'+
      '<div class="set-sub">Live platform spend, users, revenue, and abuse signals. Operator-only.</div>'+
      '<div id="fd-body"><div class="fd-loading">Loading platform stats\u2026</div></div>'+
      '<div id="fd-digest-host"></div>'+
      '<div class="fd-token-row"><input id="fd-token" type="password" autocomplete="off" placeholder="Admin token" class="inp" style="max-width:240px"/>'+
        '<button class="btn bp" id="fd-load" style="font-size:12px">Load stats</button></div>'+
      '<div class="fd-note">Your admin token is set as the ADMIN_TOKEN secret on your Worker. It\u2019s never stored - paste it here each session.</div>';
    // Pre-fill from the session holder so the operator pastes it once per tab
    // rather than once per screen. Still never written to this device.
    try{ const t0=(typeof _adminToken==='function')?_adminToken():''; if(t0 && $('fd-token')) $('fd-token').value=t0; }catch(e){}
    const loadStats=async()=>{
      const tok=($('fd-token')&&$('fd-token').value||'').trim();
      try{ if(tok && typeof _setAdminToken==='function') _setAdminToken(tok); }catch(e){}
      const base=loadStr('amv_api_base')||'';
      const body=$('fd-body');
      if(!base){ body.innerHTML='<div class="fd-empty">Connect your backend first (Settings \u2192 Live/Backend) to see platform stats.</div>'; return; }
      if(!tok){ body.innerHTML='<div class="fd-empty">Enter your admin token above and press Load stats.</div>'; return; }
      body.innerHTML='<div class="fd-loading">Loading\u2026</div>';
      try{
        const r=await fetchDeadline(base.replace(/\/$/,'')+'/v1/admin/stats',{headers:{'Authorization':'Bearer '+tok}},15000);
        if(!r.ok){ body.innerHTML='<div class="fd-empty">'+(r.status===403?'Invalid admin token.':'Could not load stats ('+r.status+').')+'</div>'; return; }
        const d=await r.json();
        body.innerHTML=_founderDashHTML(d);
        /* Rendered once, into its own host. It used to be appended to the
           stats body, so the pane's own delayed reload rebuilt it and wiped a
           preview the operator was in the middle of reading. */
        const dh=$('fd-digest-host');
        if(dh && !dh.firstChild){ dh.innerHTML=_payoutCardHTML()+_digestCardHTML(); _wireDigestCard(); _loadPayouts(); }
        // wire kill switch
        const kbtn=$('fd-kill');
        /* THE PLATFORM KILL SWITCH, and its answer was thrown away.

           A rejected admin token, or any error, resolved exactly like a
           success: nothing was said, loadStats() repainted the button in its
           old state, and the operator - who has just been asked "Pause the
           ENTIRE service for all users?" and said yes - is looking at a screen
           that reports the service is still live with no indication that is
           because their instruction did not land. The one control you press
           during a spend emergency is the last one that may report an outcome
           it did not check. */
        if(kbtn) on(kbtn,'click',async()=>{
          const turnOn=!d.spend.killed;
          if(!confirm(turnOn?'Pause the ENTIRE service for all users?':'Resume the service?')) return;
          const wasLabel=kbtn.textContent;
          kbtn.disabled=true; kbtn.textContent=turnOn?'Pausing…':'Resuming…';
          try{
            const kr=await fetchDeadline(base.replace(/\/$/,'')+'/v1/admin/kill',{method:'POST',headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({on:turnOn})},15000);
            const kd=await kr.json().catch(()=>({}));
            if(!kr.ok || kd.error){
              toast((kr.status===403?'That admin token was rejected. ':(kd.error?kd.error+' ':''))+
                    (turnOn?'The service is STILL RUNNING and still spending.':'The service is still paused.'),'error',9000);
              kbtn.disabled=false; kbtn.textContent=wasLabel; return;
            }
            toast(turnOn?'Service paused for all users.':'Service resumed.','success',4000);
          }catch(e){
            toast('Could not reach the backend, so nothing changed. '+
                  (turnOn?'The service is STILL RUNNING and still spending.':'The service is still paused.'),'error',9000);
            kbtn.disabled=false; kbtn.textContent=wasLabel; return;
          }
          kbtn.disabled=false;
          loadStats();
        });
      }catch(e){ body.innerHTML='<div class="fd-empty">Network error loading stats.</div>'; }
    };
    on($('fd-load'),'click',loadStats);
    setTimeout(loadStats,100);

  } else if(sp==='backend'){
    const liveBase=loadStr('amv_api_base')||'';
    const tokenSet=!!(loadStr('amv_api_token'));
    pane.innerHTML=
      '<div class="set-title">Live / Backend</div>'+
      '<div class="set-sub">Connect AMV to your deployed backend so Crew jobs, approvals and Handoff work for real and across accounts. Leave blank to run in local demo mode.</div>'+
      '<div class="ss2"><h3>Backend URL</h3>'+
        '<div style="display:flex;gap:8px"><input type="url" id="be-url" value="'+escH(liveBase)+'" placeholder="https://amv-ai-backend.your.workers.dev" style="flex:1;font-size:12px"><button class="btn bp" style="font-size:12px" onclick="amvSaveBackend()">Save</button></div>'+
        '<p style="font-size:11px;color:var(--mu);margin-top:8px">'+(liveBase?('Status: <span style="color:#4ade80">configured</span>'+(tokenSet?' &middot; signed in':' &middot; not signed in')):'Status: local demo mode')+'</p>'+
      '</div>'+
      '<div class="ss2" style="margin-top:14px"><h3>Sign in to backend</h3>'+
        '<p style="font-size:12px;color:var(--mu);margin:-4px 0 10px">Sign in with your AMV account email and password to sync this device. To use Google, sign in with Google on the main sign-in screen - it is verified server-side.</p>'+
        '<div style="display:flex;flex-direction:column;gap:8px"><input type="email" id="be-email" value="'+escH((S.user&&S.user.email)||'')+'" placeholder="you@email.com" style="font-size:12px" autocomplete="username"><div style="display:flex;gap:8px"><input type="password" id="be-pass" placeholder="Your password" style="flex:1;font-size:12px" autocomplete="current-password"><button class="btn bp" style="font-size:12px" onclick="amvBackendLogin()">Connect</button></div></div>'+
      '</div>';
  } else if(sp==='apikeys'){
    const liveBase=loadStr('amv_api_base')||'';
    const connected=!!(window.AMV_API && AMV_API.live);
    pane.innerHTML=
      '<div class="set-title">AI Connection</div>'+
      '<div class="set-sub">AMV runs on your secure backend. The AI key lives <b>only on your server</b> - never in the browser - so usage, billing, and limits are always enforced and can never be bypassed.</div>'+
      '<div class="conn-status '+(connected?'ok':'off')+'" id="conn-status">'+
        '<span class="conn-dot"></span>'+(connected?'Connected - AMV is ready':'Not connected - add your backend URL below')+
      '</div>'+
      '<div class="ss2"><h3>Backend URL</h3>'+
        '<div class="sf"><div><label class="lbl">Your AMV Worker URL</label><input type="text" id="s-base" value="'+escH(liveBase)+'" placeholder="https://amv-backend.yourname.workers.dev" style="font-family:var(--mn);font-size:12px"></div>'+
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
          '<button class="btn bp" id="save-base" style="font-size:12px">Save &amp; connect</button>'+
          '<button class="btn" id="test-base" style="font-size:12px">Test connection</button>'+
        '</div>'+
        '<div id="test-result" class="conn-test"></div></div>'+
      '</div>'+
      '<div class="ss2"><h3>Where does the AI key go?</h3>'+
        '<p style="font-size:12.5px;color:var(--mu);line-height:1.6;margin:0">Set your Anthropic key as a secret on the Worker - it never touches the browser:</p>'+
        '<pre style="background:var(--surface);border:1px solid var(--hair);border-radius:8px;padding:10px;font-size:11.5px;overflow:auto;margin:8px 0 0"><code>wrangler secret put AMV_MODEL_KEY</code></pre>'+
        '<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" class="conn-link">Get an Anthropic key \u2192</a>'+
      '</div>';
    on($('save-base'),'click',()=>{
      const v=($('s-base')?.value||'').trim().replace(/\/$/,'');
      if(!v){ toast('Enter your backend URL first','error'); return; }
      if(!/^https:\/\//i.test(v)){ toast('Backend URL must start with https://','error'); return; }
      saveStr('amv_api_base',v); if(window.AMV_API) AMV_API.base=v;
      const b=$('save-base'); if(b){b.textContent='Saved!';b.style.background='var(--green)';setTimeout(()=>{b.textContent='Save & connect';b.style.background='';},1500);}
      updateSbUser&&updateSbUser();
      toast('Backend saved - sign in to activate','success');
    });
    on($('test-base'),'click',async ()=>{
      const v=($('s-base')?.value||'').trim().replace(/\/$/,''); const out=$('test-result');
      if(!v){ toast('Enter a URL to test','error'); return; }
      if(out){ out.className='conn-test testing'; out.textContent='Testing\u2026'; }
      try{
        /* A request this page is not ALLOWED to make fails the same way one
           that times out does, and "check it's deployed and correct" then
           sends the operator to debug a Worker that is working.

           connect-src permits 'self' and *.workers.dev. The documented deploy
           is a workers.dev URL, so the normal path is fine - but putting the
           Worker behind a custom domain, which is the obvious next step for
           anybody who owns one, is blocked by the page's own policy. That is
           not something you would ever guess from "could not reach". So the
           violation is listened for and named. */
        let _csp=null;
        const _onCsp=(e)=>{ try{ if(String(e.blockedURI||'').indexOf(_originOf(v))===0) _csp=e; }catch(_){ _csp=e; } };
        document.addEventListener('securitypolicyviolation',_onCsp);
        let r;
        try{
          // 10s: a backend that has not answered by then is not "reachable",
          // and the user is sitting in front of a button that says Testing.
          r=await fetchDeadline(v+'/v1/health',{method:'GET'},10000);
        } finally { document.removeEventListener('securitypolicyviolation',_onCsp); }
        if(_csp){
          if(out){ out.className='conn-test err';
            out.textContent='\u2717 This page is not allowed to call that address. Its Content-Security-Policy permits your own origin and *.workers.dev - a Worker on a custom domain has to be added to connect-src in index.html before the browser will let AMV reach it. The Worker itself may be perfectly fine.'; }
          return;
        }
        if(r.ok){ const d=await r.json().catch(()=>({})); if(out){out.className='conn-test ok';out.textContent=d.ok?'\u2713 Backend is healthy and reachable.':'\u2713 Reachable.';} saveStr('amv_api_base',v); if(window.AMV_API) AMV_API.base=v; const cs=$('conn-status'); if(cs){cs.className='conn-status ok';cs.innerHTML='<span class="conn-dot"></span>Backend reachable - sign in to activate';} }
        else{ if(out){out.className='conn-test err';out.textContent='\u2717 Backend responded with '+r.status+'. Check the URL.';} }
      }catch(err){ if(out){out.className='conn-test err';out.textContent='\u2717 Could not reach that URL. Check it\u2019s deployed and correct.';} }
    });

  } else if(sp==='widget'){
    _renderWidgetPane(pane);

  } else if(sp==='platform'){
    pane.innerHTML=
      '<div class="set-title">Platform &amp; Stripe</div>'+
      '<div class="set-sub">Configure revenue collection and deployment.</div>'+
      (!S.sp&&!S.se?'<div class="wb">&#9888; Add your Stripe payment links to start collecting revenue.</div>':'')+
      '<div class="ss2"><h3>Stripe - card, Apple Pay &amp; Google Pay</h3>'+
        '<p style="font-size:12px;color:var(--mu);margin-bottom:11px;line-height:1.6">The startup standard. Create a Payment Link at stripe.com &rarr; Payments &rarr; Payment Links. <b>Apple Pay and Google Pay appear automatically inside Stripe\u2019s checkout</b> - no extra setup. Clicking &ldquo;Card / Apple Pay&rdquo; opens your real Stripe checkout. Revenue goes straight to your Stripe account. Set each link\u2019s success URL to <code>yoursite.com/?paid=pro</code> (or <code>elite</code>) so the plan activates on return.</p>'+
        '<div class="sf">'+
          '<div><label class="lbl">Pro Plan - $'+PLANS.pro.price+'/month</label><input type="url" id="s-sp" value="'+escH(S.sp||'')+'" placeholder="https://buy.stripe.com/…"></div>'+
          '<div><label class="lbl">Elite Plan - $'+PLANS.elite.price+'/month</label><input type="url" id="s-se" value="'+escH(S.se||'')+'" placeholder="https://buy.stripe.com/…"></div>'+
          '<div><label class="lbl">Stripe Customer Portal (subscription management)</label><input type="url" id="s-portal" value="'+escH(loadStr('amv_portal'))+'" placeholder="https://billing.stripe.com/p/…"></div>'+
          '<button class="btn bp" id="save-stripe" style="align-self:flex-start;font-size:12px">Save Stripe Links</button>'+
        '</div>'+
      '</div>'+
      '<div class="ss2"><h3>Support email</h3>'+
        '<p style="font-size:12px;color:var(--mu);margin-bottom:11px;line-height:1.6">The address your users reach you at. Once set, the <b>&ldquo;Email Support&rdquo;</b> buttons across the app (Help Center, About, legal) open a pre-filled email to this address. Leave blank and those buttons fall back to <b>&ldquo;Ask AMV directly&rdquo;</b> - never a broken link.</p>'+
        '<div class="sf">'+
          '<div><label class="lbl">Support email address</label><input type="email" id="s-support" value="'+escH(_supportEmail())+'" placeholder="support@yourdomain.com" autocomplete="off"></div>'+
          '<button class="btn bp" id="save-support" style="align-self:flex-start;font-size:12px">Save support email</button>'+
        '</div>'+
      '</div>'+
      '<div class="ss2"><h3>In-app card field (optional)</h3>'+
        '<p style="font-size:12px;color:var(--mu);margin-bottom:11px;line-height:1.6">Prefer the card form inside AMV instead of redirecting? Add your Stripe <b>publishable</b> key (starts with <code>pk_</code>) to enable Stripe Elements - the card field is an isolated Stripe iframe, so card numbers never touch AMV. <b>Never paste a secret (sk_) key.</b></p>'+
        '<div class="sf">'+
          '<div><label class="lbl">Stripe publishable key</label><input type="text" id="s-pk" value="'+escH(loadStr('amv_stripe_pk'))+'" placeholder="pk_live_…" style="font-family:var(--mn);font-size:12px"></div>'+
          '<button class="btn bp" id="save-pk" style="align-self:flex-start;font-size:12px">Save key</button>'+
        '</div>'+
      '</div>'+
      '<div class="ss2"><h3>PayPal &amp; Venmo</h3>'+
        /* There was a "PayPal client ID" box here, and pasting a real one into
           it did nothing at all. PayPal runs on the SERVER - the Worker holds
           PAYPAL_CLIENT_ID and PAYPAL_SECRET and creates the subscription
           itself, because a browser cannot be trusted to state a price or
           confirm a capture. The box was left over from a browser-side SDK
           flow that had to be removed for exactly that reason, and it read as
           the switch that turns PayPal on. */
        '<p style="font-size:12px;color:var(--mu);margin-bottom:11px;line-height:1.6">PayPal and Venmo subscriptions are switched on with Worker secrets, not here: set <b>PAYPAL_CLIENT_ID</b>, <b>PAYPAL_SECRET</b> and <b>PAYPAL_WEBHOOK_ID</b> on your backend and the real PayPal checkout turns on for everyone. The links below are an optional fallback for a deployment with no backend connected - a hosted PayPal or Venmo page that takes the payment instead.</p>'+
        '<div class="sf">'+
          '<div><label class="lbl">PayPal hosted link (optional fallback)</label><input type="url" id="s-ppl" value="'+escH((_payCfg().paypalLink)||'')+'" placeholder="https://www.paypal.com/…"></div>'+
          '<div><label class="lbl">Venmo hosted link (optional fallback)</label><input type="url" id="s-vml" value="'+escH((_payCfg().venmoLink)||'')+'" placeholder="https://venmo.com/…"></div>'+
          '<button class="btn bp" id="save-wallets" style="align-self:flex-start;font-size:12px">Save PayPal / Venmo</button>'+
        '</div>'+
      '</div>'+
      /* AMV-084: this list used to be assembled in the browser, which cannot
         see a single Worker secret - three rows were hardcoded to "not set up"
         and the AI row reported whether THIS BROWSER had a session, which says
         nothing about whether the server holds a key. It is now read from the
         server, which is the only thing that knows. */
      '<div class="ss2" style="background:rgba(35,209,139,.04);border-color:rgba(35,209,139,.15)"><h3 style="color:var(--green)">Go-Live status - what is actually switched on</h3>'+
        '<p style="font-size:12px;color:var(--mu);margin:-4px 0 14px;line-height:1.6">Read from your Worker, not guessed here. Each line says what it turns on and how to set it. Values are never shown - only whether a secret exists.</p>'+
        '<div class="golive" id="golive-body"><div class="fd-loading">Checking your deployment\u2026</div></div>'+
      '</div>';
    setTimeout(_loadReadiness, 0);
    on($('save-stripe'),'click',()=>{
      const sp=$('s-sp')?.value.trim(),se=$('s-se')?.value.trim(),portal=$('s-portal')?.value.trim();
      if(sp!==undefined){S.sp=sp;saveStr('amv_sp',sp);}if(se!==undefined){S.se=se;saveStr('amv_se',se);}
      saveStr('amv_portal',portal||'');
      store('amv_pay_links',{pro:sp||'',elite:se||''});
      const b=$('save-stripe');if(b){b.textContent='Saved!';b.style.background='var(--green)';setTimeout(()=>{b.textContent='Save Stripe Links';b.style.background='';},1500);}
      toast('Stripe links saved','success');
    });
    on($('save-support'),'click',()=>{
      const addr=$('s-support')?.value.trim()||'';
      if(addr && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)){ toast('Enter a valid email address (or leave blank).','error',4000); return; }
      saveStr('amv_support_email',addr);
      const b=$('save-support');if(b){b.textContent='Saved!';b.style.background='var(--green)';setTimeout(()=>{b.textContent='Save support email';b.style.background='';},1500);}
      toast(addr?('Support email set to '+addr):'Support email cleared - buttons now route to Ask AMV','success',4000);
    });
    on($('save-pk'),'click',()=>{
      const pk=$('s-pk')?.value.trim()||'';
      /* The secret-key case is checked FIRST because it was unreachable: an
         sk_ key is also "not a pk_ key", so the generic message returned above
         it every time and the one warning that matters never appeared. Being
         told "it must start with pk_" reads as "find a different key"; being
         told you have just pasted a secret reads as "go and rotate it". */
      if(/^sk_/.test(pk)){
        toast('That is a SECRET key (sk_). Never paste one anywhere in a browser - treat it as exposed and roll it in your Stripe dashboard. Use the publishable key (pk_) here.','error',9000);
        const el=$('s-pk'); if(el) el.value='';
        return;
      }
      if(pk && !/^pk_(test|live)_/.test(pk)){ toast('That is not a publishable key. It must start with pk_','error',4000); return; }
      saveStr('amv_stripe_pk',pk);
      const b=$('save-pk');if(b){b.textContent='Saved!';b.style.background='var(--green)';setTimeout(()=>{b.textContent='Save key';b.style.background='';},1500);}
      toast(pk?'Secure card field enabled':'Key cleared','success');
    });
    on($('save-wallets'),'click',()=>{
      const cfg=_payCfg();
      cfg.paypalLink=$('s-ppl')?.value.trim()||'';
      cfg.venmoLink=$('s-vml')?.value.trim()||'';
      /* A client id stored here from an older build would keep being read back
         into a field that no longer exists, so it goes with the field. */
      delete cfg.paypalClientId;
      store('amv_pay_cfg',cfg);
      const b=$('save-wallets');if(b){b.textContent='Saved!';b.style.background='var(--green)';setTimeout(()=>{b.textContent='Save PayPal / Venmo';b.style.background='';},1500);}
      toast('PayPal & Venmo saved','success');
    });

  } else if(sp==='usage'){
    pane.innerHTML=
      '<div class="set-title">Usage</div>'+
      '<div class="set-sub">Your current usage this window, activity, and the impact AMV has had for you.</div>'+
      _usageContentHTML();
    // wire upgrade buttons inside the pane
    pane.querySelectorAll('[data-stab]').forEach(b=>on(b,'click',()=>{ S.tab='plans'; setTab('plans'); }));

  } else if(sp==='integrations'){
    pane.innerHTML =
      '<div class="set-title">Connectors</div>'+
      '<div class="set-sub">Connect AMV to your tools. <b style="color:var(--tx)">Autonomous</b> ones work in the background once connected; <b style="color:var(--tx)">manual</b> ones you trigger or upload to. Click Connect - you approve in a popup, no keys to paste.</div>'+
      _integrationsCatalogHTML();
    _wireIntegrationCatalog(pane);
    _killTokenAutofill();
  } else if(sp==='skills'){
    _renderSkillsPane(pane);
  } else if(sp==='capabilities'){
    const cap=(icon,title,desc)=>'<div class="cap-item"><span class="cap-ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+icon+'</svg></span><div><div class="cap-t">'+escH(title)+'</div><div class="cap-d">'+escH(desc)+'</div></div></div>';
    const capToggle=(id,title,desc,on)=>'<div class="prv-pref"><div><div class="prv-pref-t">'+escH(title)+'</div><div class="prv-pref-s">'+escH(desc)+'</div></div><label class="sw"><input type="checkbox" id="'+id+'" '+(on?'checked':'')+'><span class="sw-sl"></span></label></div>';
    pane.innerHTML=
      '<div class="set-title">Capabilities</div>'+
      '<div class="set-sub">Everything AMV can do for you - and the switches you control.</div>'+
      '<div class="ss2"><h3>What AMV can do</h3>'+
        '<div class="cap-grid">'+
          cap('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>','Chat & reasoning','Ask anything, think through problems, get clear answers with sources.')+
          cap('<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>','Build & run code','Full-stack apps, scripts and APIs - written, run, and previewed live in Dev.')+
          cap('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>','Images & video','Generate photoreal images and video from a single line of description.')+
          cap('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>','Web search','Pull live information from the web and cite it in answers.')+
          cap('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>','Agents & Crew','Delegate multi-step jobs that run in the background and report back.')+
          cap('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>','Automations','Schedule recurring work - daily briefs, monitoring, reports - hands-free.')+
          cap('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M3 9h6"/>','Design & docs','Slides, spreadsheets, documents and designs on a live canvas.')+
          cap('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/>','Connectors','Link Gmail, Drive, Calendar, GitHub and more to work with your tools.')+
        '</div>'+
      '</div>'+
      '<div class="ss2"><h3>Controls</h3>'+
        capToggle('cap-websearch','Web search','Let AMV look things up online when it helps answer your question.', loadStr('amv_cap_websearch')!=='0')+
        capToggle('cap-memory','Memory','Let AMV remember useful facts about you across chats.', loadStr('amv_cap_memory')!=='0')+
        capToggle('cap-suggestions','Interactive answer blocks','Let AMV add tappable choices, stat cards, and step lists inside answers.', loadStr('amv_cap_suggestions')!=='0')+
      '</div>';
    on($('cap-websearch'),'change',function(){ saveStr('amv_cap_websearch',this.checked?'1':'0'); toast(this.checked?'Web search on':'Web search off','info',2000); });
    on($('cap-memory'),'change',function(){ saveStr('amv_cap_memory',this.checked?'1':'0'); toast(this.checked?'Memory on':'Memory off','info',2000); });
    on($('cap-suggestions'),'change',function(){ saveStr('amv_cap_suggestions',this.checked?'1':'0'); toast(this.checked?'Suggestions on':'Suggestions off','info',2000); });
  } else if(sp==='spending'){
    /* Rendered from 25-money-family-ui.js - see there for why these two panes
       exist at all (the logic shipped with no way for anyone to reach it). */
    _renderSpendingPane(pane);
  } else if(sp==='investing'){
    _renderInvestPane(pane);
  } else if(sp==='teamset'){
    _renderTeamSettingsPane(pane);
  } else if(sp==='family'){
    _renderFamilyPane(pane);
  } else if(sp==='api'){
    /* Rendered from 30-api-keys.js. */
    _renderApiKeysPane(pane);
  } else if(sp==='invite'){
    /* Rendered from 27-referrals.js. */
    _renderInvitePane(pane);
  } else if(sp==='about'){
    pane.innerHTML=
      '<div class="set-title">About AMV.AI</div>'+
      '<div class="set-sub">Platform information and legal.</div>'+
      '<div class="ss2">'+
        '<div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">'+
          '<div class="logo-mark-lg ce-mark-sig" style="width:50px;height:50px;border-radius:var(--r-md);flex-shrink:0">'+amvMark(34)+'</div>'+
          /* Read from CHANGELOG, which is what What's New already shows. Written
             out, this said "Version 2.0 - 2025" while the release notes one
             screen away listed 2.4, and the year had been wrong since January.
             A version number in two places is two version numbers. */
          '<div><div style="font-size:17px;font-weight:800;letter-spacing:-.4px">AMV<span style="color:var(--accent)">.</span>AI</div><div style="font-size:11px;color:var(--t2);margin-top:2px">Version '+escH(_latestVersion()||'2.0')+' &bull; '+new Date().getFullYear()+'</div></div>'+
        '</div>'+
        '<p style="font-size:12px;color:var(--t2);line-height:1.65;margin-bottom:13px">Your AI workforce - it does the work, not just answers it. Chat, agents, builds, images, video, and automation in one place.</p>'+
        '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
          '<button class="btn bs" style="font-size:12px" onclick="openTerms()">Terms of Service</button>'+
          '<button class="btn bs" style="font-size:12px" onclick="openPrivacy()">Privacy Policy</button>'+
          supportButton({label:'Contact Support',cls:'btn bs',subject:'AMV Support request'})+
        '</div>'+
      '</div>'+
      /* The third copy, and the one that was hardest to notice was stale: it
         listed six of the twelve bindings and printed Ctrl on a Mac. Rendered
         from _SHORTCUTS, so it cannot fall behind the keys that actually work. */
      '<div class="ss2"><h3>Keyboard Shortcuts</h3>'+
        '<div style="display:flex;flex-direction:column;gap:0">'+
          _shortcutRowsHTML()+
        '</div>'+
      '</div>'+
      (S.user?'<div class="ss2" style="border-color:rgba(255,95,87,.2)"><h3 style="color:var(--red)">Sign Out</h3><p style="font-size:12px;color:var(--t2);margin-bottom:12px">Your data remains saved and will be restored on next sign in.</p><button class="btn bd2" onclick="signOut()" style="font-size:12px">Sign out</button></div>':'');
  } else {
    pane.innerHTML='';
  }
}
function setFontSize(px){
  // The app uses fixed px sizes throughout, so a root font-size change alone
  // does nothing. Scale the whole interface proportionally with `zoom`
  // (text + spacing), which is what visibly changes the size for the user.
  const scale = px/14;                 // 14 = default
  _applyZoom(scale);
  saveStr('amv_fs', px);
  try{ if(S.tab==='settings' && S.settingsPane==='appearance') renderSetPane(); }catch(e){}
}
function _applyZoom(scale){
  /* Font size used to zoom #app. But #app is height:100vh - zooming it to
     1.29x made it 129vh tall, so the BOTTOM of the app (the composer / text box)
     fell off the screen and you literally couldn't type. Verified: at "Largest"
     the app overflowed by 229px at 800px tall.

     Fix: scale the TEXT, not the container. We set a root font scale and let the
     layout keep filling exactly 100vh, so every control stays reachable at any
     size. */
  const app=document.getElementById('app');
  const land=document.getElementById('land');
  [app,land].forEach(el=>{ if(!el) return;
    el.style.zoom='';
    el.style.transform='';
    el.style.width='';
  });
  const root=document.documentElement;
  if(!scale || Math.abs(scale-1) < 0.001){
    root.style.removeProperty('--fs-scale');
    root.classList.remove('fs-scaled');
  } else {
    root.style.setProperty('--fs-scale', String(scale));
    root.classList.add('fs-scaled');
  }
}
function _applyFontSize(){ const px=parseInt(loadStr('amv_fs')||'14',10); if(px&&px!==14){ _applyZoom(px/14); } }
/* THERE WERE THREE LISTS OF KEYBOARD SHORTCUTS AND NO TWO AGREED.

   This one was hand-written and wrong in two ways that matter. It said
   "Search chats - Ctrl K", and Ctrl/Cmd+K opens the COMMAND PALETTE, which is
   a different thing; and it printed Ctrl on a Mac, where every one of these is
   Cmd. It also missed Ctrl+/, ?, Ctrl+Shift+D and Ctrl+Shift+V, all of which
   are bound.

   _SHORTCUTS in 16-palette-sched.js is the real list - grouped, complete, and
   platform-aware. This opens that, so the button in the sidebar and the ? key
   show the same thing, and there is one place to edit when a binding changes. */
function openShortcuts(){
  try{ return openShortcutSheet(); }catch(e){}
}
window.openShortcuts=openShortcuts;

function setupLanding(){
  try{ if(!sessionStorage.getItem('amv_visit_marked')){ sessionStorage.setItem('amv_visit_marked','1'); AEGIS.log('page',{name:'landing'}); } }catch(e){ try{ AEGIS.log('page',{name:'landing'}); }catch(_){} }
  on($('brand-land'),'click',()=>{ window.scrollTo(0,0); });
  on($('land-login'),'click',()=>{ hideIntro(); openAuth('login'); });
  on($('land-signup'),'click',()=>{ hideIntro(); openAuth('signup'); });
  on($('cta-btn'),'click',()=>openAuth('signup'));
  on($('hero-go'),'click',()=>openAuth('signup'));
  on($('hero-inp'),'keydown',e=>{if(e.key==='Enter')openAuth('signup');});
  on($('fp-btn'),'click',openTerms);
  on($('ft-btn'),'click',openTerms);
  on($('fc-btn'),'click',openTerms);
  // Fill landing pricing
  /* The landing page is where most pricing decisions actually get made, so
     Teams belongs here too - it was only on a tab you have to sign in to
     reach, which is a strange place to keep the plan worth ten times the
     others. Guarded on .cpb so a re-render does not stack duplicates. */
  const lp=$('land-pricing'); if(lp){ lp.classList.add('pg-4'); lp.innerHTML=planCards(false); if(lp.parentNode && !lp.parentNode.querySelector('.cpb')){ lp.insertAdjacentHTML('afterend', _teamPlanBanner(false) + _customPlanBanner(false)); } }
  // Hero tags
  const tags=[
    ['Research my competitors','Research my top 5 competitors and build a comparison table with pricing, positioning, and weaknesses'],
    ['Build me a landing page','Build me a complete landing page for my product with a hero, features, pricing, and a call to action'],
    ['Plan & run my week','Plan my week from my calendar, find conflicts, and block focus time'],
    ['Draft my emails','Read my inbox, rank what needs attention, and draft a reply for each'],
    ['Daily market brief','Every morning, brief me on overnight market moves and the 3 headlines that matter'],
    ['Design a brand','Design a brand identity - logo concept, colors, and a landing page in that style'],
    ['Build a working app','Build a complete, working web app and run it live'],
    ['Write & ship content','Write a week of social posts for X and LinkedIn, ready to publish'],
  ];
  const htags=$('htags');
  if(htags){
    tags.forEach(([label,q])=>{
      const btn=document.createElement('span');
      btn.className='htag'; btn.textContent=label;
      on(btn,'click',()=>{ const inp=$('hero-inp');if(inp)inp.value=q; openAuth('signup'); });
      htags.appendChild(btn);
    });
  }
  // Marquee
  const items=['Autonomous agents','Runs in the background','Builds real apps','Designs live','Researches deeply','Drafts your email','Plans your week','Connects Gmail & Drive','Hands off to teammates','Scheduled work','Multi-step tasks','Approval before sending','Live code sandbox','Brand & landing pages','Market briefs','Inbox triage'];
  const track=$('mtrack');
  if(track) track.innerHTML=[...items,...items].map(t=>'<div class="mitem"><div class="mdot"></div>'+t+'</div>').join('');
}

/* === APP SETUP === */
function setupApp(){
  // -- Icon Rail wiring --
  // Logo does nothing (avoids confusing "signout" feeling)
  on($('tsb'),'click',toggleSb); // tsb toggles hist-drawer
  on($('ncb'),'click',newChat);
  on($('theme-btn'),'click',function(){
    document.body.classList.toggle('light');
    saveStr('amv_theme',document.body.classList.contains('light')?'light':'dark');
  });
  on($('nav-av'),'click',function(e){ e.stopPropagation(); showProfMenu(this); });

  // All data-tab buttons in icon rail - includes the bottom-left tools row
  document.querySelectorAll('.snb[data-tab], .sb-tool[data-tab]').forEach(btn=>{
    on(btn,'click',()=>{ if(btn.dataset.tab) setTab(btn.dataset.tab); });
  });
  on($('hist-search'),'input',renderHist);
  on($('star-filter'),'click',()=>{ S.starFilter=!S.starFilter; $('star-filter').style.color=S.starFilter?'var(--gold)':''; renderHist(); });
  on($('sb-user-btn'),'click',()=>{ const p=$('sb-popup'); if(p) p.classList.toggle('on'); });
  on($('smi-settings'),'click',()=>{ $('sb-popup').classList.remove('on'); S.settingsPane='account'; setTab('settings'); });
  on($('smi-whatsnew'),'click',()=>{ $('sb-popup').classList.remove('on'); openWhatsNew(); });
  on($('smi-switch'),'click',()=>{ $('sb-popup').classList.remove('on'); openAuth('login'); });
  on($('smi-signout'),'click',()=>{ $('sb-popup').classList.remove('on'); signOut(); });

  /* The history drawer and the canvas button were replaced by the sidebar and
     the composer toolbar. Their handlers stayed, binding to elements that no
     longer exist - silently, which is exactly how the Admin tab became
     unreachable and went unnoticed for months. Removed rather than kept as
     no-ops that read like live wiring. */
  on($('kb-btn'),'click',()=>openShortcuts());
  // Sidebar user popup
  on($('sb-user-btn'),'click',function(e){ e.stopPropagation(); showProfMenu(this); });
  // Profile actions handled via showProfMenu dropdown
  // Star filter
  // Sidebar nav tabs
  document.querySelectorAll('.snb[data-tab]').forEach(btn=>{
    on(btn,'click',()=>{ if(btn.dataset.tab) setTab(btn.dataset.tab); });
  });
  // History search
  on($('hist-search'),'input',renderHist);
  // File input
  on($('fi'),'change',function(){ if(this.files.length) handleFiles(this.files); this.value=''; });
  // Global delegation for data-gs (go to settings pane) buttons
  document.addEventListener('click',e=>{
    const gs=e.target.closest('[data-gs]');
    if(gs) { e.stopPropagation(); goSettings(gs.dataset.gs); return; }
    const da=e.target.closest('[data-dact]');
    if(da) { e.stopPropagation(); const fn=da.dataset.dact,arg=da.dataset.darg; if(fn==='askAmv')askAmv(); else if(fn==='toastInfo')toastInfo(arg); else if(window[fn])window[fn](arg); return; }
    const st=e.target.closest('[data-stab]');
    if(st) { e.stopPropagation(); setTab(st.dataset.stab); return; }
    const au=e.target.closest('[data-auth]');
    if(au) { e.stopPropagation(); openAuth(au.dataset.auth); return; }
  });
  // Sidebar history context menu via delegation
  on($('hist'),'contextmenu',e=>{
    e.preventDefault();
    const item=e.target.closest('[data-cid]');
    if(item) showConvMenu(e, item.dataset.cid);
  });
  // History action buttons via delegation
  on($('hist'),'click',e=>{
    const btn=e.target.closest('[data-hact]');
    if(!btn) return;
    e.stopPropagation();
    const id=btn.dataset.hid, act=btn.dataset.hact;
    if(act==='star') starConv(id);
    else if(act==='rename') renameConv(id);
    else if(act==='del') deleteConv(id);
  });
  // Close popup on outside click
  document.addEventListener('click',e=>{
    const popup=$('sb-popup');
    if(popup&&popup.classList.contains('on')&&!popup.contains(e.target)&&e.target!=$('sb-user-btn')&&!$('sb-user-btn')?.contains(e.target)){
      popup.classList.remove('on');
    }
  });
}

/* === MISSING CRITICAL FUNCTIONS === */

/* -- Navigation helpers -- */
function goSettings(pane){ S.settingsPane=pane; setTab('settings'); }
function goToStripeSettings(){ closeOvr(); goSettings('platform'); }
function showMsg(msg){ toast(msg||'Configure in Settings.','info'); }
function askAmv(){ setTab('chat'); setTimeout(()=>{ const ta=document.getElementById('mta'); if(ta){ta.value='I need help with: ';ta.focus();} },150); }
/* In-app feedback: bug reports & feature suggestions. Stored locally and surfaced
   to the operator in the admin, and sent to a support email/endpoint if configured. */
function openFeedback(kind){
  kind=(kind==='idea')?'idea':'bug';
  const ovr=$('ovr'); if(!ovr) return;
  const isBug=kind==='bug';
  ovr.innerHTML=
    '<div class="fb-modal">'+
      '<div class="fb-title">'+(isBug?'Report a bug':'Suggest a feature')+'</div>'+
      '<p class="fb-sub">'+(isBug?'What went wrong? The more detail, the faster we can fix it.':'What would make AMV better for you?')+'</p>'+
      '<div class="fb-types"><button class="fb-type'+(isBug?' on':'')+'" data-fbk="bug">\uD83D\uDC1E Bug</button><button class="fb-type'+(!isBug?' on':'')+'" data-fbk="idea">\uD83D\uDCA1 Idea</button></div>'+
      '<textarea id="fb-text" class="inp" rows="5" placeholder="'+(isBug?'When I click\u2026 I expected\u2026 but instead\u2026':'It would be great if AMV could\u2026')+'"></textarea>'+
      '<input id="fb-email" class="inp" style="margin-top:10px" placeholder="Your email (optional - so we can follow up)" value="'+escH((S.user&&S.user.email)||'')+'">'+
      '<div class="fb-actions"><button class="btn bs" id="fb-cancel">Cancel</button><button class="btn bp" id="fb-send">Send feedback</button></div>'+
    '</div>';
  ovr.classList.add('on');
  let curKind=kind;
  ovr.querySelectorAll('[data-fbk]').forEach(b=>on(b,'click',()=>{ curKind=b.dataset.fbk; ovr.querySelectorAll('.fb-type').forEach(x=>x.classList.remove('on')); b.classList.add('on'); }));
  on($('fb-cancel'),'click',closeOvr);
  on($('fb-send'),'click',async ()=>{
    const text=($('fb-text')?$('fb-text').value:'').trim();
    if(!text){ $('fb-text')&&$('fb-text').focus(); return; }
    const btn=$('fb-send');
    if(btn){ btn.disabled=true; btn.textContent='Sending\u2026'; }
    const res=_submitFeedback(curKind, text, ($('fb-email')?$('fb-email').value.trim():''));

    /* IT SAID "SENT TO THE TEAM" AND NOTHING LEFT THE DEVICE.

       _submitFeedback wrote to localStorage and only transmitted if
       `amv_feedback_endpoint` was set - a key no screen in the product could
       write. /v1/feedback is the thumbs up/down counter, which deliberately
       stores no content and would have refused a sentence. So somebody
       reporting a broken payment was thanked, told the team had it, and their
       report sat in their own browser for ever.

       Saying so instead of lying was the first fix and left the real problem:
       a product taking money with no way to be told it is broken. /v1/support
       is that way. It answers what actually happened - stored, and separately
       whether it reached a person - so this can still only claim what is
       true. */
    let sent=null;
    try{ sent = await AMV_API.support(curKind, text, { plan: loadStr('amv_plan')||'free', tab: S.tab }); }
    catch(e){ sent = { error: e && e.message }; }
    closeOvr();

    if(sent && sent.ok && sent.notified){
      toast('Thank you - your report is with the team.','success',4000);
    } else if(sent && sent.ok){
      /* It IS on the server and an operator will see it in the inbox; what we
         cannot promise is that anybody was paged about it tonight. */
      toast('Thank you - your report was received.'+(_supportEmail()?' If it is urgent, email '+_supportEmail()+' as well.':''),'success',6000);
    } else if(_supportEmail()){
      toast('That could not be sent'+(sent&&sent.error?' ('+sent.error+')':'')+'. It is saved on this device - to reach a person now, email '+_supportEmail()+'.','info',9000);
    } else {
      toast('That could not be sent, so it is saved on this device only and nobody has seen it. AMV has no support address configured - ask the operator to set one.','info',9000);
    }
    void res;
  });
}
/* Returns what actually happened, so the caller cannot thank somebody for a
   delivery that did not occur. */
function _submitFeedback(kind, text, email){
  const out={ stored:false, delivered:false };
  try{
    const entry={ id:'fb'+Date.now(), kind, text, email, ts:Date.now(),
      context:{ tab:S.tab, plan:loadStr('amv_plan')||'free', lang:_lang(), ua:navigator.userAgent.slice(0,120) } };
    // store locally (ring buffer) for the operator's admin view
    let list=[]; try{ list=JSON.parse(loadStr('amv_feedback')||'[]'); }catch(e){}
    list.unshift(entry); if(list.length>200) list.length=200;
    saveStr('amv_feedback', JSON.stringify(list));
    out.stored=true;
    try{ track('feedback_submitted',{kind}); }catch(e){}
    // send to the operator's endpoint if there is one. sendBeacon returns
    // false when the browser refuses to queue it, which is the only signal
    // available here - and it is more than was being read before.
    const ep=loadStr('amv_feedback_endpoint');
    if(ep){ try{ out.delivered=!!navigator.sendBeacon(ep, JSON.stringify(entry)); }catch(e){} }
  }catch(e){ _logErr('submitFeedback',e); }
  return out;
}
try{ window.openFeedback=openFeedback; }catch(e){}
/* Changelog / What's New - transparent product updates. Newest first. */
const CHANGELOG=[
  { v:'2.4', date:'2026-01-15', title:'Share, install, and export', items:[
    'Share any conversation with a private read-only link',
    'Install AMV as an app on your phone or desktop (PWA)',
    'Export all your data anytime from Settings \u2192 Privacy',
    'In-app bug reports and feature suggestions in the Help Center' ] },
  { v:'2.3', date:'2026-01-08', title:'Speaks your language', items:[
    'Full interface translation across 17 languages',
    'Automatic language detection on first visit',
    'Right-to-left support for Arabic and Urdu' ] },
  { v:'2.2', date:'2026-01-02', title:'Smarter billing & usage', items:[
    'In-app invoice history and payment management',
    '14-day activity trend on your Usage dashboard',
    'Clearer plan limits with contextual upgrade prompts' ] },
  { v:'2.1', date:'2025-12-20', title:'Crew works while you sleep', items:[
    'Standing jobs - schedule AMV to email you news, reports and summaries',
    'Approval queue so nothing sends without your OK',
    'A refreshed, friendlier design across the whole app' ] },
];
function _latestVersion(){ return CHANGELOG.length?CHANGELOG[0].v:''; }
function _checkWhatsNew(){
  try{
    const seen=loadStr('amv_changelog_seen')||'';
    const dot=document.getElementById('whatsnew-dot');
    if(dot) dot.style.display=(seen!==_latestVersion())?'inline-block':'none';
  }catch(e){}
}
function openWhatsNew(){
  const ovr=$('ovr'); if(!ovr) return;
  ovr.innerHTML=
    '<div class="wn-modal">'+
      '<div class="wn-head"><div class="wn-title">What\u2019s New</div><button class="wn-close" id="wn-close" aria-label="close">\u00d7</button></div>'+
      '<div class="wn-list">'+CHANGELOG.map(r=>
        '<div class="wn-rel"><div class="wn-rel-head"><span class="wn-ver">v'+escH(r.v)+'</span><span class="wn-date">'+new Date(r.date+'T00:00:00').toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'})+'</span></div>'+
        '<div class="wn-rel-title">'+escH(r.title)+'</div>'+
        '<ul class="wn-items">'+r.items.map(i=>'<li>'+escH(i)+'</li>').join('')+'</ul></div>'
      ).join('')+'</div>'+
    '</div>';
  ovr.classList.add('on');
  on($('wn-close'),'click',closeOvr);
  // mark newest as seen → clears the notification dot
  try{ saveStr('amv_changelog_seen', _latestVersion()); }catch(e){}
  _checkWhatsNew();
}
try{ window.openWhatsNew=openWhatsNew; }catch(e){}

/* -- Cookie consent -- */
function accCk(){ localStorage.setItem('amv_ck','1'); const ck=document.getElementById('ck'); if(ck)ck.remove(); }
function renderCk(){
  if(localStorage.getItem('amv_ck')) return;
  const div=document.createElement('div');
  div.id='ck';
  div.innerHTML='<p>We use essential cookies to keep you signed in. By continuing you agree to our <button class="ckl" onclick="openTerms()">Terms</button> and <button class="ckl" onclick="openPrivacy()">Privacy Policy</button>.</p>'+
    '<div style="display:flex;gap:7px;flex-shrink:0"><button class="btn bp" id="ck-acc" style="padding:5px 13px;font-size:12px">Accept</button><button class="btn bs" id="ck-nec" style="padding:5px 11px;font-size:12px">Necessary Only</button></div>';
  document.body.appendChild(div);
  document.getElementById('ck-acc')?.addEventListener('click',accCk);
  document.getElementById('ck-nec')?.addEventListener('click',accCk);
}

/* WHEN THESE DOCUMENTS TOOK EFFECT.

   Both said `Effective ' + new Date().toLocaleDateString()`, so the date was
   whatever day you happened to open them. That is not a formatting nicety: the
   Privacy Policy's own section 9 promises "material changes will be noted with
   a new effective date", and a date that moves every day makes that promise
   impossible to keep or to check. Somebody trying to work out whether the terms
   changed since they agreed has nothing to compare.

   A constant, bumped by hand when the text below materially changes - which is
   the only thing an effective date can honestly mean. */
const LEGAL_EFFECTIVE = '2026-08-05';
function _legalEffective(){
  try{ return new Date(LEGAL_EFFECTIVE + 'T00:00:00').toLocaleDateString(undefined,
        { year:'numeric', month:'long', day:'numeric' }); }
  catch(e){ return LEGAL_EFFECTIVE; }
}
try{ window._legalEffective=_legalEffective; }catch(e){}

/* -- Terms & Privacy modal -- */
function openTerms(){
  const r=document.getElementById('ovr'); if(!r) return;
  r.innerHTML=
    '<div class="ov" id="terms-bg"><div class="ob wide tall" onclick="event.stopPropagation()">'+
      '<button class="oc" onclick="closeOvr()">&#215;</button>'+
      '<h2>Terms of Service</h2>'+
      '<p class="ob-sub">Effective '+escH(_legalEffective())+' - please read carefully.</p>'+
      '<div class="ts">'+
        '<h4>1. Acceptance</h4>By using AMV.AI you agree to these terms. If you disagree, stop using the platform.'+
        '<h4>2. Content Policy</h4>Prohibited: explicit sexual/pornographic content; child sexual abuse material (CSAM - all violations reported to NCMEC and law enforcement); content intended to harass or harm; impersonation for fraud; attempts to generate malware or facilitate illegal activity. We may suspend accounts that violate this policy.'+
        '<h4>3. Automation &amp; Connected Tools</h4>By enabling automation or connected features you grant AMV.AI permission to access the accounts and files you configure (e.g. browser, email, calendar), used solely for tasks you request. Revoke access in Settings at any time.'+
        '<h4>4. AI Disclaimer</h4>AI outputs may be inaccurate. Do not rely on AMV.AI for medical, legal, or financial decisions without independent professional verification. AMV.AI does not provide financial advice; scheduled research reports information only.'+
        '<h4>5. Payments &amp; Refunds</h4>Subscriptions are billed monthly by our payment processor and can be cancelled any time; access continues to the end of the paid period. Refunds are handled per our posted policy. Chargeback or refund abuse may result in account suspension.'+
        '<h4>6. Acceptable Use &amp; Limits</h4>Each plan includes usage limits. Automated scraping of the service, reselling access, or circumventing limits is prohibited.'+
        '<h4>7. Privacy</h4>Your use of AMV.AI is also governed by our <button class="lnk-inline" onclick="closeOvr();openPrivacy()">Privacy Policy</button>, which explains what we collect and how it is handled.'+
        '<h4>8. Contact</h4>'+(_supportEmail()?escH(_supportEmail()):'Contact support from the Help Center in the app.')+
      '</div>'+
      '<div style="display:flex;gap:9px"><button class="btn bp" onclick="accCk();closeOvr()" style="flex:1">I Accept</button><button class="btn bs" onclick="closeOvr()">Close</button></div>'+
    '</div></div>';
  document.getElementById('terms-bg')?.addEventListener('click',closeOvr);
}

/* Real, SEPARATE privacy policy - required to take payments (Stripe) and to
   comply with GDPR/CCPA. Written to be ACCURATE to how AMV actually works:
   server-side storage in Cloudflare, PBKDF2-hashed passwords, and the specific
   third parties that receive data. Keep this in sync if the stack changes. */
function openPrivacy(){
  const r=document.getElementById('ovr'); if(!r) return;
  const contact=_supportEmail()?escH(_supportEmail()):'the Help Center in the app';
  r.innerHTML=
    '<div class="ov" id="priv-bg"><div class="ob wide tall" onclick="event.stopPropagation()">'+
      '<button class="oc" onclick="closeOvr()">&#215;</button>'+
      '<h2>Privacy Policy</h2>'+
      '<p class="ob-sub">Effective '+escH(_legalEffective())+' - how AMV.AI handles your data.</p>'+
      '<div class="ts">'+
        '<h4>1. What we collect</h4>'+
          '<b>Account:</b> your name and email. '+
          '<b>Content:</b> the chats, projects, memory, and automations you create. '+
          '<b>Usage:</b> counts and timestamps of requests, for limits, billing, and abuse prevention. '+
          '<b>Payment:</b> handled entirely by our payment processor - we never see or store your full card number.'+
        '<h4>2. How we store it</h4>Your account and content are stored on Cloudflare\u2019s infrastructure (KV / D1) in encrypted transit and at rest. Passwords are never stored in plain text - they are salted and hashed with PBKDF2-SHA256 at current OWASP-recommended strength. Access tokens are short-lived and can be revoked.'+
        /* CATEGORIES, not the vendor's name. AMV is branded as AMV throughout,
           and naming the model provider in copy every visitor can open is the
           one place that leaked. GDPR Art. 13(1)(e) asks for "the recipients or
           categories of recipients" - categories are sufficient on their own,
           and the current list is offered on request, which is how a
           subprocessor list is normally maintained. Nothing is hidden: what
           leaves, why, and to what kind of company is all still stated. */
        '<h4>3. Who we share it with</h4>We do <b>not</b> sell your data. We share the minimum necessary with the providers that make the service work: '+
          'our <b>AI model provider</b> (processes your prompts to generate AI responses), '+
          '<b>Stripe</b> (payments), '+
          '<b>Resend</b> (transactional email such as password resets), and '+
          '<b>Twilio</b> (only if you enable text messaging). '+
          'If you sign in with Google, Google authenticates you. Each provider handles data under its own privacy terms. '+
          'For the current list of the specific companies in each category, contact us at '+contact+'.'+
        '<h4>4. What we do NOT do</h4>We do not sell or rent your data, do not show third-party ads, and do not use your private chats to train models.'+
        '<h4>5. Your rights</h4>You can access, export, or delete your data. Deleting your account removes your account record, content, and automations from our storage. To exercise these rights, use the controls in Settings or contact us at '+contact+'.'+
        '<h4>6. Data retention</h4>We keep your data while your account is active. Usage counters expire automatically. When you delete your account, your data is removed from active storage; residual copies in routine backups age out on their normal cycle.'+
        '<h4>7. Cookies &amp; local storage</h4>We use essential storage to keep you signed in and remember your preferences, and optional analytics only if you consent. You can change this any time in Settings.'+
        '<h4>8. Children</h4>AMV.AI is not directed to children under 13 (or the minimum age in your region), and we do not knowingly collect their data.'+
        '<h4>9. Changes &amp; contact</h4>We may update this policy; material changes will be noted with a new effective date. Questions: '+contact+'.'+
      '</div>'+
      '<div style="display:flex;gap:9px"><button class="btn bp" onclick="closeOvr()" style="flex:1">Got it</button></div>'+
    '</div></div>';
  document.getElementById('priv-bg')?.addEventListener('click',closeOvr);
}
try{ window.openPrivacy=openPrivacy; }catch(e){}

/* -- Auth modal -- */
function openAuth(mode){
  const r=document.getElementById('ovr'); if(!r) return;
  const isL=(mode==='login');
  r.innerHTML=
    '<div class="ov" id="auth-bg"><div class="ob" onclick="event.stopPropagation()">'+
      '<button class="oc" id="auth-x">&#215;</button>'+
      '<h2>'+(isL?'Welcome back':'Create your account')+'</h2>'+
      '<p class="ob-sub">'+(isL?'Sign in to your AMV.AI account.':'Free forever. No credit card required.')+'</p>'+
      '<div id="auth-err" class="ae"></div>'+
      '<div class="af">'+
        '<button class="gbtn" id="g-btn">'+
          '<svg width="17" height="17" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>'+
          'Continue with Google'+
        '</button>'+
        '<div class="ord"><span>or</span></div>'+
        (!isL?'<div><label class="lbl">Full Name</label><input type="text" id="a-name" placeholder="Alex Johnson" autocomplete="name"></div>':'')+
        '<div><label class="lbl">Email</label><input type="email" id="a-email" placeholder="you@example.com" autocomplete="email"></div>'+
        '<div><label class="lbl">Password</label><input type="password" id="a-pass" placeholder="Minimum 6 characters" autocomplete="'+(isL?'current-password':'new-password')+'"></div>'+
        // Honeypot: hidden from humans, bots fill it → server rejects. Not display:none
        // (some bots skip those); off-screen + aria-hidden + tab-skipped instead.
        '<div aria-hidden="true" style="position:absolute;left:-9999px;top:-9999px;height:0;overflow:hidden"><label>Company<input type="text" id="a-company" name="company" tabindex="-1" autocomplete="off"></label></div>'+
        '<div id="a-turnstile" class="cf-turnstile" style="margin:4px 0"></div>'+
        '<button class="btn bp" id="auth-submit" style="width:100%;padding:11px;font-size:14px">'+(isL?'Sign In':'Create Free Account')+'</button>'+
      '</div>'+
      '<div class="asw">'+(isL?'No account? <button id="auth-sw">Sign up free</button>':'Already have an account? <button id="auth-sw">Sign in</button>')+'</div>'+
      (isL?'<div class="asw" style="margin-top:6px"><button id="auth-forgot" style="color:var(--mu)">Forgot password?</button></div>':'')+
      '<p class="an">By continuing you agree to our <button id="a-terms">Terms</button> and <button id="a-priv">Privacy Policy</button></p>'+
    '</div></div>';
  document.getElementById('auth-bg')?.addEventListener('click',closeOvr);
  document.getElementById('auth-x')?.addEventListener('click',closeOvr);
  document.getElementById('g-btn')?.addEventListener('click',triggerGoogle);
  document.getElementById('auth-submit')?.addEventListener('click',()=>isL?doLoginForm():doSignupForm());
  try{ _mountTurnstile(); }catch(e){}
  document.getElementById('auth-sw')?.addEventListener('click',()=>openAuth(isL?'signup':'login'));
  document.getElementById('auth-forgot')?.addEventListener('click',()=>{ const em=(document.getElementById('a-email')?.value||'').trim(); closeOvr(); openForgot(em); });
  document.getElementById('a-terms')?.addEventListener('click',()=>{closeOvr();openTerms();});
  document.getElementById('a-priv')?.addEventListener('click',()=>{closeOvr();openPrivacy();});
  document.getElementById('a-pass')?.addEventListener('keydown',e=>{if(e.key==='Enter')isL?doLoginForm():doSignupForm();});
  document.getElementById('a-email')?.addEventListener('keydown',e=>{if(e.key==='Enter')isL?doLoginForm():doSignupForm();});
}

/* -- Intro / Onboarding -- */
let _iStep=0;
const ITOTAL=5;
function showIntro(){
  const intro=document.getElementById('intro');
  if(intro) intro.classList.remove('done');
  document.getElementById('land')?.classList.remove('hidden');
  document.getElementById('app')?.classList.remove('on');
  _iStep=0; _renderIProg(); _goSlide(0); _setupIntro();
}
function hideIntro(){
  const intro=document.getElementById('intro');
  if(intro) intro.classList.add('done');
}
function _renderIProg(){
  const p=document.getElementById('iprog'); if(!p) return;
  p.innerHTML=Array.from({length:ITOTAL},(_,i)=>'<div class="ipd '+(i===_iStep?'on':'')+'" data-si="'+i+'"></div>').join('');
  p.querySelectorAll('.ipd').forEach(d=>d.addEventListener('click',()=>_goSlide(parseInt(d.dataset.si))));
}
function _goSlide(n){
  document.querySelectorAll('.islide').forEach(s=>{
    const idx=parseInt(s.dataset.s);
    s.className='islide '+(idx===n?'vis':idx<n?'hl':'hr');
  });
  _iStep=n; _renderIProg();
  const back=document.getElementById('i-back');
  const next=document.getElementById('i-next');
  const skip=document.getElementById('i-skip');
  if(back) back.style.display=n>0?'inline-flex':'none';
  if(n===ITOTAL-1){
    if(next) next.style.display='none';
    if(skip) skip.style.display='none';
  } else {
    if(next){next.style.display='inline-flex';next.textContent=n===0?'Get Started':'Next';}
    if(skip) skip.style.display='block';
  }
}
function _setupIntro(){
  document.getElementById('i-next')?.addEventListener('click',()=>{if(_iStep<ITOTAL-1)_goSlide(_iStep+1);});
  document.getElementById('i-back')?.addEventListener('click',()=>{if(_iStep>0)_goSlide(_iStep-1);});
  document.getElementById('i-skip')?.addEventListener('click',()=>{
    hideIntro();
    document.getElementById('land')?.classList.remove('hidden');
    // Show auth immediately after hiding intro
    setTimeout(()=>openAuth('signup'), 50);
  });
  document.getElementById('intro-terms-btn')?.addEventListener('click',e=>{e.preventDefault();openTerms();});
  document.getElementById('intro-priv-btn')?.addEventListener('click',e=>{e.preventDefault();openPrivacy();});
  document.getElementById('i-google-btn')?.addEventListener('click',_iGoogleSignIn);
  document.getElementById('i-signup-btn')?.addEventListener('click',_iEmailSignup);
  document.getElementById('i-signin-link')?.addEventListener('click',()=>{hideIntro();openAuth('login');});
  document.getElementById('i-pass')?.addEventListener('keydown',e=>{if(e.key==='Enter')_iEmailSignup();});
  // Swipe support
  let tx=0;
  const sl=document.getElementById('islides');
  if(sl){
    sl.addEventListener('touchstart',e=>{tx=e.touches[0].clientX;},{passive:true});
    sl.addEventListener('touchend',e=>{
      const dx=e.changedTouches[0].clientX-tx;
      if(Math.abs(dx)>50){if(dx<0&&_iStep<ITOTAL-1)_goSlide(_iStep+1);else if(dx>0&&_iStep>0)_goSlide(_iStep-1);}
    });
  }
  _goSlide(0);
}
function _showIErr(msg){ const e=document.getElementById('i-err');if(e){e.textContent=msg;e.style.display='block';} }
async function _iGoogleSignIn(){
  if(!document.getElementById('terms-chk')?.checked){_showIErr('Please accept the Terms to continue.');return;}
  const cid=loadStr('amv_gauth');
  if(cid && window.google?.accounts?.id){
    try{
      window.google.accounts.id.prompt(n=>{
        if(n && (n.isNotDisplayed?.() || n.isSkippedMoment?.())){
          _showIErr('Google Sign-In couldn\u2019t open here. Please sign up with your email below.');
        }
      });
    }catch(e){ _showIErr('Google Sign-In is unavailable here. Please sign up with email.'); }
    return;
  }
  _showIErr('Google Sign-In isn\u2019t enabled yet - please sign up with your email below. It only takes a second.');
}
async function _iEmailSignup(){
  // Terms accepted implicitly by signing up (checkbox removed from gate)
  document.getElementById('terms-chk') && (document.getElementById('terms-chk').checked=true);
  const nm=document.getElementById('i-name')?.value.trim();
  const em=document.getElementById('i-email')?.value.trim().toLowerCase();
  const pw=document.getElementById('i-pass')?.value;
  if(!nm){_showIErr('Please enter your full name.');return;}
  if(!em||!em.includes('@')){_showIErr('Please enter a valid email.');return;}
  if(!pw||pw.length<6){_showIErr('Password must be at least 6 characters.');return;}
  const existing=findAccount(em);
  if(existing){
    const how = existing.provider==='google' ? 'with Google' : 'with email';
    _showIErr('You already have an account ('+how+'). Click \u201cSign in instead\u201d.');
    return;
  }
  const btn=document.getElementById('i-signup-btn');
  if(btn){btn.disabled=true;btn.innerHTML='<div class="spin" style="width:14px;height:14px;border-width:2px;margin-right:8px"></div>Creating account…';}
  const _newAcct=await createAccount(nm,em,pw);
  try{ track('signup', { method:'email' }); }catch(e){}
  _completeIntroLogin(_newAcct);
}
function _completeIntroLogin(acct){
  if(!acct) return;
  // Nothing from any previous account may survive into this one.
  try{ _wipeAccountState(); }catch(e){}
  S.user={name:acct.name,email:acct.email,ini:acct.ini,provider:acct.provider||'email'};
  store('amv_user',S.user);
  // Now load THIS account's own sessions/memory (scoped by email).
  try{ _loadSessions(); }catch(e){}
  try{ S.memory = load('amv_memory') || []; }catch(e){ S.memory=[]; }
  accCk();
  const ck=document.getElementById('ck'); if(ck)ck.remove();
  const uc=loadUserConvs(acct.email);
  if(uc&&uc.length){S.convs=uc;S.cur=S.convs[0].id;}
  else{S.convs=[newConvObj()];S.cur=S.convs[0].id;}
  S.imgs=[];S.vids=[];
  hideIntro();
  document.getElementById('land')?.classList.add('hidden');
  S.tab='chat';   // new sign-ins land straight in chat
  goApp();
  setTab('chat');
  // First-run activation. This lives in loginUser(), but signup comes through
  // HERE - so brand-new users (the only people who need it) never saw it.
  // Onboarding popup removed per product direction (looked intrusive on sign-in).
  try{ saveStr('amv_onboarded','1'); }catch(e){}
  // if they typed a message before signing up, send it now
  if(typeof _pendingMessage!=='undefined' && _pendingMessage){
    const pm=_pendingMessage; _pendingMessage='';
    setTimeout(()=>{ try{ const ta=$('mta'); if(ta){ ta.value=pm; ta.dispatchEvent(new Event('input')); } sendMsg(); }catch(e){} }, 300);
  }
}

/* -- Keyboard shortcuts --

   THE CHEAT SHEET PROMISED ⌘ AND ONLY Ctrl WAS LISTENED FOR.

   Every branch below tested `e.ctrlKey` alone. On a Mac that is the Control
   key, which nobody presses for an application shortcut - so ⌘⇧O, ⌘⇧L, ⌘B,
   ⌘, ⌘/ ⌘⇧D and ⌘⇧V all did nothing, while the shortcut sheet rendered them
   with ⌘ symbols because it detects the platform. Every shortcut in the
   product except the command palette was dead on macOS, and the one screen
   that documents them told Mac users exactly which dead key to press.

   The palette had it right already - 01-core tests `(e.metaKey||e.ctrlKey)`.
   `_mod` is that test, used everywhere, so Windows and Linux are unchanged and
   the Mac keys are the ones the sheet shows. */
function _mod(e){ return !!(e && (e.metaKey || e.ctrlKey)); }
try{ window._mod=_mod; }catch(e){}
function setupKeyboard(){
  document.addEventListener('keydown',e=>{
    const tag=document.activeElement?.tagName;
    const inInput=tag==='INPUT'||tag==='TEXTAREA'||document.activeElement?.contentEditable==='true';
    if(e.key==='Escape'){
      // In settings, Esc closes it and returns you to your work.
      if(S.tab==='settings' && !document.querySelector('.ovr.on, #ovr.on')){ e.preventDefault(); try{ closeSettings(); }catch(err){} return; }
      // While the AI is generating, Esc stops it (as chat apps do).
      if(S.busy){ e.preventDefault(); try{ stopGenerating(); }catch(err){} return; }
      if(!inInput){ const ta=document.getElementById('mta'); if(ta)ta.focus(); return; }
    }
    if(_mod(e)&&e.shiftKey&&(e.key==='O'||e.key==='o')){e.preventDefault();newChat();return;}
    if(_mod(e)&&!e.shiftKey&&(e.key==='b'||e.key==='B')&&!inInput){
      e.preventDefault();
      /* Ctrl+B toggled a history drawer that the sidebar replaced, so the
         shortcut had quietly done nothing. It toggles the sidebar, which is
         where the history actually is now. */
      try{ toggleSb(); }catch(_){}
      return;
    }
    if(_mod(e)&&e.shiftKey&&(e.key==='L'||e.key==='l')){e.preventDefault();document.body.classList.toggle('light');saveStr('amv_theme',document.body.classList.contains('light')?'light':'dark');return;}
    if(_mod(e)&&e.key===','){e.preventDefault();S.settingsPane='account';setTab('settings');return;}
    if(_mod(e)&&e.key==='/'){e.preventDefault();setTab('help');return;}
    // "?" (Shift+/) opens the keyboard shortcut cheat sheet
    if(e.key==='?'&&!inInput){ e.preventDefault(); try{ openShortcutSheet(); }catch(err){} return; }
    // Ctrl+Shift+V toggles hands-free voice mode
    if(_mod(e)&&e.shiftKey&&(e.key==='V'||e.key==='v')){ e.preventDefault(); try{ toggleVoiceMode(); }catch(err){} return; }
    // Ctrl+Shift+D collapses / expands the sidebar
    if(_mod(e)&&e.shiftKey&&(e.key==='D'||e.key==='d')){ e.preventDefault(); try{ toggleSb(); }catch(err){} return; }
  });
}

/* === CANVAS AUTOMATION SYSTEM === */
const CANVAS_QUEUE_KEY='amv_canvas_queue';

async function runCanvasAutomation() {
  const token=loadStr('amv_canvas');
  const baseUrl=loadStr('amv_canvas_url');
  if(!token||!baseUrl){
    toast('Add Canvas API token in Settings → Integrations first.','error');
    return;
  }
  if(!_aiBackendReady()){
    toast('AMV isn\u2019t connected yet - the workspace owner needs to switch on the AMV engine first.','error');
    return;
  }

  // Show automation modal
  const r=document.getElementById('ovr'); if(!r) return;
  r.innerHTML=
    '<div class="ov" id="ca-bg"><div class="ob wide" onclick="event.stopPropagation()">'+
      '<button class="oc" onclick="closeOvr()">&#215;</button>'+
      '<h2>&#x1F4DA; Canvas Automation</h2>'+
      '<p class="ob-sub">AMV will read your assignments, complete them, and save results to your Google Drive or download them.</p>'+
      '<div id="ca-status" style="min-height:120px;background:rgba(0,0,0,.2);border:1px solid var(--bd);border-radius:var(--r-md);padding:13px;font-size:12px;color:var(--mu);font-family:var(--mn);overflow-y:auto;max-height:280px;line-height:1.8">'+
        'Connecting to Canvas API...<br>'+
      '</div>'+
      '<div style="margin-top:13px;display:flex;gap:8px">'+
        '<button class="btn bp" id="ca-start" style="font-size:13px">Start Automation</button>'+
        '<button class="btn bs" onclick="closeOvr()" style="font-size:13px">Cancel</button>'+
      '</div>'+
      '<p style="font-size:10px;color:var(--dim);margin-top:9px">Your computer must stay on and browser open. For overnight automation, deploy a backend server - see the Help section.</p>'+
    '</div></div>';
  document.getElementById('ca-bg')?.addEventListener('click',closeOvr);

  const log=(msg,color)=>{
    const s=document.getElementById('ca-status');
    if(s) s.innerHTML+=('<span style="color:'+(color||'var(--mu)')+'">'+escH(msg)+'</span><br>');
    if(s) s.scrollTop=s.scrollHeight;
  };

  document.getElementById('ca-start')?.addEventListener('click',async()=>{
    const btn=document.getElementById('ca-start');
    if(btn){btn.disabled=true;btn.textContent='Running…';}
    log('Fetching courses from Canvas...','var(--accent)');

    try{
      // Fetch courses
      const coursesRes=await fetchDeadline(baseUrl+'/api/v1/courses?enrollment_type=student&per_page=20',{
        headers:{'Authorization':'Bearer '+token}
      },20000);
      if(!coursesRes.ok) throw new Error('Canvas API error: '+coursesRes.status+' - check your token and URL.');
      const courses=await coursesRes.json();
      log('Found '+courses.length+' active courses.','var(--grn)');

      let completed=0, total=0;
      for(const course of courses.slice(0,5)){
        log('Checking '+course.name+'...','var(--tx)');
        // Fetch assignments
        const assignRes=await fetchDeadline(baseUrl+'/api/v1/courses/'+course.id+'/assignments?bucket=upcoming&per_page=10',{
          headers:{'Authorization':'Bearer '+token}
        },20000);
        /* The courses call above checks its status; this one did not, so a 401
           or a 403 here returned an error OBJECT, `.filter` was not a function,
           and the run died with a TypeError instead of "check your token" -
           the same failure, reported as a bug in AMV. */
        if(!assignRes.ok){ log('Canvas refused the assignment list for '+course.name+' ('+assignRes.status+') - skipping it.','var(--red)'); continue; }
        const assignments=await assignRes.json();
        if(!Array.isArray(assignments)){ log('Canvas sent an unexpected answer for '+course.name+' - skipping it.','var(--red)'); continue; }
        const pending=assignments.filter(a=>!a.has_submitted_submissions&&a.due_at);
        total+=pending.length;
        log(pending.length+' pending assignments in '+course.name,'var(--mu)');

        for(const assignment of pending.slice(0,3)){
          log('Working on: '+assignment.name,'var(--gold)');
          // Use AMV AI to complete it
          const prompt='Complete this assignment fully and professionally.\n\nCourse: '+course.name+'\nAssignment: '+assignment.name+'\n\nInstructions:\n'+(assignment.description||'No instructions provided - write a comprehensive response.').replace(/<[^>]*>/g,' ').trim()+'\n\nProvide a complete, submission-ready response.';

          try{
            const answer=await aiComplete(prompt, null, {model:(typeof qModel==='function'?qModel('draft'):'amv-core'), max_tokens:4000, noLang:true});
            log('&#x2713; Completed: '+assignment.name,'var(--grn)');

            // Save to a downloadable file
            const blob=new Blob(['Assignment: '+assignment.name+'\nCourse: '+course.name+'\n\n'+answer],{type:'text/plain'});
            const url=URL.createObjectURL(blob);
            const a=document.createElement('a');
            a.href=url; a.download=assignment.name.replace(/[^a-z0-9]/gi,'_').slice(0,50)+'.txt';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            completed++;
          } catch(aiErr){
            log('AI error on '+assignment.name+': '+aiErr.message,'var(--red)');
          }
          // Brief delay to avoid rate limits
          await new Promise(res=>setTimeout(res,1500));
        }
      }
      log('&#x2713; Automation complete! '+completed+'/'+total+' assignments processed.','var(--grn)');
      log('Files downloaded to your computer. Review before submitting.','var(--mu)');
      if(btn){btn.textContent='Done!';btn.style.background='var(--grn)';}
    } catch(err){
      log('Error: '+err.message,'var(--red)');
      if(btn){btn.disabled=false;btn.textContent='Retry';}
    }
  });
}
try{ window.runCanvasAutomation=runCanvasAutomation; }catch(e){}

/* Canvas overnight queue (requires backend for true overnight - shows instructions) */
function openOvernightQueue(){
  const r=document.getElementById('ovr'); if(!r) return;
  r.innerHTML=
    '<div class="ov" id="oq-bg"><div class="ob wide" onclick="event.stopPropagation()">'+
      '<button class="oc" onclick="closeOvr()">&#215;</button>'+
      '<h2>&#x1F319; Overnight Task Queue</h2>'+
      '<p class="ob-sub">Tasks to run overnight. Your computer must stay on, OR deploy a backend server.</p>'+
      '<div class="sf" style="margin-bottom:14px">'+
        '<input type="text" id="oq-task" placeholder="e.g. Complete all pending Canvas assignments for CS101…">'+
        '<button class="btn bp" id="oq-add" style="align-self:flex-start;font-size:12px">Add Task</button>'+
      '</div>'+
      '<div id="oq-list" style="display:flex;flex-direction:column;gap:7px;min-height:60px;margin-bottom:14px"></div>'+
      '<div class="wb" style="margin-bottom:13px">&#9888; For true overnight automation (computer OFF), you need a backend server. See Help Center for the free Render.com setup guide.</div>'+
      '<div style="display:flex;gap:8px">'+
        '<button class="btn bp" id="oq-run" style="font-size:13px">&#x25B6; Run Queue Now</button>'+
        '<button class="btn bs" onclick="closeOvr()" style="font-size:13px">Done</button>'+
      '</div>'+
    '</div></div>';
  document.getElementById('oq-bg')?.addEventListener('click',closeOvr);

  let queue=[];
  try{ queue=JSON.parse(localStorage.getItem(CANVAS_QUEUE_KEY)||'[]'); }catch(e){ queue=[]; }
  if(!Array.isArray(queue)) queue=[];
  const renderQ=()=>{
    const list=document.getElementById('oq-list');
    if(!list) return;
    list.innerHTML=queue.length?queue.map((t,i)=>
      '<div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.04);border:1px solid var(--bd);border-radius:7px;padding:9px 12px;font-size:12px;">'+
        '<span style="flex:1">'+escH(t)+'</span>'+
        /* Was an inline onclick calling queue.splice(...) and renderQ(). Both
           are LOCAL to this function, and an inline handler attribute runs in
           the global scope - so every click threw ReferenceError: queue is not
           defined and the row stayed. no-dead-controls did not catch it because
           its inline-handler check skips any call containing a dot, and this
           one began "queue.splice(". Bound properly instead, like the rest of
           the file. */
        '<button type="button" class="oq-del" data-oq="'+i+'" aria-label="Remove this task" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px">&#215;</button>'+
      '</div>'
    ).join(''):'<div style="font-size:12px;color:var(--t3);font-style:italic">No tasks queued.</div>';
    list.querySelectorAll('[data-oq]').forEach(b=>on(b,'click',()=>{
      const i=parseInt(b.dataset.oq,10);
      if(!(i>=0)) return;
      queue.splice(i,1);
      try{ localStorage.setItem(CANVAS_QUEUE_KEY,JSON.stringify(queue)); }catch(e){}
      renderQ();
    }));
  };
  renderQ();

  document.getElementById('oq-add')?.addEventListener('click',()=>{
    const inp=document.getElementById('oq-task');
    if(!inp?.value.trim()) return;
    const taskText=inp.value.trim();
    // Task #1: check capability before queueing. Warn specifically if missing.
    try{
      const a=(typeof analyzeTaskIntent==='function')?analyzeTaskIntent(taskText):null;
      if(a&&a.matched&&!a.ready){
        const missing=(a.missing[0]&&a.missing[0].integration)||(a.unsupported[0]&&a.unsupported[0].integration)||'a required integration';
        const api=(a.missing[0]&&a.missing[0].api)||(a.unsupported[0]&&a.unsupported[0].api)||'integration';
        toast('Queued, but needs '+missing+' ('+api+') connected to run','info',4500);
      } else {
        toast('Task added to queue','success');
      }
    }catch(e){ toast('Task added to queue','success'); }
    queue.push(taskText);
    localStorage.setItem(CANVAS_QUEUE_KEY,JSON.stringify(queue));
    inp.value=''; renderQ();
  });

  document.getElementById('oq-run')?.addEventListener('click',()=>{
    if(!queue.length){toast('No tasks in queue','info');return;}
    closeOvr();
    // Send all queued tasks to chat as one big automation request
    setTab('chat');
    setTimeout(()=>{
      const ta=document.getElementById('mta');
      if(ta){
        ta.value='Run these automation tasks in sequence:\n'+queue.map((t,i)=>(i+1)+'. '+t).join('\n');
        ta.dispatchEvent(new Event('input'));
        ta.focus();
      }
    },200);
  });
}



// === BOOT - wire everything up ===
/* This file is the WEBSITE, not anyone's data. All user data lives only in
   the visitor's own browser (localStorage), never inside this HTML. Each
   person who opens it gets their own private, separate account. To prove a
   clean slate (or wipe this browser), run amvReset() in the console. */
window.amvReset=function(){ try{ localStorage.clear(); }catch(e){} location.reload(); };
/* Premium reveal-on-scroll for landing sections */
function _initReveal(){
  try{
    const els=document.querySelectorAll('.lsec, .fgrid, .vs-grid, .step-g, .cta-sec');
    if(prefersReducedMotion()){ els.forEach(e=>e.classList.add('in')); return; }
    if(!('IntersectionObserver' in window)){ els.forEach(e=>e.classList.add('in')); return; }
    els.forEach(e=>e.classList.add('reveal'));
    const io=new IntersectionObserver((ents)=>{ ents.forEach(en=>{ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); } }); },{threshold:.12});
    els.forEach(e=>io.observe(e));
  }catch(e){}
}
/* Run low-priority work when the browser is idle so first paint + the main
   chat view become interactive immediately instead of waiting on everything. */
const _idle = (fn)=>{ try{ (window.requestIdleCallback||function(f){return setTimeout(f,1)})(fn,{timeout:2000}); }catch(e){ setTimeout(fn,1); } };
try {
  // critical: the app must be usable right away
  setupLanding();
  setupApp();
  setupKeyboard();
  try{ _initCookieConsent(); }catch(e){ try{ renderCk(); }catch(_){} }
  try{ checkOAuthCallback(); }catch(e){}
  try{ _setPlan(loadStr('amv_plan')||'free'); }catch(e){}
  // deferred: not needed for first interaction - run when idle
  _idle(()=>{ try{ _initReveal(); }catch(e){} });
  _idle(()=>{ try{ _translateUI(); }catch(e){} });
  _idle(()=>{ try{ _checkPayReturn(); }catch(e){} });
  _idle(()=>{ try{ _verifyEntitlement(); }catch(e){} });
  _idle(()=>{
  if(document.getElementById('amv-tip')) return;
  var tip=document.createElement('div'); tip.id='amv-tip'; document.body.appendChild(tip);
  document.addEventListener('mouseover',function(e){
    var b=e.target.closest && e.target.closest('.snb'); if(!b) return;
    var lbl=b.getAttribute('data-label')|| (b.dataset?b.dataset.tab:'') ||''; if(!lbl) return;
    var r=b.getBoundingClientRect();
    tip.textContent=lbl; tip.style.left=(r.right+10)+'px'; tip.style.top=(r.top+r.height/2)+'px'; tip.classList.add('on');
  });
  document.addEventListener('mouseout',function(e){
    var b=e.target.closest && e.target.closest('.snb'); if(b) document.getElementById('amv-tip').classList.remove('on');
  });
  });
  _idle(()=>{ try{ var _lbl={dashboard:'Dashboard',chat:'Chat',images:'Images',video:'Video',workspaces:'Projects',memory:'Memory',usage:'Usage',billing:'Billing',plans:'Plans',settings:'Settings',help:'Help Center',apps:'Apps',tasks:'Tasks',integrations:'Integrations',extensions:'Extensions',crew:'Crew',studio:'Studio',dev:'Dev',handoff:'Handoff',market:'Marketplace'}; document.querySelectorAll('.snb').forEach(function(b){var t=b.dataset.tab; if(_lbl[t]) b.setAttribute('data-label',_lbl[t]);}); }catch(e){} });

} catch(e) {
  console.error('Boot error:', e);
}

// Nav scroll behavior
(function(){
  const land = document.getElementById('land');
  const nav = document.getElementById('lnav');
  if(land && nav){
    land.addEventListener('scroll', function(){
      if(land.scrollTop > 60){
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }
    }, {passive: true});
  }
})();

// Apply saved theme
const savedTheme = loadStr('amv_theme');
// Default to DARK. Only use light if the user explicitly chose it.
if(savedTheme === 'light') document.body.classList.add('light');
// Apply saved accent theme (default azure = no attribute).
const ACCENT_THEMES=[
  {id:'',       name:'Azure',   dot:'#5590ff'},
  {id:'violet', name:'Violet',  dot:'#9d7bff'},
  {id:'emerald',name:'Emerald', dot:'#34d399'},
  {id:'amber',  name:'Amber',   dot:'#f5a623'},
  {id:'rose',   name:'Rose',    dot:'#fb7185'},
  {id:'cyan',   name:'Cyan',    dot:'#38bdf8'},
];
function applyAccent(id){
  if(id) document.body.setAttribute('data-accent',id);
  else document.body.removeAttribute('data-accent');
  try{ saveStr('amv_accent', id||''); }catch(e){}
}
function _restoreAccent(){ try{ const a=loadStr('amv_accent'); if(a) document.body.setAttribute('data-accent',a); }catch(e){} }
try{ window.applyAccent=applyAccent; }catch(e){}
_restoreAccent();

// Apply saved font size (zoom-based, applied when app boots via _applyFontSize)
try{ _applyFontSize&&_applyFontSize(); }catch(e){}

// Init Google auth after load
window.addEventListener('load',()=>{ setTimeout(initGAuth,500); });
// Init PWA (installable app + offline shell)
try{ _initPWA(); }catch(e){}
/* The public settings a visitor needs - the Google client id above all, since
   "Continue with Google" is the first button on the sign-up sheet and was dead
   for everybody who had not typed the id into their own Settings. Fired at
   boot, not on demand, so the id is usually there before anybody reaches the
   button; if it is not, the button still says plainly that it is unavailable
   rather than failing silently. */
try{ _loadPublicConfig(); }catch(e){}

/* Count this arrival, once per session.

   Everything AMV measures starts at signup, so the largest group there is -
   people who opened the page and left - was invisible, and visitors-to-accounts
   is the number that says whether any of the marketing works.

   Deliberately the smallest thing that answers it: a POST to AMV's own backend
   that increments a daily COUNTER. Nothing identifying is sent - no id, no
   address, no referrer, no user agent - so there is nothing here to leak, to
   join back to a person, or to need a consent banner for. It cannot answer
   "who", and "how many" is the whole question.

   sessionStorage, not localStorage: one arrival per visit is what a funnel
   means, and a returning visitor tomorrow is a new arrival. Failure is
   silence - a metric must never be able to break the page it is measuring. */
function _countVisit(){
  try{
    if(sessionStorage.getItem('amv_visit_counted')==='1') return;
    sessionStorage.setItem('amv_visit_counted','1');
    const base=(window.AMV_API && AMV_API.base)||'';
    if(!base) return;
    /* keepalive so it survives the user leaving immediately, which is exactly
       the visit most worth counting. */
    fetch(base.replace(/\/$/,'')+'/v1/visit',{method:'POST',keepalive:true}).catch(()=>{});
  }catch(e){}
}
try{ _countVisit(); window._countVisit=_countVisit; }catch(e){}
// Show a "new" dot on What's New if there are unseen updates
try{ setTimeout(()=>{ try{ _checkWhatsNew(); }catch(e){} }, 800); }catch(e){}

// Boot logic
// If this is the embeddable widget (#embed=1&k=pk_...), render the compact chat panel and stop.
if(typeof _checkEmbedView==='function' && _checkEmbedView()){
  // embed chat rendered; skip normal app boot
} else
// If this is a shared-conversation link (#share=...), show the read-only view and stop.
if(typeof _checkSharedView==='function' && _checkSharedView()){
  // shared view rendered; skip normal app boot
} else
// If this is a shared-artifact link (#art=...), show the branded artifact page and stop.
if(typeof _checkSharedArtifact==='function' && _checkSharedArtifact()){
  // shared artifact rendered; skip normal app boot
} else if(S.user&&S.user.email){
  const acct=findAccount(S.user.email);
  if(acct){
    const uc=loadUserConvs(S.user.email);
    if(uc&&uc.length){S.convs=uc;S.cur=S.convs[0].id;}
    else if(!S.convs.length){S.convs=[newConvObj()];S.cur=S.convs[0].id;}
    else if(!S.cur) S.cur=S.convs[0].id;
    try{ _loadSessions(); }catch(e){}
    hideIntro();
    document.getElementById('land')?.classList.add('hidden');
    goApp();
  } else {
    // No account yet: skip the intro wall - let them into the app immediately.
    // Sign-up is required the moment they try to send a message (see sendMsg).
    S.user=null; localStorage.removeItem('amv_user');
    hideIntro();
    document.getElementById('land')?.classList.add('hidden');
    if(!S.convs||!S.convs.length){ S.convs=[newConvObj()]; S.cur=S.convs[0].id; }
    S.tab='chat';   // always land in chat (never a gated tab that would pop signup on load)
    goApp();
  }
} else {
  // First-ever visit, no session: straight into the app, gated at first send.
  hideIntro();
  document.getElementById('land')?.classList.add('hidden');
  if(!S.convs||!S.convs.length){ S.convs=[newConvObj()]; S.cur=S.convs[0].id; }
  S.tab='chat';
  goApp();
}

function toastInfo(msg){ toast(msg||'Done','info'); }

/* ---------------- Cookie consent banner ----------------
   Shows once per device (not per account - stored in the global,
   unscoped bucket) until the person accepts, declines non-essential
   cookies, or picks preferences. Analytics code should check
   _cookieConsent().analytics before firing anything. */
function _cookieConsent(){
  try{
    const raw = localStorage.getItem('amv_cookie_consent');
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(e){ return null; }
}
function _setCookieConsent(choice){
  // choice: {essential:true, analytics:bool}
  try{
    localStorage.setItem('amv_cookie_consent', JSON.stringify(Object.assign({essential:true, ts:Date.now()}, choice)));
  }catch(e){}
  const el = $('cookie-consent-banner');
  if(el){ el.classList.add('cc-hide'); setTimeout(()=>{ try{ el.remove(); }catch(e){} }, 350); }
  try{ if(choice.analytics && typeof _analyticsInit==='function') _analyticsInit(); }catch(e){}
}
function _initCookieConsent(){
  if(_cookieConsent()) return; // already decided
  if($('cookie-consent-banner')) return; // already showing
  const wrap = document.createElement('div');
  wrap.id = 'cookie-consent-banner';
  wrap.className = 'cc-banner';
  wrap.setAttribute('role','dialog');
  wrap.setAttribute('aria-label','Cookie preferences');
  wrap.innerHTML =
    '<div class="cc-inner">'+
      '<div class="cc-text">We use essential cookies to run AMV, and optional analytics cookies to understand usage so we can improve the product. You can change this anytime in Settings.</div>'+
      '<div class="cc-actions">'+
        '<button class="btn" id="cc-manage">Manage</button>'+
        '<button class="btn" id="cc-decline">Essential only</button>'+
        '<button class="btn bp" id="cc-accept">Accept all</button>'+
      '</div>'+
    '</div>';
  document.body.appendChild(wrap);
  on($('cc-accept'),'click',()=>_setCookieConsent({analytics:true}));
  on($('cc-decline'),'click',()=>_setCookieConsent({analytics:false}));
  /* `render` is not a function anywhere in the bundle, so `render&&render()` on
     a bare undeclared identifier threw ReferenceError - inside a try, which
     swallowed it along with the toast on the line after. Somebody pressing
     Manage landed on Settings with no idea why. Sent to the Privacy pane, which
     is where the control actually is. */
  on($('cc-manage'),'click',()=>{
    _setCookieConsent({analytics:false});
    try{
      S.tab='settings'; S.settingsPane='privacy';
      if(typeof goApp==='function') goApp();
      if(typeof setTab==='function') setTab('settings');
      if(typeof toast==='function') toast('Analytics are off for now - turn them on here whenever you like.','info',5000);
    }catch(e){}
  });
}
window._cookieConsent = _cookieConsent;
window._initCookieConsent = _initCookieConsent;

/* ---------------- Analytics ----------------
   Lightweight, provider-agnostic tracker. Nothing fires unless the person
   has consented to analytics cookies AND a tracking ID has been entered in
   Settings > Privacy. Supports Google Analytics (GA4) or Plausible - pick
   one by the shape of the ID ("G-XXXX" = GA4, anything else = Plausible
   domain). Also tracks a small conversion funnel (visit -> signup -> first
   message -> upgrade) as local events, visible in Settings even with no
   provider configured, so the funnel itself never depends on a 3rd party. */
function _analyticsId(){ try{ return loadStr('amv_analytics_id')||''; }catch(e){ return ''; } }
function _analyticsSetId(id){ try{ saveStr('amv_analytics_id', (id||'').trim()); }catch(e){} }
function _analyticsAllowed(){
  const c=_cookieConsent();
  return !!(c && c.analytics && _analyticsId());
}
let _analyticsLoaded=false;
/* WHETHER THE PROVIDER SCRIPT ACTUALLY LOADED.

   Both providers are injected as third-party <script> tags, and the page's
   Content-Security-Policy `script-src` allows neither googletagmanager.com nor
   plausible.io. So pasting a tracking ID and consenting to analytics did
   nothing at all, silently: the browser blocked the script, no error surfaced,
   and Settings went on showing analytics as configured.

   Widening the CSP is not something to do quietly - a third-party script gets
   the same reach over this page as AMV's own code, and adding analytics is on
   the list of changes that need the owner's say-so. So the block is DETECTED
   and reported instead, and the Privacy screen says the truth: configured, and
   not running, and why. */
function _analyticsBlocked(){ try{ return loadStr('amv_analytics_blocked')==='1'; }catch(e){ return false; } }
function _analyticsMarkBlocked(on){ try{ saveStr('amv_analytics_blocked', on?'1':''); }catch(e){} }
try{ window._analyticsBlocked=_analyticsBlocked; }catch(e){}
function _analyticsInit(){
  if(_analyticsLoaded || !_analyticsAllowed()) return;
  const id=_analyticsId();
  const watch=(s)=>{
    /* A CSP-blocked script fires `error` on the element. So does a network
       failure or an ad-blocker - all three mean the same thing here, which is
       that nothing is being measured. */
    s.addEventListener('error',()=>{ _analyticsLoaded=false; _analyticsMarkBlocked(true); });
    s.addEventListener('load',()=>{ _analyticsMarkBlocked(false); });
  };
  try{
    if(/^G-/i.test(id)){
      const s=document.createElement('script');
      s.async=true; s.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(id);
      watch(s);
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer||[];
      window.gtag = function(){ window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', id, { anonymize_ip:true });
    } else {
      const s=document.createElement('script');
      s.defer=true; s.dataset.domain=id; s.src='https://plausible.io/js/script.js';
      watch(s);
      document.head.appendChild(s);
    }
    _analyticsLoaded=true;
  }catch(e){}
}
// Local conversion-funnel counters, independent of any 3rd-party provider.
function _funnel(){ try{ return JSON.parse(loadStr('amv_funnel')||'')||{visit:0,signup:0,first_msg:0,upgrade:0}; }catch(e){ return {visit:0,signup:0,first_msg:0,upgrade:0}; } }
function _funnelMark(step){
  try{
    const f=_funnel();
    if(!f[step]) f[step]=0;
    f[step]+=1;
    saveStr('amv_funnel', JSON.stringify(f));
  }catch(e){}
}
function _trackEvent(name, data){
  // Always keep the local funnel signal (no consent needed - it's first-party,
  // aggregate counts only, no PII), separate from 3rd-party forwarding below.
  if(name==='page' && data && data.name==='landing') _funnelMark('visit');
  if(name==='signup_complete') _funnelMark('signup');
  if(name==='first_message') _funnelMark('first_msg');
  if(name==='plan_upgrade') _funnelMark('upgrade');
  if(!_analyticsAllowed()) return;
  try{
    if(typeof window.gtag==='function'){
      window.gtag('event', name, Object.assign({}, data||{}));
    } else if(window.plausible){
      window.plausible(name, { props: data||{} });
    } else if(typeof window.plausible!=='function' && document.querySelector('script[data-domain]')){
      // Plausible's script defines window.plausible once loaded; queue until then
      (window.plausible = window.plausible || function(){ (window.plausible.q = window.plausible.q||[]).push(arguments); })(name, {props:data||{}});
    }
  }catch(e){}
}
window._analyticsId=_analyticsId; window._analyticsSetId=_analyticsSetId;
window._analyticsAllowed=_analyticsAllowed; window._analyticsInit=_analyticsInit;
window._funnel=_funnel; window._trackEvent=_trackEvent;
// If consent was already granted in a prior session, load the provider now.
try{ if(_analyticsAllowed()) _analyticsInit(); }catch(e){}




/* ----------------------------------------------
   TARGETED FIXES - added here
   Uses saveStr/loadStr (existing helpers)
   Does NOT override any existing functions
   ---------------------------------------------- */

/* 1. VOICE FIX - mic permission + better errors */
(function(){
  // Keep the copyright year current everywhere it appears - never stale.
  try{ const cy=document.getElementById('copy-year'); if(cy) cy.textContent=String(new Date().getFullYear()); }catch(e){}
})();
(function(){
  const orig = window.toggleVoice;
  window.toggleVoice = function(){
    const btn = $('voice-btn');
    if(!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)){
      toast('Voice needs Chrome or Edge','error',4000); return;
    }
    if(window._isRecording){ try{ window._voiceRec && window._voiceRec.stop(); }catch(e){} return; }
    if(navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
      navigator.mediaDevices.getUserMedia({audio:true})
        .then(s=>{ s.getTracks().forEach(t=>t.stop()); _amvStartVoice(btn); })
        .catch(err=>{ if(err.name==='NotAllowedError') toast('Microphone blocked - allow in browser settings','error',5000); else _amvStartVoice(btn); });
    } else _amvStartVoice(btn);
  };
})();

function _amvStartVoice(btn){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  window._voiceRec = new SR();
  window._voiceRec.continuous = true;
  window._voiceRec.interimResults = true;
  window._voiceRec.lang = 'en-US';
  window._voiceRec.onstart = ()=>{ window._isRecording=true; if(btn){btn.classList.add('rec');} toast('Listening - click mic to stop','info',4000); };
  window._voiceRec.onresult = e=>{
    let final='', interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      if(e.results[i].isFinal) final+=e.results[i][0].transcript;
      else interim+=e.results[i][0].transcript;
    }
    const ta=$('mta');
    if(ta){
      const base=ta.dataset.vb||'';
      ta.value=base+final+(interim?'['+interim+']':'');
      if(final) ta.dataset.vb=base+final;
      ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,130)+'px';
    }
  };
  window._voiceRec.onend = ()=>{
    window._isRecording=false; if(btn) btn.classList.remove('rec');
    const ta=$('mta');
    if(ta){ ta.value=(ta.value||'').replace(/\[.*?\]/g,'').trim(); delete ta.dataset.vb; }
  };
  window._voiceRec.onerror = e=>{
    window._isRecording=false; if(btn) btn.classList.remove('rec');
    const m={'not-allowed':'Mic blocked - allow in browser settings','no-speech':'No speech detected','audio-capture':'No microphone found'};
    if(e.error!=='aborted') toast(m[e.error]||'Voice error: '+e.error,'error',4000);
  };
  try{ window._voiceRec.start(); } catch(e){ toast('Voice failed: '+e.message,'error'); }
}

/* 2. GOOGLE OAUTH - redirect flow (no popup cross-origin errors)
   Security notes (auditor #5):
   - Adds a cryptographic `state` nonce to defend against CSRF on the
     callback (an attacker can't forge a redirect back into your session).
   - Uses the implicit flow (response_type=token) so the app works WITHOUT
     a backend. The honest tradeoff: the Google access token lands in
     localStorage. For a hardened deployment, broker OAuth through the
     Worker (auth-code flow) so the token never reaches the browser - see
     SECURITY-HEADERS.md. We scope the token to the minimum needed and
     expire it aggressively. */
async function connectGoogle(){
  const cid = loadStr('amv_gauth');
  if(!cid){ toast('Add Google Client ID in Settings → Integrations first','error',5000); goSettings('integrations'); return; }
  const scopes = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar';
  const redirectUri = window.location.origin + window.location.pathname;
  saveStr('amv_oauth_return', S.tab||'integrations');

  /* Prefer the AUTH-CODE + PKCE flow: the browser only ever holds a single-use
     code, the exchange happens on our server where the secret lives, and the
     refresh token never reaches the browser at all. The implicit flow below is
     kept only as a fallback for deployments with no backend yet - it puts the
     access token in the URL fragment, where it lands in history and referrers. */
  const canExchange = !!(window.AMV_API && AMV_API.live && AMV_API.token);
  if(canExchange && typeof _pkceChallenge === 'function'){
    try{
      const p = await _pkceChallenge('google');
      const url = 'https://accounts.google.com/o/oauth2/v2/auth'
        + '?client_id=' + encodeURIComponent(cid)
        + '&redirect_uri=' + encodeURIComponent(redirectUri)
        + '&response_type=code'
        + '&scope=' + encodeURIComponent(scopes)
        + '&code_challenge=' + encodeURIComponent(p.challenge)
        + '&code_challenge_method=S256'
        + '&access_type=offline&prompt=consent'
        + '&state=' + encodeURIComponent(p.state);
      window.location.href = url;
      return;
    }catch(e){ /* fall through to the legacy flow rather than blocking sign-in */ }
  }
  const state = _oauthTxStart('google', '');   // AMV-039: provider-bound, per-attempt state
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?client_id='+encodeURIComponent(cid)+'&redirect_uri='+encodeURIComponent(redirectUri)+'&response_type=token&scope='+encodeURIComponent(scopes)+'&prompt=consent&state='+encodeURIComponent(state);
  window.location.href = url;
}
function checkOAuthCallback(){
  /* AUTH-CODE return (?code=...&state=...). The code is single-use and useless
     without the verifier, which never left this browser. We hand both to our
     own server, which does the exchange with the client secret. */
  try{
    const q = new URLSearchParams(window.location.search || '');
    if(q.get('code') && q.get('state')){
      const st = q.get('state');
      const pk = (typeof _pkceConsume === 'function') ? _pkceConsume(st, 'google') : { ok:false };
      history.replaceState(null, '', window.location.pathname);
      if(!pk.ok || !pk.verifier){
        toast('Sign-in could not be verified. Please try connecting again.','error',5000);
        return;
      }
      const base = (loadStr('amv_api_base')||'').replace(/\/$/,'');
      const tok = loadStr('amv_api_token')||'';
      fetch(base + '/v1/oauth/google/exchange', {
        method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},
        body: JSON.stringify({ code:q.get('code'), verifier:pk.verifier,
          redirect_uri: window.location.origin + window.location.pathname })
      }).then(r=>r.json()).then(d=>{
        if(!d || !d.ok || !d.access_token) throw new Error(d && (d.error||d.need) || 'exchange failed');
        saveStr('amv_gtoken', d.access_token);
        saveStr('amv_gtoken_exp', String(Date.now() + ((d.expires_in||3600)-60)*1000));
        try{ saveStr('amv_google_connected','1'); }catch(e){}
        toast('Google connected','success');
        try{ const back=loadStr('amv_oauth_return'); if(back) setTab(back); }catch(e){}
        try{ if(typeof renderIntegrationsView==='function' && S.tab==='integrations') renderIntegrationsView(); }catch(e){}
      }).catch(err=>{
        toast('Google sign-in could not be completed. '+(err&&err.message?String(err.message).slice(0,80):''),'error',5000);
      });
      return;
    }
    if(q.get('error') && q.get('state')){
      history.replaceState(null,'',window.location.pathname);
      toast('Google sign-in was cancelled or failed.','info',4000);
      return;
    }
  }catch(e){}

  const hash = window.location.hash;
  if(!hash || hash.indexOf('access_token')<0) return;
  const params = new URLSearchParams(hash.slice(1));
  // CSRF: validate the returned state against the per-attempt, provider-bound
  // transaction we stored before redirect (AMV-039 - single-use, expiring).
  const returnedState = params.get('state')||'';
  const tx = _oauthTxConsume(returnedState, 'google');
  if(!tx){
    history.replaceState(null,'',window.location.pathname);
    toast('Sign-in could not be verified. Please try connecting again.','error',5000);
    return;
  }
  if(params.get('error')){
    history.replaceState(null,'',window.location.pathname);
    toast('Google sign-in was cancelled or failed.','info',4000);
    return;
  }
  const token = params.get('access_token');
  const exp = parseInt(params.get('expires_in')||'3600');
  if(token){
    saveStr('amv_gtoken', token);
    saveStr('amv_gtoken_exp', String(Date.now()+(exp-60)*1000));
    history.replaceState(null,'',window.location.pathname);
    const ret = loadStr('amv_oauth_return')||'integrations';
    localStorage.removeItem('amv_oauth_return');
    toast('Google connected! Gmail, Drive & Calendar active.','success',5000);
    setTimeout(()=>setTab(ret), 500);
  }
}
/* Silently renew the Google access token from the refresh token held on the
   server. Without this a user who connected once is disconnected an hour
   later - which quietly breaks every standing job that runs overnight, the
   exact time nobody is watching. Only possible on the auth-code flow, since
   the implicit flow never issues a refresh token. */
let _gRefreshInFlight = null;
async function refreshGToken(){
  if(_gRefreshInFlight) return _gRefreshInFlight;
  const base = (loadStr('amv_api_base')||'').replace(/\/$/,'');
  const tok = loadStr('amv_api_token')||'';
  if(!base || !tok) return null;
  _gRefreshInFlight = (async () => {
    try{
      const r = await fetchDeadline(base + '/v1/oauth/google/refresh', {
        method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok}, body:'{}' });
      const d = await r.json().catch(()=>({}));
      if(!r.ok || !d.ok || !d.access_token) return null;
      saveStr('amv_gtoken', d.access_token);
      saveStr('amv_gtoken_exp', String(Date.now() + ((d.expires_in||3600)-60)*1000));
      return d.access_token;
    }catch(e){ return null; }
    finally{ _gRefreshInFlight = null; }
  })();
  return _gRefreshInFlight;
}
/* Await a USABLE token - refreshing first if it has expired or is about to.
   Anything that is going to call Google should use this rather than the
   synchronous getGToken(). */
async function ensureGToken(){
  const tok = loadStr('amv_gtoken');
  const exp = parseInt(loadStr('amv_gtoken_exp')||'0');
  // renew a couple of minutes early so a long job never expires mid-run
  if(tok && exp && Date.now() < exp - 120000) return tok;
  const fresh = await refreshGToken();
  if(fresh) return fresh;
  return getGToken();
}
function getGToken(){
  const token = loadStr('amv_gtoken'); if(!token) return null;
  const exp = parseInt(loadStr('amv_gtoken_exp')||'0');
  if(!exp) return token;
  if(Date.now()<exp) return token;
  // Expired. Try to renew in the background so the NEXT call succeeds instead
  // of forcing the user to reconnect, but do not hand back a dead token now.
  try{ refreshGToken(); }catch(e){}
  localStorage.removeItem('amv_gtoken'); localStorage.removeItem('amv_gtoken_exp'); return null;
}
try{ window.refreshGToken=refreshGToken; window.ensureGToken=ensureGToken; }catch(e){}
function disconnectGoogle(){
  localStorage.removeItem('amv_gtoken'); localStorage.removeItem('amv_gtoken_exp');
  toast('Google disconnected','info');
  if(S.tab==='integrations') renderIntegrationsView();
}
window.disconnectGoogle=disconnectGoogle;
/* Real Gmail/Calendar/Drive actions - open in chat */
