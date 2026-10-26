/* SHARED PROJECTS - a team edits one project together.

   Fetched the first time it is needed (_teamProjLoad in 07b-projects.js): when
   a project page opens for somebody in a team, or the team page is drawn. A
   classic script, so it lands on window and uses the page's own helpers.

   THE MODEL. The server holds the project (teamProjectSave in the Worker): its
   name, instructions and text files, a revision number, and the instructions
   each save replaced. Each member's AMV keeps a MIRROR - an ordinary project
   with `team: { id, rev, synced }` on it - so chats in it read instructions
   and files exactly as they read any project's, with no network on the way.

     - Opening the project fetches the latest and brings the mirror up to date.
     - A change made here (instructions saved, a file added or removed) is
       noticed by comparing the mirror with what was last synced, and sent
       with the revision it was made from.
     - If a colleague saved in between, the server refuses it and says what is
       there now. Both versions are shown and the person chooses: keep theirs,
       or save mine over it - knowingly. Nothing is overwritten unseen.

   What AMV learns in a project's chats stays each person's own; the assistant
   settings (starters, engine) are per person too. Only what the team agreed
   to share - instructions and files - is shared. */
const TP_FILES_MAX = 20, TP_INSTR_MAX = 4000;

async function _tpCall(path, body){
  let r;
  try{ r = await AMV_API._fetch(path, { method:'POST', body: JSON.stringify(body || {}) }); }
  catch(e){ return { ok:false, offline:true, error: T('AMV could not reach the server. Your changes are kept here and will be sent when you are back online.') }; }
  const d = await r.json().catch(() => ({}));
  return Object.assign({ status: r.status }, d, { ok: r.ok && !!d.ok });
}

/* A fingerprint of the files, so "changed since last synced" is a comparison,
   not a guess. */
function _tpHash(s){ let h = 5381; s = String(s || ''); for(let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function _tpFilesSig(files){ return (files || []).map(f => f.id + ':' + f.name + ':' + String(f.text || '').length + ':' + _tpHash(f.text)).join('|'); }
function _tpDirty(ws){
  const s = ws.team && ws.team.synced; if(!s) return false;
  return String(ws.instructions || '') !== String(s.instructions || '') || _tpFilesSig(_projFiles(ws.id)) !== s.files;
}
function _tpWho(email){ const me = (S.user && S.user.email || '').toLowerCase(); return email && email.toLowerCase() === me ? T('you') : String(email || '').split('@')[0] || T('a teammate'); }
function _tpWhen(ts){ try{ return ts ? new Date(ts).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : ''; }catch(e){ return ''; } }

/* Make the mirror what the server says, and remember that as synced. */
function _tpAdopt(ws, p){
  ws.name = p.name || ws.name;
  if(p.icon) ws.icon = p.icon;
  ws.instructions = String(p.instructions || '');
  const files = (p.files || []).slice(0, TP_FILES_MAX).map(f => ({ id: f.id, name: f.name, text: f.text, added: f.at || Date.now(), by: f.by }));
  _projSaveFiles(ws.id, files);
  ws.team = { id: p.id, rev: p.rev, by: p.updatedBy, at: p.updated, createdBy: p.createdBy, history: (p.history || []).slice(0, 20),
              synced: { instructions: ws.instructions, files: _tpFilesSig(files) } };
  _wsTouch(ws);
}
function _tpPayload(ws){
  return { instructions: String(ws.instructions || '').slice(0, TP_INSTR_MAX),
           files: _projFiles(ws.id).slice(0, TP_FILES_MAX).map(f => ({ id: f.id, name: f.name, text: String(f.text || ''), by: f.by, at: f.added })) };
}

/* Send what changed here. Returns a state for the panel to show. */
async function _tpPush(ws, force){
  if(!ws.team || (!force && !_tpDirty(ws))) return { state:'synced' };
  const body = Object.assign({ id: ws.team.id, baseRev: ws.team.rev }, _tpPayload(ws));
  const d = await _tpCall('/team/project/save', body);
  if(d.ok){ _tpAdopt(ws, d.project); return { state:'saved' }; }
  if(d.code === 'conflict' && d.project) return { state:'conflict', theirs: d.project };
  if(d.code === 'gone' || d.status === 404) return _tpOrphan(ws, d);
  return { state:'error', error: d.error || T('Your change could not be sent. It is kept here - try again.') };
}
/* Fetch the latest. Local changes nobody has sent yet are sent first, so a
   pull can never quietly replace them. */
async function _tpPull(ws){
  if(!ws.team) return { state:'none' };
  if(_tpDirty(ws)) return _tpPush(ws);
  const d = await _tpCall('/team/project/get', { id: ws.team.id });
  if(d.ok){ if(d.project.rev !== ws.team.rev) _tpAdopt(ws, d.project); return { state:'synced' }; }
  if(d.code === 'gone' || d.status === 404) return _tpOrphan(ws, d);
  return { state:'error', error: d.error || T('The latest version could not be fetched.') };
}
/* The project was removed from the team, or this person left it. Their copy
   stays, as a personal project, and they are told which. */
function _tpOrphan(ws, d){
  delete ws.team; _wsTouch(ws);
  return { state:'orphan', error: d && d.code === 'gone'
    ? T('This project was removed from the team. Your copy stays here as a personal project.')
    : T('You are no longer in the team that shared this project. Your copy stays here as a personal project.') };
}

/* The team section of a project's page. */
async function _tpPanel(ws, el, pre){
  if(!el) return;
  const live = !!(window.AMVTeam && AMVTeam.enabled());
  if(!ws.team){
    if(!live || ws.third){ el.innerHTML = ''; return; }
    el.innerHTML = '<div class="tp-box"><div class="tp-h">' + escH(T('Edit it together')) + '</div>'
      + '<p class="pj-note">' + escH(T('Share this project with your team. Everyone can then edit its instructions and files, and every chat in it - theirs and yours - uses the latest version. What AMV learns in your chats stays yours.')) + '</p>'
      + '<button type="button" class="btn mc-mini" id="tp-share">' + escH(T('Share with my team for editing')) + '</button><span class="pj-note" id="tp-said" role="status" aria-live="polite"></span></div>';
    on($('tp-share'), 'click', async () => {
      const b = $('tp-share'); if(b) b.disabled = true;
      const p = _tpPayload(ws);
      const d = await _tpCall('/team/project/create', { name: ws.name, icon: ws.icon, instructions: p.instructions, files: p.files });
      if(d.ok){ _tpAdopt(ws, d.project); toast(T('Shared. Your team can now edit this project with you.'), 'success', 5000); _tpPanel(ws, el); }
      else { const s = $('tp-said'); if(s) s.textContent = d.error || T('It could not be shared.'); if(b) b.disabled = false; }
    });
    return;
  }
  el.innerHTML = '<div class="tp-box"><div class="tp-h">' + escH(T('Shared with your team')) + '</div><p class="pj-note" role="status">' + escH(T('Checking for changes…')) + '</p></div>';
  const r = pre || await _tpPull(ws);
  if(r.state === 'orphan'){ el.innerHTML = '<div class="tp-box"><p class="pj-note">' + escH(r.error) + '</p></div>'; return; }
  /* Pulling may have changed the instructions and files on this page. */
  if(!pre && r.state !== 'error' && r.state !== 'conflict'){ const ta = $('pj-instr'); if(ta && ta.value !== ws.instructions && document.activeElement !== ta) { _renderProjectPanel(ws.id); return; } }
  if(r.state === 'conflict') return _tpConflict(ws, el, r.theirs);
  const t = ws.team;
  el.innerHTML = '<div class="tp-box"><div class="tp-h">' + escH(T('Shared with your team')) + '</div>'
    + '<p class="pj-note">' + escH(T('Version') + ' ' + t.rev + ' · ' + T('last changed by') + ' ' + _tpWho(t.by) + ', ' + _tpWhen(t.at) + '. '
        + T('Changes to instructions and files go to everyone; what AMV learns in your chats stays yours.')) + '</p>'
    + (r.state === 'error' ? '<p class="pj-note tp-err" role="alert">' + escH(r.error) + ' <button type="button" class="skill-link" id="tp-retry">' + escH(T('Try again')) + '</button></p>' : '')
    + (r.state === 'saved' ? '<p class="pj-note" role="status">' + escH(T('Saved for the whole team.')) + '</p>' : '')
    + ((t.history || []).length ? '<details class="tp-hist"><summary>' + escH(T('Earlier instructions')) + ' (' + t.history.length + ')</summary>'
        + t.history.map((h, i) => '<div class="skill-hist"><div class="skill-hist-h">' + escH(T('Version') + ' ' + h.rev + ' · ' + _tpWho(h.by) + ' · ' + _tpWhen(h.at))
          + ' <button type="button" class="skill-link" data-tp-restore="' + i + '">' + escH(T('Restore')) + '</button></div><pre class="skill-hist-t">' + escH(h.instructions || '') + '</pre></div>').join('') + '</details>' : '')
    + '<button type="button" class="skill-link pl-del" id="tp-remove">' + escH(T('Stop sharing')) + '</button></div>';
  on($('tp-retry'), 'click', () => _tpPanel(ws, el));
  el.querySelectorAll('[data-tp-restore]').forEach(b => on(b, 'click', async () => {
    const h = (ws.team.history || [])[+b.dataset.tpRestore]; if(!h) return;
    ws.instructions = String(h.instructions || ''); _wsTouch(ws);
    const res = await _tpPush(ws);
    _renderProjectPanel(ws.id);
    if(res.state === 'saved') toast(T('Restored as a new version, for the whole team.'), 'success', 4000);
  }));
  on($('tp-remove'), 'click', async () => {
    const yes = await _askDestructive(T('Stop sharing this project?'), T('It is removed from the team for everyone - only whoever shared it or a team admin can do this. Your copy stays here as a personal project.'), T('Stop sharing'));
    if(!yes){ openProjectPanel(ws.id); return; }
    const d = await _tpCall('/team/project/delete', { id: ws.team.id });
    if(d.ok || d.code === 'gone'){ delete ws.team; _wsTouch(ws); toast(T('No longer shared. It is your personal project again.'), 'success', 5000); }
    else toast(d.error || T('It could not be removed.'), 'error', 7000);
    openProjectPanel(ws.id);
  });
}

/* Somebody else saved first. Both versions, side by side, and a choice. */
function _tpConflict(ws, el, theirs){
  const mine = String(ws.instructions || ''), their = String(theirs.instructions || '');
  const filesDiffer = _tpFilesSig(_projFiles(ws.id)) !== _tpFilesSig((theirs.files || []).map(f => ({ id: f.id, name: f.name, text: f.text })));
  el.innerHTML = '<div class="tp-box tp-conflict" role="alert"><div class="tp-h">' + escH(_tpWho(theirs.updatedBy) + ' ' + T('saved a newer version while you were editing')) + '</div>'
    + '<p class="pj-note">' + escH(T('Nothing has been overwritten. Choose which version the team keeps.')) + '</p>'
    + (mine !== their ? '<div class="tp-cols"><div><div class="tp-col-h">' + escH(T('Theirs')) + '</div><pre class="skill-hist-t">' + escH(their) + '</pre></div>'
        + '<div><div class="tp-col-h">' + escH(T('Yours')) + '</div><pre class="skill-hist-t">' + escH(mine) + '</pre></div></div>' : '')
    + (filesDiffer ? '<p class="pj-note">' + escH(T('The files differ too: theirs has') + ' ' + (theirs.files || []).length + ', ' + T('yours has') + ' ' + _projFiles(ws.id).length + '.') + '</p>' : '')
    + '<div class="pl-btns"><button type="button" class="btn bs" id="tp-theirs">' + escH(T('Keep theirs')) + '</button>'
    + '<button type="button" class="btn bp" id="tp-mine">' + escH(T('Save mine over it')) + '</button></div></div>';
  on($('tp-theirs'), 'click', () => { _tpAdopt(ws, theirs); _renderProjectPanel(ws.id); });
  on($('tp-mine'), 'click', async () => {
    ws.team.rev = theirs.rev;   /* knowingly, from the version just shown */
    const res = await _tpPush(ws, true);
    if(res.state === 'conflict') return _tpConflict(ws, el, res.theirs);
    _renderProjectPanel(ws.id);
  });
}

/* The team page: the team's shared projects, each one press from opening. */
async function _tpTeamList(el){
  if(!el) return;
  const d = await _tpCall('/team/project/list', {});
  if(!d.ok){ el.innerHTML = '<p class="pj-note">' + escH(d.error || T('Shared projects could not be loaded.')) + '</p>'; return; }
  const list = d.projects || [];
  el.innerHTML = list.length
    ? '<div class="team-shared-list">' + list.map(p => '<div class="team-shared-row"><span class="tsr-ic">' + _safeIcon(p.icon || '📁') + '</span>'
        + '<div class="tsr-main"><b>' + escH(p.name) + '</b><span>' + escH(T('Version') + ' ' + p.rev + ' · ' + T('changed by') + ' ' + _tpWho(p.updatedBy) + ', ' + _tpWhen(p.updated)) + '</span></div>'
        + '<button class="btn bs tsr-use" data-tp-open="' + escH(p.id) + '" style="font-size:var(--t-xs)">' + escH(T('Open')) + '</button></div>').join('') + '</div>'
    : '<p class="pj-note">' + escH(T('No shared projects yet. Open any project and choose “Share with my team for editing”.')) + '</p>';
  el.querySelectorAll('[data-tp-open]').forEach(b => on(b, 'click', () => _tpOpen(b.dataset.tpOpen, list.find(p => p.id === b.dataset.tpOpen))));
}
/* Open a shared project: this person's mirror of it, made on first open. */
function _tpOpen(id, summary){
  let ws = (S.workspaces || []).find(w => w && w.team && w.team.id === id);
  if(!ws){
    ws = { id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: (summary && summary.name) || T('Shared project'),
      icon: (summary && summary.icon) || '📁', instructions: '', memory: [], convs: [], created: Date.now(), updated: Date.now(),
      team: { id, rev: 0, synced: { instructions: '', files: '' } } };
    S.workspaces = [ws].concat(S.workspaces || []);
    _saveWorkspaces(S.workspaces);
  }
  openProjectPanel(ws.id);
}
try{ Object.assign(window, { _tpPanel, _tpTeamList, _tpOpen, _tpPush, _tpPull }); }catch(e){}

/* The team's own screen, moved here from 06-team-market.js (which keeps the
   door, `_renderTeamManage`). It runs in the page's scope, so every helper it
   uses is the page's own. */
function _renderTeamManageNow(vc, team){
  const role=AMVTeam.myRole(team);
  const canManage=role==='owner'||role==='admin';
  const isOwner=role==='owner';
  /* A viewer reads; the server refuses anything else (`contribute`), and the
     page does not offer what would be refused. */
  const canWork=role!=='viewer';
  const myEmail=(S.user?.email||'').toLowerCase();
  const roleName={ owner:T('Owner'), admin:T('Admin'), member:T('Member'), viewer:T('Viewer') };
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
      (over>0?' \u00b7 <b style="color:var(--gold-txt)">'+over+' over your plan</b>':'')+
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
        ? '<p style="font-size:var(--t-sm);color:var(--mu);line-height:1.6;margin:0 0 10px">'+
          'Changing the number is prorated by the day, so adding somebody mid-month costs '+
          'the part of the month they are there for.</p>'+
          '<button class="btn bs" id="seat-manage" style="font-size:var(--t-sm)">Change seats</button>'
        : '<p style="font-size:var(--t-sm);color:var(--mu);line-height:1.6;margin:0 0 10px">'+
          'Need a different number? Teams is priced per person at $'+seatPrice+'/month, '+
          'and every seat brings its own allowance rather than dividing this one.</p>'+
          '<button class="btn bs" data-stab="plans" style="font-size:var(--t-sm)">See Teams pricing</button>')+
      '<div class="seat-say" id="seat-manage-say" role="status" aria-live="polite"></div>'+
      '</div>'
    : '';
  const overBanner=over>0
    ? '<div class="ss2" style="border-color:var(--gold-txt);background:rgba(245,158,11,.07)">'+
      '<h3>'+over+' '+(over===1?'person is':'people are')+' not covered by your plan</h3>'+
      '<p style="font-size:var(--t-base);color:var(--tx);line-height:1.6;margin:0 0 10px">'+
      'Your plan includes '+seats.limit+' seat'+(seats.limit===1?'':'s')+' and the team has '+seats.used+' member'+(seats.used===1?'':'s')+'. '+
      'The '+(over===1?'member':'members')+' marked below are using their own plan instead of the team\u2019s, '+
      'so they have their own limits and lose the shared allowance. Upgrade to cover them, or remove them.</p>'+
      (isOwner?'<button class="btn bp" data-stab="plans" style="font-size:var(--t-sm)">See plans &rarr;</button>':
       '<p style="font-size:var(--t-sm);color:var(--mu);margin:0">Only the owner can change the plan.</p>')+
      '</div>'
    : '';
  const memberRows=(team.members||[]).map(m=>
    '<div class="vrow"><span>'+escH(m.email)+(m.email===myEmail?' <span style="color:var(--mu)">(you)</span>':'')+
    (m.seated===false?' <span class="team-role" style="background:rgba(245,158,11,.14);color:var(--gold-txt)">no seat</span>':'')+'</span>'+
    '<span style="display:flex;align-items:center;gap:10px">'+
    // the owner sets anyone else's role; everybody else sees it
    (isOwner&&m.role!=='owner'
      ? '<select class="sel team-role-sel" data-team-setrole="'+escH(m.email)+'" aria-label="'+escH(T('Role for {0}').replace('{0}', m.email))+'">'
        +['admin','member','viewer'].map(r=>'<option value="'+r+'"'+(r===m.role?' selected':'')+'>'+escH(roleName[r])+'</option>').join('')+'</select>'
      : '<span class="team-role team-role-'+escH(m.role)+'">'+escH(roleName[m.role]||m.role)+'</span>')+
    (canManage&&m.role!=='owner'?'<button class="team-x" data-team-remove="'+escH(m.email)+'" title="Remove">\u00d7</button>':'')+'</span></div>'
  ).join('');
  vc.innerHTML='<div class="sv fi"><div class="vi">'+
    '<span class="eyebrow">Collaboration</span><h2>'+escH(team.name)+'</h2>'+
    '<p class="vsub">'+(team.members||[]).length+' member'+((team.members||[]).length===1?'':'s')+' \u00b7 you\u2019re '+(role==='owner'?'the owner':'a '+role)+'.</p>'+
    (role==='viewer'?'<p class="vsub">'+escH(T('As a viewer you can read everything the team shares and its projects. Ask an owner or admin if you need to change them.'))+'</p>':'')+
    seatNote+
    overBanner+
    seatManage+
    '<div class="team-presence" id="team-presence"></div>'+
    '<div class="ss2"><h3>Shared library <span style="font-weight:400;color:var(--mu);font-size:var(--t-xs)">(projects &amp; prompts everyone can use)</span></h3>'+
      (canWork?'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">'+
        '<button class="btn bs" id="team-share-project" style="font-size:var(--t-sm)">Share a project</button>'+
        '<button class="btn bs" id="team-share-prompt" style="font-size:var(--t-sm)">Share a prompt</button></div>':'')+
      '<div id="team-shared"><div style="color:var(--mu);font-size:var(--t-sm);padding:6px 0">Loading\u2026</div></div>'+
    '</div>'+
    '<div class="ss2"><h3>Projects you edit together <span style="font-weight:400;color:var(--mu);font-size:var(--t-xs)">(one copy, kept up to date for everyone)</span></h3>'+
      '<div id="team-projects"><div style="color:var(--mu);font-size:var(--t-sm);padding:6px 0">Loading\u2026</div></div>'+
    '</div>'+
    (canManage?'<div class="ss2"><h3>Invite a teammate</h3><div class="sf" style="max-width:480px"><div style="display:flex;gap:8px;align-items:flex-end"><div style="flex:1"><label class="lbl">Email</label><input type="email" id="team-invite-email" placeholder="teammate@company.com" autocomplete="off"></div><div><label class="lbl">Role</label><select id="team-invite-role" class="sel"><option value="member">'+escH(T('Member'))+'</option><option value="admin">'+escH(T('Admin'))+'</option><option value="viewer">'+escH(T('Viewer'))+'</option></select></div><button class="btn bp" id="team-invite-btn" style="font-size:var(--t-sm)">Invite</button></div></div><div id="team-invite-result"></div></div>':'')+
    '<div class="ss2"><h3>Members</h3><div class="vbreak">'+memberRows+'</div></div>'+
    (canManage?'<div class="ss2"><h3>'+escH(T('Usage this month'))+'</h3>'+
      '<p style="font-size:var(--t-sm);color:var(--mu);line-height:1.6;margin:0 0 10px">'+escH(T('Totals only, never what anybody asked. Counted from what the team pays for, by calendar month (UTC).'))+'</p>'+
      '<div id="team-usage"><div style="color:var(--mu);font-size:var(--t-sm);padding:8px 0">'+escH(T('Loading\u2026'))+'</div></div></div>':'')+
    _teamEnginesHTML(team, canManage)+
    _teamSsoHTML(isOwner)+
    '<div class="ss2"><h3>Assigned work <span style="font-weight:400;color:var(--mu);font-size:var(--t-xs)">(assign tasks to teammates and track them)</span></h3>'+
      (canWork?'<div class="sf" style="max-width:560px;margin-bottom:14px"><div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">'+
        '<div style="flex:1;min-width:180px"><label class="lbl">Task</label><input type="text" id="tt-title" placeholder="e.g. Draft the launch email" autocomplete="off"></div>'+
        '<div><label class="lbl">Assign to</label><select id="tt-assignee" class="sel"><option value="">Unassigned</option>'+(team.members||[]).filter(m=>m.role!=='viewer').map(m=>'<option value="'+escH(m.email)+'">'+escH(m.email)+'</option>').join('')+'</select></div>'+
        '<div><label class="lbl">Priority</label><select id="tt-priority" class="sel"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></div>'+
        '<button class="btn bp" id="tt-add" style="font-size:var(--t-sm)">Assign</button>'+
      '</div></div>':'')+
      '<div id="tt-board"><div style="color:var(--mu);font-size:var(--t-sm);padding:8px 0">Loading tasks\u2026</div></div>'+
    '</div>'+
    (isOwner?'':'<div class="ss2"><h3>Leave this team</h3>'+
      '<p style="font-size:var(--t-sm);color:var(--mu);line-height:1.6;margin:0 0 10px">'+
      'You go back to your own plan and your own allowance. Anything you shared with the team stays with the team.</p>'+
      '<button class="btn bs" id="team-leave" style="font-size:var(--t-sm);color:var(--red-txt);border-color:var(--red-txt)">Leave team</button></div>')+
    (canManage?'<div class="ss2"><h3>Activity log <span style="font-weight:400;color:var(--mu);font-size:var(--t-xs)">(who did what)</span></h3><div id="team-audit"><div style="color:var(--mu);font-size:var(--t-sm);padding:8px 0">Loading\u2026</div></div></div>':'')+
  '</div></div>';
  if(canManage) _teamUsageLoad();
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
          '<button class="btn bs" id="team-invite-copy" style="font-size:var(--t-xs);margin-top:8px">Copy link</button></div>';
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
        res.innerHTML='<div class="team-invite-link" style="border-color:var(--gold-txt)">'+escH(e.message)+
          (isOwner?'<br><button class="btn bp" data-stab="plans" style="font-size:var(--t-xs);margin-top:8px">See plans</button>':'')+'</div>';
        return;
      }
      toast(e.message||'Invite failed','error');
    }
  });
  on($('seat-manage'),'click',async()=>{
    const say=t=>{ const s2=$('seat-manage-say'); if(s2) s2.textContent=t||''; };
    const btn=$('seat-manage'); if(btn){ btn.disabled=true; btn.textContent='Opening\u2026'; }
    /* Opened on the click - awaiting the portal call first spends the user
       activation and the browser refuses the window. See _preopenPay. */
    const pre=(typeof _preopenPay==='function')?_preopenPay():null;
    try{
      const url=await AMV_API.portal((S.user&&S.user.email)||'');
      if(url) _openExternalPay(url,null,'portal',pre);
      else { if(typeof _closePay==='function') _closePay(pre); say('Could not open billing just now. Nothing was changed.'); }
    }catch(e){ if(typeof _closePay==='function') _closePay(pre); say((e&&e.message)||'Could not open billing just now. Nothing was changed.'); }
    finally{ if(btn){ btn.disabled=false; btn.textContent='Change seats'; } }
  });
  on($('team-leave'),'click',async()=>{
    if(!await _askDestructive('Leave '+team.name+'?',
        'You go back to your own plan and lose access to everything shared with the team.',
        'Leave team')) return;
    const btn=$('team-leave'); if(btn){ btn.disabled=true; btn.textContent='Leaving\u2026'; }
    try{ await AMVTeam.leave(); toast('You have left the team','info'); renderTeamView(); }
    catch(e){ if(btn){ btn.disabled=false; btn.textContent='Leave team'; } toast(e.message||'Could not leave the team','error',6000); }
  });
  vc.querySelectorAll('[data-team-remove]').forEach(b=>on(b,'click',async()=>{
    if(!await showConfirmAsync('Remove '+b.dataset.teamRemove+' from the team?\n\nThey lose access to everything shared with the team. You can invite them again later.')) return;
    try{ await AMVTeam.remove(b.dataset.teamRemove); toast('Member removed','info'); renderTeamView(); }
    catch(e){ toast(e.message||'Could not remove','error'); }
  }));
  vc.querySelectorAll('[data-team-setrole]').forEach(b=>on(b,'change',async()=>{
    try{ await AMVTeam.setRole(b.dataset.teamSetrole, b.value); toast(T('Role updated'),'success'); renderTeamView(); }
    catch(e){ toast(e.message||T('Could not change role'),'error'); renderTeamView(); }
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
    if(!shared||!shared.length){ el.innerHTML='<div style="color:var(--mu);font-size:var(--t-sm);padding:6px 0">Nothing shared yet. Share a project or prompt so your whole team can use it.</div>'; return; }
    const _tsvg=(p)=>'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>';
    const kindIc={project:_tsvg('<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>'),prompt:_tsvg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>')};
    el.innerHTML='<div class="team-shared-list">'+shared.map(s=>'<div class="team-shared-row"><span class="tsr-ic">'+(kindIc[s.kind]||_tsvg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'))+'</span>'+
      '<div class="tsr-main"><b>'+escH(s.title)+'</b><span>'+escH(s.kind)+' \u00b7 by '+escH(s.byName||(s.by||'').split('@')[0])+'</span></div>'+
      '<button class="btn bs tsr-use" data-tsr-use="'+s.id+'" style="font-size:var(--t-xs)">Use</button>'+
      '<button class="team-x" data-tsr-del="'+s.id+'" title="Remove">\u00d7</button></div>').join('')+'</div>';
    el.querySelectorAll('[data-tsr-use]').forEach(b=>on(b,'click',()=>{
      const s=shared.find(x=>x.id===b.dataset.tsrUse); if(!s) return;
      if(s.kind==='prompt' && s.item){ S.prompts=S.prompts||[]; S.prompts.unshift({id:'p'+Date.now(),title:s.item.title||s.title,cat:'Shared',text:s.item.body||s.item.text||'',custom:true,ts:Date.now()}); store('amv_pl',S.prompts); toast('Added to your prompts','success'); }
      else if(s.kind==='project' && s.item){ _saveWorkspaces([Object.assign({id:'w'+Date.now()},s.item)].concat(S.workspaces||[])); toast('Added to your projects','success'); }
    }));
    el.querySelectorAll('[data-tsr-del]').forEach(b=>on(b,'click',async()=>{
      try{ const ns=await AMVTeam.unshare(b.dataset.tsrDel); drawShared(ns); toast('Removed','info'); }catch(e){ toast(e.message||'Could not remove','error'); }
    }));
  };
  // A rejected fetch here used to leave the panel blank with no explanation.
  if(AMVTeam.enabled()){
    AMVTeam.shared().then(drawShared).catch(e=>{
      /* A toast fades and leaves the panel saying the team has shared nothing,
         which is the same false statement with a delay on it. The panel keeps
         the message. */
      const el=$('team-shared');
      if(el) el.innerHTML='<div style="color:var(--mu);font-size:var(--t-sm);padding:8px 0;line-height:1.6">'+
        escH((e&&e.message)||'Could not load the shared library.')+
        ' Everything the team shared is still there - <button class="tt-mini" id="tsr-retry">try again</button></div>';
      on($('tsr-retry'),'click',()=>{ AMVTeam.shared().then(drawShared).catch(()=>{}); });
      try{ _logErr('team.shared', e); }catch(_){}
    });
  } else { drawShared([]); }
  const _sharePicker=(kind)=>{
    const items = kind==='prompt' ? (S.prompts||[]) : (S.workspaces||[]);
    if(!items.length){ toast('You have no '+(kind==='prompt'?'prompts':'projects')+' to share yet','info'); return; }
    const r=$('ovr'); if(!r) return;
    r.innerHTML='<div class="ov" id="shp-bg"><div class="ob" style="max-width:440px"><button class="oc" data-dact="closeOvr">\u00d7</button>'+
      '<h2 style="margin-bottom:4px">Share a '+kind+'</h2><p class="ob-sub" style="margin-bottom:14px">Everyone on your team will be able to use it.</p>'+
      '<div class="shp-list">'+items.map((it,i)=>'<button class="shp-item" data-shp="'+i+'">'+escH(it.title||it.name||('Untitled '+kind))+'</button>').join('')+'</div></div></div>';
    onBackdrop($('shp-bg'),closeOvr);
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
/* ── WHO USED HOW MUCH (owners and admins) ──────────────────────────────
   One row per member, heaviest first: this month's tokens against the
   heaviest member's, messages, the surfaces it went to, and last month's
   figure to compare. A member whose count could not be read says so, and a
   list that could not be read at all is never shown as nobody using it. */
function _teamUsageLoad(){
  const el = $('team-usage'); if(!el) return;
  const n = v => (+v || 0).toLocaleString();
  AMVTeam.usage().then(d => {
    const host = $('team-usage'); if(!host) return;
    if(!(d.total > 0) && !d.unread){ host.innerHTML = '<div style="color:var(--mu);font-size:var(--t-sm);padding:8px 0">'+escH(T('Nobody on the team has used anything yet this month.'))+'</div>'; return; }
    const top = Math.max(1, ...d.members.map(m => m.tokens));
    host.innerHTML = '<div class="srv-lbl" style="margin-bottom:8px"><span>'+escH(T('Team total'))+'</span><span>'+escH(T('{0} tokens').replace('{0}', n(d.total)))+'</span></div>'+
      d.members.map(m => {
        const sum = Object.values(m.surfaces || {}).reduce((a, b) => a + (+b || 0), 0) || 1;
        const where = Object.entries(m.surfaces || {}).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([k, v]) => T(_USAGE_SURFACE_LABEL[k] || 'Other') + ' ' + Math.round(v / sum * 100) + '%').join(' \u00b7 ');
        return '<div class="tu-row" style="padding:8px 0;border-top:1px solid var(--bd)">'+
          '<div class="srv-lbl"><span>'+escH(m.email)+'</span>'+
          '<span>'+escH(!m.read ? T('Could not be read') : m.messages === 1 ? T('{0} tokens \u00b7 1 message').replace('{0}', n(m.tokens))
            : T('{0} tokens \u00b7 {1} messages').replace('{0}', n(m.tokens)).replace('{1}', n(m.messages)))+'</span></div>'+
          '<div class="life-bar" style="display:block;margin:6px 0"><span style="width:'+Math.round(m.tokens / top * 100)+'%"></span></div>'+
          '<div class="srv-when">'+escH([where, m.lastMonth > 0 ? T('Last month: {0} tokens').replace('{0}', n(m.lastMonth)) : ''].filter(Boolean).join(' \u2014 '))+'</div>'+
        '</div>';
      }).join('')+
      (d.unread ? '<div class="srv-why">'+escH(T('Some members\u2019 usage could not be read, so the total is lower than it should be.'))+'</div>' : '');
  }).catch(err => {
    const host = $('team-usage'); if(!host) return;
    host.innerHTML = '<div style="color:var(--mu);font-size:var(--t-sm);padding:8px 0;line-height:1.6">'+
      escH((err && err.message) || T('Team usage could not be loaded.'))+' '+escH(T('This is not a record of nothing being used.'))+
      ' <button class="tt-mini" id="tu-retry">'+escH(T('Try again'))+'</button></div>';
    on($('tu-retry'), 'click', _teamUsageLoad);
  });
}
try{ window._renderTeamManageNow = _renderTeamManageNow; }catch(e){}
