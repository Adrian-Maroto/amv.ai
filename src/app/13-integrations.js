/* ============================================================
   AUTONOMOUS INTEGRATION ACTIONS - the real "does the work" layer.
   AMV can READ and ACT across connected accounts via these executable
   tools. The AI is given the tool list, decides what to do, and we
   execute the calls against the provider APIs with the user's token.
   ============================================================ */
const INTEGRATION_ACTIONS = {
  /* ---- SCHOOL --------------------------------------------------------------

     What a student has been set, and when it is due, read from Google
     Classroom. This is the piece that turns "tell AMV your deadlines every
     week" into "AMV already knows", which is the difference between a planner
     somebody maintains and one that maintains itself.

     Read-only, by scope rather than by rule: AMV was never granted permission
     to turn anything in, so it cannot, and no instruction can talk it into
     doing so. Deliberately so - this is a minor's school record, and the
     narrowest access that does the job is the only one worth asking for.

     It reads from THIS BROWSER, like the mailbox and the calendar, because the
     Google token lives here and the server never sees it. So a job built on it
     runs while AMV is open and says so, rather than implying an overnight run
     it cannot perform. */
  classroom_due: {
    desc:'List what the user has been set at school and when it is due, from Google Classroom. Read-only.',
    needs:'google',
    async run(){
      const t=(typeof ensureGToken==='function'? await ensureGToken() : getGToken());
      if(!t) throw new Error('Google Classroom is not connected');
      const cr=await fetchDeadline('https://classroom.googleapis.com/v1/courses?studentId=me&courseStates=ACTIVE&pageSize=20',{headers:{'Authorization':'Bearer '+t}});
      const cd=await cr.json();
      if(cd.error) throw new Error(cd.error.message);
      const courses=(cd.courses||[]).slice(0,12);
      if(!courses.length) return { courses:0, items:[] };

      const now=Date.now();
      /* A CLASS THAT COULD NOT BE READ IS NOT A CLASS WITH NOTHING DUE.

         Swallowing a failed per-course read and returning nothing for it turns
         "Chemistry did not load" into "Chemistry has nothing due" - on a screen
         somebody plans their week from. The student misses the deadline and
         AMV told them, confidently, that there wasn't one.

         So a failure is recorded and reported. Reading five classes out of six
         is genuinely useful and worth returning; presenting it as all six is
         the part that is not. */
      const unread=[];
      const per=await Promise.all(courses.map(async c=>{
        try{
          const r=await fetchDeadline('https://classroom.googleapis.com/v1/courses/'+encodeURIComponent(c.id)
            +'/courseWork?pageSize=30&orderBy=dueDate%20asc',{headers:{'Authorization':'Bearer '+t}});
          const d=await r.json();
          if(d.error){ unread.push(c.name||c.id); return []; }
          return (d.courseWork||[]).map(w=>{
            /* Google gives the date and time separately, and either may be
               absent. A piece of work with no due date is real and common -
               reported as having none rather than given an invented one. */
            let due=null;
            if(w.dueDate && w.dueDate.year){
              const tm=w.dueTime||{};
              due=Date.UTC(w.dueDate.year,(w.dueDate.month||1)-1,w.dueDate.day||1,
                           tm.hours||23,tm.minutes||59);
            }
            return { course:c.name||'', title:w.title||'', due,
                     dueText: due ? new Date(due).toISOString().slice(0,10) : 'no due date',
                     link:w.alternateLink||'', points:w.maxPoints||null };
          });
        }catch(e){ unread.push(c.name||c.id); return []; }
      }));
      const items=per.flat()
        /* Only what is still ahead of them. A planner listing last term's work
           is noise, and noise is what stops somebody reading it. */
        .filter(x=>x.due===null || x.due>=now-86400000)
        .sort((a,b)=>(a.due||Infinity)-(b.due||Infinity))
        .slice(0,40);
      return { courses:courses.length, items, unread,
               /* Said in words as well as in a field, because the field is
                  what a caller checks and the sentence is what reaches the
                  person. */
               note: unread.length
                 ? 'Could not read ' + unread.length + ' of ' + courses.length + ' classes ('
                   + unread.join(', ') + '). Anything set in those is NOT in this list.'
                 : '' };
    }
  },
  gmail_list_unread: {
    desc:'List the user\u2019s unread emails (sender + subject).', needs:'google',
    async run(){
      const t=(typeof ensureGToken==='function'? await ensureGToken() : getGToken()); if(!t) throw new Error('Gmail not connected');
      const r=await fetchDeadline('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&labelIds=INBOX&q=is:unread',{headers:{'Authorization':'Bearer '+t}});
      const d=await r.json(); if(d.error) throw new Error(d.error.message);
      const msgs=d.messages||[];
      const details=await Promise.all(msgs.slice(0,8).map(m=>fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+m.id+'?format=metadata&metadataHeaders=Subject&metadataHeaders=From',{headers:{'Authorization':'Bearer '+t}}).then(r=>r.json())));
      return details.map(d=>{const h=(d.payload&&d.payload.headers)||[];const g=n=>(h.find(x=>x.name===n)||{}).value||'';return {id:d.id, from:g('From'), subject:g('Subject')};});
    }
  },
  gmail_send: {
    desc:'Send an email. Args: {to, subject, body}.', needs:'google', risk:'high', riskLabel:'send an email',
    async run(args){
      const t=(typeof ensureGToken==='function'? await ensureGToken() : getGToken()); if(!t) throw new Error('Gmail not connected');
      const raw=['To: '+args.to,'Subject: '+(args.subject||''),'Content-Type: text/plain; charset=utf-8','',args.body||''].join('\r\n');
      const b64=btoa(unescape(encodeURIComponent(raw))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      const r=await fetchDeadline('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{'Authorization':'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify({raw:b64})});
      const d=await r.json(); if(d.error) throw new Error(d.error.message);
      return {sent:true, id:d.id};
    }
  },
  calendar_list: {
    desc:'List upcoming calendar events for the next 7 days.', needs:'google',
    async run(){
      const t=(typeof ensureGToken==='function'? await ensureGToken() : getGToken()); if(!t) throw new Error('Calendar not connected');
      const now=new Date(), end=new Date(now.getTime()+7*864e5);
      const r=await fetchDeadline('https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin='+now.toISOString()+'&timeMax='+end.toISOString()+'&singleEvents=true&orderBy=startTime&maxResults=20',{headers:{'Authorization':'Bearer '+t}});
      const d=await r.json(); if(d.error) throw new Error(d.error.message);
      return (d.items||[]).map(e=>({when:(e.start&&(e.start.dateTime||e.start.date)), title:e.summary}));
    }
  },
  calendar_create: {
    desc:'Create a calendar event. Args: {title, start (ISO), end (ISO), description?}.', needs:'google', risk:'high', riskLabel:'create a calendar event',
    async run(args){
      const t=(typeof ensureGToken==='function'? await ensureGToken() : getGToken()); if(!t) throw new Error('Calendar not connected');
      const body={summary:args.title, description:args.description||'', start:{dateTime:args.start}, end:{dateTime:args.end||args.start}};
      const r=await fetchDeadline('https://www.googleapis.com/calendar/v3/calendars/primary/events',{method:'POST',headers:{'Authorization':'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify(body)});
      const d=await r.json(); if(d.error) throw new Error(d.error.message);
      return {created:true, id:d.id, link:d.htmlLink};
    }
  },
  drive_list: {
    desc:'List recent Google Drive files.', needs:'google',
    async run(){
      const t=(typeof ensureGToken==='function'? await ensureGToken() : getGToken()); if(!t) throw new Error('Drive not connected');
      const r=await fetchDeadline('https://www.googleapis.com/drive/v3/files?pageSize=30&orderBy=modifiedTime desc&fields=files(name,mimeType,modifiedTime)',{headers:{'Authorization':'Bearer '+t}});
      const d=await r.json(); if(d.error) throw new Error(d.error.message);
      return (d.files||[]).map(f=>({name:f.name, type:(f.mimeType||'').split('/').pop(), modified:f.modifiedTime}));
    }
  },
  github_list_issues: {
    desc:'List open issues for a repo. Args: {repo: "owner/name"}.', needs:'github',
    async run(args){
      const t=loadStr('amv_github'); if(!t) throw new Error('GitHub not connected');
      const r=await fetchDeadline('https://api.github.com/repos/'+args.repo+'/issues?state=open&per_page=20',{headers:{'Authorization':'Bearer '+t,'Accept':'application/vnd.github+json'}});
      const d=await r.json(); if(d.message&&!Array.isArray(d)) throw new Error(d.message);
      return d.map(i=>({number:i.number, title:i.title, url:i.html_url}));
    }
  },
  github_create_issue: { risk:'high', riskLabel:'create a GitHub issue',
    desc:'Open a GitHub issue. Args: {repo:"owner/name", title, body}.', needs:'github',
    async run(args){
      const t=loadStr('amv_github'); if(!t) throw new Error('GitHub not connected');
      const r=await fetchDeadline('https://api.github.com/repos/'+args.repo+'/issues',{method:'POST',headers:{'Authorization':'Bearer '+t,'Accept':'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({title:args.title,body:args.body||''})});
      const d=await r.json(); if(!d.number) throw new Error(d.message||'Failed to create issue');
      return {created:true, number:d.number, url:d.html_url};
    }
  },
  slack_post: { risk:'high', riskLabel:'post a Slack message',
    desc:'Post a message to Slack. Args: {channel, text}.', needs:'slack',
    async run(args){
      const t=loadStr('amv_slack'); if(!t) throw new Error('Slack not connected');
      if(/^https?:\/\//.test(t)){
        /* The webhook branch used to discard the answer and return
           {posted:true} regardless. A revoked or deleted webhook answers 404
           `no_service`, an unpaid workspace 403 - and the agent reported the
           message as posted either way, to a person who then believed their
           team had been told. The token branch below already checked; this one
           did not, which is the whole difference between the two.

           A webhook answers with the literal body "ok". */
        const wr=await fetchDeadline(t,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:args.text})});
        const wt=(await wr.text().catch(()=>'')).trim();
        if(!wr.ok || (wt && wt.toLowerCase()!=='ok'))
          throw new Error('Slack refused the message'+(wt?' ('+wt.slice(0,80)+')':' (HTTP '+wr.status+')')+'. Nothing was posted.');
        return {posted:true, via:'webhook'};
      }
      const r=await fetchDeadline('https://slack.com/api/chat.postMessage',{method:'POST',headers:{'Authorization':'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify({channel:args.channel||'#general',text:args.text})});
      const d=await r.json(); if(!d.ok) throw new Error(d.error||'Slack post failed');
      return {posted:true, ts:d.ts};
    }
  },
};

/* ============================================================
   INTENT-AWARE TASK CAPABILITY SYSTEM (Task #1)
   Maps what the user wants -> the specific API/integration/auth
   required -> whether it is actually connected for THIS user.
   Never pretends a task can run when the capability is missing.
   ============================================================ */

/* Each capability: the human action, the integration it belongs to,
   the EXACT API + auth required, the tools that fulfil it, and a live
   connection check. Keywords drive intent detection. */
const TASK_CAPABILITIES = [
  { id:'gmail', integration:'Google', label:'send, read or manage email',
    api:'Gmail API', auth:'Google account (OAuth)',
    connectId:'google', tools:['gmail_list_unread','gmail_send'],
    isConnected:()=>!!getGToken(),
    keywords:['email','emails','gmail','inbox','e-mail','reply to','send a mail','unread','draft a reply','respond to','mailbox'] },
  { id:'calendar', integration:'Google Calendar', label:'view or create calendar events',
    api:'Google Calendar API', auth:'Google account (OAuth)',
    connectId:'google', tools:['calendar_list','calendar_create'],
    isConnected:()=>!!getGToken(),
    keywords:['calendar','schedule','meeting','event','appointment','book time','block time','remind me to meet','agenda','availability'] },
  { id:'drive', integration:'Google Drive', label:'read or list your files',
    api:'Google Drive API', auth:'Google account (OAuth)',
    connectId:'google', tools:['drive_list'],
    isConnected:()=>!!getGToken(),
    keywords:['drive','google drive','my files','documents','spreadsheet in drive','file named'] },
  { id:'github', integration:'GitHub', label:'manage issues and repositories',
    api:'GitHub REST API', auth:'GitHub personal access token or OAuth',
    connectId:'github', tools:['github_list_issues','github_create_issue'],
    isConnected:()=>!!loadStr('amv_github'),
    keywords:['github','issue','repo','repository','pull request','pr ','commit','open an issue','bug ticket'] },
  { id:'slack', integration:'Slack', label:'post messages to Slack',
    api:'Slack Web API (or Incoming Webhook)', auth:'Slack bot token or webhook URL',
    connectId:'slack', tools:['slack_post'],
    isConnected:()=>!!loadStr('amv_slack'),
    keywords:['slack','post to channel','message the team','#general','dm on slack','notify the channel'] },
];

/* Integrations AMV advertises but that have no executable backend yet.
   If a user asks for one of these, we name exactly what is missing. */
const PLANNED_CAPABILITIES = [
  { integration:'Microsoft 365 / Outlook', api:'Microsoft Graph API', auth:'Microsoft account (OAuth)',
    keywords:['outlook','microsoft 365','office 365','onedrive','ms teams','microsoft teams','exchange'] },
  { integration:'Notion', api:'Notion API', auth:'Notion integration token',
    keywords:['notion','notion page','notion database','my notion'] },
  { integration:'Linear', api:'Linear API', auth:'Linear API key',
    keywords:['linear','linear issue','linear ticket'] },
  { integration:'Discord', api:'Discord Bot API', auth:'Discord bot token',
    keywords:['discord','discord server','discord channel'] },
  { integration:'Canvas LMS', api:'Canvas LMS API', auth:'Canvas access token + school URL',
    keywords:['canvas','assignment due','my course','lms','homework on canvas'] },
  { integration:'SMS / Text messaging', api:'Twilio API', auth:'Twilio number + credentials (set up by operator)',
    keywords:['text me','send a text',' sms','text message'] },
  { integration:'X / Twitter', api:'X API', auth:'X developer credentials',
    keywords:['tweet','twitter','post to x','x.com'] },
  { integration:'WhatsApp', api:'WhatsApp Business API', auth:'WhatsApp Business credentials',
    keywords:['whatsapp','whats app'] },
  { integration:'Stripe (your account)', api:'Stripe API', auth:'Stripe secret key (operator)',
    keywords:['stripe charge','refund a customer','create an invoice in stripe'] },
];

/* Analyse an instruction and decide what's required + whether it's ready.
   Returns {ready, requires:[...], unsupported:[...], missing:[...], matched} */
function analyzeTaskIntent(instruction){
  const text=' '+String(instruction||'').toLowerCase()+' ';
  const requires=[]; const seen=new Set();
  for(const cap of TASK_CAPABILITIES){
    if(cap.keywords.some(k=>text.includes(k))){
      if(seen.has(cap.integration)) continue; seen.add(cap.integration);
      requires.push({ id:cap.id, integration:cap.integration, label:cap.label, api:cap.api,
        auth:cap.auth, connectId:cap.connectId, connected:!!cap.isConnected() });
    }
  }
  const unsupported=[];
  for(const cap of PLANNED_CAPABILITIES){
    if(cap.keywords.some(k=>text.includes(k))){
      if(seen.has(cap.integration)) continue; seen.add(cap.integration);
      unsupported.push({ integration:cap.integration, api:cap.api, auth:cap.auth });
    }
  }
  const missing=requires.filter(r=>!r.connected);
  return {
    matched: requires.length>0 || unsupported.length>0,
    requires, unsupported, missing,
    ready: requires.length>0 && missing.length===0 && unsupported.length===0
  };
}
window.analyzeTaskIntent=analyzeTaskIntent;

/* Build a specific, actionable message explaining what's needed.
   Used when a task can't run as-is. */
function taskRequirementMessage(analysis){
  let out='';
  if(analysis.unsupported.length){
    analysis.unsupported.forEach(u=>{
      out+='\u26D4 This task requires the **'+u.integration+'** ('+u.api+'), which is not currently available in AMV. '+
           'It needs '+u.auth+'. I can\u2019t run it until that integration is supported.\n\n';
    });
  }
  if(analysis.missing.length){
    analysis.missing.forEach(m=>{
      out+='\uD83D\uDD0C This task needs the **'+m.api+'** to '+m.label+', which isn\u2019t connected yet. '+
           'Connect **'+m.integration+'** in Integrations (it authorises via '+m.auth+'), then I can run this automatically.\n\n';
    });
  }
  return out.trim();
}
window.taskRequirementMessage=taskRequirementMessage;

/* Agentic loop: AI plans tool calls, we execute them, report back. */
async function runAgentTask(instruction, opts){
  opts=opts||{};
  const available=Object.entries(INTEGRATION_ACTIONS).filter(([k,a])=>{
    if(a.needs==='google') return !!getGToken();
    if(a.needs) return !!loadStr('amv_'+a.needs);
    return true;
  });
  if(!available.length) throw new Error('No integrations connected yet. Connect Google, GitHub, or Slack in Integrations first.');
  const toolList=available.map(([k,a])=>'- '+k+': '+a.desc).join('\n');
  const sys='You are AMV\u2019s autonomous agent. You can call tools to take real actions on the user\u2019s connected accounts. '+
    'Respond ONLY with a JSON array of steps to execute, in order. Each step: {"tool":"<name>","args":{...},"why":"<short reason>"}. '+
    'If nothing should be done, return []. Available tools:\n'+toolList;
  const plan=await aiComplete(instruction, sys, {json:true});
  let steps=[]; try{ steps=JSON.parse(String(plan).replace(/```json|```/g,'').trim()); }catch(e){ steps=[]; }
  if(!Array.isArray(steps)) steps=[];

  // ===== AUTONOMOUS SAFETY (auditor #13) =====
  // 1) Hard step cap - never run an unbounded plan.
  const MAX_STEPS=8;
  steps=steps.slice(0,MAX_STEPS);
  // 2) Loop protection - drop exact-duplicate steps (same tool+args) so a model
  //    that plans the same action repeatedly can't spin.
  const _seen=new Set();
  steps=steps.filter(s=>{ const sig=s.tool+'|'+JSON.stringify(s.args||{}); if(_seen.has(sig)) return false; _seen.add(sig); return true; });

  const results=[];
  for(const step of steps){
    const action=INTEGRATION_ACTIONS[step.tool];
    if(!action){ results.push({tool:step.tool, error:'unknown tool'}); continue; }
    // 3) HUMAN-IN-THE-LOOP - risky/irreversible actions need explicit approval
    //    before they run. Reading data is automatic; sending/creating/posting
    //    asks the user first, showing exactly what will happen.
    if(action.risk==='high'){
      const detail=_describeAction(step, action);
      const approved=opts.autoApprove===true ? true : await _approveAction(detail);
      if(!approved){ results.push({tool:step.tool, why:step.why, skipped:true, reason:'you declined this action'}); continue; }
    }
    // 4) Cost guard - each step is one bounded action; the per-call cost cap and
    //    plan backstop on the backend already bound spend. We also stop early if
    //    too many steps fail (likely a misfire).
    try{
      if(opts.onStep) opts.onStep(step);
      const out=await action.run(step.args||{});
      results.push({tool:step.tool, why:step.why, ok:true, result:out});
      try{ AMVValue.record('agent_action'); }catch(e){}
    }
    catch(e){
      results.push({tool:step.tool, why:step.why, ok:false, error:e.message});
      // 5) Bail out if the task is clearly failing (3+ errors) - don't grind on.
      if(results.filter(r=>r.ok===false).length>=3){ results.push({tool:'_halt', error:'stopped after repeated failures'}); break; }
    }
  }
  return {steps, results};
}

/* Build a human-readable description of a risky action for the approval prompt. */
function _describeAction(step, action){
  const a=step.args||{};
  if(step.tool==='gmail_send') return 'Send an email to '+(a.to||'?')+' - subject: \u201c'+(a.subject||'(none)')+'\u201d';
  if(step.tool==='calendar_create') return 'Create a calendar event: \u201c'+(a.title||'(untitled)')+'\u201d';
  if(step.tool==='github_create_issue') return 'Create a GitHub issue: \u201c'+(a.title||'(untitled)')+'\u201d';
  if(step.tool==='slack_post') return 'Post to Slack: \u201c'+String(a.text||a.message||'').slice(0,80)+'\u201d';
  return (action.riskLabel||'take an action')+' - '+(step.why||'');
}
/* Ask the user to approve a risky autonomous action. Returns a Promise<bool>. */
function _approveAction(detail){
  if(typeof _showModalAsync==='function'){
    return _showModalAsync({
      title:'Approve this action?',
      body:'<div style="font-size:13.5px;line-height:1.6;color:var(--tx)">AMV wants to:<br><br><b>'+escH(detail)+'</b><br><br><span style="color:var(--mu);font-size:12px">This takes a real action on your connected account. Approve only if you\u2019re sure.</span></div>',
      okText:'Approve & run', cancelText:'Skip this'
    });
  }
  // fallback to native confirm
  return Promise.resolve(typeof confirm==='function' ? confirm('AMV wants to: '+detail+'\n\nApprove this real action?') : false);
}
window._describeAction=_describeAction;
window.runAgentTask=runAgentTask;
window.INTEGRATION_ACTIONS=INTEGRATION_ACTIONS;

/* Run an autonomous task from the UI and report progress + results in chat. */
async function runAutonomousTask(instruction){
  if(!instruction||!instruction.trim()){ toast('Tell AMV what to do across your apps','info'); return; }
  setTab('chat');
  const msgs=getMsgs();
  msgs.push({r:'u',c:instruction,d:instruction});

  // --- Task #1: analyse intent BEFORE running. Never pretend. ---
  const analysis=analyzeTaskIntent(instruction);
  if(analysis.matched && !analysis.ready){
    // A real integration is required but missing/unsupported. Be specific.
    let out=taskRequirementMessage(analysis);
    // If part of the task IS ready, say so honestly.
    const ready=analysis.requires.filter(r=>r.connected);
    if(ready.length){
      out+='\n\n\u2705 The **'+ready.map(r=>r.integration).join('** and **')+'** part is connected and ready - '+
           'once the above is connected too, I can run the whole task.';
    }
    msgs.push({r:'a',c:out,model:S.model});
    setMsgs(msgs); S.busy=false; renderChatMsgs();
    return;
  }

  msgs.push({r:'a',c:'',_retrying:'Planning actions across your connected apps…',streaming:true});
  setMsgs(msgs); renderChatMsgs();
  const idx=msgs.length-1;
  try{
    const {steps,results}=await runAgentTask(instruction,{onStep:(s)=>{
      msgs[idx]={...msgs[idx],_retrying:'Running: '+s.tool.replace(/_/g,' ')+'…'};
      setMsgs(msgs); renderChatMsgs();
    }});
    // build a readable summary
    let out='';
    if(!steps.length){ out='I looked at this but didn\u2019t find a safe action to take automatically. Want me to do something specific?'; }
    else {
      out='**Done - here\u2019s what I did:**\n\n';
      results.forEach((r,i)=>{
        if(r.tool==='_halt'){ out+='\u26D4 Stopped early after repeated failures.\n'; return; }
        const label=(steps[i]&&steps[i].why)||r.tool;
        if(r.skipped){ out+='\u23ED\uFE0F Skipped ('+escH(r.reason||'you declined')+'): '+escH(label)+'\n'; return; }
        out+=(r.ok?'\u2705':'\u26A0\uFE0F')+' '+label+(r.ok?'':' - '+escH(r.error||'failed'))+'\n';
      });
    }
    delete msgs[idx]._retrying; msgs[idx]={r:'a',c:out,model:S.model};
  }catch(e){
    delete msgs[idx]._retrying; msgs[idx]={r:'a',c:'',model:S.model,_error:e.message||'Could not run that task.'};
  }
  setMsgs(msgs); S.busy=false; renderChatMsgs();
}
window.runAutonomousTask=runAutonomousTask;

async function quickGmail(){
  const token = getGToken();
  if(!token){ toast('Connect Gmail first - click Connect in Integrations','error',4000); return; }
  toast('Loading inbox...','info',2000);
  try{
    const r = await fetchDeadline('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&labelIds=INBOX&q=is:unread',{headers:{'Authorization':'Bearer '+token}});
    const d = await r.json();
    if(d.error){ toast('Gmail: '+d.error.message,'error'); return; }
    const msgs = d.messages||[];
    if(!msgs.length){ toast('No unread emails!','success'); return; }
    const details = await Promise.all(msgs.slice(0,8).map(m=>
      fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+m.id+'?format=metadata&metadataHeaders=Subject&metadataHeaders=From',{headers:{'Authorization':'Bearer '+token}}).then(r=>r.json())
    ));
    const summary = details.map(d=>{
      const subj = d.payload&&d.payload.headers&&d.payload.headers.find(h=>h.name==='Subject');
      const from = d.payload&&d.payload.headers&&d.payload.headers.find(h=>h.name==='From');
      return 'From: '+(from&&from.value||'?')+'\nSubject: '+(subj&&subj.value||'(no subject)');
    }).join('\n\n');
    setTab('chat');
    setTimeout(()=>{ const ta=$('mta'); if(ta){ ta.value='I have '+msgs.length+' unread emails. Summarize what needs attention:\n\n'+summary; ta.focus(); } },200);
  }catch(e){ toast('Gmail error: '+e.message,'error'); }
}
async function quickCalendar(){
  const token = getGToken();
  if(!token){ toast('Connect Calendar first','error',4000); return; }
  toast('Loading calendar...','info',2000);
  try{
    const now=new Date(), end=new Date(now.getTime()+7*24*60*60*1000);
    const r = await fetchDeadline('https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin='+now.toISOString()+'&timeMax='+end.toISOString()+'&singleEvents=true&orderBy=startTime&maxResults=20',{headers:{'Authorization':'Bearer '+token}});
    const d = await r.json();
    if(d.error){ toast('Calendar: '+d.error.message,'error'); return; }
    const events = (d.items||[]).map(e=>(e.start&&(e.start.dateTime||e.start.date))+': '+e.summary).join('\n');
    setTab('chat');
    setTimeout(()=>{ const ta=$('mta'); if(ta){ ta.value='Here is my calendar for the next 7 days:\n\n'+(events||'No events')+'\n\nHelp me optimize my week.'; ta.focus(); } },200);
  }catch(e){ toast('Calendar error: '+e.message,'error'); }
}
async function quickDrive(){
  const token = getGToken();
  if(!token){ toast('Connect Drive first','error',4000); return; }
  toast('Reading Drive...','info',2000);
  try{
    const r = await fetchDeadline('https://www.googleapis.com/drive/v3/files?pageSize=30&orderBy=modifiedTime desc&fields=files(name,mimeType,modifiedTime)',{headers:{'Authorization':'Bearer '+token}});
    const d = await r.json();
    if(d.error){ toast('Drive: '+d.error.message,'error'); return; }
    const files = (d.files||[]).map(f=>f.name+' ('+(f.mimeType&&f.mimeType.split('/').pop())+')').join('\n');
    setTab('chat');
    setTimeout(()=>{ const ta=$('mta'); if(ta){ ta.value='Here are my recent Google Drive files:\n\n'+files+'\n\nSuggest how to organize them.'; ta.focus(); } },200);
  }catch(e){ toast('Drive error: '+e.message,'error'); }
}

/* 3. TASK LAUNCHER */
const TASKS={
  email:"Write a professional email.\n\nTo: [name/role]\nAbout: [explain]\nTone: [professional/friendly/formal]",
  emailreply:"Write a reply to this email:\n\n[Paste email here]\n\nMatch the tone and be concise.",
  text:"Write a text message to [name].\n\nSituation: [what you need to say]",
  trip:"Plan a trip to [destination] for [number] days.\nInclude: daily itinerary, hotels, restaurants, costs, tips.",
  shopping:"Create a shopping list for [occasion/meal/week]. Organize by category.",
  meal:"Create a 7-day meal plan for [dietary preference].\nInclude breakfast, lunch, dinner, snacks, shopping list.",
  fitness:"Build a workout plan.\nGoal: [lose weight/build muscle/get fit]\nDays/week: [number]\nEquipment: [gym/home/none]",
  essay:"Write an essay on: [topic]\nLevel: [high school/college]\nLength: [word count]",
  homework:"Help me with this assignment:\n\n[Paste assignment here]\n\nCourse: [subject]",
  study:"Create study notes for: [subject/chapter]\nInclude: key concepts, definitions, examples, practice questions.",
  flashcards:"Create 20 flashcard Q&As for: [topic]",
  summarize:"Summarize this:\n\n[Paste text/article here]\n\nGive: 1-sentence summary, key points, takeaways.",
  explain:"Explain [concept] simply.\nUse analogies, examples, step-by-step breakdown.",
  resume:"Write a resume for a [job title] role.\nExperience: [years]\nKey skills: [list them]",
  coverletter:"Write a cover letter for [job title] at [company].\nMy background: [describe]\nJob requires: [requirements]",
  linkedin:"Rewrite my LinkedIn to get more views.\nHeadline: [current headline]\nTarget role: [what you want]",
  bizplan:"Write a business plan for: [business idea]\nInclude: market analysis, revenue model, projections.",
  proposal:"Write a proposal for [client] for [project].\nScope: [what you will do]\nPrice: $[amount]",
  meeting:"Write meeting notes from:\n\n[Paste discussion/transcript]\n\nInclude action items.",
  social:"Write 10 [Instagram/Twitter/LinkedIn] posts about [topic].\nVoice: [casual/professional]",
  script:"Write a video script for [YouTube/TikTok] about [topic].\nLength: [duration]\nAudience: [who]",
  story:"Write a short story about [topic/genre].\nSetting: [where]\nCharacter: [describe]\nConflict: [what happens]",
  code:"Build [describe what to build] in [language/framework].\nRequirements: [list them]\nDo not truncate.",
  debug:"Debug this code:\n\n[Paste code]\n\nError: [paste error message]\nExpected: [what it should do]",
  api:"Build a REST API for [what it does].\nEndpoints: [list]\nAuth: [JWT/API key/none]",
  budget:"Analyze spending and build a budget:\n\n[Paste transactions]\n\nGoal: [save/pay debt/invest]",
  invest:"Investment strategy.\nAmount: $[number]\nRisk: [low/medium/high]\nGoal: [retirement/growth/income]",
  contract:"Review this contract - explain terms, risks, what to negotiate:\n\n[Paste contract]",
  excel:"Analyze this data:\n\n[Paste CSV/spreadsheet data]\n\nQuestions: [what do you want to know?]",
  pptx:"Create a presentation on: [topic]\nSlides: [number]\nAudience: [who]\nKey message: [main point]",
  word:"Write a [report/proposal/memo] on: [topic]\nAudience: [who reads it]\nLength: [approximate]"
};
function launchTask(key){
  const prompt=TASKS[key];
  if(!prompt){ toast('Task not found','error'); return; }
  setTab('chat');
  setTimeout(()=>{
    const ta=$('mta');
    if(ta){
      ta.value=prompt;
      ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,130)+'px';
      ta.focus();
      const s=prompt.indexOf('[');
      if(s>-1) ta.setSelectionRange(s,prompt.indexOf(']')+1);
    }
  },150);
}

/* 4. TASKS VIEW */
function renderTasksView(){
  const vc=$('vc'); if(!vc) return;
  // Unique, agentic capabilities - things a plain chatbot can't do
  const unique=[
    ['🔭','Set up a research watch','AMV monitors any topic on a schedule - a stock, a company, a trend - and reports what\'s happening. Info, not advice.','researchwatch'],
    ['🛰️','Run a standing job','AMV works in the background across your accounts and only sends after you approve.','crew'],
    ['🌅','Daily brief on autopilot','Wake up to a market + inbox + calendar briefing, generated and delivered every morning.','autobrief'],
    ['🏗️','Build & ship a working app','Not just code - AMV writes it, runs it in a live sandbox, debugs it, and shows the result.','dev'],
    ['🎨','Design a brand + site live','Watch a landing page build on a canvas, then refine it by chatting.','studio'],
    ['🔁','Auto-debug until it passes','Paste broken code; AMV runs it, reads the real error, fixes, and re-runs in a loop.','lab'],
    ['🤝','Hand off with full context','Pass any task to a teammate or another agent - nothing gets dropped.','handoff'],
  ];
  const ucard=(u)=>`<button class="uniq-card" data-dact="launchUnique" data-darg="${u[3]}">
    <span class="uniq-ic">${u[0]}</span>
    <span class="uniq-t">${u[1]}</span>
    <span class="uniq-d">${escH(u[2])}</span>
    <span class="uniq-go">Try it →</span>
  </button>`;
  const cats=[
    {label:'Personal',tasks:[['email','\u2709\uFE0F','Write an email','Any email, instantly'],['emailreply','\u21A9\uFE0F','Reply to an email','Smart, ready-to-send replies'],['trip','\u2708\uFE0F','Plan a trip','A full itinerary'],['meal','\uD83C\uDF7D\uFE0F','Meal plan','A 7-day plan'],['fitness','\uD83D\uDCAA','Workout plan','Tailored to your goals']]},
    {label:'Student',tasks:[['essay','\uD83D\uDCDD','Write an essay','On any topic'],['study','\uD83D\uDCD6','Study notes','Key concepts, organized'],['flashcards','\uD83C\uDFB4','Make flashcards','20 Q&A cards'],['summarize','\uD83D\uDD0D','Summarize anything','Articles, docs or books'],['explain','\uD83D\uDCA1','Explain anything','Simple, clear breakdowns']]},
    {label:'Work',tasks:[['resume','\uD83D\uDCC4','Write my resume','ATS-optimized'],['coverletter','\u2709\uFE0F','Cover letter','Tailored to any job'],['bizplan','\uD83D\uDCC8','Business plan','A complete plan'],['proposal','\uD83E\uDD1D','Client proposal','Built to win the client'],['meeting','\uD83D\uDCCB','Meeting notes','With action items']]},
    {label:'Creative',tasks:[['social','\uD83D\uDCF1','Social posts','10 posts for any platform'],['script','\uD83C\uDFAC','Video script','For YouTube or TikTok'],['story','\uD83D\uDCDA','Write a story','Any genre or length']]},
  ];
  const row=(t)=>`<button class="tk-row" data-dact="launchTask" data-darg="${t[0]}"><span class="tk-ic">${t[1]}</span><span class="tk-body"><span class="tk-t">${t[2]}</span><span class="tk-d">${escH(t[3])}</span></span><span class="tk-arrow">\u2192</span></button>`;
  vc.innerHTML = `<div class="sv fi"><div class="tasks-page">
    <header class="tasks-hero">
      <div>
        <span class="eyebrow">What AMV can do</span>
        <h2>Get something done.</h2>
        <p class="vsub">Start with something only AMV can do - or grab a ready-made task that opens a chat set up to deliver.</p>
      </div>
    </header>
    ${_autoServerHTML()}
    <section class="uniq-sec">
      <div class="sec-head"><h3>Only on AMV</h3><span class="sec-sub">Capabilities a plain chatbot doesn't have</span></div>
      <div class="uniq-grid">${unique.map(ucard).join('')}</div>
    </section>
    <div class="tasks-masonry">
      ${cats.map((cat,n)=>`<section class="tk-cat${n===0?' wide':''}">
        <div class="sec-head"><h3>${cat.label}</h3><span class="sec-sub">${cat.tasks.length} tasks</span></div>
        <div class="tk-list">${cat.tasks.map(row).join('')}</div>
      </section>`).join('')}
    </div>
  </div></div>`;
  try{ _wireAutoServer(vc); }catch(e){}
}
function launchUnique(kind){
  const map={crew:'crew',dev:'dev',studio:'studio',lab:'lab',handoff:'handoff'};
  if(kind==='researchwatch'){ openResearchWatch(); return; }
  if(kind==='autobrief'){ setTab('crew'); setTimeout(()=>toast('Turn on a daily brief job in Crew','info'),200); return; }
  setTab(map[kind]||'chat');
}
window.launchUnique=launchUnique;
function downloadDesktop(platform){
  const url=loadStr(platform==='mac'?'amv_dl_mac':'amv_dl_win');
  if(url){ window.open(url,'_blank','noopener'); return; }
  toast('Desktop builds publish here at launch - bookmark this page','info',4000);
}
window.downloadDesktop=downloadDesktop;
/* Unified store/listing link: opens the real published URL once you set it
   (in Settings → Integrations at launch), otherwise tells the user honestly
   that it's coming, instead of sending them to a generic store homepage. */
/* Install as a PWA (add to home screen) - uses the captured beforeinstallprompt
   event when available, otherwise shows clear platform instructions. */
let _deferredPWA=null;
try{ window.addEventListener('beforeinstallprompt',(e)=>{ e.preventDefault(); _deferredPWA=e; }); }catch(e){}
function installPWA(){
  if(_deferredPWA){
    _deferredPWA.prompt();
    _deferredPWA.userChoice.finally(()=>{ _deferredPWA=null; });
    return;
  }
  const ua=navigator.userAgent||'';
  let how;
  if(/iPhone|iPad|iPod/i.test(ua)) how='In Safari: tap the Share button, then "Add to Home Screen".';
  else if(/Android/i.test(ua)) how='In Chrome: tap the ⋮ menu, then "Add to Home screen" or "Install app".';
  else how='In your browser menu, choose "Install AMV" or "Add to Home screen" / "Create shortcut".';
  toast(how, 'info', 6000);
}
function openDevView(){ try{ setTab('dev'); }catch(e){} }
window.installPWA=installPWA; window.openDevView=openDevView;

function amvStoreLink(which){
  const map={
    chrome:'amv_url_chrome', vscode:'amv_url_vscode', slack:'amv_url_slack',
    ios:'amv_url_ios', android:'amv_url_android', jetbrains:'amv_url_jetbrains'
  };
  const names={chrome:'AMV for Chrome',vscode:'VS Code extension',slack:'Slack app',ios:'iOS app',android:'Android app',jetbrains:'JetBrains plugin'};
  const url=loadStr(map[which]||'');
  // If a real published URL has been set (post-launch), open it.
  if(url){ window.open(url,'_blank','noopener'); return; }
  // Otherwise: a real "notify me" waitlist - honest and actually useful.
  const name=names[which]||'this app';
  const waitKey='amv_waitlist_'+which;
  if(loadStr(waitKey)){ toast('You\u2019re on the list for '+name+'. We\u2019ll email you the moment it\u2019s live.','success',4000); return; }
  amvNotifyMe(which,name,waitKey);
}
async function amvNotifyMe(which,name,waitKey){
  const email=(S.user&&S.user.email)||'';
  const useEmail = email || await showTextPromptAsync('Get notified when '+name+' launches - enter your email:');
  if(!useEmail||!String(useEmail).includes('@')){ if(useEmail) showError('Please enter a valid email.'); return; }
  // record interest (and send to backend if available so you have the real waitlist)
  try{ saveStr(waitKey,'1'); }catch(e){}
  let stored=false;
  if(window.AMV_API && AMV_API.live){
    try{ const r=await AMV_API._fetch('/waitlist',{method:'POST',body:JSON.stringify({product:which,email:String(useEmail).toLowerCase()})}); stored=r&&r.ok!==false; }catch(e){}
  }
  toast('You\u2019re on the list for '+name+'! We\u2019ll let you know the moment it\u2019s ready.','success',4500);
}
window.amvStoreLink=amvStoreLink;
window.amvNotifyMe=amvNotifyMe;
let _taskCat=null;
function filterTaskCat(cat){
  const secs=document.querySelectorAll('.task-sec');
  if(_taskCat===cat){
    _taskCat=null;
    secs.forEach(s=>s.style.display='');
    document.querySelectorAll('[id^="tcb-"]').forEach(b=>{b.style.background='';b.style.color='';b.style.borderColor='';});
  } else {
    _taskCat=cat;
    secs.forEach(s=>{s.style.display=s.dataset.section===cat?'':'none';});
    document.querySelectorAll('[id^="tcb-"]').forEach(b=>{
      const active=b.id==='tcb-'+cat;
      b.style.background=active?'rgba(85,144,255,.15)':'';
      b.style.color=active?'#7cb8ff':'';
      b.style.borderColor=active?'rgba(88,166,255,.35)':'';
    });
  }
}

/* 5. INTEGRATIONS VIEW - routes to the unified catalog in Settings so there is
   ONE integrations experience (the new Connect catalog), not two. */
/* ============================================================
   INTEGRATIONS - shared catalog (Task #2)
   The catalog renders identically as its own full-page view AND
   inside the Settings pane, from one source of truth.
   ============================================================ */
function _integrationsCatalogHTML(){
  const smsPhone=loadStr('amv_sms_phone');
  const gConnected=!!getGToken();
  const isConn=(k)=>!!loadStr(k);
  const intRow=(o)=>{
    const connected=o.connected;
    const badge=o.auto
      ? '<span class="ax-badge ax-auto"><span class="ax-dot"></span>Autonomous</span>'
      : '<span class="ax-badge ax-manual">Manual</span>';
    /* A connected integration that can DO something needs a way to run it. The
       Canvas automation had a working implementation and no button anywhere -
       its entry point was removed with an old toolbar and the function was left
       behind, reachable by nothing. Connecting it here means the run control
       lives next to the connection it depends on. */
    const action=connected
      ? ((o.run?'<button class="btn bp" data-int-run="'+o.run+'" style="font-size:12px">'+escH(o.runLabel||'Run')+'</button>':'')+
         '<button class="btn int-disc" data-int-disc="'+o.id+'" style="font-size:12px">Disconnect</button>')
      : (o.auto
          ? '<button class="btn bp" data-int-conn="'+o.id+'" style="font-size:12px">Connect</button>'
          : '<button class="btn bs" data-int-use="'+(o.use||'chat')+'" style="font-size:12px">'+(o.useLabel||'Open in chat')+'</button>');
    return '<div class="int-card">'+
      '<div class="int-ic" style="background:'+(o.bg||'var(--s3)')+'">'+o.icon+'</div>'+
      '<div class="int-body">'+
        '<div class="int-top"><span class="int-name">'+o.name+'</span>'+badge+(connected?'<span class="int-ok">\u2713 Connected</span>':'')+'</div>'+
        '<div class="int-desc">'+o.desc+'</div>'+
      '</div>'+
      '<div class="int-act">'+action+'</div>'+
    '</div>';
  };
  const cat=(title,rows)=>'<div class="ss2"><h3>'+title+'</h3><div class="int-list">'+rows+'</div></div>';
  return ''+
    '<div class="ax-legend">'+
      '<div class="ax-legend-item"><span class="ax-badge ax-auto"><span class="ax-dot"></span>Autonomous</span><span>Runs on its own in the background after you connect.</span></div>'+
      '<div class="ax-legend-item"><span class="ax-badge ax-manual">Manual</span><span>You trigger it or upload files each time.</span></div>'+
    '</div>'+
    cat('Email &amp; calendar',
      intRow({id:'google',name:'Google (Gmail, Drive, Calendar)',desc:'Reads & drafts email, organizes Drive, manages your calendar - automatically.',auto:true,connected:gConnected,icon:'\uD83D\uDCE7',bg:'rgba(66,133,244,.14)'})+
      intRow({id:'outlook',name:'Microsoft 365 (Outlook, OneDrive)',desc:'Email, calendar and files across your Microsoft account.',auto:true,connected:isConn('amv_outlook'),icon:'\uD83D\uDCEB',bg:'rgba(0,120,212,.14)'})+
      /* The rest of the world. Google and Microsoft cover a lot of people and
         not most of them: QQ and 163 in China, Naver in Korea, Yandex and
         Mail.ru in Russia, GMX in Germany, WP.pl in Poland, UOL in Brazil.
         All of them speak IMAP, so one connector reaches all of them. */
      intRow({id:'mail',name:'Mail worldwide (QQ, 163, Naver, Yandex, GMX, WP.pl, UOL\u2026)',
              desc:_mailConnectedAccount()
                ? ('Connected to '+escH(_mailConnectedAccount().address)+'. AMV reads it, summarizes it and drafts replies.')
                : 'Your own provider, in 22 countries. Reads, summarizes and drafts replies - automatically.',
              auto:true,connected:!!_mailConnectedAccount(),
              run:'openMailInbox',runLabel:'Open inbox',
              icon:'\uD83C\uDF0D',bg:'rgba(120,180,120,.14)'})
    )+
    cat('Messaging &amp; chat',
      intRow({id:'slack',name:'Slack',desc:'Answers, summaries and tasks inside any channel with /amv.',auto:true,connected:isConn('amv_slack'),icon:'\uD83D\uDCAC',bg:'rgba(74,21,75,.16)'})+
      intRow({id:'sms',name:'Text messages (SMS)',desc:'Run AMV from any phone by text - \u201ccheck Project X\u201d, \u201cdraft a reply\u201d.',auto:true,connected:!!smsPhone,icon:'\uD83D\uDCF1',bg:'rgba(63,185,80,.14)'})+
      intRow({id:'discord',name:'Discord',desc:'Bring AMV into your servers for answers and automations.',auto:true,connected:isConn('amv_discord'),icon:'\uD83C\uDFAE',bg:'rgba(88,101,242,.16)'})
    )+
    cat('Developer',
      intRow({id:'github',name:'GitHub',desc:'Reviews PRs, opens issues, reads repos and ships fixes you approve.',auto:true,connected:isConn('amv_github'),icon:'\uD83D\uDC19',bg:'rgba(255,255,255,.08)'})+
      intRow({id:'vscode',name:'VS Code',desc:'Your AI pair-programmer inside the editor.',auto:true,connected:isConn('amv_vscode'),icon:'\uD83D\uDCBB',bg:'rgba(0,118,212,.14)'})+
      intRow({id:'linear',name:'Linear',desc:'Creates, triages and updates issues from chat.',auto:true,connected:isConn('amv_linear'),icon:'\uD83D\uDCD0',bg:'rgba(94,106,210,.16)'})
    )+
    cat('Productivity',
      intRow({id:'notion',name:'Notion',desc:'Reads and writes pages, builds docs in your workspace.',auto:true,connected:isConn('amv_notion'),icon:'\uD83D\uDCDD',bg:'rgba(255,255,255,.08)'})+
      /* The description says what it does now. It used to promise "drafts
         answers from your notes, works overnight", which described an
         automation that was removed - and which had never run anyway, because
         it called the school from the browser and the page's policy refused
         every request. What is left is real: read what is due, take your own
         copy of the document the assignment points at, share it with the
         teacher when you say to. Handing in stays the student's own act. */
      intRow({id:'canvas',name:'Canvas LMS',desc:'Reads what is due, makes your own copy of the doc an assignment points at, and shares it with your teacher when you say to.',/* Read with the key written out, not through isConn's variable, because
         the check that pairs every storage key with its reader can only see a
         literal - and this key stopped being operator-set the moment the
         connect flow began writing it. A read it cannot see is a key it
         reports as written into the void. */
      auto:true,connected:!!loadStr('amv_canvas'),run:'schoolOpen',runLabel:'Open my school work',icon:'\uD83C\uDF93',bg:'rgba(230,70,70,.14)'})
    )+
    cat('Office files',
      intRow({id:'excel',name:'Excel & CSV',desc:'Upload a sheet - AMV runs formulas, builds pivots and charts, then you download.',auto:false,connected:false,icon:'\uD83D\uDCCA',bg:'rgba(33,115,70,.14)'})+
      intRow({id:'pptx',name:'PowerPoint',desc:'Describe a deck and AMV builds the slides - export the .pptx.',auto:false,connected:false,icon:'\uD83D\uDCD1',bg:'rgba(198,67,30,.14)'})+
      intRow({id:'word',name:'Word',desc:'Reports, proposals and letters - written and exported, ready to edit.',auto:false,connected:false,icon:'\uD83D\uDCC4',bg:'rgba(0,120,212,.14)'})
    );
}
window._integrationsCatalogHTML=_integrationsCatalogHTML;

function _wireIntegrationCatalog(root){
  root=root||document;
  /* Mail is connected with a password rather than an OAuth round trip, so it
     has its own flow instead of being pushed through connectIntegration. */
  root.querySelectorAll('[data-int-conn]').forEach(btn=>on(btn,'click',()=>{
    if(btn.dataset.intConn==='mail') return openMailConnect();
    connectIntegration(btn.dataset.intConn);
  }));
  root.querySelectorAll('[data-int-disc]').forEach(btn=>on(btn,'click',()=>{
    if(btn.dataset.intDisc==='mail') return disconnectMail();
    disconnectIntegration(btn.dataset.intDisc);
  }));
  root.querySelectorAll('[data-int-run]').forEach(btn=>on(btn,'click',()=>{
    const fn=window[btn.dataset.intRun];
    if(typeof fn==='function') fn();
    else toast('That automation is not available in this build.','error');
  }));
  root.querySelectorAll('[data-int-use]').forEach(btn=>on(btn,'click',()=>{ setTab(btn.dataset.intUse||'chat'); toast('Upload your file with the \uD83D\uDCCE button, or just describe what you need.','info',4500); }));
}
window._wireIntegrationCatalog=_wireIntegrationCatalog;

/* Refresh whichever integrations surface is currently visible:
   the standalone Integrations page OR the Settings > Integrations pane. */
function _refreshIntegrationsUI(){
  /* Status first, then repaint. Without this a mailbox that IS connected shows
     a Connect button until some other event happens to redraw the page, which
     reads as the connection having failed. */
  try{ refreshMailStatus().then(()=>{ try{ _paintIntegrations(); }catch(e){} }); }catch(e){}
  return _paintIntegrations();
}
function _paintIntegrations(){
  try{
    if(S.tab==='integrations'){ renderIntegrationsView(); return; }
    if(S.tab==='settings' && S.settingsPane==='integrations'){ renderSetPane(); return; }
    if(typeof renderSetPane==='function') renderSetPane();
  }catch(e){}
}
window._refreshIntegrationsUI=_refreshIntegrationsUI;

/* Standalone Integrations page - its OWN view, no longer redirects to Settings. */
function renderIntegrationsView(){
  const vc=$('vc'); if(!vc) return;
  vc.innerHTML=
    '<div class="sv fi"><div class="vi">'+
      '<h2>Integrations</h2>'+
      '<p class="vsub">Connect AMV to your tools. <b style="color:var(--tx)">Autonomous</b> integrations work in the background once connected; <b style="color:var(--tx)">manual</b> ones you trigger or upload to. Click Connect - you approve in a popup, no keys to paste.</p>'+
      '<div id="int-catalog">'+_integrationsCatalogHTML()+'</div>'+
    '</div></div>';
  _wireIntegrationCatalog(vc);
  try{ _killTokenAutofill&&_killTokenAutofill(); }catch(e){}
}
window.renderIntegrationsView=renderIntegrationsView;
/* 6. EXTENSIONS VIEW - real file editors */
function parseCSV(text){
  return text.trim().split('\n').map(l=>{
    const cols=[]; let cur='',inQ=false;
    for(let i=0;i<l.length;i++){if(l[i]==='"')inQ=!inQ;else if(l[i]===','&&!inQ){cols.push(cur.trim());cur='';}else cur+=l[i];}
    cols.push(cur.trim()); return cols;
  });
}
function csvToTable(data){
  if(!data||!data.length) return '';
  const h=data[0], rows=data.slice(1);
  return `<table id="sheet-tbl" style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>${h.map(hd=>`<th contenteditable="true" style="background:rgba(85,144,255,.12);border:1px solid rgba(255,255,255,.1);padding:8px 10px;text-align:left;font-weight:600;white-space:nowrap;position:sticky;top:0">${escH(hd)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${h.map((_,ci)=>`<td contenteditable="true" style="border:1px solid rgba(255,255,255,.06);padding:6px 10px;color:var(--tx)" onfocus="this.style.background='rgba(85,144,255,.08)'" onblur="this.style.background=''">${escH(row[ci]||'')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function tableToCSV(){
  const t=document.getElementById('sheet-tbl'); if(!t) return '';
  return Array.from(t.querySelectorAll('tr')).map(tr=>Array.from(tr.querySelectorAll('th,td')).map(c=>'"'+c.textContent.replace(/"/g,'""')+'"').join(',')).join('\n');
}
let _sheetData=[];
function handleSheetFile(file){
  // An unreadable or corrupt file used to do nothing at all, with no error -
  // the user just saw their upload vanish.
  file.text().then(text=>{
    try{
      _sheetData=parseCSV(text);
      if(!_sheetData || !_sheetData.length){ toast('That file has no readable rows. Check it is a CSV.','error',4500); return; }
      openSheetEditor(_sheetData,file.name);
    }catch(e){
      toast('That file could not be read as a spreadsheet.','error',4500);
      try{ _logErr('sheet.parse', e); }catch(_){}
    }
  }).catch(e=>{
    toast('Could not read that file. Try uploading it again.','error',4500);
    try{ _logErr('sheet.read', e); }catch(_){}
  });
}
function openSheetEditor(data,name){
  const vc=$('vc'); if(!vc) return;
  vc.innerHTML=`<div style="display:flex;flex-direction:column;height:100%">
<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;background:rgba(13,17,23,.95);border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0">
  <span style="font-size:13px;font-weight:600">&#128200; ${escH(name||'Spreadsheet')}</span>
  <span style="font-size:11px;color:var(--mu)">${data.length-1} rows &middot; ${data[0]&&data[0].length||0} cols</span>
  <div style="margin-left:auto;display:flex;gap:6px">
    <button class="ext-btn" onclick="(()=>{const csv=tableToCSV();if(!csv)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='amv_'+Date.now()+'.csv';a.click();toast('Downloaded','success');})()">&#8681; Download</button>
    <button class="ext-btn" onclick="setTab('extensions')">&#10005; Close</button>
  </div>
</div>
<div style="flex:1;overflow:auto;padding:12px">${csvToTable(data)}</div>
<div style="background:rgba(13,17,23,.97);border-top:1px solid rgba(255,255,255,.1);padding:12px 14px;flex-shrink:0">
  <div style="font-size:10px;color:#7cb8ff;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:7px">AMV AI Toolbar</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
    ${['Analyze trends','Find duplicates','Add totals row','Sort by first column','Summarize data'].map(q=>`<button class="ext-btn" onclick="runSheetAI('${q}')">${q}</button>`).join('')}
  </div>
  <div style="display:flex;gap:8px">
    <input type="text" id="sheet-inp" placeholder="Ask AMV anything about this spreadsheet..." style="flex:1;font-size:13px">
    <button class="btn bp" id="sheet-ask" style="font-size:13px;padding:8px 18px">Ask</button>
  </div>
  <div id="sheet-res" style="display:none;margin-top:10px;font-size:12px;color:var(--mu);background:var(--s2);border-radius:10px;padding:12px;max-height:180px;overflow-y:auto;white-space:pre-wrap;line-height:1.65"></div>
</div></div>`;
  on($('sheet-ask'),'click',()=>runSheetAI($('sheet-inp')&&$('sheet-inp').value));
  on($('sheet-inp'),'keydown',e=>{if(e.key==='Enter')runSheetAI($('sheet-inp')&&$('sheet-inp').value);});
}
async function runSheetAI(query){
  if(!query||!query.trim()) return;
  const btn=$('sheet-ask'),res=$('sheet-res');
  if(btn){btn.disabled=true;btn.textContent='Thinking...';}
  if(res){res.style.display='block';res.textContent='Analyzing...';}
  const mk=loadStr('amv_mk');
  if(!mk){toast('AMV isn’t connected yet - ask the workspace owner to switch it on.','error');if(btn){btn.disabled=false;btn.textContent='Ask';}return;}
  try{
    const reply=await aiComplete('You are a data analyst. Spreadsheet (CSV):\n\n'+tableToCSV().slice(0,8000)+'\n\nRequest: '+query+'\n\nIf modifying data, return ONLY the complete modified CSV. Otherwise answer clearly.', null, {model:(typeof qModel==='function'?qModel('explain'):'amv-core'), max_tokens:2000, noLang:true});
    const looksCSV=reply.split('\n').filter(l=>l.includes(',')).length>=2;
    if(looksCSV&&reply.split('\n').length>2){
      _sheetData=parseCSV(reply);
      const scroll=document.querySelector('#sheet-tbl')&&document.querySelector('#sheet-tbl').closest('[style*="overflow"]');
      if(scroll) scroll.innerHTML=csvToTable(_sheetData);
      if(res){res.style.display='block';res.textContent='Table updated - '+_sheetData.length+' rows.';}
      toast('Spreadsheet updated','success');
    } else if(res){res.style.display='block';res.textContent=reply;}
    if($('sheet-inp')) $('sheet-inp').value='';
  }catch(e){if(res){res.style.display='block';res.textContent='Error: '+e.message;}}
  if(btn){btn.disabled=false;btn.textContent='Ask';}
}
function openDocEditor(content,name){
  const vc=$('vc'); if(!vc) return;
  vc.innerHTML=`<div style="display:flex;flex-direction:column;height:100%">
<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;background:rgba(13,17,23,.95);border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0">
  <span style="font-size:13px;font-weight:600">&#128196; ${escH(name||'Document')}</span>
  <div style="margin-left:auto;display:flex;gap:6px">
    <button class="ext-btn" onclick="(()=>{const b=$('doc-body');if(!b)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([b.innerText],{type:'text/plain'}));a.download='doc_'+Date.now()+'.txt';a.click();})()">&#8681; Download</button>
    <button class="ext-btn" onclick="setTab('extensions')">&#10005; Close</button>
  </div>
</div>
<div id="doc-body" contenteditable="true" spellcheck="true" style="flex:1;overflow-y:auto;padding:40px 60px;font-size:14px;line-height:1.9;color:var(--tx);outline:none;max-width:780px;margin:0 auto;width:100%;box-sizing:border-box">${(content||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n\n/g,'</p><p style="margin:0 0 14px">').replace(/\n/g,'<br>')}</div>
<div style="background:rgba(13,17,23,.97);border-top:1px solid rgba(255,255,255,.1);padding:12px 14px;flex-shrink:0">
  <div style="font-size:10px;color:#7cb8ff;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:7px">AMV AI Toolbar</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
    ${['Improve writing','Fix grammar','Make it longer','Make it shorter','Change tone to formal'].map(q=>`<button class="ext-btn" onclick="runDocAI('${q}')">${q}</button>`).join('')}
  </div>
  <div style="display:flex;gap:8px">
    <input type="text" id="doc-inp" placeholder="Ask AMV to edit, rewrite, or expand..." style="flex:1;font-size:13px">
    <button class="btn bp" id="doc-ask" style="font-size:13px;padding:8px 18px">Ask</button>
  </div>
</div></div>`;
  on($('doc-ask'),'click',()=>runDocAI($('doc-inp')&&$('doc-inp').value));
  on($('doc-inp'),'keydown',e=>{if(e.key==='Enter')runDocAI($('doc-inp')&&$('doc-inp').value);});
}
async function runDocAI(query){
  if(!query||!query.trim()) return;
  const btn=$('doc-ask'),body=$('doc-body');
  if(btn){btn.disabled=true;btn.textContent='Editing...';}
  const mk=loadStr('amv_mk');
  if(!mk){toast('Add API key in Settings','error');if(btn){btn.disabled=false;btn.textContent='Ask';}return;}
  try{
    const reply=await aiComplete('Document editor. Current document:\n\n'+(body&&body.innerText||'').slice(0,6000)+'\n\nRequest: '+query+'\n\nReturn ONLY the complete revised document. No explanation.', null, {model:(typeof qModel==='function'?qModel('rewrite'):'amv-core'), max_tokens:3000, noLang:true});
    if(body) body.innerHTML=reply.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n\n/g,'</p><p style="margin:0 0 14px">').replace(/\n/g,'<br>');
    if($('doc-inp')) $('doc-inp').value='';
    toast('Document updated','success');
  }catch(e){toast('Error: '+e.message,'error');}
  if(btn){btn.disabled=false;btn.textContent='Ask';}
}

window.amvOpenFile=amvOpenFile;
/* 7. AUTOMATION VIEW - dark modal, real task queue */
const _bgQueue = { tasks: [], running: false };
function _bgAddTask(task){
  const t={id:'bg'+Date.now(),status:'queued',created:Date.now(),progress:0,...task};
  _bgQueue.tasks.push(t);
  toast('Task queued - running in background','info',3000);
  _bgRunNext();
  return t;
}
async function _bgRunNext(){
  if(_bgQueue.running) return;
  const task=_bgQueue.tasks.find(t=>t.status==='queued');
  if(!task) return;
  _bgQueue.running=true;
  task.status='running';
  const mk=loadStr('amv_mk');
  if(!mk){task.status='failed';task.error='AMV engine not connected';_bgQueue.running=false;return;}
  try{
    if(task.type==='gmail_check'){
      const token=getGToken();
      if(!token){task.status='failed';task.error='Gmail not connected - click Connect in Integrations';_bgQueue.running=false;return;}
      task.progress=30;
      const r=await fetchDeadline('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&labelIds=INBOX&q=is:unread',{headers:{'Authorization':'Bearer '+token}});
      const d=await r.json();
      if(d.error){task.status='failed';task.error='Gmail: '+d.error.message;_bgQueue.running=false;return;}
      const msgs=d.messages||[];
      task.progress=60;
      if(!msgs.length){task.status='done';task.result='Inbox clear - no unread emails.';}
      else{
        const details=await Promise.all(msgs.slice(0,8).map(m=>fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+m.id+'?format=metadata&metadataHeaders=Subject&metadataHeaders=From',{headers:{'Authorization':'Bearer '+token}}).then(r=>r.json())));
        const summary=details.map(d=>{const s=d.payload&&d.payload.headers&&d.payload.headers.find(h=>h.name==='Subject');const f=d.payload&&d.payload.headers&&d.payload.headers.find(h=>h.name==='From');return 'From: '+(f&&f.value||'?')+'\nSubject: '+(s&&s.value||'(no subject)');}).join('\n\n');
        task.result=await aiComplete('Analyze '+msgs.length+' unread emails. What needs urgent attention?\n\n'+summary, null, {model:'amv-pulse', max_tokens:600, noLang:true})||summary;
        task.status='done';task.progress=100;
      }
    } else if(task.type==='calendar_check'){
      const token=getGToken();
      if(!token){task.status='failed';task.error='Calendar not connected';_bgQueue.running=false;return;}
      const now=new Date(),end=new Date(now.getTime()+7*24*60*60*1000);
      const r=await fetchDeadline('https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin='+now.toISOString()+'&timeMax='+end.toISOString()+'&singleEvents=true&orderBy=startTime&maxResults=20',{headers:{'Authorization':'Bearer '+token}});
      const d=await r.json();
      if(d.error){task.status='failed';task.error='Calendar: '+d.error.message;_bgQueue.running=false;return;}
      const events=(d.items||[]).map(e=>(e.start&&(e.start.dateTime||e.start.date))+': '+e.summary).join('\n');
      task.result=await aiComplete('Analyze this week\'s calendar. Identify conflicts, suggest focus blocks:\n\n'+events, null, {model:'amv-pulse', max_tokens:600, noLang:true})||events;
      task.status='done';task.progress=100;
    } else {
      task.result=await aiComplete(task.prompt||task.topic||'Help me with: '+task.title, null, {model:(typeof qModel==='function'?qModel('step'):'amv-core'), max_tokens:2000, noLang:true});
      task.status='done';task.progress=100;
    }
  }catch(e){task.status='failed';task.error=e.message;}
  _bgQueue.running=false;
  if(S.tab==='automation') renderAutomationView();
  setTimeout(_bgRunNext,500);
}
function renderAutomationView(){
  const vc=$('vc'); if(!vc) return;
  const sc=s=>s==='done'?'#4ade80':s==='running'?'#5590ff':s==='failed'?'#ff4d4d':'#e0b341';
  const si=s=>s==='done'?'✓':s==='running'?'⟳':s==='failed'?'✕':'⏳';
  const cards=['<div onclick="_bgAddTask({type:\'gmail_check\',title:\'Check Gmail inbox\'})" style="background:rgba(22,27,34,.6);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:16px;cursor:pointer;text-align:center;transition:all .2s" onmouseenter="this.style.borderColor=\'rgba(88,166,255,.2)\'" onmouseleave="this.style.borderColor=\'rgba(255,255,255,.07)\'"><div style="font-size:28px;margin-bottom:8px">📧</div><div style="font-size:13px;font-weight:600;margin-bottom:3px">Check Gmail</div><div style="font-size:11px;color:var(--mu)">Analyze unread emails</div></div>',
  '<div onclick="_bgAddTask({type:\'calendar_check\',title:\'Optimize my week\'})" style="background:rgba(22,27,34,.6);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:16px;cursor:pointer;text-align:center;transition:all .2s" onmouseenter="this.style.borderColor=\'rgba(88,166,255,.2)\'" onmouseleave="this.style.borderColor=\'rgba(255,255,255,.07)\'"><div style="font-size:28px;margin-bottom:8px">📅</div><div style="font-size:13px;font-weight:600;margin-bottom:3px">Plan my week</div><div style="font-size:11px;color:var(--mu)">Calendar optimization</div></div>',
  '<div onclick="showCustomTask()" style="background:rgba(22,27,34,.6);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:16px;cursor:pointer;text-align:center;transition:all .2s" onmouseenter="this.style.borderColor=\'rgba(88,166,255,.2)\'" onmouseleave="this.style.borderColor=\'rgba(255,255,255,.07)\'"><div style="font-size:28px;margin-bottom:8px">⚡</div><div style="font-size:13px;font-weight:600;margin-bottom:3px">Custom Task</div><div style="font-size:11px;color:var(--mu)">Any AI task in background</div></div>'].join('');
  const taskList=_bgQueue.tasks.length ? _bgQueue.tasks.slice().reverse().map(function(t){
    let h='<div style="background:rgba(22,27,34,.7);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px;margin-bottom:8px">';
    h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">';
    h+='<span style="color:'+sc(t.status)+';font-size:16px">'+si(t.status)+'</span>';
    h+='<span style="font-size:13px;font-weight:600;flex:1">'+escH(t.title)+'</span>';
    h+='<span style="font-size:10px;color:'+sc(t.status)+';background:'+sc(t.status)+'22;border-radius:10px;padding:2px 10px;font-weight:600">'+t.status+'</span>';
    h+='</div>';
    if(t.status==='running') h+='<div style="height:4px;background:rgba(255,255,255,.1);border-radius:4px;margin-bottom:8px"><div style="height:100%;width:'+(t.progress||30)+'%;background:var(--blue);border-radius:4px;transition:width .5s"></div></div>';
    if(t.error) h+='<div style="font-size:12px;color:var(--red);padding:8px;background:rgba(248,81,73,.08);border-radius:7px;margin-top:4px">'+escH(t.error)+'</div>';
    if(t.result){
      h+='<div style="font-size:12px;color:var(--mu);background:rgba(0,0,0,.25);border-radius:8px;padding:10px;margin-top:8px;max-height:180px;overflow-y:auto;white-space:pre-wrap;line-height:1.65">'+escH(t.result.slice(0,500))+(t.result.length>500?' ...(truncated)':'')+'</div>';
      h+='<div style="display:flex;gap:6px;margin-top:8px"><button class="ext-btn" onclick="toast(&quot;Result copied&quot;,&quot;success&quot;)">Copy result</button></div>';
    }
    h+='<div style="font-size:10px;color:var(--dim);margin-top:6px">'+new Date(t.created).toLocaleString()+'</div>';
    h+='</div>';
    return h;
  }).join('') : emptyState({svg:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',title:'No automations yet',sub:'Set AMV to run on a schedule - a daily news brief, a weekly report - and it works while you don\u2019t. Pick a quick automation above to start.'});
  vc.innerHTML=`<div class="sv fi"><div class="vi"><h2>Automation</h2><p class="vsub">Hand the AI a repeating job and it runs on its own in the background - checking email, summarizing, monitoring - even after you close the tab. Tap a card to queue a task; results land here when each one finishes.</p>
<div class="ss2" style="background:linear-gradient(135deg,rgba(85,144,255,.08),rgba(85,144,255,.05));border-color:rgba(88,166,255,.2)">
<h3>&#9889; Quick Automations</h3>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">${cards}</div>
</div>
<div class="ss2">
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><h3 style="margin:0">Task Queue</h3><button class="ext-btn" onclick="renderAutomationView()">Refresh</button></div>
${taskList}
</div>
</div></div>`;
}

/* ── THE JOBS THAT ACTUALLY RUN ON THE SERVER ─────────────────────────────────

   This screen used to render one thing: a queue held in this browser. The jobs
   that run unattended on the server, and the results they produce while AMV is
   shut, were fetched into `_AUTOS` / `_AUTO_RESULTS` and then displayed
   nowhere - while the unread badge was pinned to THIS tab and the scheduling
   confirmations said the result would be waiting here. So the product counted
   results, pointed at this screen, and this screen did not have them.

   They are rendered here, where the badge already sends people. */
function _autoJobsNow(){ try{ return Array.isArray(_AUTOS) ? _AUTOS : []; }catch(e){ return []; } }
function _autoResultsNow(){ try{ return Array.isArray(_AUTO_RESULTS) ? _AUTO_RESULTS : []; }catch(e){ return []; } }

function _autoWhenLabel(it){
  const every = { hourly:'every hour', daily:'every day', weekly:'every week',
                  '10min':'every 10 minutes' }[it.repeat] || ('every ' + (it.repeat || 'day'));
  let next = '';
  try{ if(it.next) next = new Date(it.next).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }catch(e){}
  return every + (next ? ' · next ' + next : '');
}

function _autoServerHTML(){
  const jobs = _autoJobsNow(), results = _autoResultsNow();
  /* No section at all when there is nothing. An empty "Running on the server"
     box reads as "set up and idle", which is a different state from "you have
     never scheduled anything" and would be a quiet lie about the former. */
  if(!jobs.length && !results.length){
    /* Except when the read FAILED. Then the same nothing means something
       different, and showing it silently tells somebody with jobs running that
       they have none - which is how they end up scheduling a duplicate. */
    const st = (typeof _autoLoadState === 'function') ? _autoLoadState() : { error:'' };
    if(!st.error) return '';
    return '<section class="uniq-sec asrv"><div class="sec-head"><h3>Running on the server</h3></div>'
      +'<div class="asrv-failed">AMV could not check what is scheduled ('+escH(String(st.error))+'). '
      +'Anything already running is still running - this is not a list of nothing. '
      +'<button class="btn bs" data-asrv-retry="1" style="font-size:11.5px">Try again</button></div></section>';
  }

  const jobRows = jobs.map(it=>{
    /* An investing check-in reads accounts directly. Calling that "writes a
       result" would misdescribe the one job whose provenance matters most. */
    const tag = it.kind === 'invest' ? 'Reads your accounts'
              : it.kind === 'research' ? 'Searches the web' : 'Writes a result';
    /* A recorded problem is shown as one. "It ran and could not read your bank"
       is a different thing from "it is broken", and different again from the
       silence that used to stand for both. */
    const err = it.lastError
      ? '<div class="asrv-err">Last run: '+escH(String(it.lastError))+'</div>' : '';
    const runs = +it.runs||0;
    return '<div class="asrv-job">'
      +'<div class="asrv-top">'
      +'<span class="asrv-name">'+escH(it.detail||'Scheduled job')+'</span>'
      +'<span class="asrv-tag">'+escH(tag)+'</span>'
      +'<span class="asrv-tag '+(it.active?'on':'off')+'">'+(it.active?'Active':'Paused')+'</span>'
      +'</div>'
      +'<div class="asrv-meta">'+escH(_autoWhenLabel(it))+' · run '+runs+' time'+(runs===1?'':'s')+'</div>'
      + err
      +'<div class="asrv-acts">'
      +'<button class="btn bs asrv-b" data-auto-act="'+(it.active?'pause':'resume')+'" data-auto-id="'+escH(String(it.id))+'">'+(it.active?'Pause':'Resume')+'</button>'
      +'<button class="btn bs asrv-b" data-auto-act="delete" data-auto-id="'+escH(String(it.id))+'">Delete</button>'
      +'</div></div>';
  }).join('');

  const unread = results.filter(r=>!r.read).length;
  const resRows = results.slice().sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,20).map(r=>{
    let when=''; try{ when=new Date(r.at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }catch(e){}
    const body = String(r.out||'');
    return '<div class="asrv-res'+(r.read?'':' unread')+'">'
      +'<div class="asrv-top">'
      +(r.read?'':'<span class="asrv-dot" aria-label="Unread"></span>')
      +'<span class="asrv-name">'+escH(r.detail||'Scheduled job')+'</span>'
      +'<span class="asrv-when">'+escH(when)+'</span></div>'
      +'<div class="asrv-out" data-no-i18n>'
      + escH(body.slice(0,2000)) + (body.length>2000?'\n...(truncated)':'')
      +'</div></div>';
  }).join('');

  return '<section class="asrv">'
    +'<div class="sec-head asrv-head"><h3>Running on the server</h3>'
    +(unread?'<button class="btn bs asrv-b" data-auto-act="markread">Mark '+unread+' read</button>':'')
    +'</div>'
    +'<p class="vsub asrv-sub">These run whether or not AMV is open. Results appear here when each one finishes.</p>'
    +(jobRows||'<div class="asrv-none">No scheduled jobs yet.</div>')
    +(resRows?'<div class="asrv-lbl">Results</div>'+resRows:'')
    +'</section>';
}

function _wireAutoServer(root){
  /* The retry on the "could not check" state, so it is a control and not a
     sentence about one. */
  root.querySelectorAll('[data-asrv-retry]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      b.disabled=true; b.textContent='Checking\u2026';
      try{ await _autoRefresh(); }catch(e){}
      try{ renderTasksView(); }catch(e){}
    });
  });
  root.querySelectorAll('[data-auto-act]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const act=b.dataset.autoAct, id=b.dataset.autoId;
      b.disabled=true;
      try{
        if(act==='markread'){ await _autoMarkRead(); }
        else if(act==='delete'){
          /* Deleting a running job is not undoable from here, so it is asked
             about rather than done on a single tap. */
          if(typeof confirm==='function' && !confirm('Delete this scheduled job? It will stop running.')){ b.disabled=false; return; }
          await _autoAction(id,'delete');
        }
        else await _autoAction(id, act);
        renderTasksView();
      }catch(e){
        b.disabled=false;
        if(typeof toast==='function') toast('Could not update that job: '+((e&&e.message)||'try again'),'error',4500);
      }
    });
  });
}

/* 8. CUSTOM TASK MODAL - dark background guaranteed */
function showCustomTask(){
  const r=$('ovr'); if(!r) return;
  const div=document.createElement('div');
  div.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(8px)';
  div.innerHTML='<div style="background:var(--s1);border:1px solid var(--hair);border-radius:18px;padding:28px;width:100%;max-width:460px;box-shadow:0 24px 60px rgba(0,0,0,.4);position:relative">'
    +'<div style="font-size:18px;font-weight:700;color:var(--tx);margin-bottom:4px">Custom Background Task</div>'
    +'<div style="font-size:12px;color:var(--mu);margin-bottom:20px">Runs automatically - navigate away and it will complete</div>'
    +'<div style="display:flex;flex-direction:column;gap:14px">'
    +'<div><label style="font-size:11px;font-weight:600;color:var(--mu);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Task Name</label><input type="text" id="ct-name" placeholder="e.g. Research competitors" style="width:100%;padding:10px 12px;background:var(--s2);border:1px solid var(--hair);border-radius:10px;color:var(--tx);font-size:13px;outline:none;box-sizing:border-box"></div>'
    +'<div><label style="font-size:11px;font-weight:600;color:var(--mu);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Instructions</label><textarea id="ct-prompt" rows="4" placeholder="What do you want AMV to do?" style="width:100%;padding:10px 12px;background:var(--s2);border:1px solid var(--hair);border-radius:10px;color:var(--tx);font-size:13px;outline:none;resize:vertical;box-sizing:border-box;font-family:inherit"></textarea></div>'
    +'<button id="ct-go" style="width:100%;padding:13px;background:var(--accent);border:none;border-radius:12px;color:var(--on-accent);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">&#9889; Run in Background</button>'
    +'</div></div>';
  r.innerHTML=''; r.appendChild(div);
  div.addEventListener('click',e=>{if(e.target===div)r.innerHTML='';});
  document.getElementById('ct-go').addEventListener('click',()=>{
    const name=document.getElementById('ct-name')&&document.getElementById('ct-name').value.trim()||'Custom Task';
    const prompt=document.getElementById('ct-prompt')&&document.getElementById('ct-prompt').value.trim();
    if(!prompt){toast('Enter task instructions','error');return;}
    r.innerHTML='';
    _bgAddTask({type:'ai_task',title:name,prompt});
    setTab('automation');
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   GLOBAL MAIL - the connect flow and the inbox.

   The integrations page offered Google and Microsoft 365 and nothing else,
   which means it offered nothing at all to most of the world. This is the
   other half of that: pick your provider, paste the app password it gives
   you, and AMV reads and answers your mail the same way it does for Gmail.

   The per-provider instruction is shown AT the password field rather than in
   a help page, because every one of these providers calls it something
   different and hides it somewhere different, and somebody who pastes their
   ordinary login password gets a refusal that reads like a bug in AMV.
   ═══════════════════════════════════════════════════════════════════════ */
let _MAILP = null;        // provider catalogue, fetched once
let _MAIL_STATUS = null;  // what is connected right now

async function _mailLoadProviders(){
  if(_MAILP) return _MAILP;
  try{ _MAILP = await AMV_API.mailProviders(); }catch(e){ _MAILP = null; }
  return _MAILP;
}

async function refreshMailStatus(){
  try{ _MAIL_STATUS = await AMV_API.mailStatus(); }catch(e){ _MAIL_STATUS = null; }
  return _MAIL_STATUS;
}

function _mailConnectedAccount(){
  return (_MAIL_STATUS && _MAIL_STATUS.connected && _MAIL_STATUS.account) ? _MAIL_STATUS.account : null;
}

/* The picker. Grouped by country so somebody scans for their flag rather than
   reading forty names, and every provider carries its own setup sentence. */
async function openMailConnect(){
  const cat = await _mailLoadProviders();
  const r=$('ovr'); if(!r) return;
  if(!cat || !cat.providers){
    r.innerHTML='<div class="ov" id="ml-bg"><div class="ml-modal"><h2>Mail</h2>'+
      '<p class="mu">AMV could not load the provider list. Check your connection and try again.</p>'+
      '<div class="ml-foot"><button class="btn" id="ml-x">Close</button></div></div></div>';
    on($('ml-x'),'click',()=>{ r.innerHTML=''; });
    return;
  }
  const byCountry={};
  for(const p of cat.providers){
    const k=p.custom?'zz':(p.country||'zz');
    (byCountry[k]=byCountry[k]||[]).push(p);
  }
  const order=Object.keys(byCountry).sort((a,b)=> a==='zz'?1 : b==='zz'?-1 : a.localeCompare(b));
  const opts=order.map(c=>{
    const list=byCountry[c];
    const label=c==='zz'?'Anywhere else':(list[0].flag+' '+c);
    return '<optgroup label="'+escH(label)+'">'+
      list.map(p=>'<option value="'+escH(p.id)+'">'+escH(p.flag+' '+p.name)+'</option>').join('')+
    '</optgroup>';
  }).join('');

  r.innerHTML='<div class="ov" id="ml-bg"><div class="ml-modal" role="dialog" aria-modal="true" aria-labelledby="ml-h">'+
    '<div class="ml-head"><div><div class="eyebrow">Mail</div><h2 id="ml-h">Connect your mailbox</h2></div>'+
      '<button class="tp-x" id="ml-x" aria-label="Close">✕</button></div>'+
    '<p class="mu ml-intro">AMV works with '+(+cat.countries||20)+'+ countries’ mail providers over IMAP, the open standard they all support. Your password is encrypted on AMV’s server and is never sent back to this browser.</p>'+
    '<label class="ml-f"><span>Provider</span><select id="ml-prov">'+opts+'</select></label>'+
    '<div id="ml-custom" style="display:none">'+
      '<label class="ml-f"><span>IMAP server</span><input id="ml-imap" placeholder="imap.example.com" autocomplete="off"></label>'+
      '<label class="ml-f"><span>SMTP server</span><input id="ml-smtp" placeholder="smtp.example.com" autocomplete="off"></label>'+
    '</div>'+
    '<label class="ml-f"><span>Email address</span><input id="ml-addr" type="email" placeholder="you@example.com" autocomplete="username"></label>'+
    '<label class="ml-f"><span>App password</span><input id="ml-pass" type="password" autocomplete="off"></label>'+
    '<p class="ml-setup" id="ml-setup"></p>'+
    '<div class="ml-err" id="ml-err" style="display:none" role="alert"></div>'+
    '<div class="ml-foot"><button class="btn" id="ml-cancel">Cancel</button>'+
      '<button class="btn bp" id="ml-go">Connect</button></div>'+
  '</div></div>';

  const sel=$('ml-prov');
  const showSetup=()=>{
    const p=cat.providers.find(x=>x.id===sel.value);
    const el=$('ml-setup'); if(el&&p) el.textContent=p.setup||'';
    const cu=$('ml-custom'); if(cu) cu.style.display=(p&&p.custom)?'':'none';
  };
  on(sel,'change',showSetup); showSetup();

  /* Guarded so a click INSIDE the dialog does not close it, without using
     stopPropagation - which would kill the delegated handlers on every button
     in here (LESSONS #5). */
  on($('ml-bg'),'click',(e)=>{ if(e.target===e.currentTarget) r.innerHTML=''; });
  on($('ml-x'),'click',()=>{ r.innerHTML=''; });
  on($('ml-cancel'),'click',()=>{ r.innerHTML=''; });
  on($('ml-go'),'click',async()=>{
    const btn=$('ml-go'), err=$('ml-err');
    const provider=sel.value;
    const body={ provider, address:($('ml-addr')||{}).value||'', password:($('ml-pass')||{}).value||'' };
    const p=cat.providers.find(x=>x.id===provider);
    if(p&&p.custom){ body.imap=($('ml-imap')||{}).value||''; body.smtp=($('ml-smtp')||{}).value||''; }
    err.style.display='none';
    btn.disabled=true; btn.textContent='Connecting…';
    try{
      await AMV_API.mailConnect(body);
      /* Cleared the moment it has been handed over. There is no reason for a
         mailbox password to stay in a DOM node after it has been used. */
      const pw=$('ml-pass'); if(pw) pw.value='';
      await refreshMailStatus();
      r.innerHTML='';
      toast('Mailbox connected','success');
      try{ _refreshIntegrationsUI(); }catch(e){}
    }catch(e){
      /* The server distinguishes a wrong password from IMAP being switched off
         from a server that did not answer, and each needs a different action -
         so its sentence is shown rather than a generic failure. */
      err.textContent=String((e&&e.message)||'Could not connect.');
      err.style.display='';
      btn.disabled=false; btn.textContent='Connect';
    }
  });
}

async function disconnectMail(){
  if(!confirm('Disconnect this mailbox? AMV will stop reading it and will forget the password.')) return;
  try{ await AMV_API.mailDisconnect(); }catch(e){}
  await refreshMailStatus();
  toast('Mailbox disconnected','success');
  try{ _refreshIntegrationsUI(); }catch(e){}
}

/* The inbox, and the thing a person actually wants: a summary of it. */
async function openMailInbox(){
  const r=$('ovr'); if(!r) return;
  r.innerHTML='<div class="ov" id="mi-bg"><div class="ml-modal"><div class="ml-head">'+
    '<div><div class="eyebrow">Mail</div><h2>Your inbox</h2></div>'+
    '<button class="tp-x" id="mi-x" aria-label="Close">✕</button></div>'+
    '<div id="mi-body"><p class="mu">Reading your mailbox…</p></div></div></div>';
  on($('mi-bg'),'click',(e)=>{ if(e.target===e.currentTarget) r.innerHTML=''; });
  on($('mi-x'),'click',()=>{ r.innerHTML=''; });

  let data=null;
  try{ data=await AMV_API.mailInbox(25); }
  catch(e){
    const b=$('mi-body'); if(b) b.innerHTML='<div class="ml-err" role="alert">'+escH(String((e&&e.message)||'Could not read the mailbox.'))+'</div>';
    return;
  }
  const msgs=(data&&data.messages)||[];
  const b=$('mi-body'); if(!b) return;
  if(!msgs.length){ b.innerHTML='<p class="mu">Nothing in the inbox right now.</p>'; return; }
  b.innerHTML='<div class="mi-list">'+msgs.map(m=>
      '<div class="mi-row'+(m.seen?'':' unread')+'">'+
        '<div class="mi-from">'+escH(m.from||'(no sender)')+'</div>'+
        '<div class="mi-subj">'+escH(m.subject||'(no subject)')+'</div>'+
        '<div class="mi-date">'+escH(m.date||'')+'</div>'+
      '</div>').join('')+'</div>'+
    '<div class="ml-foot"><button class="btn bp" id="mi-sum">Summarize these in chat</button></div>';
  on($('mi-sum'),'click',()=>{
    /* Handed to chat as text rather than summarised here, so it goes through
       the same model, plan limits and spend ceiling as everything else rather
       than round a second path. */
    const lines=msgs.map(m=>'- '+(m.from||'?')+' | '+(m.subject||'(no subject)')+' | '+(m.date||''));
    r.innerHTML='';
    try{
      setTab('chat');
      const box=$('inp'); if(box){ box.value='Summarize my inbox and tell me what needs a reply:\n'+lines.join('\n'); box.focus(); }
    }catch(e){}
  });
}

/* Exposed by name because the catalogue's Run button resolves its handler
   through window[...] - a function that is only a top-level declaration works
   in the bundle today and stops working the moment anything wraps it. */
window.openMailConnect = openMailConnect;
window.openMailInbox   = openMailInbox;
window.disconnectMail  = disconnectMail;
window.refreshMailStatus = refreshMailStatus;

