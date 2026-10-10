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
    if(!it) return;
    sessionStorage.setItem('amv_launch', JSON.stringify(it));
    const q = new URLSearchParams(location.search);
    ['title', 'text', 'url', 'new'].forEach(k => q.delete(k));
    history.replaceState(history.state, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  }catch(e){}
})();

/* Called once the app is open. */
function _applyLaunchIntent(){
  /* Only into an account. The app starts once before anybody is signed in
     and again after - applied on the first start, the chat it made was left
     behind by the second. Held until there is someone to give it to. */
  try{ if(!(S.user && S.user.email)) return; }catch(e){ return; }
  let it = null;
  try{ it = JSON.parse(sessionStorage.getItem('amv_launch') || 'null'); sessionStorage.removeItem('amv_launch'); }catch(e){}
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
    APP_STORE_LINKS.play && '<a class="btn bs" href="' + escH(safeUrl(APP_STORE_LINKS.play)) + '" target="_blank" rel="noopener">Google Play</a>',
    APP_STORE_LINKS.microsoft && '<a class="btn bs" href="' + escH(safeUrl(APP_STORE_LINKS.microsoft)) + '" target="_blank" rel="noopener">Microsoft Store</a>',
  ].filter(Boolean).join('');
  return '<div class="ss2 apps-card" id="apps-card"><h3>' + escH(T('AMV on your phone and computer')) + '</h3>' + how +
    '<ul class="apps-gets">' +
      '<li>' + escH(T('Opens in its own window, without the browser around it.')) + '</li>' +
      '<li>' + escH(T('Share a page, message or link from another app into AMV.')) + '</li>' +
      '<li>' + escH(T('Hold the icon to start a new chat or open Crew.')) + '</li>' +
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
