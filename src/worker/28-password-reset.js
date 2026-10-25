/* ==============================================================
   FORGOT PASSWORD - the flow people actually expect (the flow every product uses):
     1. Enter your email    -> POST /auth/reset/code
     2. Get a 6-digit code  -> emailed to you, valid 15 minutes
     3. Type the code       -> POST /auth/reset/verify -> one-time token
     4. Set a new password  -> POST /auth/reset/confirm

   A code beats a link because the email often opens on a different device
   from the one you're signing in on.
   ============================================================== */

const RESET_CODE_TTL      = 15 * 60;   // seconds
/* AND A CEILING ON THE SENDER, NOT ONLY ON THE RECIPIENT.

   Per-email is deliberate and stays: it is what stops one attacker locking
   every account out of password reset by exhausting a shared bucket. But the
   comment beside that limit also claimed it stopped somebody "burning through
   your email quota", and per-email cannot: a list of ten thousand real
   addresses is ten thousand separate buckets, each politely under its own cap,
   and every one of them sends. One source, ten thousand emails, no limit
   reached - inbox bombing at scale and an email bill to match, which is the
   thing the comment named and the code did not do.

   Generous on purpose. An office, a school or a mobile carrier is one address
   to us, and a reset somebody cannot complete is a support ticket on launch
   day - so this sits far above any honest shared-IP usage and far below the
   volume that makes bombing worth doing. */
const RESET_IP_MAX        = 60;        // reset requests per source address...
const RESET_IP_WINDOW_MS  = 60 * 60e3; // ...per hour
const RESET_RL_MAX        = 5;         // reset codes per email...
const RESET_RL_WINDOW_MS  = 60 * 60e3; // ...per hour
const RESET_CODE_ATTEMPTS = 5;         // wrong guesses before the code dies

function _sixDigitCode() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(100000 + (a[0] % 900000));
}

/* STEP 1 - send the code. */
async function authResetCode(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) return json({ error: 'Enter a valid email address.' }, 400);

  const emailConfigured = !!env.EMAIL_API_KEY;

  /* Rate limit. Without this, anyone can hammer this endpoint and bomb a real
     person's inbox with reset codes, or burn through your email quota. Limited
     per-email, so one attacker can't lock out everyone. */
  /* THE LIMIT THAT A BURST WALKED THROUGH.

     Read the count, compare it, write it back. Fifty requests arriving together
     all read the same count, all decide they are under it, and all send - which
     is the inbox bombing this limit exists to prevent, and the email bill with
     it. The OTHER reset route, four hundred lines down, already uses the atomic
     reserve for exactly this, with a comment saying why. One of the two copies
     got the fix.

     Reserved atomically now, in a fixed hour bucket rather than a window
     starting at the first request. The difference is that a burst can straddle
     a boundary and get two buckets' worth in a short span; that is the standard
     trade for an operation that cannot race, and it is a far smaller hole than
     the one it replaces. */
  /* THE SOURCE FIRST, THEN THE RECIPIENT.

     Order matters and it is not cosmetic. Reserving the victim's bucket before
     checking the sender lets somebody who is already over their own ceiling
     still burn down the five resets a real person gets in that hour - locking
     them out of the route with a request that was never going to send anything
     anyway. Checking the source first means a blocked sender consumes nothing
     belonging to anybody else. */
  const ipKey = (await _ipHash(env, request))
             || request.headers.get('CF-Connecting-IP')
             || _rlIp(request);
  const ipBucket = Math.floor(Date.now() / RESET_IP_WINDOW_MS);
  const ipRl = await counter(env, `resetip:${ipKey}:${ipBucket}`,
                             { op: 'reserve', amount: 1, cap: RESET_IP_MAX, ttlMs: RESET_IP_WINDOW_MS * 2 });
  if (!ipRl.allowed) {
    /* Answered exactly like the per-email refusal: 200, ok:true, nothing about
       whether this address is registered. A different shape here would turn the
       new limit into the account-enumeration oracle the old one avoids. */
    audit(env, ipRl.unavailable ? 'reset_limit_unavailable' : 'reset_ip_rate_limited', { ip: ipKey });
    return json({ ok: true, sent: false, emailConfigured,
                  rateLimited: !ipRl.unavailable, unavailable: !!ipRl.unavailable });
  }

  const rlBucket = Math.floor(Date.now() / RESET_RL_WINDOW_MS);
  const rl = await counter(env, `resetcode:${email}:${rlBucket}`,
                           { op: 'reserve', amount: 1, cap: RESET_RL_MAX, ttlMs: RESET_RL_WINDOW_MS * 2 });
  if (!rl.allowed) {
    // Still 200 + ok:true - never reveal whether this address is registered.
    audit(env, rl.unavailable ? 'reset_limit_unavailable' : 'reset_rate_limited', { email });
    return json({ ok: true, sent: false, emailConfigured,
                  rateLimited: !rl.unavailable, unavailable: !!rl.unavailable });
  }

  const acct = await DB.get(env, 'acct', email);

  let delivered = false;
  if (acct && emailConfigured) {
    const code = _sixDigitCode();
    await env.AMV_KV.put('resetcode:' + email,
      JSON.stringify({ code, attempts: 0, at: Date.now() }),
      { expirationTtl: RESET_CODE_TTL });
    try { delivered = await sendResetCodeEmail(env, email, code, _emailLang(request)); } catch (e) { delivered = false; }
    if (!delivered) {
      /* The one thing the caller is no longer told, said loudly to the person
         who can fix it. A provider outage now looks identical to a stranger's
         address from the outside, so without this it would look like nothing
         at all from the inside too. */
      audit(env, 'reset_delivery_failed', { email });
      try { await alertOnce(env, 'reset_delivery',
        'Password reset codes are not being delivered - the email provider refused or did not answer. '
        + 'Nobody can reset a password until this is fixed, and the reset screen cannot say so, '
        + 'because saying so would tell strangers which addresses have accounts.', 30); } catch (e) {}
    }
  }

  /* AMV-026: THE ANSWER DEPENDS ON THE DEPLOYMENT, NEVER ON THE ADDRESS.

     This already refused to say whether the account exists - and then said it
     anyway through `sent`, which was true only when the address was registered.
     With email configured, `sent:false` meant "no account here", which is the
     same enumeration one field along from where it was being guarded against.

     So `sent` now reports whether AMV can send reset codes AT ALL, which is a
     fact about this deployment and identical for every address. `emailConfigured`
     stays, because the app must be able to say "email is not set up on this
     deployment" rather than "check your inbox" when nothing could ever arrive -
     and that is a property of the server, not of the person asking. */
  return json({ ok: true, sent: emailConfigured, emailConfigured });
}

/* STEP 2 - verify the code, hand back a one-time token. */
async function authResetVerify(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').toLowerCase().trim();
  const code = String(body.code || '').replace(/\D/g, '');
  if (!email || !code) return json({ error: 'Enter the 6-digit code.' }, 400);

  /* AMV-018: A FIVE-ATTEMPT LIMIT THAT COUNTED FIVE PER ROUND TRIP.

     This read the record, compared the code, incremented the counter and wrote
     it back - four steps with three gaps. Guesses arriving together all read
     `attempts` at the same number, all decide they are under the limit, and all
     write the same increment back. The cap does not bound the number of
     guesses, it bounds the number of SEQUENTIAL guesses, and nothing stops
     somebody sending a thousand at once.

     A six-digit code is a million possibilities. Five tries makes that safe;
     unlimited parallel tries makes it a few minutes of traffic, against
     whatever address the attacker names.

     The correct code has the same shape. Two submissions of a real code both
     read it, both delete it, and both mint a reset token - two live
     single-use tokens for one use.

     All of it now happens inside the record lock, where the value cannot change
     between reading it and acting on it. The record is marked used rather than
     deleted in place, because the lock's writer saves whatever load returned;
     the delete after it is cleanup, and a second attempt that gets in first
     sees `used` and is refused. */
  let verdict;
  try {
    verdict = await _withKV(env, 'resetcode', email, (rec) => {
      if (!rec || !rec.code || rec.used) return { gone: true };
      if ((+rec.attempts || 0) >= RESET_CODE_ATTEMPTS) return { exhausted: true };
      if (rec.code !== code) {
        rec.attempts = (+rec.attempts || 0) + 1;
        return { wrong: true, left: RESET_CODE_ATTEMPTS - rec.attempts };
      }
      rec.used = true;                   // consumed, once, under the lock
      return { ok: true };
    }, null);
  } catch (e) {
    /* The store could not be read, so nothing is known about this code. Letting
       it through would be a free attempt; counting it would let a storage fault
       burn somebody's tries. Neither, and say so. */
    if (_isBusy(e)) return json({ error: 'That is being checked already. Try again in a moment.' }, 409);
    audit(env, 'reset_code_unreadable', { email });
    return json({ error: 'AMV could not check that code just now. Please try again in a moment.' }, 503);
  }

  if (!verdict || verdict.gone) return json({ error: 'That code has expired. Request a new one.' }, 400);
  if (verdict.exhausted) {
    await env.AMV_KV.delete('resetcode:' + email);
    return json({ error: 'Too many incorrect attempts. Request a new code.' }, 429);
  }
  if (verdict.wrong) {
    const left = verdict.left;
    audit(env, 'reset_code_bad', { email });
    return json({
      error: left > 0
        ? 'That code isn\u2019t right. ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left.'
        : 'Too many incorrect attempts. Request a new code.'
    }, 400);
  }

  // correct - burn the code, issue a single-use token for the final step
  await env.AMV_KV.delete('resetcode:' + email);
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await env.AMV_KV.put('reset:' + token, JSON.stringify({ email, at: Date.now() }), { expirationTtl: RESET_CODE_TTL });
  audit(env, 'reset_code_ok', { email });
  return json({ ok: true, token });
}

async function sendResetCodeEmail(env, to, code, lang) {
  const L = lang || 'en';
  const bigCode =
    '<div dir="ltr" style="margin:0 0 22px;padding:18px;background:#f6f7f9;border:1px solid #e6e8ec;border-radius:12px;text-align:center">' +
      '<span style="font-family:ui-monospace,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:9px;color:#111">' + code + '</span>' +
    '</div>';
  return _sendEmail_security(env, to, _ew(L, 'reset.subject'),
    _emailShell(_ew(L, 'reset.title'),
      '<p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#555">' + _escHtml(_ew(L, 'reset.line')) + '</p>' + bigCode,
      null,
      '<hr style="border:none;border-top:1px solid #eee;margin:0 0 18px"><p style="margin:0;font-size:12px;line-height:1.6;color:#999">' + _escHtml(_ew(L, 'reset.ignore')) + '</p>',
      _ew(L, 'reset.footnote'), L),
    _ew(L, 'reset.subject') + ': ' + code +
    '\n\n' + _ew(L, 'reset.line') +
    '\n\n' + _ew(L, 'reset.ignore') + '\n\n- AMV');
}

/* Owner escape hatch: set a password directly with the ADMIN_TOKEN.

   You hold the ADMIN_TOKEN (it's a Worker secret). If the email provider is
   down, misconfigured, or you're just locked out of your own product, this
   gets you back in without weakening anything for anyone else.

   Requires the admin secret. Rate-limited by the fact that a wrong token is
   simply rejected, and the token never leaves your machine. */
async function authAdminReset(request, env){
  const body = await request.json().catch(()=>({}));
  { const g = await _adminGate(request, env, 'auth.reset', 60, 2000); if (g) return g; }

  const email = String(body.email||'').toLowerCase().trim();
  const password = String(body.password||'');
  if(!email || !email.includes('@')) return json({ error:'valid email required' }, 400);
  { const bad = _passwordTooLong(password); if(bad) return json(bad, 400); }
  /* The address is in hand here, so the account's own email cannot be set as
     its password. An operator resetting somebody's account to their own
     address - which is the obvious thing to type - hands the next person who
     knows that address the account. */
  if(_passwordIsPersonal(password, email, ''))
    return json({ error:'That password is the account\u2019s own email address, which is the first thing anybody would try. Please choose another.',
                  code:'password_is_personal' }, 400);

  const acct = await DB.get(env, 'acct', email);
  if(!acct) return json({ error:'No account with that email.' }, 404);
  { const bad = _passwordProblem(password, acct); if(bad) return json(bad, 400); }

  const salt = crypto.randomUUID().replace(/-/g,'');
  const newHash = await _hashPassword(password, salt, PBKDF2_ITERATIONS);
  /* Under the record lock, for the same reason as the self-serve reset: the
     hashing above is slow enough for another write to land, and the loser of
     that race is a credential. */
  try{
    await _withAcct(env, email, (a) => {
      if(!a) return;
      a.pwHash = newHash; a.salt = salt; a.pwIter = PBKDF2_ITERATIONS;
      a.pwResetAt = Date.now();
    });
  }catch(e){
    audit(env, 'password_reset_admin_blocked', { email });
    return json({ error:'Something else was changing that account just now, so the password was not changed. Try again in a moment.', code:'acct_busy' }, 503);
  }
  const _revoked = await _revokeOrSay(env, email, 'password_reset_admin');
  audit(env, 'password_reset_admin', { email, sessionsRevoked: _revoked });
  return json({ ok:true, sessionsRevoked: _revoked,
    note: _revoked ? undefined : 'The password was changed, but existing sessions could not be signed out. Sign out everywhere again once storage recovers.' });
}

/* Is password reset actually usable? The app asks this so it can tell the
   truth instead of saying "check your inbox" when nothing can be sent. */
async function authResetStatus(request, env){
  return json({ ok:true, emailConfigured: !!env.EMAIL_API_KEY, usingDefaultSender: !env.RESET_EMAIL_FROM });
}

/* ══════════════════════════════════════════════════════════════
   THE RESET PAGE.

   The reset email links to <worker>/reset?token=... - but that route did not
   exist, so the link 404'd. The whole "forgot password" flow was dead end to
   end: no email could send (no provider configured), and even if it had, the
   link went nowhere.

   This serves a self-contained page that sets the new password. It's plain
   HTML with no dependencies so it works no matter where the app is hosted.
   ══════════════════════════════════════════════════════════════ */
function resetPage(request, env){
  const url = new URL(request.url);
  const token = (url.searchParams.get('token') || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 128);
  const appUrl = (env.APP_URL || env.APP_ORIGIN || '').replace(/\/$/, '');

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reset your AMV password</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;
       background:#0d1117;color:#e6edf3}
  .card{width:100%;max-width:400px;background:#161b22;border:1px solid #30363d;
        border-radius:16px;padding:32px}
  h1{font-size:21px;font-weight:650;margin-bottom:6px}
  p.sub{font-size:14px;color:#8b949e;line-height:1.6;margin-bottom:22px}
  label{display:block;font-size:12px;font-weight:600;color:#8b949e;
        text-transform:uppercase;letter-spacing:.04em;margin-bottom:7px}
  input{width:100%;padding:12px 14px;border-radius:9px;border:1px solid #30363d;
        background:#0d1117;color:#e6edf3;font-size:15px;outline:none;margin-bottom:16px}
  input:focus{border-color:#4c8dff;box-shadow:0 0 0 3px rgba(76,141,255,.15)}
  button{width:100%;padding:12px;border:none;border-radius:9px;background:#4c8dff;
         color:#fff;font-size:15px;font-weight:600;cursor:pointer}
  button:hover{filter:brightness(1.08)}
  button:disabled{opacity:.6;cursor:default}
  .msg{padding:11px 13px;border-radius:9px;font-size:13.5px;line-height:1.5;
       margin-bottom:16px;display:none}
  .msg.err{display:block;background:rgba(248,81,73,.12);color:#f85149;
           border:1px solid rgba(248,81,73,.3)}
  .msg.ok{display:block;background:rgba(63,185,80,.12);color:#3fb950;
          border:1px solid rgba(63,185,80,.3)}
  a{color:#4c8dff;text-decoration:none;font-size:13.5px}
  .foot{text-align:center;margin-top:18px}
</style></head>
<body>
  <div class="card">
    <h1>Set a new password</h1>
    <p class="sub">Choose a new password for your AMV account. This link can only be used once.</p>
    <div id="msg" class="msg"></div>
    <div id="form">
      <label for="pw">New password</label>
      <input id="pw" type="password" placeholder="At least 8 characters" autocomplete="new-password">
      <label for="pw2">Confirm password</label>
      <input id="pw2" type="password" placeholder="Type it again" autocomplete="new-password">
      <button id="go">Set new password</button>
    </div>
    <div class="foot"><a href="${appUrl || '/'}">Back to AMV</a></div>
  </div>
<script>
  var TOKEN = ${JSON.stringify(token)};
  var APP   = ${JSON.stringify(appUrl)};
  var msg = document.getElementById('msg');
  var form = document.getElementById('form');
  var btn = document.getElementById('go');

  function show(text, kind){ msg.textContent = text; msg.className = 'msg ' + kind; }

  if (!TOKEN) { show('This reset link is missing its token. Request a new one from the app.', 'err'); form.style.display='none'; }

  btn.addEventListener('click', async function(){
    var pw = document.getElementById('pw').value;
    var pw2 = document.getElementById('pw2').value;
    if (pw.length < 8) { show('Password must be at least 8 characters.', 'err'); return; }
    if (pw !== pw2)    { show('Those passwords do not match.', 'err'); return; }
    btn.disabled = true; btn.textContent = 'Setting\u2026';
    try {
      /* Relative to this page, so it reaches the server whether the page was
         opened on the server's own host (/reset) or through the site (/api/reset). */
      var r = await fetch('./auth/reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: TOKEN, password: pw })
      });
      var d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'Could not reset the password.');
      form.style.display = 'none';
      show('Password updated. You can sign in with your new password now.', 'ok');
      if (APP) setTimeout(function(){ location.href = APP; }, 2200);
    } catch (e) {
      show(e.message, 'err');
      btn.disabled = false; btn.textContent = 'Set new password';
    }
  });
</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

