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
/* Was this permission granted, on a connection that works? Asked for a person
   who is here - the runner and chat. _cwConnHas answers the Crew question,
   which also needs the grant to work with AMV closed; asked here, it told the
   chat model that Gmail was not connected to somebody using it right now,
   whose grant simply ends when the tab does. */
function _connHasScope(scope){
  try{
    const items=((_connState&&_connState.data)||{}).items||[];
    return items.some(x=>x && !x.broken && Array.isArray(x.scopes) && x.scopes.indexOf(scope)>=0);
  }catch(e){ return false; }
}
try{ window._connHasScope=_connHasScope; }catch(e){}

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
  const r = d ? d.result : null;
  /* A write the server could not read back is not a write AMV can call done. */
  if(r && typeof r === 'object' && r.verified === null)
    r.note = 'AMV could not check this afterwards. Say it was requested, not that it is done, and suggest looking in the account.';
  /* The receipt: the person gets the way back, the model gets the truth about
     it. The ticket itself never goes to the model - taking something back is
     the person's click, not a tool call. */
  const rc = d && d.receipt;
  if(r && typeof r === 'object' && rc){
    r.undo = rc.undo ? 'The person can undo this from the notice on their screen (' + rc.undo.label + ').'
                     : 'This cannot be undone from AMV. ' + (rc.irreversible || '');
    if(rc.undo) _actOfferUndo(action, rc.undo);
  }
  return r;
}
try{ window._connActRun=_connActRun; }catch(e){}

/* What was just done, said back with the one way to take it back. Long enough
   to read on a phone; the server's ticket outlives it, the notice does not
   need to. */
const _ACT_DONE = {
  'calendar.create': () => T('Event added to your calendar'),
  'drive.copy': () => T('Copy made in your Drive'),
  'drive.share': () => T('File shared'),
  'sheets.write': () => T('Sheet updated'),
  'github.push': () => T('Branch pushed'),
  'github.issue.create': () => T('Issue opened'),
  'github.pr': () => T('Pull request opened'),
  'slack.post': () => T('Message posted to Slack'),
};
function _actOfferUndo(action, undo){
  try{
    toastAction(_ACT_DONE[action] ? _ACT_DONE[action]() : T('Done'), T('Undo'), async () => {
      try{
        const d = await AMV_API.connectUndo(undo.token);
        toast(d && d.verified ? T('Undone') : T('Asked to undo it, but AMV could not check. Look in the account.'), d && d.verified ? 'success' : 'info', 6000);
      }catch(e){ toast(e.message || T('That could not be undone.'), 'error', 8000); }
    }, 30000);
  }catch(e){}
}

/* ONE GOOGLE FILE, CHOSEN BY THE PERSON IN GOOGLE'S OWN PICKER.

   AMV edits Docs and Sheets on drive.file, which reaches the files it made and
   the ones somebody chose for it here - nothing else in their Drive. The
   picker runs in a window of its own (picker.html), so this page never loads
   Google's code; the window posts back the one file's id and name, and this
   accepts that message from that window, at this origin, and nothing else.

   Asked first, in a dialog, because a browser opens a window only from a
   click - and because choosing a file for AMV is a decision, not a step. */
async function _gPickFile(){
  if(!(window.AMV_API && AMV_API.live)) throw new Error('AMV is not connected to its engine, so it cannot open Google\u2019s file picker.');
  let cfg = null;
  try{ const r = await AMV_API._fetch('/v1/google/picker', { method:'GET' }); cfg = await r.json(); }catch(e){}
  if(!cfg || !cfg.ok) throw new Error('Could not reach AMV to open Google\u2019s file picker. Nothing was opened.');
  if(!cfg.configured) throw new Error('Choosing a Google file is not switched on for this AMV yet. AMV can still read and edit the Google files it made itself.');
  const go = await _showModalAsync({
    title: T('Choose a Google file for AMV?'),
    body: T('Google opens its own window. Pick the one Doc or Sheet AMV should read and edit - it gets that file, and nothing else in your Drive.'),
    okText: T('Choose a file'), cancelText: T('Not now'),
  });
  if(go !== true) throw new Error('No file was chosen.');
  const frag = btoa(encodeURIComponent(JSON.stringify({ clientId: cfg.clientId, apiKey: cfg.apiKey, appId: cfg.appId,
                                                       hint: (S.user && S.user.email) || '' })));
  const w = window.open('/picker.html#' + frag, 'amv-picker', 'popup,width=780,height=640');
  if(!w) throw new Error('Your browser blocked Google\u2019s file picker window. Allow pop-ups for AMV and try again.');
  return await new Promise((resolve, reject) => {
    let over = false, timer = null;
    const end = (f) => { if(over) return; over = true; window.removeEventListener('message', onMsg); clearInterval(timer); f(); };
    function onMsg(e){
      if(e.origin !== location.origin || e.source !== w || !e.data || e.data.amvPicker !== true) return;
      const d = e.data;
      if(/^[A-Za-z0-9_-]{10,}$/.test(String(d.fileId || ''))){
        const type = /spreadsheet/.test(String(d.mimeType)) ? 'sheet' : /document/.test(String(d.mimeType)) ? 'doc' : 'file';
        end(() => resolve({ fileId: d.fileId, name: String(d.name || '').slice(0, 200), type }));
      }
      else if(d.error) end(() => reject(new Error('Google\u2019s file picker could not load. Nothing was chosen.')));
      else end(() => reject(new Error('No file was chosen.')));
    }
    window.addEventListener('message', onMsg);
    timer = setInterval(() => { if(w.closed) end(() => reject(new Error('No file was chosen.'))); }, 500);
  });
}
try{ window._gPickFile=_gPickFile; }catch(e){}

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
  /* GOOGLE DOCS AND SHEETS, WHERE THEY ARE - on files the person chose (or
     AMV made). Changes are asked first, and what comes back is what the file
     says after the change, read back. */
  google_file_choose: {
    desc:'Ask the user to choose one Google Doc or Sheet for AMV in Google\u2019s own file picker. Returns {fileId, name, type}. AMV can open only Google files chosen this way or that it made, so do this before reading or editing one.',
    needs:'connect',
    async run(){ return await _gPickFile(); }
  },
  google_doc_read: {
    desc:'Read a Google Doc the user chose. Args: {fileId}. Returns its title, text and link.', needs:'connect',
    async run(args){ return await _connActRun('docs.read', { fileId: args && args.fileId }); }
  },
  google_doc_edit: {
    desc:'Change a Google Doc the user chose, in place. Args: {fileId, replace?: [{find, with, matchCase?}], append?: text to add at the end}. Read it first. Returns how many places changed and whether the change was read back.',
    needs:'connect', risk:'high', riskLabel:'change a Google Doc',
    async run(args){ return await _connActRun('docs.edit', { fileId: args && args.fileId, replace: args && args.replace, append: args && args.append }); }
  },
  google_sheet_read: {
    desc:'Read a Google Sheet the user chose. Args: {fileId, range?: like "Sheet1!A1:D20"}. Returns its tabs and the rows.', needs:'connect',
    async run(args){ return await _connActRun('sheets.read', { fileId: args && args.fileId, range: args && args.range }); }
  },
  google_sheet_write: {
    desc:'Write cells in a Google Sheet the user chose, in place. Args: {fileId, range: like "Sheet1!A2:C4", values: rows of cells}. Formulas like "=SUM(B2:B9)" stay formulas. Returns the cells changed and whether they were read back.',
    needs:'connect', risk:'high', riskLabel:'change a Google Sheet',
    async run(args){ return await _connActRun('sheets.write', { fileId: args && args.fileId, range: args && args.range, values: args && args.values }); }
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
  /* Through the server, like GitHub above. This used to post from the
     browser with a token or webhook read from `amv_slack` - a key no connect
     flow writes - so it could only ever say "Slack not connected". Slack is a
     sign-in on the server now, and the token never comes here.

     No default channel. It used to fall back to #general, which is a message
     to the whole company that nobody named. */
  slack_post: { risk:'high', riskLabel:'post a Slack message',
    desc:'Post a message to a Slack channel. Args: {channel, text}. Name the channel; there is no default.', needs:'slack',
    /* An action on the server like the others: posted, read back from Slack's
       own record of the message, and offered back to the person to delete. */
    async run(args){
      const channel=String((args&&args.channel)||'').trim();
      const text=String((args&&(args.text||args.message))||'');
      if(!channel) throw new Error('Say which Slack channel to post in. Nothing was posted.');
      if(!text.trim()) throw new Error('There was no message to post. Nothing was posted.');
      return await _connActRun('slack.post', { channel, text });
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
    isConnected:()=>_connHasScope('mail.read'),
    keywords:['email','emails','gmail','inbox','e-mail','reply to','send a mail','unread','draft a reply','respond to','mailbox'] },
  { id:'calendar', integration:'Google Calendar', label:'view or create calendar events',
    api:'Google Calendar API', auth:'Google account (OAuth)',
    connectId:'google', tools:['calendar_list','calendar_create'],
    isConnected:()=>_connHasScope('calendar.read'),
    keywords:['calendar','schedule','meeting','event','appointment','book time','block time','remind me to meet','agenda','availability'] },
  { id:'drive', integration:'Google Drive', label:'read or list your files',
    api:'Google Drive API', auth:'Google account (OAuth)',
    connectId:'google', tools:['drive_list'],
    isConnected:()=>_connHasScope('drive.read'),
    keywords:['drive','google drive','my files','documents','spreadsheet in drive','file named'] },
  { id:'github', integration:'GitHub', label:'manage issues and repositories',
    api:'GitHub REST API', auth:'GitHub personal access token or OAuth',
    connectId:'github', tools:['github_list_issues','github_create_issue'],
    /* Asked of the GRANT, like the three Google capabilities above it. The
       tools underneath this entry were moved to the server - the comment on
       github_list_issues says why, and names this exact symptom: "not
       connected" said to somebody whose account WAS connected. The tools were
       moved and this question was not, so the screen that decides whether AMV
       can be asked to touch GitHub went on reading a key retired with them. */
    isConnected:()=>_connHasScope('repo.read'),
    keywords:['github','issue','repo','repository','pull request','pr ','commit','open an issue','bug ticket'] },
  { id:'slack', integration:'Slack', label:'post messages to Slack',
    api:'Slack Web API', auth:'Slack sign-in',
    connectId:'slack', tools:['slack_post'],
    isConnected:()=>_connHasProvider('slack','slack.write'),
    keywords:['slack','post to channel','message the team','#general','dm on slack','notify the channel'] },
];

/* APPS THAT CONNECT, BUT THAT THIS RUNNER DOES NOT DRIVE.

   These were listed below as "not currently available in AMV". Every one of
   them connects today - Microsoft and Discord by sign-in, Notion, Linear and
   Stripe as app connectors, Canvas through the school screen - and chat uses
   them, one consented call at a time. What cannot use them is this runner,
   whose tools are the fixed list above. So the honest answer is where to ask,
   not that AMV cannot. */
const CHAT_CAPABILITIES = [
  { integration:'Microsoft 365 / Outlook',
    keywords:['outlook','microsoft 365','office 365','onedrive','ms teams','microsoft teams','exchange'] },
  { integration:'Notion', keywords:['notion','notion page','notion database','my notion'] },
  { integration:'Linear', keywords:['linear issue','linear ticket','linear project','linear.app'] },
  { integration:'Discord', keywords:['discord','discord server','discord channel'] },
  { integration:'Canvas LMS', keywords:['canvas','assignment due','my course','lms','homework on canvas'] },
  { integration:'Stripe (your account)', keywords:['stripe charge','refund a customer','create an invoice in stripe'] },
];

/* Integrations with no way in at all yet. If a user asks for one of these,
   we name exactly what is missing. */
const PLANNED_CAPABILITIES = [
  { integration:'SMS / Text messaging', api:'Twilio API', auth:'Twilio number + credentials (set up by operator)',
    keywords:['text me','send a text',' sms','text message'] },
  { integration:'X / Twitter', api:'X API', auth:'X developer credentials',
    keywords:['tweet','twitter','post to x','x.com'] },
  { integration:'WhatsApp', api:'WhatsApp Business API', auth:'WhatsApp Business credentials',
    keywords:['whatsapp','whats app'] },
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
  const inChat=[];
  for(const cap of CHAT_CAPABILITIES){
    if(cap.keywords.some(k=>text.includes(k))){
      if(seen.has(cap.integration)) continue; seen.add(cap.integration);
      inChat.push({ integration:cap.integration });
    }
  }
  const missing=requires.filter(r=>!r.connected);
  return {
    matched: requires.length>0 || unsupported.length>0 || inChat.length>0,
    requires, unsupported, missing, inChat,
    ready: requires.length>0 && missing.length===0 && unsupported.length===0 && inChat.length===0
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
  (analysis.inChat||[]).forEach(c=>{
    out+='\uD83D\uDCAC **'+c.integration+'** works in chat rather than here. Connect it in Integrations if you have not, '+
         'then ask in chat - AMV shows each action and asks before it runs.\n\n';
  });
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
    if(a.needs) return !!(window.AMV_API && AMV_API.live) && _connHasProvider(a.needs);
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
  /* No overlay to draw the rich version into. _askDestructive asks in AMV's
     dialog if it can, the browser's if it cannot, and refuses rather than
     approving when neither is available - which matters more here than
     anywhere: this gate stands in front of a real action on somebody's
     connected account. */
  return _askDestructive('Approve this action?',
    'AMV wants to: ' + detail + '\n\nThis takes a real action on your connected account.',
    'Approve & run');
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
    if(ready.length && (analysis.missing.length || analysis.unsupported.length)){
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
   was being read as the first.

   With a scope, it also asks whether that permission was granted - a Slack
   sign-in that may read cannot post. The runner and the capability list used
   to ask loadStr('amv_'+provider) instead, a key nothing has written since the
   server took the handshake over, so GitHub and Slack read as not connected
   to everybody who had connected them. */
function _connHasProvider(id, scope){
  try{
    const items=((_connState&&_connState.data)||{}).items||[];
    return items.some(x=>x && x.provider===id && !x.broken
      && (!scope || (Array.isArray(x.scopes) && x.scopes.indexOf(scope)>=0)));
  }catch(e){ return false; }
}
try{ window._connHasProvider=_connHasProvider; }catch(e){}

function _integrationsCatalogHTML(opts){
  const smsPhone=loadStr('amv_sms_phone');
  const intRow=(o)=>{
    const connected=o.connected;
    /* NO AUTONOMOUS / MANUAL BADGE. Asked for: the name, what it does, and
       Connect - nothing else on the row. Whether a connection works with AMV
       closed is said where it matters, on the connection itself. */
    const badge='';
    /* A connected integration that can DO something needs a way to run it. The
       Canvas automation had a working implementation and no button anywhere -
       its entry point was removed with an old toolbar and the function was left
       behind, reachable by nothing. Connecting it here means the run control
       lives next to the connection it depends on. */
    /* A ROW WHOSE CONNECTING HAPPENS SOMEWHERE ELSE.

       Every other row here either connects in place through the connected-
       accounts framework (`auto`) or is a thing you hand files to (`use`). The
       bank is neither: it is autonomous - the schedule really does read it -
       and its link is a hosted sign-in that already exists, once, in the
       investing pane. `goto` is how a row says "this is real, it is
       autonomous, and the button takes you to where it is done", rather than
       forcing a choice between the wrong badge and a second copy of a money
       flow. It also means a CONNECTED bank offers Manage rather than a
       Disconnect this page could not carry out. */
    const action=o.goto
      ? '<button class="btn '+(connected?'':'bp')+'" data-int-use="'+escH(o.goto)+'" style="font-size:var(--t-sm)">'
          +escH(connected ? (o.manageLabel||'Manage') : (o.useLabel||'Set up'))+'</button>'
      : connected
      ? ((o.run?'<button class="btn bp" data-int-run="'+o.run+'" style="font-size:var(--t-sm)">'+escH(o.runLabel||'Run')+'</button>':'')+
         '<button class="btn int-disc" data-int-disc="'+o.id+'"'+(o.preset?' data-int-preset="'+escH(o.preset)+'"':'')+' style="font-size:var(--t-sm)">Disconnect</button>')
      : (o.auto
          ? '<button class="btn bp" data-int-conn="'+o.id+'"'+(o.preset?' data-int-preset="'+escH(o.preset)+'"':'')+' style="font-size:var(--t-sm)">Connect</button>'
          /* The same button as every other Connect: the difference it used to
             show was the Manual badge's, and the badge is gone. */
          : '<button class="btn bp" data-int-use="'+(o.use||'chat')+'" style="font-size:var(--t-sm)">'+(o.useLabel||'Open in chat')+'</button>');
    return '<div class="int-card">'+
      '<div class="int-ic" style="background:'+(o.bg||'var(--s3)')+'">'+o.icon+'</div>'+
      '<div class="int-body">'+
        '<div class="int-top"><span class="int-name">'+o.name+'</span>'+badge+(connected?'<span class="int-ok">\u2713 Connected</span>':'')+'</div>'+
        '<div class="int-desc">'+o.desc+'</div>'+
      '</div>'+
      '<div class="int-act">'+action+'</div>'+
    '</div>';
  };
  /* EVERY SECTION ENDS WITH A DOOR TO THE REST OF ITS OWN KIND.

     The rows are the apps people actually use (AMV_APP_CATS, 13c). The door
     under them opens that topic's page of the open registry - thousands more,
     each one a program the bridge can start - so the answer to "can AMV
     connect to X" is on the screen for X, and there is no heading anywhere
     called "everything else". `q` is the query the door really sends. */
  /* ONE WAY TO SEE MORE, AND IT IS THE TOPIC'S OWN LIST.

     A topic ended in two controls: "Show all 33", which opened the rest of
     this list, and "See all email connectors", which opened a page of the open
     registry - programs anybody can publish, unvetted, most of which nobody
     uses. The owner: the main six, then a small See all, and not the sketchy
     ones. So the one control is a small link that opens the rest of this list
     in place. The registry is still there for somebody who searches for a
     name, and for a Crew job that needs an app this list does not have. */
  const cat=(title,rows,q,more)=>'<div class="ss2"><h3>'+title+'</h3><div class="int-list">'+rows+'</div>'+
    (more||'')+'</div>';
  /* SAY IT BEFORE THE PRESS, NOT AFTER IT.

     The click gate above is the correctness fix; on its own it still means a
     guest reads twelve rows that look ready, presses one, and only then learns
     an account is needed. The owner's words for what that looked like were
     "why does settings look like this for guest".

     One line at the top, with the sign-up in it, rather than a badge on every
     row: twelve identical badges is noise, and the rows are worth reading -
     what these integrations DO is a fair question to ask before signing up,
     which is why the catalogue stays browsable at all. */
  const guest = !(typeof S!=='undefined' && S && S.user && S.user.email);
  const mailAcc=_mailConnectedAccount();
  const DEF={
    mail:'Read, summarized and answered. Connects with an app password.',
    cal:'Read-only, through the calendar’s shared link. AMV sees your week and can never change it.',
  };
  /* What Connect does for a row that has one, in the options intRow already
     reads. Every branch is a flow that exists on this page and ends in a real
     connection - see the header of 13c for the list and why it is short. */
  const native=(a)=>{
    const h=a.how, kind=h.split(':')[0];
    const o={ id:'', name:escH(a.name), desc:escH(a.desc||DEF[kind]||''), auto:true,
              icon:_appMarkHTML(a.name), key:kind };
    if(h==='g'){ o.id='google'; o.connected=_rowConnected('google'); }
    else if(h==='ms'){ o.id='outlook'; o.connected=_rowConnected('outlook'); }
    else if(h==='gh'){ o.id='github'; o.connected=_rowConnected('github'); }
    else if(kind==='mail'){
      o.id='mail'; o.preset=h.slice(5);
      /* A Yahoo row is connected when the mailbox is Yahoo, not when any
         mailbox is - the picker row is the one that answers "any". */
      o.connected=!!mailAcc && (!o.preset || mailAcc.provider===o.preset);
      o.run='openMailInbox'; o.runLabel='Open inbox';
      if(!o.preset && mailAcc) o.desc='Connected to '+escH(mailAcc.address)+'. AMV reads it, summarizes it and drafts replies.';
    }
    else if(h==='tg'){ o.id='telegram'; o.connected=!!_TG_STATUS&&!!_TG_STATUS.connected;
      if(_telegramConnectedBot()) o.desc='Connected as @'+escH(_telegramConnectedBot())+'. AMV sends your background work here.'; }
    else if(h==='sms'){ o.id='sms'; o.connected=!!smsPhone; }
    /* Read with the key written out, because the check that pairs every
       storage key with its reader can only see a literal. */
    else if(h==='canvas'){ o.id='canvas'; o.connected=!!loadStr('amv_canvas'); o.run='schoolOpen'; o.runLabel='Open my school work'; }
    /* CONNECT GOES TO SPENDING. The link is a hosted sign-in at the bank with
       a pre-opened window and a returning step; a second copy of that money
       flow on this page is the one somebody forgets to fix. */
    else if(h==='bank'){ o.id='bank'; o.goto='bank'; o.useLabel='Link in Spending'; o.manageLabel='Manage in Spending';
      o.connected=(function(){ try{ return typeof AMVFinance!=='undefined' && AMVFinance.linked(); }catch(e){ return false; } })(); }
    else if(h==='cal'){ o.id='calfeeds'; o.auto=false; o.use='calfeeds'; o.useLabel='Connect'; o.connected=false; }
    else if(h==='jobs'){ o.id='jobboards'; o.auto=false; o.use='jobs'; o.useLabel='Browse boards'; o.connected=false; }
    else if(h==='everyday'){ o.id='everyday'; o.auto=false; o.use='everyday'; o.useLabel='See yours'; o.connected=false; }
    else if(h==='coverage'){ o.id='coverage'; o.auto=false; o.use='coverage'; o.useLabel='See coverage'; o.connected=false; }
    else if(h==='file'){ o.id=a.slug; o.auto=false; o.use='chat'; o.connected=false; }
    else if(h==='vscode'){ o.id='vscode'; o.auto=false; o.use='vscode'; o.useLabel='Set up'; o.connected=false; }
    /* THE APP'S OWN CONNECTOR. Signed in to at the app; AMV then uses it in
       chat, and asks before each action - so it is Manual, not Autonomous.
       A connection the app stopped accepting says so and offers Connect again. */
    /* THE APP'S OWN STANDARD SIGN-IN, and its API from chat. Live once the app
       is registered with the provider on this deployment; until then Connect
       says so rather than opening a flow that fails. */
    else if(kind==='p'){
      const pid=h.slice(2);
      o.id='prov'; o.preset=pid; o.manual=true; o.dedupe='prov:'+pid;
      o.connected=_rowConnected(pid);
      o.desc=escH(a.desc)+' '+(o.connected ? 'Connected - ask for it in chat, and AMV asks you before each action.'
                                           : 'Sign in at '+escH(a.name)+'; AMV asks you before each action.');
    }
    else if(kind==='r'){
      const slug=h.slice(2), st=_rmcpStateOf(slug);
      o.id='rmcp'; o.preset=slug; o.manual=true; o.dedupe='rmcp:'+slug;
      o.connected=!!(st && st.connected && !st.broken);
      o.desc=escH(a.desc)+' '+(st && st.broken
        ? '<b>It needs signing in again.</b>'
        : o.connected ? 'Connected - ask for it in chat, and AMV asks you before each action.'
                      : 'Sign in at '+escH(a.name)+'; AMV asks you before each action.');
    }
    else return null;
    return o;
  };
  /* A row AMV cannot connect yet. It says what the app is and offers the one
     honest action: tell me when. */
  const notified=_appNotifiedSet();
  const notifyRow=(a)=>'<div class="int-card int-notify">'+
      '<div class="int-ic">'+_appMarkHTML(a.name)+'</div>'+
      '<div class="int-body"><div class="int-top"><span class="int-name">'+escH(a.name)+'</span></div>'+
        '<div class="int-desc">'+escH(a.desc)+'</div></div>'+
      '<div class="int-act">'+(notified.has(a.slug)
        ? '<span class="int-onlist">✓ '+escH(T('On the list'))+'</span>'
        : '<button class="btn bs" data-app-notify="'+escH(a.slug)+'" data-app-name="'+escH(a.name)+'" style="font-size:var(--t-sm)">'+escH(T('Notify me'))+'</button>')+
      '</div></div>';
  const only=!!(opts && opts.connectedOnly), seen={};
  const sections=_appCats().map(c=>{
    /* Connected, then connectable, then the rest - so a connection somebody
       has is never hidden behind Show all, and Settings (which keeps only the
       connected rows of the first screenful) always finds it. */
    const rows=c.apps.map((a,i)=>{ const o=a.how?native(a):null; return { a, o, rank:(o&&o.connected)?0:o?1:2, i }; })
      .sort((x,y)=>x.rank-y.rank||x.i-y.i);
    let list=rows;
    if(only){
      /* One row per grant. A Google connection lights Gmail, Calendar, Drive,
         Docs, Sheets, Slides and Classroom, and Settings listing seven rows
         with seven Disconnect buttons for one sign-in would read as seven
         things to undo. */
      list=rows.filter(r=>{ const k=r.o && (r.o.dedupe||r.o.id); return r.rank===0 && !seen[k] && (seen[k]=1); });
      list.forEach(r=>{ const g=APP_GRANT_NAMES[r.o.id]; if(g) r.o.name=escH(g); });
      if(!list.length) return '';
    }
    const open=only || _appOpen.has(c.id);
    /* WHAT CONNECTS, FIRST AND ONLY, UNTIL SOMEBODY ASKS FOR THE REST.

       The first screen of a topic used to be its first six apps whatever they
       were, and 119 of the 191 rows people saw first were Notify me - apps AMV
       cannot connect. A page that is two-thirds "not yet" reads as a product
       that mostly does not work, and buries the rows that do. So a topic opens
       on the apps that really connect; See all shows everything it lists, with
       Notify me on the rest. A topic where nothing connects yet says so in one
       line rather than six cards. */
    const live=list.filter(r=>r.o);
    /* THREE STATES, NOT TWO KINDS OF CARD. Opened, a topic used to list its
       Notify me rows as cards the same size as the ones that connect, so the
       page still read as half "not yet". Connected and connectable rows stay
       cards; what AMV cannot connect goes underneath, under its own heading,
       as a compact list whose one action is to ask for it. */
    const shown=open ? live : live.slice(0, APP_ROWS_SHOWN);
    const asks=open ? list.filter(r=>!r.o) : [];
    const req=asks.length
      ? '<div class="int-req"><h4 class="int-req-h">'+escH(T('Request an integration'))+'</h4>'
          +'<p class="int-req-s">'+escH(T('AMV cannot connect these yet. Ask for one and you will be told when it can.'))+'</p>'
          +'<div class="int-list">'+asks.map(r=>notifyRow(r.a)).join('')+'</div></div>'
      : '';
    const html=shown.length ? shown.map(r=>intRow(r.o)).join('')
      : (req ? '' : '<p class="int-none">'+escH(T('Nothing here connects yet.'))+' '+escH(T('See all to ask for one.'))+'</p>');
    const more=(!only && list.length>Math.min(live.length, APP_ROWS_SHOWN))
      ? '<div class="int-more"><button class="int-seemore" data-app-more="'+escH(c.id)+'" aria-expanded="'+(open?'true':'false')+'"'
          +' aria-label="'+escH(_seeAllLabel(open, list.length, String(c.t).replace(/&amp;/g,'&')))+'">'
          +escH(open ? T('Show fewer') : T('See all {0}').replace('{0}', list.length))
          +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
          +(open ? '<path d="M6 15l6-6 6 6"/>' : '<path d="M5 12h14M13 6l6 6-6 6"/>')+'</svg></button></div>' : '';
    return cat(c.t, html, only?'':c.q, req+more);
  }).join('');
  return ''+
    (guest && !only
      ? '<div class="int-guest">'+
          '<div class="int-guest-t">Create a free account to connect these</div>'+
          '<div class="int-guest-s">Browse what each one does. Connecting keeps a token against your account, '+
            'so it needs an account first - it is free and takes a moment.</div>'+
          /* `data-auth` is the delegation that already exists for this - the
             dispatcher calls openAuth with its value. */
          '<button class="btn bp" data-auth="signup">Create a free account</button>'+
        '</div>'
      : '')+
    sections;
}
/* The name a connection is known by when one grant covers several rows. */
const APP_GRANT_NAMES = { google:'Google - Gmail, Calendar, Drive and Classroom', outlook:'Microsoft - Outlook mail and calendar' };
/* Six is a screenful on a phone and enough to see what a topic holds. */
const APP_ROWS_SHOWN = 6;
/* Which topics somebody opened with Show all. Kept across repaints, because a
   list that snaps shut when a mailbox finishes connecting is a list you lose
   your place in. */
const _appOpen = new Set();
function _appToggle(id){
  if(_appOpen.has(id)) _appOpen.delete(id); else _appOpen.add(id);
  _paintIntegrations();
}
/* A letter, rather than anybody's logo: a directory of five hundred brand
   marks is five hundred trademarks, and none of them would say anything the
   name beside it does not. */
function _appMarkHTML(name){ return '<span class="int-mono" aria-hidden="true">'+escH(String(name||'?').trim().charAt(0).toUpperCase())+'</span>'; }
/* Which apps this account asked to hear about. Written only after the server
   said it recorded the request, so "On the list" is never a guess. */
function _appNotifiedSet(){ const v=load('amv_app_notified'); return new Set(Array.isArray(v)?v:[]); }
function _appMarkNotified(slug){ const s=_appNotifiedSet(); s.add(slug); store('amv_app_notified',[...s].slice(-500)); }
/* NOTIFY ME, WHICH SAYS WHAT HAPPENED.

   The older notify-me on this page said "You're on the list!" whether the
   server stored it or not - including when there was no server at all. A
   request that was never recorded is a promise nobody will keep, told to the
   person most likely to be waiting for it. So this reports the outcome: it
   was recorded, or it was not and here is why. It goes on the waitlist the
   server already keeps (erased with the account like every other entry), one
   product per app, and that list is what decides which app is connected next. */
async function _appNotify(btn){
  const slug=btn.dataset.appNotify, name=btn.dataset.appName||'this app';
  if(!slug || _appNotifiedSet().has(slug)) return;
  let email=(S.user&&S.user.email)||'';
  if(!email){
    email=await showTextPromptAsync('We’ll email you when AMV can connect to '+name+'. Your email address:');
    if(!email) return;
    email=String(email).trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){ showError('That does not look like an email address.'); return; }
  }
  if(!(window.AMV_API && AMV_API.live)){
    toast('This copy of AMV is not connected to its server, so the request could not be recorded.','error',6000);
    return;
  }
  const was=btn.textContent;
  btn.disabled=true; btn.textContent=T('Saving…');
  let r=null, err='';
  try{ r=await AMV_API._fetch('/waitlist',{method:'POST',body:JSON.stringify({product:'app-'+slug,email:email.toLowerCase()})}); }
  catch(e){ err=String((e&&e.message)||''); }
  if(r && r.ok){
    _appMarkNotified(slug);
    toast('You’re on the list. We’ll email you when AMV can connect to '+name+'.','success',5000);
    _paintIntegrations();
    return;
  }
  btn.disabled=false; btn.textContent=was;
  let msg=err||'That could not be saved. Try again in a moment.';
  if(r){
    const d=await r.json().catch(()=>({}));
    msg = r.status===429 ? 'Too many requests from this network just now. Try again in a minute.' : String((d&&d.error)||msg);
  }
  toast(msg,'error',6000);
}
try{ window._appNotify=_appNotify; window._appToggle=_appToggle; }catch(e){}
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

/* SIGNED OUT, IN FRONT OF TWELVE CONNECT BUTTONS.

   The Integrations TAB is gated - a signed-out visitor pressing it gets the
   sign-up sheet and "Create a free account to use Integrations". The SAME
   catalogue reached through Settings had no gate at all, because the gate
   lives in the tab router and Settings does not go through it. So a guest saw
   twelve enabled Connect buttons, pressed one, and got a message meant for the
   operator: "Slack isn't connected yet. It needs its API key added by the
   operator in Settings first." Measured, signed out: twelve buttons, all
   enabled, no mention anywhere on the screen that an account is needed.

   That message is true and it is not their answer. Nothing they can do about
   an operator's API key, and the thing they actually need to do - make an
   account - was not said.

   Every path that would store something against an account goes through here
   now: connecting, and running an automation. Reading the catalogue does not,
   because what these integrations DO is a fair question to ask before signing
   up - the same reasoning that keeps Crew browsable. */
function _intNeedsAccount(what){
  if(typeof S!=='undefined' && S && S.user && S.user.email) return false;
  try{ openAuth('signup'); }catch(e){}
  try{ toast('Create a free account to connect '+(what||'this'),'info',3500); }catch(e){}
  return true;
}
try{ window._intNeedsAccount=_intNeedsAccount; }catch(e){}

/* The name a person would recognise, for that sentence. INTEGRATION_META is
   the same table the disconnect path and the catalogue read, so the row and
   the message cannot disagree about what a provider is called. */
function _intName(id){
  try{ if(INTEGRATION_META[id] && INTEGRATION_META[id].name) return INTEGRATION_META[id].name; }catch(e){}
  const extra={ mail:'your mailbox', telegram:'Telegram', slack:'Slack' };
  if(extra[id]) return extra[id];
  return id ? (id.charAt(0).toUpperCase()+id.slice(1)) : 'this';
}
try{ window._intName=_intName; }catch(e){}

/* WHAT A CONNECT BUTTON DOES, BY WHAT IT NAMES.

   Pulled out of the wiring so every door runs the same path - the directory
   row, and the card chat draws when somebody asks it to connect something.
   A second copy of this would be a second place where Google's row runs a
   sign-in that grants nothing, which is exactly what one of them used to do. */
function _intConnect(conn, preset){
  /* FIRST, before any provider branch. Put after them and the mail and
     Telegram rows would open their own connect sheets to somebody with no
     account to attach a mailbox to. */
  if(_intNeedsAccount(_intName(conn))) return;
  if(conn==='mail') return openMailConnect(preset||'');
  if(conn==='rmcp') return rmcpConnect(preset||'');
  if(conn==='prov') return connAddWhenReady(preset||'');
  if(conn==='telegram') return openTelegramConnect();
  /* Providers the connected-accounts framework owns are STARTED there, not
     here. Google's row used to run a sign-in from this button; sending it to
     the real flow is the whole fix, and it is done by provider id rather
     than by naming Google, so adding Microsoft to that framework does not
     leave a second row quietly doing the wrong thing. */
  if(_connOwnsProvider(conn)) return _connGoTo(conn);
  connectIntegration(conn);
}
function _intUse(use){
  if(use==='jobs' && typeof openJobBoards==='function') return openJobBoards();
  if(use==='calfeeds' && typeof openCalendarFeeds==='function') return openCalendarFeeds();
  if(use==='coverage' && typeof openCoverage==='function') return openCoverage();
  if(use==='everyday' && typeof openEveryday==='function') return openEveryday();
  /* No editor extension exists, and the dialog says so and offers the
     connection that does work in a project folder. */
  if(use==='vscode' && typeof _devConnectVSCode==='function') return _devConnectVSCode();
  /* The bank, and it needs its own line because the fall-through below
     tells people to upload a file - which is the right sentence for Excel
     and a baffling one for a bank account. Named rather than folded in,
     because the whole point of sending them to Spending is that the link
     happens there and they should know that before they arrive. */
  if(use==='bank'){
    try{ setTab('spend'); }catch(e){}
    try{ toast('Linking a bank happens here, on your bank\u2019s own sign-in page. AMV never sees your password.','info',6000); }catch(e){}
    return;
  }
  setTab(use||'chat'); toast('Upload your file with the \uD83D\uDCCE button, or just describe what you need.','info',4500);
}
try{ window._intConnect=_intConnect; window._intUse=_intUse; }catch(e){}

function _wireIntegrationCatalog(root){
  root=root||document;
  /* Mail is connected with a password rather than an OAuth round trip, so it
     has its own flow instead of being pushed through connectIntegration. */
  root.querySelectorAll('[data-int-conn]').forEach(btn=>on(btn,'click',()=>_intConnect(btn.dataset.intConn, btn.dataset.intPreset||'')));
  /* The bridge card is not a row, so it wires itself. Wired in the same
     pass as everything else, because a control that is drawn by one function
     and wired by another is how a button comes to do nothing. */
  try{ _bridgeWireCard(root); _neverRunWire(root); _mcpWireCard(root); }catch(e){}
  root.querySelectorAll('[data-app-notify]').forEach(btn=>on(btn,'click',()=>{ _appNotify(btn); }));
  root.querySelectorAll('[data-app-more]').forEach(btn=>on(btn,'click',()=>{ _appToggle(btn.dataset.appMore); }));
  root.querySelectorAll('[data-int-disc]').forEach(btn=>on(btn,'click',()=>{
    if(btn.dataset.intDisc==='mail') return disconnectMail();
    if(btn.dataset.intDisc==='rmcp') return rmcpDisconnect(btn.dataset.intPreset||'');
    if(btn.dataset.intDisc==='prov'){
      const it=((_connState.data||{}).items||[]).find(x=>x.provider===btn.dataset.intPreset);
      if(it) return connRemove(it.id);
    }
    if(btn.dataset.intDisc==='telegram') return disconnectTelegram();
    disconnectIntegration(btn.dataset.intDisc);
  }));
  root.querySelectorAll('[data-int-run]').forEach(btn=>on(btn,'click',()=>{
    /* An automation writes results against an account, so it needs one too.
       Reachable only from a connected row, which a guest cannot have - but
       this does not depend on that being true, because it is the kind of thing
       that stops being true when somebody adds a row. */
    if(_intNeedsAccount('an automation')) return;
    const fn=window[btn.dataset.intRun];
    if(typeof fn==='function') fn();
    else toast('That automation is not available in this build.','error');
  }));
  root.querySelectorAll('[data-int-use]').forEach(btn=>on(btn,'click',()=>_intUse(btn.dataset.intUse)));
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

/* WHAT HAS ALREADY BEEN ASKED, AND UNDER WHAT CONDITIONS.

   Connected accounts flickered - "Checking what is connected..." replacing
   the list and back again, about once a second, for as long as somebody had
   the Connectors tab open.

   Nothing was wrong with the fetch. `_connSectionHTML` asks for a load on
   every render, and the guards above only stopped a SECOND attempt while one
   was in flight or after one had SUCCEEDED. An error or an 'off' state fell
   straight through them. Meanwhile the connector directory repaints the whole
   view each time one of its thirty categories answers - so every answer was
   another attempt, another 'loading' paint, another failure, and the section
   underneath cycled between the two.

   It is the same defect `_cdirTried` was written for one file over, and the
   same shape: a render that asks, an answer that re-renders, and nothing
   recording that the question was already put.

   Keyed on the SITUATION rather than a flat "asked", because the one thing
   that makes asking again sensible - a backend becoming reachable - is what
   it records. `connReload()` clears it, so Try again still means try again. */
let _connTried = '';
function _connCtx(){ return (window.AMV_API && AMV_API.live) ? '1' : '0'; }
/* THE NEWEST ANSWER WINS (LESSONS 523). A reload forced while an older
   request was still out used to be dropped - and when it was allowed, the
   older one could land afterwards and overwrite the fresh answer with its
   error. Each load takes a number; only the latest may write. */
let _connGen = 0;
/* THE NEWEST LOAD, SO A SUPERSEDED ONE CAN WAIT FOR IT.

   A load overtaken by a newer one used to return at once, with nothing loaded.
   Its caller could not tell "superseded" from "finished": the Connect that a
   sign-in interrupted asked for the list, was overtaken by the reload that
   signing in starts, read an empty list, and dropped the Connect without a
   word. Under load it happened one run in four. Now a superseded load hands
   back the newest one, so every caller waits for a real answer. */
let _connLatest = null;
async function _connLoad(force){
  if(!force && _connState.state === 'loading') return _connLatest;
  if(_connState.state === 'done' && !force) return;
  if(!force && _connTried === _connCtx()) return;
  _connTried = _connCtx();
  if(!(window.AMV_API && AMV_API.live && AMV_API.connectList)){
    _connState = { state:'off', data:null, err:'' }; _connPaint(); return;
  }
  const gen = ++_connGen;
  const before = _connSig(_connState.data);
  _connState.state = 'loading'; _connPaint();
  const run = _connLoadRun(gen, before);
  _connLatest = run;
  return run;
}
async function _connLoadRun(gen, before){
  try{
    const d = await AMV_API.connectList();
    if(gen !== _connGen) return _connLatest;
    _connState = { state:'done', data:d || null, err:'' };
    /* THE ROWS, NOT ONLY THE LIST. _connPaint redraws the Connected accounts
       block; the app rows below it ("✓ Connected", Disconnect) and the whole
       Settings → Connectors pane are drawn from this same answer, and were
       left as they were drawn - so after signing in on a new device, or
       again on this one, Slack was connected on the server and said Connect
       on the screen until something else happened to redraw it. Redrawn only
       when what is connected changed, and not under somebody typing. */
    if(_connSig(d) !== before){
      const a = document.activeElement;
      const typing = a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.closest && a.closest('#vc, #set-pane, .set-conn');
      if(!typing && (S.tab==='integrations' || (S.tab==='settings' && S.settingsPane==='integrations'))){
        try{ _paintIntegrations(); }catch(e){}
        return;
      }
    }
  }catch(e){
    if(gen !== _connGen) return _connLatest;
    _connState = { state:'error', data:null, err:String((e&&e.message)||'').slice(0,120), code:(e&&e.code)||'' };
  }
  _connPaint();
}
/* What is connected, as one comparable string. */
function _connSig(d){
  try{ return ((d && d.items) || []).map(i => i.provider+':'+(i.scopes||[]).join(',')+(i.broken?'!':'')).sort().join('|'); }
  catch(e){ return ''; }
}
function _connPaint(){
  try{ const el=document.getElementById('conn-body'); if(el) el.innerHTML=_connBodyHTML(); }catch(e){}
  try{ const sec=document.getElementById('conn-sec'); if(sec) sec.hidden=!_connSecShown(); }catch(e){}
}
/* Try again has to mean try again: the record of having asked is cleared too,
   or the button would repaint a screen and ask nothing. */
function connReload(){ _connTried=''; _connState={state:'idle',data:null,err:''}; _connLoad(true); }
/* The same account asking again after it changed something (a connection
   finished, one was removed): what is on screen stays until the answer comes,
   rather than the block vanishing and coming back. connReload, which forgets
   everything, stays the one used when the account itself may have changed. */
function _connRefresh(){ _connTried=''; _connLoad(true); }
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
  'files.read':'read your OneDrive files', 'youtube.read':'see your YouTube channel and playlists',
  'tasks.write':'read and change your Google Tasks',
  'drive.write':'add files to your Drive - only ones AMV creates, never your existing files',
  'code.write':'change code in your repositories',
  'slack.read':'read your channels, messages and people, and search Slack', 'slack.write':'post messages as you',
  'discord.read':'see your profile and the servers you are in',
  'spotify.read':'see what you play, your playlists and your library', 'spotify.write':'control playback and change your playlists',
  'dropbox.read':'read your files', 'dropbox.write':'add and change files',
  'hubspot.read':'read contacts, companies and deals', 'hubspot.write':'add and change contacts and deals',
  'asana.all':'everything your Asana account can do', 'zoom.all':'your meetings, as allowed in AMV\u2019s Zoom app',
  'box.all':'everything your Box account can do', 'strava.read':'read your activities and profile', 'strava.write':'add activities',
  'reddit.read':'read Reddit as you, with your subscriptions and history', 'reddit.write':'post, edit and vote as you',
  'pinterest.read':'read your boards and pins', 'pinterest.write':'create boards and pins',
  'calendly.all':'your event types, bookings and availability',
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
    const r = await AMV_API.connectStart(provider, pick, _connReturnTo());
    if(r && r.url){ saveStr('amv_conn_return', S.tab||'integrations'); window.location.href = r.url; return; }
    toast('That connection could not be started.','error',5000);
  }catch(e){
    /* The sign-in ended while the permissions were being chosen: ask for it,
       and pick this Connect up again afterwards rather than dropping it. */
    if(/session expired|sign in again/i.test(String((e&&e.message)||'')) && typeof _askToSignInAgain==='function'){
      _askToSignInAgain(()=>connAddWhenReady(provider), true);
      return;
    }
    toast(String((e&&e.message)||'That connection could not be started.'),'error',7000);
  }
}
try{ window.connAdd=connAdd; }catch(e){}
/* Connect, from a row, without depending on the list having loaded first.
   connAdd returns quietly when it does not know the provider - which, from a
   row that says Connect, is a button that does nothing. So the list is asked
   for if it is not here, and a failure is said. */
async function connAddWhenReady(provider){
  /* ASKED FRESH, EVERY PRESS. A list already on screen says nothing about
     whether the sign-in still holds: with one cached, Connect went straight to
     the permission choice on an ended session, the next request asked for a
     sign-in with nothing to come back to, and the Connect was lost. Asking
     first means an ended session is found HERE, where the sign-in is told to
     carry on with this Connect. One request, on a deliberate press. */
  await _connLoad(true);
  const d=_connState.data;
  if(!d){
    /* Not signed in on this device any more: ask for the sign-in right here and
       carry on with this Connect once it is done - never "sign out and back in". */
    if(_connState && _connState.code==='unauthorized' && typeof _askToSignInAgain==='function'){
      _askToSignInAgain(()=>connAddWhenReady(provider), true);
      return;
    }
    const why=(_connState && _connState.err) ? ' ('+_connState.err+')' : '';
    toast('Connected accounts could not be loaded, so AMV cannot start a sign-in just now'+why+'. Try again in a moment.','error',9000);
    return;
  }
  if(!d.configured){ toast('Connecting apps is not switched on for this deployment yet.','info',7000); return; }
  if(!(d.providers||[]).some(x=>x.id===provider)){ toast('That app cannot be connected on this deployment.','info',6000); return; }
  return _connGoTo(provider);
}
try{ window.connAddWhenReady=connAddWhenReady; }catch(e){}

/* A real choice, with the consequence of each line written out.

   REBUILT AS A DIALOG THAT FITS THE SCREEN. It was a card with no inner
   padding and no scrolling: Google's nine permissions pushed "Continue to
   Google" below the bottom of a phone, and the only way to reach it was not to
   have a phone. The owner: "they are able to scroll on the thing", and "it
   looks awful". Now a header, a list that scrolls on its own, and a footer that
   is always on screen - a sheet from the bottom on a phone. Anything that can
   change something at the provider says so beside it. */
const _CONN_SCOPE_CHANGES = /\.(write|send|all)$/;
function _connScopePick(p){
  return new Promise(resolve => {
    const r = $('ovr'); if(!r){ resolve(null); return; }
    const cap = (t) => { t = String(t||''); return t.charAt(0).toUpperCase() + t.slice(1); };
    const rows = (p.scopes||[]).map((k,i) =>
      '<label class="cpk-opt"><input type="checkbox" data-scope="'+escH(k)+'"'+(i===0?' checked':'')+'>'+
        '<span class="cpk-lbl">'+escH(cap(_CONN_SCOPE_WORDS[k] || k))+'</span>'+
        (_CONN_SCOPE_CHANGES.test(k) ? '<span class="cpk-tag">'+escH(T('Can make changes'))+'</span>' : '')+
      '</label>').join('');
    r.innerHTML =
      '<div class="ov cpk-ov" id="conn-bg"><div class="cpk" role="dialog" aria-modal="true" aria-labelledby="conn-t" aria-describedby="conn-d">'+
        '<div class="cpk-head">'+
          '<span class="cpk-mark" aria-hidden="true">'+escH(String(p.name||'?').charAt(0))+'</span>'+
          '<div class="cpk-titles"><div class="cpk-eyebrow">'+escH(T('Connect'))+'</div>'+
            '<h2 class="cpk-t" id="conn-t">'+escH(p.name)+'</h2></div>'+
          '<button class="cpk-x" id="conn-x" aria-label="'+escH(T('Close'))+'">'+
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'+
          '</button>'+
        '</div>'+
        '<div class="cpk-body">'+
          '<p class="cpk-d" id="conn-d">'+escH(T('Choose only what you need. You can disconnect at any time, and AMV revokes it with')+' '+p.name+'.')+'</p>'+
          '<div class="cpk-list-h"><span id="conn-lh">'+escH(T('What AMV may do'))+'</span><span class="cpk-count" id="conn-count"></span></div>'+
          '<div class="cpk-list" role="group" aria-labelledby="conn-lh">'+rows+'</div>'+
          '<div class="cpk-note">'+
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'+
            '<div><b>'+escH(T('Works while you are away.'))+'</b> '+escH(T('AMV’s servers keep a key to this account until you disconnect it, and every time a job uses it is recorded here.'))+'</div>'+
          '</div>'+
        '</div>'+
        '<div class="cpk-foot"><button class="btn cpk-cancel" id="conn-cancel">'+escH(T('Cancel'))+'</button>'+
          '<button class="btn bp cpk-go" id="conn-go">'+escH(T('Continue to')+' '+p.name)+'</button></div>'+
      '</div></div>';
    const boxes = [...r.querySelectorAll('[data-scope]')];
    const count = () => {
      const n = boxes.filter(c=>c.checked).length;
      const c = $('conn-count'); if(c) c.textContent = n+' '+T('of')+' '+boxes.length+' '+T('selected');
      const go = $('conn-go'); if(go) go.disabled = !n;
    };
    boxes.forEach(b => on(b,'change',count)); count();
    const done = (v) => { r.innerHTML=''; resolve(v); };
    on($('conn-x'),'click',()=>done(null));
    on($('conn-cancel'),'click',()=>done(null));
    onBackdrop($('conn-bg'),()=>done(null));
    on($('conn-go'),'click',()=>{
      const picked=boxes.filter(c=>c.checked).map(c=>c.dataset.scope);
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
  _connGoBack();
  _connRefresh();
  /* A job may have sent somebody here. Finishing it is the point of the trip,
     and it has to wait for the connection list to come back - `cwConnectResume`
     asks whether the thing is actually connected now, and asking before the
     refresh lands answers no every time. It refuses a stale or unrelated
     intent itself, so a connection made from the Connectors page for its own
     sake switches nothing on. */
  try{ setTimeout(()=>{ try{ if(typeof cwConnectResume==='function') cwConnectResume(); }catch(e){}
                       /* And the requirements screen, for a job that sent somebody
                          here with more than one thing still to connect. */
                       try{ if(typeof cwResumeIfAny==='function') cwResumeIfAny(); }catch(e){} }, 900); }catch(e){}
}
try{ window._connectFinish=_connectFinish; }catch(e){}

async function connRemove(id){
  const d=_connState.data||{};
  const it=(d.items||[]).find(x=>x.id===id); if(!it) return;
  const okd = await showConfirmAsync('Disconnect '+(it.name||it.provider)+'?\n\n'+
    'AMV will revoke this with '+(it.name||it.provider)+' and forget it. Any job using it stops working until you connect it again.');
  if(!okd) return;
  await _disconnectSaying(AMV_API.connectRemove(id));
  _connRefresh();
}
/* ONE WAY BACK AND ONE WAY TO REPORT A DISCONNECT, for Connected accounts and
   app connectors both - the second sign-in flow calls these rather than
   carrying copies that could drift apart. */
/* THE ADDRESS A PROVIDER SENDS SOMEBODY BACK TO IS ALWAYS THE SITE ROOT.

   It was the page's own address, origin + pathname. Where the host serves
   bare paths, AMV shows /settings or /crew in the address bar - so Connect
   pressed there sent https://amv.homes/settings as the return address, and
   Google, Microsoft and Discord, which match it byte for byte against the one
   registered (https://amv.homes/), refused the sign-in before it began. Where
   to go afterwards is already remembered separately (amv_conn_return), so the
   return address never needs to say it. */
function _connReturnTo(){ return window.location.origin + '/'; }
try{ window._connReturnTo=_connReturnTo; }catch(e){}
function _connGoBack(){
  try{ const back=loadStr('amv_conn_return')||'integrations'; saveStr('amv_conn_return',''); setTab(back); }catch(e){}
}
async function _disconnectSaying(pending){
  try{
    const r = await pending;
    toast((r && r.message) || 'Disconnected.', (r && r.revoked) ? 'success' : 'info', (r && r.revoked) ? 4000 : 9000);
  }catch(e){
    toast(String((e&&e.message)||'That could not be disconnected.'),'error',7000);
  }
}
try{ window._connGoBack=_connGoBack; window._disconnectSaying=_disconnectSaying; }catch(e){}
try{ window.connRemove=connRemove; }catch(e){}

function _connBodyHTML(){
  const st=_connState;
  if(st.state==='off')
    return '<div class="conn-note">'+escH(T('This copy of AMV is not connected to a backend, so there is nowhere safe to keep an account token. Connected accounts are off rather than pretending to work.'))+'</div>';
  const had=!!(st.data && (st.data.items||[]).length);
  if((st.state==='idle'||st.state==='loading') && !had)
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

  /* WHAT IS CONNECTED, AND NOTHING ELSE. This block also listed every app that
     could be connected - "Google Connect, GitHub Connect, Slack Connect..." -
     which is the directory below said a second time, above the thing it is
     for. Asked for: only what is connected, only once something is. Every one
     of those apps keeps its Connect on its own row in the directory. */
  return items;
}
/* The block is shown when it has something to say: a connection, or a reason
   the list could not be read. Empty, loading, or switched off, it is not there
   at all - so nothing appears and then disappears as the page settles. */
function _connSecShown(){
  const st=_connState;
  if(st.state==='error') return true;
  const d=st.data||{};
  if(st.state!=='done') return !!(d.configured && (d.items||[]).length);
  if(!d.configured) return false;
  return !!((d.items||[]).length);
}

/* WHETHER THE SETUP PANEL IS OPEN, REMEMBERED.

   `<details>` keeps its own state in the element, and this view rewrites its
   markup on every render - adding a connector, a connection landing, the
   directory answering. So the panel somebody had opened to type a command into
   snapped shut the moment they pressed Add, taking the form they were using
   with it. Held here instead, and restored on every paint. */
let _connMachineOpen = false;
/* 6. THE SPREADSHEET EDITOR - sheet.js, fetched the first time a table is
   opened, the way the Office exporter is. Reading CSV, formulas, sorting,
   totals, duplicates and summaries all live there; this is the door. */
let _sheetP = null;
function _loadSheet(){
  if(window.amvSheet) return Promise.resolve(true);
  if(_sheetP) return _sheetP;
  _sheetP = new Promise(res => {
    const s = document.createElement('script');
    s.src = 'sheet.js';
    s.onload = () => res(!!window.amvSheet);
    s.onerror = () => { _sheetP = null; s.remove(); res(false); };
    document.head.appendChild(s);
  });
  return _sheetP;
}
function _sheetDownloadCSV(){
  if(window.amvSheet) window.amvSheet.downloadCSV();
  else toast(T('There is nothing in this sheet to download yet.'),'error');
}
function _saveBlob(blob,name){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=name; a.style.display='none';
  /* In the document for the click, because some browsers only follow a
     download link that is attached; removed and revoked a moment later. (A
     first draft of this note blamed the revoke timing for files arriving as
     "download" - measured, that was wrong: the old helper named them fine, and
     the only case that failed was a non-ASCII name in the headless test
     browser, which a real browser saves under its proper name.) */
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ try{ URL.revokeObjectURL(url); a.remove(); }catch(e){} },1500);
}
try{ window._sheetDownloadCSV=_sheetDownloadCSV; }catch(e){}

/* The screen the editor was opened from. openSheetEditor writes straight into
   #vc without touching S.tab, so nothing else records where you came from -
   and Close used to send everybody to a tab that renders Crew, which is not a
   place anybody was. */
let _sheetFrom='chat';
function _sheetClose(){
  const back=_sheetFrom||'chat';
  try{ setTab(back); }catch(e){ try{ setTab('chat'); }catch(_){} }
}
try{ window._sheetClose=_sheetClose; }catch(e){}
function handleSheetFile(file){
  // An unreadable or corrupt file used to do nothing at all, with no error -
  // the user just saw their upload vanish.
  file.text().then(async text=>{
    try{
      if(!await _loadSheet()){ toast(T('The spreadsheet editor could not be loaded. Check your connection and try again.'),'error',6000); return; }
      const rows=window.amvSheet.parse(text);
      if(!rows.length){ toast('That file has no readable rows. Check it is a CSV.','error',4500); return; }
      openSheetEditor(rows,file.name);
    }catch(e){
      toast('That file could not be read as a spreadsheet.','error',4500);
      try{ _logErr('sheet.parse', e); }catch(_){}
    }
  }).catch(e=>{
    toast('Could not read that file. Try uploading it again.','error',4500);
    try{ _logErr('sheet.read', e); }catch(_){}
  });
}
/* An Excel file read for a chat: its sheets, with their formulas, back into
   the editor. */
function _openXlsxAsSheet(att){
  _loadSheet().then(ok=>{
    if(!ok){ toast(T('The spreadsheet editor could not be loaded. Check your connection and try again.'),'error',6000); return; }
    const sheets=window.amvSheet.fromReaderText(att&&att.data);
    if(!sheets.length){ toast(T('No sheet in this file has cells to open.'),'error',5000); return; }
    openSheetEditor(sheets[0].rows, att.name, { sheets, sheetIx:0 });
  });
}
/* The frame is drawn at once - name, Close, the question box - and the table
   fills in when the editor arrives. */
function openSheetEditor(data,name,opts){
  const vc=$('vc'); if(!vc) return;
  _sheetFrom=(typeof S!=='undefined'&&S.tab)?S.tab:'chat';
  vc.innerHTML='<div class="sh-wrap">'
    +'<div class="sh-head"><span class="sh-name">'+escH(name||T('Spreadsheet'))+'</span><span class="sh-meta" id="sh-meta"></span>'
    +'<div class="sh-acts"><button type="button" class="btn bs" data-dact="_sheetDownloadCSV">'+escH(T('Download CSV'))+'</button>'
    +'<button type="button" class="btn bs" data-dact="_sheetClose">'+escH(T('Close'))+'</button></div></div>'
    +'<div class="sh-body"><p class="sh-loading">'+escH(T('Opening the table…'))+'</p></div>'
    +'<div class="sh-ai"><div class="sh-ai-h">'+escH(T('Ask AMV about this table'))+'</div>'
    +'<div class="sh-ai-q">'+['Analyze trends','Summarize data'].map(q=>'<button type="button" class="btn bs" data-dact="runSheetAI" data-darg="'+escH(q)+'">'+escH(T(q))+'</button>').join('')+'</div>'
    +'<div class="sh-ai-row"><input type="text" id="sheet-inp" placeholder="'+escH(T('Ask a question, or ask for a change'))+'" aria-label="'+escH(T('Ask AMV about this table'))+'">'
    +'<button type="button" class="btn bp" id="sheet-ask">'+escH(T('Ask'))+'</button></div>'
    +'<div id="sheet-res" class="sh-res" aria-live="polite" hidden></div></div></div>';
  on($('sheet-ask'),'click',()=>runSheetAI($('sheet-inp')&&$('sheet-inp').value));
  on($('sheet-inp'),'keydown',e=>{if(e.key==='Enter')runSheetAI($('sheet-inp')&&$('sheet-inp').value);});
  const box=vc.querySelector('.sh-body');
  _loadSheet().then(ok=>{
    if(!box.isConnected) return;          /* left before it arrived */
    if(ok){ window.amvSheet.open(vc, data, name, opts); return; }
    box.innerHTML='<p class="sh-loading">'+escH(T('The spreadsheet editor could not be loaded. Check your connection and try again.'))+'</p>'
      +'<button type="button" class="btn bs" id="sh-retry">'+escH(T('Try again'))+'</button>';
    on($('sh-retry'),'click',()=>openSheetEditor(data,name,opts));
  });
}
function runSheetAI(query){ if(window.amvSheet) window.amvSheet.ask(query); }
/* 7. AUTOMATION VIEW - dark modal, real task queue */
/* `var`, not `const`, and the reason is the two guards in 10-mission-control
   that read this from an EARLIER module: `typeof _bgQueue!=='undefined'`.
   Against a `const` that guard is decorative - typeof on a binding still in its
   temporal dead zone throws ReferenceError exactly as a bare read would, so the
   guard cannot fail safely, it can only fail. A top-level `var` is hoisted and
   really does read `undefined` before this line runs, which is the answer those
   guards were written to get. */
var _bgQueue = { tasks: [], running: false };
async function _bgRunNext(){
  if(_bgQueue.running) return;
  const task=_bgQueue.tasks.find(t=>t.status==='queued');
  if(!task) return;
  _bgQueue.running=true;
  task.status='running';
  /* It used to ask for amv_mk, a key setting nothing has written since the
     engine moved behind the server - so every task failed as "not connected". */
  if(!_aiBackendReady()){task.status='failed';task.error='AMV isn’t connected yet';_bgQueue.running=false;return;}
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
async function openMailConnect(preset){
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
      /* A paused provider is shown, not hidden - somebody looking for it should
         find it and read why - but it cannot be chosen. */
      list.map(p=>'<option value="'+escH(p.id)+'"'+(p.paused?' disabled':'')+'>'+escH(p.flag+' '+p.name+(p.paused?' - paused, see below':''))+'</option>').join('')+
    '</optgroup>';
  }).join('');

  r.innerHTML='<div class="ov" id="ml-bg"><div class="ml-modal" role="dialog" aria-modal="true" aria-labelledby="ml-h">'+
    '<div class="ml-head"><div><div class="eyebrow">Mail</div><h2 id="ml-h">Connect your mailbox</h2></div>'+
      '<button class="tp-x" id="ml-x" aria-label="Close">✕</button></div>'+
    '<p class="mu ml-intro">AMV works with '+(+cat.countries||20)+'+ countries’ mail providers over IMAP, the open standard they all support. Your password is encrypted on AMV’s server and is never sent back to this browser.</p>'+
    '<label class="ml-f"><span>Provider</span><select id="ml-prov">'+opts+'</select></label>'+
    cat.providers.filter(p=>p.paused).map(p=>'<p class="mu ml-paused"><b>'+escH(p.name)+' is paused.</b> '+escH(p.paused)+'</p>').join('')+
    '<div id="ml-custom" style="display:none">'+
      '<label class="ml-f"><span>IMAP server</span><input id="ml-imap" placeholder="imap.example.com" autocomplete="off"></label>'+
      '<label class="ml-f"><span>SMTP server</span><input id="ml-smtp" placeholder="smtp.example.com" autocomplete="off"></label>'+
    '</div>'+
    '<label class="ml-f"><span>Email address</span><input id="ml-addr" type="email" placeholder="you@example.com" autocomplete="username"></label>'+
    '<label class="ml-f"><span>App password</span><input id="ml-pass" type="password" autocomplete="new-password"></label>'+
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
  /* Opened from a named row - Yahoo Mail, Naver Mail - it starts on that
     provider, so the setup sentence under it is the one for the mailbox they
     pressed. An id the list does not have leaves the first choice selected. */
  if(preset && cat.providers.some(x=>x.id===preset)) sel.value=preset;
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
    '<label class="ml-f"><span>Bot token</span><input id="tg-tok" type="password" autocomplete="new-password" placeholder="123456789:AA\u2026"></label>'+
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
        /* Only from a catalogue that has arrived - see _cwDefaultJobs. When it
           has not, the definitions are cached above and the next Crew sync
           rebuilds from them. */
        const byId={}; (_cwJobs()||[]).forEach(j=>{ byId[j.id]=j; });
        const defsAll=_cwDefaultJobs();
        if(defsAll) _cwSaveJobs(defsAll.map(def=>Object.assign({}, def, {
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

/* ── THESE SCREENS ARRIVE WHEN THEY ARE OPENED ───────────────────────────
   Drawing Tasks, Integrations and Automation is in
   src/integrations/integrations-view.js (published integrations-view.js,
   audit #40). What stays here is what the rest of the app reaches without
   those screens open: connecting an account, the connection state, running
   a task. Each of these is a stand-in; the file declares the real ones,
   which replace them as it loads. */
function renderTasksView(){ _lazyScreen('integrations-view.js', renderTasksView, 'renderTasksView'); }
function renderIntegrationsView(){ _lazyScreen('integrations-view.js', renderIntegrationsView, 'renderIntegrationsView'); }
function renderAutomationView(){ _lazyScreen('integrations-view.js', renderAutomationView, 'renderAutomationView'); }
