
/* What the model is allowed to see of a page. Values the user supplied are
   removed - a filled field reports its own value back through `label` and
   through the page text, so without this a secret typed on step 2 is in the
   prompt on step 3, in the provider's logs, and in any error that quotes it. */
function _webForModel(obs, secrets) {
  const red = (s) => _webRedact(s, secrets);
  return {
    url: red(obs && obs.url),
    title: red(obs && obs.title),
    text: red(obs && obs.text),
    elements: ((obs && obs.elements) || []).map(el => ({
      ref: el.ref, tag: el.tag, type: el.type, label: red(el.label),
    })),
  };
}

/* Validate a model-proposed action. The model can NEVER widen its own
   permissions: unknown verbs refused, navigation SSRF-checked, and
   consequential verbs require this run to be pre-approved by the user. */
function _webValidateAction(act, opts){
  if(!act || typeof act !== 'object') return { ok:false, why:'No action returned.' };
  const verb = String(act.verb || '').toLowerCase();
  if(WEB_ALLOWED_VERBS.indexOf(verb) < 0) return { ok:false, why:'Unsupported action "' + verb + '".' };
  if(verb === 'goto'){
    const g = _webHostAllowed(act.url);
    if(!g.ok) return { ok:false, why:g.why };
    act.url = g.url;
  }
  // Consequence check uses the verb AND the control's own label, so clicking
  // "Place order" or "Delete account" needs approval just like submit does.
  const label = (opts && opts.label) || act.label || '';
  if(_webIsConsequential(verb, label, act.text)){
    /* Matched against the action the ticket was issued for, not against a flag.
       Approving "Place order" on one shop authorises that, and nothing else. */
    const fp = _webActionFp(verb, label, (opts && opts.url) || '');
    if(!opts || opts.approvedFp !== fp)
      return { ok:false, needsApproval:true, fp,
        why:'This step would ' + (label ? '"' + String(label).slice(0,40) + '"' : verb) + ' - it needs your approval first.' };
  }
  return { ok:true, verb, act };
}

/* Compact, sanitised observation of the page for the model.

   The per-element identity attributes (name, id, autocomplete, aria-label,
   placeholder) are collected for the SERVER, which uses them to decide which
   field a user-supplied value belongs in. They are stripped again before the
   observation reaches the model - see _webForModel - for two reasons: the model
   does not need them, and every attribute a page controls that reaches a prompt
   is vocabulary an injected page can write for itself. */
const _WEB_OBSERVE = "(() => {" +
  "const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);" +
  " return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };" +
  "const at = (el,a) => (el.getAttribute(a) || '').replace(/\\s+/g,' ').trim().slice(0,60);" +
  "const lbl = el => (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') ||" +
  " (el.labels && el.labels[0] && el.labels[0].textContent) || el.value || el.textContent || '').replace(/\\s+/g,' ').trim().slice(0,80);" +
  "const out = []; let i = 0;" +
  "document.querySelectorAll('a,button,input,select,textarea,[role=button],[contenteditable=true]').forEach(el => {" +
  " if(i >= 60 || !vis(el)) return; el.setAttribute('data-amv-ref', String(++i));" +
  " out.push({ ref:i, tag:el.tagName.toLowerCase(), type:el.type || '', label:lbl(el)," +
  "  name:at(el,'name'), fid:at(el,'id'), autoc:at(el,'autocomplete')," +
  "  aria:at(el,'aria-label'), ph:at(el,'placeholder') }); });" +
  "const captcha = !!document.querySelector('iframe[src*=\"recaptcha\"],iframe[src*=\"hcaptcha\"],.g-recaptcha,[data-sitekey]');" +
  "return { url:location.href, title:document.title," +
  " text:(document.body ? document.body.innerText : '').replace(/\\s+/g,' ').slice(0,3000)," +
  " elements:out, captcha };})()";

/* Ask the model for exactly one next action - a single auditable decision point. */
async function _webAskModel(env, sys, prompt){
  try{
    /* The cheapest tier by design: this is a routing decision, not the answer.
       Read from ENGINES so it moves with the tier table. */
    const r = await _modelFetch(env, { model: engineModel('amv-pulse'), max_tokens:400, system:sys,
      messages:[{ role:'user', content:prompt }] });
    const d = await r.json();
    const txt = (d && d.content && d.content[0] && d.content[0].text) || '';
    return JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
  }catch(e){ return null; }
}

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
