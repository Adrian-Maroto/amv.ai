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

/* What is worth watching on a schedule, per kind. [title, prompt, every].

   Nov 15 (owner: "1000+ jobs for every country, specific to it, based on what
   people there actually use"). Several jobs per kind, each a different thing a
   person would want watched on that service's PUBLIC site - so every one runs
   on AMV's servers with web research and no sign-in, and none asks for an
   account it cannot use. A blank in [brackets] is asked for when the job is
   switched on. */
const CC_CREW = {
  bank:[['Watch {n} for fee and rate changes','Check {s} for any change to {n}’s fees, interest rates or terms since last time, and report only what changed.','weekly'],
        ['{n} savings and deposit rates','Each week, the savings and deposit rates {n} publishes on {s}, and whether any moved since last week.','weekly'],
        ['{n} service and outage notices','Each day, check {s} and {n}’s official channels for app or card outages and planned maintenance, and tell me only if there is one.','daily'],
        ['New offers at {n}','Each month, any new account, card or mortgage offer {n} announces on {s}, with its conditions.','monthly']],
  insurer:[['{n} renewal check','A month before my {n} renewal on [date], compare my premium with current quotes and tell me if switching saves money.','monthly'],
           ['Policy changes at {n}','Each month, any change {n} announces to its policies, prices or claims process on {s}.','monthly'],
           ['New cover from {n}','Each month, new products or discounts {n} offers on {s}, with who they are for.','monthly']],
  university:[['{n} deadline watch','Watch {s} for application, scholarship and enrolment deadlines at {n}, and remind me two weeks before each.','weekly'],
              ['Scholarships at {n}','Each week, new scholarships and grants {n} lists on {s}, with eligibility and the closing date.','weekly'],
              ['Open days at {n}','Each month, open days, info sessions and campus events at {n}, with dates and how to sign up.','monthly'],
              ['{n} news for students','Each week, announcements from {n} that affect students - term dates, fees, closures - with links.','weekly']],
  college:[['{n} deadline watch','Watch {s} for deadlines at {n}, and remind me two weeks before each.','weekly'],
           ['Courses starting at {n}','Each month, courses at {n} opening for enrolment, with start dates and fees from {s}.','monthly'],
           ['Open days at {n}','Each month, open days and info sessions at {n}, with dates and how to sign up.','monthly']],
  newspaper:[['Morning brief from {n}','Every morning, the five most important stories in {n} ({s}), each in two sentences with a link.','daily'],
             ['{n} on a topic you follow','Each day, only the stories in {n} about [topic], each in two sentences with a link.','daily'],
             ['The week in {n}','Every Sunday, the ten stories {n} covered most this week, in one page.','weekly'],
             ['{n} opinion digest','Each week, the main opinion pieces in {n}, each summarized in a sentence with its argument.','weekly']],
  newssite:[['Morning brief from {n}','Every morning, the top stories on {n} ({s}), each in two sentences with a link.','daily'],
            ['{n} on a topic you follow','Each day, only the stories on {n} about [topic], with links.','daily'],
            ['The week on {n}','Every Sunday, the stories {n} covered most this week, in one page.','weekly']],
  tv:[['Tonight on {n}','Every evening, what is worth watching on {n} tonight.','daily'],
      ['New series on {n}','Each week, new series and seasons starting on {n}, with dates.','weekly'],
      ['{n} schedule changes','Each week, schedule changes on {n} for [programme].','weekly']],
  radio:[['New from {n}','Each week, new programmes and schedule changes on {n} ({s}).','weekly'],
         ['{n} podcasts','Each week, new podcast episodes from {n} on [topic], with links.','weekly']],
  telecom:[['Is {n} still my best deal?','Each month, compare what I pay {n} for [my plan] with their current plans and two rivals, and tell me if I could save.','monthly'],
           ['{n} outage watch','Each day, check for reported {n} outages in [area] and tell me only if there is one.','daily'],
           ['New {n} offers','Each week, new plans and offers {n} publishes on {s}, with prices.','weekly'],
           ['{n} price changes','Each month, any price rise or change to {n}’s terms announced on {s}, and when it starts.','monthly']],
  isp:[['{n} outage watch','Each day, check for reported {n} outages in [area] and tell me only if there is one.','daily'],
       ['Is {n} still my best deal?','Each month, compare what I pay {n} for [my plan] with current offers there.','monthly'],
       ['{n} price changes','Each month, any price or terms change {n} announces on {s}.','monthly']],
  airline:[['{n} fare watch','Each day, check {n} fares from [A] to [B] for [dates] and tell me when the price drops.','daily'],
           ['{n} sales and offers','Each week, new sales and offers {n} announces on {s}, with routes and dates.','weekly'],
           ['{n} strikes and disruption','Each day, any strike, cancellation wave or disruption announced for {n}, and tell me only if there is one.','daily'],
           ['{n} baggage and fee changes','Each month, any change to {n}’s baggage rules or fees published on {s}.','monthly']],
  airport:[['Delays at {n}','On my travel days, check {n} for delays and cancellations affecting [flight].','daily'],
           ['{n} news for travellers','Each week, closures, works, strikes or rule changes at {n} that affect passengers.','weekly']],
  rail:[['Disruptions on {n}','Each morning, check {n} for disruption on [my route] and tell me only if there is any.','daily'],
        ['{n} fare and ticket changes','Each month, new fares, passes or ticket rules {n} publishes on {s}.','monthly'],
        ['{n} planned works','Each week, planned engineering works on {n} affecting [my route] in the next month.','weekly'],
        ['{n} cheap tickets','Each week, the cheapest {n} fares from [A] to [B] in the next month.','weekly']],
  bus:[['Disruptions on {n}','Each morning, check {n} for disruption on [my route].','daily'],
       ['{n} timetable changes','Each month, timetable changes {n} announces for [my route].','monthly']],
  retail:[['Price drops at {n}','Each day, check {n} for a price drop on [product] and tell me when it falls below [price].','daily'],
          ['{n} weekly offers','Each week, the best offers at {n} ({s}) on [categories], with prices.','weekly'],
          ['{n} sales calendar','Each month, the sales and discount events {n} announces, with dates.','monthly'],
          ['Back in stock at {n}','Each day, check whether [product] is back in stock at {n}.','daily']],
  supermarket:[['{n} weekly offers','Each week, the offers at {n} on what I usually buy: [list].','weekly'],
               ['My basket at {n}','Each week, what [my shopping list] costs at {n} today, and what changed since last week.','weekly'],
               ['{n} recalls','Each week, product recalls announced by {n}, and tell me only if there is one.','weekly']],
  ecommerce:[['Price drops on {n}','Each day, check {n} ({s}) for a price drop on [product], with the old and new price.','daily'],
             ['{n} deals on what you want','Each week, the best deals on {n} in [category], with prices.','weekly'],
             ['Back in stock on {n}','Each day, check whether [product] is back in stock on {n}.','daily']],
  restaurant:[['New offers at {n}','Each week, any new deals at {n} ({s}) on [what I want], with prices.','weekly'],
              ['New on the {n} menu','Each month, new items and price changes on {n}’s menu.','monthly']],
  hotel:[['{n} price watch','Each day, check {n} prices in [city] for [dates] and tell me when they fall.','daily'],
         ['{n} sales','Each week, sales and member offers {n} announces on {s}.','weekly']],
  mall:[['New at {n}','Each month, new shops, events and changed opening hours at {n} ({s}).','monthly'],
        ['Sales at {n}','Each week, sales and events at {n} this week.','weekly']],
  agency:[['New from {n}','Each week, any announcement, form or deadline from {n} that affects [my situation].','weekly'],
          ['{n} deadlines','Each month, the deadlines {n} publishes on {s} for the coming months, each with its official page.','monthly'],
          ['{n} rule changes','Each month, rules or fees {n} changed on {s}, and what each change means.','monthly']],
  ministry:[['New from {n}','Each week, announcements from {n} that affect [my situation].','weekly'],
            ['{n} consultations and deadlines','Each month, public consultations and deadlines {n} opens, with dates.','monthly']],
  embassy:[['New from {n}','Each week, any change to visa rules, fees or appointment availability at {n} ({s}).','weekly'],
           ['Appointments at {n}','Each day, check {s} for new appointment slots at {n}, and tell me only when there are some.','daily']],
  union:[['New from {n}','Each month, news from {n} that affects [my job or sector].','monthly'],
         ['{n} strike and action calendar','Each week, strikes or actions {n} has called, with dates.','weekly']],
  hospital:[['New from {n}','Each month, any change to services, visiting rules or how to book at {n} ({s}).','monthly'],
            ['{n} notices','Each week, closures, strikes or notices from {n} for patients.','weekly']],
  pharma:[['New from {n}','Each month, announcements and recalls from {n} that concern [product or topic].','monthly'],
          ['{n} recalls','Each week, product recalls announced by {n}, and tell me only if there is one.','weekly']],
  utility:[['Is {n} still my best price?','Each month, compare my {n} tariff with current offers and tell me if switching saves money.','monthly'],
           ['{n} price changes','Each month, any tariff or price change {n} announces on {s}, and when it starts.','monthly'],
           ['{n} outage watch','Each day, planned or reported {n} outages in [area], and tell me only if there is one.','daily']],
  carmaker:[['{n} recall watch','Each month, check for new recalls affecting my {n} [model, year].','monthly'],
            ['New from {n}','Each month, new models, prices and offers {n} announces.','monthly']],
  museum:[['New at {n}','Each month, new exhibitions and events at {n}, with dates and how to book ({s}).','monthly'],
          ['Free days at {n}','Each month, free entry days and discounts at {n}.','monthly']],
  library:[['New at {n}','Each month, new events, changed opening hours and new e-book services at {n} ({s}).','monthly']],
  research:[['New from {n}','Each month, new publications and announcements from {n} on [topic], with links.','monthly'],
            ['Jobs and grants at {n}','Each month, positions and grants {n} opens, with closing dates.','monthly']],
  publisher:[['New from {n}','Each month, new releases from {n} in [genre or subject], with dates.','monthly']],
  school:[['{n} deadline watch','Watch {s} for enrolment dates, term dates and closures at {n}, and remind me a week before each.','weekly'],
          ['News from {n}','Each week, announcements from {n} for parents and students.','weekly']],
  sportsclub:[['{n} match week','Each week, {n}’s next fixtures, results and team news.','weekly'],
              ['{n} tickets','Each week, when tickets go on sale for {n}’s next matches, and the prices.','weekly'],
              ['{n} result','After each {n} match, the result and the key moments in a paragraph.','daily']],
  stadium:[['New at {n}','Each month, newly announced events at {n}, with dates and when tickets go on sale.','monthly']],
  theatre:[['New at {n}','Each month, new shows announced at {n}, with dates and when booking opens ({s}).','monthly'],
           ['Last-minute tickets at {n}','Each week, shows at {n} this week with seats still available.','weekly']],
  festival:[['New from {n}','Each week, line-up announcements and ticket release dates from {n} ({s}).','weekly']],
  park:[['{n} conditions','Before my visit on [dates], check {n} for closures, weather warnings and trail conditions ({s}).','weekly']],
  zoo:[['New at {n}','Each month, new events, arrivals and ticket offers at {n} ({s}).','monthly']],
  brewery:[['New from {n}','Each month, new releases, tours and events from {n} ({s}).','monthly']],
  employer:[['New jobs at {n}','Each day, new [role] openings at {n} in [location], with links.','daily'],
            ['{n} in the news','Each week, news about {n} - results, layoffs, hiring - in a few lines.','weekly']],
  company:[['New jobs at {n}','Each day, new [role] openings at {n} in [location], with links.','daily'],
           ['{n} in the news','Each week, news about {n}, in a few lines with links.','weekly']],
  software:[['New from {n}','Each week, product updates, price changes and security notices from {n} ({s}).','weekly'],
            ['{n} outages','Each day, any {n} outage or incident, and tell me only if there is one.','daily'],
            ['Jobs at {n}','Each week, new [role] openings at {n}, with links.','weekly']],
  nonprofit:[['New from {n}','Each month, news, appeals and volunteer openings from {n} ({s}).','monthly'],
             ['Volunteer with {n}','Each month, volunteer openings at {n} in [area], with how to apply.','monthly']],
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
      if(!(d && d.kinds && typeof d.kinds === 'object')) return null;
      /* The entries come from a public database anybody can edit, so each is
         checked again here: a real ID, a plain one-line name, and a site that
         is a bare host name. One that is not is dropped, never repaired - its
         name goes into instructions and its address is where somebody signs in. */
      const good = e => e && /^Q\d{1,12}$/.test(e.q) && typeof e.n === 'string' && e.n.length >= 2 && e.n.length <= 90
        && !/[\u0000-\u001f\u007f<>{}\[\]`]|https?:|www\./i.test(e.n)
        && typeof e.s === 'string' && e.s.length <= 80 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(e.s);
      const kinds = {};
      for(const [k, list] of Object.entries(d.kinds)) if(CC_KINDS[k] && Array.isArray(list)){ const ok = list.filter(good); if(ok.length) kinds[k] = ok; }
      d.kinds = kinds;
      return d;
    }catch(e){ return null; }
  })();
  const d = await _ccCache[cc];
  if(!d) delete _ccCache[cc];   // a failed fetch is tried again next time
  return d;
}
/* English only: "a {n}" before a vowel is "an" - "Find an Iberia flight". The
   translated titles are left alone ("a {n}" is "the" in Portuguese). */
const _ccAn = (t, e) => /^[aeiou]/i.test(e.n) ? String(t).replace(/\b([Aa]) \{n\}/g, '$1n {n}') : String(t);
const _ccFill = (t, e, en) => (en ? _ccAn(t, e) : String(t)).replace(/\{n\}/g, e.n).replace(/\{s\}/g, e.s);
const _ccTitle = (t, e) => { const tr = T(t); return _ccFill(tr, e, tr === t); };
/* Every task, job and service for a country, each tied to the entry it names. */
function ccTasks(d){
  const by = [];
  for(const [kind, list] of Object.entries((d && d.kinds) || {})){
    const tpl = CC_TASKS[kind]; if(!tpl) continue;
    by.push(list.map(e => tpl.map((t, i) => ({ id:'cc-' + kind + '-' + e.q + '-' + i, kind, e,
      tpl:t[0], title:_ccTitle(t[0], e), prompt:_ccFill(t[1], e, true) }))));
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
      title:_ccTitle(t[0], e), prompt:_ccFill(t[1], e, true), every:t[2] }))));
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
  /* A job whose instruction has blanks - [my route], [product] - asks for them
     when it is switched on. The unattended runner is given the job's text and
     nothing else, so a blank left unfilled would run every day against the
     words "[my route]". Crew's own switch does the asking (`asks`), refuses an
     empty answer, and adds what was said to what the runner reads. */
  const asks = (p) => { const b = [...new Set((p.match(/\[[^\]]*\]/g) || []).map(x => x.slice(1, -1)))];
    return b.length ? { q: 'This job needs: ' + b.join(', ') + '.', ph: 'Type each one, in a sentence or a list.' } : null; };
  _ccCrewJobs[cc] = ccJobs(d).map(j => ({
    asks: asks(j.prompt),
    id: j.id, icon: (CC_KINDS[j.kind] || ['\u2022'])[0], title: j.title,
    desc: j.prompt.replace(/\[([^\]]*)\]/g, '$1'), prompt: j.prompt, every: j.every,
    needs: 'Web research', cat: (CC_KINDS[j.kind] || ['', ''])[1], kind: 'research', ccKind: j.kind, site: j.e.s, src: j.e.q,
  }));
  return _ccCrewJobs[cc];
}
/* INTEGRATIONS: every service in the country, under its own topic (Nov 15).

   The owner: "remove 'popular in <country>'"; "if it says it on Crew or Tasks,
   add it - how is Crew going to do it if it is not connected?". So the
   services the country's jobs and tasks name are not a separate block with
   the country's name on it: each is a row under the topic it belongs to -
   banks under Bank & money, airlines under Travel - with the one honest
   action there is for a site AMV holds no key to: Use, which opens it in
   AMV's browser where the person signs in themselves. Topics the app list
   does not have (government, going out) are added at the end. */
const CC_KIND_TOPIC = {
  bank:'money', insurer:'money', airline:'travel', airport:'travel', rail:'travel', bus:'travel', hotel:'travel',
  retail:'shop', supermarket:'shop', ecommerce:'shop', mall:'shop', restaurant:'food',
  newspaper:'news', newssite:'news', tv:'news', radio:'news', publisher:'news',
  university:'school', college:'school', school:'school', library:'school', research:'school',
  hospital:'health', pharma:'health', telecom:'home', isp:'home', utility:'home', carmaker:'home',
  employer:'jobs', company:'jobs', software:'work', nonprofit:'home',
  agency:'gov', ministry:'gov', embassy:'gov', union:'gov',
  museum:'out', theatre:'out', stadium:'out', sportsclub:'out', park:'out', zoo:'out', festival:'out', brewery:'out',
};
const CC_EXTRA_TOPICS = { gov:'Government & paperwork', out:'Going out' };
const _ccSvc = {};
async function ccFillIntegrations(){
  const root = document.getElementById('int-catalog'); if(!root) return;
  const cc = (typeof _cwCountryGuess === 'function') ? _cwCountryGuess() : '';
  const d = await ccLoad(cc);
  if(!root.isConnected || !d) return;
  const list = ccServices(d);
  if(!list.length) return;
  list.forEach(x => { _ccSvc[x.e.q] = x; });
  const by = {};
  list.forEach(x => { const t = CC_KIND_TOPIC[x.kind] || 'home'; (by[t] = by[t] || []).push(x); });
  const svcRow = (x) => `<div class="int-card cc-svc" data-cc="${x.kind}">
      <div class="int-ic" aria-hidden="true">${(CC_KINDS[x.kind] || ['\u2022'])[0]}</div>
      <div class="int-body"><div class="int-top"><span class="int-name" data-no-i18n>${escH(x.e.n)}</span></div><div class="int-desc" data-no-i18n>${escH(x.e.s)}</div></div>
      <div class="int-act"><button class="btn bs cc-use" type="button" data-dact="ccUseService" data-darg="${escH(x.e.q)}">${escH(T('Use'))}</button></div></div>`;
  for(const [topic, rows] of Object.entries(by)){
    let sec = root.querySelector('[data-topic="' + topic + '"]');
    if(!sec){
      if(!CC_EXTRA_TOPICS[topic]) continue;
      sec = document.createElement('div'); sec.className = 'ss2'; sec.dataset.topic = topic;
      sec.innerHTML = '<h3>' + escH(T(CC_EXTRA_TOPICS[topic])) + '</h3><div class="int-cc" hidden></div>';
      root.appendChild(sec);
    }
    const box = sec.querySelector('.int-cc'); if(!box) continue;
    const first = 6;
    box.innerHTML = `<div class="int-list">${rows.slice(0, first).map(svcRow).join('')}</div>`
      + (rows.length > first ? `<div class="int-more"><button class="int-seemore cc-int-more" type="button">${escH(T('See all {0}').replace('{0}', rows.length.toLocaleString()))}</button></div>` : '');
    box.hidden = false;
    const more = box.querySelector('.cc-int-more');
    if(more) on(more, 'click', function(){ box.querySelector('.int-list').insertAdjacentHTML('beforeend', rows.slice(first).map(svcRow).join('')); this.parentNode.remove(); });
  }
}
function ccUseService(q){
  const x = _ccSvc[q]; if(!x) return;
  const text = 'Using AMV\u2019s browser, open ' + x.e.s + ' (' + x.e.n + '). I will sign in myself if it asks. Then help me [what you want to do there].';
  setTab('chat');
  setTimeout(() => { const ta = document.getElementById('mta'); if(!ta) return;
    ta.value = text; fitChatComposer(ta); ta.focus(); const a = text.indexOf('['); if(a >= 0) ta.setSelectionRange(a, text.indexOf(']') + 1); }, 150);
}
try{ window.ccFillIntegrations = ccFillIntegrations; window.ccUseService = ccUseService; window.ccCrewLoad = ccCrewLoad; }catch(e){}

/* ══════════════════════════════════════════════════════════════════════════
   WHERE YOU ARE (Nov 15). The owner: "at the top of Tasks you can click 'not
   in this country' so you can select your country if it is wrong - and make
   sure AMV can access location".

   One picker for Crew, Tasks and Integrations: a search over every country
   AMV has a list for, and Use my location. The position is asked of the
   browser only when somebody presses that button, and it is turned into a
   country HERE, against country outlines fetched for the purpose
   (geo-countries.json, Natural Earth) - the coordinates are never sent to AMV
   or to anybody else, and are not kept.
   ══════════════════════════════════════════════════════════════════════════ */
let _ccGeo = null;
async function _ccGeoLoad(){
  if(_ccGeo) return _ccGeo;
  const r = await fetch('geo-countries.json', { cache: 'force-cache' });
  if(!r.ok) throw new Error('outlines ' + r.status);
  const d = await r.json();
  const step = +d.step || 0.05, out = [];
  for(const [cc, rings] of Object.entries(d.c || {})){
    if(!/^[A-Z]{2}$/.test(cc)) continue;
    for(const enc of rings){
      if(!Array.isArray(enc) || enc.length < 8) continue;
      const pts = []; let x = enc[0], y = enc[1]; pts.push([x * step, y * step]);
      for(let i = 2; i + 1 < enc.length; i += 2){ x += enc[i]; y += enc[i + 1]; pts.push([x * step, y * step]); }
      let a = 0, minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
      for(let i = 0; i < pts.length; i++){ const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1];
        if(p[0] < minx) minx = p[0]; if(p[0] > maxx) maxx = p[0]; if(p[1] < miny) miny = p[1]; if(p[1] > maxy) maxy = p[1]; }
      out.push({ cc, pts, area: Math.abs(a / 2), box: [minx, miny, maxx, maxy] });
    }
  }
  _ccGeo = out;
  return out;
}
function _ccInRing(pts, x, y){
  let inside = false;
  for(let i = 0, j = pts.length - 1; i < pts.length; j = i++){
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if(((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
  }
  return inside;
}
/* The country a point is in: the smallest outline that holds it (so a
   country inside another wins), or the nearest within about 30 km when the
   point is just off a coast the outlines round away. */
async function ccCountryAt(lat, lon){
  const rings = await _ccGeoLoad();
  let best = null;
  for(const r of rings){
    const b = r.box; if(lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if(_ccInRing(r.pts, lon, lat) && (!best || r.area < best.area)) best = r;
  }
  if(best) return best.cc;
  let near = null, nd = 0.3 * 0.3;
  for(const r of rings){
    const b = r.box; if(lon < b[0] - 0.3 || lon > b[2] + 0.3 || lat < b[1] - 0.3 || lat > b[3] + 0.3) continue;
    for(const p of r.pts){ const d = (p[0] - lon) * (p[0] - lon) + (p[1] - lat) * (p[1] - lat); if(d < nd){ nd = d; near = r.cc; } }
  }
  return near;
}
/* Ask the browser where this device is - only now, because somebody pressed
   the button - and answer with a country code, or a sentence saying why not. */
function ccLocate(){
  return new Promise((resolve) => {
    if(!(navigator && navigator.geolocation)) return resolve({ error: T('This browser cannot share a location. Choose your country from the list.') });
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try{
        const cc = await ccCountryAt(pos.coords.latitude, pos.coords.longitude);
        resolve(cc ? { cc } : { error: T('AMV could not tell which country that position is in. Choose it from the list.') });
      }catch(e){ resolve({ error: T('AMV could not read the country outlines right now. Choose your country from the list.') }); }
    }, (err) => {
      resolve({ error: err && err.code === 1
        ? T('Location is turned off for AMV in this browser. Allow it in the browser’s site settings, or choose your country from the list.')
        : T('The location could not be found right now. Choose your country from the list.') });
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 3600000 });
  });
}
/* The picker. `done(cc)` runs after the choice is saved. */
function ccPickCountry(done){
  const r = document.getElementById('ovr'); if(!r) return;
  const list = (typeof CW_WORLD_COUNTRIES !== 'undefined' ? CW_WORLD_COUNTRIES : []).slice()
    .sort((a, b) => T(a[1]).localeCompare(T(b[1])));
  const cur = (typeof _cwCountryGuess === 'function') ? _cwCountryGuess() : '';
  const item = (c) => `<button class="ccp-row${c[0] === cur ? ' on' : ''}" data-ccp="${c[0]}" data-n="${escH((T(c[1]) + ' ' + c[1]).toLowerCase())}"${c[0] === cur ? ' aria-current="true"' : ''}><span class="ccp-flag" aria-hidden="true">${c[2]}</span><span>${escH(T(c[1]))}</span>${c[0] === cur ? `<span class="ccp-cur">${escH(T('Selected'))}</span>` : ''}</button>`;
  r.innerHTML = `<div class="ov" id="ccp-bg"><div class="ccp" role="dialog" aria-modal="true" aria-labelledby="ccp-h">
    <header class="ccp-h"><h2 id="ccp-h">${escH(T('Choose your country'))}</h2><button class="cwp-x" id="ccp-x" aria-label="${escH(T('Close'))}">✕</button></header>
    <div class="ccp-tools">
      <button class="btn bs ccp-loc" id="ccp-loc"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>${escH(T('Use my location'))}</button>
      <div class="cx-find"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="ccp-q" type="search" autocomplete="off" placeholder="${escH(T('Search countries'))}" aria-label="${escH(T('Search countries'))}"></div>
      <p class="ccp-msg" id="ccp-msg" role="status" aria-live="polite"></p>
    </div>
    <div class="ccp-list" id="ccp-list">${list.map(item).join('')}</div>
  </div></div>`;
  r.classList.add('on');
  const close = () => { try{ closeOvr(); }catch(e){} };
  onBackdrop(document.getElementById('ccp-bg'), close);
  on(document.getElementById('ccp-x'), 'click', close);
  const choose = (cc) => { try{ _cwSetCountry(cc); }catch(e){} close(); try{ if(done) done(cc); }catch(e){} };
  on(document.getElementById('ccp-list'), 'click', (e) => { const b = e.target.closest && e.target.closest('[data-ccp]'); if(b) choose(b.dataset.ccp); });
  const q = document.getElementById('ccp-q');
  on(q, 'input', function(){ const v = this.value.trim().toLowerCase();
    document.querySelectorAll('#ccp-list [data-ccp]').forEach(b => { b.hidden = !!v && b.dataset.n.indexOf(v) < 0; }); });
  on(q, 'keydown', function(e){ if(e.key === 'Enter'){ const f = document.querySelector('#ccp-list [data-ccp]:not([hidden])'); if(f){ e.preventDefault(); choose(f.dataset.ccp); } } });
  on(document.getElementById('ccp-loc'), 'click', async function(){
    const msg = document.getElementById('ccp-msg');
    this.disabled = true; if(msg) msg.textContent = T('Finding where you are…');
    const res = await ccLocate();
    this.disabled = false;
    if(res.cc){
      const known = list.find(c => c[0] === res.cc);
      if(known){ choose(res.cc); return; }
      if(msg) msg.textContent = T('AMV does not have a list for where you are yet. Choose the closest country.');
      return;
    }
    if(msg) msg.textContent = res.error || '';
  });
  try{ q.focus(); }catch(e){}
}
try{ window.ccPickCountry = ccPickCountry; window.ccLocate = ccLocate; window.ccCountryAt = ccCountryAt; }catch(e){}
