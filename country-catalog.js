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
  employer:['💼','Employers'], jobsite:['🔎','Job sites'],
  school:['🏫','Schools'], research:['🔬','Research'], publisher:['📖','Publishers'],
  software:['💻','Software'], pharma:['💊','Pharmaceuticals'], nonprofit:['🤝','Nonprofits'],
  theatre:['🎭','Theaters'], stadium:['🏟️','Stadiums'], mall:['🏬','Shopping centers'],
  park:['🏞️','National parks'], zoo:['🦁','Zoos'], festival:['🎪','Festivals'],
  embassy:['🛂','Embassies'], union:['✊','Trade unions'], brewery:['🍺','Breweries'],
  company:['🏢','Companies'],
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
  university:[['{n} deadline watch','Watch {s} for application, scholarship and enrollment deadlines at {n}, and remind me two weeks before each.','weekly'],
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
              ['Summer schools at {n}','Each month, summer schools and short programs at {n}, with deadlines.','monthly'],
              ['Admission requirements at {n}','Each month, any change to admission requirements at {n}, from {s}.','monthly'],
              ['International students at {n}','Each month, news for international students at {n} - visas, fees, deadlines.','monthly'],
              ['Sport and clubs at {n}','Each month, news from sports teams and student clubs at {n}.','monthly'],
              ['{n} alumni news','Each month, news and events for {n}’s alumni.','monthly'],
              ['Graduation at {n}','Each month, graduation dates and ceremonies at {n}.','monthly']],
  college:[['{n} deadline watch','Watch {s} for deadlines at {n}, and remind me two weeks before each.','weekly'],
           ['Courses starting at {n}','Each month, courses at {n} opening for enrollment, with start dates and fees from {s}.','monthly'],
           ['Open days at {n}','Each month, open days and info sessions at {n}, with dates and how to sign up.','monthly'],
           ['{n} news for students','Each week, announcements from {n} that affect students - term dates, fees, closures - with links.','weekly'],
           ['Jobs at {n}','Each week, new teaching and staff openings at {n}, with closing dates.','weekly'],
           ['{n} fees and funding','Each month, any change to fees, grants or financial help at {n} published on {s}.','monthly'],
           ['Short courses at {n}','Each month, short and evening courses at {n} open for enrollment, with fees.','monthly'],
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
      ['{n} schedule changes','Each week, schedule changes on {n} for [program].','weekly'],
      ['Films on {n} this week','Each week, the films on {n} this week, each with a line on what it is.','weekly'],
      ['Documentaries on {n}','Each week, the documentaries on {n}, with dates and times.','weekly'],
      ['Live sport on {n}','Each week, the live sport on {n}, with dates and times.','weekly'],
      ['{n} news','Each day, the main stories from {n}’s news, in a few lines.','daily'],
      ['New on {n} streaming','Each week, what is new on {n}’s streaming or catch-up service, with links.','weekly'],
      ['{n} for children','Each week, children’s programs on {n}, with dates and times.','weekly'],
      ['{n} highlights in {c}','Each week, the highlights on {n} in {c}, with dates and times.','weekly','c']],
  radio:[['New from {n}','Each week, new programs and schedule changes on {n} ({s}).','weekly'],
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
       ['{n} network upgrades','Each month, fiber and speed upgrades {n} announces, with the places.','monthly'],
       ['{n} customer service news','Each month, changes to {n}’s customer service, contracts or terms.','monthly']],
  airline:[['{n} fare watch','Each day, check {n} fares from [A] to [B] for [dates] and tell me when the price drops.','daily'],
           ['{n} sales and offers','Each week, new sales and offers {n} announces on {s}, with routes and dates.','weekly'],
           ['{n} strikes and disruption','Each day, any strike, cancellation wave or disruption announced for {n}, and tell me only if there is one.','daily'],
           ['{n} baggage and fee changes','Each month, any change to {n}’s baggage rules or fees published on {s}.','monthly'],
           ['New routes from {n}','Each month, new routes and seasonal flights {n} announces, with start dates.','monthly'],
           ['{n} loyalty program changes','Each month, changes to {n}’s frequent-flyer program - earning, prices in miles, status.','monthly'],
           ['Is {n} on time?','Each month, how punctual {n} has been, from published statistics, with sources.','monthly'],
           ['{n} travel rules','Each week, any change to {n}’s check-in, document or travel rules on {s}.','weekly'],
           ['{n} in the news','Each week, news about {n}, in a few lines with links.','weekly'],
           ['{n} flights from {c}','Each week, {n}’s sales and new routes from {c}, with prices and dates.','weekly','c'],
           ['{n} disruption in {c}','Each day, strikes or cancellations affecting {n} flights in {c}, and tell me only if there is one.','daily','c']],
  airport:[['Delays at {n}','On my travel days, check {n} for delays and cancellations affecting [flight].','daily'],
           ['{n} news for travelers','Each week, closures, works, strikes or rule changes at {n} that affect passengers.','weekly'],
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
          ['{n} loyalty program changes','Each month, changes to {n}’s loyalty program and member offers.','monthly'],
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
               ['{n} loyalty offers','Each week, the offers in {n}’s loyalty program, with their conditions.','weekly'],
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
              ['{n} app offers','Each week, the deals in {n}’s app or loyalty program.','weekly'],
              ['{n} food safety notices','Each month, food-safety notices or recalls involving {n}, and tell me only if there is one.','monthly'],
              ['{n} in {c}','Each month, new {n} restaurants and offers in {c}.','monthly','c']],
  hotel:[['{n} price watch','Each day, check {n} prices in [city] for [dates] and tell me when they fall.','daily'],
         ['{n} sales','Each week, sales and member offers {n} announces on {s}.','weekly'],
         ['{n} loyalty changes','Each month, changes to {n}’s loyalty program - points, prices in points, status.','monthly'],
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
           ['Scholarships from {n}','Each month, scholarships and exchange programs announced by {n}, with deadlines.','monthly'],
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
            ['Vaccination and screening at {n}','Each month, vaccination and screening programs at {n}, with how to book.','monthly'],
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
            ['Conferences at {n}','Each month, conferences and workshops {n} organizes, with dates.','monthly'],
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
  school:[['{n} deadline watch','Watch {s} for enrollment dates, term dates and closures at {n}, and remind me a week before each.','weekly'],
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
       ['School visits to {n}','Each month, school visits and education programs at {n}.','monthly']],
  brewery:[['New from {n}','Each month, new releases, tours and events from {n} ({s}).','monthly'],
           ['Tours at {n}','Each month, tours and tastings at {n}, with how to book.','monthly'],
           ['{n} awards','Each month, awards won by {n}’s beers.','monthly'],
           ['{n} in the news','Each month, news about {n}, in a few lines with links.','monthly']],
  jobsite:[['New jobs on {n}','Each day, new [role] postings on {n} in [location], with links.','daily'],
           ['Remote jobs on {n}','Each day, new remote [role] postings on {n}, with links.','daily'],
           ['Internships on {n}','Each week, new internships and graduate roles on {n} in [field], with links.','weekly'],
           ['Jobs on {n} in {c}','Each day, new [role] postings on {n} in {c}, with links.','daily','c']],
  employer:[['New jobs at {n}','Each day, new [role] openings at {n} in [location], with links.','daily'],
            ['{n} in the news','Each week, news about {n} - results, layoffs, hiring - in a few lines.','weekly'],
            ['{n} as an employer','Each month, what current and former employees say about working at {n}, from public reviews, in a few lines.','monthly'],
            ['Internships at {n}','Each month, internship and graduate programs at {n}, with deadlines.','monthly'],
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
           ['{n} strikes and labor news','Each month, strikes, union disputes and labor news at {n}, with sources.','monthly'],
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
  CN: /(^|\.)(google|youtube|gmail|blogspot|facebook|instagram|whatsapp|twitter|x|wikipedia|telegram|line|dropbox|nytimes|bbc|reuters|bloomberg|wsj|tiktok|reddit)\.[a-z.]+$|(^|\.)[a-z]+\.google$/,
  RU: /(^|\.)(facebook|instagram|twitter|x|linkedin)\.[a-z.]+$/,
  IN: /(^|\.)tiktok\.[a-z.]+$/,
};
/* An entry as the page accepts it, from any data file: a real Wikidata ID,
   a plain one-line name and a bare host - the source is editable by anybody,
   a name reaches an instruction and a site is where somebody signs in. */
/* Adult sites are never listed, however visited (owner, Nov 27): xHamster
   was filed as a company in 104 countries, so "Jobs at xHamster" sat in the
   United States' Work & career. The same list as data/not-listed.json, which
   the data scripts drop them by (the-catalogue-lists-no-adult-sites). */
const CC_NOT_LISTED_HOSTS = new Set(["xhamster.com", "camsoda.com", "cam4.com", "private.com", "balancetanude.fr", "lovehoney.com", "lovehoney.com.au", "lovehoney.co.uk", "lovehoney.eu", "lovehoney.co.nz", "ashleymadison.com", "eroticcity.cz", "orion.de", "fleshlight.com"]);
const CC_NOT_LISTED = /porn|xvideos|xnxx|xhamster|chaturbate|stripchat|bongacams|livejasmin|onlyfans|fansly|brazzers|camsoda|redtube|youporn|spankbang|hentai|adultfriendfinder/i;
function _ccListed(s){ s = String(s || '').toLowerCase().replace(/^www\./, ''); return !CC_NOT_LISTED_HOSTS.has(s) && !CC_NOT_LISTED.test(s); }
function _ccGood(e){
  return !!e && /^Q\d{1,12}$/.test(e.q) && _ccListed(e.s) && typeof e.n === 'string' && e.n.length >= 2 && e.n.length <= 90
    && !/[\u0000-\u001f\u007f<>{}\[\]`]|https?:|www\./i.test(e.n)
    && typeof e.s === 'string' && e.s.length <= 80 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(e.s);
}
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
      const good = e => _ccGood(e) && !(blocked && blocked.test(String(e.s || '')));
      const kinds = {};
      for(const [k, list] of Object.entries(d.kinds)) if(CC_KINDS[k] && Array.isArray(list)){ const ok = list.filter(good); if(ok.length) kinds[k] = ok; }
      /* A chain filed under the wrong kind is moved to the one it is (Nov 27):
         Wikidata's retail chains include Pizza Hut and AMC Theatres, so
         Shopping offered "Best price at Pizza Hut". Moved, in their order, to
         the end of the kind that fits, where its tasks are about a menu or a
         show. */
      for(const [to, re] of CC_REFILE){
        const from = kinds.retail; if(!from) break;
        const moved = from.filter(e => re.test(e.n)); if(!moved.length) continue;
        kinds.retail = from.filter(e => !re.test(e.n)); kinds[to] = (kinds[to] || []).concat(moved);
        if(!kinds.retail.length) delete kinds.retail;
      }
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
/* "an" before a vowel SOUND: "an IKEA", but "a United Airlines flight", "a
   Europcar", "a One" - a "you" or "w" sound takes "a" (seen in the United
   States' Popular tasks, Nov 25). */
const _ccVowel = (n) => /^[aeiou]/i.test(n) && !/^(u[nst]i|u[rs][aeu]|uber|euro?|eu[^r]|one\b|once)/i.test(n);
const _ccAn = (t, e) => _ccVowel(e.n) ? String(t).replace(/\b([Aa]) \{n\}/g, '$1n {n}') : String(t);
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
   it did. Jobs and tasks follow their services, ranked first by what each
   is for (_ccByUse, Nov 27) and then in this order. What people in the country actually switch on reorders Crew on
   top of this (crew-view.js, _cjList). */
function _ccByPop(d){
  const out = [];
  for(const [kind, list] of Object.entries((d && d.kinds) || {})) (list || []).forEach((e, i) => out.push({ kind, e, i }));
  /* Inside a bucket (owner, Nov 25): "Open an account at M&T Bank" led the
     United States, because the country's-own rule put every service listed
     in fewer than three countries first - and Bank of America (in 23
     countries' data) and Chase (6) are not "the world's", they are the
     country's biggest. So the better known goes first (Wikipedia editions,
     w), leaning toward the country's own by how widely it is listed (w over
     the fourth root of x): El País stays ahead of the New York Times in
     Spain, and Wells Fargo, Citi and Bank of America ahead of M&T. The
     square root it was until Nov 26 sank Bank of America below USAA and M&T
     once the visit ranking listed it in 33 countries - it is visited from
     abroad, which makes it no less the United States' own. */
  const R = x => (+x.e.r > 0 ? +x.e.r : 1e9), K = x => (+x.e.w || 0) / Math.pow(Math.max(1, +x.e.x || 1), 0.25);
  return out.sort((a, b) => (R(a) - R(b)) || (K(b) - K(a)) || (a.i - b.i) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
}
/* THE USEFUL FIRST (Nov 27), now for Crew's jobs: Tasks name no service
   since Nov 28 (ccLeads), so the per-service task tiers that ranked "Find
   jobs on LinkedIn" above "Complain to Tesla" went with them. */
/* Kinds a section lists without being for them: a company is in Work &
   career because it employs people, not because anybody goes there to work
   on their career. */
const CC_KIND_SIDE = new Set(['company', 'software', 'pharma', 'research', 'publisher', 'brewery', 'union']);
/* Retail chains that are restaurants or cinemas, by name (see ccLoad). */
const CC_REFILE = [
  ['restaurant', /pizza|burger|chicken|taco\b|donut|doughnut|starbucks|mcdonald|\bkfc\b|subway|domino|wendy|dunkin|chipotle|popeyes|panera|arby|little caesars|papa john|chick-fil-a|denny|ihop|olive garden|applebee|buffalo wild|five guys|krispy kreme|tim hortons|nando|greggs|pret a manger|costa coffee|\bcaf[eé]\b|coffee/i],
  ['theatre', /theatres?\b|cinemas?\b|cineplex|cinemark|multiplex/i],
];
/* Entries of a kind a section is for that it is NOT for by what they are: a
   cargo carrier among airlines (nobody books a UPS flight), a space agency or
   an archive among the offices people deal with, a prison's medical centre
   among hospitals. They follow the rest of their section, like a company. */
const CC_SIDE_NAME = {
  airline: /cargo|\bUPS\b|fedex|\bDHL\b|atlas air|kalitta|polar air|aerologic|\bABX\b|western global/i,
  agency: /aeronautic|\bspace\b|librar|archive|\bmint\b|cabinet|tsunami|hurricane|weather|meteorolog|geolog|survey|statistic|observator|laborator|research|ranger|national guard|\barmy\b|\bnavy\b|air force|marine corps|intelligence|census|museum|smithsonian|national park|parque nacional|parc national|nationalpark|wetter/i,
  ministry: /defen[cs]e|\barmy\b|\bnavy\b|air force|intelligence|cabinet/i,
  hospital: /prison|correctional|federal prisoners|veterinar|museum|museo|museu|mus[eé]e|research cent/i,
};
const _ccSide = (x) => CC_KIND_SIDE.has(x.kind) || !!(CC_SIDE_NAME[x.kind] && CC_SIDE_NAME[x.kind].test(x.e.n));
/* A site on another country's own domain (avito.ru, kleinanzeigen.de listed
   for the United States): real visits from people there, not where the
   country goes. The same test Integrations' Jobs uses (_ccJobsOrder). */
function _ccAbroad(e, cc){
  const s = String((e && e.s) || '').toLowerCase(), tld = cc === 'GB' ? 'uk' : String(cc || '').toLowerCase();
  return /\.[a-z]{2}$/.test(s) && !(tld && s.endsWith('.' + tld)) && !/\.(co|io|me|tv|ai)$/.test(s);
}
/* Crew's jobs, the same way (Nov 27, the owner: "I bet it's the same with
   crew"): it was - "National Football League outages", "National Hockey
   League recalls and safety notices" and "Reuters price changes" opened Work
   & career. A kind's first job is the one it is for (a fare watch, a rate
   change, new jobs, a morning brief); watching a company's news, results,
   leadership, patents or share price is for the few who follow that company,
   and goes after everything people use. */
const CC_CREW_ABOUT = /in the news|\bnews\b|\bresults\b|leadership|patents|share price|shareholder|credit rating|acquisitions|sustainability|supply news|competitors|legal and regulatory|customer reviews|ratings and reviews|at a glance|strikes and labor|privacy and terms|as an employer|investigations|opinion|data breaches/i;
function _ccCrewTier(kind, title, j){
  if(CC_CREW_ABOUT.test(title)) return 3;
  return j === 0 ? 1 : 2;
}
function _ccByUse(d, TPL, make, tierOf){
  const ents = _ccByPop(d).filter(x => TPL[x.kind] && TPL[x.kind].length);
  const cc = String((d && d.cc) || '').toUpperCase();
  const rows = [];
  ents.forEach((x, r) => {
    /* A job site leads from the country's 5,000 most visited (Integrations'
       line, _ccJobsOrder); one less visited follows the section's own kinds,
       and one on another country's domain goes after everything. Either way
       its tasks drop a tier: "Find jobs on" a site few people there use is
       not worth more than an interview at a company they do. */
    const abroad = _ccAbroad(x.e, cc);
    const kw = abroad ? 4 : x.kind === 'jobsite' ? ((+x.e.r > 0 && +x.e.r <= 5000) ? 0 : 3) : _ccSide(x) ? 2 : 1;
    const byT = new Map();
    /* A complaint is last whatever else drops a tier. */
    TPL[x.kind].forEach((t, j) => { const base = tierOf(x.kind, t[0], j), k = base >= 4 ? 9 : base + (kw >= 3 ? 1 : 0); if(!byT.has(k)) byT.set(k, []); byT.get(k).push(j); });
    /* Each service's tasks of one tier in their written order - the first
       is the one the kind is for ("Find jobs on", "Open an account at"). */
    for(const [k, js] of byT) js.forEach((j, p) => rows.push([k, kw, p, r, x, j]));
  });
  rows.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]) || (a[3] - b[3]));
  return rows.map(z => make(z[4].kind, z[4].e, z[5]));
}
/* A task opens chat with the service's name and the site the row shows under
   it - so AMV starts where the person was told it would. Half the task
   templates never named the site; it is added to those, never twice. */
/* EACH SECTION OPENS WITH WHAT PEOPLE MOST OFTEN WANT TO DO (owner, Nov 25:
   "for money, the most popular is not 'open an account at M&T' - it is
   compare savings rates, lower my loan interest, transfer fees...").

   A section used to be the country's services in visit order, one template
   each, so it opened with whichever bank happened to sort first. Now each
   opens with the everyday tasks below, in the order the largest published
   study of assistant use ranks what people ask for - practical guidance
   first, then looking up specific information, then writing (NBER working
   paper 34255, Sept 2025; docs/RESEARCH.md). Each
   is filled with the country's MOST VISITED services of the right kind
   ({n} the first, {top} the first three), so the same task names Chase in
   the United States and Santander in Spain. The service-by-service tasks
   follow, most visited first. [kind, title, prompt] - the kind decides the
   section; a country with no service of that kind lends one from the same
   section, and a section with none drops the task. */
const CC_LEADS = [
  ["bank", "Compare savings rates", "Compare the current savings rates at the main banks in {c}, from their official sites. Which pays the most, and on what conditions?"],
  ["bank", "Make me a monthly budget", "Help me make a simple monthly budget. Ask me for my income and regular costs, then lay it out and show where I can save."],
  ["bank", "Pay less interest on a loan or card", "How can I pay less interest on my [loan or credit card] in {c}? Explain my options step by step, from official sources."],
  ["bank", "Send money abroad for less", "What is the cheapest way to send [amount] from {c} to [country]? Compare a transfer from my bank with the main money transfer services, fees and exchange rate included."],
  ["bank", "Check and raise my credit score", "How do I check my credit score in {c} for free, and what raises it fastest?"],
  ["bank", "Pay off my debt faster", "Make me a plan to pay off these debts as fast as possible: [debts, amounts and interest rates]."],
  ["bank", "Explain my bank statement", "Explain my bank statement and flag anything unusual, and any fees I could avoid: [paste or attach]"],
  ["insurer", "Find cheaper insurance", "Compare [car, home or health] insurance from the main insurers in {c}: the price, what is covered and the excess."],
  ["airline", "Find cheap flights", "Find the cheapest way to fly from [city] to [place] around [dates]. Compare the airlines on the total price with bags."],
  ["airline", "Plan a trip, day by day", "Plan a [number]-day trip to [place] for [who]: day by day, with how to get around and roughly what it costs."],
  ["airline", "Entry rules for another country", "What documents, visa and entry rules apply to someone from {c} travelling to [country]? Use official sources and say when they were last updated."],
  ["airline", "My flight was delayed or cancelled", "My [airline] flight was delayed or cancelled. What refund or compensation am I owed, and how do I claim it?"],
  ["hotel", "Find a hotel within my budget", "Find a well-rated hotel in [place] for [dates] under [budget]. Compare the options and where to book each."],
  ["rail", "Train or bus between two cities", "Compare the train and the bus from [city] to [city] in {c}: times, prices and where to book."],
  ["airport", "Get from the airport to the city", "What is the best way to get from [airport] to the city centre in {c}? The options, prices and times."],
  ["airline", "Make a packing list", "Make a packing list for [trip, weather and number of days]."],
  ["ecommerce", "Find the best price for something", "Find the best price for [product] at the main shops in {c}, delivery included."],
  ["ecommerce", "Help me choose what to buy", "Help me choose a [product] for [what I need it for] under [budget]. Compare the best options and say why."],
  ["supermarket", "Plan my weekly groceries", "Plan a week of meals and the shopping list for [number of people] on a budget of [amount], with prices from supermarkets in {c}."],
  ["ecommerce", "Return an order and get a refund", "How do I return my order from [shop] and get my money back? The steps, the deadline and the cost."],
  ["ecommerce", "Is this deal real?", "Is this a good deal, and is the seller trustworthy? [link or details]"],
  ["retail", "Find a gift", "Suggest gift ideas for [person, age and interests] under [budget], with where to buy each in {c}."],
  ["hospital", "What could my symptoms mean?", "I have had [symptoms] since [when]. What could it be, what can I do at home, and when should I see a doctor? I know this is not a diagnosis."],
  ["hospital", "Explain my test results", "Explain these test results in plain words, and what I should ask my doctor: [paste or attach]"],
  ["hospital", "See a doctor in {c}", "How do I book a doctor or specialist appointment in {c}, and what does it cost?"],
  ["pharma", "Check a medicine", "What is [medicine] for, its usual dose and side effects, and does it interact with [other medicines]? From official sources."],
  ["hospital", "Make me a workout plan", "Make me a [number]-week workout plan for [goal], [days] a week, with what I have: [equipment]."],
  ["hospital", "Plan healthy meals", "Plan a week of healthy meals for [goal or diet], with a shopping list."],
  ["newspaper", "Today’s top news in {c}", "Summarize today’s most important news in {c} from its main newspapers, with a link for each story."],
  ["newspaper", "Explain a story simply", "Explain this news story simply: what happened, why it matters and what is disputed. [link or topic]"],
  ["newssite", "This week in the news", "Give me a short summary of this week’s main news in {c} and in the world."],
  ["newspaper", "Follow a topic", "What is the latest on [topic]? Summarize it from several reliable sources and say where they disagree."],
  ["tv", "Fact-check a claim", "Is this true? [claim] Check it against reliable sources and say how sure you are."],
  ["university", "Explain a topic simply", "Explain [topic] simply, with an example, then quiz me with three questions."],
  ["university", "Help me study for an exam", "Make me a study plan for [exam] on [date], and quiz me on [subject]."],
  ["university", "Apply to a university in {c}", "How do I apply to [course] at universities in {c}? The requirements, deadlines and costs."],
  ["university", "Outline my essay", "Help me outline an essay on [topic]: the main argument, the sections and sources to read. Do not write it for me."],
  ["library", "Learn a language", "Teach me [language] for [goal]: a short daily plan and today’s first lesson."],
  ["university", "Find a scholarship", "Find scholarships in {c} for [field and level], with deadlines and links."],
  ["employer", "Improve my CV", "Improve my CV for [role]: stronger wording, a clean layout and anything missing. Here it is: [paste or attach]"],
  ["employer", "Write a cover letter", "Write a cover letter for [role] at [company]. Here are my CV and the advert: [paste]"],
  ["employer", "Prepare for a job interview", "Prepare me for a [role] interview at [company]: likely questions, strong answers and what to ask them."],
  ["company", "Write a professional email", "Write a clear, polite email to [who] about [what]."],
  ["employer", "Ask for a raise", "Help me ask for a raise: what to say, what my role pays in {c}, and how to handle a no."],
  /* On the job sites people there use (LinkedIn, Indeed and Glassdoor in
     the United States; StepStone in Germany), not at named employers. */
  ["jobsite", "Find jobs near me", "Find [role] jobs in [city], {c}, posted in the last two weeks, on the job sites people there use and the employers' own sites."],
  ["telecom", "Lower my phone bill", "How can I pay less for my phone? Compare plans from the main mobile networks in {c} for [how I use it]."],
  ["utility", "Cut my energy bill", "How can I lower my electricity and gas bill in {c}? Compare the suppliers, and give me quick savings at home."],
  ["isp", "Compare internet plans", "Compare home internet plans from the main providers in {c} for [area and usage]: speed, price and contract length."],
  ["utility", "Fix something at home", "Help me fix [problem] at home, step by step, and tell me when to call a professional."],
  ["carmaker", "Choose a car", "Help me choose a car for [needs] under [budget] in {c}: new or used, and what it costs to run."],
  ["telecom", "Cancel or switch a contract", "How do I cancel or switch my [provider] contract in {c}, and what notice or fees apply?"],
  ["agency", "Renew my passport", "How do I renew my passport in {c}? The documents, cost, how long it takes and where to apply."],
  ["agency", "File my taxes", "Help me file my taxes in {c} as [situation]: deadlines, forms and what I can claim. Official sources only."],
  ["agency", "Get or renew a driving licence", "How do I get or renew a driving licence in {c}? The steps, documents and cost."],
  ["agency", "Benefits I may be able to get", "Which government benefits or support can I get in {c} as [situation], and how do I apply?"],
  ["embassy", "Get a visa", "How do I get a visa for [country] from {c}? The documents, fees, waiting time and where to apply."],
  ["agency", "Fill in an official form", "Help me fill in this official form correctly: [form or link]"],
  ["museum", "What to do this weekend", "What is on this weekend in [city], {c}? Events, shows and free things to do."],
  ["theatre", "Find tickets for a show", "Find tickets for [show or event] in [city]: the best price and seats."],
  /* No club is named: the data has clubs of some sports only, by site visits,
     so it cannot say whose team somebody follows (it gave the United States
     a football club and Pakistan, a cricket country, another). */
  ["sportsclub", "When my team plays next", "When and where does [my team] play next, and how do I get tickets? Use the team's or the league's official site."],
  ["park", "Plan a day out", "Plan a day out in [place] for [who]: what to see, where to eat and how to get there."],
  ["museum", "Find a museum or exhibition", "Which museums or exhibitions in [city], {c}, are worth it right now? Prices and opening hours."],
  ["festival", "Festivals coming up", "Which festivals are coming up in {c} in the next few months, and how do I get tickets?"],
  /* WHAT THE COMPANY-BY-COMPANY TASKS DID, SAID ONCE (Nov 28). Tasks used to
     list each of these once per company ("Open an account at Wells Fargo",
     "Jobs at adidas"), so the page named a site on every row - and the wrong
     one often enough that the owner asked for every name to go: "it just
     generates a text, goes to a new chat and puts the text down". Each is
     now the thing itself, once, about the country. */
  ["bank", "Open a bank account", "What do I need to open a bank account in {c}? Compare the main banks on documents, fees and the steps, from their official sites."],
  ["bank", "Avoid bank fees", "Which current account fees are usual in {c}, and how can I avoid them?"],
  ["bank", "Dispute a card charge", "Help me dispute a charge of [amount] from [merchant] on my card. Draft the message to my bank; do not send it."],
  ["insurer", "Make an insurance claim", "Help me make a claim on my [type] insurance for [what happened] in {c}: the steps, what to include and the deadlines."],
  ["insurer", "What my insurance covers", "Explain what this insurance policy covers and excludes, in plain words: [paste or attach]"],
  ["insurer", "Cancel an insurance policy", "How do I cancel my [type] insurance policy in {c}, and what notice or fees apply?"],
  ["university", "University entry requirements", "What are the entry requirements for [course] at universities in {c}?"],
  ["university", "University application deadlines", "When are this year’s application deadlines for [course] at universities in {c}?"],
  ["tv", "What is on TV tonight", "What is worth watching on TV in {c} tonight? A short list by channel and time."],
  ["radio", "Find a podcast or radio show", "Suggest radio shows or podcasts in {c} about [topic], and where to listen."],
  ["telecom", "Fix a phone or internet problem", "Help me fix this problem with my phone or internet: [problem]. Step by step, and when to call my provider."],
  ["telecom", "Best mobile coverage where I live", "Which mobile network has the best coverage in [area], {c}?"],
  ["airline", "Baggage rules for my flight", "What are the baggage rules and fees for my flight with [airline] in [class]?"],
  ["airline", "Check in for a flight", "How and when do I check in for my [airline] flight, and what do I need at the airport?"],
  ["airport", "Is my flight on time?", "Is flight [number] on time today? Check the airport’s arrivals and departures."],
  ["rail", "Rail passes and discounts", "Which rail passes or discount cards in {c} would save me money for [how I travel]?"],
  ["rail", "Refund for a delayed train or bus", "How do I get a refund or compensation in {c} for a [train or bus] ticket that was delayed or cancelled?"],
  ["ecommerce", "Track an order", "Where is my order from [shop]? Help me track it with [tracking number], and what to do if it is late."],
  ["supermarket", "This week’s best offers", "What are the best supermarket offers in {c} this week on [things I buy]?"],
  ["restaurant", "Find a restaurant", "Find a good restaurant in [area], {c}, for [occasion] under [budget], with what to order."],
  ["restaurant", "Check a menu for allergens", "Which dishes at [restaurant] are safe for [allergy or diet]? Check its official menu."],
  ["hotel", "Cancel a booking for free", "What is the cancellation policy of my booking at [hotel or site], and how do I cancel without paying?"],
  ["agency", "Contact a government office", "How do I contact [government office] in {c} about [what], and what should I have ready?"],
  ["utility", "Understand my energy bill", "Explain this energy bill in plain words and check it for mistakes: [paste or attach]"],
  ["utility", "Report a power or water cut", "How do I report a [power, water or gas] cut at [address] in {c}, and when will it be fixed?"],
  ["carmaker", "Check my car for recalls", "Is my [make, model and year] affected by any recall in {c}, and what do I do?"],
  ["carmaker", "Car service: when and how much", "When does my [car] need its next service, and roughly what will it cost in {c}?"],
  ["library", "Borrow books and e-books free", "How do I join a public library in {c} and borrow e-books for free?"],
  ["jobsite", "Make my job profile stand out", "Improve my profile on a job site for [role]: headline, summary and skills, from what I paste."],
  ["employer", "Research a company before applying", "Tell me about [company] before I apply: what it does, its culture, salaries and recent news."],
  ["school", "Enrol my child in a school", "How do I enrol my child in a school in [area], {c}? The steps, documents and deadlines."],
  ["school", "School term dates and holidays", "What are this year’s school term dates and holidays in [region], {c}?"],
  ["software", "Get help with an app", "Help me with this problem in [app]: [problem]. Step by step."],
  ["nonprofit", "Volunteer near me", "Where can I volunteer in [city], {c}, for [cause], and how do I sign up?"],
  ["nonprofit", "Donate to a good charity", "Which charities in {c} working on [cause] use donations well, and is my donation tax-deductible?"],
  ["embassy", "Book an embassy appointment", "How do I book an appointment at the [country] embassy or consulate in {c}, and what do I bring?"],
  ["union", "Know my rights at work", "What are my rights at work in {c} about [issue], and who can help me? Official sources."],
  ["company", "Complain about a company", "Help me write a complaint to [company] about [problem], and where to escalate it in {c} if they do not answer."],
  ["stadium", "Get to a stadium or venue", "What is the best way to get to [venue] in [city] for [event], and when should I leave?"],
  ["zoo", "Plan a visit to a zoo or park", "Plan a visit to [zoo or park] in {c} for [who]: tickets, opening hours and what not to miss."]
];
/* THE COUNTRY'S TASKS, EACH ONCE, NAMING NO COMPANY (Nov 28, the owner:
   "remove where it's from, and say what it is - 'compare saving rates' does
   not have to say Wells Fargo, 'improve my CV' should not say adidas.com").

   A task is text put into a new chat; it does not run on a site. The page
   printed the first service of the task's kind under it - an employer for
   "Improve my CV", a social network for "Write a professional email" - so
   the row read as a claim about a company that it never made, and was wrong
   as often as the data's guess at a kind. Now a row is the task itself.

   A task is listed when the country has services of its kind, or of its
   category (a country with no airline in the data still has flights), so
   the list stays the country's - only the company names are gone. */
function ccLeads(d){
  const have = new Set(), cats = new Set();
  const cat = k => (typeof CJ_KIND_CAT !== 'undefined' && CJ_KIND_CAT[k]) || '';
  _ccByPop(d).forEach(x => { have.add(x.kind); if(cat(x.kind)) cats.add(cat(x.kind)); });
  const out = [];
  CC_LEADS.forEach(([kind, title, prompt], i) => {
    if(!have.has(kind) && !(cat(kind) && cats.has(cat(kind)))) return;
    const tr = T(title);
    /* The country is in the id: one prompt per country, so an answer that
       arrives for the country somebody just left cannot replace this one's
       (Build 19 audit NEW-07). */
    out.push({ id:'cl-' + d.cc + '-' + i, kind, lead:true, tpl:title,
      title:tr.replace(/\{c\}/g, () => _ccPlace(d.cc, tr === title)),
      prompt:prompt.replace(/\{c\}/g, () => _ccPlace(d.cc, true)) });
  });
  return out;
}
function ccTasks(d){ return ccLeads(d); }
/* TASKS' POPULAR: WHAT PEOPLE DO EVERY DAY (Nov 23). The owner, of Popular:
   "make them things people can do every day ... this applies to all
   countries". The fifty most visited services in the country, of the kinds
   people use day to day (news, their bank, phone and internet, shopping,
   food, travel, bills, sport, work) - each once, with the task they would
   actually do there, never an agency's forms or an embassy's contact page.
   One per brand: a chain's hotels or a league's clubs share the brand's
   visits, so only its first is listed. */
function _ccBrand(host){
  const l = String(host).split('.');
  const shared = /^(bank|gov|nic|ac|co|com|org|net|edu|gob|go|or|ne)$/;
  return (l.length >= 3 && shared.test(l[l.length - 2]) ? l.slice(-3) : l.slice(-2)).join('.');
}
/* Popular takes turns across the everyday areas, in the order the note
   above gives them - news, the bank, phone and internet, shopping, food,
   travel, bills, sport, work - each turn taking that area's most
   visited service not yet listed (Nov 25, owner: "all the most popular, no
   irrelevant ones"). By visits alone almost every candidate sits in the same
   band of the report, so the order inside it decided everything, and fame
   decided it for the world: the BBC, the New York Times and CNN opened
   Spain, Mexico and Nigeria, while ranking for the country's own instead
   opened the United States with three pizza chains. Taking turns puts a
   bank, a shop and a way to travel in the first ten everywhere. */
const CC_POP_AREAS = [['newspaper', 'newssite', 'tv', 'radio'], ['bank'], ['telecom', 'isp'], ['supermarket', 'retail', 'ecommerce', 'mall'],
  ['restaurant'], ['airline', 'rail', 'bus', 'airport', 'hotel'], ['utility', 'insurer'], ['sportsclub', 'stadium'],
  /* Work takes the CV, the cover letter and the interview with the job
     sites (Nov 28): they are what people do there, and named no company. */
  ['jobsite', 'employer'], ['hospital', 'pharma']];
function ccTasksPopular(d, all){
  /* The same turns across the everyday areas as before, each turn now
     taking that area's next task. Inside an area the kinds people in the
     country visit most come first (the Chrome UX Report rank of the kind's
     best-visited service there), then the written order - so the United
     States opens its money turn on what its banks are visited for, and a
     country whose data has no airline still gets flights in its travel turn. */
  const rank = {}; _ccByPop(d).forEach((x, k) => { if(!(x.kind in rank)) rank[x.kind] = k; });
  const R = t => (t.kind in rank ? rank[t.kind] : 1e9);
  const queues = CC_POP_AREAS.map(kinds => (all || []).map((t, i) => [t, i]).filter(z => kinds.indexOf(z[0].kind) >= 0)
    .sort((a, b) => (R(a[0]) - R(b[0])) || (a[1] - b[1])).map(z => z[0]));
  const out = [], at = queues.map(() => 0);
  for(let more = true; more && out.length < 50;){
    more = false;
    for(let q = 0; q < queues.length && out.length < 50; q++) if(at[q] < queues[q].length){ out.push(queues[q][at[q]++]); more = true; }
  }
  return out;
}
function ccJobs(d){
  return _ccByUse(d, CC_CREW, (kind, e, i) => { const t = CC_CREW[kind][i];
    return { id:_ccJobId(kind, e, i, d.cc), kind, e, i, title:_ccTitle(t[0], e, d.cc), prompt:_ccFill(t[1], e, true, d.cc), every:t[2], ...(_ccEvening(t[1]) ? { hour: 18 } : {}) }; }, _ccCrewTier);
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
  const t = !m.visits ? T('There is no visit data for {0}, so this list is in the catalog’s own order - not a measure of what is popular.')
    : crew === 'counted' ? T('Jobs picked for {0} and the ones people there switch on most in AMV come first; the rest by visits from {0} to each service (Chrome UX Report, {1}).')
    : crew ? T('Jobs picked for {0} come first; the rest by visits from {0} to each service (Chrome UX Report, {1}) - not by how often a job is run in AMV.')
    : T('Everyday tasks, taking turns across the parts of life; in each, what people in {0} visit most comes first (Chrome UX Report, {1}) - not how often a task is run in AMV.');
  return t.split('{0}').join(place).replace('{1}', m.month);
}
try{ window.ccPopularNote = ccPopularNote; window.ccMeasure = ccMeasure; window.ccLoad = ccLoad; window.ccTasks = ccTasks; window.ccLeads = ccLeads; window.ccJobs = ccJobs; window.ccServices = ccServices; }catch(e){}

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
    /* In the order of what each job is for, the same as ccJobs (Nov 27). */
    const order = _ccByUse(d, CC_CREW, (kind, e, i) => [kind, e, i], _ccCrewTier), out = [];
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
/* "Every evening" opens at 18:00 (Build 17 audit B17-033). This file is
   fetched on its own, so it does not lean on the page's helper. */
function _ccEvening(s){ return /^(Each|Every) evening\b|\btonight\b/i.test(String(s || '')); }
/* The account that makes a catalogue job about the person (see CW_CONNECTS
   in 10a-job-needs.js): optional, beside the web it always works from. */
const CC_KIND_CONNECTS = { bank:'Bank connection', insurer:'Email', university:'Classroom, Email', college:'Classroom, Email',
  school:'Classroom, Email', library:'Email', telecom:'Email', isp:'Email', utility:'Email', airline:'Calendar', airport:'Calendar',
  rail:'Calendar', bus:'Calendar', hotel:'Calendar', hospital:'Calendar', agency:'Email, Calendar', ministry:'Email, Calendar',
  embassy:'Email, Calendar', employer:'Email', theatre:'Calendar', stadium:'Calendar', festival:'Calendar', sportsclub:'Calendar',
  museum:'Calendar', ecommerce:'Email', retail:'Email' };
function ccCrewJob(kind, e, i, cc){
  const t = CC_CREW[kind][i], prompt = _ccFill(t[1], e, true, cc);
  return {
    asks: _ccAsks(prompt),
    id: _ccJobId(kind, e, i, cc), icon: (CC_KINDS[kind] || ['\u2022'])[0], title: _ccTitle(t[0], e, cc),
    desc: prompt.replace(/\[([^\]]*)\]/g, '$1'), prompt, every: t[2], ...(_ccEvening(t[1]) ? { hour: 18 } : {}),
    needs: 'Web research', cat: (CC_KINDS[kind] || ['', ''])[1], kind: 'research', ccKind: kind, site: e.s, src: e.q,
    ...(CC_KIND_CONNECTS[kind] ? { boost: CC_KIND_CONNECTS[kind] } : {}),
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
  employer:'jobs', company:'jobs', jobsite:'jobs', software:'work', nonprofit:'home',
  agency:'gov', ministry:'gov', embassy:'gov', union:'gov',
  museum:'out', theatre:'out', stadium:'out', sportsclub:'out', park:'out', zoo:'out', festival:'out', brewery:'out',
};
const CC_EXTRA_TOPICS = { gov:'Government & paperwork', out:'Going out' };
/* THE ROWS A BUTTON CAN NAME, by Wikidata id AND site (Nov 28, Build 19 audit
   NEW-06). By id alone, the first country to draw a service kept it: after
   moving from the United States to the United Kingdom, The Independent's
   button still opened the American site. The same organisation in two
   countries is two rows, each with its own site. */
const _ccSvc = Object.create(null);
const _ccSvcKey = (x) => String(x.e.q) + '|' + String(x.e.s);
function _ccRegisterService(x){ const k = _ccSvcKey(x); _ccSvc[k] = x; return k; }
/* THE SERVICES USED IN EVERY COUNTRY (Nov 23). The owner: "integrations
   should have a minimum of 200 per section - email, calendar, all these
   sections - for all countries". A country's file holds what is filed under
   that country; the email providers, messaging apps, file stores and the
   rest that every country uses are filed under none. global-services.json
   (built from data/global, scripts/global-services.mjs) holds those per
   topic, most-covered first, and each topic lists them after the country's
   own. Fetched once, checked entry by entry like the country files; a
   failed fetch is tried again next time. */
let _ccGlobalP = null;
function ccGlobalLoad(){
  if(_ccGlobalP) return _ccGlobalP;
  _ccGlobalP = fetch('global-services.json', { cache: 'force-cache' }).then(r => r.ok ? r.json() : null).then(d => {
    if(!d || !Array.isArray(d.entries) || !d.topics || typeof d.topics !== 'object') throw new Error('no worldwide services');
    /* One table of [id, name, site]; each topic lists positions in it. */
    const ok = d.entries.map(x => Array.isArray(x) && _ccGood({ q: x[0], n: x[1], s: x[2] }) ? { q: x[0], n: x[1], s: x[2] } : null);
    const by = {};
    for(const [t, list] of Object.entries(d.topics)){
      if(!/^[a-z]{2,12}$/.test(t) || !Array.isArray(list)) continue;
      const rows = [];
      for(const i of list){ const e = Number.isInteger(i) ? ok[i] : null; if(e) rows.push({ kind: 'global', topic: t, e, i }); }
      if(rows.length) by[t] = rows;
    }
    /* Visits, one character per entry, to order them where the visitor is. */
    const r = d.reach;
    if(r && typeof r.g === 'string' && r.g.length === d.entries.length && /^[0-7]*$/.test(r.g)) _ccGlobalReach = { g: r.g, n: d.entries.length };
    /* The international news outlets (scripts/global-services.mjs, worldNews). */
    _ccWorldNews = new Set((Array.isArray(d.worldNews) ? d.worldNews : []).map(i => Number.isInteger(i) && ok[i] ? ok[i].s : '').filter(Boolean));
    _ccGlobalDone = by;
    return by;
  }).catch(() => { _ccGlobalP = null; return null; });
  return _ccGlobalP;
}
/* One country's visits to the worldwide services (global-reach/<CC>.json,
   about 1KB): a character per measured host, 1 for the top 1,000 sites
   visited from there to 7 for the top million, 0 for not in the list. */
let _ccGlobalReach = null, _ccGlobalDone = null, _ccWorldNews = new Set();
const _ccGlobalHere = {}, _ccHereDone = {};
function ccGlobalHereLoad(cc){
  if(!/^[A-Z]{2}$/.test(String(cc || ''))) return Promise.resolve(null);
  if(_ccGlobalHere[cc]) return _ccGlobalHere[cc];
  _ccGlobalHere[cc] = fetch('global-reach/' + cc + '.json', { cache: 'force-cache' }).then(r => r.ok ? r.json() : null).then(d => {
    if(!d || typeof d.codes !== 'string' || !/^[0-7]*$/.test(d.codes)) return null;
    /* And the services Crew's jobs there name (scripts/global-services.mjs):
       [id, name, site, topic, fact], each checked like any other entry. */
    const crew = [];
    for(const x of Array.isArray(d.crew) ? d.crew : []){
      if(!Array.isArray(x) || !/^[a-z]{2,12}$/.test(String(x[3])) || !/^[a-z]{2,8}$/.test(String(x[4]))) continue;
      const e = { q: x[0], n: x[1], s: x[2] }; if(!_ccGood(e)) continue;
      if(Number.isInteger(x[5]) && x[5] > 0 && x[5] <= 1000000) e.r = x[5];
      const f = x[4], topic = x[3];
      crew.push({ kind: (f === 'banks' || f === 'cards') ? 'bank' : (topic === 'money' ? 'global' : 'crew'), topic, f, e });
    }
    const here = { codes: d.codes, crew };
    _ccHereDone[cc] = here;
    return here;
  }).catch(() => { delete _ccGlobalHere[cc]; return null; });
  return _ccGlobalHere[cc];
}
/* Most visited from the visitor's country first, then most visited
   worldwide, then the rest in the file's order (Wikipedia coverage). */
function _ccGlobalOrder(rows, here){
  const R = _ccGlobalReach; if(!R) return rows;
  const codes = here && here.codes;
  const okHere = typeof codes === 'string' && codes.length === R.n;
  const key = (x) => { const i = x.i; if(i == null) return 99; const h = okHere ? +codes[i] : 0; if(h) return h; const w = +R.g[i]; return w ? 7 + w : 99; };
  return rows.map((x, i) => [key(x), i, x]).sort((a, b) => (a[0] - b[0]) || (a[1] - b[1])).map(z => z[2]);
}
/* A service's one action. A bank is never opened in AMV's browser, where a
   signed-in session could move money: Link is the read-only connection -
   balances and transactions, never a payment. A worldwide money service
   (a neobank, an exchange, a payment provider) has no read-only connection
   here, so it opens in the person's own browser, where AMV acts on nothing. */
function _ccAct(x){
  if(x.kind === 'bank') return `<button class="btn bs cc-use" type="button" data-dact="openBankLink">${escH(T('Link'))}</button>`;
  if(x.kind === 'global' && x.topic === 'money') return `<a class="btn bs cc-use" href="https://${escH(x.e.s)}/" target="_blank" rel="noopener noreferrer">${escH(T('Open'))}</a>`;
  /* "Ask AMV", not "Use" (Build 19 audit B19-R-07, NEW-08): the button opens a
     new chat with a request drafted for AMV's browser - it connects nothing
     and runs nothing until the person sends it. */
  return `<button class="btn bs cc-use" type="button" data-dact="ccUseService" data-darg="${escH(_ccRegisterService(x))}">${escH(T('Ask AMV'))}</button>`;
}
/* A Crew-named service's icon is its fact's kind of thing. */
const CC_FACT_KIND = { banks: 'bank', cards: 'bank', pay: 'bank', jobs: 'employer', shop: 'retail', groc: 'supermarket', food: 'restaurant',
  rail: 'rail', prop: 'utility', telco: 'telecom', post: 'agency', news: 'newssite', health: 'hospital', gov: 'agency', tax: 'agency', id: 'agency', car: 'agency', uni: 'university' };
/* Drawn in the same frame as the screen when everything is already here
   (fetched while the app was idle): no topic grows after it appears. Says
   whether it drew; the screen falls back to ccFillIntegrations otherwise. */
/* One topic's country services, into its section - for See the remaining,
   which opens one topic in place instead of drawing the page again. */
function ccFillTopicNow(sec, topic){
  const cc = (typeof _cwCountryGuess === 'function') ? String(_cwCountryGuess() || '').toUpperCase() : '';
  const d = _ccDone[cc]; if(!d || !_ccGlobalDone || !sec) return false;
  const here = _ccHereDone[cc] || null;
  const by = (_ccByMemo && _ccByMemo.d === d && _ccByMemo.g === _ccGlobalDone && _ccByMemo.here === here) ? _ccByMemo.by
    : (_ccByMemo = { d, g: _ccGlobalDone, here, by: _ccFillBy(d, _ccGlobalDone, here) }).by;
  if(by[topic] && sec.parentNode) _ccFillDraw(sec.parentNode, { [topic]: by[topic] });
  return true;
}
try{ window.ccFillTopicNow = ccFillTopicNow; }catch(e){}
function ccFillIntegrationsNow(){
  const root = document.getElementById('int-catalog'); if(!root) return false;
  const cc = (typeof _cwCountryGuess === 'function') ? _cwCountryGuess() : '';
  const d = _ccDone[String(cc || '').toUpperCase()];
  if(!d || !_ccGlobalDone) return false;
  _ccFillWith(root, d, _ccGlobalDone, _ccHereDone[String(cc || '').toUpperCase()] || null);
  return true;
}
async function ccFillIntegrations(){
  const root = document.getElementById('int-catalog'); if(!root) return;
  const cc = (typeof _cwCountryGuess === 'function') ? _cwCountryGuess() : '';
  /* The country's own rows are drawn as soon as its file arrives; the
     worldwide ones (a larger file) are added when theirs does, so a slow
     phone sees the country's banks and services without waiting for it. */
  const gp = Promise.all([ccGlobalLoad(), ccGlobalHereLoad(cc)]);
  /* The placeholders the screen held the slots with go in the frame the
     services are drawn - never a frame with neither. */
  const draw = (d, g, here) => {
    root.querySelectorAll('.int-ph').forEach(n => n.remove());
    root.querySelectorAll('.int-wait-all').forEach(n => n.classList.remove('int-wait-all'));
    try{ _ccFillWith(root, d, g, here); } finally { root.classList.remove('int-filling'); }
  };
  /* Still the screen AND the country this fill was started for (Build 19
     audit NEW-07): a slow file for a country somebody has just left is
     never drawn under the new one. */
  const still = () => root.isConnected && cc === ((typeof _cwCountryGuess === 'function') ? _cwCountryGuess() : '');
  const d = await ccLoad(cc).catch(() => null);
  if(!still()) return;
  /* ONE DRAW, WHEN BOTH ARE HERE (Nov 27). The country's rows and then the
     worldwide ones a moment later was two changes to the same grid; the
     worldwide file is given a moment to arrive so they are drawn together,
     and only a slow one is drawn after. */
  const both = await Promise.race([gp, new Promise(r => setTimeout(() => r(null), 1500))]);
  if(!still()) return;
  if(both && both[0]){ draw(d, both[0], both[1]); return; }
  draw(d, null, null);
  const [g, here] = await gp;
  if(g && still()) _ccFillWith(root, d, g, here);
}
/* Built once per country and reused (Nov 23, "Integrations still has some
   lag"): every See the remaining and every repaint used to rebuild and sort
   the country's whole list - thousands of rows across the topics - to draw
   nine of each. */
let _ccByMemo = null;
function _ccFillWith(root, d, g, here){
  const by = (_ccByMemo && _ccByMemo.d === d && _ccByMemo.g === g && _ccByMemo.here === here) ? _ccByMemo.by
    : (_ccByMemo = { d, g, here, by: _ccFillBy(d, g, here) }).by;
  if(!Object.keys(by).length) return;
  _ccFillDraw(root, by);
}
function _ccFillBy(d, g, here){
  const list = d ? ccServices(d) : [];
  const by = {};
  list.forEach(x => { const t = CC_KIND_TOPIC[x.kind] || 'home'; (by[t] = by[t] || []).push(x); });
  /* Then the services Crew's jobs here name, so whatever a job needs can be
     connected or used from here - each site and name once. */
  const norm = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9\u00c0-\uffff]+/g, ' ').trim();
  const crewRows = (here && here.crew) || [];
  if(crewRows.length){
    const hosts = new Set(list.map(x => x.e.s)), names = new Set(list.map(x => norm(x.e.n)));
    /* "Sabadell" is the catalogue's "Sabadell Bank" on another of its
       sites: a name already inside a listed name is that service. */
    const within = (n) => { const w = ' ' + norm(n) + ' '; for(const m of names) if((' ' + m + ' ').includes(w)) return true; return false; };
    for(const x of crewRows){
      if(hosts.has(x.e.s) || names.has(norm(x.e.n)) || within(x.e.n)) continue;
      hosts.add(x.e.s); names.add(norm(x.e.n)); list.push(x);
      const t = x.topic; (by[t] = by[t] || []).push(x);
    }
  }
  /* Crew's services among the country's own by the same measure - visits
     from the country (r) - so Santander, BBVA and CaixaBank are not drawn
     after every bank that happened to be in the catalogue first. A stable
     sort: rows with the same rank keep the order they had. */
  const rank = x => (+x.e.r > 0 ? +x.e.r : 1e9);
  if(crewRows.length) for(const t of Object.keys(by)) by[t] = by[t].map((x, i) => [x, i]).sort((a, b) => (rank(a[0]) - rank(b[0])) || (a[1] - b[1])).map(a => a[0]);
  /* After the country's own, the worldwide ones - each site once. */
  if(g){
    const have = new Set(list.map(x => x.e.s));
    for(const [t, rows] of Object.entries(g)){
      /* News asks only of itself: Reuters filed in a country as a company, or
         the AP as a nonprofit, is still news, and belongs in News too. */
      const seen = t === 'news' ? new Set((by.news || []).map(x => x.e.s)) : have;
      const add = _ccGlobalOrder(rows.filter(x => !seen.has(x.e.s)), here);
      if(add.length) by[t] = (by[t] || []).concat(add);
    }
  }
  /* WHAT A TOPIC IS FOR, BEFORE WHAT IT ONLY LISTS (Nov 27, the owner:
     "organized - popularity and everything"). Government opened on the
     Pacific Tsunami Warning Center, NASA and the Library of Congress; Home &
     life listed Khan Academy and Lichess, nonprofits, among phone companies.
     The same rule as Tasks (_ccSide): the country's own that a topic is for
     keep their order, then the rest of its own, then a site on another
     country's domain. Jobs and News have orders of their own, below. */
  const ccx = String((d && d.cc) || '').toUpperCase();
  /* A worldwide service people here do not use - outside the country's
     100,000 most visited sites, the line apps are held to (_appUsedHere) -
     is last of all: TfL, Snapp and the Tokyo Metro in the United States'
     Maps, Gitee in its Testing. */
  const R = _ccGlobalReach, hc = here && here.codes, okHere = !!(R && typeof hc === 'string' && hc.length === R.n);
  const usedHere = (x) => { const h = +hc[x.i]; return h >= 1 && h <= 5; };
  const lowly = (x) => x.kind === 'global' ? ((okHere && x.i != null && !usedHere(x)) ? 3 : 0)
    : (_ccSide(x) || x.kind === 'nonprofit') ? 1 : _ccAbroad(x.e, ccx) ? 2 : 0;
  for(const t of Object.keys(by)) if(t !== 'jobs' && t !== 'news'){
    by[t] = by[t].map((x, i) => [x, i, lowly(x)]).sort((a, b) => (a[2] - b[2]) || (a[1] - b[1])).map(z => z[0]);
    /* Which of them may take the place of an app people here do not use. */
    Object.defineProperty(by[t], 'near', { value: new Set(by[t].filter(x => lowly(x) === 0)) });
  }
  if(by.jobs) by.jobs = _ccJobsOrder(by.jobs, here, d && d.cc);
  if(by.news){
    /* A few outlets are filed in the country data under their address
       ("reuters.com"); the worldwide table has the name. */
    const named = {}; for(const x of (g && g.news) || []) named[x.e.s] = x.e.n;
    by.news = by.news.map(x => (named[x.e.s] && /^[\w.-]+\.[a-z]{2,}$/i.test(x.e.n) && x.e.n.toLowerCase() === x.e.s.toLowerCase())
      ? Object.assign({}, x, { e: Object.assign({}, x.e, { n: named[x.e.s] }) }) : x);
    /* One row per site: a country file can hold the same paper twice (once
       by its name, once by its address), and the address gets the name above. */
    const one = new Set(); by.news = by.news.filter(x => !one.has(x.e.s) && one.add(x.e.s));
    by.news = _ccNewsOrder(by.news, here, d && d.cc);
  }
  return by;
}
/* NEWS: THE OUTLETS PEOPLE THERE READ, FIRST (Nov 23). The owner: "News
   should have all the popular news sources - for the US AP, Reuters, the
   Wall Street Journal, the New York Times, CNN, Fox News - in every
   country". Two things kept them down. The general rule puts a country's
   own services before ones listed in many countries, which is right for
   banks and wrong for news: it sank the New York Times and CNN under a
   city paper. And publishers, shopping channels and reading apps were
   mixed in. So News is: the outlets (newspapers, news sites, broadcasters,
   the international outlets and wire agencies - worldNews in
   scripts/global-services.mjs) by visits from the country (Chrome UX
   Report), then by how widely each is documented (Wikipedia sitelinks);
   everything else after. Drawn ahead of the reading apps (_ccFillDraw). */
const CC_REACH_BUCKET = [0, 1000, 5000, 10000, 50000, 100000, 500000, 1000000];
function _ccNewsOrder(rows, here, cc){
  /* Inside one visit bucket (the report says only "among the top 1,000"),
     an outlet on the country's own internet domain - .de, .co.uk, .com.mx -
     before one on another country's: in Germany Bild and Die Zeit before the
     BBC. The .com of most American outlets is nobody's, so it decides
     nothing there and prominence does. */
  const tld = /^[A-Z]{2}$/.test(String(cc || '')) ? (cc === 'GB' ? 'uk' : String(cc).toLowerCase()) : '';
  const home = (x) => (tld && String(x.e.s || '').toLowerCase().endsWith('.' + tld)) ? 0 : 1;
  const R = _ccGlobalReach, codes = here && here.codes;
  const okHere = !!(R && typeof codes === 'string' && codes.length === R.n);
  const visits = (x) => {
    if(+x.e.r > 0) return +x.e.r;
    if(x.kind === 'global' && okHere && x.i != null){ const h = +codes[x.i]; if(h) return CC_REACH_BUCKET[h] || 1e9; }
    return 1e9;
  };
  /* A broadcaster counts when it is a news one: the TV and radio lists also
     hold streaming services, sport and children's channels (Prime Video,
     ESPN, Nickelodeon), which belong after the news, not among it. */
  const NEWSY = /news|nieuws|notici|notíci|nachricht|notizie|haber|actualit|info|24|cnn|bbc|fox|nbc|cbs|abc|sky|jazeera|aaj tak|ndtv|tass|ntv|euronews|ms now|msnbc/i;
  const outlet = (x) => !!(x.kind === 'newspaper' || x.kind === 'newssite' || x.f === 'news' || (x.kind === 'global' && _ccWorldNews.has(x.e.s))
    || ((x.kind === 'tv' || x.kind === 'radio') && NEWSY.test(String(x.e.n) + ' ' + String(x.e.s))));
  return rows.map((x, i) => [x, i, outlet(x) ? 0 : 1, visits(x), home(x)])
    .sort((a, b) => (a[2] - b[2]) || (a[3] - b[3]) || (a[4] - b[4]) || ((+b[0].e.w || 0) - (+a[0].e.w || 0)) || (a[1] - b[1]))
    .map(z => z[0]);
}
try{ window._ccNewsOrder = _ccNewsOrder; }catch(e){}
/* JOBS: THE SITES PEOPLE THERE LOOK FOR WORK ON, FIRST (Nov 25). The owner:
   "instead of job boards worldwide, the popular ones of the country - in the
   US LinkedIn, Indeed; in Germany, Spain, Italy, China, Vietnam their own".
   Job sites among the country's 10,000 most visited (the country's own,
   `jobsite`, and the worldwide ones) lead, by visits from the country (Chrome
   UX Report), then a site on the country's own domain, then how widely each
   is documented; then the job sites visited less; then the employers in
   their order; and last the entries never measured here - which is where
   the odd ones in that list (a college dance team, a trade union) belong. */
function _ccJobsOrder(rows, here, cc){
  const tld = /^[A-Z]{2}$/.test(String(cc || '')) ? (cc === 'GB' ? 'uk' : String(cc).toLowerCase()) : '';
  const home = (x) => (tld && String(x.e.s || '').toLowerCase().endsWith('.' + tld)) ? 0 : 1;
  const R = _ccGlobalReach, codes = here && here.codes;
  const okHere = !!(R && typeof codes === 'string' && codes.length === R.n);
  const visits = (x) => {
    if(+x.e.r > 0) return +x.e.r;
    if(x.kind === 'global' && okHere && x.i != null){ const h = +codes[x.i]; if(h) return CC_REACH_BUCKET[h] || 1e9; }
    return 1e9;
  };
  const site = (x) => x.kind === 'jobsite' || x.kind === 'global';
  /* Leading takes a site among the country's 10,000 most visited - the same
     line the data uses for "popular" (scripts/country-popular.mjs). Measured
     at all is not enough: Norway's FINN.no and Germany's Kleinanzeigen are in
     every country's top million, and led Spain and India before this. */
  /* A worldwide entry leads only from the country's top 1,000, or its top
     10,000 on the country's own domain: FINN.no is in Spain's top 5,000 -
     the Norwegians who live there - which is real and not what Spain uses. */
  /* And a site on ANOTHER country's domain never leads (Germany's
     Kleinanzeigen.de is in Spain's top 5,000), nor does a .com outside the
     top 5,000 unless it is the country's own (China's BOSS Zhipin is in
     Japan's top 10,000). */
  const GENERIC = /\.(com|net|org|info|biz|jobs|io|co|ai|me|tv|app|work|careers)$/;
  const elsewhere = (x) => { const s = String(x.e.s || '').toLowerCase(); return !home(x) ? false : !GENERIC.test(s) && /\.[a-z]{2}$/.test(s); };
  const lead = (x, v) => !elsewhere(x) && (x.kind === 'jobsite' ? (v <= 5000 || (v <= 10000 && home(x) === 0)) : (v <= 1000 || (v <= 10000 && home(x) === 0)));
  /* Below the line: the country's own job sites visited less, then its
     employers, then everything from elsewhere and the never measured. */
  const band = (x) => { const v = visits(x); return site(x) ? (lead(x, v) ? 0 : (v < 1e9 && !elsewhere(x) && (x.kind === 'jobsite' || home(x) === 0)) ? 1 : 3) : 2; };
  const sorted = rows.map((x, i) => [x, i, band(x), visits(x), home(x)])
    .sort((a, b) => (a[2] - b[2]) || (a[2] < 2 ? (a[3] - b[3]) || (a[4] - b[4]) || ((+b[0].e.w || 0) - (+a[0].e.w || 0)) : 0) || (a[1] - b[1]));
  /* Which lead is this country's answer, so it travels with this list - a
     worldwide row is the same object in every country, and a set shared by
     all of them made a site that leads in India lead in Japan too. */
  const out = sorted.map(z => z[0]);
  Object.defineProperty(out, 'lead', { value: new Set(sorted.filter(z => z[2] === 0).map(z => z[0])) });
  return out;
}
try{ window._ccJobsOrder = _ccJobsOrder; }catch(e){}
function _ccFillDraw(root, by){
  /* A row is registered when it is drawn - its Use / Link reads it there. */
  const svcRow = (x) => _ccSvcRowHTML(x);
  const _ccSvcRowHTML = (x) => `<div class="int-card cc-svc" data-cc="${escH(x.kind)}"${x.f ? ' data-crew="' + escH(x.f) + '"' : ''}>
      <div class="int-ic" aria-hidden="true">${_appMarkHTML(x.e.n)}</div>
      <div class="int-body"><div class="int-top"><span class="int-name" data-no-i18n>${escH(x.e.n)}</span></div><div class="int-desc" data-no-i18n>${escH(x.e.s)}</div></div>
      <div class="int-act">${_ccAct(x)}</div></div>`;
  for(let [topic, rows] of Object.entries(by)){
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
    /* The rows of an earlier fill go first, then the topic's own cards are
       counted - counted before, a second fill found its own nine and drew none. */
    list.querySelectorAll('.cc-svc').forEach(n => n.remove());
    list.querySelectorAll('.cc-pushed').forEach(n => n.classList.remove('cc-pushed'));
    /* A service the topic already has as an app (The New York Times app and
       nytimes.com) is listed once, as the app. */
    /* News leads with the outlets: they go before the reading apps, and on a
       closed topic they take the first screen, the apps moving behind See
       the remaining. Every other topic keeps its apps first. */
    const lead = topic === 'news' || topic === 'jobs';
    const nm = (t) => String(t || '').trim().toLowerCase();
    list.querySelectorAll('.cc-dup').forEach(n => n.classList.remove('cc-dup'));
    if(lead && topic === 'jobs' && rows.lead){
      /* A row on an app's own site is that app: linkedin.com is filed
         worldwide as "LinkedIn Learning", and it is LinkedIn people mean.
         It keeps the row's place in the visit order, under the app's name. */
      const app = {};
      list.querySelectorAll('.int-card:not(.cc-svc) .int-name').forEach(n => { const t = n.textContent.trim(); app[t.toLowerCase().replace(/[^a-z0-9]/g, '')] = t; });
      const was = rows.lead, lead2 = new Set();
      rows = rows.map(x => {
        const label = _ccBrand(String(x.e.s || '').toLowerCase()).split('.')[0], name = app[label];
        const y = (name && name !== x.e.n) ? Object.assign({}, x, { e: Object.assign({}, x.e, { n: name }) }) : x;
        if(was.has(x)) lead2.add(y);
        return y;
      });
      Object.defineProperty(rows, 'lead', { value: lead2 });
    }
    if(lead){
      /* Where the outlet is listed, its app card (same name) is not shown
         twice - the outlet keeps its place in the visit order. */
      const names = new Set(rows.map(x => nm(x.e.n)));
      list.querySelectorAll('.int-card:not(.cc-svc)').forEach(c => { const n = c.querySelector('.int-name'); if(n && names.has(nm(n.textContent))) c.classList.add('cc-dup'); });
    } else {
      const appNames = new Set([...list.querySelectorAll('.int-card .int-name')].map(n => nm(n.textContent)));
      if(appNames.size) rows = rows.filter(x => !appNames.has(nm(x.e.n)));
    }
    const shown = list.querySelectorAll('.int-card:not(.cc-dup)').length;
    let fill, pushed = 0, unshown = 0;
    if(lead){
      /* In Jobs only the job sites lead; the employers come after the apps
         (LinkedIn's own card before a company's careers page). */
      const leads = topic === 'jobs' ? (rows.lead || new Set()) : null;
      const head = leads ? rows.filter(x => leads.has(x)) : rows;
      const tail = leads ? rows.filter(x => !leads.has(x)) : [];
      fill = open ? head.length : Math.min(head.length, CC_INT_SHOWN);
      list.insertAdjacentHTML('afterbegin', head.slice(0, fill).map(svcRow).join(''));
      unshown = head.length - fill;
      let appsShown = 0;
      if(!open){
        const apps = [...list.querySelectorAll('.int-card:not(.cc-svc):not(.cc-dup)')], room = Math.max(0, CC_INT_SHOWN - fill);
        apps.slice(room).forEach(n => n.classList.add('cc-pushed'));
        pushed = Math.max(0, apps.length - room);
        appsShown = Math.min(apps.length, room);
      }
      if(tail.length){
        const t = open ? tail.length : Math.max(0, CC_INT_SHOWN - fill - appsShown);
        list.insertAdjacentHTML('beforeend', tail.slice(0, t).map(svcRow).join(''));
        unshown += tail.length - t;
      }
    } else {
      /* An app people here do not use (data-far, 13-integrations.js) goes
         after the country's own services: the services take its place and
         it moves behind See the remaining (Nov 27: Swiggy and Zomato filled
         Food in the United States ahead of its own restaurants). */
      /* Only the services people here use take its place (rows.near, from
         _ccFillBy); the rest come after it, as before. */
      const put = (where, how, part) => { if(part.length) where.insertAdjacentHTML(how, part.map(svcRow).join('')); };
      const far = [...list.querySelectorAll('.int-card[data-far]:not(.cc-dup):not(.cc-svc)')];
      const nearN = rows.near ? rows.filter(x => rows.near.has(x)).length : rows.length, at = nearN ? far[0] : null;
      if(at){
        const apps = shown - far.length, nf = open ? nearN : Math.min(nearN, Math.max(0, CC_INT_SHOWN - apps));
        put(at, 'beforebegin', rows.slice(0, nf));
        const room = open ? far.length : Math.max(0, CC_INT_SHOWN - apps - nf);
        if(!open){ far.slice(room).forEach(n => n.classList.add('cc-pushed')); pushed = Math.max(0, far.length - room); }
        const t = open ? rows.length - nf : Math.max(0, CC_INT_SHOWN - apps - nf - Math.min(far.length, room));
        put(list, 'beforeend', rows.slice(nf, nf + t));
        fill = nf + t;
      } else {
        fill = open ? rows.length : Math.max(0, CC_INT_SHOWN - shown);
        put(list, 'beforeend', rows.slice(0, fill));
      }
      unshown = rows.length - fill;
    }
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
    const rest = (btn ? (+btn.dataset.rest || 0) : 0) + Math.max(0, unshown) + pushed;
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
  /* And the worldwide ones, after every country's: each site once. */
  const g = await ccGlobalLoad();
  if(g){
    const hosts = new Set([...by.values()].map(x => x.e.s));
    for(const rows of Object.values(g)) for(const x of rows){
      if(hosts.has(x.e.s)) continue;
      const h = (x.e.n + ' ' + x.e.s).toLowerCase(); if(!words.every(w => h.indexOf(w) >= 0)) continue;
      hosts.add(x.e.s); by.set('global|' + x.e.q, { kind: 'global', topic: x.topic, e: x.e, cc: [], r: 1e9 });
    }
  }
  if(tok !== _ccSearchTok || !box.isConnected) return;
  const all = [...by.values()].sort((a, b) => (a.r - b.r) || (b.cc.length - a.cc.length) || (a.e.n < b.e.n ? -1 : 1));

  const flag = (cc) => { const r = (typeof _cwCountryRow === 'function') ? _cwCountryRow(cc) : null; return r ? r[2] : cc; };
  const where = (x) => x.cc.slice(0, 4).map(flag).join(' ') + (x.cc.length > 4 ? ' +' + (x.cc.length - 4) : '');
  const row = (x) => `<div class="int-card cc-svc" data-cc="${escH(x.kind)}">
      <div class="int-ic" aria-hidden="true">${_appMarkHTML(x.e.n)}</div>
      <div class="int-body"><div class="int-top"><span class="int-name" data-no-i18n>${escH(x.e.n)}</span></div>
        <div class="int-desc" data-no-i18n>${escH(x.e.s)}${x.cc.length ? ` <span class="cc-where" aria-label="${escH(x.cc.join(', '))}">${where(x)}</span>` : ''}</div></div>
      <div class="int-act">${_ccAct(x)}</div></div>`;
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
/* A SERVICE NAMED ANYWHERE, FOUND IN EVERY COUNTRY (owner, Nov 25).

   "I could be in Spain and say a job for an English bank - it should
   recognise it." Chat's connect card and Crew's box looked only in AMV's own
   app directory, so a service from another country's catalogue was a blank
   page to sign in on. This reads the same files the Integrations search does
   (every country's, then the worldwide list) and finds services whose NAME
   appears in what was said, as whole words - so "check my Monzo balance"
   finds Monzo, wherever the person is. Each hit carries its official site and
   the countries that list it, so the sign-in opens the real address.

   A name that is also an everyday word ("Post", "Target", "Line") would turn
   ordinary sentences into connect cards, so names under four letters, and a
   short list of common words, are never matched on their own. */
const _CC_FIND_COMMON = new Set(('about after again also always back bank bills book booking card cards care cash check city '
  + 'class clean code coffee daily data deal deals dear dinner direct easy email energy every express fast first food free fresh '
  + 'friday good great green health help home hotel house insurance just life line link live local mail market media metro '
  + 'mobile money monday monthly more morning music national news next night office online open orange order pay people phone '
  + 'plus post power price radio ready rent sale save school search send shop shopping simple smart social sport star store '
  + 'sunday target taxi team text that this time times today total tour town trade travel unit united union vision voice water '
  + 'weather week weekly where with work world your '
  /* Words that come up in the request itself (Nov 25: "my Telcel plan" also
     matched a service called Plan). */
  + 'plan plans account accounts bill parcel package train trains flight flights ticket tickets statement balance '
  + 'transfer transfers spend spent offer offers group global apps cloud drive photos maps chat notes order orders '
  + 'tell remind remember watch track compare summary summarize find show make help call meet hello alert').split(' '));
/* The name a service's own site goes by - chase.com, bbva.es, hdfc.bank.in -
   which is what people say ("my Chase card"), where the catalogue's name is
   the formal one ("JPMorgan Chase"). Counted only where it is written as a
   name, with a capital, so "an apple pie" is never Apple. */
const _ccSiteName = (s) => { const b = _ccBrand(String(s || '').toLowerCase()).split('.')[0]; return /^[a-z]{4,24}$/.test(b) && !_CC_FIND_COMMON.has(b) ? b : ''; };
const _ccFindNorm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9À-￿]+/g, ' ').trim();
let _ccNamesP = null;
function _ccNamesLoad(){
  if(!_ccNamesP) _ccNamesP = fetch('service-names.json', { cache: 'force-cache' }).then(r => r.ok ? r.json() : null)
    .then(d => (d && d.names && typeof d.names === 'object') ? d.names : null).catch(() => { _ccNamesP = null; return null; });
  return _ccNamesP;
}
async function ccFindServices(text, max){
  const hay = ' ' + _ccFindNorm(text) + ' ';
  if(hay.trim().length < 3) return [];
  const caps = new Set((String(text).match(/\p{Lu}[\p{L}\p{N}]*/gu) || []).map(w => _ccFindNorm(w)));
  /* Only the countries that can hold an answer are read: the person's own,
     and those the name index (service-names.json, built from every country's
     file) says list a name that appears in what was said. One small index
     instead of a hundred files on the first lookup. */
  const codes = [];
  let own = '';
  try{ own = (typeof _cwCountryGuess === 'function' && _cwCountryGuess()) || ''; if(own) codes.push(own); }catch(e){}
  const idx = await _ccNamesLoad();
  if(idx) for(const [name, ccs] of Object.entries(idx)){
    if(name.charAt(0) === '@'){ const a = name.slice(1); if(a.length < 4 || _CC_FIND_COMMON.has(a) || !caps.has(a)) continue; }
    else { const n = _ccFindNorm(name); if(n.length < 4 || _CC_FIND_COMMON.has(n) || hay.indexOf(' ' + n + ' ') < 0) continue; }
    for(const cc of String(ccs).split(',')) if(/^[A-Z]{2}$/.test(cc) && codes.indexOf(cc) < 0) codes.push(cc);
    if(codes.length > 12) break;
  }
  const by = new Map();
  const consider = (kind, e, cc, topic) => {
    const n = _ccFindNorm(e.n);
    let tok = (n.length >= 4 && !_CC_FIND_COMMON.has(n) && hay.indexOf(' ' + n + ' ') >= 0) ? n : '';
    if(!tok){ const a = _ccSiteName(e.s); if(a && caps.has(a)) tok = a; }
    if(!tok) return;
    const k = e.s; let x = by.get(k);
    if(!x){ x = { name: e.n, site: e.s, kind, topic: topic || CC_KIND_TOPIC[kind] || '', cc: [], r: 1e9, ro: 1e9, len: tok.length, tok }; by.set(k, x); }
    if(cc && x.cc.indexOf(cc) < 0) x.cc.push(cc);
    if(+e.r > 0){ x.r = Math.min(x.r, +e.r); if(cc && cc === own) x.ro = Math.min(x.ro, +e.r); }
  };
  let i = 0;
  const one = async () => { while(i < codes.length){ const cc = codes[i++]; const d = await ccLoad(cc).catch(() => null); if(!d) continue;
    for(const [kind, list] of Object.entries(d.kinds || {})) for(const e of (list || [])) consider(kind, e, cc); } };
  await Promise.all(Array.from({ length: 8 }, one));
  const g = await ccGlobalLoad().catch(() => null);
  if(g) for(const rows of Object.values(g)) for(const x of rows) consider('global', x.e, '', x.topic);
  /* The longest name first ("Bank of America" over "America"), then the
     person's own country's ("Santander" in Spain is Banco Santander, not the
     Polish consumer lender), then the most visited, then the one most
     countries list. */
  const mine = x => own && x.cc.indexOf(own) >= 0 ? 1 : 0;
  /* One answer for each name said: "Santander and BBVA" is two banks, not
     three Santanders. Between two of the person's own, the one visited more
     from their country - Spain's BBVA, not BBVA Colombia, which Spain's
     file also lists. */
  const said = new Set();
  return [...by.values()].sort((a, b) => (b.len - a.len) || (mine(b) - mine(a)) || (a.ro - b.ro) || (a.r - b.r) || (b.cc.length - a.cc.length))
    .filter(x => !said.has(x.tok) && said.add(x.tok)).slice(0, max || 3).map(x => { delete x.tok; delete x.ro; return x; });
}
try{ window.ccFindServices = ccFindServices; }catch(e){}
function ccUseService(key){
  const x = _ccSvc[key]; if(!x || x.kind === 'bank' || (x.kind === 'global' && x.topic === 'money')) return;
  /* What the request says it will and will not do (Build 19 audit NEW-08):
     the site is checked for the person's country first, the sign-in is
     theirs, and nothing is bought, submitted or sent without their OK. */
  const text = 'Using AMV\u2019s browser, open ' + x.e.s + ' (' + x.e.n + '). First check that it serves my country and can do what I want. I will sign in myself if it asks. Then help me [what you want to do there]. Do not buy, submit or send anything without asking me.';
  /* A new chat, like every Task (Nov 28). */
  try{ openFreshChat(); }catch(e){ setTab('chat'); }
  setTimeout(() => { const ta = document.getElementById('mta'); if(!ta) return;
    ta.value = text; fitChatComposer(ta); ta.focus(); const a = text.indexOf('['); if(a >= 0) ta.setSelectionRange(a, text.indexOf(']') + 1); }, 150);
}
try{ window.ccTasksPopular = ccTasksPopular; window.ccGlobalLoad = ccGlobalLoad; window.ccGlobalHereLoad = ccGlobalHereLoad; window.ccFillIntegrationsNow = ccFillIntegrationsNow;
  /* A country's file when it is already here, else null - for screens that
     can draw it in the frame they open. */
  window.ccLoadedNow = (cc) => _ccDone[String(cc || '').toUpperCase()] || null; }catch(e){}
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
