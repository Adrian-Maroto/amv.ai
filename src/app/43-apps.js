/* ══════════════════════════════════════════════════════════════════════
   AMV ON A PHONE AND A COMPUTER.

   AMV installs as an app wherever the platform allows a web app to be one:
   Chrome and Edge on every desktop, Android, iPhone and iPad from the Share
   menu, Safari on a Mac from File > Add to Dock. The install prompt only
   exists where the browser offers it, so where it does not - every iPhone -
   this says the two taps instead of saying nothing.

   Installed, it is in the phone's share sheet (manifest share_target): share
   a page, a message or a link to AMV and it opens a new chat with it in the
   box. It is NEVER sent by itself - something shared from another app is not
   an instruction, it is material for one.

   And the icon's own menu (manifest shortcuts) opens a new chat, Crew or
   Connectors directly.

   Store listings are the owner's to unlock (GO-LIVE.md, "Phone and desktop
   apps"): the links below are empty until a listing exists, and an empty
   link is not shown.
   ══════════════════════════════════════════════════════════════════════ */

/* Filled in when a listing is live. Never shown empty. */
const APP_STORE_LINKS = { play: '', microsoft: '' };

/* What a launch from outside asked for, read from the address: something
   shared into AMV, or the icon's "New chat". Pure, so it can be checked. */
function _launchIntent(search){
  let q;
  try{ q = new URLSearchParams(search || ''); }catch(e){ return null; }
  const parts = ['title', 'text', 'url'].map(k => String(q.get(k) || '').trim()).filter(Boolean);
  if(parts.length){
    /* A shared link usually arrives twice - once as the url and again inside
       the text - so a part already contained in another is dropped. */
    const kept = [];
    for(const p of parts){
      if(kept.some(k => k.includes(p))) continue;
      for(let i = kept.length - 1; i >= 0; i--) if(p.includes(kept[i])) kept.splice(i, 1);
      kept.push(p);
    }
    return { kind: 'share', text: kept.join('\n\n').slice(0, 20000) };
  }
  if(q.get('new') === '1') return { kind: 'new' };
  return null;
}
try{ window._launchIntent = _launchIntent; }catch(e){}

/* Read once, at load, and taken out of the address at once: a reload must
   not open a second chat, and the shared text should not sit in the history
   bar. Kept in this tab's session until the app is open to receive it - a
   share that arrives before sign-in is still there after it. */
(function _stashLaunchIntent(){
  try{
    const it = _launchIntent(location.search);
    const q = new URLSearchParams(location.search);
    /* ?open=1 is the address a file opened from the computer arrives on;
       the file itself comes through launchQueue, below. */
    if(!it && !q.has('open')) return;
    if(it) sessionStorage.setItem('amv_launch', JSON.stringify(it));
    ['title', 'text', 'url', 'new', 'open'].forEach(k => q.delete(k));
    history.replaceState(history.state, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  }catch(e){}
})();

/* FROM AMV FOR CHROME. The extension opens AMV with ?amvext=1 and its one
   script on this page posts what the person chose - a selection, a page, a
   link - straight to this window. Accepted only from this window itself,
   only in a tab the extension opened, and only as material: it becomes the
   same new-chat-with-it-in-the-box as a share from the phone, never a send. */
window.addEventListener('message', (e) => {
  const d = e && e.data;
  if(e.source !== window || e.origin !== location.origin || !d || d.amvExtShare !== 1) return;
  let q;
  try{ q = new URLSearchParams(location.search); }catch(err){ return; }
  if(q.get('amvext') !== '1') return;
  q.delete('amvext');
  try{ history.replaceState(history.state, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); }catch(err){}
  const it = _launchIntent('?' + new URLSearchParams({ title: String(d.title || ''), text: String(d.text || ''), url: String(d.url || '') }));
  if(!it || it.kind !== 'share') return;
  try{ sessionStorage.setItem('amv_launch', JSON.stringify(it)); }catch(err){ return; }
  try{ if(S.user && S.user.email) _applyLaunchIntent(); }catch(err){}
});

/* OPEN WITH AMV. The installed app is offered by the computer for the files
   AMV reads (manifest file_handlers); the browser hands the opened files to
   launchQueue. They become a new chat with the file attached, through the
   same door as the paperclip - read, refused by name, a Word file held for
   editing - and NEVER sent by themselves. Before sign-in they wait for it,
   in this tab's memory only. */
let _launchFiles = null;
try{
  if(window.launchQueue && typeof window.launchQueue.setConsumer === 'function'){
    window.launchQueue.setConsumer(async (params) => {
      const handles = Array.from((params && params.files) || []).slice(0, 10);
      if(!handles.length) return;
      const files = [];
      for(const h of handles){ try{ if(h && h.kind !== 'directory' && typeof h.getFile === 'function') files.push(await h.getFile()); }catch(e){} }
      if(!files.length){ toast(T('The file you opened could not be read. Attach it from inside AMV instead.'), 'error', 8000); return; }
      _launchFiles = files;
      let signedIn = false;
      try{ signedIn = !!(S.user && S.user.email); }catch(e){}
      if(signedIn) _applyLaunchFiles();
      else toast(T('Sign in and the file you opened will be waiting in a new chat.'), 'info', 8000);
    });
  }
}catch(e){}
function _applyLaunchFiles(){
  if(!_launchFiles) return false;
  try{ if(!(S.user && S.user.email)) return false; }catch(e){ return false; }
  const files = _launchFiles; _launchFiles = null;
  newChat();
  handleFiles(files);
  toast(T('Opened in a new chat. Say what you want done with it, then send.'), 'info', 6000);
  return true;
}
try{ window._applyLaunchFiles = _applyLaunchFiles; }catch(e){}

/* Called once the app is open. */
function _applyLaunchIntent(){
  /* Only into an account. The app starts once before anybody is signed in
     and again after - applied on the first start, the chat it made was left
     behind by the second. Held until there is someone to give it to. */
  try{ if(!(S.user && S.user.email)) return; }catch(e){ return; }
  let it = null;
  try{ it = JSON.parse(sessionStorage.getItem('amv_launch') || 'null'); sessionStorage.removeItem('amv_launch'); }catch(e){}
  /* A file opened from the computer is the more specific ask; the address
     it arrived on (?open=1) carries nothing else. */
  if(_applyLaunchFiles()) return;
  if(!it) return;
  newChat();
  if(it.kind !== 'share') return;
  const box = $('mta'); if(!box) return;
  box.value = String(it.text || '');
  box.dispatchEvent(new Event('input', { bubbles: true }));
  /* Saved as this chat's draft too, so the screen being drawn again on the way
     in - which start-up does - puts it back rather than emptying the box. */
  try{ _draftSave(box.value); }catch(e){}
  try{ box.focus(); }catch(e){}
  toast(T('Shared into a new chat. Say what you want done with it, then send.'), 'info', 6000);
}
try{ window._applyLaunchIntent = _applyLaunchIntent; }catch(e){}

/* Which device this is, as far as installing goes. */
function _appPlatform(){
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if(ios) return 'ios';
  if(/Android/.test(ua)) return 'android';
  if(/Firefox\//.test(ua)) return 'firefox';
  if(/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'mac-safari';
  return 'desktop';
}
function _appInstalled(){
  try{ return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }catch(e){ return false; }
}
try{ window._appPlatform = _appPlatform; window._appInstalled = _appInstalled; }catch(e){}

/* THE HELP CARD. Says the one thing that is true for this device. */
function _appsCardHTML(){
  const p = _appPlatform();
  let how;
  if(_appInstalled()) how = '<p class="apps-now">' + escH(T('You are using the AMV app.')) + '</p>';
  else if(window._amvInstallEvt) how = '<button class="btn bp" type="button" id="apps-install">' + escH(T('Install AMV')) + '</button>';
  else how = '<p class="apps-how">' + escH(T(({
    ios: 'Tap Share, then Add to Home Screen. AMV opens like any other app, full screen.',
    android: 'Open your browser’s menu and choose Install app (or Add to Home screen).',
    'mac-safari': 'In Safari, choose File, then Add to Dock.',
    firefox: 'Firefox does not install web apps. Open AMV in Chrome, Edge or Safari to install it.',
    desktop: 'Use the install button at the right end of the address bar, or your browser’s menu: Install AMV.',
  })[p])) + '</p>';
  const stores = [
    APP_STORE_LINKS.play && '<a class="btn bs" href="' + escH(safeUrl(APP_STORE_LINKS.play)) + '" target="_blank" rel="noopener noreferrer">Google Play</a>',
    APP_STORE_LINKS.microsoft && '<a class="btn bs" href="' + escH(safeUrl(APP_STORE_LINKS.microsoft)) + '" target="_blank" rel="noopener noreferrer">Microsoft Store</a>',
  ].filter(Boolean).join('');
  return '<div class="ss2 apps-card" id="apps-card"><h3>' + escH(T('AMV on your phone and computer')) + '</h3>' + how +
    '<ul class="apps-gets">' +
      '<li>' + escH(T('Opens in its own window, without the browser around it.')) + '</li>' +
      '<li>' + escH(T('Share a page, message or link from another app into AMV.')) + '</li>' +
      '<li>' + escH(T('Hold the icon to start a new chat or open Crew.')) + '</li>' +
      /* Only where the installed app is offered "Open with" - Chrome and Edge on a computer. */
      (p === 'desktop' ? '<li>' + escH(T('On a computer, open a Word, Excel, PowerPoint, PDF or text file with AMV and it arrives in a new chat.')) + '</li>' : '') +
    '</ul>' + (stores ? '<div class="apps-stores">' + stores + '</div>' : '') + '</div>';
}
function _appsCardWire(){
  const b = $('apps-install'); if(!b) return;
  on(b, 'click', async () => {
    const ev = window._amvInstallEvt; if(!ev) return;
    ev.prompt();
    try{ await ev.userChoice; }catch(e){}
    window._amvInstallEvt = null;
    const card = $('apps-card'); if(card) card.outerHTML = _appsCardHTML();
  });
}
try{ window._appsCardHTML = _appsCardHTML; window._appsCardWire = _appsCardWire; }catch(e){}

/* AN IPHONE NEVER OFFERS TO INSTALL. So, once, it is said - not on the first
   visit, which is for seeing what AMV is, and never again once dismissed or
   installed. */
function _iosInstallHint(){
  try{
    if(_appPlatform() !== 'ios' || _appInstalled()) return;
    if(loadStr('amv_install_dismissed') === '1' || document.getElementById('amv-install-chip')) return;
    const n = (parseInt(loadStr('amv_visits') || '0', 10) || 0) + 1;
    saveStr('amv_visits', String(n));
    if(n < 2) return;
    const chip = document.createElement('div'); chip.id = 'amv-install-chip'; chip.className = 'install-chip';
    chip.innerHTML = '<span>' + escH(T('Add AMV to your Home Screen: tap Share, then Add to Home Screen.')) + '</span>'
      + '<button id="ic-no" aria-label="' + escH(T('Dismiss')) + '">×</button>';
    document.body.appendChild(chip);
    setTimeout(() => chip.classList.add('show'), 50);
    on($('ic-no'), 'click', () => { saveStr('amv_install_dismissed', '1'); chip.remove(); });
  }catch(e){}
}
try{ window._iosInstallHint = _iosInstallHint; }catch(e){}
