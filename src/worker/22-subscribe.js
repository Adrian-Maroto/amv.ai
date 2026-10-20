/* ============================================================
   SUBSCRIBE WITH A TOKENISED CARD  (/v1/subscribe)

   The client uses Stripe Elements, so the card goes browser->Stripe and
   we only ever receive a PaymentMethod id. This creates the customer,
   attaches the method and starts the subscription server-side, where
   the price ids live. Entitlement is granted ONLY on a confirmed
   active/trialing subscription - never on the client's say-so.
   ============================================================ */
async function stripeSubscribe(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in first' }, 401);
  const blocked = await guardAction(env, 'subscribe:' + user.email, 5, 40, 'subscription attempts');
  if(blocked) return blocked;
  if(!env.STRIPE_SECRET_KEY)
    return json({ error:'Payments are not configured on this deployment.', code:'needs_service' }, 503);

  const body = await request.json().catch(() => ({}));
  const plan = String(body.plan || '').toLowerCase();
  const pm = String(body.payment_method || '');
  /* The same question the hosted checkout asks, answered by the same function -
     see _planUnsellable. This route used to carry its own copy of the wording,
     which is how the other one came to disagree with it. */
  const priceId = _stripePriceId(env, plan);
  if(!priceId) return _planUnsellable(plan);
  if(!/^pm_/.test(pm)) return json({ error:'a valid payment method is required' }, 400);

  const sk = { 'Authorization':'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type':'application/x-www-form-urlencoded' };
  const form = o => new URLSearchParams(o).toString();
  try{
    // reuse the customer if we already made one for this account
    const rec = (await DB.get(env, 'billing', user.email)) || {};
    let customer = rec.customerId;
    if(!customer){
      const cr = await fetchDeadline('https://api.stripe.com/v1/customers', { method:'POST', headers:sk,
        body: form({ email:user.email, 'metadata[amv_user]':user.email }) });
      const cd = await cr.json();
      if(!cr.ok) return json({ error:cd.error?.message || 'could not create customer' }, 502);
      customer = cd.id;
    }
    /* Without this the subscription is invisible to every later webhook, and
       the customer can neither cancel from the billing portal nor see an
       invoice. A customer who cannot cancel disputes the charge instead. */
    await _linkCustomer(env, user.email, customer);
    // attach the tokenised card and make it the default
    const at = await fetchDeadline('https://api.stripe.com/v1/payment_methods/' + encodeURIComponent(pm) + '/attach',
      { method:'POST', headers:sk, body: form({ customer }) });
    if(!at.ok){ const ad = await at.json(); return json({ error:ad.error?.message || 'card could not be attached' }, 402); }
    await fetchDeadline('https://api.stripe.com/v1/customers/' + customer, { method:'POST', headers:sk,
      body: form({ 'invoice_settings[default_payment_method]':pm }) });

    const sr = await fetchDeadline('https://api.stripe.com/v1/subscriptions', { method:'POST', headers:sk,
      body: form({ customer, 'items[0][price]':priceId, 'expand[0]':'latest_invoice.payment_intent' }) });
    const sd = await sr.json();
    if(!sr.ok) return json({ error:sd.error?.message || 'subscription failed' }, 402);

    // The card may need 3-D Secure. Do NOT grant anything until it is done.
    const status = sd.status;
    const pi = sd.latest_invoice && sd.latest_invoice.payment_intent;
    if(status !== 'active' && status !== 'trialing'){
      await DB.put(env, 'billing', user.email, Object.assign(rec, { customerId:customer, subId:sd.id, status }));
      audit(env, 'subscribe_pending', { by:user.email, plan, status });
      return json({ ok:false, code:'requires_action', status,
        clientSecret: (pi && pi.client_secret) || null,
        need:'Your bank needs to confirm this payment before the plan starts.' }, 402);
    }
    await DB.put(env, 'billing', user.email, Object.assign(rec, { customerId:customer, subId:sd.id, status }));
    await setEntitlement(env, user.email, plan);   // authoritative: server grants the plan
    /* An upgrade is a new subscription on the same customer, and Stripe does
       not know it replaces the old one. Checkout's completion cancels the old
       one; this route never did, so upgrading from the card form billed both
       plans every month. See _cancelSupersededSubs. */
    await _cancelSupersededSubs(env, customer, sd.id, user.email);
    audit(env, 'subscribe_active', { by:user.email, plan, sub:sd.id });
    return json({ ok:true, plan, status });
  }catch(e){
    return json({ error:'Payment could not be completed.' }, 502);
  }
}

/* Best-effort fraud mirror (/v1/fraud/record). Accepts an assessment the
   client already made so the operator has a server-side copy. Never trusted
   for enforcement - it is a record, not a decision. */
async function fraudRecord(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in first' }, 401);
  const blocked = await guardAction(env, 'fraudrec:' + user.email, 30, 500, 'fraud records');
  if(blocked) return blocked;
  const a = await request.json().catch(() => ({}));
  if(!a || !a.category) return json({ ok:true, stored:false });
  const idx = (await DB.get(env, 'fraud', 'index')) || { items: [] };
  idx.items = [{ at:Date.now(), by:user.email, category:String(a.category).slice(0,40),
    risk:String(a.risk||'').slice(0,10), action:String(a.action||'').slice(0,30),
    confidence:+a.confidence || 0 }, ...(idx.items||[])].slice(0, 500);
  await DB.put(env, 'fraud', 'index', idx);
  return json({ ok:true, stored:true });
}

/* THE OLDER GOOGLE GRANT WAS EXCHANGED AND REFRESHED HERE.

   googleOAuthExchange took a code and a verifier from the browser and traded
   them for a refresh token this Worker stored. googleOAuthRefresh minted a
   short-lived access token from it and HANDED THAT TO THE PAGE, which is what
   made the browser-side mailbox, calendar, Drive and Classroom readers
   possible - and what made them a liability: a provider token in a page is a
   token anything in that page can take, and it dies with the tab, so nothing
   built on it could run overnight however it was described.

   Connected accounts replaced both. The exchange happens in connFinish, the
   token is sealed under CONNECT_KEY and never leaves this Worker, and the
   browser asks /v1/connect/act to have something DONE rather than asking for a
   key to do it with.

   The routes are gone rather than left answering: an endpoint that still hands
   out a provider token is one somebody will find a use for. */


/* Accept a link invitation (/v1/link/accept). The client mirror cannot be the
   authority here: two different accounts, usually on different devices, must
   agree, and the caller must not be able to approve their own request by
   editing local state. So the code is verified HERE against the server copy,
   and only the account being accessed can redeem it. */
async function linkAccept(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in first' }, 401);
  const blocked = await guardAction(env, 'linkacc:' + user.email, 10, 60, 'link approvals');
  if(blocked) return blocked;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '').slice(0, 40);
  const code = String(body.code || '').trim();
  if(!id || !code) return json({ error:'id and code required' }, 400);

  // keyed by OWNER, so only the account being accessed can even find it
  const key = user.email + '|' + id;
  const inv = await DB.get(env, 'link', key);
  if(!inv) return json({ error:'That invitation does not exist for this account.' }, 404);
  if(inv.status !== 'pending') return json({ error:'That invitation has already been used or blocked.' }, 400);
  /* A request for access that was sent before access was removed cannot be
     accepted into existence now. */
  if(!(inv.scopes || []).includes('family') || (inv.scopes || []).length !== 1){
    inv.status = 'refused'; await DB.put(env, 'link', key, inv);
    return json({ error:'Access to someone else\u2019s account has been removed from AMV, so this request can no longer be accepted.', code:'link_removed' }, 410);
  }
  if(Date.now() > inv.expiresAt){
    inv.status = 'expired'; await DB.put(env, 'link', key, inv);
    return json({ error:'That code has expired. Ask for a new one.' }, 400);
  }
  if(String(inv.code) !== code){
    inv.attempts = (inv.attempts || 0) + 1;
    if(inv.attempts >= 5){
      inv.status = 'blocked'; await DB.put(env, 'link', key, inv);
      audit(env, 'link_blocked', { owner:user.email, grantee:inv.grantee });
      return json({ error:'Too many wrong codes. This invitation is blocked.' }, 429);
    }
    await DB.put(env, 'link', key, inv);
    return json({ error:'That code is not right. ' + (5 - inv.attempts) + ' attempts left.' }, 400);
  }

  inv.status = 'accepted'; inv.acceptedAt = Date.now();
  await DB.put(env, 'link', key, inv);
  await _famInvDrop(env, user.email, id);
  // the link itself, readable by BOTH sides
  const link = { id:'lnk_' + Date.now().toString(36), owner:user.email, grantee:inv.grantee,
    scopes:inv.scopes, active:true, createdAt:Date.now() };
  /* Both sides, under the lock revoking takes.

     Accepting read each list, put the new link on the front and wrote the
     whole list back. A revocation landing in that window is erased - and a
     revocation is the one write here that must never be lost, because losing
     it leaves somebody with access to an account after they have been told it
     stopped. The two are the same record and now hold the same lock. */
  for (const who of [user.email, inv.grantee]) {
    await _withKind(env, 'links', who, (r) => {
      if (!r) return;
      r.items = [link, ...(r.items || [])].slice(0, 50);
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
   recorded is "not known", never "adult" - the whole point is that the absence
   of an answer is not a yes.

   Returns null when allowed, or a {error, code} the caller can return as-is.
   `age_required` is deliberately distinct from a refusal, because an existing
   customer who has simply never been asked needs a prompt, not a wall. */
async function _moneyAgeGate(env, email){
  const rec = await DB.get(env, 'consent', String(email || '').toLowerCase());
  const y = rec && +rec.birthYear;
  if(!y) return { error:'Confirm your age before using anything that involves money.', code:'age_required' };
  const age = new Date().getUTCFullYear() - y;
  if(age < ADULT_AGE)
    return { error:'Anything involving money is only available to people ' + ADULT_AGE + ' and over.', code:'age_blocked' };
  return null;
}

