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
  const before = JSON.stringify([load('amv_handoffs_in') || [], load('amv_handoffs_out') || []]);
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
    /* Only if they are still on it - see _crewSyncLive - AND only if the sync
       actually changed something. Polling that returns the same two lists is
       the common case, and redrawing the whole screen to display what is
       already on it is the entire complaint this round started with. */
    const after = JSON.stringify([load('amv_handoffs_in') || [], load('amv_handoffs_out') || []]);
    if(S.tab === 'handoff' && after !== before) _reRenderSoon(renderHandoffView, 'handoff');
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
      <p class="vsub">Don\u2019t describe the work - hand over the work itself. Pull in a conversation, a Studio design, a Dev project or Lab code, or paste anything at all; your teammate or a Crew agent picks it up inside AMV with full context, makes the change, and hands it back.</p>
      <div class="ho-flow"><span class="ho-flow-step">You paste the work</span><span class="ho-flow-arrow">\u2192</span><span class="ho-flow-step">They pick up the baton</span><span class="ho-flow-arrow">\u2192</span><span class="ho-flow-step">Handed back</span></div>

      <div class="ss2">
        <h3>Hand something off</h3>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div><label class="lbl" style="font-size:var(--t-xs);color:var(--mu)">What are you handing off?</label>
            <input id="ho-title" placeholder="e.g. Finish the Q3 report intro" style="width:100%;background:var(--glass);border:1px solid var(--glass-bd);border-radius:var(--r-md);padding:12px;color:var(--tx);font-family:var(--fn);font-size:var(--t-md)"></div>
          <div><label class="lbl" style="font-size:var(--t-xs);color:var(--mu)">The work itself - paste it here</label>
            <textarea id="ho-ctx" placeholder="Paste the draft, code, data or thread" style="width:100%;min-height:220px;background:var(--glass);border:1px solid var(--glass-bd);border-radius:var(--r-md);padding:12px;color:var(--tx);font-family:var(--mn,ui-monospace,monospace);font-size:var(--t-base);line-height:1.6;resize:vertical;tab-size:2"></textarea>
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
              <button class="btn bs" data-dact="_hoPickChat" style="font-size:var(--t-sm)">Pull in your work…</button>
              <span style="font-size:var(--t-xs);color:var(--mu);align-self:center">a conversation, a design, a project or some code - or just paste anything above</span></div>
            </div>
            <!-- INSTRUCTIONS BELONG WHERE THEY SURVIVE TYPING.
                 This guidance used to BE the placeholder - 209 characters of it,
                 of which a phone showed 25. A placeholder is the worst place for
                 an instruction twice over: it is clipped to the width of the box,
                 and it vanishes the moment somebody starts typing, which is
                 exactly when they need it. It sits AFTER the button row, never
                 inside it - that row is display:flex, so a child of it would line
                 up beside the button instead of below the field. -->
            <div style="font-size:var(--t-xs);color:var(--mu);line-height:1.55;margin-top:8px">
              Whatever the next person - or the agent - picks up and continues: the draft,
              the code, the data, the email thread, the brief. Add anything they need to
              know to carry on.
            </div></div>
          <div><label class="lbl" style="font-size:var(--t-xs);color:var(--mu)">Hand off to</label>
            <input id="ho-to" placeholder="teammate@email.com - or type: crew" style="width:100%;background:var(--glass);border:1px solid var(--glass-bd);border-radius:var(--r-md);padding:12px;color:var(--tx);font-family:var(--fn);font-size:var(--t-md)"></div>
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

  r.innerHTML='<div class="ov" id="hopick-bg"><div class="ob hopick-modal" style="max-width:520px">'+
    '<button class="oc" data-dact="closeOvr" aria-label="Close">×</button>'+
    '<h2 style="margin:0 0 4px">Pull in your work</h2>'+
    '<p style="font-size:var(--t-sm);color:var(--mu);margin:0 0 14px">A conversation, a design, a project or some code. '+
      'The actual content comes across, not a description of it.</p>'+
    (sessRows?'<div class="hopick-h">Designs, projects and code</div><div class="hopick-list">'+sessRows+'</div>':'')+
    (chatRows?'<div class="hopick-h">Conversations</div><div class="hopick-list">'+chatRows+'</div>':'')+
    '</div></div>';
  onBackdrop($('hopick-bg'),closeOvr);
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
/* hoFromChat lived here, exported and referenced by nothing. */

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

