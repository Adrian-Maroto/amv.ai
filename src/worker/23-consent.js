    }, { items: [] });
  }
  audit(env, 'link_accepted', { owner:user.email, grantee:inv.grantee, scopes:(inv.scopes||[]).join(',') });

  /* A FAMILY invitation is the same consent flow with a different consequence.

     The code is generated on the server and emailed to the account being added,
     and only that account can redeem it - so a parent cannot put somebody in
     their family by typing an address. The child confirms, in their own inbox,
     before a single limit applies to them. That property is why this reuses
     the link flow rather than growing a second one beside it (AMV-102). */
  if((inv.scopes||[]).includes('family')){
    const parent = inv.grantee;                       // the one who sent the invitation
    /* AMV-197: the "is the family full" check and the seat it grants are one
       operation. Two children accepting the last invitation together both saw
       room, and the family ended up over its limit - or one of them joined and
       was written away by the other. */
    let res;
    try{
      /* The family may not exist yet, and the helper's save only writes a
         record that was already there - so the write happens inside the mutate,
         which is still inside the lock. */
      res = await _withRecord(env, 'fam', String(parent || '').toLowerCase(),
        _loadFam,
        async () => {},
        async (fresh) => {
          const fam = fresh || { id:'fam_'+crypto.randomUUID().replace(/-/g,''), parentEmail: parent, members:[{ email: parent, role:'parent', joinedAt: Date.now() }], createdAt: Date.now() };
          if(!(fam.members||[]).some(m=>m.email===user.email)){
            const kids = (fam.members||[]).filter(m=>m.role==='child');
            if(kids.length >= FAMILY_MAX_CHILDREN){
              return { error:'That family is full (' + FAMILY_MAX_CHILDREN + ' accounts).', status:402, code:'family_full' };
            }
            fam.members.push({ email:user.email, role:'child', joinedAt:Date.now(), limits: Object.assign({}, FAMILY_DEFAULTS) });
          }
          await DB.put(env, 'fam', parent, fam);
          return { ok:true };
        });
    }catch(e){ if(!_isBusy(e)) throw e; return _busyJson('family'); }
    if(res && res.error) return json({ error: res.error, code: res.code }, res.status||400);
    /* AMV-202: the marker every parental limit reads, written under the lock. */
    await _withRecord(env, 'ent', String(user.email||'').toLowerCase(),
      async (e, k) => (await DB.get(e, 'ent', k)) || { plan:'free' },
      async (e, k, rec) => { await DB.put(e, 'ent', k, rec); },
      (rec) => { rec.familyOf = parent; });
    await _userEvent(env, request, user.email, 'family_joined', { parent });
    audit(env, 'family_joined', { parent, child:user.email });
    return json({ ok:true, link, family:{ parent, limits: FAMILY_DEFAULTS } });
  }
  return json({ ok:true, link });
}

/* List / revoke links (/v1/link/list, /v1/link/revoke). Either side can end a
   link with no negotiation, and it dies for both immediately. */
/* NO LIST AND NO REVOKE FOR LINKS ANY MORE.

   Both served the "access to someone else's account" screen, which the owner
   removed as a security risk. Nothing in the product calls either, and a route
   nothing asks for is a door somebody else finds first. A link record that is
   left over grants nothing - no route ever consulted one to permit an action -
   and is erased with the account like everything else. A family is ended with
   /v1/family/remove or /v1/family/leave. */

const ADULT_AGE = 18;

/* Whether this account may touch money. Deny by default: an age nobody has
