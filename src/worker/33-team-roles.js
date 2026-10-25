/* =====================================================================
   TEAM ROLES & PERMISSIONS (auditor #11)
   Three roles with an explicit capability matrix, so permissions are
   defined in one place instead of scattered ad-hoc checks.
     • owner  - full control; only one; can't be removed; can delete team
     • admin  - manage members, change member/admin roles, edit team data
     • member - use the shared workspace, read members, leave
   ===================================================================== */
const TEAM_PERMS = {
  owner:  new Set(['invite','remove','setRole','editData','viewMembers','viewAudit','viewUsage','deleteTeam','rename','setPolicy']),
  admin:  new Set(['invite','remove','setRole','editData','viewMembers','viewAudit','viewUsage','rename','setPolicy']),
  member: new Set(['viewMembers']),
};
function _can(team, email, perm){
  const r = _role(team, email);
  return !!(r && TEAM_PERMS[r] && TEAM_PERMS[r].has(perm));
}
// Append an immutable-ish action record to the team's audit log (last 200).
async function _teamAudit(env, team, actorEmail, action, detail){
  try{
    /* AMV-SP-05: appended by every member, so read-append-write drops
       entries whenever two people act at once - and an audit log with holes in
       it is worse than none, because it is trusted. */
    await _withKV(env, 'teamlog', team.id, (log) => {
      log.push({ t: Date.now(), actor: actorEmail, action, ...(detail||{}) });
      if (log.length > 200) log.splice(0, log.length - 200);   // keep the most recent
    }, []);
    audit(env, 'team_action', { team: team.id, actor: actorEmail, action });
  }catch(e){ /* logging must never break the operation */ }
}
async function teamInvite(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const { email, role } = await request.json().catch(()=>({}));
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  if(!_can(team, user.email, 'invite')) return json({ error:'you don\u2019t have permission to invite' }, 403);
  const invitee = String(email||'').toLowerCase().trim();
  if(!invitee) return json({ error:'email required' }, 400);
  /* Seats are what a team plan sells. Checked here so the person inviting finds
     out now, and again at join, because the plan can shrink in between. */
  const limit = _teamSeatLimit(_teamPlan(team), team.customCfg);
  if((team.members||[]).length >= limit && !(team.members||[]).some(m=>m.email===invitee)){
    return json({ error: 'Your plan includes ' + limit + ' seat' + (limit===1?'':'s') +
                         '. Upgrade to add more people, or remove someone first.',
                  code: 'seat_limit', seats: { used: team.members.length, limit } }, 402);
  }
  // can't grant a role higher than allowed; only owner/admin roles are 'admin'/'member'
  const inviteRole = (role==='admin') ? 'admin' : 'member';
  // create a high-entropy invite token (256 bits) bound to THIS recipient email
  const token = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  await env.AMV_KV.put(`invite:${token}`, JSON.stringify({ teamId:team.id, email:invitee, role:inviteRole, ts:Date.now() }), { expirationTtl: 7*86400 });
  await _teamAudit(env, team, user.email, 'member_invited', { invitee, role:inviteRole });
  return json({ ok:true, inviteToken: token, inviteLink: `?invite=${token}` });
}
async function teamJoin(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const { token } = await request.json().catch(()=>({}));
  const raw = token ? await env.AMV_KV.get(`invite:${token}`) : null;
  if(!raw) return json({ error:'invalid or expired invite' }, 404);
  /* A malformed invite record is an INVALID invite, which is what the person
     needs to hear - not a server error that tells them nothing and tells the
     operator nothing either. */
  const inv = _safeJson(raw);
  if(!inv) return json({ error:'invalid or expired invite' }, 404);
  // BIND to the recipient: only the authenticated user the invite was sent to may
  // redeem it. A leaked/forwarded invite link cannot grant a role to any other
  // account (this is how an admin invite became a transferable privilege grant).
  if(!inv.email || inv.email !== user.email) return json({ error:'this invite was sent to a different email' }, 403);
  // Consume atomically so two racers can't both redeem the same token.
  if(!(await _claimOnce(env, 'inviteused', token, CLAIM_ONCE_TTL_S))) return json({ error:'this invite has already been used' }, 409);
  /* THE INVITE IS SPENT ONLY IF THEY ACTUALLY JOINED.

     The claim is permanent now, which is what stops a link being redeemed
     twice. It also means every way out of here that is NOT a join burns a
     one-time invite for ever - and one of them, the team record being busy, is
     a transient lock collision that resolves in a second. Somebody would click
     their invitation, be told to try again, and find it already used.

     So the claim is given back on every path where nobody joined. Re-claiming
     is safe: the invite record itself is what proves they were invited, and it
     is only deleted at the end, on success. */
  const _unspend = async () => { try { await _releaseClaim(env, 'inviteused', token); } catch (_) {} };
  const team0 = await DB.get(env, 'team', inv.teamId);
  if(!team0) { await _unspend(); return json({ error:'team gone' }, 404); }
  let team = team0;
  if(!team.members.find(m=>m.email===user.email)){
    /* AMV-197: the seat check and the seat itself are one operation. Two people
       redeeming the last invite together both saw room and both wrote, so the
       team ended up one seat over its limit - or, when the writes landed the
       other way, one of them joined and then vanished. */
    let joined;
    try{
      joined = await _withTeam(env, team.id, (fresh) => {
        if(!fresh) return { error:'team gone', status:404 };
        fresh.members = fresh.members || [];
        if(fresh.members.find(m=>m.email===user.email)) return { already:true };
        /* Re-checked at redemption AND inside the lock: the invite may have
           been sent when there was room and redeemed after the plan was
           downgraded, or after somebody else took the last seat a moment ago.
           Letting either through hands out a seat nobody is paying for. */
        const limit = _teamSeatLimit(_teamPlan(fresh), fresh.customCfg);
        if(fresh.members.length >= limit){
          return { error:'This team has no free seats right now. Ask the owner to upgrade or free one up.',
                   status:402, code:'seat_limit' };
        }
        fresh.members.push({ email:user.email, role:inv.role||'member', joinedAt:Date.now() });
        team = fresh;
        return { joined:true };
      });
    }catch(e){ await _unspend(); if(!_isBusy(e)) throw e; return _busyJson('team'); }
    if(joined && joined.error) { await _unspend(); return json({ error: joined.error, code: joined.code }, joined.status||400); }
    if(joined && joined.joined) await _teamAudit(env, team, user.email, 'member_joined', { role: inv.role||'member' });
  }
  /* AMV-034: A SEAT WITHOUT A POINTER IS A SEAT THE OWNER PAYS FOR AND NOBODY HOLDS.

     Joining is three writes: the member goes into the team, then two pointers
     say which team they are in. The membership is what the owner is BILLED for;
     the pointers are what lets the member reach it and what makes their requests
     spend the team's allowance.

     A failure between them leaves the worst of both. The person is in the
     members array, so a seat is counted and charged. They have no pointer, so
     they cannot open the team and their usage draws on their own allowance
     instead. And because `teamCreate` decides "are you already in a team" from
     the pointer, they can go on to create their own - which is exactly the
     abandoned-team billing hole its comment describes, reached without anybody
     doing anything unusual.

     KV has no transaction, so the answer is to compensate: if the pointers
     cannot be written, give the seat back. A join that failed and left nothing
     behind is a join somebody can simply retry.

     The invite is consumed LAST, so a retry is possible at all. */
  try {
    await env.AMV_KV.put(`userteam:${user.email}`, team.id);
    await _setUserTeam(env, user.email, team.id);
  } catch (e) {
    try {
      await _withTeam(env, team.id, (fresh) => {
        if (!fresh) return;
        fresh.members = (fresh.members || []).filter(m => String(m.email||'').toLowerCase() !== String(user.email||'').toLowerCase());
      });
    } catch (_) {}
    await _unspend();
    audit(env, 'team_join_rolled_back', { team: team.id, email: user.email });
    return json({ error: 'AMV could not finish adding you to the team. Nothing was changed - please try the invite again.',
                  code: 'join_incomplete' }, 503);
  }
  await env.AMV_KV.delete(`invite:${token}`);
  return json({ ok:true, team });
}
async function teamMembers(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ ok:true, members:[] });
  /* Say which seats the plan is actually paying for. A downgrade silently
     stops covering the people who joined last, and the owner is the only one
     who can fix it - so they have to be able to see it. */
  const limit = _teamSeatLimit(_teamPlan(team), team.customCfg);
  const seated = new Set(_teamSeated(team).map(m => m.email));
  return json({ ok:true,
    members: team.members.map(m => Object.assign({}, m, { seated: seated.has(m.email) })),
    plan: _teamPlan(team),
    seats: { used: (team.members||[]).length, limit, over: Math.max(0, (team.members||[]).length - limit) } });
}
async function teamRemove(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const { email } = await request.json().catch(()=>({}));
  let team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  if(!_can(team, user.email, 'remove')) return json({ error:'you don\u2019t have permission to remove members' }, 403);
  const target = String(email||'').toLowerCase().trim();
  if(_role(team, target)==='owner') return json({ error:'the owner can\u2019t be removed' }, 400);
  // admins can't remove other admins (only the owner can)
  if(_role(team, target)==='admin' && _role(team, user.email)!=='owner') return json({ error:'only the owner can remove an admin' }, 403);
  /* AMV-197: the removal itself happens against the team as it is now. Filtered
     from a copy read at the top of the request, a removal that raced anything
     else - somebody joining, a role change, another removal - could be written
     back over, and the person removed would still be on the team with the
     access that goes with it. */
  let out;
  try{
    out = await _withTeam(env, team.id, (fresh) => {
      if(!fresh) return { error:'no team', status:404 };
      if(!_can(fresh, user.email, 'remove')) return { error:'you don’t have permission to remove members', status:403 };
      if(_role(fresh, target)==='owner') return { error:'the owner can’t be removed', status:400 };
      if(_role(fresh, target)==='admin' && _role(fresh, user.email)!=='owner') return { error:'only the owner can remove an admin', status:403 };
      fresh.members = (fresh.members||[]).filter(m=>m.email!==target || m.role==='owner');
      team = fresh;
      return { members: fresh.members };
    });
  }catch(e){ if(!_isBusy(e)) throw e; return _busyJson('team'); }
  if(out && out.error) return json({ error: out.error, code: out.code }, out.status||400);
  await env.AMV_KV.delete(`userteam:${target}`);
  // Off the team means back on their own plan and their own counters.
  await _setUserTeam(env, target, null);
  await _teamAudit(env, team, user.email, 'member_removed', { target });
  return json({ ok:true, members:team.members });
}

/* Leave a team you are on.

   Removal was the only way off a team, which meant the only person who could
   end somebody's membership was the person whose plan they were on. That is the
   wrong way round: joining is the member's decision, so leaving has to be too -
   and while they are on it their usage is pooled with the team's, which is not
   something anybody should need permission to stop.

   The owner is the exception, and deliberately: their subscription IS the team,
   so walking away would leave everyone else holding a plan nobody pays for.
   They are told to hand it over or cancel instead of being quietly refused. */
async function teamLeave(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  let team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  if(_role(team, user.email) === 'owner'){
    return json({ error: 'You own this team, so leaving it would leave everyone else on a plan nobody is paying for. Transfer ownership first, or remove the other members.',
                  code: 'owner_cannot_leave' }, 400);
  }
  let left;
  try{
    left = await _withTeam(env, team.id, (fresh) => {
      if(!fresh) return { error:'no team', status:404 };
      /* Re-checked inside the lock: ownership can have been transferred TO them
         between the check above and this write, and an owner walking away
         leaves everybody else on a plan nobody pays for. */
      if(_role(fresh, user.email) === 'owner'){
        return { error:'You own this team, so leaving it would leave everyone else on a plan nobody is paying for. Transfer ownership first, or remove the other members.',
                 status:400, code:'owner_cannot_leave' };
      }
      fresh.members = (fresh.members||[]).filter(m => m.email !== user.email);
      team = fresh;
      return { ok:true };
    });
  }catch(e){ if(!_isBusy(e)) throw e; return _busyJson('team'); }
  if(left && left.error) return json({ error: left.error, code: left.code }, left.status||400);
  await env.AMV_KV.delete(`userteam:${user.email}`);
  await _setUserTeam(env, user.email, null);
  await _teamAudit(env, team, user.email, 'member_left', {});
  await _userEvent(env, request, user.email, 'team_left', { team: team.id });
  return json({ ok:true, left: team.id });
}

/* Change a member's role (promote to admin / demote to member). */
async function teamSetRole(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const { email, role } = await request.json().catch(()=>({}));
  let team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  if(!_can(team, user.email, 'setRole')) return json({ error:'you don\u2019t have permission to change roles' }, 403);
  const target = String(email||'').toLowerCase().trim();
  const newRole = (role==='admin') ? 'admin' : 'member';
  const m = team.members.find(x=>x.email===target);
  if(!m) return json({ error:'member not found' }, 404);
  if(m.role==='owner') return json({ error:'the owner\u2019s role can\u2019t be changed' }, 400);
  // only the owner can create/demote admins
  if(_role(team, user.email)!=='owner') return json({ error:'only the owner can change admin roles' }, 403);
  let changed;
  try{
    changed = await _withTeam(env, team.id, (fresh) => {
      if(!fresh) return { error:'no team', status:404 };
      if(!_can(fresh, user.email, 'setRole')) return { error:'you don’t have permission to change roles', status:403 };
      if(_role(fresh, user.email)!=='owner') return { error:'only the owner can change admin roles', status:403 };
      const mm = (fresh.members||[]).find(x=>x.email===target);
      /* Inside the lock, because the member may have left or been removed while
         this request was in flight - and promoting somebody who is no longer on
         the team would put them back on it. */
      if(!mm) return { error:'member not found', status:404 };
      if(mm.role==='owner') return { error:'the owner’s role can’t be changed', status:400 };
      const was = mm.role; mm.role = newRole;
      team = fresh;
      return { prev: was, members: fresh.members };
    });
  }catch(e){ if(!_isBusy(e)) throw e; return _busyJson('team'); }
  if(changed && changed.error) return json({ error: changed.error, code: changed.code }, changed.status||400);
  await _teamAudit(env, team, user.email, 'role_changed', { target, from: changed.prev, to: newRole });
  return json({ ok:true, members: changed.members });
}

/* Choose which engines the team's people may use (owner/admin).
   { engines: [...] } allows those plus the base engines; { engines: null }
   removes the policy. Unknown names are refused rather than stored, so a
   typo cannot become a rule that silently matches nothing. */
/* A team's rules for its members' computers (the page enforces them: see
   _agentRules in the client). The same shape and bounds as a person's own,
   checked here because the request does not have to come from the page. */
function _agentRulesClean(o){
  if(!o || typeof o !== 'object') return { error:'Send the rules as an object.' };
  const ctl = /[\u0000-\u001f\u007f]/, out = {};
  for(const k of ['block', 'ask', 'protect']){
    const v = o[k] == null ? [] : o[k];
    if(!Array.isArray(v) || v.length > 50) return { error:'Each list of rules holds at most 50 lines.' };
    const lines = v.map(s => String(s == null ? '' : s).trim()).filter(Boolean);
    if(lines.some(s => s.length > 120 || ctl.test(s))) return { error:'Each rule is one short line, under 120 characters.' };
    out[k] = [...new Set(lines)];
  }
  for(const k of ['afterWrite', 'onFinish']){
    const s = String(o[k] == null ? '' : o[k]).trim();
    if(s.length > 300 || ctl.test(s)) return { error:'A check is one command on one line, under 300 characters.' };
    out[k] = s;
  }
  return { rules: out };
}
async function teamSetPolicy(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const body = await request.json().catch(()=>({}));
  let team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  const setRules = Object.prototype.hasOwnProperty.call(body, 'agentRules');
  const setEngines = !setRules || Object.prototype.hasOwnProperty.call(body, 'engines');
  const deny = setRules ? 'Only the team\u2019s owner or an admin can set the team\u2019s rules.' : 'Only the team\u2019s owner or an admin can choose its engines.';
  if(!_can(team, user.email, 'setPolicy')) return json({ error: deny, code:'forbidden' }, 403);
  let agentRules = null;
  if(setRules){
    const c = _agentRulesClean(body.agentRules);
    if(c.error) return json({ error: c.error, code:'bad_request' }, 400);
    agentRules = c.rules;
  }
  let engines = null;
  if(setEngines && body.engines !== null && body.engines !== undefined){
    if(!Array.isArray(body.engines) || body.engines.length > 32) return json({ error:'Send the engines as a list.', code:'bad_request' }, 400);
    const known = new Set(Object.keys(ENGINES).concat(_partnerEngineDefs(env).map(d => d.key)));
    const bad = body.engines.find(k => typeof k !== 'string' || !known.has(k));
    if(bad !== undefined) return json({ error:'There is no engine called ' + String(bad).slice(0, 40) + '.', code:'unknown_engine' }, 400);
    engines = [...new Set(body.engines)].filter(k => !TEAM_BASE_ENGINES.includes(k));
  }
  let r;
  try{
    r = await _withTeam(env, team.id, (fresh) => {
      if(!fresh) return { error:'no team', status:404 };
      if(!_can(fresh, user.email, 'setPolicy')) return { error: deny, status:403 };
      const prev = _teamEngineList(fresh);
      /* Only what was sent changes: saving the rules leaves the engines as
         they were, and the other way round. */
      fresh.policy = Object.assign({}, fresh.policy || {}, setEngines ? { engines } : {}, setRules ? { agentRules } : {});
      team = fresh;
      return { prev };
    });
  }catch(e){ if(!_isBusy(e)) throw e; return _busyJson('team'); }
  if(r && r.error) return json({ error: r.error }, r.status || 400);
  if(setRules){
    const n = ['block', 'ask', 'protect'].reduce((a, k) => a + agentRules[k].length, 0) + (agentRules.afterWrite ? 1 : 0) + (agentRules.onFinish ? 1 : 0);
    await _teamAudit(env, team, user.email, 'agent_rules_changed', { rules: n });
    if(!setEngines) return json({ ok:true, agentRules });
  }
  const now = _teamEngineList(team);
  await _teamAudit(env, team, user.email, 'engines_changed', {
    engines: now ? now.join(',') : 'all', before: r.prev ? r.prev.join(',') : 'all' });
  return json({ ok:true, engines: now });
}

/* Read the team's action audit log (owner/admin only). */
/* WHO USED HOW MUCH, for the people who pay for it. An owner or admin sees
   each member's tokens and messages this calendar month and last, and which
   surfaces they went to - totals only, never what anybody asked, and never a
   project. Counted only from requests the TEAM paid for (tmuse:, written in
   meterStream when the billing subject is the team), so a member's own
   personal plan never shows up here. Members are told on their Usage screen. */
async function teamUsage(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'You are not on a team.' }, 404);
  if(!_can(team, user.email, 'viewUsage')) return json({ error:'Only the team’s owner and admins can see its usage.', code:'forbidden' }, 403);
  const now = monthKey();
  const d = new Date(now + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1);
  const prev = d.toISOString().slice(0, 7);
  const members = team.members || [];
  const out = []; let unread = 0;
  for (let i = 0; i < members.length; i += 20) {
    const part = await Promise.all(members.slice(i, i + 20).map(async (m) => {
      let t = null, ok = true;
      try { const r = await counter(env, `tmuse:${team.id}:${m.email}`, { op: 'lifeGet' }); t = r && r.tally; } catch (e) { ok = false; }
      if (!ok) unread++;
      const mo = (t && t.months) || {};
      const cur = mo[now] || {}, last = mo[prev] || {};
      return { email: m.email, role: m.role || 'member', read: ok,
        tokens: cur.tok || 0, messages: cur.msg || 0, surfaces: cur.s || {}, lastMonth: last.tok || 0 };
    }));
    out.push(...part);
  }
  out.sort((a, b) => b.tokens - a.tokens);
  return json({ ok: true, month: now, previous: prev, members: out,
    total: out.reduce((n, m) => n + m.tokens, 0), unread });
}
async function teamAuditLog(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ ok:true, log:[] });
  if(!_can(team, user.email, 'viewAudit')) return json({ error:'forbidden' }, 403);
  const raw = await env.AMV_KV.get(`teamlog:${team.id}`);
  const log = raw ? JSON.parse(raw) : [];
  return json({ ok:true, log: log.slice().reverse() });   // newest first
}
async function teamData(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  if(request.method==='GET') return json({ ok:true, data: team.data||{} });
  // WRITE - enforce the role model: only owner/admin may edit shared team data.
  if(!_can(team, user.email, 'editData')) return json({ error:'editing team data requires an admin or owner role' }, 403);
  const body = await request.json().catch(()=>({}));
  const patch = body.data || {};
  const bad = _boundedJson(patch, 64*1024, 6);
  if(bad) return json({ error: bad }, 413);
  /* AMV-197: merged into the team as it is inside the lock. Two admins editing
     different keys of team data at once each wrote a whole record built from
     their own read, so one of them lost everything the other had just saved -
     the shared library included, since it lives on the same record. */
  let saved;
  try{
    saved = await _withTeam(env, team.id, (fresh) => {
      if(!fresh) return { error:'no team', status:404 };
      if(!_can(fresh, user.email, 'editData')) return { error:'editing team data requires an admin or owner role', status:403 };
      const next = Object.assign({}, fresh, { data: Object.assign({}, fresh.data, patch) });
      /* Bounding the PATCH is not bounding the record: repeated 64KB writes
         under different keys grow team.data without limit, and that record is
         read on every request the team makes. The total is what has to hold,
         and it has to be measured against what is stored NOW. */
      const full = _teamRecordTooBig(next);
      if(full) return { error: full, status:413, code:'team_full' };
      fresh.data = next.data;
      return { data: fresh.data };
    });
  }catch(e){ if(!_isBusy(e)) throw e; return _busyJson('team'); }
  if(saved && saved.error) return json({ error: saved.error, code: saved.code }, saved.status||400);
  return json({ ok:true, data: saved.data });
}

/* ---------------- SHARED TEAM LIBRARY ----------------
   Any member can share a project or prompt into the team's shared library;
   every member sees it. Stored on the team record; audited. */
/* The team record is read on EVERY authenticated request from a member -
   _teamOf for permissions and _billingSubjectOf for billing both load it - so
   its size is not a storage question, it is the latency and the cost of every
   request the whole team makes. Two hundred shared items at thirty-two kilobytes
   each is a six megabyte record being fetched on every keystroke.

   So there is one ceiling on the assembled record, checked after the change is
   applied rather than on the incoming piece, because it is the total that gets
   read back. */
const TEAM_RECORD_MAX = 256 * 1024;
const TEAM_SHARE_MAX = 60;            // entries in the shared library
const TEAM_SHARE_PER_MEMBER = 20;     // so one person cannot evict everyone else's
const TEAM_TASK_MAX = 500;            // the board is fetched whole every time it opens
function _teamRecordTooBig(team){
  let n = 0;
  try{ n = JSON.stringify(team).length; }catch(e){ return 'this could not be stored'; }
  if(n <= TEAM_RECORD_MAX) return null;
  return 'Your team\u2019s shared data is full (' + Math.round(n/1024) + 'KB of ' +
         Math.round(TEAM_RECORD_MAX/1024) + 'KB). Remove something from the shared library to make room.';
}

async function teamShare(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  let team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  const { kind, item } = await request.json().catch(()=>({}));
  if(!kind || !item) return json({ error:'kind and item required' }, 400);
  const tooBig = _boundedJson(item, 32*1024, 6);
  if(tooBig) return json({ error: tooBig }, 413);
  const entry = { id:'shr_'+crypto.randomUUID().replace(/-/g,''), kind:String(kind).slice(0,24),
    title:String(item.title||item.name||'Untitled').slice(0,120), item,
    by:user.email, byName:user.name||user.email.split('@')[0], at:Date.now() };
  /* AMV-197: the library is one list on one record, so two members sharing at
     the same moment each wrote it back from their own read and one of the two
     items was never there. Somebody watching their colleague share something
     that then does not exist has no way to tell that from the product losing
     it - because that is what happened. */
  let put;
  try{
    put = await _withTeam(env, team.id, (fresh) => {
      if(!fresh) return { error:'no team', status:404 };
      const shared = Array.isArray(fresh.data && fresh.data.shared) ? fresh.data.shared.slice() : [];
      /* A per-member quota, not just a global one. With a single FIFO list, one
         member sharing sixty things silently deletes everything their colleagues
         shared - which looks exactly like the product losing their work.
         Counted inside the lock, or two shares at once both pass a check that
         only one of them should. */
      const mine = shared.filter(x => x && x.by === user.email).length;
      if(mine >= TEAM_SHARE_PER_MEMBER){
        return { error: 'You have shared ' + TEAM_SHARE_PER_MEMBER + ' items, which is the most one person can keep in the team library. Remove one of yours to add another.',
                 status:429, code:'share_limit' };
      }
      shared.unshift(entry);
      if(shared.length>TEAM_SHARE_MAX) shared.length=TEAM_SHARE_MAX;
      const next = Object.assign({}, fresh, { data: Object.assign({}, fresh.data, { shared }) });
      const full = _teamRecordTooBig(next);
      if(full) return { error: full, status:413, code:'team_full' };
      fresh.data = next.data;
      team = fresh;
      return { shared };
    });
  }catch(e){ if(!_isBusy(e)) throw e; return _busyJson('team'); }
  if(put && put.error) return json({ error: put.error, code: put.code }, put.status||400);
  await _teamAudit(env, team, user.email, 'item_shared', { kind:entry.kind, title:entry.title });
  return json({ ok:true, shared: put.shared });
}
async function teamShared(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ ok:true, shared:[] });
  return json({ ok:true, shared: (team.data && team.data.shared) || [] });
}
async function teamUnshare(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  const { id } = await request.json().catch(()=>({}));
  /* AMV-197: removing one item rewrote the whole list from a copy read at the
     top of the request, so anything a colleague shared in between came back
     from the dead - and the removal itself could be undone the same way. */
  let cut;
  try{
    cut = await _withTeam(env, team.id, (fresh) => {
      if(!fresh) return { error:'no team', status:404 };
      let shared = (fresh.data && fresh.data.shared) || [];
      const entry = shared.find(s=>s.id===id);
      // only the sharer or an admin/owner can remove
      const role = _role(fresh, user.email);
      if(entry && entry.by!==user.email && !TEAM_PERMS[role]?.has('editData')) return { error:'forbidden', status:403 };
      shared = shared.filter(s=>s.id!==id);
      fresh.data = Object.assign({}, fresh.data, { shared });
      return { shared };
    });
  }catch(e){ if(!_isBusy(e)) throw e; return _busyJson('team'); }
  if(cut && cut.error) return json({ error: cut.error, code: cut.code }, cut.status||400);
  return json({ ok:true, shared: cut.shared });
}

/* ---------------- SHARED PROJECTS: a team edits one project together ----------------
   The team library above hands out COPIES: somebody shares a project, a
   colleague takes it, and from then on there are two projects that drift. A
   shared project is ONE record, held here, that every member edits - its
   instructions and its text files - and every member's chats in it read.

   TWO PEOPLE SAVING AT ONCE. Each save names the revision it was made from.
   If somebody else saved in between, the save is refused with what is there
   now (409, code 'conflict'), and the page shows both versions and lets the
   person choose. Nothing is ever overwritten by somebody who has not seen it -
   a last-write-wins document is one where a colleague's afternoon disappears
   without a trace, and nobody can say whose fault it was.

   Every save keeps the instructions it replaced (the last TPROJ_HISTORY), with
   who and when, so a change can be undone - by saving the old text again, as a
   new version, so the undo is itself on the record. Every create, edit and
   delete goes in the team's audit log.

   Keyed by the TEAM, not by a person: it is the team's work, it outlives any
   one member, and somebody who leaves the team loses access at once because
   membership is checked on every call (_teamOf). */
const TPROJ_MAX = 20, TPROJ_FILES = 20, TPROJ_TEXT = 600 * 1024, TPROJ_INSTR = 4000, TPROJ_HISTORY = 20;
const _tprojKey = (teamId, id) => String(teamId) + ':' + String(id);
function _tprojFiles(list){
  if(!Array.isArray(list)) return { error:'files must be a list' };
  if(list.length > TPROJ_FILES) return { error:'A shared project holds up to ' + TPROJ_FILES + ' files.' };
  const out = []; let total = 0;
  for(const f of list){
    if(!f || typeof f.name !== 'string' || typeof f.text !== 'string' || !f.name.trim()) return { error:'Every file needs a name and its text.' };
    total += f.text.length;
    if(total > TPROJ_TEXT) return { error:'The files in a shared project are limited to ' + Math.round(TPROJ_TEXT / 1024) + 'k characters together.', code:'too_large' };
    out.push({ id: /^[a-z0-9_]{1,40}$/i.test(String(f.id || '')) ? String(f.id) : 'pf' + crypto.randomUUID().replace(/-/g, '').slice(0, 12),
               name: String(f.name).slice(0, 120), text: f.text, by: String(f.by || '').slice(0, 120), at: +f.at || Date.now() });
  }
  return { files: out };
}
function _tprojSummary(p){
  return { id:p.id, name:p.name, icon:p.icon, rev:p.rev, updated:p.updated, updatedBy:p.updatedBy, createdBy:p.createdBy, files:(p.files||[]).length };
}
async function teamProjectList(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ ok:true, projects:[] });
  const idx = (await DB.get(env, 'tprojidx', team.id)) || [];
  return json({ ok:true, projects: Array.isArray(idx) ? idx : [] });
}
async function teamProjectGet(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  const { id } = await request.json().catch(()=>({}));
  const p = await DB.get(env, 'tproj', _tprojKey(team.id, id));
  if(!p) return json({ error:'That shared project no longer exists.', code:'gone' }, 404);
  return json({ ok:true, project:p });
}
async function teamProjectCreate(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  const blocked = await guardAction(env, 'tproj:' + user.email, 10, 100, 'shared project changes');
  if(blocked) return blocked;
  const body = await request.json().catch(()=>({}));
  const name = String(body.name || '').trim().slice(0, 80);
  if(!name) return json({ error:'A shared project needs a name.' }, 400);
  const fl = _tprojFiles(body.files || []);
  if(fl.error) return json({ error: fl.error, code: fl.code }, fl.code === 'too_large' ? 413 : 400);
  const now = Date.now();
  const p = { id:'tp_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20), team:team.id, name,
    icon: (function(ic){ ic = String(ic == null ? '' : ic); return ic.indexOf('<') >= 0 ? '' : ic.slice(0, 8); })(body.icon),
    instructions: String(body.instructions || '').slice(0, TPROJ_INSTR), files: fl.files.map(f => Object.assign(f, { by: user.email, at: now })),
    rev:1, created:now, createdBy:user.email, updated:now, updatedBy:user.email, history:[] };
  let res;
  try{
    res = await _withKind(env, 'tprojidx', team.id, (idx) => {
      if(idx.length >= TPROJ_MAX) return { error:'Your team has ' + TPROJ_MAX + ' shared projects. Remove one to add another.', status:429, code:'tproj_limit' };
      idx.unshift(_tprojSummary(p));
      return { ok:true };
    }, []);
  }catch(e){ if(!_isBusy(e)) throw e; return _busyJson('team'); }
  if(res && res.error) return json({ error:res.error, code:res.code }, res.status || 400);
  try{ await _withKind(env, 'tproj', _tprojKey(team.id, p.id), (rec) => { Object.assign(rec, p); return { ok:true }; }, {}); }
  catch(e){ if(!_isBusy(e)) throw e; return _busyJson('team'); }
  await _teamAudit(env, team, user.email, 'project_shared', { title:name });
  return json({ ok:true, project:p });
}
async function teamProjectSave(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  const blocked = await guardAction(env, 'tproj:' + user.email, 10, 100, 'shared project changes');
  if(blocked) return blocked;
  const body = await request.json().catch(()=>({}));
  let fl = null;
  if(body.files !== undefined){ fl = _tprojFiles(body.files); if(fl.error) return json({ error: fl.error, code: fl.code }, fl.code === 'too_large' ? 413 : 400); }
  if(body.name !== undefined && !String(body.name).trim()) return json({ error:'A shared project needs a name.' }, 400);
  let res;
  try{
    res = await _withKind(env, 'tproj', _tprojKey(team.id, body.id), (p) => {
      if(!p) return { error:'That shared project no longer exists.', status:404, code:'gone' };
      /* The check this whole feature rests on: inside the lock, against what
         is stored NOW. A save made from an older revision is refused with the
         current one, never merged over it. */
      if(+body.baseRev !== p.rev) return { error:'Somebody else saved this project while you were editing it.', status:409, code:'conflict', project:p };
      const now = Date.now(), what = [];
      if(body.instructions !== undefined){
        const next = String(body.instructions || '').slice(0, TPROJ_INSTR);
        if(next !== p.instructions){
          p.history = [{ rev:p.rev, by:p.updatedBy, at:p.updated, instructions:p.instructions }].concat(p.history || []).slice(0, TPROJ_HISTORY);
          p.instructions = next; what.push('instructions');
        }
      }
      if(body.name !== undefined){ const n = String(body.name).trim().slice(0, 80); if(n !== p.name){ p.name = n; what.push('name'); } }
      if(fl){
        const was = new Map((p.files || []).map(f => [f.id, f]));
        /* A file nobody touched keeps who added it; a new or changed one is this person's. */
        p.files = fl.files.map(f => { const o = was.get(f.id); return o && o.text === f.text && o.name === f.name ? o : Object.assign(f, { by:user.email, at:now }); });
        what.push('files');
      }
      if(!what.length) return { ok:true, project:p, unchanged:true };
      p.rev += 1; p.updated = now; p.updatedBy = user.email;
      return { ok:true, project:p, what };
    });
  }catch(e){ if(!_isBusy(e)) throw e; return _busyJson('team'); }
  if(res && res.error) return json({ error:res.error, code:res.code, project:res.project }, res.status || 400);
  if(!res.unchanged){
    try{ await _withKind(env, 'tprojidx', team.id, (idx) => { const i = idx.findIndex(x => x && x.id === res.project.id); if(i >= 0) idx[i] = _tprojSummary(res.project); return { ok:true }; }, []); }
    catch(e){ if(!_isBusy(e)) throw e; /* the record is saved; the list catches up on the next save */ }
    await _teamAudit(env, team, user.email, 'project_edited', { title:res.project.name, what:res.what.join(','), rev:res.project.rev });
  }
  return json({ ok:true, project:res.project });
}
async function teamProjectDelete(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  const { id } = await request.json().catch(()=>({}));
  const p = await DB.get(env, 'tproj', _tprojKey(team.id, id));
  if(!p) return json({ error:'That shared project no longer exists.', code:'gone' }, 404);
  /* Whoever shared it, or an owner or admin - the same rule as the library. */
  if(p.createdBy !== user.email && !_can(team, user.email, 'editData')) return json({ error:'Only whoever shared it, or a team admin, can remove a shared project.' }, 403);
  try{ await _withKind(env, 'tprojidx', team.id, (idx) => { const i = idx.findIndex(x => x && x.id === id); if(i >= 0) idx.splice(i, 1); return { ok:true }; }, []); }
  catch(e){ if(!_isBusy(e)) throw e; return _busyJson('team'); }
  await DB.del(env, 'tproj', _tprojKey(team.id, id));
  await _teamAudit(env, team, user.email, 'project_removed', { title:p.name });
  return json({ ok:true });
}

/* ---------------- TEAM PRESENCE ----------------
   Poll-based heartbeat: each ping records the member's last-seen time; anyone
   seen in the last 60s counts as "active now". Cheap, no sockets, and honest -
   it reflects real recent activity. */
async function teamPresence(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ ok:true, present:[] });
  const key = 'presence:'+team.id;
  let map = (await DB.get(env, 'presence', team.id)) || {};
  const now = Date.now();
  map[user.email] = now;
  // prune stale (>5 min) to keep it small
  for(const e of Object.keys(map)){ if(now - map[e] > 300000) delete map[e]; }
  await DB.put(env, 'presence', team.id, map);
  const WINDOW = 60000; // active if seen in the last minute
  const present = (team.members||[]).map(m=>({
    email:m.email, name:(m.email===user.email?(user.name||''):'')||m.email.split('@')[0],
    active: (map[m.email] && (now - map[m.email] < WINDOW)) || m.email===user.email
  }));
  return json({ ok:true, present });
}

/* ---------------- TEAM TASK ASSIGNMENT ----------------
   A real assignment system: any member can create a task and assign it to a
   teammate; the assignee (or a manager) can move it across statuses. Tasks are
   stored per-team and every change is written to the team audit log. */
const TASK_STATUSES = new Set(['todo', 'in_progress', 'done']);
async function _teamTasks(env, teamId){ return (await DB.get(env, 'teamtasks', teamId)) || []; }
/* No unlocked save here: a task list every member writes is changed only
   under the team-tasks lock (see teamTaskCreate). The plain write that sat
   here had no callers left, and an unlocked write lying around is the one
   the next change reaches for. */

async function teamTasks(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  return json({ ok:true, tasks: await _teamTasks(env, team.id), members: (team.members||[]).map(m=>({email:m.email, role:m.role})) });
}

async function teamTaskCreate(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  const { title, assignee, notes, priority } = await request.json().catch(()=>({}));
  if(!title || !String(title).trim()) return json({ error:'title required' }, 400);
  // assignee, if given, must be a real member of this team
  const asg = (assignee||'').toLowerCase().trim();
  if(asg && !(team.members||[]).some(m=>m.email===asg)) return json({ error:'assignee is not a team member' }, 400);
  const task = {
    id: 't'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
    title: String(title).trim().slice(0, 300),
    notes: String(notes||'').slice(0, 4000),
    assignee: asg || null,
    priority: ['low','normal','high'].includes(priority) ? priority : 'normal',
    status: 'todo',
    createdBy: user.email,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  /* AMV-SP-05: A TEAM'S TASK LIST IS WRITTEN BY EVERY MEMBER OF THE TEAM.

     Read the list, add to it, write it back - with no lock, and with as many
     writers as the team has people. Two members adding a task in the same
     moment both read the list, both prepend, and the later write puts back a
     copy that never saw the other. The task is gone and the person who created
     it was told it worked; they find out when somebody asks why it was never
     done.

     The board ceiling moved in here with it. Read outside, it was the same
     check-then-act: two members could both read a list one short of the limit
     and both be told yes. Bounded for the same reason the team record is - this
     list is fetched whole every time anybody opens the board. Refused rather
     than silently trimmed, because a task board that quietly drops the oldest
     item is a task board that loses work without saying so. */
  let tasks = [];
  let full = false;
  await _withKind(env, 'teamtasks', team.id, (list) => {
    if (list.length >= TEAM_TASK_MAX) { full = true; tasks = list.slice(); return; }
    list.unshift(task);
    tasks = list.slice();
  }, []);
  if (full) {
    return json({ error: 'This team has ' + TEAM_TASK_MAX + ' tasks, which is the most a board holds. Close or delete some to add more.',
                  code: 'task_limit' }, 429);
  }
  await _teamAudit(env, team, user.email, 'task_created', { target: asg || '(unassigned)', title: task.title });
  if (asg && asg !== user.email) await _notifyAssignee(env, team, user, asg, task);
  return json({ ok:true, task, tasks });
}

/* Email a teammate when work lands on them (no-op if email isn't configured,
   never throws - notification must not break the assignment). */
async function _notifyAssignee(env, team, assigner, assigneeEmail, task) {
  try {
    const appUrl = (env.APP_URL || '').replace(/\/$/, '');
    await sendTaskAssignedEmail(env, assigneeEmail, {
      assignerName: assigner.name || assigner.email,
      taskTitle: task.title,
      priority: task.priority,
      teamName: team.name,
      appUrl: appUrl ? appUrl + '?tab=team' : '',
    });
  } catch (e) { /* email failure must not affect the operation */ }
}

async function teamTaskUpdate(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const team = await _teamOf(env, user.email);
  if(!team) return json({ error:'no team' }, 404);
  const { id, status, assignee, del } = await request.json().catch(()=>({}));
  const tasks = await _teamTasks(env, team.id);
  const i = tasks.findIndex(t=>t.id===id);
  if(i<0) return json({ error:'task not found' }, 404);
  const me = (team.members||[]).find(m=>m.email===user.email);
  const canManage = me && (me.role==='owner' || me.role==='admin');
  const isAssignee = tasks[i].assignee === user.email;
  const isCreator = tasks[i].createdBy === user.email;
  // delete: only managers or the creator
  if(del){
    if(!canManage && !isCreator) return json({ error:'not allowed to delete this task' }, 403);
    /* Re-found inside the lock. Splicing by an index read beforehand removes
       whatever is at that position NOW, which after somebody else's create is a
       different task entirely. */
    const removed = tasks[i];
    let out = tasks;
    await _withKind(env, 'teamtasks', team.id, (list) => {
      const j = list.findIndex(t => t && t.id === id);
      if (j >= 0) list.splice(j, 1);
      out = list.slice();
    }, []);
    await _teamAudit(env, team, user.email, 'task_deleted', { title: removed.title });
    return json({ ok:true, tasks: out });
  }
  // status change: assignee, creator, or a manager
  if(status){
    if(!TASK_STATUSES.has(status)) return json({ error:'invalid status' }, 400);
    if(!canManage && !isAssignee && !isCreator) return json({ error:'not allowed to update this task' }, 403);
    tasks[i].status = status;
  }
  // reassign: managers only (or the creator)
  if(assignee !== undefined){
    if(!canManage && !isCreator) return json({ error:'only managers can reassign' }, 403);
    const asg = (assignee||'').toLowerCase().trim();
    if(asg && !(team.members||[]).some(m=>m.email===asg)) return json({ error:'assignee is not a team member' }, 400);
    await _teamAudit(env, team, user.email, 'task_reassigned', { target: asg||'(unassigned)', title: tasks[i].title });
    if (asg && asg !== user.email) await _notifyAssignee(env, team, user, asg, tasks[i]);
  }
  /* Applied inside the lock, to the task as it is at that moment. The
     permission checks above are decided from the copy read beforehand, which is
     correct - they are about this person's role and about who created or was
     assigned the task, and none of those change under a concurrent write to a
     DIFFERENT task. What must not come from that copy is the LIST. */
  const wantStatus = status || null;
  const wantAssignee = assignee !== undefined ? ((assignee||'').toLowerCase().trim() || null) : undefined;
  let out = tasks;
  await _withKind(env, 'teamtasks', team.id, (list) => {
    const j = list.findIndex(t => t && t.id === id);
    if (j < 0) { out = list.slice(); return; }
    if (wantStatus) list[j].status = wantStatus;
    if (wantAssignee !== undefined) list[j].assignee = wantAssignee;
    list[j].updatedAt = Date.now();
    out = list.slice();
  }, []);
  if(status) await _teamAudit(env, team, user.email, 'task_status', { title: tasks[i].title, to: status });
  return json({ ok:true, tasks: out });
}

async function syncPull(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'unauthorized' }, 401);
  const data = (await DB.get(env, 'data', user.email)) || {};
  // rev is what a client echoes back on push to prove it saw this version.
  return json({ ok:true, data, rev: data._rev || 0, serverTime: Date.now() });
}
/* Push the user's data up (last-write-wins per top-level key, with a merge). */
const SYNC_ALLOWED_KEYS = new Set([
  'chats','convs','memory','workspaces','prompts','settings','imgs','vids','custom_cfg','plan_since',
  // Your actual WORK - Dev projects, Lab sessions, and everything in Recents.
  // These used to live only in the browser, so switching device or clearing the
  // cache destroyed them. They are the most valuable thing a user has.
  'sessions','skills','handoffs','profile',
  /* What AMV has learned about each of your projects by working in them -
     which command runs the tests, where the source lives. Small, and the
     thing that stops every session paying to rediscover the same facts.
     Contains no paths: a project is keyed by a hash of its folder, so
     somebody's home directory and real name never reach this record. */
  'projects',
  /* Installed plugins. A removed one is kept as a tombstone, so the merge
     below lets a removal on one device win over an older copy on another. */
  'plugins'
]);
const SYNC_MAX_BYTES = 4 * 1024 * 1024;   // 4MB hard ceiling (well under KV's 25MB, sane for D1)

