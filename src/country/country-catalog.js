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
   switched on.

   Nov 16 (owner: "a directory of 1,000,000+ jobs across all countries"): each
   kind grew to the things worth watching about it - a company's results,
   recalls, outages, breaches, leadership; a university's courses, fees,
   rankings, lectures - so the directory holds 1,009,008 distinct jobs, every
   one tied to a real entry. A fourth field 'c' marks a job about the entry IN
   the country it is listed for ("Jobs at {n} in {c}"): that job differs per
   country and is counted per country; every other job is counted once, however
   many countries list the entry. The count is measured, not claimed - see
   the suite every-job-in-the-world-is-one-search-away. */
const CC_CREW = {
  bank:[['Watch {n} for fee and rate changes','Check {s} for any change to {n}’s fees, interest rates or terms since last time, and report only what changed.','weekly'],
        ['{n} savings and deposit rates','Each week, the savings and deposit rates {n} publishes on {s}, and whether any moved since last week.','weekly'],
        ['{n} service and outage notices','Each day, check {s} and {n}’s official channels for app or card outages and planned maintenance, and tell me only if there is one.','daily'],
        ['New offers at {n}','Each month, any new account, card or mortgage offer {n} announces on {s}, with its conditions.','monthly'],
        ['{n} security and scam warnings','Each week, any scam, phishing or fraud warning {n} publishes on {s} or its official channels, and tell me only if there is one.','weekly'],
        ['{n} mortgage rates','Each week, the mortgage rates {n} publishes on {s}, and whether any changed since last week.','weekly'],
        ['{n} app updates','Each month, new features and changes in {n}’s app and online banking, from {s} and its release notes.','monthly'],
        ['{n} results and news','Each month, {n}’s financial results, ratings and news, in a few lines with links.','monthly'],
        ['{n} branches and ATMs in {c}','Each month, branch and ATM openings, closures and changed hours {n} announces in {c}.','monthly','c'],
        ['{n} news in {c}','Each week, news about {n} in {c} - fees, outages, regulators - in a few lines with links.','weekly','c'],
        ['Is {n} still my best bank?','Each month, compare {n}’s current account fees with other banks in its market, and tell me if I could save.','monthly']],
  insurer:[['{n} renewal check','A month before my {n} renewal on [date], compare my premium with current quotes and tell me if switching saves money.','monthly'],
           ['Policy changes at {n}','Each month, any change {n} announces to its policies, prices or claims process on {s}.','monthly'],
           ['New cover from {n}','Each month, new products or discounts {n} offers on {s}, with who they are for.','monthly'],
           ['{n} claims and service notices','Each week, any change to how {n} handles claims, and service notices on {s}.','weekly'],
           ['{n} ratings and reviews','Each month, what independent ratings and recent customer reviews say about {n}, in a few lines.','monthly'],
           ['{n} in the news','Each month, news about {n}, in a few lines with links.','monthly'],
           ['{n} offers in {c}','Each month, discounts and offers {n} runs in {c}, with their conditions.','monthly','c']],
  university:[['{n} deadline watch','Watch {s} for application, scholarship and enrolment deadlines at {n}, and remind me two weeks before each.','weekly'],
              ['Scholarships at {n}','Each week, new scholarships and grants {n} lists on {s}, with eligibility and the closing date.','weekly'],
              ['Open days at {n}','Each month, open days, info sessions and campus events at {n}, with dates and how to sign up.','monthly'],
              ['{n} news for students','Each week, announcements from {n} that affect students - term dates, fees, closures - with links.','weekly'],
              ['Courses opening at {n}','Each month, new degrees and courses {n} opens for applications on {s}, with start dates.','monthly'],
              ['{n} public lectures and events','Each week, public lectures, talks and events at {n} open to everyone, with dates and links.','weekly'],
              ['{n} research news','Each week, the main research {n} announced, each in two sentences with a link.','weekly'],
              ['Jobs at {n}','Each week, new academic and staff openings at {n}, with closing dates.','weekly'],
              ['{n} fees and funding changes','Each month, any change to tuition fees, funding or financial aid at {n} published on {s}.','monthly'],
              ['{n} in the rankings','Each month, where {n} stands in the main university rankings, and any change.','monthly'],
              ['Study abroad from {n}','Each month, exchange and study-abroad calls at {n}, with deadlines.','monthly'],
              ['Student housing at {n}','Each month, student housing news and application dates at {n}.','monthly'],
              ['Free online courses from {n}','Each month, free online courses and open lectures from {n}, with links.','monthly'],
              ['Summer schools at {n}','Each month, summer schools and short programmes at {n}, with deadlines.','monthly'],
              ['Admission requirements at {n}','Each month, any change to admission requirements at {n}, from {s}.','monthly'],
              ['International students at {n}','Each month, news for international students at {n} - visas, fees, deadlines.','monthly'],
              ['Sport and clubs at {n}','Each month, news from sports teams and student clubs at {n}.','monthly'],
              ['{n} alumni news','Each month, news and events for {n}’s alumni.','monthly'],
              ['Graduation at {n}','Each month, graduation dates and ceremonies at {n}.','monthly']],
  college:[['{n} deadline watch','Watch {s} for deadlines at {n}, and remind me two weeks before each.','weekly'],
           ['Courses starting at {n}','Each month, courses at {n} opening for enrolment, with start dates and fees from {s}.','monthly'],
           ['Open days at {n}','Each month, open days and info sessions at {n}, with dates and how to sign up.','monthly'],
           ['{n} news for students','Each week, announcements from {n} that affect students - term dates, fees, closures - with links.','weekly'],
           ['Jobs at {n}','Each week, new teaching and staff openings at {n}, with closing dates.','weekly'],
           ['{n} fees and funding','Each month, any change to fees, grants or financial help at {n} published on {s}.','monthly'],
           ['Short courses at {n}','Each month, short and evening courses at {n} open for enrolment, with fees.','monthly'],
           ['Events at {n}','Each month, events at {n} open to the public, with dates.','monthly'],
           ['Apprenticeships through {n}','Each month, apprenticeships and work placements offered through {n}, with how to apply.','monthly'],
           ['Admission requirements at {n}','Each month, any change to admission requirements at {n}, from {s}.','monthly'],
           ['International students at {n}','Each month, news for international students at {n} - visas, fees, deadlines.','monthly'],
           ['Careers events at {n}','Each month, careers fairs and employer events at {n}.','monthly']],
  newspaper:[['Morning brief from {n}','Every morning, the five most important stories in {n} ({s}), each in two sentences with a link.','daily'],
             ['{n} on a topic you follow','Each day, only the stories in {n} about [topic], each in two sentences with a link.','daily'],
             ['The week in {n}','Every Sunday, the ten stories {n} covered most this week, in one page.','weekly'],
             ['{n} opinion digest','Each week, the main opinion pieces in {n}, each summarized in a sentence with its argument.','weekly'],
             ['Evening brief from {n}','Every evening, the stories {n} ({s}) published today that matter most, each in two sentences.','daily'],
             ['Breaking news from {n}','Each day, only the breaking stories on {n}, and tell me only when there is one.','daily'],
             ['{n} business and economy','Each day, the business and economy stories in {n}, each in two sentences with a link.','daily'],
             ['{n} politics','Each day, the politics stories in {n}, each in two sentences with a link.','daily'],
             ['{n} science and technology','Each week, the science and technology stories in {n}, each in two sentences with a link.','weekly'],
             ['{n} culture and books','Each week, the culture, books and film reviews in {n}, each in a sentence.','weekly'],
             ['{n} sport','Each day, the sport stories in {n}, results first.','daily'],
             ['{n} investigations','Each week, the investigative and long-form pieces in {n}, each summarized in a paragraph.','weekly'],
             ['{n} health','Each week, the health stories in {n}, each in two sentences with a link.','weekly'],
             ['{n} corrections','Each week, the corrections and clarifications {n} published, with what changed.','weekly'],
             ['{n} on {c}','Each day, the stories in {n} about {c}, each in two sentences with a link.','daily','c'],
             ['Weekend reading from {n}','Every Saturday, the five best long reads in {n} this week, each in a paragraph.','weekly'],
             ['{n} world news','Each day, the world news in {n}, each story in two sentences with a link.','daily'],
             ['{n} climate and environment','Each week, the climate and environment stories in {n}, each in two sentences with a link.','weekly'],
             ['{n} travel','Each week, the travel pieces in {n}, each in a sentence.','weekly'],
             ['{n} food','Each week, the food and recipe pieces in {n}, each in a sentence.','weekly'],
             ['{n} property','Each week, the housing and property stories in {n}, each in two sentences.','weekly'],
             ['{n} on {c}’s economy','Each week, what {n} reported about {c}’s economy, each story in two sentences with a link.','weekly','c'],
             ['{n} on {c}’s politics','Each week, what {n} reported about {c}’s politics, each story in two sentences with a link.','weekly','c']],
  newssite:[['Morning brief from {n}','Every morning, the top stories on {n} ({s}), each in two sentences with a link.','daily'],
            ['{n} on a topic you follow','Each day, only the stories on {n} about [topic], with links.','daily'],
            ['The week on {n}','Every Sunday, the stories {n} covered most this week, in one page.','weekly'],
            ['Evening brief from {n}','Every evening, the stories {n} ({s}) published today that matter most, each in two sentences.','daily'],
            ['Breaking news from {n}','Each day, only the breaking stories on {n}, and tell me only when there is one.','daily'],
            ['{n} business and economy','Each day, the business and economy stories on {n}, each in two sentences with a link.','daily'],
            ['{n} science and technology','Each week, the science and technology stories on {n}, each in two sentences with a link.','weekly'],
            ['{n} sport','Each day, the sport stories on {n}, results first.','daily'],
            ['{n} on {c}','Each day, the stories on {n} about {c}, each in two sentences with a link.','daily','c']],
  tv:[['Tonight on {n}','Every evening, what is worth watching on {n} tonight.','daily'],
      ['New series on {n}','Each week, new series and seasons starting on {n}, with dates.','weekly'],
      ['{n} schedule changes','Each week, schedule changes on {n} for [programme].','weekly'],
      ['Films on {n} this week','Each week, the films on {n} this week, each with a line on what it is.','weekly'],
      ['Documentaries on {n}','Each week, the documentaries on {n}, with dates and times.','weekly'],
      ['Live sport on {n}','Each week, the live sport on {n}, with dates and times.','weekly'],
      ['{n} news','Each day, the main stories from {n}’s news, in a few lines.','daily'],
      ['New on {n} streaming','Each week, what is new on {n}’s streaming or catch-up service, with links.','weekly'],
      ['{n} for children','Each week, children’s programmes on {n}, with dates and times.','weekly'],
      ['{n} highlights in {c}','Each week, the highlights on {n} in {c}, with dates and times.','weekly','c']],
  radio:[['New from {n}','Each week, new programmes and schedule changes on {n} ({s}).','weekly'],
         ['{n} podcasts','Each week, new podcast episodes from {n} on [topic], with links.','weekly'],
         ['{n} news','Each day, the main stories from {n}’s news bulletins, in a few lines.','daily'],
         ['Interviews on {n}','Each week, the notable interviews on {n}, each in a sentence with a link to listen.','weekly'],
         ['Music on {n}','Each week, the new music {n} played most.','weekly'],
         ['{n} live events','Each month, concerts, live shows and events {n} hosts, with dates.','monthly']],
  telecom:[['Is {n} still my best deal?','Each month, compare what I pay {n} for [my plan] with their current plans and two rivals, and tell me if I could save.','monthly'],
           ['{n} outage watch','Each day, check for reported {n} outages in [area] and tell me only if there is one.','daily'],
           ['New {n} offers','Each week, new plans and offers {n} publishes on {s}, with prices.','weekly'],
           ['{n} price changes','Each month, any price rise or change to {n}’s terms announced on {s}, and when it starts.','monthly'],
           ['{n} coverage news','Each month, coverage upgrades and 5G rollouts {n} announces, with the places.','monthly'],
           ['{n} roaming changes','Each month, any change to {n}’s roaming prices and rules published on {s}.','monthly'],
           ['Phones and deals at {n}','Each week, new phones and phone deals at {n}, with prices.','weekly'],
           ['{n} in the news','Each month, news about {n}, in a few lines with links.','monthly'],
           ['{n} offers in {c}','Each week, the plans and offers {n} runs in {c}, with prices.','weekly','c']],
  isp:[['{n} outage watch','Each day, check for reported {n} outages in [area] and tell me only if there is one.','daily'],
       ['Is {n} still my best deal?','Each month, compare what I pay {n} for [my plan] with current offers there.','monthly'],
       ['{n} price changes','Each month, any price or terms change {n} announces on {s}.','monthly'],
       ['New {n} offers','Each week, new plans and offers {n} publishes on {s}, with prices.','weekly'],
       ['{n} network upgrades','Each month, fibre and speed upgrades {n} announces, with the places.','monthly'],
       ['{n} customer service news','Each month, changes to {n}’s customer service, contracts or terms.','monthly']],
  airline:[['{n} fare watch','Each day, check {n} fares from [A] to [B] for [dates] and tell me when the price drops.','daily'],
           ['{n} sales and offers','Each week, new sales and offers {n} announces on {s}, with routes and dates.','weekly'],
           ['{n} strikes and disruption','Each day, any strike, cancellation wave or disruption announced for {n}, and tell me only if there is one.','daily'],
           ['{n} baggage and fee changes','Each month, any change to {n}’s baggage rules or fees published on {s}.','monthly'],
           ['New routes from {n}','Each month, new routes and seasonal flights {n} announces, with start dates.','monthly'],
           ['{n} loyalty programme changes','Each month, changes to {n}’s frequent-flyer programme - earning, prices in miles, status.','monthly'],
           ['Is {n} on time?','Each month, how punctual {n} has been, from published statistics, with sources.','monthly'],
           ['{n} travel rules','Each week, any change to {n}’s check-in, document or travel rules on {s}.','weekly'],
           ['{n} in the news','Each week, news about {n}, in a few lines with links.','weekly'],
           ['{n} flights from {c}','Each week, {n}’s sales and new routes from {c}, with prices and dates.','weekly','c'],
           ['{n} disruption in {c}','Each day, strikes or cancellations affecting {n} flights in {c}, and tell me only if there is one.','daily','c']],
  airport:[['Delays at {n}','On my travel days, check {n} for delays and cancellations affecting [flight].','daily'],
           ['{n} news for travellers','Each week, closures, works, strikes or rule changes at {n} that affect passengers.','weekly'],
           ['New routes at {n}','Each month, new routes and airlines starting at {n}, with dates.','monthly'],
           ['Parking and transport at {n}','Each month, changes to parking prices and transport links at {n}.','monthly'],
           ['Security queues at {n}','On my travel days, current security wait times and advice at {n}.','daily'],
           ['Shops and lounges at {n}','Each month, new shops, restaurants and lounges at {n}.','monthly']],
  rail:[['Disruptions on {n}','Each morning, check {n} for disruption on [my route] and tell me only if there is any.','daily'],
        ['{n} fare and ticket changes','Each month, new fares, passes or ticket rules {n} publishes on {s}.','monthly'],
        ['{n} planned works','Each week, planned engineering works on {n} affecting [my route] in the next month.','weekly'],
        ['{n} cheap tickets','Each week, the cheapest {n} fares from [A] to [B] in the next month.','weekly'],
        ['{n} timetable changes','Each month, timetable changes and new connections {n} announces on {s}.','monthly'],
        ['{n} strike watch','Each day, any strike announced on {n}, and tell me only if there is one.','daily'],
        ['{n} sales','Each week, ticket sales and offers {n} announces, with dates.','weekly'],
        ['{n} passes and railcards','Each month, changes to {n}’s passes, discount cards and their prices.','monthly'],
        ['Is {n} on time?','Each month, how punctual {n} has been, from published statistics, with sources.','monthly']],
  bus:[['Disruptions on {n}','Each morning, check {n} for disruption on [my route].','daily'],
       ['{n} timetable changes','Each month, timetable changes {n} announces for [my route].','monthly'],
       ['{n} strike watch','Each day, any strike announced on {n}, and tell me only if there is one.','daily'],
       ['{n} fare changes','Each month, fare and ticket changes {n} announces on {s}.','monthly'],
       ['New routes on {n}','Each month, new routes and stops {n} announces.','monthly'],
       ['{n} service notices','Each week, diversions, closures and service notices from {n}.','weekly']],
  retail:[['Price drops at {n}','Each day, check {n} for a price drop on [product] and tell me when it falls below [price].','daily'],
          ['{n} weekly offers','Each week, the best offers at {n} ({s}) on [categories], with prices.','weekly'],
          ['{n} sales calendar','Each month, the sales and discount events {n} announces, with dates.','monthly'],
          ['Back in stock at {n}','Each day, check whether [product] is back in stock at {n}.','daily'],
          ['New at {n}','Each week, new products at {n} ({s}), the ten most notable with prices.','weekly'],
          ['{n} recalls','Each week, product recalls announced by {n}, and tell me only if there is one.','weekly'],
          ['{n} store openings and hours','Each month, {n} store openings, closures and changed hours.','monthly'],
          ['{n} loyalty programme changes','Each month, changes to {n}’s loyalty programme and member offers.','monthly'],
          ['{n} returns and delivery rules','Each month, any change to {n}’s returns, delivery or warranty rules on {s}.','monthly'],
          ['{n} in the news','Each month, news about {n}, in a few lines with links.','monthly'],
          ['{n} offers in {c}','Each week, the best offers at {n} in {c}, with prices.','weekly','c'],
          ['{n} stores in {c}','Each month, store openings, closures and changed hours of {n} in {c}.','monthly','c'],
          ['{n} sustainability','Each month, {n}’s sustainability announcements, checked against reporting by others.','monthly'],
          ['{n} customer reviews','Each month, what recent customer reviews say about {n}, in a few lines.','monthly'],
          ['{n} recalls in {c}','Each week, recalls of products sold by {n} in {c}, and tell me only if there is one.','weekly','c'],
          ['Jobs at {n} in {c}','Each week, jobs at {n} stores and offices in {c}, with links.','weekly','c']],
  supermarket:[['{n} weekly offers','Each week, the offers at {n} on what I usually buy: [list].','weekly'],
               ['My basket at {n}','Each week, what [my shopping list] costs at {n} today, and what changed since last week.','weekly'],
               ['{n} recalls','Each week, product recalls announced by {n}, and tell me only if there is one.','weekly'],
               ['{n} price changes','Each month, notable price rises and cuts at {n} on everyday products, with examples.','monthly'],
               ['New at {n}','Each month, new products at {n}, with prices.','monthly'],
               ['{n} opening hours','Each week, changed opening hours at {n}, for holidays and closures.','weekly'],
               ['{n} loyalty offers','Each week, the offers in {n}’s loyalty programme, with their conditions.','weekly'],
               ['{n} delivery fees and slots','Each month, any change to {n}’s home delivery fees, minimums and slots.','monthly']],
  ecommerce:[['Price drops on {n}','Each day, check {n} ({s}) for a price drop on [product], with the old and new price.','daily'],
             ['{n} deals on what you want','Each week, the best deals on {n} in [category], with prices.','weekly'],
             ['Back in stock on {n}','Each day, check whether [product] is back in stock on {n}.','daily'],
             ['{n} sales calendar','Each month, the sales events {n} announces, with dates.','monthly'],
             ['{n} delivery and returns changes','Each month, any change to {n}’s delivery or returns rules published on {s}.','monthly'],
             ['{n} membership changes','Each month, changes to {n}’s membership or subscription - price and benefits.','monthly'],
             ['Scams using {n}’s name','Each week, scams that use {n}’s name, reported by {n} or consumer agencies, and tell me only if there is one.','weekly'],
             ['{n} in the news','Each month, news about {n}, in a few lines with links.','monthly'],
             ['{n} deals in {c}','Each day, the best deals on {n} for {c}, with prices.','daily','c'],
             ['{n} delivery in {c}','Each month, delivery times, fees and pickup points for {n} in {c}.','monthly','c']],
  restaurant:[['New offers at {n}','Each week, any new deals at {n} ({s}) on [what I want], with prices.','weekly'],
              ['New on the {n} menu','Each month, new items and price changes on {n}’s menu.','monthly'],
              ['New {n} locations','Each month, new {n} restaurants opening, with addresses.','monthly'],
              ['{n} allergens and nutrition','Each month, changes to the allergen and nutrition information on {n}’s menu.','monthly'],
              ['{n} app offers','Each week, the deals in {n}’s app or loyalty programme.','weekly'],
              ['{n} food safety notices','Each month, food-safety notices or recalls involving {n}, and tell me only if there is one.','monthly'],
              ['{n} in {c}','Each month, new {n} restaurants and offers in {c}.','monthly','c']],
  hotel:[['{n} price watch','Each day, check {n} prices in [city] for [dates] and tell me when they fall.','daily'],
         ['{n} sales','Each week, sales and member offers {n} announces on {s}.','weekly'],
         ['{n} loyalty changes','Each month, changes to {n}’s loyalty programme - points, prices in points, status.','monthly'],
         ['New {n} hotels','Each month, new {n} hotels opening, with places and dates.','monthly'],
         ['{n} cancellation and fee rules','Each month, any change to {n}’s cancellation rules and fees on {s}.','monthly'],
         ['{n} in the news','Each month, news about {n}, in a few lines with links.','monthly'],
         ['{n} offers in {c}','Each week, {n} offers for stays in {c}, with dates and prices.','weekly','c']],
  mall:[['New at {n}','Each month, new shops, events and changed opening hours at {n} ({s}).','monthly'],
        ['Sales at {n}','Each week, sales and events at {n} this week.','weekly'],
        ['{n} opening hours','Each week, changed opening hours at {n}, for holidays and events.','weekly'],
        ['Children’s events at {n}','Each month, events and activities for children at {n}, with dates.','monthly'],
        ['Parking at {n}','Each month, parking prices and changes at {n}.','monthly'],
        ['Shops closing at {n}','Each month, shops closing at {n}, and their last days.','monthly']],
  agency:[['New from {n}','Each week, any announcement, form or deadline from {n} that affects [my situation].','weekly'],
          ['{n} deadlines','Each month, the deadlines {n} publishes on {s} for the coming months, each with its official page.','monthly'],
          ['{n} rule changes','Each month, rules or fees {n} changed on {s}, and what each change means.','monthly'],
          ['{n} news','Each week, the main announcements from {n} ({s}), each in a sentence with a link.','weekly'],
          ['{n} online services status','Each day, any outage of {n}’s online services, and tell me only if there is one.','daily'],
          ['Appointments at {n}','Each day, check {s} for new appointment slots at {n}, and tell me only when there are some.','daily'],
          ['{n} consultations','Each month, public consultations {n} opens, with closing dates.','monthly'],
          ['Jobs at {n}','Each week, job openings at {n}, with closing dates.','weekly'],
          ['{n} statistics and reports','Each month, new statistics and reports {n} published, each in a sentence.','monthly'],
          ['Scams pretending to be {n}','Each week, scams that pretend to be {n}, from {n}’s own warnings, and tell me only if there is one.','weekly'],
          ['Grants from {n}','Each month, grants and funding calls from {n}, with deadlines.','monthly'],
          ['New forms at {n}','Each month, new and changed forms on {s}, each with what it is for.','monthly'],
          ['Open data from {n}','Each month, new open data {n} published, with links.','monthly'],
          ['Tenders from {n}','Each month, public tenders {n} opened, with deadlines.','monthly'],
          ['{n} help for businesses','Each month, guidance and help {n} published for businesses.','monthly']],
  ministry:[['New from {n}','Each week, announcements from {n} that affect [my situation].','weekly'],
            ['{n} consultations and deadlines','Each month, public consultations and deadlines {n} opens, with dates.','monthly'],
            ['{n} news','Each week, the main announcements from {n} ({s}), each in a sentence with a link.','weekly'],
            ['New laws and rules from {n}','Each week, new laws, decrees and rules {n} published, each in plain words.','weekly'],
            ['Jobs at {n}','Each week, job openings at {n}, with closing dates.','weekly'],
            ['Grants and tenders from {n}','Each month, grants and public tenders {n} opens, with deadlines.','monthly'],
            ['{n} statistics','Each month, new statistics {n} published, each in a sentence.','monthly'],
            ['{n} press briefings','Each week, what {n} announced in press briefings and releases, in a few lines.','weekly'],
            ['{n} budget','Each month, budget and spending announcements from {n}, in plain numbers with sources.','monthly'],
            ['{n} public appointments','Each month, public appointments and boards {n} is recruiting for, with deadlines.','monthly'],
            ['{n} speeches','Each week, speeches by {n}’s ministers, each in a few lines.','weekly']],
  embassy:[['New from {n}','Each week, any change to visa rules, fees or appointment availability at {n} ({s}).','weekly'],
           ['Appointments at {n}','Each day, check {s} for new appointment slots at {n}, and tell me only when there are some.','daily'],
           ['Travel advice from {n}','Each week, any change to the travel advice or security warnings {n} publishes on {s}.','weekly'],
           ['Passports and documents at {n}','Each month, changes to passport, ID and document services at {n}, with fees.','monthly'],
           ['Events at {n}','Each month, cultural events and talks {n} hosts, with dates.','monthly'],
           ['{n} closures and holidays','Each month, the days {n} is closed, from {s}.','monthly'],
           ['Voting abroad with {n}','Each month, election and voting-abroad information from {n}, with deadlines.','monthly'],
           ['Scholarships from {n}','Each month, scholarships and exchange programmes announced by {n}, with deadlines.','monthly'],
           ['Jobs at {n}','Each month, job openings at {n}, with closing dates.','monthly'],
           ['{n} news','Each week, announcements from {n} ({s}), in a few lines.','weekly'],
           ['Trade and business with {n}','Each month, trade and business events and help from {n}.','monthly'],
           ['Emergency notices from {n}','Each day, any emergency notice from {n} for its citizens, and tell me only if there is one.','daily']],
  union:[['New from {n}','Each month, news from {n} that affects [my job or sector].','monthly'],
         ['{n} strike and action calendar','Each week, strikes or actions {n} has called, with dates.','weekly'],
         ['{n} pay negotiations','Each week, where {n}’s pay and conditions negotiations stand, in a few lines.','weekly'],
         ['{n} member benefits','Each month, new or changed benefits for {n} members.','monthly'],
         ['Training with {n}','Each month, training and courses {n} offers its members, with dates.','monthly'],
         ['{n} in the news','Each month, news about {n}, in a few lines with links.','monthly']],
  hospital:[['New from {n}','Each month, any change to services, visiting rules or how to book at {n} ({s}).','monthly'],
            ['{n} notices','Each week, closures, strikes or notices from {n} for patients.','weekly'],
            ['Waiting times at {n}','Each month, the published waiting times at {n}, with the source.','monthly'],
            ['Vaccination and screening at {n}','Each month, vaccination and screening programmes at {n}, with how to book.','monthly'],
            ['Jobs at {n}','Each week, job openings at {n}, with closing dates.','weekly'],
            ['Health talks at {n}','Each month, free health talks, classes and support groups at {n}.','monthly'],
            ['Clinical trials at {n}','Each month, clinical trials recruiting at {n}, with who can join.','monthly'],
            ['{n} in the news','Each month, news about {n}, in a few lines with links.','monthly'],
            ['New services at {n}','Each month, new services and specialists at {n}.','monthly'],
            ['Getting to {n}','Each month, changes to parking, transport and entrances at {n}.','monthly']],
  pharma:[['New from {n}','Each month, announcements and recalls from {n} that concern [product or topic].','monthly'],
          ['{n} recalls','Each week, product recalls announced by {n}, and tell me only if there is one.','weekly'],
          ['{n} approvals','Each month, approvals and new medicines from {n}, from regulators’ announcements.','monthly'],
          ['{n} shortages','Each week, shortages of {n} medicines reported by regulators, and tell me only if there is one.','weekly'],
          ['{n} results and news','Each month, {n}’s results and news, in a few lines with links.','monthly'],
          ['{n} clinical trials','Each month, clinical trials {n} started or reported, with links.','monthly']],
  utility:[['Is {n} still my best price?','Each month, compare my {n} tariff with current offers and tell me if switching saves money.','monthly'],
           ['{n} price changes','Each month, any tariff or price change {n} announces on {s}, and when it starts.','monthly'],
           ['{n} outage watch','Each day, planned or reported {n} outages in [area], and tell me only if there is one.','daily'],
           ['{n} planned works','Each week, planned works and interruptions {n} announces on {s}.','weekly'],
           ['Help with {n} bills','Each month, discounts, social tariffs and help schemes from {n}, with who qualifies.','monthly'],
           ['{n} in the news','Each month, news about {n}, in a few lines with links.','monthly']],
  carmaker:[['{n} recall watch','Each month, check for new recalls affecting my {n} [model, year].','monthly'],
            ['New from {n}','Each month, new models, prices and offers {n} announces.','monthly'],
            ['{n} prices','Each month, price changes for {n} models, with sources.','monthly'],
            ['{n} electric models','Each month, news on {n}’s electric and hybrid models - range, prices, launches.','monthly'],
            ['{n} software updates','Each month, software updates {n} releases for its cars, with what changes.','monthly'],
            ['{n} reviews','Each month, reviews of new {n} models from the motoring press, each in a sentence.','monthly'],
            ['{n} in the news','Each week, news about {n}, in a few lines with links.','weekly'],
            ['{n} offers in {c}','Each month, {n} offers and financing deals in {c}.','monthly','c']],
  museum:[['New at {n}','Each month, new exhibitions and events at {n}, with dates and how to book ({s}).','monthly'],
          ['Free days at {n}','Each month, free entry days and discounts at {n}.','monthly'],
          ['Tours and talks at {n}','Each month, guided tours, talks and workshops at {n}, with how to book.','monthly'],
          ['{n} for families','Each month, family and children’s activities at {n}.','monthly'],
          ['{n} opening hours','Each month, changes to {n}’s opening hours and closures.','monthly'],
          ['New in {n}’s online collection','Each month, new additions to {n}’s online collection, with links.','monthly'],
          ['Last chance at {n}','Each month, exhibitions at {n} closing in the next four weeks.','monthly'],
          ['Late nights at {n}','Each month, evening openings and special nights at {n}.','monthly'],
          ['New acquisitions at {n}','Each month, new works and objects {n} acquired, with links.','monthly'],
          ['Courses at {n}','Each month, courses and classes at {n}, with how to book.','monthly'],
          ['{n} membership','Each month, membership offers and member events at {n}.','monthly']],
  library:[['New at {n}','Each month, new events, changed opening hours and new e-book services at {n} ({s}).','monthly'],
           ['Events at {n}','Each week, talks, readings and workshops at {n}, with dates.','weekly'],
           ['{n} opening hours','Each month, changes to {n}’s opening hours and closures.','monthly'],
           ['{n} for children','Each month, story times and children’s activities at {n}.','monthly'],
           ['New digital services at {n}','Each month, new e-books, databases and online services at {n}.','monthly'],
           ['Free courses at {n}','Each month, free courses and classes at {n} - languages, computers, jobs.','monthly'],
           ['Exhibitions at {n}','Each month, exhibitions and displays at {n}.','monthly']],
  research:[['New from {n}','Each month, new publications and announcements from {n} on [topic], with links.','monthly'],
            ['Jobs and grants at {n}','Each month, positions and grants {n} opens, with closing dates.','monthly'],
            ['{n} news','Each week, the main news from {n}, each in two sentences with a link.','weekly'],
            ['Public events at {n}','Each month, public talks and open days at {n}, with dates.','monthly'],
            ['Datasets and tools from {n}','Each month, new datasets, software and tools {n} released, with links.','monthly'],
            ['{n} discoveries, explained','Each week, results from {n} that made the news, explained simply.','weekly'],
            ['PhD and fellowship calls at {n}','Each month, PhD places and fellowships {n} opens, with deadlines.','monthly'],
            ['Conferences at {n}','Each month, conferences and workshops {n} organises, with dates.','monthly'],
            ['{n} collaborations','Each month, new partnerships and joint projects {n} announced.','monthly']],
  publisher:[['New from {n}','Each month, new releases from {n} in [genre or subject], with dates.','monthly'],
             ['{n} bestsellers','Each week, {n}’s bestselling titles, with a line on each.','weekly'],
             ['New books from {n}','Each week, new books from {n}, with a line on each.','weekly'],
             ['Prizes for {n} authors','Each month, prizes and nominations for {n}’s authors.','monthly'],
             ['Author events from {n}','Each month, readings and author events from {n}, with dates.','monthly'],
             ['Is {n} open for submissions?','Each month, whether {n} is open for submissions, and its rules.','monthly'],
             ['{n} in the news','Each month, news about {n}, in a few lines with links.','monthly'],
             ['{n} releases in {c}','Each month, new releases from {n} in {c}, with dates.','monthly','c'],
             ['{n} bestsellers in {c}','Each week, {n}’s bestselling titles in {c}, with a line on each.','weekly','c']],
  school:[['{n} deadline watch','Watch {s} for enrolment dates, term dates and closures at {n}, and remind me a week before each.','weekly'],
          ['News from {n}','Each week, announcements from {n} for parents and students.','weekly'],
          ['Events at {n}','Each month, events at {n} for families, with dates.','monthly'],
          ['Admissions at {n}','Each month, admissions news and open days at {n}, with dates.','monthly'],
          ['{n} results and reports','Each month, published results and inspection reports about {n}.','monthly'],
          ['Meals at {n}','Each week, the menu and meal changes at {n}.','weekly'],
          ['Holidays at {n}','Each month, holidays and days off at {n} in the coming months.','monthly'],
          ['After-school activities at {n}','Each month, clubs and after-school activities at {n}.','monthly'],
          ['Exams at {n}','Each month, exam dates and results days at {n}.','monthly']],
  sportsclub:[['{n} match week','Each week, {n}’s next fixtures, results and team news.','weekly'],
              ['{n} tickets','Each week, when tickets go on sale for {n}’s next matches, and the prices.','weekly'],
              ['{n} result','After each {n} match, the result and the key moments in a paragraph.','daily'],
              ['{n} transfers','Each day, transfer news about {n}, and tell me only if there is some.','daily'],
              ['{n} injuries','Each week, injuries and suspensions at {n}.','weekly'],
              ['{n} in the table','Each week, where {n} stands in its league, with the next three fixtures.','weekly'],
              ['{n} season tickets','Each month, season-ticket and membership news from {n}, with prices and dates.','monthly'],
              ['{n} academy','Each month, news from {n}’s academy and youth teams.','monthly'],
              ['{n} club news','Each week, official news from {n} ({s}), in a few lines.','weekly'],
              ['{n} women’s team','Each week, results and fixtures of {n}’s women’s team, if it has one.','weekly'],
              ['{n} match preview','Before each {n} match, a preview: form, likely line-ups and what is at stake.','weekly'],
              ['{n} in numbers','Each month, {n}’s key statistics - top scorers, form and records.','monthly'],
              ['{n} stadium news','Each month, news about {n}’s ground - works, capacity, transport.','monthly']],
  stadium:[['New at {n}','Each month, newly announced events at {n}, with dates and when tickets go on sale.','monthly'],
           ['Concerts at {n}','Each month, concerts announced at {n}, with dates and when tickets go on sale.','monthly'],
           ['Tours of {n}','Each month, stadium tours and visitor events at {n}.','monthly'],
           ['Getting to {n}','Each month, transport and parking changes for events at {n}.','monthly'],
           ['Entry rules at {n}','Each month, changes to bag, ticket and entry rules at {n}.','monthly']],
  theatre:[['New at {n}','Each month, new shows announced at {n}, with dates and when booking opens ({s}).','monthly'],
           ['Last-minute tickets at {n}','Each week, shows at {n} this week with seats still available.','weekly'],
           ['Reviews of {n} shows','Each week, reviews of the shows at {n}, each in a sentence.','weekly'],
           ['{n} for families','Each month, family shows and activities at {n}, with dates.','monthly'],
           ['Cheap tickets at {n}','Each month, discounts and cheap-ticket schemes at {n}.','monthly'],
           ['Talks and workshops at {n}','Each month, talks and workshops at {n}, with how to book.','monthly'],
           ['Last chance at {n}','Each month, shows at {n} closing in the next four weeks.','monthly'],
           ['{n} membership','Each month, membership offers and member events at {n}.','monthly']],
  festival:[['New from {n}','Each week, line-up announcements and ticket release dates from {n} ({s}).','weekly'],
            ['{n} dates','Each month, the confirmed dates of {n}’s next edition, from {s}.','monthly'],
            ['{n} tickets and prices','Each week, ticket prices and releases for {n}.','weekly'],
            ['Getting to {n}','Each month, travel, camping and accommodation information from {n}.','monthly'],
            ['{n} schedule','Each week before {n} starts, the schedule as it is published, day by day.','weekly'],
            ['{n} in the news','Each month, news about {n}, in a few lines with links.','monthly'],
            ['Volunteer at {n}','Each month, volunteer and work opportunities at {n}.','monthly']],
  park:[['{n} conditions','Before my visit on [dates], check {n} for closures, weather warnings and trail conditions ({s}).','weekly'],
        ['Events at {n}','Each month, guided walks and events at {n}, with dates.','monthly'],
        ['{n} closures','Each week, closures and warnings at {n}, and tell me only if there is one.','weekly'],
        ['{n} this month','Each month, what wildlife and nature are at their best at {n} this month.','monthly'],
        ['{n} permits and fees','Each month, any change to permits, fees and booking rules at {n}.','monthly']],
  zoo:[['New at {n}','Each month, new events, arrivals and ticket offers at {n} ({s}).','monthly'],
       ['Events at {n}','Each month, talks, feeding times and events at {n}.','monthly'],
       ['{n} opening hours','Each month, changes to {n}’s opening hours and closures.','monthly'],
       ['{n} conservation news','Each month, the conservation work and news from {n}.','monthly'],
       ['School visits to {n}','Each month, school visits and education programmes at {n}.','monthly']],
  brewery:[['New from {n}','Each month, new releases, tours and events from {n} ({s}).','monthly'],
           ['Tours at {n}','Each month, tours and tastings at {n}, with how to book.','monthly'],
           ['{n} awards','Each month, awards won by {n}’s beers.','monthly'],
           ['{n} in the news','Each month, news about {n}, in a few lines with links.','monthly']],
  employer:[['New jobs at {n}','Each day, new [role] openings at {n} in [location], with links.','daily'],
            ['{n} in the news','Each week, news about {n} - results, layoffs, hiring - in a few lines.','weekly'],
            ['{n} as an employer','Each month, what current and former employees say about working at {n}, from public reviews, in a few lines.','monthly'],
            ['Internships at {n}','Each month, internship and graduate programmes at {n}, with deadlines.','monthly'],
            ['{n} work policies','Each month, changes to {n}’s remote-work, benefits and leave policies reported publicly.','monthly'],
            ['{n} results','Each month, {n}’s results and announcements, in a few lines.','monthly'],
            ['{n} hiring events','Each month, career fairs and hiring events {n} takes part in.','monthly'],
            ['Jobs at {n} in {c}','Each day, new openings at {n} in {c}, with links.','daily','c'],
            ['{n} in {c}','Each week, news about {n} in {c} - offices, hiring, layoffs - in a few lines.','weekly','c'],
            ['Internships at {n} in {c}','Each month, internships and graduate roles at {n} in {c}, with deadlines.','monthly','c'],
            ['Layoffs at {n}','Each week, any layoffs or hiring freezes announced at {n}, and tell me only if there is one.','weekly'],
            ['Salaries at {n} in {c}','Each month, what published sources say {n} pays in {c}, by role, with sources.','monthly','c'],
            ['{n} hiring events in {c}','Each month, career fairs and hiring events in {c} where {n} recruits.','monthly','c']],
  company:[['New jobs at {n}','Each day, new [role] openings at {n} in [location], with links.','daily'],
           ['{n} in the news','Each week, news about {n}, in a few lines with links.','weekly'],
           ['New from {n}','Each week, new products and services {n} announced, with links.','weekly'],
           ['{n} results','Each month, {n}’s financial results and outlook, in plain numbers with sources.','monthly'],
           ['{n} price changes','Each month, price changes {n} announced, and when they start.','monthly'],
           ['{n} outages','Each day, any outage of {n}’s services, and tell me only if there is one.','daily'],
           ['{n} recalls and safety notices','Each week, recalls or safety notices from {n}, and tell me only if there is one.','weekly'],
           ['{n} leadership changes','Each month, changes to {n}’s leadership and board, with sources.','monthly'],
           ['{n} deals and acquisitions','Each month, acquisitions, partnerships and investments by {n}, with sources.','monthly'],
           ['{n} legal and regulatory news','Each month, lawsuits, fines and regulatory decisions involving {n}, with sources.','monthly'],
           ['{n} sustainability','Each month, {n}’s climate and sustainability announcements, checked against reporting by others.','monthly'],
           ['{n} customer reviews','Each month, what recent customer reviews say about {n}, in a few lines.','monthly'],
           ['Jobs at {n} in {c}','Each day, new openings at {n} in {c}, with links.','daily','c'],
           ['{n} in {c}','Each week, news about {n} in {c}, in a few lines with links.','weekly','c'],
           ['{n} offers in {c}','Each week, offers and prices from {n} for customers in {c}.','weekly','c'],
           ['{n} data breaches','Each week, any data breach or security incident at {n}, and tell me only if there is one.','weekly'],
           ['{n} privacy and terms','Each month, changes to {n}’s privacy policy or terms, and what they mean.','monthly'],
           ['{n} share price','Each day, {n}’s share price and the main reason it moved, if it is listed.','daily'],
           ['{n} patents','Each month, new patents granted to {n}, each in a sentence.','monthly'],
           ['{n} and its competitors','Each month, what {n}’s main competitors announced, in a few lines.','monthly'],
           ['{n} strikes and labour news','Each month, strikes, union disputes and labour news at {n}, with sources.','monthly'],
           ['{n} credit rating','Each month, any change to {n}’s credit rating, with sources.','monthly'],
           ['Shareholder meetings at {n}','Each month, upcoming shareholder meetings and votes at {n}, with dates.','monthly'],
           ['{n} supply news','Each month, supply problems, factory news and shortages at {n}, with sources.','monthly'],
           ['{n} recalls in {c}','Each week, recalls of {n} products in {c}, and tell me only if there is one.','weekly','c'],
           ['{n} customer service in {c}','Each month, how to reach {n}’s customer service in {c}, and any change to it.','monthly','c'],
           ['{n} openings in {c}','Each week, new {n} stores, offices or sites opening in {c}.','weekly','c'],
           ['{n} events in {c}','Each month, events, launches and pop-ups {n} holds in {c}, with dates.','monthly','c']],
  software:[['New from {n}','Each week, product updates, price changes and security notices from {n} ({s}).','weekly'],
            ['{n} outages','Each day, any {n} outage or incident, and tell me only if there is one.','daily'],
            ['Jobs at {n}','Each week, new [role] openings at {n}, with links.','weekly'],
            ['{n} security advisories','Each day, security advisories for {n}, and tell me only if there is one.','daily'],
            ['{n} release notes','Each week, {n}’s release notes in plain words - what changed for people using it.','weekly'],
            ['{n} pricing','Each month, changes to {n}’s plans and prices.','monthly'],
            ['{n} privacy and terms','Each month, changes to {n}’s privacy policy or terms, and what they mean.','monthly'],
            ['Learn {n}','Each month, new tutorials and webinars from {n}, with links.','monthly'],
            ['Alternatives to {n}','Each month, notable new alternatives to {n}, with how they compare.','monthly'],
            ['{n} in the news','Each week, news about {n}, in a few lines with links.','weekly']],
  nonprofit:[['New from {n}','Each month, news, appeals and volunteer openings from {n} ({s}).','monthly'],
             ['Volunteer with {n}','Each month, volunteer openings at {n} in [area], with how to apply.','monthly'],
             ['{n} campaigns','Each month, campaigns and petitions {n} launches, with links.','monthly'],
             ['{n} reports','Each month, reports and research {n} published, each in a sentence.','monthly'],
             ['Events by {n}','Each month, events and fundraisers by {n}, with dates.','monthly'],
             ['Jobs at {n}','Each month, paid openings at {n}, with closing dates.','monthly'],
             ['{n} in the news','Each month, news about {n}, in a few lines with links.','monthly'],
             ['{n} in {c}','Each month, what {n} is doing in {c} - projects, appeals and events.','monthly','c'],
             ['{n} finances','Each month, any new annual report or accounts {n} published, with where the money goes.','monthly'],
             ['{n} impact','Each month, the results {n} reports from its work, checked against others’ reporting where possible.','monthly']]
};

/* Sites blocked nationwide, by country - the long-standing, widely documented
   blocks (China's on Google, Meta, X, Wikipedia and the main foreign news;
   Russia's on Meta, X and LinkedIn). Matched on the service's own address. */
const CC_BLOCKED = {
  CN: /(^|\.)(google|youtube|gmail|blogspot|facebook|instagram|whatsapp|twitter|x|wikipedia|telegram|line|dropbox|nytimes|bbc|reuters|bloomberg|wsj)\.[a-z.]+$|(^|\.)[a-z]+\.google$/,
  RU: /(^|\.)(facebook|instagram|twitter|x|linkedin)\.[a-z.]+$/,
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
      /* A site blocked nationwide in this country is no use to anybody there,
         however popular it is elsewhere - China lists Google as an employer
         and a Hong Kong club whose site is facebook.com. */
      const blocked = CC_BLOCKED[cc];
      const good = e => e && !(blocked && blocked.test(String(e.s || '')))
        && /^Q\d{1,12}$/.test(e.q) && typeof e.n === 'string' && e.n.length >= 2 && e.n.length <= 90
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
  else _ccDone[cc] = d;
  return d;
}
/* WHAT "POPULAR" IS RANKED BY (Build 16 audit D16-07). A country's lists are
   ordered by visits from that country to each service - the Chrome UX Report
   for the month its file names - not by how often anybody runs the task in
   AMV. The screen says which, and says so when the country's file has no
   visit data at all, rather than letting the order look measured. null until
   the country's file has arrived. */
const _ccDone = {};
function ccMeasure(cc){
  const d = _ccDone[String(cc || '').toUpperCase()]; if(!d) return null;
  const m = /Chrome UX Report (\d{4})(\d{2})\b/.exec(String(d.popular || ''));
  const visits = !!m && Object.values(d.kinds || {}).some(l => (l || []).some(e => +e.r > 0));
  let month = '';
  if(m){ try{ const code = (typeof _lang === 'function' && _lang() !== 'auto') ? _lang() : undefined;
    month = new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString(code, { month: 'long', year: 'numeric', timeZone: 'UTC' }); }catch(e){ month = m[1] + '-' + m[2]; } }
  return { visits, month };
}
/* English only: "a {n}" before a vowel is "an" - "Find an Iberia flight". The
   translated titles are left alone ("a {n}" is "the" in Portuguese). */
const _ccAn = (t, e) => /^[aeiou]/i.test(e.n) ? String(t).replace(/\b([Aa]) \{n\}/g, '$1n {n}') : String(t);
/* {c}: the country the entry was listed in - "the United States" in English
   (as the rest of Crew says it), the browser's own name for it otherwise. */
const _ccPlace = (cc, en) => {
  try{ const row = _cwCountryRow(cc); if(!row) return cc || ''; return en ? _cwThe(row[1]) : _cwPlaceName(row[1]); }catch(e){ return cc || ''; }
};
const _ccFill = (t, e, en, cc) => (en ? _ccAn(t, e) : String(t)).replace(/\{n\}/g, e.n).replace(/\{s\}/g, e.s)
  .replace(/\{c\}/g, () => _ccPlace(cc, en));
const _ccTitle = (t, e, cc) => { const tr = T(t); return _ccFill(tr, e, tr === t, cc); };
/* Every task, job and service for a country, each tied to the entry it names. */
/* MOST USED FIRST, ACROSS EVERY KIND (Nov 16, the owner: "organize jobs,
   tasks, crew by popularity for every country - I need these to get the most
   users").

   The lists used to take turns by kind: the first bank, the first zoo, the
   first newspaper, then the second of each - so a zoo nobody in the country
   visits stood level with the biggest bank there. Every entry carries `r`,
   the Chrome UX Report bucket its site falls in for visits FROM this country
   (1000 = among the thousand most visited there), and its place in its kind's
   list, which is the data's own order (that report, then Wikipedia
   sitelinks). So the country's services are ordered by that bucket; inside a
   bucket - the report says only "among the top 1,000" - the country's own
   before the world's (`x`, how many countries list the same service, written
   by scripts/country-reach.mjs: Facebook and MIT are in dozens, Renfe and El
   País in one, and it is the country's own that people there come for); then
   by place, then by sitelinks. One the report never saw comes after every one
   it did. Jobs and tasks follow their services: one each, most visited
   service first, before a second for any - the job each service leads with
   rotated by its place, so the first screen is not one kind of job twenty
   times over. What people in the country actually switch on reorders Crew on
   top of this (crew-view.js, _cjList). */
function _ccByPop(d){
  const out = [];
  for(const [kind, list] of Object.entries((d && d.kinds) || {})) (list || []).forEach((e, i) => out.push({ kind, e, i }));
  const R = x => (+x.e.r > 0 ? +x.e.r : 1e9), W = x => ((+x.e.x || 1) >= 3 ? 1 : 0);
  return out.sort((a, b) => (R(a) - R(b)) || (W(a) - W(b)) || (a.i - b.i) || ((+b.e.w || 0) - (+a.e.w || 0)) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
}
function _ccByPopPass(d, TPL, make){
  const ents = _ccByPop(d).filter(x => TPL[x.kind] && TPL[x.kind].length);
  const out = [], most = Math.max(0, ...ents.map(x => TPL[x.kind].length));
  for(let p = 0; p < most; p++) for(const x of ents){
    const n = TPL[x.kind].length; if(p >= n) continue;
    out.push(make(x.kind, x.e, (x.i + p) % n));
  }
  return out;
}
/* A task opens chat with the service's name and the site the row shows under
   it - so AMV starts where the person was told it would. Half the task
   templates never named the site; it is added to those, never twice. */
const _ccWithSite = (p, e) => p.indexOf(e.s) >= 0 ? p : p + ' Start from ' + e.n + '’s official site, ' + e.s + '.';
function ccTasks(d){
  return _ccByPopPass(d, CC_TASKS, (kind, e, i) => { const t = CC_TASKS[kind][i];
    return { id:'cc-' + kind + '-' + e.q + '-' + i, kind, e, tpl:t[0], title:_ccTitle(t[0], e), prompt:_ccWithSite(_ccFill(t[1], e, true), e) }; });
}
function ccJobs(d){
  return _ccByPopPass(d, CC_CREW, (kind, e, i) => { const t = CC_CREW[kind][i];
    return { id:_ccJobId(kind, e, i, d.cc), kind, e, i, title:_ccTitle(t[0], e, d.cc), prompt:_ccFill(t[1], e, true, d.cc), every:t[2] }; });
}
function ccServices(d){
  return _ccByPop(d).map(x => ({ kind: x.kind, e: x.e }));
}
/* The sentence under a Popular list. Tasks are the country's services in
   visit order and nothing else; Crew puts the jobs picked for the country
   first, and - where the server has counted enough switch-ons there
   (meta.ranked) - the ones people there switch on most. */
function ccPopularNote(cc, crew){
  const m = ccMeasure(cc); if(!m) return '';
  let place = cc;
  try{ const row = CW_WORLD_COUNTRIES.find(c => c[0] === cc); if(row) place = _cwPlaceName(row[1]); }catch(e){}
  const t = !m.visits ? T('There is no visit data for {0}, so this list is in the catalogue’s own order - not a measure of what is popular.')
    : crew === 'counted' ? T('Jobs picked for {0} and the ones people there switch on most in AMV come first; the rest by visits from {0} to each service (Chrome UX Report, {1}).')
    : crew ? T('Jobs picked for {0} come first; the rest by visits from {0} to each service (Chrome UX Report, {1}) - not by how often a job is run in AMV.')
    : T('Ranked by visits from {0} to each service (Chrome UX Report, {1}) - not by how often a task is run in AMV.');
  return t.split('{0}').join(place).replace('{1}', m.month);
}
try{ window.ccPopularNote = ccPopularNote; window.ccMeasure = ccMeasure; window.ccLoad = ccLoad; window.ccTasks = ccTasks; window.ccJobs = ccJobs; window.ccServices = ccServices; }catch(e){}

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
  /* Built once per country, language and language pack, and kept: Crew
     calls this every time it opens, and making a few thousand jobs (each a
     title and an instruction filled from its template) on every visit was a
     half-second freeze on a slow phone. Each job is made once, by the one
     builder - this used to make every job through ccJobs and throw it away. */
  const key = _ccCrewKey(), m = _ccCrewMade[cc];
  if(_ccCrewJobs[cc] && m && m.d === d && m.key === key) return _ccCrewJobs[cc];
  if(m && m.d === d && m.key === key && m.busy) return m.busy;
  /* The first build is done in slices with a pause between them, so the page
     answers a tap while a big country (the United States: ~23,000 jobs) is
     being made. The order is worked out first - cheap - and kept. */
  const made = { d, key };
  _ccCrewMade[cc] = made;
  made.busy = (async () => {
    const order = _ccByPopPass(d, CC_CREW, (kind, e, i) => [kind, e, i]), out = [];
    for(let k = 0; k < order.length; k++){
      const [kind, e, i] = order[k]; out.push(ccCrewJob(kind, e, i, d.cc));
      if(k % 1500 === 1499){ await new Promise(r => setTimeout(r, 0)); if(_ccCrewMade[cc] !== made) return _ccCrewJobs[cc] || out; }
    }
    _ccCrewJobs[cc] = out; made.busy = null;
    return out;
  })();
  return made.busy;
}
const _ccCrewMade = {};
/* The titles are in the reader's language, so a change of language - or its
   pack arriving after the first draw - makes them again. */
const _ccCrewKey = () => { try{ const l = _lang(); return l + (_i18nPackHave(l) ? '+' : '-'); }catch(e){ return ''; } };
const _ccAsks = (p) => { const b = [...new Set((p.match(/\[[^\]]*\]/g) || []).map(x => x.slice(1, -1)))];
  return b.length ? { q: 'This job needs: ' + b.join(', ') + '.', ph: 'Type each one, in a sentence or a list.' } : null; };
/* A job's id. A job about the entry alone is the same job in every country
   that lists it ("Microsoft results"), so its id has no country - and it is
   the id somebody's switched-on job was saved under, so it never changes. A
   job about the entry IN a country (a template marked 'c': "Jobs at
   Microsoft in Spain") is a different job per country, and says which. */
const _ccJobId = (kind, e, i, cc) => 'ccj-' + kind + '-' + e.q + '-' + i + (CC_CREW[kind][i][3] === 'c' ? '-' + cc : '');
/* One job: entry `e` of kind `kind`, template `i`, listed in country `cc`.
   The one builder, so a job on the main list and the same job in the
   directory are the same object. */
function ccCrewJob(kind, e, i, cc){
  const t = CC_CREW[kind][i], prompt = _ccFill(t[1], e, true, cc);
  return {
    asks: _ccAsks(prompt),
    id: _ccJobId(kind, e, i, cc), icon: (CC_KINDS[kind] || ['\u2022'])[0], title: _ccTitle(t[0], e, cc),
    desc: prompt.replace(/\[([^\]]*)\]/g, '$1'), prompt, every: t[2],
    needs: 'Web research', cat: (CC_KINDS[kind] || ['', ''])[1], kind: 'research', ccKind: kind, site: e.s, src: e.q,
  };
}

/* THE DIRECTORY OF EVERY JOB, COUNTED AND SEARCHED WITHOUT BEING BUILT (Nov 16).

   "See all jobs" used to make every job of every country as an object - a
   title, an instruction and a description each - and keep them all: a
   quarter of a million objects, hundreds of megabytes on a phone, before
   anybody typed a letter. The jobs are a product: entries times templates.
   So the directory keeps the factors and multiplies only what is on screen.

   A search word matches a job when it is in the job's template (its title in
   English and in the reader's language, its instruction, its category) or in
   the entry (the name and the site). Each is reduced to a bit per word once
   per search, and a job matches when the two together have every bit - so
   counting a million jobs is a million integer ORs, and nothing is allocated.

   The same company is often listed in several countries. A job about the
   company alone is the same job wherever it is listed, has the same id, and
   is counted once - in the first country of the reader's order (their own
   first). A job about the company in a country (marked 'c') is counted in
   each. */
const _ccDir = {};   // cc -> [{ kind, list, tpl, hay:[template text], eh:[entry text] }]
async function ccDirLoad(cc){
  if(_ccDir[cc]) return _ccDir[cc];
  const d = await ccLoad(cc); if(!d) return null;
  const groups = [];
  for(const [kind, list] of Object.entries(d.kinds || {})){
    const tpl = CC_CREW[kind]; if(!tpl || !list.length) continue;
    const cat = (CC_KINDS[kind] || ['', ''])[1];
    const here = [_ccPlace(cc, true), _ccPlace(cc, false)].join(' ');
    groups.push({ kind, list, tpl, sc: Uint8Array.from(tpl, t => t[3] === 'c' ? 1 : 0),
      hay: tpl.map(t => [t[0], T(t[0]), t[1], cat, T(cat), t[3] === 'c' ? here : ''].join(' ').toLowerCase()),
      eh: list.map(e => (e.n + ' ' + e.s).toLowerCase()) });
  }
  return (_ccDir[cc] = groups);
}
/* Which entries are a repeat of one listed in an earlier country, worked
   out once for an order of countries and kept until a country arrives. */
let _ccDirDupKey = '';
function _ccDirDups(codes){
  const key = codes.filter(cc => _ccDir[cc]).join(',');
  if(key === _ccDirDupKey) return;
  _ccDirDupKey = key;
  const seen = new Set();
  for(const cc of codes) for(const g of (_ccDir[cc] || [])){
    g.dup = new Uint8Array(g.list.length);
    g.live = 0;
    g.list.forEach((e, r) => { const k = g.kind + '|' + e.q; if(seen.has(k)) g.dup[r] = 1; else { seen.add(k); g.live++; } });
  }
}
/* How many jobs match, and the first `want` of them as jobs, in the
   directory's order: country by country (the reader's own first); with no
   search, one job per service before a second for any - template round, then
   rank, then kind - so the first screen spans many services, as the main
   list does; with a search, service by service. */
function ccDirFind(codes, words, want){
  _ccDirDups(codes);
  const W = Math.min(words.length, 30), full = W ? (2 ** W) - 1 : 0;
  const bits = (s) => { let m = 0; for(let w = 0; w < W; w++) if(s.indexOf(words[w]) >= 0) m |= (1 << w); return m; };
  let n = 0; const rows = [];
  const take = (g, r, t, cc) => { const j = ccCrewJob(g.kind, g.list[r], t, cc); j.country = cc; rows.push(j); };
  for(const cc of codes){
    const groups = _ccDir[cc]; if(!groups) continue;
    if(!W){
      for(const g of groups){ let sc = 0; for(const x of g.sc) sc += x; n += g.live * (g.tpl.length - sc) + g.list.length * sc; }
      if(rows.length >= want) continue;
      const rounds = Math.max(0, ...groups.map(g => g.tpl.length)), ranks = Math.max(0, ...groups.map(g => g.list.length));
      out: for(let t = 0; t < rounds; t++) for(let r = 0; r < ranks; r++) for(const g of groups){
        if(t >= g.tpl.length || r >= g.list.length || (g.dup[r] && !g.sc[t])) continue;
        take(g, r, t, cc); if(rows.length >= want) break out;
      }
      continue;
    }
    for(const g of groups){
      const tm = g.hay.map(bits);
      /* Templates by the words they hold: an entry then counts every template
         its own words complete, without visiting the templates one by one. */
      /* Two counts: every template, and only the ones marked 'c' - an entry
         already listed in an earlier country counts just the second. */
      const all = new Map(), own = new Map();
      tm.forEach((m, t) => { all.set(m, (all.get(m) || 0) + 1); if(g.sc[t]) own.set(m, (own.get(m) || 0) + 1); });
      let any = 0; for(const m of all.keys()) any |= m;
      for(let r = 0; r < g.list.length; r++){
        const dup = g.dup[r];
        if(dup && !own.size) continue;
        const em = bits(g.eh[r]);
        if(((em | any) & full) !== full) continue;
        for(const [m, c] of (dup ? own : all)) if((m | em) === full) n += c;
        if(rows.length < want) for(let t = 0; t < tm.length && rows.length < want; t++) if((!dup || g.sc[t]) && (tm[t] | em) === full) take(g, r, t, cc);
      }
    }
  }
  return { n, rows };
}
try{ window.ccCrewJob = ccCrewJob; window.ccDirLoad = ccDirLoad; window.ccDirFind = ccDirFind; }catch(e){}
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
      <div class="int-act">${x.kind === 'bank'
        /* A bank is never opened in AMV's browser, where a signed-in session
           could move money. Link is the read-only connection - balances and
           transactions, never a payment - and it says where it is available. */
        ? `<button class="btn bs cc-use" type="button" data-dact="openBankLink">${escH(T('Link'))}</button>`
        : `<button class="btn bs cc-use" type="button" data-dact="ccUseService" data-darg="${escH(x.e.q)}">${escH(T('Use'))}</button>`}</div></div>`;
  for(const [topic, rows] of Object.entries(by)){
    let sec = root.querySelector('[data-topic="' + topic + '"]');
    if(!sec){
      if(!CC_EXTRA_TOPICS[topic]) continue;
      sec = document.createElement('div'); sec.className = 'ss2'; sec.dataset.topic = topic;
      sec.innerHTML = '<h3>' + escH(T(CC_EXTRA_TOPICS[topic])) + '</h3><div class="int-list"></div>';
      root.appendChild(sec);
    }
    /* IN THE TOPIC'S OWN GRID, NOT A SECOND BLOCK (Nov 17). The country's
       services used to sit under the apps with a "See all 75" of their own,
       below the apps' "See all 31" - two buttons, two grids, uneven rows.
       They fill the topic's nine now, and the one button below counts both. */
    let list = sec.querySelector('.int-list');
    if(!list){ list = document.createElement('div'); list.className = 'int-list';
      const h = sec.querySelector('h3'); if(h) h.after(list); else sec.prepend(list); }
    const none = sec.querySelector('.int-none'); if(none) none.remove();
    const btn = sec.querySelector('[data-app-more]');
    /* Open is the page's own record (_appOpen, 13-integrations.js), so a
       topic of only the country's services opens and closes like the rest. */
    const open = btn ? btn.getAttribute('aria-expanded') === 'true'
      : (() => { try{ return _appOpen.has(topic); }catch(e){ return false; } })();
    const shown = list.querySelectorAll('.int-card').length;
    const fill = open ? rows.length : Math.max(0, CC_INT_SHOWN - shown);
    list.querySelectorAll('.cc-svc').forEach(n => n.remove());
    list.insertAdjacentHTML('beforeend', rows.slice(0, fill).map(svcRow).join(''));
    const topicName = ((sec.querySelector('h3') || {}).textContent || '').trim();
    if(open){
      if(!btn && rows.length > CC_INT_SHOWN){
        const wrap = document.createElement('div'); wrap.className = 'int-more';
        wrap.innerHTML = `<button class="int-seemore" type="button" data-app-more="${escH(topic)}" aria-expanded="true"
          aria-label="${escH(T('Show fewer in {0}').replace('{0}', topicName))}">${escH(T('Show fewer'))}</button>`;
        sec.appendChild(wrap);
        on(wrap.querySelector('button'), 'click', () => { try{ _appToggle(topic); }catch(e){} });
      }
      continue;
    }
    const rest = (btn ? (+btn.dataset.rest || 0) : 0) + Math.max(0, rows.length - fill);
    if(btn){
      if(rest > 0){
        const svg = btn.querySelector('svg');
        btn.textContent = T('See the remaining {0}').replace('{0}', rest.toLocaleString());
        if(svg) btn.appendChild(svg);
        btn.setAttribute('aria-label', T('See the remaining {0} in {1}').replace('{1}', topicName).replace('{0}', rest.toLocaleString()));
      }
    } else if(rest > 0){
      const wrap = document.createElement('div'); wrap.className = 'int-more';
      wrap.innerHTML = `<button class="int-seemore" type="button" data-app-more="${escH(topic)}" aria-expanded="false"
        aria-label="${escH(T('See the remaining {0} in {1}').replace('{1}', topicName).replace('{0}', rest.toLocaleString()))}">${escH(T('See the remaining {0}').replace('{0}', rest.toLocaleString()))}</button>`;
      sec.appendChild(wrap);
      on(wrap.querySelector('button'), 'click', () => { try{ _appToggle(topic); }catch(e){} });
    }
  }
}
/* A topic's first screen: its apps, then the country's services, nine cards. */
const CC_INT_SHOWN = 9;
/* EVERY COUNTRY'S SERVICES, SEARCHED (Nov 17). The Integrations search box
   finds a service whatever country is chosen: every country's file is read
   (each is cached after the first time), every entry whose name or address
   holds every word is kept once, with the countries that list it, most
   visited first - the best Chrome UX Report bucket in any of them, then how
   many countries list it. Sixty are drawn; Show more draws sixty more. */
let _ccSearchTok = 0;
async function ccSearchServices(q){
  const box = document.getElementById('cdir-cc'); if(!box) return;
  const tok = ++_ccSearchTok;
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean); if(!words.length){ box.innerHTML = ''; return; }
  box.innerHTML = '<div class="ss2"><h3>' + escH(T('Services in every country')) + '</h3><p class="int-none" role="status">' + escH(T('Searching every country…')) + '</p></div>';
  const codes = (typeof CW_WORLD_COUNTRIES !== 'undefined' ? CW_WORLD_COUNTRIES : []).map(c => c[0]);
  const by = new Map();
  let i = 0;
  const one = async () => { while(i < codes.length){ const cc = codes[i++]; const d = await ccLoad(cc).catch(() => null); if(!d) continue;
    for(const [kind, list] of Object.entries(d.kinds || {})) for(const e of (list || [])){
      const h = (e.n + ' ' + e.s).toLowerCase(); if(!words.every(w => h.indexOf(w) >= 0)) continue;
      const k = kind + '|' + e.q; let x = by.get(k);
      if(!x){ x = { kind, e, cc: [], r: 1e9 }; by.set(k, x); }
      x.cc.push(cc); if(+e.r > 0) x.r = Math.min(x.r, +e.r);
    } } };
  await Promise.all(Array.from({ length: 8 }, one));
  if(tok !== _ccSearchTok || !box.isConnected) return;
  const all = [...by.values()].sort((a, b) => (a.r - b.r) || (b.cc.length - a.cc.length) || (a.e.n < b.e.n ? -1 : 1));
  all.forEach(x => { _ccSvc[x.e.q] = { kind: x.kind, e: x.e }; });
  const flag = (cc) => { const r = (typeof _cwCountryRow === 'function') ? _cwCountryRow(cc) : null; return r ? r[2] : cc; };
  const where = (x) => x.cc.slice(0, 4).map(flag).join(' ') + (x.cc.length > 4 ? ' +' + (x.cc.length - 4) : '');
  const row = (x) => `<div class="int-card cc-svc" data-cc="${escH(x.kind)}">
      <div class="int-ic" aria-hidden="true">${(CC_KINDS[x.kind] || ['\u2022'])[0]}</div>
      <div class="int-body"><div class="int-top"><span class="int-name" data-no-i18n>${escH(x.e.n)}</span></div>
        <div class="int-desc" data-no-i18n>${escH(x.e.s)} <span class="cc-where" aria-label="${escH(x.cc.join(', '))}">${where(x)}</span></div></div>
      <div class="int-act">${x.kind === 'bank'
        ? `<button class="btn bs cc-use" type="button" data-dact="openBankLink">${escH(T('Link'))}</button>`
        : `<button class="btn bs cc-use" type="button" data-dact="ccUseService" data-darg="${escH(x.e.q)}">${escH(T('Use'))}</button>`}</div></div>`;
  let n = 60;
  const paint = () => {
    if(!all.length){ box.innerHTML = '<div class="ss2"><h3>' + escH(T('Services in every country')) + '</h3><p class="int-none">' + escH(T('No country’s services match that.')) + '</p></div>'; return; }
    const countries = new Set(all.flatMap(x => x.cc)).size;
    box.innerHTML = '<div class="ss2"><h3>' + escH(T('Services in every country')) + '</h3>'
      + '<p class="int-sub" role="status">' + escH(T('{0} services in {1} countries').replace('{0}', all.length.toLocaleString()).replace('{1}', countries.toLocaleString())) + '</p>'
      + '<div class="int-list">' + all.slice(0, n).map(row).join('') + '</div>'
      + (all.length > n ? '<div class="int-more"><button class="int-seemore" type="button" id="cdir-cc-more">' + escH(T('See the remaining {0}').replace('{0}', (all.length - n).toLocaleString())) + '</button></div>' : '')
      + '</div>';
    const m = document.getElementById('cdir-cc-more'); if(m) on(m, 'click', () => { n += 60; paint(); });
  };
  paint();
}
function ccUseService(q){
  const x = _ccSvc[q]; if(!x) return;
  const text = 'Using AMV\u2019s browser, open ' + x.e.s + ' (' + x.e.n + '). I will sign in myself if it asks. Then help me [what you want to do there].';
  setTab('chat');
  setTimeout(() => { const ta = document.getElementById('mta'); if(!ta) return;
    ta.value = text; fitChatComposer(ta); ta.focus(); const a = text.indexOf('['); if(a >= 0) ta.setSelectionRange(a, text.indexOf(']') + 1); }, 150);
}
try{ window.ccSearchServices = ccSearchServices; window.ccFillIntegrations = ccFillIntegrations; window.ccUseService = ccUseService; window.ccCrewLoad = ccCrewLoad; }catch(e){}

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
  return new Promise((resolve0) => {
    if(!(navigator && navigator.geolocation)) return resolve0({ error: T('This browser cannot share a location. Choose your country from the list.') });
    /* The browser's own timeout does not start until the person answers its
       prompt, so a prompt left unanswered waited for ever. This one always
       ends: the list is right there either way. */
    let settled = false;
    const resolve = (v) => { if(!settled){ settled = true; clearTimeout(cap); resolve0(v); } };
    const cap = setTimeout(() => resolve({ error: T('The location could not be found right now. Choose your country from the list.') }), 20000);
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
  /* Each country by the browser's own name for it in the reader's language
     (Alemania, Deutschland), sorted that language's way - what the country
     page this replaced did. The English name is still searched. */
  const lc = (() => { try{ const l = _lang(); return (l === 'auto' || !l) ? 'en' : l; }catch(e){ return 'en'; } })();
  const nm = (c) => { try{ return _cwPlaceName(c[1]); }catch(e){ return T(c[1]); } };
  const list = (typeof CW_WORLD_COUNTRIES !== 'undefined' ? CW_WORLD_COUNTRIES : []).slice()
    .sort((a, b) => { try{ return nm(a).localeCompare(nm(b), lc); }catch(e){ return nm(a) < nm(b) ? -1 : 1; } });
  const cur = (typeof _cwCountryGuess === 'function') ? _cwCountryGuess() : '';
  const item = (c) => `<button class="ccp-row${c[0] === cur ? ' on' : ''}" data-ccp="${c[0]}" data-n="${escH((nm(c) + ' ' + c[1]).toLowerCase())}"${c[0] === cur ? ' aria-current="true"' : ''}><span class="ccp-flag" aria-hidden="true">${c[2]}</span><span class="ccp-n">${escH(nm(c))}</span>${c[0] === cur ? `<span class="ccp-cur">${escH(T('Selected'))}</span>` : ''}</button>`;
  r.innerHTML = `<div class="ov" id="ccp-bg"><div class="ccp" role="dialog" aria-modal="true" aria-labelledby="ccp-h">
    <header class="ccp-h"><h2 id="ccp-h">${escH(T('Choose your country'))}</h2><button class="cwp-x" id="ccp-x" aria-label="${escH(T('Close'))}">✕</button></header>
    <div class="ccp-tools">
      <button class="btn bs ccp-loc" id="ccp-loc"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>${escH(T('Use my location'))}</button>
      <div class="cj-find"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
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
