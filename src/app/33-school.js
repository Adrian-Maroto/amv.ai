/* ═══════════════════════════════════════════════════════════════════════════
   SCHOOL: THE ASSIGNMENT THAT SAYS "MAKE A COPY AND SHARE IT WITH ME".

   That instruction is most of secondary school. The doc is a template the
   teacher owns; the student is supposed to take their own copy, work in it, and
   share it back. Doing it by hand is four clicks and two menus, and it is the
   step people forget - a finished assignment shared with nobody is a zero.

   AMV could not do any of it, and could not even READ the assignment:

     - the old Canvas code called `yourschool.instructure.com` straight from the
       browser, and the page's Content-Security-Policy names every host AMV may
       reach. No school is on that list and none can be, because the host is
       different for every school. The browser refused before the request left.
       Canvas is read through the Worker now, which has no CSP;

     - and the description was run through `.replace(/<[^>]*>/g,' ')` before
       anything looked at it. That strips tags, and the doc lives inside one -
       so the single thing the assignment was about was deleted first. The links
       are pulled out and kept now.

   What happens here is deliberately not one button. A copy is harmless; sharing
   a document with a teacher is not something to do on somebody's behalf without
   asking, so it is asked, in the words of the thing being done, with the
   address shown. And AMV does not hand anything in: the student submits, which
   is the same line the Classroom scopes already draw. */

const SCHOOL_DOC_KINDS = { doc:'Google Doc', sheet:'Google Sheet', slides:'Slides deck', file:'file' };

/* The Google token the browser already holds. Drive is in the scopes AMV asks
   for at sign-in, and www.googleapis.com is in the page's connect-src, so this
   really can copy and share - it is not a stub waiting for an operator. */
/* Read from memory through getGToken rather than off disk, because the token
   is no longer on disk. Kept synchronous: every caller here is, and the one
   thing worse than asking for a reconnect is silently doing nothing. Somebody
   whose tab has not minted a token yet is told to try again rather than told
   they are disconnected, because those are different and only one is true. */
function _schoolGoogleToken(){
  const tok = (typeof getGToken === 'function') ? getGToken() : null;
  if(tok) return { ok:true, token:tok };
  const linked = (typeof _gHasGrant === 'function') && _gHasGrant();
  if(linked){
    /* Warm it for the next attempt, which is usually a second later. */
    try{ if(typeof refreshGToken === 'function') refreshGToken(); }catch(e){}
    return { ok:false, why:'AMV is reconnecting to your Google account. Give it a moment and try again.' };
  }
  return { ok:false, why:'Connect your Google account first, in Settings → Integrations. AMV needs it to make the copy in your own Drive.' };
}

/* Google's own words when it refuses, because "something went wrong" sends
   somebody to the wrong place. A missing scope and a deleted file are different
   problems with different fixes. */
async function _schoolDrive(path, init, token){
  let r;
  try{
    r = await fetchDeadline('https://www.googleapis.com/drive/v3/' + path, Object.assign({
      headers: Object.assign({ Authorization:'Bearer ' + token, 'Content-Type':'application/json' }, (init && init.headers) || {}),
    }, init || {}), 20000);
  }catch(e){
    throw new Error('AMV could not reach Google Drive just now. Check your connection and try again.');
  }
  const d = await r.json().catch(()=>({}));
  if(r.ok) return d;
  const msg = (d && d.error && d.error.message) || '';
  if(r.status === 401) throw new Error('Google says that sign-in has expired. Reconnect Google in Settings → Integrations.');
  if(r.status === 403 && /insufficient|scope/i.test(msg))
    throw new Error('Your Google connection does not include permission to create files in Drive. Disconnect and reconnect Google, and approve Drive access when it asks.');
  if(r.status === 403) throw new Error('Google refused: ' + (msg || 'you may not have access to that document.'));
  if(r.status === 404) throw new Error('That document is not shared with your Google account, so AMV cannot copy it. Open the assignment link once while signed in to your school account, then try again.');
  throw new Error(msg || ('Google Drive answered ' + r.status + '.'));
}

async function _schoolCopyDoc(fileId, title, token){
  const copy = await _schoolDrive('files/' + encodeURIComponent(fileId) + '/copy?fields=id,name,webViewLink',
    { method:'POST', body: JSON.stringify({ name: title }) }, token);
  return copy;
}
async function _schoolShareDoc(fileId, email, role, token){
  /* sendNotificationEmail: the teacher gets told, which is the point - a share
     nobody knows about is the same as no share. */
  await _schoolDrive('files/' + encodeURIComponent(fileId) + '/permissions?sendNotificationEmail=true',
    { method:'POST', body: JSON.stringify({ type:'user', role: role || 'writer', emailAddress: email }) }, token);
  return true;
}

/* ---- the flow ---------------------------------------------------------- */

async function schoolOpen(){
  const r = $('ovr'); if(!r) return;
  r.innerHTML =
    '<div class="ov" id="sch-bg"><div class="ob wide">'+
      '<button class="oc" data-dact="closeOvr">&#215;</button>'+
      '<h2>' + T('School work') + '</h2>'+
      '<p class="ob-sub">' + T('What is due, and the documents each assignment actually points at.') + '</p>'+
      '<div id="sch-body"><div class="sch-loading">' + T('Reading your assignments…') + '</div></div>'+
    '</div></div>';
  const bg = $('sch-bg');
  if(bg) on(bg, 'click', (e) => { if(e.target === e.currentTarget) closeOvr(); });
  await _schoolRender();
}

async function _schoolRender(){
  const body = $('sch-body'); if(!body) return;
  let d;
  try{ d = await AMV_API._wrote('/v1/school/work', {}, 'AMV could not read your school work.'); }
  catch(e){
    /* The server is the authority on whether a school is connected. When it
       says no, the local marker the Connectors list reads is wrong, so it goes
       - otherwise that list would keep showing "Connected" for a school this
       screen has just been refused by. */
    if(e.code === 'not_connected'){ try{ localStorage.removeItem(_scopeKey('amv_canvas')); }catch(_e){} }
    body.innerHTML = '<div class="sch-empty"><b>' + escH(e.message) + '</b>'+
      (e.code === 'not_connected'
        ? '<span>' + T('Connect your school below and this fills itself in.') + '</span>'+
          '<button class="btn bp sch-connect-cta" data-dact="schoolConnectOpen">' + T('Connect your school') + '</button>'
        : '') + '</div>';
    return;
  }
  const work = (d && d.work) || [];
  if(!work.length){
    body.innerHTML = '<div class="sch-empty"><b>' + T('Nothing is due.') + '</b><span>'+
      T('When your teachers post something, it appears here.') + '</span></div>';
    return;
  }
  _schoolWork = work;
  body.innerHTML = '<div class="sch-list">' + work.map((a, i) => {
    const due = a.dueAt ? new Date(a.dueAt).toLocaleDateString() : T('no due date');
    const docs = (a.docs || []).length;
    return '<div class="sch-item">'+
      '<div class="sch-item-main">'+
        '<b>' + escH(a.name || '') + '</b>'+
        '<span>' + escH(a.course || '') + ' · ' + escH(due) + '</span>'+
        (docs
          ? '<span class="sch-doc">' + docs + ' ' + T(docs === 1 ? 'attached document' : 'attached documents') + '</span>'
          : '<span class="sch-doc sch-doc-none">' + T('no document attached') + '</span>')+
      '</div>'+
      (docs ? '<button class="btn bp sch-go" data-dact="schoolPrepare" data-darg="' + i + '">' + T('Make my copy') + '</button>' : '')+
    '</div>';
  }).join('') + '</div>';
}
let _schoolWork = [];

/* Review, then copy, then ASK before sharing. Three steps because they are
   three different things, and only one of them involves another person. */
async function schoolPrepare(index){
  const a = _schoolWork[+index]; if(!a) return;
  const docs = a.docs || [];
  if(!docs.length){ toast(T('That assignment has no document attached.'), 'info'); return; }

  const g = _schoolGoogleToken();
  if(!g.ok){ toast(g.why, 'error', 7000); return; }

  const body = $('sch-body'); if(!body) return;
  /* An assignment often points at more than one document - the template you
     are meant to work in, and a rubric or an example you are not. Copying the
     first one and calling it "your copy" is the kind of quiet wrong answer
     that gets somebody a zero, so when there is a choice it is theirs. */
  const many = docs.length > 1;
  const kindOf = (d) => SCHOOL_DOC_KINDS[d.kind] || T('document');
  const picker = many
    ? '<div class="sch-pick">' + docs.map((d, i) =>
        '<label class="sch-pick-row"><input type="radio" name="sch-doc" value="' + i + '"' + (i === 0 ? ' checked' : '') + '>'+
          '<span class="sch-pick-k">' + escH(kindOf(d)) + '</span>'+
          '<a href="' + escH(safeUrl(d.url)) + '" target="_blank" rel="noopener noreferrer">' + T('open the original') + '</a>'+
        '</label>').join('') + '</div>'
    : '';

  body.innerHTML =
    '<div class="sch-step">'+
      '<h3>' + escH(a.name || '') + '</h3>'+
      '<p class="sch-course">' + escH(a.course || '') + '</p>'+
      '<div class="sch-instructions">' + escH((a.instructions || '').slice(0, 1200)) + '</div>'+
      '<div class="sch-ask">'+
        (many
          ? '<b>' + T('This assignment points at more than one document. Which one do you work in?') + '</b>' + picker
          : '<b>' + T('Make your own copy of the') + ' ' + escH(kindOf(docs[0])) + '?</b>')+
        '<span>' + T('The copy goes in your Google Drive. The teacher’s original is not touched.') + '</span>'+
        '<div class="sch-btns">'+
          '<button class="btn bp" id="sch-copy">' + T('Make my copy') + '</button>'+
          '<button class="btn bs" data-dact="_schoolRender">' + T('Back') + '</button>'+
        '</div>'+
      '</div>'+
    '</div>';

  const btn = $('sch-copy');
  if(!btn) return;
  on(btn, 'click', async () => {
    const picked = many
      ? (document.querySelector('input[name="sch-doc"]:checked') || {}).value
      : 0;
    const doc = docs[+picked || 0];
    if(!doc) return;
    btn.disabled = true; btn.textContent = T('Copying…');
    let copy;
    try{
      copy = await _schoolCopyDoc(doc.id, (a.name || 'Assignment'), g.token);
    }catch(e){
      btn.disabled = false; btn.textContent = T('Try again');
      const box = document.querySelector('.sch-ask');
      if(box) box.insertAdjacentHTML('beforeend', '<div class="sch-err">' + escH(e.message) + '</div>');
      return;
    }
    await _schoolAfterCopy(a, copy, g.token);
  });
}

/* The copy exists. Now the part that involves somebody else, so it is asked
   with the address visible rather than done and reported. */
async function _schoolAfterCopy(a, copy, token){
  const body = $('sch-body'); if(!body) return;
  const link = copy.webViewLink || ('https://docs.google.com/document/d/' + copy.id + '/edit');

  let teachers = [];
  try{
    const t = await AMV_API._wrote('/v1/school/teachers', { courseId: a.courseId }, '');
    teachers = (t && t.teachers) || [];
  }catch(e){ teachers = []; }

  body.innerHTML =
    '<div class="sch-step">'+
      '<div class="sch-done">' + T('Your copy is made.') + ' <a href="' + escH(safeUrl(link)) + '" target="_blank" rel="noopener noreferrer">' + T('Open it') + '</a></div>'+
      '<div class="sch-ask">'+
        '<b>' + T('Share your copy with your teacher?') + '</b>'+
        (teachers.length
          ? '<span>' + T('AMV read this from the course, it is not a guess.') + '</span>'+
            '<select id="sch-teacher" class="inp">' +
              teachers.map(t => '<option value="' + escH(t.email) + '">' + escH(t.name || t.email) + ' (' + escH(t.email) + ')</option>').join('') +
            '</select>'
          : '<span>' + T('Your school does not publish teacher addresses, so type it exactly as your teacher gave it.') + '</span>'+
            '<input id="sch-teacher" class="inp" type="email" placeholder="teacher@school.edu" autocomplete="off">')+
        '<label class="sch-role"><input type="checkbox" id="sch-edit" checked> ' + T('Let them edit it (most assignments ask for this)') + '</label>'+
        '<div class="sch-btns">'+
          '<button class="btn bp" id="sch-share">' + T('Share it') + '</button>'+
          '<button class="btn bs" data-dact="_schoolRender">' + T('Not now') + '</button>'+
        '</div>'+
        '<div class="sch-note">' + T('AMV does not hand anything in. Once it is shared, submit it in Canvas yourself.') + '</div>'+
      '</div>'+
    '</div>';

  const btn = $('sch-share');
  if(!btn) return;
  on(btn, 'click', async () => {
    const who = ($('sch-teacher') || {}).value || '';
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(who)){
      toast(T('That does not look like an email address.'), 'error');
      return;
    }
    btn.disabled = true; btn.textContent = T('Sharing…');
    try{
      await _schoolShareDoc(copy.id, who, ($('sch-edit') || {}).checked ? 'writer' : 'reader', token);
    }catch(e){
      btn.disabled = false; btn.textContent = T('Try again');
      const box = document.querySelector('.sch-ask');
      if(box) box.insertAdjacentHTML('beforeend', '<div class="sch-err">' + escH(e.message) + '</div>');
      return;
    }
    body.innerHTML =
      '<div class="sch-step">'+
        '<div class="sch-done sch-done-final">' + T('Shared with') + ' ' + escH(who) + '.</div>'+
        '<p>' + T('Your copy:') + ' <a href="' + escH(safeUrl(link)) + '" target="_blank" rel="noopener noreferrer">' + escH(a.name || T('your document')) + '</a></p>'+
        '<div class="sch-note">' + T('Last step is yours: open the assignment in Canvas and hand it in.') + '</div>'+
        (a.url ? '<a class="btn bp" href="' + escH(safeUrl(a.url)) + '" target="_blank" rel="noopener noreferrer">' + T('Open the assignment in Canvas') + '</a>' : '')+
        '<button class="btn bs" data-dact="_schoolRender">' + T('Back to my work') + '</button>'+
      '</div>';
  });
}

/* ---- connecting a school ------------------------------------------------
   Two fields, and both are checked against the real Canvas before anything is
   stored: a token that does not work, saved and reported as connected, is the
   failure this whole area was made of. */
async function schoolConnectOpen(){
  const r = $('ovr'); if(!r) return;
  r.innerHTML =
    '<div class="ov" id="schc-bg"><div class="ob">'+
      '<button class="oc" data-dact="closeOvr">&#215;</button>'+
      '<h2>' + T('Connect your school') + '</h2>'+
      '<p class="ob-sub">' + T('AMV reads what is due. It never hands anything in.') + '</p>'+
      '<label class="sch-lbl">' + T('Your school’s Canvas address') + '</label>'+
      '<input id="schc-url" class="inp" placeholder="https://yourschool.instructure.com" autocomplete="off">'+
      '<label class="sch-lbl">' + T('Access token') + '</label>'+
      '<input id="schc-tok" class="inp" type="password" placeholder="' + T('paste the token from Canvas') + '" autocomplete="off">'+
      '<p class="sch-help">' + T('In Canvas: Account → Settings → New Access Token. AMV stores it on the server so it can read your work, and deletes it with your account.') + '</p>'+
      '<div class="sch-btns">'+
        '<button class="btn bp" id="schc-save">' + T('Connect') + '</button>'+
        '<button class="btn bs" id="schc-off">' + T('Disconnect') + '</button>'+
      '</div>'+
      '<div id="schc-msg" class="sch-err" hidden></div>'+
    '</div></div>';
  const bg = $('schc-bg');
  if(bg) on(bg, 'click', (e) => { if(e.target === e.currentTarget) closeOvr(); });

  const say = (t) => { const m = $('schc-msg'); if(m){ m.hidden = false; m.textContent = t; } };
  const save = $('schc-save');
  if(save) on(save, 'click', async () => {
    save.disabled = true; save.textContent = T('Checking…');
    try{
      const d = await AMV_API._wrote('/v1/school/connect',
        { baseUrl: ($('schc-url')||{}).value || '', token: ($('schc-tok')||{}).value || '' },
        'That could not be connected.');
      /* The marker the Connectors list reads. Written only after the server
         has proved the token against the real Canvas, so "Connected" there
         means connected rather than attempted. */
      try{ saveStr('amv_canvas', d.host || '1'); }catch(_e){}
      toast(T('Connected to') + ' ' + (d.host || T('your school')), 'success');
      closeOvr(); schoolOpen();
    }catch(e){
      save.disabled = false; save.textContent = T('Connect');
      say(e.message);
    }
  });
  const off = $('schc-off');
  if(off) on(off, 'click', async () => {
    off.disabled = true;
    try{
      await AMV_API._wrote('/v1/school/disconnect', {}, 'That could not be disconnected.');
      try{ localStorage.removeItem(_scopeKey('amv_canvas')); }catch(_e){}
      toast(T('Your school is disconnected and the token is deleted.'), 'info');
      closeOvr();
      try{ if(typeof _refreshIntegrationsUI === 'function') _refreshIntegrationsUI(); }catch(_e){}
    }catch(e){ off.disabled = false; say(e.message); }
  });
}

try{
  window.schoolConnectOpen = schoolConnectOpen;
  window.schoolOpen = schoolOpen;
  window.schoolPrepare = schoolPrepare;
  window._schoolRender = _schoolRender;
  window._docKindLabel = SCHOOL_DOC_KINDS;
}catch(e){}
