/* HANDOFF'S SCREEN - fetched the first time Handoff is drawn (published as
   handoff-view.js). The page keeps four small stand-ins in src/app/12-handoff.js:
   renderHandoffView (replaced by this file's, on purpose), and the three
   entry points the rest of the app calls - sync, save back, bring in - which
   do nothing at all unless this device holds handed-over work. */
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

async function _hoSyncNow(){
  if(!(window.AMV_API && AMV_API.live)) return;
  const before = JSON.stringify([load('amv_handoffs_in') || [], load('amv_handoffs_out') || []]);
  try{ const d=await AMV_API.listHandoff();
    if(d.incoming) store('amv_handoffs_in', d.incoming.map(h=>({id:h.id,from:h.from_email,title:h.title,context:h.context,when:'',item:h.item||null})));
    if(d.sent){
      /* Merged, not replaced. A handoff that never reached the server is not IN
         the server's list, so overwriting wholesale deleted the undelivered
         ones - taking the pasted work with them, and leaving nothing to retry
         and no sign anything had been lost. Those are kept; everything the
         server knows about is its version. */
      const keep=_hoOut().filter(h=>h && (_HO_UNSENT.indexOf(h.status)>=0 || h.status==='crew'));
      const fromServer=d.sent.map(h=>({id:h.id,to:h.to_email,title:h.title,status:h.status,when:'',item:h.item||null}));
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
        <span class="ho-when">${escH(h.when||'')}</span>
      </div>
      <div class="ho-t">${escH(h.title)}</div>
      ${h.item?_hoWorkCardHTML(h.item, h.id):''}
      <div class="ho-ctx">${escH(h.context||'').slice(0,180)}${(h.context||'').length>180?'…':''}</div>
      <div class="ho-act">
        ${dir==='in'
          ? `<button class="btn bp" data-dact="hoOpen" data-darg="${escH(h.id)}">${h.item?escH(T(_HO_OPEN[h.item.kind]||'Open')):'Open & continue'}</button><button class="btn bs" data-dact="hoDone" data-darg="${escH(h.id)}">Mark done</button>`
          : (h.item?`<button class="btn bs" data-dact="hoOpen" data-darg="${escH(h.id)}">${escH(T(_HO_OPEN[h.item.kind]||'Open'))}</button>`:'')+
            `<span class="ho-status ho-status-${escH(h.status||'waiting')}">${escH(_HO_STATUS[h.status]||_HO_STATUS.waiting)}</span>`+
            (_HO_UNSENT.indexOf(h.status)>=0
              ? `<button class="btn bs" data-dact="hoResend" data-darg="${escH(h.id)}">Send again</button>` : '')}
      </div>
    </div>`;
  vc.innerHTML=`<div class="sv fi"><div class="vi ho-page">
      <span class="eyebrow">Collaboration</span>
      <h2>Handoff</h2>
      <p class="vsub">Don\u2019t describe the work - hand over the work itself. Pull in a conversation, a design, an app or some code, or paste anything at all; your teammate or a Crew agent picks it up inside AMV with full context, makes the change, and hands it back.</p>
      <div class="ho-flow"><span class="ho-flow-step">You paste the work</span><span class="ho-flow-arrow">\u2192</span><span class="ho-flow-step">They pick up the baton</span><span class="ho-flow-arrow">\u2192</span><span class="ho-flow-step">Handed back</span></div>

      <div class="ss2">
        <h3>Hand something off</h3>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div><label class="lbl" style="font-size:var(--t-xs);color:var(--mu)">What are you handing off?</label>
            <input id="ho-title" placeholder="e.g. Finish the Q3 report intro" style="width:100%;background:var(--glass);border:1px solid var(--glass-bd);border-radius:var(--r-md);padding:12px;color:var(--tx);font-family:var(--fn);font-size:var(--t-md)"></div>
          <div><label class="lbl" style="font-size:var(--t-xs);color:var(--mu)">${escH(T('The work'))}</label>
            <div id="ho-work">${S._hoPulled?_hoWorkCardHTML(S._hoPulled, '', true):''}</div>
            <textarea id="ho-ctx" placeholder="${escH(T('Notes for them - or paste the draft, code, data or thread'))}" style="width:100%;min-height:220px;background:var(--glass);border:1px solid var(--glass-bd);border-radius:var(--r-md);padding:12px;color:var(--tx);font-family:var(--mn,ui-monospace,monospace);font-size:var(--t-base);line-height:1.6;resize:vertical;tab-size:2"></textarea>
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
              <button class="btn bs" data-dact="_hoPickChat" style="font-size:var(--t-sm)">Pull in your work…</button>
              <span style="font-size:var(--t-xs);color:var(--mu);align-self:center">${escH(T('a conversation, a design, a project or some code - it goes across as itself, and opens in AMV for them'))}</span></div>
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
    return '[Design]\n'+
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
    return '[App]\n'+
      (asked?('What was asked for:\n'+asked+'\n\n'):'')+
      (files.length?('Files ('+files.length+'):\n'+files.join(', ')+'\n\n'+body):cap(st.curCode,8000));
  }
  if(rec.kind==='lab'){
    const said=(st.chat||[]).slice(-4).map(m=>(m.role==='user'?'You: ':'AMV: ')+cap(m.text||m.content,200)).join('\n');
    return '[Code'+(st.lang?' - '+st.lang:'')+']\n'+
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

/* PULLED IN AS ITSELF (owner, Nov 24: "it doesn't just pull in text ... it
   pulls in a link, so when you click it it goes on the chat"). Pulling a chat
   or a design attaches it to the handoff as a card; sending stores it once on
   the server, shared by exactly the two people, and each side opens it as the
   real thing. The notes box stays for what they need to know. */
function _hoPullSession(id){
  const rec=((typeof _SESSIONS!=='undefined'&&_SESSIONS)||[]).find(x=>x&&x.id===id);
  if(!rec){ toast('That work could not be found','error'); return; }
  if(!_hoSessText(rec)){ toast('There is nothing in that yet','info'); return; }
  S._hoPulled={ kind:rec.kind, ref:rec.id, title:rec.title||'Untitled' };
  _hoShowPulled();
  if($('ho-title') && !$('ho-title').value) $('ho-title').value=rec.title||'Continue this work';
  toast(T('Attached “{0}”').replace('{0}', rec.title||'your work'),'success');
}
try{ window._hoPullSession=_hoPullSession; window._hoSessText=_hoSessText; }catch(e){}
function _hoPullConv(convId){
  const conv=(S.convs||[]).find(c=>c.id===convId); if(!conv){ toast('Chat not found','error'); return; }
  S._hoPulled={ kind:'chat', ref:convId, title:conv.title||'Chat' };
  _hoShowPulled();
  if($('ho-title') && !$('ho-title').value) $('ho-title').value=conv.title||'Continue this conversation';
  toast(T('Attached “{0}”').replace('{0}', conv.title||'chat'),'success');
}
function _hoShowPulled(){
  const w=$('ho-work'); if(!w) return;
  w.innerHTML=S._hoPulled?_hoWorkCardHTML(S._hoPulled,'',true):'';
}
function hoUnpull(){ S._hoPulled=null; _hoShowPulled(); }
window.hoUnpull=hoUnpull;
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
  /* The work, read from where it lives NOW - a retry sends what is there at
     the retry, not a copy frozen when the first attempt failed. */
  const work = rec.work ? _hoWorkData(rec.work) : null;
  if(rec.work && !work) return { status:'failed', error:'The attached work is no longer on this device.' };
  try{
    const d = await AMV_API.createHandoff({ title:rec.title, context:rec.context, to:rec.to,
      ...(work ? { item:{ kind:rec.work.kind, title:rec.work.title, data:work } } : {}) });
    /* Your own copy is now linked to the shared one: what they do comes back
       to it, and what you do goes to them. */
    if(work && d && d.id) _hoLink(rec.work, d.id, 1, 'from');
    return { status:'waiting', id:d && d.id };
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
  const work=S._hoPulled||null;
  const rec={ id:'h'+Date.now(), title:t.trim(), context:(ctx||'').trim(), to:to.trim(),
    from:(S.user&&S.user.email)||'you', when:new Date().toLocaleDateString(), status:'sending',
    ...(work ? { work:{ kind:work.kind, ref:work.ref, title:work.title }, item:{ kind:work.kind, title:work.title } } : {}) };
  try{ S._hoPulled=null; }catch(e){}

  // Handing to Crew is local by design - it lands in your OWN approvals queue,
  // so there is nothing to deliver and nothing that can fail to arrive.
  if(to.trim().toLowerCase()==='crew'){
    rec.status='crew';
    /* An agent reads text, so the attached work goes to it as text. */
    if(work){ const txt=_hoWorkText(work); if(txt) rec.context=(rec.context?rec.context+'\n\n':'')+txt; }
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
  if(r.id){ const o=_hoOut(); const x=o.find(y=>y.id===rec.id); if(x){ x.id=r.id; _hoSaveOut(o); } }
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
  /* Work that came with it opens as itself - for whoever received it, and
     for whoever sent it, to see what came back. */
  const hw=_hoIn().find(x=>x.id===id) || _hoOut().find(x=>x.id===id);
  if(hw && hw.item){ _hoOpenItem(id); return; }
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
  /* Handed to yourself: the sent copy on this device says done at once,
     without waiting for the next sync to bring the server's word back. */
  if(res.ok){ const o=_hoOut(); if(o.some(x=>x && x.id===id)) _hoSaveOut(o.map(x=>x && x.id===id ? Object.assign({}, x, { status:'done' }) : x)); }
  toast(res.ok ? 'Marked done'
              : 'Marked done here. Whoever sent it will see that once AMV is connected to a backend.',
        'info', res.ok?2500:6000);
  renderHandoffView();
}
window.hoSend=hoSend;window.hoOpen=hoOpen;window.hoDone=hoDone;


/* ============================================================
   HANDED-OVER WORK, LIVE ON BOTH SIDES (owner, Nov 24).

   A handoff with work attached stores it once on the server (hoitem,
   26-crew-sync.js), shared by the sender and the recipient only. Each side
   holds an ordinary chat or design on their own device, linked to that copy
   by `ho = { id, v, role, sig }`:
     · opening it (from the card, or by opening the chat) fetches the copy and
       brings in what the other person added;
     · a change saves back a moment later, as version v+1 on top of v;
     · if the other person saved first, the save is refused with their copy -
       a chat is merged by message (both people's messages kept, in order) and
       saved again; a design or code takes their newer version, and yours is
       kept beside it as "your version", so nothing is lost without a word.
   ============================================================ */
const _HO_KIND = { chat:'Chat', studio:'Design', dev:'Project', lab:'Code' };
const _HO_OPEN = { chat:'Open the chat', studio:'Open the design', dev:'Open the project', lab:'Open the code' };
const _HO_ICON = { chat:'default', studio:'palette', dev:'app', lab:'code' };
function _hoWorkCardHTML(item, hid, removable){
  const k = (item && item.kind) || 'chat';
  const ic = k === 'chat'
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
    : _lineIcon(_HO_ICON[k]||'default');
  return '<div class="ho-work">'+
    '<span class="ho-work-ic" aria-hidden="true">'+ic+'</span>'+
    '<span class="ho-work-b"><span class="ho-work-k">'+escH(T(_HO_KIND[k]||'Work'))+'</span>'+
    '<span class="ho-work-t">'+escH((item && item.title) || 'Untitled')+'</span></span>'+
    (removable ? '<button type="button" class="ho-work-x" data-dact="hoUnpull" aria-label="'+escH(T('Remove the attached work'))+'">×</button>' : '')+
  '</div>';
}
/* The local record a piece of work is: a chat in S.convs, or a design,
   project or code in _SESSIONS. */
function _hoLocalByRef(kind, ref){
  if(kind === 'chat') return (S.convs||[]).find(c => c && c.id === ref) || null;
  return ((typeof _SESSIONS !== 'undefined' && _SESSIONS) || []).find(x => x && x.id === ref) || null;
}
function _hoFindLocal(hid){
  const c = (S.convs||[]).find(x => x && x.ho && x.ho.id === hid);
  if(c) return { kind:'chat', rec:c };
  const s = ((typeof _SESSIONS !== 'undefined' && _SESSIONS) || []).find(x => x && x.ho && x.ho.id === hid);
  return s ? { kind:s.kind, rec:s } : null;
}
/* Every message carries an id, so two people's copies merge by message. */
function _hoMsgId(m){ if(m && !m.id) m.id = 'm' + Date.now().toString(36) + _rid(5); return m.id; }
/* What goes to the server: text and the document's own blocks, with pictures
   left out - a picture is large, and the other person cannot use the device
   file it came from anyway. */
function _hoMsgOut(m){
  _hoMsgId(m);
  let c = m.c;
  if(Array.isArray(c)) c = c.map(b => (b && (b.type === 'image' || b.type === 'document') ? { type:'text', text:'[' + (b.type === 'image' ? 'picture' : 'file') + ' not handed over]' } : b));
  const o = { id:m.id, r:m.r, c };
  if(m.d != null && typeof m.d === 'string') o.d = m.d;
  if(m.by) o.by = m.by;
  return o;
}
function _hoChatMsgs(conv){ return (conv.msgs||[]).filter(m => m && (m.r === 'u' || m.r === 'a') && !m.streaming && !m._quota); }
function _hoDataOf(kind, rec){
  if(!rec) return null;
  if(kind === 'chat'){ const msgs = _hoChatMsgs(rec).map(_hoMsgOut); return msgs.length ? { msgs } : null; }
  return rec.state ? { state: rec.state } : null;
}
function _hoWorkData(work){ return _hoDataOf(work.kind, _hoLocalByRef(work.kind, work.ref)); }
function _hoWorkText(work){
  const r = _hoLocalByRef(work.kind, work.ref); if(!r) return '';
  return work.kind === 'chat' ? _hoConvText(r) : _hoSessText(r);
}
/* What the copy looks like now, to tell whether it changed since it was saved. */
function _hoSig(kind, rec){
  if(kind === 'chat'){
    const m = _hoChatMsgs(rec); const last = m[m.length-1];
    const lc = last ? (typeof last.c === 'string' ? last.c.length : JSON.stringify(last.c||'').length) : 0;
    return m.length + ':' + (last ? (last.id||'') : '') + ':' + lc;
  }
  return String(rec.updated || 0);
}
function _hoSave(kind){ if(kind === 'chat'){ try{ _autoSave(); }catch(e){} } else { try{ _persistSessions(); }catch(e){} } }
function _hoLink(work, hid, v, role){
  const rec = _hoLocalByRef(work.kind, work.ref); if(!rec) return;
  if(work.kind === 'chat') _hoChatMsgs(rec).forEach(_hoMsgId);
  rec.ho = { id:hid, v, role, sig:'' };
  rec.ho.sig = _hoSig(work.kind, rec);
  _hoSave(work.kind);
}
/* Bring the shared copy into a local one. Returns { changed, ahead } - ahead
   means this side still has work the server has not got. */
function _hoApply(kind, rec, item){
  const ho = rec.ho || {};
  if(kind === 'chat'){
    const mine = _hoChatMsgs(rec); mine.forEach(_hoMsgId);
    const theirs = (item.data && item.data.msgs) || [];
    const ids = new Set(theirs.map(m => m.id));
    const byId = new Map(mine.map(m => [m.id, m]));
    const merged = theirs.map(m => byId.get(m.id) || Object.assign({}, m)).concat(mine.filter(m => !ids.has(m.id)));
    const ahead = mine.some(m => !ids.has(m.id));
    const changed = merged.length !== mine.length || merged.some((m, i) => m !== mine[i]);
    if(changed){ const extra = (rec.msgs||[]).filter(m => m && (m.streaming || m._quota)); rec.msgs = merged.concat(extra); }
    rec.ho = Object.assign({}, ho, { v:item.v });
    if(!ahead) rec.ho.sig = _hoSig('chat', rec);
    return { changed, ahead };
  }
  if(+item.v <= +(ho.v || 0)) return { changed:false, ahead: ho.sig !== _hoSig(kind, rec) };
  const dirty = ho.sig && ho.sig !== _hoSig(kind, rec);
  if(dirty){
    /* Both changed it: theirs becomes this one, yours is kept beside it. */
    const copy = { id:'sess_' + Date.now().toString(36) + _rid(3), kind, title:T('{0} (your version)').replace('{0}', rec.title || 'Untitled'),
                   updated:Date.now(), state: rec.state };
    try{ _SESSIONS.push(copy); }catch(e){}
    toast(T('They saved a newer version, so that is the one here now. Yours is kept as “{0}”.').replace('{0}', copy.title), 'info', 8000);
  }
  rec.state = (item.data && item.data.state) || rec.state;
  rec.updated = Date.now();
  rec.ho = Object.assign({}, ho, { v:item.v });
  rec.ho.sig = _hoSig(kind, rec);
  return { changed:true, ahead:false };
}
function _hoShowIfOpen(kind, rec){
  try{
    if(kind === 'chat'){ if(S.tab === 'chat' && S.cur === rec.id) setTab('chat'); }
    else if(typeof _activeSession !== 'undefined' && _activeSession[kind] === rec.id) _sessResume(rec.id);
  }catch(e){ try{ console.error('AMV: handed-over work could not be redrawn', e); }catch(_){} }
}
const _hoWho = item => (item && item.by && item.by !== ((S.user && S.user.email) || '')) ? item.by : '';

/* Open handed-over work as itself. */
async function _hoOpenItem(hid){
  let found = _hoFindLocal(hid);
  let item = null;
  if(window.AMV_API && AMV_API.live){
    try{ item = await AMV_API.handoffItem(hid); }
    catch(e){ if(!found){ toast((e && e.message) || T('That work could not be opened.'), 'error', 6000); return; } }
  } else if(!found){
    toast(T('Opening handed-over work needs AMV’s server, and this copy is not connected to one.'), 'info', 6000); return;
  }
  const me = (S.user && S.user.email) || '';
  if(!found && item){
    const role = item.from === me ? 'from' : 'to';
    let rec;
    if(item.kind === 'chat'){
      rec = newConvObj(item.title);
      rec.msgs = ((item.data && item.data.msgs) || []).map(m => Object.assign({}, m));
      S.convs.unshift(rec);
    } else {
      rec = { id:'sess_' + Date.now().toString(36) + _rid(3), kind:item.kind, title:item.title || 'Untitled', updated:Date.now(),
              state:(item.data && item.data.state) || {} };
      _SESSIONS.push(rec);
    }
    rec.ho = { id:hid, v:item.v, role, sig:'' };
    rec.ho.sig = _hoSig(item.kind, rec);
    _hoSave(item.kind);
    found = { kind:item.kind, rec };
  } else if(found && item){
    const r = _hoApply(found.kind, found.rec, item);
    if(r.changed){ _hoSave(found.kind); if(_hoWho(item)) toast(T('Updated with {0}’s latest work').replace('{0}', _hoWho(item)), 'success'); }
    if(r.ahead) _hoPushSoon(true);
  }
  if(!found) return;
  if(found.kind === 'chat') loadConv(found.rec.id);
  else _sessResume(found.rec.id);
}
window._hoOpenItem = _hoOpenItem;

/* Opening a linked chat or design, or coming back to AMV: bring in what the
   other person did since. Quiet when nothing changed. */
async function _hoPullIntoNow(localId){
  if(!(window.AMV_API && AMV_API.live)) return;
  const c = (S.convs||[]).find(x => x && x.id === localId && x.ho);
  const s = c ? null : ((typeof _SESSIONS !== 'undefined' && _SESSIONS) || []).find(x => x && x.id === localId && x.ho);
  const rec = c || s; if(!rec) return;
  const kind = c ? 'chat' : s.kind;
  let item; try{ item = await AMV_API.handoffItem(rec.ho.id); }catch(e){ return; }
  if(!(+item.v > +(rec.ho.v || 0))) return;
  const r = _hoApply(kind, rec, item);
  if(r.changed){ _hoSave(kind); _hoShowIfOpen(kind, rec); if(_hoWho(item)) toast(T('Updated with {0}’s latest work').replace('{0}', _hoWho(item)), 'success'); }
  if(r.ahead) _hoPushSoon(true);
}
window._hoPullIntoNow = _hoPullIntoNow;

/* Save back what changed, a moment after it changed. Called whenever the
   history list redraws (after every chat turn and every design save); does
   nothing at all when no handed-over work is on this device. */
let _hoPushT = null, _hoPushing = false, _hoLastPull = 0;
function _hoPushSoon(now){
  if(!(window.AMV_API && AMV_API.live)) return;
  const any = (S.convs||[]).some(c => c && c.ho) || ((typeof _SESSIONS !== 'undefined' && _SESSIONS) || []).some(x => x && x.ho);
  if(!any) return;
  clearTimeout(_hoPushT);
  _hoPushT = setTimeout(_hoPushAll, now ? 50 : 1500);
}
async function _hoPushAll(){
  if(_hoPushing) return; _hoPushing = true;
  try{
    const linked = (S.convs||[]).filter(c => c && c.ho).map(c => ({ kind:'chat', rec:c }))
      .concat(((typeof _SESSIONS !== 'undefined' && _SESSIONS) || []).filter(x => x && x.ho).map(x => ({ kind:x.kind, rec:x })));
    for(const { kind, rec } of linked){
      if(kind === 'chat' && (rec.msgs||[]).some(m => m && m.streaming)) continue;
      if(rec.ho.sig === _hoSig(kind, rec)) continue;
      await _hoPushOne(kind, rec, 0);
    }
    /* And, at most once a minute, what the other person did. */
    if(Date.now() - _hoLastPull > 60000){
      _hoLastPull = Date.now();
      for(const { rec } of linked){ try{ await _hoPullIntoNow(rec.id); }catch(e){} }
    }
  } finally { _hoPushing = false; }
}
async function _hoPushOne(kind, rec, depth){
  const data = _hoDataOf(kind, rec); if(!data) return;
  let r;
  try{ r = await AMV_API.handoffItemSave(rec.ho.id, rec.ho.v, data); }
  catch(e){ try{ console.warn('AMV: handed-over work was not saved back yet - it will be tried again', e); }catch(_){} return; }
  if(r && r.stale){
    const a = _hoApply(kind, rec, r.item);
    _hoSave(kind); if(a.changed) _hoShowIfOpen(kind, rec);
    if(a.ahead && depth < 2) await _hoPushOne(kind, rec, depth + 1);
    return;
  }
  rec.ho = Object.assign({}, rec.ho, { v:r.v });
  rec.ho.sig = _hoSig(kind, rec);
  _hoSave(kind);
}
window._hoPushSoon = _hoPushSoon; window._hoSyncNow = _hoSyncNow;
