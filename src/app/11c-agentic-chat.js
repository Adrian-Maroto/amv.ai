/* ══════════════════════════════════════════════════════════════
   AGENTIC CHAT  - chat that DOES the work, not just describes it.

   Before this, chat could only search the web. Ask it to "make an image"
   or "build a landing page" or "run this and find the bug" and it would
   talk about it while you went hunting for the right tab.

   Now chat can actually reach every AMV engine. Each tool below is wired
   to a REAL function that already powers a tab - nothing here is a mock.
   ══════════════════════════════════════════════════════════════ */
const AMV_TOOLS = [
  {
    name:'run_code',
    description:'Actually EXECUTE code and return its real output/errors. Use whenever the person wants code run, tested, verified, or when you want to check your own work before answering. Supports js, python, html.',
    input_schema:{ type:'object', properties:{
      code:{type:'string'},
      lang:{type:'string', enum:['js','python','html']}
    }, required:['code','lang'] }
  },
  {
    name:'fix_code',
    description:'Run code, and if it fails, automatically fix it and re-run until it passes. Use when the person has broken code or asks you to debug something.',
    input_schema:{ type:'object', properties:{
      code:{type:'string'},
      lang:{type:'string', enum:['js','python']}
    }, required:['code','lang'] }
  },
  {
    name:'build_app',
    description:'Build a complete, working app/site/page and show it running live. Use when the person asks you to build, make, or create something interactive - a landing page, a game, a dashboard, a tool. Produces a live preview they can use.',
    input_schema:{ type:'object', properties:{
      spec:{type:'string', description:'A full description of what to build, including features and style.'}
    }, required:['spec'] }
  },
  {
    name:'deploy_site',
    description:'Publish a page to a REAL, live, public URL that anyone can open. Use when the person asks to deploy, publish, ship, host, or "put it live", or when they want a shareable link. Returns the live URL.',
    input_schema:{ type:'object', properties:{
      html:{type:'string', description:'The complete HTML document to publish. If you just built something, pass that.'},
      title:{type:'string', description:'A short name for the site.'}
    }, required:['html'] }
  },
  /* ---- The Crew, from chat ----------------------------------------------
     Somebody who says "set that up to run every morning" has already
     described the job perfectly. Making them stop, find the Crew tab, and
     retype it is the product failing at the exact moment it was working.

     These call the same /auto/* routes the Crew screen calls, so a job
     created here is the same record, in the same list, running on the same
     cron - not a parallel idea of a job that chat keeps to itself.

     Reading is free. Anything that starts spending money on a schedule, or
     destroys work, asks the person first - see _TOOL_CONSENT below. */
  /* ---- The rest of the product, from chat -------------------------------
     Same rule as the Crew tools: each one calls what the section itself calls,
     so there is one copy of every fact. Reading is free; anything that
     persists, deletes, or sends asks first. */
  {
    name:'memory_list',
    description:'List what AMV has been told to remember about this person. Use before adding, so you do not store the same fact twice, and to answer "what do you know about me".',
    input_schema:{ type:'object', properties:{} }
  },
  {
    name:'memory_add',
    description:'Remember a durable fact about the person - their work, preferences, constraints, how they want to be answered. Use when they say "remember that..." or state something clearly meant to persist. NOT for one-off details of the current task, and never for a password, card number, or anything else secret.',
    input_schema:{ type:'object', properties:{
      text:{type:'string', description:'The fact, in one clear sentence, written so it still makes sense read on its own in six months.'}
    }, required:['text'] }
  },
  {
    name:'memory_forget',
    description:'Remove something AMV remembers. Call memory_list first and pass the id. Use for "forget that", "that is not true any more".',
    input_schema:{ type:'object', properties:{
      id:{type:'string', description:'The id from memory_list.'},
      match:{type:'string', description:'Only if you have no id: words from the memory. Ambiguous matches are refused rather than guessed.'}
    }, required:[] }
  },
  {
    name:'approvals_list',
    description:'List the finished work waiting for this person to approve - drafts produced by background jobs and by anything else that stops before sending. Use for "what is waiting for me", "anything need me", and before acting on one.',
    input_schema:{ type:'object', properties:{} }
  },
  {
    name:'approval_act',
    description:'Approve or reject a piece of waiting work. APPROVING IS WHAT SENDS IT - for an item that was going to be emailed, approving delivers it. Call approvals_list first, read the person the summary of what it will do, and only act when they have clearly said which one and which way.',
    input_schema:{ type:'object', properties:{
      id:{type:'string', description:'The id from approvals_list.'},
      action:{type:'string', enum:['approve','reject'], description:'"approve" delivers it. "reject" discards it.'}
    }, required:['id','action'] }
  },
  {
    name:'account_status',
    description:'What plan this person is on, what they have used this period, and what their background work has cost. Read-only. Use for "what plan am I on", "how much have I used", "am I near my limit" - never guess these from memory.',
    input_schema:{ type:'object', properties:{} }
  },
  {
    name:'crew_list',
    description:'List the person\'s background (Crew) jobs: what each one does, how often it runs, whether it is active or paused, and their standing instructions. ALWAYS call this before changing or removing a job, so you act on a real id rather than a guess. Also use it to answer any question about what AMV is running for them.',
    input_schema:{ type:'object', properties:{} }
  },
  {
    name:'crew_add',
    description:'Create a real background job that runs on AMV\'s servers on a schedule - overnight, at 8 every morning, every Monday - with their computer off and AMV closed, and appears in the Crew tab. Use when they ask for something to happen regularly ("every morning at 8", "each Friday at 5pm", "on the 1st of every month", "keep an eye on"), or ONCE at a later time ("on Friday at 9, check whether tickets are on sale" - repeat "once" with date and time). Pass the time they said; it runs at that time on THEIR clock. Not for one-off work you can just do now.',
    input_schema:{ type:'object', properties:{
      detail:{type:'string', description:'Exactly what the job should do on each run, written as an instruction to whoever runs it. Be specific - this is all it will have.'},
      repeat:{type:'string', enum:['once','10min','30min','hourly','daily','weekly','monthly'], description:'How often it runs. "once" runs one time, at date and time, and is then finished.'},
      date:{type:'string', description:'For "once" only: the day it runs, "YYYY-MM-DD" on their calendar, within the next year. Work out the real date from what they said ("Friday" is the coming Friday).'},
      time:{type:'string', description:'For once, daily, weekly and monthly jobs: the time it runs, 24-hour "HH:MM" on their own clock - "08:00", "19:30", "03:00" for overnight. Leave out only if they gave no time and none is implied; "every morning" means 08:00.'},
      days:{type:'array', items:{type:'string', enum:['sun','mon','tue','wed','thu','fri','sat']}, description:'For weekly jobs: which days. "weekdays" is mon-fri.'},
      day_of_month:{type:'integer', minimum:1, maximum:31, description:'For monthly jobs: which day (31 means the last day in shorter months).'},
      approval:{type:'string', enum:['suggest','require','auto'], description:'How far it may go alone. "require" (default) does the work and waits for them before anything goes out. "auto" delivers on its own - only for jobs that purely produce information. "suggest" does not run the job at all, it just tells them it is due, which costs nothing.'}
    }, required:['detail'] }
  },
  /* A TASK IN STEPS, ON THE SERVER. Each step is a one-time Crew job that
     waits for the step before it and is handed what that step produced, so a
     task that takes several stages keeps going with the laptop shut. Created
     all at once or not at all (_autoCreateSteps). */
  {
    name:'crew_steps',
    description:'Start a task that runs in STEPS on AMV\'s servers, in the background, starting within about a minute and carrying on with their computer off and AMV closed. Each step can wait for an earlier one and is handed what it produced: "research these three suppliers, then compare them, then draft the email to the best one". Use when they want something multi-stage done in the background or "while I am away", or the work is too long to wait for now. 2-5 steps; the first starts without waiting. Each step counts as one of their plan\'s background jobs until it finishes. Each step is unattended: it can search the web and write, and cannot send, buy, book or touch an account - the result of the last step waits for them. Not for work you can just do now in this answer, and not for something on a schedule (use crew_add).',
    input_schema:{ type:'object', properties:{
      steps:{ type:'array', minItems:2, maxItems:5, items:{ type:'object', properties:{
        title:{type:'string', description:'A few words naming the step, shown to the person.'},
        detail:{type:'string', description:'Exactly what this step does, as an instruction to whoever runs it. It sees this and the result of the step it waits for, nothing else - include everything else it needs.'},
        after:{type:'integer', minimum:0, description:'Which earlier step (0 is the first) it waits for and builds on. Leave out for a step that starts straight away.'}
      }, required:['title','detail'] } },
      approval:{type:'string', enum:['require','auto'], description:'For the LAST step\'s result: "require" (default) waits for them before anything goes out; "auto" delivers it on its own.'}
    }, required:['steps'] }
  },
  /* A TRIGGER: watch the mailbox, and act when something matching arrives.
     The condition is checked by rule on AMV's servers every ten minutes; the
     instruction runs - and is paid for - only when something matched. */
  {
    name:'crew_watch',
    description:'Set up a background job that WATCHES their mail and acts only WHEN a matching email arrives - "when my landlord emails, summarise what she wants", "if anything from the school about trips comes in, tell me the date and cost", "when an invoice arrives, pull out the amount and due date". Checked every ten minutes on AMV\'s servers with their computer off; a check that finds nothing matching costs nothing and posts nothing. Give at least one of from / subject / words. Not for a regular digest of everything (use crew_add) and not for something to do now.',
    input_schema:{ type:'object', properties:{
      detail:{type:'string', description:'What to do with each matching email, as an instruction. It sees the matching emails\' sender, subject and preview.'},
      from:{type:'array', items:{type:'string'}, maxItems:5, description:'Any of these in the sender\'s name or address, e.g. an address, a domain ("@school.org"), or a name.'},
      subject:{type:'array', items:{type:'string'}, maxItems:5, description:'Any of these words in the subject.'},
      words:{type:'array', items:{type:'string'}, maxItems:5, description:'Any of these words in the subject or the start of the message.'},
      approval:{type:'string', enum:['require','auto'], description:'"auto" (default for this) delivers the result on its own - it is information. "require" holds each result for them first.'}
    }, required:['detail'] }
  },
  {
    name:'crew_update',
    description:'Change what an existing background job does, or how often it runs. Call crew_list first to get the id.',
    input_schema:{ type:'object', properties:{
      id:{type:'string', description:'The job id from crew_list. Preferred.'},
      match:{type:'string', description:'Only if you have no id: words from the job, used to find exactly one. Ambiguous matches are refused rather than guessed.'},
      detail:{type:'string', description:'The new instruction, if it is changing.'},
      repeat:{type:'string', enum:['10min','30min','hourly','daily','weekly','monthly'], description:'The new frequency, if it is changing.'},
      time:{type:'string', description:'The new time, 24-hour "HH:MM" on their clock, if it is changing ("move it to 7am" is "07:00").'},
      days:{type:'array', items:{type:'string', enum:['sun','mon','tue','wed','thu','fri','sat']}, description:'For weekly: the new days.'},
      day_of_month:{type:'integer', minimum:1, maximum:31, description:'For monthly: the new day.'},
      approval:{type:'string', enum:['suggest','require','auto']}
    }, required:[] }
  },
  {
    name:'crew_pause',
    description:'Stop a background job from running, keeping it and its history so it can be resumed. Use for "stop", "pause", "hold off on" - it is the safe answer when they want something to stop and you are not certain they want it gone.',
    input_schema:{ type:'object', properties:{
      id:{type:'string'}, match:{type:'string', description:'Words from the job, if you have no id.'}
    }, required:[] }
  },
  {
    name:'crew_resume',
    description:'Start a paused background job running again.',
    input_schema:{ type:'object', properties:{
      id:{type:'string'}, match:{type:'string'}
    }, required:[] }
  },
  {
    name:'crew_remove',
    description:'Delete a background job permanently, along with its history. Prefer crew_pause unless they clearly want it gone.',
    input_schema:{ type:'object', properties:{
      id:{type:'string'}, match:{type:'string'}
    }, required:[] }
  },
  {
    name:'crew_ceiling',
    description:'Set the furthest ANY of their background jobs may go without them, now and for any they add later. Use for "never let anything run without asking me", "stop it doing things on its own", or the opposite. A job set further than this is held back rather than changed, so raising it later restores what each job was configured to do. This is a safety setting - always say plainly what it now means.',
    input_schema:{ type:'object', properties:{
      ceiling:{type:'string', enum:['suggest','require','auto'], description:'"suggest" nothing runs until asked and nothing is spent. "require" work is done but waits for approval before anything goes out. "auto" jobs deliver on their own.'}
    }, required:['ceiling'] }
  },
  {
    name:'connect_account',
    description:'Use whenever the person asks to connect, link, add, hook up or sign in to ANY account, app or service - by name, even one AMV may not know ("connect my Slack", "link my Point72 account", "add my Revolut", "connect QQ Mail"). Pass the name as they said it. This finds the real way to connect it (AMV\'s own connectors, their mailbox, the open connector registry, the bank link for banks and brokerages, and - for anything else with a sign-in, in any country - signing in themselves in a browser on their own computer) and shows them a button; it never connects anything by itself, so NEVER say an account is connected after calling it - they have to press the button and finish the sign-in. Read its result and tell them plainly what is and is not possible.',
    input_schema:{ type:'object', properties:{
      service:{type:'string', description:'The account, app or service, in the person\'s words - e.g. "Slack", "my Point72 account".'},
      url:{type:'string', description:'The service\'s official sign-in or home address, ONLY if you know it for certain (e.g. "https://www.bmi.ir"). It is opened in a browser on their own computer for them to sign in. Leave it out rather than guess - a wrong address is how people are phished.'}
    }, required:['service'] }
  },
  {
    name:'crew_standing',
    description:'Set the standing instructions that apply to EVERY background job they have now and every one they add later - how much care to take, what to prefer, what to leave out. Use for "make my crew think harder", "always check two sources", "keep it shorter". This changes how the work is done; it cannot change what AMV is allowed to do. Pass an empty string to clear it.',
    input_schema:{ type:'object', properties:{
      standing:{type:'string', description:'The instruction, in the person\'s own terms. Replaces any previous one, so include anything from before that still applies.'}
    }, required:['standing'] }
  },
  /* SEVERAL WORKERS AT ONCE, ON ONE TASK.

     "Compare these four laptops", "draft the intro, the method and the
     summary", "review this for security, speed and readability": parts that do
     not depend on each other, done one after another in one long answer. This
     hands each part to a worker of its own, runs up to three at a time, and
     brings every result back here to be combined - the main answer stays in
     charge and writes the final word. */
  {
    name:'delegate',
    description:'Split a task into 2-5 INDEPENDENT parts and have a separate AMV worker do each one at the same time, then combine their results yourself. Use only when the parts genuinely do not depend on each other (compare several options, draft several sections, review from several angles). Each worker sees ONLY its own brief - put everything it needs in the brief. Workers cannot browse, run code or use any tool; they think and write. Each worker counts against the plan like any request, so never use it for something one answer does as well.',
    input_schema:{ type:'object', properties:{
      tasks:{ type:'array', minItems:2, maxItems:5, items:{ type:'object', properties:{
        title:{type:'string', description:'A few words naming this part, shown to the person.'},
        brief:{type:'string', description:'Everything this worker needs: the question, the material, the format to answer in.'}
      }, required:['title','brief'] } }
    }, required:['tasks'] }
  }
];

/* Which tools a given surface gets. Chat gets everything; Dev and Lab get the
   ones that make sense where they are. Before this, ONLY chat had tools at all
   - Dev couldn't ship what it built, Lab couldn't publish a fix. */
function _toolsFor(surface){
  const by = n => AMV_TOOLS.find(t=>t.name===n);
  if(surface==='dev')  return [by('deploy_site'), by('run_code')].filter(Boolean);
  if(surface==='lab')  return [by('run_code'), by('fix_code'), by('deploy_site')].filter(Boolean);
  /* The Crew surface can run the Crew. Talking to AMV on the screen that shows
     your background jobs and not being able to change one of them from there
     is the gap this whole path exists to close. */
  if(surface==='crew') return [by('run_code'), by('build_app'), by('deploy_site'),
                               by('crew_list'), by('crew_add'), by('crew_steps'), by('crew_watch'), by('crew_update'), by('crew_pause'),
                               by('crew_resume'), by('crew_remove'), by('crew_standing'), by('crew_ceiling'),
                               by('connect_account')].filter(Boolean);
  return AMV_TOOLS;   // chat gets everything
}
try{ window._toolsFor=_toolsFor; }catch(e){}

/* ══════════════════════════════════════════════════════════════
   SHARED AGENTIC RUNNER - one tool-use loop, usable from ANY surface.

   Chat had its own loop baked into the streaming path, so Dev, Lab and Crew
   could never use tools at all. This is a surface-agnostic version: give it a
   prompt and a surface, it runs the full request -> tool -> result -> continue
   loop against the real engines and hands back the finished text plus anything
   that should be rendered.
   ══════════════════════════════════════════════════════════════ */
async function runAgentic(surface, userPrompt, opts){
  /* ONE LOOP, NOT TWO.

     This was a second, hand-rolled tool-use loop written when Dev, Lab and
     Crew had no way to use tools at all. It had `await r.json()` against the
     AI proxy - which only ever returns an event stream - so it could not have
     completed a single round in production (LESSONS 309), and nothing has
     ever called it, so nothing noticed. Its entry in the not-a-door list said
     it was "an engine other code calls into"; no other code did.

     `aiAgentLoop` is now that engine, and it is the tested one: it reads the
     stream, retries a busy engine, bounds itself on rounds AND wall clock,
     and can be stopped between steps. So this keeps its name, its arguments
     and its return shape, and becomes the surface-specific part - which tools
     this surface gets, the per-call consent, and the rendered extras - on top
     of that one loop. Deleting it instead would take the consent gate and the
     tool selection with it, and the next person would rewrite both.

     One deliberate difference: `text` now carries everything the model said
     across the whole run rather than only its last round. The old behaviour
     silently dropped anything said before a tool call. */
  opts = opts || {};
  const tools = _toolsFor(surface);
  const onStatus = opts.onStatus || (()=>{});
  let rendered = '';

  const out = await aiAgentLoop({
    prompt: String(userPrompt || ''),
    system: opts.system || 'You are AMV. You have real tools - use them to actually do the work rather than describing it.',
    tools,
    model: opts.model || _sectionModel('code'),
    max_tokens: opts.max_tokens || 8000,
    maxRounds: opts.maxRounds || 4,
    stopped: opts.stopped,
    signal: opts.signal,
    onStep: (ev) => { if(ev.phase === 'start') onStatus('Working\u2026'); },
    runTool: async (name, input) => {
      /* AMV-007. Every name here was chosen by the MODEL, so the request can
         come from content it read rather than from anything the person asked
         for. Chat's streaming loop has always asked first; this path must
         too, or a second dispatch route executes code and publishes pages
         with no prompt at all. */
      const nr = neverRunRefusal(name, input || {});
      if(nr) return { ok:false, text: nr };
      if(_toolNeedsConsent(name)){
        const allowed = await _confirmModelTool(name, input || {});
        if(!allowed){
          try{ if(typeof AEGIS !== 'undefined') AEGIS.log('tool_denied', { tool:name, surface }); }catch(e){}
          return { ok:false, text:'The user DENIED permission to run "' + name + '". Do not attempt it '
                 + 'again unless they explicitly ask for it. Continue helping without it.' };
        }
      }
      const r = await _amvRunTool(name, input || {}, onStatus);
      if(r && r.render) rendered += r.render;
      return { ok:true, text: String((r && r.text) || '') };
    },
  });

  return { text: out.text, rendered, rounds: out.rounds,
           ...(out.why === 'rounds' ? { hitLimit:true } : {}) };
}
try{ window.runAgentic = runAgentic; }catch(e){}

/* Execute a tool the model asked for. Returns a string result for the model,
   plus optional rich content rendered into the chat. */
/* AMV-007: tool authorization. When the MODEL requests a side-effecting or
   code-executing tool, the request may originate from prompt injection or from
   untrusted content the model read - not from the user's actual intent. Those
   tools require an explicit, per-call user approval that shows exactly what will
   happen. User-INITIATED calls (Dev/Lab "Run", explicit buttons) bypass this -
   they ARE the user's intent - so the gate lives only on the agentic
   model-driven dispatch path, never inside _amvRunTool itself. */
/* A background job is the highest-value thing on this list to an attacker: it
   runs unattended, on a schedule, spending money, and it persists long after
   the conversation that created it is gone. So creating one, restarting one,
   deleting one, or editing the instructions that ride along on every run all
   ask first - and the prompt says what will actually happen.

   crew_list and crew_pause do not. Reading their own jobs is not a side effect,
   and pausing STOPS the spending - putting a dialog in front of "stop doing
   that" is the one place a confirmation makes things worse. */
/* THE WORKERS. Bounded on every side: two to five of them, three at a time
   (the free plan allows eight requests a minute, and the main answer needs
   one), a brief of at most 6,000 characters, a short answer each. Pressing
   Stop stops all of them - they ride on this turn's own stop. A worker that
   fails is reported as failed, by name; the others still come back, and the
   main answer is told plainly which part is missing, never handed a gap to
   fill in from nothing. */
const DELEGATE_MAX = 5, DELEGATE_AT_ONCE = 3, DELEGATE_BRIEF_MAX = 6000;
async function _delegateRun(input, onStatus){
  const tasks = (Array.isArray(input && input.tasks) ? input.tasks : [])
    .map(t => ({ title: String((t && t.title) || '').trim().slice(0, 80), brief: String((t && t.brief) || '').trim() }))
    .filter(t => t.title && t.brief);
  if(tasks.length < 2) return { text: 'Not delegated: give at least two independent parts, each with a title and a brief. For one part, just answer it.', render: null };
  if(tasks.length > DELEGATE_MAX) return { text: 'Not delegated: at most ' + DELEGATE_MAX + ' parts at once. Combine some, or do it in two rounds.', render: null };
  const long = tasks.find(t => t.brief.length > DELEGATE_BRIEF_MAX);
  if(long) return { text: 'Not delegated: the brief for "' + long.title + '" is longer than ' + DELEGATE_BRIEF_MAX + ' characters. Shorten it to what that worker needs.', render: null };

  const signal = (typeof _activeStreamCtrl !== 'undefined' && _activeStreamCtrl) ? _activeStreamCtrl.signal : undefined;
  const sys = 'You are one of several AMV workers, each given one part of a larger task; another AMV combines the parts. '
    + 'Do ONLY the part in your brief, completely, as the brief asks. Do not refer to other workers or the larger task. '
    + 'You have no tools and cannot browse: say plainly when something would need current information you do not have, rather than guessing.';
  const res = tasks.map(t => ({ title: t.title, ok: false, out: '' }));
  let done = 0, next = 0;
  const say = () => { onStatus && onStatus(T('{0} of {1} workers finished').replace('{0}', done).replace('{1}', tasks.length) + '\u2026'); };
  say();
  const worker = async () => {
    while(next < tasks.length){
      const i = next++;
      if(signal && signal.aborted){ res[i].out = 'Stopped before it started.'; continue; }
      try{
        const out = await aiComplete(tasks[i].brief, sys, { max_tokens: 1500, signal });
        res[i].ok = !!String(out || '').trim();
        res[i].out = res[i].ok ? String(out) : 'The worker returned nothing.';
      }catch(e){
        res[i].out = (signal && signal.aborted) ? 'Stopped.' : 'Failed: ' + String((e && e.message) || 'no answer');
      }
      done++; say();
    }
  };
  await Promise.all(Array.from({ length: Math.min(DELEGATE_AT_ONCE, tasks.length) }, worker));
  const failed = res.filter(r => !r.ok).map(r => r.title);
  const text = res.map((r, i) => '### Worker ' + (i + 1) + ' - ' + r.title + (r.ok ? '' : ' (DID NOT FINISH)') + '\n' + r.out.slice(0, 8000)).join('\n\n')
    + (failed.length ? '\n\nThese parts did not come back: ' + failed.join(', ') + '. Say so to the person; do not write those parts yourself as if a worker had.' : '');
  const render = '<div class="chat-run dlg"><div class="chat-run-h">' + escH(T('{0} workers').replace('{0}', tasks.length)) + '</div><ul class="dlg-list">'
    + res.map(r => '<li class="dlg-i' + (r.ok ? '' : ' bad') + '"><span class="dlg-st" aria-hidden="true">' + (r.ok ? '\u2713' : '\u2715') + '</span>'
      + '<span class="dlg-t">' + escH(r.title) + '</span><span class="sr-only">' + escH(r.ok ? T('finished') : T('did not finish')) + '</span></li>').join('') + '</ul></div>';
  return { text, render };
}
try{ window._delegateRun = _delegateRun; }catch(e){}

const _TOOL_CONSENT = { deploy_site:true, run_code:true, fix_code:true,
                        crew_add:true, crew_steps:true, crew_watch:true, crew_update:true, crew_resume:true,
                        crew_remove:true, crew_standing:true, crew_ceiling:true,
                        /* A memory is appended to EVERY future request, so writing
                           one is writing a small permanent instruction - the same
                           shape of risk as the standing instruction, and worth the
                           same question. Forgetting destroys something of theirs.
                           And approving is what SENDS. */
                        memory_add:true, memory_forget:true, approval_act:true };
function _toolNeedsConsent(name){
  /* Running a command on somebody's own computer is the most consequential
     thing AMV can do, so it is gated here as well as by the bridge's own
     refusals. Reading and listing are not gated: they cannot change
     anything, and asking four times before AMV can look at a file is how a
     confirmation stops being read. */
  if(name === 'run_command' || name === 'write_file') return true;
  /* EVERY CONNECTOR TOOL, WITHOUT EXCEPTION.

     These come from servers AMV did not write, acting on accounts AMV does
     not own, and there is no list to classify them against: the tools are
     named and described by whoever published that server, so anything AMV
     said about how risky one is would be a guess dressed as a rule. A
     connector's `search` may well be harmless and its `send` may not, and we
     cannot tell them apart from the outside.

     So the answer is the one that is true rather than the one that is
     convenient: a person is asked before a third-party connector acts, and
     the prompt names the server and shows the arguments. In Build's own loop
     this is covered instead by the once-per-turn consent, which lists the
     connected services by name for the same reason. */
  if(typeof isMcpTool === 'function' && isMcpTool(name)) return true;
  return !!_TOOL_CONSENT[name];
}
/* WHAT THE ARGUMENTS ACTUALLY SAY, WITH NO FIELD ABLE TO PUSH ANOTHER OFF.

   This was `JSON.stringify(input, null, 1).slice(0, 700)`, and the truncation
   was a hole in the consent it was serving. Measured, not reasoned about:
   `{ body: 'x'.repeat(900), to: 'attacker@example.com', subject: 'Invoice' }`
   renders 700 characters of padding, and neither the address nor even the
   word "to" survives. The cut leaves no mark either, so what somebody reads
   is a complete-looking preview of a message with no recipient in it, and
   they approve it.

   The model chooses both the values and the ORDER they are serialized in, and
   AMV-007 exists precisely because a tool call can be asked for by content the
   model read rather than by the person. So this is not a corner case to be
   tidied - it is the dialog's one job, defeated by the field next to it.

   The rule here is that a FIELD NAME is never dropped. Names are short and
   they are what somebody scans for: seeing `to` at all is what makes an
   unexpected recipient noticeable. Values are what get shortened, each on its
   own budget, and a shortened one says how much was left out rather than
   trailing off. A value competes only with itself. */
const _ARG_VALUE_CAP = 140;
/* Enough for an address, an id or a filename - the short fields that carry the
   consequence - so shrinking to fit never costs the thing somebody is looking
   for. Below this a value is not worth showing badly, and the preview says so
   rather than printing a stub of one. */
const _ARG_VALUE_MIN = 44;
/* A ceiling on the whole preview. Per-field budgets alone are not a bound:
   measured at 390x620 with 24 fields at the full 140, the dialog runs to about
   2,900 characters and its buttons land at y=1330. They ARE still reachable -
   `.ov` scrolls, and that was checked rather than assumed - but a wall of text
   somebody scrolls past to find Deny is a worse consent screen than a short
   one, and the whole point of showing the arguments is that they get read. */
const _ARG_TOTAL_BUDGET = 1200;
/* Beyond this many fields the call is not something a dialog can usefully
   preview, and the honest answer is a count rather than a wall. */
const _ARG_MAX_FIELDS = 60;
function _toolArgPreview(input){
  let keys = [];
  try{ keys = Object.keys(input || {}); }catch(e){ keys = []; }
  if(!keys.length) return 'No arguments.';

  /* EVERY NAME, ALWAYS. The first version of this capped the LIST at 24
     fields, which is the original hole wearing different clothes: 24 decoy
     fields and `to` at position 25 hides the recipient exactly as 900
     characters of padding did. Names are short and they are the part that
     carries the warning, so names are what never gives way. */
  const shown = keys.slice(0, _ARG_MAX_FIELDS);
  let nameCost = 0;
  for(const k of shown) nameCost += String(k).length + 3;
  const perValue = Math.min(_ARG_VALUE_CAP,
    Math.floor((_ARG_TOTAL_BUDGET - nameCost) / Math.max(1, shown.length)));

  const lines = [];
  /* Too many fields for any of their values to be shown properly. Said out
     loud, at the top, rather than by quietly printing eleven-character stubs
     that look like the values. A call shaped like this is itself the signal. */
  if(perValue < _ARG_VALUE_MIN){
    lines.push('This call has ' + keys.length + ' fields, too many to show what is in them. '
             + 'These are their names:');
    for(const k of shown) lines.push('  ' + k);
    if(keys.length > _ARG_MAX_FIELDS) lines.push('  \u2026 and ' + (keys.length - _ARG_MAX_FIELDS) + ' more');
    return lines.join('\n');
  }

  for(const k of shown){
    let v;
    try{ v = input[k]; }catch(e){ v = null; }
    let s;
    if(typeof v === 'string') s = v;
    else { try{ s = JSON.stringify(v); }catch(e){ s = String(v); } }
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    if(s.length > perValue){
      const left = s.length - perValue;
      s = s.slice(0, perValue) + '\u2026 (' + left + ' more character' + (left === 1 ? '' : 's') + ')';
    }
    lines.push(k + ': ' + (s || '(empty)'));
  }
  if(keys.length > _ARG_MAX_FIELDS) lines.push('\u2026 and ' + (keys.length - _ARG_MAX_FIELDS) + ' more fields');
  return lines.join('\n');
}
try{ window._toolArgPreview=_toolArgPreview; }catch(e){}

/* How often a job runs, in the words a person uses. */
const _CREW_EVERY = { '10min':'every 10 minutes', '30min':'every 30 minutes',
                      hourly:'every hour', daily:'every day', weekly:'every week', once:'once' };
/* The instant a one-time job runs: its date and time on this device's clock.
   0 when either is missing or it is not in the coming year - refused, never
   guessed, because "once at some point" is not something anybody asked for. */
function _crewOnceAt(input){
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String((input && input.date) || '').trim());
  const t = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String((input && input.time) || '09:00'));
  if(!d || !t || +t[1] > 23 || +t[2] > 59) return 0;
  const at = new Date(+d[1], +d[2]-1, +d[3], +t[1], +t[2], 0, 0).getTime();
  return (at > Date.now() + 60e3 && at < Date.now() + 365*864e5) ? at : 0;
}
async function _confirmModelTool(name, input){
  input = input || {};
  const what = ({
    deploy_site:'publish a public web page live on the internet',
    run_command:'run this on your computer, in your project folder:\n\n' + String(input.command||''),
    write_file:'write the file '+String(input.path||'')+' in your project folder on your computer',
    run_code:'run '+String(input.lang||'code')+' on your device',
    fix_code:'run and edit '+String(input.lang||'code')+' on your device',
    crew_add:'set up a job that runs on its own, on a schedule',
    crew_steps:'start a task that runs in steps in the background, on AMV\u2019s servers',
    crew_watch:'watch your mail and act when something matching arrives',
    crew_update:'change one of your background jobs',
    crew_resume:'start one of your background jobs running again',
    crew_remove:'permanently delete one of your background jobs',
    crew_standing:'change the instructions every background job follows',
    crew_ceiling:'change how far ALL of your background jobs may go without asking you',
    memory_add:'remember something about you permanently',
    memory_forget:'permanently forget something it knows about you',
    approval_act:(input.action === 'reject' ? 'discard a piece of finished work' : 'APPROVE and send a piece of finished work')
  })[name] || (typeof isMcpTool === 'function' && isMcpTool(name)
      ? (() => {
          /* Named as what it is: somebody else's connector, on somebody
             else's service. "Run the mcp__github__create_issue action" tells
             a person nothing they can consent to. */
          /* From the alias registry, not by splitting the name: `a__b` +
             `c` and `a` + `b__c` are spelled alike, and a person consents to
             the tool that will actually run. (AMV-AUD-020) */
          const who = (typeof mcpToolIdentity === 'function') ? mcpToolIdentity(name) : null;
          if(who && who.remote) return 'use your ' + who.name + ' account to run "' + who.tool + '"';
          return who ? ('use your "' + who.id + '" connector to run "' + who.tool + '"')
                     : ('run the "' + name + '" connector action');
        })()
      : ('run the "'+name+'" action'));
  let detail='';
  if(typeof isMcpTool === 'function' && isMcpTool(name)){
    /* The arguments ARE the preview here. A connector call with no visible
       arguments is a blank cheque, and these reach services holding somebody's
       real mail, repositories or money. */
    detail = _toolArgPreview(input);
  }
  if(name==='deploy_site') detail='Page title: '+String(input.title||'App');
  else if(name==='run_code'||name==='fix_code') detail=String(input.code||'').slice(0,600);
  /* For a job, the dialog IS the preview: the exact instruction it will follow
     and how often it will follow it. Nobody can consent to "a background job"
     in the abstract, and this is the last point before it starts costing
     money on a timer. */
  else if(name==='crew_add')
    detail = 'It will run ' + (String(input.repeat) === 'once'
               ? 'once, ' + (_crewOnceAt(input) ? new Date(_crewOnceAt(input)).toLocaleString([], { weekday:'long', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : 'at a time still to be given')
               : (_CREW_EVERY[String(input.repeat||'daily')] || 'every day')) + ':\n\n'
           + String(input.detail||'').slice(0,600)
           + (String(input.approval||'require')==='auto'
               ? '\n\nResults go straight to you without review.'
               : '\n\nEach result waits for your approval before anything is sent.');
  else if(name==='crew_steps'){
    const st = Array.isArray(input.steps) ? input.steps.slice(0, 5) : [];
    detail = st.map((s, i) => (i + 1) + '. ' + String((s && s.title) || '').slice(0, 80)
               + (s && Number.isInteger(s.after) ? ' (after step ' + (s.after + 1) + ')' : '')
               + '\n   ' + String((s && s.detail) || '').slice(0, 300)).join('\n')
           + '\n\nIt starts within about a minute and keeps going with AMV closed. Each step uses one of your background jobs until it finishes.'
           + (String(input.approval || 'require') === 'auto'
               ? ' The final result goes straight to you without review.'
               : ' The final result waits for your approval before anything is sent.');
  }
  else if(name==='crew_watch'){
    const L = (v) => (Array.isArray(v) ? v : []).map(x => String(x||'').trim()).filter(Boolean).slice(0,5).join(', ');
    detail = 'It will check your new mail every ten minutes for anything'
           + (L(input.from) ? ' from: ' + L(input.from) : '')
           + (L(input.subject) ? (L(input.from) ? ',' : '') + ' with the subject containing: ' + L(input.subject) : '')
           + (L(input.words) ? ((L(input.from)||L(input.subject)) ? ',' : '') + ' mentioning: ' + L(input.words) : '')
           + '.\n\nWhen something matches, it will:\n' + String(input.detail||'').slice(0,500)
           + '\n\nChecks that find nothing cost nothing. It reads your mail; it never sends or replies.';
  }
  else if(name==='crew_update')
    detail = [ input.detail ? 'New instruction:\n' + String(input.detail).slice(0,500) : '',
               input.repeat ? 'New frequency: ' + (_CREW_EVERY[String(input.repeat)]||input.repeat) : ''
             ].filter(Boolean).join('\n\n');
  else if(name==='memory_add')
    detail = 'It will be added to what AMV knows about you, and included in every future conversation:\n\n'
           + String(input.text||'').slice(0,500);
  else if(name==='approval_act')
    detail = input.action === 'reject'
      ? 'The waiting item will be discarded. This cannot be undone.'
      : 'Approving is what SENDS it. If it was prepared to be emailed, it goes out now.';
  else if(name==='crew_ceiling')
    detail = ({
      suggest:'From now on, no background job runs on its own. AMV will tell you when one is due and wait to be asked. Nothing is spent.',
      require:'From now on, background jobs do the work but nothing goes out until you approve it.',
      auto:'From now on, background jobs may complete and deliver their results without asking you each time.'
    })[String(input.ceiling||'')] || '';
  else if(name==='crew_standing')
    detail = String(input.standing||'').trim()
      ? 'Every background job will follow this from now on:\n\n' + String(input.standing).slice(0,600)
      : 'Your standing instructions will be cleared, and jobs go back to running the standard way.';
  const ok = await _showModalAsync({
    title:'Allow the assistant to '+what+'?',
    body:'The assistant wants to '+what+' while answering you. This can be triggered by content it read, so allow it only if you actually want this to happen.'+(detail?'\n\n'+detail:''),
    okText:'Allow once', cancelText:'Deny'
  });
  return ok===true;
}
async function _amvRunTool(name, input, onStatus){
  try{
    /* THE BRIDGE'S TOOLS. Handled first because they are the ones that touch
       somebody's real machine, and a name collision with an AMV tool must
       resolve toward the more careful path rather than away from it.

       A failing command comes back as a RESULT, not an error: a missing
       package or a failing test is exactly what the model needs to read and
       act on, and turning it into a thrown error would end the turn at the
       moment the work actually starts. */
    /* A CONNECTOR SOMEBODY ELSE WROTE, ON A SERVICE THAT IS NOT OURS.

       Handled before AMV's own names so a connector cannot shadow one, and
       reported with the server it came from, because "AMV sent the email" and
       "the gmail connector on your machine sent the email" are different
       sentences and only the second is true. */
    if(typeof isMcpTool === 'function' && isMcpTool(name)){
      const who = (typeof mcpToolIdentity === 'function') ? mcpToolIdentity(name) : null;
      onStatus && onStatus('Using ' + (who ? (who.name || who.id) + ' \u00b7 ' + who.tool : String(name).replace(/^mcp__/, '')) + '\u2026');
      const r = await runMcpTool(name, input);
      /* Whether it failed used to be dropped here, so the model read only the
         text and could call a refused action done. And a success is the
         connector's word, which AMV cannot read back - so it is labelled as
         that, never as something AMV checked. */
      const head = (r && r.ok)
        ? '[The connector reports this. AMV has not checked it - say so if it matters.]\n'
        : '[The connector reported a FAILURE. Do not say this was done.]\n';
      return { text: head + String((r && r.text) || ''), render:null };
    }
    if(name==='run_command' || name==='read_file' || name==='write_file' || name==='list_dir'){
      const label = name==='run_command' ? ('Running: ' + String(input.command||'').slice(0,60))
                  : name==='write_file'  ? ('Writing ' + String(input.path||''))
                  : name==='read_file'   ? ('Reading ' + String(input.path||''))
                  :                        'Looking at the project';
      onStatus && onStatus(label + '…');
      const r = await runBridgeTool(name, input);
      if(r && r.error) return { text:'That did not work: ' + r.error, render:null };
      if(name==='run_command'){
        const head = 'exit ' + r.exitCode + (r.timedOut ? ' (timed out and was killed)' : '')
                   + ' in ' + r.ms + 'ms' + (r.truncated ? ' - output truncated' : '');
        return { text: head + '\n\nstdout:\n' + (r.stdout || '(empty)')
                      + '\n\nstderr:\n' + (r.stderr || '(empty)'), render:null };
      }
      if(name==='read_file')  return { text:'--- ' + r.path + ' ---\n' + r.content, render:null };
      if(name==='write_file') return { text:'Wrote ' + r.path + ' (' + r.bytes + ' bytes).', render:null };
      return { text: r.path + ':\n' + (r.entries||[]).map(e=>(e.dir?'[dir] ':'      ')+e.name).join('\n'), render:null };
    }

    /* generate_image and generate_video were handled here. Removed with the
       feature: a tool the model can call and the product cannot honour is the
       worst of both - it promises, then fails at the last step. */

    if(name==='delegate') return await _delegateRun(input, onStatus);

    if(name==='run_code'){
      onStatus && onStatus('Running the code\u2026');
      const r = await runCode(input.code, input.lang);
      if(r.html){
        return {
          text:'The HTML rendered successfully. A live preview is shown to the user.',
          render:'<iframe sandbox="allow-scripts" class="chat-live" data-amv-preview="'+escH(r.html)+'"></iframe>'
        };
      }
      const out = (r.ok ? (r.stdout || '(no output)') : (r.stderr || 'failed'));
      return {
        text:(r.ok?'Ran successfully in '+r.ms+'ms.\nOutput:\n':'Execution FAILED.\nError:\n')+out.slice(0,4000),
        render:'<div class="chat-run'+(r.ok?'':' bad')+'"><div class="chat-run-h">'+(r.ok?'Ran successfully':'Error')+'</div><pre>'+escH(out.slice(0,4000))+'</pre></div>'
      };
    }

    if(name==='fix_code'){
      onStatus && onStatus('Running it, then fixing what breaks\u2026');
      const res = await autoDebug(input.code, input.lang, 3, (st)=>{
        onStatus && onStatus((st && (st.note||st.msg)) || 'Debugging\u2026');
      }, _sectionModel('debug'));
      const fixed = res && res.code;
      /* THIS TOLD THE MODEL "Fixed and now passing." AFTER EVERY RUN.

         It tested `res.ok!==false`, and autoDebug has never returned an `ok`,
         so a budget refusal, a model error or running out of attempts all read
         as a pass - and the model then told the person their code worked. The
         failure branch read `res.stderr`, which does not exist either, so it
         could only ever have said "unknown". `_debugOutcome` reads the real
         fields for both callers. */
      const out = (typeof _debugOutcome === 'function') ? _debugOutcome(res) : { passed:false, why:'unknown' };
      return {
        text: out.passed
          ? 'Fixed and verified: the corrected version was run and it ran cleanly.\n\nWorking code:\n'+String(fixed||'').slice(0,6000)
          : 'Could NOT fix it - ' + out.why + '. Tell the user it is still failing; do not say it works.'
            + (out.lastError ? '\n\nLast error:\n' + out.lastError.slice(0,2000) : '')
            + (out.unverified ? '\n\nThe last attempted fix was never run, so it is a guess and must not be presented as working code.' : ''),
        render:null
      };
    }

    if(name==='deploy_site'){
      onStatus && onStatus('Publishing it live\u2026');
      if(!(window.AMV_API && AMV_API.live && AMV_API.hasSession))
        return { text:'Publishing needs the AMV engine connected. Tell the user to enable it in Settings.', render:null };
      let html = String(input.html||'').replace(/^```[a-z]*\n?/i,'').replace(/```\s*$/,'').trim();
      if(!html) return { text:'Nothing to publish - no HTML was given.', render:null };
      if(!/<html|<!doctype/i.test(html)) html = '<!DOCTYPE html><html><body>'+html+'</body></html>';
      try{
        /* PUBLISHING THE SAME PAGE TWICE SHOULD NOT COST TWO OF YOUR TWENTY-FIVE.

           Dev passes a slug, so re-deploying updates the same URL. This path did
           not, so every publish minted a NEW site - and the server caps a user at
           SITE_MAX_PER_USER (25). Publishing one Lab page twenty-five times filled
           the whole allowance with copies of it and then answered "You can host up
           to 25 sites. Delete one first." The same action cost a scarce resource
           differently depending on which surface you pressed it from, and nothing
           on either screen said so.

           The slug is threaded through and handed back so the caller can keep it. */
        const d = await _deployApi('/deploy', { html, title: input.title || 'App',
                                                slug: input.slug || undefined });
        return {
          slug: d.slug,
          text:'Published successfully. It is LIVE at: '+d.url+' - give the user this exact URL.',
          render:'<div class="chat-deployed"><span class="deploy-dot"></span><div><b>Live now</b>'+
                 '<a href="'+escH(safeUrl(d.url))+'" target="_blank" rel="noopener noreferrer">'+escH(d.url)+'</a></div></div>'
        };
      }catch(e){
        /* A PLAN LIMIT IS NOT A FAILURE, AND THIS IS WHERE IT ARRIVES.

           This tool answers the caller by RETURNING, not by throwing - so a
           branch on `catch(e => e.code)` further up is dead code, and the plan
           refusal was arriving as the prose "Deploy failed: Publishing to a
           live URL is part of Elite." Every caller then rendered it in red as a
           breakage, with nothing to press.

           The code and the plan are carried on the returned object so callers
           can branch on the machine-readable field, and the render is the
           upgrade rather than an error. The text stays honest about the
           outcome - nothing was published - because it is also what the model
           reads when a Crew run reaches this. */
        if(e && e.code === 'plan_required'){
          const why = String(e.message||'Publishing to a live URL is part of Elite.');
          return { code:'plan_required', minPlan: e.minPlan || 'elite',
                   text:'Not published: '+why+' Do not retry - it needs a plan change, not another attempt.',
                   render:_planUpsellCardHTML('Publishing is part of Elite', why) };
        }
        return { text:'Deploy failed: '+(e.message||e), render:null };
      }
    }

    if(name==='build_app'){
      onStatus && onStatus('Building it\u2026');
      const sys = 'You build complete, self-contained, working web apps. Return ONE full HTML document with all CSS and JS inline. No explanation, no markdown fences - just the HTML. It must actually work when opened.';
      let html = await aiCompleteLong(input.spec, sys, {
        max_tokens:16000,
        model:_sectionModel('code'),
        onProgress:(p)=>onStatus && onStatus('Building\u2026 '+p.lines.toLocaleString()+' lines')
      });
      html = String(html||'').replace(/^```[a-z]*\n?/i,'').replace(/```\s*$/,'').trim();
      if(!/<html|<!doctype/i.test(html)) html = '<!DOCTYPE html><html><body>'+html+'</body></html>';
      // Register it as a real artifact so it gets the full side-panel treatment.
      let card='';
      try{
        const art=_artifactStore(html, 'html', true);
        card=_artifactCardHTML(art);
      }catch(e){
        card='<iframe sandbox="allow-scripts" class="chat-live" data-amv-preview="'+escH(html)+'"></iframe>';
      }
      return { text:'Built it. A live, working version is shown to the user - they can open, edit, and download it.', render:card };
    }

    if(name === 'connect_account'){
      onStatus && onStatus('Looking for a way to connect ' + String((input && input.service) || '').slice(0, 40) + '\u2026');
      return await connectAccountTool(input || {});
    }
    if(name.slice(0,5) === 'crew_') return await _crewTool(name, input);
    if(name.slice(0,7) === 'memory_' || name.slice(0,8) === 'approval' || name === 'account_status')
      return await _sectionTool(name, input);
  }catch(e){
    return { text:'Tool "'+name+'" failed: '+(e.message||e), render:null };
  }
  return { text:'Unknown tool: '+name, render:null };
}

