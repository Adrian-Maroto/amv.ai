/* =====================================================================
   AMV-095  IS IT ANY GOOD?

   Cost, latency, margin, abuse and growth are all instrumented. Answer
   QUALITY is not measured anywhere at all - which means a routing change, a
   prompt edit or a model swap could make AMV materially worse and every
   dashboard would stay green. The one number that decides whether people stay
   is the one nobody can see.

   So a rating on an answer is counted, per engine, per month. What is NOT
   stored is the important part: no message text, no prompt, no answer, not a
   snippet. Storing conversations to measure quality would trade the thing
   being measured for the measurement. Engine, feature, a coarse reason and a
   timestamp is enough to answer "did that change make it worse", and is not
   worth stealing.
   ===================================================================== */

const FEEDBACK_REASONS = new Set(['wrong', 'incomplete', 'ignored_instructions', 'too_slow', 'other']);

/* ══════════════════════════════════════════════════════════════════════
   PUBLIC CONFIG - the handful of values a VISITOR's browser needs.

   The Worker holds GOOGLE_CLIENT_ID, and the browser did not - so "Continue
   with Google", the first button on the sign-up sheet, was dead for everybody
   except the owner, who had pasted the id into their own Settings. Same shape
   as the backend URL: configuration that lived in one person's localStorage
   while every visitor needed it.

   ONLY values that are public by design go in here. A Google client id, a
   Turnstile SITE key and a support address all appear in plain sight in
   ordinary use - in the OAuth URL, in the captcha widget's own markup, on the
   contact page. And only values a browser actually USES: the PayPal client id
   was served here until the browser-side PayPal SDK was removed, and an
   unused public value is still surface for nothing. Nothing
   that could sign, spend or authenticate is served: not STRIPE_SECRET_KEY, not
   TURNSTILE_SECRET, not GOOGLE_CLIENT_SECRET, not JWT_SECRET. A missing value
   is simply absent, so this also cannot be used to enumerate which secrets a
   deployment has - that is the admin readiness endpoint's job, behind a token.
   ══════════════════════════════════════════════════════════════════════ */
const PUBLIC_CONFIG_KEYS = [
  ['googleClientId',  'GOOGLE_CLIENT_ID'],
  ['supportEmail',    'SUPPORT_EMAIL'],
  /* A Turnstile SITE key is public by design - it sits in the HTML of every
     site that uses one. The SECRET is the other half and never leaves here.
     Without this the widget cannot render, no token is produced, and
     _verifyCaptcha refuses every sign-up and sign-in the moment
     TURNSTILE_SECRET is set. */
  ['turnstileSiteKey','TURNSTILE_SITE_KEY'],
];
/* ══════════════════════════════════════════════════════════════════════
   THE TOP OF THE FUNNEL - people who arrive and never sign up.

   _funnelMark already answers everything from signup onwards: signed up,
   got value, came back, paid. It cannot see the largest group there is, the
   people who looked at the page and left, so the one number that decides
   whether any of the marketing works - visitors who become accounts - was not
   computable from anything AMV held.

   The obvious fix was to serve an analytics endpoint to the browser and let
   `track()` beacon to it. That means a third party receiving a record of every
   visitor, a CSP widened to let it, and somebody else's cookie policy becoming
   AMV's problem. For ONE number.

   So this is first-party and deliberately impoverished. It increments a daily
   COUNTER. There is no identifier of any kind in it - no id, no address, no
   user agent, no referrer, nothing that could later be joined to a person -
   which is why it needs no consent banner to be honest and no processor
   agreement to be lawful. It cannot answer "who", only "how many", and how
   many is the entire question.

   Rate limited per IP because it is unauthenticated, and one visit per session
   is enforced by the browser rather than trusted from it - a caller who lies
   inflates a number that only they read. */
async function recordVisit(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (ip) {
    /* Generous: a person opening AMV in several tabs is normal. Bounded:
       an unauthenticated counter is otherwise free to inflate. */
    const r = await limitAction(env, `visit:${ip}`, 10, 200);
    if (!r.ok) return json({ ok: true, counted: false });
  }
  try { await _recordGrowth(env, 'visit'); } catch (e) {}
  return json({ ok: true, counted: true });
}

async function publicConfig(request, env) {
  /* Unauthenticated by necessity - it is read before anybody has an account -
     so it is bounded per IP like the other open endpoints. */
  const ip = request.headers.get('CF-Connecting-IP') || 'anon';
  const blocked = await guardAction(env, `pubcfg:${ip}`, 30, 2000, 'config reads');
  if (blocked) return blocked;

  const out = { ok: true };
  /* WHICH PLANS CAN BE BOUGHT BY THE YEAR, so the page can offer the choice
     only where it will work. A toggle that leads to "not configured" is a
     toggle that should not have been drawn.

     The plan NAMES, never the price ids: the client needs to know the option
     exists, not what it is called at Stripe. */
  try{
    const yearly = [];
    for (const p of ['pro', 'elite', 'ultra', 'team']) {
      if (_stripePriceId(env, p, 'year')) yearly.push(p);
    }
    if (yearly.length) out.yearlyPlans = yearly;
  }catch(e){}
  for (const [field, secret] of PUBLIC_CONFIG_KEYS) {
    const v = String((env && env[secret]) || '').trim();
    if (v) out[field] = v;
  }
  /* WHETHER THE SESSION TRAVELS IN A COOKIE, said before anybody signs in.

     The refresh token is set as a cookie on the API's own host, and a browser
     keeps a cookie from a cross-origin response only if the request asked it
     to (credentials: 'include'). The page cannot ask for that on a deployment
     without the cookie - there the API answers `*`, and a credentialed request
     to `*` is refused outright - so it has to know which kind this is BEFORE
     the sign-in request, not from the sign-in response. Not a secret: it is
     the same fact the CORS headers already state. */
  if (_cookieAuthOn(env)) out.cookieSession = true;
  /* Which halves of server speech are switched on, so the page offers
     transcription and spoken answers only where they will work, and keeps the
     browser's own voice where they will not. Never the supplier or a price. */
  if (_speechListenOn(env) || _speechSpeakOn(env)) out.speech = { listen: _speechListenOn(env), speak: _speechSpeakOn(env) };
  /* Whether searches can score passages by meaning too (79-meaning.js). */
  if (_meaningOn(env)) out.meaning = true;
  /* Built directly rather than through json(), which takes only a body and a
     status - a third argument would have been silently ignored and the cache
     header would never have been sent. Five minutes is long enough to spare
     the Worker a request per page load and short enough that rotating a client
     id takes effect while you are still watching. */
  return new Response(JSON.stringify(out), { status: 200, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300',
    ...CORS, ...SECURITY_HEADERS } });
}

async function feedbackRecord(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  // Cheap to send and easy to spam, so it is bounded like anything else.
  const blocked = await guardAction(env, `fb:${user.email}`, 30, 300, 'ratings');
  if (blocked) return blocked;

  const body = await request.json().catch(() => ({}));
  const rating = body.rating === 'up' ? 'up' : (body.rating === 'down' ? 'down' : null);
  if (!rating) return json({ error: 'rating must be up or down' }, 400);
  const engine = ENGINES[body.engine] ? body.engine : (RAW_TO_KEY[body.engine] || 'unknown');
  const feature = String(body.feature || 'chat').replace(/[^a-z_]/gi, '').slice(0, 24) || 'chat';
  const reason = FEEDBACK_REASONS.has(body.reason) ? body.reason : '';

  const mk = monthKey();
  await counter(env, `qual:${engine}:${rating}:${mk}`, { op: 'incr', amount: 1, ttlMs: 86400000 * 400 });
  await counter(env, `qualfeat:${feature}:${rating}:${mk}`, { op: 'incr', amount: 1, ttlMs: 86400000 * 400 });
  if (rating === 'down' && reason) {
    await counter(env, `qualwhy:${reason}:${mk}`, { op: 'incr', amount: 1, ttlMs: 86400000 * 400 });
  }
  /* Deliberately not audited with any content. The event itself is the record. */
  return json({ ok: true });
}

