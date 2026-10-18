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
  const cli = document.getElementById('ak-cli');
  if(cli) on(cli, 'click', async () => { cli.disabled = true; try{ await _cliDownload(); } finally{ cli.disabled = false; } });
  const vsx = document.getElementById('ak-vsix');
  if(vsx) on(vsx, 'click', async () => { vsx.disabled = true; try{ await _vsixDownload(); } finally{ vsx.disabled = false; } });
  const crx = document.getElementById('ak-chrome');
  if(crx) on(crx, 'click', async () => { crx.disabled = true; try{ await _chromeDownload(); } finally{ crx.disabled = false; } });

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
    /* data-keep-open: Escape must not take the only copy of this away. The
       comment below this function has always claimed it does not close by
       accident; this is what makes that true. */
    '<div class="share-modal" data-keep-open>'+
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
  /* Each paragraph is one whole sentence with its code in numbered slots.
     It was English pieces around <code> tags, and a page translated piece by
     piece can only ever come out half-English. The slots are filled after the
     sentence is translated, so code stays code in every language. */
  const t = (s, codes) => escH(T(s)).replace(/\{(\d+)\}/g, (m, i) => codes && codes[+i] != null ? '<code>' + escH(codes[+i]) + '</code>' : m);
  return '<div class="ss2"><h3>'+escH(T('Making a call'))+'</h3>'+
    '<p class="ak-doc">'+t('The same endpoint the app uses. Your key goes in the Authorization header - never in a query string, where it would end up in logs and browser history.')+'</p>'+
    '<pre class="ak-code"><code>'+escH(curl)+'</code></pre>'+
    '<p class="ak-doc"><b>'+t('This endpoint always streams.')+'</b> '+
      t('The response is {0} - a sequence of {1} lines carrying {2} events, ending in {3}. Read the body as a stream and parse each event; calling {4} on it will fail.',
        ['text/event-stream', 'data:', 'content_block_delta', 'message_stop', '.json()'])+' '+
      t('Sending {0} is refused with {1} rather than silently ignored, so you find out immediately rather than from a parse error.', ['"stream": false', 'stream_required'])+'</p>'+
    '<p class="ak-doc">'+t('Engines: {0} (fastest), {1} (balanced), {2} (a top engine at its fastest), {3} (deep work), {4} (hardest problems), or {5} to let AMV choose.',
        ['amv-pulse', 'amv-core', 'amv-swift', 'amv-forge', 'amv-apex', 'auto'])+'</p>'+
    '<p class="ak-doc">'+escH(T('Usage counts against this account\u2019s plan, so the limits in {0} are the limits your integration has.')).replace('{0}', () => '<b>' + escH(T('Settings -> Plan & billing')) + '</b>')+'</p>'+
    '<p class="ak-doc"><b>'+t('Counting before sending.')+'</b> '+
      t('{0} takes the same {1}, {2}, {3} and {4} and answers {5} - counted on what AMV would really send, its own instructions included, so it matches what is billed. Free: nothing is generated and nothing counts against the plan.',
        ['POST /v1/messages/count_tokens', 'model', 'system', 'messages', 'tools', '{"input_tokens": n}'])+'</p>'+
    '<p class="ak-doc"><b>'+t('Batches.')+'</b> '+
      t('{0} with up to 100 {1} requests; AMV answers them in the background, starting within five minutes - anything not answered within 24 hours is marked expired and not charged. Then {2}, {3} (one JSON line per request) and {4}, each with {5}, and {6}. Each request is charged exactly as if it were sent on its own.',
        ['POST /v1/messages/batches', '{"custom_id", "params"}', '/get', '/results', '/cancel', '{"id"}', '/list'])+'</p>'+
  '</div>'+
  /* FROM A TERMINAL. One file with nothing to install, handed over the way
     the bridge is - from this deployment, with this deployment's address
     written into it at download, so the only thing left to set is the key. */
  '<div class="ss2"><h3>'+escH(T('From a terminal'))+'</h3>'+
    '<p class="ak-doc">'+t('One file, nothing to install - it needs Node 18 or newer. It downloads with this AMV\u2019s address already in it. Your key goes in an environment variable, never on the command line, where it would be saved in your shell history.')+'</p>'+
    '<pre class="ak-code"><code>'+escH('export AMV_API_KEY=amv_sk_...\n'+
      'node amv-cli.mjs "Summarise this week\'s notes"\n'+
      'cat notes.txt | node amv-cli.mjs "Turn these into an email"\n'+
      'node amv-cli.mjs chat\n'+
      'node amv-cli.mjs code "make the tests pass"')+'</code></pre>'+
    '<p class="ak-doc">'+escH(T('{0} works on the files in the folder you start it in: it reads freely, but shows every change and every command and asks before each one, and offers to put everything back at the end.')).replace('{0}', '<code>code</code>')+'</p>'+
    '<button class="btn bs" id="ak-cli" type="button">'+escH(T('Download {0}')).replace('{0}', 'amv-cli.mjs')+'</button>'+
  '</div>'+
  /* IN VS CODE. The same handover: packed here, in this browser, with this
     deployment's address in it, so the only thing to set is the key - which
     the extension keeps in the system keychain, not in settings.json. */
  '<div class="ss2"><h3>'+escH(T('In VS Code'))+'</h3>'+
    '<p class="ak-doc">'+escH(T('Ask about the code you have open, or select lines and have AMV change them. Every change is shown as a diff first and applied only when you press Apply.'))+'</p>'+
    '<p class="ak-doc">'+escH(T('In VS Code open Extensions, choose {0} from its menu, pick the file, then run {1} and paste a key.'))
      .replace('{0}', '<b>'+escH(T('Install from VSIX'))+'</b>').replace('{1}', '<code>AMV: Set API key</code>')+'</p>'+
    '<button class="btn bs" id="ak-vsix" type="button">'+escH(T('Download {0}')).replace('{0}', 'amv.vsix')+'</button>'+
  '</div>'+
  /* IN CHROME. Needs no key at all: it only opens AMV with what you chose. */
  '<div class="ss2"><h3>'+escH(T('In Chrome'))+'</h3>'+
    '<p class="ak-doc">'+escH(T('Ask AMV about a page, a selection or a link from the right-click menu or the toolbar. It opens AMV with it in a new chat and sends nothing on its own. It needs no key and can read a page only when you press it there.'))+'</p>'+
    '<p class="ak-doc">'+escH(T('Until it is in the Chrome Web Store, add it yourself: unzip it, open chrome://extensions, turn on Developer mode, then Load unpacked.'))+'</p>'+
    '<button class="btn bs" id="ak-chrome" type="button">'+escH(T('Download {0}')).replace('{0}', 'amv-chrome.zip')+'</button>'+
  '</div>';
}

/* ── A VS CODE EXTENSION, PACKED IN THE BROWSER ───────────────────────────
   A .vsix is a zip: the extension's own files under extension/, a manifest,
   and a content-types list. Written here, uncompressed, with a CRC for each
   file - VS Code checks them - so the address can be filled in without a
   build step on the server. */
const VSIX_SRC = { pkg: 'amv-vscode.json', js: 'amv-vscode.js' };
function _crc32(bytes){
  let t = _crc32.t;
  if(!t){ t = _crc32.t = new Uint32Array(256); for(let n = 0; n < 256; n++){ let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } }
  let c = 0xFFFFFFFF;
  for(let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function _zipStored(files){
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for(const f of files){
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = _crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]), { type: 'application/zip' });
}
async function _vsixFiles(base){
  const get = async (f) => { const r = await fetchDeadline(f, { cache: 'no-store' }, 15000); if(!r.ok) throw new Error('http_' + r.status); return await r.text(); };
  const [pkgText, js] = await Promise.all([get(VSIX_SRC.pkg), get(VSIX_SRC.js)]);
  const pkg = JSON.parse(pkgText);
  if(pkg.name !== 'amv' || js.indexOf("require('vscode')") < 0) throw new Error('not_the_extension');
  pkg.contributes.configuration.properties['amv.server'].default = base;
  const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const manifest = '<?xml version="1.0" encoding="utf-8"?>\n'
    + '<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">'
    + '<Metadata><Identity Language="en-US" Id="' + x(pkg.name) + '" Version="' + x(pkg.version) + '" Publisher="' + x(pkg.publisher) + '"/>'
    + '<DisplayName>' + x(pkg.displayName) + '</DisplayName><Description xml:space="preserve">' + x(pkg.description) + '</Description>'
    + '<Categories>' + x(pkg.categories.join(',')) + '</Categories>'
    + '<Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="' + x(pkg.engines.vscode) + '"/></Properties></Metadata>'
    + '<Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/>'
    + '<Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>';
  const types = '<?xml version="1.0" encoding="utf-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/>'
    + '<Default Extension=".vsixmanifest" ContentType="text/xml"/></Types>';
  return [
    { name: '[Content_Types].xml', data: types },
    { name: 'extension.vsixmanifest', data: manifest },
    { name: 'extension/package.json', data: JSON.stringify(pkg, null, 2) },
    { name: 'extension/extension.js', data: js },
  ];
}
async function _vsixDownload(){
  const base = String(apiBase() || '').replace(/\/$/, '');
  if(!/^https:\/\/[^\s"'\\]+$/.test(base)){
    try{ toast(T('This copy of AMV is not connected to its server, so the extension would have nowhere to send questions.'), 'error', 7000); }catch(e){}
    return false;
  }
  let blob;
  try{ blob = _zipStored(await _vsixFiles(base)); }
  catch(e){
    try{ toast(T('AMV could not fetch the VS Code extension from this deployment. Try again in a moment.'), 'error', 7000); }catch(x){}
    return false;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'amv.vsix';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => { try{ URL.revokeObjectURL(url); }catch(e){} }, 4000);
  try{ toast(T('Saved amv.vsix. In VS Code: Extensions, Install from VSIX, then run AMV: Set API key.'), 'success', 8000); }catch(e){}
  return true;
}

/* ── AMV FOR CHROME, PACKED IN THE BROWSER ───────────────────────────────
   A zip of the extension's folder with THIS app's own address written in -
   the page's origin, not the API's, because the extension opens AMV itself
   and its one script may run on AMV and nowhere else. It holds no key. */
const CHROME_SRC = { manifest: 'amv-chrome.json', bg: 'amv-chrome.js', share: 'amv-chrome-share.js', icon: 'icon-192.png' };
async function _chromeFiles(origin){
  const get = async (f, bin) => { const r = await fetchDeadline(f, { cache: 'no-store' }, 15000); if(!r.ok) throw new Error('http_' + r.status); return bin ? new Uint8Array(await r.arrayBuffer()) : await r.text(); };
  const [man, bg, share, icon] = await Promise.all([get(CHROME_SRC.manifest), get(CHROME_SRC.bg), get(CHROME_SRC.share), get(CHROME_SRC.icon, true)]);
  const m = JSON.parse(man);
  if(m.manifest_version !== 3 || bg.indexOf("const AMV = '__AMV_ORIGIN__'") < 0 || share.indexOf('amvExtShare') < 0) throw new Error('not_the_extension');
  m.content_scripts[0].matches = [origin + '/*'];
  return [
    { name: 'amv-chrome/manifest.json', data: JSON.stringify(m, null, 2) },
    { name: 'amv-chrome/background.js', data: bg.replace("const AMV = '__AMV_ORIGIN__'", 'const AMV = ' + JSON.stringify(origin)) },
    { name: 'amv-chrome/share.js', data: share },
    { name: 'amv-chrome/icon.png', data: icon },
  ];
}
async function _chromeDownload(){
  const origin = String(location.origin || '');
  /* A match pattern names a scheme and a host, and an extension pointed at a
     local copy would stop working the moment that copy moves. */
  if(!/^https:\/\/[A-Za-z0-9.-]+$/.test(origin)){
    try{ toast(T('The Chrome extension is made for AMV at its own https address, and this copy is not at one.'), 'error', 7000); }catch(e){}
    return false;
  }
  let blob;
  try{ blob = _zipStored(await _chromeFiles(origin)); }
  catch(e){
    try{ toast(T('AMV could not fetch the Chrome extension from this deployment. Try again in a moment.'), 'error', 7000); }catch(x){}
    return false;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'amv-chrome.zip';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => { try{ URL.revokeObjectURL(url); }catch(e){} }, 4000);
  try{ toast(T('Saved amv-chrome.zip. Unzip it, open chrome://extensions, turn on Developer mode, choose Load unpacked and pick the folder.'), 'success', 10000); }catch(e){}
  return true;
}

const CLI_FILE = 'amv-cli.mjs';
/* Fetched from this deployment, checked to be the tool, and saved with the
   address filled in. A copy of AMV with no server has nothing to give it,
   and says so rather than handing over a tool that cannot work. */
async function _cliDownload(){
  const base = String(apiBase() || '').replace(/\/$/, '');
  if(!/^https:\/\/[^\s"'\\]+$/.test(base)){
    try{ toast('This copy of AMV is not connected to its server, so the tool would have nowhere to send questions.', 'error', 7000); }catch(e){}
    return false;
  }
  let text;
  try{
    const r = await fetchDeadline(CLI_FILE, { cache: 'no-store' }, 15000);
    if(!r.ok) throw new Error('http_' + r.status);
    text = await r.text();
    if(!/^#!\/usr\/bin\/env node/.test(text) || text.indexOf("'__AMV_API__'") < 0) throw new Error('not_the_cli');
  }catch(e){
    try{ toast('AMV could not fetch the command-line tool from this deployment. Try again in a moment.', 'error', 7000); }catch(x){}
    return false;
  }
  text = text.replace("'__AMV_API__'", JSON.stringify(base));
  const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  const a = document.createElement('a');
  a.href = url; a.download = CLI_FILE;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => { try{ URL.revokeObjectURL(url); }catch(e){} }, 4000);
  try{ toast('Saved amv-cli.mjs. Set AMV_API_KEY to one of your keys, then run: node amv-cli.mjs "your question"', 'success', 8000); }catch(e){}
  return true;
}
/* AMV IN VS CODE: THE EXTENSION, AND THE FOLDER.

   There is a real extension now - packed in the browser from this deployment
   (Settings - API keys, `_vsixDownload` in api-keys.js) with its address
   already filled in, so the only thing to set in VS Code is a key. This used
   to say there was no extension, and before that it told people to install
   `@amv/cli` from npm: a package AMV never owned, so a name anybody could
   register. Neither may come back - the-apps-people-use-connect-first checks.

   The second road stays: connect your computer and AMV reads, edits and runs
   the whole project folder, every change measured from the disk with an Undo.
   The extension works on the file in front of you; the computer on the folder.
   Opened by `_devConnectVSCode` in 11b-code-workspace.js. */
function _vscDialog(){
  const r=$('ovr'); if(!r) return;
  r.innerHTML='<div class="ov" id="vsc-bg"><div class="tp-modal" role="dialog" aria-modal="true" aria-labelledby="vsc-t" style="max-width:480px">'+
    '<button class="dna-x" id="vsc-x" aria-label="'+escH(T('Close'))+'" style="position:absolute;top:14px;right:14px">\u2715</button>'+
    '<h2 id="vsc-t" style="font-family:var(--fdisplay);font-weight:500;font-size:var(--t-xl);margin:0 0 6px">'+escH(T('AMV in VS Code'))+'</h2>'+
    '<p style="font-size:var(--t-base);color:var(--mu);line-height:1.6;margin:0 0 12px">'+escH(T('Download the AMV extension and install it in VS Code. Ask about the code you have open, or select lines and have AMV change them - every change is shown as a diff and applied only when you press Apply.'))+'</p>'+
    '<p style="font-size:var(--t-sm);color:var(--dim);line-height:1.5;margin:0 0 18px">'+escH(T('It needs an API key, made under Settings - API keys. To have AMV work across a whole project folder instead, connect your computer.'))+'</p>'+
    '<p class="gui-form-err" id="vsc-err" role="alert" style="margin:0 0 12px"></p>'+
    '<div style="display:flex;gap:var(--sp-2);flex-wrap:wrap">'+
      '<button class="btn bp" id="vsc-get">'+escH(T('Download the extension'))+'</button>'+
      '<button class="btn bs" id="vsc-keys">'+escH(T('Make an API key'))+'</button>'+
      '<button class="btn bs" id="vsc-go">'+escH(T('Connect your computer'))+'</button>'+
    '</div>'+
  '</div></div>';
  const close=()=>{ r.innerHTML=''; };
  onBackdrop($('vsc-bg'),close); on($('vsc-x'),'click',close);
  on($('vsc-get'),'click',async()=>{
    const b=$('vsc-get'); b.disabled=true;
    try{
      const ok=await _apiKeysLoad();
      if(!ok){ $('vsc-err').textContent=T('The extension could not be loaded. Check your connection and try again.'); return; }
      if(await window._vsixDownload()) close();
    } finally { if(b.isConnected) b.disabled=false; }
  });
  on($('vsc-keys'),'click',()=>{ close(); goSettings('api'); });
  on($('vsc-go'),'click',()=>{
    close();
    try{ _connMachineOpen=true; }catch(e){}
    try{ setTab('integrations'); }catch(e){}
    try{ const d=document.querySelector('details.conn-machine'); if(d){ d.open=true; d.scrollIntoView({block:'start'}); } }catch(e){}
  });
}

try{ window._renderApiKeysPane=_renderApiKeysPane; window._apiLoad=_apiLoad; window._cliDownload=_cliDownload; window._vsixDownload=_vsixDownload; window._chromeDownload=_chromeDownload; window._chromeFiles=_chromeFiles; window._vscDialog=_vscDialog; }catch(e){}
