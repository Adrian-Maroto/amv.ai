/* ============================================================
   TEAM / WORKSPACE MODE (frontend) - the B2B tier.
   Create a team, invite members with roles, share projects & prompts.
   Backed by the server when connected; gracefully shows the upsell
   when there's no backend yet.
   ============================================================ */
const AMVTeam = {
  _cache:null,
  enabled(){ try{ return !!(window.AMV_API && AMV_API.live && AMV_API.token); }catch(e){ return false; } },
  /* Throws rather than returning null on failure. A network error is NOT "you
     have no team" - answering it that way showed an existing team's owner a
     create-a-team form, and a member an upgrade wall, for a team that exists. */
  async get(){ if(!this.enabled()) return null; const r=await AMV_API._fetch('/team/get',{method:'POST',body:'{}'}); const d=await r.json(); if(d.error) throw new Error(d.error); this._cache=d.team; return d.team; },
  async create(name){ const r=await AMV_API._fetch('/team/create',{method:'POST',body:JSON.stringify({name})}); const d=await r.json(); if(d.error) throw new Error(d.error); this._cache=d.team; return d.team; },
  async invite(email,role){ const r=await AMV_API._fetch('/team/invite',{method:'POST',body:JSON.stringify({email,role})}); const d=await r.json(); if(d.error){ const e=new Error(d.error); e.code=d.code; e.seats=d.seats; throw e; } return d; },
  async join(token){ const r=await AMV_API._fetch('/team/join',{method:'POST',body:JSON.stringify({token})}); const d=await r.json(); if(d.error) throw new Error(d.error); this._cache=d.team; return d.team; },
  async remove(email){ const r=await AMV_API._fetch('/team/remove',{method:'POST',body:JSON.stringify({email})}); const d=await r.json(); if(d.error) throw new Error(d.error); return d.members; },
  async leave(){ const r=await AMV_API._fetch('/team/leave',{method:'POST',body:'{}'}); const d=await r.json(); if(d.error){ const e=new Error(d.error); e.code=d.code; throw e; } this._cache=null; return true; },
  async setRole(email,role){ const r=await AMV_API._fetch('/team/role',{method:'POST',body:JSON.stringify({email,role})}); const d=await r.json(); if(d.error) throw new Error(d.error); return d.members; },
  async audit(){ try{ const r=await AMV_API._fetch('/team/audit',{method:'POST',body:'{}'}); const d=await r.json(); return d.log||[]; }catch(e){ return []; } },
  myRole(team){ if(!team||!S.user) return null; const m=(team.members||[]).find(x=>x.email===(S.user.email||'').toLowerCase()); return m?m.role:null; },
  async tasks(){ try{ const r=await AMV_API._fetch('/team/tasks',{method:'POST',body:'{}'}); const d=await r.json(); return d.error?{tasks:[],members:[]}:d; }catch(e){ return {tasks:[],members:[]}; } },
  async taskCreate(title,assignee,notes,priority){ const r=await AMV_API._fetch('/team/task/create',{method:'POST',body:JSON.stringify({title,assignee,notes,priority})}); const d=await r.json(); if(d.error) throw new Error(d.error); return d.tasks; },
  async taskUpdate(id,patch){ const r=await AMV_API._fetch('/team/task/update',{method:'POST',body:JSON.stringify(Object.assign({id},patch))}); const d=await r.json(); if(d.error) throw new Error(d.error); return d.tasks; },
  // ── Shared library: push a project/prompt into the team's shared data ──
  async share(kind, item){
    const r=await AMV_API._fetch('/team/share',{method:'POST',body:JSON.stringify({kind,item})});
    const d=await r.json(); if(d.error) throw new Error(d.error); return d.shared||[];
  },
  async shared(){ try{ const r=await AMV_API._fetch('/team/shared',{method:'POST',body:'{}'}); const d=await r.json(); return d.shared||[]; }catch(e){ return []; } },
  async unshare(id){ const r=await AMV_API._fetch('/team/unshare',{method:'POST',body:JSON.stringify({id})}); const d=await r.json(); if(d.error) throw new Error(d.error); return d.shared||[]; },
  // ── Presence: lightweight heartbeat so teammates see who's active now ──
  async heartbeat(){ try{ const r=await AMV_API._fetch('/team/presence',{method:'POST',body:JSON.stringify({ping:Date.now()})}); const d=await r.json(); return d.present||[]; }catch(e){ return []; } },
  _presenceTimer:null,
  startPresence(onUpdate){
    if(!this.enabled()) return; this.stopPresence();
    const beat=async()=>{ const present=await this.heartbeat(); if(onUpdate) try{ onUpdate(present); }catch(e){} };
    beat(); this._presenceTimer=setInterval(beat, 25000);   // every 25s
  },
  stopPresence(){ if(this._presenceTimer){ clearInterval(this._presenceTimer); this._presenceTimer=null; } },
};
window.AMVTeam=AMVTeam;

function renderTeamView(){
  const vc=$('vc'); if(!vc) return;
  const plan=loadStr('amv_plan')||'free';
  const planName=(PLANS[plan]&&PLANS[plan].name)||'Free';
  const teamPlan=PLANS.elite||{name:'Elite',price:75};
  const hasTeamPlan=_planAllowsTeams();

  // Reusable "what Teams includes + which plan" block
  const teamExplainer=
    '<div class="ss2"><h3>What you get with Teams</h3><div class="team-feats">'+
      '<div class="team-feat"><span class="team-feat-ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg></span><div><b>Shared projects &amp; prompt library</b><span>Everyone works from the same source of truth</span></div></div>'+
      '<div class="team-feat"><span class="team-feat-ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3"/></svg></span><div><b>Roles &amp; permissions</b><span>Owner, admin, and member - you control access</span></div></div>'+
      '<div class="team-feat"><span class="team-feat-ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3 3 3 0 0 0-3 3 3 3 0 0 0 0 6 3 3 0 0 0 3 3 3 3 0 0 0 6 0 3 3 0 0 0 3-3 3 3 0 0 0 0-6 3 3 0 0 0-3-3 3 3 0 0 0-3-3z"/></svg></span><div><b>Shared team memory</b><span>AMV remembers context across the whole team</span></div></div>'+
      '<div class="team-feat"><span class="team-feat-ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg></span><div><b>Invite by email</b><span>Add teammates in seconds</span></div></div>'+
      '<div class="team-feat"><span class="team-feat-ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg></span><div><b>Seats on one subscription</b><span>Elite includes 10, Ultra 25. Everyone shares the plan\u2019s allowance - one bill, not one per person.</span></div></div>'+
    '</div></div>';

  /* The buy box. Teams is the per-seat plan, and a seat picker that shows the
     real monthly total as it moves is the difference between a price list and
     something somebody can decide about. It never pretends to work: with no
     seat price configured the server says so and this says the same thing. */
  const seatBuyCard=(function(){
    const P=(typeof PLANS!=='undefined'&&PLANS.team)||{price:20,name:'Teams'};
    const min=(typeof TEAM_SEAT_MIN!=='undefined')?TEAM_SEAT_MIN:3;
    const n=Math.max(min,+(loadStr('amv_seat_pick')||min)||min);
    return '<div class="ss2 seat-buy">'+
      '<h3>Teams - $'+P.price+' per person, per month</h3>'+
      '<p class="seat-why">Every seat brings its own full Pro allowance into one shared pool, plus '+
        'AMV Apex for everyone. Ten people get ten plans\u2019 worth of capacity and one bill, '+
        'instead of one plan\u2019s worth split ten ways.</p>'+
      '<div class="seat-pick">'+
        '<button class="btn bs seat-step" type="button" data-seat="-1" aria-label="One fewer seat">\u2212</button>'+
        '<label class="sr-only" for="seat-n">Number of seats</label>'+
        '<input id="seat-n" class="inp seat-n" type="number" inputmode="numeric" min="'+min+'" max="500" value="'+n+'">'+
        '<button class="btn bs seat-step" type="button" data-seat="1" aria-label="One more seat">+</button>'+
        '<span class="seat-total" id="seat-total"></span>'+
      '</div>'+
      '<div class="seat-say" id="seat-say" role="status" aria-live="polite"></div>'+
      '<button class="btn bp" id="seat-buy" style="font-size:12px">Get Teams</button>'+
      '<p class="seat-fine">Minimum '+min+' seats. Change the number any time - billing is prorated by the day, '+
        'so adding somebody mid-month costs the part of the month they are there for.</p>'+
    '</div>';
  })();

  // The clear plan answer - shown whenever the user can't yet use Teams
  const planRequirementCard=
    '<div class="ss2" style="background:rgba(85,144,255,.06);border-color:rgba(85,144,255,.22)">'+
      '<h3>Which plan do I need?</h3>'+
      '<p style="font-size:13.5px;color:var(--tx);line-height:1.7;margin:0 0 4px">'+
        'Teams unlocks on the <b style="color:var(--accent)">'+teamPlan.name+' plan ($'+teamPlan.price+'/month)</b> and above. '+
        'One Elite (or Ultra) subscription covers your shared workspace, roles, and team memory. '+
        'A <b>Custom plan</b> sized at the Elite tier or above also unlocks Teams.'+
      '</p>'+
      '<p style="font-size:12.5px;color:var(--mu);line-height:1.6;margin:8px 0 12px">'+
        'Free and Pro ($15) are individual plans - they don\u2019t include team workspaces. '+
        'You\u2019re currently on <b style="color:var(--tx)">'+planName+'</b>.'+
      '</p>'+
      (hasTeamPlan
        ? '<div style="font-size:13px;color:#4ade80;font-weight:600">\u2713 Your '+planName+' plan includes Teams - create yours below.</div>'
        : '<button class="btn bp" data-stab="plans" style="font-size:12px">Upgrade to '+teamPlan.name+' &rarr;</button>')+
    '</div>';

  // No backend yet → show what Teams unlocks + the plan answer (honest, clear path)
  if(!AMVTeam.enabled()){
    vc.innerHTML='<div class="sv fi"><div class="vi">'+
      '<span class="eyebrow">Collaboration</span>'+
      '<h2>Team workspaces</h2>'+
      '<p class="vsub">Share projects, prompts, and AMV\u2019s memory across your whole team - with roles and permissions.</p>'+
      teamExplainer+
      planRequirementCard+
      '<div class="ss2"><p style="font-size:12.5px;color:var(--mu);line-height:1.6;margin:0">Team mode runs on your AMV backend. Once it\u2019s connected and you\u2019re on the '+teamPlan.name+' plan, you can create a team and invite members right here.</p></div>'+
    '</div></div>';
    return;
  }

  /* Membership comes BEFORE the plan gate. A seat is the team paying for the
     person filling it, so somebody invited onto an Elite team is a full member
     on whatever plan they personally hold - showing them an upgrade wall for a
     team they are already in would be simply wrong. Only CREATING a team needs
     the plan, which is the same rule the server enforces. */
  AMVTeam.get().then(team=>{
    // a member on any plan has a team, so the nav item follows membership too
    try{ if(typeof _revealTeamNav==='function') _revealTeamNav(); }catch(e){}
    if(team){ _renderTeamManage(vc, team); return; }
    if(!hasTeamPlan){
      vc.innerHTML='<div class="sv fi"><div class="vi">'+
        '<span class="eyebrow">Collaboration</span>'+
        '<h2>Team workspaces</h2>'+
        '<p class="vsub">Shared projects, prompts, memory, and roles - for your whole team.</p>'+
        seatBuyCard+
        teamExplainer+
        planRequirementCard+
      '</div></div>';
      _wireSeatBuy();
      return;
    }
    _renderTeamCreate(vc);
  }).catch(()=>{
    vc.innerHTML='<div class="sv fi"><div class="vi">'+
      '<span class="eyebrow">Collaboration</span><h2>Team workspaces</h2>'+
      '<p class="vsub">AMV could not reach the server, so this would be out of date. '+
      'Check your connection and try again.</p>'+
      '<button class="btn bs" data-dact="renderTeamView" style="font-size:12px">Retry</button>'+
    '</div></div>';
  });
}
/* Live total, a bounded stepper, and a checkout that reports the one failure
   that is not the user's fault: the seat price is not configured yet. */
function _wireSeatBuy(){
  const el=$('seat-n'); if(!el) return;
  const P=(typeof PLANS!=='undefined'&&PLANS.team)||{price:20};
  const min=(typeof TEAM_SEAT_MIN!=='undefined')?TEAM_SEAT_MIN:3;
  const max=(typeof TEAM_SEAT_MAX!=='undefined')?TEAM_SEAT_MAX:500;
  const clamp=v=>Math.max(min,Math.min(max,Math.floor(+v||0)||min));
  const paint=()=>{
    const n=clamp(el.value);
    el.value=String(n);
    try{ saveStr('amv_seat_pick',String(n)); }catch(e){}
    const t=$('seat-total');
    if(t) t.textContent='$'+(n*P.price)+'/month for '+n+' people';
  };
  on(el,'input',paint); on(el,'change',paint); paint();
  document.querySelectorAll('.seat-step').forEach(b=>on(b,'click',()=>{
    el.value=String(clamp(+el.value + (+b.dataset.seat||0))); paint();
  }));
  on($('seat-buy'),'click',async()=>{
    const n=clamp(el.value);
    const say=t=>{ const s2=$('seat-say'); if(s2) s2.textContent=t||''; };
    if(!(window.AMV_API&&AMV_API.live&&AMV_API.token)){
      say('Sign in first and this takes you straight to checkout.');
      try{ openAuth('signup'); }catch(e){}
      return;
    }
    const btn=$('seat-buy'); if(btn){ btn.disabled=true; btn.textContent='Opening\u2026'; }
    say('');
    try{
      const url=await AMV_API.stripeCheckout('team',(S.user&&S.user.email)||'',n);
      _openExternalPay(url,'team','card');
    }catch(e){
      say(e&&e.code==='not_configured'
        ? 'Teams billing is not switched on for this deployment yet, so nothing was charged. Elite and Ultra include team seats in the meantime.'
        : (e&&e.message)||'Could not open checkout. Nothing was charged.');
    }finally{ if(btn){ btn.disabled=false; btn.textContent='Get Teams'; } }
  });
}
try{ window._wireSeatBuy=_wireSeatBuy; }catch(e){}

/* Settings -> Team. The question this answers is "what IS this", which the
   product could not answer anywhere: the Team tab showed either a tool or an
   upgrade wall, and neither said how many people fit, what a seat gets them, or
   what happens to the allowance when somebody joins. */
function _renderTeamSettingsPane(pane){
  const P=(typeof PLANS!=='undefined'&&PLANS.team)||{price:20};
  const min=(typeof TEAM_SEAT_MIN!=='undefined')?TEAM_SEAT_MIN:3;
  const team=(window.AMVTeam&&AMVTeam._cache)||null;
  const seats=team&&team.seats;

  pane.innerHTML=
    '<div class="set-title">Team</div>'+
    '<div class="set-sub">Sharing AMV with the people you work with.</div>'+
    '<div class="ss2 set-what"><h3>What a team is</h3>'+
      '<p>One AMV subscription that several people sign into with their own accounts. '+
      'They share a project library, a prompt library, a task board and AMV\u2019s memory of your '+
      'work - and you get one bill instead of one per person.</p>'+
      '<p>Everyone keeps their own conversations. A team shares what you put in the shared '+
      'library, never what anybody types into chat.</p>'+
    '</div>'+
    '<div class="ss2"><h3>How many people</h3>'+
      '<div class="set-facts">'+
        '<div class="set-fact"><div class="set-fact-k">Free / Pro</div><div class="set-fact-v">1</div>'+
          '<div class="set-fact-s">Just you - these are individual plans</div></div>'+
        '<div class="set-fact"><div class="set-fact-k">Elite</div><div class="set-fact-v">10</div>'+
          '<div class="set-fact-s">Ten people sharing that one plan\u2019s allowance</div></div>'+
        '<div class="set-fact"><div class="set-fact-k">Ultra</div><div class="set-fact-v">25</div>'+
          '<div class="set-fact-s">Same idea, twenty-five of them</div></div>'+
        '<div class="set-fact"><div class="set-fact-k">Teams</div><div class="set-fact-v">$'+P.price+'/person</div>'+
          '<div class="set-fact-s">From '+min+' people. Every seat adds its OWN allowance to the shared pool</div></div>'+
      '</div>'+
      '<p class="set-fact-s" style="margin-top:12px">The difference that matters: on Elite and Ultra a bigger '+
      'team divides one allowance, so each person gets less as you grow. On Teams each seat brings its own, '+
      'so ten people have ten plans\u2019 worth of capacity. That is why Teams is the one to buy if you are '+
      'actually a team.</p>'+
    '</div>'+
    (seats?
    '<div class="ss2"><h3>Your team right now</h3>'+
      '<div class="set-facts">'+
        '<div class="set-fact"><div class="set-fact-k">Members</div><div class="set-fact-v">'+seats.used+'</div></div>'+
        '<div class="set-fact"><div class="set-fact-k">Seats</div><div class="set-fact-v">'+seats.limit+'</div></div>'+
        '<div class="set-fact"><div class="set-fact-k">Free seats</div><div class="set-fact-v">'+Math.max(0,seats.limit-seats.used)+'</div>'+
          (seats.over>0?'<div class="set-fact-s" style="color:var(--gold)">'+seats.over+' over your plan</div>':'')+'</div>'+
      '</div>'+
      '<button class="btn bs" data-stab="team" style="font-size:12px;margin-top:14px">Manage the team \u2192</button>'+
    '</div>'
    :'<div class="ss2"><h3>You are not in a team</h3>'+
      '<p style="font-size:13px;color:var(--mu);line-height:1.65;margin:0 0 12px">'+
      'Anyone can be invited into one on any plan - the team pays for your seat, not you. '+
      'To start one yourself you need a plan that includes seats.</p>'+
      '<button class="btn bp" data-stab="team" style="font-size:12px">Open Team \u2192</button></div>')+
    '<div class="ss2"><h3>What a seat costs the team</h3>'+
      '<p style="font-size:13px;color:var(--mu);line-height:1.65;margin:0">'+
      'Everyone on a team draws on the same monthly allowance, so one person having a heavy week '+
      'is felt by everybody. You can see how much is left in <b>Settings \u2192 Usage</b> at any time. '+
      'Nobody can be charged individually - there is one subscription and one bill.</p>'+
    '</div>';
  /* Fetch the team ONCE if we do not have it, then draw again with the real
     numbers. Guarded on the cache being empty: re-rendering unconditionally
     would call this function, which would fetch, which would re-render, for
     ever. */
  if(!team){
    try{
      if(window.AMVTeam&&AMVTeam.enabled()){
        AMVTeam.get().then(t=>{ if(t) _renderTeamSettingsPane(pane); }).catch(()=>{});
      }
    }catch(e){}
  }
}
try{ window._renderTeamSettingsPane=_renderTeamSettingsPane; }catch(e){}

function _renderTeamCreate(vc){
  vc.innerHTML='<div class="sv fi"><div class="vi">'+
    '<span class="eyebrow">Collaboration</span><h2>Create your team</h2>'+
    '<p class="vsub">Start a shared workspace and invite your teammates.</p>'+
    '<div class="ss2"><div class="sf" style="max-width:420px">'+
      '<div><label class="lbl">Team name</label><input type="text" id="team-name" placeholder="Acme Inc." autocomplete="off"></div>'+
      '<button class="btn bp" id="team-create-btn" style="align-self:flex-start;font-size:12px">Create team</button>'+
    '</div></div>'+
  '</div></div>';
  on($('team-create-btn'),'click',async()=>{
    const name=$('team-name')?.value.trim()||'My Team';
    const btn=$('team-create-btn'); if(btn){btn.disabled=true;btn.textContent='Creating\u2026';}
    try{ await AMVTeam.create(name); toast('Team created!','success'); renderTeamView(); }
    catch(e){ if(btn){btn.disabled=false;btn.textContent='Create team';} toast(e.message||'Could not create team','error'); }
  });
}
function _renderTeamManage(vc, team){
  const role=AMVTeam.myRole(team);
  const canManage=role==='owner'||role==='admin';
  const isOwner=role==='owner';
  const myEmail=(S.user?.email||'').toLowerCase();
  /* Seats come from the server, which is the only thing that knows what the
     plan currently pays for. A downgrade quietly stops covering whoever joined
     last, and the owner is the only person who can fix it - so it is named
     here rather than discovered when somebody's work stops working. */
  const seats=team.seats||null;
  const over=seats?seats.over:0;
  const onSeatPlan=(team.plan||'')==='team';
  const seatPrice=((typeof PLANS!=='undefined'&&PLANS.team)||{price:20}).price;
  const seatNote=seats
    ? '<p class="vsub">'+seats.used+' of '+seats.limit+' seat'+(seats.limit===1?'':'s')+' used'+
      (over>0?' \u00b7 <b style="color:var(--gold)">'+over+' over your plan</b>':'')+
      ' \u00b7 '+(onSeatPlan
        ? 'every seat adds its own allowance to the shared pool.'
        : 'everyone shares one allowance.')+'</p>'
    : '';
  /* Seat changes go through Stripe's own portal rather than a second billing
     path in AMV. Stripe prorates the change to the day and the webhook writes
     the new count back, so the number of seats AMV honours is always the number
     being billed - there is no place for the two to disagree. */
  const seatManage=(isOwner&&seats)
    ? '<div class="ss2"><h3>Seats and billing</h3>'+
      '<div class="seat-now">'+
        (onSeatPlan
          ? '<b>$'+(seats.limit*seatPrice)+'/month</b><span>'+seats.limit+' seats at $'+seatPrice+' each</span>'
          : '<b>'+seats.limit+' seats</b><span>included with '+escH(String(team.plan||'your plan'))+'</span>')+
      '</div>'+
      (onSeatPlan
        ? '<p style="font-size:12.5px;color:var(--mu);line-height:1.6;margin:0 0 10px">'+
          'Changing the number is prorated by the day, so adding somebody mid-month costs '+
          'the part of the month they are there for.</p>'+
          '<button class="btn bs" id="seat-manage" style="font-size:12px">Change seats</button>'
        : '<p style="font-size:12.5px;color:var(--mu);line-height:1.6;margin:0 0 10px">'+
          'Need a different number? Teams is priced per person at $'+seatPrice+'/month, '+
          'and every seat brings its own allowance rather than dividing this one.</p>'+
          '<button class="btn bs" data-stab="plans" style="font-size:12px">See Teams pricing</button>')+
      '<div class="seat-say" id="seat-manage-say" role="status" aria-live="polite"></div>'+
      '</div>'
    : '';
  const overBanner=over>0
    ? '<div class="ss2" style="border-color:var(--gold);background:rgba(245,158,11,.07)">'+
      '<h3>'+over+' '+(over===1?'person is':'people are')+' not covered by your plan</h3>'+
      '<p style="font-size:13px;color:var(--tx);line-height:1.6;margin:0 0 10px">'+
      'Your plan includes '+seats.limit+' seat'+(seats.limit===1?'':'s')+' and the team has '+seats.used+' member'+(seats.used===1?'':'s')+'. '+
      'The '+(over===1?'member':'members')+' marked below are using their own plan instead of the team\u2019s, '+
      'so they have their own limits and lose the shared allowance. Upgrade to cover them, or remove them.</p>'+
      (isOwner?'<button class="btn bp" data-stab="plans" style="font-size:12px">See plans &rarr;</button>':
       '<p style="font-size:12px;color:var(--mu);margin:0">Only the owner can change the plan.</p>')+
      '</div>'
    : '';
  const memberRows=(team.members||[]).map(m=>
    '<div class="vrow"><span>'+escH(m.email)+(m.email===myEmail?' <span style="color:var(--mu)">(you)</span>':'')+
    (m.seated===false?' <span class="team-role" style="background:rgba(245,158,11,.14);color:var(--gold)">no seat</span>':'')+'</span>'+
    '<span style="display:flex;align-items:center;gap:10px"><span class="team-role team-role-'+m.role+'">'+m.role+'</span>'+
    // owner can promote/demote anyone who isn't the owner
    (isOwner&&m.role!=='owner'?'<button class="btn bs team-role-btn" data-team-setrole="'+escH(m.email)+'" data-team-newrole="'+(m.role==='admin'?'member':'admin')+'" style="font-size:10.5px;padding:3px 8px">'+(m.role==='admin'?'Make member':'Make admin')+'</button>':'')+
    (canManage&&m.role!=='owner'?'<button class="team-x" data-team-remove="'+escH(m.email)+'" title="Remove">\u00d7</button>':'')+'</span></div>'
  ).join('');
  vc.innerHTML='<div class="sv fi"><div class="vi">'+
    '<span class="eyebrow">Collaboration</span><h2>'+escH(team.name)+'</h2>'+
    '<p class="vsub">'+(team.members||[]).length+' member'+((team.members||[]).length===1?'':'s')+' \u00b7 you\u2019re '+(role==='owner'?'the owner':'a '+role)+'.</p>'+
    seatNote+
    overBanner+
    seatManage+
    '<div class="team-presence" id="team-presence"></div>'+
    '<div class="ss2"><h3>Shared library <span style="font-weight:400;color:var(--mu);font-size:11px">(projects &amp; prompts everyone can use)</span></h3>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">'+
        '<button class="btn bs" id="team-share-project" style="font-size:12px">Share a project</button>'+
        '<button class="btn bs" id="team-share-prompt" style="font-size:12px">Share a prompt</button></div>'+
      '<div id="team-shared"><div style="color:var(--mu);font-size:12px;padding:6px 0">Loading\u2026</div></div>'+
    '</div>'+
    (canManage?'<div class="ss2"><h3>Invite a teammate</h3><div class="sf" style="max-width:480px"><div style="display:flex;gap:8px;align-items:flex-end"><div style="flex:1"><label class="lbl">Email</label><input type="email" id="team-invite-email" placeholder="teammate@company.com" autocomplete="off"></div><div><label class="lbl">Role</label><select id="team-invite-role" class="sel"><option value="member">Member</option><option value="admin">Admin</option></select></div><button class="btn bp" id="team-invite-btn" style="font-size:12px">Invite</button></div></div><div id="team-invite-result"></div></div>':'')+
    '<div class="ss2"><h3>Members</h3><div class="vbreak">'+memberRows+'</div></div>'+
    '<div class="ss2"><h3>Assigned work <span style="font-weight:400;color:var(--mu);font-size:11px">(assign tasks to teammates and track them)</span></h3>'+
      '<div class="sf" style="max-width:560px;margin-bottom:14px"><div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">'+
        '<div style="flex:1;min-width:180px"><label class="lbl">Task</label><input type="text" id="tt-title" placeholder="e.g. Draft the launch email" autocomplete="off"></div>'+
        '<div><label class="lbl">Assign to</label><select id="tt-assignee" class="sel"><option value="">Unassigned</option>'+(team.members||[]).map(m=>'<option value="'+escH(m.email)+'">'+escH(m.email)+'</option>').join('')+'</select></div>'+
        '<div><label class="lbl">Priority</label><select id="tt-priority" class="sel"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></div>'+
        '<button class="btn bp" id="tt-add" style="font-size:12px">Assign</button>'+
      '</div></div>'+
      '<div id="tt-board"><div style="color:var(--mu);font-size:12px;padding:8px 0">Loading tasks\u2026</div></div>'+
    '</div>'+
    (isOwner?'':'<div class="ss2"><h3>Leave this team</h3>'+
      '<p style="font-size:12.5px;color:var(--mu);line-height:1.6;margin:0 0 10px">'+
      'You go back to your own plan and your own allowance. Anything you shared with the team stays with the team.</p>'+
      '<button class="btn bs" id="team-leave" style="font-size:12px;color:var(--red);border-color:var(--red)">Leave team</button></div>')+
    (canManage?'<div class="ss2"><h3>Activity log <span style="font-weight:400;color:var(--mu);font-size:11px">(who did what)</span></h3><div id="team-audit"><div style="color:var(--mu);font-size:12px;padding:8px 0">Loading\u2026</div></div></div>':'')+
  '</div></div>';
  on($('team-invite-btn'),'click',async()=>{
    const email=$('team-invite-email')?.value.trim(); const r=$('team-invite-role')?.value||'member';
    if(!email){ toast('Enter an email','error'); return; }
    const btn=$('team-invite-btn'); if(btn){btn.disabled=true;btn.textContent='Inviting\u2026';}
    try{
      const d=await AMVTeam.invite(email,r);
      const link=location.origin+location.pathname+(d.inviteLink||'');
      const res=$('team-invite-result');
      /* The link is passed to the handler through a closure rather than
         interpolated into an inline onclick. The old version built a JS string
         literal out of location.pathname, which is attacker-influenced, and
         relied on one quote-escape to stay safe. */
      if(res){
        res.innerHTML='<div class="team-invite-link">Invite link for '+escH(email)+':<br><code>'+escH(link)+'</code>'+
          '<button class="btn bs" id="team-invite-copy" style="font-size:11px;margin-top:8px">Copy link</button></div>';
        on($('team-invite-copy'),'click',async()=>{
          try{ await navigator.clipboard.writeText(link); toast('Link copied','success'); }
          catch(_){ toast('Copy was blocked by your browser - select the link above and copy it.','info',6000); }
        });
      }
      if(btn){btn.disabled=false;btn.textContent='Invite';}
      if($('team-invite-email')) $('team-invite-email').value='';
    }catch(e){
      if(btn){btn.disabled=false;btn.textContent='Invite';}
      /* Running out of seats is not an error the user did something wrong to
         cause, and a toast that disappears cannot be acted on. It gets the
         inline slot, with the one control that resolves it. */
      const res=$('team-invite-result');
      if(e.code==='seat_limit'&&res){
        res.innerHTML='<div class="team-invite-link" style="border-color:var(--gold)">'+escH(e.message)+
          (isOwner?'<br><button class="btn bp" data-stab="plans" style="font-size:11px;margin-top:8px">See plans</button>':'')+'</div>';
        return;
      }
      toast(e.message||'Invite failed','error');
    }
  });
  on($('seat-manage'),'click',async()=>{
    const say=t=>{ const s2=$('seat-manage-say'); if(s2) s2.textContent=t||''; };
    const btn=$('seat-manage'); if(btn){ btn.disabled=true; btn.textContent='Opening\u2026'; }
    try{
      const url=await AMV_API.portal((S.user&&S.user.email)||'');
      if(url) window.open(url,'_blank','noopener');
      else say('Could not open billing just now. Nothing was changed.');
    }catch(e){ say((e&&e.message)||'Could not open billing just now. Nothing was changed.'); }
    finally{ if(btn){ btn.disabled=false; btn.textContent='Change seats'; } }
  });
  on($('team-leave'),'click',async()=>{
    if(typeof confirm==='function' &&
       !confirm('Leave '+team.name+'? You go back to your own plan and lose access to the shared library.')) return;
    const btn=$('team-leave'); if(btn){ btn.disabled=true; btn.textContent='Leaving\u2026'; }
    try{ await AMVTeam.leave(); toast('You have left the team','info'); renderTeamView(); }
    catch(e){ if(btn){ btn.disabled=false; btn.textContent='Leave team'; } toast(e.message||'Could not leave the team','error',6000); }
  });
  vc.querySelectorAll('[data-team-remove]').forEach(b=>on(b,'click',async()=>{
    if(!confirm('Remove '+b.dataset.teamRemove+' from the team?')) return;
    try{ await AMVTeam.remove(b.dataset.teamRemove); toast('Member removed','info'); renderTeamView(); }
    catch(e){ toast(e.message||'Could not remove','error'); }
  }));
  vc.querySelectorAll('[data-team-setrole]').forEach(b=>on(b,'click',async()=>{
    try{ await AMVTeam.setRole(b.dataset.teamSetrole, b.dataset.teamNewrole); toast('Role updated','success'); renderTeamView(); }
    catch(e){ toast(e.message||'Could not change role','error'); }
  }));
  // ── Presence: who's active now (heartbeat) ──
  const drawPresence=(present)=>{
    const el=$('team-presence'); if(!el) return;
    const list=(present&&present.length)?present:(team.members||[]).map(m=>({email:m.email,name:m.email.split('@')[0],active:m.email===(S.user?.email||'').toLowerCase()}));
    el.innerHTML=list.map(p=>{
      const nm=p.name||p.email.split('@')[0]; const ini=(nm[0]||'?').toUpperCase();
      return '<span class="pres-chip'+(p.active?' on':'')+'" title="'+escH(p.email)+(p.active?' \u00b7 active now':' \u00b7 offline')+'"><span class="pres-av">'+escH(ini)+'</span>'+escH(nm)+(p.active?'<span class="pres-dot"></span>':'')+'</span>';
    }).join('');
  };
  drawPresence(null);
  if(AMVTeam.enabled()) AMVTeam.startPresence(drawPresence);

  // ── Shared library ──
  const drawShared=(shared)=>{
    const el=$('team-shared'); if(!el) return;
    if(!shared||!shared.length){ el.innerHTML='<div style="color:var(--mu);font-size:12.5px;padding:6px 0">Nothing shared yet. Share a project or prompt so your whole team can use it.</div>'; return; }
    const _tsvg=(p)=>'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>';
    const kindIc={project:_tsvg('<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>'),prompt:_tsvg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>')};
    el.innerHTML='<div class="team-shared-list">'+shared.map(s=>'<div class="team-shared-row"><span class="tsr-ic">'+(kindIc[s.kind]||_tsvg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'))+'</span>'+
      '<div class="tsr-main"><b>'+escH(s.title)+'</b><span>'+escH(s.kind)+' \u00b7 by '+escH(s.byName||(s.by||'').split('@')[0])+'</span></div>'+
      '<button class="btn bs tsr-use" data-tsr-use="'+s.id+'" style="font-size:11px">Use</button>'+
      '<button class="team-x" data-tsr-del="'+s.id+'" title="Remove">\u00d7</button></div>').join('')+'</div>';
    el.querySelectorAll('[data-tsr-use]').forEach(b=>on(b,'click',()=>{
      const s=shared.find(x=>x.id===b.dataset.tsrUse); if(!s) return;
      if(s.kind==='prompt' && s.item){ S.prompts=S.prompts||[]; S.prompts.unshift({id:'p'+Date.now(),title:s.item.title||s.title,body:s.item.body||s.item.text||'',ts:Date.now()}); store('amv_pl',S.prompts); toast('Added to your prompts','success'); }
      else if(s.kind==='project' && s.item){ S.workspaces=S.workspaces||[]; S.workspaces.unshift(Object.assign({id:'w'+Date.now()},s.item)); store('amv_ws',S.workspaces); toast('Added to your projects','success'); }
    }));
    el.querySelectorAll('[data-tsr-del]').forEach(b=>on(b,'click',async()=>{
      try{ const ns=await AMVTeam.unshare(b.dataset.tsrDel); drawShared(ns); toast('Removed','info'); }catch(e){ toast(e.message||'Could not remove','error'); }
    }));
  };
  // A rejected fetch here used to leave the panel blank with no explanation.
  if(AMVTeam.enabled()){
    AMVTeam.shared().then(drawShared).catch(e=>{
      drawShared([]);
      try{ toast('Could not load shared team items. Check your connection and try again.','error',4500); }catch(_){}
      try{ _logErr('team.shared', e); }catch(_){}
    });
  } else { drawShared([]); }
  const _sharePicker=(kind)=>{
    const items = kind==='prompt' ? (S.prompts||[]) : (S.workspaces||[]);
    if(!items.length){ toast('You have no '+(kind==='prompt'?'prompts':'projects')+' to share yet','info'); return; }
    const r=$('ovr'); if(!r) return;
    r.innerHTML='<div class="ov" id="shp-bg"><div class="ob" onclick="event.stopPropagation()" style="max-width:440px"><button class="oc" onclick="closeOvr()">\u00d7</button>'+
      '<h2 style="margin-bottom:4px">Share a '+kind+'</h2><p class="ob-sub" style="margin-bottom:14px">Everyone on your team will be able to use it.</p>'+
      '<div class="shp-list">'+items.map((it,i)=>'<button class="shp-item" data-shp="'+i+'">'+escH(it.title||it.name||('Untitled '+kind))+'</button>').join('')+'</div></div></div>';
    on($('shp-bg'),'click',closeOvr);
    r.querySelectorAll('[data-shp]').forEach(b=>on(b,'click',async()=>{
      const it=items[+b.dataset.shp]; closeOvr();
      try{ const ns=await AMVTeam.share(kind, it); drawShared(ns); toast('Shared with your team','success'); }
      catch(e){ toast(e.message||'Could not share','error'); }
    }));
  };
  on($('team-share-project'),'click',()=>_sharePicker('project'));
  on($('team-share-prompt'),'click',()=>_sharePicker('prompt'));

  // load + wire the assigned-work board
  _loadTeamTasks(team, role, myEmail);
}

const _TASK_LABEL={todo:'To do',in_progress:'In progress',done:'Done'};
const _PRIO_C={high:'var(--red,#ff4d4d)',normal:'var(--mu,#9a9085)',low:'var(--dim,#5f574d)'};
async function _loadTeamTasks(team, role, myEmail){
  const canManage = role==='owner'||role==='admin';
  const board=$('tt-board'); if(!board) return;
  let data; try{ data=await AMVTeam.tasks(); }catch(e){ data={tasks:[]}; }
  const tasks=data.tasks||[];
  const render=()=>{
    const el=$('tt-board'); if(!el) return;
    if(!tasks.length){ el.innerHTML='<div style="color:var(--mu);font-size:12px;padding:8px 0">No tasks yet - assign the first one above.</div>'; return; }
    const cols=['todo','in_progress','done'];
    el.innerHTML='<div class="tt-cols">'+cols.map(st=>{
      const items=tasks.filter(t=>t.status===st);
      return '<div class="tt-col"><div class="tt-col-h">'+_TASK_LABEL[st]+' <span class="tt-count">'+items.length+'</span></div>'+
        (items.length?items.map(t=>{
          const mine=t.assignee===myEmail, canMove=canManage||mine||t.createdBy===myEmail;
          return '<div class="tt-card">'+
            '<div class="tt-card-t">'+escH(t.title)+'</div>'+
            (t.notes?'<div class="tt-card-n">'+escH(t.notes)+'</div>':'')+
            '<div class="tt-card-m"><span class="tt-prio" style="color:'+(_PRIO_C[t.priority]||_PRIO_C.normal)+'">\u25cf '+t.priority+'</span>'+
              '<span class="tt-asg">'+(t.assignee?escH(t.assignee.split('@')[0]):'unassigned')+'</span></div>'+
            (canMove?'<div class="tt-card-a">'+
              (st!=='todo'?'<button class="tt-mini" data-tt-move="'+t.id+'" data-tt-to="'+(st==='done'?'in_progress':'todo')+'">\u2190</button>':'')+
              (st!=='done'?'<button class="tt-mini" data-tt-move="'+t.id+'" data-tt-to="'+(st==='todo'?'in_progress':'done')+'">'+(st==='todo'?'Start':'Done')+' \u2192</button>':'')+
              ((canManage||t.createdBy===myEmail)?'<button class="tt-mini tt-del" data-tt-del="'+t.id+'" title="Delete">\u00d7</button>':'')+
            '</div>':'')+
          '</div>';
        }).join(''):'<div class="tt-empty">-</div>')+
      '</div>';
    }).join('')+'</div>';
    el.querySelectorAll('[data-tt-move]').forEach(b=>on(b,'click',async()=>{
      try{ const nt=await AMVTeam.taskUpdate(b.dataset.ttMove,{status:b.dataset.ttTo}); tasks.length=0; tasks.push(...nt); render(); }
      catch(e){ toast(e.message||'Could not update','error'); }
    }));
    el.querySelectorAll('[data-tt-del]').forEach(b=>on(b,'click',async()=>{
      if(!confirm('Delete this task?')) return;
      try{ const nt=await AMVTeam.taskUpdate(b.dataset.ttDel,{del:true}); tasks.length=0; tasks.push(...nt); render(); }
      catch(e){ toast(e.message||'Could not delete','error'); }
    }));
  };
  render();

  on($('tt-add'),'click',async()=>{
    const title=$('tt-title')?.value.trim(), asg=$('tt-assignee')?.value||'', prio=$('tt-priority')?.value||'normal';
    if(!title){ toast('Enter a task','error'); return; }
    const btn=$('tt-add'); if(btn){btn.disabled=true;btn.textContent='Assigning\u2026';}
    try{
      const nt=await AMVTeam.taskCreate(title,asg,'',prio);
      tasks.length=0; tasks.push(...nt);
      if($('tt-title')) $('tt-title').value='';
      render();
      toast(asg?('Assigned to '+asg.split('@')[0]):'Task added','success');
    }catch(e){ toast(e.message||'Could not assign','error'); }
    if(btn){btn.disabled=false;btn.textContent='Assign';}
  });
  // load the audit log (managers only)
  if(role==='owner'||role==='admin'){
    AMVTeam.audit().then(log=>{
      const el=$('team-audit'); if(!el) return;
      if(!log.length){ el.innerHTML='<div style="color:var(--mu);font-size:12px;padding:8px 0">No activity yet.</div>'; return; }
      const _act={team_created:'created the team',member_invited:'invited',member_joined:'joined',member_removed:'removed',role_changed:'changed a role',task_created:'assigned a task',task_status:'moved a task',task_reassigned:'reassigned a task',task_deleted:'deleted a task'};
      el.innerHTML='<div class="team-log">'+log.slice(0,30).map(e=>{
        const when=new Date(e.t).toLocaleString();
        let what=_act[e.action]||e.action;
        if(e.invitee) what+=' '+escH(e.invitee);
        if(e.target) what+=' '+escH(e.target);
        if(e.title) what+=' \u201c'+escH(e.title)+'\u201d';
        if(e.to) what+=' \u2192 '+escH(e.to);
        if(e.from&&e.to) what+=' ('+e.from+' \u2192 '+e.to+')';
        return '<div class="team-log-row"><span class="team-log-who">'+escH(e.actor||'')+'</span> <span class="team-log-what">'+what+'</span> <span class="team-log-when">'+when+'</span></div>';
      }).join('')+'</div>';
    });
  }
}
/* Auto-redeem a team invite from ?invite=token */
function _checkTeamInvite(){
  try{
    /* An invite arriving before Teams is available was written to
       'amv_pending_invite' and never read by anything, so it was simply lost:
       the link had been used up, the person was in no team, and nothing said
       why. It is picked up here on the next run, once Teams is available. */
    const t=new URLSearchParams(location.search).get('invite')||loadStr('amv_pending_invite')||'';
    if(!t) return;
    if(!AMVTeam.enabled()){ saveStr('amv_pending_invite', t); return; }
    /* Consumed before the attempt, so a token that turns out to be expired
       cannot sit here being retried on every load forever. */
    try{ saveStr('amv_pending_invite',''); }catch(e){}
    /* A failed join is exactly the moment the user needs to be told. Silence
       here left somebody staring at an app that looked identical to before,
       with no idea the invite had expired or was sent to another address. */
    AMVTeam.join(t).then(()=>{ toast('You\u2019ve joined the team!','success'); setTab('team'); })
      .catch(e=>{ toast(e&&e.message?e.message:'That invite could not be used. Ask for a new one.','error',6000); });
  }catch(e){}
}
window.renderTeamView=renderTeamView;

/* =====================================================================
   MARKETPLACE (auditor #12) - agent / prompt / crew template store.
   The network-effect mechanic: anyone can PUBLISH a template, everyone can
   DISCOVER and INSTALL it (install counts rank them). Ships with a curated
   starter set so it's useful on day one, then community submissions layer on
   top via the backend. Installing a template drops it into the user's Prompt
   Library / Crew instantly.
   ===================================================================== */
const MARKET_STARTER = [
  {id:'mk_seo', kind:'prompt', cat:'Marketing', title:'SEO Blog Writer', author:'AMV', installs:0, sales:0, price:0, rating:0, ratings:0, icon:'\u{1F4C8}',
   desc:'Writes a fully-optimized, ready-to-publish blog post with headings, meta description, and keywords.',
   preview:'Produces an SEO title, meta description, H2/H3 structure, and keyword-placed body - paste your topic and keyword and go.',
   text:'Write a complete SEO-optimized blog post about [TOPIC]. Include: an SEO title under 60 chars, a meta description under 155 chars, H2/H3 headings, naturally placed keywords for [KEYWORD], a compelling intro, scannable body with examples, and a conclusion with a call to action.'},
  {id:'mk_cold', kind:'prompt', cat:'Sales', title:'Cold Email That Converts', author:'AMV', installs:0, sales:0, price:0, rating:0, ratings:0, icon:'\u2709\uFE0F',
   desc:'Generates a short, high-reply cold outreach email tailored to a prospect.',
   preview:'Outputs a sub-120-word cold email with a specific opener, one value prop, a soft ask, and 2 subject lines.',
   text:'Write a cold outreach email to [PROSPECT ROLE] at [COMPANY]. Keep it under 120 words, lead with a specific observation about their business, present one clear value proposition for [YOUR PRODUCT], and end with a low-friction ask. Give 2 subject line options.'},
  {id:'mk_finance', kind:'integration', cat:'Finance', title:'Excel Finance Model Pack', author:'AMV', installs:0, sales:0, price:29, rating:0, ratings:0, icon:'\u{1F4CA}',
   desc:'A set of AMV prompts + an Excel workflow that builds 3-statement models, forecasts, and valuation tabs from your raw numbers.',
   preview:'Buyers get: a guided AMV prompt that turns a revenue/cost table into a linked 3-statement model, a DCF tab, and a one-page summary - plus the exact Excel formulas to paste in. (Full deliverable unlocks after purchase.)',
   text:'You are an FP&A expert. From the financial data I paste, build a complete 3-statement model (income statement, balance sheet, cash flow) with monthly granularity. Then add: a DCF valuation tab with WACC and terminal value, a sensitivity table, and a one-page executive summary. Output the exact Excel formulas for each cell range so I can paste them directly. Data:\\n\\n[PASTE YOUR NUMBERS]'},
  {id:'mk_legal', kind:'prompt', cat:'Business', title:'Contract Plain-English Explainer', author:'AMV', installs:0, sales:0, price:9, rating:0, ratings:0, icon:'\u2696\uFE0F',
   desc:'Paste any contract clause and get a plain-English explanation with risks flagged.',
   preview:'Returns: what the clause means, your obligations, red flags, and questions to ask before signing. (Full prompt unlocks after purchase.)',
   text:'Explain the following contract text in plain English. List: 1) what it actually means, 2) any obligations it puts on me, 3) red flags or unusual terms, 4) questions I should ask before signing. This is not legal advice.\\n\\n[CONTRACT TEXT]'},
  {id:'mk_study', kind:'prompt', cat:'Education', title:'Study Plan Generator', author:'AMV', installs:0, sales:0, price:0, rating:0, ratings:0, icon:'\u{1F4DA}',
   desc:'Builds a personalized day-by-day study schedule for any exam or skill.',
   preview:'Outputs a day-by-day plan with topics, practice, milestones, and a final review window.',
   text:'Create a detailed study plan to learn [SUBJECT] in [TIMEFRAME]. Break it into daily sessions with specific topics, practice exercises, milestones, and a final review. Assume [HOURS] hours per day available.'},
  {id:'mk_crew_launch', kind:'crew', cat:'Business', title:'Product Launch Crew', author:'AMV', installs:0, sales:0, price:19, rating:0, ratings:0, icon:'\u{1F680}',
   desc:'A 4-agent crew: market research, positioning, launch copy, and a go-to-market checklist.',
   preview:'A coordinated 4-agent workflow (Researcher \u2192 Strategist \u2192 Copywriter \u2192 GTM Planner). Full crew config unlocks after purchase.',
   crew:[{role:'Market Researcher',task:'Research the target market, competitors, and audience for [PRODUCT].'},{role:'Positioning Strategist',task:'Define positioning, key messages, and differentiation.'},{role:'Copywriter',task:'Write launch announcement, landing page copy, and 3 social posts.'},{role:'GTM Planner',task:'Produce a launch checklist with timeline and channels.'}]},
  {id:'mk_crew_content', kind:'crew', cat:'Marketing', title:'Content Factory Crew', author:'AMV', installs:0, sales:0, price:0, rating:0, ratings:0, icon:'\u{1F3ED}',
   desc:'Turns one idea into a blog post, newsletter, and a week of social posts.',
   preview:'4 agents take one topic to a blog post, a newsletter, and 7 social posts.',
   crew:[{role:'Researcher',task:'Gather facts and angles on [TOPIC].'},{role:'Blog Writer',task:'Write a 1000-word post.'},{role:'Newsletter Editor',task:'Adapt it into a newsletter.'},{role:'Social Manager',task:'Create 7 platform-tailored social posts.'}]},
];

const AMVMarket = {
  _remote:null,
  _live(){ try{ return !!(window.AMV_API && AMV_API.live && AMV_API.token); }catch(e){ return false; } },
  _me(){ return ((S.user&&S.user.email)||'you@amv.local').toLowerCase(); },
  _meName(){ return (S.user&&S.user.name)||'You'; },
  // --- local stores (used when there's no backend) ---
  // Listings + reviews are a SHARED catalog (global). Purchases, wallet, and
  // ratings are per-buyer, keyed by email inside the shared map so each user
  // sees only their own while the catalog stays common (mirrors the backend).
  _localListings(){ return load('amv_market_local')||[]; },
  _saveLocalListings(v){ store('amv_market_local',v); },
  _localPurchases(){ const m=load('amv_market_purchases')||{}; return m[this._me()]||[]; },
  _saveLocalPurchases(v){ const m=load('amv_market_purchases')||{}; m[this._me()]=v; store('amv_market_purchases',m); },
  _localWallet(){ const m=load('amv_market_wallet')||{}; return m[this._me()]||{balance:0,lifetime:0,tx:[]}; },
  _saveLocalWallet(v){ const m=load('amv_market_wallet')||{}; m[this._me()]=v; store('amv_market_wallet',m); },
  _localRatings(){ const m=load('amv_market_ratings')||{}; return m[this._me()]||{}; },   // {id: myStars}
  _saveLocalRatings(v){ const m=load('amv_market_ratings')||{}; m[this._me()]=v; store('amv_market_ratings',m); },

  async list(){
    let remote=[];
    /* Whether the community half of the catalogue actually loaded.

       This used to swallow the failure and return the built-in listings alone,
       which renders a marketplace that looks complete and is not: everything
       other people published is missing, and nothing on screen can be bought
       because checkout needs the same server that just refused. Silently
       showing a partial shop as a whole one is the shape of dishonesty this
       product is not allowed to have, so the failure is recorded and said. */
    this._remoteFailed=false;
    if(this._live()){
      try{
        const r=await AMV_API._fetch('/v1/market/list',{method:'GET'});
        const d=await r.json().catch(()=>null);
        if(d&&Array.isArray(d.items)) remote=d.items; else this._remoteFailed=true;
      }catch(e){ this._remoteFailed=true; }
    }
    const installed=load('amv_market_installed')||{};
    const localPub=this._localListings();
    const owned=new Set(this._localPurchases().map(p=>p.id));
    const myRatings=this._localRatings();
    const me=this._me();
    const seen={}, out=[];
    for(const it of [...remote, ...localPub, ...MARKET_STARTER]){
      if(seen[it.id]) continue; seen[it.id]=1;
      const mine=(it.authorEmail||'').toLowerCase()===me;
      // only Active listings appear in the public catalog; owners still see their own via My listings
      if(it.status && it.status!=='active' && !mine) continue;
      out.push({...it,
        _installed:!!installed[it.id],
        _owned: owned.has(it.id),
        _mine: mine,
        _myRating: myRatings[it.id]||0,
      });
    }
    return out.filter(it=>!(it.status && it.status!=='active' && !it._owned && !it._mine));
  },
  async publish(item){
    // AMV-only guard applies in both modes
    const blob=((item.title||'')+' '+(item.desc||'')+' '+(item.text||'')).toLowerCase();
    const banned=['claude','anthropic','openai','chatgpt','gpt-4','gpt-5','gemini','copilot','grok','llama','mistral','perplexity'];
    const hit=banned.find(b=>blob.includes(b));
    if(hit) throw new Error('Listings must be AMV-only - remove references to other AI products ('+hit+').');
    // Deliverable backstop: no empty shells / fake listings.
    try{ if(typeof _mktDeliverableOK==='function'){ const d=_mktDeliverableOK(item); if(!d.ok) throw new Error(d.reason); } }catch(e){ if(e&&e.message) throw e; }
    // Content screening runs in BOTH modes. On the server it's authoritative and
    // can't be bypassed; here it also guards local/offline mode.
    try{
      if(typeof _mktScreen==='function'){
        const sc=_mktScreen(item, (typeof _mktVerifiedFor==='function'?_mktVerifiedFor():[]));
        if(!sc.ok) throw new Error(sc.reason||'This listing violates the marketplace rules.');
      }
    }catch(e){ if(e&&e.message) throw e; }
    if(this._live()){
      const r=await AMV_API._fetch('/v1/market/publish',{method:'POST',body:JSON.stringify(item)});
      const d=await r.json(); if(d.error) throw new Error(d.error); return d.item;
    }
    // local mode: save on device (files travel as data URLs inside the listing)
    const clean={ ...item, id:'usr_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),
      author:this._meName(), authorEmail:this._me(), installs:0, sales:0, rating:0, ratings:0,
      status:'active', views:0, files:Array.isArray(item.files)?item.files:[], createdAt:Date.now() };
    const list=this._localListings(); list.unshift(clean); this._saveLocalListings(list);
    return clean;
  },
  // update a listing's status (active | sold | deactivated). Owner only, local mode.
  async setStatus(id, status){
    if(this._live()){
      try{ const r=await AMV_API._fetch('/v1/market/status',{method:'POST',body:JSON.stringify({id,status})}); const d=await r.json(); if(d.error) throw new Error(d.error); return d; }catch(e){ throw e; }
    }
    const list=this._localListings(); const it=list.find(x=>x.id===id);
    if(!it) throw new Error('Listing not found'); if((it.authorEmail||'').toLowerCase()!==this._me()) throw new Error('Not your listing');
    it.status=status; this._saveLocalListings(list); return {ok:true, status};
  },
  // record a view (deduped-ish; bumps the owner's analytics). Fire-and-forget.
  view(id){
    try{
      if(this._live()){ AMV_API._fetch('/v1/market/view',{method:'POST',body:JSON.stringify({id})}).catch(()=>{}); return; }
      const list=this._localListings(); const it=list.find(x=>x.id===id);
      if(it){ it.views=(it.views||0)+1; this._saveLocalListings(list); }
    }catch(e){}
  },
  async install(item){
    const installed=load('amv_market_installed')||{}; installed[item.id]=Date.now(); store('amv_market_installed',installed);
    try{ if(this._live()){ AMV_API._fetch('/v1/market/install',{method:'POST',body:JSON.stringify({id:item.id})}).catch(()=>{}); } }catch(e){}
    // Everything you get - free or paid - is recorded as OWNED so it shows in
    // Purchases, the one place your items live.
    this._markOwned(item);
    if(item.kind==='crew' || item.kind==='workflow'){
      const me=this._me();
      const crews=load('amv_saved_crews')||[];
      // A structured crew (agents) if the listing has one; otherwise build it from
      // the listing's actual text so a bought crew ALWAYS has something to run.
      const agents=(item.crew&&item.crew.length)
        ? item.crew.map(a=>({role:a.role,task:_mktPersonalize(a.task,item.authorEmail,me)}))
        : [];
      const goal=_mktPersonalize(item.text||item.desc||'', item.authorEmail, me);
      crews.unshift({id:'c'+Date.now(),title:item.title,agents,goal,kind:item.kind,fromMarket:true,seller:item.author||'',ts:Date.now()});
      store('amv_saved_crews',crews);
    } else {
      S.prompts.unshift({id:'p'+Date.now(),title:item.title,cat:item.cat||(item.kind==='integration'?'Integrations':item.kind==='workflow'?'Workflows':item.kind==='guide'?'Guides':'Imported'),text:item.text||item.desc||'',custom:true});
      store('amv_pl',S.prompts);
    }
  },
  _markOwned(item){
    try{ const p=this._localPurchases(); if(!p.some(x=>x.id===item.id)){ p.unshift({id:item.id,title:item.title,kind:item.kind,price:item.price||0,ts:Date.now()}); this._saveLocalPurchases(p); } }catch(e){}
  },
  // resolve the full listing (with deliverable) for an id, from any source
  async _resolve(id){
    const all=[...this._localListings(), ...MARKET_STARTER];
    let it=all.find(x=>x.id===id);
    if(it) return it;
    if(this._live()){ try{ const items=await this.purchases(); it=items.find(x=>x.id===id); }catch(e){} }
    return it||null;
  },
  // ---- paid marketplace ----
  async buy(id){
    if(this._live()){
      let r=await AMV_API._fetch('/v1/market/buy',{method:'POST',body:JSON.stringify({id})});
      let d=await r.json();
      /* The server refuses money until it knows the buyer is an adult, and for
         everybody who signed up before that existed the answer is simply
         missing. That is a question, not a refusal - so it gets asked HERE, at
         the moment it matters, rather than leaving somebody to discover a
         settings pane they had no reason to open. Asked once, ever. */
      if(d && d.code==='age_required'){
        const got = await _askBirthYear();
        if(!got) throw new Error('AMV needs your year of birth before it can buy anything.');
        r=await AMV_API._fetch('/v1/market/buy',{method:'POST',body:JSON.stringify({id})});
        d=await r.json();
      }
      if(d.error) throw new Error(d.error); return d;   // {url} → external checkout
    }
    // local/demo mode: complete the purchase on-device, credit the seller 80%
    const it=await this._resolve(id);
    if(!it) throw new Error('Item not found');
    const sellerEmail=(it.authorEmail||'').toLowerCase();
    if(sellerEmail===this._me()){
      try{ if(typeof AMVFraud!=='undefined') AMVFraud.record({type:'purchase', subject:this._me(), amount:it.price||0, category:'wash_trading', signals:{self_purchase:true}, entities:{accounts:[this._me()], transactions:[id]}}); }catch(e){}
      throw new Error('You cannot buy your own listing');
    }
    // PAYMENT GATE: a paid item can only be completed through real checkout
    // (the live backend returns a Stripe URL above). On-device there is no
    // payment processor, so paid items must NOT be handed over for free -
    // route the buyer to add a payment method. Free items continue instantly.
    if((it.price||0) > 0){
      const e=new Error('This item costs $'+it.price+'. Add a payment method to buy it - free items are added instantly.');
      e.code='needs_payment'; throw e;
    }
    // one-of-a-kind: a user listing already marked sold is gone
    const isUserListing=/^usr_/.test(id);
    if(isUserListing && it.status==='sold') throw new Error('Sorry - this just sold. Message the seller to ask for another.');
    const purch=this._localPurchases();
    if(purch.some(p=>p.id===id)) return {ok:true, owned:true, local:true};
    purch.unshift({id, title:it.title, kind:it.kind, price:it.price||0, ts:Date.now()});
    this._saveLocalPurchases(purch);
    // credit the seller's wallet 80% (keyed by seller email in the shared store)
    const price=it.price||0;
    if(sellerEmail && price>0){
      const share=+(price*0.8).toFixed(2);
      const m=load('amv_market_wallet')||{};
      const w=m[sellerEmail]||{balance:0,lifetime:0,tx:[]};
      w.balance=+((w.balance||0)+share).toFixed(2);
      w.lifetime=+((w.lifetime||0)+share).toFixed(2);
      w.tx=[{type:'sale',amount:share,gross:price,item:id,title:it.title,buyer:this._me(),ts:Date.now()},...(w.tx||[])];
      m[sellerEmail]=w; store('amv_market_wallet',m);
    }
    // bump sale count; user listings are one-of-a-kind → mark SOLD (leaves public browse)
    const local=this._localListings(); const li=local.find(x=>x.id===id);
    if(li){ li.sales=(li.sales||0)+1; if(isUserListing) li.status='sold'; this._saveLocalListings(local); }
    return {ok:true, local:true, sold:isUserListing};
  },
  async purchases(){
    if(this._live()){
      /* A failed request is not "you have bought nothing". Answering it that way
         showed somebody an empty Purchases screen for things they had paid for,
         and _resolve then treated a paid item they own as unowned. */
      const r=await AMV_API._fetch('/v1/market/purchases',{method:'POST',body:'{}'});
      const d=await r.json().catch(()=>null);
      if(!d || d.error || !Array.isArray(d.items)) throw new Error((d&&d.error)||'Could not load your purchases.');
      return d.items;
    }
    // local: hydrate each purchase with its full deliverable
    const purch=this._localPurchases();
    const all=[...this._localListings(), ...MARKET_STARTER];
    return purch.map(p=>{ const it=all.find(x=>x.id===p.id); return it?{...it,_purchasedAt:p.ts}:{...p,_removed:true}; });
  },
  async myListings(){
    if(this._live()){
      const r=await AMV_API._fetch('/v1/market/mylistings',{method:'POST',body:'{}'});
      const d=await r.json().catch(()=>null);
      if(!d || d.error || !Array.isArray(d.items)) throw new Error((d&&d.error)||'Could not load your listings.');
      return d.items;
    }
    const me=this._me();
    return this._localListings().filter(it=>(it.authorEmail||'').toLowerCase()===me);
  },
  async unlist(id){
    if(this._live()){
      const r=await AMV_API._fetch('/v1/market/unlist',{method:'POST',body:JSON.stringify({id})}); const d=await r.json(); if(d.error) throw new Error(d.error); return d;
    }
    this._saveLocalListings(this._localListings().filter(x=>x.id!==id)); return {ok:true};
  },
  async earnings(){
    if(this._live()){
      /* This used to answer a failed request with a balance of ZERO, so a seller
         with money in the account was shown $0 owed to them, indistinguishable
         from having earned nothing. A wrong number on a payout screen is worse
         than no screen at all. */
      const r=await AMV_API._fetch('/v1/market/earnings',{method:'POST',body:'{}'});
      const d=await r.json().catch(()=>null);
      if(!d || d.error || typeof d.balance !== 'number') throw new Error((d&&d.error)||'Could not load your earnings.');
      return d;
    }
    const w=this._localWallet();
    return {ok:true, balance:w.balance||0, lifetime:w.lifetime||0, sellerPct:80, minWithdraw:10, tx:w.tx||[], local:true};
  },
  async withdraw(destination){
    if(this._live()){
      const r=await AMV_API._fetch('/v1/market/withdraw',{method:'POST',body:JSON.stringify({destination})}); const d=await r.json(); if(d.error) throw new Error(d.error); return d;
    }
    const w=this._localWallet();
    if((w.balance||0)<10) throw new Error('Minimum withdrawal is $10. Your balance is $'+(w.balance||0).toFixed(2)+'.');
    const amount=w.balance;
    try{ if(typeof AMVFraud!=='undefined'){ const selfDeal=(w.tx||[]).some(t=>t.type==='sale'&&(t.buyer||'').toLowerCase()===this._me()); AMVFraud.record({type:'payout', subject:this._me(), amount, signals:{payout_after_selfbuy:!!selfDeal}, entities:{accounts:[this._me()]}}); } }catch(e){}
    w.tx=[{type:'withdrawal',amount:-amount,status:'pending',ts:Date.now()},...(w.tx||[])]; w.balance=0; this._saveLocalWallet(w);
    return {ok:true, amount, status:'pending', local:true};
  },
  // ---- ratings ----
  async rate(id, stars){
    // Rating manipulation guard: you can't rate your own listing (the server
    // enforces this too; this is defense-in-depth on the client).
    try{ const own=[...this._localListings(), ...MARKET_STARTER].find(x=>x.id===id);
      if(own && (own.authorEmail||'').toLowerCase()===this._me()){ if(typeof toast==='function') toast('You can’t rate your own listing','info'); return false; } }catch(e){}
    const ratings=this._localRatings(); ratings[id]=stars; this._saveLocalRatings(ratings);
    if(this._live()){ try{ AMV_API._fetch('/v1/market/rate',{method:'POST',body:JSON.stringify({id,stars})}).catch(()=>{}); }catch(e){} }
    return true;
  },
  // ---- seller reviews (rate the PERSON you bought from, 1-5 + written review) ----
  _allReviews(){ return load('amv_market_reviews')||{}; },   // { sellerEmail: [ {by,byName,stars,text,ts} ] }
  _saveAllReviews(v){ store('amv_market_reviews',v); },
  sellerReviews(sellerEmail){ const all=this._allReviews(); return all[(sellerEmail||'').toLowerCase()]||[]; },
  sellerRating(sellerEmail){
    const rv=this.sellerReviews(sellerEmail);
    if(!rv.length) return {avg:0,count:0};
    const sum=rv.reduce((a,r)=>a+(r.stars||0),0);
    return {avg:+(sum/rv.length).toFixed(1), count:rv.length};
  },
  myReviewFor(sellerEmail){ return this.sellerReviews(sellerEmail).find(r=>(r.by||'').toLowerCase()===this._me()); },
  // did the current user buy anything from this seller? (gates who can review)
  _boughtFrom(sellerEmail, purch){
    sellerEmail=(sellerEmail||'').toLowerCase();
    const all=[...this._localListings(), ...MARKET_STARTER];
    return (purch||[]).some(p=>{ const it=p.authorEmail?p:all.find(x=>x.id===p.id); return it&&(it.authorEmail||'').toLowerCase()===sellerEmail; });
  },
  /* Used to decorate a seller's profile, so a purchases read that fails must
     not stop the profile opening. Unknown answers FALSE - it is also the gate
     on reviewing a seller, and there the safe reading of "we could not check"
     is "no", never "yes". */
  async boughtFrom(sellerEmail){
    try{ return this._boughtFrom(sellerEmail, await this.purchases()); }
    catch(e){ return false; }
  },
  async reviewSeller(sellerEmail, stars, text){
    sellerEmail=(sellerEmail||'').toLowerCase();
    if(sellerEmail===this._me()) throw new Error('You can\u2019t review yourself.');
    /* Read directly rather than through boughtFrom, so a request that FAILED is
       reported as a failure instead of as "you never bought from them" - which
       would accuse somebody of something untrue about their own account. */
    if(!this._boughtFrom(sellerEmail, await this.purchases()))
      throw new Error('You can only review sellers you\u2019ve bought from.');
    const all=this._allReviews(); const list=all[sellerEmail]||[];
    const mine=list.find(r=>(r.by||'').toLowerCase()===this._me());
    const entry={ by:this._me(), byName:this._meName(), stars:Math.max(1,Math.min(5,stars||0)), text:String(text||'').slice(0,1000), ts:Date.now() };
    if(mine){ Object.assign(mine, entry); } else { list.unshift(entry); }
    all[sellerEmail]=list; this._saveAllReviews(all);
    if(this._live()){ try{ AMV_API._fetch('/v1/market/review',{method:'POST',body:JSON.stringify({seller:sellerEmail,stars:entry.stars,text:entry.text})}).catch(()=>{}); }catch(e){} }
    return entry;
  },
  // ---- similar items (same category + close price) ----
  async similar(it, limit){
    limit=limit||4;
    const all=await this.list();
    const price=it.price||0;
    return all.filter(x=>x.id!==it.id && (x.status||'active')==='active' && !x._mine)
      .map(x=>{
        let score=0;
        if((x.cat||'')===(it.cat||'')) score+=100;              // same category is the strongest signal
        score-=Math.abs((x.price||0)-price);                    // closer price = higher
        if(x.kind===it.kind) score+=10;
        return {x,score};
      })
      .filter(o=>o.score>-50)                                    // drop wildly different prices
      .sort((a,b)=>b.score-a.score)
      .slice(0,limit).map(o=>o.x);
  },
  // ---- messaging (buyer <-> seller) ----
  // thread id is deterministic for a pair so both sides share one conversation
  _threadId(a,b){ return 'th_'+[String(a||'').toLowerCase(),String(b||'').toLowerCase()].sort().join('__'); },
  _allThreads(){ return load('amv_market_threads')||{}; },   // { threadId: {a,b,aName,bName,msgs:[{from,text,ts}], read:{email:ts}} }
  _saveThreads(v){ store('amv_market_threads',v); },
  myThreads(){
    const me=this._me(); const all=this._allThreads();
    return Object.values(all).filter(t=>t.a===me||t.b===me)
      .sort((x,y)=>(y.msgs[y.msgs.length-1]?.ts||0)-(x.msgs[x.msgs.length-1]?.ts||0));
  },
  thread(otherEmail){
    otherEmail=(otherEmail||'').toLowerCase();
    const id=this._threadId(this._me(),otherEmail);
    const all=this._allThreads();
    return all[id]||{ id, a:this._me(), b:otherEmail, msgs:[], read:{} };
  },
  async sendMessage(otherEmail, text, otherName){
    otherEmail=(otherEmail||'').toLowerCase();
    if(otherEmail===this._me()) throw new Error('You can\u2019t message yourself.');
    text=String(text||'').trim(); if(!text) throw new Error('Message is empty');
    const id=this._threadId(this._me(),otherEmail);
    const all=this._allThreads();
    let t=all[id];
    if(!t){ t={ id, a:this._me(), b:otherEmail, aName:this._meName(), bName:otherName||otherEmail.split('@')[0], msgs:[], read:{} }; }
    // keep names fresh
    if(t.a===this._me()) t.aName=this._meName(); else t.bName=this._meName();
    t.msgs.push({ from:this._me(), text:text.slice(0,2000), ts:Date.now() });
    t.read=t.read||{}; t.read[this._me()]=t.msgs.length;
    all[id]=t; this._saveThreads(all);
    if(this._live()){ try{ AMV_API._fetch('/v1/market/message',{method:'POST',body:JSON.stringify({to:otherEmail,text})}).catch(()=>{}); }catch(e){} }
    return t;
  },
  markThreadRead(otherEmail){
    const id=this._threadId(this._me(),otherEmail);
    const all=this._allThreads(); const t=all[id]; if(!t) return;
    t.read=t.read||{}; t.read[this._me()]=t.msgs.length; all[id]=t; this._saveThreads(all);
  },
  unreadCount(){
    const me=this._me();
    return this.myThreads().reduce((n,t)=>{
      const last=t.msgs[t.msgs.length-1];
      const seenCount=(t.read&&typeof t.read[me]==='number')?t.read[me]:0;
      // unread if there are messages I haven't seen AND the newest isn't mine
      if(last && last.from!==me && t.msgs.length>seenCount) return n+1;
      return n;
    },0);
  },
};
window.AMVMarket=AMVMarket;

