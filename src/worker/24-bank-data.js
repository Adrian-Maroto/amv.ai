/* ============================================================
   BANK DATA PROXY  (/v1/finance/*)

   Every call to the aggregator goes through here so the provider
   secret and the user's access token stay SERVER-SIDE and never
   reach the browser. Read-only by design: there is deliberately no
   payment or transfer route, so a compromised client cannot move
   money. Not configured -> an honest needs_service, never a made-up
   balance.
   ============================================================ */
/* ── THE INVESTING CHECK-IN ────────────────────────────────────────────────

   "Tell me how my money is doing" is one question, and answering it needs one
   thing the balance endpoint cannot give on its own: what it was LAST time.
   A balance is a number; a check-in is a change.

   So a check-in stores a snapshot each time it runs and reports the difference
   from the previous one. The first one honestly has nothing to compare against
   and says so rather than reporting 0% as though the market stood still.

   It reads investment accounts only - a current account swinging with rent and
   payday is noise in a question about investments. And it stays read-only, like
   everything else here: this can tell you that you are down four percent and it
   cannot do anything about it, which is the correct set of powers for something
   running unattended on a schedule.

   Money figures are never invented. If the provider cannot be reached the
   check-in fails and says so; a made-up balance is the single most damaging
   thing this product could produce. */
const INVEST_TYPES = ['investment','brokerage','ira','401k','roth','403b','529','hsa','retirement','mutual fund','stock plan'];
function _isInvestAccount(a){
  const t = String((a && a.type) || '').toLowerCase();
  return INVEST_TYPES.some(k => t.includes(k));
}

/* One snapshot per account, plus the total. Kept small and kept per user. */
function _investShape(accounts){
  const inv = (accounts || []).filter(_isInvestAccount);
  const total = inv.reduce((n, a) => n + (+a.balance || 0), 0);
  return { at: Date.now(), total: Math.round(total * 100) / 100,
           currency: (inv[0] && inv[0].currency) || 'USD',
           accounts: inv.map(a => ({ id: a.id, name: a.name, balance: Math.round((+a.balance || 0) * 100) / 100 })) };
}

function _investDelta(now, prev){
  if(!prev || !prev.at) return { first: true };
  const abs = Math.round((now.total - prev.total) * 100) / 100;
  /* A percentage off a zero starting balance is not a percentage. Reported as
     null rather than as Infinity or a confident-looking zero. */
  const pct = prev.total > 0 ? +(((now.total - prev.total) / prev.total) * 100).toFixed(2) : null;
  const byAccount = (now.accounts || []).map(a => {
    const was = ((prev.accounts || []).find(x => x.id === a.id) || {}).balance;
    if(was == null) return { name: a.name, balance: a.balance, isNew: true };
    return { name: a.name, balance: a.balance, change: Math.round((a.balance - was) * 100) / 100 };
  });
  /* `changeUSD` holds the change in the ACCOUNT'S currency, not in dollars, and
     the name is how a dollar sign ended up in front of a euro figure. It is not
     renamed because it is on the wire to a page the service worker caches: a
     stale client reading a renamed field would show 0.00, and a window of wrong
     money is a worse trade than a wrong name. Read it with `currency`. */
  return { first: false, since: prev.at, changeUSD: abs, changePct: pct,
           direction: abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat', byAccount };
}

/* Runs the check-in for one account. Shared by the endpoint and the cron, so a
   scheduled check-in and a manual one cannot drift apart. */
async function _investCheckin(env, email, opts){
  const o = opts || {};
  const rec = await _finGet(env, email);
  if(!rec || !rec.accessToken) return { ok:false, code:'needs_auth', error:'No investment account is linked yet.' };
  if(!env.FINANCE_CLIENT_ID || !env.FINANCE_SECRET)
    return { ok:false, code:'needs_service', error:'Bank data is not switched on for this deployment.' };

  const base = (env.FINANCE_API_URL || 'https://production.plaid.com').replace(/\/$/, '');
  let accounts = [];
  try{
    const r = await fetchDeadline(base + '/accounts/balance/get', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ client_id: env.FINANCE_CLIENT_ID, secret: env.FINANCE_SECRET, access_token: rec.accessToken }) });
    const d = await r.json();
    if(!r.ok) return { ok:false, code:'provider_error', error: d.error_message || 'Could not reach your accounts.' };
    accounts = (d.accounts || []).map(a => ({
      id:a.account_id, name:a.name || a.official_name || '', type:a.subtype || a.type || '',
      balance:(a.balances && (a.balances.current != null ? a.balances.current : a.balances.available)) || 0,
      currency:(a.balances && a.balances.iso_currency_code) || 'USD' }));
  }catch(e){
    return { ok:false, code:'provider_error', error:'Could not reach your accounts just now.' };
  }

  const now = _investShape(accounts);
  if(!now.accounts.length)
    return { ok:false, code:'no_investments', error:'No investment accounts were found on the institution you linked.' };

  const prev = await DB.get(env, 'invsnap', email);
  const delta = _investDelta(now, prev);
  /* Stored only on a successful read, so a failed check-in never becomes the
     baseline the next one measures against. */
  if(o.store !== false) await DB.put(env, 'invsnap', email, now);
  return { ok:true, total: now.total, currency: now.currency, at: now.at, ...delta };
}

async function financeCheckin(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in first', code:'needs_auth' }, 401);
  const blocked = await guardAction(env, 'invchk:' + user.email, 10, 120, 'investment check-ins');
  if(blocked) return blocked;
  const body = await request.json().catch(()=>({}));
  const r = await _investCheckin(env, user.email, { store: body.peek !== true });
  return json(r, r.ok ? 200 : (r.code === 'needs_auth' ? 400 : 503));
}

async function financeRoute(request, env, path){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in to use bank data', code:'needs_auth' }, 401);

  const blocked = await guardAction(env, 'finance:' + user.email, 20, 400, 'bank data requests');
  if(blocked) return blocked;

  if(!env.FINANCE_CLIENT_ID || !env.FINANCE_SECRET)
    return json({ error:'Bank data is not enabled on this deployment. Add your aggregator keys (FINANCE_CLIENT_ID, FINANCE_SECRET) and it works with no other change.', code:'needs_service' }, 503);

  // the user's own access token for their linked institution
  const rec = await _finGet(env, user.email);
  if(!rec || !rec.accessToken)
    return json({ error:'No bank account is linked to this profile yet.', code:'needs_auth' }, 400);

  const base = (env.FINANCE_API_URL || 'https://production.plaid.com').replace(/\/$/, '');
  const body = await request.json().catch(() => ({}));
  const auth = { client_id: env.FINANCE_CLIENT_ID, secret: env.FINANCE_SECRET, access_token: rec.accessToken };

  try{
    if(path === 'accounts'){
      const r = await fetchDeadline(base + '/accounts/balance/get', {
        method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(auth) });
      const d = await r.json();
      if(!r.ok) return json({ error:d.error_message || 'Could not read your accounts.', code:'provider_error' }, 502);
      return json({ ok:true, accounts:(d.accounts||[]).map(a => ({
        id:a.account_id, name:a.name || a.official_name || '', mask:a.mask || '',
        type:a.subtype || a.type || '', balance:(a.balances && (a.balances.available != null ? a.balances.available : a.balances.current)) || 0,
        currency:(a.balances && a.balances.iso_currency_code) || 'USD' })) });
    }
    if(path === 'transactions'){
      const days = Math.min(365, Math.max(1, +body.days || 30));
      const end = new Date(), start = new Date(Date.now() - days*86400000);
      const iso = d => d.toISOString().slice(0,10);
      const r = await fetchDeadline(base + '/transactions/get', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(Object.assign({}, auth, { start_date:iso(start), end_date:iso(end), options:{ count:250 } })) });
      const d = await r.json();
      if(!r.ok) return json({ error:d.error_message || 'Could not read your transactions.', code:'provider_error' }, 502);
      return json({ ok:true, transactions:(d.transactions||[]).map(t => ({
        date:t.date, merchant:t.merchant_name || t.name || '', name:t.name || '',
        amount: -Math.abs(+t.amount) * (t.amount < 0 ? -1 : 1),   // negative = money out
        category:(t.category && t.category[0]) || '', account:t.account_id, pending:!!t.pending })) });
    }
  }catch(e){
    return json({ error:'Bank data is temporarily unavailable.', code:'provider_error' }, 502);
  }
  return json({ error:'unknown finance route' }, 404);
}

/* ── LINKING AN ACCOUNT ──────────────────────────────────────────────────────

   Everything above needs one thing: a `fin` record holding an access token for
   the user's institution. Nothing in this worker has ever created one - there
   was no link route and no `DB.put(env,'fin',...)` anywhere - so the balance
   reads, the transaction reads and the scheduled investing check-in were all
   complete, correct, and unreachable. This is the missing half.

   It uses the aggregator's HOSTED link flow on purpose: the user completes the
   sign-in on the provider's own page and comes back. That means no third-party
   script in our page and no change to the strict CSP, and AMV never sees the
   bank username or password - which is also the honest answer to the only
   question anybody actually asks about this feature.

   The access token never leaves the server. It is not returned by any endpoint,
   not logged, and not put in an audit line. */
const FINANCE_PRODUCTS = ['investments', 'transactions'];
const FINANCE_COUNTRIES = ['US'];
/* WHERE A BANK CAN REALLY BE LINKED, AND WHO DECIDES.

   The aggregator AMV uses covers the United States, Canada, the United
   Kingdom and most of the EU (its published coverage: US, CA, GB, IE, FR, ES,
   NL, DE, IT, PL, BE, AT, DK, FI, NO, SE, EE, LT, LV, PT). Whether THIS
   deployment may link banks in each of them depends on the provider account -
   Europe and the UK are separate approvals - which is a contract, not code.
   So the list is a setting: FINANCE_COUNTRIES="US,CA,GB,ES" once those are
   approved. Anything outside the provider's coverage is ignored rather than
   trusted, and the default is the one country already approved. Brazil and
   Mexico (Belvo, Pluggy), India (the Account Aggregator network), Australia
   (Basiq) and Japan (Moneytree) need a different provider; China has no
   third-party access to Alipay or WeChat Pay at all. */
const FINANCE_COVERED = ['US','CA','GB','IE','FR','ES','NL','DE','IT','PL','BE','AT','DK','FI','NO','SE','EE','LT','LV','PT'];
function _finCountries(env){
  const set = String((env && env.FINANCE_COUNTRIES) || '').toUpperCase().split(/[\s,]+/)
    .filter(c => FINANCE_COVERED.indexOf(c) >= 0);
  return set.length ? Array.from(new Set(['US'].concat(set))) : FINANCE_COUNTRIES.slice();
}
/* Investments are a US product at the provider; elsewhere a link that asks for
   them fails outright, so only transactions are asked for there. */
function _finProductsFor(cc){ return cc === 'US' ? FINANCE_PRODUCTS : ['transactions']; }

/* And CONNECT_KEY: a bank token that cannot be sealed is not stored at all, so
   without it linking is unavailable rather than half-done. */
function _finReady(env){ return !!(env && env.FINANCE_CLIENT_ID && env.FINANCE_SECRET && connConfigured(env)); }
/* A BANK TOKEN IS SEALED LIKE EVERY OTHER ACCOUNT TOKEN (LESSONS 556).

   It reads a person's balances and transactions, and it was the one account
   token stored in the clear while mailboxes and calendars were sealed under
   CONNECT_KEY - so a copy of the database was ciphertext for every connection
   except the most sensitive one. Sealed on write, opened on read; a record
   written before this (none exist in production: bank data was never switched
   on) is still read, and is sealed the next time it is written. */
async function _finPut(env, email, rec){
  const sealed = await connSeal(env, { accessToken: rec.accessToken, itemId: rec.itemId || '' });
  await DB.put(env, 'fin', email, { sealed, linkedAt: rec.linkedAt || Date.now() });
}
async function _finGet(env, email){
  const row = await DB.get(env, 'fin', email);
  if (!row) return null;
  if (!row.sealed) return row;                       // written before sealing
  const o = await connOpen(env, row.sealed);
  return { accessToken: o.accessToken, itemId: o.itemId || '', linkedAt: row.linkedAt };
}
function _finBase(env){ return String((env && env.FINANCE_API_URL) || 'https://production.plaid.com').replace(/\/$/, ''); }

async function _finCall(env, path, body){
  try{
    const r = await fetchDeadline(_finBase(env) + path, {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(Object.assign({ client_id: env.FINANCE_CLIENT_ID, secret: env.FINANCE_SECRET }, body || {})) });
    const d = await r.json().catch(()=>({}));
    return { ok: r.ok, data: d, error: d.error_message || d.error_code || '' };
  }catch(e){
    return { ok:false, data:{}, error:'Could not reach the account provider.' };
  }
}

/* The provider is given a stable pseudonymous id, never the email address.
   There is no reason for a third party to hold the user's address in order to
   tell us a balance. */
async function _finUserId(env, email){
  const d = await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(String(email).toLowerCase() + '|' + String(env.JWT_SECRET || '')));
  return [...new Uint8Array(d)].slice(0,16).map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function financeStatus(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in first', code:'needs_auth' }, 401);
  const rec = await _finGet(env, user.email);
  /* The server is the authority on whether an account is linked. The client
     used to decide this from a localStorage flag that nothing ever wrote, so
     the answer was permanently "no" however many accounts you had linked. */
  return json({ ok:true, ready:_finReady(env), linked: !!(rec && rec.accessToken),
                linkedAt: (rec && rec.linkedAt) || null });
}

async function financeLinkStart(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in first', code:'needs_auth' }, 401);
  const blocked = await guardAction(env, 'finlink:' + user.email, 10, 900, 'account link attempts');
  if(blocked) return blocked;
  if(!_finReady(env))
    return json({ error:'Bank linking is not switched on for this deployment. Add FINANCE_CLIENT_ID and FINANCE_SECRET and it works with no other change.', code:'needs_service' }, 503);

  const appUrl = String(env.APP_URL || '').replace(/\/$/, '');
  /* The country the bank is in: the page says, else the network does, and it
     must be one this deployment may link in. */
  const reqBody = await request.clone().json().catch(() => ({}));
  const allowed = _finCountries(env);
  const cc = [String(reqBody.country || '').toUpperCase(), String((request.cf && request.cf.country) || '').toUpperCase()]
    .find(c => allowed.indexOf(c) >= 0) || 'US';
  const body = {
    client_name: 'AMV', language: 'en', country_codes: [cc],
    products: _finProductsFor(cc),
    user: { client_user_id: await _finUserId(env, user.email) },
    hosted_link: appUrl ? { completion_redirect_uri: appUrl + '/?finlink=done' } : {},
  };
  const r = await _finCall(env, '/link/token/create', body);
  if(!r.ok || !r.data.hosted_link_url)
    return json({ error: r.error || 'Could not start the link just now.', code:'provider_error' }, 502);

  /* Held so the finish step can read the session result. Short-lived: an
     abandoned link should not leave a usable handle lying about. */
  await DB.put(env, 'finlink', user.email,
    { token: r.data.link_token, at: Date.now() }, { expirationTtl: 6*3600 });
  audit(env, 'finance_link_start', { by: user.email });
  return json({ ok:true, url: r.data.hosted_link_url, expires: r.data.expiration || null });
}

async function financeLinkFinish(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in first', code:'needs_auth' }, 401);
  const blocked = await guardAction(env, 'finfin:' + user.email, 20, 900, 'link completions');
  if(blocked) return blocked;
  if(!_finReady(env)) return json({ error:'Bank linking is not switched on.', code:'needs_service' }, 503);

  const rec = await DB.get(env, 'finlink', user.email);
  if(!rec || !rec.token)
    return json({ error:'Start the link first.', code:'no_session' }, 400);

  const g = await _finCall(env, '/link/token/get', { link_token: rec.token });
  if(!g.ok) return json({ error: g.error || 'Could not read the link session.', code:'provider_error' }, 502);

  /* The public token appears on a COMPLETED session. An abandoned one simply
     has none, which is a different answer from a failure and is told apart
     here - otherwise closing the window would read as the provider being down. */
  let publicToken = '';
  for(const sess of (g.data.link_sessions || [])){
    for(const add of ((sess.results && sess.results.item_add_results) || [])){
      if(add && add.public_token) publicToken = add.public_token;
    }
  }
  if(!publicToken)
    return json({ ok:false, code:'not_finished', error:'That link was not completed. Start it again when you are ready.' }, 409);

  const x = await _finCall(env, '/item/public_token/exchange', { public_token: publicToken });
  if(!x.ok || !x.data.access_token)
    return json({ error: x.error || 'Could not finish the link.', code:'provider_error' }, 502);

  await _finPut(env, user.email,
    { accessToken: x.data.access_token, itemId: x.data.item_id || '', linkedAt: Date.now() });
  await DB.del(env, 'finlink', user.email);          // one use only
  await _userEvent(env, request, user.email, 'finance_linked', {});
  audit(env, 'finance_linked', { by: user.email }); // never the token
  return json({ ok:true, linked:true });
}

async function financeUnlink(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in first', code:'needs_auth' }, 401);
  const blocked = await guardAction(env, 'finunlink:' + user.email, 10, 900, 'account unlinks');
  if(blocked) return blocked;

  const rec = await _finGet(env, user.email);
  /* Told to the provider as well, so consent ends where the user ended it
     rather than only in our copy of the record. Best effort: our record goes
     either way, because a user who disconnects must not stay connected here
     because a third party was unreachable. */
  if(rec && rec.accessToken && _finReady(env)){
    try{ await _finCall(env, '/item/remove', { access_token: rec.accessToken }); }catch(e){}
  }
  await DB.del(env, 'fin', user.email);
  await DB.del(env, 'finlink', user.email);
  /* The snapshot is derived from that account, so it goes too - otherwise
     relinking later would compare today against a stranger's balance. */
  await DB.del(env, 'invsnap', user.email);
  await _userEvent(env, request, user.email, 'finance_unlinked', {});
  audit(env, 'finance_unlinked', { by: user.email });
  return json({ ok:true, unlinked:true });
}

