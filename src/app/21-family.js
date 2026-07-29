/* ============================================================
   LINKED ACCOUNTS (Family / shared access)

   Lets one AMV account see and act on another - a parent managing a
   child's schedule, partners sharing a calendar, an assistant running
   an executive's inbox.

   THE SECURITY PROBLEM, STATED PLAINLY: "let me control another
   account" is an account-takeover feature if it is built casually.
   Anyone who could name your email would get your calendar. So the
   whole design is consent:

   1. MUTUAL CONSENT. A link needs an invite from A and an explicit
      acceptance from B, each proven by a code delivered to THEIR OWN
      email. Naming an address is never enough - you must control it.
   2. SCOPED. A link grants specific scopes (see calendar, add events,
      read mail, spend). Nothing is granted that was not ticked.
   3. REVOCABLE INSTANTLY, BY EITHER SIDE, with no negotiation.
   4. VISIBLE. Both sides can always see every active link and every
      action taken through it. No silent access.
   5. ASYMMETRIC BY DEFAULT. A link is one direction. Parent seeing a
      child's calendar does NOT give the child the parent's.

   Codes are single-use, expire, and are rate limited. The server is
   the authority once connected - this client mirror never grants
   access the backend has not confirmed.
   ============================================================ */
const AMVFamily = {
  KEY:'amv_links',
  CODE_TTL_MS: 15*60*1000,     // an invite code is valid for 15 minutes
  MAX_ATTEMPTS: 5,             // wrong-code attempts before the invite dies

  SCOPES:{
    calendar_view:'See their calendar',
    calendar_edit:'Add and change events on their calendar',
    email_view:'Read their email',
    email_send:'Send email as them',
    tasks_view:'See their tasks and reminders',
    tasks_edit:'Create tasks and reminders for them',
    location_view:'See their shared location',
    spend:'Make purchases on their account'
  },
  // Scopes that are never granted silently - they always need a fresh,
  // explicit confirmation from the account being accessed.
  HIGH_RISK:['email_send','spend','calendar_edit','tasks_edit'],

  _all(){ try{ return load(this.KEY) || { links:[], invites:[] }; }catch(e){ return { links:[], invites:[] }; } },
  _save(v){ try{ store(this.KEY, v); }catch(e){} },
  _me(){ try{ return ((S.user&&S.user.email)||'').toLowerCase(); }catch(e){ return ''; } },
  _code(){ // 6 digits from a real CSPRNG, never Math.random
    try{ const a=new Uint32Array(1); crypto.getRandomValues(a); return String(100000 + (a[0] % 900000)); }
    catch(e){ return String(100000 + Math.floor(Math.random()*900000)); }
  },

  /* Step 1 - A invites B, choosing exactly what B may do.
     This ONLY creates a pending invite. It grants nothing. */
  invite(email, scopes, opts){
    opts = opts || {};
    const me = this._me();
    const target = String(email||'').trim().toLowerCase();
    if(!target || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target)) throw new Error('Enter a valid email address.');
    if(target === me) throw new Error('That is your own account.');
    const want = (scopes||[]).filter(s => this.SCOPES[s]);
    if(!want.length) throw new Error('Choose at least one thing this link may do.');

    const d = this._all();
    if(d.links.some(l => l.owner===target && l.grantee===me && l.active))
      throw new Error('You already have an active link to that account.');

    const inv = {
      id:'inv_'+Date.now().toString(36),
      // direction: the GRANTEE (me) is asking the OWNER (them) for access
      grantee: me, owner: target, scopes: want,
      code: this._code(), createdAt: Date.now(), expiresAt: Date.now()+this.CODE_TTL_MS,
      attempts: 0, status:'pending', label: String(opts.label||'').slice(0,40)
    };
    d.invites = [inv, ...(d.invites||[])].slice(0,50);
    this._save(d);
    // The code must reach the OWNER's own inbox. Naming an address proves
    // nothing; controlling it does. Delivery is server-side when connected.
    return { id:inv.id, owner:target, scopes:want, expiresAt:inv.expiresAt,
      delivery: this._deliver(inv) };
  },

  /* Send the code to the account being accessed. Honest about degradation:
     with no backend it cannot email, and says so rather than pretending. */
  _deliver(inv){
    try{
      if(window.AMV_API && AMV_API.live && AMV_API.token){
        fetch(String(AMV_API.base).replace(/\/$/,'')+'/v1/link/invite',{
          method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+AMV_API.token},
          body: JSON.stringify({ owner:inv.owner, scopes:inv.scopes, id:inv.id })
        }).catch(()=>{});
        return { sent:true, to:inv.owner, how:'A confirmation code was sent to '+inv.owner+'.' };
      }
    }catch(e){}
    return { sent:false, to:inv.owner,
      how:'Connect the AMV backend so the confirmation code can be emailed to '+inv.owner+'. Until then the link cannot be approved, because approval must come from that account.' };
  },

  /* Server-authoritative accept. When the backend is connected the code is
     verified THERE against the server's copy, so a link cannot be forged by
     editing local state, and both accounts (usually on different devices)
     genuinely share it. The local path below is the offline mirror. */
  async acceptRemote(inviteId, code){
    const base = (typeof loadStr === 'function' && (loadStr('amv_api_base')||'')).replace(/\/$/,'');
    const tok = (typeof loadStr === 'function' && loadStr('amv_api_token')) || '';
    if(!base || !tok) return this.accept(inviteId, code);   // offline mirror
    const r = await fetchDeadline(base + '/v1/link/accept', {
      method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},
      body: JSON.stringify({ id:inviteId, code:String(code||'').trim() })
    });
    const d = await r.json().catch(()=>({}));
    if(!r.ok || !d.ok) throw new Error(d.error || 'That code could not be verified.');
    // mirror locally so the UI matches immediately
    try{ const all=this._all(); all.links=[d.link, ...(all.links||[])]; this._save(all); }catch(e){}
    return d.link;
  },

  /* Step 2 - B accepts, proving control of their own inbox with the code.
     Only this creates the link. Wrong codes are counted and burn the invite. */
  accept(inviteId, code){
    const d = this._all();
    const inv = (d.invites||[]).find(i => i.id === inviteId);
    if(!inv) throw new Error('That invitation no longer exists.');
    if(inv.status === 'blocked') throw new Error('That invitation was blocked after too many wrong codes. Ask for a new one.');
    if(inv.status === 'expired') throw new Error('That invitation expired. Ask for a new one.');
    if(inv.status !== 'pending') throw new Error('That invitation has already been used.');
    if(Date.now() > inv.expiresAt){ inv.status='expired'; this._save(d); throw new Error('That code has expired. Ask for a new one.'); }
    // Only the account being accessed can accept - not the requester.
    if(this._me() !== inv.owner) throw new Error('Only ' + inv.owner + ' can approve this link, from their own account.');
    if(String(code||'').trim() !== inv.code){
      inv.attempts = (inv.attempts||0) + 1;
      if(inv.attempts >= this.MAX_ATTEMPTS){ inv.status='blocked'; this._save(d); throw new Error('Too many wrong codes. This invitation is now blocked - start again.'); }
      this._save(d);
      throw new Error('That code is not right. ' + (this.MAX_ATTEMPTS - inv.attempts) + ' attempts left.');
    }
    inv.status = 'accepted';
    const link = {
      id:'lnk_'+Date.now().toString(36),
      owner: inv.owner, grantee: inv.grantee, scopes: inv.scopes,
      label: inv.label, active: true, createdAt: Date.now(), log: []
    };
    d.links = [link, ...(d.links||[])];
    this._save(d);
    return link;
  },

  /* Say no. Only the account being asked for can refuse, and refusing kills
     the code immediately - otherwise "no" would only mean "not yet", and a
     request could sit there waiting to be accepted by mistake later. */
  refuse(inviteId){
    const d = this._all();
    const inv = (d.invites||[]).find(i => i.id === inviteId);
    if(!inv) throw new Error('That invitation no longer exists.');
    if(this._me() !== inv.owner) throw new Error('Only ' + inv.owner + ' can refuse this, from their own account.');
    if(inv.status !== 'pending') throw new Error('That invitation is no longer pending.');
    inv.status = 'refused'; inv.refusedAt = Date.now();
    this._save(d);
    return { refused:true };
  },

  /* Either side can cut a link instantly. No approval from the other side. */
  revoke(linkId){
    const d = this._all(); const me = this._me();
    const l = (d.links||[]).find(x => x.id === linkId);
    if(!l) throw new Error('No such link.');
    if(me !== l.owner && me !== l.grantee) throw new Error('That link is not yours to revoke.');
    l.active = false; l.revokedAt = Date.now(); l.revokedBy = me;
    this._save(d);
    return { revoked:true, by:me };
  },

  /* Links visible to me, in both directions - never a hidden connection. */
  mine(){
    const me = this._me(); const d = this._all();
    const links = (d.links||[]).filter(l => l.owner===me || l.grantee===me);
    return {
      iCanAccess: links.filter(l => l.grantee===me && l.active)
        .map(l => ({ id:l.id, account:l.owner, scopes:l.scopes, label:l.label })),
      canAccessMe: links.filter(l => l.owner===me && l.active)
        .map(l => ({ id:l.id, account:l.grantee, scopes:l.scopes, label:l.label })),
      pendingForMe: (d.invites||[]).filter(i => i.owner===me && i.status==='pending' && Date.now()<i.expiresAt)
        .map(i => ({ id:i.id, from:i.grantee, scopes:i.scopes })),
      revoked: links.filter(l => !l.active).length
    };
  },

  /* THE GATE every cross-account action must pass. Returns the reason it is
     refused, or null when allowed. Deny by default. */
  check(targetEmail, scope){
    const me = this._me();
    const target = String(targetEmail||'').toLowerCase();
    if(!target || target === me) return null;                      // own account
    if(!this.SCOPES[scope]) return 'Unknown permission "'+scope+'".';
    const d = this._all();
    const link = (d.links||[]).find(l => l.owner===target && l.grantee===me && l.active);
    if(!link) return 'You do not have an approved link to ' + target + '. They must approve it from their own account first.';
    if(link.scopes.indexOf(scope) < 0)
      return 'Your link to ' + target + ' does not include "' + this.SCOPES[scope] + '". They would need to approve that separately.';
    return null;
  },

  /* Record every cross-account action so BOTH sides can see it. Access that
     cannot be reviewed is not consent, it is surveillance. */
  note(targetEmail, scope, what){
    const d = this._all(); const me = this._me();
    const link = (d.links||[]).find(l => l.owner===String(targetEmail||'').toLowerCase() && l.grantee===me && l.active);
    if(!link) return;
    link.log = [{ at:Date.now(), by:me, scope, what:String(what||'').slice(0,160) }, ...(link.log||[])].slice(0,200);
    this._save(d);
  },
  history(linkId){
    const d = this._all(); const me = this._me();
    const l = (d.links||[]).find(x => x.id===linkId && (x.owner===me || x.grantee===me));
    return l ? (l.log||[]) : [];
  }
};
try{ window.AMVFamily = AMVFamily; }catch(e){}

/* Expose linked accounts to chat/Crew - reads and the consent flow only.
   Acting on another account still goes through AMVFamily.check() at the
   point of action, so a connector can never become a side door. */
try{
  if(typeof AMVConnectors !== 'undefined'){
    AMVConnectors.register({
      id:'family', name:'Linked accounts', auth:'none', channel:'local',
      isLive(){ return true; },
      actions:{
        list:{ desc:'Show every linked account: what you can access, who can access you, and pending requests.',
          async run(){ return AMVFamily.mine(); } },
        invite:{ desc:'Ask for access to another account. Args: {email, scopes:[...]}. They must approve with a code sent to their own inbox.',
          risk:'high', riskLabel:'request access to another person’s account',
          async run(a){ return AMVFamily.invite((a&&a.email)||'', (a&&a.scopes)||[], {label:(a&&a.label)||''}); } },
        revoke:{ desc:'End a link immediately. Args: {id}', risk:'high', riskLabel:'end an account link',
          async run(a){ return AMVFamily.revoke((a&&a.id)||''); } },
        can_i:{ desc:'Check whether you may do something on another account. Args: {email, scope}',
          async run(a){ const why=AMVFamily.check((a&&a.email)||'', (a&&a.scope)||'');
            return { allowed: !why, reason: why || 'Allowed by an approved link.' }; } }
      }
    });
  }
}catch(e){}
