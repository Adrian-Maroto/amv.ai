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
  '.wlv.min .wlv-goal, .wlv.min .wlv-pic, .wlv.min .wlv-now, .wlv.min .wlv-take{ display:none; }\n' +
  '.wlv.taking .wlv-dot{ background:var(--gold); }\n' +
  '.wlv.taking .wlv-pic img{ cursor:crosshair; }\n' +
  '.wlv-take{ display:flex; flex-direction:column; gap:var(--sp-2); }\n' +
  '.wlv-take-row{ display:flex; flex-wrap:wrap; gap:var(--sp-2); }\n' +
  '.wlv-take-row input{ flex:1; min-width:0; min-height:44px; }\n' +
  '.wlv-take .btn{ min-height:44px; }\n' +
  '@media (max-width:560px){\n' +
  '  .wlv{ right:0; left:0; top:auto; bottom:0; width:auto; border-radius:var(--r-lg) var(--r-lg) 0 0; border-bottom:0; }\n' +
  '}\n' +
  '.wj-list{ list-style:none; margin:0 0 var(--sp-2); padding:0; }\n' +
  '.wj-row{ display:flex; align-items:center; justify-content:space-between; gap:var(--sp-2); padding:var(--sp-2) 0; border-bottom:1px solid var(--bdl); }\n' +
  '.wj-site{ font-size:var(--t-base); color:var(--tx); overflow-wrap:anywhere; }\n' +
  '.wj-none{ color:var(--mu); font-size:var(--t-sm); margin:0; }';
function _wlvCss(){
  if(document.getElementById('wlv-css')) return;
  const st = document.createElement('style'); st.id = 'wlv-css'; st.textContent = _WLV_CSS;
  document.head.appendChild(st);
}
function _webLiveOpen(goal){
  _wlvCss();
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
  /* YOUR TURN. The run stopped where only the person can go on - a captcha,
     or a sign-in AMV has nothing for - and handed the browser over (see
     72-web-takeover.js). The picture becomes the page: a tap clicks there,
     the box types, the keys press. What is typed goes to the page and is
     cleared from the box at once; it is never kept here either. `act` is the
     caller's, which knows the address and the sign-in. Resolves 'resume' or
     'stop'. */
  const takeover = (end, act) => new Promise((resolve) => {
    el.classList.remove('done'); el.classList.add('taking');
    const now = el.querySelector('#wlv-now');
    now.textContent = T('Your turn: AMV stopped at something only you can do. Tap the picture to click there, type below, then carry on. The browser stays open for ten minutes.');
    const box = document.createElement('div');
    box.className = 'wlv-take';
    box.innerHTML = '<div class="wlv-take-row"><input id="wlv-text" type="text" autocomplete="off" spellcheck="false" aria-label="' + escH(T('Type into the page')) + '" placeholder="' + escH(T('Type into the page')) + '">'
      + '<button class="btn bs" type="button" data-take="type">' + escH(T('Type')) + '</button></div>'
      + '<div class="wlv-take-row"><button class="btn bs" type="button" data-take="Enter">Enter</button><button class="btn bs" type="button" data-take="Tab">Tab</button>'
      + '<button class="btn bs" type="button" data-take="Backspace">' + escH(T('Delete')) + '</button><button class="btn bs" type="button" data-take="scroll">' + escH(T('Scroll down')) + '</button></div>'
      + '<div class="wlv-take-row"><button class="btn bp" type="button" data-take="resume">' + escH(T('Carry on')) + '</button>'
      + '<button class="btn bs" type="button" data-take="close">' + escH(T('Close the browser')) + '</button></div>';
    el.appendChild(box);
    const img = el.querySelector('#wlv-img');
    let busy = false;
    const finish = (how) => { img.removeEventListener('click', onPic); box.remove(); el.classList.remove('taking'); resolve(how); };
    const send = async (a) => {
      if(busy) return; busy = true; box.querySelectorAll('button').forEach(b => b.disabled = true);
      try{
        const d = await act(a);
        if(d && d.shot) setPic(d.shot, T('The page'));
        if(d && d.status === 410){ now.textContent = d.error || T('That browser has closed.'); finish('stop'); return; }
        if(d && (d.code === 'blocked_url' || d.closed)){ now.textContent = d.error || T('The browser is closed.'); finish('stop'); return; }
        if(d && d.error) now.textContent = d.error;
      }catch(e){ now.textContent = T('That did not reach AMV’s browser. Try again.'); }
      finally{ busy = false; box.querySelectorAll('button').forEach(b => b.disabled = false); }
    };
    const onPic = (e) => {
      const r = img.getBoundingClientRect();
      if(!r.width || !r.height) return;
      send({ kind: 'click', x: Math.round((e.clientX - r.left) / r.width * 1279), y: Math.round((e.clientY - r.top) / r.height * 899) });
    };
    img.addEventListener('click', onPic);
    const text = box.querySelector('#wlv-text');
    const typeIt = () => { const t = text.value; text.value = ''; if(t) send({ kind: 'type', text: t.slice(0, 500) }); };
    text.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); typeIt(); } });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-take]'); if(!b) return;
      const k = b.getAttribute('data-take');
      if(k === 'type') typeIt();
      else if(k === 'scroll') send({ kind: 'scroll', dy: 600 });
      else if(k === 'resume'){ now.textContent = T('Carrying on…'); finish('resume'); }
      else if(k === 'close'){ send({ kind: 'close' }).then(() => { now.textContent = T('Closed. Nothing more was done on the page.'); finish('stop'); }); }
      else send({ kind: 'key', key: k });
    });
    stopBtn.textContent = T('Close'); stopBtn.dataset.done = '1';
    text.focus();
  });
  /* Back to watching, for the run that carries on. */
  const restart = () => {
    el.classList.remove('done', 'taking');
    stopBtn.textContent = T('Stop'); stopBtn.dataset.done = '';
  };
  /* A few rounds at most - each is the person's own choice. Sign-ins the run
     collected are kept for this device after each, as at the end of any run. */
  const rounds = async (d, runOnce, base, tok, site) => {
    for(let round = 0; d && d.takeover && round < 3; round++){
      if(site && Array.isArray(d.cookies)) await _webJarSave(site, d.cookies);
      const handle = d.takeover;
      const how = await takeover(d, async (a) => {
        const tr = await fetchDeadline(base.replace(/\/$/, '') + '/v1/browser/takeover', { method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
          body: JSON.stringify({ handle, act: a }) }, 30000);
        const j = await tr.json().catch(() => ({}));
        return Object.assign(j, { status: tr.status });
      });
      if(how !== 'resume'){ delete d.takeover; break; }
      restart();
      const r = await runOnce({ resume: handle });
      d = /event-stream/.test(r.headers.get('Content-Type') || '') ? await this_read(r) : await r.json().catch(() => ({}));
    }
    return d;
  };
  let this_read = null;
  const view = {
    signal: ctrl.signal,
    close, takeover, restart, rounds,
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
  this_read = view.read.bind(view);
  return view;
}


/* ══════════════════════════════════════════════════════════════════════
   STAYING SIGNED IN: THE SIGN-INS LIVE ON THIS DEVICE, ENCRYPTED.

   When a run ends, the server hands back the cookies of the sites it was on
   (see _webJarIn in the Worker). They are kept here, in IndexedDB, sealed
   with AES-GCM under a key made in this browser as non-extractable - it can
   be used here and cannot be read out, by AMV or anybody else. AMV's servers
   never hold them: the next run from the same site gets them from here, uses
   them, and drops them when it ends.

   One store per SITE THE RUN STARTED ON, per account. A run started on one
   site carries only what runs started there collected - including the
   sign-in host that site sends people to - and never another site's. A
   second account on the same device has its own key and its own stores.
   The list, and Forget, are in Settings > Privacy.
   ══════════════════════════════════════════════════════════════════════ */
const _WJ_DB = 'amv-webjar';
function _wjDb(){
  return new Promise((res, rej) => {
    const r = indexedDB.open(_WJ_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function _wjDo(mode, fn){
  const db = await _wjDb();
  try{
    return await new Promise((res, rej) => {
      const tx = db.transaction('kv', mode); const st = tx.objectStore('kv');
      const req = fn(st);
      tx.oncomplete = () => res(req && req.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
  } finally { db.close(); }
}
const _wjGet = (k) => _wjDo('readonly', st => st.get(k));
const _wjPut = (k, v) => _wjDo('readwrite', st => st.put(v, k));
const _wjDel = (k) => _wjDo('readwrite', st => st.delete(k));
async function _wjAcct(){
  const em = String((typeof S !== 'undefined' && S.user && S.user.email) || '').toLowerCase();
  if(!em) return '';
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('amv-webjar:' + em));
  return [...new Uint8Array(h)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function _wjKey(acct){
  let k = await _wjGet('key:' + acct);
  if(k) return k;
  k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await _wjPut('key:' + acct, k);
  return k;
}
function _wjSite(url){ try{ return new URL(url).hostname.toLowerCase(); }catch(e){ return ''; } }
const _wjLive = (c) => !(+c.expires > 0 && +c.expires * 1000 < Date.now());
/* The sign-ins kept for runs started on `site`, unsealed, still in date. */
async function _webJarLoad(site){
  try{
    const acct = await _wjAcct(); if(!acct || !site) return [];
    const rec = await _wjGet('jar:' + acct + ':' + site); if(!rec) return [];
    const key = await _wjKey(acct);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, key, rec.ct);
    return (JSON.parse(new TextDecoder().decode(plain)) || []).filter(_wjLive);
  }catch(e){ return []; }
}
/* What a run handed back, merged over what was kept and sealed again. */
async function _webJarSave(site, cookies){
  try{
    const acct = await _wjAcct(); if(!acct || !site || !Array.isArray(cookies) || !cookies.length) return false;
    const have = await _webJarLoad(site);
    const id = (c) => c.name + '\u0000' + c.domain + '\u0000' + c.path;
    const merged = new Map(have.map(c => [id(c), c]));
    for(const c of cookies) merged.set(id(c), c);
    const list = [...merged.values()].filter(_wjLive).slice(-300);
    const key = await _wjKey(acct);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(list)));
    await _wjPut('jar:' + acct + ':' + site, { iv, ct });
    const idx = (await _wjGet('sites:' + acct)) || {};
    idx[site] = { at: Date.now(), n: list.length };
    await _wjPut('sites:' + acct, idx);
    return true;
  }catch(e){ return false; }
}
async function _webJarSites(){
  const acct = await _wjAcct(); if(!acct) return [];
  const idx = (await _wjGet('sites:' + acct)) || {};
  return Object.keys(idx).sort().map(site => Object.assign({ site }, idx[site]));
}
async function _webJarForget(site){
  const acct = await _wjAcct(); if(!acct) return;
  if(site){ await _wjDel('jar:' + acct + ':' + site); const idx = (await _wjGet('sites:' + acct)) || {}; delete idx[site]; await _wjPut('sites:' + acct, idx); return; }
  for(const s of await _webJarSites()) await _wjDel('jar:' + acct + ':' + s.site);
  await _wjDel('sites:' + acct);
}
/* Settings > Privacy: where AMV's browser is signed in, and Forget. */
async function _webJarPane(el){
  _wlvCss();
  const sites = await _webJarSites();
  el.innerHTML = '<h3>' + escH(T('Signed in on AMV\u2019s browser')) + '</h3>'
    + '<p class="set-sub">' + escH(T('Sites you or AMV signed in to during a web run. The sign-ins are kept encrypted on this device only, and used again the next time AMV works on that site.')) + '</p>'
    + (sites.length
      ? '<ul class="wj-list">' + sites.map(x => '<li class="wj-row"><span class="wj-site">' + escH(x.site) + '</span>'
          + '<button class="btn bs" type="button" data-wj-forget="' + escH(x.site) + '">' + escH(T('Forget')) + '</button></li>').join('') + '</ul>'
        + '<button class="btn bs" type="button" data-wj-forget="">' + escH(T('Forget all')) + '</button>'
      : '<p class="wj-none">' + escH(T('None yet.')) + '</p>');
  el.querySelectorAll('[data-wj-forget]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    await _webJarForget(b.getAttribute('data-wj-forget'));
    toast(T('Forgotten. AMV\u2019s browser will ask that site to sign in again.'), 'success', 5000);
    _webJarPane(el);
  }));
}
try{
  Object.assign(window, { _webLiveOpen, _webJarLoad, _webJarSave, _webJarSites, _webJarForget, _webJarPane, _wjSite });
}catch(e){}
