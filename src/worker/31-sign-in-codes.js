/* ============================================================
   SIGN-IN CODES - THE PASSWORD IS NOT THE WHOLE KEY
   ============================================================
   Asked for: "make sure no one can log into anyone else's account... make it
   like the big assistants do it... make sure they can't auto sign in because
   I didn't put the code but it still signed me in".

   AMV signed anybody in on email and password alone, and never checked that
   whoever signed up owned the address. So:

     - Sign-up does not hand out a session. It emails a 6-digit code to the
       address, and only the code finishes it - which proves the address.
     - Sign-in on a device this account has not proved itself on takes the
       password AND a code sent to the address. A stolen or guessed password
       is no longer enough on its own.
     - A device that has entered a code is trusted for DEVICE_TRUST_MS, by a
       signed token in an HttpOnly cookie (or, where the deployment does not
       use cookies, the same token held by the page). It carries the account's
       revocation epoch, so "sign out everywhere" un-trusts every device too.

   A code is six digits, lives SIGNIN_CODE_TTL_S, may be tried
   SIGNIN_CODE_ATTEMPTS times under the record lock (so parallel guesses
   cannot all be "the first"), works once, and belongs to ONE challenge - the
   id the server issued after the password check - so a code is useless
   without the attempt it was sent for. What is stored is a hash of the code,
   never the code. Sending is inside the per-address email budget.

   Only where email can reach people (_emailReaches): a deployment with no
   verified sender cannot deliver a code, and requiring one would lock out
   everyone; its readiness screen says verification is off. */
const SIGNIN_CODE_TTL_S    = 10 * 60;
const SIGNIN_CODE_ATTEMPTS = 5;
const SIGNIN_CODE_RESENDS  = 3;
const DEVICE_TRUST_MS      = 30 * 864e5;
const DEVICE_COOKIE        = 'amv_dev';

function _codesOn(env) { return _emailReaches(env); }

function _readCookieNamed(request, name) {
  try {
    const raw = request.headers.get('Cookie') || '';
    for (const part of raw.split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
    }
  } catch (e) {}
  return '';
}
function _deviceCookie(value, maxAgeS) {
  return [`${DEVICE_COOKIE}=${value}`, 'HttpOnly', 'Secure', 'SameSite=None', 'Path=/auth',
          'Max-Age=' + Math.max(0, Math.floor(maxAgeS))].join('; ');
}
/* WHETHER THIS DEVICE HAS PROVED ITSELF - AND IF NOT, WHY NOT.

   Two copies may arrive: the HttpOnly cookie and the copy the page keeps. Each
   is tried, because a stale cookie (from before a "sign out everywhere") used
   to hide a valid copy beside it, and a browser that dropped the cookie (Safari
   caps cookies set by a server on another address; private windows keep none)
   still has the page's copy. Neither can be forged; both carry the account's
   revocation epoch.

   The reason is for the words on the code screen, never for the decision: the
   payload is read unverified only to say WHICH way trust ended. "This device is
   new" was said in every case, which was false most of the times it was shown. */
async function _deviceTrustState(env, request, body, email) {
  const toks = [_readCookieNamed(request, DEVICE_COOKIE), String((body && body.deviceToken) || '')].filter(Boolean);
  if (!toks.length) return { trusted: false, reason: 'none' };
  let reason = 'none';
  for (const tok of toks) {
    const c = await verifyToken(tok, env.JWT_SECRET, env, 'device');
    if (c && String(c.email || '').toLowerCase() === email) return { trusted: true };
    try {
      const p = JSON.parse(atob(String(tok.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/')));
      if (String(p.email || '').toLowerCase() !== email) continue;
      if (p.exp && p.exp * 1000 < Date.now()) reason = 'expired';
      else if (reason !== 'expired') reason = 'revoked';
    } catch (e) {}
  }
  return { trusted: false, reason };
}
/* A session response that also carries a fresh device token: in the body
   always (the page keeps a copy), and as the HttpOnly cookie where the
   deployment uses cookies. Signing never fails the response it rides on. */
async function _withDeviceTrust(env, email, respond, tokens) {
  let device = null;
  try { if (env.JWT_SECRET) device = await _deviceTokenFor(env, email); } catch (e) { device = null; }
  const resp = respond(env, tokens, device ? { deviceToken: device } : {});
  if (device && _cookieAuthOn(env)) resp.headers.append('Set-Cookie', _deviceCookie(device, DEVICE_TRUST_MS / 1000));
  return resp;
}
async function _deviceTrusted(env, request, body, email) {
  return (await _deviceTrustState(env, request, body, email)).trusted;
}
async function _deviceTokenFor(env, email) {
  const epoch = await _tokenEpoch(env, email);
  return signToken({ email }, env.JWT_SECRET, { typ: 'device', epoch, ttlMs: DEVICE_TRUST_MS });
}
async function _codeHash(id, code) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id + ':' + code));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function _maskEmail(email) {
  const [u, d] = String(email).split('@');
  if (!d) return '';
  return (u.length <= 2 ? u[0] + '\u2022' : u[0] + '\u2022'.repeat(Math.min(6, u.length - 2)) + u[u.length - 1]) + '@' + d;
}
async function _sendSignInCodeEmail(env, email, code, why) {
  const signup = why === 'signup' || why === 'claim';
  const subject = 'Your AMV code: ' + code;
  const line = signup
    ? 'Enter this code to finish creating your AMV account.'
    : 'Enter this code to finish signing in to AMV on a new device.';
  const html = _emailShell(signup ? 'Confirm your email' : 'Your sign-in code',
    '<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#333">' + _escHtml(line) + '</p>'
    + '<div style="margin:0 0 20px;font-size:32px;font-weight:700;letter-spacing:8px;color:#15131f;text-align:center">' + _escHtml(code) + '</div>'
    + '<p style="margin:0;font-size:13px;line-height:1.6;color:#777">It expires in 10 minutes and works once. '
    + (signup ? 'If you did not try to create an account, you can ignore this email - nothing happens without the code.'
              : 'If this was not you, somebody knows your password: change it now, and nothing happens without this code.') + '</p>',
    null, null, 'Never share this code. AMV will never ask you for it.');
  const text = line + '\n\n' + code + '\n\nIt expires in 10 minutes and works once. Never share this code.';
  return _sendEmail(env, email, subject, html, text, 'signin');
}

async function _startSignInCode(env, request, email, name, why, pending, reason) {
  const id = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
  const code = _sixDigitCode();
  await env.AMV_KV.put('signincode:' + id,
    JSON.stringify({ email, name: name || '', why, hash: await _codeHash(id, code), attempts: 0, resends: 0, at: Date.now(),
                     ...(pending ? { pending } : {}) }),
    { expirationTtl: SIGNIN_CODE_TTL_S });
  const sent = await _sendSignInCodeEmail(env, email, code, why);
  if (!sent) {
    audit(env, 'signin_code_not_sent', { email, why });
    try { await env.AMV_KV.delete('signincode:' + id); } catch (e) {}
    /* THE PROVIDER REFUSED THE SENDER ITSELF - NOT A HICCUP.

       "The amv.homes domain is not verified" is a fact about the deployment,
       true for every address and every attempt until the operator fixes it.
       Requiring a code then locks everybody out of their own account - the
       failure _codesOn already exists to avoid, reached by a setting that
       looked right. So this is treated as what it is, a deployment whose email
       does not reach people: the sign-in carries on without a code, the
       operator is alerted, and the readiness screen says so. Every other
       failure (the network, the per-address cap) still refuses, because those
       pass, and passing through them would hand a code-free sign-in to anyone
       who can make a send fail. Returns null for "carry on". */
    if (await _emailSenderRefused(env)) {
      /* A claim never passes through: without the inbox there is no proof, so
         the caller answers "account exists" exactly as before claims existed. */
      if (why === 'claim') return null;
      audit(env, 'signin_code_skipped', { email, why, reason: 'sender_refused' });
      try { await alertOnce(env, 'email_sender_refused', 'Sign-in codes cannot be sent: the email provider refuses the sender (' + String(env.RESET_EMAIL_FROM || '') + '). People are signing in WITHOUT a code until the domain is verified with the provider.', 60); } catch (e) {}
      return null;
    }
    /* The daily allowance for this address used up is not "try again in a
       minute" - a minute changes nothing. Read without reserving (op:get), so
       asking costs the address nothing. */
    try {
      const used = await counter(env, `mailto:signin:${email}:${todayKey()}`, { op: 'get' });
      if (used && +used.value >= EMAIL_DAY_CAP.signin)
        return json({ error: 'AMV has sent the most sign-in codes it sends to one address in a day. Use the newest code you received, or try again tomorrow.',
                      code: 'code_daily_limit' }, 429);
    } catch (e) {}
    return json({ error: 'AMV could not email your code just now. Try again in a minute.', code: 'code_not_sent' }, 503);
  }
  audit(env, 'signin_code_sent', { email, why });
  return json({ ok: true, needsCode: true, challenge: id, to: _maskEmail(email), why, ...(reason ? { reason } : {}) });
}

async function authLoginVerify(request, env) {
  const body = await request.json().catch(() => ({}));
  const id = String(body.challenge || '').replace(/[^a-f0-9]/g, '').slice(0, 64);
  const code = String(body.code || '').replace(/\D/g, '');
  if (!id || code.length !== 6) return json({ error: 'Enter the 6-digit code.' }, 400);
  const lim = await limitAction(env, `signinverify:${_rlIp(request)}`, 30, 600);
  if (!lim.ok && !lim.unavailable)
    return json({ error: 'Too many tries from here. Give it a moment.', code: 'rate_limited' }, 429, { 'Retry-After': '60' });
  const want = await _codeHash(id, code);
  let verdict;
  try {
    verdict = await _withKV(env, 'signincode', id, (rec) => {
      if (!rec || !rec.hash || rec.used) return { gone: true };
      if ((+rec.attempts || 0) >= SIGNIN_CODE_ATTEMPTS) return { exhausted: true };
      const same = timingSafeEqual(new TextEncoder().encode(want), new TextEncoder().encode(rec.hash));
      if (!same) {
        rec.attempts = (+rec.attempts || 0) + 1;
        return { wrong: true, left: SIGNIN_CODE_ATTEMPTS - rec.attempts, email: rec.email };
      }
      rec.used = true;
      return { ok: true, email: rec.email, name: rec.name, why: rec.why, at: +rec.at || 0, pending: rec.pending || null };
    }, null);
  } catch (e) {
    if (_isBusy(e)) return json({ error: 'That code is being checked already. Try again in a moment.' }, 409);
    return json({ error: 'AMV could not check that code just now. Please try again in a moment.' }, 503);
  }
  if (!verdict || verdict.gone) return json({ error: 'That code has expired. Sign in again to get a new one.', code: 'code_expired' }, 400);
  if (verdict.exhausted) {
    try { await env.AMV_KV.delete('signincode:' + id); } catch (e) {}
    return json({ error: 'Too many incorrect codes. Sign in again to get a new one.', code: 'code_exhausted' }, 429);
  }
  if (verdict.wrong) {
    audit(env, 'signin_code_bad', { email: verdict.email });
    const left = verdict.left;
    return json({ error: left > 0
      ? 'That code isn\u2019t right. ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left.'
      : 'Too many incorrect codes. Sign in again to get a new one.', code: 'code_wrong' }, 400);
  }
  try { await env.AMV_KV.delete('signincode:' + id); } catch (e) {}
  const em = verdict.email;
  /* A challenge is keyed by its id, so erasing an account cannot find the
     ones in flight. One sent a minute before the account was deleted would
     otherwise mint a session for an account that no longer exists - or, if
     the address was registered again since, for somebody else's. The same
     rule authResetConfirm uses: nothing issued before the account existed. */
  const acct = await DB.get(env, 'acct', em);
  if (!acct || (verdict.at && acct.createdAt && acct.createdAt > verdict.at))
    return json({ error: 'That sign-in has expired. Sign in again to get a new code.', code: 'code_expired' }, 400);
  if (verdict.why === 'signup') {
    try { await _withAcct(env, em, (a) => { if (a) a.emailVerifiedAt = Date.now(); }); } catch (e) {}
  }
  /* The inbox answered a sign-up on an unconfirmed account: the password that
     waited in the challenge becomes the account's, and every session issued
     under the old one ends - the squatter's included. */
  if (verdict.why === 'claim' && verdict.pending) {
    const p = verdict.pending;
    let applied = false;
    try {
      await _withAcct(env, em, (a) => {
        if (!a) return;
        Object.assign(a, { salt: p.salt, pwHash: p.pwHash, pwIter: p.pwIter, sipHash: p.sipHash, name: p.name || a.name });
        a.emailVerifiedAt = Date.now();
        applied = true;
      });
    } catch (e) {}
    if (!applied) return json({ error: 'AMV could not finish that just now. Please sign up again.', code: 'claim_failed' }, 503);
    try { await revokeUserTokens(env, em); } catch (e) {}
    audit(env, 'account_claimed', { email: em });
  }
  try { await _markActive(env, em); } catch (e) {}
  await _userEvent(env, request, em, verdict.why === 'signup' ? 'email_verified' : 'signed_in', { with: 'code' });
  return _withDeviceTrust(env, em, _tokenResponse, await issueTokens(env, em, verdict.name || '', await _sessOpen(env, request, em)));
}

async function authLoginResend(request, env) {
  const body = await request.json().catch(() => ({}));
  const id = String(body.challenge || '').replace(/[^a-f0-9]/g, '').slice(0, 64);
  if (!id) return json({ error: 'Sign in again to get a new code.' }, 400);
  const code = _sixDigitCode();
  const hash = await _codeHash(id, code);
  let rec;
  try {
    rec = await _withKV(env, 'signincode', id, (r) => {
      if (!r || !r.hash || r.used) return { gone: true };
      if ((+r.resends || 0) >= SIGNIN_CODE_RESENDS) return { capped: true };
      if (Date.now() - (+r.sentAt || +r.at || 0) < 30000) return { tooSoon: true };
      r.hash = hash; r.resends = (+r.resends || 0) + 1; r.sentAt = Date.now();
      return { ok: true, email: r.email, why: r.why };
    }, null);
  } catch (e) {
    return json({ error: 'AMV could not send a new code just now. Try again in a moment.' }, 503);
  }
  if (!rec || rec.gone) return json({ error: 'That sign-in has expired. Sign in again to get a new code.', code: 'code_expired' }, 400);
  if (rec.capped) return json({ error: 'That is as many codes as one sign-in gets. Sign in again to start over.', code: 'resend_capped' }, 429);
  if (rec.tooSoon) return json({ error: 'A code was just sent. Give it 30 seconds, and check spam.', code: 'resend_soon' }, 429);
  const sent = await _sendSignInCodeEmail(env, rec.email, code, rec.why);
  if (!sent) return json({ error: 'AMV could not email your code just now. Try again in a minute.', code: 'code_not_sent' }, 503);
  return json({ ok: true, sent: true });
}

/* Operator user list - admin-gated. Returns accounts for the Admin Control
   Center. Only a verified admin token may call this. */
async function adminUsers(request, env) {
  const auth = request.headers.get('Authorization')||'';
  const token = auth.replace(/^Bearer\s+/i,'');
  const claims = token ? await verifyToken(token, env.JWT_SECRET, env, 'access') : null;
  if(!claims || !claims.email) return json({ error:'unauthorized' }, 401);
  // must be an admin: either the configured owner email or an account flagged admin
  const acct = await DB.get(env, 'acct', String(claims.email).toLowerCase());
  // Operator email - from env, falling back to the hard-coded owner. Change both
  // (this line and OWNER_EMAIL in app.js) when transferring ownership.
  // AMV-034: owner identity comes ONLY from the configured OWNER_EMAIL secret -
  // no hardcoded personal-email fallback. If it isn't set, nobody is owner (fail
  // closed) rather than a source-code constant silently granting privilege.
  const ownerEmail = String(env.OWNER_EMAIL || '').toLowerCase();
  const isOwner = !!ownerEmail && String(claims.email).toLowerCase() === ownerEmail;
  if(!isOwner && !(acct && acct.admin)) return json({ error:'forbidden' }, 403);
  /* AMV-052: RATE LIMITED AND AUDITED LIKE EVERY OTHER ADMIN SURFACE.

     This route authenticates DIFFERENTLY from the rest on purpose - the owner's
     Control Center reaches it with their signed-in session, while the operator
     screens use the admin token, and those are two different credentials for
     two different things. Deliberately kept apart: making them
     interchangeable would let any account flagged admin export the whole
     database without the operator's token.

     What was not deliberate is that this one had no rate limit and no audit
     line at all, while the sixteen beside it had both. One admin surface
     without a ceiling is the one somebody walks through. */
  { const g = await _adminRateLimit(request, env, 'userlist', 60, 2000); if (g) return g; }
  audit(env, 'admin_user_list', { by: String(claims.email).toLowerCase(), owner: isOwner });
  /* AMV-198: ONE PAGE OF ACCOUNTS, NOT ALL OF THEM AT ONCE.

     This did six storage round trips per account across up to three hundred of
     them - eighteen hundred in a single request, for one screen. A Worker has a
     ceiling on how many it may make, so this screen was on a countdown to
     failing outright, and long before that it was simply slow: the owner's own
     Control Center getting worse every time AMV succeeded at anything.

     Two of the six are now one bulk read for the whole page rather than one
     each, and the rest are done for the page being looked at instead of every
     account that exists. The page is a stated number the caller can move
     through, so nothing has been removed from the screen - it arrives in
     pieces. */
  let users=[]; let truncated=false; let total=0; let hasMore=false;
  const url = new URL(request.url);
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  const limit = Math.max(1, Math.min(ADMIN_USERS_PAGE,
                  parseInt(url.searchParams.get('limit') || String(ADMIN_USERS_PAGE), 10) || ADMIN_USERS_PAGE));
  try{
    const s = await scan(env, 'acct', ADMIN_USERS_LIMIT, 'admin user list');
    const all = s.rows || []; truncated = s.truncated;
    total = all.length;
    const list = all.slice(offset, offset + limit);
    hasMore = offset + list.length < total;
    const month = monthKey();
    /* Every per-account record is read for THIS PAGE only. Reading a kind in
       bulk instead was tried and is a pessimisation on the store AMV actually
       runs on: `DB.list` over KV does one read per key, so pulling every
       entitlement to serve sixty rows costs three hundred reads instead of
       sixty. On D1 the reverse is true - one query beats sixty - and that is
       worth doing when D1 is bound, but not by making the KV path worse today
       for a backend that is not in use yet. */
    users = await Promise.all(list.map(async r=>{
      const a=r.value||{}; const email=a.email; if(!email) return null;
      const [ent, abuse, wallet, purchases] = await Promise.all([
        DB.get(env, 'ent', email).catch(()=>null),
        DB.get(env, 'abuse', email).catch(()=>null),
        env.AMV_KV.get(`wallet:${email}`).catch(()=>null),
        env.AMV_KV.get(`purchases:${email}`).catch(()=>null),
      ]);
      let monthCost=0, monthTok=0;
      try{ monthCost = (await counter(env, `cost:${email}:${month}`, { op:'get' })).value || 0; }catch(e){}
      try{ monthTok = (await counter(env, `tok:${email}:${month}`, { op:'get' })).value || 0; }catch(e){}
      let walletBal=0; try{ if(wallet){ walletBal=(JSON.parse(wallet).balance)||0; } }catch(e){}
      let purchaseCount=0; try{ if(purchases){ purchaseCount=(JSON.parse(purchases)||[]).length; } }catch(e){}
      const plan = (ent && ent.plan) ? _planOf(ent) : (a.plan || 'free');
      return {
        email, name:a.name||'', plan, provider:a.provider||'email',
        createdAt:a.createdAt||null, admin:!!a.admin,
        source:(ent && ent.source)||null,          // stripe / paypal / manual
        monthCostUSD:+(+monthCost).toFixed(2),
        monthTokens:monthTok,
        walletBalance:+(+walletBal).toFixed(2),
        purchases:purchaseCount,
        flagged:!!(abuse && abuse.blocked),
        disputes:(abuse && abuse.disputes)||0,
        refunds:(abuse && abuse.refunds)||0,
      };
    }));
    users = users.filter(Boolean);
  }catch(e){
    /* AMV-051: A STORAGE FAILURE IS NOT AN EMPTY CUSTOMER BASE.

       This was `catch(e){}`. The listing throws - the scan cannot reach the
       store, a read times out - and `users` is still the empty array it was
       initialised to, so the request answers 200 with `users: []` and
       `count: 0`. To the operator that is not an error. It is a screen saying
       there are no accounts.

       Which is the worst possible thing for this particular screen to say,
       because it is the screen somebody opens DURING an incident to find out
       whether anything is left. "Nothing here" and "I could not look" have to
       be different answers, and only one of them is true. */
    audit(env, 'admin_user_list_failed', { why: String((e && e.message) || e).slice(0, 120) });
    try{ await _workerError(env, 'adminUsers', e); }catch(_){}
    return json({ error: 'AMV could not read the account list just now, so this screen is not showing one. '
                       + 'This is a read failure, not an empty database - nothing has been lost.',
                  code: 'listing_unavailable' }, 503);
  }
  /* `count` is the number of rows on THIS screen, not the number of accounts
     that exist. Said plainly, because an operator reading 300 off an admin
     page and believing it is the customer base makes decisions on it. The real
     total lives on the stats screen, which counts rather than lists. */
  return json({ users, count: users.length, offset, limit, total, hasMore,
                truncated, scanLimit: ADMIN_USERS_LIMIT,
                note: truncated
                  ? 'Showing the first ' + ADMIN_USERS_LIMIT + ' accounts. There are more - this is not the total.'
                  : (hasMore ? 'Showing ' + (offset + users.length) + ' of ' + total + ' accounts.' : null) });
}

/* Verify a Google ID token (JWT credential) SERVER-SIDE before trusting it.
   This is the production-safe path: the browser sends the credential from Google
   Identity Services, and here we confirm it with Google - checking the signature,
   that the audience matches OUR client id, and that it hasn't expired - then mint
   our own session. The frontend never grants privileges on an unverified token. */
async function authGoogle(request, env) {
  const body = await request.json().catch(()=>({}));
  const { credential } = body;
  if (!credential) return json({ error: 'credential required' }, 400);
  /* AMV-027: A REQUEST NOBODY HAS TO AUTHENTICATE MAKES AMV CALL SOMEBODY ELSE.

     Every call here becomes an outbound request to Google, from AMV's own
     address, paid for out of the operator's Workers budget - and this endpoint
     is open by definition, because signing in is what it is for. Unbounded,
     that is a free amplifier: a loop of garbage credentials turns one attacker's
     bandwidth into AMV hammering Google until Google starts refusing AMV, which
     breaks sign-in for real customers without anybody's password being guessed.

     Bounded by source, before the outbound call rather than after it - a limit
     applied to the answer still pays for the question. A real person signs in a
     handful of times; this ceiling is nowhere near them. */
  const gip = _rlIp(request);
  const gLimit = await limitAction(env, 'googlesig:' + gip, 20, 300);
  if (!gLimit.ok) {
    /* A counter that cannot be reached is a fault here, not a verdict. Refusing
       on it would turn one storage blip into "nobody can sign in with Google",
       which is a worse outcome than a brief window in which the amplifier is
       unbounded - and unlike the money ceilings, nothing irreversible happens
       on the other side of this one. It is audited, so the window is visible
       rather than silent. */
    if (gLimit.unavailable) audit(env, 'google_limit_unavailable', {});
    else {
      audit(env, 'google_rate_limited', {});
      return json({ error: 'Too many sign-in attempts from here. Give it a moment and try again.',
                    code: 'rate_limited' }, 429, { 'Retry-After': '60' });
    }
  }
  /* A credential far larger than any id token is refused before it is put on a
     URL and sent anywhere. A Google id token is around a kilobyte. */
  if (String(credential).length > 4096) return json({ error: 'invalid google token' }, 401);
  try{
    // Google's tokeninfo validates signature + expiry for us and returns the claims.
    const r = await fetchDeadline('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    if(!r.ok){ audit(env,'google_verify_fail',{status:r.status}); return json({ error:'invalid google token' }, 401); }
    const claims = await r.json();
    // AMV-052: FAIL CLOSED. Google sign-in requires GOOGLE_CLIENT_ID so we can
    // pin the audience - without it, a token minted for ANY other Google app
    // would be accepted (audience confusion). Validate aud, issuer and
    // email_verified unconditionally.
    const expectedAud = env.GOOGLE_CLIENT_ID || '';
    if(!expectedAud){ audit(env,'google_unconfigured',{}); return json({ error:'Google sign-in is not configured for this workspace.', code:'google_unconfigured' }, 503); }
    if(claims.aud !== expectedAud){ audit(env,'google_aud_mismatch',{}); return json({ error:'token audience mismatch' }, 401); }
    if(!/(^|\.)accounts\.google\.com$/.test(String(claims.iss||''))){ return json({ error:'bad issuer' }, 401); }
    /* AMV-027: VERIFIED MEANS VERIFIED, NOT "DID NOT SAY OTHERWISE".

       This refused an explicit `false` and let ABSENCE through. A token with no
       email_verified claim at all was treated as a verified address - and this
       claim is the only thing standing between "Google says this person owns
       this address" and "somebody typed this address into a Google account".

       The consequence is not a bad signup, it is a takeover: an address that
       already exists here as an email-and-password account is signed straight
       into, below, with no password. Somebody creates a Google account claiming
       a customer's address, and if Google has not verified it and AMV does not
       insist, they are that customer.

       So it is required, and required to be true. A missing claim is a refusal,
       which is the only safe reading of a fact nobody asserted. */
    const verified = claims.email_verified;
    if(verified !== true && verified !== 'true'){
      audit(env,'google_unverified_email',{ had: typeof verified });
      return json({ error:'Google has not confirmed that this address belongs to that account, so AMV cannot sign you in with it.',
                    code:'google_unverified' }, 401);
    }
    const em = String(claims.email||'').toLowerCase().trim();
    if(!em) return json({ error:'no email in token' }, 401);
    { const sso = await _ssoRequiredFor(env, em); if(sso) return _ssoRequiredJson(sso); }
    const name = claims.name || em.split('@')[0];
    let fed;
    try{ fed = await _federatedAccount(env, em, { email:em, name, provider:'google', createdAt:Date.now(), sipHash: await _ipHash(env, request) }); }
    catch(e){ if(!_isBusy(e)) throw e; return _busyJson('account'); }
    if(fed.squatted) audit(env, 'google_cleared_unconfirmed_password', {});
    const created = fed.created;
    if(created){
      /* AMV-SP-01: `email` does not exist here - the address in this function is
         `em`. Every Google signup threw a ReferenceError into the empty catch
         below, so none of them were ever recorded: the funnel undercounted
         real customers and the account population did not move, while the
         password path did both correctly. A swallowed exception in accounting
         code is invisible precisely because nothing downstream depends on it.

         The population counter is incremented here too, which the password
         path did and this one did not - so the two providers now agree. */
      try{ await counter(env, 'popaccounts', { op: 'incr', amount: 1 }); }catch(e){}
      try{ await _recordGrowth(env, 'signup'); await _funnelMark(env, em, 'signup'); }
      catch(e){ try{ await _workerError(env, 'authGoogle:accounting', e); }catch(_){} }
      try{ await _referralCapture(env, request, em, body.ref); }catch(e){}
    }
    /* Google proves the address; an authenticator app the account turned on
       is still asked for on a device that has not proved itself, or Google
       would be the way around it. */
    if(!created){
      const a = await DB.get(env, 'acct', em);
      if(_acctFactors(a).totp && !(await _deviceTrusted(env, request, body, em))) return _mfaAsk(env, em, name);
    }
    await _userEvent(env, request, em, 'signed_in', { reason: 'Google' });
    const tokens = await issueTokens(env, em, name, await _sessOpen(env, request, em));
    return _tokenResponse(env, tokens, { email: em, name, picture: claims.picture || '' });
  }catch(e){
    audit(env,'google_verify_error',{msg:String(e).slice(0,120)});
    return json({ error:'verification failed' }, 500);
  }
}

/* Exchange a valid refresh token for a fresh access+refresh pair. */
const REFRESH_GRACE_MS = 30 * 1000;
/* Marks a refresh token as retired by sign-out (see authRefresh). Two minutes,
   which covers any renewal already in flight; a use after that is a replay. */
async function _retiredBySignOut(env, jti) {
  try { await env.AMV_KV.put('rtgrace:' + jti, 'out', { expirationTtl: 120 }); } catch (e) {}
}
async function authRefresh(request, env) {
  const body = await request.json().catch(()=>({}));
  /* The cookie first, because on a deployment where it is in force it is the
     copy the browser holds and the body is not sent at all. The body remains a
     fallback for a deployment with no configured origin, and for anything that
     is not a browser. */
  const refreshToken = _readRefreshCookie(request) || (body && body.refreshToken) || '';
  if (!refreshToken) return json({ error: 'refresh token required' }, 400);
  const data = await verifyToken(refreshToken, env.JWT_SECRET, env, 'refresh');
  if (!data || !data.email) return json({ error: 'invalid or expired refresh token' }, 401);
  // AMV-011: refresh-token ROTATION with reuse detection. Each refresh token may
  // be exchanged exactly once. Claiming its jti is atomic (on D1); if the jti was
  // already used, the token is being REPLAYED - it was stolen and used twice - so
  // we revoke every token for the account (kills both the thief and the victim's
  // session; the victim simply signs in again) instead of quietly issuing more.
  /* TWO THINGS THAT ARE NOT THEFT, AND HAD BEEN TREATED AS THEFT.

     The owner was asked to sign in on every reload. A theft verdict revokes
     every session on the account, and two ordinary events reached it:

     - The lock store not answering. "Could not check" came back as "already
       used", so a moment's hiccup on the server signed the person out of every
       device. Now it is a 503 - the page keeps its session and tries again -
       and only a real second use is a reuse.
     - Two renewals of the same token within moments: two tabs, the installed
       app and a tab, or a reload that dropped the first answer before its new
       cookie was kept. The token was used twice by the same person. Within
       REFRESH_GRACE_MS of the first use, a second one gets a fresh pair instead
       of a revocation - the rotation-overlap window the large identity
       providers keep for exactly this. After it, a reuse is a replay and is
       treated as one. */
  if (data.jti) {
    const claim = await _claimOnceDetail(env, 'usedrefresh', data.jti, Math.floor(REFRESH_TTL_MS / 1000));
    if (claim.unavailable)
      return json({ error: 'AMV could not renew your sign-in just now. Try again in a moment.', code: 'auth_busy' }, 503, { 'Retry-After': '5' });
    if (claim.claimed) {
      try { await env.AMV_KV.put('rtgrace:' + data.jti, String(Date.now()), { expirationTtl: 120 }); } catch (e) {}
    } else {
      let mark = null;
      try { mark = await env.AMV_KV.get('rtgrace:' + data.jti); } catch (e) {}
      /* Spent by its own device signing out, moments ago: a renewal that was
         already on its way from that device. Refused - the session is over -
         but not as a theft, which would sign out every other device too. */
      if (mark === 'out') return json({ error: 'signed out', code: 'signed_out' }, 401);
      const first = +mark || 0;
      if (!(first && Date.now() - first <= REFRESH_GRACE_MS)) {
        await revokeUserTokens(env, data.email);
        audit(env, 'refresh_replay', { email: data.email });
        return json({ error: 'refresh token already used' }, 401);
      }
      audit(env, 'refresh_overlap', { email: data.email });
    }
  }
  try{ await _markActive(env, data.email); }catch(e){}
  /* The session continues under the same id; a token from before sessions were
     recorded starts one now, so it appears in the device list from here on. */
  let sid = data.sid || '';
  if (sid) {
    let kept = false;
    try { kept = await _sessTouch(env, request, data.email, sid); } catch (e) { kept = true; }
    if (!kept && Math.floor(Date.now() / 1000) - (data.iat || 0) > SESS_FRESH_S)
      return json({ error: 'signed out', code: 'signed_out' }, 401, _clearRefreshCookie(env));
  } else {
    try { sid = await _sessOpen(env, request, data.email); } catch (e) { sid = ''; }
  }
  return _tokenResponse(env, await issueTokens(env, data.email, data.name || '', sid));
}

/* Sign out everywhere: bump the user's token epoch, revoking all tokens. */
/* Sign out. Two different things, and they had been the same thing:
   - THIS device: retire the refresh token this device holds, so it can never be
     exchanged again. The access token it also holds dies on its own within the
     hour and is deleted locally immediately.
   - EVERYWHERE: bump the account's token epoch, which invalidates every token
     ever issued to it. This is the "someone else is in my account" button.
   Before AMV-076 the plain sign-out did the second one while the button said
   the first, so signing out of a laptop silently ended the session on a phone
   in someone's pocket. */
/* "Sign out and erase this device" also means: this device is no longer one
   that has proved itself, so the next sign-in here asks for the emailed code
   again. The trust cookie is HttpOnly - the page cannot clear it - so the
   server does, on whichever way the sign-out below ends. */
async function authLogout(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const tok = auth.replace(/^Bearer\s+/i, '');
  let data = await verifyToken(tok, env.JWT_SECRET, env, 'access');
  const body = await request.json().catch(() => ({}));
  const fin = (r) => {
    if (body && body.forgetDevice) r.headers.append('Set-Cookie', _deviceCookie('', 0));
    if (_cookieAuthOn(env)) r.headers.append('Set-Cookie', _sessionHintCookie(0));
    return r;
  };
  /* An access token lasts minutes and a sign-in cookie weeks. Signing out with
     an expired access token answered "ok" and left the cookie working, so the
     next visit on that browser could be signed straight back in. The refresh
     token identifies the session just as well; it is used when the access
     token cannot be, and the cookie is cleared whatever happens. */
  if (!data || !data.email) {
    const rtOnly = String((body && body.refreshToken) || _readRefreshCookie(request) || '');
    const rt = rtOnly ? await verifyToken(rtOnly, env.JWT_SECRET, env, 'refresh') : null;
    if (rt && rt.email && rt.jti) {
      await _claimOnce(env, 'usedrefresh', rt.jti, Math.floor(REFRESH_TTL_MS / 1000));
      await _retiredBySignOut(env, rt.jti);
      if (rt.sid) { try { await env.AMV_KV.delete(_sessKey(rt.email, rt.sid)); } catch (e) {} }
      await _userEvent(env, request, rt.email, 'signed_out');
      return fin(json({ ok: true, scope: 'device' }, 200, _clearRefreshCookie(env)));
    }
    return fin(json({ ok: true }, 200, _clearRefreshCookie(env)));   // nothing to revoke; never leak which
  }
  if (body && body.everywhere) {
    await revokeUserTokens(env, data.email);
    await _userEvent(env, request, data.email, 'signed_out_everywhere');
    return fin(json({ ok: true, scope: 'all' }, 200, _clearRefreshCookie(env)));
  }
  /* Retire just this device's refresh token. Claiming its id is exactly what
     the refresh endpoint does on use, so a retired token is indistinguishable
     from one already spent - and a replay of it revokes the account, which is
     the correct response to a stolen token being reused. */
  let scoped = false;
  /* AMV-019: the cookie is where the refresh token lives on a deployment that
     has one, and script cannot read it - so a signing-out client has nothing to
     put in the body. Without looking here, every ordinary sign-out would find
     itself unscoped and revoke every session the person has on every device,
     which is a working feature turned into a daily annoyance by a security fix. */
  const rtRaw = String((body && body.refreshToken) || _readRefreshCookie(request) || '');
  if (rtRaw) {
    const rt = await verifyToken(rtRaw, env.JWT_SECRET, env, 'refresh');
    if (rt && rt.email === data.email && rt.jti) {
      await _claimOnce(env, 'usedrefresh', rt.jti, Math.floor(REFRESH_TTL_MS / 1000));
      await _retiredBySignOut(env, rt.jti);
      scoped = true;
    }
  }
  if (!scoped) {
    /* We were asked to sign out but given nothing that identifies WHICH session.
       A cached older build sends no body at all. The only safe reading of "sign
       me out" that we can actually honour is all of them - signing out nothing
       would leave a live token behind on a request that promised otherwise. */
    await revokeUserTokens(env, data.email);
    await _userEvent(env, request, data.email, 'signed_out_everywhere', { reason: 'unscoped' });
    return fin(json({ ok: true, scope: 'all' }, 200, _clearRefreshCookie(env)));
  }
  if (data.sid) { try { await env.AMV_KV.delete(_sessKey(data.email, data.sid)); } catch (e) {} }
  await _userEvent(env, request, data.email, 'signed_out');
  return fin(json({ ok: true, scope: 'device' }, 200, _clearRefreshCookie(env)));
}

/* GET /v1/sessions - where this account is signed in, newest first.
   POST /v1/sessions/end {id} - end one of them. Not this one: that is what
   Sign out is for, and it also clears this browser's cookie. */
async function sessionsList(request, env) {
  const user = await requireUser(request, env);
  if (!user || user.via === 'apikey') return json({ error: 'unauthorized' }, 401);
  let list = [];
  try { list = await _sessList(env, user.email); }
  catch (e) { return json({ error: 'AMV could not read your sign-ins just now. Try again in a moment.', code: 'sessions_unavailable' }, 503); }
  list.sort((a, b) => (b.seen || 0) - (a.seen || 0));
  return json({ ok: true, current: user.sid || '',
    sessions: list.map(r => ({ id: r.sid, device: r.dev || '', country: r.country || '', created: r.created || 0, seen: r.seen || 0, current: !!user.sid && r.sid === user.sid })) });
}
async function sessionsEnd(request, env) {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const user = await requireUser(request, env);
  if (!user || user.via === 'apikey') return json({ error: 'unauthorized' }, 401);
  const body = await request.json().catch(() => ({}));
  const id = String((body && body.id) || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Which sign-in? The id was missing or malformed.' }, 400);
  if (user.sid && id === user.sid) return json({ error: 'That is this device. Use Sign out to end it.', code: 'this_device' }, 400);
  const key = _sessKey(user.email, id);
  let rec = null;
  try { rec = JSON.parse(await env.AMV_KV.get(key) || 'null'); } catch (e) {}
  if (!rec) return json({ ok: true, already: true });
  await env.AMV_KV.delete(key);
  await _userEvent(env, request, user.email, 'session_ended', { from: rec.dev || 'a device' });
  return json({ ok: true });
}

/* DELETE MY ACCOUNT - the "right to erasure" the privacy policy promises.
   Purges every piece of the user's data from KV and revokes their tokens. It is
   irreversible, so the client requires an explicit typed confirmation before
   calling this. We delete by the user's own email, so one user can only ever
   delete THEMSELVES - never anyone else. */
/* Everything AMV holds that belongs to one account.

   ONE list, used twice and in opposite directions: erasure deletes it, and the
   data export returns it. Two lists would drift, and the way they would drift
   is the dangerous way round - an export that omits a record the product is
   still holding tells somebody they have everything when they do not, which is
   the question a data-access request is actually asking. */
/* 'kyc' is here because identity evidence is the single most sensitive record
   AMV holds about a person - and it was added with the payout risk engine and
   left out of this list, so a deleted account kept its verification row for
   ever with nothing able to reach it. The erasure check caught it, which is
   exactly what that check is for. */
const PER_USER_KINDS = ['acct', 'ent', 'entitleitem', 'data', 'auto', 'crewjobs', 'mailcfg', 'telegram', 'school', 'kyc',
  /* The list of their files kept in the account. The files themselves are in
     object storage and are erased by their own phase in authDeleteAccount. */
  'lib',
  /* The games somebody made. Every participant record lives inside the game
     record, so erasing the creator erases the people who played too - which is
     right: they have no account of their own to keep it under. */
  'gameown',
  'approvals', 'handoff', 'abuse', 'seller', 'widget', 'wallet', 'wallet_tx',
  /* The two convenience indexes: which listings somebody published and which
     conversations they are in. They name a person and point at their things,
     so they go with the account like everything else - and the records they
     point at are erased by the loops above and below this one. */
  'mktmine', 'mktinbox',
  /* Which of this person's payouts have not settled. The payouts themselves
     are retained - that is the tax record - and this is only a pointer, so it
     goes with the account. */
  'wdopen',
  /* Where each connector got to for this person, plus the ids of the messages
     AMV has already told them about. It is derived and small, but it is a
     record OF THEIR MAILBOX - which message arrived when, and which ones were
     surfaced - so it belongs to the account and goes with it. Caught by the
     erasure roster on the run that added it, which is what that check is for:
     a new per-person record is exactly the kind of thing that gets written
     first and remembered second. */
  'ingest',
  'purchases', 'stripecust', 'userteam', 'sites', 'spendlimits',
  'fin', 'finlink', 'invsnap', 'links', 'fam', 'apikeys', 'consent', 'widget_owner', 'shares', 'presence',
  /* Family invitations waiting for this person: who asked, and until when. */
  'faminv',
  /* The calendar subscriptions. Caught by the erasure roster on the run that
     added them, which is exactly what that check is for - a new per-person
     record is the kind of thing that gets written first and remembered second,
     and this one is a live link to somebody's calendar. Left off, deleting an
     account would keep a working view of their week. */
  'cal',
  /* The list of somebody's batches. The batches themselves (keyed by id, not
     by person) are deleted on erasure by walking this list first. */
  'batchidx',
  /* AMV-SP-02: the Google grant. It was erased - by a hand-written delete in
     authDeleteAccount, which also revokes the token at Google first - and it
     was never on this list, which is the shared inventory the export walks and
     the erasure roster checks against. So it sat outside the one place that
     knows what AMV holds about a person: the export did not mention it at all,
     and its deletion depended on somebody having remembered rather than on
     anything that would notice if they stopped.

     A person asking what AMV holds on them should be told there is a live grant
     to their Google account. Not the token - that is a credential and goes in
     EXPORT_REDACTED beside the mailbox password - but the fact of it, which is
     the thing they would want to revoke. */
  'goauth',
  /* Connected accounts, for exactly the reason stated above about the Google
     grant - and this one is worse if it is missed, because these tokens are the
     ones AMV uses while nobody is watching. A deleted account that left a live
     unattended mailbox grant behind would be the most serious version of this
     mistake the product could make. */
  'conn',
  /* App connector sign-ins, for the same reason as `conn` above them: tokens
     AMV holds against somebody's Notion or Stripe must not outlive the account. */
  'rmcp',
  /* Support tickets are keyed by the reporter's email precisely so they land
     here: a support inbox is one of the easiest places for somebody's words
     about their own account to outlive them. Erased with the account, and in
     their export, like everything else the server holds. */
  'support'];

/* Kinds that are HELD but must never be handed back verbatim: a live
   credential is not somebody's data to download, and returning it would turn
   an export into a key-exfiltration route. The fact that the record exists is
   disclosed; its contents are not. */
const EXPORT_REDACTED = { fin: 'bank connection credential', finlink: 'bank link token',
  apikeys: 'API key hashes', stripecust: 'payment processor customer id',
  /* AMV-014: the Canvas record carries a live bearer token. It was in
     PER_USER_KINDS, so the export walked it, and nothing redacted it - the
     download handed somebody a working key to their own school account, which
     then travels wherever that file travels: a mailbox, a cloud sync, a
     support ticket, a shared laptop. The mailbox and Telegram credentials were
     already treated this way; this one was missed because it was added later. */
  school: 'school (Canvas) access token', telegram: 'messaging bot token',
  mailcfg: 'mailbox password',
  /* AMV-SP-02. Named so the export says a grant exists, redacted because the
     refresh token in it is a working key to somebody's Google account - which
     then travels wherever a downloaded file travels. */
  goauth: 'Google account access grant (revoke it in your Google account, or by disconnecting here)',
  /* Sealed in the store already, so an export would carry ciphertext rather
     than tokens. Redacted anyway: handing somebody an encrypted blob of their
     own live credentials in a downloadable file is a key waiting for the day
     the key leaks, and the useful disclosure - that these grants exist, to
     whom, with what permission - is what the connections screen already shows
     in words a person can act on. */
  conn: 'connected account tokens (see Connected accounts to review or disconnect them)',
  rmcp: 'app connector sign-ins (see Integrations to review or disconnect them)' };

/* GET /v1/account/export - everything the server holds about the caller.

   The in-app "Export my data" button collected what lived in the BROWSER and
   said so, which was honest and was not the whole answer: automations,
   approvals, handoffs, purchases, the wallet, listings, teams and the activity
   log are all held server-side, and none of them were in the file somebody
   downloaded before deleting their account.

   Built from PER_USER_KINDS - the same list erasure walks - so the export
   cannot quietly cover less than the product holds. Anything on that list which
   is a live credential is reported as present and withheld rather than handed
   over: a data export is not a way to read a key back out. */
async function accountExport(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const guard = await guardAction(env, `acctexport:${user.email}`, 3, 20, 'data exports');
  if (guard) return guard;

  const email = String(user.email || '').toLowerCase();
  const records = {}, withheld = {};

  /* AMV-039: "EVERYTHING AMV HOLDS" WAS A PROMISE SIX EMPTY CATCHES COULD NOT KEEP.

     Every read and every listing here was wrapped in `catch(e){}`, and the note
     on the way out said this file is everything AMV holds on the server for
     this account. So a storage error, a timeout, one page of a listing that did
     not come back - and the export was quietly short, and said it was complete.

     This is not an ordinary swallowed error. A data export is the thing a
     person is given when they exercise a right to it, and it is read as an
     answer to "what do you have on me". An answer that is missing a record
     nobody knows is missing is worse than a refusal, because the person cannot
     tell and stops asking.

     Nothing is silent now. Whatever could not be read is named, the answer says
     plainly whether it is complete, and the note only claims completeness when
     it is true. */
  const unreadable = [];
  const noteFailure = (what, e) => {
    unreadable.push({ what, why: String((e && e.message) || e).slice(0, 120) });
  };

  for (const kind of PER_USER_KINDS) {
    if (kind in EXPORT_REDACTED) {
      let present = false;
      try { present = !!(await DB.get(env, kind, email)); }
      catch (e) { noteFailure(kind, e); continue; }
      if (present) withheld[kind] = EXPORT_REDACTED[kind];
      continue;
    }
    try { const v = await DB.get(env, kind, email); if (v != null) records[kind] = v; }
    catch (e) { noteFailure(kind, e); }
  }

  /* The account record is the SUBJECT of the export. Without it there is
     nothing to hand over that means anything, so that one failure is refused
     outright rather than reported as a gap. */
  if (unreadable.some(u => u.what === 'acct')) {
    audit(env, 'account_export_failed', { email });
    return json({ error: 'AMV could not read your account record just now, so it will not hand you an export that is missing it. '
                       + 'Nothing has been lost - please try again in a moment.',
                  code: 'export_unavailable' }, 503);
  }

  /* The loose keys, in the same shapes erasure removes them. */
  const loose = {};
  const add = async (k, label) => {
    try { const v = await env.AMV_KV.get(k); if (v != null) loose[label || k] = v; }
    catch (e) { noteFailure(label || k, e); }
  };
  await add(`alog:${email}`, 'activity_log');
  await add(`refmine:${email}`, 'referral_code');
  await add(`refpend:${email}`, 'referral_pending');
  for (const prefix of [`resume:${email}:`, `smsverify:${email}:`, `mktsess:${email}:`, `sess:${email}:`]) {
    try {
      let cursor;
      do {
        const page = await env.AMV_KV.list({ prefix, cursor, limit: 1000 });
        for (const k of (page.keys || [])) {
          /* A pending verification CODE is a credential; that one is named, not
             returned. */
          if (prefix.startsWith('smsverify')) { withheld[k.name] = 'pending verification code'; continue; }
          await add(k.name);
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
    } catch (e) { noteFailure(prefix + '*', e); }
  }

  const complete = unreadable.length === 0;
  if (!complete) {
    audit(env, 'account_export_partial', { email, missing: unreadable.length });
    try { await alertOnce(env, 'export_partial',
      'A data export came back incomplete - ' + unreadable.length + ' record(s) could not be read. '
      + 'The person was told, but this is a storage fault worth looking at.', 60); } catch (e) {}
  }
  audit(env, 'account_exported', { email, kinds: Object.keys(records).length, complete });
  return json({
    ok: true,
    generatedAt: new Date().toISOString(),
    account: email,
    complete,
    note: (complete
      ? 'Everything AMV holds on the server for this account.'
      : 'This export is INCOMPLETE. ' + unreadable.length + ' record'
        + (unreadable.length === 1 ? '' : 's') + ' could not be read and are listed under `unreadable`. '
        + 'Nothing has been deleted - they exist and could not be fetched. Ask again shortly for a complete copy.')
      + ' Records that are live credentials are listed under `withheld` by name only - AMV will not hand a key back through an export.',
    records, loose, withheld,
    ...(complete ? {} : { unreadable }),
    alsoRetained: { billing: 'invoices and payment records are kept to meet retention obligations and are available on request' },
  });
}

/* Payouts of this seller's that have not settled yet.

   Lives outside authDeleteAccount deliberately. That function is read by
   erasure-covers-every-key, which takes any key prefix named inside it as a
   claim that erasure DELETES that prefix - and this only reads them. A scan
   for a guard, written in the middle of a deletion routine, would have made
   the payout ledger look erased to the one check whose job is to notice if it
   ever were. */
/* A SELLER'S UNSETTLED PAYOUTS, WITHOUT READING THE WHOLE LEDGER.

   This walked every `withdraw:` record ever written to find the handful
   belonging to one person - on account deletion, which is rare, so it was easy
   to leave. It gets slower every day and never recovers: the ledger is
   retained for ever on purpose, because it is the tax record.

   The index is complete BY CONSTRUCTION rather than by everybody remembering.
   A payout is unsettled from the moment it is requested until the moment it is
   settled, and there are exactly two places in this file where either happens
   - marketWithdraw and adminPayoutMark. Both go through the two helpers below,
   so an id cannot enter or leave the open set anywhere else.

   That distinction is the whole reason this one is safe and the automation
   due-index was not: there, a due time could be set from any number of places
   and completeness rested on discipline. Here the state transition IS the
   write, and the write is in two functions. */
async function _openPayoutAdd(env, email, id) {
  const em = String(email || '').toLowerCase();
  if (!em || !id) return;
  try {
    await _withKV(env, 'wdopen', em, (r) => {
      r.ids = Array.isArray(r.ids) ? r.ids : [];
      if (!r.ids.includes(id)) r.ids.push(id);
      /* An index that gains a payout is an index. Without this the next read
         would rebuild it by scanning, which is the cost being removed. */
      r.built = r.built || Date.now();
      return r;
    }, { ids: [] });
  } catch (e) { audit(env, 'open_payout_index_failed', { email: em, id, op: 'add', error: String((e && e.message) || e) }); }
}
async function _openPayoutRemove(env, email, id) {
  const em = String(email || '').toLowerCase();
  if (!em || !id) return;
  try {
    await _withKV(env, 'wdopen', em, (r) => {
      r.ids = (Array.isArray(r.ids) ? r.ids : []).filter(x => x !== id);
      r.built = r.built || Date.now();
      return r;
    }, { ids: [] });
  } catch (e) { audit(env, 'open_payout_index_failed', { email: em, id, op: 'remove', error: String((e && e.message) || e) }); }
}

async function _payoutsInFlight(env, email) {
  const em = String(email || '').toLowerCase();
  const held = [];
  try {
    const raw = await env.AMV_KV.get(`wdopen:${em}`);
    let idx = null;
    try { idx = raw ? JSON.parse(raw) : null; } catch (e) { idx = null; }
    /* BUILT ON FIRST USE, like the marketplace indexes and for the same
       reason: a payout requested before this index existed is in no index, and
       "no entry" would read as "nothing in flight" - which is the answer that
       lets somebody delete an account with money on its way to them. `built`
       is what separates a seller with nothing outstanding from one nobody has
       looked up yet. */
    if (!idx || !idx.built) {
      const found = [];
      let cursor, scanned = 0;
      do {
        const page = await env.AMV_KV.list({ prefix: 'withdraw:', cursor, limit: 1000 });
        for (const k of (page.keys || [])) {
          scanned++;
          const w = await env.AMV_KV.get(k.name);
          if (!w) continue;
          let rec = null; try { rec = JSON.parse(w); } catch (e) { continue; }
          if (rec && String(rec.seller || '').toLowerCase() === em
              && ['pending', 'approved'].includes(rec.status || 'pending')) found.push(rec.id || k.name.slice(9));
        }
        cursor = page.list_complete ? undefined : page.cursor;
        if (cursor && scanned >= 20000) {
          /* A backfill that stopped short is NOT written as complete - the
             payouts past the cap would be lost to this check for good, which
             is worse than the slow read it replaces. */
          audit(env, 'open_payout_backfill_partial', { email: em, scanned });
          cursor = undefined;
          idx = { ids: found, built: 0 };
          break;
        }
      } while (cursor);
      if (!idx) {
        idx = { ids: found, built: Date.now() };
        try { await env.AMV_KV.put(`wdopen:${em}`, JSON.stringify(idx)); } catch (e) {}
      }
    }
    const ids = idx.ids || [];
    for (const id of ids) {
      const w = await env.AMV_KV.get(`withdraw:${id}`);
      if (!w) continue;
      let rec = null; try { rec = JSON.parse(w); } catch (e) { continue; }
      /* Checked against the RECORD, not taken from the index. An index is a
         convenience; the payout's own status is the truth, and a stale entry
         must not block somebody's deletion for a payout that already settled. */
      if (rec && rec.seller === em && ['pending', 'approved'].includes(rec.status || 'pending')) held.push(rec);
    }
  } catch (e) {
    /* AMV-SP-04: "I COULD NOT LOOK" IS NOT "I LOOKED AND FOUND NOTHING".

       This returned an empty list on any read failure, and the note said a
       failed read must not become a way to block somebody's deletion. That is
       the right instinct about a right to erasure and the wrong answer about
       money. An empty list is indistinguishable from a clean one, so a storage
       blip let an account be erased while a payout was on its way to it - and
       erasure takes the WALLET, so the balance those payouts were debited from
       goes too. The comment's own consolation, that the payout records survive,
       is only half true: the record survives and the person it was owed to does
       not.

       It also fails in the one direction that cannot be undone. Waiting costs
       somebody a few minutes; erasing costs them their money and there is no
       putting it back.

       So the two outcomes are separated. A genuine miss still means nothing is
       in flight. An unreadable one throws, and the caller asks them to try
       again rather than deleting on the strength of a lookup that never
       happened. */
    audit(env, 'delete_payout_check_failed', { email: em, error: String((e && e.message) || e) });
    const err = new Error('payouts in flight could not be checked');
    err.code = 'payout_check_unavailable';
    throw err;
  }
  return held;
}

/* AMV-015: DELETING EVERYTHING SOMEBODY HAS NEEDS MORE THAN A BEARER TOKEN.

   Erasure is the one irreversible action in the product. It took whatever
   requireUser accepted and nothing more - so an access token was enough, and an
   access token is the thing most likely to have leaked: a shared laptop left
   signed in, a token pulled out of storage by a script on some other page, a
   borrowed phone. Every other destructive act in a product like this asks the
   person to prove they are still there, precisely because holding a session is
   not the same as being the account owner right now.

   An API key is not a way to do it at all. A key is for automation, and no
   automation has a reason to erase the account it runs on; making it possible
   only means a leaked key can.

   Federated accounts have no password to check, so they confirm by typing their
   own address - which proves intent and the identity of whoever is looking at
   the screen, and is what the interface can honestly ask of them. */
async function _reauthForDelete(env, request, user, body) {
  if (user.via === 'apikey') {
    return json({ error: 'An API key cannot delete an account. Sign in and delete it from your settings.',
                  code: 'reauth_required' }, 403);
  }
  const em = String(user.email || '').toLowerCase();
  const acct = await DB.get(env, 'acct', em);
  if (!acct) return json({ error: 'unauthorized' }, 401);

  /* Bounded, because this endpoint now accepts a password and everything that
     accepts a password is a guessing surface. */
  const g = await guardAction(env, `delacct:${em}`, 5, 20, 'account deletion');
  if (g) return g;

  if (acct.provider === 'email' && acct.pwHash) {
    const password = String((body && body.password) || '');
    if (!password) {
      return json({ error: 'Enter your password to confirm you want to delete your account. This cannot be undone.',
                    code: 'reauth_required', need: 'password' }, 401);
    }
    const hash = await _hashPassword(password, acct.salt, acct.pwIter || 100000);
    const ok = timingSafeEqual(new TextEncoder().encode(hash), new TextEncoder().encode(acct.pwHash || ''));
    if (!ok) {
      audit(env, 'delete_reauth_failed', { email: em });
      return json({ error: 'That password is not right.', code: 'reauth_failed', need: 'password' }, 401);
    }
    return _deleteSecondStep(env, em, acct, body);
  }

  /* No password on the account - it is a federated sign-in. Typing the address
     is what can honestly be asked, and it still requires somebody to be looking
     at the screen rather than a token being replayed. */
  const typed = String((body && body.confirmEmail) || '').toLowerCase().trim();
  if (typed !== em) {
    return json({ error: 'Type your email address to confirm you want to delete your account. This cannot be undone.',
                  code: 'reauth_required', need: 'confirmEmail' }, 401);
  }
  return _deleteSecondStep(env, em, acct, body);
}
/* AND THE SECOND STEP, WHERE THERE IS ONE.

   Somebody who turned on an authenticator app or added a passkey did it so
   that a password alone - phished, reused, typed on a shared computer - does
   not open the account. Deleting the account is the one thing that cannot be
   undone, so it asks for the same: an authenticator or recovery code, or the
   passkey. A recovery code used here is spent, like anywhere else. */
async function _deleteSecondStep(env, em, acct, body) {
  const f = _acctFactors(acct);
  if (!f.totp && !f.passkeys) return null;
  const b = body || {};
  const can = { totp: f.totp, recovery: f.recoveryLeft > 0, passkey: f.passkeys > 0 };
  if (typeof b.totp === 'string' && f.totp) { if (await _totpSpend(env, em, b.totp)) return null; }
  else if (typeof b.recovery === 'string' && f.recoveryLeft) { if (await _recoverySpend(env, em, b.recovery)) return null; }
  else if (b.passkey && f.passkeys) {
    const site = _pkSite(env);
    if (site && await _pkAssertFor(env, site, em, b.passkey, 'stepup').catch(() => null)) return null;
  }
  else return json({ error: f.totp ? 'Enter a code from your authenticator app as well. This cannot be undone.'
                                   : 'Confirm with your passkey as well. This cannot be undone.',
                     code: 'reauth_required', need: 'second', can }, 401);
  audit(env, 'delete_reauth_failed', { email: em, step: 'second' });
  return json({ error: 'That did not confirm it is you. Nothing was deleted.', code: 'reauth_failed', need: 'second', can }, 401);
}

async function authDeleteAccount(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const email = user.email;

  /* Before anything is touched. */
  const body = await request.json().catch(() => ({}));
  const reauth = await _reauthForDelete(env, request, user, body);
  if (reauth) return reauth;

  /* MONEY IN FLIGHT IS A REASON TO WAIT, NOT A REASON TO REFUSE.

     A payout is requested, the balance is debited, the record sits waiting for
     an operator - and nothing stopped the seller deleting the account in
     between. The wallet went with it, so the money was neither in their
     balance nor with them, and the only thing left naming them was a payout
     record for an account that no longer existed.

     This is not a refusal of the right to erasure. It is a few days: settle
     the payout or cancel it, and the account deletes normally. Saying which
     one and how much matters - "you cannot delete your account" with no
     reason is how somebody decides the platform is keeping them hostage. */
  let held = [];
  try {
    held = await _payoutsInFlight(env, email);
  } catch (e) {
    /* Deliberately NOT treated as "nothing outstanding". See _payoutsInFlight:
       erasure takes the wallet, so proceeding on a lookup that failed is how
       somebody loses money AMV was in the middle of sending them. */
    try { await alertOnce(env, 'delete_payout_check',
      'An account deletion could not be completed because the unsettled-payout check could not be read. '
      + 'The account is intact and the person has been asked to try again.', 30); } catch (_) {}
    return json({
      error: 'AMV could not confirm whether you have any payouts still being sent, so your account has not '
           + 'been deleted. Nothing has changed. Please try again in a few minutes - this is a temporary fault '
           + 'on our side, not a refusal.',
      code: 'payout_check_unavailable',
    }, 503);
  }
  if (held.length) {
    const total = +held.reduce((n, w) => n + (+w.amount || 0), 0).toFixed(2);
    audit(env, 'delete_blocked_payout', { email, count: held.length, total });
    return json({
      error: `You have ${held.length} payout${held.length === 1 ? '' : 's'} of $${total.toFixed(2)} still being sent. `
           + 'Your account can be deleted once they have settled, usually within a few days - '
           + 'or cancel the withdrawal and the balance returns to you first.',
      code: 'payout_pending', count: held.length, amountUSD: total,
    }, 409);
  }

  // (AMV-015) Erase referenced records too, not just the top-level per-user rows.

  /* EVERY PHASE REPORTS INTO THE SAME LIST.

     The loop over perUserKinds below already did this, and its comment states
     the principle: "Erasure that half-worked and SAYS so can be finished by
     hand; erasure that half-worked in silence cannot, because nobody knows to
     look." That was true of one loop out of fifteen. Every other phase - the
     deployed sites, the shared conversations, the marketplace snapshots, the
     revoke of every connected account, the OTHER party's half of a permission
     link, the family membership, the API keys, and a live password-reset code -
     swallowed its failure whole and let the route answer "deleted".

     So the list is declared up here instead, and each phase names itself into
     it. Deduped, because one phase failing on ten rows is one thing to go and
     finish, not ten. A parse fallback is deliberately NOT counted: only a catch
     that wraps an actual deletion can mean data survived. */
  const eraseFailed = [];
  const _eraseFailed = (what) => { if (!eraseFailed.includes(what)) eraseFailed.push(what); };

  // 1) Remove the user from their team's member list before dropping the pointer,
  //    so team records don't retain a ghost member. (A team-OWNER's team is left
  //    intact - ownership transfer/teardown is a separate flow.)
  try {
    const tid = await env.AMV_KV.get(`userteam:${email}`);
    if (tid) {
      /* AMV-197: erasure competes with everything else the team is doing, and
         it is the one write that must not be undone - a ghost member left on
         the record is data AMV said it had deleted. */
      /* ONE pass under ONE lock, member and owner alike. Taking it, releasing
         it, and taking it again for the owner case is two chances for the team
         to change underneath a half-finished erasure - and if the second
         attempt cannot get the lock, the owner teardown silently does not
         happen while the first half already did. */
      const wasOwner = await _withTeam(env, tid, (fresh) => {
        if (!fresh) return false;
        const owner = fresh.ownerEmail === email;
        fresh.members = (fresh.members || []).filter(m => m.email !== email);
        if (owner) {
          /* The OWNER is the one who pays. A team's plan is a cached copy of
             their entitlement, so deleting the owner used to leave
             `plan:'elite'` sitting on the record with no lapse marker and
             nobody being billed - every member kept a paid plan, free,
             permanently.

             The team is NOT deleted: other people's shared projects and library
             live in it, and destroying those is not a consequence anybody
             agreed to by one person closing their own account. It simply stops
             being a paid team, which is the true statement now that nobody is
             paying, and members fall back to their own plans. */
          fresh.plan = 'free';
          fresh.ownerGone = Date.now();
        }
        return owner;
      });
      if (wasOwner) audit(env, 'team_owner_deleted', { team: tid, was: email });
    }
  } catch (e) {
    /* Not silent. A ghost member left on a team record is data AMV has told
       somebody was deleted, and nobody finds out from an empty catch. */
    audit(env, 'erase_team_failed', { email, error: String((e && e.message) || e) });
    /* Audited and paged, and until now the ROUTE still answered "deleted" - so
       the person was told it was done while a membership row still named them. */
    _eraseFailed('team membership');
    try { await alertOnce(env, 'erase_team:' + email,
      'An account was deleted but could not be removed from its team, so a membership row may still name them. Remove it by hand.', 60); } catch (_) {}
  }

  /* Their files in object storage - every one, checked gone afterwards. */
  try { await _libEraseAll(env, email); }
  catch (e) {
    audit(env, 'erase_library_failed', { email, error: String((e && e.message) || e).slice(0, 120) });
    _eraseFailed('your files');
  }

  /* Their batches: the requests they sent, the answers, and the queue entry -
     found through the index before the index itself goes. */
  try {
    const bidx = (await DB.get(env, 'batchidx', email)) || [];
    for (const b of bidx) {
      const id = b && b.id; if (!/^batch_[a-f0-9]{24}$/.test(String(id || ''))) continue;
      try {
        const rec = await DB.get(env, 'batch', id);
        const n = rec && Array.isArray(rec.items) ? rec.items.length : BATCH_MAX;
        for (let i = 0; i < n; i++) { await env.AMV_KV.delete(`batchreq:${id}:${i}`); await env.AMV_KV.delete(`batchres:${id}:${i}`); }
        await env.AMV_KV.delete('batchq:' + id);
        await DB.del(env, 'batch', id);
      } catch { _eraseFailed('batches'); }
    }
  } catch { _eraseFailed('batches'); }

  // 2) Delete the user's deployed public sites (records + index).
  try {
    const idx = await DB.get(env, 'sites', email);
    for (const slug of (idx && idx.slugs) || []) { try { await DB.del(env, 'site', slug); } catch { _eraseFailed('deployed sites'); } }
  } catch { _eraseFailed('deployed sites'); }

  /* Publicly shared conversations. `sites` was handled this way and `share` was
     not, so a deleted account's chats stayed readable at their public URL
     forever - the account was gone from every screen and the content was still
     on the internet. */
  try {
    const mine = await DB.get(env, 'shares', email);
    for (const it of ((mine && mine.items) || [])) {
      const sid = it && (it.id || it.slug);
      if (sid) { try { await DB.del(env, 'share', sid); } catch { _eraseFailed('shared conversations'); } }
    }
  } catch { _eraseFailed('shared conversations'); }

  // 3) Delete the user's marketplace listings and their purchased-item snapshots.
  try {
    /* Listings live in KV everywhere else in the product - marketList and
       _getListing both read them straight from it - so they are enumerated the
       same way here. Listing them through DB found nothing on a D1 deployment,
       which left a deleted account's listings sitting in the public catalogue
       with their address on them. Within one kind, every operation has to use
       the same door. */
    let cursor;
    do {
      const page = await env.AMV_KV.list({ prefix: 'market:', cursor, limit: 1000 });
      for (const k of (page.keys || [])) {
        try {
          const raw = await env.AMV_KV.get(k.name);
          if (!raw) continue;
          const rec = JSON.parse(raw);
          if (rec && rec.authorEmail === email) await env.AMV_KV.delete(k.name);
        } catch { _eraseFailed('marketplace listings'); }
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  } catch { _eraseFailed('marketplace listings'); }
  try {
    /* Through DB, both to list and to delete. Listing from KV found nothing on a
       D1 deployment, so the snapshots of everything this person had bought
       survived the erasure of their account - data that was supposed to be gone
       and is keyed by their address. */
    /* Keyed `<buyer>:<item>`, so this person's are found by their own prefix.
       This used to read every snapshot in the product for every deletion -
       one is written on every purchase, so at scale an erasure that read them
       all would run out of time and fail to erase. */
    for (const id of await DB.idsWithPrefix(env, 'mktsnap', email + ':')) {
      try { await DB.del(env, 'mktsnap', id); } catch { _eraseFailed('purchased-item snapshots'); }
    }
  } catch { _eraseFailed('purchased-item snapshots'); }

  /* Account-link invitations, keyed `link:<owner>|<id>` - the same compound
     shape as the snapshots above, and missed for the same reason: `links` is
     on PER_USER_KINDS and `link` is a different kind entirely, one letter
     apart. Each record holds a live six-digit confirmation code, the scopes
     somebody asked for over this account, and the address of whoever asked.
     Left behind, that is a working credential against an account that no
     longer exists, naming a person who asked to stop existing here.

     Both directions: invitations ABOUT this account, and invitations this
     account sent to somebody else. */
  try {
    /* Invitations TO this account are keyed by it, so those come by prefix;
       ones it SENT are keyed by whoever it invited, and nothing lists them,
       so those still need the scan below. It is family invitations only,
       rate-limited per sender, so the namespace stays small - but a sender
       index would remove the scan entirely. */
    for (const id of await DB.idsWithPrefix(env, 'link', email + '|')) {
      try { await DB.del(env, 'link', id); } catch { _eraseFailed('account-link invitations'); }
    }
    const { rows: invites } = await scan(env, 'link', SCAN_ALL, 'erasure: account-link invitations');
    for (const l of invites) {
      const id = l && typeof l.id === 'string' ? l.id : '';
      const rec = (l && l.value) || {};
      const mine = id.startsWith(email + '|')
        || String(rec.grantee || '').toLowerCase() === email
        || String(rec.owner || '').toLowerCase() === email;
      if (!mine) continue;
      try { await DB.del(env, 'link', id); } catch { _eraseFailed('account-link invitations'); }
    }
  } catch { _eraseFailed('account-link invitations'); }

  // 4) Unlink phone/SMS records (email↔phone are cross-referenced).
  try {
    const link = await env.AMV_KV.get(`sms:user:${email}`);
    if (link) { let phone = link; try { phone = JSON.parse(link).phone || link; } catch { /* an older row held the number as a bare string; that IS the fallback, not a failure to delete anything */ } if (phone) await env.AMV_KV.delete(`sms:phone:${phone}`); }
    await env.AMV_KV.delete(`sms:user:${email}`);
    await env.AMV_KV.delete(`sms:email:${email}`);
  } catch { _eraseFailed('phone and SMS records'); }

  /* 5) END THE SUBSCRIPTION BEFORE ERASING WHAT MAKES IT FINDABLE.

     Deleting the account used to drop the customer maps and stop there, so the
     card kept being charged every month for a product the person no longer had
     - and because the reverse-map was gone, the webhook for those charges could
     no longer resolve to anybody, so nothing here even noticed. The customer's
     only remaining move is a chargeback.

     Cancelled immediately rather than at period end: they asked for the account
     to stop existing, so continuing to bill to the end of a cycle they cannot
     use is not a defensible reading of that. */
  let cancelled = 0, cancelFailed = 0;
  try {
    const custId = await env.AMV_KV.get(`stripecust:${email}`);
    if (custId && env.STRIPE_SECRET_KEY) {
      const sk = { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
                   'Content-Type': 'application/x-www-form-urlencoded' };
      const ls = await fetchDeadline('https://api.stripe.com/v1/subscriptions?status=active&limit=100&customer=' +
        encodeURIComponent(custId), { headers: sk });
      const ld = await ls.json().catch(() => ({}));
      for (const sub of ((ld && ld.data) || [])) {
        try {
          const dr = await fetchDeadline('https://api.stripe.com/v1/subscriptions/' + encodeURIComponent(sub.id),
            { method: 'DELETE', headers: sk });
          if (dr.ok) cancelled++; else cancelFailed++;
        } catch { cancelFailed++; }
      }
    }
    if (custId) await env.AMV_KV.delete(`custemail:${custId}`);
  } catch { cancelFailed++; }

  /* AMV-SP-03: AND PAYPAL, WHICH WAS NEVER CANCELLED AT ALL.

     Only Stripe was ended here. A customer who pays through PayPal and deletes
     their account went on being charged every month for a product they no
     longer have - which is the exact failure the note above describes, left in
     place for the other half of the paying customers. It is worse on this side:
     PayPal bills against an agreement the customer set up, so it keeps taking
     money with nothing on AMV's side involved at all.

     The subscription id is on the entitlement, recorded when the plan was
     granted (AMV-007), so there is no lookup to lose. Read BEFORE the record is
     erased, for the same reason the Stripe block runs before the customer maps
     go: after erasure there is nothing left that names the subscription. */
  try {
    const ent = await DB.get(env, 'ent', email);
    const ppSub = ent && ent.lastEventSrc === 'paypal' ? String(ent.subId || '') : '';
    if (ppSub && env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET) {
      const token = await _paypalToken(env);
      if (!token) { cancelFailed++; }
      else {
        const r = await fetchDeadline(
          `${_paypalBase(env)}/v1/billing/subscriptions/${encodeURIComponent(ppSub)}/cancel`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Account deleted at the customer\u2019s request' }),
          });
        /* PayPal answers 204 on success, and 422 when the subscription is
           already cancelled or expired - which is the outcome asked for, so it
           is not a failure. */
        if (r.status === 204 || r.ok) cancelled++;
        else if (r.status === 422) { /* already not billing; nothing to do */ }
        else cancelFailed++;
      }
    }
  } catch { cancelFailed++; }

  /* A card still being charged after erasure is the one failure here that costs
     a real person real money, and the account row is about to go - so if the
     cancellation did not land, it has to reach a human who can finish it. */
  if (cancelFailed) {
    try {
      await alertOnce(env, 'delete_cancel_fail_' + email,
        'Account deleted but a subscription could not be cancelled for ' + email +
        '. Cancel it in Stripe or PayPal now - this customer is still being charged.', 1);
    } catch {}
  }
  audit(env, 'account_delete_billing', { email, cancelled, cancelFailed });

  // 6) Per-user records keyed by email. DB.del handles both D1 and KV so the
  //    erasure is complete under either storage backend (AMV-014). We intentionally
  //    KEEP `tokepoch` (a bare revocation integer, no personal data) so any tokens
  //    still in circulation stay dead after the account row is gone.
  /* Disconnect the bank at the PROVIDER before dropping our copy. Deleting the
     record alone leaves a live connection to somebody's financial data standing
     at a third party, against an account that no longer exists - and, on a
     metered aggregator, still being billed for. Erasure has to reach outside
     this worker or it is not erasure. */
  try {
    const fin = await _finGet(env, email);
    if (fin && fin.accessToken && _finReady(env)) {
      await _finCall(env, '/item/remove', { access_token: fin.accessToken });
    }
  } catch { _eraseFailed('bank connection'); }

  /* THE OLDER GOOGLE GRANT'S REFRESH TOKENS, WHICH NOTHING WRITES ANY MORE.

     `goauth` is where googleOAuthExchange stored a long-lived refresh token.
     That route is retired and connected accounts replaced it, so no new row can
     appear here - and every row that already exists is a standing grant to
     somebody's mail and calendar. Closing an account has to end those, or the
     grant outlives the user it belonged to, revocable by nobody.

     KEPT UNTIL THE ROWS ARE GONE, deliberately. Deleting this because nothing
     writes it any more would leave exactly the accounts that connected under
     the old flow - the ones with the longest-lived tokens - as the ones erasure
     silently skips. Revoked at Google first, then the record goes either way: a
     third party being unreachable must not keep somebody connected to a service
     they have left. */
  try {
    const g = await DB.get(env, 'goauth', email);
    if (g && g.refreshToken) {
      try {
        await fetchDeadline('https://oauth2.googleapis.com/revoke', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: g.refreshToken }).toString(),
        });
      } catch { _eraseFailed('stored bank data'); }
      audit(env, 'google_revoked_on_erasure', { by: email });
    }
    await DB.del(env, 'goauth', email);
  } catch { _eraseFailed('stored bank data'); }

  /* EVERY CONNECTED ACCOUNT, REVOKED BEFORE THE ROW GOES.

     Same reasoning as the Google grant above, and more urgent: these are the
     tokens AMV uses while nobody is watching. An account closed while a live
     unattended mailbox grant stayed valid at the provider would be the worst
     thing this feature could do to somebody - they deleted their account
     precisely to end that, and would have no way left to reach it.

     `conn` is also in PER_USER_KINDS, so the loop below deletes the record
     regardless. This runs first so the grant is dead at the provider before
     the only copy of the token is gone. A provider that cannot be reached does
     not keep the account open - the row still goes - but it is audited, because
     that is a live grant nobody can now revoke and somebody should know. */
  try {
    const conns = (await DB.get(env, CONN_KV, email)) || {};
    for (const id of Object.keys(conns)) {
      const c = conns[id];
      const p = CONN_PROVIDERS[(c && c.provider) || ''];
      if (!p || !p.revoke) { audit(env, 'conn_unrevocable_on_erasure', { by: email, provider: (c&&c.provider)||'' }); continue; }
      try {
        const tok = await connOpen(env, c.sealed);
        const r = await _connRevokeRequest(env, p, tok);
        audit(env, 'conn_revoked_on_erasure', { by: email, provider: c.provider, ok: r.ok });
      } catch (e) {
        audit(env, 'conn_revoke_failed_on_erasure', { by: email, provider: c.provider,
          why: String((e && e.message) || 'failed').slice(0, 60) });
      }
    }
  } catch { _eraseFailed('connected accounts'); }
  /* The same for app connectors: revoked at each app first where it offers a
     way to, then the record goes with the rest of PER_USER_KINDS. */
  try {
    const apps = (await DB.get(env, RMCP_KV, email)) || {};
    for (const slug of Object.keys(apps)) {
      const ok = await _rmcpRevoke(env, apps[slug]);
      audit(env, ok ? 'rmcp_revoked_on_erasure' : 'rmcp_unrevoked_on_erasure', { by: email, app: slug });
    }
  } catch { _eraseFailed('app connectors'); }

  /* Links this account is part of, in BOTH directions. A link lives under each
     side's own row, so deleting only this one would leave the other party
     holding an active grant pointing at an account that is gone. */
  try {
    const rec = await DB.get(env, 'links', email);
    for (const l of ((rec && rec.items) || [])) {
      const other = l.owner === email ? l.grantee : l.owner;
      if (!other || other === email) continue;
      const r = await DB.get(env, 'links', other);
      if (!r || !Array.isArray(r.items)) continue;
      const before = r.items.length;
      r.items = r.items.filter(x => x.id !== l.id);
      if (r.items.length !== before) await DB.put(env, 'links', other, r);
    }
  } catch { _eraseFailed('links held by the other party'); }

  /* If this person was carried in someone's family, their membership row is
     held in the PARENT's record and would otherwise outlive them. */
  try {
    const ent = await DB.get(env, 'ent', email);
    if (ent && ent.familyOf) {
      /* AMV-197: under the family's lock. A parent adjusting limits at the same
         moment would otherwise write back the record they read first, and the
         deleted person's row would return - data AMV has already told them was
         gone. */
      await _withFam(env, ent.familyOf, (fam) => {
        if (!fam || !Array.isArray(fam.members)) return;
        fam.members = fam.members.filter(m => m.email !== email);
      });
    }
  } catch { _eraseFailed('family membership'); }

  /* And if they were the parent, the children must stop being limited by an
     account that no longer exists - otherwise a spend cap set by a deleted
     parent would apply forever with nobody able to lift it. */
  try {
    const mine = await DB.get(env, 'fam', email);
    for (const m of ((mine && mine.members) || [])) {
      if (!m || !m.email) continue;
      await _withEnt(env, m.email, (ce) => {
        if (!ce || ce.familyOf !== email) return null;
        delete ce.familyOf;
      });
    }
  } catch { _eraseFailed('family limits on children'); }

  /* API KEYS OUTLIVING THE ACCOUNT.

     A key is resolved by `apikey:<hash>` -> {email, id}, and the request path
     never checks that the account still exists. Neither the key records nor
     those lookups were deleted, so every key a person had carried on
     authenticating after they closed their account - live credentials into the
     product, spending against quota, belonging to nobody. Revoking one deletes
     its lookup for exactly this reason; erasure has to do the same for all of
     them, which is what the stored hash is there for. */
  try {
    const keys = await DB.get(env, 'apikeys', email);
    for (const k of ((keys && keys.items) || [])) {
      if (k && k.hash) { try { await env.AMV_KV.delete(`apikey:${k.hash}`); } catch { _eraseFailed('API keys'); } }
    }
  } catch { _eraseFailed('API keys'); }

  /* `fin` is a live credential and `invsnap` is a record of somebody's account
     balances - both are exactly what erasure is for, and neither was listed. */
  const perUserKinds = PER_USER_KINDS;
  /* `billing` is deliberately NOT in that list. Invoices and payment records
     carry retention obligations that erasure does not override, and deciding
     otherwise is a legal call rather than an engineering one. It stays until
     somebody with the authority to say so decides how long. */
  /* AMV-192: A FAILED DELETE IS NOT A SUCCESSFUL ERASURE.

     This swallowed every failure whole - a storage hiccup on one kind, a
     timeout on another, and the route still answered ok with a smaller number
     nobody compares to anything. The person is told their data is gone while
     their bank credential, their conversations, their family record are still
     here, and nobody finds out, because the only trace was a counter that
     quietly counted lower.

     "Your account has been deleted" is a statement to a regulator, not a status
     message. So what survives is collected, named, returned, audited and paged.
     Erasure that half-worked and SAYS so can be finished by hand; erasure that
     half-worked in silence cannot, because nobody knows to look. */
  /* Each passkey is also indexed by its own id, so a passkey sign-in can find
     its account. Read before the account record goes, or nothing would say
     which index entries were this person's - and a passkey of a deleted
     account would keep resolving to an address. */
  let myPasskeys = [];
  try { const a = await DB.get(env, 'acct', email); myPasskeys = ((a && a.passkeys) || []).map(k => k.id).filter(Boolean); }
  catch { _eraseFailed('passkey index'); }
  let deleted = 0;
  for (const kind of perUserKinds) {
    try { await DB.del(env, kind, email); deleted++; }
    catch (e) { eraseFailed.push(kind); }
  }
  /* Uncounted, so the conversion denominator follows reality. A counter that
     only ever goes up would make the funnel look worse every time somebody
     leaves, which is its own kind of wrong number. */
  try{ await counter(env, 'popaccounts', { op: 'incr', amount: -1 }); }catch(e){}
  /* Loose per-user keys that are not DB `kind` rows. The referral pair must go
     both ways or the code would keep resolving to an account that no longer
     exists, and the activity log is a record OF this person - erasure means it
     goes too. */
  let myCode = '';
  /* A failed READ here is not harmless: myCode stays empty, so `refcode:<code>`
     below is never deleted and the code keeps resolving to an account that is
     gone. Nothing else would ever notice. */
  try { myCode = await env.AMV_KV.get(`refmine:${email}`) || ''; }
  catch { _eraseFailed('referral code pair'); }
  /* `reset:${email}` used to be on this list and never existed: reset tokens
     are keyed by the TOKEN, not by the address, so deleting it deleted nothing
     and a pending reset link outlived the account. It cannot be reached from
     here at all, so authResetConfirm refuses a link older than the account it
     names instead. `resetcode:` CAN be reached - it is keyed by the address -
     and is a live credential, so it goes. */
  const loose = [`resetcode:${email}`, `active:${email}:${todayKey()}`,
                 `alog:${email}`, `alogfail:${email}`, `refmine:${email}`, `refpend:${email}`,
                 /* The funnel markers are a record that THIS person signed up,
                    got an answer, came back and paid. The aggregate counters
                    carry no identity and stay; these name someone, so erasure
                    means them too (AMV-101). */
                 `factive:${email}`,
                 /* An authenticator app being set up: its secret, sealed. */
                 `totpset:${email}`,
                 ...FUNNEL_STEPS.map(step => `fstep:${email}:${step}`)];
  if (myCode) loose.push(`refcode:${myCode}`);
  for (const id of myPasskeys) loose.push(`pkcred:${id}`);
  for (const raw of loose) {
    /* `resetcode:` in this list is a LIVE credential - the comment above says
       so - and the referral pair must go both ways or a code keeps resolving
       to an account that is gone. A delete that fails here is data surviving,
       so it is named rather than swallowed. */
    try { await env.AMV_KV.delete(raw); } catch { _eraseFailed('loose per-user keys'); }
  }

  /* Keys that carry the address inside a compound key rather than as the whole
     of it. Each one was missed because the loose list above can only name a key
     it can spell exactly, and these need a scan.

     `resume:` is a parked answer - the person's own model output, held server
     side so a dropped connection does not cost them a regeneration.
     `smsverify:` is a live verification code AND their phone number, in the
     key itself. `mktsess:` names them and the item they were part-way through
     buying, which is a record of what somebody was shopping for. All three are
     exactly what erasure is for. */
  for (const prefix of [`resume:${email}:`, `smsverify:${email}:`, `mktsess:${email}:`, `sess:${email}:`,
                        /* The throttle on this very endpoint. Confirming a deletion takes a
                           password, so it is rate limited like everything else that does -
                           and the counter keys carry the address. They expire on their own,
                           but "it will be gone tomorrow" is not what erasure means, and
                           there is nothing left to throttle once the account is gone. */
                        `rl:act:delacct:${email}:`, `ctr:actday:delacct:${email}:`]) {
    try {
      let cursor;
      do {
        const page = await env.AMV_KV.list({ prefix, cursor, limit: 1000 });
        for (const k of (page.keys || [])) { try { await env.AMV_KV.delete(k.name); deleted++; } catch { _eraseFailed('scanned per-user keys'); } }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
    } catch { _eraseFailed('scanned per-user keys'); }
  }

  /* The waitlist puts the address at the END of the key (waitlist:<product>:
     <email>), so there is no prefix that finds it - it takes a scan of the
     whole list. Erasure is rare and this is somebody asking not to be on a
     mailing list any more, which is the request it would be worst to ignore. */
  try {
    let cursor;
    const suffix = ':' + email;
    do {
      const page = await env.AMV_KV.list({ prefix: 'waitlist:', cursor, limit: 1000 });
      for (const k of (page.keys || [])) {
        if (k.name.endsWith(suffix)) { try { await env.AMV_KV.delete(k.name); deleted++; } catch { _eraseFailed('waitlist entries'); } }
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  } catch { _eraseFailed('waitlist entries'); }

  /* Lifetime usage totals live in the counter, not in KV, and are kept with
     no expiry - so they go explicitly, or they would outlive the account. */
  /* And what any team counted for them: the lifetime record says which. */
  try {
    const lr = await counter(env, `life:${email}`, { op: 'lifeGet' });
    const teams = (lr && lr.tally && Array.isArray(lr.tally.teams)) ? lr.tally.teams : [];
    let tid = null; try { tid = await env.AMV_KV.get(`userteam:${email}`); } catch (e) {}
    if (tid && teams.indexOf(tid) < 0) teams.push(tid);
    for (const t of teams) {
      const r = await counter(env, `tmuse:${t}:${email}`, { op: 'clear' });
      if (!(r && r.ok)) _eraseFailed('team usage totals');
    }
  } catch { _eraseFailed('team usage totals'); }
  try { const r = await counter(env, `life:${email}`, { op: 'clear' }); if (!(r && r.ok)) _eraseFailed('lifetime usage totals'); }
  catch { _eraseFailed('lifetime usage totals'); }

  // Revoke all tokens so existing sessions die immediately.
  await _revokeOrSay(env, email, 'account_deleted');

  /* What survived, said out loud in all three places it has to be said: to the
     person who asked, in AMV's own record, and to somebody who can go and
     finish it. The person leaving will not keep this reply - the audit line and
     the page are what exist afterwards. */
  if (eraseFailed.length) {
    audit(env, 'account_delete_incomplete', { email, keysRemoved: deleted, failed: eraseFailed.join(',') });
    try {
      await alertOnce(env, 'erase_incomplete:' + email,
        'AN ERASURE DID NOT COMPLETE. ' + email + ' asked to be deleted and these could not be removed: '
        + eraseFailed.join(', ') + '. Everything else went. This is a legal obligation that is now part done, '
        + 'and the person has been told it is incomplete - remove the rest by hand and confirm to them.', 60);
    } catch (e) {}
    return json({
      ok: false,
      incomplete: true,
      deleted: false,
      prefixesPurged: deleted,
      failed: eraseFailed,
      error: 'Some of your data could not be deleted (' + eraseFailed.join(', ') + '). '
           + 'Everything else has been removed and our team has been alerted to finish it. '
           + 'Contact support if you do not get confirmation.',
    }, 500);
  }
  audit(env, 'account_deleted', { email, keysRemoved: deleted });
  /* WHAT IS KEPT, AND WHY, SAID RATHER THAN LEFT TO BE DISCOVERED.

     Erasure takes the wallet and its transaction history with everything else.
     What it does NOT take is the payout ledger and the calendar-year totals -
     deliberately, because a record of money actually sent has to outlive the
     account under tax and anti-money-laundering rules, and both GDPR and the
     CCPA say so in the same breath as the right to erasure. Keeping them
     silently would be the wrong way to be right: somebody who asked to be
     deleted is entitled to know what survived and on what grounds.

     It is stated here whether or not this person was ever paid, because a
     reply that only appears for sellers tells the reader something about the
     account, and because the sentence is about AMV's policy rather than about
     them. */
  return json({ ok: true, deleted: true, prefixesPurged: deleted,
    retained: {
      what: 'Records of payouts actually sent to you, and the yearly totals built from them.',
      why: 'Tax and anti-money-laundering law require these to be kept for a set period, '
         + 'and the right to erasure does not override that. They hold what was paid and when. '
         + 'Nothing about what you sold, to whom, or anything you wrote.',
    },
  });
}

/* Pull all of a user's synced data (or just keys changed since `since`). */
