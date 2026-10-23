/* =====================================================================
   EMBEDDABLE WIDGET  (the "add AMV chat to any website" feature)
   ---------------------------------------------------------------------
   Model (the same shape any support-chat embed uses):
     1. The site owner (an authenticated AMV user) creates a widget config.
        We mint a PUBLIC site key (pk_...) that is safe to ship in HTML.
     2. They paste a one-line <script src=".../widget.js?k=pk_..."> on their
        site. That loader injects a bubble + an iframe pointing at the AMV
        app in embed mode.
     3. The embedded chat calls POST /v1/widget/chat with the site key. That
        endpoint is PUBLIC (no visitor login) but hard-fenced:
          • the site key must exist and be enabled
          • the request Origin must match an allowed domain on the config
          • per-widget daily message cap  (abuse / cost ceiling)
          • per-widget daily spend cap    (hard margin protection)
          • the global daily spend cap     (shared safety net)
        The model key is NEVER exposed; the model is chosen by the owner
        and clamped server-side. This makes the widget safe to expose to the
        open internet without turning your model into a free public API.
   ===================================================================== */

// Public site keys are safe to embed; we still store a private record keyed by it.
function _newSiteKey() { return 'pk_' + crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8); }

// Normalize an origin/host for comparison ("https://a.com/", "A.com" -> "a.com")
function _host(v) {
  try {
    let s = String(v || '').trim().toLowerCase();
    if (!s) return '';
    if (!/^https?:\/\//.test(s)) s = 'https://' + s;
    return new URL(s).host;
  } catch { return String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''); }
}

// Is this request's Origin allowed by the widget's domain allow-list?
// An empty allow-list means "not yet restricted" - allowed, but we surface a
// warning in the owner UI so they lock it down before going wide.
function _originAllowed(reqOrigin, allowedList) {
  if (!Array.isArray(allowedList) || allowedList.length === 0) return true;
  const oh = _host(reqOrigin);
  if (!oh) return false;
  return allowedList.some(d => {
    const dh = _host(d);
    return dh && (oh === dh || oh.endsWith('.' + dh));
  });
}

// CORS headers for the public widget endpoint: reflect an allowed origin only.
function _widgetCors(reqOrigin, cfg) {
  const allow = _originAllowed(reqOrigin, cfg && cfg.origins) && reqOrigin ? reqOrigin : (cfg && (!cfg.origins || !cfg.origins.length) ? '*' : 'null');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

const WIDGET_DEFAULTS = {
  title: 'Chat with us',
  greeting: 'Hi! How can I help you today?',
  accent: '#4f7cff',
  model: 'amv-core',                 // owner-chosen engine, clamped server-side
  systemPrompt: 'You are a helpful assistant embedded on a website. Be concise, friendly, and accurate. If you do not know something, say so.',
  origins: [],                        // allow-listed domains (empty = unrestricted, warned)
  dailyMsgCap: 500,                  // messages/day across all visitors of this widget
  dailySpendCapUSD: 5,               // $/day hard ceiling for this widget
  maxOut: 1024,                       // per-answer token clamp (cost control)
  enabled: true,
};

/* PUBLIC: display-only config for the embed panel (title, greeting, accent).
   Never returns caps, system prompt, origins, or the owner - just what the
   visitor-facing UI needs to render. Safe to call with the public site key. */
async function widgetConfigPublic(request, env) {
  const url = new URL(request.url);
  const key = (url.searchParams.get('k') || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 120);
  const cfg = key ? await DB.get(env, 'widget', key) : null;
  const cors = { 'Access-Control-Allow-Origin': request.headers.get('Origin') || '*', 'Vary': 'Origin' };
  if (!cfg || !cfg.enabled) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...cors } });
  }
  return new Response(JSON.stringify({ ok: true, config: { title: cfg.title, greeting: cfg.greeting, accent: cfg.accent } }), {
    status: 200, headers: { 'Content-Type': 'application/json', ...cors },
  });
}

/* OWNER: read the caller's widget config (creating a default one on first use). */
async function widgetConfigGet(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in.' }, 401);
  let cfg = await DB.get(env, 'widget_owner', user.email);
  if (!cfg) {
    /* Made once, under the lock. Two first loads at once each made a key, and
       the one not kept stayed live in the public index - a widget that went
       on answering after its owner switched theirs off. */
    let made = false;
    cfg = await _withKind(env, 'widget_owner', user.email, (rec) => {
      if (!rec.key) { Object.assign(rec, { ...WIDGET_DEFAULTS, key: _newSiteKey(), owner: user.email, created: Date.now() }); made = true; }
      return { ...rec };
    }, {});
    if (made) await DB.put(env, 'widget', cfg.key, cfg);   // index by site key for public lookup
  }
  return json({ ok: true, config: cfg });
}

/* OWNER: create/update the widget config. Validates + clamps every field so a
   bad value can't widen cost exposure. The site key is immutable once minted. */
async function widgetConfigSave(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in.' }, 401);
  const blocked = await guardAction(env, `widget:${user.email}`, 20, 500, 'widget saves');
  if (blocked) return blocked;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid body.' }, 400);

  /* AMV-045: TWO RECORDS THAT MUST NOT DISAGREE, WRITTEN WITHOUT A LOCK.

     The lock roster excused this as "the caller's own widget settings; the only
     other writer is this same handler" - which is true and is the problem. Two
     saves from two tabs both read the config, each applies its own subset of
     fields, and the later write puts back a record missing the other's changes.
     The person sees their spend cap revert with nothing having errored.

     Worse, the config is written to TWO keys: the owner's copy and the
     public-lookup copy the widget itself reads. Between those two writes they
     disagree, and a failure between them leaves a widget serving settings its
     owner can no longer see. The site key is minted here on first save, so a
     race can also mint two - one of which the owner never learns about.

     Applied inside the lock, from the record as it is at that moment rather
     than from a copy read beforehand. */
  const clampNum = (v, min, max, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt; };
  let cfg = null;
  await _withKind(env, 'widget_owner', user.email, (rec) => {
    if (!rec.key) Object.assign(rec, { ...WIDGET_DEFAULTS, key: _newSiteKey(), owner: user.email, created: Date.now() });
    // Apply only known, bounded fields
    if (typeof body.title === 'string')       rec.title = body.title.slice(0, 60);
    if (typeof body.greeting === 'string')    rec.greeting = body.greeting.slice(0, 300);
    if (typeof body.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.accent)) rec.accent = body.accent;
    if (typeof body.systemPrompt === 'string') rec.systemPrompt = body.systemPrompt.slice(0, 4000);
    if (typeof body.model === 'string' && (ENGINES[body.model] || RAW_TO_KEY[body.model])) rec.model = RAW_TO_KEY[body.model] || body.model;
    if (Array.isArray(body.origins))          rec.origins = body.origins.map(_host).filter(Boolean).slice(0, 20);
    if (body.dailyMsgCap != null)             rec.dailyMsgCap = clampNum(body.dailyMsgCap, 0, 100000, rec.dailyMsgCap);
    if (body.dailySpendCapUSD != null)        rec.dailySpendCapUSD = clampNum(body.dailySpendCapUSD, 0, 1000, rec.dailySpendCapUSD);
    if (body.maxOut != null)                  rec.maxOut = clampNum(body.maxOut, 128, 4000, rec.maxOut);
    if (typeof body.enabled === 'boolean')    rec.enabled = body.enabled;
    rec.updated = Date.now();
    cfg = rec;
  }, {});
  if (!cfg) return json({ error: 'Could not save the widget settings just now. Please try again.' }, 503);
  /* The public copy, written from what the lock actually stored. Second, so a
     failure between them leaves the owner's record ahead of the public one -
     the direction where the widget serves the older settings rather than
     settings its owner cannot see. */
  await DB.put(env, 'widget', cfg.key, cfg);
  audit(env, 'widget_save', { owner: user.email, key: cfg.key });
  return json({ ok: true, config: cfg });
}

/* PUBLIC: a website visitor's chat turn. Site-key + origin gated, own caps. */
async function widgetChat(request, env, ctx) {
  const reqOrigin = request.headers.get('Origin') || '';
  const body = await request.json().catch(() => null);
  const key = body && typeof body.key === 'string' ? body.key : '';
  const cfg = key ? await DB.get(env, 'widget', key) : null;

  // Unknown key: reply with a generic error and permissive-but-safe CORS so the
  // embedded page can render the message (never leak whether a key exists via CORS).
  if (!cfg || !cfg.enabled) {
    return new Response(JSON.stringify({ error: 'This chat widget is not available.' }), {
      status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': reqOrigin || '*', 'Vary': 'Origin' },
    });
  }
  const wcors = _widgetCors(reqOrigin, cfg);

  if (!_originAllowed(reqOrigin, cfg.origins)) {
    audit(env, 'widget_origin_block', { key, origin: reqOrigin });
    return new Response(JSON.stringify({ error: 'This widget is not enabled for this domain.' }), { status: 403, headers: { 'Content-Type': 'application/json', ...wcors } });
  }
  // AMV-022: per-visitor (IP) throttle so a single abuser can't drain the whole
  // widget's daily budget in a burst. The per-widget message/spend caps below
  // bound the total; this bounds any one caller.
  const vip = _rlIp(request);
  const vRl = await limitAction(env, `widgetip:${key}:${vip}`, 15, 300);
  /* Our fault, not the visitor's: said as a pause, not "slow down" to
     somebody who sent one message (the same rule as guardAction). */
  if (!vRl.ok && vRl.unavailable) {
    return new Response(JSON.stringify({ error: 'The assistant is briefly unavailable. Please try again in a moment.', code: 'limit_unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json', ...wcors } });
  }
  if (!vRl.ok) {
    audit(env, 'widget_visitor_throttle', { key });
    return new Response(JSON.stringify({ error: 'Too many messages - please slow down and try again in a moment.' }), { status: 429, headers: { 'Content-Type': 'application/json', ...wcors } });
  }
  if (!body || !Array.isArray(body.messages)) {
    return new Response(JSON.stringify({ error: 'Invalid request.' }), { status: 400, headers: { 'Content-Type': 'application/json', ...wcors } });
  }

  // Validate + bound the visitor conversation just like the main proxy.
  const vErr = validateMessagesPayload({ messages: body.messages, system: cfg.systemPrompt, max_tokens: cfg.maxOut });
  if (vErr) return new Response(JSON.stringify({ error: vErr }), { status: 400, headers: { 'Content-Type': 'application/json', ...wcors } });

  /* NO MODEL KEY, NO REQUEST. The same guard aiProxy carries, and it was
     missing here: with AMV_MODEL_KEY unset this reserved the widget's caps and
     then called out with `x-api-key: ''`, so a visitor on somebody else's
     website waited for a round trip that could not succeed. A widget failing
     is worse than a chat failing - it is on a customer's own site, in front of
     their customers. */
  if (!_modelKey(env)) {
    audit(env, 'widget_unconfigured', { key });
    try { await alertOnce(env, 'model_key_missing_widget',
      'A website widget was used but AMV has no model key, so it answered nobody. Set AMV_MODEL_KEY.', 60); } catch (e) {}
    return new Response(JSON.stringify({ error: 'This assistant is not available right now.' }),
      { status: 503, headers: { 'Content-Type': 'application/json', ...wcors } });
  }

  /* WHOSE ALLOWANCE THIS COMES OUT OF.

     It came out of nobody's. The meter below was handed a synthetic user
     (`widget:<key}`, plan `widget`) with limits of Infinity, so a widget's
     spend was bounded only by the caps its OWNER sets - and those default to
     $5/day, can be set to 0 meaning no limit, and keep applying long after the
     owner stops paying. Cancel your subscription and your embedded widget goes
     on serving visitors and spending AMV's model budget for ever.

     There is no plan gate on creating a widget either, so the same was true of
     a Free account that never paid anything.

     So the owner's real entitlement is read on every turn and the usage is
     reserved against THEIR allowance, the way a chat turn in their browser
     would be. A paying customer notices nothing. Somebody who has stopped
     paying gets their widget bounded by the free allowance, which is the
     honest answer to "what does a free account get". _planOf is what applies a
     lapsed subscription, so a past-due account degrades on the same clock as
     everything else rather than needing its own rule. */
  const ownerEmail = String(cfg.owner || '').toLowerCase();
  const ownerEnt = ownerEmail ? ((await DB.get(env, 'ent', ownerEmail)) || {}) : {};
  /* familyOf is carried on the entitlement (ENT_CARRY_KEYS), so the parent's
     record can be read without a second lookup on every widget turn. Without
     it ownerUser has no family at all and _monthlyCeilingUSD would answer with
     the plan backstop alone - which is how a capped child's widget would keep
     spending past the limit their parent set. */
  const ownerFam = ownerEmail ? await _familyOf(env, ownerEmail, ownerEnt) : null;
  const ownerUser = { email: ownerEmail || ('widget:' + key), plan: _planOf(ownerEnt),
                      customCfg: ownerEnt.custom || null, bonusTokens: ownerEnt.bonusTokens || 0,
                      family: ownerFam,
                      blocked: !!ownerEnt.blocked, blockedReason: ownerEnt.blockedReason || '' };
  /* A widget spends the OWNER's money, whoever is typing into it, so the
     owner's hold stops it - otherwise the one spending path that keeps running
     after a chargeback is the one embedded on a public website, where the
     person who charged back does not even have to be present.

     The visitor is told the assistant is unavailable and nothing else. They
     are a stranger on somebody else's site; the state of that person's account
     is not theirs to learn.

     Nothing has been reserved at this point - the message cap and the token
     reservation are both below - so there is nothing to give back. */
  if (await _accountHold(env, ownerUser, 'widget')) {
    return new Response(JSON.stringify({ error: 'This assistant is unavailable right now. Please try again later.' }),
      { status: 503, headers: { 'Content-Type': 'application/json', ...wcors } });
  }
  const ownerLimits = effectiveLimits(ownerUser);
  const ownerSubject = ownerEnt.teamId ? ('team:' + ownerEnt.teamId) : (ownerEmail || ('widget:' + key));

  const key2 = RAW_TO_KEY[cfg.model] || (ENGINES[cfg.model] ? cfg.model : 'amv-core');
  const eng = ENGINES[key2];

  /* Per-widget DAILY MESSAGE cap, reserved atomically.

     This said "atomic test-and-increment" and was a read, a comparison, and an
     increment forty lines apart. Requests arriving together all read the same
     value, all pass, and all increment - so the cap is exceeded by however many
     were in flight, which on a public endpoint is however many a caller cares
     to send at once. The per-IP throttle bounds one caller; it does nothing
     about a distributed burst, which is the case a cap on a PUBLIC endpoint
     exists for.

     `reserve` is the operation the counter already has for this, and it is
     what every other dollar and token ceiling uses. A cap of 0 means unlimited, so that case
     counts without a ceiling rather than reserving against zero and refusing
     everything. */
  const msgName = `wmsg:${key}:${todayKey()}`;
  const msgCap = cfg.dailyMsgCap > 0 ? cfg.dailyMsgCap : 0;
  const msgRes = msgCap
    ? await counter(env, msgName, { op: 'reserve', amount: 1, cap: msgCap, ttlMs: 86400000 * 2 })
    : { allowed: true };
  if (!msgRes.allowed) {
    audit(env, 'widget_msg_cap', { key });
    return new Response(JSON.stringify({ error: 'This assistant has reached its daily message limit. Please try again tomorrow.' }), { status: 429, headers: { 'Content-Type': 'application/json', ...wcors } });
  }
  /* Reserved above, so every path from here that does NOT reach the model has
     to give it back or a rejected request permanently costs the owner one. */
  const refundMsg = async () => {
    if (!msgCap) return;
    try { await counter(env, msgName, { op: 'incr', amount: -1, ttlMs: 86400000 * 2 }); } catch (e) {}
  };

  /* THE OWNER'S DOLLAR CEILING, which every other spending path consults.

     The widget was bounded by three things and none of them was this one: a
     per-widget message cap, a per-widget daily spend cap the owner sets (and
     which defaults to unlimited), and the owner's TOKEN allowance. Tokens are
     a count. The ceiling that stops chat and SMS is a dollar
     figure - the lower of the plan's cost backstop and a parent's monthly
     limit - and a widget belonging to a capped account ran past it, because
     the widget asked a different question.

     Checked against the owner's billing subject, since a widget spends the
     owner's money whoever is typing into it on somebody else's website. */
  const ownerCeiling = _monthlyCeilingUSD(ownerUser);
  /* AMV-004: what this turn can cost at most, booked against all three dollar
     ceilings before the model runs. The widget is the surface where genuine
     concurrency is easiest to produce - it is public, and anybody can open the
     page in twenty tabs - so it is the worst place to be reading a total and
     charging afterwards. Settled by meterStream against what the turn really
     cost. */
  const wMaxOut = Math.min(cfg.maxOut || eng.maxOut, eng.maxOut);
  const wEstUSD = (((_estimateReserveInput({ messages: body.messages }) + AI_INJECTED_INPUT_TOK) * AI_INPUT_SAFETY) / 1e6) * eng.inCost
                + (wMaxOut / 1e6) * eng.outCost;
  const ownerCostName = `cost:${ownerSubject}:${_periodKeyOf(ownerUser)}`;
  let bookedOwnerUSD = 0, bookedWidgetUSD = 0, bookedGlobalW = 0;
  const releaseWidgetUSD = async () => {
    if (bookedOwnerUSD > 0) { await _releaseUSD(env, ownerCostName, bookedOwnerUSD, 86400000 * 70); bookedOwnerUSD = 0; }
    if (bookedWidgetUSD > 0) { await _releaseUSD(env, wSpendName, bookedWidgetUSD, 86400000 * 70); bookedWidgetUSD = 0; }
    if (bookedGlobalW > 0) { await _releaseUSD(env, `spend:${todayKey()}`, bookedGlobalW, 86400000 * 2); bookedGlobalW = 0; }
  };
  const wSpendName = `wspend:${key}:${todayKey()}`;
  if (ownerCeiling != null) {
    let oc = null;
    try {
      oc = await _reserveUSD(env, ownerCostName, wEstUSD, ownerCeiling, 86400000 * 70);
      bookedOwnerUSD = oc.reserved;
    }
    catch (e) { audit(env, 'spend_gate_blind', { what: 'widget', scope: 'account', error: String((e && e.message) || e) }); }
    if (oc && !oc.allowed) {
      audit(env, 'widget_owner_cap', { key, subject: ownerSubject });
      await refundMsg();
      /* A stranger on somebody else's website is told nothing about that
         person's billing - only that the assistant is not available. */
      return new Response(JSON.stringify({ error: 'This assistant is unavailable right now. Please try again later.' }),
        { status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) } });
    }
  }

  // Per-widget DAILY SPEND cap (hard margin protection for the owner).
  if (cfg.dailySpendCapUSD > 0) {
    const capRes = await _reserveUSD(env, wSpendName, wEstUSD, cfg.dailySpendCapUSD, 86400000 * 70);
    bookedWidgetUSD = capRes.reserved;
    if (!capRes.allowed) {
      audit(env, 'widget_spend_cap', { key });
      await refundMsg();
      await releaseWidgetUSD();
      return new Response(JSON.stringify({ error: 'This assistant is unavailable right now. Please try again later.' }), { status: 429, headers: { 'Content-Type': 'application/json', ...wcors } });
    }
  }

  /* THE OWNER'S OWN ALLOWANCE, reserved before the model is called.

     Metering after the fact records a cost; it does not stop one. This is what
     actually bounds a widget belonging to somebody who has stopped paying: the
     turn is reserved against their daily and monthly plan allowance exactly as
     a turn typed in their own browser would be, and refused when it is gone.

     Refused politely, and without telling a stranger on somebody else's
     website anything about that person's billing. */
  const wReserve = _estimateReserveInput({ messages: body.messages })
                 + Math.max(1, Math.min(cfg.maxOut || 1024, 200000));
  const ownerDayName = `usg:${ownerSubject}:${todayKey()}`;
  const ownerMonthName = `usg:${ownerSubject}:${_periodKeyOf(ownerUser)}`;
  const oDay = await counter(env, ownerDayName, { op: 'reserve', amount: wReserve, cap: ownerLimits.dayTokens, ttlMs: 86400000 * 35 });
  if (!oDay.allowed) {
    audit(env, 'widget_owner_quota', { key, owner: ownerEmail, scope: 'day' });
    await refundMsg();
    await releaseWidgetUSD();
    return new Response(JSON.stringify({ error: 'This assistant has reached its limit for today. Please try again tomorrow.' }),
      { status: 429, headers: { 'Content-Type': 'application/json', ...wcors } });
  }
  const oMonth = await counter(env, ownerMonthName, { op: 'reserve', amount: wReserve, cap: ownerLimits.monthTokens, ttlMs: 86400000 * 70 });
  if (!oMonth.allowed) {
    audit(env, 'widget_owner_quota', { key, owner: ownerEmail, scope: 'month' });
    try { await counter(env, ownerDayName, { op: 'incr', amount: -wReserve, ttlMs: 86400000 * 35 }); } catch (e) {}
    await refundMsg();
    await releaseWidgetUSD();
    return new Response(JSON.stringify({ error: 'This assistant is unavailable right now. Please try again later.' }),
      { status: 429, headers: { 'Content-Type': 'application/json', ...wcors } });
  }
  /* Every path from here that does not reach the model gives both back. */
  const refundOwner = async () => {
    try { await counter(env, ownerDayName, { op: 'incr', amount: -wReserve, ttlMs: 86400000 * 35 }); } catch (e) {}
    try { await counter(env, ownerMonthName, { op: 'incr', amount: -wReserve, ttlMs: 86400000 * 70 }); } catch (e) {}
    /* And the dollars. Every path that gives the tokens back has to give these
       back too, or a refused turn permanently consumes the owner's monthly
       budget for work that never ran. */
    await releaseWidgetUSD();
  };

  // GLOBAL daily spend cap (shared safety net across the whole platform).
  const gName = `spend:${todayKey()}`;
  const gCap = parseFloat(env.GLOBAL_DAILY_USD_CAP || '500');
  const gRes = await _reserveUSD(env, gName, wEstUSD, gCap, 86400000 * 2);
  bookedGlobalW = gRes.reserved;
  if (!gRes.allowed) {
    await refundMsg(); await refundOwner();
    return new Response(JSON.stringify({ error: 'Service is at capacity. Please try again later.' }), { status: 503, headers: { 'Content-Type': 'application/json', ...wcors } });
  }

  const maxTokens = Math.min(cfg.maxOut || eng.maxOut, eng.maxOut);
  const upstreamBody = {
    model: eng.model,
    max_tokens: maxTokens,
    stream: true,
    system: [{ type: 'text', text: _systemWithIdentity(cfg.systemPrompt || WIDGET_DEFAULTS.systemPrompt),
               cache_control: { type: 'ephemeral' } }],
    messages: body.messages,
  };

  // stream:true - the widget streams this straight through to the visitor.
  /* The same hole chat had, and worse here: a throw from _modelFetch left the
     widget's daily message booked AND the owner's tokens reserved, and it left
     without the widget's CORS headers - so the page on somebody else's site
     could not even read the error to say anything to the visitor. */
  let upstream;
  try {
    upstream = await _modelFetch(env, upstreamBody, { stream: true });
  } catch (netErr) {
    await refundMsg(); await refundOwner();
    try { await _workerError(env, 'widgetChat:unreachable', netErr); } catch (_) {}
    try { await alertOnce(env, 'model_unreachable',
      'AMV cannot reach the model endpoint at all (network error, not an error status). Chat is failing for everyone. '
      + 'Check AMV_MODEL_URL and the provider’s status.', 10); } catch (_) {}
    return new Response(JSON.stringify({ error: 'The assistant is unavailable right now. Please try again in a moment.' }),
      { status: 503, headers: { 'Content-Type': 'application/json', ...wcors } });
  }

  if (!upstream.ok) {
    const e = await upstream.json().catch(() => ({}));
    await refundMsg(); await refundOwner();   // nothing was generated, so nothing was used
    return new Response(JSON.stringify({ error: e?.error?.message || 'The assistant is unavailable.' }), { status: 502, headers: { 'Content-Type': 'application/json', ...wcors } });
  }

  // tee: stream to the visitor AND meter cost into this widget's + global counters
  const [toClient, toMeter] = upstream.body.tee();
  ctx.waitUntil(meterStream(toMeter, eng, {
    /* The OWNER's allowance counters - the ones the reservation above was
       taken from. meterStream reconciles `reserved` against dName/mName, so
       these have to be the same pair or the reservation is never given back
       and a widget permanently over-charges its owner for the difference
       between what a turn might cost and what it did.

       These used to be `wtok:<key>` informational tallies that nothing in the
       product ever read, beside a synthetic user with limits of Infinity. */
    dName: ownerDayName,
    mName: ownerMonthName,
    reserved: wReserve,
    gName,                                    // shares the global spend cap
    costName: wSpendName,                     // per-widget spend counter (the hard cap above)
    /* AND the owner's own account ledger, which widget traffic never touched.
       The owner's monthly ceiling is CHECKED at the top of this handler against
       `cost:<subject>` and the metering wrote `wspend:<key>`, so that ceiling
       could not be reached by a widget no matter how much it was used. */
    acctCostName: ownerCostName,
    reservedUSD: bookedWidgetUSD,
    reservedGlobalUSD: bookedGlobalW,
    reservedAcctUSD: bookedOwnerUSD,
    user: ownerUser,
    env, limits: ownerLimits,
    reqMessages: body.messages,
    feature: 'widget',
  }));

  return new Response(toClient, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...wcors },
  });
}

/* PUBLIC: the embed loader. A site owner adds ONE line to their HTML:
     <script src="https://YOUR_WORKER/widget.js?k=pk_...&host=https://app.yourdomain.com" async></script>
   It injects a floating bubble that opens an iframe to the AMV app in embed
   mode. Served as real JavaScript with long cache + permissive CORS (it's a
   public asset). The site key travels in the iframe URL; all trust decisions
   happen server-side in /v1/widget/chat, so exposing the key here is safe. */
async function widgetLoader(request, env) {
  const url = new URL(request.url);
  const k = (url.searchParams.get('k') || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 120);
  // The app host to embed. Prefer an explicit ?host=, else an env default, else
  // this Worker's own origin (works when the app is served from the same place).
  const appHost = (url.searchParams.get('host') || env.APP_ORIGIN || env.APP_URL || url.origin).replace(/\/+$/, '');
  const js = _widgetLoaderJS(k, appHost);
  return new Response(js, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function _widgetLoaderJS(key, appHost) {
  // The loader is intentionally tiny and dependency-free. It creates a launcher
  // button and an iframe (the actual chat UI lives in the AMV app at #embed).
  const iframeSrc = appHost + '/#embed=1&k=' + encodeURIComponent(key);
  return `(function(){
  if(window.__AMV_WIDGET__) return; window.__AMV_WIDGET__=1;
  var KEY=${JSON.stringify(key)}, SRC=${JSON.stringify(iframeSrc)};
  var open=false, wrap, frame, btn;
  function el(t,s){var e=document.createElement(t); if(s) e.setAttribute('style',s); return e;}
  function build(){
    btn=el('button','position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;background:#4f7cff;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.25);z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .15s');
    btn.setAttribute('aria-label','Open chat');
    btn.innerHTML='<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    btn.onmouseenter=function(){btn.style.transform='scale(1.06)';};
    btn.onmouseleave=function(){btn.style.transform='scale(1)';};
    wrap=el('div','position:fixed;bottom:92px;right:20px;width:390px;height:600px;max-width:calc(100vw - 32px);max-height:calc(100vh - 120px);border-radius:16px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.32);z-index:2147483000;display:none;background:#fff');
    frame=el('iframe','width:100%;height:100%;border:none;');
    frame.setAttribute('title','AMV chat'); frame.setAttribute('allow','clipboard-write');
    frame.src=SRC;
    wrap.appendChild(frame);
    btn.onclick=function(){ open=!open; wrap.style.display=open?'block':'none'; btn.style.transform='scale(1)'; };
    document.body.appendChild(wrap); document.body.appendChild(btn);
  }
  /* AMV-044: THE X INSIDE THE PANEL, AND NOBODY ELSE.

     This listened for a message and acted on it without asking where it came
     from. The listener runs on the CUSTOMER'S OWN SITE - AMV's script, on
     somebody else's page - so every frame on that page, and every window with a
     handle to it, could send {__amvWidget:'close'} and be obeyed.

     Closing a panel is a small thing to be able to do. The listener is not: it
     is an open channel into a script running on a third party's site, and the
     moment this protocol grows a second verb - open it, point it somewhere,
     hand it a session - the same code obeys that from anywhere too. The cost of
     checking is two comparisons.

     Both checks, because either alone leaves a way in: the ORIGIN alone would
     accept any frame served from the app host, including one an attacker
     embedded themselves, and the SOURCE alone would accept a window that
     happens to be the frame but is showing something else. */
  var APP_ORIGIN=(function(){ try{ return new URL(SRC).origin; }catch(e){ return ''; } })();
  window.addEventListener('message',function(e){
    if(!e || !APP_ORIGIN || e.origin!==APP_ORIGIN) return;
    if(!frame || e.source!==frame.contentWindow) return;
    if(e.data && e.data.__amvWidget==='close'){ open=false; if(wrap) wrap.style.display='none'; }
  });
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',build); else build();
})();`;
}

/* ---------------- alerting (webhook) ------------------------------- */
async function notify(env, msg) {
  if (!env.ALERT_WEBHOOK) return;
  try { await fetchDeadline(env.ALERT_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '[AMV] ' + msg }) }); } catch {}
}

/* Throttled alert: fire at most once per `key` per `windowMin` minutes, so a
   recurring failure pages you the FIRST time (when you can still act) without
   burying you in thousands of duplicate messages. Critical money/security
   events use a short window; noisy ones use a long one. Returns quietly if no
   webhook is configured - alerting is opt-in via ALERT_WEBHOOK. */
async function alertOnce(env, key, msg, windowMin = 30) {
  if (!env.ALERT_WEBHOOK) return;
  try {
    const k = `alerted:${key}`;
    if (await env.AMV_KV.get(k)) return;            // already alerted this window
    await env.AMV_KV.put(k, '1', { expirationTtl: Math.max(60, windowMin * 60) });
    await notify(env, msg);
  } catch { /* alerting must never break the request */ }
}

