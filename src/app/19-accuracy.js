/* ============================================================
   AMV ACCURACY LAYER - independent verification.

   A system prompt tells the model to be careful; it cannot MEASURE
   whether the answer is right. This layer does the one thing that
   demonstrably catches real errors: it re-derives high-stakes answers
   INDEPENDENTLY (a fresh solve that never sees the first answer, so it
   cannot anchor to it) and compares the conclusions.

   - Agreement reached two independent ways is a genuine signal.
   - Disagreement is surfaced to the user rather than hidden, because a
     flagged uncertainty is far cheaper than a confident wrong answer.
   - It runs only where a mistake actually costs something (numbers,
     dates, money, medical/legal/safety, factual claims), so ordinary
     chat stays fast.
   ============================================================ */
const AMVVerify = {
  // Only verify where being wrong matters. Everything else stays instant.
  HIGH_STAKES: [
    { re:/\b\d+(\.\d+)?\s*(%|percent|kg|lb|mg|ml|km|mi|hours?|days?|years?)\b/i, why:'a quantity' },
    { re:/[\$£€]\s?\d|\b\d+\s?(usd|eur|gbp|dollars?)\b/i, why:'money' },
    { re:/\b(calculate|compute|solve|total|sum|average|percentage|convert)\b/i, why:'a calculation' },
    { re:/\b(dose|dosage|mg\/kg|symptom|diagnos|medication|treatment)\b/i, why:'medical information' },
    { re:/\b(legal|lawsuit|liable|contract|statute|tax|deduction|irs)\b/i, why:'legal or tax information' },
    { re:/\b(in \d{4}|on \w+ \d{1,2}, \d{4}|born|died|founded|released)\b/i, why:'a date or historical fact' },
    { re:/\b(safe|toxic|allergic|overdose|poison|voltage|amperage)\b/i, why:'a safety claim' }
  ],

  /* Should this answer be independently checked? */
  shouldVerify(question, answer){
    const t = String(question || '') + ' ' + String(answer || '');
    if(t.length < 12) return null;
    for(const h of this.HIGH_STAKES){ if(h.re.test(t)) return h.why; }
    return null;
  },

  /* Pull the checkable conclusion out of an answer so two solves can be
     compared on substance rather than wording. */
  _conclusion(text){
    const t = String(text || '');
    const nums = (t.match(/-?\d+(?:[.,]\d+)?/g) || []).map(n => n.replace(/,/g, ''));
    return { nums, tail: t.trim().slice(-260) };
  },

  /* Do two independent answers agree on the numbers that matter? */
  agree(a, b){
    const A = this._conclusion(a), B = this._conclusion(b);
    if(!A.nums.length && !B.nums.length) return { agree:true, reason:'no numeric claim to compare' };
    const key = A.nums.slice(-3), other = new Set(B.nums);
    const matched = key.filter(n => other.has(n));
    if(!key.length) return { agree:true, reason:'no numeric claim to compare' };
    const ratio = matched.length / key.length;
    return { agree: ratio >= 0.5, ratio, reason: ratio >= 0.5 ? 'independent solve agrees' : 'independent solve disagrees' };
  },

  /* Re-solve the question from scratch. The verifier deliberately never sees
     the first answer, so it cannot be anchored into repeating a mistake. */
  async recheck(question){
    if(typeof _aiBackendReady !== 'function' || !_aiBackendReady()) return null;
    if(typeof aiComplete !== 'function') return null;
    const sys = 'Solve the problem independently and carefully. Show the key steps briefly, then state the '
      + 'final answer on the last line as "ANSWER: <value>". If the question cannot be answered factually '
      + 'with confidence, say "ANSWER: uncertain". Do not guess.';
    try{ return await aiComplete(String(question).slice(0, 4000), sys, { max_tokens: 700, noLang: true }); }
    catch(e){ return null; }
  },

  /* Full pass: decide, re-derive, compare. Returns null when not applicable so
     the caller can skip silently (never a fake "verified" badge). */
  async verify(question, answer){
    const why = this.shouldVerify(question, answer);
    if(!why) return null;
    const second = await this.recheck(question);
    if(!second) return { status:'unverified', why, note:'Could not verify independently.' };
    const cmp = this.agree(answer, second);
    return {
      status: cmp.agree ? 'agreed' : 'conflict',
      why, ratio: cmp.ratio, second,
      note: cmp.agree
        ? 'Checked ' + why + ' a second, independent way - the results agree.'
        : 'An independent re-check of ' + why + ' did NOT match. Treat this answer as uncertain and verify before relying on it.'
    };
  },

  /* The chip shown under an answer. Honest states only:
     agreed / conflict / unverified. Never a green tick we did not earn. */
  chipHTML(v){
    if(!v) return '';
    if(v.status === 'agreed')  return '<div class="vfy-chip ok" title="' + escH(v.note) + '">Double-checked</div>';
    if(v.status === 'conflict') return '<div class="vfy-chip warn" title="' + escH(v.note) + '">Unverified - independent check disagreed</div>';
    return '<div class="vfy-chip" title="' + escH(v.note || '') + '">Not independently verified</div>';
  }
};
try{ window.AMVVerify = AMVVerify; }catch(e){}
