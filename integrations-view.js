/* ═════════════════════════════════════════════════
   TASKS, INTEGRATIONS AND AUTOMATION - the screens. Published as
   integrations-view.js (see build.mjs) and fetched when one is first drawn,
   or when the browser is idle.

   Moved out of the page, unchanged, by following what the rest of the app
   calls (audit #40): everything here is reached only from these screens.
   What other parts of the app call stays in src/app/13-integrations.js,
   beside stand-ins that this file's real renderers replace when it loads.
   A classic script, like the page.
   ═════════════════════════════════════════════════ */
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
  word:"Write a [report/proposal/memo] on: [topic]\nAudience: [who reads it]\nLength: [approximate]",
  compare:"Help me choose [what I am buying].\nBudget: [amount]\nWhat matters most: [list]\n\nFind the three best options available where I live, compare them on price and quality with sources, and tell me which you would pick and why.",
  lookup:"Find out [what I need to know].\n\nGive me the current answer with the source and the date of each fact, and say plainly if sources disagree.",
  cook:"I have [ingredients] and [time] minutes.\nWhat can I cook tonight? Give me two options with steps, and what to buy if one ingredient is missing.",
  edit:"Improve this - clearer and tighter, without changing what I mean or how I sound:\n\n[Paste your text]",
  translate:"Translate this into [language], keeping the tone and anything that should stay as it is:\n\n[Paste your text]"
};
function launchTask(key){
  const prompt=TASKS[key];
  if(!prompt){ toast('Task not found','error'); return; }
  setTab('chat');
  setTimeout(()=>{
    const ta=$('mta');
    if(ta){
      ta.value=prompt;
      fitChatComposer(ta);
      ta.focus();
      const s=prompt.indexOf('[');
      if(s>-1) ta.setSelectionRange(s,prompt.indexOf(']')+1);
    }
  },150);
}

/* 4. TASKS VIEW */

const AMV_TASK_EXTRA = [
  {
    "id": "meeting-agenda",
    "title": "Prepare a meeting agenda",
    "prompt": "Turn [meeting goal] into an agenda with decisions, time boxes and preparation.",
    "cat": "Work"
  },
  {
    "id": "follow-up",
    "title": "Draft a follow-up",
    "prompt": "Draft a polite follow-up about [topic]. Do not send it; give me text to review.",
    "cat": "Work"
  },
  {
    "id": "weekly-update",
    "title": "Write a weekly update",
    "prompt": "Turn [notes] into completed work, blockers and next steps. Do not invent results.",
    "cat": "Work"
  },
  {
    "id": "project-scope",
    "title": "Define a project scope",
    "prompt": "For [project], separate objectives, deliverables, exclusions, dependencies and acceptance tests.",
    "cat": "Work"
  },
  {
    "id": "risk-register",
    "title": "Build a risk register",
    "prompt": "For [project], identify risks, warning signs, mitigations and owners to assign.",
    "cat": "Work"
  },
  {
    "id": "decision-memo",
    "title": "Compare a decision",
    "prompt": "Compare [options] against [criteria]. Separate known evidence, assumptions and missing information.",
    "cat": "Work"
  },
  {
    "id": "interview-practice",
    "title": "Practice an interview",
    "prompt": "Ask me one interview question at a time for [role]. Give specific feedback after each answer.",
    "cat": "Work"
  },
  {
    "id": "onboarding",
    "title": "Plan onboarding",
    "prompt": "Create a first-week checklist for [role]. Flag access permissions that an administrator must grant.",
    "cat": "Work"
  },
  {
    "id": "handover",
    "title": "Prepare a handover",
    "prompt": "Turn [notes] into a handover with current status, open decisions and source links.",
    "cat": "Work"
  },
  {
    "id": "proposal-review",
    "title": "Review a proposal",
    "prompt": "Review [proposal] for unclear scope, contradictory terms, deliverables and unanswered questions.",
    "cat": "Work"
  },
  {
    "id": "quiz-me",
    "title": "Quiz me one question at a time",
    "prompt": "Quiz me on [topic], one question at a time. Explain errors and adjust difficulty.",
    "cat": "Study"
  },
  {
    "id": "study-calendar",
    "title": "Plan revision",
    "prompt": "Build a realistic revision schedule for [exam date, subjects, available time]. Ask for missing details.",
    "cat": "Study"
  },
  {
    "id": "essay-outline",
    "title": "Outline an argument",
    "prompt": "Help outline my argument about [topic], with thesis, counterargument and evidence gaps. Do not invent citations.",
    "cat": "Study"
  },
  {
    "id": "rubric-check",
    "title": "Check work against a rubric",
    "prompt": "Compare [my work] with [rubric]. Quote specific evidence and propose concrete edits.",
    "cat": "Study"
  },
  {
    "id": "citation-audit",
    "title": "Check citations",
    "prompt": "Check [citations] against the sources I provide. Flag unverifiable references instead of inventing them.",
    "cat": "Study"
  },
  {
    "id": "lab-report",
    "title": "Organize a lab report",
    "prompt": "Organize [experiment notes] into hypothesis, method, observations and limitations. Do not fabricate data.",
    "cat": "Study"
  },
  {
    "id": "worked-example",
    "title": "Walk through a problem",
    "prompt": "Guide me through [problem] step by step. Ask me to attempt the next step before giving it.",
    "cat": "Study"
  },
  {
    "id": "language-practice",
    "title": "Practice a conversation",
    "prompt": "Practice [language] with me about [topic]. Keep corrections short and explain useful expressions.",
    "cat": "Study"
  },
  {
    "id": "debate-prep",
    "title": "Prepare both sides of a debate",
    "prompt": "Build arguments and counterarguments for [motion]. Distinguish sourced facts from opinions.",
    "cat": "Study"
  },
  {
    "id": "reading-questions",
    "title": "Discuss a reading",
    "prompt": "From [reading], create questions that require close reading. Use only quotations actually in the supplied text.",
    "cat": "Study"
  },
  {
    "id": "bill-explain",
    "title": "Understand a bill",
    "prompt": "Explain [redacted bill]. Separate usage, fixed fees, taxes and due dates. Do not pay it.",
    "cat": "Money and home"
  },
  {
    "id": "subscription-inventory",
    "title": "List subscriptions",
    "prompt": "From [redacted receipts or connected email with consent], list subscriptions, renewals and evidence. Do not cancel anything.",
    "cat": "Money and home"
  },
  {
    "id": "refund-draft",
    "title": "Draft a refund request",
    "prompt": "Draft a refund request for [order issue] using the seller policy I provide or a current official source. Do not submit it.",
    "cat": "Money and home"
  },
  {
    "id": "utility-compare",
    "title": "Compare utility plans",
    "prompt": "Compare utility options for [postcode and needs] from current official pricing. State exclusions and dates.",
    "cat": "Money and home"
  },
  {
    "id": "move-checklist",
    "title": "Organize a move",
    "prompt": "Build a moving checklist for [origin, destination, date] with documents and tasks. Verify local official requirements.",
    "cat": "Money and home"
  },
  {
    "id": "rental-questions",
    "title": "Prepare rental questions",
    "prompt": "From [listing or lease], suggest questions about fees, repairs and renewal. Flag legal questions for a qualified adviser.",
    "cat": "Money and home"
  },
  {
    "id": "insurance-compare",
    "title": "Compare insurance documents",
    "prompt": "Compare [policy documents] on coverage, exclusions, limits and deductibles. Do not recommend a policy without the missing facts.",
    "cat": "Money and home"
  },
  {
    "id": "renewal-calendar",
    "title": "Identify renewal dates",
    "prompt": "From [documents], list renewal dates and deadlines with the exact source for each. Do not create calendar events without my review.",
    "cat": "Money and home"
  },
  {
    "id": "receipt-table",
    "title": "Organize receipts",
    "prompt": "Turn [receipts] into a table of merchant, date, currency, amount and category. Never add unlike currencies.",
    "cat": "Money and home"
  },
  {
    "id": "savings-scenarios",
    "title": "Model savings scenarios",
    "prompt": "Calculate savings scenarios from [income, expenses, target]. Label assumptions and show the arithmetic.",
    "cat": "Money and home"
  },
  {
    "id": "source-check",
    "title": "Check a claim",
    "prompt": "Verify [claim] using primary sources when possible. Give dates, disagreement and confidence.",
    "cat": "Research"
  },
  {
    "id": "compare-sources",
    "title": "Compare sources",
    "prompt": "Compare [sources] on evidence, methods, conflicts of interest and what each cannot establish.",
    "cat": "Research"
  },
  {
    "id": "country-services",
    "title": "Find official local services",
    "prompt": "Find official services for [need] in the selected country. Verify domains and eligibility; do not submit personal data.",
    "cat": "Research"
  },
  {
    "id": "market-map",
    "title": "Map a market",
    "prompt": "Map [market] by customer segment, competitors and evidence. Distinguish revenue data from estimates.",
    "cat": "Research"
  },
  {
    "id": "company-brief",
    "title": "Research a company",
    "prompt": "Create a sourced brief on [company], including business model, recent official filings and open questions.",
    "cat": "Research"
  },
  {
    "id": "product-compare",
    "title": "Compare local products",
    "prompt": "Compare [product requirements] using current country-specific prices and seller policies. I will complete any checkout.",
    "cat": "Research"
  },
  {
    "id": "fact-timeline",
    "title": "Build an evidence timeline",
    "prompt": "Build a dated timeline of [topic]. Distinguish the event date from publication date.",
    "cat": "Research"
  },
  {
    "id": "paper-explain",
    "title": "Explain a research paper",
    "prompt": "Explain [paper] with its question, method, results, limitations and what the evidence does not show.",
    "cat": "Research"
  },
  {
    "id": "public-data",
    "title": "Find public datasets",
    "prompt": "Find datasets for [research question]. Report source, license, geography, update date and missing values.",
    "cat": "Research"
  },
  {
    "id": "accessibility-review",
    "title": "Review accessibility",
    "prompt": "Review [page or interface] for keyboard access, labels, contrast and readable content. Separate measured checks from hypotheses.",
    "cat": "Research"
  },
  {
    "id": "test-plan",
    "title": "Design a test plan",
    "prompt": "For [feature], define happy paths, permission checks, failure injection and acceptance criteria.",
    "cat": "Build"
  },
  {
    "id": "bug-repro",
    "title": "Write a bug report",
    "prompt": "Turn [observations] into steps, expected versus actual behavior, environment and a minimal reproduction.",
    "cat": "Build"
  },
  {
    "id": "api-contract",
    "title": "Review an API contract",
    "prompt": "Review [API specification] for authorization, idempotency, validation, error responses and versioning.",
    "cat": "Build"
  },
  {
    "id": "db-migration",
    "title": "Plan a database migration",
    "prompt": "Plan [migration] with backups, compatibility, rollback conditions and verification. Do not run it.",
    "cat": "Build"
  },
  {
    "id": "security-review",
    "title": "Review code security",
    "prompt": "Review [code] defensively for access control, injection, secret handling and failure behavior. Cite exact lines and label untested risks.",
    "cat": "Build"
  },
  {
    "id": "release-checklist",
    "title": "Prepare a release checklist",
    "prompt": "For [application], make a release checklist with required tests, rollback, monitoring and owners.",
    "cat": "Build"
  },
  {
    "id": "incident-notes",
    "title": "Organize an incident",
    "prompt": "From [incident notes], separate timeline, observed impact, hypotheses, mitigation and follow-up evidence.",
    "cat": "Build"
  },
  {
    "id": "sql-review",
    "title": "Review a query",
    "prompt": "Review [SQL] for correctness, permissions and performance. Suggest a safe plan; do not execute production changes.",
    "cat": "Build"
  },
  {
    "id": "docs-draft",
    "title": "Write developer documentation",
    "prompt": "Document [feature or code] with setup, examples, errors and known limitations. Do not claim behavior not in the code.",
    "cat": "Build"
  },
  {
    "id": "data-validation",
    "title": "Check a dataset",
    "prompt": "Inspect [dataset] for missing values, duplicates, types and inconsistent units. Report checks, not invented cleaned data.",
    "cat": "Build"
  },
  {
    "id": "travel-docs",
    "title": "Check travel documents",
    "prompt": "Identify official document requirements for [nationality, destination, dates]. Verify current government sources; do not submit an application.",
    "cat": "Everyday"
  },
  {
    "id": "packing",
    "title": "Make a packing list",
    "prompt": "Make a packing list for [destination, dates, activities] and explain the assumptions.",
    "cat": "Everyday"
  },
  {
    "id": "meal-budget",
    "title": "Plan meals on a budget",
    "prompt": "Plan meals for [people, budget, restrictions] using local units. Ask about allergies before choosing ingredients.",
    "cat": "Everyday"
  },
  {
    "id": "appointment-prep",
    "title": "Prepare appointment questions",
    "prompt": "Help organize questions and information for [appointment]. Do not diagnose or replace the professional.",
    "cat": "Everyday"
  },
  {
    "id": "event-plan",
    "title": "Plan a small event",
    "prompt": "Plan [event] with budget, timeline, accessibility, roles and contingency options.",
    "cat": "Everyday"
  },
  {
    "id": "gift-research",
    "title": "Research a gift",
    "prompt": "Compare gift options for [recipient interests, budget, delivery deadline] from sellers in the selected country. Do not buy anything.",
    "cat": "Everyday"
  },
  {
    "id": "document-checklist",
    "title": "Create a document checklist",
    "prompt": "From the official rules for [process], make a checklist and show the source for each requirement.",
    "cat": "Everyday"
  },
  {
    "id": "repair-options",
    "title": "Compare repair options",
    "prompt": "For [item and issue], compare safe troubleshooting, official repair and replacement. Do not suggest hazardous repairs.",
    "cat": "Everyday"
  },
  {
    "id": "calendar-review",
    "title": "Review a week",
    "prompt": "From [calendar export or an authorized connection], identify conflicts and open blocks. Propose changes without making them.",
    "cat": "Everyday"
  },
  {
    "id": "writing-tone",
    "title": "Adjust the tone",
    "prompt": "Rewrite [text] in [tone] while preserving its meaning and all commitments. Do not add promises.",
    "cat": "Everyday"
  }
];

let _taskSearch='', _taskMode='all', _taskPage=0;
function _taskCatalog(){
  const title={email:'Write an email',emailreply:'Reply to an email',text:'Write a text',trip:'Plan a trip',meal:'Plan meals',fitness:'Plan exercise',essay:'Develop an essay',homework:'Work through homework',study:'Create study notes',flashcards:'Create flashcards',summarize:'Summarize a document',explain:'Explain a concept',resume:'Improve a resume',coverletter:'Draft a cover letter',linkedin:'Improve a profile',bizplan:'Explore a business idea',proposal:'Draft a proposal',meeting:'Summarize meeting notes',social:'Draft social posts',script:'Write a script',story:'Write a story',code:'Build a feature',debug:'Debug code',api:'Design an API',budget:'Build a budget',invest:'Explore investment questions',contract:'Explain contract terms',excel:'Analyze data',pptx:'Create a presentation',word:'Draft a document',compare:'Compare products',lookup:'Research with sources',cook:'Cook from ingredients',edit:'Improve writing',translate:'Translate text',shopping:'Make a shopping list'};
  const base=Object.keys(TASKS).map(id=>({id:'chat:'+id,title:title[id]||id,prompt:TASKS[id],cat:'Chat',mode:'chat'}));
  const extra=AMV_TASK_EXTRA.map(t=>({...t,id:'extra:'+t.id,mode:'chat'}));
  let jobs=[];try{jobs=_cwCountryHundred(_cwCountryGuess())||[];}catch(e){}
  const seen=new Set();
  return base.concat(extra,jobs.filter(j=>j&&j.id&&!seen.has(j.id)&&seen.add(j.id)).map(j=>({id:'crew:'+j.id,title:j.title,desc:j.desc,cat:j.cat||'Crew',mode:'crew',jobId:j.id})));
}
function renderTasksView(){
  const vc=$('vc');if(!vc)return;
  const list=_taskCatalog();
  vc.innerHTML='<div class="sv fi"><div class="vi task-hub"><header class="product-header"><span class="eyebrow">Start with an outcome</span><h2>Tasks</h2><p>Choose a task for chat, or set up recurring work with Crew. Review the instruction before anything runs.</p></header>'+_productCountryHTML('tasks-country')+
    '<div class="task-controls"><label class="task-search">Find a task<input class="inp" id="task-search" type="search" value="'+escH(_taskSearch)+'" placeholder="Email, bills, assignments, research..."></label><label>Run with<select class="inp" id="task-mode"><option value="all">Chat and Crew</option><option value="chat">Chat</option><option value="crew">Crew</option></select></label></div>'+
    '<div id="task-count" class="product-note" role="status"></div><div id="task-results" class="task-grid"></div><div id="task-pages" class="task-pages"></div><p class="product-note">These are task templates, not a national usage ranking. Regional examples do not mean a site offers an API or that AMV can buy from it.</p></div></div>';
  $('task-mode').value=_taskMode;
  const paint=()=>{
    const q=_taskSearch.toLocaleLowerCase().trim();
    const found=list.filter(t=>(_taskMode==='all'||t.mode===_taskMode)&&(!q||(t.title+' '+(t.desc||t.prompt)+' '+t.cat).toLocaleLowerCase().includes(q)));
    const pages=Math.max(1,Math.ceil(found.length/24));_taskPage=Math.min(_taskPage,pages-1);
    $('task-count').textContent=found.length+' matching tasks'+(_productCountryName()?' for '+_productCountryName():'')+' / '+list.length+' templates in this view';
    $('task-results').innerHTML=found.slice(_taskPage*24,(_taskPage+1)*24).map(t=>'<button class="task-card" data-task-id="'+escH(t.id)+'"><span class="task-mode">'+(t.mode==='crew'?'CREW / RECURRING':'CHAT / ONE TASK')+'</span><strong>'+escH(t.title)+'</strong><span class="task-desc">'+escH(t.desc||(t.prompt.split('\n')[0]))+'</span><span class="task-open">'+(t.mode==='crew'?'Choose schedule':'Open in chat')+' &rarr;</span></button>').join('')||'<p>No matching templates. Try a shorter search or describe the task in chat.</p>';
    $('task-pages').innerHTML='<button class="btn bs" id="task-prev" '+(!_taskPage?'disabled':'')+'>Previous</button><span>Page '+(_taskPage+1)+' of '+pages+'</span><button class="btn bs" id="task-next" '+(_taskPage>=pages-1?'disabled':'')+'>Next</button>';
    on($('task-prev'),'click',()=>{_taskPage--;paint();});on($('task-next'),'click',()=>{_taskPage++;paint();});
  };
  on($('task-search'),'input',e=>{_taskSearch=e.target.value;_taskPage=0;paint();});
  on($('task-mode'),'change',e=>{_taskMode=e.target.value;_taskPage=0;paint();});
  on($('tasks-country'),'change',e=>{if(!e.target.value)return;_cwSetCountry(e.target.value);_taskPage=0;renderTasksView();});
  on($('task-results'),'click',e=>{
    const b=e.target.closest('[data-task-id]');if(!b)return;
    const t=list.find(t=>t.id===b.dataset.taskId);if(!t)return;
    if(t.mode==='crew'){cwPeek(t.jobId);return;}
    const country=_productCountryName();setTab('chat');
    requestAnimationFrame(()=>{const ta=$('mta');if(!ta)return;ta.value=t.prompt+(country?'\n\nCountry context: '+country+'. Verify local sources where relevant; do not assume a provider is supported.':'');fitChatComposer(ta);ta.focus();const a=ta.value.indexOf('[');if(a>=0)ta.setSelectionRange(a,ta.value.indexOf(']',a)+1);});
  });
  paint();
  if(typeof _cwCatalog==='function'&&!_cwCatalog())_loadCrewData().then(ok=>{if(ok&&S.tab==='tasks')renderTasksView();});
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
let _taskCat=null;

function _connSectionHTML(){
  try{ setTimeout(()=>_connLoad(false), 0); }catch(e){}
  return '<section class="conn-sec" id="conn-sec">'+
    '<div class="sec-head"><h3>'+escH(T('Connected accounts'))+'</h3>'+
      '<span class="sec-sub">'+escH(T('Accounts AMV holds a key to, so Crew jobs keep running with this tab closed. Every one shows what it may do and which job used it last.'))+'</span></div>'+
    '<div id="conn-body" class="conn-body">'+_connBodyHTML()+'</div>'+
  '</section>';
}
/* ── POPULAR WHERE YOU ARE ─────────────────────────────────────────────────

   Asked for: what people in each country actually use, on this page, so they
   can connect it. One card near the top that is always there - so nothing
   arrives late and pushes the page down - and a dialog that lists, for the
   country, three honest kinds of thing:

     · what AMV really connects there (that country's own mailboxes; the bank
       where bank sign-in exists), with Connect;
     · what AMV already uses there WITHOUT a sign-in (its job sites, shops,
       trains, official pages), with the Crew jobs that use them;
     · what cannot be connected yet (a bank outside the US), with Notify me.

   A bank in Spain gets Notify me and a sentence saying why, never a Connect
   that goes nowhere: a button that looks like it links your money and does not
   is the most expensive kind of wrong on this page. */
function _intLocalBannerHTML(){
  let cc = '', row = null, pending = false;
  try{ pending = _cwHerePending(); cc = pending ? '' : _cwCountryGuess(); row = _cwCountryRow(cc); }catch(e){}
  try{ setTimeout(() => { Promise.resolve(_cwAskWhere()).then(_intLocalFill, _intLocalFill); }, 0); }catch(e){}
  return '<button class="int-local" id="int-local" data-dact="openLocalConnect">'+
    '<span class="int-local-flag" id="int-local-flag" aria-hidden="true">'+(row ? row[2] : '\uD83C\uDF0D')+'</span>'+
    '<span class="int-local-b"><span class="int-local-t" id="int-local-t">'+
      escH(row ? _cwSayPlace('Popular in {country}', row[1]) : T('Popular where you are'))+'</span>'+
      '<span class="int-local-s">'+escH(T('The mail, banks, job sites and shops people there use - and what AMV does with each.'))+'</span></span>'+
    '<span class="int-local-go">'+escH(T('See them'))+
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>'+
  '</button>';
}
/* The card's words change in place when the country is known; its size does
   not, so the page under it never moves. */
function _intLocalFill(){
  try{
    const t = $('int-local-t'), f = $('int-local-flag'); if(!t) return;
    const row = _cwCountryRow(_cwCountryGuess());
    const words = row ? _cwSayPlace('Popular in {country}', row[1]) : T('Popular where you are');
    if(t.textContent !== words) t.textContent = words;
    if(f && row && f.textContent !== row[2]) f.textContent = row[2];
  }catch(e){}
}
/* Which Crew search each fact leads to - words that really occur in the jobs
   that use it, so "See the jobs" never lands on "no matches". */
const INT_LOCAL_USES = [
  { keys:['jobs'], t:'Job sites', d:'AMV searches these for roles that fit you and prepares each application. Nothing to sign in to.', find:'job' },
  { keys:['shop','groc'], t:'Shops and supermarkets', d:'AMV watches their public prices for your deals, price drops and weekly shop.', find:'price' },
  { keys:['food'], t:'Food delivery', d:'AMV compares what is open and what it costs. You place the order.', find:'table' },
  { keys:['rail'], t:'Trains', d:'AMV checks live times and disruption before your trips.', find:'trip' },
  { keys:['prop'], t:'Property', d:'AMV watches new listings and rents where you want to live.', find:'property' },
  { keys:['post'], t:'Post and parcels', d:'AMV tracks what is coming and what is late.', find:'parcel' },
  { keys:['telco'], t:'Mobile networks', d:'AMV compares plans when your contract is up and flags a bill that jumped.', find:'bill' },
  { keys:['tax','gov','id','car'], t:'Government and official', d:'AMV reads the official pages for deadlines, fees and rules and reminds you in time. It never signs in, pays or files anything for you.', find:'renew' },
  { keys:['health'], t:'Health', d:'Appointments, prescriptions and check-ups, tracked so nobody misses one.', find:'appointment' },
  { keys:['exams','uni'], t:'School and university', d:'Exam dates and application deadlines, tracked for you.', find:'school' },
  { keys:['news','weather'], t:'News and weather', d:'What your morning briefing reads.', find:'brief' },
];
function _intLocalRow(o){
  return '<div class="int-card'+(o.notify?' int-notify':'')+'">'+
    '<div class="int-ic">'+_appMarkHTML(o.mark||o.name)+'</div>'+
    '<div class="int-body"><div class="int-top"><span class="int-name">'+escH(o.name)+'</span>'+
      (o.connected?'<span class="int-ok">\u2713 '+escH(T('Connected'))+'</span>':'')+'</div>'+
      (o.names?'<div class="int-local-names">'+escH(o.names)+'</div>':'')+
      '<div class="int-desc">'+escH(o.desc)+'</div></div>'+
    '<div class="int-act">'+o.act+'</div></div>';
}
function _intLocalBody(cc, d){
  const row = _cwCountryRow(cc), name = row ? row[1] : (d && d.name) || cc;
  const f = (d && d.facts && typeof d.facts === 'object') ? d.facts : {};
  /* Provider examples from the country catalog, not a measured popularity ranking.
     Each connection still requires deployment support and the relevant scopes. */
  const mail = Array.isArray(d && d.inbox) && d.inbox.length ? d.inbox
             : (Array.isArray(d && d.mail) ? d.mail.map(m => ({ id:m.id, name:m.name, how:'mail:' + m.id })) : []);
  const acc = _mailConnectedAccount(), notified = _appNotifiedSet();
  const btn = (attrs, label, cls) => '<button class="btn '+(cls||'bp')+'" '+attrs+' style="font-size:var(--t-sm)">'+escH(label)+'</button>';
  /* CONNECT: only what really connects. */
  const connect = mail.map(m => {
    const grant = m.how === 'g' ? 'google' : m.how === 'ms' ? 'outlook' : '';
    const on = grant ? _rowConnected(grant) : (!!acc && acc.provider === m.id);
    return _intLocalRow({ name:m.name, connected:on,
      desc: grant ? T('Read, summarized and answered. Sign in at the provider; you choose what AMV may do.')
          : on ? T('Connected. AMV reads it, summarizes it and drafts replies.') : T('Read, summarized and answered. Connects with an app password.'),
      act: grant ? (on ? '' : btn('data-lc-grant="'+grant+'"', T('Connect')))
         : on ? btn('data-lc-inbox="1"', T('Open inbox'), 'bs') : btn('data-lc-mail="'+escH(m.id)+'"', T('Connect')) });
  });
  /* The calendar that goes with the mailbox people there use, and school
     where schools run on Google Classroom - the same connections the top ten
     in Crew is built on, so the two screens never disagree about a country. */
  const m1 = mail[0];
  if(m1 && (m1.how === 'g' || m1.how === 'ms')){
    const grant = m1.how === 'g' ? 'google' : 'outlook', calName = m1.how === 'g' ? 'Google Calendar' : 'Outlook Calendar';
    const on = _rowConnected(grant);
    connect.push(_intLocalRow({ name:calName, connected:on,
      desc:T('Your week, read - never changed. Comes with the same sign-in as your mail.'),
      act: on ? '' : btn('data-lc-grant="'+grant+'"', T('Connect')) }));
  }
  if(d && d.classroom){
    const on = _rowConnected('google');
    connect.push(_intLocalRow({ name:'Google Classroom', connected:on,
      desc:T('What is due and what is late, read-only - AMV cannot hand anything in.'),
      act: on ? '' : btn('data-lc-grant="google"', T('Connect')) }));
  }
  /* A bank wherever this deployment may link one (FINANCE_COUNTRIES on the
     server), not only in the US - linked at the bank, read-only. */
  if(d && d.bank){
    const linked = (function(){ try{ return typeof AMVFinance!=='undefined' && AMVFinance.linked(); }catch(e){ return false; } })();
    connect.push(_intLocalRow({ name:T('Your bank'), names:[f.cards, f.banks].filter(Boolean).join(' · '), connected:linked,
      desc:T('Balances and transactions for your money jobs, through your bank’s own sign-in. AMV never sees your password and cannot move money.'),
      act: btn('data-lc-bank="1"', linked ? T('Manage in Spending') : T('Link in Spending'), linked ? 'bs' : 'bp') }));
  }
  /* WORKS NOW, NO SIGN-IN. */
  const uses = INT_LOCAL_USES.map(u => {
    const names = u.keys.map(k => String(f[k] || '')).filter(Boolean).join(' · ');
    if(!names) return '';
    return _intLocalRow({ name:T(u.t), names, desc:T(u.d), act: btn('data-lc-find="'+escH(u.find)+'"', T('See the jobs'), 'bs') });
  }).filter(Boolean);
  /* NOT YET: said, with the one honest action. */
  const later = [];
  if(!(d && d.bank) && (f.banks || f.pay)){
    const slug = 'bank-' + cc.toLowerCase(), label = T('Bank sign-in in')+' '+name;
    const needs = d && d.bankElsewhere ? ' ' + T('It needs') + ' ' + d.bankElsewhere + '.' : '';
    later.push(_intLocalRow({ name:label, mark:'B', names:[f.banks, f.pay].filter(Boolean).join(' · '), notify:true,
      desc:T('Not available in')+' '+name+' '+T('yet, so nothing here pretends to link it.')+needs+' '+T('Money jobs work from the bills in your mailbox meanwhile.'),
      act: notified.has(slug) ? '<span class="int-onlist">\u2713 '+escH(T('On the list'))+'</span>'
                              : btn('data-app-notify="'+escH(slug)+'" data-app-name="'+escH(label)+'"', T('Notify me'), 'bs') }));
  }
  const sec = (h, rows) => rows.length ? '<div class="ss2"><h3>'+escH(h)+'</h3><div class="int-list">'+rows.join('')+'</div></div>' : '';
  const opts = CW_WORLD_COUNTRIES.slice().sort((a, b) => a[1].localeCompare(b[1]))
    .map(c => '<option value="'+escH(c[0])+'"'+(c[0]===cc?' selected':'')+'>'+escH(c[1])+'</option>').join('');
  return '<label class="ml-f cv-find"><span>'+escH(T('Country'))+'</span><select id="lc-c">'+opts+'</select></label>'+
    sec(T('Connect in')+' '+name, connect)+
    sec(T('Already works in')+' '+name+' - '+T('no sign-in'), uses)+
    sec(T('Not yet'), later)+
    (connect.length || uses.length ? '' : '<p class="mu">'+escH(T('Nothing is written down for')+' '+name+' '+T('yet. Every job still runs there.'))+'</p>')+
    '<p class="cw-anything">'+escH(T('Every Crew job answers for')+' '+name+' '+T('- its sites, prices and rules. None of this is the limit: type anything in the Crew box and AMV works out what it needs.'))+'</p>';
}
async function openLocalConnect(code){
  const r = $('ovr'); if(!r) return;
  let cc = String(code || '').toUpperCase();
  if(!_cwCountryRow(cc)) cc = _cwCountryGuess() || 'US';
  const row = _cwCountryRow(cc);
  r.innerHTML = _ovShell({ id:'lc', wide:true, eyebrow:T('Where you are'),
                           title:row ? _cwSayPlace('Popular in {country}', row[1]) : T('Popular in')+' '+cc,
                           body:'<p class="mu">'+escH(T('Loading\u2026'))+'</p>' });
  _ovWire('lc');
  let d = null;
  if(window.AMV_API && AMV_API.live){ try{ d = await AMV_API.everyday(cc); }catch(e){ d = null; } }
  const b = $('lc-body'); if(!b) return;
  if(!d || typeof d !== 'object'){
    b.innerHTML = '<div class="ml-err">'+escH(_cwSayPlace('AMV’s servers cannot be reached right now, so the list for {country} cannot be shown. Try again in a moment.', row ? row[1] : cc))+'</div>';
    return;
  }
  try{ if(d.facts && typeof d.facts === 'object') _cwFacts[cc] = d.facts; }catch(e){}
  b.innerHTML = _intLocalBody(cc, d);
  const h = $('lc-h'); if(h && row) h.textContent = _cwSayPlace('Popular in {country}', row[1]);
  on($('lc-c'), 'change', e => { openLocalConnect(e.target.value); });
  b.querySelectorAll('[data-lc-mail]').forEach(x => on(x, 'click', () => {
    if(_intNeedsAccount(_intName('mail'))) return;
    r.innerHTML = ''; openMailConnect(x.dataset.lcMail);
  }));
  b.querySelectorAll('[data-lc-inbox]').forEach(x => on(x, 'click', () => { r.innerHTML = ''; openMailInbox(); }));
  b.querySelectorAll('[data-lc-grant]').forEach(x => on(x, 'click', () => {
    if(_intNeedsAccount(_intName(x.dataset.lcGrant))) return;
    r.innerHTML = ''; _connGoTo(x.dataset.lcGrant);
  }));
  b.querySelectorAll('[data-lc-bank]').forEach(x => on(x, 'click', () => {
    r.innerHTML = '';
    try{ setTab('spend'); }catch(e){}
    try{ toast('Linking a bank happens here, on your bank\u2019s own sign-in page. AMV never sees your password.','info',6000); }catch(e){}
  }));
  b.querySelectorAll('[data-lc-find]').forEach(x => on(x, 'click', () => {
    r.innerHTML = '';
    /* Set before the tab opens, so Crew draws once, already searched. */
    try{ _cwFind = String(x.dataset.lcFind || ''); }catch(e){}
    setTab('crew');
  }));
  b.querySelectorAll('[data-app-notify]').forEach(x => on(x, 'click', () => { _appNotify(x); }));
}
try{ window.openLocalConnect = openLocalConnect; window._intLocalBody = _intLocalBody; }catch(e){}

function renderIntegrationsView(){
  const vc=$('vc'); if(!vc) return;
  /* SEE ALL OPENS A PAGE, NOT A LONGER SCROLL.

     The first version rendered the full directory in place, under the
     connected accounts, the machine panel and the whole native catalogue - so
     pressing See all left you looking at exactly what you had been looking at,
     with more of it somewhere below. What was asked for was a page, and a page
     is a screen with one thing on it and a way back. */
  if(typeof _cdirOpenNow === 'function' && _cdirOpenNow()){
    /* The search comes with you. A topic page with no way to search from it
       meant going back to the overview first, which is two steps to do the one
       thing this screen exists for - and it is also where somebody lands after
       searching, so the box they just used would have vanished. */
    vc.innerHTML = '<div class="sv fi"><div class="vi vi-conn">'
      + ((typeof cdirSearchBarHTML === 'function') ? cdirSearchBarHTML() : '')
      + connectorDirectoryHTML() + '</div></div>';
    try{ _cdirWireFind&&_cdirWireFind(); }catch(e){}
    return;
  }
  vc.innerHTML=
    '<div class="sv fi"><div class="vi vi-conn">'+
      /* ONE NAME FOR ONE THING. This screen said "Integrations" while the
         Settings pane showing the same catalogue said "Connectors", so the
         product had two words for the thing somebody is looking for - which
         is how you fail to find it. Connectors, in both places.

         The copy also predated Connected accounts. "Click Connect, you
         approve in a popup, no keys to paste" was true of the old per-service
         buttons; what matters now, and what somebody deciding whether to hand
         over a mailbox actually wants to know, is that the grant is scoped,
         held by the server rather than this browser, and revocable. */
      '<span class="eyebrow">Connectors</span>'+
      '<h2>Connections</h2>'+
      /* Counted, not claimed: the number is the length of the list below. */
      /* ONLY WHAT IS BACKED. This said "of the apps people use most", and no
         usage data or survey stands behind that ranking - the list is curated.
         What IS measured is said instead: the sign-ins are checked against
         each provider every day (tools/connector-health.mjs, run daily by the
         connectors workflow), and every Notify me is recorded on the server
         (/waitlist, one entry per app). */
      '<p class="vsub">Choose a country, connect supported accounts, and see exactly what access you have granted. Directory listings are not proof of regional availability or permission to act.</p>'+
      /* THE SEARCH FIRST, AND OUTSIDE THE DIRECTORY.

         Asked for in that order - "it has to be search bar, then the main
         ones" - and it is also the fix for "the search bar is very laggy".
         It used to be rendered by connectorDirectoryHTML, inside the `.cdir`
         node that `_cdirPaint` replaces wholesale, so the element somebody was
         typing into was destroyed and rebuilt under them while the topic rows
         filled in. Up here it belongs to this view, and nothing the directory
         repaints can reach it. See cdirSearchBarHTML. */
      ((typeof cdirSearchBarHTML === 'function') ? cdirSearchBarHTML() : '')+
      _productCountryHTML('connections-country')+
      '<section class="regional-connections" id="regional-connections" aria-live="polite"></section>'+
      _connSectionHTML()+
      /* THE SETUP, FOLDED AWAY UNTIL IT IS WANTED.

         The bridge card and the connector form are two of the largest blocks
         in this product and they used to open this page - above the catalogue,
         inside a section called "Email & calendar" that they have nothing to
         do with. So the first thing somebody saw when they came looking for
         what AMV connects to was a download button and a command line.

         They are not moved or reduced; they are closed. Anybody who needs them
         is looking for them, and anybody browsing is not. */
      '<details class="conn-machine"'+(_connMachineOpen?' open':'')+'>'+
        '<summary><span class="conn-machine-t">Your computer</span>'+
          '<span class="conn-machine-s">'+
            ((typeof BRIDGE!=='undefined' && BRIDGE.cloud && BRIDGE.connected)
              ? 'AMV\u2019s cloud workspace \u00b7 commands and files; connectors need your own computer'
              : (typeof BRIDGE!=='undefined' && BRIDGE.connected)
              ? 'Connected \u00b7 AMV can run connectors and work in your files'
              : 'Optional · needed only for local computer connectors')+
          '</span></summary>'+
        '<div class="conn-machine-b">'+_bridgeCardHTML()+_neverRunHTML()+_mcpCardHTML()+'</div>'+
      '</details>'+
      '<details class="global-app-catalog"><summary>Browse all app categories <span>Availability must be checked for your country</span></summary><div id="int-catalog">'+_integrationsCatalogHTML()+'</div></details>'+
      /* NOTHING AFTER THE TOPICS. There used to be a last section called
         "Everything else, by topic" - a wall of doors into the open registry.
         Asked for: "no part should say everything else by topic, it should
         stay consistent". Every topic above now ends in its own door to the
         same registry, and the search box at the top reaches all of it. */
    '</div></div>';
  _wireIntegrationCatalog(vc);
  on($('connections-country'),'change',e=>{_cwSetCountry(e.target.value);renderIntegrationsView();});
  _paintRegionalConnections($('regional-connections'));
  try{
    const d=vc.querySelector('details.conn-machine');
    if(d) on(d,'toggle',()=>{ _connMachineOpen = !!d.open; });
  }catch(e){}
  /* Enter searches, because a search box that only responds to a button is a
     search box somebody presses Enter on and thinks is broken. Through the
     directory's own wiring, so the keystroke listener and the one that keeps
     the typed value are attached in one place rather than two. */
  try{ _cdirWireFind&&_cdirWireFind(); }catch(e){}
  try{ _killTokenAutofill&&_killTokenAutofill(); }catch(e){}
  /* Which apps this account has signed in to. Asked once per situation; the
     page repaints only if the answer changed what it shows. */
  try{ if(typeof _rmcpLoad==='function') setTimeout(()=>{ _rmcpLoad(false).then(ch=>{ if(ch) _paintIntegrations(); }); }, 0); }catch(e){}
}
window.renderIntegrationsView=renderIntegrationsView;
function _bgAddGmailCheck(){ _bgAddTask({type:'gmail_check',title:'Check Gmail inbox'}); }
function _bgAddCalendarCheck(){ _bgAddTask({type:'calendar_check',title:'Optimize my week'}); }
function _toastResultCopied(){ toast('Result copied','success'); }

window.amvOpenFile=amvOpenFile;
function _bgAddTask(task){
  const t={id:'bg'+Date.now(),status:'queued',created:Date.now(),progress:0,...task};
  _bgQueue.tasks.push(t);
  toast('Task queued - running in background','info',3000);
  _bgRunNext();
  return t;
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
      h+='<div style="display:flex;gap:6px;margin-top:8px"><button class="btn bs" data-dact="_toastResultCopied">Copy result</button></div>';
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
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><h3 style="margin:0">Task Queue</h3><button class="btn bs" data-dact="renderAutomationView">Refresh</button></div>
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
  if(it.done) return 'ran once' + (it.doneAt ? ' · ' + _dayLabel(it.doneAt) : '');
  const every = { hourly:'every hour', daily:'every day', weekly:'every week', once:'once',
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
    /* A job the quiet-hours window pushed back. Said in its own words rather
       than through `lastError`, which this row prefixes with "Last run:" - a
       job that was held did not have a run, and calling a deferral the outcome
       of one is how a row starts lying in small ways. */
    const held = (it.heldUntil && it.heldUntil > Date.now())
      ? '<div class="asrv-held">Held until your quiet hours end</div>' : '';
    /* Running, and deliberately not emailing, because this job kept saying the
       same thing and the person accepted "only when it changes". Said out loud
       for the same reason as the line above: a job that stopped working must
       never look like a job with nothing new to report. */
    const same = it.quietSince
      ? '<div class="asrv-held">Same answer since ' + escH(_dayLabel(it.quietSince))
        + ' \u00b7 in AMV, not your inbox</div>' : '';
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
      + held
      + same
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
      +'</div>'
      /* THE TWO BUTTONS, AND WHY THEY ARE NOT ANALYTICS.

         They buy the person something. A run of "not worth it" earns an offer
         to stop emailing this job, or to pause it if it was never emailing -
         and a run of "worth it" on a job AMV has been holding back earns an
         offer to undo that. A button whose only effect is a number on somebody
         else's dashboard costs a tap and gives nothing back.

         The answer is shown, not just taken, and it can be changed: a first tap
         that cannot be corrected is a trap, and people are allowed to change
         their minds. */
      +'<div class="asrv-feel">'
      +'<span class="asrv-feel-q">Worth telling you about?</span>'
      +'<button class="btn bs asrv-feel-b'+(r.feel==='up'?' on':'')+'" data-feel="up" data-feel-id="'+escH(String(r.id||''))+'"'
      +(r.feel==='up'?' aria-pressed="true"':' aria-pressed="false"')+'>Yes</button>'
      +'<button class="btn bs asrv-feel-b'+(r.feel==='down'?' on':'')+'" data-feel="down" data-feel-id="'+escH(String(r.id||''))+'"'
      +(r.feel==='down'?' aria-pressed="true"':' aria-pressed="false"')+'>Not really</button>'
      +'</div>'
      +'</div>';
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
  /* One answer per result, posted where it is given. The pair shows the answer
     immediately so the tap is acknowledged before the round trip, and the whole
     view IS redrawn afterwards - an answer can earn an offer, and an offer
     somebody has to reload to find is one they never see.

     A failure says so and puts both buttons back the way they were, because a
     tap that silently did nothing is worse than one that says it could not.
     `aria-pressed` moves with the class: a screen reader announcing the old
     answer while the screen shows the new one is the same defect, for the
     person least able to check. */
  root.querySelectorAll('[data-feel]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const said = b.dataset.feel, id = b.dataset.feelId;
      if(!id) return;
      const row = b.parentNode;
      const pair = row ? [...row.querySelectorAll('[data-feel]')] : [];
      const was = pair.map(x=>({ cls:x.className, pressed:x.getAttribute('aria-pressed') }));
      pair.forEach(x=>{
        x.disabled = true;
        x.classList.toggle('on', x === b);
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      });
      try{
        await _autoApi('/auto/update', { action:'feel', result:id, said });
        try{ await _autoRefresh(); }catch(e){}
        try{ renderTasksView(); }catch(e){}
      }catch(e){
        pair.forEach((x,i)=>{
          x.disabled = false;
          if(was[i]){
            x.className = was[i].cls;
            if(was[i].pressed === null) x.removeAttribute('aria-pressed');
            else x.setAttribute('aria-pressed', was[i].pressed);
          }
        });
        if(typeof toast==='function')
          toast('AMV could not record that: '+((e&&e.message)||'try again'),'error',4500);
      }
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
          if(!await _askDestructive('Delete this scheduled job?',
              'It stops running straight away and is not kept. You can create it again later.',
              'Delete job')){ b.disabled=false; return; }
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
try{ window._bgAddGmailCheck=_bgAddGmailCheck; window._bgAddCalendarCheck=_bgAddCalendarCheck; window._toastResultCopied=_toastResultCopied; }catch(e){}

/* Here once: the page's loader reads this before fetching again. */
try{ window._intViewHere = true; }catch(e){}

async function _paintRegionalConnections(host){
  if(!host)return;
  const code=typeof _cwCountryGuess==='function'?_cwCountryGuess():'';
  if(!code){host.innerHTML='<p class="product-note">Choose a country to load regional examples. Existing connections remain visible below.</p>';return;}
  host.innerHTML='<p class="product-note" role="status">Checking regional connection options...</p>';
  try{
    if(!AMV_API.live)throw new Error('Backend unavailable');
    const data=await AMV_API.everyday(code);
    // A late response for another country must never overwrite this screen.
    if(!host.isConnected || _cwCountryGuess()!==code)return;
    if(!data||typeof data!=='object'||data.error)throw new Error('No regional data');
    host.innerHTML='<h3>For '+escH(_productCountryName())+'</h3><p class="product-note">Regional examples, not a popularity ranking. Sign-in availability is checked when you connect. A website listing is not permission to buy or submit.</p>'+_intLocalBody(code,data);
    const pick=host.querySelector('#lc-c');if(pick){pick.closest('label')?.remove();if(pick.isConnected)pick.remove();}
    host.querySelectorAll('[data-lc-grant]').forEach(b=>on(b,'click',()=>{if(!_intNeedsAccount(_intName(b.dataset.lcGrant)))_connGoTo(b.dataset.lcGrant);}));
    host.querySelectorAll('[data-lc-mail]').forEach(b=>on(b,'click',()=>{if(!_intNeedsAccount(_intName('mail')))openMailConnect(b.dataset.lcMail);}));
    host.querySelectorAll('[data-lc-inbox]').forEach(b=>on(b,'click',openMailInbox));
    host.querySelectorAll('[data-lc-bank]').forEach(b=>on(b,'click',()=>setTab('spend')));
    host.querySelectorAll('[data-lc-find]').forEach(b=>on(b,'click',()=>{_cwFind=String(b.dataset.lcFind||'');setTab('crew');}));
    host.querySelectorAll('[data-app-notify]').forEach(b=>on(b,'click',()=>_appNotify(b)));
  }catch(e){
    if(!host.isConnected||_cwCountryGuess()!==code)return;
    host.innerHTML='<h3>For '+escH(_productCountryName())+'</h3><p class="product-note">Regional availability could not be verified. No connection is being claimed here. Your existing accounts and the clearly marked general catalog remain below.</p><button class="btn bs" id="regional-retry">Retry</button>';
    on(host.querySelector('#regional-retry'),'click',()=>_paintRegionalConnections(host));
  }
}
