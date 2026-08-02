/* ============================================================
   TIERED WORK, AND MAKING THE CHEAP TIER NOT FEEL CHEAP.

   Two separate problems that are usually confused for one.

   COST. An agent run is not one call, it is a plan plus N steps plus a
   delivery. Running all of them on the engine the user picked in the model
   dropdown means routine work - "reformat this", "pull the three numbers out",
   "write the next paragraph" - is billed at the price of the hardest thing the
   product can do. Crew multiplies that by the number of steps. So work is
   routed by WHAT IT IS: classification, extraction, titles, summaries and
   routine steps go to the cheap engine; planning and the final review, where
   the whole run's quality is actually decided, get the best one available.

   QUALITY. A cheaper model is not worse at everything - it is worse at
   noticing its own mistakes. That is a fixable property, and fixing it is
   much cheaper than paying for a bigger model on every call:

     1. A cheap engine improves more from a specific instruction than an
        expensive one does. Vague prompts are where the gap shows.
     2. Most of the remaining gap is caught by one focused self-check pass on
        the SAME engine. Two cheap calls still cost a fraction of one premium
        call, and the second one is looking for concrete defects rather than
        being asked to be brilliant.
     3. What is left is structural: refusals, placeholders, truncation, output
        that was supposed to be JSON and is not. Those are detectable without a
        model at all - and when detected, THAT is the moment to spend real money
        by retrying one tier up.

   So the floor is set by validation and escalation rather than by the price of
   the engine, and the average cost stays near the cheap tier. The result is
   deliberately not branded as any vendor's model anywhere in the product: AMV
   names its own engines, which is what makes swapping what sits behind them an
   honest thing to do.
   ============================================================ */

/* What kind of work this is, not how clever we want to look doing it. */
const TASK_TIER = {
  /* Machinery. The user never reads this output as prose - it routes, labels or
     structures something, and a bigger engine returns the same answer. */
  route:'fast', classify:'fast', extract:'fast', title:'fast',
  translate:'fast', summarize:'fast', tag:'fast',
  /* Real work, read by a person, but one bounded piece of it. */
  step:'core', draft:'core', rewrite:'core', explain:'core',
  /* Where the quality of the whole run is decided. Worth the money. */
  plan:'best', review:'best', final:'best', debug:'best', architect:'best',
};

/* The best engine this account may actually use, so "best" never means an
   engine their plan cannot reach - which would fail the call rather than
   downgrade it. */
function _bestEngineKey(){
  try{
    const plan = loadStr('amv_plan') || 'free';
    const rank = (typeof PLAN_RANK !== 'undefined' && PLAN_RANK[plan]) || 0;
    if(rank >= ((typeof PLAN_RANK !== 'undefined' && PLAN_RANK.elite) || 2)) return 'smart';
    if(rank >= ((typeof PLAN_RANK !== 'undefined' && PLAN_RANK.pro) || 1)) return 'coding';
    return 'core';
  }catch(e){ return 'core'; }
}

/* The model string for a task. */
function qModel(task){
  try{
    const tier = TASK_TIER[task] || 'core';
    const key = tier === 'best' ? _bestEngineKey() : tier;
    return (MODELS[key] || MODELS.core).model;
  }catch(e){ return 'amv-core'; }
}
/* One tier up from whatever produced a bad answer, for escalation. */
function _nextTierModel(task){
  try{
    const tier = TASK_TIER[task] || 'core';
    if(tier === 'fast') return (MODELS.core || {}).model || 'amv-core';
    return (MODELS[_bestEngineKey()] || MODELS.core).model;
  }catch(e){ return 'amv-core'; }
}

/* ── IS THIS OUTPUT ACTUALLY USABLE ──────────────────────────────────────────
   Structural only. No model is asked whether the answer is good, because that
   costs as much as producing it again and is the thing cheap engines are worst
   at. These are the failures that make a product feel cheap, and every one of
   them is visible without understanding the content. */
/* Deliberately NOT wrapped in \b(...)\b: a word boundary before "[" or "<"
   can never match, which silently disabled every bracketed pattern here - the
   most common placeholder shape of all. And a bare run of x's is not a
   placeholder; it matched redactions, hashes and ordinary content. */
const _Q_PLACEHOLDER = /(lorem ipsum|\bTODO\b|\bFIXME\b|\[insert[^\]]*\]|\[your [^\]]*\]|\[[a-z ]{2,20}here\]|<placeholder>|\bTBD\b)/i;
const _Q_REFUSAL = /\b(I(?:'m| am) (?:sorry|unable|not able)|I cannot (?:help|assist|do that)|As an AI(?: language)? model)\b/i;
const _Q_HEDGE_ONLY = /^(?:\s*(?:it depends|there are many|that varies)[^.]*\.\s*)+$/i;

function qBad(text, opts){
  const o = opts || {};
  const t = String(text == null ? '' : text).trim();
  if(!t) return 'empty';
  /* A length floor is a prose test. Valid JSON can be genuinely tiny, and
     rejecting it for brevity would send a correct answer up a tier for nothing. */
  if(!o.json && t.length < (o.minLen || 24)) return 'too short to be the finished thing';
  if(_Q_REFUSAL.test(t)) return 'a refusal rather than an answer';
  if(_Q_PLACEHOLDER.test(t)) return 'placeholder text left in';
  if(_Q_HEDGE_ONLY.test(t)) return 'hedging with no actual answer';
  /* Cut off mid-sentence: the single most recognisable sign of a cheap model
     hitting a token ceiling, and trivially detectable. */
  if(o.prose && t.length > 200 && !/[.!?)"'`\]}…]\s*$/.test(t) && !/```\s*$/.test(t))
    return 'stops mid-sentence';
  if(o.json){
    try{ JSON.parse(t.replace(/^```(?:json)?|```$/g, '').trim()); }
    catch(e){ return 'not the JSON it was asked for'; }
  }
  if(o.mustInclude && !o.mustInclude.every(x => t.indexOf(x) >= 0)) return 'missing something it was told to include';
  return null;
}

/* ── THE CHEAP TIER, MADE TO HOLD UP ─────────────────────────────────────────

   Runs the task on the engine its KIND deserves, checks the result, and only
   spends more when the result does not stand up. `refine` adds one self-check
   pass on the same engine for output a person will actually read - the cheapest
   large improvement available. */
async function qRun(task, prompt, system, opts){
  const o = Object.assign({}, opts || {});
  const model = o.model || qModel(task);
  const guard = { json:o.json, prose:o.prose, minLen:o.minLen, mustInclude:o.mustInclude };

  /* A specific instruction is worth more to a small engine than a large one.
     This is appended rather than replacing the caller's system prompt, which
     carries the actual domain. */
  const rigor = ' Produce the finished thing, not a description of it. Be concrete and specific:'
    + ' real names, real numbers, real values - never a placeholder, never "[insert x]", never "TODO".'
    + ' Do not hedge, do not explain what you are about to do, and do not stop part way.'
    + ' Never use em or en dashes; use a plain hyphen (-) instead.';

  let out = '';
  try{
    out = await aiComplete(prompt, (system || '') + rigor, Object.assign({}, o, { model }));
  }catch(e){ out = ''; }

  let why = qBad(out, guard);

  /* One focused repair on the SAME engine. Asked to find specific defects
     rather than to "improve" - a small model told to improve something usually
     just makes it longer. */
  if(!why && o.refine){
    try{
      const better = await aiComplete(
        'Here is a draft. Fix anything wrong with it and return ONLY the corrected version, complete.\n\n'
        + 'Check, in order: is anything factually inconsistent with the request; is anything left vague'
        + ' or placeholder; is it actually finished; is any of it padding that could be cut.\n\n'
        + 'REQUEST:\n' + String(prompt).slice(0, 4000) + '\n\nDRAFT:\n' + out,
        (system || '') + ' Return only the corrected work itself, with no commentary about what you changed.'
          + ' Never use em or en dashes; use a plain hyphen (-) instead.',
        Object.assign({}, o, { model }));
      /* Kept only if it is still valid - a repair pass that breaks the output is
         worse than the draft it was given. */
      if(better && !qBad(better, guard)) out = better;
    }catch(e){}
  }

  /* Structural failure is the one thing worth real money. One retry, one tier
     up, and no further - a ladder with no top is how a cost control becomes a
     cost multiplier. */
  if(why){
    const up = _nextTierModel(task);
    if(up !== model){
      try{
        const retry = await aiComplete(prompt, (system || '') + rigor,
          Object.assign({}, o, { model: up }));
        if(retry && !qBad(retry, guard)){ return { text: retry, model: up, escalated: true, firstFault: why }; }
        if(retry) out = retry;
      }catch(e){}
    }
    why = qBad(out, guard);
  }

  return { text: out, model, escalated: false, fault: why || null };
}

try{
  window.TASK_TIER = TASK_TIER; window.qModel = qModel;
  window.qBad = qBad; window.qRun = qRun; window._bestEngineKey = _bestEngineKey;
}catch(e){}
