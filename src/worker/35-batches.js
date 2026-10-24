/* ══ BATCHES: MANY REQUESTS, ANSWERED IN THE BACKGROUND ══════════════════════

   A developer with a thousand documents to summarise should not have to hold
   a thousand connections open. A batch is up to BATCH_MAX requests handed
   over at once; AMV works through them in the background and the results are
   collected later.

   EVERY ITEM IS AN ORDINARY REQUEST. Each one runs through aiProxy itself - the
   same plan check, the same rate limit, the same token, message and dollar
   reservations, the same extra-usage rules and the same settlement - as the
   batch's owner, exactly as if they had sent it. There is no second metering
   path to drift from the first, which is the whole design: batches are
   charged like the messages they are, no more and no less, and every guard
   that protects a message protects a batch item with no extra code.

   What that means in practice:
     - an item refused because a window is full waits and is tried again
       later, until the batch's 24 hours run out; anything else refused is
       recorded as that item's error, with the reason AMV gave;
     - a batch made with an API key stops when the key is revoked;
     - an item that was running when its worker died is NOT run again: it
       may already have been answered and charged, and charging twice is the
       one outcome a retry must never cause - it is reported as interrupted;
     - cancelling stops before the next item; what was answered stays.

   Results are kept for seven days. */
const BATCH_MAX = 100, BATCH_ACTIVE_MAX = 5, BATCH_TTL_MS = 24 * 3600000, BATCH_KEEP_S = 7 * 86400;
const BATCH_TICK_MS = 25000, BATCH_STALE_MS = 10 * 60000;
const BATCH_WAIT_CODES = new Set(['rate_limited', 'quota_window', 'quota_top_week', 'global_cap', 'acct_busy', 'provider_error']);

async function batchCreate(request, env, ctx) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in again.' }, 401);
  const held = await _accountHold(env, user, 'chat');
  if (held) return held;
  const blocked = await guardAction(env, 'batch:' + user.email, 5, 100, 'batches');
  if (blocked) return blocked;
  const body = await request.json().catch(() => null);
  const reqs = body && Array.isArray(body.requests) ? body.requests : null;
  if (!reqs || !reqs.length) return json({ error: 'Send "requests": a list of {custom_id, params}.', code: 'invalid_input' }, 400);
  if (reqs.length > BATCH_MAX) return json({ error: 'A batch holds at most ' + BATCH_MAX + ' requests. Split it into several.', code: 'invalid_input' }, 400);
  const seen = new Set();
  for (let i = 0; i < reqs.length; i++) {
    const r = reqs[i] || {}, cid = String(r.custom_id || '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(cid)) return json({ error: 'Request ' + i + ': custom_id must be 1-64 letters, digits, _ or -.', code: 'invalid_input' }, 400);
    if (seen.has(cid)) return json({ error: 'Request ' + i + ': custom_id "' + cid + '" is used twice.', code: 'invalid_input' }, 400);
    seen.add(cid);
    const p = r.params;
    if (!p || typeof p !== 'object') return json({ error: 'Request ' + i + ' ("' + cid + '") has no params.', code: 'invalid_input' }, 400);
    const v = validateMessagesPayload(p);
    if (v) return json({ error: 'Request ' + i + ' ("' + cid + '"): ' + v, code: 'invalid_input' }, 400);
    if (p.stream === false) return json({ error: 'Request ' + i + ' ("' + cid + '"): leave "stream" out - batch items are collected for you.', code: 'invalid_input' }, 400);
  }
  const id = 'batch_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  const now = Date.now();
  let res, dropped = [];
  try {
    res = await _withKind(env, 'batchidx', user.email, (idx) => {
      const active = idx.filter(b => b && b.status !== 'ended').length;
      if (active >= BATCH_ACTIVE_MAX) return { error: 'You have ' + BATCH_ACTIVE_MAX + ' batches still running. Wait for one to finish, or cancel one.', status: 429, code: 'batch_limit' };
      idx.unshift({ id, created: now, status: 'in_progress', n: reqs.length });
      if (idx.length > 50) dropped = idx.splice(50);
      return { ok: true };
    }, []);
  } catch (e) { if (!_isBusy(e)) throw e; return _busyJson('batch'); }
  if (res && res.error) return json({ error: res.error, code: res.code }, res.status || 400);
  /* A batch that falls off the end of the list goes with it. Nothing else
     ever deletes a batch record, and the list is also how erasure finds an
     account's batches - so one left behind here would outlive the account
     that made it, owner's address and all. (Its requests and answers expire
     on their own.) */
  for (const b of dropped) { try { if (b && b.id) await DB.del(env, 'batch', b.id); } catch (e) {} }
  for (let i = 0; i < reqs.length; i++) await env.AMV_KV.put(`batchreq:${id}:${i}`, JSON.stringify(reqs[i].params), { expirationTtl: BATCH_KEEP_S + 86400 });
  const rec = { id, owner: user.email, keyId: await _apiKeyIdOf(request, env), created: now, expiresAt: now + BATCH_TTL_MS, status: 'in_progress',
                items: reqs.map(r => ({ cid: String(r.custom_id), state: 'pending' })) };
  await _withKind(env, 'batch', id, (r) => { Object.assign(r, rec); return { ok: true }; }, {});
  await env.AMV_KV.put('batchq:' + id, '1');
  audit(env, 'batch_created', { by: user.email, n: reqs.length });
  /* Nothing is started here. Work handed to waitUntil gets about thirty
     seconds after this response, and one long answer outlives that - the item
     would be cut off mid-answer and reported interrupted for nothing but where
     it happened to start. The cron's next tick, within five minutes, runs it
     with the time it needs. */
  return json(_batchView(rec));
}

/* Which API key, if any, made this request - so a batch made with one stops
   when it is revoked. Read from the key itself, the way requireUser found it. */
async function _apiKeyIdOf(request, env) {
  const raw = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '') || request.headers.get('X-AMV-Key') || '';
  if (!raw.startsWith(API_KEY_PREFIX)) return '';
  try { const ref = JSON.parse(await env.AMV_KV.get(`apikey:${await _apiKeyHash(raw)}`) || 'null'); return (ref && ref.id) || ''; }
  catch (e) { return ''; }
}
function _batchView(rec) {
  const c = { processing: 0, succeeded: 0, errored: 0, canceled: 0, expired: 0 };
  for (const it of rec.items || []) {
    if (it.state === 'pending' || it.state === 'running') c.processing++;
    else c[it.result] = (c[it.result] || 0) + 1;
  }
  return { id: rec.id, type: 'message_batch', processing_status: rec.status === 'ended' ? 'ended' : rec.status === 'canceling' ? 'canceling' : 'in_progress',
           request_counts: c, created_at: new Date(rec.created).toISOString(), expires_at: new Date(rec.expiresAt).toISOString(),
           ended_at: rec.endedAt ? new Date(rec.endedAt).toISOString() : null };
}

/* Only the owner, and only by id. Somebody else's batch is "not found",
   not "forbidden": whether it exists is not theirs to learn. */
async function _batchOwned(request, env, user) {
  const body = await request.json().catch(() => ({}));
  const id = String((body && body.id) || '');
  const rec = /^batch_[a-f0-9]{24}$/.test(id) ? await DB.get(env, 'batch', id) : null;
  if (!rec || rec.owner !== user.email) return { res: json({ error: 'There is no batch with that id on this account.', code: 'not_found' }, 404) };
  return { user, rec };
}
async function batchGet(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in again.' }, 401);
  const o = await _batchOwned(request, env, user); if (o.res) return o.res;
  return json(_batchView(o.rec));
}
async function batchList(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in again.' }, 401);
  const idx = (await DB.get(env, 'batchidx', user.email)) || [];
  const out = [];
  for (const b of idx.slice(0, 50)) { const rec = await DB.get(env, 'batch', b.id); if (rec) out.push(_batchView(rec)); }
  return json({ data: out });
}
async function batchCancel(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in again.' }, 401);
  const o = await _batchOwned(request, env, user); if (o.res) return o.res;
  let rec;
  try {
    rec = await _withKind(env, 'batch', o.rec.id, (r) => {
      if (r && r.status === 'in_progress') r.status = 'canceling';
      return r;
    });
  } catch (e) { if (!_isBusy(e)) throw e; return _busyJson('batch'); }
  audit(env, 'batch_cancel', { by: o.user.email });
  return json(_batchView(rec || o.rec));
}
/* One line per request, in the order sent: what it answered, or why not. */
async function batchResults(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in again.' }, 401);
  const o = await _batchOwned(request, env, user); if (o.res) return o.res;
  const lines = [];
  for (let i = 0; i < o.rec.items.length; i++) {
    const it = o.rec.items[i];
    if (it.state === 'pending' || it.state === 'running') continue;
    let result = { type: it.result || 'errored' };
    if (it.result === 'succeeded' || it.result === 'errored') {
      const raw = await env.AMV_KV.get(`batchres:${o.rec.id}:${i}`);
      try { if (raw) result = JSON.parse(raw); } catch (e) {}
    }
    lines.push(JSON.stringify({ custom_id: it.cid, result }));
  }
  return new Response(lines.join('\n') + (lines.length ? '\n' : ''), { status: 200, headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } });
}

/* An answer, read off the stream aiProxy returned: the same message shape a
   non-streamed reply would have had. */
function _sseMessage(text, engine) {
  const content = []; let stop = null; const usage = { input_tokens: 0, output_tokens: 0 };
  for (const raw of String(text).split('\n\n')) {
    const line = raw.split('\n').find(l => l.startsWith('data:'));
    if (!line) continue;
    let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
    if (ev.type === 'message_start' && ev.message && ev.message.usage) usage.input_tokens = ev.message.usage.input_tokens || 0;
    else if (ev.type === 'content_block_start') content[ev.index] = ev.content_block && ev.content_block.type === 'tool_use'
      ? { type: 'tool_use', id: ev.content_block.id, name: ev.content_block.name, _json: '' } : { type: 'text', text: '' };
    else if (ev.type === 'content_block_delta' && content[ev.index]) {
      if (ev.delta && ev.delta.type === 'text_delta') content[ev.index].text += ev.delta.text || '';
      else if (ev.delta && ev.delta.type === 'input_json_delta') content[ev.index]._json += ev.delta.partial_json || '';
    } else if (ev.type === 'message_delta') { if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason; if (ev.usage && ev.usage.output_tokens != null) usage.output_tokens = ev.usage.output_tokens; }
  }
  return { type: 'message', role: 'assistant', engine, stop_reason: stop, usage,
           content: content.filter(Boolean).map(b => { if (b.type !== 'tool_use') return b; let input = {}; try { input = b._json ? JSON.parse(b._json) : {}; } catch (e) {} return { type: 'tool_use', id: b.id, name: b.name, input }; }) };
}

/* Work through one batch for up to `budgetMs`. One worker at a time per batch
   (the claim), one item at a time, each item's state changed under the lock. */
async function _batchRun(env, ctx, id, budgetMs) {
  if (!(await _claimOnce(env, 'batchrun', id, 120))) return 'busy';
  const until = Date.now() + (budgetMs || BATCH_TICK_MS);
  try {
    for (;;) {
      if (Date.now() > until) return 'budget';
      let pick = null, ended = false;
      const rec = await _withKind(env, 'batch', id, (r) => {
        if (!r || r.status === 'ended') { ended = true; return r; }
        const now = Date.now();
        for (const it of r.items) if (it.state === 'running' && now - (it.at || 0) > BATCH_STALE_MS) { it.state = 'done'; it.result = 'errored'; it.code = 'interrupted'; }
        const finish = (why) => { for (const it of r.items) if (it.state === 'pending') { it.state = 'done'; it.result = why; } };
        if (r.status === 'canceling') finish('canceled');
        else if (now > r.expiresAt) finish('expired');
        const i = r.items.findIndex(it => it.state === 'pending' && !(it.wait > now));
        if (i >= 0) { r.items[i].state = 'running'; r.items[i].at = now; pick = i; }
        else if (!r.items.some(it => it.state === 'pending' || it.state === 'running')) { r.status = 'ended'; r.endedAt = now; ended = true; }
        return r;
      });
      if (ended || !rec) {
        try { await env.AMV_KV.delete('batchq:' + id); } catch (e) {}
        if (rec) await _withKind(env, 'batchidx', rec.owner, (idx) => { const b = idx.find(x => x && x.id === id); if (b) b.status = 'ended'; return { ok: true }; }, []).catch(() => {});
        return 'ended';
      }
      if (pick == null) return 'waiting';
      const outcome = await _batchItem(env, ctx, rec, pick);
      await _withKind(env, 'batch', id, (r) => {
        const it = r.items[pick];
        if (outcome.wait) { it.state = 'pending'; it.wait = Date.now() + outcome.wait; }
        else { it.state = 'done'; it.result = outcome.result; it.code = outcome.code || ''; }
        if (outcome.stop) for (const x of r.items) if (x.state === 'pending') { x.state = 'done'; x.result = 'canceled'; }
        return r;
      });
      if (outcome.wait) return 'waiting';
    }
  } finally { await _releaseClaim(env, 'batchrun', id); }
}
async function _batchItem(env, ctx, rec, i) {
  const fail = async (code, message, extra) => {
    await env.AMV_KV.put(`batchres:${rec.id}:${i}`, JSON.stringify({ type: 'errored', error: { code, message } }), { expirationTtl: BATCH_KEEP_S });
    return Object.assign({ result: 'errored', code }, extra || {});
  };
  /* The pause switch. Items reach aiProxy directly, not through the router
     that refuses /v1/ while paused - so without this a paused deployment
     would go on spending on every batch already queued. Read from KV, not
     the router's cache: a stale answer is more of the spend being stopped.
     Waited out, not failed: pausing must not cost anybody their batch. */
  if ((await env.AMV_KV.get('GLOBAL_KILL')) === '1') return { wait: 5 * 60000 };
  /* A batch made with a key lives and dies with the key. */
  if (rec.keyId) {
    const keys = (await DB.get(env, 'apikeys', rec.owner)) || { items: [] };
    const k = (keys.items || []).find(x => x.id === rec.keyId);
    if (!k || k.revoked) return fail('key_revoked', 'The API key this batch was made with was revoked, so the rest of the batch was cancelled.', { stop: true });
  }
  const user = await _principalOf(env, rec.owner, null, { via: rec.keyId ? 'apikey' : 'batch', keyId: rec.keyId || undefined });
  if (!user) return fail('account_gone', 'The account this batch belongs to no longer exists.', { stop: true });
  let params = null;
  try { params = JSON.parse(await env.AMV_KV.get(`batchreq:${rec.id}:${i}`) || 'null'); } catch (e) {}
  if (!params) return fail('request_missing', 'This request could not be read back, so it was not run.');
  const req = new Request('https://batch.amv.internal/v1/messages', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AMV-Request-Id': 'b' + rec.id.slice(6, 18) + 'i' + i },
    body: JSON.stringify(Object.assign({}, params, { stream: true })) });
  let res;
  try { res = await aiProxy(req, env, ctx, user); }
  catch (e) { return { wait: 60000 }; }
  if (!res.ok) {
    let d = {}; try { d = await res.json(); } catch (e) {}
    /* A passing condition - a full window, a busy provider, a 5xx with no
       verdict of AMV's own - is waited out. A decision (a plan boundary, a bad
       request, a missing service) is the item's answer. */
    const code = String(d.code || '');
    if (BATCH_WAIT_CODES.has(code) || (!code && (res.status === 429 || res.status >= 500))) {
      const ra = +res.headers.get('Retry-After') || 60;
      return { wait: Math.min(6 * 3600, Math.max(60, ra)) * 1000 };
    }
    const said = d.error && typeof d.error === 'object' ? d.error.message : d.error;
    return fail(code || 'error_' + res.status, String(said || 'The request was refused.').slice(0, 500));
  }
  const text = await res.text();
  const msg = _sseMessage(text, res.headers.get('X-AMV-Engine') || String(params.model || ''));
  await env.AMV_KV.put(`batchres:${rec.id}:${i}`, JSON.stringify({ type: 'succeeded', message: msg }), { expirationTtl: BATCH_KEEP_S });
  return { result: 'succeeded' };
}
/* The cron's share: every batch with work left, a slice of time each.

   In turns, from where the last tick stopped. Listing from the top every
   time served the first fifty ids in key order and nobody after them - and a
   batch waiting hours on a full window would have held its place at the
   front the whole time. Where to resume (the listing's page, and how far into
   it) is kept between ticks and wraps at the end.

   A few batches at once (BATCH_LANES), one item at a time within each: the
   tick is mostly waiting on the model, and every item is still its own
   ordinary request with its own reservations. */
const BATCH_LANES = 4;
async function runBatches(env, ctx) {
  const until = Date.now() + 4 * BATCH_TICK_MS;
  let at = { c: null, o: 0 };
  try { const v = JSON.parse((await env.AMV_KV.get('batchcursor')) || 'null'); if (v && typeof v === 'object') at = { c: v.c || null, o: Math.max(0, v.o | 0) }; } catch (e) {}
  const out = [];
  for (let pages = 0; pages < 4 && Date.now() < until; pages++) {
    let page;
    try { page = await env.AMV_KV.list(Object.assign({ prefix: 'batchq:', limit: 50 }, at.c ? { cursor: at.c } : {})); }
    catch (e) { if (!at.c) throw e; at = { c: null, o: 0 }; continue; }   /* a cursor that no longer works starts again from the top */
    const ids = page.keys.slice(at.o).map(k => k.name.slice('batchq:'.length));
    let next = 0;
    const lane = async () => {
      while (next < ids.length && Date.now() < until) {
        const i = next++;
        out.push(await _batchRun(env, ctx, ids[i], BATCH_TICK_MS).catch(() => 'error'));
      }
    };
    await Promise.all(Array.from({ length: Math.min(BATCH_LANES, ids.length) }, lane));
    if (next < ids.length) { at = { c: at.c, o: at.o + next }; break; }
    at = page.list_complete || !page.cursor ? { c: null, o: 0 } : { c: page.cursor, o: 0 };
    if (!at.c) break;
  }
  try {
    if (at.c || at.o) await env.AMV_KV.put('batchcursor', JSON.stringify(at));
    else await env.AMV_KV.delete('batchcursor');
  } catch (e) {}
  return out;
}

/* ── COUNTING TOKENS BEFORE SENDING ─────────────────────────────────────────
   POST /v1/messages/count_tokens - how many input tokens a request would be,
   without running it. Free, nothing is reserved or counted against an
   allowance, and nothing is generated.

   Counted on what AMV would actually send, not on what the caller wrote: the
   identity framing every request carries is included, and so are the tools
   that would be forwarded - because that is the number the account is billed
   on. A count that left the framing out would be smaller than every bill.

   For AMV's own engines the count is the provider's, exact. A partner engine
   has no counting endpoint AMV can reach, so it gets AMV's own estimate, and
   says so (`estimate: true`) rather than passing one off as the other. */
async function aiCountTokens(request, env){
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in again.' }, 401);
  const blocked = await guardAction(env, 'count:' + user.email, 120, 20000, 'token counts');
  if (blocked) return blocked;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid request body.' }, 400);
  const vErr = validateMessagesPayload(body);
  if (vErr) return json({ error: vErr, code: 'invalid_input' }, 400);

  const rawModel = String(body.model || 'amv-core');
  /* Auto picks per request when it runs, so a count can only be for the engine
     it lands on most - Core - and the reply names it. */
  let key = (rawModel === 'auto' || rawModel === 'amv-auto') ? 'amv-core' : (RAW_TO_KEY[rawModel] || (ENGINES[rawModel] ? rawModel : ''));
  let partner = null;
  if (!key && PARTNER_KEY_RE.test(rawModel)) partner = (await _partnerEngines(env)).find(d => d.key === rawModel) || null;
  if (!key && !partner) return json({ error: 'That engine is not available. Choose one of AMV’s engines.', code: 'engine_unavailable' }, 400);

  const system = _systemWithIdentity(body.system);
  const tools = Array.isArray(body.tools) ? _safeTools(body.tools, { callerTools: user.via === 'apikey' }) : [];
  if (partner) {
    const est = _estimateReserveInput(Object.assign({}, body, { system }));
    return json({ input_tokens: est, engine: partner.key, estimate: true });
  }
  if (!_modelKey(env)) {
    return json({ error: 'AMV is not connected to a model on this deployment yet, so it cannot count. Nothing was charged.', code: 'needs_service' }, 503);
  }
  const eng = ENGINES[key];
  const payload = { model: eng.model, messages: body.messages, system: [{ type: 'text', text: system }] };
  if (tools.length) payload.tools = tools;
  if (eng.thinking) payload.thinking = { type: 'adaptive' };
  let r, d;
  try {
    r = await fetchDeadline(_modelBase(env) + '/v1/messages/count_tokens', { method: 'POST', headers: _modelHeaders(env),
      body: JSON.stringify(payload) }, 20000);
    d = await r.json().catch(() => ({}));
  } catch (e) {
    return json({ error: 'The count could not be made just now. Try again in a moment.', code: 'upstream_unavailable' }, 502);
  }
  if (!r.ok || typeof d.input_tokens !== 'number') {
    if (r.status === 400) return json({ error: 'That request could not be counted - it would be refused if sent as it is.', code: 'invalid_input' }, 400);
    return json({ error: 'The count could not be made just now. Try again in a moment.', code: 'upstream_unavailable' }, 502);
  }
  return json({ input_tokens: d.input_tokens, engine: key });
}

/* `principal` is given only by the batch runner (_batchItem), which resolves
   the batch's owner the same way requireUser would; every request from
   outside is authenticated here as always. */
async function aiProxy(request, env, ctx, principal) {
  const user = principal || await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in again.' }, 401);

  /* Before the key check, the rate limit and the reservation, because none of
     those should be spent deciding something already decided. Chat does not go
     through _spendGate - it enforces its own ceiling inline against a token
     reservation - so it has to ask here or the largest spending path in the
     product is the one the hold does not reach. */
  {
    const held = await _accountHold(env, user, 'chat');
    if (held) return held;
  }

  /* No model key, no request. This used to fall straight through: quota was
     reserved, a rate-limit slot spent, and an outbound call made with
     `x-api-key: ''` - which the provider refuses, so the person waited for a
     network round trip to be told something that was knowable before the
     request left. Every other integration here refuses up front and says which
     secret is missing (payments, SMS, Google, video); this is that, for the
     one that matters most. The 401 path below still exists, because a key that
     is SET and rejected is a different failure and pages the operator. */
  if (!_modelKey(env)) {
    audit(env, 'ai_unconfigured', { by: user.email });
    try { await alertOnce(env, 'model_key_missing',
      'AMV has no model key, so chat is refused for everyone. Set AMV_MODEL_KEY.', 60); } catch (e) {}
    return json({ error: 'AMV is not connected to a model on this deployment yet, so it cannot answer. Nothing has been charged or counted against your allowance.',
                  code: 'needs_service' }, 503);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid request body.' }, 400);

  // --- INPUT VALIDATION (auditor #4) ---
  // Reject malformed/oversized requests before they reach the model. This is
  // the first line of defense; it bounds cost and shrinks the attack surface.
  const vErr = validateMessagesPayload(body);
  if (vErr) return json({ error: vErr, code: 'invalid_input' }, 400);

  /* THIS ENDPOINT ONLY STREAMS, AND IT SHOULD SAY SO RATHER THAN PRETEND.

     `stream: true` is written into the upstream body below as a literal and
     the one success path returns text/event-stream, whatever the caller asked
     for. `body.stream` was never read at all - so a developer with an API key
     who sent `"stream": false`, which every client library in this shape
     offers, got a stream anyway, called .json() on it, and received a parse
     error with nothing anywhere explaining why.

     That is not hypothetical. It is LESSONS 309: the same mistake made inside
     AMV silently broke every surface except chat, and it took a long time to
     find precisely because the failure carries no explanation. Shipping it as
     the documented behaviour of a paid API is the same trap sold to somebody
     who cannot read this file.

     Refused rather than ignored, before the rate limit and before any
     reservation, so nothing is counted against an account for a request that
     was never going to work. Nothing that works today sends this: a caller
     passing stream:false is already broken, and is now broken loudly. */
  if (body.stream === false) {
    return json({ error: 'This endpoint always streams. Read the response body as text/event-stream rather than as JSON - "stream": false is not supported. Omit the field or send "stream": true.',
                  code: 'stream_required' }, 400);
  }

  /* A client-supplied id for this turn, so a dropped connection can ask for the
     answer back (AMV-070). Validated rather than trusted - it becomes part of a
     KV key, and it is namespaced by the caller's own email either way. */
  const _rawId = String(request.headers.get('X-AMV-Request-Id') || '');
  const _reqId = /^[A-Za-z0-9_-]{6,64}$/.test(_rawId) ? _rawId : '';

  // resolve requested engine
  const rawModel = body.model || 'amv-core';
  const limits = effectiveLimits(user);
  /* 'auto' is routed for real (AMV-065), not aliased to one engine. The plan
     ceiling is applied inside the router, and the choice is reported back so
     the interface can name the engine that actually answered. */
  const isAuto = rawModel === 'auto' || rawModel === 'amv-auto';
  let routed = isAuto ? _autoRoute(body, user, limits) : null;
  /* Auto never routes to an engine the team has not allowed. Core is always
     allowed, and it is where the router's own plan cap lands as well. */
  if (routed && Array.isArray(user.teamEngines) && !user.teamEngines.includes(routed.key)) {
    routed = { key: 'amv-core', why: 'Balanced engine - your team has not turned on the deeper one' };
  }
  /* A PARTNER ENGINE, OR AN AMV NAME NOTHING ANSWERS TO.

     An `amv-*` name that is not one of the primary engines is either a live
     partner engine or not available - and "not available" is said, never
     quietly answered by a different engine the person did not choose. */
  let partnerEng = null;
  if (!routed && PARTNER_KEY_RE.test(rawModel) && !ENGINES[rawModel] && !RAW_TO_KEY[rawModel]) {
    partnerEng = (await _partnerEngines(env)).find(d => d.key === rawModel) || null;
    if (!partnerEng) {
      return json({ error: 'That engine is not available right now. Choose another, or try again later.', code: 'engine_unavailable' }, 503,
                  { 'Retry-After': '300' });
    }
  }
  const key = routed ? routed.key : partnerEng ? partnerEng.key
            : (RAW_TO_KEY[rawModel] || (ENGINES[rawModel] ? rawModel : 'amv-core'));
  // Carry the engine's own name with it, so metering can bucket by engine
  // without re-deriving it from the model string.
  const eng = partnerEng ? Object.assign({}, partnerEng) : Object.assign({ key }, ENGINES[key]);

  // 1) PLAN ENFORCEMENT - free can't call premium engines (custom plans paid for all models)
  if (!limits.allModels && _planRankOf(user.plan, user.customCfg) < PLAN_RANK[eng.minPlan]) {
    return json({ error: `${key} requires the ${eng.minPlan} plan. Upgrade to use it.`, code: 'plan_required', minPlan: eng.minPlan }, 402);
  }
  /* 1b) THE TEAM'S CHOICE. Refused, never quietly swapped for an allowed
     engine: the person picked this one and should know why it did not run. */
  if (Array.isArray(user.teamEngines) && !user.teamEngines.includes(key)) {
    return json({ error: `Your team has not turned on ${_engineTitle(key, eng)}. Choose another engine, or ask your team\u2019s owner or an admin to allow it in Team.`,
                  code: 'team_policy', engine: key }, 403);
  }

  // 2) RATE LIMIT (per account, per minute) - ATOMIC test-and-increment.
  //    A Durable Object serializes this op, so parallel requests can't race
  //    past the limit (the bug a plain KV read-then-write would have).
  //
  //    Deliberately per EMAIL, not per billing subject: tokens and cost are a
  //    budget and a team shares one, but requests-per-minute is a burst control
  //    on one human at one keyboard. Pooling it would have ten teammates
  //    throttling each other for typing at the same time (AMV-100).
  const rlName = `rl:${user.email}:${Math.floor(Date.now() / 60000)}`;
  const rlRes = await counter(env, rlName, { op: 'rateCheck', limit: limits.rpm, windowMs: 60000 });
  if (!rlRes.allowed) {
    audit(env,'rate_block',{email:user.email});
    /* The burst limit on the hottest route in the product. Without the header
       the client's backoff retries inside the same minute window, so one
       refusal becomes three, each spending a counter op. */
    const ra = _retryAfterWindow();
    return json({ error: 'Rate limit reached. Slow down a moment.', code: 'rate_limited', retryAfter: ra },
                429, { 'Retry-After': String(ra) });
  }

  // 3) QUOTA CHECK (per account, day + month)
  //
  // RESERVE-THEN-RECONCILE. The obvious version of this is:
  //     read used -> compare to cap -> call the model -> add what it cost
  // That races. Twenty parallel requests all read the SAME `used`, all decide
  // they're under the cap, and all call the model. Measured on the free plan:
  // 8 concurrent requests burned 160,000 tokens against a 50,000/day cap - a
  // 3.2x overshoot, trivially triggered from devtools with a fetch loop.
  //
  // So instead we RESERVE an upper bound atomically BEFORE calling the model.
  // The counter is a Durable Object, so the increment is serialised: only the
  // requests that actually fit under the cap get through. meterStream() then
  // reconciles the reservation against what the call really cost (refunding the
  // difference), so nobody is over-billed for reserving conservatively.
  /* Keyed by the billing SUBJECT, not the email: a team shares one plan, so it
     shares one allowance. Keying by email would multiply the plan by the number
     of people on it (AMV-100). */
  const subject = user.billingSubject || user.email;
  const dName = `usg:${subject}:${todayKey()}`;
  const mName = `usg:${subject}:${_periodKeyOf(user)}`;
  /* EXTRA USAGE (see _creditGrant). Looked at only when one of the plan's own
     limits is reached: then, if the account has prepaid credit, the message
     goes ahead on it - booked against the credit before the model runs and
     settled after, at CREDIT_MARKUP - and `overflowWhy` keeps the refusal it
     replaced, so a credit too small to cover it gives the plan's own answer. */
  let overflowWhy = null, credit = null;
  const creditCovers = async () => {
    if (!_creditEligible(user)) return false;
    credit = credit || await _creditState(env, subject);
    return credit.left > 0;
  };

  // Upper bound for this call: what we're sending + the most it can generate.
  const estIn  = _estimateReserveInput(body);
  /* The engine's own ceiling when the caller names none - that is what the
     upstream call below is sent, so reserving a flat 1,024 instead let a
     request with no max_tokens book a sixteenth of what it could spend. */
  const _outCap = Number(eng.maxOut) || 16000;
  let estOut = Math.max(1, Math.min(Number(body.max_tokens) || _outCap, _outCap));
  let reserve = estIn + estOut;

  /* FIT THE ANSWER TO WHAT IS LEFT, RATHER THAN REFUSE THE QUESTION.

     The reservation books the longest answer the request allows. On the free
     plan that alone was most of the day: a 16,000-token ceiling plus ~4,000
     tokens of AMV's own instructions against a 20,000-token day. So a free
     account whose instructions or conversation had grown a little was told
     "Daily usage limit reached" on its FIRST message, having used nothing.

     When the full booking does not fit, the answer's ceiling is lowered to
     exactly what remains (never below ANSWER_FLOOR_TOKENS, so there is room
     for a real answer) and that smaller amount is booked. The cap holds just
     as tightly - max_tokens below is set to the same number - it only stops
     refusing questions it has room to answer. */
  const tryFit = async (name, cap, ttlMs) => {
    let res = await counter(env, name, { op: 'reserve', amount: reserve, cap, ttlMs });
    if (res.allowed) return res;
    const used = (await counter(env, name, { op: 'get' })).value || 0;
    const fit = Math.floor(cap - used - estIn);
    if (fit < ANSWER_FLOOR_TOKENS || fit >= estOut) return res;
    estOut = fit; reserve = estIn + estOut; body.max_tokens = estOut;
    return await counter(env, name, { op: 'reserve', amount: reserve, cap, ttlMs });
  };

  const dRes = await tryFit(dName, limits.dayTokens, 86400000 * 35);
  if (!dRes.allowed) {
    const now = new Date();
    const resetAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const why = { error: 'Daily usage limit reached.', code: 'quota_day', resetAt };
    if (!(await creditCovers())) return json(why, 429, { 'Retry-After': _retryAfterUntil(resetAt) });
    /* Booked past the cap, so the settlement after the call lands on a counter
       that holds what was really used. */
    await counter(env, dName, { op: 'incr', amount: reserve, ttlMs: 86400000 * 35 });
    overflowWhy = why;
  }
  /* The month is fitted the same way. If it shrinks the answer further, the
     day was booked at the larger amount, so the difference is given back to
     the day at once rather than at reconciliation. */
  const dayBooked = reserve;
  const mRes = await tryFit(mName, limits.monthTokens, 86400000 * 70);
  if (mRes.allowed && reserve < dayBooked) await counter(env, dName, { op: 'incr', amount: reserve - dayBooked, ttlMs: 86400000 * 35 });
  if (!mRes.allowed) {
    /* The BILLING period, not the calendar month - `mName` above is keyed on
       `_periodKeyOf(user)`, so the calendar 1st was the wrong date for every
       paying account and the client unlocked the composer on it. */
    const resetAt = _periodResetAtOf(user);
    const why = { error: 'Monthly usage limit reached. Upgrade for more room.', code: 'quota_month', resetAt };
    if (!(await creditCovers())) {
      // give back the daily reservation we just took - this call isn't happening
      await counter(env, dName, { op: 'incr', amount: -dayBooked, ttlMs: 86400000 * 35 });
      return json(why, 429, { 'Retry-After': _retryAfterUntil(resetAt) });
    }
    await counter(env, mName, { op: 'incr', amount: reserve, ttlMs: 86400000 * 70 });
    overflowWhy = overflowWhy || why;
  }

  /* AND THE MESSAGE, COUNTED WHERE THE TOKENS ARE COUNTED.

     Messages are what the plan is sold in, so they are reserved the same way
     and under the same refund discipline - booked before the model runs,
     given back by refundReservation if the call never happens. Counting them
     after a success instead would undercount every turn that failed halfway,
     which is the direction that costs the operator rather than the customer.

     Keyed on the billing SUBJECT and the billing PERIOD, exactly as the tokens
     are: a team shares one plan so it shares one message allowance, and the
     period is the one the customer is billed on rather than the calendar
     month. A separate key from `usg:` so nothing already stored changes
     meaning. */
  const msgName = `msgs:${subject}:${_periodKeyOf(user)}`;
  const msgCap = Number(limits.monthMessages) || 0;

  /* THREE WINDOWS, AND THEY ANSWER DIFFERENT QUESTIONS.

     The five-hour one bounds a burst and is the only one an ordinary person
     will ever see - and seeing it costs them a few hours, not the rest of the
     month. The weekly one bounds the DEAREST engine, which is where the money
     actually goes, and is what makes the best engine affordable on the
     cheapest paid plan. The monthly one is the backstop behind both.

     Booked smallest-window-first so the message a customer gets names the
     limit that will clear soonest. Refused the other way round, somebody a few
     messages into a burst would be told to come back next month when in fact
     they can come back at four o'clock.

     Every one of them is given back by the same refund as the tokens, and a
     refusal at any stage hands back everything booked before it - a partial
     booking left behind is an allowance nobody spent. */
  const nowMs = Date.now();
  /* One window per account that opens with its first message (op 'session'). */
  const win5Name = `msgs5h:${subject}`;
  const win5Cap = Number(limits.messages5h) || 0;
  const topName = `msgtop:${subject}:${weekKey(nowMs)}`;
  const topCap = Number(limits.topMessagesWeek) || 0;
  /* Only the engines that actually cost the money are counted weekly. The
     cheaper ones are what everyday use runs on, and metering those against a
     weekly ceiling would be rationing the thing that is nearly free.

     DERIVED FROM THE TABLE, NOT TYPED. This read `inCost >= 10`, which is the
     dearest rate as it happens to stand today. The moment a rate moves - and
     one moved twice this week - that literal either meters an engine that is
     no longer expensive or stops metering the one that is, silently, with the
     weekly ceiling simply not applying to the thing it exists for. */
  const isTopEngine = eng && eng.inCost >= _DEAREST_ENGINE_IN_COST;

  const booked = [];
  const unbook = async () => {
    for (const b of booked) {
      try {
        if (b.session) await counter(env, b.name, { op: 'sessionRelease', start: b.session, amount: b.amount });
        else await counter(env, b.name, { op: 'incr', amount: -b.amount, ttlMs: b.ttlMs });
      } catch (e) {}
    }
  };
  const refuseWindow = async (message, code, resetAt) => {
    await counter(env, dName, { op: 'incr', amount: -reserve, ttlMs: 86400000 * 35 });
    await counter(env, mName, { op: 'incr', amount: -reserve, ttlMs: 86400000 * 70 });
    await unbook();
    return json({ error: message, code, resetAt }, 429, { 'Retry-After': _retryAfterUntil(resetAt) });
  };
  /* A window that is full is a refusal - unless prepaid credit carries it. */
  const windowOrCredit = async (message, code, resetAt) => {
    if (await creditCovers()) { overflowWhy = overflowWhy || { error: message, code, resetAt }; return null; }
    return await refuseWindow(message, code, resetAt);
  };

  if (win5Cap > 0) {
    const r5 = await counter(env, win5Name, { op: 'session', amount: 1, cap: win5Cap, windowMs: WINDOW_5H_MS });
    if (!r5.allowed) {
      const resetAt = (+r5.start || nowMs) + WINDOW_5H_MS;
      const refused = await windowOrCredit(
        'That is a lot of messages in a short space of time, so this window is full. It reopens at '
        + new Date(resetAt).toUTCString().replace(/ GMT$/, ' UTC') + ' - a few hours, not the rest of the month.',
        'quota_window', resetAt);
      if (refused) return refused;
    } else booked.push({ name: win5Name, amount: 1, session: r5.start });
  }

  if (topCap > 0 && isTopEngine) {
    const rt = await counter(env, topName, { op: 'reserve', amount: 1, cap: topCap, ttlMs: 86400000 * 21 });
    if (!rt.allowed) {
      const monday = new Date(weekKey(nowMs) + 'T00:00:00Z').getTime();
      const resetAt = monday + 7 * 86400000;
      /* Named as what it is - the best engine, not "your plan" - because the
         rest of the product is still working and telling somebody they are out
         of messages when they are not is how a cancellation starts. */
      const refused = await windowOrCredit(
        'That is this week\u2019s allowance on AMV\u2019s best engine. Everything else still works, and the '
        + 'best engine comes back on ' + new Date(resetAt).toUTCString().replace(/ GMT$/, ' UTC') + '.',
        'quota_top_week', resetAt);
      if (refused) return refused;
    } else booked.push({ name: topName, amount: 1, ttlMs: 86400000 * 21 });
  }

  let msgRes = { allowed: true };
  if (msgCap > 0) {
    msgRes = await counter(env, msgName, { op: 'reserve', amount: 1, cap: msgCap, ttlMs: 86400000 * 70 });
    if (!msgRes.allowed) {
      const resetAt = _periodResetAtOf(user);
      /* Reaching this is not an ordinary customer running out. The caps are set
         where only a script arrives, so the message says what is true rather
         than inviting somebody to buy their way past it. */
      return await refuseWindow(
        'This account has sent far more messages than a person can send in a month, so it has been paused. If that was not you, change your password; if it was, get in touch and we will sort it out.',
        'quota_messages', resetAt);
    }
    booked.push({ name: msgName, amount: 1, ttlMs: 86400000 * 70 });
  }

  /* THE SHAPE OF THE DISTRIBUTION, COUNTED AT THE TWO MOMENTS IT CHANGES.

     Measuring "what share of accounts are heavy" by scanning every account
     would be a read per account per sweep, which is the kind of cost that gets
     a measurement deleted. It is two counters instead, each written at most
     once per account per period: one when an account sends its first message,
     one when it crosses its own break-even. Everything in between is free.

     Best effort on purpose. This is instrumentation, and instrumentation that
     can fail somebody's message is worse than no instrumentation. */
  if (msgCap > 0 && msgRes.allowed) {
    try {
      const period = _periodKeyOf(user);
      if (msgRes.value === 1) {
        await counter(env, `cohort:active:${period}`, { op: 'incr', amount: 1, ttlMs: 86400000 * 70 });
      }
      const breakEven = _breakEvenMessages(user);
      if (breakEven > 0 && msgRes.value === breakEven) {
        await counter(env, `cohort:heavy:${period}`, { op: 'incr', amount: 1, ttlMs: 86400000 * 70 });
        audit(env, 'cohort_heavy', { plan: user.plan, at: breakEven });
      }
    } catch (e) { /* never let a measurement refuse a message */ }
  }

  // From here on, `reserve` tokens are already booked against this user. Any
  // early return below MUST refund them, or a failed call would silently eat
  // someone's quota.
  const refundReservation = async () => {
    try {
      await counter(env, dName, { op: 'incr', amount: -reserve, ttlMs: 86400000 * 35 });
      await counter(env, mName, { op: 'incr', amount: -reserve, ttlMs: 86400000 * 70 });
      /* Every window goes back with the tokens. Left out, a run of failed calls
         would eat an allowance nobody spent - and because the caps are large,
         it would do it invisibly for a long time. `booked` is what was actually
         taken, so this cannot drift from the bookings above the way three
         hand-written refunds would. */
      await unbook();
    } catch (e) { /* never throw out of a refund */ }
    /* AMV-004: and the dollars, which are booked before the model runs for the
       same reason the tokens are. Every refusal below already calls this, so
       folding the money in here is what stops a new early return from giving
       back the allowance and silently keeping the charge.

       Declared after this closure and read only when it is called, which is
       always after they exist - the two quota refusals above return before
       either is booked, and they refund inline rather than through this. */
    await releaseUSD();
  };

  const mUsed = mRes.value || 0;
  const dUsed = dRes.value || 0;
  // (month cap already enforced by the reservation above)

  // 3b) COST BACKSTOP - applies to EVERY paid plan. A user can never cost us
  //     more than a safe fraction of what they paid, guaranteeing margin even
  //     if they run 100% on the most expensive model. This is the profit lock.
  const costName = `cost:${user.billingSubject || user.email}:${_periodKeyOf(user)}`;
  /* The day's ceiling is named here rather than at the block that uses it, so
     the release closure below can reach it. Both dollar ceilings are booked
     before the model runs and both have to be givable back together. */
  const gName = `spend:${todayKey()}`;
  const gCap = parseFloat(env.GLOBAL_DAILY_USD_CAP || '500');
  const _paying = _planPriceUSD(user.plan, user.customCfg) > 0;
  const gCapForThem = _paying ? gCap : +(gCap * FREE_TIER_CAP_SHARE).toFixed(2);
  /* One definition, shared with _spendGate - see _monthlyCeilingUSD. It used
     to be written out here and only here, which is why it bound chat and
     nothing else. */
  const ceiling = _monthlyCeiling(user);
  const costCeiling = ceiling.value;
  /* AMV-004: the most this call can cost, priced from the tokens already
     reserved above. Booked before the model runs rather than read, so a burst
     of parallel requests cannot all pass the same total - the token allowance
     three blocks up has worked this way since an 8-request burst was measured
     at 3.2x its cap, and the dollar ceiling was left on the racing version.

     An upper bound, so it is settled after the call rather than charged. The
     cost of over-reserving is that somebody a few cents from their ceiling is
     stopped one call early, which is the right direction for a control that
     exists to stop a bill. */
  const estUSD = (((estIn + AI_INJECTED_INPUT_TOK) * AI_INPUT_SAFETY) / 1e6) * eng.inCost
               + (estOut / 1e6) * eng.outCost;
  let bookedUSD = 0, bookedGlobalUSD = 0, bookedCreditUSD = 0;
  const creditName = _creditSpentName(subject);
  const releaseUSD = async () => {
    if (bookedUSD > 0) { await _releaseUSD(env, costName, bookedUSD, 86400000 * 70); bookedUSD = 0; }
    if (bookedGlobalUSD > 0) { await _releaseUSD(env, gName, bookedGlobalUSD, 86400000 * 2); bookedGlobalUSD = 0; }
    if (bookedCreditUSD > 0) { await _releaseUSD(env, creditName, bookedCreditUSD, 0, true); bookedCreditUSD = 0; }
  };
  /* Already past a plan limit and running on credit: the plan's own dollar
     ceiling is not booked as well - the credit is what pays for this one. */
  if (costCeiling != null && !overflowWhy) {
    const capRes = await _reserveUSD(env, costName, estUSD, costCeiling, 86400000 * 70);
    bookedUSD = capRes.reserved;
    if (!capRes.allowed) {
      audit(env,'spend_cap_hit',{email:user.email,plan:user.plan,family:!!(user.family)});
      /* "Upgrade for more" is not an action a child can take. Tell them the
         true one: the person who set the limit is the person who can change
         it. Which one bound is decided in _monthlyCeiling, beside the numbers
         it was decided from. */
      const hitFamilyCap = ceiling.source === 'family';
      const capResetAt = _periodResetAtOf(user);
      if (!hitFamilyCap && await creditCovers()) {
        overflowWhy = { error: 'You\u2019ve used your full plan allowance for this billing cycle. It resets next month, or upgrade for more.',
                        code: 'quota_month', resetAt: capResetAt };
      } else {
        await refundReservation();
        return json(hitFamilyCap
        ? { error: 'You have used the monthly limit set for your account. It resets next month, or whoever manages your family can raise it.',
            code: 'family_cap', resetAt: capResetAt }
        : { error: 'You\u2019ve used your full plan allowance for this billing cycle. It resets next month, or upgrade for more.',
            code: 'quota_month', resetAt: capResetAt }, 429,
                { 'Retry-After': _retryAfterUntil(capResetAt) });
      }
    }
  }
  /* Running on credit: book the most this message can cost, at the markup,
     against what was paid - atomically, so a burst cannot spend past it. Too
     little left is the plan's own refusal, with the balance said. */
  if (overflowWhy) {
    const cr = await _reserveUSD(env, creditName, estUSD * CREDIT_MARKUP, credit.bought, 0, true);
    bookedCreditUSD = cr.reserved;
    if (!cr.allowed) {
      await refundReservation();
      const resetAt = overflowWhy.resetAt;
      return json(Object.assign({}, overflowWhy, { credit: { balance: credit.balance, short: true } }), 429,
                  { 'Retry-After': _retryAfterUntil(resetAt) });
    }
    audit(env, 'credit_used', { by: user.email, code: overflowWhy.code });
  }

  // 4) GLOBAL SPEND CAP - hard ceiling across ALL users (atomic read)
  /* AMV-195: THE FREE TIER MUST NOT BE ABLE TO LOCK OUT PAYING CUSTOMERS.

     One cap, checked the same way for everybody, meant a busy day of free usage
     could exhaust it and the next request refused was somebody on Ultra. AMV
     has taken their money and cannot deliver - which is a refund, a chargeback,
     and a fair complaint, all caused by traffic that pays nothing.

     So the cap is shared but not equally. Free accounts stop at a fraction of
     it; paying accounts keep the whole thing. When the day is busy the free
     tier is what gets shed, which is the correct order - and the message says
     so honestly rather than implying AMV is broken. */
  const gRes = await _reserveUSD(env, gName, estUSD, gCapForThem, 86400000 * 2);
  bookedGlobalUSD = gRes.reserved;
  if (!gRes.allowed && !_paying) {
    /* Free, and the day's free budget is spent. Paying accounts are unaffected
       and are told so, because "AMV is down" and "AMV is busy for free accounts"
       are different sentences and only one of them is true. */
    audit(env, 'free_cap_hit', { value: gRes.value || 0, cap: gCapForThem, email: user.email });
    await refundReservation();
    return json({ error: 'AMV is at capacity for free accounts today - it resets tomorrow. Paid plans are running normally.',
                  code: 'free_capacity' }, 503, { 'Retry-After': _retryAfterMidnight() });
  }
  if (!gRes.allowed) {
    audit(env,'global_cap_hit',{value:gRes.value||0,cap:gCap}); ctx.waitUntil(notify(env, `GLOBAL DAILY SPEND CAP HIT: $${(gRes.value||0).toFixed(2)} >= $${gCap}`));
    await refundReservation();   // the call never happened - don't eat their quota
    return json({ error: 'Service is at capacity for today. Please try again tomorrow.', code: 'global_cap' }, 503,
                { 'Retry-After': _retryAfterMidnight() });
  }

  // 5) clamp output tokens to the engine max (cost ceiling per call)
  const maxTokens = Math.min(body.max_tokens || eng.maxOut, eng.maxOut);

  // 6) build the upstream request - inject prompt caching to cut input cost
  const upstreamBody = {
    model: eng.model,
    max_tokens: maxTokens,
    stream: true,
    // Cache the conversation prefix, not only the system prompt (AMV-066).
    messages: _withCacheBreakpoints(body.messages || [], eng),
  };
  /* Always sent, whether or not the client supplied one: the identity framing
     is ours and goes first (AMV-077). Cached, so repeat turns are ~90% cheaper
     on it - the preamble is constant, which makes it an ideal prefix. */
  /* (tool forwarding: see _safeTools) */
  upstreamBody.system = [{ type: 'text', text: _systemWithIdentity(body.system),
                           cache_control: { type: 'ephemeral' } }];
  // Only forward tools we explicitly support - never pass arbitrary client
  // tool definitions straight upstream (auditor #4: bounds attack + cost surface).
  /* Thinking and effort, only for engines that accept them. Sending `effort`
     to an engine that does not support it is a 400, so it is opt-in per model
     rather than blanket. */
  if (eng.thinking) upstreamBody.thinking = { type: 'adaptive' };
  /* What the caller asked for, clamped to what their plan may have. The
     resolved value is echoed back on the response so the surface shows what
     actually ran rather than what it requested - a picker that reports its
     own wish is how a clamped control comes to look broken. */
  const _effort = _resolveEffort(eng, body.effort, _planRankOf(user.plan, user.customCfg));
  if (_effort) upstreamBody.output_config = { effort: _effort };
  if (eng.speed) upstreamBody.speed = eng.speed;
  if (body.tools && Array.isArray(body.tools)) {
    const safe = _safeTools(body.tools, { callerTools: user.via === 'apikey' });
    if (safe.length) upstreamBody.tools = safe;
  }

  /* stream:true - this response goes straight to the user, so it must never be
     retried on another endpoint: words already delivered would be repeated. */
  const _callUpstream = eng.provider === 'partner'
    /* A partner engine: the same turn, translated for the partner, answered
       in AMV's own event stream (see PARTNER ENGINES). */
    ? (payload) => _partnerCall(env, eng, { system: _systemWithIdentity(body.system), messages: body.messages || [],
                                             tools: payload.tools, max_tokens: payload.max_tokens, effort: body.effort })
    : (payload) => _modelFetch(env, payload, payload.speed
    ? { stream: true, headers: { [MODEL_BETA_HEADER]: FAST_MODE_BETA } } : { stream: true });

  /* A THROW BURNS THE ALLOWANCE THAT AN ERROR STATUS GIVES BACK.

     Every refusal below this point refunds, and the comment on the first one
     says why: "otherwise an outage would quietly burn through everyone's daily
     quota". That was true of an error STATUS. _modelFetch also THROWS - on a
     socket failure, a DNS failure, a timeout - and a throw walked straight past
     all of it with `reserve` tokens still booked against the person.

     Which is exactly backwards. An HTTP 500 from the model is the mild case;
     the network being down is the one that fails every request at once, and it
     was the one that charged for the failure. A handful of them is a free
     account's whole day, spent on answers nobody received.

     Caught rather than left to the top-level handler because only here is it
     known what to give back. The person is told the truth - AMV could not
     reach the model, nothing was counted - with a code the client already
     treats as worth retrying, since a network blip usually is. */
  let upstream;
  try {
    upstream = await _callUpstream(upstreamBody);
  } catch (netErr) {
    await refundReservation();
    try { await _workerError(env, 'aiProxy:unreachable', netErr); } catch (_) {}
    try { await alertOnce(env, 'model_unreachable',
      'AMV cannot reach the model endpoint at all (network error, not an error status). Chat is failing for everyone. '
      + 'Check AMV_MODEL_URL and the provider’s status.', 10); } catch (_) {}
    return json({ error: 'AMV could not reach the model just now. Nothing has been counted against your allowance - please try again in a moment.',
                  code: 'provider_error' }, 503);
  }

  /* FAST CAPACITY IS ITS OWN, AND WHEN IT IS FULL THE ANSWER STILL COMES.

     Fast mode has a rate limit separate from the engine's standard one, and
     is a preview the provider may decline. Either way the person asked a
     question, not for a speed: the same request goes again at standard speed
     and is billed at the standard rate (the reservation was taken at the fast
     rate, so settling at the lower one only gives money back). The response
     says which speed ran. */
  let _speed = upstreamBody.speed || '';
  if (_speed && (upstream.status === 429 || upstream.status === 400 || upstream.status === 503)) {
    const why = await upstream.clone().text().catch(() => '');
    if (upstream.status !== 400 || /speed|fast/i.test(why)) {
      const std = Object.assign({}, upstreamBody); delete std.speed;
      try {
        const again = await _callUpstream(std);
        if (again.ok) {
          upstream = again; _speed = 'standard';
          eng.inCost = eng.stdIn || eng.inCost; eng.outCost = eng.stdOut || eng.outCost;
          audit(env, 'fast_mode_fell_back', { status: upstream.status, why: why.slice(0, 100) });
        }
      } catch (_) { /* the original response stands and is handled below */ }
    }
  }

  /* AMV-068: a rejected OPTIONAL parameter must not take AI down for everyone.
     thinking, output_config and cache_control are tuning, not the request. If a
     model ever stops accepting one of them, a 400 here would break every chat
     in the product until someone noticed and shipped a fix. So one retry with
     the optional parts stripped: the answer is slightly less tuned and the
     product keeps working. A 400 about the messages themselves is a real
     client error and is NOT retried. */
  if (upstream.status === 400 && eng.provider !== 'partner') {
    const raw = await upstream.clone().text().catch(() => '');
    if (/thinking|output_config|effort|cache_control|unexpected|unsupported|unrecognized/i.test(raw)) {
      const plain = {
        model: upstreamBody.model, max_tokens: upstreamBody.max_tokens, stream: true,
        messages: (body.messages || []),                       // no cache markers
      };
      if (body.system) plain.system = String(body.system);      // no cache marker
      if (upstreamBody.tools) plain.tools = upstreamBody.tools;
      /* AMV-021: INSIDE THE CATCH THAT REFUNDS, LIKE THE FIRST CALL.

         The first _callUpstream is wrapped in a try/catch that refunds the
         caller's reservation when the provider cannot be reached. This retry
         was not, so a network failure on the second attempt left the request
         with the quota already taken and nothing to show for it. The customer
         pays for an attempt that never produced an answer, and the only path
         that reaches this line is one where something already went wrong. */
      let retry = null;
      try {
        retry = await _callUpstream(plain);
      } catch (netErr) {
        await refundReservation();
        try { await _workerError(env, 'aiProxy:retry-unreachable', netErr); } catch (_) {}
        return json({ error: 'AMV could not reach the model just now. Nothing was charged - try again in a moment.',
                      code: 'upstream_unreachable' }, 502);
      }
      if (retry.ok) {
        audit(env, 'upstream_param_fallback', { key, reason: raw.slice(0, 120) });
        try { await alertOnce(env, 'model_param_reject',
          'AMV dropped an optional model parameter after a 400 and retried successfully. Chats still work, but tuning (thinking/effort/caching) is off for ' + key + '. Reason: ' + raw.slice(0, 160), 60); } catch (_) {}
        upstream = retry;
      }
    }
  }

  if (!upstream.ok) {
    // The model errored, so it produced nothing. Give the reservation back -
    // otherwise an outage would quietly burn through everyone's daily quota.
    await refundReservation();
    const e = await upstream.json().catch(() => ({}));
    try { await _workerError(env, 'aiProxy:upstream', new Error('upstream ' + upstream.status)); } catch (_) {}
    // A 401/403 from the model means your API key is bad/expired/over-quota -
    // that breaks the ENTIRE product for everyone, so alert loudly and fast.
    if (upstream.status === 401 || upstream.status === 403) {
      ctx.waitUntil(alertOnce(env, 'model_auth_fail', `🚨 Model API rejected our key (${upstream.status}): ${e?.error?.message || 'auth error'}. AI is DOWN for all users - check AMV_MODEL_KEY / billing.`, 10));
    } else if (upstream.status >= 500) {
      ctx.waitUntil(alertOnce(env, 'model_5xx', `⚠️ Model API erroring (${upstream.status}). AI responses may be failing.`, 15));
    }
    return json({ error: e?.error?.message || 'AI error', status: upstream.status }, upstream.status);
  }

  // 7) pass the stream to the client AND tally tokens/cost as it flows
  const flow = _stopAwareStream(upstream.body, env, user && user.email, _reqId, ctx);
  const toClient = flow.toClient;
  /* The reservations are handed on so meterStream settles them instead of
     charging again. Passed by value AFTER every early return, so anything that
     refused above has already given them back and the numbers here are what is
     genuinely still booked. */
  ctx.waitUntil(meterStream(flow.toMeter, eng, { dName, mName, gName, costName, user, env, limits,
    reqMessages: body.messages || [], reserved: reserve,
    reservedUSD: bookedUSD, reservedGlobalUSD: bookedGlobalUSD, reqId: _reqId, stopped: flow.stopped,
    creditName: overflowWhy ? creditName : '', reservedCreditUSD: bookedCreditUSD }));

  return new Response(toClient, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...CORS, ...SECURITY_HEADERS,
      // Tell the client which engine actually ran. Without this, a routed turn
      // would be labelled "AMV Auto", which says nothing.
      'X-AMV-Engine': key,
      'X-AMV-Effort': _effort || '',
      'X-AMV-Speed': _speed,
      'X-AMV-Engine-Why': routed ? routed.why : '' },
  });
}

/* Read the SSE copy, extract usage, persist token + cost counters atomically.
   Hardened for accuracy (auditor #3):
   - Prices cache tiers correctly: cache READ ~0.1x input, cache WRITE ~1.25x.
   - Survives interruptions: tracks the latest usage seen, so a disconnect
     mid-stream still bills what was generated (never a free ride).
   - Handles message_start / message_delta / message_stop usage shapes.
   - Falls back to an output estimate if the stream yields no usage at all. */
