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

/* ══════════════════════════════════════════════════════════════════════
   SUPPORT - a bug report that reaches a person.

   There was nowhere for one to go. The in-app report wrote to localStorage and
   only transmitted if `amv_feedback_endpoint` was set, a key no screen in the
   product could write, and /v1/feedback is the thumbs up/down counter above,
   which deliberately stores no content and would have refused a sentence. So
   somebody reporting a broken payment was thanked and their report sat in
   their own browser for ever.

   The screen at least stopped claiming otherwise. It still left a product that
   takes money with no way to be told it is broken, which is a refund and a
   chargeback for every problem that could have been a reply.

   Stored under the reporter's own email, which is not incidental: it is what
   puts support tickets on PER_USER_KINDS, so they are erased with the account
   and included in a data export like everything else the server holds. A
   support inbox is one of the easiest places to accumulate personal data that
   outlives the person who wrote it. */
const SUPPORT_MAX_LEN = 4000;
const SUPPORT_KEEP = 20;              // per account, newest first
const SUPPORT_KINDS = new Set(['bug', 'idea', 'billing', 'account', 'other']);

async function supportSubmit(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in first, or email support directly' }, 401);
  /* Reaching a human is worth spending real money on, so it is worth abusing.
     Generous for a person with a bad day, useless as an amplifier. */
  const blocked = await guardAction(env, `support:${user.email}`, 5, 20, 'support messages');
  if (blocked) return blocked;

  const body = await request.json().catch(() => ({}));
  const text = String(body.text || '').trim().slice(0, SUPPORT_MAX_LEN);
  if (text.length < 5) return json({ error: 'please describe what happened' }, 400);
  const kind = SUPPORT_KINDS.has(body.kind) ? body.kind : 'other';
  /* Context the reporter did not have to think to include, and nothing more.
     No conversation content: somebody reporting that chat is broken has not
     agreed to send us what they were chatting about. */
  const ticket = {
    id: 'sup_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    kind, text, at: Date.now(),
    plan: String(body.plan || '').slice(0, 16),
    tab: String(body.tab || '').replace(/[^a-z_-]/gi, '').slice(0, 24),
    app: String(body.app || '').slice(0, 24),
    status: 'open',
  };

  /* AMV-033: two tickets submitted from two tabs both read the list, both
     prepend, and the later write loses the earlier ticket - somebody who asked
     for help and was told it was sent. */
  await _withKind(env, 'support', user.email, (rec) => {
    rec.tickets = [ticket].concat(Array.isArray(rec.tickets) ? rec.tickets : []).slice(0, SUPPORT_KEEP);
    rec.updatedAt = Date.now();
