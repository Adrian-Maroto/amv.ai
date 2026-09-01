/* ══════════════════════════════════════════════════════════════════════
   WHAT AMV KNOWS ABOUT THIS PROJECT, AND HOW IT CAME TO KNOW IT.

   Every session used to start from nothing. AMV would work out how to run
   the tests, where the source lives and what this project's conventions
   are - and then throw all of it away, so the next request paid to
   rediscover the same three facts. On a big repository that is several
   minutes and several rounds of somebody's allowance, every time, for
   something that has not changed since yesterday.

   So a project gets a memory. The important word is LEARNED: everything in
   here is something that actually happened. A command that ran and exited
   zero is evidence that it is how this project does that thing; a command
   the model asserted would work is not evidence of anything, and does not
   get in. That distinction is the whole reason this can be trusted enough
   to put in a prompt.

   WHY THE PATH IS HASHED. The natural key for "this project" is the folder
   it lives in, and a folder path is almost always somebody's home
   directory with their real name in it. This memory syncs, so that path
   would leave the machine. The id is a hash instead: stable across
   sessions and devices for the same folder, and meaningless to anybody who
   reads the record. The readable NAME is the folder's own basename, which
   is what people call their project anyway.
   ══════════════════════════════════════════════════════════════════════ */

/* A LIST, NOT A MAP, AND FOR ONE REASON.

   Everything else that syncs here - Recents, skills, handoffs - is a list of
   items carrying an `id` and an `updated`, because that is the shape the
   server's merge understands: two devices that both changed something are
   reconciled item by item, newest wins. A map keyed by id would have fallen
   through that to "last writer replaces everything", so a project learned on
   the laptop would vanish the next time the desktop synced. Forty entries
   make a linear lookup free. */
const PROJ = {
  list: [],
  /* The account `list` was loaded for. See _projFresh. */
  scope: null,
  /* The one in front of us, or '' when nothing is connected. */
  current: '',
};
try{ window.PROJ = PROJ; }catch(e){}

const PROJ_MAX        = 40;     // projects remembered at once
const PROJ_MAX_FACTS  = 40;     // per project - a prompt block, not a database
const PROJ_FACT_MAX   = 200;    // characters per fact

/* LOADED FOR THE ACCOUNT THAT IS SIGNED IN, WHICH IS NOT KNOWN AT LOAD TIME.

   `store`/`load` scope every key by the signed-in email. This module runs
   while the bundle is being evaluated, before sign-in has been restored, so
   a plain load at the bottom of the file reads the guest scope and finds
   nothing - and then the first `_projSave` writes an EMPTY list over the
   real one under the account's own key. Everything AMV had learned about
   every project, gone on the next turn, silently.

   So the scope is recorded with the data, and any read checks it first. A
   different account (or one arriving late, which is the ordinary case) is a
   reload rather than a wipe. */
function _projScope(){
  try{
    if(typeof S !== 'undefined' && S && S.user && S.user.email) return S.user.email.toLowerCase();
  }catch(e){}
  try{ const u = JSON.parse(localStorage.getItem('amv_user') || 'null'); if(u && u.email) return u.email.toLowerCase(); }catch(e){}
  return 'guest';
}
function _projLoad(){
  try{
    const raw = load('amv_projects');
    PROJ.list = Array.isArray(raw) ? raw.filter(p => p && p.id) : [];
  }catch(e){ PROJ.list = []; }
  PROJ.scope = _projScope();
}
/* Called by everything that reads or writes. Cheap: a string compare. */
function _projFresh(){
  if(PROJ.scope !== _projScope()) _projLoad();
}
try{ window._projFresh=_projFresh; }catch(e){}
function _projSave(){
  try{
    /* Least recently touched drops off, so a long-lived browser does not grow
       without end. */
    PROJ.list.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    PROJ.list = PROJ.list.slice(0, PROJ_MAX);
    store('amv_projects', PROJ.list);
  }catch(e){}
  /* Rides the sync that already exists rather than inventing a second one.
     Debounced there, so calling this on every fact costs nothing. */
  try{ if(typeof AMVSync !== 'undefined') AMVSync.push(); }catch(e){}
}
try{ window._projSave=_projSave; }catch(e){}

/* A stable, meaningless id for a path. FNV-1a rather than SHA-256 because
   this is a lookup key and not a secret: nothing is protected by it being
   hard to reverse, and a synchronous function keeps every caller simple.
   What matters is that the path itself never leaves. */
function _projHash(s){
  let h = 0x811c9dc5;
  const str = String(s || '');
  for(let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return 'p' + h.toString(36) + str.length.toString(36);
}
try{ window._projHash=_projHash; }catch(e){}

/* Which project is in front of us. A connected folder is the answer when
   there is one; without a machine there is no stable identity to key on, so
   there is no project memory rather than a made-up one. */
function projectId(){
  try{
    if(typeof BRIDGE !== 'undefined' && BRIDGE.connected && BRIDGE.root) return _projHash(BRIDGE.root);
  }catch(e){}
  return '';
}
function projectName(){
  try{ if(typeof BRIDGE !== 'undefined' && BRIDGE.connected) return BRIDGE.folder || 'this project'; }catch(e){}
  return '';
}
function _projCurrent(create){
  _projFresh();
  const id = projectId();
  if(!id) return null;
  let p = PROJ.list.find(x => x && x.id === id);
  if(!p){
    if(!create) return null;
    p = { id, name: projectName(), facts: [], updated: Date.now() };
    PROJ.list.push(p);
  }
  /* The folder can be renamed; the path is what identifies it. */
  p.name = projectName() || p.name;
  PROJ.current = id;
  return p;
}
try{ window.projectId=projectId; window.projectName=projectName; }catch(e){}

/* ── LEARNING ───────────────────────────────────────────────────────────── */
/* Near-duplicates are the failure mode here: forty variations on "the tests
   are run with npm test" crowd out everything else and make the block worse
   than empty. Compared on a normalised form rather than exactly. */
const _projNorm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[`'".,;:]/g, '').trim();

function projLearn(text, how){
  const p = _projCurrent(true);
  if(!p) return false;
  const t = String(text || '').trim().slice(0, PROJ_FACT_MAX);
  if(!t) return false;
  const norm = _projNorm(t);
  const at = p.facts.findIndex(f => _projNorm(f.t) === norm);
  if(at >= 0){
    /* Seen again. Worth knowing: something confirmed five times is worth
       more room than something seen once, and this is what makes the
       trimming below keep the right things. */
    p.facts[at].seen = (p.facts[at].seen || 1) + 1;
    p.facts[at].ts = Date.now();
  } else {
    p.facts.push({ t, how: String(how || 'observed').slice(0, 40), ts: Date.now(), seen: 1 });
  }
  /* Most-confirmed first, then most recent. What falls off the end is what
     was seen once and long ago, which is the right thing to forget. */
  p.facts.sort((a, b) => (b.seen || 1) - (a.seen || 1) || (b.ts || 0) - (a.ts || 0));
  p.facts = p.facts.slice(0, PROJ_MAX_FACTS);
  p.updated = Date.now();
  _projSave();
  return true;
}
function projForget(text){
  const p = _projCurrent(false);
  if(!p) return false;
  const norm = _projNorm(text);
  const before = p.facts.length;
  p.facts = p.facts.filter(f => _projNorm(f.t) !== norm);
  if(p.facts.length === before) return false;
  p.updated = Date.now();
  _projSave();
  return true;
}
try{ window.projLearn=projLearn; window.projForget=projForget; }catch(e){}

/* WHAT A FINISHED TURN ACTUALLY TAUGHT US.

   Only commands that RAN and SUCCEEDED. A command that failed says nothing
   about how this project works - it may have been wrong, or the project may
   have been broken at that moment - and recording it would teach the next
   turn to repeat somebody's mistake.

   The noise is filtered out too: `ls`, `cat`, `cd` and friends are how
   anybody looks around and are true of every project on earth, so they are
   not facts about THIS one. */
const _PROJ_BORING = /^(ls|ll|cat|cd|pwd|echo|head|tail|which|whoami|find|grep|rg|wc|true|clear|date|env)\b/;
function projLearnFromSteps(steps){
  if(!Array.isArray(steps) || !steps.length) return 0;
  let n = 0;
  for(const s of steps){
    if(!s || s.name !== 'run_command' || s.ok !== true) continue;
    const cmd = String((s.input && s.input.command) || '').trim();
    if(!cmd || cmd.length > PROJ_FACT_MAX || _PROJ_BORING.test(cmd)) continue;
    if(cmd.includes('\n')) continue;                 // a script, not a project's command
    if(projLearn('`' + cmd + '` runs here and succeeds', 'ran it')) n++;
  }
  return n;
}
try{ window.projLearnFromSteps=projLearnFromSteps; }catch(e){}

/* ── TELLING THE MODEL ──────────────────────────────────────────────────── */
/* Empty when there is nothing worth saying, so a first visit is not prefixed
   with a heading over nothing. */
function projBlock(){
  const p = _projCurrent(false);
  if(!p || !p.facts.length) return '';
  const lines = p.facts.slice(0, PROJ_MAX_FACTS).map(f => '- ' + f.t);
  return '\n\nWHAT YOU ALREADY KNOW ABOUT "' + (p.name || 'this project') + '"\n'
    + 'These are things that have actually happened in this folder in earlier\n'
    + 'sessions, not guesses. Prefer them over exploring again, but if one turns\n'
    + 'out to be wrong now, say so and go by what you find.\n'
    + lines.join('\n') + '\n';
}
try{ window.projBlock=projBlock; }catch(e){}

/* ── THE DOOR: what AMV knows, on the Build screen ───────────────────────── */
function projPanelHTML(){
  const p = _projCurrent(false);
  const name = projectName();
  if(!name) return '';
  if(!p || !p.facts.length){
    return '<div class="prj prj-empty"><span class="prj-h">' + escH(name) + '</span>'
      + '<span class="prj-none">AMV has not learned anything about this project yet. '
      + 'It will, as it works.</span></div>';
  }
  const rows = p.facts.map(f =>
    '<li class="prj-f">'
      + '<span class="prj-t">' + escH(f.t) + '</span>'
      + '<span class="prj-how">' + escH(f.how) + ((f.seen || 1) > 1 ? ' · ' + f.seen + '×' : '') + '</span>'
      + '<button class="prj-x" type="button" aria-label="Forget this" title="Forget this"'
        + ' data-prj-forget="' + escH(f.t) + '">×</button>'
    + '</li>').join('');
  return '<details class="prj"><summary class="prj-sum">'
      + '<span class="prj-h">' + escH(name) + '</span>'
      + '<span class="prj-n">' + p.facts.length + ' thing' + (p.facts.length === 1 ? '' : 's') + ' learned</span>'
    + '</summary><ul class="prj-list">' + rows + '</ul>'
    + '<p class="prj-note">Learned by doing, not guessed. Remove anything that is wrong '
      + 'and AMV will stop believing it.</p></details>';
}
function projWirePanel(root){
  root = root || document;
  root.querySelectorAll('[data-prj-forget]').forEach(b => on(b, 'click', () => {
    if(projForget(b.dataset.prjForget)){
      try{ toast('Forgotten.', 'info', 2500); }catch(e){}
      try{ _devRenderProject(); }catch(e){}
    }
  }));
}
try{ window.projPanelHTML=projPanelHTML; window.projWirePanel=projWirePanel; }catch(e){}

try{ _projLoad(); }catch(e){}
