/* AMV'S CODE SANDBOX - where programs AMV runs for somebody actually run.
   (AMV-AUD-001, AMV-AUD-015)

   WHY IT IS A SEPARATE PAGE.

   Programs used to run in Web Workers made by the app itself. A worker has no
   document and no localStorage, which kept code away from the page - but it
   shares the app's ORIGIN: it can open the app's IndexedDB, and it can fetch
   the app's own backend with the person's cookies attached. Code the model
   wrote, possibly steered by a web page it read, was one step from the
   account. And the app's security policy refuses WebAssembly, so Python could
   not start at all.

   This page is loaded by the app as <iframe sandbox="allow-scripts"> - no
   allow-same-origin - which gives it an OPAQUE origin ("null"): no cookies, no
   localStorage, no IndexedDB, no reach into the app's page. Its own policy
   (sandbox.html) allows no network except the one host the Python runtime is
   fetched from, and is the only policy in AMV that allows WebAssembly. Every
   program still runs in a Worker of its own inside it, so a runaway loop
   never holds the page's thread, and each worker is stopped on every way out.

   THE PROTOCOL is postMessage, and deliberately small:
     app -> here   { t:'run', id, lang:'js'|'py', code, timeoutMs }
     here -> app   { t:'ready' }  once, when this page can take work
                   { t:'status', id, msg }  optional progress for a job
                   { t:'result', id, ok, stdout, stderr, result, ms }
   Only messages from the window that framed this page are acted on. Results go
   back to it with '*' as the target because this page cannot know the app's
   origin from inside an opaque one, and a result is the program's own output,
   nothing the app did not hand over. The app, for its part, only accepts
   messages whose source is this frame. */
(function () {
  'use strict';
  const PY_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/';
  const JS_LOG_CAP = 200000;
  const PY_OUT_CAP = 200000;
  const host = window.parent;
  const send = (m) => { try { host.postMessage(m, '*'); } catch (e) {} };
  const now = () => (self.performance && performance.now) ? performance.now() : Date.now();

  /* ── JAVASCRIPT ──────────────────────────────────────────────────────────
     The program goes into the worker's own source rather than through eval,
     so nothing here needs 'unsafe-eval'. Console output is captured and capped
     as it is written (AMV-AUD-022), and an error thrown from a callback or an
     unawaited rejection still ends the run instead of waiting for the timeout. */
  function jsWorkerSource(code, id) {
    const tag = JSON.stringify(id);
    return 'self.window=self;var __logs=[],__n=0,__cut=false;' +
      'function __fmt(a){try{return (typeof a==="object"&&a!==null)?JSON.stringify(a):String(a)}catch(e){return String(a)}}' +
      'var __p=function(){ if(__n>=' + JS_LOG_CAP + '){ __cut=true; return; }' +
        'var s=Array.prototype.slice.call(arguments).map(__fmt).join(" ");' +
        'if(__n+s.length>' + JS_LOG_CAP + '){ s=s.slice(0,' + JS_LOG_CAP + '-__n); __cut=true; }' +
        '__logs.push(s); __n+=s.length+1; };' +
      'self.console={log:__p,error:__p,warn:__p,info:__p,debug:__p,trace:__p};' +
      'var __sent=false;' +
      'function __done(ok,err,result){ if(__sent) return; __sent=true;' +
        'if(__cut) __logs.push("[output cut off at ' + JS_LOG_CAP + ' characters]");' +
        'self.postMessage({__sbx:' + tag + ',ok:ok,logs:__logs.slice(),error:err||"",' +
        'result:(result===undefined||result===null)?"":String(result)}); }' +
      'self.onerror=function(m,s,l,c,e){ __done(false,(e&&e.stack)?e.stack:String(m)); return true; };' +
      'self.onunhandledrejection=function(ev){ var r=ev&&ev.reason; __done(false,(r&&r.stack)?r.stack:String(r)); };' +
      '(async function(){ var __r;' +
        'try{ __r = await (async function(){\n' + code + '\n})(); }' +
        'catch(e){ __done(false,(e&&e.stack)?e.stack:String(e)); return; }' +
        '__done(true,"",__r);' +
      '})();';
  }
  function runJS(job) {
    return new Promise((resolve) => {
      const id = 'js_' + Math.random().toString(36).slice(2);
      const t0 = now();
      const ms = () => Math.round(now() - t0);
      let done = false, worker = null, url = '', timer = null;
      /* THE ONE WAY OUT. The worker is stopped here and nowhere else, so no
         branch can forget: a program that has already answered can still be
         spinning in a callback, and a worker nobody stopped keeps its thread. */
      const finish = (res) => {
        if (done) return; done = true;
        clearTimeout(timer);
        try { if (worker) worker.terminate(); } catch (e) {}
        try { if (url) URL.revokeObjectURL(url); } catch (e) {}
        resolve(res);
      };
      try {
        url = URL.createObjectURL(new Blob([jsWorkerSource(job.code, id)], { type: 'application/javascript' }));
        worker = new Worker(url);
      } catch (e) {
        finish({ ok: false, stdout: '', stderr: 'The JavaScript sandbox could not start, so nothing was run: ' + ((e && e.message) || e), result: '', ms: ms() });
        return;
      }
      worker.onmessage = (ev) => {
        const d = ev && ev.data;
        if (!d || d.__sbx !== id) return;
        finish({ ok: !!d.ok, stdout: (d.logs || []).join('\n'), stderr: d.error || '', result: d.result || '', ms: ms() });
      };
      /* A program that does not PARSE never runs, so there is no message to
         wait for: reported as the syntax error it is, not as a timeout. */
      worker.onerror = (ev) => {
        try { if (ev && ev.preventDefault) ev.preventDefault(); } catch (e) {}
        const where = (ev && ev.lineno) ? (' (line ' + Math.max(1, (ev.lineno | 0) - 1) + ')') : '';
        finish({ ok: false, stdout: '', stderr: ((ev && ev.message) || 'The program could not be started.') + where, result: '', ms: ms() });
      };
      const limit = job.timeoutMs || 15000;
      timer = setTimeout(() => finish({ ok: false, stdout: '',
        stderr: 'Execution timed out after ' + Math.round(limit / 1000) + 's and the sandbox was stopped. Check for an infinite loop or heavy computation.',
        result: '', ms: limit }), limit);
    });
  }

  /* ── PYTHON ──────────────────────────────────────────────────────────────
     ONE INTERPRETER PER JOB (AMV-AUD-016): a job's variables, imports and
     patched modules never reach the next job, because each job takes its own
     worker and that worker is terminated when the job ends. The cost of a
     fresh runtime is paid in the background - the next clean worker is started
     and warmed as soon as a job ends. The app sends Python jobs one at a time. */
  function pyWorkerSource() {
    return "let py=null,loading=null;" +
      "async function ensure(){ if(py) return py; if(!loading) loading=(async()=>{" +
        "importScripts('" + PY_CDN + "pyodide.js');" +
        "py=await loadPyodide({indexURL:'" + PY_CDN + "'}); return py; })(); return loading; }" +
      "function why(x){ const m=(x&&x.message)?x.message:String(x);" +
        "return /WebAssembly|wasm|unsafe-eval/i.test(m)" +
          "? 'Python cannot start here: the security policy does not allow the Python runtime (WebAssembly) to load. JavaScript still runs.'" +
          ": 'Runtime load error: '+m; }" +
      "self.onmessage=async(e)=>{ const d=e.data||{};" +
        "if(d.warm){ try{ await ensure(); self.postMessage({warm:true,ok:true}); }catch(x){ self.postMessage({warm:true,ok:false}); } return; }" +
        "let out='',cut=false; const add=s=>{ if(out.length<" + PY_OUT_CAP + ") out+=s+'\\n'; else cut=true; };" +
        "let p; try{ p=await ensure(); }catch(x){ self.postMessage({id:d.id, ok:false, stdout:'', stderr:why(x), result:'', loaded:false}); return; }" +
        "p.setStdout({batched:add}); p.setStderr({batched:add});" +
        "let result,err=null;" +
        "try{ result=await p.runPythonAsync(d.code); }catch(x){ err=(x&&x.message)?x.message:String(x); }" +
        "if(cut) out=out.slice(0," + PY_OUT_CAP + ")+'\\n[output cut off at " + PY_OUT_CAP + " characters]';" +
        "self.postMessage({id:d.id, ok:!err, stdout:out.trim(), stderr:err||'', result:(result!==undefined&&result!==null)?String(result):'', loaded:true});" +
      "};";
  }
  let pyUrl = '';            // one Blob URL for the source, made once - it never changes
  let pyWarm = null;         // the clean, possibly warm, worker the next job will take
  let pyRuntimeOk = false;   // warm the next worker only once the runtime has been seen to load
  function pyNewWorker() {
    if (!pyUrl) pyUrl = URL.createObjectURL(new Blob([pyWorkerSource()], { type: 'application/javascript' }));
    return new Worker(pyUrl);
  }
  function pyPrewarm() {
    if (!pyRuntimeOk) return;
    try { if (!pyWarm) pyWarm = pyNewWorker(); pyWarm.postMessage({ warm: true }); } catch (e) {}
  }
  function runPy(job) {
    return new Promise((resolve) => {
      let w;
      /* The job TAKES the worker: nobody else is handed an interpreter this
         job has touched. */
      try { w = pyWarm || pyNewWorker(); pyWarm = null; }
      catch (e) { resolve({ ok: false, stdout: '', stderr: 'Python sandbox unavailable: ' + ((e && e.message) || e), result: '', ms: 0 }); return; }
      const id = 'py_' + Math.random().toString(36).slice(2);
      const t0 = now();
      let done = false, timer = null;
      const finish = (r) => {
        if (done) return; done = true;
        clearTimeout(timer);
        try { w.removeEventListener('message', onMsg); } catch (e) {}
        try { w.terminate(); } catch (e) {}
        if (r.loaded) pyRuntimeOk = true;
        delete r.loaded;
        pyPrewarm();
        resolve(r);
      };
      const onMsg = (ev) => {
        if (!ev.data || ev.data.id !== id) return;
        const d = ev.data;
        finish({ ok: d.ok, stdout: d.stdout, stderr: d.stderr, result: d.result, loaded: d.loaded, ms: Math.round(now() - t0) });
      };
      w.addEventListener('message', onMsg);
      send({ t: 'status', id: job.id, msg: pyRuntimeOk ? 'Running Python in a sandbox…' : 'Running Python in a sandbox (first run loads the runtime)…' });
      w.postMessage({ id, code: job.code });
      const limit = job.timeoutMs || 30000;
      timer = setTimeout(() => finish({ ok: false, stdout: '', stderr: 'Execution timed out (' + Math.round(limit / 1000) + 's) - the sandbox was terminated.', result: '', ms: Math.round(now() - t0) }), limit);
    });
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== host) return;                     // only the window that framed this page
    const d = ev.data;
    if (!d || d.t !== 'run' || typeof d.id !== 'string' || typeof d.code !== 'string') return;
    const job = { id: d.id, code: d.code, timeoutMs: Math.max(1000, Math.min(Number(d.timeoutMs) || 0, 120000)) || undefined };
    const run = d.lang === 'py' ? runPy : runJS;
    run(job).then((r) => send(Object.assign({ t: 'result', id: d.id }, r)));
  });
  send({ t: 'ready' });
})();
