/* Runs on AMV's own address and nowhere else (the manifest's one match). If
   this tab was opened by the extension, it asks for what it was opened with
   and hands it to the page - which puts it in a new chat's box and sends
   nothing. */
if(new URLSearchParams(location.search).get('amvext') === '1'){
  chrome.runtime.sendMessage({ amv: 'share?' }, (s) => {
    if(chrome.runtime.lastError || !s) return;
    window.postMessage({ amvExtShare: 1, title: s.title || '', url: s.url || '', text: s.text || '' }, location.origin);
  });
}
