  if(!SHARE_ID_RE.test(String(id||''))) return notFound('That link is not valid');
  const rec = await DB.get(env, 'share', id);
  if(!rec) return notFound('This conversation is no longer shared');
  /* Anything created before this choice existed was created under a promise of
     "not indexed". It keeps that promise: only an explicit true opts in. */
  const listed = rec.listed === true;

  const base = (env.APP_URL || '').replace(/\/$/, '') || new URL(request.url).origin;
  // Only offered when an address is actually configured - a Report link that
  // goes nowhere is worse than none.
  const reportTo = String(env.SUPPORT_EMAIL || '').trim();
  const title = _shareEsc(rec.title || 'Shared conversation');
  // The preview description is the opening question, which is what makes a
  // shared link worth clicking.
  const first = (rec.msgs.find(m => m.r === 'u') || rec.msgs[0] || {}).c || '';
  const desc = _shareEsc(String(first).replace(/\s+/g, ' ').slice(0, 180));
  const turns = rec.msgs.map(m =>
    '<div class="m ' + (m.r === 'u' ? 'u' : 'a') + '">' +
      '<div class="who">' + (m.r === 'u' ? 'Asked' : 'AMV') + '</div>' +
      '<div class="t">' + _shareEsc(m.c) + '</div></div>').join('');

  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + ' - AMV.AI</title>' +
    '<meta name="description" content="' + desc + '">' +
    (listed ? '' : '<meta name="robots" content="noindex,nofollow">') +
    // The tags that make a pasted link render as a card instead of a bare URL.
    '<meta property="og:type" content="article">' +
    '<meta property="og:site_name" content="AMV.AI">' +
    '<meta property="og:title" content="' + title + '">' +
    '<meta property="og:description" content="' + desc + '">' +
    '<meta property="og:url" content="' + _shareEsc(_publicOrigin(request) + '/c/' + id) + '">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    '<meta name="twitter:title" content="' + title + '">' +
    '<meta name="twitter:description" content="' + desc + '">' +
    '<style>' +
    ':root{color-scheme:light dark}' +
    'body{font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;background:#0d0d0f;color:#e8e8ea}' +
    '@media(prefers-color-scheme:light){body{background:#fbfbfc;color:#18181b}.m.a{background:#fff;border-color:#e6e6ea}.m .who{color:#666}}' +
    '.wrap{max-width:720px;margin:0 auto;padding:28px 20px 64px}' +
    '.top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:28px;flex-wrap:wrap}' +
    '.brand{font-weight:700;letter-spacing:-.02em}' +
    '.cta{display:inline-block;padding:8px 18px;border-radius:999px;background:#5590ff;color:#fff;text-decoration:none;font-size:14px;font-weight:500}' +
    'h1{font-size:23px;line-height:1.3;margin:0 0 22px}' +
    '.m{margin:0 0 14px;padding:13px 16px;border:1px solid #26262b;border-radius:12px;background:#141418}' +
    '.m.u{background:none;border-style:dashed}' +
    '.who{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#8a8a92;margin-bottom:6px}' +
    '.t{white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}' +
    '.foot{margin-top:34px;padding-top:20px;border-top:1px solid #26262b;font-size:13.5px;color:#8a8a92}' +
    '.foot a{color:#5590ff}' +
    '</style></head><body><div class="wrap">' +
    '<div class="top"><span class="brand">AMV.AI</span>' +
    '<a class="cta" href="' + _shareEsc(base) + '">Try AMV free</a></div>' +
    '<h1>' + title + '</h1>' + turns +
    /* Two things this footer has to do. Sell AMV - and be straight about what
       the page is. The transcript was uploaded by whoever made the link; AMV
       cannot verify that it is unedited, so the page must not present it as
       AMV vouching for the content, and there must be a way to report it. That
       reporting route is what makes a takedown possible at all. */
    '<div class="foot">Shared by an AMV user. AMV.AI hosts this page but does not verify or endorse its contents. ' +
    '<a href="' + _shareEsc(base) + '">Try AMV free</a>' +
    (reportTo ? ' &middot; <a href="mailto:' + _shareEsc(reportTo) +
      '?subject=' + encodeURIComponent('Report shared page ' + id) + '">Report this page</a>' : '') +
    '</div>' +
    '</div></body></html>';

  return new Response(html, { status: 200, headers: {
    'Content-Type': 'text/html; charset=utf-8',
    /* Short, and revalidated. A shared page is revoked from the privacy screen
       the moment someone changes their mind, and a five-minute public cache
       meant the link kept working after the app had told them it was dead.
       Sixty seconds still absorbs the burst a link gets when it is posted. */
    'Cache-Control': 'public, max-age=60, must-revalidate',
    ...(listed ? {} : { 'X-Robots-Tag': 'noindex, nofollow' }),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // No scripts at all: this page renders text AMV produced, to strangers.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  }});
}

/* =====================================================================
   AMV-070: A DROPPED CONNECTION SHOULD NOT COST THE ANSWER.

   The meter runs on a tee of the stream inside waitUntil, so when a client
   disconnects mid-answer the model keeps generating and AMV keeps paying for
   every output token - and the user gets nothing. They then retry, and pay for
   the whole thing a second time. On mobile, where connections drop routinely,
   that is a real double charge on the business and a lost answer for the user.

   The meter is already reading every byte, so it assembles the text as it goes
   and parks the finished answer for a few minutes. A client that lost its
   connection asks for it back instead of regenerating.

   Bounded on purpose: only answers long enough to be worth recovering, capped
   in size, and short-lived. This is a recovery buffer, not storage - the real
   copy is the conversation the client saves.
   ===================================================================== */
const RESUME_TTL_S = 900;                 // 15 minutes
const RESUME_MIN_CHARS = 200;             // not worth a KV write below this
const RESUME_MAX_CHARS = 120000;
async function _parkAnswer(env, email, reqId, text) {
  try {
    if (!env || !env.AMV_KV || !reqId || !email) return;
    const body = String(text || '');
    if (body.length < RESUME_MIN_CHARS) return;
    await env.AMV_KV.put('resume:' + email.toLowerCase() + ':' + reqId,
      JSON.stringify({ text: body.slice(0, RESUME_MAX_CHARS), at: Date.now() }),
      { expirationTtl: RESUME_TTL_S });
  } catch (e) { /* recovery is best-effort; never break the response for it */ }
}
/* Hand back an answer the client lost. Scoped to the caller's own account, so
   one user can never read another's recovered response. */
async function resumeAnswer(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return json({ error: 'bad id' }, 400);
  const raw = await env.AMV_KV.get('resume:' + user.email.toLowerCase() + ':' + id);
  if (!raw) return json({ ok: false, code: 'not_ready' });
  let d = null; try { d = JSON.parse(raw); } catch (_) { return json({ ok: false, code: 'not_ready' }); }
  return json({ ok: true, text: d.text || '', at: d.at || 0 });
}

/* STOP MEANS STOP - AND A DROPPED CONNECTION STILL DOES NOT COST THE ANSWER.

   The model's stream used to be tee()d: one branch to the browser, one to the
   meter. A browser that went away cancelled only its own branch, and tee()
   went on pulling the source for the meter - so the model always finished the
   answer, the provider billed all of it, and the person who pressed Stop was
   charged for every word they had refused.

   That behaviour was half deliberate. On a phone moving between networks the
   connection drops mid-answer, and finishing the answer and parking it
   (_parkAnswer) is what lets the app collect it instead of paying twice. The
   server cannot tell a Stop from a drop by looking at the connection - both
   are a client that went away.

   So a Stop says so. The app posts /v1/stop for the turn BEFORE it cuts the
   connection, and that writes a short-lived flag scoped to the account. When
   the browser's side of this stream is cancelled, the flag is read ONCE:
     - present: the person stopped. The upstream request is cancelled, so the
       model stops generating, and the meter settles on what was generated;
     - absent: the connection dropped. Generation continues to the end and the
       answer is parked for recovery, exactly as before.
   A flag that is late or lost falls back to the second case - today's
   behaviour, not something worse. Checked only on disconnect, never per chunk,
   so an answer that runs to completion costs nothing extra. */
const AI_STOP_TTL_S = 300;
function _aiStopKey(email, reqId) { return 'aistop:' + String(email || '').toLowerCase() + ':' + reqId; }
function _stopAwareStream(source, env, email, reqId, ctx) {
  const reader = source.getReader();
  const meter = new TransformStream();
  const mw = meter.writable.getWriter();
  const state = { stopped: false, clientGone: false };
  let ctrl = null;
  const toClient = new ReadableStream({
    start(c) { ctrl = c; },
    async cancel() {
      state.clientGone = true;
      if (!reqId || !email || !env || !env.AMV_KV) return;
      let flag = null;
      try { flag = await env.AMV_KV.get(_aiStopKey(email, reqId)); } catch (e) { flag = null; }
      if (!flag) return;
      state.stopped = true;
      try { await reader.cancel('stopped by the person'); } catch (e) {}
    },
  });
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!state.clientGone) { try { ctrl.enqueue(value); } catch (e) { state.clientGone = true; } }
        await mw.write(value);
      }
      if (!state.clientGone) { try { ctrl.close(); } catch (e) {} }
    } catch (e) {
      if (!state.clientGone) { try { ctrl.error(e); } catch (_) {} }
    } finally {
      try { await mw.close(); } catch (e) {}
    }
  })();
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(pump);
  return { toClient, toMeter: meter.readable, stopped: () => state.stopped };
}
async function aiStop(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in.' }, 401);
  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const id = String((body && body.id) || '');
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return json({ error: 'That is not an answer AMV knows about.', code: 'bad_id' }, 400);
  const g = await guardAction(env, `aistop:${user.email}`, 60, 3000, 'stopping answers');
  if (g) return g;
  try {
    await env.AMV_KV.put(_aiStopKey(user.email, id), '1', { expirationTtl: AI_STOP_TTL_S });
  } catch (e) {
    return json({ ok: false, error: 'AMV could not record the stop, so the answer may finish in the background.' }, 503);
  }
  return json({ ok: true });
}

async function meterStream(stream, eng, { dName, mName, gName, costName, acctCostName = '', user, env, limits, reqMessages, reserved = 0, reservedUSD = 0, reservedGlobalUSD = 0, reservedAcctUSD = 0, reqId = '', feature = 'chat', stopped = null, creditName = '', reservedCreditUSD = 0 }) {
  /* AMV-098: how long the user waited. Cost and quality are measured; speed is
     not, and it is the thing people feel most - a routing change that halves
     the bill and doubles the wait would have looked like a pure win on every
     screen. Two numbers: time to the FIRST token, which is what reads as
     "fast", and the total. Both are bucketed rather than stored per request,
     so this is a histogram, not a log of who asked what and when. */
  const _t0 = Date.now();
  let _firstByteAt = 0;
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let inTok = 0, cacheRead = 0, cacheWrite = 0, outTok = 0;
  let webSearches = 0;   // AMV-021: separately-billed web-search tool calls
  let sawUsage = false, sawAnyEvent = false;
  let answer = '';       // assembled so a client that dropped can get it back
  let genChars = 0;      // everything the model generated: text, tool input, thinking
  let finished = false;  // the provider's own end of message was seen
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const ln of lines) {
        const line = ln.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let ev; try { ev = JSON.parse(payload); } catch { continue; }
        sawAnyEvent = true;
        if (ev.type === 'content_block_delta' && ev.delta) {
          const d = ev.delta;
          genChars += (typeof d.text === 'string' ? d.text.length : 0)
                    + (typeof d.partial_json === 'string' ? d.partial_json.length : 0)
                    + (typeof d.thinking === 'string' ? d.thinking.length : 0);
        }
        if (ev.type === 'message_stop' || (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason)) finished = true;
        // Text as it streams. Free to collect - the bytes are already here.
        if (ev.type === 'content_block_delta' && ev.delta && typeof ev.delta.text === 'string') {
          if (!_firstByteAt) _firstByteAt = Date.now();
          if (answer.length < RESUME_MAX_CHARS) answer += ev.delta.text;
        }
        // input + cache token counts arrive in message_start
        if (ev.type === 'message_start' && ev.message && ev.message.usage) {
          const u = ev.message.usage;
          inTok      = u.input_tokens || 0;
          cacheRead  = u.cache_read_input_tokens || 0;
          cacheWrite = u.cache_creation_input_tokens || 0;
          if (typeof u.output_tokens === 'number') outTok = u.output_tokens;
          if (u.server_tool_use && typeof u.server_tool_use.web_search_requests === 'number') webSearches = u.server_tool_use.web_search_requests;
          sawUsage = true;
        }
        // output token count accumulates and finalizes in message_delta
        if (ev.type === 'message_delta' && ev.usage) {
          if (typeof ev.usage.output_tokens === 'number') outTok = ev.usage.output_tokens;  // running TOTAL, not a delta
          if (ev.usage.server_tool_use && typeof ev.usage.server_tool_use.web_search_requests === 'number') webSearches = ev.usage.server_tool_use.web_search_requests;
          sawUsage = true;
        }
        // some responses (tool use, final) also carry usage on message_stop
        if (ev.type === 'message_stop' && ev.usage) {
          if (typeof ev.usage.output_tokens === 'number') outTok = ev.usage.output_tokens;
          if (typeof ev.usage.input_tokens === 'number') inTok = ev.usage.input_tokens;
          if (ev.usage.server_tool_use && typeof ev.usage.server_tool_use.web_search_requests === 'number') webSearches = ev.usage.server_tool_use.web_search_requests;
          sawUsage = true;
        }
      }
    }
  } catch { /* stream interrupted - we still bill whatever usage we saw */ }

  /* Park whatever was produced. This runs whether the client is still there or
     not, which is the entire point: the answer the user lost is waiting. */
  if (reqId) await _parkAnswer(env, user && user.email, reqId, answer);

  /* STOPPED BY THE PERSON: charged for what was generated, not for the whole
     answer and not for nothing. The provider reports output tokens at the END
     of an answer, so a stopped one has only message_start's placeholder; the
     text that actually streamed is the measure of what was produced, at the
     same four characters to a token the input estimate uses. Settled here, so
     the "never saw usage" fallback below - half the cap, for a stream that
     died - does not charge a Stop pressed before the first word as if half an
     answer had been written. */
  const _wasStopped = typeof stopped === 'function' && stopped();
  if (_wasStopped && !finished) {
    inTok = inTok || _estimateInputTokens(reqMessages);
    outTok = Math.max(outTok, Math.ceil(genChars / 4));
    sawUsage = true;
  }

  // Fallback: if we never got usage (parse failure / hard interruption), estimate
  // conservatively from the request so a request is NEVER completely free.
  if (!sawUsage) {
    const estIn = _estimateInputTokens(reqMessages);
    inTok = inTok || estIn;
    outTok = outTok || Math.floor((eng.maxOut || 4000) * 0.5); // assume half the cap was produced
  }

  // --- cost, priced by tier (per million tokens) ---
  // cache reads are ~10% of input price; cache writes ~125% of input price.
  const cost =
      (inTok      / 1e6) * eng.inCost
    + (cacheRead  / 1e6) * eng.inCost * 0.10
    + (cacheWrite / 1e6) * eng.inCost * 1.25
    + (outTok     / 1e6) * eng.outCost
    // AMV-021: web search is a separately-billed provider dimension (~$0.01 per
    // request). Price it into the same spend ledger as tokens so interactive
    // searches aren't consumed for free.
    + (webSearches * WEB_SEARCH_COST_USD);

  // total tokens for quota accounting (count cache tokens too - they're real usage)
  const total = inTok + cacheRead + cacheWrite + outTok;

  // persist counters ATOMICALLY (DO incr) - no read-modify-write race
  /* RECONCILE the reservation.

     `reserved` tokens were already booked against this user BEFORE the model
     ran (that pre-booking is what stops a parallel burst from blowing past the
     cap). Now we know what the call actually cost, so we settle the difference:

        actual > reserved  ->  charge the extra
        actual < reserved  ->  refund the unused part

     Adding `total` outright here would double-charge every single call. */
  const delta = total - (reserved || 0);
  if (delta !== 0) {
    await counter(env, dName, { op: 'incr', amount: delta, ttlMs: 86400000 * 35 });
    await counter(env, mName, { op: 'incr', amount: delta, ttlMs: 86400000 * 70 });
  }
  /* SETTLE the dollar reservations, exactly as the tokens are settled above.
     `reservedUSD` was booked against these two counters before the model ran,
     so adding `cost` outright here would charge every call twice - which is the
     mirror-image of the race the reservation exists to close, and would look
     like the ceiling working unusually well right up until somebody was cut off
     at half their allowance. */
  const dCost = cost - (reservedGlobalUSD || 0);
  const gRes = dCost !== 0
    ? await counter(env, gName, { op: 'incr', amount: dCost, ttlMs: 86400000 * 2 })
    : { value: 0 };
  /* A message that ran on prepaid credit is paid for by the credit, at the
     markup, and settled against what was booked for it - not added to the
     plan's own ledger as well, which would charge it twice. */
  if (creditName) {
    const dCred = cost * CREDIT_MARKUP - (reservedCreditUSD || 0);
    if (dCred !== 0) await counter(env, creditName, { op: 'incr', amount: dCred, ttlMs: CREDIT_TTL_MS });
  } else {
    const dAcct = cost - (reservedUSD || 0);
    if (dAcct !== 0) await counter(env, costName, { op: 'incr', amount: dAcct, ttlMs: 86400000 * 70 });
  }
  /* A SECOND account ledger, when this path's primary counter is not the
     account's own. The widget is the only one: its `costName` is the
     per-widget `wspend:` counter, so the owner's `cost:` counter - the one the
     owner's monthly ceiling and family cap are measured against, and the one
     this handler CHECKS before every turn - was never written by widget
     traffic at all.

     That ceiling could therefore never be reached by a widget, however much a
     stranger on somebody else's website typed into it. It is the same shape as
     the SMS ceiling and the wash-trading signal: a control that reads a number
     nothing feeds. */
  if (acctCostName) {
    const dOwner = cost - (reservedAcctUSD || 0);
    if (dOwner !== 0) await counter(env, acctCostName, { op: 'incr', amount: dOwner, ttlMs: 86400000 * 70 });
  }
  /* The same money, totalled once - so the dashboard can report spend without
     adding up every account (AMV-088). */
  await counter(env, `costtotal:${monthKey()}`, { op: 'incr', amount: cost, ttlMs: 86400000 * 70 });

  /* ACTIVATED, at the only moment that actually proves it: AMV finished writing
     something for this person. Not "opened the app", not "typed into the box" -
     a real answer, delivered. Marked once per account, ever, and never allowed
     to fail the request it is measuring. */
  try { if (total > 0 && user && user.email) await _funnelMark(env, user.email, 'activated'); } catch (e) {}

  /* AMV-071: two numbers the owner cannot run this business without.

     WHERE the money goes - a single blended cost figure cannot tell you that
     images are eating the margin while chat is fine, so spend is split by
     feature. And WHAT CACHING IS WORTH - a cached input token costs a tenth of
     a fresh one, so the saving is real money that would otherwise be invisible.
     Both are month-scoped global counters: two extra increments per request,
     which is a small price for being able to see the unit economics at all. */
  try {
    const mk = monthKey();
    await counter(env, `featcost:${feature || 'chat'}:${mk}`, { op: 'incr', amount: cost, ttlMs: 86400000 * 70 });
    const saved = (cacheRead / 1e6) * eng.inCost * 0.90;   // what a cache read did NOT cost
    if (saved > 0) await counter(env, `cachesave:${mk}`, { op: 'incr', amount: saved, ttlMs: 86400000 * 70 });
    /* Latency, as a histogram rather than a log. Buckets mean the owner can see
       "most answers start inside a second" without AMV keeping a record of who
       asked what and when - the shape is the useful part, the individual
       request is only a liability. */
    try {
      const ttfb = _firstByteAt ? _firstByteAt - _t0 : 0;
      if (ttfb > 0) {
        const b = ttfb < 500 ? 'p500' : ttfb < 1000 ? 'p1000' : ttfb < 2500 ? 'p2500'
                : ttfb < 5000 ? 'p5000' : 'slow';
        await counter(env, `ttfb:${eng.key || 'unknown'}:${b}:${mk}`, { op: 'incr', amount: 1, ttlMs: 86400000 * 70 });
        await counter(env, `ttfbsum:${mk}`, { op: 'incr', amount: ttfb, ttlMs: 86400000 * 70 });
        await counter(env, `ttfbn:${mk}`, { op: 'incr', amount: 1, ttlMs: 86400000 * 70 });
      }
    } catch (e) { /* a measurement must never break the response it measured */ }
  } catch (e) { /* reporting must never break metering */ }

  // alert threshold (80% of global cap)
  const gSpent = gRes.value || 0;
  const gCap = parseFloat(env.GLOBAL_DAILY_USD_CAP || '500');
  if (gSpent >= gCap * 0.8 && gSpent - cost < gCap * 0.8) {
    await notify(env, `Spend alert: today at $${gSpent.toFixed(2)} (80% of $${gCap} cap).`);
  }
}

/* Rough token estimate from request messages (~4 chars/token), used only as a
   billing floor when the upstream stream gave us no usage numbers at all. */
function _estimateInputTokens(messages) {
  try {
    if (!Array.isArray(messages)) return 500;
    let chars = 0;
    for (const m of messages) {
      if (typeof m.content === 'string') chars += m.content.length;
      else if (Array.isArray(m.content)) for (const b of m.content) chars += (b.text || '').length + ((b.source && typeof b.source.data === 'string') ? b.source.data.length : 0);
    }
