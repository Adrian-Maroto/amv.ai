/* ══════════════════════════════════════════════════════════════════════
   WATCHING AMV'S BROWSER WORK.

   Fetched the first time a web run starts (`_webLiveLoad` in 18-universal.js),
   so nobody who never runs one carries it. It runs in the page's own scope.

   The web agent runs in a hosted browser on AMV's servers. Asked for in live
   mode (/v1/browser/run?live=1) it streams every step: what it did, where,
   and a picture of the page. This is the panel that shows it - the latest
   picture, what just happened, and Stop. Stop aborts the stream, and the
   server ends the run at its next step rather than carry on unwatched.

   The pictures live in this panel and nowhere else: never in the chat, never
   saved, never synced. Closing the panel lets them go.
   ══════════════════════════════════════════════════════════════════════ */
/* Its styles travel with it rather than in styles.css: only somebody watching
   a run ever needs them, and the page is at its weight ceiling. Same tokens as
   everything else, added once. */
const _WLV_CSS = '.wlv{ position:fixed; right:var(--sp-4); top:calc(var(--nav-h, 56px) + var(--sp-3)); z-index:900; width:min(360px, calc(100vw - 2*var(--sp-4)));\n' +
  '  background:var(--s1); border:1px solid var(--bd); border-radius:var(--r-lg); box-shadow:var(--sh-lg); padding:var(--sp-3);\n' +
  '  display:flex; flex-direction:column; gap:var(--sp-2); }\n' +
  '.wlv-h{ display:flex; align-items:center; gap:var(--sp-2); }\n' +
  '.wlv-dot{ width:8px; height:8px; border-radius:var(--r-pill); background:var(--grn); flex:none; }\n' +
  '.wlv.done .wlv-dot{ background:var(--mu); }\n' +
  '.wlv-tt{ flex:1; min-width:0; display:flex; flex-direction:column; font-size:var(--t-sm); color:var(--tx); }\n' +
  '.wlv-host{ color:var(--mu); font-size:var(--t-xs); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }\n' +
  '.wlv-goal{ font-size:var(--t-sm); color:var(--mu); line-height:1.45; }\n' +
  '.wlv-pic{ background:var(--s3); border-radius:var(--r-md); overflow:hidden; aspect-ratio:1280 / 900; display:flex; align-items:center; justify-content:center; }\n' +
  '.wlv-pic img{ width:100%; height:100%; object-fit:contain; display:block; }\n' +
  '.wlv-wait{ margin:0; font-size:var(--t-sm); color:var(--mu); }\n' +
  '.wlv-now{ margin:0; font-size:var(--t-sm); color:var(--tx); line-height:1.45; min-height:1.45em; overflow-wrap:anywhere; }\n' +
  '.wlv.min .wlv-goal, .wlv.min .wlv-pic, .wlv.min .wlv-now{ display:none; }\n' +
  '@media (max-width:560px){\n' +
  '  .wlv{ right:0; left:0; top:auto; bottom:0; width:auto; border-radius:var(--r-lg) var(--r-lg) 0 0; border-bottom:0; }\n' +
  '}';
function _webLiveOpen(goal){
  if(!document.getElementById('wlv-css')){
    const st = document.createElement('style'); st.id = 'wlv-css'; st.textContent = _WLV_CSS;
    document.head.appendChild(st);
  }
  const old = document.getElementById('wlv'); if(old) old.remove();
  const ctrl = new AbortController();
  const el = document.createElement('section');
  el.id = 'wlv'; el.className = 'wlv';
  el.setAttribute('aria-label', T('AMV’s browser'));
  el.innerHTML =
    '<div class="wlv-h"><span class="wlv-dot" aria-hidden="true"></span>'
    + '<div class="wlv-tt"><b>' + escH(T('AMV’s browser')) + '</b><span class="wlv-host" id="wlv-host"></span></div>'
    + '<button class="btn bs" id="wlv-min" type="button" aria-expanded="true">' + escH(T('Hide')) + '</button>'
    + '<button class="btn bs wlv-stop" id="wlv-stop" type="button">' + escH(T('Stop')) + '</button></div>'
    + '<div class="wlv-goal">' + escH(String(goal || '').slice(0, 160)) + '</div>'
    + '<div class="wlv-pic"><img id="wlv-img" alt="" hidden><p class="wlv-wait" id="wlv-wait">' + escH(T('Opening the page…')) + '</p></div>'
    + '<p class="wlv-now" id="wlv-now" role="status" aria-live="polite"></p>';
  document.body.appendChild(el);
  let url = '';
  const setPic = (b64, alt) => {
    if(!b64) return;
    try{
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const next = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      const img = el.querySelector('#wlv-img');
      img.src = next; img.alt = alt; img.hidden = false;
      el.querySelector('#wlv-wait').hidden = true;
      if(url) URL.revokeObjectURL(url);
      url = next;
    }catch(e){}
  };
  const SAY = { open: 'Opened the page', click: 'Clicked', type: 'Typed', filled: 'Filled in a saved detail', select: 'Chose an option',
                press: 'Pressed a key', scroll: 'Scrolled', submit: 'Submitted', blocked: 'Stopped', skipped: 'Skipped a box', extract: 'Read the page' };
  const close = () => { try{ if(url) URL.revokeObjectURL(url); }catch(e){} url = ''; el.remove(); };
  /* Hidden, not stopped: the run carries on and the bar stays, so the
     message box and everything else on the page can be used meanwhile. */
  const minBtn = el.querySelector('#wlv-min');
  minBtn.addEventListener('click', () => {
    const min = el.classList.toggle('min');
    minBtn.textContent = min ? T('Show') : T('Hide');
    minBtn.setAttribute('aria-expanded', min ? 'false' : 'true');
  });
  const stopBtn = el.querySelector('#wlv-stop');
  stopBtn.addEventListener('click', () => {
    if(stopBtn.dataset.done === '1'){ close(); return; }
    try{ ctrl.abort(); }catch(e){}
    stopBtn.textContent = T('Close'); stopBtn.dataset.done = '1';
    el.querySelector('#wlv-now').textContent = T('Stopped. Nothing more was done on the page.');
    el.classList.add('done');
  });
  return {
    signal: ctrl.signal,
    close,
    /* Read the stream to its end. Each step updates the panel; the `end` event
       is returned - the same answer the plain call gives, with its status. */
    async read(res){
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', end = null;
      try{
        for(;;){
          const { value, done } = await reader.read();
          if(done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while((i = buf.indexOf('\n\n')) >= 0){
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            if(!chunk.startsWith('data: ')) continue;
            let e; try{ e = JSON.parse(chunk.slice(6)); }catch(x){ continue; }
            if(e.type === 'step'){
              const what = T(SAY[e.verb] || 'Working');
              let host = ''; try{ host = new URL(e.url).host; }catch(x){}
              el.querySelector('#wlv-host').textContent = host;
              el.querySelector('#wlv-now').textContent = T('Step') + ' ' + e.step + ' · ' + what + (e.why ? ': ' + e.why : '');
              setPic(e.shot, what + (host ? ' - ' + host : ''));
            } else if(e.type === 'end') end = e;
          }
        }
      }catch(err){
        if(ctrl.signal.aborted) return { ok: false, code: 'stopped', status: 200, error: T('Stopped. Nothing more was done on the page.') };
        throw err;
      }
      el.classList.add('done');
      stopBtn.textContent = T('Close'); stopBtn.dataset.done = '1';
      if(end){
        el.querySelector('#wlv-now').textContent = end.ok ? (end.result || T('Done.')) : (end.need || end.message || end.error || T('Stopped.'));
      }
      return end || { ok: false, status: 502, error: T('The web run ended without an answer.') };
    }
  };
}
try{ window._webLiveOpen = _webLiveOpen; }catch(e){}
