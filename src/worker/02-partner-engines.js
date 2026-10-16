/* ══════════════════════════════════════════════════════════════════════
   PARTNER ENGINES: OTHER COMPANIES' MODELS, SOLD AS AMV ENGINES.

   AMV buys models; it does not train them. This is the second supplier. A
   partner is any endpoint that speaks the widely shared chat-completions
   protocol (most model companies and the large cloud marketplaces offer one),
   configured by three settings and switched on by nothing else:

     AMV_PARTNER_URL      the endpoint's base, e.g. https://<host>/v1
     AMV_PARTNER_KEY      its key - read here and nowhere else
     AMV_PARTNER_ENGINES  JSON: the engines AMV sells on it, each
                          { key, model, label, minPlan, inCost, outCost,
                            maxOut, tokenParam?, reasoning?, vision?, tools? }

   AN ENGINE EXISTS ONLY WHEN THE PARTNER SAYS ITS MODEL DOES. The partner's
   own model list is read (cached for six hours) and an engine whose model id
   is not on it is not offered, not routable and not billable. A name in a
   settings field is a claim; the list is the evidence.

   EVERYTHING DOWNSTREAM IS UNCHANGED. The request is translated into the
   partner's shape, and its stream is translated back into the event stream
   the rest of AMV already reads - so the reservation, the metering, the
   refund on failure, the client's parser and every limit apply exactly as
   they do to the primary engines. Prices come from the engine's own entry,
   so a partner engine is billed at what it costs.

   NAMED AS AMV. The engines are AMV's (key and label are AMV names); the
   partner's model id never reaches a screen.
   ══════════════════════════════════════════════════════════════════════ */
const PARTNER_KEY_RE = /^amv-[a-z0-9-]{2,24}$/;

/* WHICH ENGINES A TEAM'S PEOPLE MAY USE.

   A company buying seats decides this, not each person: some keep the top
   engines for the people who need them, some keep everyone on one supplier's
   models. Set by the owner or an admin, stored on the team, and enforced here
   on the server for every member - the picker only reflects it.

   Pulse and Core are always allowed. Background jobs, chat summaries and the
   automatic router fall back to them, so a policy that removed them would not
   restrict anything - it would break the account. `null` means no policy:
   everything the plan allows. */
const TEAM_BASE_ENGINES = ['amv-pulse', 'amv-core'];
function _teamEngineList(team){
  const p = team && team.policy;
  if (!p || !Array.isArray(p.engines)) return null;
  return TEAM_BASE_ENGINES.concat(p.engines.filter(k => typeof k === 'string' && !TEAM_BASE_ENGINES.includes(k)));
}
/* The name a person knows an engine by. A partner engine carries its own. */
function _engineTitle(key, eng){
  if (eng && eng.label) return String(eng.label);
  const k = String(key || '').replace(/^amv-/, '');
  return 'AMV ' + k.charAt(0).toUpperCase() + k.slice(1);
}
const PARTNER_MODELS_TTL_S = 6 * 3600;

function _partnerConfigured(env){
  return !!(env && env.AMV_PARTNER_URL && env.AMV_PARTNER_KEY && env.AMV_PARTNER_ENGINES);
}
function _partnerBase(env){
  const u = String((env && env.AMV_PARTNER_URL) || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(u) ? u : '';
}
/* The engine entries, validated. A malformed entry is dropped, never guessed
   at: an engine with a missing price would be one AMV gives away. */
function _partnerEngineDefs(env){
  let raw;
  try{ raw = JSON.parse(String((env && env.AMV_PARTNER_ENGINES) || '[]')); }catch(e){ return []; }
  if(!Array.isArray(raw)) return [];
  const out = [];
  for(const d of raw.slice(0, 12)){
    if(!d || !PARTNER_KEY_RE.test(String(d.key || '')) || ENGINES[d.key]) continue;
    const inCost = +d.inCost, outCost = +d.outCost, maxOut = Math.floor(+d.maxOut);
    if(!(inCost > 0) || !(outCost > 0) || !(maxOut >= 256 && maxOut <= 128000)) continue;
    if(!/^[\w./:-]{1,120}$/.test(String(d.model || ''))) continue;
    if(!PLAN_RANK.hasOwnProperty(d.minPlan || 'pro')) continue;
    out.push({ key: d.key, provider: 'partner', model: String(d.model), label: String(d.label || d.key).slice(0, 40),
               minPlan: d.minPlan || 'pro', inCost, outCost, maxOut,
               tokenParam: d.tokenParam === 'max_tokens' ? 'max_tokens' : 'max_completion_tokens',
               reasoning: !!d.reasoning, vision: !!d.vision, tools: d.tools !== false,
               thinking: false, effort: null, cacheMin: 0 });
  }
  return out;
}
/* The partner's model ids, from the partner. Cached so a model list call is
   not paid on every message; a failure to read it is not cached, so a
   partner that was down an hour ago is asked again. */
async function _partnerModelIds(env){
  const base = _partnerBase(env);
  if(!base || !env.AMV_PARTNER_KEY) return null;
  const ck = 'partner:models:' + base;
  try{
    const hit = env.AMV_KV ? await env.AMV_KV.get(ck) : null;
    if(hit){ const arr = JSON.parse(hit); if(Array.isArray(arr)) return new Set(arr); }
  }catch(e){}
  try{
    const r = await fetchDeadline(base + '/models', { headers: { 'Authorization': 'Bearer ' + env.AMV_PARTNER_KEY } }, 8000);
    if(!r.ok) return null;
    const d = await r.json();
    const ids = (Array.isArray(d && d.data) ? d.data : []).map(m => m && m.id).filter(x => typeof x === 'string').slice(0, 5000);
    if(env.AMV_KV) await env.AMV_KV.put(ck, JSON.stringify(ids), { expirationTtl: PARTNER_MODELS_TTL_S });
    return new Set(ids);
  }catch(e){ return null; }
}
/* The engines that are really live right now. */
async function _partnerEngines(env){
  if(!_partnerConfigured(env)) return [];
  const defs = _partnerEngineDefs(env);
  if(!defs.length) return [];
  const ids = await _partnerModelIds(env);
  if(!ids) return [];
  return defs.filter(d => ids.has(d.model));
}

/* ── REQUEST: AMV's message shape -> the chat-completions shape ─────────── */
function _partnerText(c){
  if(typeof c === 'string') return c;
  if(!Array.isArray(c)) return '';
  return c.filter(b => b && b.type === 'text').map(b => b.text || '').join('\n');
}
function _partnerRequest(eng, body){
  const msgs = [];
  const sys = typeof body.system === 'string' ? body.system : _partnerText(body.system);
  if(sys) msgs.push({ role: 'system', content: sys });
  for(const m of (body.messages || [])){
    const c = m.content;
    if(typeof c === 'string'){ msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: c }); continue; }
    if(!Array.isArray(c)) continue;
    if(m.role === 'assistant'){
      const text = c.filter(b => b && b.type === 'text').map(b => b.text || '').join('');
      const calls = c.filter(b => b && b.type === 'tool_use').map(b => ({ id: String(b.id), type: 'function',
        function: { name: String(b.name), arguments: JSON.stringify(b.input || {}) } }));
      const out = { role: 'assistant', content: text || null };
      if(calls.length) out.tool_calls = calls;
      if(text || calls.length) msgs.push(out);
      continue;
    }
    /* A user turn: tool results become their own messages, in order, before
       whatever the person wrote alongside them. */
    for(const b of c.filter(b => b && b.type === 'tool_result')){
      msgs.push({ role: 'tool', tool_call_id: String(b.tool_use_id),
                  content: typeof b.content === 'string' ? b.content : _partnerText(b.content) });
    }
    const parts = [];
    for(const b of c){
      if(!b) continue;
      if(b.type === 'text') parts.push({ type: 'text', text: b.text || '' });
      else if(b.type === 'image' && b.source && b.source.type === 'base64' && eng.vision)
        parts.push({ type: 'image_url', image_url: { url: 'data:' + b.source.media_type + ';base64,' + b.source.data } });
      else if(b.type === 'image' || b.type === 'document')
        parts.push({ type: 'text', text: '[An attachment was included that this engine cannot read. Say so if it matters to the answer.]' });
    }
    if(parts.length) msgs.push({ role: 'user', content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts });
  }
  const req = { model: eng.model, messages: msgs, stream: true, stream_options: { include_usage: true } };
  req[eng.tokenParam] = Math.min(Number(body.max_tokens) || eng.maxOut, eng.maxOut);
  if(eng.tools && Array.isArray(body.tools)){
    const fns = body.tools.filter(t => t && t.name && t.input_schema && !t.type)
      .map(t => ({ type: 'function', function: { name: t.name, description: String(t.description || '').slice(0, 1024), parameters: t.input_schema } }));
    if(fns.length) req.tools = fns;
  }
  if(eng.reasoning && body.effort) req.reasoning_effort = ({ low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' })[body.effort] || undefined;
  return req;
}

/* ── RESPONSE: the partner's stream -> AMV's event stream ──────────────── */
function _partnerStream(upstream, eng){
  const enc = new TextEncoder(), dec = new TextDecoder();
  const sse = (type, data) => enc.encode('event: ' + type + '\ndata: ' + JSON.stringify(Object.assign({ type }, data)) + '\n\n');
  const STOP = { stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use', function_call: 'tool_use', content_filter: 'refusal' };
  let buf = '', idx = -1, open = null, openKind = '', usage = { input_tokens: 0, output_tokens: 0 }, stop = null, started = false;
  const tools = new Map();   // partner tool index -> our block index
  return new ReadableStream({
    async start(ctrl){
      const reader = upstream.body.getReader();
      const begin = () => { if(started) return; started = true;
        ctrl.enqueue(sse('message_start', { message: { id: 'msg_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24), type: 'message', role: 'assistant', model: eng.key, content: [], usage: { input_tokens: 0, output_tokens: 0 } } })); };
      const close = () => { if(open !== null){ ctrl.enqueue(sse('content_block_stop', { index: open })); open = null; openKind = ''; } };
      try{
        for(;;){
          const { value, done } = await reader.read();
          if(done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while((nl = buf.indexOf('\n')) >= 0){
            const line = buf.slice(0, nl).replace(/\r$/, ''); buf = buf.slice(nl + 1);
            if(!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if(!data || data === '[DONE]') continue;
            let ch; try{ ch = JSON.parse(data); }catch(e){ continue; }
            begin();
            if(ch.usage){ usage = { input_tokens: ch.usage.prompt_tokens || 0, output_tokens: ch.usage.completion_tokens || 0 }; }
            if(ch.error){ throw new Error(String((ch.error && ch.error.message) || 'partner error')); }
            const c = ch.choices && ch.choices[0];
            if(!c) continue;
            const d = c.delta || {};
            if(typeof d.content === 'string' && d.content){
              if(openKind !== 'text'){ close(); idx++; open = idx; openKind = 'text'; ctrl.enqueue(sse('content_block_start', { index: idx, content_block: { type: 'text', text: '' } })); }
              ctrl.enqueue(sse('content_block_delta', { index: open, delta: { type: 'text_delta', text: d.content } }));
            }
            for(const tc of (Array.isArray(d.tool_calls) ? d.tool_calls : [])){
              const k = tc.index != null ? tc.index : 0;
              if(!tools.has(k)){
                close(); idx++; open = idx; openKind = 'tool'; tools.set(k, idx);
                ctrl.enqueue(sse('content_block_start', { index: idx, content_block: { type: 'tool_use', id: String(tc.id || ('call_' + idx)), name: String((tc.function && tc.function.name) || ''), input: {} } }));
              }
              const args = tc.function && tc.function.arguments;
              if(args) ctrl.enqueue(sse('content_block_delta', { index: tools.get(k), delta: { type: 'input_json_delta', partial_json: args } }));
            }
            if(c.finish_reason) stop = STOP[c.finish_reason] || 'end_turn';
          }
        }
        begin(); close();
        ctrl.enqueue(sse('message_delta', { delta: { stop_reason: stop || 'end_turn' }, usage: { output_tokens: usage.output_tokens } }));
        ctrl.enqueue(sse('message_stop', { usage }));
        ctrl.close();
      }catch(e){
        try{ ctrl.enqueue(sse('error', { error: { type: 'api_error', message: 'The engine stopped partway: ' + String(e && e.message || e).slice(0, 200) } })); }catch(_){}
        try{ ctrl.close(); }catch(_){}
      }
    },
  });
}
/* One streamed call to the partner, answered in AMV's own event stream. A
   refusal before any output is a plain error response the caller already
   knows how to refund. */
async function _partnerCall(env, eng, body, signal){
  const base = _partnerBase(env);
  if(!base || !env.AMV_PARTNER_KEY) return new Response(JSON.stringify({ error: { message: 'This engine is not connected.' } }), { status: 503 });
  const r = await fetch(base + '/chat/completions', {
    method: 'POST', signal: signal || AbortSignal.timeout(MODEL_DEADLINE_MS),
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.AMV_PARTNER_KEY },
    body: JSON.stringify(_partnerRequest(eng, body)),
  });
  if(!r.ok || !r.body) return new Response(await r.text().catch(() => ''), { status: r.status || 502 });
  return new Response(_partnerStream(r, eng), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/* The dearest input rate on the ladder. The weekly ceiling exists to bound
   what the expensive engines cost, so which engines those ARE has to follow
   the table rather than a number somebody typed while looking at it. */
const _DEAREST_ENGINE_IN_COST = Math.max(...Object.values(ENGINES).map((e) => e.inCost));

/* ── EFFORT: A REAL CONTROL, WITH THE PLAN AS ITS CEILING ─────────────────
   Effort decides how hard the engine thinks, which decides what the call
   costs. It was fixed per engine, and a picker that changes nothing would be
   decoration; a picker anybody can raise would be a way for a free account to
   spend Ultra money. So it is a real request with a ceiling set by the plan.

   Down is always allowed, for everyone. "Run this one cheaper" is a thing
   people genuinely want and it can only reduce the bill, so there is no
   reason to gate it - and gating it would make the control feel like an
   upsell rather than a tool.

   Up needs Elite or above, and never goes past what the engine already runs
   at, so the ceiling is the smaller of the two.

   ONLY THE VALUES THIS SERVICE ALREADY SENDS UPSTREAM ARE LISTED. A lower
   step would be a nice third rung and is deliberately absent: sending an
   effort the upstream does not accept is a 400 on a live request, and the
   place to learn that is its documentation, not production. Adding one is a
   line in this table once it is verified. */
/* 'low' joined once it was verified on every engine in the table (the effort
   documentation lists it for all of them). It sits below the engines' own
   settings, so choosing it can only lower a bill - the ceiling logic below
   never needs to gate it. */
/* 'xhigh' and 'max' joined on the same evidence: the effort documentation
   lists all five levels for every engine in the table. They are the two that
   cost more, so each is a plan's to give. Spend still cannot run past the
   reservation - thinking is counted inside max_tokens, which is booked before
   the call - so a higher level spends more of an answer's ceiling on
   thinking, never more than the ceiling. */
const EFFORT_RANK = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 };
const EFFORT_LABEL = { low: 'Quick', medium: 'Balanced', high: 'High', xhigh: 'Extra high', max: 'Maximum' };
function _effortCeiling(eng, rank) {
  if (!eng.effort) return null;
  /* Below Elite the engine's own setting is the ceiling, so nobody can raise
     spend past what their plan already pays for. Elite reaches Extra high;
     Maximum, the dearest, is Ultra's. */
  if (rank >= PLAN_RANK.ultra) return 'max';
  if (rank >= PLAN_RANK.elite) return 'xhigh';
  return eng.effort;
}
function _resolveEffort(eng, want, rank) {
  if (!eng.effort) return null;                       // engine takes no effort
  const ceiling = _effortCeiling(eng, rank);
  if (want == null || !EFFORT_RANK.hasOwnProperty(want)) return eng.effort;
  /* Clamped to the ceiling, never above it - and an ask above the ceiling
     lands on the higher of the ceiling and the engine's own setting, so
     asking for more never quietly gets LESS than saying nothing would. */
  if (EFFORT_RANK[want] <= EFFORT_RANK[ceiling]) return want;
  return EFFORT_RANK[ceiling] >= EFFORT_RANK[eng.effort] ? ceiling : eng.effort;
}

/* The model behind a tier, read from the one place that defines it.
   Three worker paths hardcoded a model id instead - the browser agent's
   per-step decision (up to WEB_MAX_STEPS calls per run), the SMS agent, and the
   chat default. Retuning ENGINES therefore missed exactly the paths that fire
   most often, which is the opposite of what a tier table is for: switching to a
   cheaper provider has to be one edit, not a hunt for literals. */
function engineModel(key){
  const e = ENGINES[key] || ENGINES['amv-core'];
  return e.model;
}
// Map every form the frontend might send -> canonical engine key. The picker
// sends the real model string today, but we also accept the short keys
// (fast/core/coding/smart), the amv-* names, and 'auto' (smart routing ->
// core as a safe, cost-controlled default) so engine resolution is never a
// silent mis-default. (auditor #6: RAW_TO_KEY/engine resolution consistency)
const RAW_TO_KEY = {
  // real model strings
  'claude-haiku-5-5': 'amv-pulse', 'claude-sonnet-5-5': 'amv-core',
  'claude-haiku-4-5-20251001': 'amv-pulse', 'claude-haiku-4-5': 'amv-pulse',
  'claude-sonnet-5': 'amv-core',
  'claude-fable-5': 'amv-forge',
  'claude-fable-5-1': 'amv-apex',
  /* THIS MAP HAS TO FOLLOW THE TABLE, AND IT IS THE THING THAT FORGETS.

     Every entry here names a model string a client might send and the rung it
     should land on. When the ladder moved, these kept pointing at the rungs
     the strings USED to mean - the top engine's own model string resolved to
     the paid floor, so a picker asking for the best model would quietly have
     been served the one below it, with nothing failing anywhere.

     The ids below are previous-generation, kept because a cached client build
     still sends them. They resolve by CAPABILITY, not by the name they once
     had: the retired mid-tier lands on the paid floor, which is the nearest
     rung that is not a downgrade. */
  'claude-sonnet-4-6': 'amv-core',
  'claude-opus-5': 'amv-forge', 'claude-opus-4-8': 'amv-forge', 'claude-opus-4-7': 'amv-forge',
  // frontend short keys
  'fast': 'amv-pulse', 'core': 'amv-core', 'coding': 'amv-forge', 'smart': 'amv-apex',
  // amv-friendly aliases
  'amv-pulse': 'amv-pulse', 'amv-core': 'amv-core', 'amv-forge': 'amv-forge', 'amv-apex': 'amv-apex', 'amv-swift': 'amv-swift',
  'claude-opus-5-5': 'amv-swift',
  'swift': 'amv-swift',
  // smart routing -> balanced default
  'auto': 'amv-core', '': 'amv-core',
};
const PLAN_RANK = { free: 0, pro: 1, elite: 2, ultra: 3 };

/* The model provider's key, under an AMV name - and only that name.

   There used to be a second one here: the provider's own name, kept as a
   fallback "so an existing deployment does not stop answering the moment this
   ships". There is no existing deployment. Preflight still reports the KV
   namespace id as a placeholder, so nothing has ever run against real storage,
   and the alias was protecting a customer who does not exist at the cost of a
   standing rule - AMV does not carry another company's name in anything it
   ships, and a secret name is read by whoever opens the dashboard.

   One name. Everything that asks for it, alerts about it or checks for it
   already said AMV_MODEL_KEY; this was the last place that did not. */
function _modelKey(env){
  return (env && env.AMV_MODEL_KEY) || '';
}

/* ── THE MODEL TRANSPORT ───────────────────────────────────────────────────
   One place that knows where the model lives and how to talk to it.

   The endpoint, the auth header and the protocol version were copied into six
   call sites. That is not only duplication - it is why AMV had no answer to its
   provider having a bad hour. Changing where a request goes meant finding and
   editing six places correctly, so nobody was ever going to do it during an
   outage, which is the only time it matters.

   Now the destination is configuration. MODEL_API_URL points AMV at any
   endpoint speaking the same protocol - a gateway, a proxy, a second region -
   and MODEL_API_FALLBACK_URL is tried when the primary cannot answer.

   The fallback deliberately does NOT cover streaming. A stream that failed
   halfway has already delivered words to the user, and starting again on
   another endpoint would repeat them - a duplicated answer is a worse failure
   than an honest error. So it retries only requests that have produced nothing
   yet, and only for the failures that are worth retrying: a transport error, or
   a 5xx. A 400 means the request is wrong and sending it somewhere else makes
   the same wrong request twice. */
const MODEL_API_DEFAULT = 'https://api.anthropic.com';
const MODEL_API_VERSION = '2023-06-01';
/* The header that switches on a feature the provider ships as a beta (fast
   mode). Named once, beside the version header: same category - the API
   defines the name, and a request without it does not get the feature. */
const MODEL_BETA_HEADER = 'anthropic-beta';

function _modelBase(env, which){
  const raw = which === 'fallback'
    ? (env && env.MODEL_API_FALLBACK_URL)
    : (env && env.MODEL_API_URL) || MODEL_API_DEFAULT;
  return String(raw || '').replace(/\/+$/, '');
}

function _modelHeaders(env, extra){
  return Object.assign({
    'Content-Type': 'application/json',
    'x-api-key': _modelKey(env),          // the key never leaves the server
    'anthropic-version': MODEL_API_VERSION,
  }, extra || {});
}

/* One request to the model. `stream` marks a call whose response is handed
   straight to the user, which is what makes it ineligible for a retry. */
/* Long enough for a slow streamed answer, short enough that a stalled
   provider fails as a request rather than as a dead Worker. */
const MODEL_DEADLINE_MS = 120000;

/* What one inbound text can cost, for the reservation the SMS path takes before
   it runs. The output figure is runSmsAgent's own max_tokens; the input one is
   a generous allowance for a 1600-character message plus the system prompt.
   Both are upper bounds - the reservation is settled against the real usage the
   moment the turn returns, so over-reserving costs nothing but a slightly
   earlier refusal for somebody already at their ceiling. */
const SMS_MAX_OUT_TOK = 400;
const SMS_EST_IN_TOK = 1200;

/* WHAT AMV ITSELF ADDS TO EVERY REQUEST, IN TOKENS.

   _estimateReserveInput counts the caller's messages and the caller's system
   text. It does not count the identity framing AMV prepends, the tool
   definitions it forwards, or the cache-write premium - all of which are real
   input the provider bills for. So the estimate is reliably SMALLER than the
   truth, which is harmless for an allowance that settles up afterwards and not
   harmless at all for a dollar ceiling: if every reservation under-books, a
   burst still settles past the limit, just by less.

   A ceiling is only a ceiling if the reservation is an upper BOUND. This is the
   headroom that makes it one. Over-reserving costs nothing - the difference is
   given straight back when the turn settles - beyond refusing somebody who is
   already within a few cents of their limit, which is the right way to be
   wrong about money. */
const AI_INJECTED_INPUT_TOK = 4000;
const AI_INPUT_SAFETY = 1.25;      // cache writes are billed at ~125% of input

async function _modelFetch(env, payload, opts){
  const o = opts || {};
  const init = {
    method: 'POST',
    headers: _modelHeaders(env, o.headers),
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  };
  /* AMV-022: EVERY MODEL CALL HAS A DEADLINE, WHETHER THE CALLER SET ONE OR NOT.

     This used a signal only when the caller supplied one, and most call sites
     do not. A provider that accepts the connection and then stalls held the
     Worker, the caller's reservation and the request open until the platform
     killed the whole invocation - which is the worst way to fail, because the
     reservation is never refunded and nothing reports a cause.

     A caller that knows better still wins: an explicit signal is used as given,
     including one with a shorter deadline. This only fills in the gap. */
  if (o.signal) {
    init.signal = o.signal;
  } else {
    try { init.signal = AbortSignal.timeout(+o.timeoutMs || MODEL_DEADLINE_MS); } catch (_) {}
  }

  const primary = _modelBase(env);
  let r, err = null;
  try{ r = await fetch(primary + '/v1/messages', init); }
  catch(e){ err = e; }

  const worthRetrying = err || (r && r.status >= 500);
  const alt = _modelBase(env, 'fallback');
  if(worthRetrying && alt && alt !== primary && !o.stream){
    try{
      /* A FRESH DEADLINE, OR THE FAILOVER CANNOT SURVIVE THE FAILURE IT EXISTS
         FOR.

         This reused `init` unchanged, signal included. A caller's own signal is
         theirs and is left alone - if they cancelled, the whole thing is
         cancelled. But the deadline this function fills in when they supply
         none is ALREADY ABORTED by the time a timeout brings us here: the
         primary stalled, the signal fired, and handing that same signal to the
         second endpoint aborts it before the connection opens.

         So the failover worked for a transport error, where the signal is
         still live, and was inert for a hung provider - which is the failure
         mode a second endpoint is bought to cover, and the one nobody would
         have found until the outage. Nothing errors, nothing logs; the
         `catch(e2)` below swallows the immediate abort and the primary's error
         is reported as though there had been no fallback at all. */
      const init2 = Object.assign({}, init);
      if(!o.signal){
        try{ init2.signal = AbortSignal.timeout(+o.timeoutMs || MODEL_DEADLINE_MS); }
        catch(_){ delete init2.signal; }
      }
      const r2 = await fetch(alt + '/v1/messages', init2);
      /* Only report the failover when it actually rescued the request. Saying
         "we failed over" and then returning the same error is noise. */
      if(r2 && r2.ok){
        try{ await alertOnce(env, 'model_failover',
          '\u26a0\ufe0f The primary model endpoint failed and AMV fell back to the secondary. Requests are being served, but check the primary.', 30); }catch(_){}
        return r2;
      }
      if(!r) return r2;
    }catch(e2){ /* the fallback is a best effort; report the primary failure */ }
  }
  if(err) throw err;
  return r;
}

