/* =====================================================================
   AMV-065: SMART ROUTING - what "AMV Auto" was supposed to be.
   Auto is the DEFAULT model and its description promises it "automatically
   picks the right model for each task". It did not: 'auto' mapped to amv-core
   and every request, from "thanks" to a 400-line refactor, ran on the same
   engine. That is a feature the interface claimed and the code did not
   deliver, and it is also the largest cost lever in the product - Core input
   is 3x Pulse and Forge is 15x, so answering trivial turns on Core burns
   margin while hard turns get less engine than they need.

   Routing is done from signals already in the request. It deliberately does
   NOT ask a model which model to use: that would add a round-trip of latency
   and cost to every single turn, defeating the point.

   The rule is "cheapest engine that will not visibly do a worse job":
     - Pulse  short, self-contained, conversational or lookup-shaped turns.
     - Core   the default. Anything substantial, anything with a document,
              image or web search, anything with real conversation history.
     - Forge  work where reasoning depth shows: code, proofs, architecture,
              multi-part analysis. Only when the plan includes it.
   ===================================================================== */
const _RX_CODE      = /```|\bfunction\b|\bclass\b|=>|\bimport\s|\bdef\s|\bSELECT\b.*\bFROM\b|<\/[a-z]+>|\{[\s\S]*\}/i;
const _RX_HARD      = /\b(refactor|debug|architect|architecture|algorithm|optimi[sz]e|implement|migrat(e|ion)|prove|derive|theorem|integral|regression|complexity|concurrency|race condition|security review|threat model|trade-?offs?|design (a|the) system|step by step|write (me )?(a|an) (program|script|app|api))\b/i;
const _RX_ANALYSIS  = /\b(analy[sz]e|compare|evaluate|critique|summari[sz]e|explain why|strategy|forecast|plan for|pros and cons|research)\b/i;
const _RX_TRIVIAL   = /^(hi|hey|hello|yo|thanks|thank you|ta|ok|okay|cool|nice|got it|sure|yes|no|yep|nope|good morning|good night|bye)\b[\s!.?]*$/i;
const _RX_LOOKUP    = /^(what|who|when|where|which|how many|how much|define|translate|convert|spell)\b/i;

/* =====================================================================
   AMV-066: CACHE THE CONVERSATION, NOT JUST THE SYSTEM PROMPT.

   Caching is a PREFIX match, and the render order is tools -> system ->
   messages. The system prompt already carries a breakpoint, which means the
   tools in front of it are cached too. What was never cached is the part that
   grows: the conversation itself. By turn fifteen the history dwarfs the
   system prompt, and every one of those tokens was being re-charged at full
   price on every single turn - the largest avoidable cost in a chat product.

   Placing a breakpoint on the last block of the newest turn means the next
   turn reads the whole conversation from cache at a tenth of the price.

   Two constraints that make this correct rather than just present:
   - A cache write costs 1.25x, so a prefix that will not be read again is a
     loss. Below the model's minimum cacheable size nothing caches at all and
     the marker is silently wasted - the minimum differs per model, so it is
     read from the engine rather than assumed.
   - A breakpoint only looks back 20 content blocks for an earlier entry. A
     single turn with many tool calls can exceed that on its own, which
     silently breaks the chain, so a long turn gets a second breakpoint part
     way back.
   ===================================================================== */
const CACHE_LOOKBACK = 20;          // blocks a breakpoint will search backwards
function _withCacheBreakpoints(messages, eng) {
  if (!Array.isArray(messages) || !messages.length) return messages;
  const min = (eng && eng.cacheMin) || 1024;
  // Not worth a 1.25x write below the model's minimum - it would not cache.
  if (_estimateInputTokens(messages) < min) return messages;

  /* Strip any cache markers the CLIENT put there. A cache write costs 1.25x, so
     markers on content that will never be read back are a way to inflate
     somebody else's bill from the browser; and more than four in one request is
     a hard upstream error. Caching is a server decision, made below. */
  const out = messages.map(m => {
    const c = m && m.content;
    if (!Array.isArray(c)) return Object.assign({}, m);
    return Object.assign({}, m, { content: c.map(b => {
      if (b && typeof b === 'object' && 'cache_control' in b) { const { cache_control, ...rest } = b; return rest; }
      return b;
    }) });
  });
  const mark = i => {
    const m = out[i]; if (!m) return false;
    // cache_control lives on a content BLOCK, so a plain string has to become one.
    if (typeof m.content === 'string') {
      if (!m.content) return false;
      m.content = [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }];
      return true;
    }
    if (Array.isArray(m.content) && m.content.length) {
      const last = m.content.length - 1;
      m.content = m.content.map((b, j) =>
        j === last ? Object.assign({}, b, { cache_control: { type: 'ephemeral' } }) : b);
      return true;
    }
    return false;
  };

  let placed = 0;
  if (mark(out.length - 1)) placed++;
  /* The lookback guard. Walk back counting blocks; if the newest turn alone is
     wide enough to push the previous turn out of range, anchor an extra
     breakpoint inside the window so the chain still connects. */
  let blocks = 0;
  for (let i = out.length - 1; i >= 0 && placed < 3; i--) {
    const c = out[i].content;
    blocks += Array.isArray(c) ? c.length : 1;
    if (blocks > CACHE_LOOKBACK - 5 && i > 0) { if (mark(i - 1)) placed++; break; }
  }
  return out;
}

/* Returns { key, why }. `why` is shown to the user, so it has to be true. */
function _autoRoute(body, user, limits) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const last = msgs.length ? msgs[msgs.length - 1] : null;
  // A turn's content can be a string or a content-block array (text + images).
  let text = '', hasMedia = false;
  const c = last && last.content;
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) {
    c.forEach(b => {
      if (!b) return;
      if (b.type === 'text') text += (b.text || '') + '\n';
      if (b.type === 'image' || b.type === 'document') hasMedia = true;
    });
  }
  text = String(text).trim();
  const len = text.length;
  const turns = msgs.filter(m => m && m.role === 'user').length;
  const wantsSearch = !!(body.tools && body.tools.length);
  const bigSystem = String(body.system || '').length > 6000;   // a loaded project context

  const cap = k => {                       // never route above what they pay for
    if (limits && limits.allModels) return k;
    /* _planRankOf, not a raw PLAN_RANK lookup: `custom` and `team` have no entry
       in that table and would silently rank 0, capping a paying customer to the
       cheapest engine. Both are guarded by allModels above today - this makes
       the next plan that is not guarded safe by default rather than by luck. */
    const rank = _planRankOf(user.plan, user.customCfg);
    if (rank < PLAN_RANK[ENGINES[k].minPlan]) return 'amv-core';
    return k;
  };

  // Hardest first: depth is worth paying for, and getting this wrong is the
  // one failure a user actually notices.
  if (_RX_CODE.test(text) || _RX_HARD.test(text) || len > 6000 || bigSystem) {
    const k = cap('amv-forge');
    return { key: k, why: k === 'amv-forge'
      ? 'Deep reasoning engine - this needs care'
      : 'Balanced engine - the deep one is on Pro and above' };
  }
  // Cheapest: only for turns where a bigger engine would produce the same answer.
  if (!hasMedia && !wantsSearch && turns <= 3 && len <= 220 &&
      (_RX_TRIVIAL.test(text) || (_RX_LOOKUP.test(text) && !_RX_ANALYSIS.test(text)))) {
    return { key: 'amv-pulse', why: 'Fast engine - a short, direct question' };
  }
  if (hasMedia)     return { key: 'amv-core', why: 'Balanced engine - reading what you attached' };
  if (wantsSearch)  return { key: 'amv-core', why: 'Balanced engine - researching and pulling it together' };
  return { key: 'amv-core', why: 'Balanced engine' };
}

// In-isolate cache for the global kill switch (avoids a KV read per request).
const _KILL_TTL_MS = 5000;
let _killCache = { val: false, ts: 0 };

