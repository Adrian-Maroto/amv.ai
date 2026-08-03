/* ============================================================
   EVERY SECTION -> CHAT.  The whole product on one bridge.

   Each part of AMV (settings, marketplace, studio, lab, design,
   crew, memory, handoff, projects, usage, jobs, chats) is registered
   as a real connector, so from the main chat box you can ask about
   or act on ANY of them and get the ACTUAL data - not a regenerated
   guess and not a canned answer.

   Rules that keep this trustworthy:
   - Actions read from the SAME live stores the tabs render from, so
     chat and the UI can never disagree.
   - Reads are free. Anything that CHANGES something is risk:'high',
     so the universal agent stops for approval first.
   - Empty is reported as empty. If there is nothing there, it says
     so instead of inventing plausible-looking entries.
   ============================================================ */
(function(){
  if(typeof AMVConnectors === 'undefined') return;
  const R = AMVConnectors.register.bind(AMVConnectors);
  const nothing = (msg) => { const e = new Error(msg); e.code = 'needs_info'; throw e; };
  const arr = (v) => Array.isArray(v) ? v : [];

  /* ---- Settings & account ---- */
  R({ id:'settings', name:'Settings', auth:'none', channel:'local',
    isLive(){ return true; },
    actions:{
      get:{ desc:'Read the current settings: plan, theme, language, name, email, connected accounts.',
        async run(){
          const u = (typeof S!=='undefined' && S.user) || {};
          return { name:u.name||'', email:u.email||'',
            plan:(typeof loadStr==='function' && loadStr('amv_plan'))||'free',
            theme:(typeof loadStr==='function' && loadStr('amv_theme'))||'dark',
            language:(typeof _lang==='function' && _lang())||'auto',
            backendConnected:!!(window.AMV_API && AMV_API.base) };
        } },
      /* Not high risk. Approvals exist for things that are hard to undo or that
         reach outside the account; making the screen light is neither, and
         stopping to ask about it teaches people to click through the prompts
         that matter. Same reasoning that took the risk chooser out of Crew. */
      set_theme:{ desc:'Switch the theme. Args: {theme:"dark"|"light"}',
        async run(a){ const t=(a&&a.theme)==='light'?'light':'dark';
          try{ saveStr('amv_theme',t); if(typeof applyTheme==='function') applyTheme(t); }catch(e){}
          return { theme:t }; } },
      set_language:{ desc:'Change the interface language. Args: {code}',
        async run(a){ const c=String((a&&a.code)||'').trim();
          if(!c || (typeof LANGS!=='undefined' && !LANGS[c])) nothing('That language is not one of the supported codes.');
          try{ saveStr('amv_lang',c); if(typeof _translateUI==='function') _translateUI(); }catch(e){}
          return { language:c }; } }
    } });

  /* ---- Marketplace ---- */
  R({ id:'marketplace', name:'Marketplace', auth:'none', channel:'local',
    isLive(){ return typeof AMVMarket !== 'undefined'; },
    actions:{
      my_purchases:{ desc:'Everything you have bought in the marketplace.',
        async run(){ const it=await AMVMarket.purchases();
          if(!arr(it).length) nothing('You have not bought anything in the marketplace yet.');
          return { count:it.length, items:it.map(x=>({ id:x.id, title:x.title, kind:x.kind, price:x.price })) }; } },
      my_listings:{ desc:'The listings you are selling.',
        async run(){ const it=await AMVMarket.myListings();
          if(!arr(it).length) nothing('You have no listings up for sale yet.');
          return { count:it.length, items:it.map(x=>({ id:x.id, title:x.title, price:x.price, sales:x.sales||0, status:x.status||'active' })) }; } },
      my_earnings:{ desc:'Your marketplace balance and payout history.',
        async run(){ const e=await AMVMarket.earnings();
          return { balance:e.balance||0, lifetime:e.lifetime||0, sellerPct:e.sellerPct||80, minWithdraw:e.minWithdraw||10 }; } }
    } });

  /* ---- Crew: jobs, approvals, schedule ---- */
  R({ id:'crew', name:'Crew', auth:'none', channel:'local',
    isLive(){ return typeof _cwJobs === 'function'; },
    actions:{
      running_jobs:{ desc:'Standing jobs and whether each is on, and autonomous or ask-first.',
        async run(){ const j=_cwJobs()||[];
          return { count:j.length, jobs:j.map(x=>({ id:x.id, title:x.title, on:!!x.on, needs:x.needs||'' })) }; } },
      approvals:{ desc:'Everything waiting for your approval right now.',
        async run(){ const a=_cwApprovals()||[];
          if(!a.length) nothing('Nothing is waiting for your approval.');
          return { count:a.length, items:a.map(x=>({ id:x.id, title:x.title, preview:(x.preview||'').slice(0,160) })) }; } },
      job_hunt_status:{ desc:'Job Hunt settings and what it has applied to.',
        async run(){ if(typeof AMVJobs==='undefined') nothing('Job Hunt is not available.');
          const c=AMVJobs.cfg();
          return { on:!!c.on, runAt:c.runAt, reviewCount:c.reviewCount, autoCount:c.autoCount,
            roles:(c.targets&&c.targets.roles)||[], applied:(c.applied||[]).length,
            ready:AMVJobs.ready() }; } }
    } });

  /* ---- Studio (designs) ---- */
  R({ id:'studio', name:'Studio', auth:'none', channel:'local',
    isLive(){ return typeof _STUDIO !== 'undefined'; },
    actions:{
      my_designs:{ desc:'The designs/artifacts in Studio.',
        async run(){ const a=(typeof _STUDIO!=='undefined' && arr(_STUDIO.artifacts))||[];
          if(!a.length) nothing('There are no designs in Studio yet.');
          return { count:a.length, designs:a.map((x,i)=>({ index:i, title:x.title||x.prompt||('Design '+(i+1)) })) }; } },
      get_design_html:{ desc:'Full HTML of one Studio design. Args: {index}',
        async run(a){ const list=(typeof _STUDIO!=='undefined' && arr(_STUDIO.artifacts))||[];
          const i=Math.max(0,+((a&&a.index)||0)); const d=list[i];
          if(!d) nothing('There is no design at that position in Studio.');
          return { index:i, html:d.html||'' }; } }
    } });

  /* ---- Memory ---- */
  R({ id:'memory', name:'Memory', auth:'none', channel:'local',
    isLive(){ return typeof S !== 'undefined'; },
    actions:{
      list:{ desc:'Everything AMV remembers about you.',
        async run(){ const m=arr(typeof S!=='undefined' && S.memory);
          if(!m.length) nothing('AMV has no saved memories about you yet.');
          return { count:m.length, memories:m.map(x=>({ id:x.id, text:x.text })) }; } },
      add:{ desc:'Save a new memory. Args: {text}', risk:'high', riskLabel:'save a memory about you',
        async run(a){ const t=String((a&&a.text)||'').trim(); if(!t) nothing('Nothing to remember - give me the text.');
          S.memory=[{ id:'m'+Date.now(), text:t, added:Date.now() }, ...arr(S.memory)];
          try{ if(typeof renderMemList==='function' && S.tab==='memory') renderMemList(); }catch(e){}
          return { saved:true, text:t }; } }
    } });

  /* ---- Handoff ---- */
  R({ id:'handoff', name:'Handoff', auth:'none', channel:'local',
    isLive(){ return typeof load === 'function'; },
    actions:{
      list:{ desc:'Handoffs you have sent and received.',
        async run(){ const out=arr(load('amv_handoffs_out')), inb=arr(load('amv_handoffs_in'));
          if(!out.length && !inb.length) nothing('You have no handoffs yet.');
          return { sent:out.length, received:inb.length,
            items:[...inb,...out].slice(0,25).map(h=>({ id:h.id, title:h.title||'', to:h.to||'', done:!!h.done })) }; } }
    } });

  /* ---- Projects / workspaces ---- */
  R({ id:'projects', name:'Projects', auth:'none', channel:'local',
    isLive(){ return typeof load === 'function'; },
    actions:{
      list:{ desc:'Your projects and how many chats each holds.',
        async run(){ const ws=arr(load('amv_workspaces'));
          if(!ws.length) nothing('You have no projects yet.');
          return { count:ws.length, projects:ws.map(w=>({ id:w.id, name:w.name||'Untitled', chats:arr(w.chats).length })) }; } }
    } });

  /* ---- Chats ---- */
  R({ id:'chats', name:'Chats', auth:'none', channel:'local',
    isLive(){ return typeof S !== 'undefined'; },
    actions:{
      list:{ desc:'Your recent conversations.',
        async run(){ const c=arr(typeof S!=='undefined' && S.convs).filter(x=>x && arr(x.msgs).length);
          if(!c.length) nothing('You have no conversations with messages yet.');
          return { count:c.length, chats:c.slice(0,25).map(x=>({ id:x.id, title:x.title||'Untitled', messages:arr(x.msgs).length })) }; } },
      search:{ desc:'Find a past conversation by keyword. Args: {q}',
        async run(a){ const q=String((a&&a.q)||'').toLowerCase().trim(); if(!q) nothing('Give me something to search for.');
          const hits=arr(typeof S!=='undefined' && S.convs).filter(c=>{
            if(!c) return false;
            if(String(c.title||'').toLowerCase().includes(q)) return true;
            return arr(c.msgs).some(m=>typeof m.c==='string' && m.c.toLowerCase().includes(q));
          });
          if(!hits.length) nothing('No conversation mentions "'+q+'".');
          return { count:hits.length, chats:hits.slice(0,15).map(c=>({ id:c.id, title:c.title||'Untitled' })) }; } }
    } });

  /* ---- Usage & billing (read-only: money is never changed from chat) ---- */
  R({ id:'usage', name:'Usage & billing', auth:'none', channel:'local',
    isLive(){ return true; },
    actions:{
      status:{ desc:'Your plan and how much of your allowance is left.',
        async run(){
          let u=null; try{ u=(typeof AMVUsage!=='undefined') ? AMVUsage.status() : null; }catch(e){}
          return { plan:(typeof loadStr==='function' && loadStr('amv_plan'))||'free',
            remaining:u?u.remaining:null, resetsAt:u?u.resetsAt:null,
            note:'Billing changes are made in Billing, not from chat.' };
        } }
    } });
})();
