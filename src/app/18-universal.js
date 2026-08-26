/* ============================================================
   AMV UNIVERSAL AGENT CORE - the layer that lets Crew connect to
   ANYTHING and actually do it.

   Design goals (owner directive):
   - One text box. Any request. Crew figures out which services,
     accounts, APIs and actions are needed and completes the whole
     task in the background.
   - NOT a fixed command list. New/unexpected requests are handled by
     planning against whatever connectors exist right now.
   - Official API first; permitted browser automation when no API.
   - Every new API is trivial to add - a DECLARATIVE entry, no new
     code path (see AMVConnectors.register).
   - Nothing is fake. If a step cannot run, it says exactly what is
     missing (auth, permission, login, captcha, approval, a server)
     and resumes automatically the moment that is provided.
   - Consequential actions stop for approval. Policy gate blocks the
     illegal/abusive (fake reviews, spam, credential theft...).
   ============================================================ */

/* ---------- 1. CONNECTOR REGISTRY (declarative + extensible) ----------
   Add ANY service in one object. Two flavours of action:
     - declarative HTTP: {method,url,body,headers} - no code needed
     - custom: {run(args, ctx)} - for anything unusual
   A connector is "live" when its token/credential is present. */
const AMVConnectors = {
  _reg: Object.create(null),

  /* Add or extend a connector. Registering an id that already exists MERGES
     the new actions in rather than replacing the connector wholesale - so a
     second registration (a plugin, a reload, an id collision) can never
     silently delete capabilities that were already working. Same-named
     actions are intentionally overridden; everything else is preserved. */
  register(def){
    if(!def || !def.id) return null;
    def.actions = def.actions || {};
    const existing = this._reg[def.id];
    if(existing){
      existing.actions = Object.assign({}, existing.actions, def.actions);
      // keep the richer metadata, but let an explicit new value win
      ['name','auth','tokenKey','channel','isLive','getToken'].forEach(k => {
        if(def[k] !== undefined) existing[k] = def[k];
      });
      return existing;
    }
    this._reg[def.id] = def;
    return def;
  },
  all(){ return Object.values(this._reg); },
  get(id){ return this._reg[id] || null; },

  // Is this connector usable right now (credential present)?
  live(id){
    const c = this.get(id); if(!c) return false;
    try{
      if(typeof c.isLive === 'function') return !!c.isLive();
      if(c.tokenKey) return !!(typeof loadStr === 'function' && loadStr(c.tokenKey));
    }catch(e){}
    return false;
  },
  token(id){
    const c = this.get(id); if(!c) return '';
    try{
      if(typeof c.getToken === 'function') return c.getToken() || '';
      if(c.tokenKey) return (typeof loadStr === 'function' && loadStr(c.tokenKey)) || '';
    }catch(e){}
    return '';
  },

  // Every action across every connector, as a flat catalog the planner
  // can choose from. This is what makes Crew open-ended: the planner sees
  // whatever exists today, including services added after this was written.
  catalog(){
    const out = [];
    this.all().forEach(c => {
      Object.keys(c.actions).forEach(k => {
        const a = c.actions[k];
        out.push({
          id: c.id + '.' + k, connector: c.id, connectorName: c.name, action: k,
          desc: a.desc || k, risk: a.risk || 'low', args: a.args || [],
          live: this.live(c.id), auth: c.auth || 'none', channel: c.channel || 'api'
        });
      });
    });
    return out;
  },

  // Execute one action for real. Throws with an actionable message when the
  // connector is not connected - never silently pretends.
  async run(fullId, args){
    const [cid, act] = String(fullId || '').split('.');
    const c = this.get(cid);
    if(!c) throw new Error('No connector "' + cid + '" is registered.');
    const a = c.actions[act];
    if(!a) throw new Error('"' + cid + '" has no action "' + act + '".');
    if(c.auth && c.auth !== 'none' && !this.live(cid)){
      const e = new Error('Connect ' + (c.name || cid) + ' first.');
      e.code = 'needs_auth'; e.connector = cid; throw e;
    }
    const ctx = { token: this.token(cid), connector: c };
    if(typeof a.run === 'function') return await a.run(args || {}, ctx);

    // declarative HTTP action
    const url = typeof a.url === 'function' ? a.url(args || {}, ctx) : a.url;
    if(!url) throw new Error('Action "' + fullId + '" has no url or run().');
    const headers = Object.assign(
      { 'Content-Type': 'application/json' },
      c.auth === 'bearer' || c.auth === 'oauth' ? { Authorization: 'Bearer ' + ctx.token } : {},
      typeof a.headers === 'function' ? a.headers(args || {}, ctx) : (a.headers || {})
    );
    const init = { method: a.method || 'GET', headers };
    if(init.method !== 'GET' && a.body) init.body = JSON.stringify(typeof a.body === 'function' ? a.body(args || {}, ctx) : a.body);
    // A connector calling somebody else's API gets a deadline like everything
    // else - a third-party outage must not freeze the step it belongs to.
    const r = await fetchDeadline(url, init, 30000);
    let d = null; try{ d = await r.json(); }catch(e){ d = { ok: r.ok }; }
    if(!r.ok) throw new Error((d && (d.error_description || d.message || (d.error && d.error.message))) || ('Request failed (' + r.status + ')'));
    return d;
  }
};
try{ window.AMVConnectors = AMVConnectors; }catch(e){}

/* ---------- 2. SEED CONNECTORS ----------
   The already-working INTEGRATION_ACTIONS are adopted wholesale, so the
   universal layer starts with every real capability AMV already has.
   Adding LinkedIn/X/Notion/anything later is one register() call. */
try{
  if(typeof INTEGRATION_ACTIONS !== 'undefined'){
    const byNeed = {};
    Object.keys(INTEGRATION_ACTIONS).forEach(k => {
      const a = INTEGRATION_ACTIONS[k];
      const need = a.needs || 'amv';
      (byNeed[need] = byNeed[need] || {})[k] = {
        desc: a.desc, risk: a.risk || 'low', riskLabel: a.riskLabel,
        run: (args) => a.run(args)
      };
    });
    const meta = {
      /* Keyed on 'connect' now, because these actions no longer belong to one
         provider - they belong to whatever the server holds a grant for. Live
         means "the server has a working connection", which is a question only
         the server's own list can answer; asking whether a Google token is in
         this page stopped being the question when the token stopped coming
         here, and would have reported no connectors on an account with every
         permission granted. */
      connect: { name: 'Connected accounts', auth: 'server',
                 isLive: () => { try{ return typeof _connHasAny === 'function' && _connHasAny(); }catch(e){ return false; } } },
      github: { name: 'GitHub', auth: 'bearer', tokenKey: 'amv_github' },
      slack:  { name: 'Slack', auth: 'bearer', tokenKey: 'amv_slack' }
    };
    Object.keys(byNeed).forEach(need => {
      const m = meta[need] || { name: need, auth: 'none' };
      AMVConnectors.register(Object.assign({ id: need, actions: byNeed[need] }, m));
    });
  }
}catch(e){}

/* Browser channel: for sites with NO API. Real automation runs server-side
   (a headless browser the Worker drives) - it can never run in this tab.
   Until that service is configured this reports exactly what is missing
   instead of pretending, and every call flips live the moment it exists. */
AMVConnectors.register({
  id: 'browser', name: 'Web automation (any site)', auth: 'none', channel: 'browser',
  isLive(){ try{ return !!(loadStr('amv_browser_service') || ''); }catch(e){ return false; } },
  actions: {
    do: {
      desc: 'Operate any website that has no API: open, log in, fill forms, click, upload, submit. Args: {url, goal, data?}',
      risk: 'high', riskLabel: 'act on a website as you',
      async run(args){
        /* MONEY GATE. The browser agent can complete a checkout, so it must
           pass the same age and spending checks as any other purchase -
           otherwise the limits are trivially bypassed by routing a buy through
           here instead of through the spend layer. Declared spend is also sent
           to the server, which enforces its own ceiling independently. */
        const spend = +(args && args.spendAmount) || 0;
        const buying = spend > 0 || /\b(buy|purchase|checkout|order|pay|subscribe)\b/i.test(String((args && args.goal) || ''));
        if(buying){
          try{
            if(typeof AMVCompliance !== 'undefined'){
              const why = AMVCompliance.gate('spend');
              if(why){ const e = new Error(why); e.code = 'not_permitted'; throw e; }
            }
          }catch(e){ if(e && e.code === 'not_permitted') throw e; }
          if(spend > 0 && typeof AMVSpend !== 'undefined'){
            const v = AMVSpend.check(spend);
            if(!v.allow){ const e = new Error(v.reason); e.code = 'over_limit'; throw e; }
            if(v.needsApproval && !(args && args.approved)){
              const e = new Error(v.reason); e.code = 'needs_approval'; throw e;
            }
          }
        }
        // The agent runs SERVER-SIDE (a real headless browser the Worker drives).
        // It can never run in this tab, so the backend URL is the service URL.
        const base = (typeof loadStr === 'function' && (loadStr('amv_browser_service') || loadStr('amv_api_base'))) || '';
        if(!base){
          const e = new Error('Web automation needs the AMV backend. Connect it in Settings and this starts working.');
          e.code = 'needs_service'; throw e;
        }
        const tok = (typeof loadStr === 'function' && loadStr('amv_api_token')) || '';
        const r = await fetchDeadline(base.replace(/\/$/, '') + '/v1/browser/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
          body: JSON.stringify({
            url: args.url, goal: args.goal,
            /* Values the user saved for this task. They never enter the model's
               view: the server decides which field each one belongs in, from
               that field's own identity, and fills it only on a site named
               here. Naming extra sites is for the real case where a login
               finishes somewhere else - a checkout handing over to a payment
               processor, a company site handing over to its sign-in host. */
            data: args.data || {},
            dataOrigins: Array.isArray(args.dataOrigins) ? args.dataOrigins.slice(0, 4) : undefined,
            approved: !!args.approved,           // the user's explicit OK for this run
            // the server enforces its own ceiling on these, independently
            spendAmount: spend || undefined,
            spendLimit: (typeof AMVSpend !== 'undefined' ? (AMVSpend.cfg().perPurchase || undefined) : undefined)
          })
        }, 240000);   // a real browser session is slow, but it is not infinite
        const d = await r.json().catch(() => ({}));
        // Surface the agent's structured stopping points as real blockers so the
        // UI can say exactly what is needed and resume when it is provided.
        if(d && d.code){
          const e = new Error(d.need || d.message || d.error || 'Web automation stopped.');
          e.code = d.code; e.trace = d.trace; throw e;
        }
        if(!r.ok || d.error) throw new Error(d.error || 'Web automation failed.');
        return d;
      }
    }
  }
});

/* ---------- 3. POLICY GATE ----------
   Universal does NOT mean lawless. These are refused outright, and the
   refusal is explicit rather than a silent failure. */
const AMV_POLICY = [
  { re:/\bfake (review|rating|testimonial)|review bomb|post .*review .*(never|didn'?t) (use|buy|visit)|astroturf/i,
    why:'Posting a review for something you did not actually experience is review fraud (and illegal in many places). I can post an honest review of a real experience.' },
  { re:/\b(mass|bulk) (dm|message|email)|spam|blast .*(unsolicited)|scrape .*emails? .*(sell|list)/i,
    why:'Mass unsolicited messaging breaks platform rules and anti-spam law. I can send personalised messages to people you actually have a reason to contact.' },
  { re:/\b(hack|brute[- ]?force|bypass (login|captcha|2fa|paywall)|credential stuff|steal .*(password|account|card))/i,
    why:'That is unauthorised access. I will not do it.' },
  { re:/\bimpersonat|pretend to be (?!me\b)|catfish|fake (identity|profile|id)\b/i,
    why:'I can act as you on your own accounts, but I will not impersonate someone else.' },
  { re:/\b(ddos|denial of service|botnet|malware|ransomware|phish)/i,
    why:'That is an attack. I will not do it.' }
];
function _policyCheck(text){
  const t = String(text || '');
  for(const p of AMV_POLICY){ if(p.re.test(t)) return { ok:false, why:p.why }; }
  return { ok:true };
}

/* ---------- 4. THE UNIVERSAL AGENT ----------
   plan -> resolve (bind each step to a REAL action) -> execute. */
const AMVUniversal = {
  MAX_STEPS: 20,

  policy: _policyCheck,

  /* Decompose ANY request into concrete steps bound to real actions.
     With the engine connected the AI plans against the live catalog (so it
     handles requests nobody preprogrammed). Offline it still produces an
     honest single-step plan rather than nothing. */
  async plan(request){
    const gate = _policyCheck(request);
    if(!gate.ok) return { blocked:true, why:gate.why, steps:[] };
    let _planErr = '';
    const cat = AMVConnectors.catalog();
    if(typeof _aiBackendReady === 'function' && _aiBackendReady() && typeof aiComplete === 'function'){
      const tools = cat.map(a => '- ' + a.id + ' (' + a.connectorName + (a.live ? ', connected' : ', NOT connected') + '): ' + a.desc).join('\n');
      const sys = 'You plan real actions for an autonomous agent. You are given the EXACT tool catalog. '
        + 'Break the request into the fewest concrete steps that finish it end to end. '
        + 'Each step MUST pick a tool id from the catalog, or use "browser.do" for any site with no API (give {url, goal}). '
        + 'Return ONLY JSON: [{"title":"short","tool":"connector.action","args":{...},"needs_approval":true|false}]. '
        + 'Set needs_approval true for anything that sends, posts, publishes, buys, deletes or contacts someone.';
      try{
        const raw = await aiComplete('TOOL CATALOG:\n' + tools + '\n\nREQUEST: ' + request, sys, { max_tokens: 1400 });
        const arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
        if(Array.isArray(arr) && arr.length) return { steps: arr.slice(0, this.MAX_STEPS) };
        _planErr = 'The planner did not return any steps.';
      }catch(e){
        /* Swallowing this used to be dishonest: with the engine connected but
           the call failing, the user got a mysterious one-step plan and no clue
           that planning had failed at all. Keep the fallback, name the reason. */
        _planErr = (e && e.message) || 'Planning failed.';
      }
    }
    return { steps: [{ title:'Complete the request', tool:null, args:{ goal:request }, needs_approval:true }],
             planError: _planErr || undefined,
             degraded: !(typeof _aiBackendReady === 'function' && _aiBackendReady()) };
  },

  /* What EXACTLY is stopping this step from running right now?
     Returns null when it can run. This is what makes the agent honest and
     auto-resuming: the blocker names the precise requirement. */
  blockerFor(step){
    if(!step || !step.tool) return { code:'no_tool', need:'a connected service that can do this', how:'Connect an account or add the API in Settings -> Connectors.' };
    const [cid] = String(step.tool).split('.');
    const c = AMVConnectors.get(cid);
    if(!c) return { code:'unknown_connector', need:cid, how:'Add this service in Settings -> Connectors.' };
    if(cid === 'browser' && !AMVConnectors.live('browser'))
      return { code:'needs_service', need:'the web automation service', how:'Deploy the browser service and set its URL in Settings. Everything else keeps working meanwhile.' };
    if(c.auth && c.auth !== 'none' && !AMVConnectors.live(cid))
      return { code:'needs_auth', need:c.name, how:'Connect ' + c.name + ' in Settings -> Connectors.' };
    return null;
  },

  /* Bind a plan to reality: mark every step runnable / blocked / needs-approval. */
  resolve(steps, opts){
    opts = opts || {};
    const autonomous = !!opts.autonomous;
    return (steps || []).map(s => {
      const blocker = this.blockerFor(s);
      const meta = s.tool ? AMVConnectors.catalog().find(a => a.id === s.tool) : null;
      const high = !!(s.needs_approval || (meta && meta.risk === 'high'));
      return Object.assign({}, s, {
        blocker,
        status: blocker ? 'blocked' : (high && !autonomous ? 'needs_approval' : 'ready'),
        risk: high ? 'high' : 'low',
        connectorName: meta ? meta.connectorName : (s.tool ? String(s.tool).split('.')[0] : '')
      });
    });
  },

  /* Execute a resolved plan for real. Emits progress for the live UI so the
     user sees every step, what it used, what it produced, what it is waiting
     on. Blocked steps do not fail the run - they park, and rerunning after
     the requirement is provided continues automatically. */
  async execute(resolved, opts){
    opts = opts || {};
    /* A throw inside the caller's progress callback used to abort the whole
       run: a rendering bug would look like the agent failing. */
    const _emit = typeof opts.onEvent === 'function' ? opts.onEvent : function(){};
    const onEvent = e => { try{ _emit(e); }catch(_){} };
    /* No step may run forever. Connector calls have their own network
       deadlines, but a custom run() (the web agent, a local bridge) could sit
       there indefinitely and take the whole plan with it. */
    const stepMs = opts.stepTimeoutMs || 300000;
    /* A deadline here stops the PLAN waiting; it cannot reach into a connector
       and cancel work already in flight. So the message says that, rather than
       claiming the step was stopped - if the step was a send or a purchase, it
       may well still land, and the user needs to check before re-running it
       rather than being told it definitely did not happen. */
    const _withDeadline = (p, s) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(Object.assign(
        new Error('This step took longer than ' + Math.round(stepMs / 1000) + 's, so AMV stopped waiting for it. '
                + 'It may still finish on its own - if it sends, posts, buys or contacts anyone, check there before running this again.'),
        { code:'step_timeout' })), stepMs);
      Promise.resolve(p).then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
    const results = [];
    /* Stopping rules. A BLOCKED step parks and the run continues, because a
       missing connection for one step says nothing about the others. An ERROR
       is different: the plan is sequential, so a later step is very likely
       working from something the failed step was supposed to produce - and
       later steps are the ones that send, post, buy and contact people.
       Running them anyway is how an agent does real damage on bad data. So an
       error stops the run and the rest are reported as not attempted. */
    let stopped = null;
    for(let i = 0; i < resolved.length; i++){
      const s = resolved[i];
      if(opts.signal && opts.signal.aborted && !stopped) stopped = { code:'cancelled', why:'You stopped the run.' };
      if(stopped){
        const blocker = { code:stopped.code, need:stopped.why,
          how: stopped.code === 'cancelled' ? 'Run it again when you are ready.'
             : 'Fix the step that failed above, then run again - I continue from there.' };
        onEvent({ type:'skipped', i, step:s, blocker });
        results.push({ i, status:'skipped', blocker });
        continue;
      }
      if(s.status === 'blocked'){
        onEvent({ type:'blocked', i, step:s, blocker:s.blocker });
        results.push({ i, status:'blocked', blocker:s.blocker });
        continue;
      }
      if(s.status === 'needs_approval' && !opts.approved){
        onEvent({ type:'awaiting_approval', i, step:s });
        results.push({ i, status:'awaiting_approval' });
        continue;
      }
      onEvent({ type:'start', i, step:s });
      try{
        const out = await _withDeadline(AMVConnectors.run(s.tool, s.args || {}), s);
        onEvent({ type:'done', i, step:s, result:out });
        results.push({ i, status:'done', result:out });
      }catch(e){
        const HOW = {
          needs_service:'Enable web automation on your deployment (Browser Rendering binding), then this runs automatically.',
          needs_key:'Add your AI key so the agent can read pages and decide actions.',
          needs_approval:'Approve this step and I will finish it.',
          needs_human:'This site showed a captcha - solve it once and I can continue.',
          needs_info:'Tell me this detail and I will carry on.',
          needs_auth:'Connect the account this step needs.',
          blocked_url:'That address is not allowed (internal or unsupported).',
          step_cap:'The task needed more steps than the safety cap allows - narrow it slightly and rerun.',
          step_timeout:'The service did not finish in time. Try again, or narrow this step.'
        };
        // step_timeout is a failure, not something the user can simply provide.
        const parked = e && e.code && e.code !== 'step_timeout';
        const blocker = parked ? { code:e.code, need:e.message, how:HOW[e.code] || e.message } : null;
        onEvent({ type: blocker ? 'blocked' : 'error', i, step:s, error:e.message, blocker,
                  how: blocker ? undefined : (HOW[e && e.code] || undefined) });
        results.push({ i, status: blocker ? 'blocked' : 'error', error:e.message, blocker });
        if(!blocker) stopped = { code:'earlier_step_failed', why:'An earlier step failed, so this was not attempted.' };
      }
    }
    return results;
  },

  /* One call: request in, real work out. */
  async fulfill(request, opts){
    opts = opts || {};
    const p = await this.plan(request);
    if(p.blocked) return { blocked:true, why:p.why };
    const resolved = this.resolve(p.steps, opts);
    if(typeof opts.onPlan === 'function') opts.onPlan(resolved);
    const results = await this.execute(resolved, opts);
    return { steps:resolved, results, degraded:p.degraded, planError:p.planError,
             summary:this.summarize(resolved, results) };
  },

  summarize(resolved, results){
    const n = a => results.filter(r => r.status === a).length;
    // "needs" is what the user can supply to unstick the run. A step that was
    // never attempted is a consequence, not a requirement, so it is counted
    // but kept out of the ask.
    const blockers = results.filter(r => r.blocker && r.status !== 'skipped').map(r => r.blocker);
    const seen = {};
    const failed = results.find(r => r.status === 'error');
    return {
      total: resolved.length, done: n('done'), blocked: n('blocked'),
      awaitingApproval: n('awaiting_approval'), errors: n('error'), skipped: n('skipped'),
      failedAt: failed ? failed.i : -1, failedWhy: failed ? failed.error : '',
      needs: blockers.filter(b => seen[b.code + b.need] ? false : (seen[b.code + b.need] = true))
    };
  }
};
try{ window.AMVUniversal = AMVUniversal; }catch(e){}

/* ---------- 5. LIVE RUN SURFACE ----------
   Shows the real thing happening: every planned step, which service it uses,
   whether it ran, what it produced, and exactly what it is waiting on. No
   fake progress - each row is driven by a real execute() event. */
function _uniStepRow(s, i){
  const st = s.status === 'ready' ? 'waiting' : s.status;
  const tag = s.blocker ? '<span class="uni-tag need">Needs: ' + escH(s.blocker.need || '') + '</span>'
            : s.status === 'needs_approval' ? '<span class="uni-tag appr">Needs your OK</span>'
            : s.risk === 'high' ? '<span class="uni-tag risk">Sends / posts</span>' : '';
  return '<div class="uni-step ' + escH(st) + '" id="uni-s' + i + '">' +
    '<span class="uni-ix">' + (i + 1) + '</span>' +
    '<div class="uni-b"><div class="uni-t">' + escH(s.title || ('Step ' + (i + 1))) + '</div>' +
    '<div class="uni-m"><span class="uni-tool">' + escH(s.connectorName || 'AMV') + '</span>' + tag +
    (s.blocker ? '<span class="uni-how">' + escH(s.blocker.how || '') + '</span>' : '') + '</div>' +
    '<div class="uni-out" id="uni-o' + i + '"></div></div>' +
    '<span class="uni-ic"></span></div>';
}
function _uniSetStatus(i, status, text){
  const el = document.getElementById('uni-s' + i); if(!el) return;
  el.className = 'uni-step ' + status;
  if(text){ const o = document.getElementById('uni-o' + i); if(o) o.textContent = text; }
}
/* Run any request from the one text box, with everything visible. */
async function uniRun(request, opts){
  opts = opts || {};
  const mount = document.getElementById('uni-live') || document.getElementById('vc');
  const paint = html => { const m = document.getElementById('uni-live'); if(m) m.innerHTML = html; };
  if(document.getElementById('uni-live')) paint('<div class="uni-plan"><div class="uni-h">Working out how to do this…</div></div>');

  const p = await AMVUniversal.plan(request);
  if(p.blocked){
    paint('<div class="uni-plan blocked"><div class="uni-h">I will not do that</div><div class="uni-why">' + escH(p.why) + '</div></div>');
    if(typeof toast === 'function') toast('Blocked by policy', 'error', 4000);
    return { blocked: true, why: p.why };
  }
  const resolved = AMVUniversal.resolve(p.steps, { autonomous: !!opts.autonomous });
  /* An agent that is doing real things on the user's behalf must be stoppable.
     Cancelling takes effect between steps - the one already in flight is not
     killed halfway, which would be worse than letting it finish - so the
     button says so rather than implying an instant halt. */
  const ctrl = opts.signal ? null : ((typeof AbortController !== 'undefined') ? new AbortController() : null);
  const signal = opts.signal || (ctrl ? ctrl.signal : null);
  paint('<div class="uni-plan"><div class="uni-h">' + resolved.length + ' step' + (resolved.length === 1 ? '' : 's') +
        (ctrl ? '<button class="uni-stop" id="uni-stop" type="button">Stop</button>' : '') + '</div>' +
        resolved.map(_uniStepRow).join('') + '</div>');
  if(ctrl){
    const sb = document.getElementById('uni-stop');
    if(sb) sb.addEventListener('click', () => {
      try{ ctrl.abort(); }catch(e){}
      sb.disabled = true; sb.textContent = 'Stopping after this step…';
    });
  }

  const res = await AMVUniversal.execute(resolved, {
    autonomous: !!opts.autonomous, approved: !!opts.approved, signal: signal,
    onEvent: e => {
      if(e.type === 'start') _uniSetStatus(e.i, 'running');
      else if(e.type === 'done') _uniSetStatus(e.i, 'done', typeof e.result === 'object' ? JSON.stringify(e.result).slice(0, 140) : String(e.result || '').slice(0, 140));
      else if(e.type === 'blocked') _uniSetStatus(e.i, 'blocked');
      else if(e.type === 'awaiting_approval') _uniSetStatus(e.i, 'needs_approval');
      else if(e.type === 'error') _uniSetStatus(e.i, 'error', e.error);
      else if(e.type === 'skipped') _uniSetStatus(e.i, 'skipped', (e.blocker && e.blocker.need) || 'Not attempted');
    }
  });
  const sum = AMVUniversal.summarize(resolved, res);
  const needs = sum.needs.length
    ? '<div class="uni-needs"><b>To finish this I need:</b> ' + sum.needs.map(n => escH(n.how || n.need)).join(' · ') +
      '<div class="uni-resume">Provide it and run again - I continue from here automatically.</div></div>' : '';
  /* Failures were computed and then never shown: a run where every step threw
     reported "0 done - 0 blocked - 0 awaiting your OK" and looked like nothing
     had happened. Say what failed, where, and what it means for the rest. */
  const failed = sum.errors
    ? '<div class="uni-failed"><b>Stopped at step ' + (sum.failedAt + 1) + ':</b> ' + escH(sum.failedWhy || 'it failed') +
      (sum.skipped ? '<div class="uni-resume">' + sum.skipped + ' later step' + (sum.skipped === 1 ? '' : 's') +
        ' were not attempted, because they would have run on the result of the step that failed.</div>' : '') +
      '</div>' : '';
  const planFailed = p.planError
    ? '<div class="uni-failed"><b>I could not plan this properly:</b> ' + escH(p.planError) +
      '<div class="uni-resume">What you see is a single fallback step, not a real plan.</div></div>' : '';
  const _sb = document.getElementById('uni-stop'); if(_sb) _sb.remove();   // the run is over
  const m = document.getElementById('uni-live');
  if(m) m.insertAdjacentHTML('beforeend',
    '<div class="uni-sum">' + sum.done + ' done · ' + sum.blocked + ' blocked · ' + sum.awaitingApproval + ' awaiting your OK' +
    (sum.errors ? ' · <span class="uni-err-n">' + sum.errors + ' failed</span>' : '') +
    (sum.skipped ? ' · ' + sum.skipped + ' not attempted' : '') +
    (p.degraded ? ' · <span class="uni-deg">connect the engine for full planning</span>' : '') +
    planFailed + failed + needs + '</div>');
  return { steps: resolved, results: res, summary: sum, planError: p.planError };
}
try{ window.uniRun = uniRun; window._uniStepRow = _uniStepRow; }catch(e){}
