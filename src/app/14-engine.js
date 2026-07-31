/* ============================================================
   AMV ENGINE - real working backbone for the dev/agent tools
   aiComplete(): single-shot AI text. runCode(): real execution.
   ============================================================ */
window.AMV_ENGINE = true;

// --- Reusable single-shot AI completion (returns a string) ---
/* SECURITY ARCHITECTURE: every AI call in AMV goes through the backend proxy.
   The upstream API key lives ONLY on the server (Cloudflare Worker secret). The
   browser never holds it, so JWT auth, rate limiting, metering, and the spend
   cap can never be bypassed. _aiBase()/_aiHeaders() are the single choke-point;
   if the backend isn't configured, AI calls fail loudly instead of silently
   leaking a key into the browser. */
function _aiBackendReady(){ return !!(window.AMV_API && AMV_API.live && AMV_API.token); }
function _aiBase(){
  if(!_aiBackendReady()) throw new Error('AMV isn’t connected yet. The workspace owner needs to switch on the AMV engine in Settings.');
  return AMV_API.base.replace(/\/$/,'')+'/v1/messages';
}
function _aiHeaders(){
  return {'Content-Type':'application/json','Authorization':'Bearer '+AMV_API.token};
}
window._aiBackendReady=_aiBackendReady;

/* Generate output of ANY length. The API caps a single response at max_tokens
   (~1-2k lines of code). This keeps the conversation going - feeding the model
   its own partial output and asking it to continue - until it finishes naturally.
   That's how Dev can emit 10,000+ lines in one build. */
async function aiCompleteLong(prompt, system, opts){
  opts = opts || {};
  const mdl = (typeof MODELS!=='undefined' && MODELS[S.model]) ? MODELS[S.model] : {model:'amv-apex', tokens:4096};
  const modelStr = opts.model || mdl.model;
  const url = _aiBase();
  const headers = _aiHeaders();
  const maxTok = opts.max_tokens || 16000;
  const maxRounds = opts.maxRounds || 14;          // hard ceiling so we can't loop forever
  const onProgress = opts.onProgress;

  const messages = [{ role:'user', content: prompt }];
  let full = '';
  let round = 0;

  while(round < maxRounds){
    round++;
    const body = { model: modelStr, max_tokens: maxTok, messages: messages.slice() };
    if(system) body.system = system + (opts.noLang?'':_langInstruction());
    else if(!opts.noLang) body.system = _langInstruction();

    const res = await fetchDeadline(url, {method:'POST', headers, body: JSON.stringify(body)}, 180000);
    if(!res.ok){ const t=await res.text().catch(()=>''); throw new Error('AI error '+res.status+': '+t.slice(0,200)); }
    const data = await res.json();
    const chunk = (data.content||[]).map(b=>b.text||'').join('');
    full += chunk;

    // usage accounting, same as aiComplete
    try{
      const u=data.usage||{};
      const inTok=u.input_tokens||Math.ceil(JSON.stringify(messages).length/4);
      const outTok=u.output_tokens||Math.ceil(chunk.length/4);
      if(typeof AEGIS!=='undefined') AEGIS.recordUsage(modelStr, inTok, outTok);
      if(typeof AMVUsage!=='undefined') AMVUsage.record((inTok||0)+(outTok||0));
    }catch(e){}

    onProgress && onProgress({ round, lines: full.split('\n').length, chars: full.length,
                               truncated: data.stop_reason === 'max_tokens' });

    // Finished naturally? done.
    if(data.stop_reason !== 'max_tokens') break;

    // Truncated - hand the model its own output back and tell it to keep going.
    messages.push({ role:'assistant', content: chunk });
    messages.push({ role:'user', content:
      'Continue exactly where you left off. Do not repeat any code you already wrote, do not re-open a fenced block you already opened, and do not add commentary - just continue the output from the exact character you stopped at.' });
  }
  return full.trim();
}
try{ window.aiCompleteLong=aiCompleteLong; }catch(e){}

async function aiComplete(prompt, system, opts){
  opts=opts||{};
  const mdl = (typeof MODELS!=='undefined' && MODELS[S.model]) ? MODELS[S.model] : {model:'amv-apex',tokens:4096};
  const modelStr = opts.model || mdl.model;
  const url = _aiBase();              // throws if backend not ready - never falls back to browser key
  const headers = _aiHeaders();
  const maxTok = opts.max_tokens || 4096;
  const body = { model: modelStr, max_tokens: maxTok, messages: [{role:'user', content: prompt}] };
  if(system) body.system = system + (opts.noLang?'':_langInstruction());
  else if(!opts.noLang) body.system = _langInstruction();
  const res = await fetchDeadline(url,{method:'POST',headers,body:JSON.stringify(body)}, 120000);
  if(!res.ok){ const t=await res.text().catch(()=>''); throw new Error('AI error '+res.status+': '+t.slice(0,200)); }
  const data = await res.json();
  const text=_noDash((data.content||[]).map(b=>b.text||'').join('').trim());
  // record usage for EVERY call (Lab, Dev, Studio, Cowork, agents) - not just chat
  try{
    const u=data.usage||{}; const inTok=u.input_tokens||Math.ceil(prompt.length/4); const outTok=u.output_tokens||Math.ceil(text.length/4);
    if(typeof AEGIS!=='undefined') AEGIS.recordUsage(modelStr, inTok, outTok);
    if(typeof AMVUsage!=='undefined') AMVUsage.record((inTok||0)+(outTok||0));
  }catch(e){}
  return text;
}

// --- Extract first fenced code block of a given lang (or any) ---
function extractCode(text, lang){
  if(!text) return '';
  const re = lang ? new RegExp('```'+lang+'\\s*([\\s\\S]*?)```','i') : /```[a-z]*\s*([\s\S]*?)```/i;
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

// --- REAL multi-language code execution sandbox ---
/* AMV-006: run untrusted Python inside a Web Worker sandbox. A Worker has NO
   document and NO localStorage, so Pyodide's `js` bridge there cannot read page
   tokens or touch the DOM - closing the same-origin code-execution hole. The
   worker is TERMINATED on timeout so malicious/synchronous code can't hang the
   tab. If the sandbox can't start, Python degrades to an honest error; it NEVER
   falls back to executing on the main thread. */
const _PY_CDN='https://cdn.jsdelivr.net/pyodide/v0.26.2/full/';
let _pyWorker=null;
function _pyWorkerSource(){
  return "let py=null,loading=null;"+
    "async function ensure(){ if(py) return py; if(!loading) loading=(async()=>{"+
      "importScripts('"+_PY_CDN+"pyodide.js');"+
      "py=await loadPyodide({indexURL:'"+_PY_CDN+"'}); return py; })(); return loading; }"+
    "self.onmessage=async(e)=>{ const d=e.data||{}; let out='';"+
      "try{ const p=await ensure();"+
        "p.setStdout({batched:s=>{out+=s+'\\n';}});"+
        "p.setStderr({batched:s=>{out+=s+'\\n';}});"+
        "let result,err=null;"+
        "try{ result=await p.runPythonAsync(d.code); }catch(x){ err=(x&&x.message)?x.message:String(x); }"+
        "self.postMessage({id:d.id, ok:!err, stdout:out.trim(), stderr:err||'', result:(result!==undefined&&result!==null)?String(result):''});"+
      "}catch(x){ self.postMessage({id:d.id, ok:false, stdout:'', stderr:'Runtime load error: '+((x&&x.message)||x), result:''}); } };";
}
function _ensurePyWorker(){
  if(_pyWorker) return _pyWorker;
  const blob=new Blob([_pyWorkerSource()],{type:'application/javascript'});
  _pyWorker=new Worker(URL.createObjectURL(blob));
  return _pyWorker;
}
function _runPythonInWorker(code, onStatus){
  return new Promise((resolve)=>{
    let w;
    try{ w=_ensurePyWorker(); }
    catch(e){ resolve({ok:false,stdout:'',stderr:'Python sandbox unavailable: '+((e&&e.message)||e),result:'',ms:0}); return; }
    const id='py_'+Math.random().toString(36).slice(2);
    const t0=performance.now();
    let done=false;
    const onMsg=(ev)=>{ if(!ev.data||ev.data.id!==id) return; const d=ev.data; finish({ok:d.ok,stdout:d.stdout,stderr:d.stderr,result:d.result,ms:Math.round(performance.now()-t0)}); };
    const finish=(r)=>{ if(done) return; done=true; try{w.removeEventListener('message',onMsg);}catch(e){} resolve(r); };
    w.addEventListener('message',onMsg);
    onStatus&&onStatus('Running Python in a sandbox (first run loads the runtime)…');
    w.postMessage({id, code});
    setTimeout(()=>{
      if(done) return;
      try{ w.terminate(); }catch(e){}
      _pyWorker=null; // dead worker - rebuild next time
      finish({ok:false,stdout:'',stderr:'Execution timed out (30s) - the sandbox was terminated.',result:'',ms:Math.round(performance.now()-t0)});
    },30000);
  });
}

// runCode(code, lang) -> {ok, stdout, stderr, result, ms}
async function runCode(code, lang, onStatus){
  lang=(lang||'js').toLowerCase();
  const t0=performance.now();
  if(lang==='js'||lang==='javascript'){
    return await _runJS(code, t0);
  } else if(lang==='py'||lang==='python'){
    return await _runPythonInWorker(code, onStatus);
  } else if(lang==='html'){
    return {ok:true, stdout:'(HTML rendered in preview)', stderr:'', result:'', ms:0, html:code};
  }
  return {ok:false, stdout:'', stderr:'Unsupported language: '+lang, result:'', ms:0};
}

// JS runs in a sandboxed iframe. The user's code is injected as a REAL <script>
// (never eval) so it runs even under the app's strict CSP, and the iframe gets
// its own permissive CSP via a <meta> tag. stdout is captured via a console proxy.
function _runJS(code, t0){
  return new Promise(resolve=>{
    const iframe=document.createElement('iframe');
    iframe.sandbox='allow-scripts';
    iframe.style.display='none';
    const id='sbx_'+Math.random().toString(36).slice(2);
    let done=false;
    const finish=(res)=>{ if(done) return; done=true; try{document.body.removeChild(iframe);}catch(e){} window.removeEventListener('message',onMsg); resolve(res); };
    const onMsg=(ev)=>{ if(!ev.data||ev.data.__sbx!==id) return; finish({ok:ev.data.ok, stdout:(ev.data.logs||[]).join('\n'), stderr:ev.data.error||'', result:ev.data.result||'', ms:Math.round(performance.now()-t0)}); };
    window.addEventListener('message',onMsg);
    const harness='(function(){var logs=[];'+
      'function fmt(a){try{return typeof a==="object"?JSON.stringify(a):String(a)}catch(e){return String(a)}}'+
      'var p=function(){logs.push(Array.prototype.slice.call(arguments).map(fmt).join(" "))};'+
      'console.log=p;console.error=p;console.warn=p;console.info=p;'+
      'window.__L=logs;'+
      'window.__D=function(ok,err,result){parent.postMessage({__sbx:'+JSON.stringify(id)+',ok:ok,logs:logs,error:err||"",result:(result===undefined||result===null)?"":String(result)},"*")};'+
      'window.onerror=function(m,s,l,c,e){window.__D(false,(e&&e.stack)?e.stack:String(m));return true};'+
    '})();';
    const runner='(async function(){try{var __r=await (async function(){\n'+code+'\n})();window.__D(true,"",__r);}catch(e){window.__D(false,(e&&e.stack)?e.stack:String(e))}})();';
    const meta='<meta http-equiv="Content-Security-Policy" content="script-src \'unsafe-inline\'; default-src \'none\'">';
    const html='<!doctype html><html><head>'+meta+'</head><body>'+
      '<script>'+harness+'<\/script>'+
      '<script>'+runner+'<\/script>'+
    '</body></html>';
    iframe.srcdoc=html;
    document.body.appendChild(iframe);
    setTimeout(()=>finish({ok:false,stdout:'',stderr:'Execution timed out (15s) - the program ran too long. Check for infinite loops or heavy computation.',result:'',ms:15000}),15000);
  });
}


/* ===== AUTONOMOUS DEBUG LOOP (analyze -> fix -> re-run -> repeat), REAL =====
   Fable-5 quality: each iteration first does a root-cause analysis, then a
   surgical fix. Handles large/advanced programs. Never loops on the same fix. */
async function autoDebug(code, lang, maxIters, onStep, modelStr){
  maxIters = maxIters||8; lang=lang||'js';
  const dbgModel = modelStr||'amv-apex';
  let cur=code, history=[];
  const isLarge = code.length>4000;
  for(let i=0;i<maxIters;i++){
    const _bg=(typeof _budgetGuard==='function')?_budgetGuard(6000):{ok:true};
    if(!_bg.ok){ onStep&&onStep({phase:'error', msg:_bg.reason}); return {success:false, code:cur, iters:i, history, error:_bg.reason, budget:true}; }
    const run = await runCode(cur, lang, s=>onStep&&onStep({phase:'status',msg:s}));
    history.push({iter:i+1, code:cur, run});
    onStep&&onStep({phase:'run', iter:i+1, run, code:cur});
    if(run.ok){ onStep&&onStep({phase:'done', iter:i+1, success:true, code:cur}); return {success:true, code:cur, iters:i+1, history}; }
    onStep&&onStep({phase:'status', msg:'Analyzing the root cause (iteration '+(i+1)+' of '+maxIters+')…'});

    const err=run.stderr||'';
    const firstLine=err.split('\n')[0]||'';
    // pull the referenced line number from the error, if any, and show that region
    let region='';
    const lm=err.match(/:(\d+):(\d+)|line (\d+)/);
    if(lm){ const ln=parseInt(lm[1]||lm[3],10); if(ln){ const lines=cur.split('\n'); const a=Math.max(0,ln-4), b=Math.min(lines.length,ln+3); region=lines.slice(a,b).map((L,k)=>(a+k+1)+': '+L).join('\n'); } }
    const prevErrs=history.slice(-3).map(h=>h.run&&h.run.stderr?('• '+(h.run.stderr.split("\n")[0])):'').filter(Boolean).join('\n');

    const sys='You are AMV Apex - the most capable debugging intelligence ever built. Given a program and the EXACT runtime error it produced, you find and fix the TRUE root cause with zero collateral damage. '+
      'You reason about: duplicate/shadowed declarations, scope and hoisting, async/await and promise handling, off-by-one and boundary conditions, type coercion, null/undefined access, closure capture, recursion limits, and library misuse. '+
      'You NEVER paper over a symptom, never delete features to make an error disappear, and never introduce a regression. Preserve every bit of working logic and the program\u2019s intent. '+
      'Respond in TWO parts: first a line "ROOT CAUSE: <one sentence>", then the COMPLETE corrected program in a single fenced '+lang+' code block'+(isLarge?' (return the ENTIRE file, every line - this is a large program)':'')+'.';
    const prompt='Fix this '+lang+' program so it runs cleanly.\n\nCODE:\n```'+lang+'\n'+cur+'\n```\n\nEXACT RUNTIME ERROR:\n'+err+
      (region?('\n\nCODE AROUND THE FAILING LINE:\n'+region):'')+
      '\n\nSTDOUT BEFORE THE ERROR:\n'+(run.stdout||'(none)')+
      (prevErrs?('\n\nERRORS ALREADY TRIED (do NOT reintroduce these):\n'+prevErrs):'')+
      '\n\nGive the ROOT CAUSE line, then the complete corrected program.';
    let fixed, rootCause='';
    try{
      const resp=await aiComplete(prompt, sys, {max_tokens: isLarge?16000:10000, model:_sectionModel('debug')});
      const rc=resp.match(/ROOT CAUSE:\s*(.+)/i); rootCause=rc?rc[1].trim():'';
      fixed=extractCode(resp, lang)||extractCode(resp);
    }
    catch(e){ onStep&&onStep({phase:'error', msg:e.message}); return {success:false, code:cur, iters:i+1, history, error:e.message}; }
    if(!fixed){ onStep&&onStep({phase:'stuck', iter:i+1}); return {success:false, code:cur, iters:i+1, history}; }
    if(fixed.trim()===cur.trim()){ onStep&&onStep({phase:'stuck', iter:i+1, note:'identical'}); return {success:false, code:cur, iters:i+1, history, note:'identical'}; }
    onStep&&onStep({phase:'patch', iter:i+1, code:fixed, rootCause});
    cur=fixed;
  }
  return {success:false, code:cur, iters:maxIters, history};
}

/* ===== MULTI-AGENT PIPELINE (Planner -> Coder -> Critic -> Tester) REAL ===== */
async function runAgents(task, lang, onStep){
  lang=lang||'js';
  const agents={};
  // 1. Planner
  onStep&&onStep({agent:'Planner', status:'thinking'});
  agents.plan = await aiComplete(
    'Break this task into a concise numbered implementation plan (max 6 steps). Task: '+task,
    'You are a senior software architect. Output only the plan.');
  onStep&&onStep({agent:'Planner', status:'done', output:agents.plan});
  // 2. Coder
  onStep&&onStep({agent:'Coder', status:'thinking'});
  const coderResp = await aiComplete(
    'Task: '+task+'\n\nPlan:\n'+agents.plan+'\n\nWrite complete, runnable '+lang+' code that accomplishes this. Return ONLY one fenced '+lang+' code block.',
    'You are an expert '+lang+' engineer. Output only code in a fenced block.');
  agents.code = extractCode(coderResp, lang)||extractCode(coderResp)||coderResp;
  onStep&&onStep({agent:'Coder', status:'done', output:agents.code, isCode:true});
  // 3. Tester (REAL execution)
  onStep&&onStep({agent:'Tester', status:'thinking'});
  const testRun = await runCode(agents.code, lang, s=>onStep&&onStep({agent:'Tester',status:'thinking',note:s}));
  agents.test = testRun;
  onStep&&onStep({agent:'Tester', status:'done', output:(testRun.ok?'PASSED - ran clean.\n\nOutput:\n':'FAILED - runtime error:\n')+(testRun.ok?(testRun.stdout||testRun.result||'(no output)'):testRun.stderr), run:testRun});
  // 3b. If failed, Coder auto-fixes once via debug loop
  if(!testRun.ok){
    onStep&&onStep({agent:'Coder', status:'thinking', note:'Test failed - patching…'});
    const dbg = await autoDebug(agents.code, lang, 3, null);
    agents.code = dbg.code; agents.test = dbg.history[dbg.history.length-1].run;
    onStep&&onStep({agent:'Tester', status:'done', output:(agents.test.ok?'PASSED after auto-fix.\n\n':'Still failing after fixes.\n\n')+(agents.test.ok?(agents.test.stdout||agents.test.result):agents.test.stderr), run:agents.test});
  }
  // 4. Critic
  onStep&&onStep({agent:'Critic', status:'thinking'});
  agents.critique = await aiComplete(
    'Review this '+lang+' code for correctness, readability, edge cases and improvements. Be specific and concise.\n\n```'+lang+'\n'+agents.code+'\n```',
    'You are a meticulous senior code reviewer.');
  onStep&&onStep({agent:'Critic', status:'done', output:agents.critique});
  // 5. Security
  onStep&&onStep({agent:'Security', status:'thinking'});
  agents.security = await aiComplete(
    'Identify security risks (injection, unsafe eval, secrets, unvalidated input) in this code and how to fix them. If none, say so.\n\n```'+lang+'\n'+agents.code+'\n```',
    'You are an application security engineer.');
  onStep&&onStep({agent:'Security', status:'done', output:agents.security});
  return agents;
}

/* ===== CODE ANALYSIS SUITE (real LLM analysis) ===== */
/* Split large code into line-aligned chunks so Lab can handle 10,000+ lines.
   Each chunk carries its ABSOLUTE line range so findings cite real line numbers. */
function _labChunks(code, maxChars){
  maxChars = maxChars || 42000;
  const lines = String(code||'').split('\n');
  const chunks = []; let cur = [], curLen = 0, start = 1;
  for(let i=0;i<lines.length;i++){
    const l = lines[i];
    if(curLen + l.length + 1 > maxChars && cur.length){
      chunks.push({ start, end: i, text: cur.join('\n') });
      cur = []; curLen = 0; start = i + 1;
    }
    cur.push(l); curLen += l.length + 1;
  }
  if(cur.length) chunks.push({ start, end: lines.length, text: cur.join('\n') });
  return chunks;
}
try{ window._labChunks=_labChunks; }catch(e){}

/* Analyze code of ANY size. Small files go in one pass; large files are split,
   analyzed section by section, then merged into a single deduplicated report. */
async function analyzeCodeLarge(code, lang, kind, onProgress){
  const chunks = _labChunks(code);
  if(chunks.length <= 1){
    onProgress && onProgress(1, 1);
    return await analyzeCode(code, lang, kind);
  }
  const parts = [];
  for(let i=0;i<chunks.length;i++){
    onProgress && onProgress(i+1, chunks.length);
    const c = chunks[i];
    const framed =
      '(Section '+(i+1)+' of '+chunks.length+' of a larger file. These are lines '+c.start+'-'+c.end+
      ' of the original file - cite these ABSOLUTE line numbers in every finding.)\n\n' + c.text;
    const out = await analyzeCode(framed, lang, kind);
    parts.push('--- Lines '+c.start+'-'+c.end+' ---\n' + out);
  }
  onProgress && onProgress(chunks.length, chunks.length, true);
  // Merge the per-section reports into one clean result.
  const merged = parts.join('\n\n').slice(0, 120000);
  return await aiComplete(
    'Merge these per-section findings into ONE clean report for the whole file. Deduplicate repeated issues, keep the exact line numbers, and order by severity (most serious first). Do not invent anything that is not in the findings.\n\n' + merged,
    'You merge multiple code-analysis reports into a single precise, well-organised report.',
    { model: _sectionModel('debug'), max_tokens: 14000 }
  );
}
try{ window.analyzeCodeLarge=analyzeCodeLarge; }catch(e){}

/* Lightweight syntax highlighter for the Lab editor.
   Tokenises the RAW source, escapes every token, then wraps it - so no user
   input can ever reach the DOM unescaped. */
function _labHL(code, lang){
  const esc = (t)=>String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const KW = (lang==='python')
    ? /\b(def|class|return|if|elif|else|for|while|in|import|from|as|try|except|finally|raise|with|lambda|None|True|False|and|or|not|is|pass|break|continue|yield|global|self|print|len|range)\b/
    : /\b(function|const|let|var|return|if|else|for|while|do|switch|case|break|continue|class|extends|new|this|typeof|instanceof|import|export|from|default|async|await|try|catch|finally|throw|null|undefined|true|false|of|in|delete|void|yield|static|get|set)\b/;
  const RE = new RegExp(
    '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|#[^\\n]*)' +            // 1 comment
    '|("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)' +  // 2 string
    '|(\\b\\d+(?:\\.\\d+)?\\b)' +                                            // 3 number
    '|' + KW.source.replace(/^\\b|\\b$/g,'') .replace(/^\(/,'(\\b').replace(/\)$/,'\\b)') , // 4 keyword
    'g'
  );
  let out='', last=0, m;
  const re = new RegExp(RE.source,'g');
  while((m = re.exec(code)) !== null){
    if(m.index > last) out += esc(code.slice(last, m.index));
    if(m[1])      out += '<span class="t-com">'+esc(m[1])+'</span>';
    else if(m[2]) out += '<span class="t-str">'+esc(m[2])+'</span>';
    else if(m[3]) out += '<span class="t-num">'+esc(m[3])+'</span>';
    else          out += '<span class="t-kw">'+esc(m[0])+'</span>';
    last = m.index + m[0].length;
    if(m[0].length===0) re.lastIndex++;
  }
  out += esc(code.slice(last));
  return out + '\n';
}
try{ window._labHL=_labHL; }catch(e){}

async function analyzeCode(code, lang, kind){
  const prompts={
    stacktrace:['You are a stack-trace interpreter. Explain the error in plain English, name the exact cause, and give the fix.','Interpret this stack trace / error and explain the root cause + fix:\n\n'+code],
    smells:['You are a code-smell detector. List concrete smells with line references and refactors.','Detect code smells and anti-patterns:\n\n```'+lang+'\n'+code+'\n```'],
    refactor:['You are a refactoring engine. Return improved code in a fenced block, then a short list of what you changed.','Refactor this for clarity and performance:\n\n```'+lang+'\n'+code+'\n```'],
    bugs:['You are a static bug finder. List likely bugs, edge cases and regressions with severity.','Find bugs and regressions in this code:\n\n```'+lang+'\n'+code+'\n```'],
    security:['You are a vulnerability scanner. List vulnerabilities with severity and remediation.','Scan for vulnerabilities:\n\n```'+lang+'\n'+code+'\n```'],
    tests:['You are an automated test generator. Output a complete runnable test suite in a fenced block.','Generate thorough tests for this code:\n\n```'+lang+'\n'+code+'\n```'],
  };
  const pr=prompts[kind]||prompts.bugs;
  const large=code.length>4000;
  return await aiComplete(pr[1], pr[0]+' Be thorough, precise, and correct - reference exact lines, miss nothing.', {model:_sectionModel('debug'), max_tokens: large?14000:8000});
}


/* ===== LAB VIEW - real working dev/agent tools ===== */
/* Lab starts EMPTY on purpose. It used to ship with demo code, which meant the
   entry screen ("Drop in your code and AMV takes it from there") never appeared
   - so nobody learned how to paste or upload. Empty = the instructions show. */
const _LAB = { lang:'js', code:'', busy:false, files:[], chat:[] };

function renderLabView(){
  const vc=$('vc'); if(!vc) return;
  if(typeof _LAB_HANDOFF!=='undefined' && _LAB_HANDOFF){ _LAB.code=_LAB_HANDOFF; _LAB_HANDOFF=''; }
  const labBlank = !String(_LAB.code||'').trim();
  vc.innerHTML = `<div class="lab-shell${labBlank?' lab-blank':''}" id="lab-shell">
    <div class="lab-bar">
      <div class="lab-bar-l">
        <span class="dev-badge">Lab</span>
        <select id="lab-lang" class="lab-lang-sel">
          <option value="js">JavaScript</option>
          <option value="python">Python</option>
          <option value="html">HTML</option>
        </select>
        ${_sectionModelSelect('debug','lab-model')}
        <span class="lab-count" id="lab-count"></span>
        <span class="sec-usage-note" id="lab-usage-note"></span>
      </div>
      <div class="lab-bar-r">
        <button class="dev-ico" id="lab-upload-top" title="Upload code files"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></button>
        <button class="dev-ico" id="lab-new" title="New session"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
        <button class="dev-ico" id="lab-agents" title="Run agents on this code"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/></svg></button>
        <button class="lab-run-btn" id="lab-run"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>Run</button>
        <button class="dev-ico" id="lab-deploy" title="Publish this page to a live URL"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h8l-1 8 10-12h-8z"/></svg></button>
        <button class="lab-fix-btn" id="lab-debug"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>Auto-Debug</button>
      </div>
    </div>

    <!-- ENTRY STATE: paste on the left, upload on the right -->
    <div class="lab-entry" id="lab-entry">
      <h2>Drop in your code and AMV takes it from there</h2>
      <p>Paste it, or upload files - any size, 10,000+ lines is fine. Then pick what you want done.</p>
      <div class="lab-entry-grid">
        <div class="lab-entry-card">
          <div class="lab-entry-h"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Paste your code</div>
          <textarea id="lab-paste" placeholder="Paste here\u2026"></textarea>
        </div>
        <div class="lab-entry-card">
          <div class="lab-entry-h"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Or upload files</div>
          <div class="lab-drop" id="lab-drop">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <b>Drop files here</b>
            <span>or click to browse \u00b7 .js .py .ts .html and more</span>
          </div>
        </div>
      </div>
      <div class="lab-entry-do">
        <span class="lab-entry-lbl">Then just pick one - AMV loads it and explains what it finds</span>
        <div class="lab-entry-acts" id="lab-entry-acts">
          <button class="lab-go lab-go-p" data-go="run"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>Run it</button>
          <button class="lab-go lab-go-a" data-go="debug"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>Find &amp; fix the bugs</button>
          <button class="lab-go" data-go="bugs">Find bugs</button>
          <button class="lab-go" data-go="security">Security scan</button>
          <button class="lab-go" data-go="smells">Code smells</button>
          <button class="lab-go" data-go="refactor">Refactor</button>
          <button class="lab-go" data-go="tests">Write tests</button>
          <button class="lab-go" data-go="stacktrace">Explain an error</button>
        </div>
      </div>
      <input type="file" id="lab-files" multiple style="display:none">
    </div>

    <div class="lab-split">
      <section class="lab-editor">
        <div class="lab-files-bar" id="lab-files-bar"></div>
        <div class="lab-code-wrap" id="lab-code-wrap">
          <div class="lab-gutter" id="lab-gutter"></div>
          <pre class="lab-hl" id="lab-hl" aria-hidden="true"><code></code></pre>
          <textarea id="lab-code" spellcheck="false" placeholder="Paste or type your code here\u2026"></textarea>
        </div>
        <div class="lab-tools" id="lab-tools">
          ${['bugs','smells','refactor','security','tests','stacktrace'].map(k=>`<button class="lab-chip" data-an="${k}">${({bugs:'Find bugs',smells:'Code smells',refactor:'Refactor',security:'Security scan',tests:'Write tests',stacktrace:'Explain an error'})[k]}</button>`).join('')}
        </div>
      </section>
      <section class="lab-out">
        <div class="lab-out-top"><span class="lab-out-l" id="lab-out-title">Output</span><span id="lab-out-stat"></span></div>
        <div id="lab-out-body" class="lab-out-body"><div class="lab-empty-out">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
          <div><b>Nothing run yet</b><span>Hit Run to execute, or pick a tool - results stream in here.</span></div>
        </div></div>
        <!-- Talk to Lab about the code: "fix that", "this still doesn't work" -->
        <div class="lab-chat" id="lab-chat">
          <div class="lab-chat-log" id="lab-chat-log"></div>
          <div class="lab-chat-in">
            <textarea id="lab-ask" rows="1" placeholder="Tell Lab what to do - &quot;fix that&quot;, &quot;this still doesn\u2019t work&quot;, &quot;make it faster&quot;\u2026"></textarea>
            <button id="lab-ask-go" class="lab-ask-go" title="Send"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg></button>
          </div>
        </div>
      </section>
    </div>
  </div>`;

  const codeEl=$('lab-code'), langEl=$('lab-lang');
  langEl.value=_LAB.lang;
  // ── Loading code into Lab: paste, upload, or drag & drop ──
  const labShell=$('lab-shell');
  const setBlank=()=>{ if(labShell) labShell.classList.toggle('lab-blank', !String(codeEl.value||'').trim()); };

  // Load code in and leave the entry state.
  const labLoad=(code, name)=>{
    codeEl.value=String(code||'');
    _LAB.code=codeEl.value;
    if(name){ _LAB.files=_LAB.files||[]; if(!_LAB.files.includes(name)) _LAB.files.push(name); }
    paint(); labCount(); labFilesBar(); setBlank();
    try{ _sessTouch('lab'); }catch(e){}
  };

  // Read uploaded files (text only) and concatenate them with clear separators.
  const labIngest=async(fileList)=>{
    const files=Array.from(fileList||[]);
    if(!files.length) return;
    if(typeof _ctxFileGuard==='function' && !_ctxFileGuard('lab', files.length)) return;
    const readable=files.filter(f=>f.size < 8*1024*1024);
    if(!readable.length){ toast('Those files are too large to read (8MB limit each).','error',4500); return; }
    const parts=[];
    for(const f of readable){
      const text=await f.text().catch(()=>'');
      if(!text) continue;
      try{ _ctxFileTrack('lab', f.name); }catch(e){}
      parts.push(readable.length>1 ? ('/* ===== '+f.name+' ===== */\n'+text) : text);
      // pick the language from the first file's extension
      if(parts.length===1){
        const ext=(f.name.split('.').pop()||'').toLowerCase();
        const lang = ext==='py' ? 'python' : (ext==='html'||ext==='htm') ? 'html' : 'js';
        _LAB.lang=lang; if(langEl) langEl.value=lang;
      }
    }
    if(!parts.length){ toast('Could not read those files as text.','error',4000); return; }
    const combined=parts.join('\n\n');
    const existing=String(codeEl.value||'').trim();
    labLoad(existing ? existing+'\n\n'+combined : combined, readable.map(f=>f.name).join(', '));
    const lines=combined.split('\n').length;
    toast('Loaded '+readable.length+' file'+(readable.length>1?'s':'')+' \u00b7 '+lines.toLocaleString()+' lines. Pick a tool and AMV gets to work.','success',4500);
  };

  // File pills above the editor
  const labFilesBar=()=>{
    const bar=$('lab-files-bar'); if(!bar) return;
    const f=_LAB.files||[];
    if(!f.length){ bar.innerHTML=''; bar.style.display='none'; return; }
    bar.style.display='flex';
    bar.innerHTML=f.slice(-6).map(n=>'<span class="lab-file-pill"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'+escH(n)+'</span>').join('');
  };

  // Entry-state paste box → loads straight into the editor
  const pasteBox=$('lab-paste');
  if(pasteBox){
    const takePaste=()=>{ const v=pasteBox.value; if(v && v.trim()){ labLoad(v); pasteBox.value=''; } };
    on(pasteBox,'input',()=>{ /* live: don't steal focus, just track */ });
    on(pasteBox,'blur',takePaste);
    on(pasteBox,'paste',()=>setTimeout(takePaste,30));
  }

  // Upload: click the drop zone, the top icon, or drag files anywhere
  const filesInput=$('lab-files');
  on($('lab-drop'),'click',()=>filesInput&&filesInput.click());
  on($('lab-upload-top'),'click',()=>filesInput&&filesInput.click());
  on(filesInput,'change',async function(){ await labIngest(this.files); this.value=''; });
  const drop=$('lab-drop');
  if(drop){
    on(drop,'dragover',e=>{ e.preventDefault(); drop.classList.add('on'); });
    on(drop,'dragleave',()=>drop.classList.remove('on'));
    on(drop,'drop',async e=>{ e.preventDefault(); drop.classList.remove('on'); await labIngest(e.dataTransfer.files); });
  }
  if(labShell){
    on(labShell,'dragover',e=>{ e.preventDefault(); labShell.classList.add('lab-dropping'); });
    on(labShell,'dragleave',e=>{ if(e.target===labShell) labShell.classList.remove('lab-dropping'); });
    on(labShell,'drop',async e=>{ e.preventDefault(); labShell.classList.remove('lab-dropping'); if(e.dataTransfer.files.length) await labIngest(e.dataTransfer.files); });
  }

  // ONE-CLICK: the entry buttons take whatever is loaded (or pasted) and just do it.
  vc.querySelectorAll('#lab-entry-acts [data-go]').forEach(btn=>on(btn,'click',async()=>{
    // pull in anything sitting in the paste box first
    if(pasteBox && pasteBox.value.trim()){ labLoad(pasteBox.value); pasteBox.value=''; }
    const code=String(codeEl.value||'').trim();
    if(!code){
      toast('Paste your code or upload a file first - then pick what you want done.','error',4500);
      if(pasteBox) pasteBox.focus();
      return;
    }
    const go=btn.dataset.go;
    setBlank();                                  // leave the entry screen
    if(go==='run') return _labRun();
    if(go==='debug') return _labDebug();
    return _labAnalyze(go);
  }));

  // Paint the highlight layer + line-number gutter, and keep them in sync.
  const hl=$('lab-hl'), gutter=$('lab-gutter');
  const paint=()=>{
    const v=codeEl.value||'';
    if(hl && hl.firstElementChild){
      // Only highlight what's on screen for very large files (keeps it instant).
      hl.firstElementChild.innerHTML = v.length>200000 ? _labHL(v.slice(0,200000),_LAB.lang) : _labHL(v,_LAB.lang);
    }
    if(gutter){
      const n=v.split('\n').length;
      let g=''; for(let i=1;i<=n;i++) g+=i+'\n';
      gutter.textContent=g;
    }
  };
  const syncScroll=()=>{
    if(hl){ hl.scrollTop=codeEl.scrollTop; hl.scrollLeft=codeEl.scrollLeft; }
    if(gutter) gutter.scrollTop=codeEl.scrollTop;
  };
  codeEl.value=_LAB.code||'';
  paint();
  on(codeEl,'scroll',syncScroll);
  on(codeEl,'input',()=>{ paint(); setBlank(); });
  labFilesBar(); setBlank();

  // Live size readout - shows Lab is handling big files.
  const labCount=()=>{
    const el=$('lab-count'); if(!el) return;
    const v=codeEl.value||''; if(!v.trim()){ el.textContent=''; return; }
    const lines=v.split('\n').length;
    const kb=v.length/1024;
    const chunks=(typeof _labChunks==='function')?_labChunks(v).length:1;
    el.textContent = lines.toLocaleString()+' lines \u00b7 '+(kb<1000?kb.toFixed(0)+'KB':(kb/1024).toFixed(1)+'MB')+(chunks>1?' \u00b7 '+chunks+' passes':'');
    el.classList.toggle('lab-count-big', lines>2000);
  };
  labCount();
  on(codeEl,'input',()=>{_LAB.code=codeEl.value; labCount(); try{ _sessTouch('lab'); }catch(e){}});
  on(langEl,'change',()=>{_LAB.lang=langEl.value; paint();});
  const labUsage=()=>{ const n=$('lab-usage-note'); if(n){ n.textContent=''; } };
  labUsage();
  on($('lab-model'),'change',function(){ _setSectionModel('debug', this.value); labUsage(); toast('Debug model set to '+MODELS[this.value].label,'info',2500); });
  on($('lab-new'),'click',()=>{
    _sessLeave('lab');      // save current work to Recents
    _sessNew('lab');
    _resetToolState('lab');
    renderLabView();
    toast('New Lab session','info',2000);
  });
  on($('lab-run'),'click',_labRun);
  on($('lab-debug'),'click',_labDebug);
  on($('lab-deploy'),'click',_labDeploy);
  on($('lab-ask-go'),'click',_labAsk);
  const askEl=$('lab-ask');
  if(askEl){
    on(askEl,'keydown',e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); _labAsk(); } });
    on(askEl,'input',()=>{ askEl.style.height='auto'; askEl.style.height=Math.min(askEl.scrollHeight,110)+'px'; });
  }
  _labChatRender();
  on($('lab-agents'),'click',_labAgents);
  _wireModelPicker(vc);
  vc.querySelectorAll('.lab-chip').forEach(ch=>on(ch,'click',()=>_labAnalyze(ch.dataset.an)));
}
function _labOut(html){ const b=$('lab-out-body'); if(b) b.innerHTML=html; try{ _mobileShowOutput('lab'); }catch(e){} }

/* Analysis tools - each explains what it found, in plain English.
   Handles files of ANY size via chunked map-reduce (10,000+ lines). */
async function _labAnalyze(kind){
  if(_LAB.busy) return; _labBusy(true); _labStat('Analyzing\u2026');
  const code=$('lab-code').value;
  const lines=code.split('\n').length;
  _labOut('<div class="lab-running">Analyzing '+lines.toLocaleString()+' lines\u2026</div>');
  try{
    const out=await analyzeCodeLarge(code, _LAB.lang, kind, (i,total,merging)=>{
      if(total>1){
        _labStat(merging?'Merging\u2026':'Section '+i+' of '+total);
        _labOut('<div class="lab-running">'+(merging
          ? 'Merging findings across '+total+' sections\u2026'
          : 'Analyzing '+lines.toLocaleString()+' lines - section '+i+' of '+total+'\u2026')+
          '<div class="lab-prog"><div class="lab-prog-b" style="width:'+Math.round((i/total)*100)+'%"></div></div></div>');
      }
    });
    const titles={bugs:'Bugs found',smells:'Code smells',refactor:'Refactored code',security:'Security scan',tests:'Tests written',stacktrace:'Error explained'};
    _labStat('\u2713 done','ok');
    _labOut('<div class="lab-sec"><div class="lab-sec-h">'+escH(titles[kind]||kind)+
      ' <span class="lab-sec-sub">'+lines.toLocaleString()+' lines analyzed</span></div>'+
      '<div class="lab-md">'+(typeof md==='function'?md(out):'<pre class="lab-pre">'+_esc(out)+'</pre>')+'</div></div>');
  }catch(e){
    _labStat('\u2717 '+e.message,'err');
    _labOut('<div class="lab-sec err"><pre class="lab-pre">'+_esc(e.message)+'</pre></div>');
  }
  _labBusy(false);
}
try{ window._labAnalyze=_labAnalyze; }catch(e){}

/* Auto-Debug: run it, fix what breaks, re-run - then explain the fix. */
async function _labDebug(){
  if(_LAB.busy) return; _labBusy(true);
  const code=$('lab-code').value;
  const lines=code.split('\n').length;
  _labStat('Auto-debugging\u2026');
  _labOut('<div class="lab-running">Running '+lines.toLocaleString()+' lines, then fixing whatever breaks\u2026</div>');
  try{
    const res=await autoDebug(code, _LAB.lang, 3, (st)=>{
      _labOut('<div class="lab-running">'+escH((st&&(st.note||st.msg))||'Working\u2026')+
        '<div class="lab-prog"><div class="lab-prog-b" style="width:'+Math.min(100,((st&&st.iter)||1)*33)+'%"></div></div></div>');
    }, _sectionModel('debug'));
    if(res && res.code && res.code!==code){
      const el=$('lab-code');
      if(el){ el.value=res.code; _LAB.code=res.code; el.dispatchEvent(new Event('input',{bubbles:true})); }
    }
    const passed = res && res.ok!==false;
    _labStat(passed?'\u2713 fixed & passing':'\u2717 still failing', passed?'ok':'err');
    const explain = (res && (res.explanation||res.summary)) ||
      (passed ? 'The code runs cleanly now - the fixed version is in the editor.' : 'Some issues remain. See the details above.');
    _labOut('<div class="lab-sec'+(passed?'':' err')+'">'+
      '<div class="lab-sec-h">'+(passed?'Fixed':'Could not fully fix')+
        ' <span class="lab-sec-sub">'+lines.toLocaleString()+' lines</span></div>'+
      '<div class="lab-md">'+(typeof md==='function'?md(explain):escH(explain))+'</div>'+
      ((res&&res.stdout)?'<div class="lab-sec-h" style="margin-top:12px">Output</div><pre class="lab-pre">'+_esc(res.stdout)+'</pre>':'')+
    '</div>');
  }catch(e){
    _labStat('\u2717 '+e.message,'err');
    _labOut('<div class="lab-sec err"><pre class="lab-pre">'+_esc(e.message)+'</pre></div>');
  }
  _labBusy(false);
}
try{ window._labDebug=_labDebug; }catch(e){}

/* Run Agents: a small crew plans, writes, and verifies against your code. */
async function _labAgents(){
  if(_LAB.busy) return; _labBusy(true);
  const code=$('lab-code').value;
  const task = code.trim()
    ? 'Improve and harden this code. Explain what you changed and why.\n\n```'+_LAB.lang+'\n'+code.slice(0,40000)+'\n```'
    : 'Ask the user what they want built.';
  _labStat('Agents working\u2026');
  _labOut('<div class="lab-running">Agents are planning, writing, and verifying\u2026</div>');
  try{
    const res=await runAgents(task, _LAB.lang, (st)=>{
      _labOut('<div class="lab-running">'+escH((st&&(st.note||st.msg||st.agent))||'Working\u2026')+'</div>');
    });
    if(res && res.code){
      const el=$('lab-code');
      if(el){ el.value=res.code; _LAB.code=res.code; el.dispatchEvent(new Event('input',{bubbles:true})); }
    }
    _labStat('\u2713 done','ok');
    const body = (res && (res.explanation||res.summary||res.report)) || 'The agents finished. Any updated code is in the editor.';
    _labOut('<div class="lab-sec"><div class="lab-sec-h">Agents finished</div>'+
      '<div class="lab-md">'+(typeof md==='function'?md(body):escH(String(body)))+'</div></div>');
  }catch(e){
    _labStat('\u2717 '+e.message,'err');
    _labOut('<div class="lab-sec err"><pre class="lab-pre">'+_esc(e.message)+'</pre></div>');
  }
  _labBusy(false);
}
try{ window._labAgents=_labAgents; }catch(e){}

/* Lab can now SHIP. If the code in the editor is a page, publish it live. */
async function _labDeploy(){
  if(_LAB.busy) return;
  const code=($('lab-code')||{}).value||'';
  if(!code.trim()){ toast('Nothing to publish - load some code first.','info',3500); return; }
  const looksLikePage = _LAB.lang==='html' || /<html|<!doctype|<body|<div/i.test(code);
  if(!looksLikePage){
    toast('Publishing works for web pages. Switch the language to HTML, or build a page in Dev.','info',5000);
    return;
  }
  if(!(window.AMV_API && AMV_API.live && AMV_API.token)){
    toast('Connect the AMV engine in Settings to publish a live URL.','error',5000);
    return;
  }
  _labBusy(true); _labStat('Publishing\u2026');
  try{
    const out=await _amvRunTool('deploy_site',{ html:code, title:'Lab page' },(m)=>_labStat(m));
    const m=String(out.text||'').match(/https?:\/\/\S+/);
    const url=m?m[0]:'';
    _labStat('\u2713 live','ok');
    _labOut('<div class="lab-sec"><div class="lab-sec-h">Published</div>'+
      '<div class="lab-md">'+(url
        ? 'It\u2019s live at <a href="'+escH(url)+'" target="_blank" rel="noopener" style="color:var(--accent)">'+escH(url)+'</a> - anyone with the link can open it.'
        : escH(out.text))+'</div></div>');
  }catch(e){
    _labStat('\u2717 '+e.message,'err');
    _labOut('<div class="lab-sec err"><pre class="lab-pre">'+_esc(e.message)+'</pre></div>');
  }
  _labBusy(false);
}
try{ window._labDeploy=_labDeploy; }catch(e){}

/* ── Talk to Lab about your code ───────────────────────────────
   Lab could only run fixed tools (Run / Find bugs / Auto-Debug). You couldn't
   just say "this still doesn't work" or "make it faster". Now you can: Lab sees
   the code in the editor, can rewrite it, and can use the real tools. */
function _labChatRender(){
  const log=$('lab-chat-log'); if(!log) return;
  const msgs=_LAB.chat||[];
  if(!msgs.length){ log.innerHTML=''; log.classList.remove('on'); return; }
  log.classList.add('on');
  log.innerHTML = msgs.map(m=>
    m.role==='user'
      ? '<div class="lc-u">'+escH(m.text)+'</div>'
      : '<div class="lc-a">'+(typeof md==='function'?md(m.text):escH(m.text))+(m.applied?'<div class="lc-applied">\u2713 Updated the code in the editor</div>':'')+'</div>'
  ).join('');
  log.scrollTop = log.scrollHeight;
}

async function _labAsk(){
  const ta=$('lab-ask'); if(!ta) return;
  const q=ta.value.trim(); if(!q) return;
  if(_LAB.busy) return;
  const codeEl=$('lab-code');
  const code=(codeEl&&codeEl.value)||'';
  if(!code.trim()){ toast('Paste or upload some code first - then tell Lab what to do with it.','info',4500); return; }

  ta.value=''; ta.style.height='auto';
  _LAB.chat=_LAB.chat||[];
  _LAB.chat.push({role:'user', text:q});
  _labChatRender();
  _labBusy(true); _labStat('Thinking\u2026');

  try{
    const lastOut = ($('lab-out-body')||{}).textContent || '';
    const sys = 'You are AMV Lab, working on the user\u2019s code with them. You can SEE their code and the last output.\n'+
      'If the answer requires changing the code, return the COMPLETE updated file inside one fenced code block, then a short plain-English explanation of what you changed and why.\n'+
      'If no code change is needed, just answer clearly. Never return fragments or diffs - always the whole file when you change it.';
    const prompt =
      'LANGUAGE: '+_LAB.lang+'\n\n'+
      'CURRENT CODE:\n```'+_LAB.lang+'\n'+code.slice(0,120000)+'\n```\n\n'+
      (lastOut.trim() ? 'LAST OUTPUT / RESULT:\n'+lastOut.slice(0,3000)+'\n\n' : '')+
      (_LAB.chat.slice(-6,-1).map(m=>(m.role==='user'?'User: ':'You: ')+String(m.text).slice(0,600)).join('\n')||'')+
      '\n\nUSER: '+q;

    const out = await aiComplete(prompt, sys, { max_tokens:8000, model:_sectionModel('debug') });

    // If Lab returned new code, apply it straight into the editor.
    const m = String(out||'').match(/```[a-z]*\n([\s\S]*?)```/i);
    let applied=false;
    if(m && m[1] && m[1].trim() && m[1].trim() !== code.trim()){
      codeEl.value = m[1].trim();
      _LAB.code = codeEl.value;
      codeEl.dispatchEvent(new Event('input',{bubbles:true}));
      applied=true;
      try{ _sessTouch('lab'); }catch(e){}
    }
    const explanation = String(out||'').replace(/```[a-z]*\n[\s\S]*?```/i,'').trim() || (applied?'Updated the code.':'Done.');
    _LAB.chat.push({role:'ai', text:explanation, applied});
    _labChatRender();
    _labStat(applied?'\u2713 code updated':'\u2713 done','ok');
  }catch(e){
    _LAB.chat.push({role:'ai', text:'Couldn\u2019t do that: '+e.message});
    _labChatRender();
    _labStat('\u2717 '+e.message,'err');
  }
  _labBusy(false);
}
try{ window._labAsk=_labAsk; }catch(e){}

function _labStat(t,cls){ const s=$('lab-out-stat'); if(s){ s.textContent=t||''; s.className=cls||''; } }
function _labBusy(b){ _LAB.busy=b; ['lab-run','lab-debug','lab-agents'].forEach(id=>{const el=$(id); if(el) el.disabled=b;}); }
function _esc(s){ return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function _labRun(){
  if(_LAB.busy) return; _labBusy(true);
  const code=$('lab-code').value;
  _labStat('Running\u2026'); _labOut('<div class="lab-running">Running your code\u2026</div>');
  try{
    const r=await runCode(code, _LAB.lang);
    if(r.html){
      _labStat('\u2713 rendered','ok');
      const ifr=document.createElement('iframe');
      ifr.sandbox='allow-scripts'; ifr.style.cssText='width:100%;height:100%;border:0;background:#fff;border-radius:8px';
      ifr.srcdoc=r.html;
      const b=$('lab-out-body'); if(b){ b.innerHTML=''; b.appendChild(ifr); }
    } else if(r.ok){
      _labStat('\u2713 ran in '+r.ms+'ms','ok');
      _labOut('<div class="lab-sec"><div class="lab-sec-h">Output</div><pre class="lab-pre">'+_esc(r.stdout||'(no output)')+'</pre>'+
        (r.result?'<div class="lab-sec-h" style="margin-top:12px">Result</div><pre class="lab-pre">'+_esc(r.result)+'</pre>':'')+'</div>');
    } else {
      _labStat('\u2717 error','err');
      _labOut('<div class="lab-sec err"><div class="lab-sec-h">Error</div><pre class="lab-pre">'+_esc(r.stderr||'failed')+'</pre>'+
        (r.stdout?'<div class="lab-sec-h" style="margin-top:12px">Output before the error</div><pre class="lab-pre">'+_esc(r.stdout)+'</pre>':'')+'</div>');
    }
  }catch(e){ _labStat('\u2717 '+e.message,'err'); _labOut('<div class="lab-sec err"><pre class="lab-pre">'+_esc(e.message)+'</pre></div>'); }
  _labBusy(false);
}
window.renderLabView=renderLabView;


/* ===== REAL CREW TASK EXECUTION (runs + shows result inline) ===== */
const _CREW_RESULTS = [];
function _crewResultsHTML(){
  if(!_CREW_RESULTS.length) return '';
  return '<div class="crew-results">'+_CREW_RESULTS.slice().reverse().map(r=>(
    '<div class="crew-res '+(r.status)+'">'+
      '<div class="crew-res-h"><span class="crew-res-ic">'+(r.status==='running'?'<span class="spin"></span>':r.status==='done'?'✓':'✕')+'</span>'+
        '<span class="crew-res-t">'+escH(r.title)+'</span>'+
        '<span class="crew-res-s">'+(r.status==='running'?(r.note||'working…'):r.status==='done'?'completed':'failed')+'</span></div>'+
      (r.body?'<div class="crew-res-body">'+(typeof md==='function'?md(r.body):escH(r.body))+'</div>':'')+
      (r.actions?'<div class="crew-res-act">'+r.actions+'</div>':'')+
    '</div>'
  )).join('')+'</div>';
}
function _crewRender(){ const el=$('crew-live'); if(el) el.innerHTML=_crewResultsHTML(); }

async function crewRun(kind, title, opts){
  opts=opts||{};
  const res={id:'cr'+Date.now(), kind, title, status:'running', note:'starting…', body:'', actions:''};
  _CREW_RESULTS.push(res); _crewRender();
  const up=(p)=>{ Object.assign(res,p); _crewRender(); const el=$('crew-live'); if(el) el.scrollTop=0; };
  try{
    if(kind==='trip'){
      up({note:'planning your trip…'});
      const detail = opts.detail || await showTextPromptAsync('Where & when? (e.g. "Lisbon for 5 days in October, mid budget, leaving from NYC")','');
      if(!detail){ up({status:'failed', note:'cancelled', body:'No trip details given.'}); return res; }
      res.title='Trip plan - '+detail.slice(0,50);
      const out = await aiComplete(
        'Plan this trip in detail. Output: (1) a day-by-day itinerary, (2) a markdown table of suggested flights with realistic airlines/times/price ranges and a "Book" column noting the route, (3) 3 hotel suggestions with nightly price, (4) estimated total budget. Be specific and realistic.\n\nTrip: '+detail,
        'You are an elite travel planner. Use markdown headers, tables, and bullet lists.');
      // realistic booking handoff (real search links, not a fake "booked")
      const q=encodeURIComponent(detail);
      const book='<a class="btn bp" href="https://www.google.com/travel/flights?q='+q+'" target="_blank" rel="noopener">Search & book flights →</a>'+
                 '<a class="btn" href="https://www.booking.com/searchresults.html?ss='+q+'" target="_blank" rel="noopener">Find hotels →</a>';
      up({status:'done', body:out, actions:book});
    }
    else if(kind==='gmail'){
      up({note:'checking Gmail…'});
      const token=(typeof getGToken==='function')?getGToken():null;
      if(!token){ up({status:'failed', body:'**Gmail not connected.** Go to Integrations and connect Gmail, then run this again.'}); return res; }
      const r=await fetchDeadline('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&labelIds=INBOX&q=is:unread',{headers:{'Authorization':'Bearer '+token}});
      const d=await r.json();
      if(d.error){ up({status:'failed', body:'Gmail error: '+d.error.message}); return res; }
      const msgs=d.messages||[];
      if(!msgs.length){ up({status:'done', body:'**Inbox clear** - no unread emails.'}); return res; }
      up({note:'reading '+msgs.length+' emails…'});
      const details=await Promise.all(msgs.slice(0,8).map(m=>fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+m.id+'?format=metadata&metadataHeaders=Subject&metadataHeaders=From',{headers:{'Authorization':'Bearer '+token}}).then(x=>x.json())));
      const list=details.map(m=>{const h=(m.payload&&m.payload.headers)||[];const g=n=>(h.find(x=>x.name===n)||{}).value||'';return {from:g('From'),subject:g('Subject'),snippet:m.snippet||''};});
      const summary=await aiComplete('Summarize these unread emails into a short prioritized briefing with suggested one-line replies. Emails:\n'+JSON.stringify(list,null,2),'You are an executive assistant. Use markdown.');
      up({status:'done', body:summary});
    }
    else if(kind==='week'){
      up({note:'planning your week…'});
      const out=await aiComplete('Create an optimized weekly plan. Ask nothing; make reasonable assumptions and produce a Monday-Sunday schedule with focus blocks, then a short rationale.','You are a productivity strategist. Use a markdown table for the schedule.');
      up({status:'done', body:out});
    }
    else if(kind==='custom'){
      const t=opts.detail || await showTextPromptAsync('What should AMV do? (it will actually do it and show the result)','');
      if(!t){ up({status:'failed', note:'cancelled', body:''}); return res; }
      res.title=t.slice(0,60);
      up({note:'working…'});
      const out=await aiComplete(t,'You are AMV, a highly capable autonomous assistant. Actually complete the task and present the finished result with markdown formatting. Do not say you will do it later - do it now.');
      up({status:'done', body:out});
    }
    else { up({status:'failed', body:'Unknown task.'}); }
  }catch(e){
    up({status:'failed', body:'**Error:** '+e.message+(/key/i.test(e.message)?' - the AMV engine needs to be connected by the workspace owner.':'')});
  }
  return res;
}
window.crewRun=crewRun;


/* ===== DEDICATED TRIP PLANNER (own screen, real form -> AI) ===== */
function openTripPlanner(){
  const r=$('ovr'); if(!r) return;
  r.innerHTML = `<div class="ov trip-ov" id="trip-bg"><div class="trip-modal" onclick="event.stopPropagation()">
    <div class="trip-head">
      <div><div class="eyebrow">AMV Travel</div><h2 class="trip-title">Plan a trip</h2></div>
      <button class="trip-x" id="trip-close" aria-label="close">✕</button>
    </div>
    <div id="trip-step1" class="trip-body">
      <p class="trip-sub">Tell AMV what you want. It builds a full itinerary, finds flights & hotels in your budget, and gives you one-tap booking.</p>
      <div class="trip-form">
        <div class="trip-row">
          <label class="trip-f"><span>Destination</span><input id="t-dest" type="text" placeholder="e.g. Lisbon, or 'somewhere warm in Europe'"></label>
          <label class="trip-f"><span>Departing from</span><input id="t-from" type="text" placeholder="e.g. New York (JFK)"></label>
        </div>
        <div class="trip-row">
          <label class="trip-f"><span>Start date</span><input id="t-start" type="date"></label>
          <label class="trip-f"><span>End date</span><input id="t-end" type="date"></label>
        </div>
        <div class="trip-row">
          <label class="trip-f"><span>Travelers</span><input id="t-trav" type="number" min="1" value="1"></label>
          <label class="trip-f"><span>Total budget (USD)</span><input id="t-budget" type="number" min="0" placeholder="e.g. 2000"></label>
        </div>
        <div class="trip-row">
          <label class="trip-f"><span>Trip style</span>
            <select id="t-style"><option>Balanced</option><option>Budget</option><option>Luxury</option><option>Adventure</option><option>Relaxation</option><option>Foodie</option><option>Culture & history</option><option>Family</option></select>
          </label>
          <label class="trip-f"><span>Pace</span>
            <select id="t-pace"><option>Moderate</option><option>Packed</option><option>Slow & easy</option></select>
          </label>
        </div>
        <label class="trip-f full"><span>Anything else? (interests, must-dos, dietary, accessibility)</span><textarea id="t-notes" rows="2" placeholder="e.g. love hiking and seafood, want one beach day, no early flights"></textarea></label>
      </div>
      <div class="trip-foot">
        <span class="trip-hint">AMV will plan everything from these details.</span>
        <button class="btn bp trip-go" id="trip-plan">Plan my trip →</button>
      </div>
    </div>
    <div id="trip-step2" class="trip-body" style="display:none">
      <div id="trip-status" class="trip-planning"><span class="spin"></span> <span id="trip-status-t">Planning your trip…</span></div>
      <div id="trip-result" class="trip-result"></div>
      <div id="trip-actions" class="trip-actions2"></div>
    </div>
  </div></div>`;
  on($('trip-close'),'click',closeTripPlanner);
  on($('trip-bg'),'click',closeTripPlanner);
  on($('trip-plan'),'click',_tripPlan);
  // sensible default dates (next month, 5 days)
  const s=new Date(Date.now()+30*864e5), e=new Date(Date.now()+35*864e5);
  const f=d=>d.toISOString().slice(0,10);
  if($('t-start')) $('t-start').value=f(s);
  if($('t-end')) $('t-end').value=f(e);
}
function closeTripPlanner(){ const r=$('ovr'); if(r) r.innerHTML=''; }

async function _tripPlan(){
  const g=id=>{const el=$(id);return el?el.value.trim():'';};
  const dest=g('t-dest');
  if(!dest){ toast('Where do you want to go?','error'); $('t-dest')&&$('t-dest').focus(); return; }
  const data={
    destination:dest, from:g('t-from')||'(flexible)', start:g('t-start'), end:g('t-end'),
    travelers:g('t-trav')||'1', budget:g('t-budget')||'(flexible)', style:g('t-style'), pace:g('t-pace'), notes:g('t-notes')
  };
  // switch to step 2
  $('trip-step1').style.display='none'; $('trip-step2').style.display='block';
  const setStat=t=>{ const el=$('trip-status-t'); if(el) el.textContent=t; };
  try{
    const prompt='Plan a complete trip from these exact details:\n'+JSON.stringify(data,null,2)+
      '\n\nProduce, using markdown:\n## Overview (1-2 lines)\n## Flights - a table: Airline | Route | Times | Est. price (in budget). \n## Where to stay - 3 options with nightly price.\n## Day-by-day itinerary (use the actual dates).\n## Budget breakdown - a table that totals at or under the stated budget for '+data.travelers+' traveler(s).\n## Tips. Be specific and realistic.';
    const out=await aiComplete(prompt,'You are an elite travel planner. Be specific, realistic, and stay within budget. Use markdown headers and tables.',{max_tokens:6000});
    $('trip-status').style.display='none';
    $('trip-result').innerHTML=(typeof md==='function'?md(out):escH(out));
    // real booking handoffs prefilled
    const q=encodeURIComponent((data.from!=='(flexible)'?data.from+' to ':'')+data.destination+' '+data.start+' to '+data.end);
    const hq=encodeURIComponent(data.destination);
    $('trip-actions').innerHTML=
      '<a class="btn bp" target="_blank" rel="noopener" href="https://www.google.com/travel/flights?q='+q+'">Search & book flights →</a>'+
      '<a class="btn" target="_blank" rel="noopener" href="https://www.booking.com/searchresults.html?ss='+hq+'&checkin='+data.start+'&checkout='+data.end+'">Book hotels →</a>'+
      '<button class="btn" id="trip-redo">Plan another</button>'+
      '<button class="btn" id="trip-save">Save to a chat</button>';
    on($('trip-redo'),'click',openTripPlanner);
    on($('trip-save'),'click',()=>{ try{ S.cur=null; setMsgs([{r:'u',c:'Plan a trip to '+data.destination},{r:'a',c:out,model:S.model,ts:Date.now()}]); closeTripPlanner(); setTab('chat'); toast('Saved to a new chat','success'); }catch(e){} });
  }catch(err){
    $('trip-status').style.display='none';
    $('trip-result').innerHTML='<div class="trip-err"><b>Couldn\'t plan the trip.</b><br>'+escH(err.message)+(/key/i.test(err.message)?'<br><br>The AMV engine needs to be connected by the workspace owner.':'')+'</div>';
    $('trip-actions').innerHTML='<button class="btn" id="trip-back2">← Back</button>';
    on($('trip-back2'),'click',openTripPlanner);
  }
}
window.openTripPlanner=openTripPlanner;


/* ===== TASK DETAIL PANEL (file / custom) + RECURRING AUTOMATION ===== */
let _PENDING_FILE=null, _PENDING_FILE_CONTENT=null, _PENDING_FILE_KIND=null;

// File cards call this: read file, then open the detail panel
function amvOpenFile(f,kind){
  if(!f) return;
  _PENDING_FILE=f; _PENDING_FILE_KIND=kind;
  const reader=new FileReader();
  const isText = kind!=='image' && (f.type.startsWith('text')||/\.(txt|md|csv|tsv|json|js|ts|py|html|css|xml|yml|yaml|java|c|cpp|go|rb|php|sql)$/i.test(f.name)||f.size<200000);
  reader.onload=()=>{ _PENDING_FILE_CONTENT=reader.result; openTaskPanel('file'); };
  reader.onerror=()=>{ if(typeof toast==='function') toast('Could not read '+f.name,'error'); };
  if(kind==='image'||!isText) reader.readAsDataURL(f); else reader.readAsText(f);
}

function openTaskPanel(mode){
  const r=$('ovr'); if(!r) return;
  const isFile = mode==='file';
  const title = isFile ? 'Work on a file' : 'Custom task';
  const fileLine = isFile && _PENDING_FILE ? '<div class="tp-file">📎 '+escH(_PENDING_FILE.name)+' <span>'+Math.round(_PENDING_FILE.size/1024)+' KB</span></div>' : '';
  const ph = isFile ? "e.g. 'find the bugs and fix them', 'summarize the key points', 'clean this data and chart revenue by month'"
                    : "Describe exactly what you want AMV to do. Be specific - it will actually do it and show the result.";
  r.innerHTML = `<div class="ov tp-ov" id="tp-bg"><div class="tp-modal" onclick="event.stopPropagation()">
    <div class="tp-head"><div><div class="eyebrow">AMV Task</div><h2 class="tp-title">${title}</h2></div><button class="tp-x" id="tp-close">✕</button></div>
    <div class="tp-body" id="tp-step1">
      ${fileLine}
      <label class="tp-f"><span>What should AMV do?</span><textarea id="tp-detail" rows="4" placeholder="${escH(ph)}"></textarea></label>
      <div class="tp-recur">
        <label class="tp-f"><span>Repeat this task</span>
          <select id="tp-repeat">
            <option value="none">Just once</option>
            <option value="hourly">Every hour</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
          </select>
        </label>
        <div class="tp-recur-note" id="tp-recur-note"></div>
      </div>
      <div class="tp-foot"><span class="tp-hint">AMV does it now and shows the result here.</span><button class="btn bp" id="tp-run">Do it →</button></div>
    </div>
    <div class="tp-body" id="tp-step2" style="display:none">
      <div id="tp-status" class="tp-planning"><span class="spin"></span> <span id="tp-status-t">Working…</span></div>
      <div id="tp-result" class="tp-result"></div>
      <div id="tp-actions" class="tp-actions2"></div>
    </div>
  </div></div>`;
  on($('tp-close'),'click',closeTaskPanel);
  on($('tp-bg'),'click',closeTaskPanel);
  on($('tp-run'),'click',()=>_taskRun(mode));
  const rep=$('tp-repeat'), note=$('tp-recur-note');
  on(rep,'change',()=>{ note.textContent = rep.value==='none' ? '' :
    'Runs '+rep.value+' while AMV is open. Connect the AMV backend to run it 24/7 even when you\'re away.'; });
}
function closeTaskPanel(){ const r=$('ovr'); if(r) r.innerHTML=''; }

async function _taskRun(mode){
  const detail=($('tp-detail')?$('tp-detail').value.trim():'');
  if(!detail){ toast('Tell AMV what to do first','error'); $('tp-detail')&&$('tp-detail').focus(); return; }
  const repeat=$('tp-repeat')?$('tp-repeat').value:'none';
  $('tp-step1').style.display='none'; $('tp-step2').style.display='block';
  const setStat=t=>{const el=$('tp-status-t'); if(el) el.textContent=t;};
  try{
    let prompt, sys='You are AMV, a highly capable assistant. Actually complete the task now and present the finished result with markdown. Do not say you will do it later.';
    if(mode==='file' && _PENDING_FILE){
      const isImg=_PENDING_FILE_KIND==='image';
      prompt = isImg
        ? 'The user uploaded an image named '+_PENDING_FILE.name+'. Task: '+detail+'\n(Describe what you would do and produce any text-based result you can.)'
        : 'File: '+_PENDING_FILE.name+'\n\nContents:\n```\n'+String(_PENDING_FILE_CONTENT).slice(0,14000)+'\n```\n\nTask: '+detail+'\n\nDo it and show the result.';
    } else {
      prompt = detail;
    }
    const out=await aiComplete(prompt, sys, {max_tokens:5000});
    $('tp-status').style.display='none';
    $('tp-result').innerHTML=(typeof md==='function'?md(out):escH(out));
    let acts='<button class="btn" id="tp-again">New task</button><button class="btn" id="tp-save">Save to a chat</button>';
    if(repeat!=='none'){ _scheduleTask({mode, detail, repeat, fileName:_PENDING_FILE?_PENDING_FILE.name:null}); acts='<span class="tp-sched">✓ Scheduled '+repeat+'</span>'+acts; }
    $('tp-actions').innerHTML=acts;
    on($('tp-again'),'click',()=>openTaskPanel(mode));
    on($('tp-save'),'click',()=>{ try{ S.cur=null; setMsgs([{r:'u',c:detail},{r:'a',c:out,model:S.model,ts:Date.now()}]); closeTaskPanel(); setTab('chat'); toast('Saved','success'); }catch(e){} });
  }catch(err){
    $('tp-status').style.display='none';
    $('tp-result').innerHTML='<div class="tp-err"><b>Could not complete.</b><br>'+escH(err.message)+(/key/i.test(err.message)?'<br><br>The AMV engine needs to be connected by the workspace owner.':'')+'</div>';
    $('tp-actions').innerHTML='<button class="btn" id="tp-back2">← Back</button>';
    on($('tp-back2'),'click',()=>openTaskPanel(mode));
  }
}

/* ---- Automations: REAL background execution on the server ----
   These now live server-side and are executed by a cron trigger, so they run
   whether or not the app is open. (They used to only fire when you opened the
   app, which made a "7am daily brief" useless.) If the engine isn't connected,
   we say so honestly instead of silently pretending to schedule. */
async function _autoApi(path, body){
  if(!(window.AMV_API && AMV_API.live && AMV_API.token))
    throw new Error('not-connected');
  const r = await fetchDeadline(AMV_API.base.replace(/\/$/,'') + path, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+AMV_API.token },
    body: JSON.stringify(body||{})
  });
  const d = await r.json().catch(()=>({}));
  if(!r.ok || d.error){
    // Carry the machine-readable code across too. Callers need to tell "this
    // needs a paid plan" from "the network failed", and matching on prose is
    // how that goes wrong the first time the wording changes.
    const err = new Error(d.error || ('request failed ('+r.status+')'));
    if(d.code) err.code = d.code;
    err.status = r.status;
    throw err;
  }
  return d;
}

/* ── Research Watch setup ──────────────────────────────────────────────────
   Let the user set up an autonomous, recurring research job: watch a subject on
   a schedule and report what's happening. It delivers in-app always, and by
   email if they choose. Framed as monitoring/analysis - never trade advice. */
function openResearchWatch(){
  const ovr=$('ovr'); if(!ovr) return;
  ovr.innerHTML=
    '<div class="rw-modal">'+
      '<div class="rw-head">'+
        '<span class="rw-emoji">🔭</span>'+
        '<div><div class="rw-title">Set up a research watch</div>'+
        '<p class="rw-sub">AMV checks on your topic on a schedule and reports what\u2019s happening - the facts, the news, the sentiment. It never tells you to buy, sell, or short; that\u2019s your call.</p></div>'+
      '</div>'+
      '<label class="rw-lbl">What should AMV watch?</label>'+
      '<textarea id="rw-subject" class="inp" rows="3" placeholder="e.g. Bitcoin price and major news, or NVIDIA stock and analyst sentiment, or new AI model releases"></textarea>'+
      '<label class="rw-lbl">How often?</label>'+
      '<div class="rw-opts" id="rw-repeat">'+
        '<button class="rw-opt" data-repeat="10min">Every 10 min</button>'+
        '<button class="rw-opt" data-repeat="30min">Every 30 min</button>'+
        '<button class="rw-opt on" data-repeat="hourly">Hourly</button>'+
        '<button class="rw-opt" data-repeat="daily">Daily</button>'+
        '<button class="rw-opt" data-repeat="weekly">Weekly</button>'+
      '</div>'+
      '<label class="rw-lbl">Where should findings go?</label>'+
      '<div class="rw-opts" id="rw-notify">'+
        '<button class="rw-opt on" data-notify="app">In-app<span class="rw-opt-s">See it in Tasks</span></button>'+
        '<button class="rw-opt" data-notify="email">Email me<span class="rw-opt-s">Sent each run</span></button>'+
      '</div>'+
      '<div class="rw-note">This is information, not financial advice. AMV reports what\u2019s happening; it won\u2019t place trades or tell you what to buy.</div>'+
      '<div class="rw-actions"><button class="btn bs" id="rw-cancel">Cancel</button><button class="btn bp" id="rw-start">Start watching</button></div>'+
    '</div>';
  ovr.classList.add('on');

  let repeat='hourly', notify='app';
  ovr.querySelectorAll('#rw-repeat [data-repeat]').forEach(b=>on(b,'click',()=>{
    repeat=b.dataset.repeat;
    ovr.querySelectorAll('#rw-repeat .rw-opt').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
  }));
  ovr.querySelectorAll('#rw-notify [data-notify]').forEach(b=>on(b,'click',()=>{
    notify=b.dataset.notify;
    ovr.querySelectorAll('#rw-notify .rw-opt').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
  }));
  on($('rw-cancel'),'click',closeOvr);
  on($('rw-start'),'click',async()=>{
    const subject=($('rw-subject')?$('rw-subject').value:'').trim();
    if(!subject){ $('rw-subject')&&$('rw-subject').focus(); return; }
    const btn=$('rw-start'); if(btn){ btn.disabled=true; btn.textContent='Setting up\u2026'; }
    const item=await _scheduleTask({
      detail: subject,
      repeat,
      kind: 'research',
      notify
    });
    if(item){
      closeOvr();
      setTab('tasks');
    } else if(btn){
      btn.disabled=false; btn.textContent='Start watching';
    }
  });
}
try{ window.openResearchWatch=openResearchWatch; }catch(e){}

// Create an automation that genuinely runs in the background.
/* Whether background work can reach an inbox on this deployment, and whether
   this account's plan can run it at all. Both come from the server - the app
   must never promise delivery it cannot perform. Unknown until the first
   /auto/list, and unknown means we do not claim it. */
let _AUTO_EMAIL_READY = false;
let _AUTO_CAN_SCHEDULE = null;

async function _scheduleTask(t){
  try{
    // Ask for email when the deployment can send it - "have it ready when I get
    // up" is only true if it arrives somewhere the user looks when AMV is shut.
    const wantEmail = t.notify === 'email' || (t.notify !== 'app' && _AUTO_EMAIL_READY);
    const d = await _autoApi('/auto/create', {
      detail: t.detail,
      repeat: t.repeat || 'daily',
      kind: t.kind || 'task',
      notify: wantEmail ? 'email' : 'app',
      firstRunAt: t.firstRunAt || null,
      approval: t.approval || 'require',
      scope: t.scope || null
    });
    if(typeof d.emailReady === 'boolean') _AUTO_EMAIL_READY = d.emailReady;
    _AUTOS = d.item ? (_AUTOS||[]).concat(d.item) : _AUTOS;
    _AUTO_CAN_SCHEDULE = true;
    /* Say which of the two things actually happens, because they are different
       promises. Emailed means they never have to come back to find out; in-app
       means it is waiting in Tasks and they do. */
    if(typeof toast==='function'){
      const emailed = d.item && d.item.notify === 'email';
      toast(emailed
        ? 'Scheduled - it runs on its own and the result is emailed to you.'
        : 'Scheduled - it runs on its own, and the result will be waiting in Tasks.',
        'success', 4500);
    }
    return d.item;
  }catch(e){
    /* A plan that cannot run background work is not an error to swallow - it is
       the one case where the user can fix it, so it points at the fix. */
    if(e.code === 'plan_required' || /paid plan/i.test(e.message||'')){
      _AUTO_CAN_SCHEDULE = false;
      if(typeof toast==='function') toast(e.message || 'Background automations need a paid plan.','info',7000);
      try{ if(typeof setTab==='function'){ S.tab='plans'; setTab('plans'); } }catch(_){}
      return null;
    }
    if(e.message === 'not-connected'){
      if(typeof toast==='function')
        toast('Connect the AMV engine in Settings so automations can run in the background.','error',6000);
    } else {
      if(typeof toast==='function') toast('Could not schedule: '+e.message,'error',5000);
    }
    return null;
  }
}

// Pull the user's automations + any results that ran while they were away.
let _AUTOS = [];
let _AUTO_RESULTS = [];
async function _autoRefresh(){
  try{
    const d = await _autoApi('/auto/list', {});
    _AUTOS = d.items || [];
    _AUTO_RESULTS = d.results || [];
    if(typeof d.emailReady === 'boolean') _AUTO_EMAIL_READY = d.emailReady;
    if(typeof d.canSchedule === 'boolean') _AUTO_CAN_SCHEDULE = d.canSchedule;
    const unread = _AUTO_RESULTS.filter(r=>!r.read);
    if(unread.length && typeof toast==='function'){
      toast(unread.length + ' automation result' + (unread.length>1?'s':'') + ' ready while you were away.','success',6000);
    }
    _autoBadge(unread.length);
    try{ if(S.tab==='automation') renderAutomationView(); }catch(e){}
    return d;
  }catch(e){ return null; }
}
function _autoBadge(n){
  try{
    const nav=document.querySelector('[data-tab="automation"], [data-tab="tasks"]');
    if(!nav) return;
    let b=nav.querySelector('.auto-badge');
    if(!n){ if(b) b.remove(); return; }
    if(!b){ b=document.createElement('span'); b.className='auto-badge'; nav.appendChild(b); }
    b.textContent = n>9 ? '9+' : String(n);
  }catch(e){}
}
async function _autoAction(id, action){
  try{
    const d = await _autoApi('/auto/update', { id, action });
    _AUTOS = d.items || _AUTOS;
    try{ if(S.tab==='automation') renderAutomationView(); }catch(e){}
    return true;
  }catch(e){ if(typeof toast==='function') toast('Failed: '+e.message,'error',4000); return false; }
}
async function _autoMarkRead(){
  try{ await _autoApi('/auto/read',{}); _AUTO_RESULTS.forEach(r=>r.read=true); _autoBadge(0); }catch(e){}
}
try{ window._autoRefresh=_autoRefresh; window._autoAction=_autoAction; window._autoMarkRead=_autoMarkRead; }catch(e){}
window.openTaskPanel=openTaskPanel; window.amvOpenFile=amvOpenFile;
// On open: pull anything that ran in the background while you were away.
setTimeout(function(){ try{ if(S.user && S.user.email) _autoRefresh(); }catch(e){} }, 2000);
// And keep it fresh while the app is open.
setInterval(function(){ try{ if(S.user && S.user.email && !document.hidden) _autoRefresh(); }catch(e){} }, 120000);


