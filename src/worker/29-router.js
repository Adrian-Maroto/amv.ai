export default {
  /* Cloudflare Cron trigger. THIS is what makes automations real: it runs on
     Cloudflare's schedule whether or not anyone has the app open.
     Configure in wrangler.toml:
       [triggers]
       crons = ["every 5 minutes"]   // i.e. the standard 5-minute cron expression
  */
  async scheduled(event, env, ctx) {
    _liveCtx = ctx;   // AMV-046: the tick logs too, and its events matter most
    /* THE EVERY-MINUTE TICK: background work starts within a minute.

       A second schedule, "* * * * *", that does ONE thing - runs jobs the
       due-work index already names (runDueAutomations with `quick`). Every
       other duty below (payments, renewals, digest, batches, the hourly full
       sweep) stays on the five-minute schedule it was written for. On the
       minutes both schedules fire, this one stands aside, so the two never
       race for the same jobs; if they did, the per-run lease would still let
       only one of them run each job. The kill switch stops it like the rest. */
    if (event && event.cron === '* * * * *') {
      const at = Number(event.scheduledTime) || Date.now();
      if (new Date(at).getUTCMinutes() % 5 === 0) return;
      ctx.waitUntil((async()=>{
        let killed = false;
        try{ killed = (await env.AMV_KV.get('GLOBAL_KILL')) === '1'; }catch(e){ killed = true; }
        if(killed) return;
        try{
          const r = await runDueAutomations(env, 0, { quick: true });
          if(r.ran || r.failed || r.deferred) console.log('[cron:minute] automations', JSON.stringify(r));
        }catch(e){
          console.error('[cron:minute] failed', e && e.message);
          try{ await _workerError(env, 'cron.minute', e); }catch(_){}
        }
      })());
      return;
    }
    ctx.waitUntil((async()=>{
      /* THE KILL SWITCH HAS TO REACH THE CRON, OR IT DOES NOT STOP SPENDING.

         GLOBAL_KILL was checked in one place: the fetch router, for /v1/
         paths. That stops every request a person makes and does nothing at all
         about the thing that runs when nobody is there. So an operator
         watching the bill run away could hit the switch, watch user traffic
         stop, and have automations go on firing every five minutes - calling
         the model, spending money - because the cron never asked.

         The one control whose entire purpose is "stop spending NOW" did not
         stop the spender that needs no one present.

         Read directly rather than through _killCache: the cache exists to keep
         a hot request path off KV, and this runs once every five minutes. A
         stale answer here would be five more minutes of the exact spend the
         operator is trying to stop. */
      let killed = false;
      try{ killed = (await env.AMV_KV.get('GLOBAL_KILL')) === '1'; }catch(e){}

      if(killed){
        console.log('[cron] paused by GLOBAL_KILL - automations skipped');
        audit(env, 'cron_paused', { by: 'GLOBAL_KILL' });
      } else {
        /* Payments that succeeded and were never applied. Cheap when there is
           nothing pending, and the one thing standing between a dropped webhook
           and a customer who paid for nothing. */
        try{ await reconcilePayments(env); }
        catch(e){ try{ await _workerError(env, 'cron.reconcile', e); }catch(_){} }

        try{
          const r = await runDueAutomations(env);
          if(r.ran || r.failed || r.deferred) console.log('[cron] automations', JSON.stringify(r));
        }catch(e){
          console.error('[cron] failed', e && e.message);
          try{ await _workerError(env, 'cron', e); }catch(_){}
        }
      }
      /* AMV-081: the weekly owner digest, in its own try. It is a report about
         the business; it must never be able to stop the tick that runs every
         customer's background work. Claimed once per week internally, so
         calling it on every 5-minute tick is correct and cheap. */
      /* Skipped while paused: it is a report, it costs an email, and a
         business summary sent from a deployment somebody has deliberately
         halted is noise at the worst possible moment. */
      if(!killed){
        try{
          const d = await runWeeklyDigest(env);
          if(d && d.sent) console.log('[cron] weekly digest sent', JSON.stringify(d));
        }catch(e){
          console.error('[cron] digest failed', e && e.message);
          try{ await _workerError(env, 'cron.digest', e); }catch(_){}
        }
      }
      /* Runs even while paused, deliberately: it is the one piece of cron work
         that REDUCES exposure rather than creating it - marking subscriptions
         nobody has confirmed - and a halted deployment is exactly when you
         want that still true.

         AMV-133: the renewal sweep, in its own try for the same reason as the
         digest. Claimed once per day internally, so running it on every
         5-minute tick is correct and costs one KV read. It is the only thing
         that revokes a plan without a webhook, so it must not be able to be
         taken out by an unrelated failure earlier in the tick. */
      try{
        const s = await runRenewalSweep(env);
        if(s && s.ran && (s.stale || s.truncated)) console.log('[cron] renewal sweep', JSON.stringify(s));
      }catch(e){
        console.error('[cron] renewal sweep failed', e && e.message);
        try{ await _workerError(env, 'cron.renewals', e); }catch(_){}
      }
      /* Batches with work left get their slice of this tick. Its own try,
         like everything here: a batch fault must not take out the sweeps.
         Skipped while paused, like automations: every item is a call to the
         model, and the switch exists to stop exactly that. */
      if(!killed){
        try{ await runBatches(env, ctx); }
        catch(e){ console.error('[cron] batches failed', e && e.message); try{ await _workerError(env, 'cron.batches', e); }catch(_){} }
      }
      /* Its own try, for the same reason as everything else on this tick: two
         counter reads that must not be able to take out the sweep that revokes
         plans. Alarmed once a month internally, so running it every tick costs
         two reads and nothing else. */
      try{
        const c = await runCohortCheck(env);
        if(c && c.alarmed) console.log('[cron] heavy share', JSON.stringify(c));
      }catch(e){
        console.error('[cron] cohort check failed', e && e.message);
        try{ await _workerError(env, 'cron.cohort', e); }catch(_){}
      }
    })());
  },

  /* ONE CATCH THAT ACTUALLY CATCHES.

     The catch below exists so a broken endpoint answers in AMV's own words,
     records the fault and pages an operator. It had never once fired for a
     route, and could not: the switch it guarded said

         case '/v1/messages': return aiProxy(request, env, ctx);

     and every handler here is async. Returning a promise EXITS the try. The
     rejection lands after the block is gone, so it was not an unhandled
     exception reaching the top level - it was one leaving through the roof.

     What a person got instead was Cloudflare's own 1101 error page: no AMV
     wording, no recovery path, and the message from the exception - which is
     precisely what the comment below is careful never to send - decided by
     somebody else's error page rather than by this file. Nothing was written
     to the error log and nobody was alerted, so the one signal that says the
     product is broken for everybody was silent for the whole class of faults
     most likely to cause it: a provider timing out, storage refusing, a null
     dereference in a new handler.

     `await` is the entire fix. It is spelled with the routing moved into
     its own function so there is exactly one thing to await and no chance of
     a later `return` inside the router escaping the same way - including the
     four public GET routes, which were outside the try altogether. */
  async fetch(request, env, ctx) {
    /* AMV-046: so audit() can register its deliveries with waitUntil. It has no
       ctx of its own and cannot be handed one without threading it through
       several hundred call sites. */
    _liveCtx = ctx;
    const mounted = _mountRequest(request, env);
    if (mounted) request = mounted;
    try {
      /* AMV-029: HOW MUCH THE SENDER IS ALLOWED TO HAND OVER.

         Nothing bounded a request body. Every handler went straight to
         `request.json()`, which reads the whole thing into memory before
         anybody can object - so an unauthenticated POST of a hundred megabytes
         of JSON to any endpoint was a hundred megabytes buffered and parsed
         inside a Worker with a 128MB limit, for the price of uploading it. The
         parse is the expensive part and it happens before the handler has even
         decided the caller is allowed to be there.

         Checked here rather than in each handler, for the reason AMV-028's CORS
         was: there are a hundred and sixty routes and one place they all pass
         through, and a rule applied in a hundred and sixty places is a rule
         with a hole in it by next month. */
      const tooBig = _bodyTooBig(request);
      if (tooBig) return _applyCors(request, env, tooBig);

      /* A DEPLOYMENT THAT CANNOT FINISH THE JOB SHOULD NOT START IT.

         Found by running this Worker in workerd with no secrets set, which is
         exactly the state a first deploy is in until somebody remembers
         `wrangler secret put`.

         Signing fails closed without JWT_SECRET - deliberately, so a missing
         secret can never become a public signing key. But issueTokens is the
         LAST thing signup does. The account row was already written, the
         counters already incremented, the growth already recorded; the throw
         arrived after all of it and came back as a generic 500. So the account
         existed, its owner had no token, and trying again answered "account
         exists" with a 409. One forgotten secret and every person who signed up
         is locked out of an address they own, permanently, with nothing on
         either side saying why.

         Checked here for the reason the body limit is: there are a hundred and
         sixty routes and one place they all pass through. And checked BEFORE
         the route runs, because the whole failure is that the work happened
         first. */
      const unconfigured = _deploymentCannotServe(request, env);
      if (unconfigured) return _applyCors(request, env, unconfigured);

      return _applyCors(request, env, _mountCookies(await _route(request, env, ctx), mounted));
    } catch (err) {
      // An unhandled exception reached the top level. Record it AND alert (both
      // throttled + best-effort) so a broken endpoint pages you instead of
      // silently 500ing until a user complains. Never let logging mask the 500.
      try{
        let path = 'request';
        try{ path = new URL(request.url).pathname; }catch(_){}
        /* SAY IT WHERE THE RUNTIME CAN HEAR IT.

           _workerError writes the exception to KV and forwards it to Sentry,
           and both are real - but KV is readable only through an admin route
           that needs a token and a POST, and Sentry is inert until somebody
           sets a DSN. Neither reaches the platform's own log, so a 500 arrived
           in Workers Logs as an error event with no reason in it: the operator
           could see THAT a request failed and had no way to learn WHY, which
           is the whole thing they came to the log for.

           The cron path had console.error from the start. The request path -
           the one every user is on - did not. Scrubbed with the same function
           the stored copy uses, because a log line is as public as a KV record
           and an exception can quote a URL with a token in it. */
        try{
          console.error('[500] ' + path + ' :: '
            + _errScrub(String((err && err.message) || err), 300) + ' :: '
            + _errScrub(String((err && err.stack) || ''), 600));
        }catch(_){}
        ctx.waitUntil(_workerError(env, path, err));
      }catch(_){}
      /* The MESSAGE stays on the server. This returned err.message straight to
         whoever made the request, which is the one thing this file is careful
         about everywhere else - a provider's raw response is logged and the
         caller told something generic, for exactly this reason. An exception message
         is written for an engineer and can carry a key name, a storage path, a
         query fragment or a stack-shaped hint; none of that belongs in an
         answer to a stranger. It is recorded above, with an alert, so nothing
         is lost by not saying it here. */
      return _applyCors(request, env, json({ error: 'Something went wrong on our side. It has been logged.' }, 500));
    }
  },
};

/* AMV-029: the default ceiling on a request body, and the routes that are
   genuinely bigger.

   A megabyte is many times any chat turn, form or settings blob AMV sends. The
   exceptions are the two places a person really does hand over a large file,
   and they are listed rather than implied so a new route is small by default
   and a large one is somebody's decision. */
const BODY_MAX_BYTES = 1024 * 1024;
const BODY_MAX_BY_PATH = {
  '/admin/backup/import': 64 * 1024 * 1024,  // a whole namespace snapshot, restored by the operator
  '/sync/push': 8 * 1024 * 1024,             // everything one account has, from one device
  '/v1/messages/batches': 8 * 1024 * 1024,   // up to a hundred requests at once
};

function _bodyMaxFor(path) {
  return Object.prototype.hasOwnProperty.call(BODY_MAX_BY_PATH, path)
    ? BODY_MAX_BY_PATH[path] : BODY_MAX_BYTES;
}

/* Refuse on the DECLARED length, before a byte of the body is read.

   Content-Length is the sender's own claim, so it is a fast path and not the
   answer on its own - but it is the answer for every honest client, and for a
   dishonest one the platform still has to receive what it sends. The bodies
   that are actually parsed downstream are separately bounded where they are
   read: the mail reader (AMV-047) and the school reader (AMV-050) both count
   as they go, for exactly this reason. */
function _bodyTooBig(request) {
  const m = String(request.method || '').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return null;
  let path = '';
  try { path = new URL(request.url).pathname.replace(/\/+$/, ''); } catch (e) {}
  const max = _bodyMaxFor(path);
  const declared = Number(request.headers.get('content-length'));
  if (!Number.isFinite(declared) || declared <= max) return null;
  return json({
    error: 'That request is larger than AMV accepts on this endpoint ('
      + Math.round(max / 1024) + ' KB), so nothing was read.',
    code: 'body_too_large', limit: max,
  }, 413);
}

/* THE ROUTES THAT CANNOT WORK WITHOUT A SIGNING KEY.

   Not "every route": most of this Worker is honest about missing configuration
   already, and refusing everything because one optional key is absent would
   turn a partial deployment into no deployment. These are the paths that MUST
   mint or renew a token to succeed, so without JWT_SECRET they cannot end any
   way but a throw - and three of them write something first.

   Everything that only VERIFIES is already fine: verifyToken wraps its work in
   a try and answers null, so those paths come back 401 rather than 500. That is
   the correct answer to "this deployment cannot check who you are" and it needs
   no help from here.

   The list is exactly the handlers that call issueTokens or signToken,
   read off the source rather than remembered - /auth/reset/confirm was on it
   for a first draft and does not sign anything, and a route on this list that
   does not need to be is a route refused for no reason.

   Kept as a roster beside the check rather than as a condition inside each
   handler, for the reason GET_SAFE is: a rule spread across a hundred and
   sixty routes has a hole in it by next month. A new auth route that signs
   something belongs on this list, and the test that reads it says so. */
const NEEDS_SIGNING = new Set([
  '/auth/signup',
  '/auth/login',
  '/auth/google',
  '/auth/sso/finish',
  '/auth/refresh',
  '/auth/login/verify',
  '/auth/login/mfa',
  '/auth/passkey/signin',
]);

/* Whether this deployment can serve this request at all.

   Answers with 503 rather than 500, because those mean different things to
   everyone downstream: 500 says AMV broke and invites a retry, 503 says AMV is
   not set up and a retry will do exactly the same thing. The message names the
   missing thing without printing it - the operator needs to know WHICH secret,
   and nobody needs to know its value. */
function _deploymentCannotServe(request, env) {
  let path = '';
  try { path = new URL(request.url).pathname.replace(/\/+$/, ''); } catch (e) { return null; }
  if (!NEEDS_SIGNING.has(path)) return null;
  if (env && env.JWT_SECRET) return null;
  /* Audited, because the operator's first sight of this should not be a
     customer telling them sign-in is broken. */
  try { audit(env, 'deployment_unconfigured', { path, missing: 'JWT_SECRET' }); } catch (e) {}
  return json({
    error: 'This AMV deployment is not finished being set up, so no account can '
      + 'be created or signed in yet. Nothing was changed.',
    code: 'not_configured',
    missing: 'JWT_SECRET',
  }, 503, { 'Retry-After': '300' });
}

/* AMV-SP-09: WHERE SOMEBODY LANDS AFTER PAYING IS NOT THE CALLER'S CHOICE.

   The three payment redirects read `APP_URL || APP_ORIGIN || request Origin`,
   under a comment saying the request Origin is "only a dev fallback when no
   APP_URL is configured". The comment is describing an intention. Nothing in
   the code knows whether a deployment is development: a production instance
   that simply never set APP_URL takes the redirect from a header the caller
   sends, and that header is not authenticated by anything.

   What that is worth: a request to start a checkout with `Origin:
   https://amv-billing.example` puts an attacker's address into Stripe's
   success_url. The customer pays - really pays, to the real Stripe - and is
   returned to a page the attacker controls, at the exact moment they are
   expecting to be asked to confirm something. That is a phishing page with
   perfect timing and a genuine transaction behind it.

   There is no fallback now. A deployment that has not been told its own address
   cannot start a payment, and says which setting is missing. That is the honest
   version of "dev fallback": it works the moment the setting exists, and it
   does not quietly do something dangerous before then. */
function _paymentReturnOrigin(env) {
  return String((env && (env.APP_URL || env.APP_ORIGIN)) || '').replace(/\/$/, '');
}
function _paymentOriginMissing() {
  return json({ error: 'Payments are not set up on this deployment: AMV does not know its own address, '
                     + 'so it cannot say where to send you after paying. Set APP_URL and this works immediately.',
                code: 'needs_service' }, 503);
}

/* AMV-028: THE CONFIGURED ORIGIN, APPLIED WHERE EVERY RESPONSE PASSES.

   `ALLOWED_ORIGIN` exists so an operator can lock the browser API to their own
   front end, and `corsFor(env)` was written to honour it. Nothing called it.
   Every JSON response went out through `json()`, which carries a hardcoded
   `Access-Control-Allow-Origin: *` - so the setting was a comment describing a
   behaviour the product did not have, and a deployment that had set it was no
   more restricted than one that had not.

   Fixed here rather than in `json()`, which is called from several hundred
   places and has no access to `env`. Every response the Worker produces goes
   through this one line, so there is nowhere for a route to be forgotten.

   `*` is kept as the default. Locking the API to one origin is a real choice
   with real consequences for anybody embedding the widget, and the token is the
   security boundary - flipping it on for everybody who has not asked would
   break working deployments to enforce a setting they never set.

   Credentials are only allowed when a concrete origin is configured, because a
   browser refuses `Allow-Credentials` alongside a wildcard - which is the rule
   that makes an origin-locked deployment the one that can hold an HttpOnly
   refresh cookie. */
/* ONE LOCK, THREE KINDS OF CALLER (outside audit, 2026-10-20).

   Locking the API to the site used to lock out the two callers that are
   cross-site by design. Every response was stamped "only <the site> may read
   this", so on a deployment that set ALLOWED_ORIGIN:
     - the website widget, which runs on a CUSTOMER's site, had its config and
       every chat answer refused by the visitor's browser - the widget simply
       stopped working, with nothing on AMV's side to say so;
     - a browser calling with an API key from its own page was refused too.
   So the lock now applies to what it protects - the person's session, the one
   caller that may carry cookies - and the other two are answered as what they
   are, never with credentials:
     - the widget's two public routes keep the answer their handlers give,
       which names the visitor's site only where the widget is allowed - the
       same as on an open deployment;
     - a request carrying an API key is answered to anyone: the key in the
       request is the whole credential, and no cookie is ever involved. */
const _CORS_WIDGET = new Set(['/v1/widget/chat', '/v1/widget/config-public']);
function _corsKind(request, want) {
  try {
    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    if (_CORS_WIDGET.has(path)) return 'widget';
    /* A preflight carries no credential to look at - only the names of the
       headers to come. One from any page but AMV's own is answered without
       credentials: it grants nothing by itself (the real response still
       decides what is readable), and a browser never sends a cookie after a
       preflight answered '*', so the session stays locked. */
    if (request.method === 'OPTIONS') return (request.headers.get('Origin') || '') === want ? 'session' : 'key';
    const auth = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (auth.startsWith(API_KEY_PREFIX) || request.headers.get('X-AMV-Key')) return 'key';
  } catch (e) {}
  return 'session';
}
function _applyCors(request, env, res) {
  try {
    const want = _corsOrigin(env);
    if (want === '*') return res;
    const kind = _corsKind(request, want);
    /* The widget's handlers decide for themselves - they name the visitor's
       site only when the widget is allowed there - exactly as they do on an
       open deployment. */
    if (kind === 'widget') return res;
    const h = new Headers(res.headers);
    if (kind === 'key') {
      h.set('Access-Control-Allow-Origin', '*');
      h.delete('Access-Control-Allow-Credentials');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }
    h.set('Access-Control-Allow-Origin', want);
    h.set('Access-Control-Allow-Credentials', 'true');
    /* A response that varies by origin must say so, or a shared cache can hand
       one origin's answer to another. */
    const vary = h.get('Vary');
    h.set('Vary', vary ? (/\bOrigin\b/i.test(vary) ? vary : vary + ', Origin') : 'Origin');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  } catch (e) { return res; }
}

/* THE ROUTER. Everything it can do is awaited by the caller above, which is
   the only reason the error handling there works at all. */
async function _route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');

  // Live deployed sites are PUBLIC - served before any auth/CORS gating.
  /* A company's directory adding and removing its people (71-scim.js).
     Before the method list (SCIM uses GET, POST, PUT, PATCH and DELETE) and
     before the emergency stop: removing somebody's access is a security
     action, and the stop exists to stop spending. */
  if (path.startsWith('/scim/v2') && request.method !== 'OPTIONS') return scimRoute(request, env, path);
  /* A request from another service to a Crew job's own address. Before the
     method list below, because the address is a path no list can name; the
     handler takes POST only. See 70-hooks.js. */
  if (path.startsWith('/v1/hook/') && request.method !== 'OPTIONS') {
    const _killed = (await env.AMV_KV.get('GLOBAL_KILL')) === '1';
    if (_killed) return json({ error: 'Service temporarily paused. Please try again soon.' }, 503);
    return hookDeliver(request, env, path.slice('/v1/hook/'.length));
  }
  if (request.method === 'GET' && path.startsWith('/s/')) {
    return serveSite(request, env, path.slice(3));
  }

  // A shared conversation is a public page - no auth, and it must be
  // reachable by a link preview crawler (AMV-074).
  if (request.method === 'GET' && path.startsWith('/c/')) {
    return sharePage(request, env, path.slice(3));
  }

  /* A game is a public page by design: somebody opens it from a group chat
     with no account and no app. Same treatment as a shared conversation. */
  if (request.method === 'GET' && path.startsWith('/g/')) {
    return gamePage(request, env, path.slice(3));
  }

  // The password-reset page must be public too - the whole point is that the
  // user cannot log in. This is what the reset email links to.
  if (request.method === 'GET' && path === '/reset') {
    return resetPage(request, env);
  }

  if (request.method === 'OPTIONS') {
    // The public widget endpoint may be locked to specific origins; reflect the
    // request Origin for its preflight so a domain-restricted widget still works.
    if (path === '/v1/widget/chat') {
      const o = request.headers.get('Origin') || '*';
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': o,
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin',
      }});
    }
    return new Response(null, { headers: { ...CORS, ...SECURITY_HEADERS } });
  }

  // ---------- GLOBAL KILL SWITCH ----------
  // Cached in-isolate for a few seconds so it's not a KV round-trip on
  // every single request (this is the hottest path). Worst-case delay to
  // honor a freshly-flipped switch is _KILL_TTL_MS. (auditor: hot-path read)
  /* AMV-003: THE EMERGENCY STOP STOPPED ONE NAMESPACE.

     This was `path.startsWith('/v1/')`, which reads like "the API" and is not.
     /sms/incoming is outside it and calls the model through runSmsAgent, so
     the one control that exists to stop AMV spending money did not stop the
     one inbound channel a stranger can trigger by sending a text. The switch
     that is supposed to be the last line of defence had a hole in exactly the
     place an attacker does not need an account to reach.

     Now everything is stopped except a named few, so a route added tomorrow is
     covered by default rather than by remembering. The exceptions, each for a
     reason:

       health      - the thing that tells an operator the Worker is alive at
                     all; killing it makes an outage indistinguishable from a
                     pause.
       admin/kill  - the switch itself. Blocking it meant the stop could be
                     turned on through the API and only turned off with
                     wrangler, which is a bad thing to discover mid-incident.
       webhooks    - Stripe and PayPal do not spend AMV's money; they report
                     that a customer already spent theirs. A 503 makes the
                     provider retry, which is survivable briefly and loses
                     paid subscriptions if the pause is long. Letting them
                     through keeps billing state true while everything that
                     COSTS is stopped.
       /auth/*     - killing sign-in would lock every customer out of their own
                     account, and the operator out of the incident, over a
                     spend problem that has nothing to do with them. That is a
                     deliberate choice with a test behind it in
                     stop-means-stop-spending; the first version of this fix
                     broke it, which is what the test is for. */
  const KILL_EXEMPT = (p) =>
    p === '/v1/health'                 // an outage must stay distinguishable from a pause
    || p === '/v1/admin/kill'          // the switch itself, or it can only be lifted with wrangler
    || p === '/v1/stripe/webhook'      // billing truth: these report money already spent,
    || p === '/v1/paypal/webhook'      //   and a 503 for long enough loses paid subscriptions
    || p.startsWith('/auth/');         // people, and the operator, keep reaching their accounts
  if (!KILL_EXEMPT(path)) {
    const now = Date.now();
    if (now - _killCache.ts > _KILL_TTL_MS) {
      _killCache.val = (await env.AMV_KV.get('GLOBAL_KILL')) === '1';
      _killCache.ts = now;
    }
    if (_killCache.val) return json({ error: 'Service temporarily paused. Please try again soon.' }, 503);
  }

  /* AMV-030: A ROUTE THAT ANSWERS ANY VERB ANSWERS THE WRONG ONES.

     Nothing here checked the method. `/v1/family/leave`, `/v1/mail/disconnect`,
     `/team/leave`, `/v1/finance/unlink` and forty more read no body at all, so
     every one of them did its work on a GET - and a GET is what a browser
     performs from an <img src>, a link somebody clicks, a preview crawler
     following a URL out of a chat message. That is a state-changing action
     triggered by loading a page, with the signed-in customer's own session
     attached, which is the classic shape of cross-site request forgery. It
     needs no attacker skill: it needs somebody to open a link.

     HTTP already has the distinction and it is the right one to use. A SAFE
     route - one that reads and changes nothing - may be fetched with GET.
     Everything else is POST, because a POST is not what a page loads by
     accident.

     Listed rather than derived. "Does it read a request body" looked like the
     rule and is not: the routes above read no body and change plenty. Safety is
     a fact about what a handler DOES, so it has to be written down by somebody
     who looked, and a new route is POST-only until it is. */
  const GET_SAFE = new Set([
    '/v1/health',               // liveness, reads nothing
    /* Two booleans about the deployment - is an email provider set, and is it
       still on the default sender - and nothing about any account. A GET so the
       owner can open it in a browser to check their email setup; as POST-only
       a browser visit answered "error", which reads like a broken key. */
    '/auth/reset/status',       // can email reach people (no account data)
    '/v1/public-config',        // which features this deployment has
    '/v1/entitlement',          // what plan this account is on
    '/v1/market/list',          // the public marketplace
    /* Reads no storage and writes nothing: it returns three constants - the
       universal jobs, the five for the country asked about, and the country
       names. A GET so a browser and the edge can cache it, which is what keeps
       a public catalogue cheap. */
    '/v1/everyday',             // what AMV does where you live
    /* Which country this request comes from, as the network edge reports it.
       Reads no storage and writes nothing; per visitor, so never cached. */
    '/v1/where',                // the country Crew is for
    /* The same shape and the same reason: a catalogue, read-only, identical
       for everyone who asks, and the thing somebody reads before they have an
       account. It holds nothing belonging to anybody - it reads the public MCP
       registry, filters it to what AMV's bridge can actually start, and caches
       the answer. A GET so the edge can serve it. */
    '/v1/connectors',           // everything AMV can be connected to
    /* The picture beside each of those, served from here rather than from
       somebody else's origin so a visitor's browser never announces itself to
       a third party for the sake of a 28-pixel square. It holds nothing
       belonging to anybody and the address it fetches is derived, never
       supplied. A GET so the edge and the browser can both cache it. */
    '/v1/connector-logo',       // and the logo beside each of them
    /* A READ THAT WAS ANSWERING 405 TO ITS ONLY CALLER.

       AMV_API.crewPopular() calls this with no method, which is a GET, and
       this list is what decides whether a GET is allowed - so every request
       the product has ever made to this route came back "that endpoint does
       not accept GET requests". The most-used section had no data because it
       was never given any, and nothing said so: the client swallowed it and
       rendered the not-enough-yet state, which looks exactly like a young
       product with few users.

       The route's own comment describes a cache header put there so a browser
       visiting the screen twice in a minute does not ask twice. That header
       was on a POST response, and browsers do not cache those - so the one
       mitigation named in the design was inert as well. Both work now. */
    '/crew/popular',            // aggregate counts, read-only, already public
    /* The same mistake, found by the same check in the same minute.
       AMV_API.connectList() sends a GET; this route requires an account,
       writes nothing, and returns the caller's own connected accounts. It was
       answering 405 to the only thing that calls it, so the Connected accounts
       screen was listing nothing for the same invisible reason. Not cached -
       it is one account's data, not a catalogue. */
    '/v1/connect/list',         // the caller's own connections, read-only
    '/v1/account/export',       // the caller's own data, read-only, and a download
    '/widget.js',               // a <script src> on somebody else's site
    '/v1/widget/config-public', // fetched by that script before the chat opens
    /* Read-only screens that carry their arguments in the query string, which
       is what makes them GETs in the first place. Every one of them was checked
       for writes before being listed - see a-link-is-not-a-command, which
       re-checks it on every run rather than trusting this comment. */
    '/v1/resume',               // a public resume page, opened by its link

    /* The read-only screens the app really does fetch with GET. Found by
       sweeping every fetch in src/app that sets no method, rather than by
       guessing - the first version of this list was written from memory and
       would have broken the operator's own dashboard, which is precisely the
       surface the rule about verifying on the surface the owner uses exists
       for. Every one of them was then read and confirmed to write nothing. */
    '/v1/activity', '/v1/sessions', '/v1/engines', '/v1/google/picker', '/v1/computer/info', '/v1/credit', '/v1/referral', '/v1/usage', '/v1/stripe/invoices',
    '/api/approvals',
    '/v1/library', '/v1/library/get',   // your files: the list, and one file's contents
    '/admin/users', '/admin/payouts', '/admin/digest', '/admin/reports',
    '/admin/abuse/list', '/admin/readiness', '/admin/backup/export',
    '/v1/admin/finance', '/v1/admin/stats', '/v1/admin/support',

    /* Two routes are a GET and a POST of the same thing: the GET lists, the
       POST changes. Both must be reachable, and the handler decides which it
       is - see the test, which checks that they really do branch rather than
       taking this comment's word for it. */
    '/api/handoff',             // GET lists the inbox, POST sends one
    '/api/jobs',                // GET lists jobs, POST toggles one
  ]);
  if (request.method !== 'POST' && !(request.method === 'GET' && GET_SAFE.has(path))) {
    /* HEAD is answered like GET on the safe ones by the runtime; anything else
       is refused with the list, because a 405 that does not say what IS allowed
       sends people guessing. */
    if (!(request.method === 'HEAD' && GET_SAFE.has(path))) {
      const allow = GET_SAFE.has(path) ? 'GET, HEAD, POST, OPTIONS' : 'POST, OPTIONS';
      return json({ error: 'That endpoint does not accept ' + request.method + ' requests.',
                    code: 'method_not_allowed', allow }, 405, { 'Allow': allow });
    }
  }

  switch (path) {
    case '/v1/health':       return json({ ok: true, ts: Date.now() });
    case '/v1/public-config': return publicConfig(request, env);
    case '/v1/visit':        return recordVisit(request, env);
    case '/auth/signup':     return authSignup(request, env);
    case '/auth/login':      return authLogin(request, env);
    case '/auth/login/verify': return authLoginVerify(request, env);
    case '/auth/login/resend': return authLoginResend(request, env);
    case '/auth/login/mfa':    return authLoginMfa(request, env);
    case '/auth/passkey/options':  return passkeyOptions(request, env);
    case '/auth/passkey/register': return passkeyRegister(request, env);
    case '/auth/passkey/signin':   return passkeySignin(request, env);
    case '/auth/passkey/remove':   return passkeyRemove(request, env);
    case '/auth/security':         return securityStatus(request, env);
    case '/auth/totp/start':       return totpStart(request, env);
    case '/auth/totp/confirm':     return totpConfirm(request, env);
    case '/auth/totp/disable':     return totpDisable(request, env);
    case '/auth/recovery/new':     return recoveryNew(request, env);
    case '/auth/google':     return authGoogle(request, env);
    case '/auth/sso/start':  return authSsoStart(request, env);
    case '/auth/sso/finish': return authSsoFinish(request, env);
    case '/admin/users':     return adminUsers(request, env);
    case '/auth/refresh':    return authRefresh(request, env);
    case '/auth/logout':     return authLogout(request, env);
    case '/auth/delete':     return authDeleteAccount(request, env);
    case '/auth/reset':      return authReset(request, env);
    case '/auth/reset/confirm': return authResetConfirm(request, env);
    case '/auth/reset/status':  return authResetStatus(request, env);
    case '/auth/reset/code':    return authResetCode(request, env);
    case '/auth/reset/verify':  return authResetVerify(request, env);
    case '/auth/admin-reset':   return authAdminReset(request, env);
    case '/v1/resume':       return resumeAnswer(request, env);
    case '/v1/stop':         return aiStop(request, env);
    case '/v1/activity':     return accountActivity(request, env);
    case '/v1/sessions':     return sessionsList(request, env);
    case '/v1/engines':      return enginesList(request, env);
    case '/v1/google/picker': return googlePickerConfig(request, env);
    case '/v1/computer/info': return computerInfo(request, env);
    case '/v1/computer/checkout': return computerCheckout(request, env);
    case '/v1/computer/exec': case '/v1/computer/exec/cancel': case '/v1/computer/read':
    case '/v1/computer/write': case '/v1/computer/list': case '/v1/computer/delete':
    case '/v1/computer/revoke': case '/v1/computer/status':
      return computerRoute(request, env, path.slice('/v1/computer/'.length));
    case '/v1/sessions/end': return sessionsEnd(request, env);
    case '/v1/keys/create':  return apiKeyCreate(request, env);
    case '/v1/keys/list':    return apiKeyList(request, env);
    case '/v1/keys/revoke':  return apiKeyRevoke(request, env);
    case '/v1/feedback':     return feedbackRecord(request, env);
    case '/v1/support':      return supportSubmit(request, env);
    case '/v1/admin/support': return supportInbox(request, env);
    case '/v1/referral':     return referralStatus(request, env);
    case '/v1/game/create':  return gameCreate(request, env);
    case '/v1/game/join':    return gameJoin(request, env);
    case '/v1/game/answer':  return gameAnswer(request, env);
    case '/v1/game/state':   return gameState(request, env);
    case '/v1/game/close':   return gameClose(request, env);
    case '/v1/game/reveal':  return gameReveal(request, env);
    case '/v1/game/mine':    return gameMine(request, env);
    case '/v1/share/create': return shareCreate(request, env);
    case '/v1/share/list':   return shareList(request, env);
    case '/v1/share/revoke': return shareRevoke(request, env);
    case '/v1/share/visibility': return shareVisibility(request, env);
    case '/sync/pull':       return syncPull(request, env);
    case '/sync/push':       return syncPush(request, env);
    case '/auto/list':       return autoList(request, env);
    case '/auto/create':     return autoCreate(request, env);
    case '/crew/popular':    return crewPopular(request, env);
    case '/v1/connect/start':  return connStart(request, env);
    case '/v1/connect/finish': return connFinish(request, env);
    case '/v1/connect/list':   return connList(request, env);
    case '/v1/connect/act':    return connAct(request, env);
    case '/v1/connect/undo':   return connUndo(request, env);
    case '/v1/library':        return libList(request, env);
    case '/v1/library/put':    return libPut(request, env);
    case '/v1/library/get':    return libGet(request, env);
    case '/v1/library/delete': return libDelete(request, env);
    case '/v1/library/move':   return libMove(request, env);
    case '/v1/audio/transcribe': return speechTranscribe(request, env);
    case '/v1/audio/speak':      return speechSpeak(request, env);
    case '/v1/connect/remove': return connRemove(request, env);
    case '/v1/connect/api':    return connApi(request, env);
    case '/v1/remote/list':    return remoteList(request, env);
    case '/v1/remote/start':   return remoteStart(request, env);
    case '/v1/remote/finish':  return remoteFinish(request, env);
    case '/v1/remote/remove':  return remoteRemove(request, env);
    case '/v1/remote/tools':   return remoteTools(request, env);
    case '/v1/remote/call':    return remoteCall(request, env);
    case '/auto/update':     return autoUpdate(request, env);
    case '/auto/hook':       return autoHook(request, env);
    case '/auto/read':       return autoClearResults(request, env);
    case '/auto/pause':      return autoPause(request, env);
    case '/deploy':          return deploySite(request, env);
    case '/deploy/list':     return deployList(request, env);
    case '/deploy/delete':   return deployDelete(request, env);
    case '/v1/browser/run':  return browserRunRoute(request, env, ctx);
    case '/v1/browser/takeover': return browserTakeover(request, env, ctx);   // the person's hands in a handed-over run (72-web-takeover.js)
    case '/v1/finance/accounts':     return financeRoute(request, env, 'accounts');
    case '/v1/finance/transactions': return financeRoute(request, env, 'transactions');
    case '/v1/finance/checkin':      return financeCheckin(request, env);
    case '/v1/finance/status':       return financeStatus(request, env);
    case '/v1/cal/feeds':            return calFeedList(request, env);
    case '/v1/cal/feeds/add':       return calFeedAdd(request, env);
    case '/v1/cal/feeds/remove':    return calFeedRemove(request, env);
    case '/v1/cal/events':          return calEvents(request, env);
    case '/v1/finance/link/start':   return financeLinkStart(request, env);
    case '/v1/finance/link/finish':  return financeLinkFinish(request, env);
    case '/v1/finance/unlink':       return financeUnlink(request, env);
    case '/v1/spend/limits':         return spendGet(request, env);
    case '/v1/spend/set':            return spendSet(request, env);
    case '/v1/family/get':           return familyGet(request, env);
    case '/v1/notify/done':          return notifyDone(request, env);
    case '/v1/school/connect':       return schoolConnect(request, env);
    case '/v1/school/disconnect':    return schoolDisconnect(request, env);
    case '/v1/school/work':          return schoolWork(request, env);
    case '/v1/school/teachers':      return schoolTeachers(request, env);
    case '/v1/family/limits':        return familySetLimits(request, env);
    case '/v1/family/remove':        return familyRemove(request, env);
    case '/v1/family/leave':         return familyLeave(request, env);
    case '/v1/family/pending':       return familyPending(request, env);
    case '/v1/family/decline':       return familyDecline(request, env);
    case '/v1/link/invite':          return linkInvite(request, env);
    case '/v1/link/accept':          return linkAccept(request, env);
    case '/v1/consent':              return consentRecord(request, env);
    case '/v1/subscribe':            return stripeSubscribe(request, env);
    case '/v1/fraud/record':         return fraudRecord(request, env);
    case '/errors':          return errorsReport(request, env, ctx);
    case '/errors/list':     return errorsList(request, env);
    case '/errors/resolve':  return errorsResolve(request, env);
    case '/admin/reports':     return adminReports(request, env);
    case '/admin/abuse/list':  return abuseList(request, env);
    case '/admin/abuse/clear': return abuseClear(request, env);
    case '/admin/payouts':       return adminPayouts(request, env);
    case '/admin/payouts/mark':  return adminPayoutMark(request, env);
    case '/admin/readiness':     return adminReadiness(request, env);
    case '/admin/email-test':    return adminEmailTest(request, env);
    case '/admin/digest':        return adminDigest(request, env);
    case '/admin/backup/export': return backupExport(request, env);
    case '/admin/backup/import': return backupImport(request, env);
    case '/api/jobs':            return crewJobs(request, env);
    case '/api/approvals':       return crewApprovals(request, env);
    case '/api/approvals/act':   return crewApprovalAct(request, env);
    case '/api/approvals/edit':  return crewApprovalEdit(request, env);
    case '/api/handoff':         return request.method === 'POST' ? handoffCreate(request, env) : handoffList(request, env);
    case '/api/handoff/act':     return handoffAct(request, env);
    case '/team/create':     return teamCreate(request, env);
    case '/team/get':        return teamGet(request, env);
    case '/team/invite':     return teamInvite(request, env);
    case '/team/join':       return teamJoin(request, env);
    case '/team/members':    return teamMembers(request, env);
    case '/team/remove':     return teamRemove(request, env);
    case '/team/leave':      return teamLeave(request, env);
    case '/team/role':       return teamSetRole(request, env);
    case '/team/audit':      return teamAuditLog(request, env);
    case '/team/policy':     return teamSetPolicy(request, env);
    case '/team/sso':        return teamSso(request, env);
    case '/team/data':       return teamData(request, env);
    case '/team/share':      return teamShare(request, env);
    case '/team/shared':     return teamShared(request, env);
    case '/team/unshare':    return teamUnshare(request, env);
    case '/team/project/list':   return teamProjectList(request, env);
    case '/team/project/get':    return teamProjectGet(request, env);
    case '/team/project/create': return teamProjectCreate(request, env);
    case '/team/project/save':   return teamProjectSave(request, env);
    case '/team/project/delete': return teamProjectDelete(request, env);
    case '/team/presence':   return teamPresence(request, env);
    case '/team/tasks':      return teamTasks(request, env);
    case '/team/task/create': return teamTaskCreate(request, env);
    case '/team/task/update': return teamTaskUpdate(request, env);
    case '/v1/messages':     return aiProxy(request, env, ctx);
    case '/v1/messages/count_tokens': return aiCountTokens(request, env);
    case '/v1/messages/batches':         return batchCreate(request, env, ctx);
    case '/v1/messages/batches/list':    return batchList(request, env);
    case '/v1/messages/batches/get':     return batchGet(request, env);
    case '/v1/messages/batches/results': return batchResults(request, env);
    case '/v1/messages/batches/cancel':  return batchCancel(request, env);
    case '/v1/usage':        return usageReport(request, env);
    case '/sms/register':    return smsRegister(request, env);
    case '/waitlist':        return waitlistAdd(request, env);
    case '/sms/incoming':    return smsIncoming(request, env, ctx);
    // --- PAYMENTS (real Stripe + PayPal) ---
    case '/v1/stripe/checkout': return stripeCheckout(request, env);
    case '/v1/stripe/portal':   return stripePortal(request, env);
    case '/v1/stripe/auto-renew': return stripeAutoRenew(request, env);
    case '/v1/stripe/invoices': return stripeInvoices(request, env);
    case '/v1/stripe/webhook':  return stripeWebhook(request, env, ctx);
    case '/v1/credit':          return creditInfo(request, env);
    case '/v1/credit/checkout': return creditCheckout(request, env);
    /* There is no /v1/paypal/create or /v1/paypal/capture. They backed a
       ONE-TIME PayPal order, and a one-time order cannot pay for a monthly
       plan: the capture granted an entitlement with no renewal to expire
       it, no subscription behind it, and no event that would ever revoke
       it. Fifteen dollars once bought Pro for ever, and any signed-in
       account could do it with two curl calls long after the browser flow
       that used them was removed. AMV sells subscriptions; that is what
       the route below is for. */
    case '/v1/paypal/subscribe': return paypalSubscribe(request, env);
    case '/v1/paypal/webhook':  return paypalWebhook(request, env, ctx);
    case '/v1/entitlement':     return getEntitlement(request, env);
    case '/v1/account/export':  return accountExport(request, env);
    // --- MARKETPLACE (community templates) ---
    case '/v1/market/list':     return marketList(request, env);
    case '/v1/market/publish':  return marketPublish(request, env);
    case '/v1/market/install':  return marketInstall(request, env);
    case '/v1/market/buy':      return marketBuy(request, env);
    case '/v1/market/purchases': return marketPurchases(request, env);
    case '/v1/market/mylistings': return marketMyListings(request, env);
    case '/v1/market/unlist':   return marketUnlist(request, env);
    case '/v1/market/earnings': return marketEarnings(request, env);
    case '/v1/market/withdraw': return marketWithdraw(request, env);
    case '/v1/market/status':   return marketSetStatus(request, env);
    case '/v1/market/view':     return marketView(request, env);
    case '/v1/market/rate':     return marketRate(request, env);
    case '/v1/market/review':   return marketReview(request, env);
    case '/v1/market/report':   return marketReport(request, env);
    case '/v1/market/message':  return marketMessage(request, env);
    case '/v1/market/threads':  return marketThreads(request, env);
    case '/v1/market/thread/read': return marketThreadRead(request, env);
    // --- FOUNDER ADMIN (token-gated) ---
    case '/v1/admin/stats':     return adminStats(request, env);
    case '/v1/admin/finance':   return adminFinance(request, env);
    case '/v1/admin/kill':      return adminKill(request, env);
    case '/v1/admin/waitlist/notify': return adminWaitlistNotify(request, env);
    case '/v1/admin/user':      return adminUser(request, env);
    // --- EMBEDDABLE WIDGET ---
    // --- WHAT AMV CAN DO, PER COUNTRY (computed from the registries) ---
    case '/v1/coverage':        return coverageMap(request, env);
    // --- WHAT PEOPLE ALREADY DO EVERY WEEK, WHERE THEY LIVE ---
    case '/v1/everyday':        return everydayJobs(request, env);
    case '/v1/where':           return whereFrom(request);
    case '/v1/connectors':      return connectorDirectory(request, env);
    case '/v1/connector-logo': return connectorLogo(request, env);
    // --- TELEGRAM (official Bot API; the messenger most of the world uses) ---
    case '/v1/telegram/status':     return telegramStatus(request, env);
    case '/v1/telegram/connect':    return telegramConnect(request, env);
    case '/v1/telegram/disconnect': return telegramDisconnect(request, env);
    case '/v1/telegram/send':       return telegramSend(request, env);
    // --- GLOBAL JOB BOARDS (57 boards, 38 countries) ---
    case '/v1/jobs/boards':     return jobBoards(request, env);
    case '/v1/jobs/apply':      return jobApply(request, env);
    // --- GLOBAL MAIL (IMAP/SMTP, the countries in MAIL_PROVIDERS) ---
    case '/v1/mail/providers':  return mailProviders(request, env);
    case '/v1/mail/status':     return mailStatus(request, env);
    case '/v1/mail/connect':    return mailConnect(request, env);
    case '/v1/mail/disconnect': return mailDisconnect(request, env);
    case '/v1/mail/inbox':      return mailInbox(request, env);
    case '/v1/mail/message':    return mailMessage(request, env);
    case '/v1/mail/send':       return mailSend(request, env);
    case '/v1/widget/config':   return widgetConfigGet(request, env);   // owner: read config
    case '/v1/widget/config-public': return widgetConfigPublic(request, env); // public: display fields only
    case '/v1/widget/save':     return widgetConfigSave(request, env);  // owner: create/update config
    case '/v1/widget/chat':     return widgetChat(request, env, ctx);   // public: end-visitor chat (site-key gated)
    case '/widget.js':          return widgetLoader(request, env);      // public: the <script> embed loader
    default: {
      // A browser hitting an unknown URL should get a friendly HTML page;
      // an API client gets JSON. We tell them apart by the Accept header.
      const accept = request.headers.get('Accept') || '';
      if (accept.includes('text/html')) {
        return new Response(
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>404 - Not found</title><style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0e14;color:#e6e6e6;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}.b{text-align:center;padding:24px}.c{font-size:72px;font-weight:800;color:#4c7dff;line-height:1}.t{font-size:22px;margin:12px 0 6px}.s{color:#9aa4b2;margin-bottom:20px}a{display:inline-block;padding:10px 20px;background:#4c7dff;color:#fff;text-decoration:none;border-radius:9px;font-weight:600}</style></head><body><div class="b"><div class="c">404</div><div class="t">Page not found</div><div class="s">This page doesn't exist or may have moved.</div><a href="/">Go home</a></div></body></html>`,
          { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
      return json({ error: 'not found' }, 404);
    }
  }
}

/* ---------------- AUTH: issue a signed session token ---------------- */
