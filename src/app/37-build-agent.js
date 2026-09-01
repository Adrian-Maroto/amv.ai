/* ══════════════════════════════════════════════════════════════════════
   BUILDING ON THE MACHINE, WHICH MEANS DOING THE WORK RATHER THAN
   DESCRIBING IT.

   Before this, a build turn was one question and one answer: describe the
   change, get files back, write them into a project that lives in a browser
   tab. That is genuinely useful and it is not what anybody means by "make
   the tests pass". Making the tests pass is a loop - run them, read what
   broke, change the file, run them again - and every step of it depends on
   the result of the step before, so none of it can be written down in
   advance and handed over in one go.

   The bridge supplied the missing half: a real folder, on a real computer,
   where commands really run. This is the other half - the turn that uses it.

   WHAT MAKES THIS DIFFERENT FROM A CHAT THAT HAPPENS TO HAVE TOOLS.

   · It does not stop to ask between steps. Being asked "shall I run the
     tests again?" nine times is not safety, it is the feature not working.
     Consent is asked ONCE, at the top, for the whole turn, in words that say
     what the turn may do and where.
   · Stop is real and always there. It is checked before every round and
     before every single command, so it lands at the next instant rather than
     at the end of whatever is running.
   · It ends with a changelist measured from the disk. Every file the turn
     wrote was read first, so the card says what actually moved rather than
     what the model said it would - and Undo puts the bytes back.
   · It says which bound stopped it. A turn that ran out of rounds is not
     presented as a turn that finished.
   ══════════════════════════════════════════════════════════════════════ */

const _AGENT = {
  running: false,
  stop: false,
  /* Consent is per TURN, never remembered. A grant that outlives the thing
     it was granted for is not consent, it is a setting somebody agreed to
     once - and this one runs commands on their computer. */
  before: null,
  after: null,
  created: null,
  /* WHICH PATHS HAVE ALREADY BEEN LOOKED AT, which is NOT the same as which
     ones have a `before`. A file the turn created has no before - that is
     what marks it created - so testing `path in before` to decide whether to
     capture would capture again on the second write to it, find the file
     there this time, and record the turn's own first write as the original.
     The card would then call a new file an edit, and Undo would leave it
     behind holding an intermediate version. */
  seen: null,
  steps: null,
};
try{ window._AGENT = _AGENT; }catch(e){}

/* Machine mode is on when there is a machine. Not a toggle: a toggle would
   let somebody switch it on with nothing connected and be told no, which is
   a worse screen than the one that simply reflects what is true. */
function _agentReady(){
  try{ return !!(BRIDGE && BRIDGE.connected && Array.isArray(BRIDGE_TOOLS) && BRIDGE_TOOLS.length); }
  catch(e){ return false; }
}
try{ window._agentReady=_agentReady; }catch(e){}

/* ONE ASK, FOR THE WHOLE TURN, NAMING THE FOLDER.

   The alternative - a prompt per command - was tried in chat and is right
   there, because a chat turn runs one or two tools and the person is reading
   along. A build turn runs twenty and the person has gone to make tea. So
   this states the scope plainly: this folder, until it is done or you stop
   it, and here is what it may do.

   It is asked again on the next turn. Nothing here is stored. */
async function _agentConsent(msg){
  const folder = (BRIDGE && BRIDGE.folder) || 'your project folder';
  const ok = await _showModalAsync({
    title: 'Let AMV work in ' + folder + '?',
    body: 'AMV will work on this by itself until it is done: reading your files, '
        + 'writing changes, and running commands like builds, tests and git inside '
        + folder + ' on this computer.\n\n'
        + 'It cannot touch anything outside that folder, and your bridge refuses '
        + 'anything destructive on its own - that rule lives on your machine, not in AMV.\n\n'
        + 'You can stop it at any moment, and every file it changes is listed at the '
        + 'end with an Undo.\n\nThis is for this one request: '
        + String(msg || '').slice(0, 140),
    okText: 'Let it work', cancelText: 'Not now',
  });
  return ok === true;
}

/* WHAT THE TURN IS ALLOWED TO DO, AND WHAT IT RECORDS WHILE DOING IT.

   Every write is read FIRST, so the changelist at the end is measured from
   the disk rather than assembled from what the model said it wrote. A file
   that did not exist is recorded as created, which is what makes Undo able
   to remove it rather than leave an empty one behind. */
async function _agentRunTool(name, input, step){
  if(name === 'write_file'){
    const path = String(input.path || '');
    if(!_AGENT.seen[path]){
      _AGENT.seen[path] = true;
      let prev = null;
      try{ const r = await bridgeRead(path); prev = r && typeof r.content === 'string' ? r.content : null; }
      catch(e){ prev = null; }          // not there, or not readable as text
      if(prev === null) _AGENT.created[path] = true;
      else _AGENT.before[path] = prev;
    }
    const out = await runBridgeTool(name, input);
    if(!out || out.error) return { ok:false, text:'That did not work: ' + ((out && out.error) || 'the write failed') };
    _AGENT.after[path] = String(input.content == null ? '' : input.content);
    return { ok:true, text:'Wrote ' + out.path + ' (' + out.bytes + ' bytes).' };
  }

  const r = await runBridgeTool(name, input);
  if(r && r.error) return { ok:false, text:'That did not work: ' + r.error };

  if(name === 'run_command'){
    const head = 'exit ' + r.exitCode + (r.timedOut ? ' (timed out and was killed)' : '')
               + ' in ' + r.ms + 'ms' + (r.truncated ? ' - output truncated' : '');
    step.exitCode = r.exitCode;
    step.timedOut = !!r.timedOut;
    return { ok: r.exitCode === 0,
             text: head + '\n\nstdout:\n' + (r.stdout || '(empty)')
                        + '\n\nstderr:\n' + (r.stderr || '(empty)') };
  }
  if(name === 'read_file') return { ok:true, text:'--- ' + r.path + ' ---\n' + r.content };
  return { ok:true, text: r.path + ':\n'
           + (r.entries || []).map(e => (e.dir ? '[dir] ' : '      ') + e.name).join('\n') };
}

/* THE STEP LIST, WHICH IS THE WHOLE INTERFACE OF THIS FEATURE.

   Somebody watching AMV work on their computer needs to see what it is
   doing, in their words, as it happens - not a spinner that resolves into a
   paragraph. A failed command is shown as failed and stays visible: it is
   usually the most interesting line in the run, because it is what the next
   step is about.

   Output is a <pre> with textContent set on it later rather than escaped
   into a string here, because build logs contain everything. */
const _AGENT_VERB = {
  run_command: 'Ran', read_file: 'Read', write_file: 'Wrote', list_dir: 'Looked in',
};
function _agentStepHTML(s, live){
  const verb = _AGENT_VERB[s.name] || s.name;
  const what = s.name === 'run_command' ? String(s.input.command || '')
             : String(s.input.path || '.');
  const bad = s.ok === false;
  const tail = s.name === 'run_command' && s.exitCode != null && s.exitCode !== 0
    ? '<span class="ags-code">exit ' + escH(String(s.exitCode)) + '</span>' : '';
  return '<li class="ags-step' + (bad ? ' ags-bad' : '') + (live ? ' ags-live' : '') + '">'
    + '<span class="ags-dot" aria-hidden="true"></span>'
    + '<span class="ags-verb">' + escH(verb) + '</span>'
    + '<code class="ags-what">' + escH(what.slice(0, 160)) + '</code>'
    + tail
    + '</li>';
}
function _agentStepsHTML(entry){
  const steps = entry.steps || [];
  if(!steps.length) return '';
  const failed = steps.filter(s => s.ok === false).length;
  const cmds = steps.filter(s => s.name === 'run_command').length;
  /* A summary in the words somebody would use, not a count of tool calls. */
  const bits = [];
  if(cmds) bits.push(cmds + ' command' + (cmds === 1 ? '' : 's'));
  const wrote = new Set(steps.filter(s => s.name === 'write_file').map(s => s.input.path)).size;
  if(wrote) bits.push(wrote + ' file' + (wrote === 1 ? '' : 's') + ' written');
  if(failed) bits.push(failed + ' that failed');
  return '<div class="ags">'
    + '<div class="ags-head">'
      + '<span class="ags-h">What AMV did on your computer</span>'
      + (bits.length ? '<span class="ags-sum">' + escH(bits.join(' · ')) + '</span>' : '')
    + '</div>'
    + '<ol class="ags-list">' + steps.map(s => _agentStepHTML(s, false)).join('') + '</ol>'
    + (entry.why && entry.why !== 'done'
        ? '<div class="ags-why">' + escH(_agentWhyText(entry.why)) + '</div>' : '')
  + '</div>';
}
function _agentWhyText(why){
  if(why === 'stopped') return 'You stopped this, so it is unfinished. What it had already done is listed above and can be undone.';
  if(why === 'rounds')  return 'AMV stopped after the maximum number of steps for one request. Ask it to keep going if there is more to do.';
  if(why === 'time')    return 'This request hit its time limit and was stopped. Ask it to keep going if there is more to do.';
  return '';
}
try{ window._agentStepsHTML=_agentStepsHTML; window._agentWhyText=_agentWhyText; }catch(e){}

/* Stop, and the button that means it. Replacing Send rather than sitting
   beside it, because a Send that does nothing while a turn runs is a control
   that lies about being available. */
function _agentStopBtnHTML(){
  return '<button class="dev-send dev-stop" id="dev-stop" type="button" hidden title="Stop what AMV is doing" aria-label="Stop">'
    + '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
    + '<rect x="5" y="5" width="14" height="14" rx="2"/></svg></button>';
}
function _agentSetRunning(on){
  _AGENT.running = !!on;
  const send = document.getElementById('dev-send');
  const stop = document.getElementById('dev-stop');
  if(send) send.hidden = !!on;
  if(stop) stop.hidden = !on;
}
function _agentStop(){
  _AGENT.stop = true;
  try{ _devBusy(true, 'Stopping after this step'); }catch(e){}
}
try{ window._agentStop=_agentStop; window._agentSetRunning=_agentSetRunning; }catch(e){}

/* UNDO FOR WORK THAT HAPPENED ON DISK.

   The in-browser turn restores a snapshot of an object. This has to write
   real bytes back, and remove the files the turn created - which is what the
   bridge's delete route exists for. A turn that created a file and cannot
   take it back has not been undone, it has been half undone, and half is the
   answer this codebase has spent a lot of effort not giving. */
async function _agentToggleTurn(t, id){
  const goingBack = !t.undone;
  const target = goingBack ? t.before : t.after;
  const created = t.created || {};
  let failed = 0;
  try{ _devBusy(true, goingBack ? 'Rolling back' : 'Putting it back'); }catch(e){}
  for(const path of Object.keys(goingBack ? Object.assign({}, t.before, created) : t.after)){
    try{
      if(goingBack && created[path]) await bridgeDelete(path);
      else if(target[path] != null) await bridgeWrite(path, target[path]);
    }catch(e){ failed++; }
  }
  try{ _devBusy(false); }catch(e){}
  if(failed){
    try{ toast(failed + ' file' + (failed === 1 ? '' : 's') + ' could not be changed back. Your computer may have disconnected.', 'error', 6000); }catch(e){}
    return;
  }
  t.undone = !t.undone;
  try{ _devRenderLog(); }catch(e){}
  try{ toast(t.undone ? 'Rolled back on your computer.' : 'Change restored on your computer.', 'info', 3000); }catch(e){}
}
try{ window._agentToggleTurn=_agentToggleTurn; }catch(e){}

/* THE TURN ITSELF. */
const _AGENT_SYS =
  'You are AMV Forge, a principal engineer working directly in the user’s own project folder on '
+ 'their computer. You have real tools: run commands, read files, write files, list directories. '
+ 'USE THEM. Do not describe what could be done and do not ask the user to run anything - run it.\n\n'
+ 'How to work:\n'
+ '1. Look before you touch. List and read the files that matter so the change is made against what '
+ 'is really there, not what is typical for a project of that kind.\n'
+ '2. Make the change properly: complete, correct, secure, and in the style of the code around it. '
+ 'write_file writes the WHOLE file, so read it first and keep everything that should stay.\n'
+ '3. VERIFY IT YOURSELF. Run the build, the tests, the linter - whatever this project has. If '
+ 'something fails, read the error, fix it, and run it again. Keep going until it passes or until '
+ 'you are certain it cannot be fixed without a decision only the user can make.\n'
+ '4. Never claim something works because it should. If you did not run it, say that you did not.\n\n'
+ 'Be economical: the smallest command that answers the question, and no exploratory rummaging '
+ 'once you know where you are. Finish with a short plain-English summary of what changed and what '
+ 'you verified - no file listing, that is shown separately.';

async function _devSendAgent(msg, stat){
  if(!await _agentConsent(msg)){
    _DEV.log.push({ role:'ai', text:'Left it alone. Nothing was run or changed on your computer.' });
    _devRenderLog();
    return;
  }
  _AGENT.stop = false;
  _AGENT.before = {}; _AGENT.after = {}; _AGENT.created = {}; _AGENT.seen = {};
  _AGENT.steps = [];
  _agentSetRunning(true);

  const entry = { role:'ai', text:'', steps:_AGENT.steps };
  _DEV.log.push(entry);
  _devRenderLog();

  const paint = () => { try{ _devRenderLog(); }catch(e){} };
  const _hist = await _ctxDevHistory();
  const folder = (BRIDGE && BRIDGE.folder) || 'the project';

  let out;
  try{
    out = await aiAgentLoop({
      system: _AGENT_SYS + _handoffContext('dev') + _userStyle(),
      prompt: _hist + 'You are in the folder "' + folder + '".\n\nREQUEST: ' + msg,
      tools: BRIDGE_TOOLS,
      model: _sectionModel('code'),
      effort: _devEffort(),
      max_tokens: 8000,
      runTool: _agentRunTool,
      stopped: () => _AGENT.stop,
      onStep: (ev) => {
        if(ev.phase === 'start'){
          /* The SAME array the log entry holds, so a step appears on screen
             the moment it starts rather than when the turn is over. The loop
             keeps its own transcript; this is the one being rendered. */
          _AGENT.steps.push(ev.step);
          try{ _devBusy(true, (_AGENT_VERB[ev.step.name] || 'Working') + ' · '
               + String(ev.step.input.command || ev.step.input.path || '').slice(0, 40)); }catch(e){}
          paint();
        } else if(ev.phase === 'end'){ paint(); }
        else if(ev.phase === 'said' && ev.text && ev.text.trim()){
          if(stat) stat.textContent = ev.text.trim().split('\n')[0].slice(0, 80);
        }
      },
    });
  }catch(err){
    /* The steps already taken are real and stay on the screen with their own
       changelist. An error at round nine does not un-write round three. */
    entry._snag = _errText(err);
    entry._snagRoute = (typeof _refusalRoute === 'function' ? _refusalRoute(err && err.code) : '');
    _agentFinish(entry);
    return;
  }

  entry.text = out.text || 'Done.';
  entry.why = out.why;
  _agentFinish(entry);
}

/* What every ending has in common, so a stopped turn, a failed turn and a
   finished one all get the same changelist and the same Undo. */
function _agentFinish(entry){
  const before = Object.assign({}, _AGENT.before);
  const after = Object.assign({}, _AGENT.after);
  /* A file the turn created has no "before". It is listed as created by
     being absent from `before`, which is exactly what _devChangeSet reads. */
  const rows = _devChangeSet(before, after);
  if(rows.length){
    const id = 'chg' + (++_DEVCHG.seq);
    _DEVCHG.turns[id] = { before, after, created: Object.assign({}, _AGENT.created),
                          machine:true, undone:false };
    entry.changes = rows;
    entry.chgId = id;
  }
  _agentSetRunning(false);
  _AGENT.stop = false;
  try{ _devBusy(false); }catch(e){}
  _devRenderLog();
}
try{ window._devSendAgent=_devSendAgent; }catch(e){}
