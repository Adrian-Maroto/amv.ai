/* ══════════════════════════════════════════════════════════════
   THE CREW, RUN FROM CHAT

   Every one of these goes through the same /auto/* routes the Crew screen
   uses, so there is exactly one idea of what a background job is. A job
   created in a sentence is the same record as one created by the form: same
   list, same cron, same limits, same plan checks. Chat is a second door onto
   the feature, not a second copy of it.

   Three things the model is never allowed to do here, because each of them
   would be a plausible-looking disaster:

   - Guess which job it meant. "Remove the email one" with two email jobs
     returns both and refuses. Deleting the wrong background job is silent
     data loss the person only discovers when the thing they relied on has
     been gone for a week.
   - Claim something happened. Every failure comes back as an instruction to
     say so plainly, because the one behaviour worse than not creating the
     job is telling somebody it is running when it is not.
   - Route around a limit. Plan ceilings, the free-tier shaping, the
     permission rules for unattended runs - all of those live on the server
     and are enforced identically no matter which door the request came in.
   ══════════════════════════════════════════════════════════════ */
const _CREW_REPEATS = ['10min','30min','hourly','daily','weekly'];

/* Find the ONE job being talked about, or explain why that is not possible.
   Returns { item } or { error } - never a best guess. */
async function _crewFind(input){
  let items = [];
  try{ const d = await _autoApi('/auto/list', {}); items = d.items || []; }
  catch(e){ return { error: _crewErr(e) }; }

  const id = String((input && input.id) || '').trim();
  if(id){
    const byId = items.find(x => x.id === id);
    if(byId) return { item: byId, items };
    /* An id that is not on the list means the model invented it or the job is
       already gone. Both are worth saying rather than falling through to a
       fuzzy match that could hit something else entirely. */
    return { error:'There is no background job with that id. Call crew_list to see the real ones, and tell the user if the job they meant is not there.' };
  }

  const q = String((input && input.match) || '').trim().toLowerCase();
  if(!q) return { error:'Which job? Call crew_list, then pass the id of the one they mean.' };
  const words = q.split(/\s+/).filter(w => w.length > 2);
  const hits = items.filter(x => {
    const hay = String(x.detail || '').toLowerCase();
    return hay.includes(q) || (words.length > 0 && words.every(w => hay.includes(w)));
  });
  if(hits.length === 1) return { item: hits[0], items };
  if(hits.length === 0)
    return { error: items.length
      ? 'No background job matches that. The ones that exist are: '
        + items.map(x => x.id + ' - ' + String(x.detail||'').slice(0,70)).join(' | ')
        + '. Ask the user which they meant, or tell them it does not exist.'
      : 'They have no background jobs at all, so there is nothing to change. Say so.' };
  return { error:'That matches ' + hits.length + ' jobs, so it is not clear which one they mean: '
                 + hits.map(x => x.id + ' - ' + String(x.detail||'').slice(0,70)).join(' | ')
                 + '. Ask the user which one before doing anything.' };
}

/* A failure the model can repeat to the person truthfully, including the one
   thing they can do about it. */
function _crewErr(e){
  const msg = (e && e.message) || 'the server did not accept it';
  if(msg === 'not-connected')
    return 'AMV is not connected to its engine, so background jobs cannot be reached at all. Tell the user to connect it in Settings. Do NOT say the job was created.';
  if(e && e.code === 'job_limit')
    return 'The account is at its background-job limit: ' + msg +
           '. Tell the user exactly this. Removing one frees a slot, and a higher plan raises the number. ' +
           'Do NOT say the job was created, and do NOT retry - it will refuse again.';
  if((typeof _isPlanRefusal==='function' && _isPlanRefusal(e)) || /paid plan/i.test(msg))
    return 'This account\'s plan cannot run that: ' + msg + '. Tell the user exactly this and that upgrading lifts it. Do NOT say the job was created.';
  return 'That did not work: ' + msg + '. Tell the user plainly - do NOT say it worked.';
}

/* One line per job, in the terms the person thinks in. */
/* "08:00" + days + day of month -> the schedule the server keeps. Null when
   the cadence has no time of day (every 10 minutes, hourly) or no time was
   given, which leaves the server's own first-run rule in place. */
const _CREW_DOW = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 };
function _crewSchedOf(cad, input){
  const m = String((input && input.time) || '').match(/^\s*(\d{1,2}):(\d{2})\s*$/);
  if(!m || ['daily','weekly','monthly'].indexOf(cad) < 0) return null;
  const hour = +m[1], minute = +m[2];
  if(hour > 23 || minute > 59) return null;
  if(cad === 'weekly'){
    let days = (Array.isArray(input.days) ? input.days : []).map(d => _CREW_DOW[String(d).slice(0,3).toLowerCase()]).filter(d => d != null);
    if(!days.length) days = [new Date().getDay()];
    return { cad, hour, minute, days };
  }
  if(cad === 'monthly') return { cad, hour, minute, dom: Math.min(31, Math.max(1, parseInt(input.day_of_month, 10) || 1)) };
  return { cad, hour, minute };
}
/* How a job's schedule reads, on the person's clock when it has one. */
function _crewWhen(x){
  if(x && x.repeat === 'once') return 'once' + (x.next ? ', ' + new Date(Number(x.next)).toLocaleString([], { weekday:'long', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : '');
  if(x && x.sched && typeof _schedHumanOf === 'function') return _schedHumanOf(x.sched).replace(/^Every/, 'every') + (x.sched.tz ? ' (' + x.sched.tz + ')' : '');
  return _CREW_EVERY[String((x && x.repeat) || '')] || 'on a schedule';
}
try{ window._crewSchedOf=_crewSchedOf; window._crewWhen=_crewWhen; }catch(e){}
/* One of the person's agents (77-agents.js), named the way they would name
   it. Read from the server each time: a name that was renamed or deleted a
   minute ago must not be matched from a copy. */
async function _crewAgentId(name){
  let d;
  try{ const r = await AMV_API._fetch('/v1/agents', { method:'GET', timeout:10000 }); d = await r.json(); }
  catch(e){ return { ok:false, error:'Their agents could not be read just now, so nothing was set up. Say so and offer to try again.' }; }
  const list = (d && Array.isArray(d.agents)) ? d.agents : [];
  const want = String(name || '').trim().toLowerCase();
  const a = list.find(x => x.id === name) || list.find(x => String(x.name).toLowerCase() === want);
  if(!a) return { error:'They have no agent called "' + String(name).slice(0, 60) + '"' + (list.length ? ' - their agents are: ' + list.map(x => x.name).join(', ') + '.' : ' - they have no agents yet; they can make one in Crew.') + ' Nothing was set up.' };
  if(a.paused) return { error:'Their agent ' + a.name + ' is paused, so it would not run the job. Nothing was set up - ask whether to resume it in Crew first, or to have AMV do it instead.' };
  return { id: a.id, name: a.name };
}
function _crewLine(x){
  const every = _crewWhen(x);
  return '- [' + x.id + '] ' + (x.step ? 'step ' + x.step.n + ' of ' + x.step.of + ' of a task, ' : '')
       + (x.done ? (/^did not run/.test(String(x.lastError||'')) ? 'DID NOT RUN - ' + x.lastError : 'FINISHED - a one-time job that has already run')
          : x.waiting ? 'WAITING for an earlier step to finish' : x.active === false ? 'PAUSED'
          : x.when ? 'WATCHING ' + ({ page:'a web page', calendar:'their calendar' }[x.when.source] || 'their mail') + ' for ' + _whenSay(x.when) + (x.lastError ? ' (' + x.lastError + ')' : '') : 'running ' + every)
       + ({ auto:', results delivered automatically',
            suggest:', suggest only - it does not run until asked',
            require:', each result waits for approval' }[String(x.approval||'require')] || '')
       + ': ' + String(x.detail || '').slice(0, 220);
}

/* Repaint whatever is on screen, so a job created in chat is visible in Crew
   the moment they look - rather than next time something happens to refresh. */
function _crewSynced(){
  try{ if(typeof _autoRefresh === 'function') _autoRefresh(); }catch(e){}
  try{ if(S.tab === 'crew' && typeof renderCrewView === 'function') renderCrewView(); }catch(e){}
  try{ if(S.tab === 'tasks' && typeof renderTasksView === 'function') renderTasksView(); }catch(e){}
}

/* The steps as they were set up, in the conversation: what each does and
   which it waits for. Their progress lives in Crew, which reads the server. */
function _crewStepsCard(items){
  if(!items || !items.length) return null;
  const byId = new Map(items.map(x => [x.id, x]));
  return '<div class="chat-run dlg dlg-steps"><div class="chat-run-h">' + escH(T('Task in {0} steps, running in the background').replace('{0}', items.length)) + '</div><ul class="dlg-list">'
    + items.map(x => {
        /* One step or several (a join): each named by its title. */
        const prev = (Array.isArray(x.after) ? x.after : x.after ? [x.after] : []).map(id => byId.get(id)).filter(Boolean)
          .map(p => (p.step && p.step.title) || '').filter(Boolean);
        return '<li class="dlg-i"><span class="dlg-st" aria-hidden="true">' + escH(String((x.step && x.step.n) || '')) + '</span>'
          + '<span class="dlg-t">' + escH((x.step && x.step.title) || String(x.detail || '').slice(0, 60))
          + (prev.length ? ' <span class="dlg-after">' + escH(T('after {0}').replace('{0}', prev.join(', '))) + '</span>' : '') + '</span></li>';
      }).join('')
    + '</ul><div class="dlg-foot"><button class="btn bs" type="button" data-dact="setTab" data-darg="crew">' + escH(T('Open Crew')) + '</button></div></div>';
}

/* What a trigger watches for, in words. */
function _whenSay(w){
  const j = (a) => (a || []).join(' or ');
  if(w.source === 'page'){
    let host = ''; try{ host = new URL(w.url).hostname; }catch(e){ host = String(w.url || ''); }
    return [ (w.appears || []).length ? T('{0} saying {1}').replace('{0}', host).replace('{1}', j(w.appears)) : '',
             (w.disappears || []).length ? T('{0} no longer saying {1}').replace('{0}', host).replace('{1}', j(w.disappears)) : '' ].filter(Boolean).join(', ');
  }
  if(w.source === 'calendar') return T('new events with {0}').replace('{0}', j(w.words));
  if(w.source === 'github') return T('{0} on {1}').replace('{0}', (w.events || []).map(e => ({ pull_request: T('new pull requests'), issue: T('new issues'), push: T('pushes'), release: T('releases') }[e] || e)).join(', '))
    .replace('{1}', String(w.repo || '')) + ((w.words || []).length ? ' ' + T('mentioning {0}').replace('{0}', j(w.words)) : '');
  if(w.source === 'hook') return (w.words || []).length ? T('a request to its address mentioning {0}').replace('{0}', j(w.words)) : T('a request to its address');
  return [ (w.from || []).length ? T('mail from {0}').replace('{0}', j(w.from)) : '',
           (w.subject || []).length ? T('a subject with {0}').replace('{0}', j(w.subject)) : '',
           (w.words || []).length ? T('mentions of {0}').replace('{0}', j(w.words)) : '' ].filter(Boolean).join(', ');
}
try{ window._whenSay = _whenSay; }catch(e){}

async function _crewTool(name, input){
  input = input || {};

  if(name === 'crew_list'){
    let d;
    try{ d = await _autoApi('/auto/list', {}); }
    catch(e){ return { text: _crewErr(e), render:null }; }
    const items = d.items || [];
    const standing = String(d.standing || '').trim();
    const head = items.length
      ? 'Their background jobs (' + items.length + (typeof d.maxAutomations === 'number' ? ' of ' + d.maxAutomations + ' allowed' : '') + '):\n'
        + items.map(_crewLine).join('\n')
      : 'They have no background jobs set up yet.'
        + (d.canSchedule === false ? ' Their plan cannot run them - say so if they ask for one.' : '');
    const agents = Array.isArray(d.agents) ? d.agents : [];
    const agentsSay = agents.length
      ? '\n\nTheir agents (give one a job with agent set to its name): ' + agents.map(a => a.name + (a.paused ? ' (paused)' : '')).join(', ') + '.'
      : '';
    const named = new Map(agents.map(a => [a.id, a.name]));
    const head2 = head.replace(/^- \[([^\]]+)\]/gm, (m, id) => { const it = items.find(x => x.id === id); return it && it.agent && named.get(it.agent) ? m + ' (agent ' + named.get(it.agent) + ')' : m; });
    const cap = String(d.ceiling || 'auto');
    const capSay = { suggest:'Their account is set so NO background job runs on its own - each one waits to be asked. Any job above says what it is configured to do, but this is what actually happens.',
                     require:'Their account is set so nothing goes out without their approval, whatever an individual job says.',
                     auto:'' }[cap] || '';
    return { text: head2 + agentsSay + (standing
      ? '\n\nStanding instructions applying to all of them: ' + standing
      : '\n\nThey have no standing instructions set.')
      + (capSay ? '\n\n' + capSay : ''), render:null };
  }

  if(name === 'crew_add'){
    const detail = String(input.detail || '').trim();
    if(!detail) return { text:'A job needs to say what it does. Ask the user what they want it to do each time it runs.', render:null };
    let agentId = '';
    if(input.agent){
      const got = await _crewAgentId(input.agent);
      if(got.error) return { text: got.error, render:null };
      agentId = got.id;
    }
    const asked = String(input.repeat || '');
    const approval = ['suggest','require','auto'].includes(input.approval) ? input.approval : 'require';
    if(asked === 'once'){
      const at = _crewOnceAt(input);
      if(!at) return { text:'A one-time job needs a date ("YYYY-MM-DD") and a time ("HH:MM") that are still to come and within a year. Ask the user exactly when, then call again.', render:null };
      let o;
      try{ o = await _autoApi('/auto/create', Object.assign({ detail, repeat:'once', firstRunAt:at, kind:'task', approval, notify:'app' }, agentId ? { agent: agentId } : {})); }
      catch(e){ return { text: _crewErr(e), render:null }; }
      _crewSynced();
      return { text:'Created. It runs once, ' + new Date(at).toLocaleString([], { weekday:'long', month:'long', day:'numeric', hour:'numeric', minute:'2-digit' })
        + ' on their clock, on AMV\u2019s servers - with their computer off and AMV closed - and is then finished. It is in their Crew tab now.'
        + ({ auto:' The result is delivered without review.', suggest:' It will NOT run on its own - AMV tells them it is due.',
             require:' The result waits for their approval.' }[String((o.item && o.item.approval) || approval)] || ''), render:null };
    }
    const repeat = asked === 'monthly' ? 'weekly' : _CREW_REPEATS.includes(asked) ? asked : 'daily';
    const sched = _crewSchedOf(asked || 'daily', input);
    let d;
    try{
      d = await _autoApi('/auto/create', Object.assign({ detail, repeat, kind:'task', approval, notify:'app' }, sched ? { sched } : {}, agentId ? { agent: agentId } : {}));
    }catch(e){ return { text: _crewErr(e), render:null }; }
    _crewSynced();
    /* The server is allowed to give a free account something smaller than was
       asked for. Saying "done, every 10 minutes" when it made a weekly job is
       the exact lie this whole path is built to avoid, so the model is handed
       the shaping message and told to pass it on. */
    const made = d.item || {};
    const gotRepeat = String(made.repeat || repeat);
    const shaped = gotRepeat !== repeat || d.shaped;
    const firstAt = Number(made.next) ? new Date(Number(made.next)).toLocaleString([], { weekday:'long', hour:'numeric', minute:'2-digit' }) : '';
    return { text:'Created. It is in their Crew tab now and runs ' + _crewWhen(made)
      + ' on AMV\u2019s servers - with their computer off and AMV closed.'
      + (firstAt ? ' First run: ' + firstAt + '.' : '')
      + ({ auto:' Results are delivered without review.',
           suggest:' It will NOT run on its own - AMV tells them it is due and waits to be asked, which costs nothing.',
           require:' Each result waits for their approval.' }[String(made.approval||'require')] || '')
      + (shaped ? ' IMPORTANT - tell the user this part: ' + (d.shapedWhy || 'their plan runs it ' + (_CREW_EVERY[gotRepeat]||'less often') + ' rather than what was asked for.') : ''),
      render:null };
  }

  if(name === 'crew_steps'){
    const raw = Array.isArray(input.steps) ? input.steps : [];
    const steps = raw.map(s => ({ title: String((s && s.title) || '').trim().slice(0, 80), detail: String((s && s.detail) || '').trim(),
                                  ...(s && Number.isInteger(s.after) ? { after: s.after }
                                      : s && Array.isArray(s.after) && s.after.length ? { after: s.after.filter(Number.isInteger).slice(0, 4) } : {}) }));
    if(steps.length < 2 || steps.length > 5 || steps.some(s => !s.detail))
      return { text:'A task in steps needs two to five steps, each saying what it does. For one step, use crew_add or just do it now.', render:null };
    const approval = input.approval === 'auto' ? 'auto' : 'require';
    for(let i = 0; i < raw.length; i++){
      const want = raw[i] && raw[i].agent;
      if(!want) continue;
      const got = await _crewAgentId(want);
      if(got.error) return { text: got.error, render:null };
      steps[i].agent = got.id;
    }
    let d;
    try{ d = await _autoApi('/auto/create', { steps, approval, notify:'app' }); }
    catch(e){ return { text: _crewErr(e), render:null }; }
    _crewSynced();
    const made = d.items || [];
    return { text:'Started. ' + made.length + ' steps are in their Crew tab, running on AMV\u2019s servers: the first starts within about '
      + ((d.startsWithinMin || 1) === 1 ? 'a minute' : d.startsWithinMin + ' minutes') + ', and each later step starts when the step or steps it waits for have finished, building on their results. '
      + 'It keeps going with their computer off and AMV closed. '
      + (approval === 'auto' ? 'The final result is delivered without review. ' : 'The final result waits for their approval. ')
      + 'If a step fails, the steps after it do not run, and Crew says which one stopped it. Do NOT say it has finished or describe results - nothing has run yet.',
      render: _crewStepsCard(made) };
  }

  if(name === 'crew_watch'){
    const detail = String(input.detail || '').trim();
    const L = (v) => (Array.isArray(v) ? v : []).map(x => String(x || '').trim()).filter(Boolean).slice(0, 5);
    const src = ['calendar', 'page', 'hook', 'github'].includes(input.source) ? input.source : 'mail';
    const when = src === 'page' ? { source: src, url: String(input.url || '').trim(), appears: L(input.appears), disappears: L(input.disappears) }
               : src === 'github' ? { source: src, repo: String(input.repo || '').trim(), events: L(input.events), words: L(input.words) }
               : src === 'calendar' || src === 'hook' ? { source: src, words: L(input.words) }
               : { from: L(input.from), subject: L(input.subject), words: L(input.words) };
    if(!detail) return { text:'A watch needs to say what to do when something matches. Ask the user.', render:null };
    if(src === 'page' && !/^https:\/\//i.test(when.url))
      return { text:'A page watch needs the page\u2019s full https address. Ask the user for it.', render:null };
    if(src === 'page' && !when.appears.length && !when.disappears.length)
      return { text:'A page watch needs words to look for - appearing on the page, or disappearing from it. Ask the user which.', render:null };
    if(src === 'github' && !/^[\w.-]+\/[\w.-]+$/.test(when.repo.replace(/^https:\/\/github\.com\//i, '').replace(/\.git$|\/$/g, '')))
      return { text:'A GitHub watch needs the repository as owner/name. Ask the user which.', render:null };
    if(src === 'calendar' && !when.words.length)
      return { text:'A calendar watch needs words to look for in new events. Ask the user which.', render:null };
    if(src === 'mail' && !when.from.length && !when.subject.length && !when.words.length)
      return { text:'A watch needs something to watch for - a sender, words in the subject, or words in the message. Ask the user which.', render:null };
    let d;
    try{ d = await _autoApi('/auto/create', { detail, repeat:'10min', when, kind:'task', notify:'app', approval: input.approval === 'require' ? 'require' : 'auto' }); }
    catch(e){ return { text: _crewErr(e), render:null }; }
    _crewSynced();
    if(src === 'hook'){
      /* The address is the key to the job: shown to them once here, and again
         from the job's row in Crew whenever they need it. */
      return { text:'Set up. It is in their Crew tab and runs when another service sends a request to its own address'
        + (when.words.length ? ' that mentions ' + when.words.join(' or ') : '') + '. The address is: ' + (d.hookUrl || '(open Crew and press Copy address)')
        + ' - tell them to paste it where that service asks for a webhook or notification URL (method POST). Requests close together are read in one run, at most once every five minutes. '
        + 'Anybody holding the address can start the job, so tell them to keep it private; Crew has "New address" to replace it. What is sent is read as information, never as instructions, and the job can still only write - it cannot send, buy or touch an account. Do not say anything has arrived yet.', render:null };
    }
    const where = { mail:'checks their new mail', calendar:'checks their calendar for new events', page:'looks at that page', github:'checks ' + when.repo + ' on GitHub' }[src];
    const first = { mail:'Its first check only notes where the inbox is, so mail that is already there will not set it off - only mail that arrives from now on. ',
                    calendar:'Its first check only notes the events already there, so only events added from now on can set it off. ',
                    page:'Its first look only records what the page says now, so words already on it will not set it off - only a change from now on. ',
                    github:'Its first look only records what has already happened on the repository, so only new activity from now on can set it off. ' }[src];
    const needs = { mail:' It needs their Google mail connected to watch.', calendar:' It needs their Google calendar connected to watch.',
                    page:' It reads only the public page; it cannot see anything behind a sign-in.',
                    github:' It needs their GitHub connected (Integrations) and only reads - it cannot comment, merge or push.' }[src];
    return { text:'Set up. It is in their Crew tab and ' + where + ' every ten minutes on AMV\u2019s servers, with their computer off. '
      + first + 'Checks that find nothing cost nothing and post nothing.' + needs + ' Do not say anything has matched yet.', render:null };
  }

  if(name === 'crew_ceiling'){
    const lvl = String(input.ceiling||'');
    if(!['suggest','require','auto'].includes(lvl))
      return { text:'That is not one of the three levels. They are: suggest (nothing runs until asked), require (work is done, waits for approval), auto (delivers on its own). Ask the user which they meant.', render:null };
    let d;
    try{ d = await _autoCeiling(lvl); }
    catch(e){ return { text: _crewErr(e), render:null }; }
    _crewSynced();
    const n = typeof d.restrains === 'number' ? d.restrains : 0;
    const say = { suggest:'No background job will run on its own now. AMV tells them a job is due and waits to be asked, so nothing is spent either.',
                  require:'Background jobs will do the work but nothing goes out until they approve it.',
                  auto:'Background jobs may complete and deliver on their own again.' }[lvl];
    return { text: say
      + (n ? ' ' + n + ' of their jobs ' + (n===1?'is':'are') + ' set further than this and ' + (n===1?'is':'are')
           + ' now held back - the ' + (n===1?'job keeps its':'jobs keep their') + ' own setting, so raising this later restores it.' : '')
      + ' This is enforced by the server when each job runs, not by the app.', render:null };
  }

  if(name === 'crew_standing'){
    const text = String(input.standing == null ? '' : input.standing);
    let d;
    try{ d = await _autoStanding(text); }
    catch(e){ return { text: _crewErr(e), render:null }; }
    _crewSynced();
    const n = typeof d.appliesTo === 'number' ? d.appliesTo : 0;
    if(!String(d.standing || '').trim())
      return { text:'Cleared. Their background jobs go back to running the standard way.', render:null };
    return { text:'Saved, and it is real: the server puts this in front of every background run, so the next run of '
      + (n ? 'all ' + n + ' of their jobs' : 'anything they set up') + ' follows it. '
      + 'It changes how the work is done - it does not change what AMV is allowed to do, so do not tell them it grants any new permission.', render:null };
  }

  /* Everything below acts on one specific job. */
  const found = await _crewFind(input);
  if(found.error) return { text: found.error, render:null };
  const item = found.item;
  const what = String(item.detail || '').slice(0, 90);

  try{
    if(name === 'crew_pause'){
      if(item.active === false) return { text:'That job ("' + what + '") is already paused. Nothing to do - say so.', render:null };
      await _autoApi('/auto/update', { id:item.id, action:'pause' });
      _crewSynced();
      return { text:'Paused "' + what + '". It stays in their Crew tab and will not run until they resume it.', render:null };
    }
    if(name === 'crew_resume'){
      if(item.active !== false) return { text:'That job ("' + what + '") is already running. Nothing to do - say so.', render:null };
      await _autoApi('/auto/update', { id:item.id, action:'resume' });
      _crewSynced();
      return { text:'Resumed "' + what + '". Its next run is one full interval from now, not immediately.', render:null };
    }
    if(name === 'crew_remove'){
      await _autoApi('/auto/update', { id:item.id, action:'delete' });
      _crewSynced();
      return { text:'Deleted "' + what + '" and its history. It will not run again. If they only wanted it stopped for now, tell them it can be set up again.', render:null };
    }
    if(name === 'crew_update'){
      const patch = { id:item.id, action:'edit' };
      if(typeof input.detail === 'string' && input.detail.trim()) patch.detail = input.detail.trim();
      const askedRepeat = String(input.repeat || '');
      if(askedRepeat === 'monthly') patch.repeat = 'weekly';
      else if(_CREW_REPEATS.includes(askedRepeat)) patch.repeat = askedRepeat;
      /* A new time keeps the cadence it has unless a new one was given. */
      if(input.time){
        const cad = askedRepeat || (item.sched && item.sched.cad) || item.repeat || 'daily';
        const base = item.sched || {};
        const sc = _crewSchedOf(cad, Object.assign({ days: (base.days || []).map(d => ['sun','mon','tue','wed','thu','fri','sat'][d]), day_of_month: base.dom }, input));
        if(!sc) return { text:'That time could not be used - give it as 24-hour HH:MM for a daily, weekly or monthly job. Nothing was changed.', render:null };
        patch.sched = sc;
      }
      if(['suggest','require','auto'].includes(input.approval)) patch.approval = input.approval;
      if(!patch.detail && !patch.repeat && !patch.approval && !patch.sched)
        return { text:'Nothing was actually changed - no new instruction, time, frequency or approval setting was given. Ask the user what they want changed.', render:null };
      await _autoApi('/auto/update', patch);
      _crewSynced();
      return { text:'Updated "' + what + '".'
        + (patch.detail ? ' It now does: ' + patch.detail.slice(0,120) + '.' : '')
        + (patch.sched ? ' It now runs ' + _crewWhen({ sched: patch.sched }) + ' on their clock.'
           : patch.repeat ? ' It now runs ' + (_CREW_EVERY[patch.repeat] || patch.repeat) + ', starting one interval from now.' : '')
        + (patch.approval ? ({ auto:' Results are now delivered without review.',
                              suggest:' It will no longer run on its own - AMV will say it is due and wait to be asked.',
                              require:' Each result now waits for their approval.' }[patch.approval] || '') : ''),
        render:null };
    }
  }catch(e){ return { text: _crewErr(e), render:null }; }

  return { text:'Unknown crew action: ' + name, render:null };
}


/* ══════════════════════════════════════════════════════════════
   THE REST OF THE PRODUCT, FROM CHAT

   Memory, the approvals queue, and what the account has actually used. Same
   discipline as the Crew tools: each one goes through what the section itself
   uses, so a fact has one home; nothing is guessed when it is ambiguous; and
   every failure comes back as an instruction to say so rather than as silence
   the model will paper over.

   The two that deserve more care than they look like they need:

   - A MEMORY IS APPENDED TO EVERY FUTURE REQUEST. Writing one is writing a
     small permanent instruction, which is the same shape of risk as the
     standing instruction and gets the same treatment: the person is shown the
     exact words and asked, and secrets are refused outright rather than stored
     in something designed to be repeated back.
   - APPROVING IS WHAT SENDS. The approvals queue exists because something
     stopped short of acting; approving is the act. So the dialog says that in
     those words, and the model is told to read the person the summary before
     it asks.
   ══════════════════════════════════════════════════════════════ */

/* _MEM_SECRET, _MEM_CARDISH and _memLooksSecret are defined in
   07-workspace-memory.js, beside the Memory tab that also uses them. They live
   in the EARLIER module on purpose: both doors into the memory store have to
   apply the same refusal, and a shared constant declared after one of its users
   is an ordering dependency waiting to be noticed the hard way. */
const _MEM_MAX = 400;

function _memList(){
  try{ return (typeof S!=='undefined' && Array.isArray(S.memory)) ? S.memory : []; }catch(e){ return []; }
}
function _memRepaint(){
  try{ if(typeof S!=='undefined' && S.tab==='memory' && typeof renderMemoryView==='function') renderMemoryView(); }catch(e){}
}
/* One memory, or an explanation - never a best guess, because forgetting the
   wrong thing is silent and they only discover it when AMV stops knowing
   something it should. */
function _memFind(input){
  const list = _memList();
  const id = String((input && input.id) || '').trim();
  if(id){
    const hit = list.find(m => m.id === id);
    if(hit) return { item: hit };
    return { error:'There is no memory with that id. Call memory_list for the real ones and tell the user if the thing they meant is not there.' };
  }
  const q = String((input && input.match) || '').trim().toLowerCase();
  if(!q) return { error:'Which memory? Call memory_list and pass the id of the one they mean.' };
  const words = q.split(/\s+/).filter(w => w.length > 2);
  const hits = list.filter(m => {
    const hay = String(m.text||'').toLowerCase();
    return hay.includes(q) || (words.length > 0 && words.every(w => hay.includes(w)));
  });
  if(hits.length === 1) return { item: hits[0] };
  if(hits.length === 0)
    return { error: list.length
      ? 'Nothing remembered matches that. What AMV remembers is: '
        + list.map(m => m.id + ' - ' + String(m.text||'').slice(0,70)).join(' | ')
        + '. Ask the user which they meant.'
      : 'AMV does not remember anything about them yet, so there is nothing to forget. Say so.' };
  return { error:'That matches ' + hits.length + ' memories, so it is not clear which: '
                 + hits.map(m => m.id + ' - ' + String(m.text||'').slice(0,70)).join(' | ')
                 + '. Ask the user which one before removing anything.' };
}

function _sectionErr(e){
  const msg = (e && e.message) || 'the server did not accept it';
  if(msg === 'not-connected' || /not-connected/.test(msg))
    return 'AMV is not connected to its engine, so that could not be done. Tell the user plainly and do NOT say it worked.';
  return 'That did not work: ' + msg + '. Tell the user plainly - do NOT say it worked.';
}

async function _sectionTool(name, input){
  input = input || {};

  /* ---- Memory ---- */
  if(name === 'memory_list'){
    const list = _memList();
    if(!list.length) return { text:'AMV does not remember anything about them yet.', render:null };
    return { text:'What AMV remembers about them (' + list.length + '):\n'
      + list.map(m => '- [' + m.id + '] ' + String(m.text||'').slice(0,200)).join('\n')
      + '\n\nAll of these are included in every conversation.', render:null };
  }

  if(name === 'memory_add'){
    if(_isTempChat())
      return { text:'Not saved: this is a temporary chat, so nothing from it is remembered. Tell the user so, and that they can say it again in a normal chat if they want AMV to keep it.', render:null };
    const text = String(input.text||'').trim().slice(0, _MEM_MAX);
    if(text.length < 3) return { text:'That is not enough to remember. Ask the user what exactly they want AMV to know.', render:null };
    /* Refused rather than stored. A memory is replayed into every future
       request, which makes it the worst possible place for a credential -
       and the person asking has almost certainly not thought about that. */
    if(_memLooksSecret(text))
      return { text:'Refused: that looks like a password, key, card number or other secret. AMV includes every memory in every future conversation, so it will not store one. Tell the user plainly why, and offer to remember something that is not the secret itself.', render:null };
    if(_memList().some(m => String(m.text||'').trim().toLowerCase() === text.toLowerCase()))
      return { text:'AMV already remembers exactly that. Nothing to do - say so rather than confirming a second save.', render:null };
    try{
      S.memory = [{ id:'m'+Date.now()+Math.random().toString(36).slice(2,5), text, added: Date.now() }].concat(_memList());
    }catch(e){ return { text:_sectionErr(e), render:null }; }
    _memRepaint();
    return { text:'Remembered, and it is in the Memory tab where they can edit or delete it. From now on it is included in every conversation.', render:null };
  }

  if(name === 'memory_forget'){
    const found = _memFind(input);
    if(found.error) return { text: found.error, render:null };
    const what = String(found.item.text||'').slice(0,90);
    try{
      S.memory = _memList().filter(m => m.id !== found.item.id);
    }catch(e){ return { text:_sectionErr(e), render:null }; }
    _memRepaint();
    return { text:'Forgotten: "' + what + '". It will not be included in future conversations.', render:null };
  }

  /* ---- The approvals queue ---- */
  if(name === 'approvals_list'){
    let items = [];
    try{
      items = (window.AMV_API && AMV_API.live && typeof AMV_API.approvals==='function')
        ? await AMV_API.approvals()
        : (typeof _cwApprovals==='function' ? _cwApprovals() : []);
    }catch(e){ return { text:_sectionErr(e), render:null }; }
    if(!items.length) return { text:'Nothing is waiting for them. Say they are all caught up.', render:null };
    return { text:'Waiting for their approval (' + items.length + '):\n'
      + items.map(a => '- [' + a.id + '] ' + String(a.title||'Untitled').slice(0,120)
          + (a.actionType === 'send' ? ' - APPROVING THIS SENDS IT' : ' - review only')
          + (a.preview ? '\n    ' + String(a.preview).replace(/\s+/g,' ').slice(0,200) : '')).join('\n')
      + '\n\nNothing here has been sent. Read them the summary of the one they care about before doing anything with it.', render:null };
  }

  if(name === 'approval_act'){
    const id = String(input.id||'').trim();
    const action = input.action === 'reject' ? 'reject' : 'approve';
    if(!id) return { text:'Which one? Call approvals_list and pass the id.', render:null };
    let d;
    try{
      if(!(window.AMV_API && AMV_API.live && typeof AMV_API.actApproval==='function')) throw new Error('not-connected');
      d = await AMV_API.actApproval(id, action);
    }catch(e){ return { text:_sectionErr(e), render:null }; }
    try{ if(typeof S!=='undefined' && S.tab==='crew' && typeof renderCrewView==='function') renderCrewView(); }catch(e){}
    if(action === 'reject') return { text:'Rejected and discarded. It will not be sent.', render:null };
    /* The server says whether approving actually DELIVERED it. Reporting
       "sent" when there was no way to send is the exact failure the approve
       path was rebuilt to stop, so it is repeated honestly here. */
    if(d && d.delivered === false)
      return { text:'Approved - but it could NOT be delivered, because this deployment has no email provider connected. Tell the user it is approved and still undelivered, and that connecting email in Settings is what fixes it. Do not say it was sent.', render:null };
    if(d && d.delivered === true) return { text:'Approved and sent.', render:null };
    return { text:'Approved. It was a review-only item, so there was nothing to send - it is simply resolved.', render:null };
  }

  /* ---- What the account has actually used ---- */
  if(name === 'account_status'){
    const plan = (()=>{ try{ return loadStr('amv_plan') || 'free'; }catch(e){ return 'free'; } })();
    let usage = null;
    try{ usage = (typeof AMVUsage!=='undefined') ? AMVUsage.status() : null; }catch(e){}
    let auto = null;
    try{ auto = await _autoApi('/auto/list', {}); }catch(e){ /* background work is optional context */ }

    const lines = ['Plan: ' + plan + '.'];
    if(usage && typeof usage.remaining === 'number'){
      lines.push('Usage this period: ' + usage.used + ' of ' + usage.cap
        + ' (' + usage.remaining + ' left'
        + (usage.resetsInMs ? ', resets in about ' + Math.max(1, Math.round(usage.resetsInMs/3600000)) + 'h' : '') + ').');
    }
    if(auto){
      const items = auto.items || [];
      const spent = (auto.results||[]).reduce((t,r)=>t + (Number(r.costUSD)||0), 0);
      lines.push('Background jobs: ' + items.length
        + (typeof auto.maxAutomations === 'number' ? ' of ' + auto.maxAutomations + ' allowed' : '')
        + ', ' + items.filter(x=>x.active!==false).length + ' running.');
      lines.push('Spent on background work in the visible record: $' + spent.toFixed(2) + '.');
      if(auto.ceiling && auto.ceiling !== 'auto')
        lines.push('Their account holds background work at "' + auto.ceiling + '", so jobs set further are held back.');
    } else {
      lines.push('Background work could not be read, so do not state anything about their jobs.');
    }
    return { text: lines.join(' ') + ' These are the real numbers - never estimate them.', render:null };
  }

  return { text:'Unknown action: ' + name, render:null };
}
try{ window._sectionTool = _sectionTool; }catch(e){}

try{ window.AMV_TOOLS=AMV_TOOLS; window._amvRunTool=_amvRunTool; window._crewTool=_crewTool; window._sectionTool=_sectionTool; }catch(e){}

/* ══════════════════════════════════════════════════════════════
   CONTEXT WINDOW MANAGEMENT
   A conversation has a finite context. We track it, warn as it
   fills, and when it's full you start a new chat - but you can carry a
   COMPRESSED handoff across so nothing is lost and you pick up exactly where
   you left off.
   ══════════════════════════════════════════════════════════════ */
const CTX_LIMIT_TOKENS = 180000;      // usable context budget
const CTX_MAX_FILES    = 100;         // max files in a Dev project
/* THE BIGGEST SINGLE FILE THAT CAN BE OPENED.

   It was 800,000 bytes, which sounds generous and is not: ten thousand lines
   of ordinary code is 544KB and fits, the same ten thousand lines at ninety
   columns is 1MB and did not. Somebody uploading a real file has no idea which
   side of that they are on, and the old code did not tell them.

   Five megabytes covers fifty thousand lines of source with room to spare.
   Above it the answer is a refusal that names the file, not a silent skip -
   and the storage layer already reports honestly if a project this size
   cannot be saved between sessions, so a bigger ceiling does not buy a new
   silent failure. */
const DEV_MAX_FILE_BYTES = 5000000;
const CTX_WARN_AT      = 0.75;        // show a nudge
const CTX_FULL_AT      = 0.92;        // must start a new chat

// ~4 chars per token is the standard rough estimate.
function _tok(str){ return Math.ceil(String(str||'').length / 4); }

/* _ctxUsage and _ctxUsageDev counted the whole conversation against the
   180k budget and existed only to feed the percentage over the composer.
   That percentage was measuring content the request did not send - the
   history had already been cut to the last twenty turns - and it is gone,
   so the arithmetic behind it goes with it rather than sitting here as a
   number nothing reads and nobody can check. What replaced it is
   `_ctxSplit`, which measures what is actually sent. */

// Build a COMPRESSED handoff of the current chat/session. Small enough to paste,
// complete enough that a fresh chat continues seamlessly.
async function _ctxBuildHandoff(kind){
  kind = kind || 'chat';
  let convo = '', projectManifest = '', title = '';
  if(kind === 'dev'){
    title = 'Dev session';
    convo = (_DEV.log||[]).map(m=>(m.role==='user'?'User: ':'AMV: ')+(m.text||'')).join('\n');
    const proj = _DEV.project||{};
    const paths = Object.keys(proj);
    projectManifest = paths.length
      ? '\n\nPROJECT FILES ('+paths.length+'):\n'+paths.map(p=>'- '+p+' ('+((proj[p].content||'').split('\n').length)+' lines)').join('\n')
      : '';
  } else {
    const c = (S.convs||[]).find(c=>c.id===S.cid);
    title = (c && c.title) || 'Conversation';
    convo = ((typeof getMsgs==='function'?getMsgs():[])||[]).map(m=>(m.r==='u'?'User: ':'AMV: ')+(m.c||'')).join('\n');
  }
  // Ask the model to compress it. If that's unavailable, fall back to a trim.
  let summary = '';
  try{
    summary = await aiComplete(
      'Compress this conversation into a HANDOFF BRIEF so a fresh session can continue seamlessly. Include: the goal, every decision made, the current state, open problems, and exact next steps. Keep all specifics (names, numbers, file paths, choices). Be dense - no filler.\n\n' + convo.slice(-60000),
      'You write handoff briefs that let a new session resume work with zero loss of context.',
      { max_tokens: 3000, noLang: true }
    );
  }catch(e){
    summary = convo.slice(-8000);   // offline fallback: keep the tail
  }
  return {
    v: 1,
    kind,
    title,
    createdAt: Date.now(),
    summary,
    manifest: projectManifest,
    files: kind==='dev' ? Object.keys(_DEV.project||{}) : [],
    memory: (S.memory||[]).slice(0, 40),
  };
}

// Encode a handoff into a compact, pasteable token.
function _ctxEncode(h){
  try{
    const json = JSON.stringify(h);
    // compress: deflate -> base64 (falls back to plain base64 if unsupported)
    const bytes = new TextEncoder().encode(json);
    let bin=''; bytes.forEach(b=>bin+=String.fromCharCode(b));
    return 'AMVCTX1:' + btoa(bin);
  }catch(e){ return 'AMVCTX1:' + btoa(unescape(encodeURIComponent(JSON.stringify(h)))); }
}
function _ctxDecode(str){
  try{
    const s = String(str||'').trim().replace(/^AMVCTX1:/, '');
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  }catch(e){ return null; }
}
/* WHAT THE CHAT SAYS ABOUT ITS OWN LENGTH, WHICH IS ALMOST NOTHING NOW.

   This used to render "Context 75% full" from halfway, and at 92% told you
   the chat was full and to start a new one. Both were wrong. The percentage
   measured the whole conversation against a budget that was never what got
   sent - the request had already been cut to the last twenty turns - and
   "full" described a limit the product had invented for itself.

   A long chat now compacts in place, so there is no full and nothing to do.
   What is left is the two things somebody genuinely benefits from knowing:
   that older turns are now travelling as a summary rather than verbatim, and
   - the one that matters - that AMV could NOT summarise them, because
   without an engine it has no way to, and turns are being left out.

   The file count stays. CTX_MAX_FILES is a real ceiling with a real refusal
   behind it, which is a different kind of fact from a percentage. */
function _ctxRenderMeter(hostId, kind){
  const host=$(hostId); if(!host) return;
  const conv = (kind!=='dev' && typeof getCurConv==='function') ? getCurConv() : null;
  const compact = conv && conv.compact;
  /* Asked, not re-derived. Two places deciding what "degraded" means is how
     the meter and the request come to disagree about it. */
  const degraded = _ctxDegraded(conv);
  const summarised = !!(compact && compact.summary);

  let files = 0;
  if(kind==='dev'){ try{ files = Object.keys(_DEV.project||{}).length; }catch(e){} }
  const filesTight = kind==='dev' && files >= CTX_MAX_FILES*0.8;

  if(!degraded && !summarised && !filesTight){ host.innerHTML=''; return; }

  if(degraded){
    host.innerHTML =
      '<div class="ctx-note-line ctx-degraded">'+
        'Older messages in this chat are not being sent - AMV needs its engine connected '+
        'to summarise them. Everything you can see is still here.'+
      '</div>';
    return;
  }
  if(filesTight){
    host.innerHTML =
      '<div class="ctx-note-line">'+files+' of '+CTX_MAX_FILES+' files in this project.</div>';
    return;
  }
  /* Summarised, and nothing is wrong. One quiet line, no number, no button:
     the chat is working exactly as intended and there is nothing to decide. */
  host.innerHTML =
    '<div class="ctx-note-line">Earlier messages are summarised so this chat can keep going.</div>';
}

// Compress the current context, start fresh, and resume seamlessly.
async function _ctxHandoffFlow(kind){
  const r=$('ovr'); if(!r) return;
  r.innerHTML='<div class="ov"><div class="ob" style="max-width:460px">'+
    '<div style="font-size:var(--t-prose);font-weight:600;margin-bottom:6px">Carrying your context over\u2026</div>'+
    '<div style="font-size:var(--t-base);color:var(--mu);line-height:1.6" id="ctx-step">Compressing everything important from this '+(kind==='dev'?'session':'chat')+'\u2026</div>'+
    '<div class="ctx-bar" style="margin-top:14px"><div class="ctx-fill" id="ctx-anim" style="width:15%"></div></div>'+
  '</div></div>';
  r.classList.add('on');
  try{
    const h = await _ctxBuildHandoff(kind);
    const token = _ctxEncode(h);
    const st=$('ctx-step'); const an=$('ctx-anim');
    if(an) an.style.width='100%';
    if(st) st.textContent='Done. Starting fresh with your handoff loaded.';
    // Save the handoff so it can also be downloaded / pasted later.
    try{
      const all=load('amv_handoffs')||[];
      all.unshift({ id:'h'+Date.now(), kind, title:h.title, token, at:Date.now() });
      store('amv_handoffs', all.slice(0,20));
    }catch(e){}
    await new Promise(res=>setTimeout(res,550));
    closeOvr();
    _ctxResume(h, kind, token);
  }catch(e){
    closeOvr();
    toast('Could not build the handoff: '+e.message,'error',5000);
  }
}

// Start the new chat/session pre-loaded with the handoff.
function _ctxResume(h, kind, token){
  if(kind==='dev'){
    try{ _sessLeave('dev'); _sessNew('dev'); _resetToolState('dev'); }catch(e){}
    _DEV.handoff = h;                       // rides along in the next prompt
    setTab('dev');
    try{ _devPushSys('Picked up from your last session. I have the full handoff - goal, decisions, current state, and next steps. Tell me what to do next, or say "continue".'); _devRenderLog(); }catch(e){}
  } else {
    try{ newChat(); }catch(e){}
    S._chatHandoff = h;                     // rides along in the next prompt
    setTab('chat');
    try{
      const msgs=getMsgs();
      msgs.push({r:'a', c:'**Picked up where we left off.** I have a compressed handoff of the previous chat - the goal, every decision, the current state, and the next steps.\n\nTell me what you want next, or just say "continue".\n\n*You can download this handoff or reuse it later from Handoffs (\u2318K \u2192 "handoff").*', _t:Date.now()});
      /* _autoSave, not saveConvs - which is defined nowhere. It threw a
         ReferenceError into the empty catch below, so this message was drawn
         and never persisted: reload and the handoff you just carried over had
         vanished from the chat. */
      renderChatMsgs(); _autoSave();
    }catch(e){}
  }
  toast('Context carried over - you can pick up right where you left off.','success',4500);
}

// Download a handoff as a .amvctx file.
function _ctxDownload(token, title){
  try{
    const blob=new Blob([token],{type:'text/plain'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download='amv-handoff-'+String(title||'session').toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40)+'.amvctx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
    toast('Handoff downloaded. Paste it into any new chat to pick up exactly where you left off.','success',5000);
  }catch(e){ toast('Could not download: '+e.message,'error',4000); }
}
try{ window._ctxDownload=_ctxDownload; }catch(e){}

// The handoff manager: download past handoffs, or paste one in to resume.
function openHandoffManager(){
  const r=$('ovr'); if(!r) return;
  const all=(()=>{ try{ return load('amv_handoffs')||[]; }catch(e){ return []; } })();
  const rows = all.length
    ? all.map(h=>'<div class="ho-row">'+
        '<div class="ho-row-l"><div class="ho-row-t">'+escH(h.title||'Session')+'</div>'+
          '<div class="ho-row-m">'+escH(h.kind==='dev'?'Dev session':'Chat')+' \u00b7 '+new Date(h.at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+'</div></div>'+
        '<div class="ho-row-r">'+
          '<button class="btn bs" data-ho-dl="'+escH(h.id)+'" style="font-size:var(--t-sm)">Download</button>'+
          '<button class="btn bp" data-ho-use="'+escH(h.id)+'" style="font-size:var(--t-sm)">Resume</button>'+
        '</div></div>').join('')
    : '<div class="ho-empty">No handoffs yet. When a chat or Dev session fills up, AMV creates one automatically.</div>';
  r.innerHTML='<div class="ov" id="ho-bg"><div class="ob" style="max-width:560px">'+
    '<div style="font-size:var(--t-lg);font-weight:600;margin-bottom:4px">Context handoffs</div>'+
    '<div style="font-size:var(--t-sm);color:var(--mu);line-height:1.6;margin-bottom:16px">A handoff is a compressed snapshot of a conversation - the goal, every decision, the current state, and the next steps. Load one into a fresh chat and AMV picks up exactly where you left off.</div>'+
    '<div class="ho-list">'+rows+'</div>'+
    '<div class="ho-paste">'+
      '<label class="lbl">Paste a handoff</label>'+
      '<textarea id="ho-paste-in" rows="3" placeholder="Paste an AMVCTX1:\u2026 handoff here (or the contents of a .amvctx file)" style="width:100%;resize:vertical;font-family:var(--mn,monospace);font-size:var(--t-sm)"></textarea>'+
      '<div style="display:flex;gap:8px;margin-top:9px">'+
        '<button class="btn bs" id="ho-file-btn" style="font-size:var(--t-sm)">Load a .amvctx file</button>'+
        '<button class="btn bp" id="ho-paste-go" style="font-size:var(--t-sm)">Resume from this handoff</button>'+
      '</div>'+
      '<input type="file" id="ho-file" accept=".amvctx,.txt" style="display:none">'+
    '</div>'+
    '<div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn bs" id="ho-close" style="font-size:var(--t-sm)">Close</button></div>'+
  '</div></div>';
  r.classList.add('on');
  on($('ho-close'),'click',closeOvr);
  onBackdrop($('ho-bg'),closeOvr);
  r.querySelectorAll('[data-ho-dl]').forEach(b=>on(b,'click',()=>{
    const h=all.find(x=>x.id===b.dataset.hoDl); if(h) _ctxDownload(h.token, h.title);
  }));
  r.querySelectorAll('[data-ho-use]').forEach(b=>on(b,'click',()=>{
    const h=all.find(x=>x.id===b.dataset.hoUse); if(!h) return;
    const decoded=_ctxDecode(h.token);
    if(!decoded){ toast('That handoff is corrupted.','error',4000); return; }
    closeOvr(); _ctxResume(decoded, decoded.kind||'chat', h.token);
  }));
  // paste a handoff
  on($('ho-paste-go'),'click',()=>{
    const raw=($('ho-paste-in')?.value||'').trim();
    if(!raw){ toast('Paste a handoff first.','error',3000); return; }
    const decoded=_ctxDecode(raw);
    if(!decoded || !decoded.summary){ toast('That doesn\u2019t look like a valid AMV handoff.','error',4500); return; }
    closeOvr(); _ctxResume(decoded, decoded.kind||'chat', raw);
  });
  // load from a file
  on($('ho-file-btn'),'click',()=>$('ho-file')?.click());
  on($('ho-file'),'change',function(){
    const f=this.files&&this.files[0]; if(!f) return;
    const rd=new FileReader();
    rd.onload=(e)=>{ const t=$('ho-paste-in'); if(t) t.value=String(e.target.result||'').trim(); };
    rd.readAsText(f);
    this.value='';
  });
}
try{ window.openHandoffManager=openHandoffManager; }catch(e){}

// Inject the handoff into the next request so the model actually has it.
function _handoffContext(kind){
  try{
    const h = kind==='dev' ? _DEV.handoff : S._chatHandoff;
    if(!h) return '';
    return '\n\n[Handoff from the previous '+(kind==='dev'?'session':'chat')+' - continue seamlessly]\n'+
           (h.summary||'') + (h.manifest||'');
  }catch(e){ return ''; }
}
/* ONE file limit for the whole app. Every place a file can enter - chat,
   Dev, Lab, workspaces, marketplace listings - goes through this guard, so
   the cap is real everywhere and can't be dodged by using another surface. */
function _ctxFileCount(kind){
  try{
    if(kind==='dev')  return Object.keys(_DEV.project||{}).length;
    if(kind==='chat') return (S._chatFiles||[]).length;
    if(kind==='lab')  return (S._labFiles||[]).length;
    if(kind==='workspace'){ const w=(S.workspaces||[]).find(w=>w.id===S.wsId); return (w&&w.files||[]).length; }
    return 0;
  }catch(e){ return 0; }
}
// Returns true if it's OK to add `incoming` more files; otherwise warns and returns false.
function _ctxFileGuard(kind, incoming){
  try{
    const have = _ctxFileCount(kind);
    const n = incoming || 1;
    if(have + n > CTX_MAX_FILES){
      const room = Math.max(0, CTX_MAX_FILES - have);
      toast(
        'File limit reached - '+CTX_MAX_FILES+' files per '+(kind==='chat'?'conversation':'session')+'. '+
        (room ? 'You can add '+room+' more.' : 'Start a new '+(kind==='chat'?'chat':'session')+' and carry a handoff across to keep going.'),
        'error', 6500
      );
      return false;
    }
    return true;
  }catch(e){ return true; }
}
// Track a file against the current surface's count.
function _ctxFileTrack(kind, name){
  try{
    if(kind==='chat'){ S._chatFiles = S._chatFiles||[]; S._chatFiles.push(String(name||'file')); }
    else if(kind==='lab'){ S._labFiles = S._labFiles||[]; S._labFiles.push(String(name||'file')); }
  }catch(e){}
}
try{ window._ctxFileGuard=_ctxFileGuard; window._ctxFileCount=_ctxFileCount; window._ctxFileTrack=_ctxFileTrack; }catch(e){}

try{ window._ctxRenderMeter=_ctxRenderMeter; window._ctxHandoffFlow=_ctxHandoffFlow; window._handoffContext=_handoffContext; }catch(e){}

try{ window._ctxUsage=_ctxUsage; window._ctxUsageDev=_ctxUsageDev; window._ctxBuildHandoff=_ctxBuildHandoff;
     window._ctxEncode=_ctxEncode; window._ctxDecode=_ctxDecode; window.CTX_LIMIT_TOKENS=CTX_LIMIT_TOKENS;
     window.CTX_MAX_FILES=CTX_MAX_FILES; }catch(e){}

