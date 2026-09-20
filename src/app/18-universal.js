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
        const base = (typeof loadStr === 'function' && (loadStr('amv_browser_service') || apiBase())) || '';
        if(!base){
          const e = new Error('Web automation needs the AMV backend. Connect it in Settings and this starts working.');
          e.code = 'needs_service'; throw e;
        }
        const tok = (window.AMV_API && AMV_API.token) || '';
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
            /* THE TICKET, NOT A FLAG. This used to send `approved: !!args.approved`
               - a boolean the caller chose - and the server believed it, so
               anything able to compose a request as the signed-in user could
               approve a purchase on the first attempt with no human involved.
               The server now issues an approval bound to the exact action it
               stopped on; this is that id going back. Sending nothing, or
               anything made up, approves nothing. */
            approvalTicket: args.approvalTicket || undefined,
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
          e.code = d.code; e.trace = d.trace;
          /* Carried back so whatever asks the person can hand the SAME ticket
             to the resumed run. Without it the approval has nowhere to go and
             the step stops again, for ever. */
          e.approvalTicket = d.approvalTicket || '';
          throw e;
        }
        if(!r.ok || d.error) throw new Error(d.error || 'Web automation failed.');
        return d;
      }
    }
  }
});

/* ---------- 3b. CAN AMV ACTUALLY DO THIS? ----------------------------------

   Asked for, in the owner's words: "if it is genuinely not possible... say
   something that shows you can't do it. Like for example send an email to mark
   Zuckerberg everyday and log into random Facebook accounts... that is one out
   of millions just in general have like scanning things which can tell if
   possible or not."

   The last sentence is the requirement, and it rules out the obvious
   implementation. A list of impossible requests is a list of the ones somebody
   thought of; the millionth request is the one that gets "Working on it..."
   and a spinner that never resolves into anything.

   So this is three layers, and only the middle one is general.

   FLOOR. A handful of things no software running in a browser tab can ever do,
   whatever connectors get added later: be somewhere in person, use an account
   that belongs to somebody else, promise what another person will do, or carry
   out an act that is legally bound to a human identity. These are not a list
   of requests, they are a list of AMV's edges, and they are short because the
   edges are few. The floor exists so the answer is honest with no engine
   connected at all - it costs nothing and needs no key.

   CATALOG. The general one. The planner is already handed the exact list of
   every action every connector exposes, live or not. It is therefore the only
   thing in this system that can answer "can any combination of what exists do
   this" for a request nobody anticipated - so it is allowed to say no, with a
   reason and with what it would do instead, rather than being forced to return
   steps it knows are fiction.

   EVIDENCE. After planning, the plan is checked against reality: if every step
   it produced is bound to a tool that does not exist, the plan is fiction no
   matter how confident it reads, and saying so beats running it.

   What this must NOT do is refuse things that are merely unlikely to work.
   Emailing a public figure every day is entirely possible - AMV can send mail.
   What it cannot do is promise he reads it. So the verdict names the PART that
   cannot be done and offers to do the rest, rather than rejecting the whole
   request because one clause of it was ambitious. */
const FEAS_EDGES = [
  {
    id: 'in-person',
    /* Being somewhere, with hands. No connector will ever cover this. */
    re: /\b(?:drive|walk|run over|go (?:to|down|round)|head (?:to|over)|pick (?:it |them |him |her )?up(?! a call)|drop (?:it|them|him|her|off)|deliver (?:it|them|this|the)|collect (?:it|them|the)|post (?:a |the |this )?(?:letter|parcel|package)|mail (?:a |the |this )?(?:letter|parcel|package)|print (?:it|this|these|out|off)|shred|photocopy|hand (?:it |them )?(?:in|over)|sign .{0,20}in person|show up|turn up|attend in person|be there|cook|clean (?:my|the) (?:house|room|flat|kitchen)|water (?:my|the) plants|walk (?:my|the) dog|feed (?:my|the) (?:cat|dog))\b/i,
    why: 'that part needs somebody physically there, and AMV runs in a browser - it has no hands, no car and no printer.',
    instead: ['book, order or arrange it with whoever does have hands',
              'find who does it near you, with prices and opening times',
              'prepare the document so it is ready to print or hand over'],
  },
  {
    id: 'their-account',
    /* Somebody else's credentials. Not a policy question about intent - it is
       simply not a thing AMV has or can be given. */
    /* Two ways in, because both are how people say it and only one has a verb.
       "log into" is the one the first draft missed: `log ?in` then a word
       boundary cannot match it, because "into" is one word. The possessive
       branch carries no verb at all - "check my friend's inbox" names no
       action this could have keyed on - and it deliberately leaves out
       his/her/their, which usually mean a company's account, and calendars,
       which are routinely shared and so are genuinely reachable. */
    re: /\b(?:log(?:ging|ged)? ?in(?:to)?|sign(?:ing|ed)? ?in(?:to)?|get(?:ting)? into|log(?:ging|ged)? on(?:to)?|access(?:ing|ed)?|break(?:ing)? into|hack(?:ing)? into)\b[^.!?]{0,40}\b(?:random|other people'?s|someone ?else'?s|somebody ?else'?s|strangers?'?|his|her|their|my (?:friend|mate|mum|mom|dad|boss|teacher|colleague|wife|husband|partner|brother|sister)'?s?)\b[^.!?]{0,25}\b(?:accounts?|profiles?|inbox(?:es)?|emails?|messages?|dms?)\b|\b(?:random|other people'?s|someone ?else'?s|somebody ?else'?s|strangers?'?|my (?:friend|mate|mum|mom|dad|boss|teacher|colleague|wife|husband|partner|brother|sister)'?s?)\s+(?:accounts?|profiles?|inbox(?:es)?|mailbox(?:es)?|dms?|passwords?)\b|\b(?:accounts?|profiles?)\b[^.!?]{0,25}\bthat (?:are not|aren'?t|is not|isn'?t) (?:mine|yours|ours)\b/i,
    why: 'that part needs an account that is not yours, and AMV only ever acts on accounts you have connected yourself.',
    instead: ['do the same thing on your own connected accounts',
              'draft what you would send and leave it for you to send',
              'set it up so it runs the moment you connect the right account'],
  },
  {
    id: 'other-people',
    /* A promise about a third party's behaviour. AMV can do the work; it
       cannot make anyone respond, hire, approve or follow. */
    re: /\b(?:make|get|force|ensure|guarantee)\b[^.!?]{0,30}\b(?:him|her|them|he|she|they|everyone|people|my (?:boss|ex|crush|teacher|landlord))\b[^.!?]{0,30}\b(?:reply|respond|answer|agree|say yes|hire me|approve|accept|call me back|follow|like|love|forgive)\b|\bguarantee\b[^.!?]{0,40}\b(?:i (?:get|win|pass)|go(?:es|ing)? viral|\d[\d,]*\s*(?:followers|views|likes|subscribers))\b|\bmake (?:it|this|me|my (?:video|post|page|account))\b[^.!?]{0,15}\bgo(?:es|ing)? viral\b/i,
    why: 'that part depends on what another person decides to do, and nobody can promise that - AMV will not pretend otherwise.',
    instead: ['do the work that makes it more likely, and show you what it did',
              'follow up on a schedule and tell you the moment there is a reply',
              'track the result honestly, including when it does not land'],
  },
  {
    id: 'is-you',
    /* Acts legally bound to a human identity. AMV can prepare every one of
       these; it cannot BE you at the moment of signing. */
    re: /\b(?:sit|take|write) (?:my|the) (?:exam|test|sat|act|gcse|a[- ]?levels?|driving test)\b|\bvote (?:for me|on my behalf|in the election)\b|\b(?:sign|swear|notarise|notarize) (?:it|this|the (?:contract|lease|deed|affidavit)) (?:as|for) me\b|\b(?:open|close) (?:a |my )?bank account\b|\bbe me\b|\bpretend to be me (?:on (?:the )?(?:phone|call))\b/i,
    why: 'that part has to be done by you in person - it is tied to your identity, and a signature or an ID check is the whole point of it.',
    instead: ['get everything ready so all that is left is your signature',
              'tell you exactly what the process is, what you need and what it costs',
              'put the deadline in your calendar and remind you before it'],
  },
];

/* THE FLOOR. Deterministic, instant, and correct with no engine connected.

   It returns the FIRST edge the request runs into, and nothing else - naming
   two problems at once reads as a wall of refusal for a request that may have
   one small impossible clause in it. */
function _feasFloor(text){
  const t = String(text || '');
  if(!t) return null;
  for(const e of FEAS_EDGES){ if(e.re.test(t)) return { edge:e.id, why:e.why, instead:e.instead.slice() }; }
  return null;
}

/* IS THE PLAN FICTION?

   A planner asked for steps will produce steps. Handed a request nothing can
   do, the honest answer is a refusal and the likely answer is three confident
   lines naming tools that are not there. So the plan is checked against the
   catalog afterwards: when NOTHING it named exists, there is no plan, and
   showing "0 done - 3 blocked" instead of saying so is how an agent wastes
   somebody's afternoon.

   Only when EVERY step is unbound. One unknown tool among four real ones is an
   ordinary blocked step, which the run already handles by parking it. */
function _feasPlanIsFiction(steps){
  const list = Array.isArray(steps) ? steps : [];
  if(!list.length) return false;
  return list.every(s => {
    if(!s || !s.tool) return true;
    const cid = String(s.tool).split('.')[0];
    return !AMVConnectors.get(cid);
  });
}

/* WHICH SHAPE DID THE PLANNER REPLY IN?

   Two are allowed - an array of steps, or a refusal object - and guessing
   wrong is expensive in one direction only. Reading a refusal as "no steps"
   loses the reason and shows a fallback plan for something that cannot be
   done, which is the failure this whole section exists to prevent.

   So it is decided by which bracket comes FIRST in the reply, not by trying
   one parse and falling back: a refusal object often contains an "instead"
   array, so looking for a `[` finds one inside the object and parses the
   wrong thing. Prose before the JSON is tolerated because models write it. */
function _feasParse(raw){
  try{
    const t = String(raw || '');
    const o = t.indexOf('{'), a = t.indexOf('[');
    if(o < 0) return null;
    if(a >= 0 && a < o) return null;               // an array came first: it is a plan
    const v = JSON.parse(t.slice(o, t.lastIndexOf('}') + 1));
    if(!v || !v.impossible) return null;
    return {
      impossible: true,
      why: String(v.why || 'AMV has nothing that can do this.').trim(),
      instead: Array.isArray(v.instead) ? v.instead.map(x => String(x)).filter(Boolean).slice(0, 4) : [],
    };
  }catch(e){ return null; }
}

/* WHERE THE PERSON IS, HANDED TO THE PLANNER.

   Asked for: "anything foreign country make sure it can actually recognize
   what it's asking for even if it's niche."

   Recognition is the planner's job and it is good at it - but a local term is
   ambiguous without a country, and the ambiguity is not exotic. "Pay my
   Bizum", "renew my NIE", "file my BIR 2316", "check my Aadhaar", "sort my
   PAYE" each mean one specific thing where they are said and nothing anywhere
   else. Crew already knows the country: somebody picked it in the filter, or
   the browser was asked. It just was not being passed along, so every request
   was planned as though it came from nowhere.

   Appended to the DATA half of the turn, not to the system prompt, for the
   same reason everything else read off the person's settings is - it is
   information about them, not an instruction, and the two must not share a
   channel. */
function _feasWhere(){
  try{
    const code = (typeof _cwCountryGuess === 'function') ? _cwCountryGuess() : '';
    if(!code) return '';
    let name = code;
    try{
      const row = (typeof CW_WORLD_COUNTRIES !== 'undefined')
        ? CW_WORLD_COUNTRIES.find(c => c[0] === code) : null;
      if(row) name = row[1];
    }catch(e){}
    return '\n\nWHERE THEY ARE: ' + name + '. If the request names a local service, tax, form, '
         + 'bank, payment method or authority, resolve it for that country rather than guessing at '
         + 'a similar-sounding one elsewhere. Web research and writing work in every country, so an '
         + 'unfamiliar local service is a thing to look up, not a reason to say it cannot be done.';
  }catch(e){ return ''; }
}
try{ window._feasWhere = _feasWhere; }catch(e){}

const AMVFeasible = {
  EDGES: FEAS_EDGES,
  floor: _feasFloor,
  planIsFiction: _feasPlanIsFiction,
  parse: _feasParse,
  where: _feasWhere,

  /* One sentence plus what AMV would do instead, ready to render. */
  say(v){
    if(!v) return '';
    return 'I cannot do this: ' + v.why;
  },
};
try{ window.AMVFeasible = AMVFeasible; window._feasFloor = _feasFloor; window._feasParse = _feasParse; }catch(e){}

/* ---------- 3. POLICY GATE ----------
   Universal does NOT mean lawless. These are refused outright, and the
   refusal is explicit rather than a silent failure. */
const AMV_POLICY = [
  /* "never went" was not caught, which is the most natural way anybody would
     phrase it about a restaurant or a hotel - the rule knew use, buy and visit
     only. Widened to the verbs people actually reach for, and to the "did not
     actually" form. */
  { re:/\bfake (review|rating|testimonial)|review bomb|astroturf|(?:post|write|leave) .{0,40}review .{0,30}(?:never|didn'?t|did not|have not|haven'?t) (?:use|used|buy|bought|visit|visited|go|went|been|try|tried|stay|stayed|order|ordered|eat|ate)|review .{0,30}(?:somewhere|something|a place) (?:i|we) (?:never|didn'?t)/i,
    why:'Posting a review for something you did not actually experience is review fraud (and illegal in many places). I can post an honest review of a real experience.' },
  { re:/\b(mass|bulk) (dm|message|email)|spam|blast .*(unsolicited)|scrape .*emails? .*(sell|list)/i,
    why:'Mass unsolicited messaging breaks platform rules and anti-spam law. I can send personalised messages to people you actually have a reason to contact.' },
  { re:/\b(hack|brute[- ]?force|bypass (login|captcha|2fa|paywall)|credential stuff|steal .*(password|account|card))/i,
    why:'That is unauthorised access. I will not do it.' },
  { re:/\bimpersonat|pretend to be (?!me\b)|catfish|fake (identity|profile|id)\b/i,
    why:'I can act as you on your own accounts, but I will not impersonate someone else.' },
  { re:/\b(ddos|denial of service|botnet|malware|ransomware|phish)/i,
    why:'That is an attack. I will not do it.' },
  /* BUYING FASTER THAN A PERSON CAN.

     This guard is on the agent that ACTS, and an agent that can drive a browser
     is one that can be pointed at a ticket queue. Automated buying to resell is
     specifically illegal in the US under the BOTS Act and in the UK under the
     Breaching Limits regulations, and it breaks the terms of every site that
     sells anything in limited quantity.

     The line is automation and intent to resell, not buying tickets. AMV
     finding four seats to a game and putting them in a basket is the ordinary
     use and stays allowed - the refusal is about queue-jumping software and
     buying inventory to flip. */
  { re:/\b(ticket|sneaker|drop|checkout|queue)[\s-]?bots?\b|\bbots? (?:to|that|for) (?:buy|cop|snag|grab|secure) |\bscalp|\bcop(?:ping)? (?:sneakers|drops|tickets)\b|beat the queue|skip the queue .*(bot|script|automat)/i,
    why:'Buying automatically to resell is ticket and inventory botting - illegal under the BOTS Act in the US and the equivalent rules elsewhere, and against the terms of every site that sells in limited quantity. I can find what is available and take you to it, and you can buy it yourself.' },
  /* Creating people who do not exist, at volume. Bulk accounts are the input to
     almost every other abuse on this list, so it is worth naming on its own
     rather than leaving it to the impersonation rule. */
  { re:/\b(bulk|mass|many|multiple|hundreds of|thousands of) (?:accounts?|sign[- ]?ups?|registrations?)\b|\baccount (?:generator|farm|creator bot)\b|\bcaptcha (?:farm|solving service|solver)\b|\bsim[- ]?swap/i,
    why:'Creating accounts in bulk, farming captchas or moving somebody\u2019s phone number are how other people get defrauded. I will not do any of them. I can set up one account for you, on a service you are entitled to use.' },
  /* Documents that assert something untrue about somebody. The model refuses
     this in conversation; this is the guard on the agent that could otherwise
     go and file one. */
  { re:/\b(?:fake|forged|counterfeit|fraudulent)\s+(?:passport|visa|id|identity|licence|license|diploma|degree|certificate|payslip|pay stub|bank statement|utility bill|reference)\b|\bforge (?:a |the )?(?:signature|document|letter)\b/i,
    why:'That document would assert something untrue about a real person, which is forgery wherever you are. I can help you get the real one - what the actual process is, what you need, and how to fill it in correctly.' }
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
    /* THE FLOOR, BEFORE ANYTHING SAYS "WORKING ON IT".

       Deterministic and instant, so the answer is the same with no engine
       connected - and first, so a request that runs into one of AMV's actual
       edges is answered rather than planned around. */
    const edge = _feasFloor(request);
    if(edge) return { impossible:true, why:edge.why, instead:edge.instead, edge:edge.edge, steps:[] };
    let _planErr = '';
    const cat = AMVConnectors.catalog();
    if(typeof _aiBackendReady === 'function' && _aiBackendReady() && typeof aiComplete === 'function'){
      const tools = cat.map(a => '- ' + a.id + ' (' + a.connectorName + (a.live ? ', connected' : ', NOT connected') + '): ' + a.desc).join('\n');
      const sys = 'You plan real actions for an autonomous agent. You are given the EXACT tool catalog. '
        + 'Break the request into the fewest concrete steps that finish it end to end. '
        + 'Each step MUST pick a tool id from the catalog, or use "browser.do" for any site with no API (give {url, goal}). '
        + 'Return ONLY JSON: [{"title":"short","tool":"connector.action","args":{...},"needs_approval":true|false}]. '
        + 'Set needs_approval true for anything that sends, posts, publishes, buys, deletes or contacts someone. '
        /* THE ONLY GENERAL ANSWER TO "CAN THIS BE DONE". A list of impossible
           requests is a list of the ones somebody thought of; this is the one
           thing in the system holding the whole catalog, so it is the only
           thing that can answer for the request nobody anticipated. Allowed to
           refuse so it is not forced to invent steps it knows are fiction. */
        + 'If NOTHING in this catalog, in any combination, can finish the request - it needs a physical action, '
        + 'an account that is not the user\'s, a service that is not listed, or an outcome nobody can promise - '
        + 'return ONLY {"impossible":true,"why":"one plain sentence, no apology","instead":["what you would do instead","..."]} '
        + 'instead of the array. Do NOT use this for something that merely needs connecting: that is a step, not an impossibility.';
      try{
        const raw = await aiComplete('TOOL CATALOG:\n' + tools + _feasWhere() + '\n\nREQUEST: ' + request, sys, { max_tokens: 1400 });
        /* Either shape, and which one is decided by which bracket comes first
           in the reply rather than by hoping for one of them. */
        const v = _feasParse(raw);
        if(v && v.impossible) return { impossible:true, why:v.why, instead:v.instead, edge:'catalog', steps:[] };
        const arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
        if(Array.isArray(arr) && arr.length){
          const steps = arr.slice(0, this.MAX_STEPS);
          /* A PLAN THAT NAMES NOTHING REAL IS NOT A PLAN.

             Asked for steps, a planner produces steps. Handed something
             nothing can do, the likely answer is three confident lines naming
             tools that are not there - and running that spends somebody's
             afternoon on "0 done - 3 blocked". Only when EVERY step is
             unbound: one unknown tool among four real ones is an ordinary
             blocked step, which the run already parks. */
          if(_feasPlanIsFiction(steps))
            return { impossible:true, edge:'no-tools', steps:[],
                     why:'nothing AMV can reach does this - the steps it came up with are not bound to anything real.',
                     instead:['tell you what would have to be connected for this to work',
                              'do the part of it that does map onto something AMV has',
                              'find and hand you the place where it can be done by hand'] };
          return { steps };
        }
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
  /* CANNOT is not the same as WILL NOT, and saying the wrong one is its own
     failure. A refusal implies AMV is choosing; this is the honest statement
     that there is nothing to choose. It leads with what it CAN do, because
     somebody who asked for a lift to the airport still wants the taxi booked
     and the calendar entry - and that is the whole difference between a dead
     end and an assistant. */
  if(p.impossible){
    paint('<div class="uni-plan cannot">' +
      '<div class="uni-h">This part I genuinely cannot do</div>' +
      '<div class="uni-why">' + escH(p.why) + '</div>' +
      (p.instead && p.instead.length
        ? '<div class="uni-instead"><b>What I can do instead</b><ul>' +
          p.instead.map(x => '<li>' + escH(x) + '</li>').join('') + '</ul>' +
          '<div class="uni-resume">Say which one and I will start on it.</div></div>'
        : '') +
      '</div>');
    return { impossible: true, why: p.why, instead: p.instead || [], edge: p.edge || '' };
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
