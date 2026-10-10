/* GOOGLE'S FILE PICKER, FOR ONE FILE, IN A WINDOW OF ITS OWN.

   AMV edits Google Docs and Sheets on drive.file, which reaches only the files
   AMV made and the ones somebody CHOSE for it in Google's picker. This window
   is that choice. It signs in with Google for drive.file alone (its own short
   token, kept in this window and gone when it closes - the server's sealed
   grant is never here), shows Google's picker for Docs and Sheets, and posts
   the chosen file's id, name and type to the AMV window that opened it, at
   AMV's own origin and nowhere else.

   The settings arrive in the address's fragment from the app, which fetched
   them from /v1/google/picker: a client id, a browser key and a project
   number, all public by design. */
(function(){
  'use strict';
  var say = function(t){ var p = document.getElementById('say'); if(p) p.textContent = t; };
  var send = function(msg){
    try{ if(window.opener) window.opener.postMessage(Object.assign({ amvPicker: true }, msg), location.origin); }catch(e){}
  };
  var finish = function(msg){ send(msg); setTimeout(function(){ window.close(); }, 50); };

  var cfg = {};
  try{ cfg = JSON.parse(decodeURIComponent(atob(location.hash.slice(1)))); }catch(e){}
  if(!cfg.clientId || !cfg.apiKey || !/^\d{6,20}$/.test(String(cfg.appId || ''))){
    say('This window needs to be opened from AMV.');
    return;
  }
  var load = function(src){ return new Promise(function(ok, no){
    var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); };

  window.addEventListener('beforeunload', function(){ send({ cancelled: true }); });

  Promise.all([load('https://apis.google.com/js/api.js'), load('https://accounts.google.com/gsi/client')]).then(function(){
    window.gapi.load('picker', function(){
      var tc = window.google.accounts.oauth2.initTokenClient({
        client_id: cfg.clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        login_hint: cfg.hint || undefined,
        callback: function(resp){
          if(!resp || !resp.access_token){ say('Google did not sign in, so no file was chosen.'); finish({ cancelled: true }); return; }
          var P = window.google.picker;
          var docs = new P.DocsView(P.ViewId.DOCUMENTS).setMode(P.DocsViewMode.LIST);
          var sheets = new P.DocsView(P.ViewId.SPREADSHEETS).setMode(P.DocsViewMode.LIST);
          new P.PickerBuilder()
            .addView(docs).addView(sheets)
            .setOAuthToken(resp.access_token)
            .setDeveloperKey(cfg.apiKey)
            .setAppId(cfg.appId)
            .setTitle('Choose one file for AMV')
            .setCallback(function(data){
              var a = data[P.Response.ACTION];
              if(a === P.Action.PICKED){
                var d = (data[P.Response.DOCUMENTS] || [])[0] || {};
                finish({ fileId: String(d[P.Document.ID] || ''), name: String(d[P.Document.NAME] || ''),
                         mimeType: String(d[P.Document.MIME_TYPE] || '') });
              } else if(a === P.Action.CANCEL){
                finish({ cancelled: true });
              }
            })
            .build().setVisible(true);
          say('Choose the file in Google’s window.');
        },
      });
      tc.requestAccessToken({ prompt: '' });
    });
  }, function(){
    say('Google’s file picker could not load. Check the connection and try again.');
    send({ error: 'load_failed' });
  });
})();
