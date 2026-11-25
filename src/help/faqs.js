/* THE HELP CENTER'S QUESTIONS AND ANSWERS - fetched the first time Help is
   opened (_faqsLoad in 12a-view-router-help.js). About ten kilobytes of prose
   most visits never read, so it does not ride in the page. A classic script:
   it uses the page's own plan figures (PLANS, _msgMonthLabel...) as it loads,
   so the answers always quote the numbers the server enforces. */
const FAQS=[
  {c:'start', q:'How do I start with AMV?', a:'Click “New chat” at the top of the sidebar and type anything - an essay, code, a 3D model, deep research, or a question about a photo you upload. AMV figures out what you need and does the work. On mobile, tap the menu icon for the full sidebar.'},
  {c:'start', q:'Where are Settings, Team and my account?', a:'Click your avatar at the top right. That one menu has Upgrade, Manage Subscription, Settings, Team, Help, What\u2019s New and the ways to sign out. Settings opens in the middle of the screen over whatever you were doing - search at the top of its list finds a setting by what it does (try \u201cpassword\u201d or \u201clanguage\u201d), and X or Esc puts you back where you were.'},
  {c:'chat', q:'What are the buttons under an answer?', a:'Thumbs up or down tell AMV how it did. Copy puts the answer on your clipboard, Read aloud speaks it, and Share sends the text through your device\u2019s share sheet - no link to your chat is made. The three dots hold Download (Word, Excel or PowerPoint), Branch from here and React.'},
  {c:'auto', q:'How do I choose when a Crew job runs?', a:'Open the job. If it runs on AMV\u2019s servers, pick every day, week or month and a time - it uses your time zone, and exactly that is what the server runs. A job that needs something only this browser has runs while AMV is open, and the panel says so.'},
  {c:'billing', q:'Can AMV buy things for me?', a:'Yes, in AMV\u2019s browser on your computer, where you are signed in to the store yourself. Ask in chat - for example \u201cbuy this kettle on Amazon\u201d. AMV asks once to shop on that store, then searches, fills your cart and gets the checkout ready. It cannot press the pay or place-order button on its own: it shows you the item, the store and the total read from the store\u2019s own page, and you tap Buy. The amount is held against your Spending limits first - spending must be on, and within your single-purchase and monthly limits, in your limits\u2019 currency - and AMV reads the order number and total back from the confirmation page. The store charges the payment you saved there; AMV never sees your card.'},
  {c:'start', q:'What can AMV actually do?', a:'One place for everything: chat and deep research, reading the files and images you upload, interactive 3D, a design canvas (Studio), an app builder (Dev), and autonomous agents (Crew) that complete multi-step work for you and bring back a finished result to approve. AMV reads an image you give it; it does not generate one.'},
  {c:'auto', q:'What is Crew and Mission Control?', a:'Crew is AMV working autonomously in the background. Mission Control (the Crew tab) is your overview of everything it’s doing - what needs your approval, what’s running now, what’s scheduled, and what’s finished. Give it an outcome and it plans the steps, does the work, and stops before anything consequential to wait for you.'},
  {c:'auto', q:'How do approvals work - Preview &amp; Approve?', a:'When AMV finishes something that would send, publish, or change anything, it waits in “Needs your approval.” Press Preview to open the full workspace: the finished result, a timeline of what happened, the agents involved, and a plain-language summary of exactly what will happen. Then Approve, Edit, or Reject.'},
  {c:'auto', q:'What is Auto Approve?', a:'Crew settings set how far AMV may go on its own: <b>Suggest only</b> (it tells you a job is due and does not run it), <b>Ask me first</b> (it does the work, then waits - nothing is sent, posted or acted on until you approve), or <b>Let it run</b> (it delivers the result on its own). Even then, a run nobody is watching only produces text: it never sends, buys or posts without you. When you have said yes to a job every time, AMV may offer to let that job deliver without asking, and you can change it back on its row. <b>Pause all</b> on Crew stops everything.'},
  {c:'auto', q:'How do I schedule recurring autonomous work?', a:'Open Crew and tell AMV what to do and when - for example “every weekday at 8, summarize my unread email.” AMV asks only what it still needs, then sets the job up. You can also switch on any job in the list and choose its schedule. Everything switched on is under <b>Running jobs</b>; <b>Manage</b> shows each job’s next run and lets you change its schedule, pause it or cancel it. On Pro and above, jobs run on AMV’s servers, so they carry on with AMV closed.'},
  {c:'create', q:'How do I create interactive 3D models?', a:'Just ask in chat - e.g. “create a 3D model of a human heart.” It renders live with drag-to-rotate, scroll-to-zoom, and pan controls.'},
  {c:'create', q:'What is Studio (AMV Design)?', a:'Studio is a live design canvas. Describe a landing page, UI mockup, poster, or graphic and watch it build, then refine by chatting (“make it darker,” “add a pricing section”). Set a reusable Design DNA once and everything follows your colors, fonts, and style.'},
  {c:'build', q:'Can AMV build and run real apps?', a:'Yes - Dev writes the code, runs it in a live sandbox, and shows you the result. Lab lets you paste or upload existing code (any size) to run, find and fix bugs, review, refactor, or add tests. On higher plans you can deploy to a live URL.'},
  {c:'chat', q:'How do I upload files for analysis?', a:'Click the paperclip in the chat input or drag &amp; drop. AMV reads PDFs, pictures, Word, Excel, PowerPoint, CSV and code. An older .doc, .xls or .ppt needs saving in the newer format first, and audio and video are not read. It can also work across a whole folder for autonomous tasks.'},
  {c:'connect', q:'How do I connect Gmail, Calendar, and files?', a:'Go to Settings → Connectors (or Integrations). Connect Google to let AMV read email, manage your calendar, and work with Drive files. Everything an agent wants to send still waits for your approval first.'},
  {c:'connect', q:'What is Handoff?', a:'Handoff lets you pass a task - with its full context - to a teammate inside AMV, or receive one from them, so work moves between people without losing the thread.'},
  {c:'connect', q:'How does Team work?', a:'Team is the plan for organisations: $'+PLANS.team.price+' per person a month, from '+TEAM_SEAT_MIN+' people, billed monthly or yearly. Everyone signs in with their own account and gets AMV\u2019s top models; each person adds their own full allowance to one shared pool, and you get one bill. Owners and admins manage who is in. Teammates see only what somebody shares into the team library - never anyone\u2019s chats. Start one from Team in the avatar menu.'},
  /* Priced from PLANS. Written out, this answer quoted three figures that
     nothing kept in step with the cards or with checkout, so changing a price
     left the Help Center stating the old one to the person who came here to
     ask what it costs. */
  /* WAS: "the cheapest paid plan gets the same model as the most expensive
     one". Not true, and it was the kind of not-true that reads as a rounding.
     Forge and Apex are distinct engines; what is true - and what the engine
     ladder is built to hold - is that they bill the SAME per token, so paying
     more buys more of the best rather than access to a better one. Those are
     different promises and only the second one survives somebody checking. */
  {c:'billing', q:'Can I get a refund?', a:'Yes. Within 14 days of a plan charge, if less than 20% of what your plan includes has been used since that charge, open Billing and press Refund: the whole charge goes back to your card and your plan ends straight away. That works once in any 12 months. For anything else - a charge you did not expect, one taken twice, heavier use, or your legal right to withdraw where you live - press Ask for a refund in Billing and say why. The answer appears there. You can also turn off auto-renew at any time and keep your plan until the period you paid for ends.'},
  {c:'billing', q:'How do plans and limits work?', a:'Free is '+_msgMonthLabel('free')+' messages a month on the balanced engine, up to '+_msg5hLabel('free')+' every '+USAGE_WINDOW_HOURS+' hours. Pro ($'+PLANS.pro.price+'/mo) runs AMV Forge, a frontier engine, on the cheapest paid plan there is - '+_msgMonthLabel('pro')+' messages a month, '+_msg5hLabel('pro')+' every '+USAGE_WINDOW_HOURS+' hours, and '+_topWeekLabel('pro')+' Forge or Apex messages a week on top - and unlocks autonomous agents, Mission Control, the app builder and connected accounts. Elite ($'+PLANS.elite.price+'/mo) adds Apex and one-click deploy, with '+_msgMonthLabel('elite')+' messages a month and '+_topWeekLabel('elite')+' top-engine messages a week. Ultra ($'+PLANS.ultra.price+'/mo) is '+_msgMonthLabel('ultra')+' a month, '+_topWeekLabel('ultra')+' top-engine a week, the highest throughput AMV offers and team workspaces. Custom lets you set your own hard-capped budget. The engines above Core bill the same per token as each other, so a higher plan buys MORE of the best engine rather than a better one.'},
  {c:'privacy', q:'What is AI Memory?', a:'Memory lets AMV remember facts about you - your role, preferences, and context - and apply them automatically in every conversation. Add or edit them under Memory in the sidebar.'},
  {c:'chat', q:'Can AMV email me when it is done?', a:'Yes. When an answer or a build has been running a while, AMV asks once whether you want an email when it is done. Say yes and, whenever long work finishes while you are away from the tab, AMV emails your account address - only then, never about something you watched finish, and never after you press Stop. Turn it on or off any time in Settings \u2192 Account \u2192 Notifications.'},
  {c:'chat', q:'How do I use voice input?', a:'Click the microphone in the chat input (best in Chrome and Edge), speak, and your words appear in the box. Press Enter to send.'},
  {c:'chat', q:'How do I rename, star, or delete chats?', a:'Hover a chat in the sidebar for quick actions, or right-click for the full menu including Export and Share.'},
  {c:'chat', q:'Can I export my conversations?', a:'Yes - right-click any chat and choose “Export as Markdown” to download a .md file for Notion, Obsidian, or any editor.'},
  {c:'privacy', q:'How is my data protected?', a:'Your chats are kept in your browser and, when you are signed in, synced to your account over an encrypted connection (TLS). Passwords are salted and hashed with PBKDF2 - AMV never stores the password itself. Card details go straight to Stripe - AMV never sees them. Export or delete everything any time in Settings \u2192 Privacy.'}
];
try{ window._FAQS = FAQS; }catch(e){}

/* THE HELP CENTER ITSELF (moved here from the page, Nov 25): drawn with the
   questions it holds, and replacing the page's stand-in (12a-view-router-help.js). */
const FAQ_CATS=[
  ['start','Getting started'],
  ['chat','Chat and results'],
  ['create','Design and 3D'],
  ['build','Building apps'],
  ['auto','Automations and approvals'],
  ['connect','Connections and teamwork'],
  ['billing','Plans and billing'],
  ['privacy','Memory, data and privacy']
];

function _renderHelpViewReal(){
  const vc=$('vc'); if(!vc) return;
  /* The questions arrive from help-faqs.js the first time; everything else on
     this screen is drawn at once, and the questions fill in when they land. */
  const _faqsHere=true;
  const FAQS=window._FAQS||[];
  const chips='<div class="hc-chips" role="group" aria-label="Filter help by topic">'+
    '<button class="hc-chip on" data-hcc="all">All</button>'+
    FAQ_CATS.map(c=>'<button class="hc-chip" data-hcc="'+c[0]+'">'+escH(c[1])+'</button>').join('')+
  '</div>';
  const groups=FAQ_CATS.map(c=>{
    const items=FAQS.map((f,i)=>[f,i]).filter(x=>x[0].c===c[0]);
    if(!items.length) return '';
    return '<section class="hc-group" data-hcg="'+c[0]+'">'+
      '<h3 class="hc-group-h">'+escH(c[1])+'</h3>'+
      items.map(x=>
        '<div class="faq-item" id="fi-'+x[1]+'" data-hcg="'+c[0]+'">'+
          '<div class="faq-q" data-fi="'+x[1]+'"><span>'+x[0].q+'</span><span class="faq-arr">+</span></div>'+
          '<div class="faq-a">'+x[0].a+'</div>'+
        '</div>').join('')+
    '</section>';
  }).join('');
  /* ONE CENTERED COLUMN (owner, Nov 25: "the Help center looks weird, not
     centered - make it very clear, like the leading assistants'"). Their help
     centers open the same way: one question, a large search, the topics,
     then the answers, then the two ways to a person. Every id the rest of
     the app and the suites use is kept. */
  vc.innerHTML=
    '<div class="sv fi"><div class="vi vi-help hc2">'+
      '<header class="hc2-hero">'+
        '<h2>'+escH(T('How can we help?'))+'</h2>'+
        '<div class="hc2-search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'+
          '<input type="search" id="faq-search" placeholder="'+escH(T('Search help…'))+'" aria-label="'+escH(T('Search help'))+'"></div>'+
        chips+
      '</header>'+
      '<div class="hc2-body">'+
        '<div id="faq-list">'+(_faqsHere?groups:'<p class="vsub" id="faq-loading" role="status">'+escH(T('Loading…'))+'</p>')+'</div>'+
        '<p id="faq-none" class="hc-none" hidden>No answer matches that. Try a different word, or ask AMV below - it can answer from the product itself.</p>'+
      '</div>'+
      '<div class="hc2-help">'+
        '<div class="hc2-card"><h3>Still need help?</h3>'+
          '<p>Ask AMV - it can answer from the product itself - or write to us.</p>'+
          '<div class="hc2-acts">'+
            '<button class="btn bp" data-dact="askAmv" data-darg="">Ask AMV directly</button>'+
            supportButton({label:'Email Support',cls:'btn bs',subject:'AMV Support request'})+
          '</div>'+
          (_supportEmail()?'<p class="hc2-mail">Or email us directly at <b>'+escH(_supportEmail())+'</b> - we reply within 24 hours.</p>':'')+
        '</div>'+
        '<div class="hc2-card"><h3>Share feedback</h3>'+
          '<p>Found a bug or have an idea? Tell us - real feedback shapes what we build next.</p>'+
          '<div class="hc2-acts">'+
            '<button class="btn bs" data-dact="openFeedback" data-darg="bug">Report a bug</button>'+
            '<button class="btn bs" data-dact="openFeedback" data-darg="idea">Suggest a feature</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
      _appsCardHTML()+
    '</div></div>';
  _appsCardWire();
  vc.querySelectorAll('.faq-q').forEach(q=>{
    q.addEventListener('click',()=>{
      document.getElementById('fi-'+q.dataset.fi)?.classList.toggle('open');
    });
  });

  /* One function decides what is visible, from the two inputs, every time.
     Two independent handlers each hiding rows is how a chip and a search box
     end up disagreeing about the same row. */
  let cat='all';
  function apply(){
    const s=(($('faq-search')||{}).value||'').toLowerCase().trim();
    let shown=0;
    vc.querySelectorAll('.faq-item').forEach(item=>{
      const f=FAQS[+item.querySelector('.faq-q').dataset.fi];
      const okCat = cat==='all' || f.c===cat;
      const okTxt = !s || f.q.toLowerCase().includes(s) || f.a.toLowerCase().includes(s);
      const on = okCat && okTxt;
      item.hidden = !on;
      if(on) shown++;
    });
    /* A heading over nothing reads as a group with no answers in it. */
    vc.querySelectorAll('.hc-group').forEach(g=>{
      g.hidden = !g.querySelector('.faq-item:not([hidden])');
    });
    const none=$('faq-none'); if(none) none.hidden = shown>0;
  }
  vc.querySelectorAll('[data-hcc]').forEach(b=>b.addEventListener('click',()=>{
    cat=b.dataset.hcc;
    vc.querySelectorAll('[data-hcc]').forEach(x=>x.classList.toggle('on',x===b));
    apply();
  }));
  on($('faq-search'),'input',apply);
}
try{ window.renderHelpView = _renderHelpViewReal; }catch(e){}
