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
/* A LONG SILENCE IS NOT A DEAD CONNECTION - SO SAY SO, EVERY FEW SECONDS.

   The newest engines think before they answer and, by default, send nothing
   while they do: a hard question on Forge or Apex can be thirty seconds or more
   of silence before the first word. The page gives up on a stream that is
   silent for 30 seconds (it has to - a dropped phone connection looks the
   same), and it told the person "the connection stalled, please retry" about
   an answer the engine was still writing and the person would be billed for,
   then billed again for the retry. So while the engine is silent the browser
   is sent an SSE comment every AI_KEEPALIVE_MS - a line beginning ':', which
   every reader of this stream already skips (it reads only 'data:' lines).
   Only to the browser: the meter reads the engine's bytes alone. */
const AI_KEEPALIVE_MS = 10000;
const _KEEPALIVE = new TextEncoder().encode(': keepalive\n\n');
function _aiStopKey(email, reqId) { return 'aistop:' + String(email || '').toLowerCase() + ':' + reqId; }
/* AN ERROR INSIDE A STREAM IS SAID IN AMV'S WORDS TOO.

   _modelErrorShown translates a refusal that arrives before the stream. One
   that arrives inside it - the provider giving up half way, most often
   overloaded - came through as the provider's own event, sentence and all,
   to the page, to API callers and to visitors of somebody's website widget.
   Only `error` events are touched: the line is parsed, its message replaced
   by AMV's sentence for that kind, its `type` kept (the page and the agent
   loop decide what to do from the type alone). Everything else passes
   through as it arrived, a whole line at a time. */
const _SSE_ERR_SAID = {
  overloaded_error: 'The model is busy right now and stopped before finishing. Try again in a moment.',
  rate_limit_error: 'The model is busy right now and stopped before finishing. Try again in a moment.',
  api_error:        'The model had a problem and stopped before finishing. Try again in a moment.',
};
function _sseErrorScrubber() {
  const dec = new TextDecoder(), enc = new TextEncoder();
  let held = '';
  const fix = (line) => {
    if (!/^data:/.test(line) || line.indexOf('"error"') < 0) return line;
    let evt; try { evt = JSON.parse(line.slice(5)); } catch (e) { return line; }
    if (!evt || evt.type !== 'error') return line;
    const type = String((evt.error && evt.error.type) || 'error').slice(0, 60);
    return 'data: ' + JSON.stringify({ type: 'error', error: { type,
      message: _SSE_ERR_SAID[type] || 'The model stopped with an error before finishing. Try again, or pick another engine.' } });
  };
  return {
    push(bytes) {
      held += dec.decode(bytes, { stream: true });
      const cut = held.lastIndexOf('\n');
      if (cut < 0) return null;
      const whole = held.slice(0, cut + 1); held = held.slice(cut + 1);
      return enc.encode(whole.split('\n').map(fix).join('\n'));
    },
    flush() { const rest = held + dec.decode(); held = ''; return rest ? enc.encode(fix(rest)) : null; },
  };
}
function _sseInOurWords(body) {
  const s = _sseErrorScrubber();
  return body.pipeThrough(new TransformStream({
    transform(chunk, c) { const out = s.push(chunk); if (out && out.length) c.enqueue(out); },
    flush(c) { const out = s.flush(); if (out && out.length) c.enqueue(out); },
  }));
}

function _stopAwareStream(source, env, email, reqId, ctx) {
  const scrub = _sseErrorScrubber();
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
  let lastSent = Date.now();
  const beat = setInterval(() => {
    if (state.clientGone || Date.now() - lastSent < AI_KEEPALIVE_MS) return;
    try { ctrl.enqueue(_KEEPALIVE); lastSent = Date.now(); } catch (e) { state.clientGone = true; }
  }, Math.max(1000, Math.floor(AI_KEEPALIVE_MS / 2)));
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!state.clientGone) {
          const out = scrub.push(value);
          if (out && out.length) { try { ctrl.enqueue(out); lastSent = Date.now(); } catch (e) { state.clientGone = true; } }
        }
        await mw.write(value);
      }
      if (!state.clientGone) {
        const rest = scrub.flush();
        try { if (rest && rest.length) ctrl.enqueue(rest); ctrl.close(); } catch (e) {}
      }
    } catch (e) {
      if (!state.clientGone) { try { ctrl.error(e); } catch (_) {} }
    } finally {
      clearInterval(beat);
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

async function meterStream(stream, eng, { dName, mName, gName, costName, acctCostName = '', user, env, limits, reqMessages, reserved = 0, reservedUSD = 0, reservedGlobalUSD = 0, reservedAcctUSD = 0, reqId = '', feature = 'chat', project = '', stopped = null, creditName = '', reservedCreditUSD = 0 }) {
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
    if (dCred !== 0) await counter(env, creditName, { op: 'incr', amount: dCred, keep: true });
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
  /* Lifetime totals for the person: tokens, one message, the month, the
     engine, and where it was used (surface, project). Never allowed to fail
     the answer it is counting. */
  if (user && user.email && total > 0) {
    try { await counter(env, `life:${user.email}`, { op: 'lifeAdd', tokens: total, msgs: 1, month: monthKey(), engine: eng.key || '',
      surface: feature || 'chat', project: project || '',
      team: String(user.billingSubject || '').startsWith('team:') ? user.billingSubject.slice(5) : '' }); } catch(e) { /* best-effort: the lifetime totals on Usage; the plan meters that bind are separate */ }
    /* Paid for by a team: the same answer, counted for the team's owners and
       admins to see (teamUsage) - totals and surfaces, never a project. */
    if (String(user.billingSubject || '').startsWith('team:')) {
      try { await counter(env, `tmuse:${user.billingSubject.slice(5)}:${user.email}`, { op: 'lifeAdd', tokens: total, msgs: 1, month: monthKey(), surface: feature || 'chat' }); } catch(e) { /* best-effort: a team member's usage total for the team page; the plan meters that bind are separate */ }
    }
  }
  /* The same money, totalled once - so the dashboard can report spend without
     adding up every account (AMV-088). */
  await _tallyAdd(env, `costtotal:${monthKey()}`, user && (user.billingSubject || user.email), cost, 86400000 * 70);

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
    await _tallyAdd(env, `featcost:${feature || 'chat'}:${mk}`, user && (user.billingSubject || user.email), cost, 86400000 * 70);
    const saved = (cacheRead / 1e6) * eng.inCost * 0.90;   // what a cache read did NOT cost
    const payer = user && (user.billingSubject || user.email);
    if (saved > 0) await _tallyAdd(env, `cachesave:${mk}`, payer, saved, 86400000 * 70);
    /* Latency, as a histogram rather than a log. Buckets mean the owner can see
       "most answers start inside a second" without AMV keeping a record of who
       asked what and when - the shape is the useful part, the individual
       request is only a liability. */
    try {
      const ttfb = _firstByteAt ? _firstByteAt - _t0 : 0;
      if (ttfb > 0) {
        const b = ttfb < 500 ? 'p500' : ttfb < 1000 ? 'p1000' : ttfb < 2500 ? 'p2500'
                : ttfb < 5000 ? 'p5000' : 'slow';
        await _tallyAdd(env, `ttfb:${eng.key || 'unknown'}:${b}:${mk}`, payer, 1, 86400000 * 70);
        await _tallyAdd(env, `ttfbsum:${mk}`, payer, ttfb, 86400000 * 70);
        await _tallyAdd(env, `ttfbn:${mk}`, payer, 1, 86400000 * 70);
      }
    } catch (e) { /* a measurement must never break the response it measured */ }
  } catch (e) { /* reporting must never break metering */ }

  /* THE DAY'S SPEND, SAID ON THE WAY UP (audit, Oct 31) - not only at 80%.
     A ceiling announced once, near the top, is a ceiling found out about
     when everybody's chat stops. Each of SPEND_ALERT_AT is said once a day
     when the day's total passes it. gRes is one share of sixteen, so a share
     crossing a threshold of itself is the cue to add the day up. */
  const gSpent = gRes.value || 0;
  const gCap = parseFloat(env.GLOBAL_DAILY_USD_CAP || '500');
  const shareCap = gCap / _spendSharesFor(gCap);
  const crossed = SPEND_ALERT_AT.filter(f => gSpent >= shareCap * f && gSpent - cost < shareCap * f);
  if (crossed.length) {
    try {
      const total = await _globalSpendToday(env);
      for (const f of SPEND_ALERT_AT) {
        if (total < gCap * f) continue;
        const flag = 'spend' + Math.round(f * 100) + ':' + todayKey();
        if (await env.AMV_KV.get(flag)) continue;
        await env.AMV_KV.put(flag, '1', { expirationTtl: 2 * 86400 });
        await notify(env, `Spend alert: today at $${total.toFixed(2)} (${Math.round(f * 100)}% of the $${gCap} daily ceiling).`
          + (f >= 0.95 ? ' At 100% every paid model call stops until midnight UTC - raise GLOBAL_DAILY_USD_CAP now if this is real demand.' : ''));
      }
    } catch (e) {}
  }
}
const SPEND_ALERT_AT = [0.5, 0.7, 0.85, 0.95];

/* Rough token estimate from request messages (~4 chars/token), used only as a
   billing floor when the upstream stream gave us no usage numbers at all. */
/* WHAT A PICTURE OR A PDF COSTS TO READ, NOT WHAT IT WEIGHS.

   These were counted at a quarter of their base64 length, as if they were
   prose. A photo the page sends is about 400KB encoded - booked as 100,000
   tokens, five times a free account's whole day, so a free account could not
   send a photo at all and a paid one ran out after a few; the engine reads
   that photo for about 1,600. The booking is settled against what the call
   really used, so this only ever decided REFUSALS, and it refused wrongly.

   A picture: the engine scales anything larger down to about 1.15 megapixels
   before reading it, which is ~1,600 tokens whatever was sent; IMAGE_TOKENS
   books a little over that. A PDF: every page is read as its text and as a
   picture of the page, so ~PDF_PAGE_TOKENS a page, the pages counted in the
   file itself; a file whose pages cannot be counted falls back to its size,
   which over-counts rather than under. */
const IMAGE_TOKENS = 1800;
const PDF_PAGE_TOKENS = 3000;
function _pdfPages(b64) {
  try {
    const head = String(b64 || '');
    if (head.length > 16 * 1024 * 1024) return 0;
    const bin = atob(head);
    const n = (bin.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
    return n;
  } catch (e) { return 0; }
}
function _blockTokens(b) {
  const src = b && b.source;
  if (!src || typeof src.data !== 'string') return 0;
  if (src.type !== 'base64') return _estimateTextTokens(src.data);
  if (b.type === 'image') return IMAGE_TOKENS;
  const pages = /pdf/i.test(String(src.media_type || '')) ? _pdfPages(src.data) : 0;
  return pages ? pages * PDF_PAGE_TOKENS : Math.ceil(src.data.length / 4);
}
function _estimateInputTokens(messages) {
  try {
    if (!Array.isArray(messages)) return 500;
    let chars = 0, files = 0;
    for (const m of messages) {
      if (typeof m.content === 'string') chars += m.content.length;
      else if (Array.isArray(m.content)) for (const b of m.content) {
        chars += (b.text || '').length + (typeof b.content === 'string' ? b.content.length : 0);
        files += _blockTokens(b);
        if (Array.isArray(b.content)) for (const x of b.content) { if (x) { chars += (x.text || '').length; files += _blockTokens(x); } }
      }
    }
    return Math.max(200, Math.ceil(chars / 4) + files);
  } catch { return 500; }
}
/* Reservation estimate for a full request - includes the client-supplied system
   prompt so it is METERED and reserved rather than sent to the model for free
   (AMV-020). Every token-bearing field must be counted here. */
/* The smallest answer worth booking when a day's allowance is nearly spent.
   Below it the request is refused as over the limit: an answer with no room
   would spend the person's last tokens on the engine's thinking and show
   them nothing. */
const ANSWER_FLOOR_TOKENS = 2048;
/* TOKENS BY SCRIPT, NOT BY A FLAT FOUR CHARACTERS.

   English runs about four characters to a token; Chinese, Japanese and Korean
   about one. A flat four-to-one estimate reads a Japanese contract as a
   quarter of its real size, which is fine for booking (the booking is settled
   against what the call really cost) and wrong for deciding whether it fits:
   a request the estimate called 300,000 tokens could be 1.2 million, and the
   provider would refuse it after AMV had already said yes. */
/* WHERE A REQUEST WAS USED, for the person's own breakdown. The server names
   what it can tell for itself - a batch, an API key - and only a request
   made with the app's own sign-in may say which screen it came from, from a
   fixed list. It changes no price and no limit: it only says where the
   tokens went. The project is an opaque id the person's device names. */
const USAGE_SURFACES_CLIENT = new Set(['chat', 'crew', 'build', 'code', 'voice', 'automation', 'other']);
function _usageTagOf(body, user, principal) {
  const a = (body && body.amv && typeof body.amv === 'object') ? body.amv : {};
  let surface;
  if (principal) surface = 'batch';
  else if (user && user.via === 'apikey') surface = 'api';
  else surface = USAGE_SURFACES_CLIENT.has(a.surface) ? a.surface : 'chat';
  const project = (!principal && !(user && user.via === 'apikey') && typeof a.project === 'string'
    && /^[A-Za-z0-9_-]{1,40}$/.test(a.project) && a.project !== '_other') ? a.project : '';
  return { surface, project };
}
function _estimateTextTokens(s) {
  const t = String(s || '');
  let wide = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if ((c >= 0x3040 && c <= 0x30ff) || (c >= 0x3400 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff)) wide++;
  }
  return wide + Math.ceil((t.length - wide) / 4);
}
/* Does this request fit the engine it is going to? Text by script; a picture
   or a PDF by what it costs to read (_blockTokens). */
function _fitsContext(body, eng) {
  let tok = _estimateTextTokens(body && body.system);
  for (const m of ((body && body.messages) || [])) {
    if (typeof m.content === 'string') { tok += _estimateTextTokens(m.content); continue; }
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (typeof b.text === 'string') tok += _estimateTextTokens(b.text);
      if (typeof b.content === 'string') tok += _estimateTextTokens(b.content);
      tok += _blockTokens(b);
      /* A tool result carries blocks of its own - a screenshot is a picture
         inside one - and they are read like any other. */
      if (Array.isArray(b.content)) for (const x of b.content) {
        if (x && typeof x.text === 'string') tok += _estimateTextTokens(x.text);
        if (x) tok += _blockTokens(x);
      }
    }
  }
  const room = (Number(eng && eng.context) || 200000) - (Number(eng && eng.maxOut) || 16000) - 8000;
  return { ok: tok <= room, tokens: tok, room };
}

function _estimateReserveInput(body) {
  const msgs = _estimateInputTokens((body && body.messages) || []);
  const sys = Math.ceil(String((body && body.system) || '').length / 4);
  return msgs + sys;
}

function _usageBreakdown(life) {
  const months = (life && life.months) || {};
  const now = monthKey();
  const d = new Date(now + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1);
  const prev = d.toISOString().slice(0, 7);
  const one = (mo) => { const m = months[mo] || {}; return { month: mo, tokens: m.tok || 0, surfaces: m.s || {}, projects: m.p || {} }; };
  return { current: one(now), previous: one(prev) };
}

async function usageReport(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'sign in' }, 401);
  const limits = effectiveLimits(user);
  /* The same subject the limits are enforced against, or the screen would show
     one number while the server refused on another (AMV-100). */
  const subject = user.billingSubject || user.email;
  const dUsed = (await counter(env, `usg:${subject}:${todayKey()}`, { op: 'get' })).value || 0;
  const mUsed = (await counter(env, `usg:${subject}:${_periodKeyOf(user)}`, { op: 'get' })).value || 0;
  const mCost = (await counter(env, `cost:${subject}:${_periodKeyOf(user)}`, { op: 'get' })).value || 0;
  /* Read from the SAME counter the proxy reserves against, so the number on
     the screen is the number that would refuse the next message rather than a
     second tally that agrees with it most of the time. */
  const msgUsed = (await counter(env, `msgs:${subject}:${_periodKeyOf(user)}`, { op: 'get' })).value || 0;
  /* The same keys the proxy reserves against, read at the same instant, so the
     screen cannot show one window while a different one refuses. */
  const nowMs = Date.now();
  const win5 = await counter(env, `msgs5h:${user.email || subject}`, { op: 'sessionGet', windowMs: WINDOW_5H_MS });
  const win5Used = (win5 && win5.value) || 0;
  const topUsed = (await counter(env, `msgtop:${subject}:${weekKey(nowMs)}`, { op: 'get' })).value || 0;
  /* THE COST OF A MESSAGE, MEASURED RATHER THAN ASSUMED.

     What a month of messages really costs decides whether a large cap is
     generous or ruinous, and it turns almost entirely on how long the replies
     are - long enough and the same count that earns a healthy margin loses
     money instead. Nothing measured it, so every cap was set against somebody's
     estimate. Two numbers already in hand divide into the answer. Null until
     there is something to divide, because a made-up figure here would be worse
     than none. */
  const perMessageUSD = msgUsed > 0 ? +(mCost / msgUsed).toFixed(6) : null;
  /* THE METER THAT CAN STOP SOMEBODY, SAID AS THE ONE THEY SEE.

     A paid month is bounded twice: by tokens, and by what those tokens cost -
     the dollar ceiling that keeps the dearest engine from running a plan at a
     loss. Only the token meter was on the screen, so somebody on the top engine
     could read 68% used and be refused, by a ceiling they were never shown, at
     what looked like two thirds of the month. The dollars stay internal; the
     share of the ceiling does not. `included` is whichever of the two is
     further along, which is the honest answer to "how much of my month is
     left". */
  const monthResetAt = _periodResetAtOf(user, nowMs);
  const ceiling = _monthlyCeilingUSD(user);
  const costPct = ceiling > 0 ? Math.min(100, Math.round((mCost / ceiling) * 100)) : null;
  const tokPct = limits.monthTokens > 0 ? Math.min(100, Math.round((mUsed / limits.monthTokens) * 100)) : 0;
  const dayStart = new Date(nowMs);
  /* All time, for this person (not the team pool): totals only. */
  let life = null;
  try { const r = await counter(env, `life:${user.email}`, { op: 'lifeGet' }); life = r && r.tally; } catch (e) {}
  return json({
    plan: user.plan,
    day: { used: dUsed, limit: limits.dayTokens,
           resetAt: Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), dayStart.getUTCDate() + 1) },
    included: { pct: Math.max(tokPct, costPct || 0), by: (costPct || 0) > tokPct ? 'cost' : 'tokens', resetAt: monthResetAt },
    /* The unit the plan is sold in, so the app can show what was bought rather
       than translating tokens for somebody who never asked about tokens. */
    messages: { used: msgUsed, limit: limits.monthMessages || 0, perMessageUSD },
    /* EACH WINDOW WITH THE TIME IT REOPENS, BECAUSE THAT IS THE ONLY PART
       ANYBODY CARES ABOUT.

       "You have used 812 of 1000" answers a question nobody asked. The
       question is when they can carry on, and a window that cannot say so is
       the same wall a monthly cap was - it just arrives sooner. Both reset
       times are computed from the same absolute clock the counters are keyed
       on, so the number on the screen is the moment the counter actually
       rolls rather than an estimate of it. */
    window5h: {
      /* It opens with the first message, so until then there is no reset
         time to give - `startsAt: null` says "it starts when you do". */
      used: win5Used, limit: limits.messages5h || 0,
      startedAt: (win5 && win5.start) || null,
      resetAt: (win5 && win5.start) ? win5.start + WINDOW_5H_MS : null,
    },
    topEngineWeek: {
      used: topUsed, limit: limits.topMessagesWeek || 0,
      resetAt: new Date(weekKey(nowMs) + 'T00:00:00Z').getTime() + 7 * 86400000,
    },
    // `bonus` is the referral capacity folded into the monthly limit above, sent
    // separately so the app can say WHERE the extra allowance came from.
    month: { used: mUsed, limit: limits.monthTokens, costUSD: +mCost.toFixed(4), costPct, bonus: limits.bonusTokens || 0, resetAt: monthResetAt },
    // Said plainly, because "used" meaning the whole team is a surprise otherwise.
    /* Only when the counters really are pooled. Somebody on a team who kept
       their own better plan is NOT sharing, and telling them they are would
       have them chasing a teammate for usage that is entirely their own. */
    lifetime: life ? { tokens: life.tok || 0, messages: life.msg || 0, since: life.since || null,
      months: Object.keys(life.months || {}).sort().slice(-12).map(m => ({ month: m, tokens: life.months[m].tok || 0, messages: life.months[m].msg || 0 })),
      engines: life.eng || {} } : { tokens: 0, messages: 0, since: null, months: [], engines: {} },
    /* Where this calendar month's tokens went, and last month's to compare:
       by surface, and by project id (the device has the names). */
    breakdown: _usageBreakdown(life),
    shared: (user.billingSubject && user.billingSubject !== user.email)
      ? { team: true, note: 'This allowance is shared with your team.' } : null,
  });
}

