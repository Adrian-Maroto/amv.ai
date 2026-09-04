/* ============================================================
   AMV-097  API KEYS - the screen.

   The whole design rests on one property: the key exists exactly once, in the
   response to the request that created it. The server stores only a hash and
   genuinely cannot show it again. That makes this screen's job unusual - it has
   to make sure the user copies the value NOW, and it must never imply the key
   can be retrieved later, because it cannot.

   So the new key is shown once, in full, with the copy control next to it and
   a plain sentence saying it will not be shown again. Everything after that is
   the last four characters, which is enough to recognise a key and useless to
   anyone who steals the list.
   ============================================================ */

function _apiWhen(ts){
  if(!ts) return 'never';
  const diff = Date.now() - ts;
  if(diff < 3600000) return Math.max(1, Math.floor(diff/60000)) + ' min ago';
  if(diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
  try{ return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }
  catch(e){ return ''; }
}

function _renderApiKeysPane(pane){
  pane.innerHTML =
    '<h2 class="set-title">API keys</h2>'+
    '<div class="set-sub">Use AMV from your own code. A key spends this account\u2019s plan - the same limits, '+
      'the same monthly ceiling, the same protections. Nothing separate to watch.</div>'+
    '<div class="ss2" id="api-body"><div class="ak-load">Loading your keys\u2026</div></div>'+
    _apiDocsHTML();

  const body = document.getElementById('api-body');
  if(!(window.AMV_API && AMV_API.live && AMV_API.hasSession)){
    body.innerHTML = '<div class="ak-off">API keys live on your AMV account. Sign in and they appear here.</div>';
    return;
  }
  _apiLoad();
}

async function _apiLoad(){
  const body = document.getElementById('api-body'); if(!body) return;
  try{
    const d = await AMV_API.keysList();
    if(!d || !d.ok){ body.innerHTML = '<div class="ak-off">Could not load your keys just now.</div>'; return; }
    _apiPaint(body, d);
  }catch(e){
    body.innerHTML = '<div class="ak-off">Could not reach the server, so this would be out of date.</div>';
  }
}

function _apiPaint(host, d){
  const live = (d.keys||[]).filter(k=>!k.revoked);
  const rows = (d.keys||[]).map(k=>
    '<div class="ak-row'+(k.revoked?' ak-dead':'')+'">'+
      '<div class="ak-main">'+
        '<div class="ak-name">'+escH(k.name||'API key')+(k.revoked?' <span class="ak-tag">revoked</span>':'')+'</div>'+
        '<div class="ak-meta">'+escH('amv_sk_' + '\u2026' + (k.last4||'????'))+
          ' · created '+escH(_apiWhen(k.created))+
          ' · last used '+escH(_apiWhen(k.lastUsed))+'</div>'+
      '</div>'+
      (k.revoked?'':'<button class="btn bs" type="button" data-ak-rev="'+escH(k.id)+'">Revoke</button>')+
    '</div>').join('');

  host.innerHTML =
    '<h3>Your keys</h3>'+
    (rows || '<div class="ak-off">No keys yet.</div>')+
    '<div class="ak-new">'+
      '<label class="sr-only" for="ak-name">Name for the new key</label>'+
      '<input id="ak-name" class="inp" placeholder="What is it for? e.g. production" maxlength="60">'+
      '<button class="btn bp" id="ak-create" type="button">Create key</button>'+
    '</div>'+
    '<div class="ak-say" id="ak-say" role="status" aria-live="polite"></div>'+
    '<div class="ak-fine">'+live.length+' of '+(d.max||10)+' active. A key is shown once when it is created - '+
      'AMV stores only a hash of it and cannot show it again.</div>';

  const say = (t, kind) => { const el=document.getElementById('ak-say'); if(el){ el.className='ak-say'+(kind?' '+kind:''); el.textContent=t; } };

  on(document.getElementById('ak-create'),'click', async ()=>{
    const name = (document.getElementById('ak-name')||{}).value || '';
    say('Creating\u2026');
    try{
      const d2 = await AMV_API.keyCreate(name);
      _apiShowOnce(d2.key);
      await _apiLoad();
    }catch(e){
      if(e.code === 'plan_required'){
        say(e.message, 'bad');
        try{ S.tab='plans'; setTab('plans'); }catch(_){}
        return;
      }
      say(e.message || 'Could not create a key.', 'bad');
    }
  });

  host.querySelectorAll('[data-ak-rev]').forEach(b=>on(b,'click', async ()=>{
    /* Revoking is immediate and cannot be undone - anything using this key
       stops working the moment it is confirmed, so it says that. */
    if(!await _askDestructive('Revoke this key?',
        'Anything using it stops working immediately, and it cannot be restored.',
        'Revoke key')) return;
    say('Revoking\u2026');
    const ok2 = await AMV_API.keyRevoke(b.dataset.akRev);
    say(ok2 ? 'Revoked.' : 'Could not revoke that key - nothing was changed.', ok2 ? '' : 'bad');
    if(ok2) _apiLoad();
  }));
}

/* The one moment the key exists outside the server's memory. Modal, explicit,
   and it does not close by accident. */
function _apiShowOnce(key){
  const ovr = document.getElementById('ovr'); if(!ovr) return;
  ovr.innerHTML =
    '<div class="share-modal">'+
      '<div class="share-title">Your new API key</div>'+
      '<p class="share-sub">Copy it now. AMV stores only a hash of this key and <b>cannot show it again</b> - '+
        'if you lose it, revoke it and make another.</p>'+
      '<div class="share-link-row"><input id="ak-val" class="inp" readonly value="'+escH(key)+'">'+
        '<button class="btn bp" id="ak-copy">Copy</button></div>'+
      '<div class="ak-say" id="ak-modal-say" role="status" aria-live="polite"></div>'+
      '<div class="share-actions"><button class="btn bs" id="ak-done">I have copied it</button></div>'+
    '</div>';
  ovr.classList.add('on');
  const say = t => { const el=document.getElementById('ak-modal-say'); if(el) el.textContent=t; };
  on(document.getElementById('ak-copy'),'click', async ()=>{
    try{ await navigator.clipboard.writeText(key); say('Copied.'); }
    catch(e){
      const f=document.getElementById('ak-val'); if(f){ f.focus(); f.select(); }
      say('Copy was blocked by your browser - the key is selected, press Ctrl+C or Cmd+C.');
    }
  });
  on(document.getElementById('ak-done'),'click',()=>{ try{ closeOvr(); }catch(e){} });
}

/* Enough to make the first call without leaving the page. */
function _apiDocsHTML(){
  const base = (apiBase()||'https://your-worker.workers.dev').replace(/\/$/,'');
  /* THE ONE SENTENCE THAT WAS WRONG WAS "Responses stream by default."

     There is no default about it. `/v1/messages` writes stream:true into its
     upstream body as a literal and returns text/event-stream on its only
     success path, whatever the caller asked for. "by default" told a developer
     the opposite of the truth - that stream:false was available - and the
     failure it leads to explains nothing: an SSE body handed to .json() is a
     parse error at their end with no message anywhere saying why. That is the
     exact trap of LESSONS 309, sold to somebody who cannot read that file.

     The server now refuses stream:false with a sentence instead of ignoring
     it. This says the same thing before they send anything, and the example
     asks for what it is going to get. --no-buffer, because without it curl
     holds the stream in its own buffer and the example looks like it hangs. */
  const curl =
    'curl --no-buffer ' + base + '/v1/messages \\\n' +
    '  -H "Authorization: Bearer amv_sk_..." \\\n' +
    '  -H "Content-Type: application/json" \\\n' +
    '  -d \'{"model":"amv-core","max_tokens":1024,"stream":true,\n' +
    '       "messages":[{"role":"user","content":"Hello"}]}\'';
  return '<div class="ss2"><h3>Making a call</h3>'+
    '<p class="ak-doc">The same endpoint the app uses. Your key goes in the Authorization header - '+
      'never in a query string, where it would end up in logs and browser history.</p>'+
    '<pre class="ak-code"><code>'+escH(curl)+'</code></pre>'+
    '<p class="ak-doc"><b>This endpoint always streams.</b> The response is '+
      '<code>text/event-stream</code> - a sequence of <code>data:</code> lines carrying '+
      '<code>content_block_delta</code> events, ending in <code>message_stop</code>. Read the body as a '+
      'stream and parse each event; calling <code>.json()</code> on it will fail. '+
      'Sending <code>"stream": false</code> is refused with <code>stream_required</code> rather than '+
      'silently ignored, so you find out immediately rather than from a parse error.</p>'+
    '<p class="ak-doc">Engines: <code>amv-pulse</code> (fastest), <code>amv-core</code> (balanced), '+
      '<code>amv-forge</code> (deep work), <code>amv-apex</code> (hardest problems), or '+
      '<code>auto</code> to let AMV choose.</p>'+
    '<p class="ak-doc">Usage counts against this account\u2019s plan, so the limits in '+
      '<b>Settings -> Usage</b> are the limits your integration has.</p>'+
  '</div>';
}
try{ window._renderApiKeysPane=_renderApiKeysPane; window._apiLoad=_apiLoad; }catch(e){}
