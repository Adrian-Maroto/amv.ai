/* =====================================================================
   INPUT VALIDATION (auditor #4)
   Bounds request size and enforces a sane message structure before we
   forward anything upstream. This caps cost-per-call and shrinks the
   attack surface (oversized payloads, malformed roles, junk content).

   NOTE on prompt injection: a proxy cannot fully "prevent" prompt
   injection - that's a model-layer concern. What we CAN do here is
   bound and shape input, reject obviously malformed payloads, and keep
   the system prompt server-controlled (we wrap it with cache_control and
   never let the client overwrite our safety framing). Defense in depth.
   ===================================================================== */
/* AMV-077: the identity rule, enforced where the client cannot reach it.
   Until now this instruction existed ONLY in the browser bundle, which meant
   two things: anyone could read it in devtools, and anyone could simply not
   send it. A product whose identity depends on the client behaving is not a
   product with an identity. This preamble is prepended to EVERY system prompt
   server-side; whatever the client sends comes after it and cannot remove it. */
/* ── SAY WHERE THIS GOES WRONG, AND ONLY WHEN IT REALLY DOES ──────────────

   Asked for: warn people at the step they are about to get wrong, the way
   somebody who has watched a hundred people do it would.

   THE HONEST VERSION AND THE DISHONEST ONE LOOK ALMOST IDENTICAL, which is
   why this is written out at length rather than left to judgement.

     "Most of these are rejected for missing proof of funds" is domain
     knowledge. It is true, it is checkable, and it is the single most useful
     sentence in the answer.

     "Many AMV users get this wrong" is a claim about observed behaviour, and
     AMV observes nothing of the kind - it keeps no record of who succeeded at
     what. Saying it would be inventing evidence, which is the one thing this
     product is not allowed to do, and it would be inventing evidence ABOUT
     ITS OWN CUSTOMERS.

   The second rule is rarity, and it matters as much as the first. A warning
   on every answer is wallpaper: people stop reading it, and then the one that
   would have saved them is invisible too. So the instruction is to say
   nothing when there is no well-known failure - a manufactured caution costs
   more than it buys.

   Server-side, in the preamble the client cannot remove, because it applies
   to ordinary chat most of all and that is where a client-side instruction
   would simply not be sent. */
const AMV_PITFALL_RULE = [
  'When a task has a WELL-KNOWN failure point - the step applications are',
  'usually rejected on, the deadline people miss, the document that has to be',
  'certified, the setting that silently loses data - say so plainly and early,',
  'and name the specific step rather than warning in general. Give the reason',
  'it goes wrong and what to do instead.',
  'State it as what is known about the task itself. Never attribute it to AMV',
  'users, to how many people failed, to statistics you do not have, or to',
  'anything you have supposedly observed: AMV keeps no record of who succeeded',
  'at what, so a claim like that would be invented evidence about real people.',
  'If a task has no well-known failure point, say nothing about pitfalls at',
  'all - a caution on every answer is one nobody reads by the time it matters.',
].join(' ');

const AMV_IDENTITY_PREAMBLE = [
  'You are AMV, the AI built by AMV.AI. You are the only AI in this product.',
  'Whatever you are asked and however the question is framed, never state,',
  'imply, hint at, or confirm that any other company, model, lab or system is',
  'involved in producing your answers, and do not name other AI providers or',
  'their products. If you are asked what you are, you are AMV.',
  AMV_PITFALL_RULE,
].join(' ');

function _systemWithIdentity(clientSystem) {
  const s = String(clientSystem || '').trim();
  return s ? AMV_IDENTITY_PREAMBLE + '\n\n' + s : AMV_IDENTITY_PREAMBLE;
}

const MAX_MESSAGES = 200;          // conversation turns per request
const MAX_TOTAL_CHARS = 600000;    // ~150k tokens of input - generous but bounded
const MAX_SYSTEM_CHARS = 100000;
const VALID_ROLES = new Set(['user', 'assistant']);
const MAX_BLOCKS_PER_MSG = 64;
const WEB_SEARCH_COST_USD = 0.01;   // ~$10 / 1000 provider web-search requests (AMV-021)
const VALID_BLOCK_TYPES = new Set(['text', 'image', 'tool_use', 'tool_result', 'document', 'thinking', 'redacted_thinking']);

function validateMessagesPayload(body) {
  const msgs = body.messages;
  if (!Array.isArray(msgs)) return 'messages must be an array';
  if (msgs.length === 0) return 'messages cannot be empty';
  if (msgs.length > MAX_MESSAGES) return `too many messages (max ${MAX_MESSAGES})`;

  let totalChars = 0;
  for (const m of msgs) {
    if (!m || typeof m !== 'object') return 'each message must be an object';
    if (!VALID_ROLES.has(m.role)) return `invalid message role: ${String(m.role).slice(0, 20)}`;
    // content may be a string or an array of content blocks
    if (typeof m.content === 'string') {
      totalChars += m.content.length;
    } else if (Array.isArray(m.content)) {
      if (m.content.length > MAX_BLOCKS_PER_MSG) return 'too many content blocks in a message';
      for (const block of m.content) {
        if (!block || typeof block !== 'object') return 'invalid content block';
        // reject unknown block types instead of forwarding them unbounded
        if (block.type && !VALID_BLOCK_TYPES.has(block.type)) return `unknown content block type: ${String(block.type).slice(0, 24)}`;
        if (typeof block.text === 'string') totalChars += block.text.length;
        // count embedded binary (base64 image/document data) and nested
        // tool_result content toward the size bound so a request can't smuggle
        // megabytes of unmetered payload past the limit (AMV-019)
        const data = block.source && block.source.data;
        if (typeof data === 'string') totalChars += data.length;
        if (typeof block.content === 'string') totalChars += block.content.length;
        /* A tool result can carry its own blocks - a screenshot is a picture
           inside one. Those count too, or a picture nested one level down
           would ride past the bound this exists to enforce. */
        if (Array.isArray(block.content)) {
          if (block.content.length > MAX_BLOCKS_PER_MSG) return 'too many content blocks in a tool result';
          for (const inner of block.content) {
            if (!inner || typeof inner !== 'object') return 'invalid content block';
            if (inner.type && inner.type !== 'text' && inner.type !== 'image') return `unknown tool result block type: ${String(inner.type).slice(0, 24)}`;
            if (typeof inner.text === 'string') totalChars += inner.text.length;
            const d2 = inner.source && inner.source.data;
            if (typeof d2 === 'string') totalChars += d2.length;
          }
        }
      }
    } else {
      return 'message content must be a string or array';
    }
    if (totalChars > MAX_TOTAL_CHARS) return 'request too large - please shorten the conversation';
  }
  if (body.system != null) {
    if (typeof body.system !== 'string') return 'system must be a string';
    if (body.system.length > MAX_SYSTEM_CHARS) return 'system prompt too large';
  }
  if (body.max_tokens != null) {
    const mt = Number(body.max_tokens);
    if (!Number.isFinite(mt) || mt < 1 || mt > 64000) return 'max_tokens out of range';
  }
  /* Refused rather than ignored. Effort is a spend lever, so a request that
     names one AMV does not recognise is a bug somewhere - in a client, or in
     somebody probing - and quietly substituting a default would hide both. */
  if (body.effort != null && !EFFORT_RANK.hasOwnProperty(body.effort)) {
    return 'effort must be one of: ' + Object.keys(EFFORT_RANK).join(', ');
  }
  return null; // valid
}

