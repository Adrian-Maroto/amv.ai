/* ══════════════════════════════════════════════════════════════════════════
   THE COUNTRY CATALOGUE (Nov 10) - Tasks, Crew jobs and Integrations built from
   real, named services in the country you choose.

   The owner's bar: "500+ in every section, for every country, backed by real
   data - that is what makes us so good." The data is data/countries/<CC>.json,
   built by scripts/country-data.mjs from Wikidata: per country, the banks,
   universities, newspapers, telecom operators, airlines, retailers, agencies
   and more that are there, have an official website and have not closed,
   ranked by how many Wikipedia editions cover them. Each entry carries its
   Wikidata ID, so every row on these screens can be traced to a public record.

   What is built from it, per entry:
   - TASKS: what people do with that kind of service - open an account at a
     bank, apply to a university, claim from an airline - naming the service
     and its own site, opened as a chat.
   - CREW: what is worth watching on a schedule - fee changes at a bank, price
     drops at a shop, new jobs at an employer, disruptions on a rail line - run
     with web research.
   - INTEGRATIONS: the service itself, reached through AMV's own browser, where
     the person signs in on the real site and nothing is stored by AMV.

   Nothing here invents a service: a kind a country has no entries for offers
   nothing, and the count on each screen is the count of what is really there.
   ══════════════════════════════════════════════════════════════════════════ */

/* kind -> [icon, label]. */
const CC_KINDS = {
  bank:['🏦','Banks'], insurer:['🛡️','Insurance'], university:['🎓','Universities'],
  college:['🎓','Colleges'], newspaper:['📰','Newspapers'], newssite:['📰','News sites'],
  tv:['📺','TV channels'], radio:['📻','Radio'], telecom:['📱','Mobile networks'],
  isp:['🌐','Internet providers'], airline:['✈️','Airlines'], airport:['🛫','Airports'],
  rail:['🚆','Rail'], bus:['🚌','Transport'], retail:['🛍️','Shops'],
  supermarket:['🛒','Supermarkets'], ecommerce:['📦','Online shops'], restaurant:['🍔','Restaurants'],
  hotel:['🏨','Hotels'], agency:['🏛️','Government'], ministry:['🏛️','Ministries'],
  hospital:['🏥','Hospitals'], utility:['⚡','Energy'], carmaker:['🚗','Car makers'],
  museum:['🏛️','Museums'], library:['📚','Libraries'], sportsclub:['⚽','Football clubs'],
  employer:['💼','Employers'],
  school:['🏫','Schools'], research:['🔬','Research'], publisher:['📖','Publishers'],
  software:['💻','Software'], pharma:['💊','Pharmaceuticals'], nonprofit:['🤝','Nonprofits'],
  theatre:['🎭','Theatres'], stadium:['🏟️','Stadiums'], mall:['🏬','Shopping centres'],
  park:['🏞️','National parks'], zoo:['🦁','Zoos'], festival:['🎪','Festivals'],
  embassy:['🛂','Embassies'], union:['✊','Trade unions'], brewery:['🍺','Breweries'],
  company:['🏢','Companies'],
};

/* What people do with each kind. [title, prompt]; {n} is the service, {s} its
   site. The prompts ask for official sources and never act on their own. */
const CC_TASKS = {
  bank:[['Open an account at {n}','What do I need to open an account at {n} ({s})? Documents, fees and the steps, from their official site.'],
        ['{n}: fees explained','Explain the current account fees at {n}, using {s}. Which can I avoid, and how?'],
        ['Dispute a charge with {n}','Help me dispute a charge of [amount] from [merchant] on my {n} card. Draft the message; do not send it.'],
        ['Compare {n} with another bank','Compare {n} with [another bank] on fees, app, savings rates and support, from their official sites.'],
        ['{n} savings rates','What savings and deposit rates does {n} offer right now? Use {s} and say when it was last updated.']],
  insurer:[['Get a quote from {n}','What would [type of cover] from {n} cost me, and what is excluded? Use {s}.'],
           ['What my {n} policy covers','Explain what my {n} policy covers and excludes. Here is the policy: [paste or attach]'],
           ['Make a claim with {n}','How do I make a claim with {n} for [what happened]? The steps, the documents and the deadline, from {s}.'],
           ['Cancel a {n} policy','How do I cancel my {n} policy, what notice is needed, and is anything refunded?']],
  university:[['Apply to {n}','How do I apply to {n} for [course]? Requirements, deadlines and steps, from {s}.'],
              ['{n} deadlines','List the application and enrolment deadlines at {n} for [year], each with its official page on {s}.'],
              ['Scholarships at {n}','What scholarships and financial aid does {n} offer for [my situation]? Official sources only.'],
              ['{n} entry requirements','What grades, tests or documents does {n} require for [course], and by when? Use {s}.'],
              ['Visit {n}','Plan a visit to {n}: open days, campus tours and how to get there.']],
  college:[['Apply to {n}','How do I apply to {n} for [course]? Requirements, deadlines and steps, from {s}.'],
           ['{n} courses and fees','What does [course] at {n} cost, and how long does it take? Use {s}.'],
           ['{n} deadlines','List the application deadlines at {n}, each with its official page.']],
  newspaper:[['Today in {n}','Brief me on today’s main stories in {n} ({s}), each in two sentences with a link.'],
             ['What {n} says about it','What has {n} reported about [topic] this month? Summarise, with links.']],
  newssite:[['Today on {n}','Brief me on today’s main stories on {n} ({s}), with links.'],
            ['{n} on a topic','What has {n} published about [topic] recently? Summarise, with links.']],
  tv:[['What is on {n} tonight','What is on {n} tonight and this week, and which shows are worth it? Use {s}.'],['Watch {n} online','How can I watch {n} online or on demand, and what does it cost?']],
  radio:[['Listen to {n}','How do I listen to {n} live or catch up on a programme? Use {s}.']],
  telecom:[['A cheaper {n} plan','Find the cheapest {n} plan for [my usage] on {s}, and what changes from mine.'],
           ['Cancel {n}','How do I cancel or switch away from {n}? Notice period, fees and steps.'],
           ['Fix a {n} problem','Help me fix [problem] with my {n} service, then draft a message to their support if it is still not working.'],
           ['{n} coverage','How good is {n} coverage at [address or area]? Official coverage map and independent reports.']],
  isp:[['A better {n} deal','Is there a cheaper or faster {n} plan for [address]? Use {s}.'],
       ['Report a {n} outage','Is {n} down in [area] right now, and how do I report it?']],
  airline:[['Find a {n} flight','Find {n} flights from [A] to [B] around [dates], with prices and baggage.'],
           ['{n} baggage rules','What are {n}’s cabin and checked baggage allowances and fees for [route or fare]? Use {s}.'],
           ['Claim from {n}','My {n} flight [number, date] was [delayed / cancelled]. What am I owed, and draft the claim. Do not send it.'],
           ['Check in with {n}','How and when do I check in with {n} for [flight], and what do I need at the airport? Use {s}.']],
  airport:[['Get to {n}','The best way to get to {n} from [place] at [time], with cost and time.'],
           ['{n} arrivals and delays','Are there delays at {n} today? Use the airport’s own pages at {s}.']],
  rail:[['Plan a trip with {n}','Plan a trip with {n} from [A] to [B] on [date]: times, fares and the cheapest ticket.'],
        ['{n} passes and discounts','What passes, cards or discounts does {n} offer for [my travel]? Use {s}.'],
        ['Refund a {n} ticket','How do I get a refund or compensation from {n} for [what happened]?']],
  bus:[['Plan a trip with {n}','Plan a trip with {n} from [A] to [B]: times, fares and tickets.'],['{n} tickets and passes','What tickets and passes does {n} sell, and which is cheapest for [my travel]?']],
  retail:[['Best price at {n}','What does [product] cost at {n} right now, with delivery? Compare with two other shops.'],
          ['Return something to {n}','How do I return [item] to {n}? The deadline, the steps and what I get back.'],
          ['{n} offers this week','What offers does {n} have this week on [category]? Use {s}.']],
  supermarket:[['A week’s shop at {n}','Plan a week of groceries for [people] on [budget] using {n}’s current prices.'],
               ['{n} offers this week','What is on offer at {n} this week, and which deals are actually good? Use {s}.']],
  ecommerce:[['Best price on {n}','Find the best price for [product] on {n}, with delivery and seller ratings.'],
             ['Return something to {n}','How do I return [item] bought on {n} ({s}) - the deadline, who pays postage and when the refund arrives?'],
             ['Track a {n} order','How do I track my {n} order [number], and what if it is late?']],
  restaurant:[['{n} menu and allergens','What does {n} serve, and which dishes are free of [allergen]? Use {s}.'],['{n} near me','Where is the nearest {n} to [place], and what are its hours?']],
  hotel:[['Stay at a {n} hotel','Compare {n} hotels in [city] for [dates], with prices and cancellation terms.'],['{n} cancellation policy','What is {n}’s cancellation and refund policy for [rate]?']],
  agency:[['Get something done with {n}','How do I [what you need] with {n}? Official steps, documents and fees, from {s}.'],
          ['{n} forms and deadlines','What forms and deadlines does {n} have for [my situation]?'],
          ['Contact {n}','How do I contact {n} about [issue], and what should I have ready?']],
  ministry:[['Get something done with {n}','How do I [what you need] with {n}? Official steps, from {s}.'],['{n} announcements','What has {n} announced recently that affects [me / my situation]?']],
  hospital:[['An appointment at {n}','How do I book an appointment at {n} for [department]? Use {s}.'],['{n} services and visiting','What services does {n} offer, and what are the visiting hours?']],
  utility:[['Understand a {n} bill','Explain this {n} bill and what I can do to lower it: [paste or attach].'],
           ['Switch away from {n}','Is there a cheaper energy supplier than {n} for [my usage]? How do I switch?'],
           ['Report a {n} outage','Is there a power outage with {n} in [area]? How do I report one?']],
  carmaker:[['Service my {n}','How often does my {n} [model] need servicing, and what does it cost at an official dealer?'],
            ['{n} recalls','Is my {n} [model, year] affected by any recall? Official sources only.'],
            ['Compare {n} models','Compare {n} models for [needs and budget], with prices and running costs.']],
  museum:[['Visit {n}','Plan a visit to {n}: hours, tickets, what not to miss. Use {s}.'],['{n} exhibitions','What exhibitions are on at {n} now and coming up, with dates and ticket prices? Use {s}.']],
  library:[['Use {n}','How do I join {n} and borrow books or e-books? Use {s}.']],
  sportsclub:[['{n} fixtures','When does {n} play next, and where can I watch or buy a ticket? Use {s}.'],['{n} tickets','How do I buy tickets for a {n} match, and what do they cost?']],
  employer:[['Jobs at {n}','Find current [role] openings at {n}, with locations and how to apply. Use {s}.'],
            ['Interview at {n}','Prepare me for an interview at {n} for [role]: what they ask and what they value.'],
            ['{n} at a glance','Give me a short, sourced brief on {n}: what it does, recent news and reputation as an employer.']],
  school:[['Enrol at {n}','How do I enrol a child at {n}? Ages, documents, fees if any and deadlines, from {s}.'],
          ['{n} term dates','What are the term dates, holidays and exam weeks at {n} for [year]? Use {s}.'],
          ['Contact {n}','Who do I contact at {n} about [my question], and how? Use the official details on {s}.']],
  research:[['{n} at a glance','Give me a short, sourced brief on {n}: what it researches, who funds it and its best-known work.'],
            ['Latest research from {n}','Summarise the latest published research from {n} on [topic], with links to the sources.']],
  publisher:[['New books from {n}','What has {n} published recently in [genre or subject]? Titles, authors and dates, from {s}.'],
             ['Submit to {n}','Does {n} accept submissions for [my kind of work], and what are the guidelines? Use {s}.']],
  software:[['{n} at a glance','Give me a short, sourced brief on {n}: its products, prices and how it compares with rivals.'],
            ['Get help with {n}','I have this problem with a {n} product: [describe]. Find the official fix on {s} and walk me through it.'],
            ['Jobs at {n}','What roles is {n} hiring for in [field]? Use their careers page on {s} and list what each asks for.']],
  pharma:[['{n} at a glance','Give me a short, sourced brief on {n}: what it makes, recent news and where it operates.'],
          ['Jobs at {n}','What roles is {n} hiring for in [field]? Use their careers page on {s} and list what each asks for.']],
  nonprofit:[['Volunteer with {n}','How can I volunteer with {n} in [place]? What they need, the time it takes and how to apply, from {s}.'],
             ['Donate to {n}','How does {n} use donations, and what are the ways to give? Official figures from {s}; do not pay anything.'],
             ['Get help from {n}','Can {n} help with [my situation]? Who qualifies and how to ask, from {s}.']],
  theatre:[['What is on at {n}','What is on at {n} this month and next, with dates and ticket prices? Use {s}.'],
           ['{n} tickets','How do I buy tickets for [show] at {n}, what do they cost and which seats are good value?'],
           ['Get to {n}','What is the best way to get to {n} from [place] - public transport, parking and how long to allow?']],
  stadium:[['Events at {n}','What events are coming up at {n}, with dates and how to buy tickets? Use {s}.'],
           ['Get to {n}','What is the best way to get to {n} from [place] on an event day - transport, parking and when to leave?'],
           ['{n} tickets','How do I buy tickets for [event] at {n}, what do they cost and what can I bring in?']],
  mall:[['Shops and hours at {n}','Which shops and restaurants are at {n}, and what are the opening hours this week? Use {s}.'],
        ['Get to {n}','What is the best way to get to {n} from [place] - public transport, parking and the quiet times?']],
  park:[['Visit {n}','Plan a visit to {n} for [dates]: how to get there, entry fees, where to stay and what not to miss.'],
        ['Trails and rules at {n}','What are the best trails at {n} for [my level], and what permits or rules apply? Use {s}.']],
  zoo:[['Visit {n}','Plan a visit to {n}: opening hours, ticket prices, how to get there and what not to miss. Use {s}.'],
       ['{n} tickets','What do tickets to {n} cost for [who is going], and is it cheaper to book ahead? Use {s}.']],
  festival:[['{n} dates and line-up','When is {n} next held, what is on the programme and where does it take place? Use {s}.'],
            ['{n} tickets','How do I get tickets for {n}, what do they cost and when do they go on sale? Use {s}.']],
  embassy:[['Visa at {n}','What visa do I need for [purpose of travel], and how do I apply through {n}? Documents, fees and timing, from {s}.'],
           ['An appointment at {n}','How do I book an appointment at {n} for [service], and what must I bring? Use {s}.'],
           ['Contact {n}','How do I contact {n} about [my question] - address, hours and the right department? Use {s}.']],
  union:[['Join {n}','Who can join {n}, what does it cost and what do members get? Use {s}.'],
         ['Get help from {n}','Can {n} help with [my situation at work]? What they offer members and how to ask, from {s}.']],
  brewery:[['Visit {n}','Does {n} offer tours or tastings? Times, prices and how to book, from {s}.'],
           ['{n} at a glance','Give me a short, sourced brief on {n}: its history, what it makes and where to find it.']],
  company:[['{n} at a glance','Give me a short, sourced brief on {n}: what it does, recent news and how it is regarded.'],
           ['Jobs at {n}','What roles is {n} hiring for in [field]? Use their careers page on {s} and list what each asks for.'],
           ['Contact {n}','How do I reach the right team at {n} about [my question]? Official contact details from {s}.'],
           ['Complain to {n}','Help me write a complaint to {n} about [what happened], with what I want done. Draft it; do not send it.']],
};

/* What is worth watching on a schedule, per kind. [title, prompt, every]. */
const CC_CREW = {
  bank:[['Watch {n} for fee and rate changes','Check {s} for any change to {n}’s fees, interest rates or terms since last time, and report only what changed.','weekly']],
  insurer:[['{n} renewal check','A month before my {n} renewal on [date], compare my premium with current quotes and tell me if switching saves money.','monthly']],
  university:[['{n} deadline watch','Watch {s} for application, scholarship and enrolment deadlines at {n}, and remind me two weeks before each.','weekly']],
  college:[['{n} deadline watch','Watch {s} for deadlines at {n}, and remind me two weeks before each.','weekly']],
  newspaper:[['Morning brief from {n}','Every morning, the five most important stories in {n} ({s}), each in two sentences with a link.','daily']],
  newssite:[['Morning brief from {n}','Every morning, the top stories on {n} ({s}), each in two sentences with a link.','daily']],
  tv:[['Tonight on {n}','Every evening, what is worth watching on {n} tonight.','daily']],
  telecom:[['Is {n} still my best deal?','Each month, compare what I pay {n} for [my plan] with their current plans and two rivals, and tell me if I could save.','monthly'],
           ['{n} outage watch','Each day, check for reported {n} outages in [area] and tell me only if there is one.','daily']],
  isp:[['{n} outage watch','Each day, check for reported {n} outages in [area] and tell me only if there is one.','daily']],
  airline:[['{n} fare watch','Each day, check {n} fares from [A] to [B] for [dates] and tell me when the price drops.','daily']],
  airport:[['Delays at {n}','On my travel days, check {n} for delays and cancellations affecting [flight].','daily']],
  rail:[['Disruptions on {n}','Each morning, check {n} for disruption on [my route] and tell me only if there is any.','daily']],
  bus:[['Disruptions on {n}','Each morning, check {n} for disruption on [my route].','daily']],
  retail:[['Price drops at {n}','Each day, check {n} for a price drop on [product] and tell me when it falls below [price].','daily'],
          ['{n} weekly offers','Each week, the best offers at {n} ({s}) on [categories], with prices.','weekly']],
  supermarket:[['{n} weekly offers','Each week, the offers at {n} on what I usually buy: [list].','weekly']],
  ecommerce:[['Price drops on {n}','Each day, check {n} ({s}) for a price drop on [product], with the old and new price.','daily']],
  restaurant:[['New offers at {n}','Each week, any new deals at {n} ({s}) on [what I want], with prices.','weekly']],
  hotel:[['{n} price watch','Each day, check {n} prices in [city] for [dates] and tell me when they fall.','daily']],
  agency:[['New from {n}','Each week, any announcement, form or deadline from {n} that affects [my situation].','weekly']],
  ministry:[['New from {n}','Each week, announcements from {n} that affect [my situation].','weekly']],
  utility:[['Is {n} still my best price?','Each month, compare my {n} tariff with current offers and tell me if switching saves money.','monthly']],
  carmaker:[['{n} recall watch','Each month, check for new recalls affecting my {n} [model, year].','monthly']],
  museum:[['New at {n}','Each month, new exhibitions and events at {n}, with dates and how to book ({s}).','monthly']],
  sportsclub:[['{n} match week','Each week, {n}’s next fixtures, results and team news.','weekly']],
  employer:[['New jobs at {n}','Each day, new [role] openings at {n} in [location], with links.','daily']],
  school:[['{n} deadline watch','Watch {s} for enrolment dates, term dates and closures at {n}, and remind me a week before each.','weekly']],
  research:[['New from {n}','Each month, new publications and announcements from {n} on [topic], with links.','monthly']],
  publisher:[['New from {n}','Each month, new releases from {n} in [genre or subject], with dates.','monthly']],
  software:[['New from {n}','Each week, product updates, price changes and security notices from {n} ({s}).','weekly']],
  pharma:[['New from {n}','Each month, announcements and recalls from {n} that concern [product or topic].','monthly']],
  nonprofit:[['New from {n}','Each month, news, appeals and volunteer openings from {n} ({s}).','monthly']],
  theatre:[['New at {n}','Each month, new shows announced at {n}, with dates and when booking opens ({s}).','monthly']],
  stadium:[['New at {n}','Each month, newly announced events at {n}, with dates and when tickets go on sale.','monthly']],
  mall:[['New at {n}','Each month, new shops, events and changed opening hours at {n} ({s}).','monthly']],
  park:[['{n} conditions','Before my visit on [dates], check {n} for closures, weather warnings and trail conditions ({s}).','weekly']],
  zoo:[['New at {n}','Each month, new events, arrivals and ticket offers at {n} ({s}).','monthly']],
  festival:[['New from {n}','Each week, line-up announcements and ticket release dates from {n} ({s}).','weekly']],
  embassy:[['New from {n}','Each week, any change to visa rules, fees or appointment availability at {n} ({s}).','weekly']],
  union:[['New from {n}','Each month, news from {n} that affects [my job or sector].','monthly']],
  brewery:[['New from {n}','Each month, new releases, tours and events from {n} ({s}).','monthly']],
  company:[['New jobs at {n}','Each day, new [role] openings at {n} in [location], with links.','daily']],
};

/* One country's file, fetched once. */
const _ccCache = {};
async function ccLoad(cc){
  cc = String(cc || '').toUpperCase();
  if(!/^[A-Z]{2}$/.test(cc)) return null;
  if(_ccCache[cc]) return _ccCache[cc];
  _ccCache[cc] = (async () => {
    try{
      const r = await fetch('countries/' + cc + '.json', { cache: 'force-cache' });
      if(!r.ok) return null;
      const d = await r.json();
      return (d && d.kinds && typeof d.kinds === 'object') ? d : null;
    }catch(e){ return null; }
  })();
  const d = await _ccCache[cc];
  if(!d) delete _ccCache[cc];   // a failed fetch is tried again next time
  return d;
}
const _ccFill = (t, e) => String(t).replace(/\{n\}/g, e.n).replace(/\{s\}/g, e.s);
/* Every task, job and service for a country, each tied to the entry it names. */
function ccTasks(d){
  const by = [];
  for(const [kind, list] of Object.entries((d && d.kinds) || {})){
    const tpl = CC_TASKS[kind]; if(!tpl) continue;
    by.push(list.map(e => tpl.map((t, i) => ({ id:'cc-' + kind + '-' + e.q + '-' + i, kind, e,
      tpl:t[0], title:_ccFill(T(t[0]), e), prompt:_ccFill(t[1], e) }))));
  }
  /* Interleaved, so the first rows span many services rather than five tasks
     for one bank: a first pass takes one task per service - rank by rank,
     across every kind, rotating which task - and the rest follow in order. */
  return _ccWeave(by);
}
/* by: [kind][entry][template] -> one list, first pass across kinds. */
function _ccWeave(by){
  const out = [], first = new Set(), most = Math.max(0, ...by.map(k => k.length));
  for(let r = 0; r < most; r++) for(const k of by){ const ts = k[r]; if(!ts || !ts.length) continue; const t = ts[r % ts.length]; out.push(t); first.add(t.id); }
  for(const k of by) for(const ts of k) for(const t of ts) if(!first.has(t.id)) out.push(t);
  return out;
}
function ccJobs(d){
  const by = [];
  for(const [kind, list] of Object.entries((d && d.kinds) || {})){
    const tpl = CC_CREW[kind]; if(!tpl) continue;
    by.push(list.map(e => tpl.map((t, i) => ({ id:'ccj-' + kind + '-' + e.q + '-' + i, kind, e,
      title:_ccFill(T(t[0]), e), prompt:_ccFill(t[1], e), every:t[2] }))));
  }
  return _ccWeave(by);
}
function ccServices(d){
  const out = [];
  for(const [kind, list] of Object.entries((d && d.kinds) || {})) for(const e of list) out.push({ kind, e });
  return out;
}
try{ window.ccLoad = ccLoad; window.ccTasks = ccTasks; window.ccJobs = ccJobs; window.ccServices = ccServices; }catch(e){}

/* CREW: the catalogue's jobs as ordinary Crew jobs, so the panel, the "when"
   picker and the switch treat them exactly like the rest. They run on AMV's
   servers with web research - no account is asked for. */
const _ccCrewJobs = {};
try{ window._ccCrewJobs = _ccCrewJobs; }catch(e){}
async function ccCrewLoad(cc){
  const d = await ccLoad(cc); if(!d) return [];
  _ccCrewJobs[cc] = ccJobs(d).map(j => ({
    id: j.id, icon: (CC_KINDS[j.kind] || ['\u2022'])[0], title: j.title,
    desc: j.prompt.replace(/\[[^\]]*\]/g, '\u2026'), prompt: j.prompt, every: j.every,
    needs: 'Web research', cat: (CC_KINDS[j.kind] || ['', ''])[1], kind: 'research', ccKind: j.kind, site: j.e.s, src: j.e.q,
  }));
  return _ccCrewJobs[cc];
}
/* The section on Crew: every job for the country, by kind, first rows then all. */
async function ccFillCrew(){
  const host = document.getElementById('cc-crew'); if(!host) return;
  const cc = (typeof _cwCountryGuess === 'function') ? _cwCountryGuess() : '';
  const list = await ccCrewLoad(cc);
  if(!host.isConnected || !list.length) return;
  const row = (typeof _cwCountryRow === 'function') ? _cwCountryRow(cc) : null;
  const kinds = [...new Set(list.map(j => j.ccKind))];
  host.innerHTML = `<div class="sec-head"><h3>${escH(row ? _cwSayPlace('Every job for {country}', row[1], _cwThe(row[1])) : T('Every job for you'))}</h3>
      <span class="sec-sub"><b>${list.length}</b> ${escH(T('jobs watching real services there'))} \u00b7 ${escH(T('Source'))}: Wikidata</span></div>
    <div class="cw-chips cc-chips" role="group" aria-label="${escH(T('Filter by kind'))}">
      <button class="cw-chip on" data-cc-kind="">${escH(T('All'))}</button>
      ${kinds.map(k => `<button class="cw-chip" data-cc-kind="${k}"><span aria-hidden="true">${(CC_KINDS[k] || ['', ''])[0]}</span><span>${escH(T((CC_KINDS[k] || ['', k])[1]))}</span></button>`).join('')}
    </div>
    <div class="cc-list cc-jobs">${list.map((j, i) => `<button class="cc-job${i >= 24 ? ' cc-more' : ''}" data-cc="${j.ccKind}" data-dact="cwPeek" data-darg="${escH(j.id)}">
        <span class="cc-job-ic" aria-hidden="true">${j.icon}</span>
        <span class="cc-job-b"><span class="cc-job-t" data-no-i18n>${escH(j.title)}</span><span class="cc-job-s" data-no-i18n>${escH(j.site)} \u00b7 ${escH(T({ daily: 'Every day', weekly: 'Every week', monthly: 'Every month' }[j.every] || 'Every day'))}</span></span>
        <span class="tk-arrow" aria-hidden="true">\u2192</span></button>`).join('')}</div>
    ${list.length > 24 ? `<button class="btn bs cc-all" id="cc-crew-all">${escH(T('Show all'))} (${list.length})</button>` : ''}`;
  host.hidden = false;
  host.querySelectorAll('[data-cc-kind]').forEach(c => on(c, 'click', () => {
    host.querySelectorAll('[data-cc-kind]').forEach(x => x.classList.toggle('on', x === c));
    const k = c.dataset.ccKind; host.classList.toggle('cc-filtered', !!k);
    host.querySelectorAll('.cc-job').forEach(r => r.classList.toggle('cc-off', !!k && r.dataset.cc !== k));
  }));
  on(document.getElementById('cc-crew-all'), 'click', function(){ host.classList.add('cc-open'); this.remove(); });
}
try{ window.ccFillCrew = ccFillCrew; }catch(e){}

/* INTEGRATIONS: every service in the country, reached through AMV's own
   browser - the person signs in on the real site themselves and AMV keeps no
   password. "Use in chat" opens a chat set up to work on that site. */
const _ccSvc = {};
async function ccFillIntegrations(){
  const host = document.getElementById('cc-int'); if(!host) return;
  const cc = (typeof _cwCountryGuess === 'function') ? _cwCountryGuess() : '';
  const d = await ccLoad(cc);
  if(!host.isConnected || !d) return;
  const list = ccServices(d);
  if(!list.length) return;
  list.forEach(x => { _ccSvc[x.e.q] = x; });
  const row = (typeof _cwCountryRow === 'function') ? _cwCountryRow(cc) : null;
  const kinds = [...new Set(list.map(x => x.kind))];
  host.innerHTML = `<div class="sec-head"><h3>${escH(row ? _cwSayPlace('Services in {country}', row[1], _cwThe(row[1])) : T('Services where you are'))}</h3>
      <span class="sec-sub"><b>${list.length}</b> ${escH(T('real services there, each through AMV\u2019s browser - you sign in on the real site'))} \u00b7 ${escH(T('Source'))}: Wikidata</span></div>
    <div class="cw-chips cc-chips" role="group" aria-label="${escH(T('Filter by kind'))}">
      <button class="cw-chip on" data-cc-kind="">${escH(T('All'))}</button>
      ${kinds.map(k => `<button class="cw-chip" data-cc-kind="${k}"><span aria-hidden="true">${(CC_KINDS[k] || ['', ''])[0]}</span><span>${escH(T((CC_KINDS[k] || ['', k])[1]))}</span></button>`).join('')}
    </div>
    <div class="cc-list cc-svcs">${list.map((x, i) => `<div class="cc-svc${i >= 30 ? ' cc-more' : ''}" data-cc="${x.kind}">
        <span class="cc-job-ic" aria-hidden="true">${(CC_KINDS[x.kind] || ['\u2022'])[0]}</span>
        <span class="cc-job-b"><span class="cc-job-t" data-no-i18n>${escH(x.e.n)}</span><span class="cc-job-s" data-no-i18n>${escH(x.e.s)}</span></span>
        <button class="btn bs cc-use" type="button" data-dact="ccUseService" data-darg="${escH(x.e.q)}">${escH(T('Use in chat'))}</button></div>`).join('')}</div>
    ${list.length > 30 ? `<button class="btn bs cc-all" id="cc-int-all">${escH(T('Show all'))} (${list.length})</button>` : ''}`;
  host.hidden = false;
  host.querySelectorAll('[data-cc-kind]').forEach(c => on(c, 'click', () => {
    host.querySelectorAll('[data-cc-kind]').forEach(x => x.classList.toggle('on', x === c));
    const k = c.dataset.ccKind; host.classList.toggle('cc-filtered', !!k);
    host.querySelectorAll('.cc-svc').forEach(r => r.classList.toggle('cc-off', !!k && r.dataset.cc !== k));
  }));
  on(document.getElementById('cc-int-all'), 'click', function(){ host.classList.add('cc-open'); this.remove(); });
}
function ccUseService(q){
  const x = _ccSvc[q]; if(!x) return;
  const text = 'Using AMV\u2019s browser, open ' + x.e.s + ' (' + x.e.n + '). I will sign in myself if it asks. Then help me [what you want to do there].';
  setTab('chat');
  setTimeout(() => { const ta = document.getElementById('mta'); if(!ta) return;
    ta.value = text; fitChatComposer(ta); ta.focus(); const a = text.indexOf('['); if(a >= 0) ta.setSelectionRange(a, text.indexOf(']') + 1); }, 150);
}
try{ window.ccFillIntegrations = ccFillIntegrations; window.ccUseService = ccUseService; }catch(e){}
