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

/* THE COPY AND THE SHARE HAPPEN ON THE SERVER.

   This block used to hold a Google token in the page and call Drive from here,
   with the FULL `drive` scope behind it - permission over everything the
   student owns, to do a job that touches one document.

   Both moved. The server holds the grant, and the scope behind the copy is now
   drive.file: it reaches only files AMV itself created, or ones the person
   explicitly opened with it. It cannot read their Drive. That is the difference
   between a feature that does the job and one that asks for a permission it
   does not need - and the copy AMV makes is the only thing it can afterwards
   share.

   Copying needs BOTH capabilities at once, read and write, because the document
   being copied belongs to the teacher and the copy belongs to the student. The
   server asks for them as a set, so a half-granted connection is refused before
   anything happens rather than failing between the read and the write. */
async function _schoolCopyDoc(fileId, title){
  return await _connActRun('drive.copy', { fileId, title });
}
async function _schoolShareDoc(fileId, email, role){
  /* The teacher is notified, which is the point - a share nobody knows about is
     the same as no share. */
  await _connActRun('drive.share', { fileId, email, role: role || 'writer' });
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
  /* THE SERVER NAMES THE CLASSES IT COULD NOT READ. SHOW THEM.

     `schoolWork` fetches each course's assignments separately and any one of
     them can fail on its own. It deliberately does not drop those in silence:
     it sends back `partial`, the course names in `missedCourses`, and a
     written `notice` - the comment beside it says a homework list with a whole
     class missing and no reason to doubt it is the worst way for this to be
     wrong. This screen was reading `work` and nothing else, so all of that
     care stopped one layer short of the student.

     The empty case was worse than the partial one. Every course failing to
     read produces an empty list, and the screen answered "Nothing is due" -
     stated flatly, with no hedge, to somebody who has homework. */
  const missed = (d && Array.isArray(d.missedCourses)) ? d.missedCourses : [];
  const partial = !!(d && d.partial) || missed.length > 0;
  const notice = partial
    ? '<div class="sch-partial" role="status">'+
        '<b>' + T('This list is not complete.') + '</b>'+
        '<span>' + escH(d.notice || (T('AMV could not read') + ' ' + missed.join(', ') + '.')) + ' '+
          T('Anything due in those is missing from this list.') + '</span>'+
        '<button class="btn bs sch-retry" data-dact="schoolReload">' + T('Try again') + '</button>'+
      '</div>'
    : '';
  if(!work.length){
    body.innerHTML = partial
      ? notice
      : '<div class="sch-empty"><b>' + T('Nothing is due.') + '</b><span>'+
        T('When your teachers post something, it appears here.') + '</span></div>';
    return;
  }
  _schoolWork = work;
  body.innerHTML = notice + '<div class="sch-list">' + work.map((a, i) => {
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

  /* No token check here any more. The page holds none, and the SERVER is the
     thing that knows whether the grant covers this - checking here would be a
     second answer to a question that already has one, and the two would drift.
     The refusal arrives from the copy below, in the person's own words, at the
     moment it is relevant. */
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
      copy = await _schoolCopyDoc(doc.id, (a.name || 'Assignment'));
    }catch(e){
      btn.disabled = false; btn.textContent = T('Try again');
      const box = document.querySelector('.sch-ask');
      if(box) box.insertAdjacentHTML('beforeend', '<div class="sch-err">' + escH(e.message) + '</div>');
      return;
    }
    await _schoolAfterCopy(a, copy);
  });
}

/* The copy exists. Now the part that involves somebody else, so it is asked
   with the address visible rather than done and reported. */
async function _schoolAfterCopy(a, copy){
  const body = $('sch-body'); if(!body) return;
  /* The server returns `link`; Drive itself calls the field webViewLink. Both
     are accepted so a change at either end degrades to the constructed URL
     rather than to an empty href, which looks like a working button. */
  const link = copy.link || copy.webViewLink || ('https://docs.google.com/document/d/' + copy.id + '/edit');

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
      await _schoolShareDoc(copy.id, who, ($('sch-edit') || {}).checked ? 'writer' : 'reader');
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
      '<input id="schc-tok" class="inp" type="password" placeholder="' + T('paste the token from Canvas') + '" autocomplete="new-password">'+
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

/* The retry the partial notice offers. It re-runs the same read, because a
   course that could not be reached once often can be a moment later - and the
   alternative on that screen is closing it and opening it again. */
async function schoolReload(){
  const body = $('sch-body');
  if(body) body.innerHTML = '<div class="sch-loading">' + T('Reading your assignments\u2026') + '</div>';
  await _schoolRender();
}

try{
  window.schoolReload = schoolReload;
  window.schoolConnectOpen = schoolConnectOpen;
  window.schoolOpen = schoolOpen;
  window.schoolPrepare = schoolPrepare;
  window._schoolRender = _schoolRender;
  window._docKindLabel = SCHOOL_DOC_KINDS;
}catch(e){}
