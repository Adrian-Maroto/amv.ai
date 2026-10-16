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

/* ============================================================
   CONSENT RECORD  (/v1/consent)

   A record that only exists in the user's own browser proves nothing
   in a dispute - they can clear it, and you cannot produce it. This
   stores the accepted terms version, the timestamp, and the request
   metadata server-side, which is the artifact that actually answers
   "did this user agree to your terms, and when?".
   ============================================================ */
async function consentRecord(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in first' }, 401);
  const blocked = await guardAction(env, 'consent:' + user.email, 10, 100, 'consent updates');
  if(blocked) return blocked;

  const body = await request.json().catch(() => ({}));
  const version = String(body.termsVersion || '').slice(0, 32);
  if(!version) return json({ error:'termsVersion required' }, 400);

  const entryIp = (request.headers.get('CF-Connecting-IP') || '').slice(0, 45);
  const entryCountry = (request.cf && request.cf.country) || '';
  const entryUa = (request.headers.get('User-Agent') || '').slice(0, 180);
  const nowYear = new Date().getUTCFullYear();
  let ageRecorded = null;
  let entry = null;
  /* AMV-033: THE BIRTH YEAR IS RECORDED ONCE, AND ONCE MEANS ONCE.

     The check below is deliberately write-once - the comment says a limit
     anyone can raise by retyping it is not a limit - and it was a read
     followed by a write. Two requests arriving together both read a record with
     no birth year, both decide they may set it, and the later one wins. So the
     value that cannot be edited could be edited, by sending it twice.

     Under the record lock the second request reads what the first stored and
     declines, which is what the rule already said. */
  await _withKind(env, 'consent', user.email, (prev) => {
  /* Age, recorded HERE and not only in the browser. The client has always had
     an age gate and it lives in localStorage, so clearing one key - or calling
     the API directly with a key - walked straight through it. Under-13 handling
     is strict liability and a minor's purchase comes back as a chargeback, so
     the one place it has to hold is the side the money runs on.

     A birth YEAR only: enough to gate correctly and the least personal thing
     that does the job. Recorded once and not editable afterwards, because a
     limit anyone can raise by retyping it is not a limit. */
  if(body.birthYear != null && !prev.birthYear){
    const y = Math.floor(+body.birthYear) || 0;
    if(y >= 1900 && y <= nowYear){
      prev.birthYear = y;
      prev.ageSetAt = Date.now();
      ageRecorded = { by: user.email, adult: (nowYear - y) >= ADULT_AGE };
    }
  }
  entry = { version, at: Date.now(), ip: entryIp, country: entryCountry, ua: entryUa };
  prev.current = entry;
  prev.history = [entry, ...(prev.history || [])].slice(0, 20);   // every version ever accepted
  }, { history: [] });
  /* Audited outside the lock: it is a storage write of its own, and holding a
     record lock across one is how a lease runs out mid-work. */
  if (ageRecorded) audit(env, 'age_recorded', ageRecorded);
  if (!entry) return json({ error: 'Could not record that just now. Please try again.' }, 503);
  audit(env, 'consent_accepted', { by: user.email, version });
  return json({ ok: true, version, at: entry.at });
}

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
