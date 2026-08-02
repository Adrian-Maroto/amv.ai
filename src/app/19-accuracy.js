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

  /* Pull the checkable CONCLUSION out of an answer. Comparing every number in
     a reply is wrong: a worked answer ("a 15% tip on $84 is $12.60") contains
     working (15, 84) that a terse second opinion ("ANSWER: 12.60") never
     repeats, which would flag two agreeing solves as a conflict. So compare
     what each one actually CONCLUDED. */
  _conclusion(text){
    const t = String(text || '');
    const nums = (t.match(/-?\d+(?:[.,]\d+)?/g) || []).map(n => n.replace(/,/g, ''));
    // an explicit "ANSWER: x" wins; otherwise the last number stated is the result
    const tagged = t.match(/ANSWER\s*:\s*\$?\s*(-?\d+(?:[.,]\d+)?)/i);
    const final = tagged ? tagged[1].replace(/,/g, '') : (nums.length ? nums[nums.length - 1] : null);
    const uncertain = /ANSWER\s*:\s*uncertain/i.test(t);
    return { nums, final, uncertain, tail: t.trim().slice(-260) };
  },

  /* Close enough to be the same result (tolerates 12.6 vs 12.60, rounding). */
  _same(x, y){
    if(x == null || y == null) return false;
    if(String(x) === String(y)) return true;
    const a = parseFloat(x), b = parseFloat(y);
    if(!isFinite(a) || !isFinite(b)) return false;
    const scale = Math.max(Math.abs(a), Math.abs(b), 1);
    return Math.abs(a - b) / scale < 0.005;   // within 0.5%
  },

  /* Do two independent solves agree on the answer that matters? */
  agree(a, b){
    const A = this._conclusion(a), B = this._conclusion(b);
    // The verifier refusing to guess is NOT a disagreement - it is no signal.
    if(B.uncertain) return { agree:true, inconclusive:true, reason:'the second opinion declined to guess' };
    if(A.final == null && B.final == null) return { agree:true, reason:'no numeric claim to compare' };
    if(A.final == null || B.final == null) return { agree:true, inconclusive:true, reason:'only one solve stated a number' };
    if(this._same(A.final, B.final)) return { agree:true, ratio:1, reason:'independent solve reached the same result' };
    /* Conclusions differ. Before calling that a conflict, check BOTH ways.

       The primary answer has no "ANSWER:" line, so its conclusion is taken as
       the last number in the text - and a reply that ends "...let me know if
       you want the 20% figure too" concludes with 20. Comparing only A's guessed
       conclusion against B produced false conflicts on correct answers, and a
       warning that cries wolf is worse than no warning: it teaches people to
       ignore the one that matters. */
    if(B.nums.some(n => this._same(n, A.final)))
      return { agree:true, ratio:0.75, reason:'the second solve also arrived at this figure' };
    if(B.final != null && A.nums.some(n => this._same(n, B.final)))
      return { agree:true, ratio:0.75, reason:'the answer contains the figure the second solve reached' };
    return { agree:false, ratio:0, reason:'independent solve reached a different result' };
  },

  /* Re-solve the question from scratch. The verifier deliberately never sees
     the first answer, so it cannot be anchored into repeating a mistake. */
  /* A DIFFERENT engine, not just a fresh context.

     This used to call the model with no engine specified, which meant the
     "independent" check ran on the same one that produced the answer. Hiding
     the first answer prevents anchoring, but an identical model given an
     identical question reproduces its own systematic errors - so two agreeing
     draws from one distribution were being shown to the user as "double-
     checked". Agreement between two DIFFERENT engines is a real signal;
     agreement with itself is mostly a measure of its own consistency.

     This only ever runs on money, medical, legal, safety and numeric claims, so
     it is the one place where paying for the better engine is obviously right. */
  _verifierModel(){
    try{
      const primary = (MODELS[S.model] || {}).model || '';
      const best = (typeof qModel === 'function') ? qModel('review') : 'amv-core';
      if(best && best !== primary) return best;
      /* The answer already came from the best engine available, so a second
         opinion from it would not be a second opinion. Step sideways. */
      const alt = (MODELS.coding || {}).model;
      if(alt && alt !== primary) return alt;
      return (MODELS.core || {}).model || 'amv-core';
    }catch(e){ return 'amv-core'; }
  },

  async recheck(question){
    if(typeof _aiBackendReady !== 'function' || !_aiBackendReady()) return null;
    if(typeof aiComplete !== 'function') return null;
    const sys = 'Solve the problem independently and carefully. Show the key steps briefly, then state the '
      + 'final answer on the last line as "ANSWER: <value>". If the question cannot be answered factually '
      + 'with confidence, say "ANSWER: uncertain". Do not guess.';
    try{ return await aiComplete(String(question).slice(0, 4000), sys,
      { max_tokens: 700, noLang: true, model: this._verifierModel() }); }
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
      engine: cmp.agree ? undefined : this._verifierModel(),
      note: cmp.agree
        ? 'Checked ' + why + ' on a second, different engine - the results agree.'
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

/* ============================================================
   DEV <-> CHAT BRIDGE
   Registers the Dev workspace as a real connector so you can ask in
   chat (or Crew) "give me all my files for the X project" and get the
   actual files back - the same project the Dev tab is showing, not a
   regenerated guess. Read-only by design: chat can list and read, but
   writing code stays in Dev where you can see the diff and preview.
   ============================================================ */
try{
  if(typeof AMVConnectors !== 'undefined'){
    AMVConnectors.register({
      id:'dev', name:'Dev workspace', auth:'none', channel:'local',
      isLive(){ try{ return typeof _DEV !== 'undefined'; }catch(e){ return false; } },
      actions:{
        project_info:{
          desc:'Name of the current Dev project and how many files it has.',
          async run(){
            const name=(typeof _devProjectName==='function' && _devProjectName())||'';
            const files=(typeof _devProjectFiles==='function' && _devProjectFiles())||[];
            return { project:name||'(unnamed)', fileCount:files.length, files };
          }
        },
        list_files:{
          desc:'List every file path in the current Dev project. Args: {project?}',
          async run(args){
            const name=(typeof _devProjectName==='function' && _devProjectName())||'';
            if(args && args.project && name && String(args.project).toLowerCase().indexOf(name)<0
               && name.indexOf(String(args.project).toLowerCase())<0){
              const e=new Error('The open Dev project is "'+name+'", not "'+args.project+'". Open that project in Dev first.');
              e.code='needs_info'; throw e;
            }
            const files=(typeof _devProjectFiles==='function' && _devProjectFiles())||[];
            if(!files.length){ const e=new Error('There are no files in Dev yet - build something there first.'); e.code='needs_info'; throw e; }
            return { project:name||'(unnamed)', files };
          }
        },
        get_file:{
          desc:'Read one file from the Dev project. Args: {path}',
          async run(args){
            const p=String((args&&args.path)||'');
            const f=(typeof _DEV!=='undefined') && _DEV.project[p];
            if(!f){ const e=new Error('No file "'+p+'" in the Dev project.'); e.code='needs_info'; throw e; }
            return { path:p, content:f.content, lang:f.lang };
          }
        },
        get_all_files:{
          desc:'Return EVERY file in the Dev project with its full contents. Use for "give me all my files".',
          async run(){
            const name=(typeof _devProjectName==='function' && _devProjectName())||'';
            const paths=(typeof _devProjectFiles==='function' && _devProjectFiles())||[];
            if(!paths.length){ const e=new Error('There are no files in Dev yet - build something there first.'); e.code='needs_info'; throw e; }
            return { project:name||'(unnamed)', count:paths.length,
              files:paths.map(p=>({ path:p, lang:_DEV.project[p].lang, content:_DEV.project[p].content })) };
          }
        }
      }
    });
  }
}catch(e){}
