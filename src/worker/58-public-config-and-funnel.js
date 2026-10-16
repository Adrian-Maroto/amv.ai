/* POST /v1/keys/list */
async function apiKeyList(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const rec = (await DB.get(env, 'apikeys', user.email)) || { items: [] };
  return json({ ok: true, keys: (rec.items || []).map(_apiKeyPublic), max: API_KEY_MAX_PER_USER });
}

/* POST /v1/keys/revoke { id } */
async function apiKeyRevoke(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { id } = await request.json().catch(() => ({}));
  /* AMV-210: the hot path stamps lastUsed on this same record once a minute
     per key, so a revoke could be written back over. The KEY still stopped
     working either way - the lookup row below is what the request path reads,
     and deleting it is what revocation really is - but the record would show a
     revoked key as active, which is a screen telling somebody the opposite of
     the truth about a credential. */
  let hash = '';
  const found = await _withKind(env, 'apikeys', user.email, (rec) => {
    const item = (rec.items || []).find(k => k.id === id);
    if (!item) return false;
    hash = item.hash || '';
    if (!item.revoked) item.revoked = Date.now();
    return true;
  }, { items: [] });
  if (!found) return json({ error: 'not found' }, 404);
  /* Delete the lookup too - this is what the request path reads, and deleting
     it is what revocation really is. Marking the record without removing this
     would leave the key working. */
  if (hash) { try { await env.AMV_KV.delete(`apikey:${hash}`); } catch (e) {} }
  audit(env, 'apikey_revoked', { email: user.email, id });
  await _userEvent(env, request, user.email, 'api_key_revoked');
  return json({ ok: true, id, revoked: true });
}

/* Resolve `Authorization: Bearer amv_sk_...` to the account it belongs to, in
   the same shape requireUser returns - so every quota, cost cap and plan check
   downstream applies to an API call exactly as it does to a browser one. */
async function _userFromApiKey(request, env) {
  const raw = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
           || request.headers.get('X-AMV-Key') || '';
  if (!raw.startsWith(API_KEY_PREFIX)) return null;
  let ref = null;
  try { ref = JSON.parse(await env.AMV_KV.get(`apikey:${await _apiKeyHash(raw)}`) || 'null'); } catch (e) {}
  if (!ref || !ref.email) return null;

  const rec = (await DB.get(env, 'apikeys', ref.email)) || { items: [] };
  const item = (rec.items || []).find(k => k.id === ref.id);
  if (!item || item.revoked) return null;

  /* The account still has to exist. Erasure now clears these, but a key that
     authenticates on the strength of a lookup row alone is one orphaned record
     away from being a credential belonging to nobody - and this is the check
     that makes that impossible rather than merely tidy. */
  const acct = await DB.get(env, 'acct', ref.email);
  if (!acct) return null;

  // Last use, so a customer can tell a live key from a forgotten one. Written
  // at most once a minute: this is on the hot path of every API request.
  const now = Date.now();
  if (!item.lastUsed || now - item.lastUsed > 60000) {
    /* Under the lock, and re-found inside it: this runs on every authenticated
       API request, so it is the write most likely to be racing a revoke. */
    try {
      await _withKind(env, 'apikeys', ref.email, (rec2) => {
        const cur = (rec2.items || []).find(k => k.id === ref.id);
        if (!cur) return null;
        cur.lastUsed = now;
        cur.calls = (cur.calls || 0) + 1;
      }, { items: [] });
    } catch (e) {}
    item.lastUsed = now;
  }

  /* The SAME principal a browser session gets. This used to return five fields
     of its own and nothing else, so an API key carried no billing subject, no
     block, and no family limit - see _principalOf. */
  return await _principalOf(env, ref.email, null, { via: 'apikey', keyId: ref.id });
}

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
