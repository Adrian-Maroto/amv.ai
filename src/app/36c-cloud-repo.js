/* ══ A GITHUB REPOSITORY IN THE CLOUD WORKSPACE, AND BACK ═══════════════════

   Open: the server copies one exact commit of the repository into the cloud
   workspace (src/worker/10a-cloud-checkout.js) - the GitHub key never goes in
   the machine - and this card says what arrived and what did not.

   Send back: the workspace is asked, with git, what changed since that
   commit; every file is listed before anything leaves; and the change goes to
   GitHub as a NEW branch built on the commit that was copied, through the same
   action as every other push (read back, with Undo). A pull request is a
   second, separate press.

   Kept for this tab only. The workspace is cleared when it sleeps, so a
   repository remembered past that would point at a folder that is not there. */
const CLOUD_REPO = { open: null };

function _cloudRepoHTML(){
  const r = CLOUD_REPO.open;
  if(!r) return '';
  return '<p class="brg-p"><b>' + escH(r.repo) + '</b> ' + escH(T('is open in {0}').replace('{0}', r.folder)) + ' · '
    + escH(T('{0} files at {1}').replace('{0}', r.files).replace('{1}', String(r.base).slice(0, 7)))
    + (r.skippedCount ? ' · ' + escH(T('{0} not copied').replace('{0}', r.skippedCount)) : '') + '</p>'
    + (r.skipped && r.skipped.length ? '<details class="brg-p"><summary>' + escH(T('What was not copied')) + '</summary><ul>'
        + r.skipped.map(x => '<li><code>' + escH(x.path) + '</code> - ' + escH(T(x.why))).join('') + '</ul></details>' : '')
    + '<p class="brg-p">' + escH(T('Ask AMV in Build to work in that folder. Send your changes back before the workspace sleeps.')) + '</p>'
    + '<div class="brg-acts"><button class="btn bp" id="brg-gh-send" type="button">' + escH(T('Send changes to GitHub')) + '</button></div>';
}
function _cloudRepoPaint(root){
  const box = (root || document).querySelector('#brg-repo');
  if(box){ box.innerHTML = _cloudRepoHTML(); _cloudRepoWire(root); }
}
function _cloudRepoWire(root){
  root = root || document;
  const go = root.querySelector('#brg-gh-open');
  if(go && !go._amv){ go._amv = 1; on(go, 'click', async () => { go.disabled = true; try{ await _cloudRepoOpen(root); } finally { go.disabled = false; } }); }
  const send = root.querySelector('#brg-gh-send');
  if(send && !send._amv){ send._amv = 1; on(send, 'click', async () => { send.disabled = true; try{ await _cloudRepoSend(); } finally { send.disabled = false; } }); }
}

async function _cloudRepoOpen(root){
  const conn = await _ghConnection();
  if(!conn.ok){ toast(_ghNotReadyMessage(conn.why), 'info', 7000); return; }
  let repos = [];
  try{ repos = await _connActRun('github.repos'); }
  catch(e){ toast(e.message || T('Could not read your repositories.'), 'error', 6000); return; }
  if(!repos || !repos.length){ toast(T('No repository on your account can be changed from AMV.'), 'info', 6000); return; }
  const repo = await _devPickRepo(repos, T('Open which repository?'));
  if(!repo) return;
  toast(T('Copying {0} into your cloud workspace…').replace('{0}', repo.full), 'info', 4000);
  let r, d;
  try{
    r = await AMV_API._fetch('/v1/computer/checkout', { method: 'POST', body: JSON.stringify({ repo: repo.full, ref: repo.branch }), timeout: 180000 });
    d = await r.json().catch(() => ({}));
  }catch(e){ toast(T('AMV could not reach your cloud workspace. Nothing was copied.'), 'error', 7000); return; }
  if(!r.ok || !d.ok){ toast(String(d.message || d.error || T('The repository could not be copied.')), 'error', 8000); return; }
  CLOUD_REPO.open = { repo: d.repo, ref: d.ref, base: d.base, folder: d.folder, files: d.files, tracked: !!d.tracked,
                      skipped: d.skipped || [], skippedCount: d.skippedCount || 0 };
  _cloudRepoPaint(root);
  toast(T('{0} is open in your cloud workspace.').replace('{0}', d.repo), 'success', 5000);
}

/* What changed since the copy, from git in the workspace. -z output: one
   entry per NUL, a rename followed by its old name. */
function _cloudRepoChanges(out){
  const parts = String(out || '').split('\0'), changed = [], deleted = [];
  for(let i = 0; i < parts.length; i++){
    const e = parts[i]; if(e.length < 4) continue;
    const xy = e.slice(0, 2), path = e.slice(3);
    if(path === '.amv-checkout.json') continue;
    if(xy[0] === 'R' || xy[1] === 'R'){ changed.push(path); deleted.push(parts[++i]); continue; }
    if(xy.indexOf('D') >= 0) deleted.push(path); else changed.push(path);
  }
  return { changed, deleted: deleted.filter(Boolean) };
}

async function _cloudRepoSend(){
  const o = CLOUD_REPO.open;
  if(!o) return;
  if(!o.tracked){ toast(T('This copy is not tracked, so AMV cannot tell what changed. Open the repository again.'), 'error', 8000); return; }
  let st;
  try{ st = await bridgeExec('git status --porcelain=v1 -z --untracked-files=all', { cwd: o.folder, timeout: 60000 }); }
  catch(e){ toast((e && e.message) || T('The workspace could not be asked what changed.'), 'error', 7000); return; }
  if(!st || st.exitCode !== 0){ toast(T('The folder is no longer there - the workspace may have slept. Open the repository again.'), 'error', 8000); return; }
  const ch = _cloudRepoChanges(st.stdout);
  if(!ch.changed.length && !ch.deleted.length){ toast(T('Nothing has changed since it was copied.'), 'info', 5000); return; }
  const files = [];
  for(const p of ch.changed){
    let f;
    try{ f = await bridgeRead(o.folder + '/' + p); }
    catch(e){ toast(T('{0} could not be read, so nothing was sent.').replace('{0}', p), 'error', 8000); return; }
    if(f) files.push({ path: p, content: String(f.content || '') });
  }
  const branch = _ghBranchName();
  const rows = files.map(f => '<li class="ghp-f"><span class="ghp-p">' + escH(f.path) + '</span><span class="ghp-n">' + f.content.split('\n').length + ' ' + escH(T('lines')) + '</span></li>').join('')
    + ch.deleted.map(p => '<li class="ghp-f"><span class="ghp-p">' + escH(p) + '</span><span class="ghp-n">' + escH(T('removed')) + '</span></li>').join('');
  _ghModal(T('Send {0} changes to {1}?').replace('{0}', files.length + ch.deleted.length).replace('{1}', o.repo),
    '<p class="ob-sub">' + escH(T('AMV creates a NEW branch from the commit that was copied. Nothing is merged - a pull request is how you decide that.')) + '</p>'
    + '<div class="ghp-meta"><b>' + escH(o.repo) + '</b><span>' + escH(T('branch')) + ' <code>' + escH(branch) + '</code> ' + escH(T('from')) + ' <code>' + escH(String(o.base).slice(0, 7)) + '</code></span></div>'
    + '<ul class="ghp-l">' + rows + '</ul>'
    + '<div class="ghp-acts"><button class="btn bs" id="ghp-no" type="button">' + escH(T('Cancel')) + '</button><button class="btn bp" id="ghp-go" type="button">' + escH(T('Send')) + '</button></div>',
    () => {
      on($('ghp-no'), 'click', closeOvr);
      on($('ghp-go'), 'click', async () => {
        closeOvr();
        try{
          const r = await _connActRun('github.push', { repo: o.repo, base: o.ref, branch, baseSha: o.base,
            message: T('Changes from AMV’s cloud workspace'), files, deletes: ch.deleted });
          toastAction(T('Sent to {0} on branch {1}.').replace('{0}', r.repo).replace('{1}', r.branch), T('Open pull request'),
            () => _devOpenPR({ repo: r.repo, branch: r.branch, base: o.ref }), 30000);
        }catch(e){ toast((e && e.message) || T('The changes could not be sent. Nothing was changed on GitHub.'), 'error', 8000); }
      });
    });
}
try{ Object.assign(window, { _cloudRepoOpen, _cloudRepoSend, _cloudRepoChanges, CLOUD_REPO_STATE: CLOUD_REPO }); }catch(e){}
