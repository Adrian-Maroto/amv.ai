/* SKILLS AND PLUGINS - the Skills screen in Settings: the skill editor with
   its version history and files, and plugins.

   Fetched the first time Skills is drawn, or a plugin is installed from the
   marketplace (_skillsLoad in 12-handoff.js), the way the sell form and the
   memory window are. A classic script, so it lands on window and uses the
   page's own helpers. What a chat is told about skills and plugins
   (_skillsContext, _pluginSkillsContext) stays in the page, because every
   message needs it and this file is only for the screen. */

/* ── SKILLS: edited, versioned, shared as a file ────────────────────────────
   A skill is a name, what it is for, its instructions, and whether it is
   always on or used only when relevant. Every save keeps the version before
   it; restoring an old version is itself a new version, so nothing is lost.
   A skill exported is a small JSON file; importing one shows its full text
   before it is added, because what it says goes into AMV's instructions. */
const SKILL_INSTR_MAX = 4000, SKILL_HISTORY_MAX = 20;
function _skillSave(id, patch){
  const list=_loadSkills(), sk=list.find(x=>x.id===id); if(!sk) return null;
  const same=['name','instr','when','mode'].every(k=>String(patch[k]==null?(sk[k]||''):patch[k])===String(sk[k]||''));
  if(same) return sk;
  sk.history=[{ v:sk.v||1, name:sk.name, instr:sk.instr, when:sk.when||'', mode:sk.mode||'always', at:sk.updated||sk.created||Date.now() }].concat(sk.history||[]).slice(0,SKILL_HISTORY_MAX);
  Object.assign(sk, patch, { v:(sk.v||1)+1, updated:Date.now() });
  sk.desc=String(sk.when||sk.instr).slice(0,80);
  _saveSkills(list);
  return sk;
}
function _skillNew(o){
  const now=Date.now();
  return { id:'sk_'+now+Math.random().toString(36).slice(2,5), name:String(o.name||'').slice(0,60), when:String(o.when||'').slice(0,200),
           instr:String(o.instr||'').slice(0,SKILL_INSTR_MAX), mode:o.mode==='auto'?'auto':'always', desc:String(o.when||o.instr||'').slice(0,80),
           v:1, created:now, updated:now, history:[] };
}
/* A file somebody else wrote: every field is checked for type and size, and
   nothing in it but text is kept. */
function _skillFromFile(txt){
  let o; try{ o=JSON.parse(txt); }catch(e){ return { error:T('That file is not a skill package.') }; }
  if(!o || o.format!=='amv-skill' || typeof o.name!=='string' || typeof o.instr!=='string' || !o.name.trim() || !o.instr.trim())
    return { error:T('That file is not a skill package.') };
  if(o.instr.length > SKILL_INSTR_MAX) return { error:T('That skill is longer than AMV accepts')+' ('+SKILL_INSTR_MAX.toLocaleString()+' '+T('characters')+').' };
  const sk=_skillNew({ name:o.name, when:typeof o.when==='string'?o.when:'', instr:o.instr, mode:o.mode });
  sk.v=Math.max(1, Math.min(9999, parseInt(o.v,10)||1));
  sk.history=(Array.isArray(o.history)?o.history:[]).filter(h=>h && typeof h.instr==='string' && h.instr.length<=SKILL_INSTR_MAX)
    .slice(0,SKILL_HISTORY_MAX).map(h=>({ v:parseInt(h.v,10)||1, name:String(h.name||o.name).slice(0,60), instr:h.instr, when:String(h.when||'').slice(0,200), mode:h.mode==='auto'?'auto':'always', at:+h.at||0 }));
  return { skill:sk };
}
function _skillExport(id){
  const sk=_loadSkills().find(x=>x.id===id); if(!sk) return;
  const pkg={ format:'amv-skill', name:sk.name, when:sk.when||'', instr:sk.instr, mode:sk.mode||'always', v:sk.v||1, history:sk.history||[], exported:new Date().toISOString() };
  const base=String(sk.name).replace(/[^\p{L}\p{N} _-]+/gu,'').trim().replace(/\s+/g,'-').slice(0,50)||'skill';
  _saveBlob(new Blob([JSON.stringify(pkg,null,2)],{type:'application/json'}), base+'.amvskill.json');
}
function _renderSkillsPane(pane){
  const custom=_loadSkills();
  const active=_activeSkillIds();
  const mode=s=>s.mode==='auto'?T('When relevant'):T('Always on');
  const row=(s,isCustom)=>{
    const on=active.indexOf(s.id)>=0;
    return '<div class="skill-row"><div class="skill-info"><div class="skill-name">'+escH(s.name)+(on?' <span class="skill-on">'+escH(T('Active'))+'</span>':'')
        +(isCustom?' <span class="skill-ver">v'+(s.v||1)+' · '+escH(mode(s))+'</span>':'')+'</div>'+
      '<div class="skill-desc">'+escH(s.when||s.desc||'')+'</div>'+
      (isCustom?'<div class="skill-tools"><button type="button" class="skill-link" data-skedit="'+escH(s.id)+'">'+escH(T('Edit'))+'</button>'
        +((s.history||[]).length?'<button type="button" class="skill-link" data-skhist="'+escH(s.id)+'">'+escH(T('History'))+' ('+s.history.length+')</button>':'')
        +'<button type="button" class="skill-link" data-skexp="'+escH(s.id)+'">'+escH(T('Export'))+'</button></div>':'')+
      '</div><div class="skill-acts">'+
        (isCustom?'<button class="skill-del" data-skdel="'+escH(s.id)+'" title="'+escH(T('Delete'))+'" aria-label="'+escH(T('Delete')+' '+s.name)+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>':'')+
        '<label class="sw"><input type="checkbox" data-sktoggle="'+escH(s.id)+'" aria-label="'+escH(s.name)+'" '+(on?'checked':'')+'><span class="sw-sl"></span></label>'+
      '</div></div>';
  };
  pane.innerHTML=
    '<h2 class="set-title">'+escH(T('Skills'))+'</h2>'+
    '<div class="set-sub">'+escH(T('Reusable instructions. Turn one on and AMV follows it in every chat - always, or only when a request is about what the skill is for. Every edit keeps the previous version.'))+'</div>'+
    '<div class="ss2"><h3>'+escH(T('Your skills'))+' <button type="button" class="btn mc-mini ghost" id="sk-import">'+escH(T('Import'))+'</button></h3>'+
      '<input type="file" id="sk-file" accept=".json,application/json" hidden>'+
      (custom.length?'<div class="skill-list">'+custom.map(s=>row(s,true)).join('')+'</div>':'<div class="skill-empty">'+escH(T('No custom skills yet - create one below, or import a skill file.'))+'</div>')+
      '<div class="skill-create" id="sk-form">'+_skillFormHTML(null)+'</div>'+
    '</div>'+
    '<div class="ss2"><h3>'+escH(T('Presets'))+'</h3>'+
      '<div class="set-sub" style="margin-top:-2px;margin-bottom:12px">'+escH(T('Ready-made skills you can switch on.'))+'</div>'+
      '<div class="skill-list">'+_BUILTIN_SKILLS.map(s=>row(s,false)).join('')+'</div>'+
    '</div>'+
    '<div class="ss2" id="pl-host"></div>';
  _pluginsPane($('pl-host'));
  pane.querySelectorAll('[data-sktoggle]').forEach(cb=>on(cb,'change',function(){
    const id=this.getAttribute('data-sktoggle');
    let a=_activeSkillIds();
    if(this.checked){ if(a.indexOf(id)<0) a.push(id); } else { a=a.filter(x=>x!==id); }
    _setActiveSkills(a); _renderSkillsPane(pane);
  }));
  pane.querySelectorAll('[data-skdel]').forEach(btn=>on(btn,'click',async function(){
    const id=this.getAttribute('data-skdel'), sk=_loadSkills().find(x=>x.id===id);
    /* The question takes the Settings window's place; Settings comes back on Skills either way. */
    const yes=await _askDestructive(T('Delete this skill?'), (sk?'“'+sk.name+'” ':'')+T('and its version history are removed.'), T('Delete'));
    if(yes){ _saveSkills(_loadSkills().filter(s=>s.id!==id)); _setActiveSkills(_activeSkillIds().filter(x=>x!==id)); }
    goSettings('skills');
  }));
  pane.querySelectorAll('[data-skedit]').forEach(b=>on(b,'click',()=>{ const f=$('sk-form'); if(f){ f.innerHTML=_skillFormHTML(b.dataset.skedit); _wireSkillForm(pane, b.dataset.skedit); f.scrollIntoView({block:'nearest'}); const n=$('sk-instr'); if(n) n.focus(); } }));
  pane.querySelectorAll('[data-skexp]').forEach(b=>on(b,'click',()=>_skillExport(b.dataset.skexp)));
  pane.querySelectorAll('[data-skhist]').forEach(b=>on(b,'click',()=>_skillHistory(pane, b.dataset.skhist)));
  on($('sk-import'),'click',()=>{ const i=$('sk-file'); if(i) i.click(); });
  on($('sk-file'),'change',async function(){
    const f=this.files&&this.files[0]; this.value='';
    if(!f) return;
    if(f.size>256*1024){ toast(T('That file is too large to be a skill.'),'error',6000); return; }
    const r=_skillFromFile(await f.text());
    if(r.error){ toast(r.error,'error',7000); return; }
    const yes=await _askDestructive(T('Add this skill?'), '“'+r.skill.name+'” - '+T('it will tell AMV:')+'\n\n'+r.skill.instr.slice(0,1500)+(r.skill.instr.length>1500?'…':''), T('Add skill'), { safe:true });
    if(yes){ _saveSkills(_loadSkills().concat([r.skill])); toast(T('Skill added. Switch it on when you want it.'),'success',4000); }
    goSettings('skills');
  });
  _wireSkillForm(pane, null);
}
function _skillFormHTML(id){
  const sk=id?_loadSkills().find(x=>x.id===id):null;
  return '<div class="skill-form-h">'+escH(sk?T('Edit')+' “'+sk.name+'” · v'+(sk.v||1):T('New skill'))+'</div>'+
    '<input class="inp" id="sk-name" placeholder="'+escH(T('Skill name (e.g. “Legal tone”)'))+'" maxlength="60" value="'+escH(sk?sk.name:'')+'" aria-label="'+escH(T('Skill name'))+'">'+
    '<input class="inp" id="sk-when" placeholder="'+escH(T('What it is for (e.g. “contracts and formal letters”)'))+'" maxlength="200" value="'+escH(sk?sk.when||'':'')+'" aria-label="'+escH(T('What it is for'))+'" style="margin-top:8px">'+
    '<textarea id="sk-instr" rows="4" maxlength="'+SKILL_INSTR_MAX+'" placeholder="'+escH(T('What should AMV do? e.g. “Write in a formal, precise tone and cite sources.”'))+'" aria-label="'+escH(T('Instructions'))+'" style="width:100%;resize:vertical;margin-top:8px">'+escH(sk?sk.instr:'')+'</textarea>'+
    '<div class="skill-mode" role="radiogroup" aria-label="'+escH(T('When AMV uses it'))+'">'+
      '<label><input type="radio" name="sk-mode" value="always"'+(!sk||sk.mode!=='auto'?' checked':'')+'> '+escH(T('Always on'))+'</label>'+
      '<label><input type="radio" name="sk-mode" value="auto"'+(sk&&sk.mode==='auto'?' checked':'')+'> '+escH(T('Only when relevant'))+'</label></div>'+
    '<div class="pj-row"><button class="btn bp" id="sk-add" style="font-size:var(--t-sm)">'+escH(sk?T('Save new version'):T('Create skill'))+'</button>'+
      (sk?'<button type="button" class="btn mc-mini ghost" id="sk-cancel">'+escH(T('Cancel'))+'</button>':'')+'</div>';
}
function _wireSkillForm(pane, id){
  on($('sk-cancel'),'click',()=>{ const f=$('sk-form'); if(f){ f.innerHTML=_skillFormHTML(null); _wireSkillForm(pane,null); } });
  on($('sk-add'),'click',()=>{
    const name=($('sk-name')?.value||'').trim(), instr=($('sk-instr')?.value||'').trim(), when=($('sk-when')?.value||'').trim();
    const m=(pane.querySelector('input[name="sk-mode"]:checked')||{}).value==='auto'?'auto':'always';
    if(!name||!instr){ toast(T('Give your skill a name and instructions.'),'error',3000); return; }
    if(m==='auto' && !when){ toast(T('Say what the skill is for, so AMV knows when it is relevant.'),'error',4000); return; }
    if(id){ const sk=_skillSave(id,{ name:name.slice(0,60), instr:instr.slice(0,SKILL_INSTR_MAX), when:when.slice(0,200), mode:m }); toast(sk?T('Saved as version')+' '+sk.v:T('That skill no longer exists.'), sk?'success':'error', 2500); }
    else { _saveSkills(_loadSkills().concat([_skillNew({ name, instr, when, mode:m })])); toast(T('Skill created'),'success',2500); }
    _renderSkillsPane(pane);
  });
}
function _skillHistory(pane, id){
  const sk=_loadSkills().find(x=>x.id===id); const f=$('sk-form'); if(!sk||!f) return;
  const day=ts=>{ try{ return ts?new Date(ts).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }):''; }catch(e){ return ''; } };
  f.innerHTML='<div class="skill-form-h">'+escH(T('History of')+' “'+sk.name+'”')+' · '+escH(T('now'))+' v'+(sk.v||1)+'</div>'+
    (sk.history||[]).map((h,i)=>'<div class="skill-hist"><div class="skill-hist-h">v'+h.v+' · '+escH(day(h.at))+(h.name!==sk.name?' · '+escH(h.name):'')+
      ' <button type="button" class="skill-link" data-skrestore="'+i+'">'+escH(T('Restore'))+'</button></div><pre class="skill-hist-t">'+escH(h.instr)+'</pre></div>').join('')+
    '<div class="pj-row"><button type="button" class="btn mc-mini ghost" id="sk-cancel">'+escH(T('Close'))+'</button></div>';
  f.scrollIntoView({block:'nearest'});
  on($('sk-cancel'),'click',()=>{ f.innerHTML=_skillFormHTML(null); _wireSkillForm(pane,null); });
  f.querySelectorAll('[data-skrestore]').forEach(b=>on(b,'click',()=>{
    const h=(sk.history||[])[+b.dataset.skrestore]; if(!h) return;
    const r=_skillSave(id,{ name:h.name, instr:h.instr, when:h.when||'', mode:h.mode||'always' });
    toast(T('Restored version')+' '+h.v+' '+T('as version')+' '+(r?r.v:''),'success',3500);
    _renderSkillsPane(pane);
  }));
}
try{ window._renderSkillsPane=_renderSkillsPane; }catch(e){}

/* PLUGINS - one package of skills, starter prompts and the apps they work
   with, added in one step and removed in one step.

   WHAT A PLUGIN CAN DO, which is the whole of its safety story:
     - its skills are instructions, told to the engine as a third party's
       (see _pluginSkillsContext) - they shape how AMV answers and can never
       change AMV's rules, approve an action, or ask for a password;
     - its prompts are text put in the composer when somebody presses Use;
     - its apps are NAMES. Pressing one searches the connector directory. A
       plugin cannot connect anything - connecting stays the person's own act,
       through the same flow and the same per-call consent as everything else.
   Nothing in a package but text survives _plNormalize, and every word of it is
   shown before it is added.

   Removing one leaves a tombstone ({id, removed, updated}) rather than
   nothing, because plugins sync by merging lists by id: a deletion that is
   simply absent comes back from the next device to sync, and a tombstone
   newer than the copy wins the merge. */
const PL_MAX = 12, PL_SKILLS = 10, PL_PROMPTS = 20, PL_APPS = 8, PL_TEXT_MAX = 4000, PL_TOMBS = 50;
const PL_APP_RE = /^[\p{L}\p{N}][\p{L}\p{N} .&+'’-]{0,39}$/u;

function _plClean(s, n){ return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n); }

/* A package from anywhere - a file, the marketplace, a preset. Too long is
   refused rather than cut, as a skill file is: a cut instruction is a
   different instruction from the one somebody was shown. */
function _plNormalize(o){
  const bad = (m) => ({ error: m || T('That is not a plugin package.') });
  if(!o || typeof o !== 'object' || o.format !== 'amv-plugin') return bad();
  const name = _plClean(o.name, 60);
  if(!name) return bad(T('That plugin has no name.'));
  const rs = Array.isArray(o.skills) ? o.skills : [], rp = Array.isArray(o.prompts) ? o.prompts : [], ra = Array.isArray(o.apps) ? o.apps : [];
  if(rs.length > PL_SKILLS) return bad(T('A plugin can carry at most') + ' ' + PL_SKILLS + ' ' + T('skills.'));
  if(rp.length > PL_PROMPTS) return bad(T('A plugin can carry at most') + ' ' + PL_PROMPTS + ' ' + T('prompts.'));
  if(ra.length > PL_APPS) return bad(T('A plugin can name at most') + ' ' + PL_APPS + ' ' + T('apps.'));
  const skills = [], prompts = [], apps = [];
  for(let i = 0; i < rs.length; i++){
    const s = rs[i];
    if(!s || typeof s.name !== 'string' || typeof s.instr !== 'string' || !s.name.trim() || !s.instr.trim()) return bad(T('One of its skills is missing its name or instructions.'));
    if(s.instr.length > PL_TEXT_MAX) return bad(T('One of its skills is longer than AMV accepts') + ' (' + PL_TEXT_MAX.toLocaleString() + ' ' + T('characters') + ').');
    const mode = s.mode === 'auto' ? 'auto' : 'always', when = _plClean(s.when, 200);
    if(mode === 'auto' && !when) return bad(T('A skill used only when relevant has to say what it is for.'));
    skills.push({ id: 'ps' + i, name: _plClean(s.name, 60), when, instr: _plClean(s.instr, PL_TEXT_MAX), mode });
  }
  for(const p of rp){
    if(!p || typeof p.title !== 'string' || typeof p.text !== 'string' || !p.title.trim() || !p.text.trim()) return bad(T('One of its prompts is missing its title or text.'));
    if(p.text.length > PL_TEXT_MAX) return bad(T('One of its prompts is longer than AMV accepts') + ' (' + PL_TEXT_MAX.toLocaleString() + ' ' + T('characters') + ').');
    prompts.push({ title: _plClean(p.title, 100), text: _plClean(p.text, PL_TEXT_MAX) });
  }
  for(const a of ra){
    const n = _plClean(a, 40);
    if(!PL_APP_RE.test(n)) return bad(T('One of the apps it names is not a plain app name.'));
    if(apps.indexOf(n) < 0) apps.push(n);
  }
  if(!skills.length && !prompts.length) return bad(T('That plugin has nothing in it - no skills and no prompts.'));
  return { plugin: { name, desc: _plClean(o.desc, 280), v: Math.max(1, Math.min(9999, parseInt(o.v, 10) || 1)), skills, prompts, apps } };
}

/* Made by AMV, so they are told to the engine as AMV's own. Each is written
   for a job people actually bring, and names only apps the directory finds. */
const PL_PRESETS = [
  { preset: 'writing', format: 'amv-plugin', name: 'Writing kit', desc: 'Clear, plain writing - drafts, edits and replies that sound like a person.',
    skills: [
      { name: 'Plain language', mode: 'always', instr: 'Write in plain, direct language. Short sentences, active voice, concrete words. No filler, no hype, no clichés. Lead with the point.' },
      { name: 'Editor', mode: 'auto', when: 'editing, proofreading or improving a piece of writing', instr: 'When asked to edit, keep the author’s voice. Fix errors, cut what does not earn its place, and list the three most important changes you made and why.' },
    ],
    prompts: [
      { title: 'Reply to this email', text: 'Write a short, friendly reply to this email that [WHAT YOU WANT TO SAY]:\n\n[PASTE THE EMAIL]' },
      { title: 'Make it shorter', text: 'Cut this to half its length without losing anything important:\n\n[PASTE THE TEXT]' },
      { title: 'Explain it to a newcomer', text: 'Rewrite this so somebody new to the subject understands it on first read:\n\n[PASTE THE TEXT]' },
    ],
    apps: ['Gmail', 'Google Docs', 'Notion'] },
  { preset: 'jobs', format: 'amv-plugin', name: 'Job search kit', desc: 'CVs, cover letters and interview practice aimed at one job at a time.',
    skills: [
      { name: 'Recruiter’s eye', mode: 'auto', when: 'CVs, resumes, cover letters, job applications and interviews', instr: 'Read applications the way a busy recruiter does: what stands out in the first ten seconds, what is missing, what reads as generic. Tie every suggestion to the specific job described. Never invent experience the person does not have.' },
    ],
    prompts: [
      { title: 'Tailor my CV to a job', text: 'Here is a job advert and my CV. Tell me what to change so the CV fits this job, line by line.\n\nJob:\n[PASTE THE ADVERT]\n\nCV:\n[PASTE YOUR CV]' },
      { title: 'Cover letter', text: 'Write a cover letter for [JOB TITLE] at [COMPANY], under 250 words, using only what is in my CV:\n\n[PASTE YOUR CV]' },
      { title: 'Mock interview', text: 'Interview me for [JOB TITLE]. Ask one question at a time, wait for my answer, then tell me how to make it stronger.' },
    ],
    apps: ['LinkedIn', 'Gmail', 'Google Calendar'] },
  { preset: 'business', format: 'amv-plugin', name: 'Small business kit', desc: 'Quotes, invoices, customer replies and a weekly look at the numbers.',
    skills: [
      { name: 'Customer voice', mode: 'auto', when: 'replies to customers, complaints, quotes and sales messages', instr: 'Write to customers warmly and briefly. Acknowledge the issue in one line, say exactly what happens next and when, and never promise anything the person has not said they can do.' },
      { name: 'Numbers check', mode: 'auto', when: 'prices, invoices, budgets, margins or any arithmetic', instr: 'Show the arithmetic for every figure, state assumptions, and flag anything that looks wrong rather than smoothing it over.' },
    ],
    prompts: [
      { title: 'Quote for a job', text: 'Write a clear quote for [CUSTOMER] for [THE WORK], with line items, totals and payment terms.' },
      { title: 'Calm reply to a complaint', text: 'Help me answer this complaint fairly and calmly:\n\n[PASTE THE COMPLAINT]' },
      { title: 'This week in numbers', text: 'Here are this week’s sales and costs. Tell me what changed, what to watch, and one thing to do next week.\n\n[PASTE THE NUMBERS]' },
    ],
    apps: ['Stripe', 'QuickBooks', 'Google Sheets'] },
];

function _plAll(){ try{ const l = load('amv_plugins'); return Array.isArray(l) ? l : []; }catch(e){ return []; } }
function _plLive(){ return _plAll().filter(p => p && p.id && !p.removed); }
function _plSave(list){
  /* Tombstones are kept only as long as they are useful, newest first. */
  const live = list.filter(p => p && !p.removed), dead = list.filter(p => p && p.removed).sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, PL_TOMBS);
  store('amv_plugins', live.concat(dead));
  try{ if(typeof AMVSync !== 'undefined' && AMVSync.push) AMVSync.push(); }catch(e){}
}
function _plSame(a, meta){
  if(meta.listing) return a.listing === meta.listing;
  if(meta.preset) return a.preset === meta.preset;
  return !a.listing && !a.preset && a.name === meta.name && (a.author || '') === (meta.author || '');
}

/* Ask, showing everything. A promise that settles however the window goes -
   Escape included, which closes the overlay without touching these buttons. */
function _plAsk(pkg, meta){
  const ovr = $('ovr');
  if(!ovr) return Promise.resolve(false);
  const by = meta.third ? T('Made by') + ' ' + (meta.author || T('someone else')) + ' ' + T('- not by AMV.') : T('Made by AMV.');
  const mode = s => s.mode === 'auto' ? T('Only when relevant') + ': ' + s.when : T('Always on');
  ovr.innerHTML = '<div class="ov" id="pla-bg"><div class="ob pl-ask" role="dialog" aria-modal="true" aria-labelledby="pla-t">'
    + '<button class="oc" id="pla-x" aria-label="' + escH(T('Close')) + '">&#215;</button>'
    + '<h2 id="pla-t">' + escH(T('Add') + ' “' + pkg.name + '”?') + '</h2>'
    + '<p class="ob-sub">' + escH(by) + (pkg.desc ? ' ' + escH(pkg.desc) : '') + '</p>'
    + (pkg.skills.length ? '<h3 class="pl-h">' + escH(pkg.skills.length + ' ' + T(pkg.skills.length === 1 ? 'skill - instructions AMV will follow' : 'skills - instructions AMV will follow')) + '</h3>'
      + pkg.skills.map(s => '<details class="pl-item" open><summary><b>' + escH(s.name) + '</b> <span class="pl-mode">' + escH(mode(s)) + '</span></summary><pre class="skill-hist-t">' + escH(s.instr) + '</pre></details>').join('') : '')
    + (pkg.prompts.length ? '<h3 class="pl-h">' + escH(pkg.prompts.length + ' ' + T(pkg.prompts.length === 1 ? 'starter prompt' : 'starter prompts')) + '</h3>'
      + pkg.prompts.map(p => '<details class="pl-item"><summary>' + escH(p.title) + '</summary><pre class="skill-hist-t">' + escH(p.text) + '</pre></details>').join('') : '')
    + (pkg.apps.length ? '<h3 class="pl-h">' + escH(T('Works with')) + '</h3><div class="pl-apps">' + pkg.apps.map(a => '<span class="pl-app">' + escH(a) + '</span>').join('') + '</div>'
      + '<p class="pl-note">' + escH(T('You connect these yourself, under Connectors. A plugin cannot connect anything.')) + '</p>' : '')
    + '<p class="pl-note">' + escH(T('A plugin’s instructions shape how AMV answers. They cannot change AMV’s rules, approve anything for you, or ask for a password or payment. Turn it off or remove it whenever you like.')) + '</p>'
    + '<div class="pl-btns"><button class="btn bs" id="pla-no">' + escH(T('Cancel')) + '</button><button class="btn bp" id="pla-yes">' + escH(T('Add plugin')) + '</button></div>'
    + '</div></div>';
  ovr.classList.add('on');
  return new Promise(resolve => {
    let settled = false, obs = null;
    const done = v => { if(settled) return; settled = true; try{ if(obs) obs.disconnect(); }catch(e){} resolve(v); };
    const no = () => { closeOvr(); done(false); };
    on($('pla-no'), 'click', no);
    on($('pla-x'), 'click', no);
    on($('pla-yes'), 'click', () => { closeOvr(); done(true); });
    try{ obs = new MutationObserver(() => { if(!document.getElementById('pla-yes')) done(false); });
         obs.observe(ovr, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }); }catch(e){}
    /* Cancel holds the focus, but the window opens at its top: the title and
       who made it are the first things to read, not the buttons. */
    setTimeout(() => { try{ const n = $('pla-no'); if(n) n.focus({ preventScroll: true });
      const d = document.querySelector('.pl-ask'), bg = $('pla-bg'); if(d) d.scrollTop = 0; if(bg) bg.scrollTop = 0; }catch(e){} }, 0);
  });
}

/* Add one - after asking. Installing the same plugin again replaces it in
   place (an update), never a second copy beside the first. */
async function _pluginAdd(raw, meta){
  meta = meta || {};
  const r = _plNormalize(raw);
  if(r.error){ toast(r.error, 'error', 7000); return null; }
  const pkg = r.plugin;
  const m = { listing: _plClean(meta.listing, 64), preset: _plClean(meta.preset, 32), author: _plClean(meta.author, 40), third: meta.third !== false, name: pkg.name };
  const live = _plLive(), was = live.find(a => _plSame(a, m));
  if(!was && live.length >= PL_MAX){ toast(T('You have') + ' ' + PL_MAX + ' ' + T('plugins. Remove one before adding another.'), 'error', 7000); return null; }
  if(!(await _plAsk(pkg, m))) return null;
  const now = Date.now();
  const rec = Object.assign({ id: was ? was.id : 'pl_' + now.toString(36) + Math.random().toString(36).slice(2, 6) }, pkg,
    { on: was ? was.on !== false : true, third: m.third, author: m.author, listing: m.listing, preset: m.preset, added: was ? was.added : now, updated: now });
  _plSave(_plAll().filter(a => a.id !== rec.id).concat([rec]));
  toast((was ? T('Updated') : T('Added')) + ' “' + rec.name + '”. ' + T('Its skills are on in every chat.'), 'success', 5000);
  return rec;
}
function _pluginSetOn(id, onOff){
  const list = _plAll(), p = list.find(a => a.id === id && !a.removed); if(!p) return;
  p.on = !!onOff; p.updated = Date.now(); _plSave(list);
}
async function _pluginRemove(id){
  const p = _plLive().find(a => a.id === id); if(!p) return false;
  const yes = await _askDestructive(T('Remove this plugin?'), '“' + p.name + '” ' + T('and everything it added - its skills and prompts - are removed. Apps you connected stay connected.'), T('Remove'));
  if(!yes) return false;
  _plSave(_plAll().filter(a => a.id !== id).concat([{ id, removed: true, updated: Date.now() }]));
  return true;
}
function _plPackage(p){
  return { format: 'amv-plugin', name: p.name, desc: p.desc || '', v: p.v || 1,
    skills: (p.skills || []).map(s => ({ name: s.name, when: s.when || '', instr: s.instr, mode: s.mode })),
    prompts: (p.prompts || []).map(x => ({ title: x.title, text: x.text })), apps: (p.apps || []).slice() };
}
function _plDownload(pkg){
  const base = String(pkg.name).replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'plugin';
  _saveBlob(new Blob([JSON.stringify(Object.assign({}, pkg, { exported: new Date().toISOString() }), null, 2)], { type: 'application/json' }), base + '.amvplugin.json');
}
/* From the marketplace: the listing's plugin, by its seller. */
function _pluginFromListing(item){
  const p = item && item.plugin && typeof item.plugin === 'object' ? item.plugin : {};
  return _pluginAdd({ format: 'amv-plugin', name: item.title, desc: item.desc, skills: p.skills, prompts: p.prompts, apps: p.apps },
    { listing: item.id, author: item.author || '', third: true });
}
function _plUse(text){
  try{ closeOvr(); }catch(e){}
  if(typeof _templateBlanks === 'function' && _templateBlanks(text).length && typeof openTemplateForm === 'function'){ openTemplateForm({ title: '', text }); return; }
  _putInComposer(text);
}
function _plFind(app){
  try{ closeOvr(); }catch(e){}
  setTab('integrations');
  setTimeout(() => { try{ cdirAll(app); }catch(e){} }, 0);
}

/* The section under Skills. */
function _pluginsPane(host){
  if(!host) return;
  const live = _plLive();
  const mode = s => s.mode === 'auto' ? T('When relevant') : T('Always on');
  const row = p => '<div class="pl-row" data-pl="' + escH(p.id) + '">'
    + '<div class="pl-row-h"><div class="skill-info"><div class="skill-name">' + escH(p.name) + (p.on !== false ? ' <span class="skill-on">' + escH(T('On')) + '</span>' : '') + '</div>'
      + '<div class="skill-desc">' + escH((p.third ? T('By') + ' ' + (p.author || T('someone else')) : T('By AMV')) + ' · ' + p.skills.length + ' ' + T(p.skills.length === 1 ? 'skill' : 'skills') + ' · ' + p.prompts.length + ' ' + T(p.prompts.length === 1 ? 'prompt' : 'prompts')) + '</div></div>'
      + '<label class="sw"><input type="checkbox" data-pl-on="' + escH(p.id) + '" aria-label="' + escH(p.name) + '"' + (p.on !== false ? ' checked' : '') + '><span class="sw-sl"></span></label></div>'
    + '<details class="pl-in"><summary>' + escH(T('What is in it')) + '</summary>'
      + (p.desc ? '<p class="skill-desc">' + escH(p.desc) + '</p>' : '')
      + p.skills.map(s => '<div class="skill-hist"><div class="skill-hist-h">' + escH(s.name) + ' · ' + escH(mode(s)) + (s.mode === 'auto' ? ': ' + escH(s.when) : '') + '</div><pre class="skill-hist-t">' + escH(s.instr) + '</pre></div>').join('')
      + p.prompts.map((x, i) => '<div class="pl-pr"><span>' + escH(x.title) + '</span><button type="button" class="skill-link" data-pl-use="' + escH(p.id) + '" data-i="' + i + '">' + escH(T('Use')) + '</button></div>').join('')
      + (p.apps.length ? '<div class="pl-apps">' + p.apps.map(a => '<button type="button" class="pl-app" data-pl-find="' + escH(a) + '" title="' + escH(T('Find it in Connectors')) + '">' + escH(a) + '</button>').join('') + '</div>' : '')
      + '<div class="skill-tools"><button type="button" class="skill-link" data-pl-exp="' + escH(p.id) + '">' + escH(T('Download file')) + '</button>'
      + '<button type="button" class="skill-link pl-del" data-pl-del="' + escH(p.id) + '">' + escH(T('Remove')) + '</button></div>'
    + '</details></div>';
  const presets = PL_PRESETS.filter(x => !live.some(p => p.preset === x.preset));
  const mySkills = (typeof _loadSkills === 'function' ? _loadSkills() : []);
  const myPrompts = (S.prompts || []).filter(p => p && p.custom);
  host.innerHTML = '<h3>' + escH(T('Plugins')) + ' <button type="button" class="btn mc-mini ghost" id="pl-import">' + escH(T('Import')) + '</button></h3>'
    + '<input type="file" id="pl-file" accept=".json,application/json" hidden>'
    + '<div class="set-sub">' + escH(T('A plugin is a package of skills, starter prompts and the apps they work with - added in one step, removed in one step.')) + '</div>'
    + (live.length ? '<div class="skill-list">' + live.map(row).join('') + '</div>' : '<div class="skill-empty">' + escH(T('No plugins yet - add a ready-made one below, import a plugin file, or install one from the marketplace.')) + '</div>')
    + (presets.length ? '<div class="pl-pre-h">' + escH(T('Ready-made')) + '</div><div class="skill-list">' + presets.map(x => '<div class="skill-row"><div class="skill-info"><div class="skill-name">' + escH(x.name) + '</div><div class="skill-desc">' + escH(x.desc) + '</div></div>'
        + '<div class="skill-acts"><button type="button" class="btn mc-mini" data-pl-preset="' + escH(x.preset) + '">' + escH(T('Add')) + '</button></div></div>').join('') + '</div>' : '')
    + '<details class="pl-make"><summary>' + escH(T('Make a plugin from your own skills and prompts')) + '</summary>'
      + (mySkills.length || myPrompts.length
        ? '<input class="inp" id="plm-name" maxlength="60" placeholder="' + escH(T('Plugin name')) + '" aria-label="' + escH(T('Plugin name')) + '">'
          + '<input class="inp" id="plm-desc" maxlength="280" placeholder="' + escH(T('What it is for, in a sentence')) + '" aria-label="' + escH(T('What it is for')) + '">'
          + (mySkills.length ? '<div class="pl-pick-h">' + escH(T('Skills')) + '</div>' + mySkills.slice(0, 40).map(s => '<label class="pl-pick"><input type="checkbox" data-plm-sk="' + escH(s.id) + '"> ' + escH(s.name) + '</label>').join('') : '')
          + (myPrompts.length ? '<div class="pl-pick-h">' + escH(T('Prompts')) + '</div>' + myPrompts.slice(0, 40).map(p => '<label class="pl-pick"><input type="checkbox" data-plm-pr="' + escH(p.id) + '"> ' + escH(p.title || '') + '</label>').join('') : '')
          + '<input class="inp" id="plm-apps" maxlength="330" placeholder="' + escH(T('Apps it works with, separated by commas (optional)')) + '" aria-label="' + escH(T('Apps it works with')) + '">'
          + '<div class="pj-row"><button type="button" class="btn bp" id="plm-file">' + escH(T('Download plugin file')) + '</button>'
          + '<label class="lbl" for="plm-price">' + escH(T('Price in whole dollars')) + '</label><input id="plm-price" class="inp pl-price" type="text" inputmode="numeric" value="0">'
          + '<button type="button" class="btn mc-mini" id="plm-pub">' + escH(T('Share in the marketplace')) + '</button></div>'
          + '<span class="pj-note" id="plm-said" role="status" aria-live="polite"></span>'
        : '<div class="skill-empty">' + escH(T('Create a skill or save a prompt first - a plugin is made from those.')) + '</div>')
    + '</details>';

  const redraw = () => _pluginsPane(host);
  host.querySelectorAll('[data-pl-on]').forEach(cb => on(cb, 'change', function(){ _pluginSetOn(this.getAttribute('data-pl-on'), this.checked); redraw(); }));
  host.querySelectorAll('[data-pl-del]').forEach(b => on(b, 'click', async () => { await _pluginRemove(b.getAttribute('data-pl-del')); goSettings('skills'); }));
  host.querySelectorAll('[data-pl-exp]').forEach(b => on(b, 'click', () => { const p = _plLive().find(a => a.id === b.getAttribute('data-pl-exp')); if(p) _plDownload(_plPackage(p)); }));
  host.querySelectorAll('[data-pl-use]').forEach(b => on(b, 'click', () => { const p = _plLive().find(a => a.id === b.getAttribute('data-pl-use')); const x = p && p.prompts[+b.getAttribute('data-i')]; if(x) _plUse(x.text); }));
  host.querySelectorAll('[data-pl-find]').forEach(b => on(b, 'click', () => _plFind(b.getAttribute('data-pl-find'))));
  host.querySelectorAll('[data-pl-preset]').forEach(b => on(b, 'click', async () => {
    const x = PL_PRESETS.find(p => p.preset === b.getAttribute('data-pl-preset')); if(!x) return;
    await _pluginAdd(x, { preset: x.preset, third: false });
    goSettings('skills');
  }));
  on($('pl-import'), 'click', () => { const i = $('pl-file'); if(i) i.click(); });
  on($('pl-file'), 'change', async function(){
    const f = this.files && this.files[0]; this.value = '';
    if(!f) return;
    if(f.size > 256 * 1024){ toast(T('That file is too large to be a plugin.'), 'error', 6000); return; }
    let o; try{ o = JSON.parse(await f.text()); }catch(e){ toast(T('That is not a plugin package.'), 'error', 6000); return; }
    /* A file can claim to be by anybody - "AMV" included - so the name it
       gives is not shown as its maker. */
    await _pluginAdd(o, { author: T('whoever wrote the file'), third: true });
    goSettings('skills');
  });
  const made = () => {
    const say = t => { const m = $('plm-said'); if(m) m.textContent = t; };
    const skIds = Array.from(host.querySelectorAll('[data-plm-sk]:checked')).map(x => x.getAttribute('data-plm-sk'));
    const prIds = Array.from(host.querySelectorAll('[data-plm-pr]:checked')).map(x => x.getAttribute('data-plm-pr'));
    const pkg = { format: 'amv-plugin', name: String(($('plm-name') || {}).value || '').trim(), desc: String(($('plm-desc') || {}).value || '').trim(),
      skills: mySkills.filter(s => skIds.indexOf(s.id) >= 0).map(s => ({ name: s.name, when: s.when || '', instr: s.instr, mode: s.mode })),
      prompts: myPrompts.filter(p => prIds.indexOf(p.id) >= 0).map(p => ({ title: p.title || '', text: typeof _promptText === 'function' ? _promptText(p) : String(p.text || '') })),
      apps: String(($('plm-apps') || {}).value || '').split(',').map(a => a.trim()).filter(Boolean) };
    const r = _plNormalize(pkg);
    if(r.error){ say(r.error); return null; }
    say('');
    return Object.assign({ format: 'amv-plugin' }, r.plugin, { skills: r.plugin.skills.map(s => ({ name: s.name, when: s.when, instr: s.instr, mode: s.mode })) });
  };
  on($('plm-file'), 'click', () => { const pkg = made(); if(pkg) _plDownload(pkg); });
  on($('plm-pub'), 'click', async () => {
    const say = t => { const m = $('plm-said'); if(m) m.textContent = t; };
    const pkg = made(); if(!pkg) return;
    const priceRaw = String(($('plm-price') || {}).value || '0').trim();
    if(!/^\d{1,3}$/.test(priceRaw)){ say(T('Prices are whole dollars, from 0 to 999.')); return; }
    const item = { kind: 'plugin', title: pkg.name, cat: 'Plugins', desc: pkg.desc, price: +priceRaw, icon: '🧩',
      text: pkg.desc || (pkg.skills.length + ' skills and ' + pkg.prompts.length + ' prompts.'),
      plugin: { skills: pkg.skills, prompts: pkg.prompts, apps: pkg.apps } };
    const btn = $('plm-pub'); if(btn) btn.disabled = true;
    try{ await AMVMarket.publish(item); say(item.price ? T('Listed. You keep 80% of each sale.') : T('Listed for free.')); }
    catch(e){ say((e && e.message) || T('It could not be listed.')); }
    if(btn) btn.disabled = false;
  });
}
try{ Object.assign(window, { _pluginsPane, _pluginAdd, _pluginFromListing, _pluginRemove, _pluginSetOn, _plNormalize }); }catch(e){}
