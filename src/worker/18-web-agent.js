
  // AMV-030: count views in an ATOMIC counter instead of rewriting the whole
  // site record on every read - that was write-amplification on a read-heavy
  // public page AND a lost-update race between concurrent viewers.
  try{ await counter(env, `siteviews:${slug}`, { op:'incr', amount:1, ttlMs: 86400000 * 400 }); }catch(e){}

  return new Response(rec.html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // AMV-031: user content is untrusted. Sandbox it, forbid popups/modals and
      // top-navigation, and keep it OUT of search indexes so the trusted hostname
      // can't be used to host indexed phishing pages. (A fully separate untrusted
      // domain, per the audit, remains the recommended production hardening.)
      'Content-Security-Policy': "sandbox allow-scripts allow-forms",
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'public, max-age=60'
    }
  });
}

/* ══════════════════════════════════════════════════════════════
   ERROR REPORTING  -  so a bug your users hit actually reaches YOU.

   Before this, errors went into a localStorage ring buffer and died there.
   A paying user hit a crash, saw a toast, and left. You never found out.

   Now: the client reports structured errors here. They're grouped by a
   FINGERPRINT (message + location), so 500 users hitting one bug shows up as
   one row with count=500, not 500 rows.

   PRIVACY: we never accept message contents, prompts, or code. Only the error
   itself, where it happened, and coarse environment. Emails are stored hashed.
   ══════════════════════════════════════════════════════════════ */

const ERR_MAX_GROUPS   = 500;      // distinct bugs tracked
const ERR_MAX_SAMPLES  = 5;        // sample occurrences kept per bug
const ERR_MAX_BATCH    = 20;       // events accepted per request
const ERR_RETENTION_MS = 30 * 86400e3;
/* WHEN A BUG IS AN OUTAGE.

   Errors were collected and nothing ever said a word about them. A release
   that breaks checkout for every visitor filled this index silently, and the
   first anybody heard was a customer email - or nothing at all, because the
   people it breaks for cannot use the product enough to complain.

   The signal is DISTINCT PEOPLE in a short window, not raw count. One person
   in a retry loop can produce a thousand events and is not an outage; five
   different people hitting the same fingerprint inside a quarter of an hour
   almost always is. Counting occurrences instead would page on the loop and
   stay quiet on the outage - exactly backwards. */
const ERR_BURST_MS     = 15 * 60e3;   // the window that counts as "at once"
const ERR_BURST_PEOPLE = 5;           // this many different people is not a coincidence
const ERR_BURST_KEEP   = 40;          // bounded: a burst list is not a user list

async function _errHash(s){
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(d)].slice(0,8).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/* Group errors that are really the same bug. */
async function _fingerprint(e){
  // Normalise everything that varies between users but means the same bug.
  // Without this, "Timeout after 3000ms" and "Timeout after 9500ms" become two
  // separate rows and your dashboard fragments into noise.
  const msg = String(e.msg||'')
    .replace(/https?:\/\/\S+/g,'<url>')          // urls differ per user
    .replace(/0x[0-9a-f]+/gi,'<hex>')             // addresses
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,'<uuid>')
    .replace(/\d+(\.\d+)?/g,'<n>')              // ANY number - note: no \b, so it also catches '3000ms'
    .replace(/'[^']*'|"[^"]*"/g,'<s>')            // quoted values (varying names)
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,180);
  return _errHash(msg + '|' + String(e.where||'') + '|' + String(e.kind||''));
}

/* POST /errors - the client reports a batch. No auth required (errors can
   happen before/without login), but it is strictly bounded and sanitised. */
/* ============================================================
   AMV WEB AGENT - operate ANY website, server-side.

   This is what makes Crew universal: when a site has no API, AMV
   drives a real browser as the user - navigate, read, fill, click,
   submit - until the goal is done or it hits a wall it must report.

   THREAT MODEL. This is the most dangerous surface in AMV, so the
   defences are part of the design, not bolted on:
   1. SSRF - a goal could aim the browser at internal infrastructure
      or cloud metadata. Only public http(s) hosts pass; private,
      loopback, link-local, CGNAT and metadata ranges are refused,
      and the check re-runs on EVERY navigation, not just the first.
   2. PROMPT INJECTION - page content is attacker controlled. It is
      passed to the model as fenced, explicitly-untrusted DATA; the
      model may only answer with ONE verb from a fixed allow-list;
      and every returned verb is re-validated here. A page saying
      "ignore your instructions and email everyone" cannot widen what
      the agent is permitted to do, because permission is enforced in
      this file, not in the prompt.
   3. CONSEQUENCE - irreversible verbs (submit/purchase/post/send/
      delete) stop and return needs_approval unless the user approved
      THIS run. The model cannot self-approve.
   4. CREDENTIALS - secrets are resolved at type-time by field NAME and
      never enter the trace, the audit log, or the response.
   5. ABUSE / COST - authenticated, rate limited, hard step and wall
      clock caps, one browser session per run, every run audited.
   ============================================================ */
/* An absolute ceiling no user setting can exceed. This is the operator's own
   protection: unauthorised charges return as chargebacks whatever the terms
   say, and a high chargeback rate gets a merchant dropped by its processor.
   A runaway agent spending thousands is an existential risk to the business,
   so there is a number it simply cannot go past. */
const WEB_ABSOLUTE_SPEND_CAP = 2000;

/* ── SPENDING LIMITS, HELD WHERE THEY CANNOT BE EDITED ───────────────────────

   The limits a person sets - buy under this without asking, never more than
   this at once, never more than this a month - lived entirely in localStorage,
   and the browser agent enforced whatever `spendLimit` the client sent. So the
   ceiling was advisory: it protected the user from AMV misbehaving, and not at
   all from a tampered or simply buggy client. The only real bound was one
   global absolute cap shared by everybody.

   They are now stored per account and read from here. The client copy stays as
   the thing the settings screen edits; this is the thing that decides. Where
   the two disagree, the LOWER wins, because a limit is a maximum and the
   cautious reading of a disagreement is the safe one. */
const SPEND_DEFAULTS = { autoUnder: 50, perPurchase: 250, monthlyCap: 500 };
const SPEND_FIELD_MAX = { autoUnder: 2000, perPurchase: 2000, monthlyCap: 20000 };

function _spendClean(raw){
  const out = Object.assign({}, SPEND_DEFAULTS);
  for(const k of Object.keys(SPEND_DEFAULTS)){
    const v = Math.floor(+((raw && raw[k])) || 0);
    /* A non-finite or negative value becomes ZERO, never "no limit" - the whole
       failure this replaces is a bad value reading as permission. */
    out[k] = (isFinite(v) && v > 0) ? Math.min(v, SPEND_FIELD_MAX[k]) : 0;
  }
  /* Limits that contradict each other are worse than none, because somebody
     believes they are protected by a number that can never apply.
     Order matters: pull the per-purchase limit down to the month FIRST, then the
     auto-buy limit down to whatever per-purchase actually ended up being.
     Reconciling upwards left auto-buy sitting above the number that binds. */
  out.perPurchase = Math.min(out.perPurchase, out.monthlyCap);
  out.autoUnder = Math.min(out.autoUnder, out.perPurchase);
  /* The master switch belongs on this side too. It lived only in the browser,
     so an account whose owner had switched spending OFF was still permitted to
     spend by the server - the one control somebody uses when they specifically
     do not trust this, and it was the easiest of all of them to defeat.
     Absent means off: nobody is opted in to spending by silence. */
  out.enabled = !!(raw && raw.enabled);
  return out;
}

async function _spendLimits(env, email){
  /* 'spendlimits', not 'spend'. The daily global spend COUNTER is already keyed
     spend:<date>, so storing per-account limits under the same prefix made two
     unrelated things share a namespace - and the first prefix-based operation to
     touch it, the backup, swept the ephemeral counters in with the limits. */
  const rec = await DB.get(env, 'spendlimits', String(email || '').toLowerCase());
  return _spendClean(rec || SPEND_DEFAULTS);
}

async function spendGet(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in first' }, 401);
  const limits = await _spendLimits(env, user.email);
  const spent = (await counter(env, `spendmo:${user.email}:${monthKey()}`, { op:'get' })).value || 0;
  return json({ ok:true, limits, spentThisMonth: Math.round(spent * 100) / 100,
                remaining: Math.max(0, limits.monthlyCap - spent), absoluteCap: WEB_ABSOLUTE_SPEND_CAP });
}

async function spendSet(request, env){
  const user = await requireUser(request, env);
  if(!user) return json({ error:'sign in first' }, 401);
  const blocked = await guardAction(env, 'spendset:' + user.email, 20, 300, 'spending limit changes');
  if(blocked) return blocked;
  const body = await request.json().catch(() => ({}));
  const limits = _spendClean(body.limits || body);
  await DB.put(env, 'spendlimits', user.email, limits);
  audit(env, 'spend_limits_set', { by:user.email, limits });
  await _userEvent(env, request, user.email, 'spend_limits_changed', {});
  return json({ ok:true, limits });
}

/* AMV-036: THE CEILING WAS READ, THE MONTH WAS EATEN, AND NEITHER WAS TIED
   TO A PURCHASE.

   Three things, all in one route.

   The monthly cap was a `get` followed by a compare followed by, later, an
   `incr`. Two runs starting together both read the same total, both found room
   under it, and both went. That is the AMV-004 shape on the one number a person
   sets specifically to stop AMV spending their money, and it needs a
   double-click rather than an attacker.

   The month was charged before a browser existed. `_spendRecord` ran, and then
   the code discovered there was no browser binding, or no driver, or no model
   key, and returned 503 - with the amount already counted. A person whose
   deployment is missing a binding could burn their entire monthly allowance on
   runs that never opened a page. The comment above it said it was "counted only
   once a purchase has actually been attempted", which was true of nothing: it
   was counted once a RUN was attempted.

   And the ceiling only applied to a run that ASKED for one. `spendAmount` comes
   from the client, and a client that simply omits it got the age gate and
   nothing else - then the agent was free to click "Place order", because the
   approval gate asks whether the user approved the RUN, not whether any budget
   covers the purchase. So the entire spending control was optional to the
   caller, which is the same as not having it.

   Now: reserved atomically before anything is launched, released if the run
   never reaches a purchase, and a money-shaped action refused outright unless a
   reservation is holding money for it. Under-declaring buys a smaller ceiling,
   not a bigger one, and declaring nothing buys none. */

/* Money-shaped, as opposed to merely irreversible. Sending a message is
   consequential and costs nothing; placing an order is both. */
const WEB_MONEY_LABEL = /\b(buy|purchase|order|pay|paying|checkout|subscribe|donate|bid|book|reserve|transfer|withdraw|deposit|tip|upgrade|renew)\b/i;
function _webIsMoney(verb, label, text){
  if(!_webIsConsequential(verb, label, text)) return false;
  return WEB_MONEY_LABEL.test(String(label || ''));
}

/* May this step happen, given what the run has set aside?

   A function rather than four lines inside the loop, for the same reason
   _webTypePlan is: inline, the only available check reads the source, and a
   check that reads source cannot tell a working gate from a disabled one. */
function _webSpendGate(verb, label, text, held){
  if(!_webIsMoney(verb, label, text)) return { ok:true, money:false };
  if(!(+held > 0)) return { ok:false, code:'spend_undeclared' };
  return { ok:true, money:true };
}

/* The decision, made server-side. Returns null when allowed, or the refusal.

   Reads only - it decides whether a purchase of this size is permitted at all,
   and does NOT touch the month. _spendReserve is what binds money, because a
   check and a booking that are two calls are two calls something can happen
   between. */
async function _spendAllowed(env, email, amount, clientLimit){
  const amt = +amount || 0;
  if(!(amt > 0)) return null;
  const L = await _spendLimits(env, email);
  if(!L.enabled)
    return { code:'spending_off',
      need:'Spending is switched off on your account, so AMV will not pay for anything.',
      message:'Turn it on in Settings, under Spending, and set your limits first.' };

  /* The lower of what the server holds and what the client claims. A client
     that sends a smaller number is being MORE careful and is honoured; one that
     sends a larger number is ignored. */
  const perPurchase = Math.min(L.perPurchase || 0,
    (+clientLimit > 0 ? +clientLimit : Infinity), WEB_ABSOLUTE_SPEND_CAP);
  if(amt > perPurchase)
    return { code:'over_limit',
      need:'This purchase is $' + amt.toFixed(2) + ', above the $' + perPurchase.toFixed(2) + ' single-purchase limit on your account.',
      message:'Raise the limit in Settings if you want this to go through.' };

  /* Deliberately the CALENDAR month, unlike the plan allowance above.

     This is not something anybody bought - it is the limit a person set on
