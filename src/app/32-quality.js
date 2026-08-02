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


/* ── CLOSING THE REST OF THE GAP ─────────────────────────────────────────────

   The tiering above routes work by kind and repairs sloppiness. This is the
   part that goes after ACCURACY, which is the other half of why an expensive
   model feels expensive.

   Three levers, in the order of how much they actually buy:

   1. COMPUTE INSTEAD OF RECALL. A small model doing arithmetic in its head is
      guessing at a calculation; the same model writing two lines of code and
      running them is exactly as correct as any model in the world, because the
      computer does the sum. Numbers are also where a wrong answer is most
      visible and least forgivable, so this is the single largest win available
      and it costs one cheap call plus local execution.

   2. ASK MORE THAN ONCE. Sampling the same question a few times and keeping
      the answer that recurs removes most one-off reasoning slips - a small
      model's errors are scattered, its correct answers cluster. Three cheap
      samples still cost a fraction of one top-tier call.

   3. DISAGREEMENT IS THE SIGNAL TO SPEND. When the samples do not converge,
      the question is genuinely beyond the cheap tier, and THAT is the moment
      to pay for the better engine - rather than paying on every call against
      the possibility.

   What this does not do, and no amount of scaffolding will: raise the ceiling
   on a problem the small model cannot represent at all. It makes the cheap tier
   reliable, not brilliant. Most of what reads as "cheap" is unreliability. */

/* Pull the conclusion out of an answer so two samples can be compared. Reuses
   the accuracy layer's parser, which already knows that a worked answer's
   WORKING is not its conclusion. */
function _qFinal(text){
  try{
    if(typeof AMVVerify !== 'undefined' && AMVVerify._conclusion)
      return AMVVerify._conclusion(text).final;
  }catch(e){}
  const m = String(text||'').match(/-?\d+(?:[.,]\d+)?/g);
  return m ? m[m.length-1].replace(/,/g,'') : null;
}
function _qAgree(a, b){
  try{
    if(typeof AMVVerify !== 'undefined' && AMVVerify._same) return AMVVerify._same(a, b);
  }catch(e){}
  return String(a) === String(b);
}

/* Ask the cheap engine for the CALCULATION rather than the answer, then run it.
   Returns null when the task is not actually computable, so the caller falls
   back rather than inventing a number - the one outcome that would be worse
   than not trying. */
async function qCompute(question, opts){
  const o = opts || {};
  if(typeof runCode !== 'function' || typeof aiComplete !== 'function') return null;
  let code = '';
  try{
    code = await aiComplete(
      'Write JavaScript that computes the answer to this and prints ONLY the final value with console.log. '
      + 'No explanation, no comments, no formatting - just the code. If it cannot be computed exactly, '
      + 'output exactly: NOT_COMPUTABLE\n\n' + String(question).slice(0, 2000),
      'You output only runnable JavaScript, or the single token NOT_COMPUTABLE.',
      Object.assign({}, o, { model: qModel('extract'), max_tokens: 500, noLang: true }));
  }catch(e){ return null; }
  const clean = String(code || '').replace(/^```(?:js|javascript)?|```$/gm, '').trim();
  if(!clean || /NOT_COMPUTABLE/.test(clean)) return null;
  try{
    const r = await runCode(clean, 'js');
    const out = String((r && (r.output || r.result || r.logs)) || '').trim();
    if(!out || /error/i.test((r && r.error) || '')) return null;
    const last = out.split('\n').filter(Boolean).pop();
    return (last && last.trim()) || null;
  }catch(e){ return null; }
}

/* Sample a few times and keep what recurs. */
async function qConsensus(task, prompt, system, opts){
  const o = opts || {};
  const n = Math.max(2, Math.min(5, o.samples || 3));
  const model = o.model || qModel(task);
  const runs = [];
  for(let i = 0; i < n; i++){
    try{ runs.push(await aiComplete(prompt, system, Object.assign({}, o, { model }))); }
    catch(e){ runs.push(''); }
  }
  const usable = runs.filter(t => !qBad(t, { prose:o.prose, json:o.json, minLen:o.minLen }));
  if(!usable.length) return { text:'', model, agreed:false, samples:n };

  /* Group by the conclusion each sample reached. */
  const groups = [];
  usable.forEach(t => {
    const f = _qFinal(t);
    const g = groups.find(x => _qAgree(x.final, f));
    if(g) g.items.push(t); else groups.push({ final:f, items:[t] });
  });
  groups.sort((a, b) => b.items.length - a.items.length);
  const top = groups[0];
  const agreed = top.items.length > 1 && top.items.length >= Math.ceil(usable.length / 2);
  return { text: top.items[0], model, agreed, samples:n,
           split: groups.length > 1 ? groups.map(g => g.final) : null };
}

/* The whole ladder, for work where being WRONG is the failure that matters:
   compute it if it can be computed, otherwise agree with itself, and escalate
   only when it cannot. */
async function qAccurate(task, prompt, system, opts){
  const o = opts || {};

  if(o.numeric !== false){
    const computed = await qCompute(prompt, o);
    if(computed != null){
      /* The number is now a fact rather than a recollection. The engine is only
         asked to put it into words, which is the part it is good at. */
      const said = await qRun(task, prompt + '\n\nThe correct computed answer is: ' + computed
        + '\nUse exactly this value. Explain it clearly.', system, Object.assign({}, o, { refine:false }));
      return { text: said.text, model: said.model, grounded:true, value: computed };
    }
  }

  const c = await qConsensus(task, prompt, system, o);
  if(c.agreed) return { text: c.text, model: c.model, grounded:false, agreed:true, samples:c.samples };

  /* They did not converge, so the question is beyond this tier. This is the
     moment the better engine is worth its price. */
  const up = _nextTierModel(task);
  if(up !== c.model){
    try{
      const better = await aiComplete(prompt, system, Object.assign({}, o, { model: up }));
      if(better && !qBad(better, { prose:o.prose, json:o.json, minLen:o.minLen }))
        return { text: better, model: up, grounded:false, agreed:false, escalated:true, split:c.split };
    }catch(e){}
  }
  return { text: c.text || '', model: c.model, grounded:false, agreed:false, split:c.split };
}

try{
  window.qCompute = qCompute; window.qConsensus = qConsensus; window.qAccurate = qAccurate;
}catch(e){}


/* ── THE TWO THAT RAISE THE CEILING RATHER THAN THE FLOOR ────────────────────

   Everything above makes the cheap tier reliable. These two make it capable of
   things it cannot do in one pass, which is a different claim and a stronger
   one.

   DECOMPOSITION. A model that cannot hold a five-part problem can usually hold
   each part. Splitting the problem, solving the parts separately - each with
   computation and consensus behind it - and composing the results produces
   answers a single pass on the same engine could not reach. This is the one
   technique that genuinely extends reasoning depth rather than tidying output.

   EXECUTION. For code, correctness is not a matter of opinion. Generate, RUN,
   feed the real error back, run again. A cheap engine inside a working loop
   produces code far above its one-shot ability, because the compiler is doing
   the judging and the compiler is never wrong about whether something runs. */

/* Split, solve, compose. Falls back to a single accurate pass when the problem
   does not decompose - forcing a split on something atomic makes it worse. */
async function qDecompose(task, prompt, system, opts){
  const o = opts || {};
  let parts = [];
  try{
    const raw = await aiComplete(
      'Break this into the smallest set of INDEPENDENT sub-questions that must each be answered '
      + 'to answer it fully. Two to five. Each must stand alone - no sub-question may depend on '
      + 'another\'s answer. If it does not split that way, return exactly: ATOMIC\n\n'
      + String(prompt).slice(0, 3000),
      'Return only a JSON array of strings, or the single token ATOMIC.',
      Object.assign({}, o, { model: qModel('plan'), max_tokens: 700, noLang: true }));
    const clean = String(raw || '').replace(/^```(?:json)?|```$/gm, '').trim();
    if(!/ATOMIC/.test(clean)) parts = JSON.parse(clean);
  }catch(e){ parts = []; }

  if(!Array.isArray(parts) || parts.length < 2 || parts.length > 5)
    return await qAccurate(task, prompt, system, o);

  /* Each part gets the full accuracy ladder - computed where it can be
     computed, agreed with itself where it cannot. */
  const solved = [];
  for(const part of parts.slice(0, 5)){
    const r = await qAccurate('step', String(part), system, Object.assign({}, o, { samples: o.samples || 2 }));
    solved.push({ q: String(part), a: (r && r.text) || '', grounded: !!(r && r.grounded) });
  }

  /* Composition is the one step that sees the whole thing, so it gets the good
     engine - and it is told to use the answers rather than re-derive them. */
  const composed = await qRun('final',
    'Question:\n' + prompt + '\n\nEach part has already been worked out:\n\n'
    + solved.map((s, i) => (i+1) + '. ' + s.q + '\n   -> ' + s.a).join('\n\n')
    + '\n\nWrite the complete answer using these results. Do not re-derive them and do not contradict them.',
    system, Object.assign({}, o, { refine: false, prose: true }));

  return { text: composed.text, model: composed.model, decomposed: true,
           parts: solved.length, grounded: solved.some(s => s.grounded) };
}

/* Generate code, run it, and keep fixing it with the REAL error until it works.
   Correctness here is decided by execution rather than by the engine's
   confidence, which is why a cheap engine does well at it. */
async function qCode(request, lang, opts){
  const o = opts || {};
  const language = (lang || 'js').toLowerCase();
  const maxTries = Math.max(1, Math.min(5, o.tries || 3));
  if(typeof runCode !== 'function' || typeof aiComplete !== 'function')
    return { ok:false, reason:'Code execution is not available here.' };

  let code = '', lastErr = '', attempts = 0;
  for(let i = 0; i < maxTries; i++){
    attempts++;
    const ask = i === 0
      ? 'Write ' + language + ' that does this. Output ONLY the code.\n\n' + String(request).slice(0, 4000)
      : 'This ' + language + ' failed. Fix it and output ONLY the corrected code.\n\nCODE:\n' + code
        + '\n\nTHE ACTUAL ERROR:\n' + lastErr;
    let out = '';
    try{
      out = await aiComplete(ask, 'You output only runnable ' + language + ', with no commentary.',
        Object.assign({}, o, { model: i === 0 ? qModel('step') : _nextTierModel('step'), max_tokens: 1800 }));
    }catch(e){ lastErr = String(e && e.message || e); continue; }

    code = String(out || '').replace(/^```(?:[a-z]+)?|```$/gm, '').trim();
    if(!code){ lastErr = 'no code was produced'; continue; }

    try{
      const r = await runCode(code, language);
      const err = (r && r.error) || '';
      if(!err) return { ok:true, code, output:String((r && (r.output || r.result)) || '').trim(), attempts };
      lastErr = String(err).slice(0, 600);
    }catch(e){ lastErr = String(e && e.message || e).slice(0, 600); }
  }
  /* Honest failure: the code is returned so the work is not lost, but it is NOT
     called working. */
  return { ok:false, code, error:lastErr, attempts,
           reason:'This did not run cleanly after ' + attempts + ' attempts. The last error is included.' };
}

try{ window.qDecompose = qDecompose; window.qCode = qCode; }catch(e){}
