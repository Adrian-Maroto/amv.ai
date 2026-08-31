/* ============================================================
   AUTONOMOUS INTEGRATION ACTIONS - the real "does the work" layer.
   AMV can READ and ACT across connected accounts via these executable
   tools. The AI is given the tool list, decides what to do, and we
   execute the calls against the provider APIs with the user's token.
   ============================================================ */
/* Is there ANY usable connection? The per-action capability is the server's to
   check - it holds the grant and refuses without the scope - so this only has
   to answer whether offering these tools at all makes sense. */
function _connHasAny(){
  try{
    const items=((_connState&&_connState.data)||{}).items||[];
    return items.some(x=>x && !x.broken);
  }catch(e){ return false; }
}
try{ window._connHasAny=_connHasAny; }catch(e){}

/* One door to the server for every connected-account action.

   The refusal is passed through rather than flattened to "that failed",
   because the server distinguishes three cases the person can act on and they
   have three different fixes: nothing is connected, something is connected but
   this permission was not granted, and the connection has stopped working.
   Collapsing them sends somebody to reconnect an account that is fine. */
async function _connActRun(action, args){
  if(!(window.AMV_API && AMV_API.live))
    throw new Error('AMV is not connected to its engine, so it cannot reach your accounts.');
  const d = await AMV_API.connectAct(action, args || {});
  if(d && d.error) throw new Error(d.message || d.error);
  return d ? d.result : null;
}
try{ window._connActRun=_connActRun; }catch(e){}

const INTEGRATION_ACTIONS = {
  /* ---- SCHOOL --------------------------------------------------------------

     What a student has been set, and when it is due. The piece that turns "tell
     AMV your deadlines every week" into "AMV already knows", which is the
     difference between a planner somebody maintains and one that maintains
     itself.

     Read-only by SCOPE rather than by rule: the permission that would let AMV
     turn work in was never requested, so Google refuses the call. A rule in a
     prompt can be argued with by anything that gets text in front of a model.
     A permission that does not exist cannot.

     The whole reader moved to the server with the rest. It used to say, in this
     comment, that it read from THIS BROWSER and so ran only while AMV was open
     - which was honest about a real limitation and is no longer the limitation.
     It reads with the sealed grant now, so the morning plan is there whether or
     not anybody opened a tab. The class-that-could-not-be-read rule went with
     it: a class that failed to load is not a class with nothing due, and it is
     named in what the model is handed rather than dropped. */
  classroom_due: {
    desc:'List what the user has been set at school and when it is due, from Google Classroom. Read-only.',
    needs:'connect',
    async run(){ return await _connActRun('school.due'); }
  },
  /* ── THE FIVE THAT MOVED TO THE SERVER ────────────────────────────────────

     Each of these used to hold a Google token in this page and call Google
     from here. That is the older grant, and two things were wrong with it that
     no amount of care in these functions could fix: a provider token that
     reaches a page is a token anything on that page can take, and it is gone
     when the tab closes, so nothing built on it could ever run overnight.

     They ask the server now. The server holds the sealed grant, checks that the
     capability was actually granted, records the use against the account, and
     returns the result. The credential never comes here.

     The `needs` key is 'connect' rather than 'google' because the question is
     no longer "is a Google token in this browser" - it is "is there a grant on
     the server that covers this". A high-risk action still asks the person
     first, in this browser, before the request is made: the server refusing
     without the scope is the floor, not the consent. */
  gmail_list_unread: {
    desc:'List the user\u2019s unread emails (sender + subject).', needs:'connect',
    async run(){ return await _connActRun('gmail.unread'); }
  },
  gmail_send: {
    desc:'Send an email. Args: {to, subject, body}.', needs:'connect', risk:'high', riskLabel:'send an email',
    async run(args){ return await _connActRun('gmail.send', args); }
  },
  calendar_list: {
    desc:'List upcoming calendar events for the next 7 days.', needs:'connect',
    async run(){ return await _connActRun('calendar.list'); }
  },
  calendar_create: {
    desc:'Create a calendar event. Args: {title, start (ISO), end (ISO), description?}.', needs:'connect', risk:'high', riskLabel:'create a calendar event',
    async run(args){ return await _connActRun('calendar.create', args); }
  },
  drive_list: {
    desc:'List recent Google Drive files.', needs:'connect',
    async run(){ return await _connActRun('drive.list'); }
  },
  /* BOTH OF THESE WENT THROUGH THE BROWSER AND COULD NEVER WORK.

     They read a GitHub token from localStorage under `amv_github`, a key that
     no connect flow has ever written - so every call threw "GitHub not
     connected" at somebody whose account WAS connected, and the fix looked
     like a bug in GitHub rather than a key that does not exist.

     They go through the server now, which is where the token actually lives
     and the only place it should: a repo-scoped credential in localStorage is
     one injected script away from being somebody else's. */
  github_list_issues: {
    desc:'List open issues for a repo. Args: {repo: "owner/name"}.', needs:'github',
    async run(args){ return await _connActRun('github.issues', { repo:args.repo }); }
  },
  github_create_issue: { risk:'high', riskLabel:'create a GitHub issue',
    desc:'Open a GitHub issue. Args: {repo:"owner/name", title, body}.', needs:'github',
    async run(args){ return await _connActRun('github.issue.create', args); }
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
    /* Asked of the GRANT, per capability, not of the sign-in. "Somebody signed
       in with Google" was standing in for "AMV may read this mailbox", and they
       are different questions - which is how a screen came to report Gmail as
       connected to an account that had granted no mail scope at all. */
    isConnected:()=>_cwConnHas('mail.read'),
    keywords:['email','emails','gmail','inbox','e-mail','reply to','send a mail','unread','draft a reply','respond to','mailbox'] },
  { id:'calendar', integration:'Google Calendar', label:'view or create calendar events',
    api:'Google Calendar API', auth:'Google account (OAuth)',
    connectId:'google', tools:['calendar_list','calendar_create'],
    isConnected:()=>_cwConnHas('calendar.read'),
    keywords:['calendar','schedule','meeting','event','appointment','book time','block time','remind me to meet','agenda','availability'] },
  { id:'drive', integration:'Google Drive', label:'read or list your files',
    api:'Google Drive API', auth:'Google account (OAuth)',
    connectId:'google', tools:['drive_list'],
    isConnected:()=>_cwConnHas('drive.read'),
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
    /* A server-held grant, asked of the server's own list. This used to ask
       whether a Google token was in this browser, which stopped being the
       question when the token stopped coming here - and would have answered
       "no tools available" on an account with every permission granted. */
    if(a.needs==='connect') return !!(window.AMV_API && AMV_API.live) && _connHasAny();
    if(a.needs) return !!loadStr('amv_'+a.needs);
    return true;
  });
  if(!available.length) throw new Error('No integrations connected yet. Connect an account in Settings, Integrations first.');
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
      body:'<div style="font-size:var(--t-base);line-height:1.6;color:var(--tx)">AMV wants to:<br><br><b>'+escH(detail)+'</b><br><br><span style="color:var(--mu);font-size:var(--t-sm)">This takes a real action on your connected account. Approve only if you\u2019re sure.</span></div>',
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
    /* THREE THINGS AMV LEARNED TO DO AND NEVER MENTIONED HERE.

       This list was written before Connected accounts, before the country
       packs, and before the agent that works a website. So the page whose job
       is to answer "what can this actually do" was describing a smaller
       product than the one underneath it. Each of these lands somewhere real:
       the first opens Connected accounts, the second opens the catalogue where
       a hundred countries now are, the third opens the box that takes a
       sentence. */
    ['\uD83D\uDD10','Act on your real accounts','Connect an account once and AMV works inside it - reading, drafting, organizing - with a scoped grant you can take back at any time.','connect'],
    ['\uD83C\uDF0D','Whatever your country actually needs','The paperwork, the shops, the deadlines and the weather where you live - written for 105 countries, not translated from one.','world'],
    ['\uD83D\uDCAC','Just say it, and it goes and does it','Describe the outcome in a sentence. AMV works out which accounts and sites it needs, does the work, and stops for your approval before anything leaves.','say'],
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
  /* Connected accounts is a Settings pane rather than a tab, so the pane has
     to be set before the tab or it lands on whichever one was open last. */
  if(kind==='connect'){ try{ S.settingsPane='integrations'; }catch(e){} setTab('settings'); return; }
  if(kind==='world'){ setTab('crew'); return; }
  /* Straight into the box, with the cursor in it. The point of this card is
     that saying it IS the interface, so making somebody hunt for the field
     would be the card describing itself wrongly. */
  if(kind==='say'){
    setTab('crew');
    setTimeout(()=>{ try{ const el=document.getElementById('mc-cmd-input');
      if(el){ el.scrollIntoView({block:'center'}); el.focus(); } }catch(e){} }, 260);
    return;
  }
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

/* 5. INTEGRATIONS VIEW - routes to the unified catalog in Settings so there is
   ONE integrations experience (the new Connect catalog), not two. */
/* ============================================================
   INTEGRATIONS - shared catalog (Task #2)
   The catalog renders identically as its own full-page view AND
   inside the Settings pane, from one source of truth.
   ============================================================ */
/* Is there a REAL connection to this provider - a grant the server holds - as
   opposed to a sign-in token that proves identity and permits nothing? The
   catalogue used getGToken() for Google, which answers the second question and
   was being read as the first. */
function _connHasProvider(id){
  try{
    const items=((_connState&&_connState.data)||{}).items||[];
    return items.some(x=>x && x.provider===id && !x.broken);
  }catch(e){ return false; }
}
try{ window._connHasProvider=_connHasProvider; }catch(e){}

function _integrationsCatalogHTML(){
  const smsPhone=loadStr('amv_sms_phone');
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
      ? ((o.run?'<button class="btn bp" data-int-run="'+o.run+'" style="font-size:var(--t-sm)">'+escH(o.runLabel||'Run')+'</button>':'')+
         '<button class="btn int-disc" data-int-disc="'+o.id+'" style="font-size:var(--t-sm)">Disconnect</button>')
      : (o.auto
          ? '<button class="btn bp" data-int-conn="'+o.id+'" style="font-size:var(--t-sm)">Connect</button>'
          : '<button class="btn bs" data-int-use="'+(o.use||'chat')+'" style="font-size:var(--t-sm)">'+(o.useLabel||'Open in chat')+'</button>');
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
      /* CONNECT MEANT SIGN IN, AND THE ROW SAID GMAIL.

         This row is labelled Autonomous - "runs on its own in the background
         after you connect" - and describes reading and drafting email. Its
         Connect button called connectIntegration('google'), which calls
         triggerGoogle: Google SIGN-IN, the one-tap that proves who you are and
         grants no Gmail, Drive or Calendar scope at all. Somebody who wanted
         AMV to read their mail could press Connect, complete a real Google
         flow, come back, and have granted nothing - and `connected` was read
         from the sign-in token, so the row would then show a tick.

         The flow that does what this row describes is Connected accounts,
         directly above: the server holds the grant, the scopes are chosen, and
         it survives the tab closing. So the row points there. Nothing is
         removed - the capability moves to the entry that actually delivers it,
         which is the difference between a catalogue and a promise. */
      intRow({id:'google',name:'Google (Gmail, Drive, Calendar)',desc:'Reads & drafts email, organizes Drive, manages your calendar - automatically. Set up under Connected accounts above, where you choose what AMV may do.',auto:true,connected:_connHasProvider('google'),icon:'\uD83D\uDCE7',bg:'rgba(66,133,244,.14)'})+
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
              icon:'\uD83C\uDF0D',bg:'rgba(120,180,120,.14)'})+
      /* The boards somebody's country actually uses. Reachable from here
         because this is where a person goes looking for what AMV connects
         to, and a catalogue nothing links to is a catalogue nobody reads. */
      intRow({id:'jobboards',name:'Job boards worldwide (Europe, Asia and beyond)',
              desc:'StepStone, Reed, Pracuj, Naukri, Saramin, 51job, Rikunabi and more - AMV applies where a posting takes email, and prepares the rest.',
              auto:false,connected:false,use:'jobs',useLabel:'Browse boards',
              icon:'\uD83D\uDCBC',bg:'rgba(200,160,90,.14)'})+
      /* The answer to "does any of this work where I live", which is the first
         thing somebody outside the United States wants to know. */
      /* The half of "what works where I live" that is not a directory: the
         things somebody there does every week. */
      intRow({id:'everyday',name:'Everyday life where you live',
              desc:'Bills, renewals, fines, official letters and school dates - watched and dated for your country, not somebody else\u2019s.',
              auto:false,connected:false,use:'everyday',useLabel:'See yours',
              icon:'\uD83C\uDFE0',bg:'rgba(150,170,110,.14)'})+
      intRow({id:'coverage',name:'AMV around the world',
              desc:'Every country AMV works in, and what it can do there - mail, job boards, and where it can apply for you.',
              auto:false,connected:false,use:'coverage',useLabel:'See coverage',
              icon:'\uD83C\uDF10',bg:'rgba(90,150,200,.14)'})
    )+
    cat('Messaging &amp; chat',
      intRow({id:'slack',name:'Slack',desc:'Answers, summaries and tasks inside any channel with /amv.',auto:true,connected:isConn('amv_slack'),icon:'\uD83D\uDCAC',bg:'rgba(74,21,75,.16)'})+
      intRow({id:'sms',name:'Text messages (SMS)',desc:'Run AMV from any phone by text - \u201ccheck Project X\u201d, \u201cdraft a reply\u201d.',auto:true,connected:!!smsPhone,icon:'\uD83D\uDCF1',bg:'rgba(63,185,80,.14)'})+
      /* The messenger most of the world actually uses. Free official API, no
         business verification, and it is the default across Russia, Ukraine,
         Iran, much of Central Asia, and huge in Brazil, India and Nigeria -
         where SMS costs money per message and Slack is a work tool. */
      /* Asked of the server, like the mailbox, NOT of a local flag. The token
         lives on the server, so a browser key is a guess - and a wrong guess
         here shows Connect to somebody already connected, who then connects a
         second time. */
      intRow({id:'telegram',name:'Telegram',
              desc:_telegramConnectedBot()
                ? ('Connected as @'+escH(_telegramConnectedBot())+'. AMV sends your background work here.')
                : 'Run AMV from Telegram and get your background work there - through a bot you own and can revoke.',
              auto:true,connected:!!_TG_STATUS&&!!_TG_STATUS.connected,
              icon:'\u2708\uFE0F',bg:'rgba(42,171,238,.16)'})+
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

/* Which providers the connected-accounts framework handles. Read from what the
   server actually offers rather than a list kept here, so the two cannot drift:
   a provider added on the server is owned by the framework the moment it
   appears, and one removed stops being claimed. */
function _connOwnsProvider(id){
  try{
    const provs=((_connState&&_connState.data)||{}).providers||[];
    return provs.some(p=>p && p.id===id);
  }catch(e){ return false; }
}
/* Take them to the section that does it, and open the scope picker so the
   press does something rather than scrolling and stopping. */
function _connGoTo(id){
  try{
    const sec=document.getElementById('conn-sec');
    if(sec) sec.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){}
  try{ if(typeof announce==='function') announce('Connected accounts'); }catch(e){}
  try{ return connAdd(id); }catch(e){}
}
try{ window._connOwnsProvider=_connOwnsProvider; window._connGoTo=_connGoTo; }catch(e){}

function _wireIntegrationCatalog(root){
  root=root||document;
  /* Mail is connected with a password rather than an OAuth round trip, so it
     has its own flow instead of being pushed through connectIntegration. */
  root.querySelectorAll('[data-int-conn]').forEach(btn=>on(btn,'click',()=>{
    if(btn.dataset.intConn==='mail') return openMailConnect();
    if(btn.dataset.intConn==='telegram') return openTelegramConnect();
    /* Providers the connected-accounts framework owns are STARTED there, not
       here. Google's row used to run a sign-in from this button; sending it to
       the real flow is the whole fix, and it is done by provider id rather
       than by naming Google, so adding Microsoft to that framework does not
       leave a second row quietly doing the wrong thing. */
    if(_connOwnsProvider(btn.dataset.intConn)) return _connGoTo(btn.dataset.intConn);
    connectIntegration(btn.dataset.intConn);
  }));
  root.querySelectorAll('[data-int-disc]').forEach(btn=>on(btn,'click',()=>{
    if(btn.dataset.intDisc==='mail') return disconnectMail();
    if(btn.dataset.intDisc==='telegram') return disconnectTelegram();
    disconnectIntegration(btn.dataset.intDisc);
  }));
  root.querySelectorAll('[data-int-run]').forEach(btn=>on(btn,'click',()=>{
    const fn=window[btn.dataset.intRun];
    if(typeof fn==='function') fn();
    else toast('That automation is not available in this build.','error');
  }));
  root.querySelectorAll('[data-int-use]').forEach(btn=>on(btn,'click',()=>{
    if(btn.dataset.intUse==='jobs' && typeof openJobBoards==='function') return openJobBoards();
    if(btn.dataset.intUse==='coverage' && typeof openCoverage==='function') return openCoverage();
    if(btn.dataset.intUse==='everyday' && typeof openEveryday==='function') return openEveryday();
    setTab(btn.dataset.intUse||'chat'); toast('Upload your file with the \uD83D\uDCCE button, or just describe what you need.','info',4500); }));
}
window._wireIntegrationCatalog=_wireIntegrationCatalog;

/* Refresh whichever integrations surface is currently visible:
   the standalone Integrations page OR the Settings > Integrations pane. */
function _refreshIntegrationsUI(){
  /* Status first, then repaint. Without this a mailbox that IS connected shows
     a Connect button until some other event happens to redraw the page, which
     reads as the connection having failed. */
  try{
    Promise.all([refreshMailStatus(), refreshTelegramStatus()])
      .then(()=>{ try{ _paintIntegrations(); }catch(e){} });
  }catch(e){}
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
/* ── CONNECTED ACCOUNTS ──────────────────────────────────────────────────────

   The screen for the thing that carries the most risk in this product, so it
   is written to be read by somebody deciding whether to trust it rather than by
   somebody admiring it.

   Three facts per connection, because these are the three somebody actually
   wants: what it may do, whether it works while AMV is closed, and when it was
   last used and by which job. "Last used by Morning inbox digest, 6 hours ago"
   is the line that makes an unattended grant something a person can supervise
   rather than something they have to take on faith. */
let _connState = { state:'idle', data:null, err:'' };

async function _connLoad(force){
  if(_connState.state === 'loading') return;
  if(_connState.state === 'done' && !force) return;
  if(!(window.AMV_API && AMV_API.live && AMV_API.connectList)){
    _connState = { state:'off', data:null, err:'' }; _connPaint(); return;
  }
  _connState.state = 'loading'; _connPaint();
  try{
    const d = await AMV_API.connectList();
    _connState = { state:'done', data:d || null, err:'' };
  }catch(e){
    _connState = { state:'error', data:null, err:String((e&&e.message)||'').slice(0,120) };
  }
  _connPaint();
}
function _connPaint(){
  try{ const el=document.getElementById('conn-body'); if(el) el.innerHTML=_connBodyHTML(); }catch(e){}
}
function connReload(){ _connState={state:'idle',data:null,err:''}; _connLoad(true); }
try{ window.connReload=connReload; }catch(e){}

function _connAgo(ts){
  const t = Number(ts)||0; if(!t) return 'never';
  const m = Math.round((Date.now()-t)/60000);
  if(m < 1) return 'just now';
  if(m < 60) return m+' min ago';
  if(m < 1440) return Math.round(m/60)+'h ago';
  const d = Math.round(m/1440);
  return d === 1 ? 'yesterday' : d+' days ago';
}
/* Capability keys are for the wire. These are for people. */
const _CONN_SCOPE_WORDS = {
  'mail.read':'read your mail', 'mail.send':'send mail as you',
  'calendar.read':'read your calendar', 'calendar.write':'add and change events',
  'drive.read':'read your files', 'repo.read':'read your repositories',
  'issues.write':'open and update issues',
  /* Said as what it can SEE and what it cannot DO, in one line, because this is
     the one on the list a parent will read twice. */
  'school.read':'see what you have been set at school and when it is due - it cannot turn work in',
};
function _connScopeWords(list){
  return (Array.isArray(list)?list:[]).map(k => _CONN_SCOPE_WORDS[k] || k);
}

async function connAdd(provider){
  const d = _connState.data || {};
  const p = (d.providers||[]).find(x => x.id === provider);
  if(!p) return;
  if(!p.ready){
    toast(p.name+' is not set up on this deployment yet. It needs an app registered with '+p.name+' and its credentials added on the server.','info',7000);
    return;
  }
  /* ASKED FOR, NOT ASSUMED. The person chooses what this connection may do,
     and the list is what the provider actually offers. Connecting for a
     calendar digest must not quietly request permission to send mail. */
  const pick = await _connScopePick(p);
  if(!pick || !pick.length) return;
  try{
    const redirect = window.location.origin + window.location.pathname;
    const r = await AMV_API.connectStart(provider, pick, redirect);
    if(r && r.url){ saveStr('amv_conn_return', S.tab||'integrations'); window.location.href = r.url; return; }
    toast('That connection could not be started.','error',5000);
  }catch(e){
    toast(String((e&&e.message)||'That connection could not be started.'),'error',7000);
  }
}
try{ window.connAdd=connAdd; }catch(e){}

/* A real choice, with the consequence of each line written out. */
function _connScopePick(p){
  return new Promise(resolve => {
    const r = $('ovr'); if(!r){ resolve(null); return; }
    const rows = (p.scopes||[]).map((k,i) =>
      '<label class="conn-scope"><input type="checkbox" data-scope="'+escH(k)+'"'+(i===0?' checked':'')+'>'+
      '<span>'+escH(_CONN_SCOPE_WORDS[k] || k)+'</span></label>').join('');
    r.innerHTML =
      '<div class="ov" id="conn-bg"><div class="cwp" role="dialog" aria-modal="true" aria-labelledby="conn-t">'+
        '<button class="cwp-x" id="conn-x" aria-label="Close">✕</button>'+
        '<div class="cwp-head"><div><h2 class="cwp-t" id="conn-t">Connect '+escH(p.name)+'</h2>'+
          '<div class="cwp-meta"><span class="cwp-pill">You choose what it may do</span></div></div></div>'+
        '<p class="cwp-desc">Pick only what you need. You can disconnect at any time, and AMV revokes it with '+escH(p.name)+' when you do.</p>'+
        '<div class="conn-scopes">'+rows+'</div>'+
        '<p class="conn-warn"><b>This lets AMV work while you are away.</b> It also means AMV’s servers hold a key to this account until you disconnect it. Every time a job uses it, that is recorded here with the job’s name.</p>'+
        '<div class="cwp-foot"><button class="btn" id="conn-cancel">Cancel</button>'+
          '<button class="btn bp" id="conn-go">Continue to '+escH(p.name)+'</button></div>'+
      '</div></div>';
    const done = (v) => { r.innerHTML=''; resolve(v); };
    on($('conn-x'),'click',()=>done(null));
    on($('conn-cancel'),'click',()=>done(null));
    onBackdrop($('conn-bg'),()=>done(null));
    on($('conn-go'),'click',()=>{
      const picked=[...r.querySelectorAll('[data-scope]')].filter(c=>c.checked).map(c=>c.dataset.scope);
      if(!picked.length){ toast('Pick at least one thing AMV may do, or cancel.','info',4000); return; }
      done(picked);
    });
  });
}

async function _connectFinish(code, state){
  try{
    const r = await AMV_API.connectFinish(code, state);
    if(r && r.ok){
      toast(r.unattended
        ? (r.name||'That account')+' is connected. Jobs using it now run with AMV closed.'
        : (r.note || 'Connected, but only while AMV is open.'),
        r.unattended ? 'success' : 'info', r.unattended ? 5000 : 9000);
    } else {
      toast('That connection did not complete.','error',6000);
    }
  }catch(e){
    toast(String((e&&e.message)||'That connection did not complete.'),'error',8000);
  }
  try{ const back=loadStr('amv_conn_return')||'integrations'; saveStr('amv_conn_return',''); setTab(back); }catch(e){}
  connReload();
}
try{ window._connectFinish=_connectFinish; }catch(e){}

async function connRemove(id){
  const d=_connState.data||{};
  const it=(d.items||[]).find(x=>x.id===id); if(!it) return;
  const okd = await showConfirmAsync('Disconnect '+(it.name||it.provider)+'?\n\n'+
    'AMV will revoke this with '+(it.name||it.provider)+' and forget it. Any job using it stops working until you connect it again.');
  if(!okd) return;
  try{
    const r = await AMV_API.connectRemove(id);
    toast((r && r.message) || 'Disconnected.', (r && r.revoked) ? 'success' : 'info', (r && r.revoked) ? 4000 : 9000);
  }catch(e){
    toast(String((e&&e.message)||'That could not be disconnected.'),'error',7000);
  }
  connReload();
}
try{ window.connRemove=connRemove; }catch(e){}

function _connSectionHTML(){
  try{ setTimeout(()=>_connLoad(false), 0); }catch(e){}
  return '<section class="conn-sec" id="conn-sec">'+
    '<div class="sec-head"><h3>'+escH(T('Connected accounts'))+'</h3>'+
      '<span class="sec-sub">'+escH(T('Accounts AMV holds a key to, so Crew jobs keep running with this tab closed. Every one shows what it may do and which job used it last.'))+'</span></div>'+
    '<div id="conn-body" class="conn-body">'+_connBodyHTML()+'</div>'+
  '</section>';
}

function _connBodyHTML(){
  const st=_connState;
  if(st.state==='off')
    return '<div class="conn-note">'+escH(T('This copy of AMV is not connected to a backend, so there is nowhere safe to keep an account token. Connected accounts are off rather than pretending to work.'))+'</div>';
  if(st.state==='idle'||st.state==='loading')
    return '<div class="conn-note" aria-busy="true">'+escH(T('Checking what is connected...'))+'</div>';
  if(st.state==='error')
    return '<div class="conn-note">'+escH(T('Your connected accounts could not be loaded'))+(st.err?' ('+escH(st.err)+')':'')+
      '. '+escH(T('They have not been disconnected.'))+' <button class="mc-sec-link" data-dact="connReload">'+escH(T('Try again'))+'</button></div>';

  const d=st.data||{};
  if(!d.configured)
    return '<div class="conn-note"><b>'+escH(T('Not switched on yet.'))+'</b> '+
      escH(T('AMV will not hold an account token until the server has an encryption key for it, because storing one unencrypted is not a trade worth making. Nothing here works until that is set.'))+'</div>';

  const items=(d.items||[]).map(it => {
    const words=_connScopeWords(it.scopes);
    return '<div class="conn-row'+(it.broken?' broken':'')+'">'+
      '<div class="conn-main">'+
        '<div class="conn-name">'+escH(it.name||it.provider)+
          (it.unattended
            ? '<span class="conn-tag bg">'+escH(T('works with AMV closed'))+'</span>'
            : '<span class="conn-tag open">'+escH(T('only while AMV is open'))+'</span>')+
        '</div>'+
        '<div class="conn-can">'+escH(T('Can'))+' '+escH(words.join(', '))+'</div>'+
        '<div class="conn-used">'+escH(T('Connected'))+' '+escH(_connAgo(it.at))+
          ' · '+escH(T('last used'))+' '+escH(_connAgo(it.lastUsed))+
          (it.lastJob?' '+escH(T('by'))+' '+escH(it.lastJob):'')+'</div>'+
        (it.broken
          ? '<div class="conn-broken">'+escH(T('This stopped working - it was probably revoked at the provider. Reconnect it, or the jobs using it will keep doing nothing.'))+'</div>'
          : '')+
        (it.revokeNote?'<div class="conn-note-sm">'+escH(it.revokeNote)+'</div>':'')+
      '</div>'+
      '<button class="btn conn-x" data-dact="connRemove" data-darg="'+escH(it.id)+'">'+escH(T('Disconnect'))+'</button>'+
    '</div>';
  }).join('');

  const add=(d.providers||[]).map(p =>
    '<button class="conn-add'+(p.ready?'':' dark')+'" data-dact="connAdd" data-darg="'+escH(p.id)+'"'+
      (p.ready?'':' aria-disabled="true"')+'>'+
      '<span class="conn-add-n">'+escH(p.name)+'</span>'+
      '<span class="conn-add-s">'+escH(p.ready?T('Connect'):T('Not set up on this deployment'))+'</span>'+
    '</button>').join('');

  return (items || '<div class="conn-note">'+escH(T('Nothing is connected. Jobs that need an account say so on the Crew screen, and send you here.'))+'</div>')+
    '<div class="conn-add-row">'+add+'</div>';
}

function renderIntegrationsView(){
  const vc=$('vc'); if(!vc) return;
  vc.innerHTML=
    '<div class="sv fi"><div class="vi">'+
      /* ONE NAME FOR ONE THING. This screen said "Integrations" while the
         Settings pane showing the same catalogue said "Connectors", so the
         product had two words for the thing somebody is looking for - which
         is how you fail to find it. Connectors, in both places.

         The copy also predated Connected accounts. "Click Connect, you
         approve in a popup, no keys to paste" was true of the old per-service
         buttons; what matters now, and what somebody deciding whether to hand
         over a mailbox actually wants to know, is that the grant is scoped,
         held by the server rather than this browser, and revocable. */
      '<h2>Connectors</h2>'+
      '<p class="vsub">Connect an account once and AMV can work inside it. A connection is a real sign-in at the provider - AMV never sees your password, only a grant limited to what you allow, and you can take it back at any time. <b style="color:var(--tx)">Autonomous</b> ones keep working when AMV is closed; <b style="color:var(--tx)">manual</b> ones you trigger or upload to.</p>'+
      _connSectionHTML()+
      '<div id="int-catalog">'+_integrationsCatalogHTML()+'</div>'+
    '</div></div>';
  _wireIntegrationCatalog(vc);
  try{ _killTokenAutofill&&_killTokenAutofill(); }catch(e){}
}
window.renderIntegrationsView=renderIntegrationsView;
/* 6. EXTENSIONS VIEW - real file editors */
/* NO ROWS MEANS NO ROWS, and an empty file used to mean one empty cell.

   `''.trim().split('\n')` is `['']`, so this returned [['']] for an empty file -
   one row, one blank column. Every caller then tested `!data.length`, which was
   false, so the "that file has no readable rows" message could never be shown
   and an empty CSV opened an empty grid with no explanation. A guard that
   cannot pass is a guard that is not there.

   Returning [] for nothing is the honest answer, and it makes every one of
   those existing checks start working rather than needing a new one at each
   call site. */
function parseCSV(text){
  const t=String(text||'').trim();
  if(!t) return [];
  return t.split('\n').map(l=>{
    const cols=[]; let cur='',inQ=false;
    for(let i=0;i<l.length;i++){if(l[i]==='"')inQ=!inQ;else if(l[i]===','&&!inQ){cols.push(cur.trim());cur='';}else cur+=l[i];}
    cols.push(cur.trim()); return cols;
  /* And a file that is only blank lines or commas has no content either. */
  }).filter(row => row.some(c => c !== ''));
}
function csvToTable(data){
  if(!data||!data.length) return '';
  const h=data[0], rows=data.slice(1);
  return `<table id="sheet-tbl" style="width:100%;border-collapse:collapse;font-size:var(--t-sm)"><thead><tr>${h.map(hd=>`<th contenteditable="true" style="background:rgba(85,144,255,.12);border:1px solid rgba(255,255,255,.1);padding:8px 10px;text-align:left;font-weight:600;white-space:nowrap;position:sticky;top:0">${escH(hd)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${h.map((_,ci)=>`<td contenteditable="true" style="border:1px solid rgba(255,255,255,.06);padding:6px 10px;color:var(--tx)">${escH(row[ci]||'')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function tableToCSV(){
  const t=document.getElementById('sheet-tbl'); if(!t) return '';
  return Array.from(t.querySelectorAll('tr')).map(tr=>Array.from(tr.querySelectorAll('th,td')).map(c=>'"'+c.textContent.replace(/"/g,'""')+'"').join(',')).join('\n');
}
/* The two download buttons used to carry their whole body in an onclick
   attribute. Named functions instead: the attribute form is the last thing
   holding 'unsafe-inline' in the script CSP, and a download that silently
   produced nothing had nowhere to say so. */
function _sheetDownloadCSV(){
  const csv=tableToCSV();
  if(!csv){ toast('There is nothing in this sheet to download yet.','error'); return; }
  _saveBlob(new Blob([csv],{type:'text/csv'}), 'amv_'+Date.now()+'.csv');
  toast('Downloaded','success');
}
function _saveBlob(blob,name){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=name; a.click();
  /* The object URL used to be left behind, one per download, for the life of
     the tab. Revoked on the next tick because Chrome needs the click to have
     been dispatched first. */
  setTimeout(()=>{ try{ URL.revokeObjectURL(url); }catch(e){} },0);
}
function _bgAddGmailCheck(){ _bgAddTask({type:'gmail_check',title:'Check Gmail inbox'}); }
function _bgAddCalendarCheck(){ _bgAddTask({type:'calendar_check',title:'Optimize my week'}); }
function _toastResultCopied(){ toast('Result copied','success'); }
try{
  window._sheetDownloadCSV=_sheetDownloadCSV;
  window._bgAddGmailCheck=_bgAddGmailCheck; window._bgAddCalendarCheck=_bgAddCalendarCheck;
  window._toastResultCopied=_toastResultCopied;
}catch(e){}

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
  <span style="font-size:var(--t-base);font-weight:600">&#128200; ${escH(name||'Spreadsheet')}</span>
  <span style="font-size:var(--t-xs);color:var(--mu)">${data.length-1} rows &middot; ${data[0]&&data[0].length||0} cols</span>
  <div style="margin-left:auto;display:flex;gap:6px">
    <button class="ext-btn" data-dact="_sheetDownloadCSV">&#8681; Download</button>
    <button class="ext-btn" data-stab="extensions">&#10005; Close</button>
  </div>
</div>
<div style="flex:1;overflow:auto;padding:12px">${csvToTable(data)}</div>
<div style="background:rgba(13,17,23,.97);border-top:1px solid rgba(255,255,255,.1);padding:12px 14px;flex-shrink:0">
  <div style="font-size:var(--t-2xs);color:#7cb8ff;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:7px">AMV AI Toolbar</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
    ${['Analyze trends','Find duplicates','Add totals row','Sort by first column','Summarize data'].map(q=>`<button class="ext-btn" data-dact="runSheetAI" data-darg="${q}">${q}</button>`).join('')}
  </div>
  <div style="display:flex;gap:8px">
    <input type="text" id="sheet-inp" placeholder="Ask AMV anything about this spreadsheet..." style="flex:1;font-size:var(--t-base)">
    <button class="btn bp" id="sheet-ask" style="font-size:var(--t-base);padding:8px 18px">Ask</button>
  </div>
  <div id="sheet-res" style="display:none;margin-top:10px;font-size:var(--t-sm);color:var(--mu);background:var(--s2);border-radius:var(--r-md);padding:12px;max-height:180px;overflow-y:auto;white-space:pre-wrap;line-height:1.65"></div>
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
    /* THE TWO BACKGROUND CHECKS ASK THE SERVER TOO.

       Both held a Google token in this page and called Google from here. They
       are the last two, and leaving them behind would have been the worst
       version of this change: five paths moved to a system where the credential
       never reaches the browser, and two kept reaching for one - so the older
       grant could not be retired and the reason for the whole migration would
       still be sitting in the bundle. */
    if(task.type==='gmail_check'){
      task.progress=30;
      let mail;
      try{ mail=await _connActRun('gmail.unread'); }
      catch(e){ task.status='failed'; task.error=String((e&&e.message)||'Mail could not be read'); _bgQueue.running=false; return; }
      const msgs=Array.isArray(mail)?mail:[];
      task.progress=60;
      if(!msgs.length){task.status='done';task.result='Inbox clear - no unread emails.';}
      else{
        const summary=msgs.map(m=>'From: '+(m.from||'?')+'\nSubject: '+(m.subject||'(no subject)')).join('\n\n');
        task.result=await aiComplete('Analyze '+msgs.length+' unread emails. What needs urgent attention?\n\n'+summary, null, {model:'amv-pulse', max_tokens:600, noLang:true})||summary;
        task.status='done';task.progress=100;
      }
    } else if(task.type==='calendar_check'){
      let ev;
      try{ ev=await _connActRun('calendar.list'); }
      catch(e){ task.status='failed'; task.error=String((e&&e.message)||'The calendar could not be read'); _bgQueue.running=false; return; }
      const events=(Array.isArray(ev)?ev:[]).map(e=>(e.start||e.when||'')+': '+(e.title||'')).join('\n');
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
  const cards=['<button type="button" class="bgq-card" data-dact="_bgAddGmailCheck"><span class="bgq-ic" aria-hidden="true">📧</span><span class="bgq-t">Check Gmail</span><span class="bgq-s">Analyze unread emails</span></button>',
  '<button type="button" class="bgq-card" data-dact="_bgAddCalendarCheck"><span class="bgq-ic" aria-hidden="true">📅</span><span class="bgq-t">Plan my week</span><span class="bgq-s">Calendar optimization</span></button>',
  '<button type="button" class="bgq-card" data-dact="showCustomTask"><span class="bgq-ic" aria-hidden="true">⚡</span><span class="bgq-t">Custom Task</span><span class="bgq-s">Any AI task in background</span></button>'].join('');
  const taskList=_bgQueue.tasks.length ? _bgQueue.tasks.slice().reverse().map(function(t){
    let h='<div style="background:rgba(22,27,34,.7);border:1px solid rgba(255,255,255,.08);border-radius:var(--r-lg);padding:14px;margin-bottom:8px">';
    h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">';
    h+='<span style="color:'+sc(t.status)+';font-size:var(--t-lg)">'+si(t.status)+'</span>';
    h+='<span style="font-size:var(--t-base);font-weight:600;flex:1">'+escH(t.title)+'</span>';
    h+='<span style="font-size:var(--t-2xs);color:'+sc(t.status)+';background:'+sc(t.status)+'22;border-radius:var(--r-md);padding:2px 10px;font-weight:600">'+t.status+'</span>';
    h+='</div>';
    if(t.status==='running') h+='<div style="height:4px;background:rgba(255,255,255,.1);border-radius:var(--r-2xs);margin-bottom:8px"><div style="height:100%;width:'+(t.progress||30)+'%;background:var(--blue);border-radius:var(--r-2xs);transition:width .5s"></div></div>';
    if(t.error) h+='<div style="font-size:var(--t-sm);color:var(--red-txt);padding:8px;background:rgba(248,81,73,.08);border-radius:var(--r-sm);margin-top:4px">'+escH(t.error)+'</div>';
    if(t.result){
      h+='<div style="font-size:var(--t-sm);color:var(--mu);background:rgba(0,0,0,.25);border-radius:var(--r-sm);padding:10px;margin-top:8px;max-height:180px;overflow-y:auto;white-space:pre-wrap;line-height:1.65">'+escH(t.result.slice(0,500))+(t.result.length>500?' ...(truncated)':'')+'</div>';
      h+='<div style="display:flex;gap:6px;margin-top:8px"><button class="ext-btn" data-dact="_toastResultCopied">Copy result</button></div>';
    }
    h+='<div style="font-size:var(--t-2xs);color:var(--dim);margin-top:6px">'+new Date(t.created).toLocaleString()+'</div>';
    h+='</div>';
    return h;
  }).join('') : emptyState({svg:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',title:'No automations yet',sub:'Set AMV to run on a schedule - a daily news brief, a weekly report - and it works while you don\u2019t. Pick a quick automation above to start.'});
  vc.innerHTML=`<div class="sv fi"><div class="vi"><h2>Automation</h2><p class="vsub">Hand the AI a repeating job and it runs on its own in the background - checking email, summarizing, monitoring - even after you close the tab. Tap a card to queue a task; results land here when each one finishes.</p>
<div class="ss2" style="background:linear-gradient(135deg,rgba(85,144,255,.08),rgba(85,144,255,.05));border-color:rgba(88,166,255,.2)">
<h3>&#9889; Quick Automations</h3>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">${cards}</div>
</div>
<div class="ss2">
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><h3 style="margin:0">Task Queue</h3><button class="ext-btn" data-dact="renderAutomationView">Refresh</button></div>
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
      +'<button class="btn bs" data-asrv-retry="1" style="font-size:var(--t-sm)">Try again</button></div></section>';
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
    /* And what it WILL need, resolved by the server for every job on this
       list. Without this, the only place a missing permission is said is
       against a run that already stopped - so somebody schedules a job at noon
       and finds out at 7pm that AMV could not finish it. */
    const willNeed = (typeof _mcWillNeed === 'function') ? _mcWillNeed(it) : '';
    const runs = +it.runs||0;
    return '<div class="asrv-job">'
      +'<div class="asrv-top">'
      +'<span class="asrv-name">'+escH(it.detail||'Scheduled job')+'</span>'
      +'<span class="asrv-tag">'+escH(tag)+'</span>'
      +'<span class="asrv-tag '+(it.active?'on':'off')+'">'+(it.active?'Active':'Paused')+'</span>'
      +'</div>'
      +'<div class="asrv-meta">'+escH(_autoWhenLabel(it))+' · run '+runs+' time'+(runs===1?'':'s')+'</div>'
      + err
      + willNeed
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
  div.innerHTML='<div style="background:var(--s1);border:1px solid var(--hair);border-radius:var(--r-3xl);padding:28px;width:100%;max-width:460px;box-shadow:0 24px 60px rgba(0,0,0,.4);position:relative">'
    +'<div style="font-size:var(--t-xl);font-weight:700;color:var(--tx);margin-bottom:4px">Custom Background Task</div>'
    +'<div style="font-size:var(--t-sm);color:var(--mu);margin-bottom:20px">Runs automatically - navigate away and it will complete</div>'
    +'<div style="display:flex;flex-direction:column;gap:14px">'
    +'<div><label style="font-size:var(--t-xs);font-weight:600;color:var(--mu);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Task Name</label><input type="text" id="ct-name" placeholder="e.g. Research competitors" style="width:100%;padding:10px 12px;background:var(--s2);border:1px solid var(--hair);border-radius:var(--r-md);color:var(--tx);font-size:var(--t-base);outline:none;box-sizing:border-box"></div>'
    +'<div><label style="font-size:var(--t-xs);font-weight:600;color:var(--mu);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Instructions</label><textarea id="ct-prompt" rows="4" placeholder="What do you want AMV to do?" style="width:100%;padding:10px 12px;background:var(--s2);border:1px solid var(--hair);border-radius:var(--r-md);color:var(--tx);font-size:var(--t-base);outline:none;resize:vertical;box-sizing:border-box;font-family:inherit"></textarea></div>'
    +'<button id="ct-go" style="width:100%;padding:13px;background:var(--accent);border:none;border-radius:var(--r-lg);color:var(--on-accent);font-size:var(--t-md);font-weight:700;cursor:pointer;font-family:inherit">&#9889; Run in Background</button>'
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
/* Telegram sits here rather than beside its own UI because it is the same
   fact of the same shape: a credential the SERVER holds, so the only honest
   answer to "is this connected" comes from the server. */
let _TG_STATUS = null;

async function refreshTelegramStatus(){
  try{ _TG_STATUS = await AMV_API.telegramStatus(); }catch(e){ _TG_STATUS = null; }
  return _TG_STATUS;
}
function _telegramConnectedBot(){
  return (_TG_STATUS && _TG_STATUS.connected && _TG_STATUS.bot) ? String(_TG_STATUS.bot) : '';
}

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
  onBackdrop($('ml-bg'),()=>{ r.innerHTML=''; });
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
  if(!await showConfirmAsync('Disconnect this mailbox?\n\nAMV stops reading it and forgets the password. Any job that needs it will say so instead of running.')) return;
  try{ await AMV_API.mailDisconnect(); }catch(e){}
  await refreshMailStatus();
  toast('Mailbox disconnected','success');
  try{ _refreshIntegrationsUI(); }catch(e){}
}

/* The inbox, and the thing a person actually wants: a summary of it. */
async function openMailInbox(){
  const r=$('ovr'); if(!r) return;
  r.innerHTML=_ovShell({ id:'mi', eyebrow:'Mail', title:'Your inbox',
                         body:'<p class="mu">Reading your mailbox\u2026</p>' });
  _ovWire('mi');

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
window.refreshTelegramStatus = refreshTelegramStatus;

/* ═══════════════════════════════════════════════════════════════════════
   WHAT AMV CAN DO WHERE.

   Deliberately NOT a geographic map. A real world map is a hundred kilobytes
   of path data in a single-file app that has a hard page-weight ceiling, and
   it would be the heaviest thing a visitor downloads - on a phone in Lagos or
   Jakarta, which is exactly who this is for. Making the product slower for
   the people it is meant to reach is not a trade worth making for a picture.

   A board reads better anyway: continents, then countries, then what actually
   works there. Every number comes from the server, which computes it from the
   same registries the features use, so this page cannot promise a country
   something the product does not do.
   ═══════════════════════════════════════════════════════════════════════ */
async function openCoverage(){
  const r=$('ovr'); if(!r) return;
  r.innerHTML=_ovShell({ id:'cv', wide:true, eyebrow:'AMV worldwide',
                         title:'What AMV does in your country',
                         body:'<p class="mu">Loading\u2026</p>' });
  _ovWire('cv');

  let d=null; try{ d=await AMV_API.coverage(); }catch(e){ d=null; }
  const b=$('cv-body'); if(!b) return;
  if(!d||!d.byContinent){ b.innerHTML='<div class="ml-err">Could not load this. Try again in a moment.</div>'; return; }

  const order=['Europe','Asia','North America','South America','Africa','Oceania','Other'];

  const card=(c)=>'<div class="cv-card">'+
    '<div class="cv-n">'+escH(c.name)+'</div>'+
    '<div class="cv-l"><span class="cv-k">Mail</span>'+
      '<span>'+escH(String(c.mail.national+c.mail.global))+' providers'+
      (c.mail.names.length?' · '+escH(c.mail.names.slice(0,2).join(', ')):'')+'</span></div>'+
    '<div class="cv-l"><span class="cv-k">Daily</span>'+
      '<span>'+escH(String(c.everyday||0))+' everyday jobs</span></div>'+
    '<div class="cv-l"><span class="cv-k">Jobs</span>'+
      '<span>'+escH(String((c.jobs.boards||0)+(c.jobs.global||0)))+' board'+((c.jobs.boards+(c.jobs.global||0))===1?'':'s')+
      (c.jobs.names.length?' · '+escH(c.jobs.names.slice(0,2).join(', ')):'')+'</span></div>'+
    (c.jobs.autoApply
      ? '<div class="cv-auto">AMV can apply for you here</div>'
      : '<div class="cv-prep">AMV prepares applications here</div>')+
  '</div>';

  /* Forty-five countries across six continents is a long scroll to reach the
     one you live in, which is the only reason anybody opens this. Filtered in
     the page, over data already loaded, so it costs nothing per keystroke. */
  const paint=(q)=>{
    const s=String(q||'').trim().toLowerCase();
    const hit=(c)=>!s || String(c.name).toLowerCase().includes(s) || String(c.code).toLowerCase()===s;
    const html=order.filter(k=>d.byContinent[k]&&d.byContinent[k].some(hit))
      .map(k=>'<div class="cv-c"><div class="cv-c-h">'+escH(k)+'</div><div class="cv-grid">'+
        d.byContinent[k].filter(hit).map(card).join('')+'</div></div>').join('');
    const g=$('cv-list'); if(!g) return;
    /* An empty result says so. Showing nothing reads as the page having
       broken, and the honest answer is that AMV does not reach there yet. */
    g.innerHTML = html || '<p class="mu">No country matches that. AMV reaches '+
      escH(String(d.totals.countries))+' countries so far.</p>';
  };

  b.innerHTML=
    '<p class="mu ml-intro">'+escH(String(d.totals.countries))+' countries across '+escH(String(d.totals.continents))+
      ' continents. Mail works in every one of them, because '+escH(String(d.totals.mailGlobal))+
      ' of the '+escH(String(d.totals.mailProviders))+' providers are the ones used worldwide - the rest are the '+
      'national ones people actually have. '+escH(String(d.totals.jobBoards))+' job boards.</p>'+
    '<label class="ml-f cv-find"><span>Find your country</span>'+
      '<input id="cv-q" type="search" autocomplete="off" placeholder="e.g. Nigeria, Brazil, ID"></label>'+
    '<div id="cv-list"></div>';
  paint('');
  on($('cv-q'),'input',(e)=>paint(e.target.value));
}
window.openCoverage = openCoverage;

/* Telegram: the person's own bot, so the messages come from something they
   control and can revoke, and AMV is not a middleman holding one bot every
   customer shares. */
async function openTelegramConnect(){
  const r=$('ovr'); if(!r) return;
  r.innerHTML=_ovShell({ id:'tg', eyebrow:'Telegram', title:'Connect your bot', body:
    '<p class="mu ml-intro">AMV sends through a bot you own, so you can revoke it any time and the messages are not from a stranger.</p>'+
    '<p class="ml-setup">Open Telegram, message <b>@BotFather</b>, send <b>/newbot</b>, and it gives you a token. '+
      'Then send your new bot any message, open <b>api.telegram.org/bot&lt;your token&gt;/getUpdates</b> in a browser, and copy the <b>chat id</b> it shows.</p>'+
    '<label class="ml-f"><span>Bot token</span><input id="tg-tok" type="password" autocomplete="off" placeholder="123456789:AA\u2026"></label>'+
    '<label class="ml-f"><span>Chat id</span><input id="tg-chat" autocomplete="off" placeholder="e.g. 87654321"></label>'+
    '<div class="ml-err" id="tg-err" style="display:none" role="alert"></div>'+
    '<div class="ml-foot"><button class="btn" id="tg-cancel">Cancel</button>'+
      '<button class="btn bp" id="tg-go">Connect</button></div>' });
  _ovWire('tg');
  on($('tg-cancel'),'click',()=>{ r.innerHTML=''; });
  on($('tg-go'),'click',async()=>{
    const btn=$('tg-go'), err=$('tg-err');
    err.style.display='none'; btn.disabled=true; btn.textContent='Connecting\u2026';
    try{
      await AMV_API.telegramConnect({ token:($('tg-tok')||{}).value||'', chatId:($('tg-chat')||{}).value||'' });
      const t=$('tg-tok'); if(t) t.value='';
      r.innerHTML=''; toast('Telegram connected','success');
      try{ _refreshIntegrationsUI(); }catch(e){}
    }catch(e){
      err.textContent=String((e&&e.message)||'Could not connect.'); err.style.display='';
      btn.disabled=false; btn.textContent='Connect';
    }
  });
}
window.openTelegramConnect = openTelegramConnect;
async function disconnectTelegram(){
  if(!await showConfirmAsync('Disconnect Telegram?\n\nAMV forgets the bot token. Messages will stop arriving until you connect it again.')) return;
  try{ await AMV_API.telegramDisconnect(); }catch(e){}
  toast('Telegram disconnected','success');
  try{ _refreshIntegrationsUI(); }catch(e){}
}
window.disconnectTelegram = disconnectTelegram;

/* ═══════════════════════════════════════════════════════════════════════
   EVERYDAY LIFE, WHERE YOU LIVE.

   The Crew catalogue was built around work: inboxes, competitors, weekly
   reports. That is a good product for somebody with a desk job in an
   English-speaking country and it is not most people's week. Most people's
   week is a bill with a date on it, a renewal that lapses quietly, a fine
   with a discount window, a document somebody official is waiting for.

   Choosing a country does not create a separate feature. It folds that
   country's jobs into the SAME Crew list as the built-in ones, with the same
   toggles, the same access checks and the same scheduling - so there is one
   way to run a job in AMV rather than two that drift apart.
   ═══════════════════════════════════════════════════════════════════════ */

/* A guess, said as a guess. The browser's region is right often enough to
   save a scroll and wrong often enough that it must never be silent. */
function _everydayGuess(){
  try{
    const l = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    const m = /[-_]([A-Za-z]{2})$/.exec(String(l));
    return m ? m[1].toUpperCase() : '';
  }catch(e){ return ''; }
}

async function openEveryday(){
  const r=$('ovr'); if(!r) return;
  r.innerHTML=_ovShell({ id:'ed', wide:true, eyebrow:'Everyday life',
                         title:'What you already do, every week',
                         body:'<p class="mu">Loading\u2026</p>' });
  _ovWire('ed');

  const saved = loadStr('amv_everyday_country') || '';
  let code = saved || _everydayGuess();
  let d=null; try{ d=await AMV_API.everyday(code); }catch(e){ d=null; }
  const b=$('ed-body'); if(!b) return;
  if(!d||!Array.isArray(d.universal)){
    b.innerHTML='<div class="ml-err">Could not load these. Try again in a moment.</div>'; return;
  }

  const paint=(data)=>{
    const body=$('ed-body'); if(!body) return;
    const opts=(data.countries||[]).map(c=>
      '<option value="'+escH(c.code)+'"'+(c.code===data.country?' selected':'')+'>'+
        escH(c.name)+'</option>').join('');
    const row=(j,local)=>'<div class="ed-row">'+
      '<div class="ed-i">'+escH(j.icon||'')+'</div>'+
      '<div class="ed-t"><div class="ed-n">'+escH(j.title||'')+
        (local?'<span class="ed-tag">'+escH(data.name||data.country)+'</span>':'')+'</div>'+
        '<div class="ed-d">'+escH(j.desc||'')+'</div>'+
        '<div class="ed-need">Needs '+escH(j.needs||'')+'</div></div></div>';
    const chosen = !!(data.country && data.local && data.local.length);
    body.innerHTML=
      '<p class="mu ml-intro">These are things you already do. AMV does not do them for you - it watches for '+
        'them, works out the date, and tells you in time. Nothing is paid, filed or renewed on your behalf.</p>'+
      '<label class="ml-f cv-find"><span>Where do you live?</span>'+
        '<select id="ed-c"><option value="">Choose a country</option>'+opts+'</select></label>'+
      (chosen
        ? '<div class="cv-c-h">'+escH(data.name||data.country)+' \u00b7 '+data.local.length+'</div>'+
          data.local.map(j=>row(j,true)).join('')
        : '<p class="mu">Choose a country and the ones specific to it appear here.</p>')+
      '<div class="cv-c-h">Everywhere \u00b7 '+data.universal.length+'</div>'+
      data.universal.map(j=>row(j,false)).join('')+
      '<div class="ml-foot"><button class="btn bp" id="ed-add"'+(chosen?'':' disabled')+'>'+
        'Add '+((chosen?data.local.length:0)+data.universal.length)+' to my Crew</button></div>';

    on($('ed-c'),'change',async(e)=>{
      const c=e.target.value;
      const sel=$('ed-c'); if(sel) sel.disabled=true;
      try{ const nd=await AMV_API.everyday(c); paint(nd); }
      catch(err){ if(sel) sel.disabled=false; toast('Could not load those','error'); }
    });
    on($('ed-add'),'click',()=>{
      /* Cached where the DEFINITIONS are read from, not appended to the saved
         list - the server sync rebuilds that list from the definitions every
         run, so anything only in the list is deleted the next time it runs. */
      const defs=(data.local||[]).concat(data.universal).map(j=>Object.assign({}, j, {
        cat:'Everyday life', on:false,
      }));
      _everydayCache(defs);
      if(data.country) saveStr('amv_everyday_country', data.country);
      /* Rebuild from definitions so the new ones appear, keeping every switch
         somebody had already set. */
      try{
        const byId={}; (_cwJobs()||[]).forEach(j=>{ byId[j.id]=j; });
        _cwSaveJobs(_cwDefaultJobs().map(def=>Object.assign({}, def, {
          on: byId[def.id] ? !!byId[def.id].on : !!def.on,
          autoId: byId[def.id] ? (byId[def.id].autoId||null) : null,
        })));
      }catch(e){}
      r.innerHTML='';
      toast(defs.length+' added to your Crew, all switched off until you turn them on','success');
      try{ if(typeof renderCrewView==='function') renderCrewView(); }catch(e){}
    });
  };
  paint(d);
}
window.openEveryday = openEveryday;

