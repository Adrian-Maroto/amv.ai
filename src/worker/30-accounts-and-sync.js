/* ============================================================
   SERVER-SIDE ACCOUNTS + DATA SYNC
   Accounts (with hashed passwords) and per-user data (chats, memory,
   settings, workspaces) live in KV, so users keep everything across
   devices. Passwords are salted+hashed with PBKDF2-SHA256 at the OWASP-2023
   iteration count. The iteration count is stored ON the account record, so we
   can raise it over time and verify old logins at their original count, then
   transparently re-hash on next successful login - no lockouts.
   (Argon2id would be preferable but isn't available in the Workers runtime.)
   ============================================================ */
/* WHAT THE PLATFORM WILL ACTUALLY DO, WHICH IS NOT WHAT OWASP ASKS FOR.

   This was 210000, citing OWASP's 2023 recommendation for PBKDF2-SHA256. The
   Workers runtime refuses it:

     NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
     supported (requested 210000).

   So _hashPassword threw on every single call, and since every sign-up hashes a
   password, NOBODY COULD CREATE AN ACCOUNT on a deployed AMV. Not a rare path,
   not a race - the first thing the first user does, failing for everybody, from
   the first deployment. It surfaced as the generic 500 because that is what the
   top-level catch is for.

   100000 is the platform maximum, so this is not a tuning choice; it is the
   ceiling. Be honest about what that costs: it is a sixth of OWASP's 600000 for
   this algorithm, which means an offline attacker with a stolen hash does a
   sixth of the work. What stands in front of that is unchanged - the hash is
   salted per account, the store is not public, and every route that hashes is
   rate limited per source precisely because hashing is the expensive thing here.

   It can be raised later without a migration and without anybody losing an
   account: every record stores its own `pwIter` and verification uses the
   stored value, so new accounts can move to a higher factor the moment the
   platform allows one, and old ones keep verifying at theirs.

   Chaining several sub-100000 rounds to reach 210000 would preserve the work
   factor and was deliberately not done: it triples the CPU of the most
   expensive operation in the Worker, on a free plan with a hard CPU ceiling
   per request, and a sign-up killed for CPU looks exactly like this bug did. */
const PBKDF2_MAX_ITERATIONS = 100000;   // hard limit in the Workers runtime
const PBKDF2_ITERATIONS = 100000;       // == the cap; see above before raising
// AMV-051: reject the most common / trivially-weak passwords at signup.
const _COMMON_PASSWORDS = new Set(['password','12345678','123456789','1234567890','qwerty123','password1','password123','iloveyou','admin123','welcome1','letmein1','abc12345','11111111','qwertyuiop','1q2w3e4r','sunshine1','football1','baseball1','trustno1','superman1']);

/* THE WORD PEOPLE PUT A NUMBER AFTER.

   A list of exact strings catches exactly the strings on it, and the way these
   passwords are actually chosen is a word plus a year, a word plus "1", a word
   plus "!". `monkey` is on every breach list ever published and `monkey2024`
   is on none of them, while being just as guessable - the attacker's wordlist
   has the same suffix rule this does.

   So the BASE is listed and the decoration is described. Kept to words that
   are GUESSED rather than words that are weak: a base list long enough to
   catch a real passphrase would be a list that refuses good passwords, and a
   password rule people fight is a password rule people defeat with a sticky
   note. */
const _COMMON_BASES = new Set([
  'password','passwort','contrasena','motdepasse','senha','wachtwoord',
  'welcome','letmein','changeme','default','qwerty','azerty','monkey','dragon',
  'master','shadow','sunshine','princess','football','baseball','basketball',
  'soccer','superman','batman','spiderman','starwars','pokemon','minecraft',
  'fortnite','liverpool','arsenal','chelsea','barcelona','juventus','computer',
  'internet','samsung','iphone','android','google','facebook','whatsapp',
  'michael','jennifer','jessica','charlie','daniel','thomas','matthew','joshua',
  'ashley','nicole','amanda','anthony','andrew','robert','william','richard',
  'hunter','killer','ginger','chocolate','freedom','whatever','secret','trustno',
  'iloveyou','admin','administrator','root','guest','test','demo','temp',
  'amv','amvai',
]);

/* Rows of a keyboard, forwards. Reversed and case-folded where they are used,
   so `mnbvcxz` and `POIUYTREWQ` are the same walk as `zxcvbnm` and `qwerty`. */
const _KEY_WALKS = ['qwertyuiop','asdfghjkl','zxcvbnm','azertyuiop','qwertzuiop',
                    '1234567890','1qaz2wsx','2wsx3edc','qazwsxedc','1q2w3e4r5t'];

function _isCommonPassword(pw){
  const p = String(pw||'').toLowerCase();
  if(!p) return false;
  if(_COMMON_PASSWORDS.has(p)) return true;
  if(/^(.)\1+$/.test(p)) return true;                       // all one repeated character
  if(/^(01234567|12345678|abcdefgh|87654321)/.test(p)) return true;   // obvious sequences

  /* A run along a keyboard row, either direction, long enough to be the whole
     idea rather than a coincidence inside a real password. */
  const flat = p.replace(/[^a-z0-9]/g, '');
  if(flat.length >= 6){
    for(const row of _KEY_WALKS){
      const back = row.split('').reverse().join('');
      if(row.indexOf(flat) >= 0 || back.indexOf(flat) >= 0) return true;
    }
  }

  /* A listed word wearing a hat.

     THE DECORATION COMES OFF FIRST, AND THAT ORDER IS THE WHOLE TRICK. The
     first version undid the letter-for-digit swaps before stripping, which
     turned `monkey2024` into `monkey2o2a` - the trailing year was read as part
     of the word and the word stopped being one. Strip first and it is `monkey`
     again; the swaps then apply to the word alone, so `p4ssw0rd!` loses the
     bang, becomes `p4ssw0rd`, and unleets to `password`. Leet digits live
     INSIDE a word, decoration lives outside it, which is what lets one pass
     remove the second without eating the first.

     Only the decoration. A base word buried inside a longer phrase is left
     alone, or "correct horse battery staple" would be refused for containing
     "horse" - and a rule that refuses good passwords is a rule people defeat
     with a sticky note. The spaces are what save it: stripping only touches
     the ends, so the core is still the whole phrase and matches nothing. */
  const bare = p.replace(/^[^a-z]+/,'').replace(/[^a-z]+$/,'');
  /* ONE CHECK, BECAUSE THE SECOND ONE WAS THE FIRST ONE.

     This read the stripped word, and then read it again unleeted. Deleting the
     first line changed nothing any test could see - and that is not a missing
     test, it is arithmetic: every base word is plain letters, and unleeting a
     plain-letter word returns it unchanged. The first check could only ever
     match when the second one would too.

     Left in, it would read as two rules and carry the weight of two, while one
     of them can never be the reason anything is refused. A dead line in a
     password check is worse than a missing one: it is coverage somebody counts
     on that is actually coming from somewhere else. */
  const unleet = bare.replace(/[@4]/g,'a').replace(/3/g,'e').replace(/[1!|]/g,'i')
                     .replace(/0/g,'o').replace(/[$5]/g,'s').replace(/7/g,'t');
  if(unleet && _COMMON_BASES.has(unleet)) return true;
  return false;
}

/* THE PASSWORD THAT IS THE ACCOUNT ITSELF.

   Somebody's own email, the part in front of the @, or their own name. It
   survives every rule above - `jessicamorgan` is nobody's idea of a common
   password - and it is the first thing tried by anyone holding the address,
   which by definition is whoever is attacking the account.

   Separate from _isCommonPassword because it has to know WHO, and the routes
   learn that at different moments. Compared on letters and digits only, so
   `Jessica.Morgan` and `jessicamorgan99` are both caught. */
function _passwordIsPersonal(password, email, name){
  const flat = (v) => String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const p = flat(password);
  if(p.length < 3) return false;
  const em = String(email||'').toLowerCase().trim();
  for(const c of [flat(em), flat(em.split('@')[0]), flat(name)]){
    if(c.length < 3) continue;
    /* Equal, or that string with a little tacked on. Not "contains", which
       would refuse a long passphrase that happens to include a short name. */
    if(p === c) return true;
    if(p.length <= c.length + 4 && p.indexOf(c) === 0) return true;
  }
  return false;
}
/* AMV-SP-10: A PASSWORD IS A SECRET, NOT A WORKLOAD.

   PBKDF2 is deliberately expensive, and its cost is per BYTE of what it hashes
   as well as per iteration. Signup capped the length at 512 and login capped it
   at nothing at all, so a sign-in attempt could carry a ten megabyte "password"
   and the server would faithfully run six hundred thousand rounds of SHA-256
   over it before deciding it was wrong. That is a request that costs the
   operator seconds of CPU and the sender nothing, on an endpoint that has to be
   open to the world by definition, and the per-email throttle does not help:
   the attacker picks the email.

   One bound, checked before any key derivation anywhere, so a new password
   route cannot be written without it. 512 bytes is far past any real
   passphrase and far short of a weapon. */
const PASSWORD_MAX = 512;
const PASSWORD_MIN = 8;
function _passwordTooLong(password){
  if(String(password == null ? '' : password).length <= PASSWORD_MAX) return null;
  return { error:'That password is longer than ' + PASSWORD_MAX + ' characters, which AMV does not accept. Use a shorter one - length past this point adds nothing.',
           code:'password_too_long' };
}
/* The MAXIMUM is about the server and applies everywhere a password is read.
   The MINIMUM is about the password and applies only where one is being SET -
   enforcing it at sign-in would lock out any account whose password predates
   the rule, which is a rule change turning into an outage for the people least
   able to explain it. */
/* ONE GATE, AND IT IS THE ONE EVERY SET PATH ALREADY CALLS.

   The common-password check used to live in authSignup and only there, as two
   lines of its own. Two other routes set a password - the self-serve reset and
   the admin reset - and both called this function for the length and stopped.
   So a password AMV refused at signup could be set from the reset link, which
   is the easier door to reach: it needs an email you can receive, not an
   account you already have.

   Folding it in here rather than repeating it three times is the whole point.
   Every set path calls this because it has to bound the length before hashing,
   so the strength rules now arrive with it - and the fourth route somebody
   writes gets them without knowing they exist. Same reasoning as PASSWORD_MAX
   above: a rule that has to be remembered is a rule that gets missed.

   Renamed with it, because a name promising one check on a function doing
   three is how the next person reads past it. */
function _passwordProblem(password){
  const tooLong = _passwordTooLong(password);
  if(tooLong) return tooLong;
  if(String(password == null ? '' : password).length < PASSWORD_MIN)
    return { error:'Password must be at least ' + PASSWORD_MIN + ' characters.', code:'password_too_short' };
  if(_isCommonPassword(password))
    return { error:'That password is one of the most commonly guessed ones, so it would not protect the account. Please choose another.',
             code:'password_too_common' };
  return null;
}

async function _hashPassword(password, salt, iterations){
  /* The last line of defence, at the one place every route funnels through. A
     caller that skipped the check above does not get to spend the CPU anyway. */
  if(String(password == null ? '' : password).length > PASSWORD_MAX){
    const e = new Error('password too long');
    e.code = 'password_too_long';
    throw e;
  }
  const enc = new TextEncoder();
  /* Clamped rather than trusted. `iterations` arrives from a stored record for
     verification, and a record written by a future deployment - or edited -
     could name a count this runtime refuses. Throwing there would lock somebody
     out of their own account with a 500; clamping verifies at the highest count
     the platform will run, which for any record written by THIS code is the
     count it was hashed at. */
  const want = iterations || PBKDF2_ITERATIONS;
  const rounds = Math.min(want, PBKDF2_MAX_ITERATIONS);
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', salt: enc.encode(salt), iterations: rounds, hash:'SHA-256' }, keyMaterial, 256);
  return [...new Uint8Array(bits)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
/* Verify a Cloudflare Turnstile token. Returns true if:
   - Turnstile isn't configured yet (TURNSTILE_SECRET unset) - we don't block
     real users before you've set it up; the honeypot + rate limits still apply.
   - OR Turnstile is only HALF set up (secret without site key), because no
     browser on earth can produce a token in that state - see below.
   - OR the token validates against Cloudflare.
   Returns false only when Turnstile IS fully configured and the token is
   missing or invalid.

   The half-configured case is the one that mattered. The site key is what
   renders the widget; the secret is what checks its answer. Setting only the
   secret - which the go-live checklist invited, calling Turnstile "optional,
   add anytime" - meant every sign-up and every sign-in on the entire site
   started answering "Please complete the verification" about a checkbox that
   was not on the screen and could not be. It reads as a user problem and is
   entirely a configuration one, so it is allowed through and shouted about
   instead: a silent security downgrade is its own failure. */
async function _verifyCaptcha(env, token, request){
  if (!env.TURNSTILE_SECRET) {
    /* NOT SET UP. Allowed - demanding a token when no widget exists would
       refuse every sign-up on a fresh deployment, which is the opposite of
       honest degradation. The honeypot and the per-address rate limit still
       apply, and free-tier spend is bounded by its share of the day's ceiling,
       so this is a bounded gap rather than an open door.

       What was missing is that it happened in SILENCE. The half-configured
       case one line down audits and pages; the fully-unset case - which is the
       DEFAULT, and therefore the state AMV is most likely to be in on the day
       it has real users - produced no evidence anywhere that a security
       control had been skipped. If AMV is ever flooded with bot signups, the
       logs need to say that the thing which would have stopped them was not
       switched on. Alerted once a day, not once a signup. */
    audit(env, 'captcha_skipped', { why: 'TURNSTILE_SECRET not set' });
    try { await alertOnce(env, 'turnstile_unset',
      'Turnstile is not configured, so sign-up and sign-in have no captcha. Only the honeypot and the '
      + 'per-address rate limit stand in front of account creation, and every account carries a free '
      + 'allowance and a scheduled job. Set TURNSTILE_SITE_KEY and TURNSTILE_SECRET.', 60 * 24); } catch (e) {}
    return true;
  }
  if (!env.TURNSTILE_SITE_KEY) {
    /* Half-configured. The browser cannot possibly have produced a token, so
       blocking everybody would be self-inflicted. Allowed, and shouted about,
       because a silent security downgrade is its own failure. */
    audit(env, 'captcha_misconfigured', { why: 'TURNSTILE_SECRET set without TURNSTILE_SITE_KEY' });
    try { await alertOnce(env, 'turnstile_halfset',
      'Turnstile is half-configured: TURNSTILE_SECRET is set but TURNSTILE_SITE_KEY is not, so no browser can produce a token. Captcha is being SKIPPED. Set TURNSTILE_SITE_KEY to switch it on.'); } catch (e) {}
    return true;
  }
  if (!token) return false;
  try{
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const form = new URLSearchParams();
    form.set('secret', env.TURNSTILE_SECRET);
    form.set('response', String(token));
    if (ip) form.set('remoteip', ip);
    const r = await fetchDeadline('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: form.toString()
    });
    const d = await r.json().catch(()=>({}));
    return !!d.success;
  }catch(e){ return false; }   // fail closed when configured but verification errors
}

async function authSignup(request, env){
  const body = await request.json().catch(()=>({}));
  const { email, name, password } = body;
  // Bot protection. Two layers:
  //  1. Honeypot: a hidden form field bots tend to fill. Works with zero config.
  //  2. Turnstile (Cloudflare's free CAPTCHA): verified when TURNSTILE_SECRET is
  //     set. Until you configure it, we rely on the honeypot + rate limits.
  if (body.company || body.website) { audit(env,'bot_blocked',{where:'signup_honeypot'}); return json({ error:'signup failed' }, 400); }
  /* AMV-191: THIS WAS THE ONE AUTH ROUTE WITH NO CEILING.
     Login and password reset were both bounded; creating an account - the thing
     that makes something which then SPENDS - was not. The comment above claims
     "we rely on the honeypot + rate limits" and only the honeypot existed. The
     captcha does not cover it either: _verifyCaptcha returns true when
     TURNSTILE_SECRET is unset, which is the default.

     An account is not free. Each one carries a real monthly token allowance and
     a weekly autonomous job that runs on a timer, so unlimited sign-ups is
     unlimited spend on AMV's card - and a funnel whose numbers stop describing
     people.

     Keyed per address, generous enough for a household or an office. _ipHash
     returns '' when there is nothing to hash, and keyed on THAT every
     unidentifiable caller would share one bucket - five sign-ups a minute for
     the whole internet, a denial of service written by the person adding the
     rate limit. So it falls back to the address, then to a named bucket. */
  const sIp = (await _ipHash(env, request)) || _rlIp(request);
  const sBlock = await guardAction(env, `signup:${sIp}`, 5, 40, 'sign-ups');
  if (sBlock) return sBlock;
  const capOk = await _verifyCaptcha(env, body.captchaToken, request);
  if (!capOk) return json({ error:'Please complete the verification and try again.', code:'captcha_required' }, 400);
  const em = String(email||'').toLowerCase().trim();
  // Strict format: exactly one @, no whitespace/colons/control chars, sane length.
  // Emails go into KV key structures and audit logs - keep them clean by construction.
  if(!em || em.length > 254 || !/^[^\s@:]{1,64}@[^\s@:]+\.[^\s@:]{2,}$/.test(em)) return json({ error:'valid email required' }, 400);
  { const sso = await _ssoRequiredFor(env, em); if(sso) return _ssoRequiredJson(sso); }
  // AMV-051: raise the password baseline - 8+ chars and reject the most common
  // passwords so a leaked hash has meaningfully more offline resistance.
  /* Length, commonness and every other strength rule arrive together from the
     one gate now - the separate common-password line that used to sit here is
     exactly why the two reset routes did not have one. */
  { const bad = _passwordProblem(password); if(bad) return json(bad, 400); }
  if(_passwordIsPersonal(password, em, name))
    return json({ error:'That password is your own email address or name, which is the first thing anybody holding your address would try. Please choose another.',
                  code:'password_is_personal' }, 400);
  const safeName = String(name||'').slice(0, 80);
  const salt = crypto.randomUUID();
  const pwHash = await _hashPassword(password, salt, PBKDF2_ITERATIONS);
  /* AMV-075: a keyed hash of the signup network, never the address itself. It
     exists for exactly one comparison - "did the inviter and the invited sign up
     from the same place" - and cannot be reversed back into an IP. */
  const sipHash = await _ipHash(env, request);

  /* AMV-017: TWO PEOPLE CANNOT BOTH CREATE THE SAME ACCOUNT.

     This read the account, found nothing, and wrote one - a check followed by a
     decision, with everything the hash costs sitting in the gap. Two signups
     for the same address arriving together both read nothing, both write, and
     the last one wins. Both callers are then handed a valid session for one
     account whose password is the SECOND person's: whoever signed up first has
     a working session on an account somebody else controls, and neither of them
     is told anything is wrong.

     It does not need an attacker. A double-submitted form on a slow connection
     is the ordinary way to produce it, and the PBKDF2 hash above widens the
     window to something a human can hit.

     Decided inside the record lock, where the answer cannot change between
     reading it and acting on it. The mutate returns whether it created the
     account, so the caller can answer honestly without a second read. */
  const acct = { email: em, name: safeName, provider:'email', salt, pwHash, pwIter: PBKDF2_ITERATIONS, createdAt: Date.now(), sipHash };
  /* AMV-031: a record that will not parse is not an address nobody has taken.
     Asked before the lock, because the answer decides whether this is a
     creation at all - and being handed null for a corrupt account record would
     let anybody who knows the address sign up over it with a new password. */
  try {
    await DB.getStrict(env, 'acct', em);
  } catch (e) {
    audit(env, 'signup_blocked_unreadable', { email: em });
    return json({ error: 'AMV could not check that address just now. Please try again in a few minutes.',
                  code: 'account_unreadable' }, 503);
  }
  let created = false, unconfirmed = false;
  await _withKind(env, 'acct', em, (rec) => {
    if (rec && rec.email) {                          // somebody already has it
      unconfirmed = (rec.provider || 'email') === 'email' && !rec.emailVerifiedAt;
      return;
    }
    Object.assign(rec, acct);                        // written by the lock, in place
    created = true;
  }, {});
  if (!created) {
    /* AN ADDRESS NOBODY HAS PROVED IS NOT YET ANYBODY'S.

       The account is written before the code is entered, so signing up with
       somebody else's address and never entering the code left an account in
       their name with the squatter's password - and the real owner, signing up
       later, was told it already existed. Signing up again on an account nobody
       has confirmed now sends the address a code; the new password waits in the
       challenge and is written only when the code comes back, which only the
       inbox can do. A confirmed account is never touched here, and where no
       code can be sent nothing changes hands at all. */
    if (unconfirmed && _codesOn(env)) {
      const pending = { salt, pwHash, pwIter: PBKDF2_ITERATIONS, sipHash, name: safeName };
      const c = await _startSignInCode(env, request, em, safeName, 'claim', pending);
      if (c) return c;
    }
    return json({ error:'account exists' }, 409);
  }
  /* THE DENOMINATOR. Conversion was computed against the number of ENTITLEMENT
     rows, and a free signup never creates one - so the denominator was, near
     enough, "people who have already paid" and the dashboard reported ~100%
     conversion for ever. Measured on a fixture of twenty free accounts and one
     payer it read 100% against a true 4.8%.

     Counted here, at the one place an account comes into existence, so it is
     exact at any size and costs one increment. */
  try{ await counter(env, 'popaccounts', { op: 'incr', amount: 1 }); }catch(e){}
  /* `em`, not `email`. The raw body value is whatever was typed - case and
     surrounding whitespace included - and every other record this account
     touches is keyed on the normalised address. Marking the funnel under the
     typed form filed the signup under one identity and the later `paid` step
     under another, so the customer counted as a signup that never converted
     and the conversion rate read low for ever. Sibling of AMV-SP-01: the same
     wrong variable at the same call, throwing in one path and silently
     miscounting in the other. */
  try{ await _recordGrowth(env, 'signup'); await _funnelMark(env, em, 'signup'); }catch(e){}
  await _userEvent(env, request, em, 'account_created');
  // An invite code, if they arrived through one. Recorded, not yet rewarded.
  try{ await _referralCapture(env, request, em, body.ref); }catch(e){}
  /* No session until the address is proved: the code finishes the sign-up. */
  if (_codesOn(env)) { const c = await _startSignInCode(env, request, em, safeName, 'signup'); if (c) return c; }
  return _tokenResponse(env, await issueTokens(env, em, safeName, await _sessOpen(env, request, em)));
}
async function authLogin(request, env) {
  const body = await request.json().catch(()=>({}));
  const { email, name, password, provider } = body;
  // Honeypot - a hidden field only bots fill.
  if (body.company || body.website) { audit(env,'bot_blocked',{where:'login_honeypot'}); return json({ error:'sign in failed' }, 400); }
  const em = String(email||'').toLowerCase().trim();
  if (!em) return json({ error: 'email required' }, 400);
  /* A company that requires its own sign-in: before any hashing, because the
     password is not what decides here. */
  { const sso = await _ssoRequiredFor(env, em); if (sso) return _ssoRequiredJson(sso); }
  // /auth/login is the EMAIL + PASSWORD endpoint ONLY. Turnstile ALWAYS applies:
  // a `provider` value in the request body is attacker-controlled and must never
  // skip verification or stand in for proof of identity. Federated identities
  // (Google, etc.) authenticate through their own server-verified callback
  // (/auth/google), never here.
  {
    const capOk = await _verifyCaptcha(env, body.captchaToken, request);
    if (!capOk) return json({ error:'Please complete the verification and try again.', code:'captcha_required' }, 400);
  }
  const ip = _rlIp(request);

  /* HOW MANY TIMES ONE SOURCE MAY MAKE AMV HASH A PASSWORD.

     The only throttle here counted FAILURES per email+ip, so an attacker
     rotating the address paid nothing: every request bought a PBKDF2 at six
     hundred thousand iterations, which is the most expensive thing this file
     does on purpose. That was already true for addresses that exist.

     AMV-026 made it true for any string. Closing the enumeration hole means a
     missing account does the same hashing as a real one - that is the whole
     point, the clock must not answer what the status code no longer does - and
     it widened the CPU cost from "emails somebody has guessed correctly" to
     "anything at all".

     So the ceiling is on ATTEMPTS from one source, not on failures against one
     address. Thirty a minute is nowhere near a person signing in and nowhere
     near enough to be worth doing.

     Unavailable does not refuse, for the reason the Google limiter does not:
     turning a storage blip into "nobody can sign in" is a worse outcome than a
     brief window of unbounded hashing, and nothing irreversible happens on the
     other side of this one. */
  {
    const lim = await limitAction(env, `loginip:${ip}`, 30, 600);
    if (!lim.ok) {
      if (lim.unavailable) audit(env, 'login_limit_unavailable', {});
      else {
        audit(env, 'auth_fail', { email: em, reason: 'ip_throttled' });
        return json({ error: 'Too many sign-in attempts from here. Give it a moment and try again.',
                      code: 'rate_limited' }, 429, { 'Retry-After': '60' });
      }
    }
  }

  // brute-force throttle: cap failed password attempts per email+IP
  const rlKey = `authfail:${em}:${ip}`;
  {
    const fails = parseInt(await env.AMV_KV.get(rlKey) || '0', 10);
    if (fails >= 8) { audit(env, 'auth_fail', { email: em, reason: 'throttled' }); return json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, 429); }
  }
  /* AMV-026: ONE ANSWER, WHATEVER IS TRUE ON THIS SIDE.

     "no such account" with a 404 and "wrong password" with a 401 are two
     different answers, and the difference is the whole of the question an
     attacker is asking. Point a list of a million addresses at this endpoint
     and it sorts them into customers and strangers, for free, with no password
     guessed - which is a breach on its own for anybody whose membership here is
     private, and the shortlist for credential stuffing for everybody else.

     Every failure below is now the same status, the same code and the same
     sentence. The reason is still recorded server-side, where an operator can
     see it and an attacker cannot.

     The check on the password's LENGTH moved above the account lookup, because
     it is a fact about the request rather than about the account and answering
     it early keeps it out of the enumeration set. */
  { const bad = _passwordTooLong(password); if(bad) return json(bad, 400); }

  const SAME_ANSWER = { error:'That email and password do not match an account.', code:'bad_credentials' };
  const acct0 = await DB.get(env, 'acct', em);
  if(!acct0){
    await _noteAuthFail(env, rlKey);
    audit(env,'auth_fail',{email:em,reason:'no_account'});
    /* The same work, so the CLOCK does not answer the question the status code
       no longer does. Without this a missing account returns in a millisecond
       and a real one takes as long as PBKDF2 does, which is the same disclosure
       measured with a stopwatch instead of read off the screen. */
    await _hashPassword(password, 'absent-account-timing-salt', PBKDF2_ITERATIONS).catch(() => {});
    return json(SAME_ANSWER, 401);
  }
  const acct = acct0;
  // FAIL CLOSED: only a real email-password account with a stored password hash
  // may obtain a token here. A federated account (provider !== 'email', or no
  // pwHash) has no password to check, so it must be rejected - never fall through
  // to issueTokens. This closes both the provider-impersonation bypass and the
  // "any password logs in a federated account" bypass.
  if(acct.provider !== 'email' || !acct.pwHash){
    await _noteAuthFail(env, rlKey);
    audit(env,'auth_fail',{email:em,reason:'wrong_method'});
    /* Same reason as above: this branch skipped the hashing entirely, so a
       Google account and a password account were a stopwatch apart. */
    await _hashPassword(password, acct.salt || 'absent-account-timing-salt', acct.pwIter || PBKDF2_ITERATIONS).catch(() => {});
    return json(SAME_ANSWER, 401);   // generic - never reveal the account's provider
  }
  // verify using the iteration count the hash was MADE with (default 100k for
  // pre-upgrade accounts), so raising the global count never locks anyone out
  const usedIter = acct.pwIter || 100000;
  const hash = await _hashPassword(password, acct.salt, usedIter);
  // constant-time compare to avoid password-timing leaks
  const ok = timingSafeEqual(new TextEncoder().encode(hash), new TextEncoder().encode(acct.pwHash || ''));
  if(!ok){
    await _noteAuthFail(env, rlKey);
    audit(env,'auth_fail',{email:em,reason:'bad_password'});
    /* Shown to the account owner: a run of these is how someone finds out their
       password is being guessed, which is the single most useful thing an
       activity log can tell them. */
    /* Coalesced to at most one entry per 15 minutes per account. Without that,
       a distributed guessing run against one address is an unbounded write
       amplifier on that account's log - the per-IP throttle above does not
       bound it, because the attacker supplies the IPs. The user still sees a
       run of entries across the hours an attack lasts, which is the signal
       that matters; they do not need one line per guess. */
    try{
      const seen = `alogfail:${em}`;
      if(!(await env.AMV_KV.get(seen))){
        await env.AMV_KV.put(seen, '1', { expirationTtl: 900 });
        await _userEvent(env, request, em, 'sign_in_failed', { reason: 'wrong password' });
      }
    }catch(e){ /* logging must never change the outcome of a sign-in */ }
    return json(SAME_ANSWER, 401);
  }
  // success - clear the failure counter
  try{ await env.AMV_KV.delete(rlKey); }catch(e){}
  // transparent upgrade: if this account is below the current target, re-hash now
  if(usedIter < PBKDF2_ITERATIONS){
    try{
      const newHash = await _hashPassword(password, acct.salt, PBKDF2_ITERATIONS);
      /* AMV-196: under the record lock, re-reading inside it, and ONLY if the
         stored hash is still the one this login verified against.

         Writing the whole record back from a read taken at the top of the
         request is how a password reset gets silently undone: somebody resets
         because they think they are compromised, a login with the OLD password
         is in flight, and it restores the old hash and salt. The reset reports
         success, the new password does not work, and the old one still does.

         An upgrade is a nice-to-have; losing a password change is not. If the
         record moved underneath us, the upgrade is skipped - the next login
         does it. */
      await _withAcct(env, em, (fresh) => {
        if (!fresh || fresh.pwHash !== acct.pwHash || fresh.salt !== acct.salt) return;
        fresh.pwHash = newHash; fresh.pwIter = PBKDF2_ITERATIONS;
      });
    }catch(e){ /* non-fatal - login still succeeds */ }
  }
  /* THE PASSWORD IS ONE HALF. On a device this account has not proved itself
     on, the other half is a code sent to the address - see _startSignInCode. */
  let trust = null;
  if (_codesOn(env)) {
    trust = await _deviceTrustState(env, request, body, em);
    if (!trust.trusted) { const c = await _startSignInCode(env, request, em, acct.name || name || '', 'signin', null, trust.reason); if (c) return c; }
  }
  try{ await _markActive(env, em); }catch(e){}
  await _userEvent(env, request, em, 'signed_in');
  /* Trust is counted from the LAST sign-in, not the first code: somebody who
     signs in every week should not be asked for a code every thirty days. */
  if (trust && trust.trusted) return _withDeviceTrust(env, em, _tokenResponse, await issueTokens(env, em, acct.name || name || '', await _sessOpen(env, request, em)));
  return _tokenResponse(env, await issueTokens(env, em, acct.name || name || '', await _sessOpen(env, request, em)));
}

