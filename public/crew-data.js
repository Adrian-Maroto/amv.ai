/* ══════════════════════════════════════════════════════════════════════
   THE CREW CATALOGUE - fetched the first time somebody opens Crew.

   Every built-in background job (what it is, what it needs, what it says it
   will do, the prompt it runs) and the country lists that pick which ones a
   person sees first. About 58KB compressed of data that only the Crew screen
   and its sync read, so it is not in the page every visitor downloads - it is
   fetched once, the way the spreadsheet editor and the Office exporter are,
   and then cached by the service worker.

   This source is pure data: it sets one global and nothing else. The build
   appends Mission Control's screen (src/crew/mission-control.js) to the file
   it publishes, because that screen is only drawn after this has arrived. The page reads it
   through _cwCatalog() in 10-mission-control.js, and nothing there rebuilds a
   saved job list until this has arrived - a rebuild from an empty catalogue
   would delete every built-in job somebody had switched on.
   ══════════════════════════════════════════════════════════════════════ */
window.AMV_CREW_DATA = {
 jobs: [  { id:'job_hunt', cat:'Work & career', icon:'\uD83D\uDCBC', title:'Job hunt - find and prepare applications', needs:'Job hunt profile, Web research', on:false,
    desc:'AMV finds roles matched to your resume and prepares a tailored application for each one, ready for you to review and send. If a posting asks something you have not specified, it asks you first. Submitting on its own is not switched on - nothing reaches an employer without you.',
    prompt:'Find current job openings matching the roles, locations and salary floor in my Job Hunt profile. For each one: the title, company, location, pay if stated, why it fits me, and the direct link. Then draft a tailored application for the strongest matches, using my resume and stated preferences. Do not submit anything - present each as a finished draft for me to review. If a posting asks for something my profile does not answer, list the question instead of inventing an answer.' },
  { id:'morning_brief', cat:'Watching the world', icon:'\u2600\uFE0F', title:'Morning news & markets brief', needs:'Web research', on:false,
    desc:'Every morning, AMV researches what happened overnight and emails you a short brief on the moves that matter and why - facts and figures, never a recommendation.',
    /* IT HAS TO BE TOLD WHAT TO FOLLOW, and it never was. This job claimed a
       mailbox, which would not have answered the question either - reading
       somebody's mail does not tell you which markets they care about. The
       claim was hiding an underspecified job rather than supplying anything,
       which the catalogue check found the moment the claim came off. */
    asks:{ q:'What should I follow for you?', ph:'e.g. "AI chip makers, the FTSE 100, UK interest rates, and anything about my industry"' },
    sample:['OVERNIGHT: three things moved, one matters to what you follow.','Chip index down 2.1% after an earnings miss in Asia. The miss was guidance, not revenue.','Energy flat despite the headline - the market had already priced it.','ON YOUR LIST: the two names you watch closed 0.4% and 1.8% down, in line with the sector rather than company news.','Information, not financial advice.'],
    prompt:'Search the live web now and report what happened overnight in news and markets relevant to what the user follows. Give the specific moves with numbers and the reason attributed to each, distinguishing a real cause from a headline the market had already priced. Cover the user\u2019s named interests explicitly, and say when nothing relevant happened rather than padding. You must NOT give financial advice: never tell the user to buy, sell, hold or wait, and never predict a price. End by stating this is information, not financial advice.' },
  { id:'inbox_digest', cat:'Inbox & calendar', icon:'\uD83D\uDCEC', title:'Daily inbox digest', needs:'Email', on:false,
    desc:'Each evening, the few emails that actually need you - summarized, with a ready-to-send reply drafted for each. Nothing goes out without you pressing send.',
    sample:['6 needed you today. 58 did not.','Client asking to move Thursday to Friday - reply drafted, says yes and proposes 2pm.','Invoice query from accounts - reply drafted, needs the PO number you have not given me.','Recruiter, second follow-up - drafted a short no, since you have not replied twice.','Every draft is ready to send and has NOT been sent.'],
    prompt:'Summarize the user\u2019s recent mail into the messages that genuinely need them and the count of those that do not. For each that needs action: who, what they want, and what is at stake if it waits. Draft a ready-to-send reply for each, in the user\u2019s own register. Where a reply needs information only the user has, say exactly what is missing rather than inventing it. State plainly on every draft that it is ready and has NOT been sent. Never describe an email you cannot actually see.' },
  { id:'competitor_watch', every:'weekly', cat:'Growing a business', icon:'\uD83D\uDD0D', title:'Competitor & industry watch', needs:'Web research', on:false,
    desc:'Watches the companies you compete with and tells you what actually changed - pricing, launches, hiring, positioning - and what it means for you, not just that it happened.',
    /* Same shape: "the competitors the user has named" needs them named. */
    asks:{ q:'Which competitors, and what market?', ph:'e.g. "Notion, Coda and Obsidian - note-taking apps sold to teams"' },
    sample:['2 real changes this week out of 40 things published.','Competitor A cut their entry tier from 29 to 19 and removed the seat limit. That is the first price move in 14 months.','WHAT IT MEANS: your 25 tier is now the expensive middle option rather than the cheap one.','Competitor B is hiring 3 enterprise salespeople. They are moving upmarket, away from your customers.','Everything else was marketing.'],
    prompt:'Track the competitors and market the user has named. Report only genuine changes: pricing, product launches, positioning, funding, notable hiring patterns and public statements - with the date and source for each. For every change, say what it means for the user specifically, not just that it happened. Explicitly separate substance from marketing, and say how much you discarded so the summary is trusted as filtered. Never report a change you cannot evidence from a real source.' },
  { id:'weekly_report', every:'weekly', cat:'Inbox & calendar', icon:'\uD83D\uDCCA', title:'Weekly summary report', needs:'Email', on:false,
    desc:'Every Friday, your week written up properly: what got finished, what moved, what is still open and who it is waiting on - ready to send to a team or keep for yourself.',
    sample:['WEEK OF 3 MARCH','FINISHED: onboarding rewrite, two client calls, the pricing page.','MOVED BUT NOT DONE: migration plan - blocked on the data export since Tuesday.','WAITING ON OTHERS: legal review (4 days), supplier quote (6 days). The supplier one is now the longest-running item you have.','NEXT WEEK: nothing new is scheduled, so this is the week to clear the two blocked items.'],
    prompt:'Compile the user\u2019s week from what they and their correspondence record: what was completed, what progressed without finishing and what is blocking it, what is waiting on other people and for how long, and what is scheduled next. Name the single longest-outstanding item explicitly - it is the one that gets forgotten. Write it so it can be sent to a colleague without editing. Never claim something was finished unless there is evidence for it.' },
  { id:'content_calendar', every:'weekly', cat:'Growing a business', icon:'\u270D\uFE0F', title:'Social content drafts', needs:'Web research', on:false,
    desc:'A week of posts written for you from what is actually being talked about in your field this week - full copy, ready to publish, waiting for your approval rather than going out on their own.',
    sample:['5 posts for next week, built from 3 things genuinely being discussed in your field.','MON - the pricing debate everybody is having. Full copy, 78 words, opinionated.','WED - a short how-to on the question you keep getting asked. 4 lines plus a list.','FRI - the contrarian one. This is the riskiest of the five and the most likely to travel.','Nothing is scheduled or posted. These wait for you.'],
    asks:{ q:'What is your field, and who are you talking to?', ph:'e.g. "B2B SaaS for dental practices, posting on LinkedIn to practice owners"' },
    prompt:'Research what is genuinely being discussed in the user\u2019s field this week and draft a week of posts from it. For each: the day, the full ready-to-publish copy, and one line on why this angle now. Vary the shape - not five of the same post. Say which one is the riskiest and why, so the user can decide rather than discover. Ground every post in something real you found, and name it. Nothing is posted or scheduled: say plainly that these are drafts awaiting approval.' },

  /* ---- The standing services below are what make Crew worth paying for:
     they run in the background and create value without you remembering to
     ask. Each carries the concrete instruction the autonomous runner
     executes, and an honest `needs` so it never pretends to run without the
     access it requires. ---- */

  { id:'opportunity_radar', cat:'Work & career', icon:'\uD83C\uDFAF', title:'Opportunity radar', needs:'Web research', on:false,
    desc:'Every morning AMV hunts for things you could actually get - scholarships, grants, internships, jobs, competitions, fellowships, discounts and rebates that match your profile - and emails you only the ones you qualify for, with the deadline and the direct link.',
    sample:['6 open now that you actually qualify for. 2 close inside a fortnight.','Regional innovation grant - up to 5,000, closes in 11 days, needs a one-page plan you already have most of.','Industry fellowship - paid, closes in 6 weeks, needs two references. Ask this week, not that week.','Discarded 23: wrong region, wrong stage, or already closed. No point showing you those.'],
    asks:{ q:'What should I match against?', ph:'Your age, where you live, what you study or do, and the kinds of things you want - e.g. "17, in the US, studying chemistry and math, want scholarships and summer research"' },
    prompt:'Search the live web for opportunities matching the user profile and interests: scholarships, grants, internships, jobs, competitions, fellowships, rebates and tax credits. Only include ones open NOW with a future deadline. For each: name, what it gives, eligibility, deadline, direct application link. Exclude anything they clearly do not qualify for. If you find nothing new, say so plainly.' },

  { id:'change_digest', cat:'Watching the world', icon:'\uD83D\uDD14', title:'Did anything change today?', needs:'Web research', on:false,
    desc:'You tell AMV what to watch - a page, a price, a competitor, a policy, a person, a job board - and each morning it checks every one and reports only what actually changed. No change, no noise.',
    sample:['4 things on your watch list. 1 changed.','The supplier page: lead time went from 3 weeks to 6. Changed some time in the last 24 hours.','WHY IT MATTERS: your quote to the client assumed 3.','The other three are unchanged. Prices, the policy page, the job board - all identical to yesterday.'],
    asks:{ q:'What should I watch?', ph:'One per line: a page, a price, a competitor, a policy, a job board. Paste links where you have them.' },
    prompt:'Check each item on the user watch list against its previous state. Report ONLY genuine changes: what changed, the old value, the new value, and why it might matter. If nothing changed, say "nothing changed" rather than padding the report.' },

  /* BETTER WITH A BANK, NOT BROKEN WITHOUT ONE.

     The description said "receipts and statements" while the job could only
     ever read receipts, and a receipt is what a merchant SAID it would charge.
     A price rise announced in one email is invisible until the next receipt
     arrives, which is exactly the leak this job is named after.

     So it declares the bank as a `boost`: where one is linked the figures come
     off the statement and are what actually left the account, and where one is
     not it still runs on receipts and says so in the answer. It is not a
     `needs`, because the aggregator behind it covers a short list of countries
     and making the bank mandatory would break this job for most of the world
     for no gain. */
  { id:'money_leaks', cat:'Money', icon:'\uD83D\uDCB8', title:'Money leak detector', needs:'Email', boost:'Bank connection', on:false,
    desc:'AMV finds subscriptions you stopped using, duplicate charges, silent price rises and avoidable fees - then tells you what to cancel and how much you would save. It reads your receipts, and where a bank is linked it reads the real charges instead.',
    sample:['Found 4 things. Together they cost you 631 a year.','Design tool - 34/month, no login recorded in 5 months. 408/year.','Two charges from the same streaming service on the 3rd and the 17th. One is a duplicate.','Cloud storage went from 8 to 12 in January - your statement shows both. 48/year, quietly.','Every one of these points at a real charge or a real receipt. Nothing here is a guess.'],
    prompt:'Identify money leaks from the evidence AMV supplies: recurring charges that look unused, duplicate charges, subscription price increases versus previous months, and avoidable fees. For each, give the merchant, the amount, how often, and the annual cost of keeping it. Total the potential saving. Say which figures came from a bank statement and which came from a receipt email, since a receipt is what the merchant said and a statement is what actually left the account. Never guess a charge you cannot see evidence for.' },

  { id:'forgot_check', cat:'Inbox & calendar', icon:'\uD83E\uDDE0', title:'What did I forget?', needs:'Email, Calendar', on:false,
    desc:'Each morning AMV re-reads your recent mail and calendar for things you said you would do, questions nobody answered, and commitments with no follow-up - so nothing quietly slips.',
    sample:['3 things you said you would do and have not.','You told Priya on the 4th you would send the revised figures \'tomorrow\'. That was 9 days ago.','Two people are waiting on a reply: the landlord (6 days) and the accountant (3 days).','You asked the supplier a question on the 8th and never got an answer. Worth chasing before the order.'],
    prompt:'Review recent emails and calendar entries. List: promises the user made that have no follow-up, messages awaiting their reply, questions they asked that were never answered, and commitments with an approaching date. Be specific - quote the sentence and name the person. Only include real, evidenced items.' },

  /* THE ONE JOB THAT ENDS WITH SOMETHING OTHER PEOPLE OPEN.

     Every other entry here produces text to read. This produces a link: the
     run writes the questions, the server turns them into a real game, and the
     link arrives with the result. `kind:'game'` is what tells the run loop to
     do that - see _autoMakeGame.

     Weekly rather than daily on purpose. A game night that happens every night
     is not a game night, and a job that asks a group for their attention seven
     times a week is the kind of thing people turn off and resent. */
  { id:'friday_game', every:'weekly', cat:'Home & life', icon:'\uD83C\uDFB2', title:'Friday night game', needs:'Nothing', on:false, kind:'game',
    desc:'Every Friday evening, a fresh set of questions about your group, turned into a link you send to the chat. Anybody can answer without an account. Nobody sees the answers until you reveal them.',
    asks:{ q:'Who is in the group, and what are they like?', ph:'First names and anything that makes them them - e.g. "Sam always late, Alex films everything, Priya wins every argument, Tom claims he can cook"' },
    sample:['MOST LIKELY TO ARRIVE LAST AND BLAME THE TRAIN?','WHO WOULD SURVIVE LONGEST WITH NO PHONE?','WHOSE CAMERA ROLL WOULD BE THE MOST EMBARRASSING TO SCROLL?','WHO IS MOST LIKELY TO START AN ARGUMENT ABOUT SOMETHING THEY GOOGLED ONCE?','Your game is ready - send this to the group: amv.homes/g/...'],
    prompt:'Write between five and eight short questions for a group of friends to answer about each other, using ONLY the names and details the user gave you. Each question on its own line, no numbering, no preamble, no closing line. Make them specific to these people rather than generic - a question that would work for any group is a wasted question. Keep them warm: teasing is the point, humiliation is not, and nothing about anybody\u2019s body, money, health, family or relationships. Never invent a fact about somebody that the user did not tell you. Ask nothing that involves payment, cards or accounts of any kind.' },

  { id:'renewal_watchdog', cat:'Money', icon:'\uD83D\uDCC4', title:'Contract & renewal watchdog', needs:'Email', on:false,
    desc:'Finds subscriptions, insurance, leases, warranties, domains and memberships heading for renewal, warns you BEFORE the auto-charge, and prepares the cancel-or-renegotiate message.',
    sample:['3 renewals inside 30 days. One of them is bad value.','Insurance auto-renews on the 22nd at 840 - up from 690 last year, for the same cover.','Domain renews on the 30th, 14. Fine, leave it.','Gym renews on the 2nd, 45/month. You have been twice since November.','Cancellation email for the gym and a renegotiation email for the insurance, both drafted and NOT sent.'],
    prompt:'Find upcoming renewals, expirations and auto-charges in the user mail: subscriptions, insurance, leases, warranties, domains, memberships, licenses. For each: what it is, the renewal date, the amount, and whether it auto-renews. Flag anything renewing within 30 days first. Draft a cancellation or renegotiation email for anything that looks poor value.' },

  { id:'followups', cat:'Inbox & calendar', icon:'\uD83E\uDD1D', title:'Relationship follow-ups', needs:'Email', on:false,
    desc:'Tells you who is waiting on you and who you have gone quiet on - clients, recruiters, mentors, friends - with the context of your last exchange and a ready-to-send message.',
    sample:['2 people are waiting on you, and 1 you have gone quiet on.','The recruiter asked a direct question 8 days ago. That is long enough to look like a no.','Client asked for the timeline on Tuesday - a one-line answer would do it.','You have not spoken to your old manager since March, and they moved to a company you were curious about. Short note drafted.','All three drafts are ready and none of them has been sent.'],
    prompt:'Find people awaiting a reply from the user, and important contacts with no exchange in a while. For each: who, when you last spoke, what it was about, and why now is a good moment. Draft a short, natural follow-up message for each. Never invent a shared history that is not in the thread.' },

  { id:'deal_watch', cat:'Money', icon:'\uD83C\uDFF7\uFE0F', title:'Price & deal watcher', needs:'Web research', on:false,
    desc:'Watches everything on your wish list and tells you when a price is genuinely good by its own history - not just when a site claims a sale.',
    sample:['6 things on your list. 1 is genuinely cheap right now.','The headphones: 179, against a 12-month usual of 219 and a lowest-ever of 169. This is a real drop, not a sale banner.','The jacket says \'40% off\' and is 4 more than it was in October. That discount is against a price it never sold at.','Nothing else has moved enough to mention.'],
    asks:{ q:'What is on your wish list?', ph:'One per line, with a link if you have one - e.g. "Sony WH-1000XM5 headphones"' },
    prompt:'Check the current price of each item on the user wish list. Report the current price, the usual price, and whether this is genuinely a good price by historical standards. Explicitly call out fake or marketing-only discounts. Only flag a real drop.' },

  { id:'travel_guardian', cat:'Home & life', icon:'\u2708\uFE0F', title:'Travel guardian', needs:'Email, Calendar, Web research', on:false,
    desc:'From your booking confirmations it tracks flight delays, gate changes, weather at both ends, and check-in windows - and warns you early enough to actually do something.',
    sample:['Flight in 2 days. Two things need you.','Your outbound is now 40 minutes earlier. The airline emailed at 3am and it is easy to miss.','Check-in opens tomorrow at 07:00 and the seats you wanted are on a 6-hour leg.','Weather at the far end: heavy rain the day you land, clear after. Worth knowing before you pack.','Return leg unchanged.'],
    prompt:'From the booking confirmation emails in the user mail, identify upcoming travel. Check flight status, gate and time changes, weather at origin and destination, and check-in windows. Report anything that needs action, with how much time remains to act. State clearly if a booking cannot be verified.' },

  { id:'meeting_prep', cat:'Inbox & calendar', icon:'\uD83D\uDCCB', title:'Meeting prep & follow-up', needs:'Calendar, Email, Web research', on:false,
    desc:'Before each meeting you get a brief on who you are meeting, their company and recent news, and the history of your thread. Afterwards it drafts the follow-up and the action list.',
    sample:['Meeting at 2pm with Daniel Okafor, Head of Ops at Kestrel.','They announced a warehouse move 3 weeks ago - relevant, because your last thread was about delivery times.','LAST TIME: you agreed to send pricing for the larger tier. You did, on the 12th. They never replied to it.','OPEN ITEM: that unanswered pricing question is the whole meeting. Lead with it.','3 talking points, and a follow-up email drafted for after.'],
    prompt:'For each upcoming meeting: who is attending, their role and company, relevant recent news, the history of prior correspondence, open items from last time, and 3 suggested talking points. After a meeting, draft a follow-up email and a task list. Never fabricate a fact about a person - if you cannot verify it, omit it.' },

  { id:'bills_due', cat:'Money', icon:'\uD83E\uDDFE', title:'Bills, payments & paycheck alerts', needs:'Email', on:false,
    desc:'Tells you what is due and when, flags failed payments and low balances early, and confirms when your pay or a refund actually lands.',
    prompt:'From receipts, invoices and bank notification emails, report: bills due in the next 14 days with amounts, any failed or declined payments, refunds that have or have not arrived, and expected income that has landed. Do not state a balance you cannot see evidence for.' },

  { id:'site_monitor', cat:'Watching the world', icon:'\uD83D\uDC41\uFE0F', title:'Website & application watch', needs:'Web research', on:false,
    desc:'Watches pages that matter - application portals, government pages, waitlists, admissions, job boards - and tells you the moment something opens or changes.',
    asks:{ q:'Which pages should I watch?', ph:'One URL per line, and what counts as a meaningful change on each' },
    prompt:'Check each watched page for meaningful change: new postings, opened applications, status changes, updated deadlines or policy edits. Ignore cosmetic changes. Report what changed and the direct link.' },

  { id:'goal_tracker', cat:'Home & life', icon:'\uD83D\uDE80', title:'Goal tracker & weekly plan', needs:'Nothing', on:false,
    desc:'Turns a real goal - save an amount, get fit, launch something, get into a school - into a weekly plan, checks your progress, and adapts when you fall behind instead of nagging.',
    prompt:'For each user goal: assess progress since last check, give the specific next actions for this week, and adapt the plan if they are behind. Be concrete and realistic. Encourage honestly - never claim progress that has not happened.' },

  { id:'deliveries', cat:'Home & life', icon:'\uD83D\uDCE6', title:'Package & delivery tracking', needs:'Email', on:false,
    desc:'Pulls tracking numbers out of your order confirmations and tells you what is arriving today, what is late, and what never shipped.',
    prompt:'From order and shipping confirmation emails, list every package in transit: what it is, carrier, tracking number, expected date, and current status. Flag anything late or never shipped. Only report packages you have evidence for.' },

  { id:'life_admin', cat:'Home & life', icon:'\uD83D\uDDD3\uFE0F', title:'Life admin & expiry reminders', needs:'Email, Calendar', on:false,
    desc:'Passport, license, insurance, registration, medical checks, home and car maintenance - AMV tracks the dates and reminds you far enough ahead that renewing is easy.',
    prompt:'From renewal notices and reminders in the user mail, track expiries and recurring life admin: passport, license, insurance, vehicle registration and inspection, medical and dental checks, home and car maintenance. Report what is due in the next 90 days, how long renewal usually takes, and what to do first.' },

  { id:'vip_alerts', cat:'Inbox & calendar', icon:'\uD83D\uDEA8', title:'Important email alerts', needs:'Email', on:false,
    desc:'Not a daily digest - AMV pings you the moment something genuinely urgent lands: your boss, a client, an offer, an interview invite, a deadline or anything money-related.',
    prompt:'Watch incoming mail for genuinely urgent items: named VIP senders, offers, interview invitations, deadlines, legal or money matters, and anything explicitly marked urgent by a real person. Alert immediately with sender, subject and the one line that makes it urgent. Do NOT alert on newsletters, marketing or automated notifications.' },

  { id:'recurring_email', cat:'Inbox & calendar', icon:'\uD83D\uDCEE', title:'Recurring emails on a schedule', needs:'Email', on:false,
    desc:'Send a real email on any schedule - weekly reports to your team, monthly invoices, a check-in every Friday. AMV writes it fresh each time from current information and sends it through your own connected mail account.',
    prompt:'At each scheduled run, compose the recurring email fresh from the latest information (do not resend a stale copy), then send it from their own connected mail account to the specified recipients. Confirm what was sent and to whom. If the recipient or content is unclear, ask instead of sending.' },

  { id:'calendar_brief', cat:'Inbox & calendar', icon:'\uD83C\uDF05', title:'Morning calendar briefing', needs:'Calendar', on:false,
    desc:'Your day in one message before it starts: every meeting, travel time between them, what needs prep, where the free blocks are, and the one thing you should protect time for.',
    prompt:'Summarize today from the calendar: each event with time and attendees, realistic travel or transition time between them, which need preparation, where the genuine free blocks are, and the single most important thing to protect time for. Flag any day that is overbooked.' },

  { id:'conflict_watch', cat:'Inbox & calendar', icon:'\u26A0\uFE0F', title:'Scheduling conflict alerts', needs:'Calendar', on:false,
    desc:'Catches double-bookings, meetings with no travel time between them, and things scheduled outside your working hours - before they become an awkward cancellation.',
    prompt:'Scan the calendar for problems: overlapping events, back-to-back meetings in different locations with no travel time, events outside stated working hours, and meetings with no agenda or attendees. Report each conflict and suggest the specific fix.' },

  { id:'meeting_docs', cat:'Inbox & calendar', icon:'\uD83D\uDCCE', title:'Prepare documents before meetings', needs:'Calendar, Email, Drive', on:false,
    desc:'Before a meeting AMV pulls together everything you will need - the last thread, the attached files, the previous notes, the numbers - into one place so you are never scrambling.',
    prompt:'For each upcoming meeting, gather the relevant material: prior email threads with attendees, attached documents, previous meeting notes and open action items. Produce one prep pack with the key facts and open questions. Only include documents that actually exist.' },

  { id:'project_pulse', cat:'Work & career', icon:'\uD83D\uDCC8', title:'Morning project updates', needs:'Email, Web research', on:false,
    desc:'A single morning read on everything moving: what progressed, what stalled, what is blocked on someone else, and what needs you today.',
    prompt:'From the user mail and the live web, report the current state of each active project: what moved since the last update, what stalled, what is blocked and on whom, and what specifically needs the user today. Be concrete and short. Say plainly if a project had no activity.' },

  { id:'overdue_escalation', cat:'Work & career', icon:'\u23F0', title:'Overdue task escalation', needs:'Email, Calendar', on:false,
    desc:'When something slips past its date AMV escalates it properly - reminds you, drafts the chase message to whoever is holding it up, and keeps raising it until it is actually closed.',
    prompt:'Find tasks and commitments past their due date. For each: what it is, how overdue, who is holding it up, and the impact of continued delay. Draft a polite chase message for anything waiting on someone else. Escalate the tone gradually the longer it slips.' },

  { id:'forum_watch', cat:'Watching the world', icon:'\uD83D\uDCAC', title:'Reddit & forum monitoring', needs:'Web research', on:false,
    desc:'Watches subreddits, forums and communities for the topics, products or names you care about - and surfaces the threads actually worth reading.',
    asks:{ q:'Which communities, and what topics?', ph:'Subreddits, forums or communities on one line each, then the keywords that matter to you' },
    prompt:'Monitor the specified subreddits, forums and communities for the user keywords and topics. Report only genuinely relevant new threads: title, community, why it matters, and the link. Skip low-engagement noise and reposts.' },

  { id:'groceries', cat:'Home & life', icon:'\uD83D\uDED2', title:'Grocery & household restock', needs:'Email', on:false,
    desc:'Learns what you buy and how often, then reminds you before you run out - and builds the list for you, grouped the way a shop is laid out.',
    prompt:'From past orders and receipts, work out what the user buys and how often. Predict what is running low now, build a grouped shopping list, and note anything currently cheaper than usual. Only include items with real purchase history.' },

  { id:'chores', cat:'Home & life', icon:'\uD83E\uDDF9', title:'Chore & routine scheduling', needs:'Calendar', on:false,
    desc:'Keeps the recurring stuff on a sensible rhythm - cleaning, laundry, bins, plants, pets - scheduled around your actual calendar instead of nagging at random.',
    prompt:'Maintain the recurring chore schedule. Each run, report what is due today and this week, fitted around the real calendar so nothing lands during a meeting or while away. Reschedule anything missed rather than repeating the same reminder.' },

  { id:'coupons', cat:'Money', icon:'\uD83C\uDF9F\uFE0F', title:'Coupon & discount finder', needs:'Web research', on:false,
    desc:'Before you buy, AMV hunts for working codes, cashback, student or member discounts - and tells you the real final price rather than the advertised one.',
    asks:{ q:'What are you buying, and where?', ph:'The item or retailer, roughly what it costs, and any membership or student status you have' },
    prompt:'For the specified purchase or retailer, search for currently valid discount codes, cashback offers, student or membership discounts and price-match options. Report the real final price after each. State clearly if you cannot verify a code is still valid.' },

  { id:'hotel_watch', cat:'Home & life', icon:'\uD83C\uDFE8', title:'Hotel & stay price tracking', needs:'Web research', on:false,
    desc:'Watches the price of the places you actually want to stay for your real dates, and tells you when to book - including when a refundable rate drops so you can rebook cheaper.',
    asks:{ q:'Which hotels, and which dates?', ph:'e.g. "Hotel Borges and Casa do Bairro, Lisbon, 14-18 June, 2 adults"' },
    prompt:'Track the price of the specified hotels for the specified dates. Report current price, how it compares to recent history, and whether to book now or wait. If an existing booking is refundable and the price has dropped, flag the rebooking saving explicitly.' },

  { id:'ambient', cat:'Work & career', icon:'\u2728', title:'Ambient automation - AMV suggests', needs:'Email, Calendar', on:false,
    desc:'AMV watches how you actually work and proposes automations you did not think to ask for: the report you rebuild every Monday, the reply you always send, the thing you check daily. You approve the ones you want.',
    prompt:'Look for repeated patterns in the user activity: tasks done on a regular cadence, near-identical emails sent repeatedly, information checked over and over, manual steps repeated weekly. For each, propose a specific automation with what it would do and the time it would save. Only propose patterns that genuinely repeat - never invent one.' },

  /* These read your REAL linked accounts through the bank connection - not
     receipts guessed from email. Until a bank is linked they say so. */
  { id:'money_morning', cat:'Money', icon:'\uD83C\uDFE6', title:'Morning money summary', needs:'Bank connection', on:false,
    desc:'Real balances across every account and card, what came in and went out yesterday, what is due next, and what is actually safe to spend today.',
    prompt:'Report the real balances from the linked accounts, yesterday\u2019s money in and out, upcoming scheduled payments, and the genuinely safe-to-spend figure after commitments. Use only real account data. If an account cannot be read, say which one and why - never estimate a balance.' },

  { id:'unusual_spend', cat:'Money', icon:'\uD83D\uDD3A', title:'Unusual transaction alerts', needs:'Bank connection', on:false,
    desc:'Learns what normal looks like for YOU, then flags charges far outside it - plus duplicate charges and anything from a merchant you have never used.',
    prompt:'Compare recent transactions against this account\u2019s own normal pattern. Flag charges well outside it, same-day duplicates, and first-time merchants with a large amount. For each: date, merchant, amount, and why it stands out. Do not flag ordinary recurring bills.' },

  { id:'low_balance', cat:'Money', icon:'\uD83E\uDEAB', title:'Low balance early warning', needs:'Bank connection', on:false,
    desc:'Warns you before a balance gets tight - accounting for payments already scheduled - so you move money in time instead of paying an overdraft fee.',
    prompt:'Project each account balance forward against scheduled payments and known recurring debits. Warn when a projected balance falls below the user floor, with how many days remain and the exact shortfall. Never state a balance you cannot read.' },

  { id:'credit_watch', cat:'Money', icon:'\uD83D\uDCC9', title:'Credit score & report changes', needs:'Bank connection', on:false,
    desc:'Tells you when your score moves and what caused it - a new account, a hard search, changed utilization - and flags anything on your report you did not do.',
    prompt:'Report changes to the credit score and report since the last check: the movement, the likely cause, and anything unrecognized such as an unknown account or hard search. Explain what would raise it most. If the score cannot be read, say so plainly.' },

  { id:'budget_trend', cat:'Money', icon:'\uD83D\uDCCA', title:'Budget pace & spending review', needs:'Bank connection', on:false,
    desc:'Not a report after the damage - it tells you mid-month that you are trending over budget while you can still do something, and where the overspend is coming from.',
    asks:{ q:'What is your budget?', ph:'What you expect to spend on what, and the number that matters - e.g. "about 400 a month on food, and I must not go over 1200 total"' },
    prompt:'Work out the current month\u2019s spending pace against the user budget and project the month-end total. If trending over, identify which categories are driving it and what change would bring it back. Use real transactions only.' },

  { id:'target_buy', cat:'Money', icon:'\uD83D\uDECD\uFE0F', title:'Buy at my target price', needs:'Web research, Web automation', on:false, spend:true,
    desc:'Watches an item and buys it the moment it hits your target. Small purchases go through instantly with no interruption; anything above your auto-buy limit takes one tap. Your monthly cap can never be crossed.',
    prompt:'Monitor the specified item until it reaches the user target price. When it does, read the FINAL total including shipping, tax and any pre-ticked extras, and remove anything that was added without being asked for (warranties, protection plans, insurance). Check the total against the user spending limits: below the auto-buy limit, complete the purchase; above it, request one approval. Never exceed the per-purchase or monthly cap, never substitute a different item, size or color, and always report the exact final total and what was bought.' },

  /* ---- More standing work. Each one is here because somebody would genuinely
     pay to stop doing it by hand, and each carries the concrete instruction the
     runner executes. Nothing here claims an action the runner cannot take: it
     researches, watches, compares and drafts. Where a job needs a connected
     account to be true, `needs` says so and the card refuses to pretend. ---- */

  { id:'price_protect', cat:'Money', icon:'💳', title:'Refund chaser & price protection', needs:'Email, Web research', on:false,
    desc:'Most shops quietly refund the difference if the price drops within a window of your purchase, and almost nobody claims it. AMV re-checks what you bought, finds the drops that are still claimable, and writes the claim.',
    prompt:'From recent order confirmation emails, list what the user bought, the price paid, and the purchase date. Check the current price of each item at the same retailer. Where the price is now lower AND the retailer’s price-protection or return window is still open, report the item, the amount recoverable, the exact deadline, and draft the claim message. Ignore items outside the window. Never claim a refund is available without checking the retailer’s stated policy.' },

  { id:'bill_negotiate', cat:'Money', icon:'📞', title:'Bill negotiation prep', needs:'Email, Web research', on:false,
    desc:'Finds the bills where you are paying above the going rate - broadband, mobile, insurance, streaming - looks up what new customers are offered right now, and writes the script that actually gets the discount.',
    prompt:'From bills and receipts in the user mail, identify their recurring bills and the amount paid for each. Research the current new-customer and retention pricing for the same service and comparable providers. For each bill where the user is paying materially above market: state what they pay, what is available now, the annual saving, and write the exact script to use with retentions, including the competing offer to cite. Only include bills you have real evidence of.' },

  { id:'tax_catch', cat:'Money', icon:'🧾', title:'Deductible expense catcher', needs:'Email', on:false,
    desc:'Deductions get lost because nobody tags them in January. AMV watches receipts all year, files the ones that count, and hands you an organized list instead of a shoebox in April.',
    asks:{ q:'What is your tax situation?', ph:'Country, whether employed or self-employed, and anything relevant - e.g. "UK, self-employed, work from home two days a week"' },
    prompt:'Review receipts and invoices since the last run. Identify expenses that are plausibly deductible for the user’s stated situation: work equipment, software, professional subscriptions, mileage, home office, education, charitable giving. For each: date, merchant, amount, and which category it likely falls under. Keep a running annual total. State clearly that this is organisation, not tax advice, and never assert an expense is deductible when the rules depend on facts you do not have.' },

  { id:'rate_watch', every:'weekly', cat:'Money', icon:'🏦', title:'Savings rate & refinance watch', needs:'Web research', on:false,
    desc:'Your savings sit at a rate the bank quietly cut, and your mortgage or loan may now be beatable. AMV tracks both against the live market and tells you the moment moving is worth the paperwork.',
    asks:{ q:'What rates should I track?', ph:'What you hold or are looking at - e.g. "5-year fixed mortgage, UK, and my savings account paying 3.1%"' },
    prompt:'Compare the user’s stated savings rate and loan or mortgage rate against current market rates from real providers. Report: the rate they hold, the best comparable rate available now, the annual difference in money, and whether the switching cost is worth it. Flag it only when the gap is genuinely material. Name the providers and the date the rate was checked.' },

  { id:'insurance_reshop', cat:'Money', icon:'🛡️', title:'Insurance re-shop before renewal', needs:'Email, Web research', on:false,
    desc:'Insurers price-walk loyal customers every year. Before each renewal lands, AMV checks what the same cover costs elsewhere and gives you the number to quote back.',
    prompt:'Find upcoming insurance renewals in the user’s mail with the renewal date and premium. Research the current market price for equivalent cover. Report: the renewal quote, the best comparable price found, the saving, and the date by which they must act. Note any difference in cover so a cheaper price is not mistaken for a like-for-like one.' },

  { id:'salary_bench', every:'weekly', cat:'Work & career', icon:'📈', title:'Salary benchmark & timing', needs:'Web research', on:false,
    desc:'Tells you what your role pays in your market right now, whether you have fallen behind, and when the evidence is strong enough to ask - with the numbers to bring.',
    asks:{ q:'What is your role?', ph:'Job title, level, industry and location - e.g. "backend engineer, senior, fintech, Chicago"' },
    prompt:'Research current pay for the user’s role, level, industry and location using real posted ranges and published surveys. Report the range, the midpoint, where the user sits against it, and how it has moved since the last check. If they are below market, assemble the specific evidence to use in a conversation. Cite where each figure came from and its date. Never invent a figure.' },

  { id:'recruiter_triage', cat:'Work & career', icon:'🎯', title:'Recruiter inbound triage', needs:'Email, Web research', on:false,
    desc:'Most recruiter mail is noise and one message a year is life-changing. AMV reads every one, researches the company behind it, and surfaces only the ones actually worth a reply - with the reply written.',
    asks:{ q:'What are you looking for?', ph:'Role, level, location, salary floor, and what you would refuse - e.g. "backend, senior, remote UK, 80k+, no on-call"' },
    prompt:'Review recruiter and hiring outreach received since the last run. For each: the company, the role, the stated or researched pay range, funding and stability signals, and how well it matches the user’s stated goals. Rank them and recommend which deserve a reply. Draft a short reply for the ones worth answering and a polite decline for the rest. Say plainly when a range is not stated rather than guessing one.' },

  { id:'employer_health', every:'weekly', cat:'Work & career', icon:'🩺', title:'Employer & industry health watch', needs:'Web research', on:false,
    desc:'The signals before a bad quarter are public - hiring freezes, funding news, exec departures, layoff reports, customer losses. AMV watches them for your employer and your industry so you are early rather than surprised.',
    asks:{ q:'Which employer and industry?', ph:'The company name and the sector it operates in' },
    prompt:'Monitor public signals for the user’s employer and industry: funding and earnings news, hiring or freeze signals, layoff reports, leadership departures, notable customer wins or losses, analyst and press coverage. Report what changed and what it plausibly indicates, separating confirmed facts from interpretation. Do not speculate about individuals. If nothing meaningful changed, say so.' },

  { id:'interview_pack', cat:'Work & career', icon:'🎓', title:'Interview prep pack', needs:'Calendar, Email, Web research', on:false,
    desc:'Before each interview: the company’s real position, who is interviewing you and what they work on, the questions this company actually asks, and answers built from your own history.',
    prompt:'For each upcoming interview found in the calendar or mail: research the company’s business, recent news, products and competitors; identify the interviewer’s role and public professional background only; gather commonly reported interview questions for this company and role. Draft answers grounded in the user’s real experience, and list strong questions for them to ask. Never fabricate a fact about an interviewer and never use non-professional personal information.' },

  { id:'portfolio_fresh', cat:'Work & career', icon:'✒️', title:'Keep my CV and profile current', needs:'Email, Calendar', on:false,
    desc:'Your best work disappears because you update your CV once every three years. AMV notices what you actually shipped and drafts the line for it while you still remember the numbers.',
    prompt:'From recent mail and calendar activity, identify accomplishments worth recording: projects completed, things shipped, measurable results, new responsibilities, tools learned, recognition received. For each, draft one strong CV or profile line in the user’s voice with the concrete result. Maintain the running list between runs. Only include achievements with real evidence.' },

  { id:'churn_signals', cat:'Growing a business', icon:'📉', title:'Customer churn early warning', needs:'Email', on:false,
    desc:'Customers rarely announce they are leaving - they go quiet, complain twice, then cancel. AMV spots the pattern in your own mail while there is still time to save the account.',
    prompt:'Review customer correspondence for churn risk signals: unanswered complaints, repeated issues, negative sentiment shift, reduced contact frequency, questions about cancellation, contract or billing disputes. For each at-risk account: who, the evidence, the risk level, and a specific recommended intervention. Draft the outreach message. Only flag accounts with real evidence in the thread.' },

  { id:'review_watch', cat:'Growing a business', icon:'⭐', title:'Review & reputation monitoring', needs:'Web research', on:false,
    desc:'Watches every place people rate you - app stores, Google, Trustpilot, forums - and tells you the moment something needs a response, with the response drafted.',
    asks:{ q:'Which business or product?', ph:'The name as it appears publicly, and where it is reviewed - Google, Trustpilot, an app store' },
    prompt:'Check public review and rating sources for the user’s business or product. Report new reviews since the last run: rating, platform, what the reviewer actually said, and whether it needs a response. Identify recurring themes across reviews rather than listing them one by one. Draft a specific, non-generic reply for anything negative or unfair. Report the rating trend honestly, including when it is falling.' },

  { id:'lead_triage', cat:'Growing a business', icon:'📥', title:'Inbound lead triage & first reply', needs:'Email, Web research', on:false,
    desc:'Speed of first reply decides who wins the deal. AMV qualifies every inbound enquiry, researches who is asking, and has the reply written before you have opened the message.',
    asks:{ q:'Who is a good lead for you?', ph:'What you sell, to whom, deal size, and what disqualifies one' },
    prompt:'Review inbound enquiries since the last run. For each: who they are, the company and its size or funding where publicly known, what they are asking for, and how well it fits the user’s stated ideal customer. Rank by likely value. Draft a specific first reply for each that answers their actual question and proposes a clear next step. Do not invent details about a company you could not verify.' },

  { id:'rank_watch', every:'weekly', cat:'Growing a business', icon:'🔎', title:'Search ranking & visibility watch', needs:'Web research', on:false,
    desc:'Tells you when you move up or down for the searches that bring you customers, and who overtook you - so a slow slide gets caught in a week rather than a quarter.',
    asks:{ q:'Which site and which keywords?', ph:'Your domain, then the search terms you want to rank for, one per line' },
    prompt:'Check the user’s current search visibility for their specified keywords. Report position changes since the last run, which competitors moved, and what visibly changed on the pages that overtook them. Focus on the keywords that matter commercially rather than vanity terms. State the date and method of the check, and be explicit about the limits of what a single check can show.' },

  { id:'pricing_diff', every:'weekly', cat:'Growing a business', icon:'🏷️', title:'Competitor pricing page diff', needs:'Web research', on:false,
    desc:'A competitor changing price, adding a tier, or quietly removing a limit is the single most useful thing to know in your market - and it is never announced.',
    asks:{ q:'Whose pricing pages?', ph:'One competitor pricing page URL per line' },
    prompt:'Check each competitor pricing page against its previous state. Report only real changes: price moves, new or removed tiers, changed limits or included features, new trial or discount terms, and altered positioning language. Quote the before and after. If a page could not be read, say which one and why rather than reporting no change.' },

  { id:'ad_waste', cat:'Growing a business', icon:'🔥', title:'Ad spend waste check', needs:'Email', on:false,
    desc:'Campaigns keep spending long after they stop working. AMV reads your own reporting mail and tells you what to switch off and what to move the money to.',
    prompt:'From advertising reports and billing emails, summarize spend and results per campaign since the last run. Identify what is spending without returning, what is improving, and where cost per result has risen. Recommend specific pauses or budget shifts with the money involved. Use only figures present in the reports - never estimate performance.' },

  { id:'regulation_watch', every:'weekly', cat:'Watching the world', icon:'⚖️', title:'Rule & regulation change watch', needs:'Web research', on:false,
    desc:'A rule change in your industry, your visa category, your profession or your tax situation is expensive to learn late. AMV watches the sources that publish them and translates what it means for you.',
    asks:{ q:'What rules affect you?', ph:'Your industry, where you operate, and which regulators or rules you care about' },
    prompt:'Monitor official and regulatory sources relevant to the user’s stated situation and industry for genuine changes: new rules, amendments, consultations, enforcement dates and guidance updates. For each: what changed, the date it takes effect, who it applies to, and the practical implication for the user. Link the official source. Distinguish clearly between a proposal and something in force, and state that this is information, not legal advice.' },

  { id:'breach_watch', cat:'Watching the world', icon:'🔐', title:'Breach & exposure watch', needs:'Web research', on:false,
    desc:'When a service you use is breached, you usually find out from the news months later. AMV watches for reported breaches at the companies you actually have accounts with and tells you exactly what to change.',
    asks:{ q:'Which services do you have accounts with?', ph:'One per line - just the service names, never your passwords. e.g. "Dropbox, LinkedIn, my bank"' },
    prompt:'Check for newly reported data breaches and security incidents at the services the user has accounts with. For each: the service, the date reported, what data was reportedly exposed, and the specific action to take now such as changing a password or enabling two-factor. Rely only on publicly reported, attributed incidents and say when a report is unconfirmed. Never ask for or handle the user’s passwords.' },

  { id:'tool_advisories', every:'weekly', cat:'Watching the world', icon:'🛠️', title:'Updates & advisories for your tools', needs:'Web research', on:false,
    desc:'Breaking changes, deprecations, price changes and security advisories for the software you depend on - filtered to the versions you actually run.',
    asks:{ q:'Which tools do you depend on?', ph:'One per line, with versions where you know them - e.g. "Node 20, Postgres 15, Cloudflare Workers"' },
    prompt:'Monitor release notes, changelogs, advisories and status pages for the tools and services the user depends on. Report only what affects them: breaking changes, deprecations with deadlines, security advisories, pricing or plan changes, and outages with a pattern. Give the version affected and the action required. Skip routine minor releases with no impact.' },

  { id:'person_watch', cat:'Watching the world', icon:'👤', title:'Follow what someone publishes', needs:'Web research', on:false,
    desc:'Track the public output of the people who move your field - founders, researchers, investors, analysts - so you read the important post the day it lands rather than a month later.',
    asks:{ q:'Whose public work should I follow?', ph:'Names, one per line, with where they publish if you know it' },
    prompt:'Monitor the public professional output of the named people: posts, articles, talks, papers, interviews and public announcements. Report only genuinely new items: who, what, why it matters to the user, and the link. Use public professional sources only - never track private activity, location, or personal life, and decline any name where the request is clearly personal rather than professional.' },

  { id:'brand_watch', cat:'Watching the world', icon:'📣', title:'Mentions & impersonation watch', needs:'Web research', on:false,
    desc:'Finds where your name or brand is being discussed, and catches fake accounts, copied sites and lookalike domains trading on it.',
    asks:{ q:'What name should I search for?', ph:'Your name, brand or product exactly as people write it, plus any spellings to include' },
    prompt:'Search for new public mentions of the user’s name, brand or product across the web, news, forums and social platforms. Separate genuine discussion from impersonation: fake profiles, copied content, lookalike domains, misuse of the name. For real mentions, report sentiment and whether a response is warranted. For suspected impersonation, report the evidence and the reporting route for that platform.' },

  { id:'paper_digest', every:'weekly', cat:'Learning', icon:'📚', title:'New research in my field', needs:'Web research', on:false,
    desc:'The handful of genuinely new papers, releases and findings in your field each week, explained in plain language, with why each one matters and whether it is worth your time.',
    asks:{ q:'What field should I follow?', ph:'The subject, and any specific journals, authors or topics' },
    prompt:'Find genuinely new publications, preprints and significant releases in the user’s stated field since the last run. For each: the title, who published it, what is actually new about it in plain language, why it matters, and whether it is worth reading in full. Prioritise substance over popularity. If the week was quiet, report the two best things rather than padding the list.' },

  { id:'deadline_radar', cat:'Learning', icon:'📅', title:'Assignment & deadline radar', needs:'Email, Calendar', on:false,
    desc:'Every due date pulled out of syllabi, portals and mail into one honest picture - what is due, how long each will really take, and what to start today to not be up at 3am.',
    prompt:'Collect every upcoming deadline from mail and calendar: assignments, exams, applications, submissions and their weightings where stated. Build a single ordered list with dates. Estimate realistic effort for each, identify what must start now to be finished on time, and flag any week where the load is genuinely not achievable. Only include deadlines you have evidence for.' },

  { id:'study_drill', cat:'Learning', icon:'🧠', title:'Spaced revision on a schedule', needs:'Nothing', on:false,
    desc:'Sends you the right questions at the right interval on whatever you are learning, harder on the things you keep getting wrong - the method that actually makes things stick.',
    asks:{ q:'What are you studying?', ph:'Subject, level, and the topics you keep getting wrong' },
    prompt:'Maintain a spaced repetition schedule over the user’s stated study material. Each run, produce the set of questions due now, weighted toward material they have previously answered incorrectly or not seen recently. Include the answers separately so they can self-test first. Track which items are due next and adjust the interval based on reported performance.' },

  { id:'reading_queue', cat:'Learning', icon:'📖', title:'Turn my saved links into a briefing', needs:'Email', on:false,
    desc:'The articles you saved and never read, condensed into one briefing with the actual argument of each - so the reading list stops being a guilt pile.',
    prompt:'Take the user’s saved or emailed links since the last run. For each: the core argument or finding in a few sentences, what is genuinely useful in it, and whether the full piece is worth reading. Group related items and note where two sources disagree. If a link cannot be read, say which one rather than summarising from the title.' },

  { id:'health_admin', cat:'Health', icon:'🩺', title:'Prescriptions, appointments and screenings', needs:'Email, Calendar', on:false,
    desc:'Refills before you run out, appointments you meant to book, and the routine screenings that quietly slip by years - tracked so none of it depends on remembering.',
    prompt:'Track health admin from mail and calendar: prescription refill timing, upcoming and overdue appointments, referrals not yet booked, and routine screenings due based on stated intervals. Report what needs booking now and what is coming. Include the practice or pharmacy contact where it appears in the correspondence. This is scheduling and organisation only - never give medical advice, never interpret a symptom or result, and say clearly that clinical questions go to their clinician.' },

  { id:'appt_prep', cat:'Health', icon:'📋', title:'Appointment prep notes', needs:'Calendar, Email', on:false,
    desc:'Walks you into an appointment with the timeline written down and the questions you meant to ask - because you always remember them in the car afterwards.',
    asks:{ q:'What is the appointment?', ph:'What kind, when, and what you want out of it. Only what you are happy for AMV to hold.' },
    prompt:'Before an upcoming medical or professional appointment, assemble what the user has already recorded: the timeline of what they noted and when, previous correspondence, current medications or arrangements they have mentioned, and outstanding questions from last time. Produce a one page prep note and a list of questions to ask. Record only what the user has stated - never infer, diagnose, interpret results, or suggest treatment.' },

  { id:'habit_pulse', cat:'Health', icon:'🏃', title:'Training plan that adapts', needs:'Nothing', on:false,
    desc:'Adjusts the plan to the week you actually had rather than the one you intended - so missing two sessions changes the plan instead of ending it.',
    prompt:'Review the user’s reported activity since the last run against their stated goal. Report what actually happened, adjust the coming week to fit their real availability and recent load, and progress or ease the plan accordingly. Be honest when a goal has drifted out of reach on the current trajectory and say what would bring it back. Never give medical advice or interpret pain or injury - direct those to a professional.' },

  { id:'home_seasonal', cat:'Home & life', icon:'🏠', title:'Home maintenance by season', needs:'Calendar', on:false,
    desc:'The jobs that cost thousands when skipped - boiler, gutters, filters, damp checks, roof, drains - scheduled at the right time of year for where you actually live.',
    prompt:'Maintain a seasonal home maintenance schedule for the user’s property type and climate. Each run, report what is due now, why it matters, roughly what it costs to do versus what neglecting it costs, and whether it is a job for them or a trade. Track what has already been done so nothing repeats needlessly.' },

  { id:'car_admin', cat:'Home & life', icon:'🚗', title:'Vehicle service, tax and inspection', needs:'Email, Calendar', on:false,
    desc:'Service intervals, inspection and tax dates, warranty expiry and open recalls for your actual vehicle - with enough warning to book rather than scramble.',
    prompt:'From reminders and renewal notices in the user mail, track vehicle admin: service intervals against mileage or date, inspection and tax renewal dates, insurance renewal, warranty expiry, and any open safety recalls for the specific make, model and year. Report what is due in the next 90 days and what needs booking now. Check recalls against official sources only.' },

  { id:'flight_watch', cat:'Home & life', icon:'✈️', title:'Flight price watch for a real trip', needs:'Web research', on:false,
    desc:'Watches your actual route and dates, learns what a normal fare looks like, and tells you when a price is genuinely good - including when to rebook a refundable fare cheaper.',
    sample:['Your route, your dates. Watching for 3 weeks now.','Best right now: 214 return, direct. The usual since watching began has been 260-290.','This is the lowest it has been. Not by a little - by 46.','Flying out a day earlier saves another 31, if that works.','You already hold a refundable fare at 268. Rebooking now saves 54.'],
    asks:{ q:'Which trip?', ph:'Route and dates - e.g. "Chicago to Lisbon, leaving 14-16 June, back 21-23 June"' },
    prompt:'Track fares for the user’s specified routes and date ranges. Report the current best fare, the airline, how it compares to what has been seen since watching began, and whether to book now or wait. Include nearby dates or airports when they are materially cheaper. If the user already holds a refundable booking and the fare has dropped, state the rebooking saving explicitly. Never present a fare you have not actually seen.' },

  { id:'move_watch', every:'weekly', cat:'Home & life', icon:'📍', title:'Rent, property and neighborhood watch', needs:'Web research', on:false,
    desc:'Watches what places like yours actually rent and sell for, and what is happening where you live or want to live - so a lease renewal or an offer is a decision made with numbers.',
    asks:{ q:'Which area and what kind of place?', ph:'e.g. "2-bed apartment, your neighborhood, renting"' },
    prompt:'Track the local market for the user’s stated area and property type: current asking and achieved prices or rents for comparable places, how they have moved, time on market, and relevant local developments such as transport, planning or school changes. Report what it means for a renewal, a purchase or a sale decision. Use real listings and cite the date checked.' },

  { id:'gift_radar', cat:'Home & life', icon:'🎁', title:'Birthdays, occasions and gift ideas', needs:'Calendar, Email, Web research', on:false,
    desc:'Warns you far enough ahead to do something good rather than something panicked, with ideas built from what that person has actually said they like, and the delivery cut-off.',
    sample:['Your sister\'s birthday is in 3 weeks. Long enough to do something good.','She mentioned twice in messages that her camera strap is falling apart.','A good replacement is 38 and ships in 4 days, so the last safe order date is the 19th.','Two other ideas grounded in things she has actually said, both under your 50.','Nothing here is invented - each one traces back to something she wrote.'],
    asks:{ q:'Who and when?', ph:'Names, dates, roughly what you would spend, and anything they have said they like' },
    prompt:'Track upcoming birthdays, anniversaries and occasions from the calendar and correspondence. For each, warn far enough ahead to act, and suggest specific ideas grounded in things that person has actually mentioned or shown interest in, within the user’s stated budget. Include current price, where to get it, and the delivery cut-off date to arrive in time. Never invent a preference the user has no record of.' },

  { id:'doc_expiry', cat:'Home & life', icon:'🛂', title:'Passport, visa and travel eligibility', needs:'Email, Calendar, Web research', on:false,
    desc:'Catches the trap that ruins trips: a passport too close to expiry for the country you booked, a visa or permit needing renewal, an entry rule that changed since you last flew.',
    sample:['You have a flight booked. Your passport is a problem.','It expires in 4 months. Spain requires 3 months\' validity beyond your return date - you clear it by 11 days.','That is too close. A delayed return or a date change breaks it.','A renewal takes about 3 weeks at the moment, so start before the 8th.','Entry rules checked against the government source today. These change without notice.'],
    prompt:'Using the travel found in their mail and calendar, check the user’s travel documents against that planned travel: passport expiry versus each destination’s validity requirement, visa or permit status and renewal timing, and current entry requirements for those destinations. Report anything that would block travel, how long the fix takes, and the latest date to start it. Verify entry rules against official government sources and give the date checked, since these change without notice.' },

  /* ---- SCHOOL ------------------------------------------------------------

     Written for the person who has six subjects, four deadlines, a part-time
     job and no system - which is most students, and the audience with the most
     to gain from work that happens while they sleep.

     One rule shapes every prompt below, and it is not negotiable: AMV prepares,
     checks, explains and drafts. It never submits anything, never sits an
     assessment, and never hands over work to be passed off as the student's
     own. A tool that does somebody's homework gets the student expelled and
     gets AMV blocked by every school district that notices - so the jobs that
     touch coursework produce a plan, a critique, or a study aid, and say so on
     their face. That is also the more useful product: a graded-quality draft
     they did not write teaches nothing and is detectable; a list of exactly
     what is weak in the draft they DID write is worth more than the grade. */

  { id:'school_week', every:'weekly', cat:'Learning', icon:'📅', title:'Plan my whole school week', needs:'Web research', on:false,
    desc:'Every Sunday, turns everything due into an actual plan: what to do on which day, how long each piece really takes, and what to start early so nothing lands on top of everything else.',
    sample:['MON - Bio lab writeup (~50 min). Start now, it is the only thing due Wed.','TUE - History essay: outline + find 3 sources (~40 min). Do NOT start writing yet.','WED - History essay draft (~90 min). This is the big one this week.','THU - Light day. Catch up if Wednesday slipped.','Heads up: your history essay and chemistry test are both Friday. Move the essay draft to Wednesday or you will be doing both on Thursday night.'],
    asks:{ q:'What is due, and when?', ph:'One per line: what it is, which subject, when it is due - e.g. "History essay, Friday 14th". Include anything else that eats your week.' },
    prompt:'Build the user a plan for the coming week from the assignments, tests and commitments they have listed. For each piece of work: which day to do it, roughly how long it takes, and what has to happen first. Put heavier work earlier than its deadline and say why. Explicitly flag any day where two significant things collide, and propose the specific move that fixes it. Be realistic about time - a plan they cannot follow is worse than none. Never invent a deadline they have not given you.' },

  { id:'deadline_rescue', cat:'Learning', icon:'🚨', title:'Catch a deadline before it catches me', needs:'Web research', on:false,
    desc:'Checks every day for work that is due soon and has not been started, and tells you the last realistic moment to begin it - while there is still time to do it properly.',
    sample:['DUE IN 2 DAYS - English essay, not started. Start tonight: this one needs about 3 hours and you have 2 evenings.','DUE IN 5 DAYS - Physics problem set. Fine to leave until Wednesday.','You have nothing due tomorrow. This is the best night this week to get ahead on the essay.'],
    asks:{ q:'What is due, and what have you started?', ph:'One per line: what it is, when it is due, and whether you have started it' },
    prompt:'Review the user’s upcoming deadlines against what they have said is done. For anything not started, work out the last realistic day to begin it given how long that kind of work takes them, and say so plainly. Rank by urgency, not by due date - a big piece due in a week can be more urgent than a small one due tomorrow. Say clearly when there is nothing urgent, rather than manufacturing pressure. Never guess at a deadline you were not told about.' },

  { id:'work_check', cat:'Learning', icon:'🔎', title:'Check my work before I hand it in', needs:'Web research', on:false,
    desc:'You paste in what you wrote; AMV marks it the way your teacher would - what is weak, what is missing against the rubric, what would lose marks - and explains each one so the next piece is better.',
    sample:['Against the rubric you gave me, this is around a B.','WHAT COSTS YOU MARKS: paragraphs 2 and 4 make a claim with no evidence. The rubric weights evidence at 30%.','MISSING: the question asks you to evaluate, and you have described. Add a sentence to each paragraph saying which side is stronger and why.','STRONG: your introduction sets up the argument clearly - keep doing that.','Fix the two evidence gaps and this moves up a band.'],
    asks:{ q:'What are you working on, and what is it marked against?', ph:'Paste the task or question and the rubric or mark scheme. Paste your own draft here too when you have one.' },
    prompt:'The user will give you their own finished work and, where they have it, the rubric or task description. Assess it the way their marker would: what it currently earns and why, what specifically costs marks, what the task asks for that is missing, and what is genuinely good. Quote the exact sentence for every point so they can find it. Explain the reason behind each correction so the next piece improves. Do NOT rewrite their work for them and do NOT produce a version to hand in - the point is that they fix it themselves and understand why. If they ask you to write it for them, say plainly that you will not and offer the critique instead.' },

  { id:'study_coach', every:'daily', cat:'Learning', icon:'🧠', title:'Study coach that knows what I keep getting wrong', needs:'Web research', on:false,
    desc:'Tracks the questions you keep missing and builds each session around exactly those - with practice questions, worked answers, and a plain explanation of the thing you actually misunderstood.',
    sample:['You have now missed 4 questions on the same idea: which reactant runs out first.','THE MISUNDERSTANDING: you are comparing the amounts you started with, not the amounts the equation needs.','5 practice questions on exactly that, hardest last.','Worked answer to number 3, since that is the shape you got wrong twice.','You have not missed a mole-ratio question in two weeks. That one is done - dropping it.'],
    asks:{ q:'What are you studying, and what keeps going wrong?', ph:'Subject and level, then the topics or question types you keep losing marks on' },
    prompt:'Track which topics and question types the user keeps getting wrong across sessions. Build today’s session around the ones that are actually still weak, not the ones they are already good at. For each: name the specific misunderstanding rather than the topic, explain it plainly, then give practice questions with worked answers, hardest last. Drop topics they have consistently got right and say you are dropping them. Never claim they are improving unless the record shows it.' },

  { id:'exam_prep', cat:'Learning', icon:'📚', title:'Get me ready for this specific test', needs:'Web research', on:false,
    desc:'Works backwards from the test date: what to revise on which day, what is most likely to come up, and a practice set each session that gets harder as the date gets closer.',
    sample:['9 days until the test. Working backwards:','DAYS 9-7: the three topics you are weakest on. Learning, not revising.','DAYS 6-3: full practice questions under time. This is where marks are actually won.','DAYS 2-1: only what you got wrong in practice. No new material.','Most likely to appear, based on the syllabus weighting you gave me: titration calculations and reaction rates.'],
    asks:{ q:'Which test, and when?', ph:'Subject, date, what is on it, and which topics you are weakest on' },
    prompt:'Build a revision plan working backwards from the user’s test date. Front-load the topics they are weakest on and leave the last days for practice and correction only, never new material. Say which topics are most likely to be assessed and on what basis - syllabus weighting or past papers they have given you - and be explicit that it is a judgement, not a prediction. Include a practice set for each session, increasing in difficulty as the date approaches. Never claim to know what is on a specific test.' },

  { id:'morning_brief_student', every:'daily', cat:'Learning', icon:'☀️', title:'Morning briefing before school', needs:'Web research', on:false,
    desc:'One short thing to read before you leave: what is due today, what you need to bring, what is on later, and the single most useful thing you could do with your free period.',
    sample:['TODAY: history essay due period 4. It is in your drive, finished.','BRING: PE kit, calculator.','LATER: football 4pm - you will not get work done tonight, so use your free.','FREE PERIOD (p2): start the chemistry questions due Thursday. About 30 minutes of it.','Nothing else is urgent today.'],
    asks:{ q:'What does your week look like?', ph:'What is due and when, your timetable, and anything regular - clubs, work, training' },
    prompt:'Produce a short briefing the user reads before their day starts: what is due today, what they need to bring or prepare, what is scheduled later that will eat their evening, and the single most useful thing they could do with any free time they have. Keep it under 100 words - this is read walking out of the door. Say plainly when the day is light rather than filling space. Never invent a commitment they have not told you about.' },

  { id:'evening_brief_student', every:'daily', cat:'Learning', icon:'🌙', title:'Evening wrap-up and tomorrow', needs:'Web research', on:false,
    desc:'At the end of the day: what got done, what slipped, what tomorrow actually looks like, and the one thing worth doing tonight if you only do one thing.',
    sample:['DONE TODAY: chemistry questions, history reading.','SLIPPED: the math problem set. It is now due in 2 days and untouched.','TOMORROW: double free in the afternoon - that is enough for the whole math set.','IF YOU DO ONE THING TONIGHT: read the essay question so it is in your head. 5 minutes.'],
    asks:{ q:'What does your week look like?', ph:'What is due and when, your timetable, and anything regular that eats your evenings' },
    prompt:'Close out the user’s day: what they finished, what slipped and what that now means for its deadline, what tomorrow looks like, and the single highest-value thing they could do tonight - including "nothing, go to bed" when that is the honest answer. Be brief and specific. Never guilt them about what slipped; state the consequence and the fix.' },

  { id:'application_help', cat:'Learning', icon:'🎓', title:'University and job applications, tracked', needs:'Web research', on:false,
    desc:'Keeps every application in one place with its real deadline, what each one still needs from you, and honest feedback on your personal statement - written by you, made better by you.',
    sample:['4 applications open. Nearest deadline: 12 days.','NEEDS FROM YOU: reference request not sent (this is the one that will bite - ask this week).','PERSONAL STATEMENT: paragraph 3 is the strongest thing in it. Paragraph 1 says what you want, not what you have done - it is the weakest opening and it is the first thing they read.','2 of the 4 ask for the same essay with a different word count. Write the long one, cut it down.'],
    asks:{ q:'What are you applying to?', ph:'One per line: where, the deadline, and what it still needs from you' },
    prompt:'Track each of the user’s applications: the real deadline, what has been submitted, and what is still outstanding - especially items that depend on other people, such as references, which need the most warning. Where they share their own drafted statement, give specific feedback: which paragraph is strongest, which is weakest and exactly why, and what a reader sees first. Point out where one piece of writing can be reused across applications. Do NOT write their statement for them - it has to be theirs, and admissions readers can tell. Say so if they ask.' },

  { id:'group_project', cat:'Learning', icon:'👥', title:'Keep a group project from falling apart', needs:'Web research', on:false,
    desc:'Tracks who agreed to do what and by when, notices what has gone quiet, and drafts the message that chases it without starting an argument.',
    sample:['4 parts, 3 people. Due in 6 days.','ON TRACK: your section, Maya’s research.','GONE QUIET: Sam’s slides - agreed 5 days ago, nothing since, and the presentation cannot be assembled without them.','DRAFT MESSAGE TO SAM: short, no blame, asks for a yes/no on Thursday so there is still time to cover it.','If Sam cannot, the fastest fix is Maya takes 2 slides and you take 1.'],
    asks:{ q:'Who is doing what, by when?', ph:'One per line: person, their part, the date they agreed - and when the whole thing is due' },
    prompt:'Track a group project: who agreed to what, by when, and what has actually been delivered. Identify what has gone quiet and what it blocks. Draft a short, friendly chase message for anything overdue - no blame, and asking for a clear yes or no by a specific day so there is time to react. Where something looks likely to fail, propose the concrete redistribution that saves the deadline. Never accuse anyone of anything you cannot evidence from what the user has told you.' },

  { id:'reading_digest', cat:'Learning', icon:'📖', title:'Make sense of a long reading', needs:'Web research', on:false,
    desc:'Turns a long chapter, paper or set text into the argument, the evidence and the bits that will actually be examined - plus the questions to test whether you understood it.',
    sample:['THE ARGUMENT: the author claims the revolution was economic before it was political.','THE EVIDENCE THEY USE: grain prices, tax records, three contemporary letters.','THE WEAK POINT: the letters are all from one city, which they acknowledge in a footnote and then ignore.','LIKELY EXAM ANGLE: "to what extent" questions want you to weigh this against the political reading.','5 questions to check you actually understood it - answers below, do not look first.'],
    asks:{ q:'What do you have to read?', ph:'Paste the text, or give the title, author and chapter - plus the question you are reading it for' },
    prompt:'Take a long text the user has to read and give them: the central argument in one sentence, the evidence used to support it, the weakest part of that argument, and which aspects are most likely to be examined and how. Then give comprehension questions with answers held separately, so they can test themselves honestly. This is a companion to the reading, not a replacement for it - say so, and do not summarize so completely that reading it becomes pointless.' },

  { id:'life_admin_student', every:'weekly', cat:'Home & life', icon:'📎', title:'The boring admin nobody reminds you about', needs:'Web research', on:false,
    desc:'The forms, renewals, sign-ups and appointments that have no deadline until suddenly they do - tracked, with the one that matters this week at the top.',
    sample:['THIS WEEK: driving theory test slots for your area open Thursday and go within a day.','SOON: student finance opens in 3 weeks. It takes about an hour and needs your parents’ income details - ask now, not then.','NOT URGENT: passport has 14 months left. Renew before the 9-month mark for the trip you mentioned.'],
    asks:{ q:'What do you need to keep on top of?', ph:'Renewals, forms, applications, appointments - with dates where you know them' },
    prompt:'Track the administrative tasks the user has told you about: renewals, applications, registrations, appointments and forms. Surface the one or two that genuinely need action this week and say exactly what to do. For anything requiring other people or documents, warn early enough that gathering them is possible. Be explicit about what is NOT urgent, so the list stays trustworthy. Never invent a deadline - if you are unsure of a date, say you are unsure and how to check.' },

  { id:'wellbeing_check', every:'weekly', cat:'Health', icon:'🌱', title:'Notice when the week is too much', needs:'Web research', on:false,
    desc:'Looks at the shape of your week - deadlines, commitments, sleep you said you got - and says plainly when it is too much, and which single thing to move.',
    sample:['This week has 3 deadlines, 2 evening commitments and you have said you are getting under 6 hours.','That is not a sustainable week, and Thursday is the day it breaks.','THE ONE THING TO MOVE: the history reading. It is due Friday but nothing depends on it - do it Saturday.','Nothing else here is optional, so moving one thing is the whole fix.','This is an observation about your schedule, not health advice - if you are struggling, talk to someone you trust.'],
    asks:{ q:'What does a normal week look like?', ph:'Your commitments, roughly what sleep you get, and anything that is currently too much' },
    prompt:'Look at the shape of the user’s week - deadlines, commitments, and anything they have told you about sleep or energy - and say plainly whether it is realistic. Name the specific day it becomes too much and why. Recommend moving exactly ONE thing, chosen because nothing else depends on it, rather than producing a list of lifestyle suggestions. Be direct and kind. You are commenting on a schedule, not giving medical or mental health advice: never diagnose, never suggest treatment, and always close by pointing to a real person if they say they are struggling.' },

  { id:'money_student', every:'weekly', cat:'Money', icon:'💰', title:'Where my money actually went', needs:'Web research', on:false,
    desc:'The honest weekly number: what you spent, what it was mostly on, what is coming out next week, and whether that leaves enough.',
    sample:['SPENT THIS WEEK: 47. Most of it - 31 - was food out across 6 days.','COMING OUT NEXT WEEK: phone (12) and the gym (20).','That leaves you short for the concert ticket on the 14th unless something changes.','The 6 days of food out is the whole gap. That is the number, not a judgement.'],
    asks:{ q:'What comes in and what goes out?', ph:'Regular income, regular payments, and what you are saving for' },
    prompt:'Report what the user spent over the period from what they have recorded: the total, the largest category with the actual number, and what regular payments are due next. State plainly whether what remains covers what is coming. Give the numbers and the arithmetic without moralising about the spending. Never estimate a figure you have not been given - say what is missing instead.' },

  { id:'opportunity_student', every:'weekly', cat:'Learning', icon:'🎯', title:'Things I could actually get', needs:'Web research', on:false,
    desc:'Hunts for scholarships, competitions, summer programs, internships and free courses you genuinely qualify for - with the deadline and the direct link, and nothing you cannot enter.',
    sample:['4 open now that you qualify for. 2 close within a month.','Regional essay competition - 500 prize, closes in 18 days, needs 1500 words on a set theme. You have written on this before.','Summer research programme - free, closes in 5 weeks, needs a teacher reference. Ask now.','Dropped 11 others: age, region or grade requirements you do not meet. No point showing you those.'],
    asks:{ q:'Who are you, for eligibility?', ph:'Age, country and region, year group or level, what you study, and the kinds of things you want' },
    prompt:'Search the live web for opportunities the user genuinely qualifies for given their age, location, year group and interests: scholarships, competitions, summer programs, internships, bursaries and free courses. Only include ones open now with a future deadline. For each: what it is, what it gives, what it requires, the deadline, and the direct link. Explicitly say how many you excluded and why, so they trust that the list is filtered rather than padded. Flag anything needing a reference or a document early, since those depend on other people.' },

  { id:'inbox_cleanup', every:'daily', cat:'Inbox & calendar', icon:'🧹', title:'Clear the noise out of my inbox', needs:'Email', on:false,
    desc:'Separates the handful of messages that actually need you from the pile that does not, drafts the replies, and never sends anything without you.',
    sample:['3 need you today. 41 do not.','1. Teacher asking to reschedule Thursday - needs a yes or no. Draft ready.','2. Application portal: reference outstanding. Draft chaser to Mr Ahmed ready.','3. Bank: card expiring. 2 minutes, do it on your phone.','The other 41 are newsletters, receipts and notifications. Nothing in them needs a reply.'],
    prompt:'Sort the user’s recent mail into the few messages that genuinely need them and everything that does not, and say both counts. For each that needs action: who it is from, what they want, and how long it will take. Draft a ready-to-send reply for each one. Nothing is sent - say plainly at the top of each draft that it is ready and has NOT been sent. Never describe a message you cannot actually see.' },

  { id:'social_plan', cat:'Home & life', icon:'🎉', title:'Actually make the plan happen', needs:'Calendar, Web research', on:false,
    desc:'Takes the group chat that has said "we should do something" for three weeks and turns it into a date that works for everyone, with the thing booked or the tickets found.',
    sample:['5 people, 3 weeks of nobody picking a date.','Only 2 evenings work for everyone: Friday 14th and Saturday 22nd.','The 14th is 3 days before your test. The 22nd is clear.','Tickets for the 22nd: 3 left at 18, going up at the door.','Draft message with one date and one link, so it needs a yes rather than a discussion.'],
    prompt:'Turn a stalled plan into a decision. From the availability the user gives you, find the dates that genuinely work for everyone and say how few there are. Rule out any that collide with their own commitments and say why. Research the specific option - venue, tickets, cost, availability - with real current prices and links. Draft a message that proposes ONE date and ONE option, because a group answers a yes/no and does not answer an open question. Never claim to have booked anything.' },

  /* ---- MAKING THINGS -----------------------------------------------------

     For somebody who makes things - videos, music, art, writing, clothes,
     games - rather than somebody selling something. The distinction matters:
     the business jobs above optimise a funnel, and none of them are any use to
     a seventeen year old with an editing app and an idea.

     All three run on live research plus what the person tells AMV, and all
     three stop where the work starts. AMV can tell you what is landing and why,
     and it can be honest about a draft. It cannot make the thing, and a job
     that pretended to would produce something nobody wants to watch. */

  { id:'creative_ideas', every:'weekly', cat:'Making things', icon:'💡', title:'Ideas worth making this week', needs:'Web research', on:false,
    desc:'Three specific things worth making this week, from what is genuinely landing in your corner right now - each with the angle and the opening line, and an honest note on which is the risky one.',
    asks:{ q:'What do you make, and for whom?', ph:'The format and the subject - e.g. "short videos about skateboarding tricks, for beginners" or "acoustic covers on TikTok"' },
    sample:['3 ideas, from what is actually landing in your corner this week - not what landed last year.','1. The "I tried it badly first" angle. Beginner-fail openings are outperforming clean demos on this topic right now, roughly 2x on saves.','   Hook: "Everyone shows you the landing. Here is the 40 attempts."','2. A 20-second answer to the question three big accounts got asked this week and none of them answered.','3. The contrarian one: the trick everybody teaches first is the one you should learn third. Riskiest of the three, most likely to travel.','Skipped 9 other trends - wrong audience, or already saturated by people with 100x your reach.'],
    prompt:'Research what is genuinely performing right now in the user’s stated format and subject, this week rather than in general. Propose three specific things they could make, each with the angle, an opening hook written out, and one line on why this angle now - grounded in something you actually found, which you name. Say how many other trends you discarded and why, so the list reads as filtered rather than padded. Rank them and say which is riskiest. Never invent a trend, a statistic or an account. If nothing genuinely new is happening in their corner this week, say exactly that rather than manufacturing three ideas.' },

  { id:'creative_check', cat:'Making things', icon:'🎬', title:'Be honest about this before I publish', needs:'Web research', on:false,
    desc:'Paste what you are about to post and get the response an honest friend who knows the platform would give: what the first three seconds do, what is genuinely good, and whether this is a strong piece or an ordinary one.',
    asks:{ q:'What are you about to publish, and where?', ph:'Paste the script, caption, lyrics or description - and say which platform and who it is for' },
    sample:['THE FIRST THREE SECONDS: your hook is the fourth sentence. Everything before it is context nobody has earned yet.','WHAT IS WORKING: the middle section is genuinely good - specific, and it sounds like you.','WHAT WILL COST YOU: it ends on a summary. Endings that ask something get replies; summaries get scrolled.','THE HONEST NOTE: this is a solid piece, not a breakout one. The idea is familiar - the execution is what would have to carry it.','Two specific fixes, both under ten minutes.'],
    prompt:'The user will paste something they are about to publish. Give them the response an honest friend who knows the platform would give: what the first three seconds do, what is genuinely working, what will cost them attention and why, and a plain assessment of whether this is a strong piece or an ordinary one. Be specific and quote their own words back. Do NOT rewrite it for them - name the fix and let them make it, because a piece rewritten by AMV stops sounding like them and that is the only thing they actually have. Never flatter: if it is ordinary, saying so is the entire value of being asked.' },

  { id:'creative_repurpose', cat:'Making things', icon:'♻️', title:'Get more out of what I already made', needs:'Web research', on:false,
    desc:'One thing you already made is usually five. Finds the section that stands alone, the line better than your title, and the posts hiding inside it - written out, not described.',
    asks:{ q:'What have you already made?', ph:'Describe or paste the piece - and say which platforms you are on' },
    sample:['One 8-minute video is at least 5 more things.','1. The 40-second section at 3:12 stands alone completely. That is the short.','2. The question you answer at 5:30 is a text post on its own - here it is written out.','3. Three stills worth posting, with captions.','4. The thing you said offhand at 6:04 is better than your title. Use it as the title next time.','Nothing here is new work - it is all already in what you made.'],
    prompt:'Take something the user has already made and find everything else it can become across the platforms they use. Be specific: which section, which timestamp or paragraph, and what shape it takes on each platform. Write out the captions and text posts in full rather than describing them. Point out anything in the piece that is stronger than how it was framed - a line better than the title, a moment better than the thumbnail. Do not propose new work: the whole point is that this already exists. Ground the platform advice in what actually performs there now, and say when you are unsure.' },

  { id:'school_auto', every:'daily', cat:'Learning', icon:'🎒', title:'Know what is due without telling me', needs:'Classroom', on:false,
    desc:'Reads what you have actually been set in Google Classroom - every class, every due date - and plans your week around it. Nothing to type in and nothing to keep updated.',
    asks:{ q:'Anything AMV should know beyond your classes?', ph:'Things Classroom does not have - a job, training, a test that was announced in class - or leave it blank and it works from Classroom alone' },
    sample:['Read from Classroom: 6 classes, 9 pieces of work still ahead.','DUE IN 2 DAYS - History essay (worth 40 points, the biggest thing this fortnight). Not mentioned since it was set.','DUE FRIDAY - Chemistry problem set, and the biology reading.','NO DUE DATE - the art portfolio. It has been open 3 weeks, which is usually how those end up done in one night.','THE COLLISION: history and chemistry both land Friday. Do the essay Wednesday or you are doing both on Thursday.','AMV reads Classroom. It cannot submit anything, and it is not able to - it was never given permission to.'],
    prompt:'You are given the user’s real coursework from Google Classroom: each piece, its class, its due date and what it is worth. Build them a plan around it. Lead with what is due soonest and what is worth most, name any day where two significant things collide and give the specific move that fixes it, and call out anything with no due date that has been open a long time, because that is what gets done badly at the last minute. Use the points to say which piece actually matters. If they have told you anything Classroom does not know about, fold it in. Be brief - this is read before school. Never invent a piece of work or a due date: everything you list must be in what you were given. If any class could not be read, say so at the top and name it - a plan that quietly omits a class reads as \u2018nothing is due\u2019 for it, and that is how somebody misses a deadline AMV told them about. State plainly that you can read their coursework and cannot submit anything.' },

  /* ---- EVERYDAY LIFE, THE PART THAT REPEATS ------------------------------

     The catalogue above is mostly work, money and study. The owner's list was
     none of those: the weather before you leave, where petrol is cheapest this
     week, what is about to go off in the fridge, what the school has quietly
     asked for by Friday. Small things, and the ones people actually want an
     assistant for.

     Every one of these runs on live web research and what the person tells it,
     so they genuinely run with AMV closed and the result is emailed. None of
     them books, buys, pays or files anything - the ones that touch a business
     or a doctor prepare everything and stop, and their instructions say so in
     the runner's own words rather than only on the card. That line is the
     difference between a useful assistant and a lawsuit. */

  { id:'weather_day', every:'daily', cat:'Home & life', icon:'🌤️', title:'The forecast, and what to do about it', needs:'Web research', on:false,
    desc:'Every morning, the day where you actually are - and the one thing it changes. Not a temperature you could have read anywhere, but whether to leave earlier, take a coat, or move the thing you had planned outside.',
    asks:{ q:'Where are you, and what does weather change for you?', ph:'Your town or ZIP code, then what it affects - e.g. “your city, I cycle to work and my kids walk to school”' },
    sample:['Rain from 07:40 to about 09:15, then dry all day.','THAT MEANS: leave at 07:20 and you miss it, or leave at 09:30 and you miss it. 08:00 is the worst possible time.','14C, feels like 11 in the wind. Coat, not a jacket.','Tomorrow is the dry day this week, if you are moving anything outdoors.'],
    prompt:'Search the live web for today’s forecast for the user’s stated location, from a real forecast source you name. Do not just recite numbers: lead with the ONE thing the weather changes for them today, given what they told you it affects. Give the timing of any rain, snow or wind precisely enough to plan around - the hour it starts and the hour it stops - because a day that is “60% rain” is useless and “wet until nine, then dry” is a decision. Say what to wear only when it is not obvious. Mention tomorrow only if it is materially different and something could be moved to it. If the forecast source is uncertain or the models disagree, say so plainly rather than picking one. Never invent a temperature or a time.' },

  { id:'fuel_watch', every:'weekly', cat:'Money', icon:'⛽', title:'Where fuel is cheapest near me', needs:'Web research', on:false,
    desc:'Once a week, the real price at the stations you would actually drive to - what it costs to fill up at each, and whether the cheaper one is worth the detour or just further away.',
    asks:{ q:'Where do you fill up, and what do you drive?', ph:'Your area or ZIP code, the fuel type, roughly your tank size, and any loyalty card - e.g. “your area, diesel, 55 gallon tank, warehouse club member”' },
    sample:['Cheapest within a sensible drive: 3.42 a gallon at the supermarket station two miles out.','A FULL TANK THERE: 76.40. At your usual station it is 81.35. You save 4.95.','THE CATCH: it is 2.6 miles further each way, which costs you about 0.90 in fuel. Real saving is roughly 4.','Prices rose about 2p across the area this week, so this is not the week to wait for better.'],
    prompt:'Search the live web for current fuel prices at stations near the user’s stated location, for their stated fuel type, from a real price source you name along with how recently it was updated. List the genuinely cheapest few, with the price per liter or gallon and what a full tank of their stated size actually costs at each. Then do the arithmetic they will not: compare against their usual station, subtract the fuel burned getting to a further one, and say whether the detour is actually worth it in money. Say which way prices are moving in their area this week, so they know whether to fill now or wait. If prices at a station are stale or unverified, say so rather than presenting them as current. Never invent a price or a station.' },

  { id:'store_deals', every:'daily', cat:'Money', icon:'🏷️', title:'Discounts where I actually shop',  needs:'Web research', on:false,
    desc:'Every morning, real current offers at the specific shops you buy from - and only on the things you actually buy. No vouchers for a shop you have never been to and no code that expired in March.',
    asks:{ q:'Which shops, and what do you buy there?', ph:'One per line - the shop and the kind of thing - e.g. “the supermarket you use, weekly food shop” / “your clothing shop, basics” / “the pharmacy, contact lenses”' },
    sample:['3 offers worth your time today, out of 41 running.','YOUR SUPERMARKET - 3 for 2 across the diapers you buy monthly. Works out at 11.32 saved on a normal shop. Ends Tuesday.','BOOTS - your lens brand is on the 25% multibuy again. It was 25% in January too, so this is the regular cycle, not a one-off.','UNIQLO - the basics you buy are NOT in the sale. The sale is outerwear.','Dropped 38: wrong shop, wrong products, or a “deal” that is the normal price.'],
    prompt:'Search the live web for offers running RIGHT NOW at the specific shops the user named, and only on the kinds of things they said they buy there. For each: what the offer is, what it saves on a realistic basket for them in money, when it ends, and a link. Then be the filter they came for: say how many offers you discarded and why, and explicitly call out any “deal” that is simply the usual price or a discount off an inflated one. If an offer runs on a predictable cycle, say so, because knowing it will be back in six weeks changes whether they buy today. Verify every offer is currently live and dated - an expired voucher is worse than no email. Never invent an offer, a code or a saving.' },

  { id:'local_basket', every:'weekly', cat:'Money', icon:'🍎', title:'Where the food shop is cheapest this week', needs:'Web research', on:false,
    desc:'The things you buy every week, priced across the shops you can actually reach - so you know where the fruit is cheap this week and whether the whole shop is worth moving.',
    asks:{ q:'Where do you shop, and what is on the list every week?', ph:'Your area, the shops within reach, then the items you always buy - e.g. “your ZIP code, the three supermarkets you can reach, bananas milk eggs chicken rice diapers”' },
    sample:['Your usual list, priced across 4 shops: 38.60 to 47.15. That is a 22% spread on the same food.','FRUIT IS THE GAP THIS WEEK: bananas and apples are 40% cheaper at the discounter than at your usual store. Everything else is within cents.','SO: it is not worth moving the whole shop. It is worth buying fruit in one place.','CHICKEN went up everywhere, about 8%, so that is the market and not your shop.','Prices checked today from each retailer’s own listings.'],
    prompt:'Search the live web for current prices on the specific items the user listed, at the specific shops they said they can reach, using each retailer’s own current listings and naming your source and the date. Price their whole list at each shop and give the total, so the spread is visible. Then say the useful thing rather than the obvious one: identify which few items account for most of the difference, and say honestly whether it is worth moving the entire shop or only worth buying two things elsewhere - because “drive to a fourth supermarket to save 90p” is bad advice. Flag any item that has risen everywhere, since that is the market rather than their choice of shop. If a price cannot be verified, leave the item out and say which ones you could not check. Never estimate a price and present it as read.' },

  { id:'fridge_recipes', every:'daily', cat:'Home & life', icon:'🥕', title:'What is about to go off, and what to cook with it', needs:'Web research', on:false,
    desc:'Tell AMV what you bought and it keeps track of what expires when - then, before anything is wasted, gives you real meals built from exactly what is in the house.',
    asks:{ q:'What did you buy, and who are you cooking for?', ph:'What you bought and when - e.g. “Wednesday: eggs, spinach, chicken thighs, double cream, half a loaf” - plus how many people and anything nobody eats' },
    sample:['GOING FIRST: the spinach, 2 days at most. Then the cream, Sunday. The eggs are fine until the 14th.','TONIGHT, uses the spinach and 3 eggs: a proper frittata. 20 minutes, one pan, and you have everything except nothing.','FRIDAY, uses the cream and the chicken: chicken in a mustard cream sauce over the rice you already have.','THE BREAD is going stale rather than off - it is better as croutons on Saturday than binned on Thursday.','Nothing here needs a shop.'],
    prompt:'Track what the user told you they bought and when. Work out realistic use-by order from typical shelf life for each item, stating the assumption rather than pretending to know an exact date, and lead with what must be used first. Then give two or three actual meals built ONLY from what they have said is in the house plus ordinary staples, naming which perishable each meal rescues and roughly how long it takes. Say plainly if a meal needs one thing they do not have. Distinguish food that is genuinely unsafe past a date from food that is simply past its best, since one must be thrown away and the other becomes something else. On anything where getting it wrong is a health risk - meat, fish, eggs, reheated rice, anything cooked and stored - be conservative and say so; when in doubt, tell them to throw it out. You are not a food safety authority and must say so.' },

  { id:'figure_market', every:'daily', cat:'Watching the world', icon:'📣', title:'When someone I watch posts, and what moved after', needs:'Web research', on:false,
    desc:'Follow the accounts whose posts actually move things. AMV brings you what was said, the source, and what the market did in the hours after - the facts and the numbers, and never a recommendation to buy or sell anything.',
    asks:{ q:'Who should AMV watch, and what are you exposed to?', ph:'The accounts or people, then the markets, sectors or holdings you care about - e.g. “@realDonaldTrump and the Fed chair; I hold index funds and some semiconductor stocks”' },
    sample:['2 posts yesterday that anything moved after. 9 that nothing moved after.','14:12 - a post on tariffs on imported vehicles. Full text quoted below, with the link.','WHAT MOVED: two European carmakers fell 3.1% and 2.4% within the hour. The broad index did not move.','ON WHAT YOU HOLD: your semiconductor exposure was untouched by this one - it is a different supply chain.','19:40 - a post on interest rates. Markets were closed. Futures moved 0.3%, which is noise at that hour.','This is what happened. It is information, not financial advice, and AMV will not tell you what to buy.'],
    prompt:'Search the live web for what the accounts the user named have posted since your last run. For each post: the time, the substance quoted accurately, and the direct link to the original - never a paraphrase presented as a quote. Then give the market context: what actually moved in the hours afterwards, with real figures and the source, and be rigorous about the difference between a move that followed the post and one that was already happening. Say explicitly when nothing moved, and say when a market was closed, because a futures wobble at midnight is noise and presenting it as a reaction is misleading. Relate it to what the user said they are exposed to, including saying plainly when a post has nothing to do with anything they hold. You must NOT give financial advice: never say what to buy, sell, hold or wait for, never predict a price or a direction, and never rank ideas by attractiveness. If the user asks you to, decline and give the facts instead. End every report by stating that this is information, not financial advice.' },

  { id:'appt_chase', every:'weekly', cat:'Health', icon:'🩺', title:'Get the appointment, and get ready for it', needs:'Web research', on:false,
    desc:'The parts of a medical appointment that are actually work: finding who can see you soonest, having every reference and number ready before you call, and turning up knowing what to ask. AMV does not book anything - it hands you a call you can make in two minutes.',
    asks:{ q:'What do you need seen to, and where?', ph:'Who you are registered with, what it is about, how urgent, and anything relevant - e.g. “GP in Bristol BS7, recurring headaches for 6 weeks, also due a dental check”' },
    sample:['3 things open. One of them has been open 6 weeks.','THE HEADACHES: your surgery releases same-day slots at 08:00 and online booking opens at 07:30. That is the door, and calling at 09:30 is why you have not got in.','READY TO GO: your insurance or patient number, the dates you have recorded, what you have already tried, and the three questions worth asking. All below, ready to read out.','THE DENTAL CHECK is overdue by 4 months. Two practices nearby are taking new patients this month - both links below.','AMV has NOT booked anything. These are calls for you to make.'],
    prompt:'Help the user actually get seen. Research the real booking routes for the specific provider or area they named - opening times, when slots are released, online booking, and any triage service - from current sources you name, and say plainly when opening hours or availability could not be verified. Then prepare the call so it takes them two minutes: the number, the reference or patient details they told you, a two-sentence account of the problem in the order a receptionist needs it, and the questions worth asking once they are in front of a clinician. Track anything that has been open too long and say how long, because that is the thing that gets forgotten. You must NOT book, cancel, confirm or reschedule anything, and you must NOT contact any surgery, practice or clinician - say clearly in every report that nothing has been booked and these are calls for the user to make. Do not diagnose, do not suggest a diagnosis, and do not advise for or against treatment: you are preparing an appointment, not replacing one. If anything the user describes could be an emergency, say so first and tell them to seek urgent care now.' },

  { id:'family_week', every:'weekly', cat:'Family & kids', icon:'👨‍👩‍👧', title:'The week ahead for the whole house', needs:'Web research', on:false,
    desc:'Everything the family has to be somewhere for, in one place - with the kit, the money and the forms each one quietly needs, and the two days that are going to collide.',
    asks:{ q:'Who is in the house, and what is on this term?', ph:'Each child, their year, and what they do - clubs, lessons, teams, days they need kit - plus your own fixed commitments' },
    sample:['THURSDAY IS THE PROBLEM. Swimming at 16:00 and parents’ evening at 17:30, 20 minutes apart in opposite directions.','THE FIX: parents’ evening slots are usually bookable - take a 18:30 and the day works.','KIT: PE Tuesday and Friday for Amir. Swimming bag Thursday. Football boots need studs before Saturday, the old ones are worn.','MONEY: trip payment closes Friday, 14. School dinner balance is low.','FORMS: consent slip for the museum trip has not gone back. It went out 9 days ago.'],
    prompt:'Build the week for a whole household from what the user has told you about each person. Lead with the collision - the day where two things overlap or leave no time between them - and give one specific move that fixes it rather than just naming the clash. Then list what each day needs to actually work: kit, uniform, equipment, packed lunches, anything that must be in a bag the night before. Separately list money owed with its deadline, and forms or permissions outstanding with how long they have been outstanding, because those are what get missed. Be brief and scannable - this is read while doing something else. Only include what the user has actually told you or what you can verify from a real source such as a school website; never invent a club, a deadline or an amount. If something looks like it is missing, ask rather than guessing.' },

  { id:'school_admin', every:'weekly', cat:'Family & kids', icon:'📋', title:'What the school has asked for', needs:'Web research', on:false,
    desc:'Schools ask for things in a newsletter on a Tuesday and expect them by Friday. This watches the school’s own pages and letters for what has actually been asked of you, what it costs, and what closes when.',
    asks:{ q:'Which school, and which children?', ph:'The school name and its website if you have it, each child’s year or class, and where letters reach you' },
    sample:['4 things asked of you this week. 2 have deadlines.','TRIP PAYMENT - 14, closes Friday. Places are capped, so late usually means no.','WORLD BOOK DAY is a week on Thursday. Costume. This is the one people find out about the night before.','NON-UNIFORM Friday, 1 for the charity. Nothing to organise.','INSET DAY 3 March - school closed, and it is a Monday, so childcare.','From the school newsletter dated the 4th and the term calendar page.'],
    prompt:'Watch the school’s own published sources - newsletters, term calendar, class pages - for what has actually been asked of a parent, and report only that. For each item: what is being asked, which child it concerns, what it costs, and the deadline. Put anything with a hard deadline or a cap first, and flag well in advance the things that need preparation rather than money - costume days, a closed day that means childcare, anything requiring a form signed by someone else. Say when nothing was asked this week rather than padding the list. Name the source and its date for every item, and say plainly if a page could not be read, since a quiet omission reads as “nothing was asked” and that is how a deadline gets missed. Never invent a date, an amount or an event.' },

  { id:'kids_weekend', every:'weekly', cat:'Family & kids', icon:'🎡', title:'Something to do with the kids this weekend', needs:'Web research', on:false,
    desc:'Real things happening near you this weekend, at ages that match your children, with the actual price - including the free ones, and honest about which are worth the journey.',
    asks:{ q:'Where are you, how old are the children, and what is the budget?', ph:'Your area and how far you will travel, each child’s age, and roughly what you are willing to spend - e.g. “Cardiff, 30 min drive, 3 and 7, under 25 total”' },
    sample:['5 things on this weekend that suit a 3 and a 7 year old. 3 of them are free.','SATURDAY - free craft session at the library, 10:30, drop-in, no booking. Suits both, and the 3 year old will last about 40 minutes.','SATURDAY - the museum has a dinosaur trail on this month. Free entry, 2 for the trail sheet.','SUNDAY - farm park, 9 each, 25 minutes away. Worth it in dry weather and grim in the rain, and Sunday is forecast wet.','SKIPPED: 4 things aimed at over-8s and one that is 22 a head.'],
    prompt:'Search the live web for things genuinely happening this weekend within the distance the user gave, suitable for the specific ages of their children. For each: what it is, exactly when, what it costs including any per-child charge, whether booking is needed, how far it is, and the link. Lead with the free and cheap ones - the ask was for something to do, not something to spend. Be honest about fit: say when something will hold a younger child for forty minutes rather than an afternoon, and when an activity depends on the weather, check the forecast and say so. Say how many you discarded and why, so the list reads as filtered. Everything must be verified as actually running this weekend from a real source you name - an event that finished last month is the failure this job exists to avoid.' },

  { id:'family_health', every:'weekly', cat:'Family & kids', icon:'💚', title:'Nobody in this house misses a check-up', needs:'Web research', on:false,
    desc:'Vaccinations, dental checks, eye tests, reviews and prescriptions - for everyone in the house, tracked by date, so the one that quietly went twenty months without a dentist is the one you hear about.',
    asks:{ q:'Who is in the house, and when was each thing last done?', ph:'Each person, their age, and the last date you know for dentist, optician, vaccinations and any repeat prescription' },
    sample:['1 overdue, 1 due this month, everything else fine.','OVERDUE - Layla, dentist. Last seen 20 months ago; children are usually seen every 6 to 12 months.','DUE THIS MONTH - your own repeat prescription runs out on the 19th. Ordering takes 3 working days at your surgery, so the 14th is the real deadline.','ON SCHEDULE - the pre-school booster is due at 3 years 4 months, which is April for Sami. Nothing to do yet.','AMV has not booked anything. Nothing here is medical advice.'],
    prompt:'Track routine health admin for everyone the user has told you about: dental checks, eye tests, routine vaccinations and boosters by age, health reviews and repeat prescriptions. Work from the standard schedule published for the user’s country, which you should name and link, and say when a schedule is a general guideline rather than a rule. Lead with anything genuinely overdue and say how overdue. Work backwards from real lead times - if reordering a prescription takes three days, the deadline is three days earlier, and say so. Be explicit about what is NOT due, so the list stays trustworthy. Do NOT book or contact anyone, and say so in every report. Do not give medical advice, do not interpret symptoms and do not advise for or against any vaccination or treatment - this job tracks dates and nothing else. Tell the user to confirm anything that matters with their own clinician.' },

  /* WATCHING A PUBLIC ACCOUNT, AND WHERE THE LINE IS.

     Asked for as "every time Trump tweets, email me what he tweeted and what
     stocks to buy". The first half is an ordinary feed watch. The second half
     is financial advice, and AMV does not give it - not as a matter of taste,
     but because telling somebody what to buy is a regulated activity and the
     abuse register already lists it.

     What is genuinely useful and genuinely allowed is the part in between: the
     post itself, what it actually says, which companies or sectors it names or
     bears on, and what has historically moved on posts of that kind - with the
     reasoning shown so the person can judge it. That is research, and it is
     what the morning brief already does for markets generally.

     So the job does the watch and the analysis and stops before the
     recommendation, and says so on every send rather than leaving somebody to
     discover the boundary. */
  { id:'account_watch', cat:'Watching the world', icon:'\uD83D\uDCE1', title:'Watch a public account and tell me what it means', needs:'Web research', on:false,
    desc:'Watches the public accounts you name. When one posts something that matters, AMV emails you what was said, which companies or sectors it touches, and how markets have reacted to that kind of post before - with its reasoning shown. It does not tell you what to buy.',
    asks:{ q:'Which accounts, and what are you watching them for?', ph:'e.g. @realDonaldTrump on Truth Social and X - I hold semiconductor and energy names and want to know when a post bears on them' },
    sample:['1 post in the last hour that touches what you hold.','POSTED 09:14 - announced a review of chip export rules, naming no company.',
            'TOUCHES: semiconductor names with China revenue. Your two holdings both have it, at roughly 20% and 34% of revenue by their last filings.',
            'BEFORE: the four comparable posts since 2018 moved the sector index between -3.1% and +0.4% on the day; the two that named a specific rule moved it most.',
            'UNCERTAIN: this one names no rule and no company, which historically has been the weaker signal.',
            'Information and analysis, not financial advice. AMV will not tell you what to buy or sell.'],
    prompt:'Check the public accounts the user named for new posts since your last run. For each post that genuinely bears on what they said they are watching: quote what was actually posted, with the time; identify the specific companies, sectors or assets it touches and say WHY it touches them, citing the concrete link (revenue exposure, named regulation, supply chain) rather than a vague association; and describe how comparable posts have been followed by market moves before, with the actual numbers and dates, distinguishing correlation from cause. Say plainly where the signal is weak or ambiguous. If nothing relevant was posted, say exactly that rather than reporting a post that does not matter. You must NOT give financial advice: never tell the user to buy, sell, hold, short or wait, never predict a price or a direction, and never phrase analysis as a recommendation. End every report by stating it is information and analysis, not financial advice.' },

  { id:'book_table', cat:'Home & life', icon:'\uD83C\uDF7D\uFE0F', title:'Find and book a table', needs:'Web research', on:false,
    desc:'Finds somewhere that fits the occasion, the budget and the people coming, checks what is actually available at the time you want, and books it once you say yes. It asks before reserving anything in your name.',
    asks:{ q:'What is the occasion, and any constraints?', ph:'e.g. four of us, Friday around 8, walkable from Union Square, one vegetarian, under $50 a head' },
    sample:['3 places fit Friday at 8 for four, one vegetarian, under $50 a head.','BEST FIT - Vera, 7:45 or 8:30 free. Vegetarian menu is a real one, not a side salad. 12 minutes walk.',
            'ALSO - Cardoon at 8:15. Cheaper, louder, and the vegetarian options are thinner.',
            'NOT AVAILABLE - the two you have been to before are both full at that hour.',
            'Say which and AMV will book it. Nothing has been reserved yet.'],
    prompt:'Find restaurants that genuinely fit the user\u2019s occasion, party size, budget, location and dietary needs. Check real current availability for the date and time they asked for rather than assuming it. Present the options ranked by fit, saying honestly what is good and what is weaker about each - including where a dietary need is only nominally catered for. Name what is NOT available so the absence is visible. Do NOT reserve anything without the user choosing: present the options and wait. When they choose, make the booking in their name with the details they gave, then confirm back exactly what was booked, for when, and under what name and contact.' },],
 madeFor: [
  { k:'jobs', id:'jobs', icon:'💼', cat:'Work & career', every:'daily',
    t:f => 'Job hunt on ' + _cwNames(f.jobs, 2),
    d:(f, C) => 'New roles that fit you on ' + f.jobs + ', each with a tailored application drafted. Nothing reaches an employer without you.',
    ask:['What work are you looking for, and where?', 'e.g. "junior accountant, in the capital or remote, full-time"'],
    p:(f, C) => 'Search ' + f.jobs + ' and other genuine job sites used in ' + C + ' for openings posted recently that match what the user asked for. For each: title, employer, location, pay if stated, why it fits, and the direct link. Draft a short tailored application for the three strongest. Never submit or contact anyone; never invent a listing - only ones you found, with links.' },
  { k:'groc', id:'groc', icon:'🛒', cat:'Home & life', every:'weekly',
    t:f => 'Cheapest weekly shop: ' + _cwNames(f.groc, 3),
    d:(f, C) => 'Compares this week’s prices and offers at ' + f.groc + ' for the things you buy, and says where the basket is cheapest.',
    ask:['What do you usually buy, and which town are you in?', 'e.g. "milk, eggs, chicken, rice, nappies - in Valencia"'],
    p:(f, C) => 'Using the current published prices and promotions of ' + f.groc + ' in ' + C + ', price the user’s usual basket at each and say which is cheapest this week and by how much. Name the offers that matter. Give prices in the local currency. Where a price could not be found, say so rather than estimating.' },
  { k:'shop', id:'shop', icon:'🏷️', cat:'Money', every:'daily',
    t:f => 'Price drops on ' + _cwNames(f.shop, 2),
    d:(f, C) => 'Watches the things you want on ' + f.shop + ' and tells you when the price genuinely drops - not a discount on an inflated price.',
    ask:['What do you want, and what would you pay?', 'e.g. "a Dyson V15 under 450, a PS5 Slim under 400"'],
    p:(f, C) => 'Check today’s prices for the items the user named on ' + f.shop + ' and other legitimate sellers in ' + C + '. Report the lowest real price with the link, whether it is at or under their target, and whether this is a genuine low or a discount on a raised price. Say plainly when nothing has dropped.' },
  { k:'tax', id:'tax', icon:'🧾', cat:'Money', every:'weekly',
    t:f => 'Tax deadlines and forms (' + _cwShort(f.tax) + ')',
    d:(f, C) => 'What ' + f.tax + ' needs from you and by when - dates, forms and what changed this year - from the official pages, in time.',
    ask:['What is your tax situation?', 'e.g. "employee, plus a flat I rent out" or "self-employed designer"'],
    p:(f, C) => 'From the official pages of ' + f.tax + ', list the tax deadlines and filings in ' + C + ' that apply to the user’s situation in the next 90 days: the date, the form by its real name, and what it needs from them. Flag anything that changed this year. Link each official page. Information, not tax advice - say when they need a professional.' },
  { k:'id', id:'id', icon:'🪪', cat:'Home & life', every:'weekly',
    t:f => 'Passport and ID renewals with ' + _cwPlain(f.id),
    d:(f, C) => 'Knows when your documents run out and what ' + f.id + ' needs to renew them - fees, photos, the booking step - before the queue gets long.',
    ask:['Which documents, and when do they expire?', 'e.g. "passport June 2027, ID card March 2026"'],
    p:(f, C) => 'For the documents the user listed, work out how far ahead each must be renewed in ' + C + ' through ' + f.id + ': current fees, required photos and papers, how appointments are booked and current waiting times. Say which is urgent. Use only official sources and link them. Never book anything.' },
  { k:'car', id:'car', icon:'🚗', cat:'Home & life', every:'weekly',
    t:f => 'Car inspection, tax and insurance: ' + _cwNames(_cwPlainAll(f.car), 2),
    d:(f, C) => 'Keeps the dates for ' + f.car + ' in view, with what to do and where, before anything lapses.',
    ask:['Which car, and what dates do you know?', 'e.g. "2016 Seat Ibiza, inspection due in May, insurance renews 1 Sept"'],
    p:(f, C) => 'For the user’s car in ' + C + ', track what is due with ' + f.car + ': the next date for each, what it costs, how to book or pay, and the penalty for missing it. Flag anything in the next 30 days first. Official sources only, linked. Never pay or book on their behalf.' },
  { k:'rail', id:'rail', icon:'🚆', cat:'Home & life', every:'daily',
    t:f => 'Train fares and delays: ' + _cwNames(f.rail, 2),
    d:(f, C) => 'Watches fares on ' + f.rail + ' for the trips you make, and warns you about strikes and disruption before you leave.',
    ask:['Which trips do you make, and when?', 'e.g. "Madrid to Barcelona, Fridays after 5pm, back Sunday"'],
    p:(f, C) => 'For the trips the user named, check current fares on ' + f.rail + ' in ' + C + ' and any announced strikes, engineering works or disruption. Give the cheapest real option with times and the link, and warn clearly about anything that affects their dates. Never book.' },
  { k:'prop', id:'prop', icon:'🏠', cat:'Home & life', every:'daily',
    t:f => 'New homes on ' + _cwNames(f.prop, 2),
    d:(f, C) => 'New listings on ' + f.prop + ' that fit your budget and area the day they appear, with the overpriced ones called out.',
    ask:['Rent or buy, where, what budget, how many rooms?', 'e.g. "rent, Gràcia or Eixample, up to 1,300 a month, 2 bedrooms"'],
    p:(f, C) => 'Search ' + f.prop + ' for listings in ' + C + ' that match the user’s criteria and appeared recently. For each: price, size, area, the link, and whether the price is high or low for that area going by comparable listings. Only real listings you found. Never contact an agent.' },
  { k:'food', id:'food', icon:'🍜', cat:'Home & life', every:'weekly',
    t:f => 'Takeaway deals on ' + _cwNames(f.food, 2),
    d:(f, C) => 'The real offers this week on ' + f.food + ' for what you like to eat - checked, not advertised.',
    ask:['Which area, and what do you like to eat?', 'e.g. "central Lisbon - sushi, burgers, anything vegetarian"'],
    p:(f, C) => 'Find the genuine current offers on ' + f.food + ' in ' + C + ' for the user’s area and tastes: the restaurant, the deal, its conditions and the link. Leave out anything that is only a delivery-fee promotion unless it is the best value. Never order.' },
  { k:'telco', id:'telco', icon:'📱', cat:'Money', every:'weekly',
    t:f => 'A cheaper mobile plan? ' + _cwNames(f.telco, 3),
    d:(f, C) => 'Compares what you pay with the current plans from ' + f.telco + ' and the budget brands, and says when switching saves real money.',
    ask:['Which network, what do you pay, and how much data do you use?', 'e.g. "Vodafone, 25 a month, about 15GB"'],
    p:(f, C) => 'Compare the user’s current mobile plan with the plans on sale now from ' + f.telco + ' and the budget brands on their networks in ' + C + '. Name the cheapest plan that meets their usage, the yearly saving, any contract or porting catch, and the link. Say plainly if they are already on a good deal.' },
  { k:'banks', id:'save', icon:'💰', cat:'Money', every:'weekly',
    t:f => 'Better savings rates than ' + _cwNames(f.banks, 1),
    d:(f, C) => 'Compares savings and deposit rates at ' + f.banks + ' and the online banks, and tells you when yours is beaten.',
    ask:['Where are your savings now, and at what rate?', 'e.g. "Santander savings account at 1.5%"'],
    p:(f, C) => 'Compare the user’s current savings rate with the savings and fixed-deposit rates on offer now from ' + f.banks + ' and reputable online banks in ' + C + ', including the deposit guarantee scheme that covers each. Give rates, conditions and links. Information, not financial advice - never tell them to move money.' },
  { k:'health', id:'health', icon:'🩺', cat:'Home & life', every:'weekly',
    t:f => 'Check-ups and prescriptions through ' + _cwPlain(f.health),
    d:(f, C) => 'What is due - a check-up, a repeat prescription, a screening - and how to get it through ' + f.health + '.',
    ask:['What should it keep track of?', 'e.g. "repeat inhaler prescription, yearly dental check-up, a smear test"'],
    p:(f, C) => 'For the items the user listed, explain how each is obtained or booked through ' + f.health + ' in ' + C + ', typical waiting times, and anything that must be done ahead. Remind them what is coming due. Official sources only, linked. Not medical advice; never book.' },
  { k:'exams', id:'exams', icon:'🎓', cat:'Learning', every:'daily',
    t:f => 'Revision for ' + _cwShort(f.exams),
    d:(f, C) => 'A daily revision plan for ' + f.exams + ' with the real exam dates, adjusted to what you keep getting wrong.',
    ask:['Which exam, which subjects, and when?', 'e.g. "maths and chemistry, exams start 3 June"'],
    p:(f, C) => 'Build today’s revision session for the user’s exams (' + f.exams + ', ' + C + '): the topics to cover, ten practice questions in the official exam style with answers at the end, and the days left. Use the official syllabus and past papers where they exist, and link them.' },
  { k:'uni', id:'uni', icon:'🏫', cat:'Learning', every:'weekly',
    t:f => 'University applications (' + _cwShort(f.uni) + ')',
    d:(f, C) => 'Every deadline and requirement for applying through ' + f.uni + ', tracked, so nothing is missed.',
    ask:['Which courses or universities, and for which year?', 'e.g. "computer science, starting next September"'],
    p:(f, C) => 'For the courses the user named, list the application steps and deadlines through ' + f.uni + ' in ' + C + ': entry requirements, documents, fees and dates, soonest first. Official pages only, linked. Never submit anything.' },
  { k:'news', id:'news', icon:'📰', cat:'Watching the world', every:'daily',
    t:f => 'Morning brief from ' + _cwNames(f.news, 2),
    d:(f, C) => 'What matters in ' + C + ' this morning, from ' + f.news + ', in five lines.',
    ask:['What should it focus on?', 'e.g. "politics, housing and anything about my city" or "just the big stories"'],
    p:(f, C) => 'Read this morning’s coverage from ' + f.news + ' and summarise what matters in ' + C + ' in five lines, weighted to what the user asked for. Link each story. Separate fact from opinion and say when outlets disagree.' },
  { k:'weather', id:'weather', icon:'⛈️', cat:'Watching the world', every:'daily',
    t:f => 'Weather warnings from ' + _cwShort(f.weather),
    d:(f, C) => 'Official warnings from ' + f.weather + ' for where you are, and what to do about them - only when there is one.',
    ask:['Which town or area?', 'e.g. "Seville"'],
    p:(f, C) => 'Check the official warnings from ' + f.weather + ' for the user’s area in ' + C + '. If there is a warning, give its level, timing and the practical advice. If there is none, say so in one line.' },
  { k:'gov', id:'gov', icon:'🏛️', cat:'Home & life', every:'weekly',
    t:f => 'Government letters and deadlines (' + _cwPlain(f.gov) + ')',
    d:(f, C) => 'What the authorities in ' + C + ' need from you and by when, explained - using ' + f.gov + ' when you do it yourself. AMV never signs in for you.',
    ask:['What do you deal with?', 'e.g. "renewing my residence permit, a parking fine, child benefit"'],
    p:(f, C) => 'For the matters the user described, explain what the authorities in ' + C + ' need from them, the deadlines, fees and forms, and how it is done online with ' + f.gov + '. Official sources only, linked. Never sign in, pay or submit anything.' },
],
 madeMore: [
  ['jobs','salary','Work & career','💵','weekly','What your job pays in {C}','Real salary ranges for your role and city from listings on {2} - so you know your number before you ask.','Which job, and which city?','e.g. "backend developer, 4 years, Madrid"','From current listings on {v} and official pay data for {C}, give the realistic salary range for the role and city the user named, what moves it up, and how the user compares. Cite listings and sources; say when data is thin.'],
  ['jobs','interview','Work & career','🎤','weekly','Interview prep for jobs on {2}','For the roles you apply to on {2}: the questions employers in {C} actually ask, and answers built from your experience.','Which role, and what is your background?','e.g. "sales manager, 6 years in retail"','Prepare the user for interviews for the role named, as employers in {C} run them: likely questions, what a strong answer covers, and three stories from their background to use. Note local norms (salary talk, references, notice periods).'],
  ['jobs','cv','Work & career','📄','weekly','A CV in the format employers in {C} expect','Keeps your CV in the local format and wording, tuned to the roles you are chasing on {2}.','What roles are you going for, and paste or describe your experience','e.g. "marketing roles; 5 years at an agency, 2 in-house"','Advise how CVs are written in {C} (length, photo or not, personal details, language) and draft a CV section by section from what the user gave, tuned to the roles named. Never invent experience.'],
  ['jobs','hiring','Work & career','🏢','weekly','Who is hiring near you on {2}','Companies in your area and field that started hiring this week, with the roles and links.','Your field and area?','e.g. "nursing, Lisbon"','Find employers in the user’s field and area that posted new roles this week on {v} and company career pages. List employer, roles, links. Only real postings.'],
  ['groc','offers','Home & life','🏷️','weekly','This week’s offers at {3}','The deals worth having this week at {3}, filtered to what you actually buy.','What do you usually buy?','e.g. "coffee, chicken, yoghurt, nappies"','List this week’s current promotions at {v} relevant to what the user buys: the item, the deal, the store, the end date. Skip offers that are not genuine savings.'],
  ['groc','rises','Home & life','📈','weekly','Price rises on your staples at {2}','Tells you when the things you buy every week get more expensive at {2}, and where they did not.','Which staples?','e.g. "milk, bread, eggs, olive oil"','Compare current prices of the user’s staples at {v} with a month ago where published. Report rises and the cheapest current place for each. Local currency; say when a price could not be found.'],
  ['groc','meals','Home & life','🥗','weekly','A week of dinners from {2} offers','Seven dinners planned around what is on offer at {2} this week, with the shopping list.','How many people, and anything you avoid?','e.g. "2 adults, 1 child, no pork"','Plan seven dinners for the household described, built around this week’s offers at {v}. Give the list by store with estimated cost in the local currency.'],
  ['groc','swaps','Home & life','🔄','weekly','Own-brand swaps that save at {2}','Which of your usual products have a cheaper own-brand version at {2}, and how much you would save.','What do you usually buy?','e.g. "Nutella, Ariel, Coca-Cola, Pampers"','For each product the user named, find the own-brand equivalent at {v}, the price difference and a note on quality where reviewers compare them.'],
  ['shop','realdeal','Money','🔍','daily','Is it really a discount? ({2})','Checks the price history of things you are about to buy on {2}, so a fake sale does not get you.','What are you thinking of buying?','e.g. "a Samsung 55″ TV, a Dyson Airwrap"','For each item, find its price history on {v} and whether today’s "sale" price is genuinely low or a raised price with a discount on it. Say plainly when to wait.'],
  ['shop','returns','Money','↩️','weekly','Return windows about to close ({2})','What you bought recently on {2} and the last day each one can still go back.','What did you buy, and when?','e.g. "headphones on Amazon, 3 June; jacket from Zalando, 10 June"','For each purchase, work out the return deadline under the retailer’s policy and consumer law in {C}, and list them soonest first with how to return.'],
  ['shop','sales','Money','📅','weekly','Big sale dates on {2}','When the big sales on {2} happen this year, and what usually gets cheapest in each.','Anything specific you are waiting to buy?','e.g. "a laptop, a winter coat"','List the major sale events on {v} in {C} in the coming months with dates, what typically drops most, and when to buy the items the user named.'],
  ['shop','cheaper','Money','💸','daily','Cheaper than {1} elsewhere?','Finds the same product cheaper at another trusted shop in {C} before you pay.','What are you about to buy, and where?','e.g. "AirPods Pro on Amazon"','Find the same product at other reputable sellers in {C}, with price, delivery cost and seller reliability. Recommend the best total price.'],
  ['food','newplaces','Home & life','🍽️','weekly','New places on {2} near you','Restaurants that just joined {2} in your area, and which are worth trying.','Your area and what you like?','e.g. "Kreuzberg, Asian food"','Find restaurants newly listed on {v} in the user’s area, with cuisine, price level and early reviews. Only real listings.'],
  ['food','deliveryfees','Home & life','🛵','daily','Cheapest way to order tonight','Compares delivery fees and offers across {2} for the place you want tonight.','Which restaurant or dish, and your area?','e.g. "Five Guys, city centre"','Compare the total cost (items, delivery, service fees, current offers) of ordering the user’s choice via {v}. Name the cheapest.'],
  ['rail','strikes','Home & life','⚠️','daily','Strikes and works on {2}','Planned strikes, engineering works and closures on {2} that affect your routes.','Which routes do you use?','e.g. "Lyon to Paris, Paris RER B"','Check announced strikes, engineering works and closures on {v} affecting the user’s routes in the coming two weeks, with dates and alternatives.'],
  ['rail','release','Home & life','🎟️','weekly','Cheap tickets released on {1}','When cheap tickets go on sale for your trips on {1}, so you book the day they appear.','Which trips and dates?','e.g. "Madrid to Seville, 12 July"','Find when advance tickets are released on {v} for the trips named, the current cheapest fares and fare types. Say whether to book now or wait.'],
  ['rail','pass','Money','🧾','weekly','Is a rail pass worth it for you?','Compares a season ticket or railcard against what you pay now on {2}.','How often do you travel, and which routes?','e.g. "commute 4 days a week Leeds to York"','Compare the season tickets, passes and railcards on {v} against the user’s pattern of travel, with the yearly cost of each option.'],
  ['prop','rents','Home & life','🏘️','weekly','What rent costs in your area ({2})','Current asking rents on {2} for your area and size, and whether yours is high.','Your area, size, and what you pay?','e.g. "2-bed in Porto centre, paying 1,100"','From current listings on {v}, give the typical asking rent for the area and size, how the user’s rent compares, and the trend. Cite listings.'],
  ['prop','drops','Home & life','📉','daily','Price drops on homes you like ({2})','Homes on {2} matching your search whose asking price just came down.','Your search: area, budget, rooms?','e.g. "buy, Utrecht, up to 450k, 3 rooms"','Find listings on {v} matching the search whose asking price was reduced recently, with old and new price and link.'],
  ['banks','mortgage','Money','🏠','weekly','Mortgage rates in {C} this week','Current mortgage rates at {3} and online lenders, and what they mean for your payment.','Loan size, term, fixed or variable?','e.g. "250,000 over 25 years, fixed"','Compare current mortgage rates at {v} and reputable online lenders in {C} for the loan described, with the monthly payment for each. Information, not financial advice.'],
  ['banks','fees','Money','🧾','monthly','Bank fees you may be paying at {1}','The charges on accounts at {3} and which accounts in {C} would cost you nothing.','Which bank and account?','e.g. "Santander Cuenta Online"','Explain the current fees on the user’s account from the bank’s published tariff, and list fee-free alternatives in {C} with their conditions.'],
  ['banks','switch','Money','🔁','weekly','Bank switching offers in {C}','Banks in {C} currently paying you to switch, and the conditions attached.','','','List current switching and welcome offers from banks in {C} including {3}: the bonus, the conditions, the end date. Information, not financial advice.'],
  ['banks','cards','Money','💳','weekly','Credit card offers in {C}','The best current credit card deals in {C} for how you spend - cashback, travel, 0% periods.','How do you mainly use a card?','e.g. "groceries and travel, pay in full monthly"','Compare current credit card offers in {C} for the user’s spending: rewards, fees, rates, conditions. Information, not financial advice.'],
  ['pay','scams','Money','🛡️','weekly','Scams using {2} right now','The scams currently targeting people who pay with {2}, and how to spot them.','','','Report the scams currently circulating in {C} that abuse {v}: how they work, the red flags, and what to do if caught. Cite police, bank or consumer-agency warnings.'],
  ['pay','limits','Money','💱','monthly','Fees and limits on {2}','What {2} charges and caps in {C}, so a transfer never surprises you.','','','Summarise the current fees, limits and protections for {v} in {C} from official sources, and what changed recently.'],
  ['tax','deductions','Money','✂️','weekly','Deductions you can claim in {C}','The deductions and credits most people in {C} miss, checked against your situation.','Your situation?','e.g. "employee, renting, one child, commute by car"','From the official pages of {v}, list deductions and credits in {C} the user’s situation may qualify for, with the rules and evidence needed. Information, not tax advice.'],
  ['tax','refund','Money','💰','weekly','Your tax refund, tracked ({s})','Where your refund is with {s} and what to do if it is late.','When did you file, and how?','e.g. "filed online in April"','Explain how refunds from {v} are processed and tracked, typical timelines this year and what to do if it is late. Official sources only.'],
  ['tax','selfemployed','Money','🧮','weekly','Self-employed payments due ({s})','Advance payments, contributions and filings due to {s} if you work for yourself.','What do you do, and roughly what do you earn?','e.g. "freelance designer, 40k a year"','List upcoming payments and filings for the self-employed in {C} with {v}: dates, how the amounts are worked out, penalties. Information, not tax advice.'],
  ['id','travel','Home & life','🧳','weekly','Travel documents check before a trip','Whether your passport, visa and ID are valid for where you are going, in time to fix it.','Where are you going, when, and your passport expiry?','e.g. "Thailand in March, passport expires next August"','Check entry rules for the destination for a citizen travelling from {C}: passport validity required, visa, other documents; compare with the user’s dates and flag anything to fix, with official links.'],
  ['car','fines','Home & life','🚦','weekly','Fines, tolls and parking ({s})','New fines, tolls or parking penalties and how to pay or appeal them with {s}.','Which vehicle and where do you drive?','e.g. "2018 Golf, Milan"','Explain how to check for outstanding fines and tolls with {v}, deadlines for discounted payment and how appeals work in {C}. Official sources.'],
  ['car','value','Money','🚗','monthly','What your car is worth','What your car sells for now in {C}, from real listings.','Make, model, year, mileage?','e.g. "Toyota Corolla 2019, 60,000 km"','From current listings in {C}, give the realistic private and trade-in value of the car described, and what affects it.'],
  ['health','waits','Health','⏳','weekly','Waiting times with {s}','Current waiting times for appointments with {s} where you live, and faster routes.','What do you need, and where?','e.g. "dermatologist, Manchester"','From official published data, give current waiting times for the service named through {v}, and legitimate faster options. Not medical advice.'],
  ['health','insurance','Health','📋','monthly','Health cover renewal check','Before your health cover renews, what else in {C} would cover you for less.','What cover do you have and pay?','e.g. "private plan, 90 a month, single"','Compare the user’s health cover with current alternatives in {C}: price, cover, exclusions. Information, not advice.'],
  ['exams','papers','Learning','📚','weekly','Past papers for {s}','Official past papers and mark schemes for {s}, one set a week, with the answers explained.','Which subjects?','e.g. "maths and biology"','Find official past papers and mark schemes for {v} in the subjects named, set this week’s practice and explain the answers.'],
  ['exams','results','Learning','📨','weekly','Results and appeals for {s}','Results day, what to do on it, and how appeals and resits work for {s}.','','','From official sources, give the results date for {v}, how to get results, and how reviews, appeals and resits work, with deadlines.'],
  ['uni','grants','Learning','🎓','weekly','Scholarships and grants in {C}','Funding you could get for study in {C}, with deadlines.','What will you study, and where?','e.g. "engineering, starting next year"','List scholarships, grants and student finance in {C} relevant to the user, with eligibility, amounts and deadlines. Official sources.'],
  ['uni','housing','Learning','🛏️','weekly','Student housing near your university','Rooms and residences near your university and what they cost.','Which university and budget?','e.g. "University of Porto, up to 400 a month"','Find student residences and rooms near the university named with prices and application deadlines.'],
  ['news','evening','Watching the world','🌙','daily','Evening wrap from {2}','What happened in {C} today, in five lines, from {2}.','Anything to focus on?','e.g. "politics and my city"','Summarise today’s main news in {C} from {v} in five lines, weighted to what the user asked. Link sources.'],
  ['news','industry','Work & career','📊','weekly','News for your industry in {C}','What moved in your industry in {C} this week, from {2} and trade press.','Your industry?','e.g. "logistics"','Report this week’s notable news in the user’s industry in {C}: deals, rules, launches, hiring or layoffs. Link sources.'],
  ['weather','weekend','Home & life','☀️','weekly','The weekend forecast for your plans','Friday morning: the weekend forecast from {s} for where you will be, and what it means for your plans.','Where, and what are you planning?','e.g. "Brighton, a beach day Saturday"','Using the official forecast from {v}, give the weekend outlook for the place named and practical advice for the plans.'],
  ['gov','appts','Home & life','🗓️','daily','Government appointment slots','Watches for appointment slots at the office you need - the ones that vanish in minutes.','Which office and procedure?','e.g. "passport renewal, Lisbon Loja do Cidadão"','Check how appointments for the procedure named are booked in {C} and whether slots are showing, with the booking link. Never book.'],
  ['gov','benefits','Money','🤝','weekly','Benefits and support you may qualify for','Support in {C} people in your situation often do not claim, and how to apply.','Your situation?','e.g. "single parent, part-time, renting"','From official sources in {C}, list benefits and support the user may qualify for, with rules, amounts and how to apply. Information, not advice.'],
  ['telco','roaming','Money','🌍','weekly','Roaming costs for your next trip','What your plan with {1} charges abroad, and a cheaper option if there is one.','Your network, plan, and where you are going?','e.g. "Movistar, 30GB plan, going to Morocco"','Explain the roaming charges on the user’s plan from {v} for the destination and compare with travel eSIMs or add-ons.'],
  ['telco','broadband','Money','📶','monthly','Home internet deals in your area','Broadband and fibre offers from {3} where you live, against what you pay now.','Your area and what you pay?','e.g. "Lyon 3e, 40 a month, 300Mb"','Compare home internet offers available at the user’s area from {v} and others: speed, price, contract length.'],
  ['post','delays','Home & life','📦','daily','Delivery disruption with {2}','Strikes, delays and holiday cut-off dates with {2} that affect your parcels.','','','Report current disruption, strikes and last-posting dates with {v} in {C}.'],
  ['','holidays','Home & life','🎉','weekly','Public holidays and long weekends in {C}','The next public holidays in {C}, the long weekends they make, and what closes.','Which region, if holidays differ?','e.g. "Catalonia"','List the upcoming public holidays in {C} (and the region named), the long weekends they create, and what is closed. Official calendar.'],
  ['','events','Home & life','🎭','weekly','What is on this weekend near you','Concerts, markets, exhibitions and events near you this weekend.','Your city, and what you like?','e.g. "Seville; live music, markets"','Find real events this weekend in the user’s city matching their tastes, with times, prices and links.'],
  ['','localscams','Money','🚨','weekly','Scams going around in {C}','The scams police and banks in {C} are warning about this week, and how to spot them.','','','Report the scams currently circulating in {C} (texts, calls, parcels, online shopping, investment), with red flags. Cite police, regulators or consumer bodies.'],
  ['','fuel','Money','⛽','daily','Where fuel is cheapest near you','Today’s cheapest fuel near you, from published prices.','Your area and fuel type?','e.g. "Porto, diesel"','From published fuel price data in {C}, list the cheapest stations near the user’s area with prices and distance.'],
  ['','workrules','Work & career','⚖️','weekly','Pay and work-rule changes in {C}','Changes to minimum wage, holidays, overtime and contracts in {C}, and what they mean for you.','Your job and contract?','e.g. "full-time, retail, permanent contract"','Report recent and upcoming changes to employment law and pay in {C} relevant to the user. Official sources.'],
  ['','rates','Money','🏦','weekly','Interest rates and inflation in {C}, explained','What the central bank and prices did this week in {C}, and what it means for your money.','','','Explain this week’s central-bank decisions, inflation data and rate moves affecting {C} in plain terms, and what they mean for savers and borrowers. Information, not advice.'],
  ['','fx','Money','💱','daily','Exchange rate watch','Tells you when the currency you need hits a good rate.','Which currency, and what rate would you like?','e.g. "EUR to USD, above 1.12"','Report today’s exchange rate for the pair the user named, the recent trend, and whether it reached their target. Information, not advice.'],
  ['','energy','Money','⚡','weekly','Energy prices and tariff changes in {C}','Changes to electricity and gas prices in {C}, and whether a better tariff exists for you.','Your supplier and tariff?','e.g. "Endesa, fixed tariff"','Report changes to regulated and market energy prices in {C} and compare the user’s tariff with current alternatives.'],
  ['','schoolterms','Family & kids','🎒','weekly','School holidays and term dates in {C}','Term dates and school holidays where you live, so you can book before prices jump.','Which region or school district?','e.g. "Bavaria"','List the school term dates and holidays for the region named in {C} for the coming year. Official sources.'],
  ['','elections','Watching the world','🗳️','weekly','Votes and elections coming up in {C}','Elections, referendums and registration deadlines in {C}, with what is at stake.','','','List upcoming elections and referendums in {C}, registration deadlines and how to vote, with neutral summaries of what is being decided. Official sources.'],
  ['','disruption','Home & life','🚧','daily','Strikes and disruption in {C}','Transport, school and public-service strikes announced in {C} that could affect your week.','Your city?','e.g. "Paris"','Report strikes and major disruption announced in {C} for the coming week, affecting the user’s city, with dates and alternatives.'],
  ['','air','Health','🌫️','daily','Air quality and pollen where you live','Tells you on the days air quality or pollen is bad where you live.','Your town?','e.g. "Milan"','Check official air-quality and pollen forecasts for the town named in {C}; alert only when levels are high, with advice.'],
  ['','newlaws','Watching the world','📜','weekly','New laws taking effect in {C}','Rules that change this month in {C} and whether they touch you.','','','List laws and regulations taking effect in {C} this month and next that affect everyday life (money, housing, driving, work, consumer rights). Official sources.'],
  ['','flights','Home & life','✈️','weekly','Cheap flights from your airport','Fare drops from your nearest airport to the places you want to go.','Your airport and where you would like to go?','e.g. "from Dublin; Lisbon, Rome or anywhere sunny in May"','Find current cheapest fares from the airport named to the destinations, with dates and airlines. Never book.'],
  ['','kids','Family & kids','🧸','weekly','Things to do with kids this weekend','Family activities near you this weekend, free ones first.','Your city and the children’s ages?','e.g. "Madrid, ages 4 and 8"','Find family activities this weekend in the city named suited to the ages given, free ones first, with times and links.'],
  ['','free','Home & life','🏛️','weekly','Free museum days and events','Free entry days, open-air events and free things to do near you.','Your city?','e.g. "Berlin"','List free museum days, free events and free activities in the user’s city in the coming two weeks.'],
  ['','jobfairs','Work & career','🤝','weekly','Job fairs and hiring days near you','Recruitment fairs and open hiring days coming up near you.','Your city and field?','e.g. "Warsaw, IT"','Find job fairs and hiring events coming up in the user’s city and field, with dates and registration links.'],
  ['','pricerises','Money','📈','weekly','Price rises coming in {C}','Announced price rises in {C} - transport, utilities, subscriptions, postage - before they hit.','','','List price rises announced in {C} for the coming months (transport fares, utilities, postage, common subscriptions) with dates and amounts. Cite sources.'],
  ['','recalls','Home & life','⛔','weekly','Product recalls in {C}','Food, toy and product recalls in {C}, in case something in your home is on the list.','Anything you want watched specially?','e.g. "baby products, my car model"','List product recalls published by the authorities in {C} this week, and anything matching what the user named.'],
  ['','commute','Home & life','🛣️','daily','Roadworks and closures on your commute','Planned roadworks and closures on your route, before you leave.','Your route?','e.g. "A1 from Porto to Aveiro"','Check planned roadworks, closures and major incidents on the user’s route in {C} today and this week.'],
  ['','team','Watching the world','⚽','weekly','Your team, this week','Fixtures, results, injuries and ticket releases for the team you follow.','Which team?','e.g. "Benfica"','Give this week’s fixtures, last results, team news and any ticket releases for the team named.'],
  ['','concerts','Home & life','🎵','weekly','Concert tickets for artists you like','Tells you when artists you like announce shows near you, before tickets sell out.','Which artists, and your city?','e.g. "Rosalía, Coldplay; Barcelona"','Check for newly announced concerts in or near the user’s city by the artists named, with ticket release dates and official sellers only.'],
  ['','carinsurance','Money','🛡️','monthly','Car insurance renewal check','Before your car insurance renews, cheaper cover in {C} for the same car.','Your car, age, and what you pay?','e.g. "2017 Clio, 34, 480 a year"','Compare typical current premiums in {C} for the profile described against what the user pays, and how to cut the cost. Information, not advice.'],
  ['','homeinsurance','Money','🏠','monthly','Home insurance check','Whether your home or contents cover in {C} is fair value, before it renews.','What cover and what you pay?','e.g. "contents, rented flat, 180 a year"','Compare the user’s home or contents cover with current alternatives in {C}: price, cover, excess.'],
  ['','visa','Home & life','🛂','weekly','Entry rules for your next trip','Visa, entry and health rules for where you are going from {C}, checked again before you fly.','Where and when?','e.g. "USA in December"','Check the current entry requirements for a traveller from {C} to the destination named: visa or travel authorisation, passport validity, health rules. Official links.'],
  ['','healthalerts','Health','💉','weekly','Health advisories and vaccination campaigns in {C}','Public-health advisories and free vaccination campaigns where you live.','','','Report current public-health advisories and vaccination campaigns in {C} from the health authority, with who is eligible and how to book.'],
  ['','volunteer','Home & life','💚','weekly','Volunteering near you','Volunteering and community events near you that fit the time you have.','Your city and how much time?','e.g. "Toronto, Saturday mornings"','Find volunteering opportunities and community events in the city named that fit the time given, with links.'],
  ['','secondhand','Money','♻️','daily','Second-hand deals on what you want','Watches second-hand listings near you for what you are after, at your price.','What, and your maximum price?','e.g. "a road bike under 300, size M"','Search the main second-hand marketplaces used in {C} for the item named under the price given, near the user. Only real listings; flag likely scams.'],
  ['','discounts','Money','🎟️','weekly','Discounts you are entitled to in {C}','Student, youth, senior and family discounts in {C} you may not be using.','Your age and situation?','e.g. "student, 21"','List discounts and reduced fares in {C} the user is entitled to (transport, culture, software, phones), with how to get each.'],
  ['','localtax','Money','🏛️','monthly','Local taxes and municipal charges due','Property, waste and municipal charges where you live - how much and by when.','Your town and whether you own or rent?','e.g. "Valencia, owner"','Explain the local taxes and municipal charges in the user’s town in {C}: amounts, due dates, payment and discounts. Official sources.'],
  ['','parking','Home & life','🅿️','weekly','Parking rules and zones in your city','Resident permits, zone changes and new parking rules in your city.','Your city and neighbourhood?','e.g. "Amsterdam, De Pijp"','Report parking rules, permit costs and recent changes for the neighbourhood named. Official sources.'],
  ['','restaurants','Home & life','🍴','weekly','New restaurants worth trying near you','The openings people are actually recommending in your area this month.','Your area and tastes?','e.g. "Shoreditch, Korean or Italian"','Find restaurants that opened recently in the user’s area with genuine early reviews, price level and booking links.'],
  ['','rentrights','Home & life','🔑','monthly','Your rights as a tenant in {C}','Rent increases, deposits and repairs: what the rules in {C} say about your situation.','What is happening with your rental?','e.g. "landlord wants 15% more at renewal"','Explain what tenancy law in {C} says about the situation described, the limits and steps, with official sources. Not legal advice.'],
  ['','consumer','Money','🧾','weekly','Refunds and your consumer rights in {C}','When a company owes you a refund in {C}, and how to get it.','What went wrong?','e.g. "flight delayed 5 hours", "faulty washing machine"','Explain the consumer rights in {C} that apply to the situation described, what the user is owed and exactly how to claim. Cite official sources. Not legal advice.'],
  ['','savings','Money','🐷','weekly','Where your savings earn most in {C}','The best easy-access and fixed savings rates in {C} this week.','Easy access or fixed, and how much?','e.g. "easy access, 10,000"','List the best current savings rates in {C} for the type named, with the deposit protection that covers each. Information, not financial advice.'],
  ['','budget','Money','📊','monthly','Your monthly budget, in {C} prices','A budget for your household built on what things really cost in {C} now.','Household, income and main costs?','e.g. "couple, 3,200 net, rent 1,100"','Build a monthly budget for the household described using current typical costs in {C}, highlighting where they are above average and realistic savings.'],
  ['','phoneplan','Money','📱','monthly','Is your phone contract still a good deal?','Checks your phone contract against what the same usage costs today in {C}.','Your network, what you pay and use?','e.g. "20 a month, 10GB"','Compare the user’s mobile contract with current offers in {C} for the same usage, including budget brands.'],
  ['','outages','Home & life','🔌','daily','Power and water cuts in your area','Scheduled electricity and water cuts where you live, before they happen.','Your town and area?','e.g. "Johannesburg, Soweto"','Check the published schedules of the electricity and water utilities in {C} for the area named: planned cuts today and this week, with times. Only official schedules.'],
  ['','remit','Money','📤','weekly','Cheapest way to send money abroad from {C}','Compares fees and exchange rates for sending money to family, so more of it arrives.','How much, and to which country?','e.g. "200 to Nepal every month"','Compare the total cost (fees plus exchange-rate margin) of sending the amount named from {C} to the destination with the main banks, money-transfer apps and agents. Name the cheapest and how long it takes.'],
  ['','govjobs','Work & career','🏛️','weekly','Public-sector jobs and exams in {C}','New government and public-sector openings and recruitment exams in {C}, with deadlines.','Your field and qualifications?','e.g. "graduate in accounting"','Find public-sector vacancies and recruitment exams announced in {C} matching the user’s field, from official portals, with deadlines and how to apply.'],
  ['','gold','Money','🪙','daily','Gold price in {C} today','The local gold price per gram today, and how it moved this week.','Which purity?','e.g. "22 carat"','Report today’s gold price in {C} in the local currency for the purity named, the week’s change and the source. Information, not advice.'],
  ['','staples','Money','🌾','weekly','Prices of staples in {C} this week','What rice, flour, oil, eggs and cooking gas cost this week in {C}, and what changed.','Your city?','e.g. "Karachi"','Report current prices of staple foods and cooking fuel in {C} (the city named where data exists) and the change from last week, from official or market sources.'],
  ['','pharmacy','Health','💊','daily','Pharmacies open near you tonight','The duty pharmacies open late near you tonight.','Your town and area?','e.g. "Casablanca, Maarif"','List the on-duty (late-night or weekend) pharmacies in the user’s area in {C} for tonight, from the official rota where one exists.'],
  ['','bus','Home & life','🚌','weekly','Cheapest bus and coach tickets','Coach and intercity bus fares for your trips, cheapest first.','Which trip and date?','e.g. "Lima to Arequipa, Friday"','Find current intercity bus and coach fares for the trip named in {C}, with operators, times and links. Never book.'],
  ['','ride','Money','🚕','daily','Ride-hailing prices, compared','Which ride app is cheapest for your usual trip right now.','Your usual trip?','e.g. "home to airport"','Compare typical current fares on the ride-hailing apps used in {C} for the trip named, and when prices surge.'],
  ['','farm','Money','🚜','weekly','Crop and livestock prices in {C}','This week’s market prices for what you grow or raise, and the weather ahead.','What do you grow or raise, and where?','e.g. "maize and beans, Nakuru"','Report this week’s market prices in {C} for the crops or livestock named, from official market data, and the weather outlook for the area.'],
  ['','market','Money','📈','daily','The stock market in {C} today','How the main index in {C} closed, and the moves in shares you follow.','Which shares, if any?','e.g. "the main banks"','Report today’s close of the main stock index in {C} and the moves of the shares named, with the reasons reported. Information, not financial advice.'],
  ['','calendar','Home & life','🕌','weekly','Religious and cultural calendar in {C}','Festivals, fasting dates and religious holidays in {C} this month, with the times that matter.','Anything specific?','e.g. "Ramadan timings", "Diwali"','List the religious and cultural observances in {C} in the coming weeks, with dates and local times where they depend on it, and what closes. Neutral and factual.'],
  ['','drivingtest','Learning','🚘','weekly','Driving test and licence steps in {C}','Where you are in getting a licence in {C}, the next step, and test slots.','Where are you in the process?','e.g. "passed theory, need practical test"','Explain the licence process in {C} from the user’s stage, fees, and how to find test slots, from official sources.'],
  ['','getaway','Home & life','🏖️','weekly','Weekend getaways from your city','Two-day trips from where you live, with what they cost this month.','Your city and budget?','e.g. "Nairobi, up to 150 for two"','Suggest weekend trips from the user’s city in {C} within the budget, with travel, stay and current prices.'],
  ['','hotels','Money','🏨','weekly','Hotel prices for your next trip','Watches the hotel prices for your dates and tells you when they drop.','Where and which dates?','e.g. "Cartagena, 12-15 December"','Check current prices for hotels in the place and dates named, and report drops and good-value options. Never book.'],
  ['','clinics','Health','🏥','weekly','Clinics and doctors near you','Clinics and doctors near you with the specialism you need, and how to book.','What do you need, and where?','e.g. "paediatrician, Accra"','Find clinics and doctors in the user’s area in {C} with the specialism named, opening hours, and how to book. Not medical advice.'],
  ['','gym','Health','🏋️','weekly','Gyms and classes near you','Gyms and fitness classes near you, with prices and trial offers.','Your area and what you like?','e.g. "Tbilisi Vake, yoga"','Find gyms and classes in the user’s area in {C} matching their interest, with prices and trial offers.'],
  ['','tenders','Growing a business','📑','weekly','Government tenders for your business in {C}','New public tenders and contracts in {C} that fit what your business does.','What does your business do?','e.g. "IT services and hardware supply"','Find newly published public tenders in {C} matching the business described, with deadlines and links, from official procurement portals.'],
  ['','bizlicence','Growing a business','🪪','monthly','Business licences and filings due in {C}','Registration renewals, permits and filings your business owes in {C}, before they lapse.','Your business type and city?','e.g. "restaurant, Amman"','List the licences, permits and periodic filings a business of this type must keep current in {C}, with renewal dates and costs. Official sources.'],
  ['','smbtax','Growing a business','🧾','weekly','Sales tax and VAT changes for small businesses in {C}','Changes to VAT, sales tax or small-business tax rules in {C} that affect you.','Your business?','e.g. "online shop, turnover 80k"','Report changes to VAT, sales tax and small-business tax regimes in {C} relevant to the business described. Official sources; not tax advice.'],
  ['','abroad','Learning','🌍','weekly','Scholarships abroad for students from {C}','Funded study-abroad places open to students from {C}, with deadlines.','What level and subject?','e.g. "master’s in public health"','List scholarships open to citizens of {C} for the level and subject named, with eligibility, value and deadlines. Official sources.'],
  ['','phones','Money','📱','weekly','Phone and electronics prices in {C}','The going price of the phone or laptop you want in {C}, and where it is cheapest.','What do you want?','e.g. "iPhone 15, 128GB"','Find the current price of the device named from reputable sellers in {C}, the cheapest legitimate offer, and warnings about grey imports.'],
  ['','cookinggas','Money','🔥','weekly','Cooking gas and home fuel prices','The price of cooking gas and heating fuel in {C} this week, and any subsidy.','Your city?','e.g. "Dhaka"','Report current prices of cooking gas (LPG) and home fuel in {C}, recent changes and any subsidy scheme. Official sources.'],
  ['','flightshome','Money','🏠','weekly','Flights home for the holidays','Watches fares for your trip home for the holidays, so you book at the low point.','From where to where, and when?','e.g. "London to Lagos, Christmas"','Track current fares for the route and dates named and say when fares are low. Never book.'],
  ['','localnews','Watching the world','🏙️','daily','News from your city in five lines','What happened in your city today - local news only.','Your city?','e.g. "Medellín"','Summarise today’s local news for the city named in {C} in five lines from local outlets, with links.'],
  ['','traffic','Home & life','🚥','daily','Traffic before you leave','Each morning, how long your commute will take today and anything blocking it.','Your route and time?','e.g. "Westlands to CBD, 7:30"','Report current traffic, closures and incidents on the route named and the expected travel time.'],
  ['','dailyweather','Home & life','⛅','daily','Tomorrow’s weather where you live','Each evening, tomorrow’s weather where you are and what to wear or bring.','Your town?','e.g. "Ulaanbaatar"','Give tomorrow’s forecast for the town named from the national weather service of {C} and practical advice.'],
  ['','crypto','Money','🪙','daily','Crypto prices in your currency','The coins you follow, priced in your currency, and big moves.','Which coins?','e.g. "BTC, ETH"','Report today’s prices of the coins named in the local currency of {C} and notable moves, with the source. Information, not financial advice; never suggest trading.'],
  ['','schoolfees','Family & kids','🏫','monthly','School fees, grants and supplies this term','What this term costs at school - fees, uniforms, books - and any help available in {C}.','Your children’s ages and type of school?','e.g. "ages 7 and 12, public school"','Explain the typical costs for the coming term in {C} for the children described, and grants or subsidies available, from official sources.'],
  ['','childcare','Family & kids','👶','monthly','Childcare support and places in {C}','Childcare support, free hours and nursery places you may be able to get in {C}.','Your children’s ages and work situation?','e.g. "age 2, both parents working"','From official sources in {C}, list childcare support and free hours the family may qualify for, and how to find places.'],
  ['','pension','Money','🧓','monthly','Your pension and retirement rules in {C}','Changes to state pension and retirement rules in {C}, and what they mean for you.','Your age and situation?','e.g. "52, employed, private scheme"','Explain the state pension and retirement rules in {C} relevant to the user, and recent or upcoming changes. Official sources; not advice.'],
  ['','ccrates','Money','💳','monthly','Loan and credit rates in {C}','Personal-loan and credit rates on offer in {C} now, if you need to borrow.','How much, and for what?','e.g. "5,000 for a car, 3 years"','Compare current personal-loan offers in {C} for the amount and term named: rate, total cost, conditions. Information, not advice.'],
  ['','wedding','Home & life','💍','weekly','Planning an event in {C}','Venues, prices and suppliers for the event you are planning, within budget.','What event, where, how many guests, budget?','e.g. "wedding, Istanbul, 120 guests"','Find venues and key suppliers in {C} for the event described, with current prices and availability.'],
  ['','pets','Home & life','🐾','weekly','Vets and pet care near you','Vets, vaccination reminders and pet-care costs near you.','Your area and pet?','e.g. "Bogotá, a dog"','Find vets near the area named in {C}, opening hours, typical costs for routine care, and vaccination schedules.'],
  ['','charity','Watching the world','🤝','weekly','Verified appeals and how to help in {C}','Registered charities and emergency appeals in {C}, checked as genuine.','Any cause you care about?','e.g. "flood relief"','List current appeals in {C} from registered charities (check the registration), with how donations are used. Flag known fake appeals.'],
  ['','hobby','Home & life','🎨','weekly','Clubs and classes for your hobby','Clubs, courses and meet-ups near you for what you enjoy.','Your hobby and city?','e.g. "chess, Yerevan"','Find clubs, classes and meet-ups in the city named for the hobby, with times and costs.'],
  ['','transit','Money','🚌','monthly','Public transport passes in your city','The monthly passes, discounts and fare changes on buses, trams and metro where you live - and which one fits how you travel.','Your city, and how often you ride?','e.g. "Lisbon, metro twice a day on weekdays"','From the official transport operators of the user’s city in {C}, list current fares, passes and discounts (student, youth, senior, low income), any fare changes announced, and which option costs the user least per month.'],
  ['','training','Learning','🎓','weekly','Free and funded courses in {C}','Government-funded training, free courses and certifications open to you in {C}.','What do you want to learn, or which field?','e.g. "data analysis", "forklift licence", "English"','Find free or state-funded courses and certifications in {C} in the field named: provider, format, dates, cost after funding, who qualifies. Only programmes currently open.'],
  ['','moving','Home & life','📦','monthly','Moving to {C}: your paperwork, step by step','Residence, registration, tax number, bank account, health cover - the next step for somebody settling in {C}.','Where are you from, and what have you done so far?','e.g. "EU citizen, arrived last month, have a flat"','Using official immigration and government sources for {C}, lay out the registration steps for a newcomer in the user’s situation in the right order, what each needs, and which one to do next. Flag deadlines.'],
  ['','bizgrants','Growing a business','🌱','weekly','Grants and funding for small businesses in {C}','Open grants, subsidised loans and programmes for businesses like yours in {C}, with the deadlines.','Your business: sector, size, stage?','e.g. "bakery, 4 staff, 3 years old"','Find currently open grants, subsidised loans and support programmes in {C} for the business described: who runs it, the amount, eligibility, deadline, link. Only programmes open now.'],
  ['','rivals','Growing a business','🔭','weekly','What your competitors did this week','New prices, offers, openings and reviews from the businesses you compete with in {C}.','Your business and the competitors you watch?','e.g. "hair salon in Valencia; Salon X, Studio Y"','Check the public websites, social pages and review listings of the competitors named and report what changed this week: prices, offers, openings, notable reviews. Only what can be seen publicly, with links.'],
  ['','reviews','Growing a business','⭐','daily','New reviews of your business','New public reviews of your business, and a reply drafted for each one that needs it.','Your business name and town?','e.g. "Café Sol, Seville"','Find new public reviews of the business named on the review sites used in {C}, summarise each, and draft a courteous reply for any that needs one. Never post anything.'],
  ['','firsthire','Growing a business','🧑‍💼','monthly','Hiring your first employee in {C}','Contracts, registration, payroll tax and the minimum wage in {C} - what hiring someone involves, in order.','What role, full or part time?','e.g. "part-time shop assistant"','From official sources for {C}, explain what an employer must do to hire the person described: registration, contract type, minimum pay, employer contributions, payroll filings and deadlines. Information, not legal advice.'],
  ['','internships','Work & career','🧑‍🎓','weekly','Internships and graduate schemes in {C}','Open internships and graduate programmes in your field in {C}, with closing dates.','Your field and when you finish studying?','e.g. "engineering, graduating next June"','Find currently open internships and graduate schemes in {C} for the field named: employer, pay where stated, closing date, link. Only real, open postings.'],
  ['','freelance','Work & career','🧰','weekly','Freelance and side work in {C}','Paid freelance projects and side work for your skills, plus the tax rules for side income in {C}.','Your skills?','e.g. "translation EN-ES, copywriting"','Find current freelance projects and side-work openings for the user’s skills from platforms and boards used in {C}, and summarise the rules for declaring side income there.'],
  ['','races','Health','🏃','weekly','Runs, races and sports events in {C}','Races, rides and amateur sports events near you with entry deadlines.','Your sport and area?','e.g. "running, 10k to half marathon, Barcelona"','List upcoming amateur races and sports events in the user’s sport and area in {C}: date, distance or format, entry fee, entry deadline, link.'],
  ['','mind','Health','🫶','weekly','Free mental-health support in {C}','Free and low-cost support lines, services and groups in {C}, and how to reach them today.','Anything specific (stress, grief, a young person)?','e.g. "support for a teenager"','List free and low-cost mental-health services in {C} relevant to what the user named, from official and established charity sources: what each offers, hours, how to reach it. Always include the national emergency number and crisis line for {C}.'],
  ['','warnings','Home & life','🌩️','daily','Severe weather warnings for your area','Official storm, flood, heat and snow warnings where you live, the evening before they hit.','Your town or region?','e.g. "Valencia province"','Check the official meteorological service of {C} for warnings for the user’s area over the next 48 hours: type, level, timing, official advice. If there are none, say so in one line.'],
  ['','checkups','Family & kids','🩺','monthly','Your child’s check-ups and vaccines in {C}','Which check-ups and vaccinations are due for your child’s age under the schedule in {C}.','Your child’s age?','e.g. "14 months"','From the official health ministry schedule for {C}, list the check-ups and vaccinations due for a child of the age named and in the next six months, and how to book them. Information, not medical advice.'],
  ['','parental','Family & kids','👶','monthly','Parental leave and family benefits in {C}','What parental leave, child benefit and childcare support you are entitled to in {C}, and the deadlines to claim.','Your situation (expecting, new baby, employed or self-employed)?','e.g. "expecting in March, employed full time"','From official sources for {C}, explain the parental leave, pay, child benefit and childcare support for the situation described, how to claim each, and the deadlines.'],
  ['','eldercare','Family & kids','🧓','monthly','Care for an older parent in {C}','Home help, care allowances and residential options for an older relative in {C}, and how to apply.','Their situation and area?','e.g. "mother, 82, lives alone, Lyon"','From official and established sources for {C}, set out the care support available for the person described: home help, allowances, day centres, residential care, costs and how to apply locally.'],
  ['','homeprices','Money','🏡','monthly','Home prices in your city','What homes sell for in your city this quarter, and whether prices are rising or falling.','Your city or area?','e.g. "Manchester"','From official statistics and major property sources for {C}, give the current typical home price in the user’s city, the change over the last year, and the direction. Cite sources.'],
  ['','breaches','Watching the world','🔓','weekly','Data breaches that may include you','Breaches at companies people in {C} use, what leaked, and exactly what to change.','Which services do you use?','e.g. "my telecom, my bank, a food delivery app"','Report data breaches disclosed recently at companies used in {C}, especially the services the user named: what leaked, when, and the specific steps to take. Cite the company’s notice or the data-protection authority.'],
  ['','studydeadlines','Learning','🗓️','weekly','University application deadlines in {C}','When applications, grants and entrance tests open and close in {C} for the course you want.','Which course or field, and for when?','e.g. "medicine, starting next September"','From official university and education-ministry sources for {C}, list the application windows, entrance-test dates and grant deadlines for the course and year named, soonest first.'],
  /* Jobs only some countries need, gated by CW_SIGNAL rather than by a fact,
     each from a published source (see CW_SIGNAL). */
  ['@MUSLIM','prayer','Home & life','🕌','daily','Prayer times and Ramadan dates for your city','Today’s prayer times where you are, and the Ramadan, Eid and holiday dates as the official bodies in {C} announce them.','Which city?','e.g. "Riyadh"','From the official religious authority or national calendar for {C}, give today’s prayer times for the user’s city and the announced dates for Ramadan, Eid and the related public holidays, saying which dates are confirmed and which still await the moon sighting. Link the source.'],
  ['@POWER','loadshedding','Home & life','🔌','daily','Power cuts and load-shedding for your area','The published load-shedding stage and cut times for your area today and tomorrow, from the utility in {C}.','Which town, and which area or zone?','e.g. "Soweto, block 7"','Check the utility’s official load-shedding or outage schedule in {C} for the user’s area today and tomorrow: the stage, the exact times and any change announced. If there is none, say so in one line. Link the source.'],
  ['@PREPAID','bundles','Money','📶','weekly','Cheapest data bundles this week','The best-value prepaid data and airtime bundles from the networks in {C}, for how much you actually use.','Which network, and how much data a week?','e.g. "Safaricom, about 3GB a week"','Compare the current prepaid data and airtime bundles from the mobile networks in {C} for the user’s usage: price per GB, validity, and any night-only or app-only catch. Name the cheapest that fits, with the link or dial code.'],
  ['@PARALLEL','parallel','Money','💱','daily','The official and the parallel exchange rate today','Today’s official rate and the parallel-market rate as reported in {C}, and how far apart they are.','Which currency?','e.g. "US dollars"','Report today’s official exchange rate in {C} for the currency named and the parallel-market rate as reported by named, reputable outlets, the gap between them and how it moved this week. Information only: never advise buying or selling, and say plainly that trading outside official channels may be illegal.'],
  ['@FUELWEEK','fuelweek','Money','⛽','weekly','Fuel prices, set {cycle}','The pump price {C} sets {cycle}, the change, and whether to fill up before it takes effect.','Petrol or diesel?','e.g. "petrol"','{C} sets fuel prices {cycle}. Check the latest official announcement: the new pump price for the user’s fuel, the change from the last one, and the date it takes effect. If the next one is not out yet, say when it is due. Link the official source.'],
]
};

/* ═════════════════════════════════════════════════
   MISSION CONTROL'S SCREEN - shipped inside crew-data.js (see build.mjs).

   Moved out of the page, unchanged, by following what the rest of the app
   calls (audit #40): everything here is reached only from the Crew screen
   itself, so it waits for the first time somebody opens it. What other parts
   of the app call without the screen open stays in
   src/app/10b-mission-control-view.js, beside a stand-in renderCrewView that
   this file's real one replaces when it loads. A classic script, like the
   page: it uses the page's own helpers and declares its functions globally.
   ═════════════════════════════════════════════════ */
function _setAutonomyPaused(v){ try{ saveStr('amv_autonomy_paused', v?'1':'0'); }catch(e){} }
/* The emergency stop. _setAutonomyPaused only halts the schedule THIS browser
   walks; server-side jobs run on the worker's cron and keep going until the
   server is told. The call was fired and forgotten and the message went out
   regardless, so a failed request left somebody reading "nothing runs until you
   resume" while their autonomous jobs carried on doing things.

   A safety control is the last place to report an outcome it did not wait for,
   so this waits, and says plainly what is still running if it could not. */
async function _setAutonomyEverywhere(paused){
  _setAutonomyPaused(paused);              // local first: this half always works
  if(!(window.AMV_API && AMV_API.live && AMV_API.pauseAutonomy))
    return { ok:false, code:'needs_service' };
  try{ await AMV_API.pauseAutonomy(paused); return { ok:true }; }
  catch(e){ return { ok:false, code:'failed', error:(e&&e.message)||'' }; }
}
async function pauseAllAutonomous(){
  const res = await _setAutonomyEverywhere(true);
  renderCrewView();
  if(res.ok){ toast('All autonomous work paused - nothing runs until you resume.','info',3800); return; }
  toast(res.code === 'needs_service'
    ? 'Paused on this device. AMV is not connected to a backend, so there is no server-side work to stop.'
    : 'Paused on this device, but the server was NOT told'+(res.error?' ('+res.error+')':'')+
      ' - anything scheduled to run in the background is STILL RUNNING. Try again.',
    res.code === 'needs_service' ? 'info' : 'error', 8000);
}
async function resumeAllAutonomous(){
  const res = await _setAutonomyEverywhere(false);
  renderCrewView();
  if(res.ok){ toast('Autonomous work resumed.','success'); return; }
  toast(res.code === 'needs_service'
    ? 'Resumed on this device.'
    : 'Resumed on this device, but the server was NOT told'+(res.error?' ('+res.error+')':'')+
      ' - background work stays paused until it is. Try again.',
    res.code === 'needs_service' ? 'success' : 'error', 8000);
}
try{ window._setAutonomyEverywhere=_setAutonomyEverywhere; }catch(e){}
window.pauseAllAutonomous=pauseAllAutonomous; window.resumeAllAutonomous=resumeAllAutonomous;

function _mcState(){
  const appr=_cwApprovals();
  const jobs=_cwJobs();
  const sched=(typeof _loadSched==='function')?_loadSched():[];
  const bg=(typeof _bgQueue!=='undefined'&&_bgQueue.tasks)?_bgQueue.tasks:[];
  /* A finished RUN is not a finished JOB.

     Every run marked itself `done` and dropped into the Completed pile, so a
     job scheduled for 9am every day showed as "Completed" after its first
     morning - while it kept running every morning after that. The schedule and
     the run lived in two separate lists and nothing joined them, so nothing
     could tell the difference.

     A run carries the id of the job it belongs to now. If that job is still
     scheduled, the run is history for a job that is very much alive, and it
     belongs with the job rather than in Completed. Only work that has genuinely
     finished for good lands there. */
  const liveJobIds=new Set(sched.map(t=>t.id));
  const isRunOfLiveJob=t=>!!(t.schedId && liveJobIds.has(t.schedId));
  return {
    appr,
    active: bg.filter(t=>t.status==='running'||t.status==='queued'),
    failed: bg.filter(t=>t.status==='failed'),
    done: bg.filter(t=>t.status==='done' && !isRunOfLiveJob(t)),
    runsOfJobs: bg.filter(t=>t.status==='done' && isRunOfLiveJob(t)),
    auton: jobs.filter(j=>j.on),
    sched,
    /* THE JOBS THE SERVER IS ACTUALLY RUNNING.

       This section used to render `sched` alone - a list in this browser's
       localStorage, with the server's id stapled on afterwards. The cron does
       not read that list. It reads the account's own record, which is why a job
       kept running after the local entry was gone, and why a job set up on a
       phone was invisible on a laptop while quietly spending money on both.

       So the server's list is the truth here, and the local one is only for
       work that never made it to the server (no engine connected, plan cannot
       schedule) - which is real, still runs while AMV is open, and now says so
       instead of being displayed identically to background work. */
    server: (typeof _AUTOS !== 'undefined' && Array.isArray(_AUTOS)) ? _AUTOS : [],
    serverLoaded: (typeof window._autoLoadState === 'function') ? !!window._autoLoadState().loaded : false,
    serverError: (typeof window._autoLoadState === 'function') ? (window._autoLoadState().error || '') : ''
  };
}
/* Asked once per session, not once per render - renderCrewView runs on every
   toggle, and a refresh that triggers a render that triggers a refresh is a
   loop against the user's own backend. */
let _mcAskedServer = false;
/* Local entries that the server also knows about, so one job is one row. */
function _mcLocalOnly(st){
  const known = new Set((st.server||[]).map(x=>x.id));
  return (st.sched||[]).filter(t=>!(t.autoId && known.has(t.autoId)));
}
/* When a recurring job last produced something, so the card can say "ran this
   morning, runs again tomorrow" rather than implying it has never run. */
function _mcLastRunOf(st, jobId){
  const runs=(st.runsOfJobs||[]).filter(t=>t.schedId===jobId);
  if(!runs.length) return null;
  return runs.reduce((a,b)=>((b.created||0)>(a.created||0)?b:a));
}
function _mcActiveCard(t){
  const running=t.status==='running';
  const bar = running
    ? (t.progress ? `<div class="mc-bar"><span style="width:${Math.max(6,Math.min(100,t.progress))}%"></span></div>` : `<div class="mc-bar indet"><span></span></div>`)
    : '';
  return `<div class="mc-card"><div class="mc-card-top"><span class="mc-card-t">${escH(t.title||t.type||'Task')}</span><span class="mc-pill ${running?'run':'wait'}">${running?'Running':'Queued'}</span></div>${bar}<div class="mc-card-sub">${running?'AMV is working on this now.':'Waiting to start.'}</div></div>`;
}
function _mcFailCard(t){
  return `<div class="mc-card fail"><div class="mc-card-top"><span class="mc-card-t">${escH(t.title||'Task')}</span><span class="mc-pill err">Needs you</span></div><div class="mc-card-sub">${escH(t.error||'This task could not complete.')}</div><div class="mc-card-act"><button class="btn mc-mini" data-dact="_mcRetry" data-darg="${t.id}">Retry</button></div></div>`;
}
function _mcRetry(id){
  const t=((typeof _bgQueue!=='undefined'&&_bgQueue.tasks)||[]).find(x=>x.id===id); if(!t){ renderCrewView(); return; }
  t.status='queued'; t.error=null; t.progress=0;
  if(typeof _bgRunNext==='function') _bgRunNext();
  toast('Retrying - running in the background','info'); renderCrewView();
}
window._mcRetry=_mcRetry;
function _mcSchedRow(t, st){
  const when = t.sched?((typeof _schedHumanOf==='function')?_schedHumanOf(t.sched):''):((typeof _freqLabel==='function')?_freqLabel(t.freq):'');
  let next='';
  try{ if(t.next) next=new Date(t.next).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }catch(e){}
  /* "Ran this morning, runs again tomorrow" is the sentence that tells somebody
     the job is alive. Its absence is why a running job read as a finished one. */
  let ran='';
  try{
    const last=st?_mcLastRunOf(st,t.id):null;
    const at=(last&&last.created)||t.lastRun;
    if(at) ran=new Date(at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  }catch(e){}
  const auto = t.approval==='auto';
  let waiting=0; try{ waiting=_cwApprovals().filter(a=>a.fromJob===t.id).length; }catch(e){}
  const mode = t.paused
    ? '<span class="mc-sched-mode paused">Paused</span>'
    : (auto ? '<span class="mc-sched-mode auto">Autonomous - sends automatically</span>'
            : '<span class="mc-sched-mode req">Ask first - you approve each one</span>');
  const waitChip = (!auto && waiting) ? `<span class="mc-sched-waiting">${waiting} waiting in Needs your approval</span>` : '';
  /* A job the quiet-hours window pushed back says so on its own row. Otherwise
     the only evidence is a "next" time that moved, which reads like the
     schedule being wrong rather than like the setting working. */
  const heldChip = (t.heldUntil && t.heldUntil > Date.now())
    ? '<span class="mc-sched-quiet">Held until your quiet hours end</span>' : '';
  return `<div class="mc-sched-row">
    <div class="mc-sched-b">
      <div class="mc-sched-goal">${escH(t.goal||'Scheduled job')}</div>
      <div class="mc-sched-meta">${escH(when)}${ran?` · last ran ${escH(ran)}`:''}${next?` · next ${escH(next)}`:''}${t.localOnly?' · runs while AMV is open':''}</div>
      <div class="mc-sched-mode-row">${mode}${waitChip}${heldChip}</div>
    </div>
    <div class="mc-sched-acts">
      <button class="btn mc-mini ${auto?'ghost':'bp'}" data-dact="_schedToggleApproval" data-darg="${t.id}">${auto?'Make me approve first':'Make autonomous'}</button>
      <button class="btn mc-mini ghost" data-dact="_schedEdit" data-darg="${t.id}">Edit</button>
      <button class="btn mc-mini ghost" data-dact="_mcCancelSched" data-darg="${t.id}">Cancel</button>
    </div>
  </div>`;
}
/* CHECKED, then said. The save was wrapped in an empty catch and the message
   went out regardless, so a write that failed - storage full, storage disabled,
   a private window - told somebody a job was cancelled while it stayed on the
   schedule and kept running. This one is local, which is exactly why it is
   worth getting right: there is no server to correct it later. */
async function _mcCancelSched(id){
  let gone = false;
  /* The server's copy first - see _schedServer. */
  const t0 = _loadSched().find(t=>t.id===id);
  if(t0 && typeof _schedServer === 'function' && !await _schedServer(t0, 'delete')){
    toast('AMV\u2019s server could not be reached, so the job was not cancelled - it still runs there. Try again in a moment.', 'error', 7000);
    renderCrewView(); return;
  }
  try{
    _saveSched(_loadSched().filter(t=>t.id!==id));
    gone = !_loadSched().some(t=>t.id===id);
  }catch(e){ gone = false; }
  toast(gone ? 'Scheduled task cancelled'
             : 'That could not be cancelled - it is still on the schedule. Try again.',
        gone ? 'info' : 'error', gone ? 3000 : 7000);
  renderCrewView();
}
window._mcCancelSched=_mcCancelSched;
/* "From the marketplace" - crews the user bought, usable right here in Crew. */
function _mcBoughtCrewsHTML(){
  let crews=[];
  try{ crews=(load('amv_saved_crews')||[]).filter(c=>c.fromMarket); }catch(e){}
  if(!crews.length) return '';
  return `<div class="mc-sec mc-bought owned-plugins" id="mc-bought">
    <div class="sec-head"><h3>Marketplace plugins</h3><span class="sec-sub">Crews and workflows you bought, ready to run as your own. Click Run and AMV works it end to end - the seller’s details are swapped for yours automatically.</span></div>
    <div class="mc-grid">${crews.slice(0,8).map(c=>`<div class="mc-card">
      <div class="mc-card-top"><span class="mc-card-t">${escH(c.title||'Crew')}</span><span class="mc-pill ok">Owned</span></div>
      <div class="mc-card-sub">${(c.agents||[]).slice(0,4).map(a=>escH(a.role)).join(' → ')||(c.goal?escH(c.goal.slice(0,90)):'Multi-agent crew')}${c.seller?` · by ${escH(c.seller)}`:''}</div>
      <div class="mc-card-act"><button class="btn mc-mini" data-dact="_mcUseCrew" data-darg="${escH(c.id)}">Run this</button></div>
    </div>`).join('')}</div>
  </div>`;
}
function _mcUseCrew(id){
  let c=null; try{ c=(load('amv_saved_crews')||[]).find(x=>x.id===id); }catch(e){}
  if(!c){ toast('Crew not found','error'); return; }
  let goal;
  if(c.agents&&c.agents.length) goal='Run this crew for me:\n\n'+c.agents.map(a=>'• '+(a.role||'Agent')+': '+(a.task||'')).join('\n');
  else goal=c.goal||c.title||'';
  if(!goal.trim()){ toast('This crew has no instructions to run','error'); return; }
  if(typeof openCoworkWith==='function') openCoworkWith(goal);
  else { setTab('chat'); setTimeout(()=>{ const ta=$('mta'); if(ta){ ta.value=goal; ta.dispatchEvent(new Event('input')); ta.focus(); } },200); }
}
window._mcUseCrew=_mcUseCrew;

/* HOW the crew works, as opposed to WHAT it works on.

   Every job on this screen says what to do. None of them says how much care to
   take, what to prefer, or what to leave out - and those are account-wide
   preferences, not per-job ones. Somebody who wants "always check two sources"
   should say it once and have it hold for the job they set up next month.

   The server appends this to the system prompt of every unattended run, so
   editing it here genuinely changes the next result. It is not a note kept for
   the user's own reference, and the screen must not imply that it is.

   Two things it deliberately is not. It is not permission: the limits an
   unattended run operates under sit above this text on the server and cannot be
   edited from a textarea. And it is not unbounded - it rides along on every
   single run, so it is capped, and the box says so rather than truncating in
   silence. */
const MC_STANDING_MAX = 1200;

/* HOW FAR ANY BACKGROUND JOB MAY GO WITHOUT ASKING.

   Each job carries its own level, and this is the ceiling over all of them -
   the setting somebody makes once when they decide "nothing sends on its own",
   rather than a decision they have to remember correctly for every job they
   ever create. The server applies it at the moment of spending and sending, so
   a job set higher is held back rather than rewritten, and raising this later
   gives every job back exactly what it was configured to do.

   Written as three plain statements about what happens tonight, because that is
   the question being answered. "Approve before action" is a category name;
   "AMV does the work, then waits for you before anything goes out" is the
   thing somebody is actually choosing. */
const MC_LEVELS = [
  { id:'suggest', label:'Suggest only',
    say:'AMV tells you a job is due and what it would do. It does not run it, so it spends nothing.' },
  { id:'require', label:'Ask me first',
    say:'AMV does the work, then waits for you. Nothing is sent, posted or acted on until you approve it.' },
  { id:'auto',    label:'Let it run',
    say:'AMV does the work and delivers it on its own. Still no sending, buying or posting - an unattended run can only produce text.' },
];
function _mcCeilingHTML(){
  const cur = (typeof window._autoCeilingLevel==='function' ? window._autoCeilingLevel() : 'auto') || 'auto';
  const held = (typeof _AUTOS!=='undefined' && Array.isArray(_AUTOS))
    ? _AUTOS.filter(x=>['suggest','require','auto'].indexOf(String(x.approval||'require'))
                     > ['suggest','require','auto'].indexOf(cur)).length : 0;
  return `<section id="mc-ceiling" class="mc-sec mc-ceiling">
    <div class="sec-head">
      <h3>How far AMV may go on its own</h3>
      <span class="sec-sub">The most any background job may do without you, now and for anything you add later. A job set further than this is held back rather than changed.</span>
    </div>
    <div class="mc-lv" role="radiogroup" aria-label="How far AMV may go on its own">
      ${MC_LEVELS.map(l=>`
        <button class="mc-lv-opt${cur===l.id?' on':''}" role="radio" aria-checked="${cur===l.id?'true':'false'}"
                tabindex="${cur===l.id?'0':'-1'}"
                data-dact="mcSetCeiling" data-darg="${l.id}">
          <span class="mc-lv-dot" aria-hidden="true"></span>
          <span class="mc-lv-b">
            <span class="mc-lv-t">${escH(l.label)}</span>
            <span class="mc-lv-s">${escH(l.say)}</span>
          </span>
        </button>`).join('')}
    </div>
    ${held?`<div class="mc-lv-held">${held===1?'1 of your jobs is':held+' of your jobs are'} set further than this and ${held===1?'is':'are'} being held back. ${held===1?'It keeps':'They keep'} its setting - raise this and ${held===1?'it goes':'they go'} back to normal.</div>`:''}
  </section>`;
}
async function mcSetCeiling(level){
  if(!['suggest','require','auto'].includes(level)) return;
  try{
    if(typeof window._autoCeiling !== 'function') throw new Error('not-connected');
    const d = await window._autoCeiling(level);
    renderCrewView();
    const n = typeof d.restrains === 'number' ? d.restrains : 0;
    const said = (MC_LEVELS.find(l=>l.id===level)||{}).say || '';
    if(typeof toast==='function')
      toast(said + (n ? ' ' + n + ' of your jobs ' + (n===1?'is':'are') + ' set further than this and will be held back.' : ''),
            'success', 6500);
  }catch(e){
    /* The setting is a safety promise, so a failure to save it must never look
       like a save. Somebody who believes they have switched off autonomous
       sending and has not is worse off than somebody who never tried. */
    if(typeof toast==='function')
      toast((e && e.message === 'not-connected')
        ? 'AMV is not connected to its engine, so that could not be saved. Your jobs are UNCHANGED.'
        : 'That did not save: ' + ((e && e.message) || 'the server refused it') + '. Your jobs are UNCHANGED.',
        'error', 7000);
    renderCrewView();
  }
}
try{ window.mcSetCeiling = mcSetCeiling; }catch(e){}
/* ARROW KEYS, BECAUSE THESE SAY THEY ARE RADIO BUTTONS.

   role="radio" inside role="radiogroup" is a promise about behaviour, not a
   label: a screen reader announces "1 of 3" and the person reaches for the
   arrow keys. Three buttons that all sit in the tab order and ignore arrows
   announce themselves as one thing and behave as another, which is worse than
   plain buttons would have been.

   So: one stop in the tab order (the selected option), arrows and Home/End move
   between them, and moving SELECTS - which is what a radio group does, and what
   makes it usable without a mouse at all. Delegated, so it survives the
   re-render that follows every change. */
try{
  document.addEventListener('keydown', (e)=>{
    const opt = e.target && e.target.closest && e.target.closest('.mc-lv-opt');
    if(!opt) return;
    const keys = ['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'];
    if(keys.indexOf(e.key) < 0) return;
    const opts = [...document.querySelectorAll('.mc-lv-opt')];
    const i = opts.indexOf(opt);
    if(i < 0) return;
    e.preventDefault();
    let n = i;
    if(e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % opts.length;
    else if(e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + opts.length) % opts.length;
    else if(e.key === 'Home') n = 0;
    else if(e.key === 'End') n = opts.length - 1;
    const next = opts[n];
    if(!next || next === opt) return;
    /* Focus first so the person hears where they are even if the save is
       slow, then select - the render that follows keeps focus because the
       newly-selected option is the one carrying tabindex 0. */
    try{ next.focus(); }catch(_){}
    const lvl = next.dataset && next.dataset.darg;
    if(lvl) mcSetCeiling(lvl);
  });
}catch(e){}

function _mcStandingHTML(){
  const cur = (typeof window._autoStandingText==='function' ? window._autoStandingText() : '') || '';
  return `<section id="mc-standing" class="mc-sec mc-standing">
    <div class="sec-head">
      <h3>How the crew should work</h3>
      <span class="sec-sub">Applies to every background job you have now and every one you add later. AMV reads this before each run.</span>
    </div>
    <textarea id="mc-standing-box" class="mc-standing-box" rows="3" maxlength="${MC_STANDING_MAX}"
      placeholder="e.g. Think carefully before answering, check at least two sources, and keep it under five bullets. Skip anything I have already seen this week."
      aria-describedby="mc-standing-note">${escH(cur)}</textarea>
    <div class="mc-standing-foot">
      <span id="mc-standing-note" class="mc-standing-note">This changes how the work is done, not what AMV is allowed to do. Background runs still never send, buy, or post anything without your approval.</span>
      <span class="mc-standing-right">
        <span id="mc-standing-count" class="mc-standing-count">${cur.length}/${MC_STANDING_MAX}</span>
        <button class="btn mc-mini" id="mc-standing-save" data-dact="mcSaveStanding">Save</button>
      </span>
    </div>
  </section>`;
}
/* ── WHAT AMV ACTUALLY DID WHILE NOBODY WAS WATCHING ─────────────────────────

   Background work is the one part of this product that happens with the person
   absent, which makes it the one part they have no way to check. Everything
   else they can see happening. This is the record of everything else.

   Three things it has to show that a list of finished results does not:

   - Runs that FAILED. A job that has produced nothing for a week is either
     failing every night or has genuinely had nothing to say, and those call for
     opposite responses. Failures used to set a field on the job and appear
     nowhere.
   - The level each run EXECUTED at, recorded at the time. Reading it off the
     job's current setting would be reading the one thing most likely to have
     changed since.
   - What each run COST. Unattended spending that nobody can itemise is the
     thing that makes people turn a feature off entirely.

   Read from the results the server already returns, so there is no second
   record to drift from the first. */
const MC_ACT_SHOWN = 12;
const _MC_OUTCOME = {
  emailed:   ['sent',      'Emailed to you'],
  'in-app':  ['done',      'Waiting in AMV'],
  waiting:   ['wait',      'Waiting for your approval'],
  suggested: ['idle',      'Not run - suggest only'],
  failed:    ['err',       'Did not complete'],
  /* Its own state, not a failure. A run stopped because it has not been given
     a permission has done nothing wrong, and showing it in red beside real
     breakages teaches people to ignore the red. */
  needs_access: ['need',   'Needs your permission'],
};

function _mcNeeds(r){
  const list = Array.isArray(r && r.needs) ? r.needs : [];
  if(!list.length) return '';
  return `<span class="mc-need">
    <span class="mc-need-h">Important - to finish this run AMV needs:</span>
    <span class="mc-need-l">${list.map(n=>`<span class="mc-need-i">
      <b>${escH(String(n.needs||''))}</b>
      <em>so it can ${escH(String(n.label||''))}${n.where?` · add it in ${escH(String(n.where))}`:''}</em>
    </span>`).join('')}</span>
  </span>`;
}

function _mcAgo(ts){
  const d = Number(ts)||0; if(!d) return '';
  const m = Math.round((Date.now()-d)/60000);
  if(m < 1) return 'just now';
  if(m < 60) return m + ' min ago';
  if(m < 60*24) return Math.round(m/60) + 'h ago';
  const days = Math.round(m/1440);
  return days === 1 ? 'yesterday' : days + ' days ago';
}
function _mcMoney(n){
  const v = Number(n)||0;
  if(v <= 0) return 'nothing';
  if(v < 0.01) return 'under a cent';
  return '$' + v.toFixed(2);
}
/* ── A LETTER YOU CAN ACTUALLY SEND ────────────────────────────────────────
   The end of option (a), and the reason it is worth anything.

   A run can find a subscription, work out that its receipts come from a
   mailbox somebody reads, and write the cancellation - and if that letter only
   exists inside a paragraph of prose, the person has to retype it. That is the
   difference between a feature and a mention of one.

   IT IS HANDED OVER, NOT SENT. The owner's decision: the person's own mail
   client now, their own mailbox later, never AMV's domain. AMV sending to
   strangers from its own domain fails twice over - it makes the product a
   sending relay, so one abuse wave burns the reputation that carries every
   password reset and receipt; and a merchant cannot verify that a robot
   address is the account holder, so it is exactly the cancellation they are
   entitled to ignore. Coming from the person's own address is not a lesser
   version of this. It is the version that works.

   Only ever drafts the server marked deliverable - a letter to an unattended
   mailbox is not offered at all, because offering it is offering an action
   that does not exist. */
function _mcMailto(d){
  const q = 'subject=' + encodeURIComponent(String(d.subject || ''))
          + '&body=' + encodeURIComponent(String(d.body || ''));
  return 'mailto:' + encodeURIComponent(String(d.to || '')).replace(/%40/g, '@') + '?' + q;
}
/* The plain-text form, for the copy that goes into a client this browser
   cannot open. Headers included, because a body with no recipient is half a
   letter and the address is the part that must not be retyped from memory. */
function _mcDraftText(d){
  return 'To: ' + String(d.to || '') + '\nSubject: ' + String(d.subject || '') + '\n\n' + String(d.body || '');
}
function _mcDraftsHTML(r){
  const ds = (r && Array.isArray(r.drafts)) ? r.drafts : [];
  if(!ds.length) return '';
  return `<span class="mc-draft">
    <span class="mc-draft-h">${escH(ds.length === 1 ? 'A cancellation is ready to send' : ds.length + ' cancellations are ready to send')}</span>
    ${ds.map((d, i) => `<span class="mc-draft-row">
      <span class="mc-draft-t">${escH(String(d.merchant || 'Subscription'))} · to ${escH(String(d.to || ''))}</span>
      <a class="btn mc-mini bp mc-draft-go" href="${escH(_mcMailto(d))}">Open in your mail app</a>
      <button class="btn mc-mini ghost mc-draft-go" data-dact="mcCopyDraft" data-darg="${escH(String(r.id))}|${i}">Copy it</button>
    </span>`).join('')}
    <span class="mc-draft-note">AMV cannot send these itself. Opening one puts it in your own mail app, from your own address - which is the version a provider will act on, and the only one you can check in your Sent folder.</span>
  </span>`;
}
/* Copy is a real action with a real failure mode - a browser that refuses the
   clipboard, a page without focus - and saying "Copied" on a clipboard that is
   still empty is the small version of saying "Sent" on a send that never
   happened. */
async function mcCopyDraft(arg){
  const [id, ix] = String(arg || '').split('|');
  const all = (typeof _AUTO_RESULTS !== 'undefined' && Array.isArray(_AUTO_RESULTS)) ? _AUTO_RESULTS : [];
  const r = all.find(x => String(x.id) === String(id));
  const d = r && Array.isArray(r.drafts) ? r.drafts[Number(ix)] : null;
  if(!d){ toast('That draft is no longer here - run the job again for a fresh one.', 'error', 5000); return; }
  try{
    await navigator.clipboard.writeText(_mcDraftText(d));
    toast('Copied, with the address and subject - paste it into your mail app.', 'success', 4000);
  }catch(e){
    toast('Your browser would not let AMV use the clipboard, so nothing was copied. Open it in your mail app instead.', 'error', 6000);
  }
}
try{ window.mcCopyDraft = mcCopyDraft; }catch(e){}

function _mcActivityHTML(){
  const all = (typeof _AUTO_RESULTS!=='undefined' && Array.isArray(_AUTO_RESULTS)) ? _AUTO_RESULTS : [];
  const rows = all.slice().sort((a,b)=>(b.at||0)-(a.at||0)).slice(0, MC_ACT_SHOWN);
  const spent = all.reduce((t,r)=>t + (Number(r.costUSD)||0), 0);

  if(!rows.length){
    /* An empty timeline and a timeline that could not be loaded are different
       facts, and only one of them means "nothing has happened". */
    const st = (typeof window._autoLoadState==='function') ? window._autoLoadState() : { loaded:true, error:'' };
    return `<section id="mc-activity" class="mc-sec">
      <div class="sec-head"><h3>What AMV did on its own</h3><span class="sec-sub">Every unattended run, what it cost, and what happened to it.</span></div>
      <div class="mc-empty-row">${st && st.error
        ? 'This could not be loaded (' + escH(st.error) + '). It does not mean nothing ran. <button class="mc-sec-link" data-dact="mcReloadJobs">Try again</button>'
        : 'Nothing has run on its own yet. Once a background job runs, every one of its runs is listed here - including the ones that failed.'}</div>
    </section>`;
  }

  return `<section id="mc-activity" class="mc-sec">
    <div class="sec-head">
      <h3>What AMV did on its own</h3>
      <span class="sec-sub">Every unattended run, what it cost, and what happened to it. Nothing here was sent, bought or posted - background work can only produce text.</span>
    </div>
    <div class="mc-act">${rows.map(r=>{
      const o = _MC_OUTCOME[String(r.outcome||'')] || (r.kind==='failed' ? _MC_OUTCOME.failed : ['done','Completed']);
      return `<div class="mc-act-row ${o[0]}">
        <span class="mc-act-when">${escH(_mcAgo(r.at))}</span>
        <span class="mc-act-b">
          <span class="mc-act-t">${escH(String(r.detail||'Background job').slice(0,120))}</span>
          <span class="mc-act-m">
            <span class="mc-act-st">${escH(o[1])}</span>
            <span class="mc-act-sep">·</span>${escH(_mcMoney(r.costUSD))}
            ${r.approval?`<span class="mc-act-sep">·</span>ran as “${escH((MC_LEVELS.find(l=>l.id===r.approval)||{}).label || r.approval)}”`:''}
          </span>
          ${_mcNeeds(r)}
          ${_mcDraftsHTML(r)}
        </span>
      </div>`;
    }).join('')}</div>
    <div class="mc-act-foot">
      ${all.length > rows.length ? 'Showing the last ' + rows.length + ' of ' + all.length + ' runs. ' : ''}
      Total spent on background work in this record: <b>${escH(_mcMoney(spent))}</b>.
    </div>
  </section>`;
}

async function mcSaveStanding(){
  const box = $('mc-standing-box'), btn = $('mc-standing-save');
  if(!box) return;
  const text = box.value.trim();
  if(btn){ btn.disabled = true; btn.textContent = 'Saving...'; }
  try{
    if(typeof window._autoStanding !== 'function') throw new Error('not-connected');
    const d = await window._autoStanding(text);
    /* Say how far it reaches, because "saved" alone leaves them wondering
       whether the jobs already running picked it up. They did. */
    const n = typeof d.appliesTo === 'number' ? d.appliesTo : 0;
    if(typeof toast==='function'){
      toast(!text
        ? 'Cleared. Background jobs go back to running the standard way.'
        : (n ? 'Saved. Your next run of all ' + n + ' background job' + (n>1?'s':'') + ' follows this.'
             : 'Saved. Every background job you add will follow this.'),
        'success', 5000);
    }
    if(btn){ btn.textContent = 'Saved'; setTimeout(()=>{ if(btn) btn.textContent='Save'; }, 1800); }
  }catch(e){
    /* Never leave the box looking saved when it is not - this is the one
       failure that silently makes the whole feature a lie. */
    if(typeof toast==='function'){
      toast(e && e.message === 'not-connected'
        ? 'Connect the AMV engine in Settings before setting standing instructions.'
        : 'Could not save that: ' + ((e && e.message) || 'the server did not accept it'),
        'error', 6000);
    }
    if(btn) btn.textContent = 'Save';
  }finally{ if(btn) btn.disabled = false; }
}
try{ window.mcSaveStanding = mcSaveStanding; }catch(e){}
/* Delegated, so it survives every re-render of the Crew screen rather than
   being re-bound (or forgotten) each time the section is rebuilt. */
try{
  document.addEventListener('input', (e)=>{
    const t = e.target;
    if(!t || t.id !== 'mc-standing-box') return;
    const c = document.getElementById('mc-standing-count');
    if(c) c.textContent = t.value.length + '/' + MC_STANDING_MAX;
  });
}catch(e){}
try{ window._cwSampleLine=_cwSampleLine; }catch(e){}
try{ window.cwPeek = cwPeek; }catch(e){}

/* A job the SERVER is running, shown with the controls that reach the server.

   Every button here posts to the same /auto/update the chat tools use, so the
   screen and the conversation are two doors onto one job rather than two
   records that drift apart. */
function _mcServerSchedRow(x){
  /* The time it runs on their clock when it has one - "every day at 8:00 AM",
     "every weekday at 7:30 PM" - rather than only how often. */
  const every = (x.sched && typeof _schedHumanOf === 'function')
    ? _schedHumanOf(x.sched).replace(/^Every/, 'every') : (_CREW_EVERY_UI[String(x.repeat||'')] || 'on a schedule');
  const paused = x.active === false && !x.done;
  const auto = x.approval === 'auto';
  /* A one-time job reads as one: when it runs, then that it ran - never as
     "Paused", which is what an inactive job looked like before. */
  /* A step of a task says which step it is, and a step that never ran says
     so - "Ran once · finished" about a step that was cancelled would be the
     row lying about the one thing somebody opened it to check. */
  const stepOf = x.step ? T('Step {0} of {1}').replace('{0}', x.step.n).replace('{1}', x.step.of) + ' · ' : '';
  const when = stepOf + (x.done && /^did not run/.test(String(x.lastError||'')) ? T('Did not run') + ' - ' + String(x.lastError).replace(/^did not run - /, '')
    : x.waiting ? (Array.isArray(x.after) && x.after.length > 1
        ? T('Waits for {0} steps to finish').replace('{0}', x.after.length) + ' \u00b7 ' + T('{0} done').replace('{0}', Object.keys(x.got || {}).length)
        : T('Waits for the step before it to finish'))
    : (x.when && x.active !== false) ? (/^not watching/.test(String(x.lastError || '')) ? T('Not watching') + ' - ' + String(x.lastError).replace(/^not watching - /, '')
        : T('Watching for {0}').replace('{0}', _whenSay(x.when)) + (x.lastCheckAt ? ' \u00b7 ' + T('last checked {0}').replace('{0}', _agoLabel(x.lastCheckAt)) : ''))
    : x.done ? ('Ran once' + (x.doneAt ? ', ' + _dayLabel(x.doneAt) : '') + ' · finished')
    : x.repeat === 'once' ? ('Runs once' + (x.next ? ', ' + _onceWhen(x.next) + ' (' + _mcWhen(x.next) + ')' : ''))
    : paused ? 'Paused' : ('Runs ' + every + (x.next ? ' · next ' + _mcWhen(x.next) : '')));
  return `<div class="mc-sched-row${paused?' paused':''}">
    <div class="mc-sched-b">
      <div class="mc-sched-goal">${escH(String(x.detail||'Background job').slice(0,180))}</div>
      <div class="mc-sched-meta">${escH(when)} · Runs on AMV's servers, whether or not this is open</div>
      <div class="mc-sched-mode-row">${(()=>{
        /* What this job will ACTUALLY do tonight - its own level capped by the
           account ceiling. Showing the job's own setting here would have it
           reading "Autonomous" under a ceiling that stops it, which is the one
           sentence on this screen that must never be wrong. */
        const own = String(x.approval||'require');
        const cap = (typeof window._autoCeilingLevel==='function' ? window._autoCeilingLevel() : 'auto') || 'auto';
        const rank = l => ['suggest','require','auto'].indexOf(l);
        const eff = rank(own) <= rank(cap) ? own : cap;
        const say = { suggest:'Suggest only - it will not run until you ask',
                      require:'Ask first - each result waits for your approval',
                      auto:'Autonomous - results are delivered for you' }[eff];
        /* Two different sentences that both begin "held". The gold one is the
           account ceiling holding a job BELOW the level it was set to, which
           is permanent until somebody raises the ceiling. The quiet one is
           tonight's window pushing this run back a few hours. A row can
           honestly show both at once. */
        const quiet = (x.heldUntil && x.heldUntil > Date.now())
          ? `<span class="mc-sched-quiet">Held until your quiet hours end</span>` : '';
        /* A THIRD SENTENCE, AND THE REASON IT HAS TO BE HERE.

           This job is running and is deliberately not emailing, because the
           person accepted "email me only when it changes". Without a line
           saying so, a job that has quietly stopped working looks exactly like
           a job that is working and has nothing new to say - and the whole
           bargain was that they lose nothing by not looking. */
        const same = x.quietSince
          ? `<span class="mc-sched-same">Same answer since ${escH(_dayLabel(x.quietSince))} · in AMV, not your inbox</span>` : '';
        return `<span class="mc-sched-mode ${eff==='auto'?'auto':''}">${escH(say)}</span>`
             + (eff!==own?`<span class="mc-sched-held">held back from “${escH(own)}” by your account setting</span>`:'')
             + quiet + same;
      })()}</div>
    </div>
    <div class="mc-sched-acts">
      ${x.done ? '' : `<button class="btn mc-mini ghost" data-dact="mcServerJob" data-darg="${escH(x.id)}|${paused?'resume':'pause'}">${paused?'Resume':'Pause'}</button>`}
      ${x.done || !(x.when && x.when.source === 'hook') ? '' : `<button class="btn mc-mini ghost" data-dact="mcHookAddress" data-darg="${escH(x.id)}|show">${escH(T('Copy address'))}</button><button class="btn mc-mini ghost" data-dact="mcHookAddress" data-darg="${escH(x.id)}|renew">${escH(T('New address'))}</button><button class="btn mc-mini ghost" data-dact="mcHookSigning" data-darg="${escH(x.id)}|${escH((x.hook && x.hook.signed) || '')}">${escH(x.hook && x.hook.signed ? T('Signed') + ' · ' + T(_HOOK_SIGNERS[x.hook.signed]) : T('Require signing'))}</button>`}
      <button class="btn mc-mini ghost" data-dact="mcServerJob" data-darg="${escH(x.id)}|delete">Remove</button>
    </div>
  </div>`;
}
function _onceWhen(ts){
  try{ return new Date(Number(ts)).toLocaleString([], { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }); }
  catch(e){ return ''; }
}
function _mcWhen(ts){
  const d = Number(ts)||0; if(!d) return '';
  const mins = Math.round((d - Date.now())/60000);
  if(mins <= 0) return 'due now';
  if(mins < 60) return 'in ' + mins + ' min';
  if(mins < 60*24) return 'in ' + Math.round(mins/60) + 'h';
  return 'in ' + Math.round(mins/1440) + 'd';
}
/* Pause, resume or remove a real server job from the screen. Removing asks
   first, because it takes the job and its history and cannot be undone. */
async function mcServerJob(arg){
  const [id, action] = String(arg||'').split('|');
  if(!id || !action) return;
  if(action === 'delete'){
    const yes = await showConfirmAsync('Remove this background job? It stops running and its history goes with it. Pausing keeps both.');
    if(!yes) return;
  }
  try{
    await _autoApi('/auto/update', { id, action });
    if(typeof _autoRefresh === 'function') await _autoRefresh();
    renderCrewView();
    toast(action === 'delete' ? 'Removed. It will not run again.'
        : action === 'pause' ? 'Paused. It stays here and will not run until you resume it.'
        : 'Resumed. Its next run is one interval from now.', 'success', 4000);
  }catch(e){
    /* Never redraw as though it worked - the job is still running, and saying
       otherwise is how somebody stops watching something that is still
       spending. */
    toast((e && e.message === 'not-connected')
      ? 'AMV is not connected to its engine, so that job could not be changed. It is still running.'
      : 'That did not work: ' + ((e && e.message) || 'the server refused it') + '. The job is unchanged.',
      'error', 6500);
  }
}
/* A JOB ANOTHER SERVICE STARTS: its address, asked for again or replaced.
   Fetched from the server each time rather than kept on the page - the
   address is the key to the job, and a copy left in the page's memory or
   storage is one more place it can be read from. */
async function mcHookAddress(arg){
  const [id, action] = String(arg || '').split('|');
  if(!id) return;
  if(action === 'renew'){
    const yes = await showConfirmAsync(T('Make a new address for this job? The old one stops working at once, so give the new one to the service that sends to it.'));
    if(!yes) return;
  }
  let d;
  try{ d = await _autoApi('/auto/hook', { id, action: action === 'renew' ? 'renew' : 'show' }); }
  catch(e){ toast(T('The address could not be fetched. Try again.') + ' ' + ((e && e.message) || ''), 'error', 6000); return; }
  try{ await _copyText(d.url); toast(action === 'renew' ? T('New address copied. The old one no longer works.') : T('Address copied. Give it to the service that should start this job.'), 'success', 6000); }
  catch(e){ try{ window.prompt(T('Copy this address:'), d.url); }catch(x){} }
}
/* WHO MAY START IT: the address alone, or only requests signed with a secret
   (70-hooks.js). A secret AMV makes is shown here once and never again; one
   pasted from Stripe or Slack is sent once and never shown back. */
const _HOOK_SIGNERS = { amv:'AMV standard', github:'GitHub', stripe:'Stripe', slack:'Slack' };
function mcHookSigning(arg){
  const [id, now] = String(arg || '').split('|');
  const r = $('ovr'); if(!id || !r) return;
  const pick = (k) => {
    const paste = k === 'stripe' || k === 'slack' || k === 'github';
    $('hs-form').innerHTML = (paste ? '<label class="ob-sub" for="hs-secret">' + escH(k === 'github' ? T('Secret (leave empty and AMV makes one)')
        : k === 'stripe' ? T('Signing secret from Stripe (whsec_...)') : T('Signing Secret from your Slack app')) + '</label>'
        + '<input id="hs-secret" type="password" autocomplete="new-password" spellcheck="false" class="fp-in">' : '')
      + '<div class="sec-row"><button class="btn bp" id="hs-save">' + escH(T('Require signing')) + '</button></div>';
    on($('hs-save'), 'click', () => save(k));
  };
  const save = async (k) => {
    const sec = ($('hs-secret') || {}).value || '';
    let d;
    try{ d = await _autoApi('/auto/hook', k ? { id, action:'sign', kind:k, secret:sec } : { id, action:'unsign' }); }
    catch(e){ $('hs-msg').textContent = (e && e.message && e.message !== 'not-connected') ? e.message : T('That did not work. Nothing changed.'); return; }
    mcReloadJobs();
    /* Slack needs one more thing done on Slack's side, so the dialog says what
       rather than closing: the address goes in the app's Event Subscriptions,
       where Slack checks it at once (70-hooks.js answers that check). */
    if(k === 'slack' && d.url){
      $('hs-form').innerHTML = '<p class="ob-sub">' + escH(T('In your Slack app, open Event Subscriptions, turn it on and paste this address as the Request URL - Slack checks it straight away. Then subscribe to the message.channels bot event and reinstall the app. Messages people post in the channels the app is in will start this job; messages from bots never do.')) + '</p>'
        + '<div class="sec-row"><button class="btn bp" id="hs-addr">' + escH(T('Copy address')) + '</button></div>';
      on($('hs-addr'), 'click', () => { _copyText(d.url).then(() => toast(T('Copied'), 'success', 2500), () => {}); });
      return;
    }
    if(!d.secret){ closeOvr(); toast(k ? T('Signing is on. Unsigned requests are refused.') : T('Signing is off. The address alone starts this job.'), 'success', 6000); return; }
    $('hs-form').innerHTML = '<div class="sec-secret"><p class="ob-sub">' + escH(k === 'github' ? T('Paste this as the webhook’s Secret in GitHub. It is shown once.')
        : T('Sign each request with this secret, using the Standard Webhooks headers: webhook-id, webhook-timestamp, webhook-signature. It is shown once.'))
      + '</p><code>' + escH(d.secret) + '</code></div><div class="sec-row"><button class="btn bp" id="hs-copy">' + escH(T('Copy')) + '</button></div>';
    on($('hs-copy'), 'click', () => { _copyText(d.secret).then(() => toast(T('Copied'), 'success', 2500), () => {}); });
  };
  r.innerHTML = '<div class="ov" id="hs-bg"><div class="ob" role="dialog" aria-labelledby="hs-t" style="max-width:520px">'
    + '<button class="oc" id="hs-x" aria-label="' + escH(T('Close')) + '">×</button>'
    + '<h2 id="hs-t">' + escH(T('Who may start this job?')) + '</h2>'
    + '<p class="ob-sub">' + escH(T('Anyone with the address can start it. With signing on, only requests signed with a secret are accepted, so a leaked address is not enough.')) + '</p>'
    + '<p class="ob-sub"><b>' + escH(now ? T('Now: signed by') + ' ' + T(_HOOK_SIGNERS[now]) : T('Now: the address alone')) + '</b></p>'
    + '<div class="sec-row">' + Object.keys(_HOOK_SIGNERS).map(k => '<button class="btn bs" data-hs="' + k + '">' + escH(T(_HOOK_SIGNERS[k])) + '</button>').join('')
    + (now ? '<button class="btn bs" data-hs="">' + escH(T('Turn off')) + '</button>' : '') + '</div>'
    + '<div id="hs-form"></div><p class="ob-sub" id="hs-msg" role="alert"></p></div></div>';
  r.classList.add('on');
  r.querySelectorAll('[data-hs]').forEach(b => on(b, 'click', () => b.dataset.hs ? pick(b.dataset.hs) : save('')));
  on($('hs-x'), 'click', closeOvr);
  onBackdrop($('hs-bg'), closeOvr);
}
async function mcReloadJobs(){
  try{ if(typeof _autoRefresh === 'function') await _autoRefresh(); }catch(e){}
  renderCrewView();
}
try{ window.mcServerJob = mcServerJob; window.mcReloadJobs = mcReloadJobs; window.mcHookAddress = mcHookAddress; window.mcHookSigning = mcHookSigning; }catch(e){}

/* A standing job shown as a row in the unified Scheduled section. */
function _mcAutonSchedRow(j){
  return `<div class="mc-sched-row">
    <div class="mc-sched-b">
      <div class="mc-sched-goal">${escH(j.title)}</div>
      <div class="mc-sched-meta">${escH(j.desc||T('Runs in the background'))} · ${escH(_cwUsesLine(j, j.needs||''))}</div>
      <div class="mc-sched-mode-row"><span class="mc-sched-mode auto">Autonomous - emails you results automatically</span></div>
    </div>
    <div class="mc-sched-acts"><button class="btn mc-mini ghost" data-dact="cwToggle" data-darg="${j.id}">Turn off</button></div>
  </div>`;
}
try{ window._myTimeZone=_myTimeZone; }catch(e){}
try{ window._mcScheduleServer=_mcScheduleServer; window._mcWhereItRuns=_mcWhereItRuns; }catch(e){}
try{ window._mcReview=_mcReview; }catch(e){}
try{ window._mcNeedsFirst=_mcNeedsFirst; }catch(e){}
try{ window._mcSchedule=_mcSchedule; }catch(e){}
try{ window._mcCannot=_mcCannot; }catch(e){}
/* A rotation rewraps the example. One listener for the page, finding the box
   each time, because the view is redrawn and a listener per draw would pile up. */
try{ window.addEventListener('resize', () => { try{ _mcCmdFit(document.getElementById('mc-cmd-input')); }catch(e){} }, { passive:true }); }catch(e){}
try{ window._mcCmdFit=_mcCmdFit; }catch(e){}
try{ window._mcConnectIntent=_mcConnectIntent; }catch(e){}
window.mcRunCommand=mcRunCommand;
window._mcGoConnect=_mcGoConnect;
function _mcDoneCard(t){
  const snip=t.result?String(t.result).replace(/\s+/g,' ').trim():'';
  return `<div class="mc-card done"><div class="mc-card-top"><span class="mc-card-t">${escH(t.title||'Task')}</span><span class="mc-pill ok">Done</span></div>${snip?`<div class="mc-card-sub">${escH(snip.slice(0,140))}${snip.length>140?'…':''}</div>`:''}</div>`;
}
/* ── QUIET HOURS, THE CONTROL ──────────────────────────────────────────────
   The server has enforced these since the tick learned about them, and the
   bound was unreachable: nothing in the product could set one. That is the
   `scope` defect read from the other end - a rule the code obeys and nobody
   can write - and it is why this row exists rather than a settings page nobody
   opens.

   Two hours and the zone this browser is in. The zone is not a preference and
   is not asked for: it is read from the machine, because somebody choosing
   "11pm" means eleven at night where they are, and asking them to also name a
   timezone is asking them to do arithmetic to express something they already
   said. It travels with the window so the server can read the hour on THEIR
   clock, which is what stops the window drifting an hour when the clocks
   change. */
const _MC_QUIET_HOURS = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23];
function _mcQuietTz(){
  try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }catch(e){ return 'UTC'; }
}
function _mcQuietLabel(h){ return String(h).padStart(2,'0') + ':00'; }
function _mcQuietRowHTML(){
  const q = _mcQuiet();
  const opts = (sel) => _MC_QUIET_HOURS.map(h =>
    `<option value="${h}"${h===sel?' selected':''}>${_mcQuietLabel(h)}</option>`).join('');
  return `<div class="mc-quiet">
    <label class="mc-quiet-on">
      <input type="checkbox" id="mc-quiet-on" ${q?'checked':''} data-dact="mcQuietToggle">
      <span>Don’t run jobs overnight</span>
    </label>
    <div class="mc-quiet-when" ${q?'':'hidden'}>
      <span class="mc-quiet-k">From</span>
      <select id="mc-quiet-from" aria-label="Quiet hours start" data-dact="mcQuietChange">${opts(q?q.from:23)}</select>
      <span class="mc-quiet-k">to</span>
      <select id="mc-quiet-to" aria-label="Quiet hours end" data-dact="mcQuietChange">${opts(q?q.to:7)}</select>
      <span class="mc-quiet-note">your time · jobs due in this window run when it ends</span>
    </div>
  </div>`;
}
/* Saved to the server, because the browser is asleep at the hour this is for.
   Stored locally too so the row draws right away on the next load rather than
   waiting for a round trip to know what it already knows. */
async function _mcQuietSave(q){
  try{ store('amv_auto_quiet', q); }catch(e){}
  /* Through `_autoApi`, the one door onto this route - which is also the only
     spelling of it that exists. The first version of this posted to
     `/v1/auto/update` through `AMV_API._fetch`; the router answers
     `/auto/update`, so every save would have failed against a real backend
     while the row went on showing the window it had stored locally. Exactly
     the defect this control was written to fix, one layer up. */
  if(!(window.AMV_API && AMV_API.live && AMV_API.hasSession)){
    toast('Saved on this device. It only holds jobs overnight once AMV is connected to a backend - that is where they run.','info',6000);
    return;
  }
  try{
    await _autoApi('/auto/update', { action:'quiet', quiet: q });
    toast(q ? ('Jobs will wait between ' + _mcQuietLabel(q.from) + ' and ' + _mcQuietLabel(q.to) + '.')
            : 'Jobs can run at any hour again.', 'success', 4000);
  }catch(e){
    /* The one thing that must not happen quietly: the row showing a window the
       server never received. */
    toast('That did NOT save - your jobs can still run overnight. ' + ((e&&e.message)||''), 'error', 7000);
  }
}
function mcQuietToggle(){
  const on = !!(document.getElementById('mc-quiet-on')||{}).checked;
  _mcQuietSave(on ? { from:23, to:7, tz:_mcQuietTz() } : null).then(()=>renderCrewView());
}
function mcQuietChange(){
  const f = +(document.getElementById('mc-quiet-from')||{}).value;
  const t = +(document.getElementById('mc-quiet-to')||{}).value;
  if(!Number.isInteger(f) || !Number.isInteger(t)) return;
  if(f === t){
    toast('A window that starts and ends at the same hour is not a window - untick it to turn quiet hours off.','info',5000);
    return;
  }
  _mcQuietSave({ from:f, to:t, tz:_mcQuietTz() });
}
try{ window.mcQuietToggle = mcQuietToggle; window.mcQuietChange = mcQuietChange; }catch(e){}

/* ── THE OFFER ─────────────────────────────────────────────────────────────
   The only thing on this screen AMV proposes rather than waits to be told, so
   it has to earn its place every time it appears.

   Both answers are buttons of equal weight. A "yes" styled as the obvious
   choice and a "no" styled as a link is not an offer, it is a funnel - and
   this one can propose LESS autonomy as easily as more, which is the reason it
   is defensible at all.

   It disappears the moment it is answered, either way, and the server never
   raises it again for that job. */
function _mcOfferHTML(){
  const o = (typeof window._autoOffer === 'function') ? window._autoOffer() : null;
  if(!o || !o.say) return '';
  return `<section class="mc-offer mc-offer-${escH(String(o.kind || 'auto'))}">
    <div class="mc-offer-b">
      <div class="mc-offer-t">${escH({
        pause:   'This job keeps producing something you do not use',
        quiet:   'This job keeps saying the same thing',
        inapp:   'You keep telling AMV this was not worth an email',
        stop:    'You keep telling AMV this was not worth making',
        unquiet: 'AMV held this back and you wanted it',
        auto:    'You have said yes to this every time',
      }[String(o.kind || 'auto')] || 'You have said yes to this every time')}</div>
      <div class="mc-offer-s">${escH(String(o.say))}</div>
    </div>
    <div class="mc-offer-acts">
      <button class="btn mc-offer-go" data-dact="mcOfferAnswer" data-darg="yes">${escH(String(o.accept || 'Yes'))}</button>
      <button class="btn ghost mc-offer-go" data-dact="mcOfferAnswer" data-darg="no">${escH(String(o.decline || 'No'))}</button>
    </div>
  </section>`;
}
async function mcOfferAnswer(arg){
  const o = (typeof window._autoOffer === 'function') ? window._autoOffer() : null;
  if(!o) return;
  const accept = String(arg) === 'yes';
  /* Cleared before the request, so a second press cannot answer twice - and
     restored if the request fails, because an offer that vanished without
     being recorded is one the person will never be asked about again. */
  try{ window._autoOfferClear(); }catch(e){}
  renderCrewView();
  try{
    const d = await _autoApi('/auto/update', { action:'offer', job:o.job, accept });
    if(!accept) toast('AMV will not ask about that one again.','info',4000);
    else if(d.applied === 'auto') toast('Done - this job delivers without asking now. You can change it back on its row.','success',6000);
    else if(d.applied === 'pause') toast('Paused. It stops running and stops costing anything; resume it on its row whenever you want.','success',6000);
    else toast('Nothing changed - that offer was no longer valid for this job.','info',5000);
    try{ await _autoRefresh(); }catch(e){}
    renderCrewView();
  }catch(e){
    toast('That did NOT go through' + ((e&&e.message)?' ('+e.message+')':'') + ', so nothing has changed. It will be offered again.','error',7000);
    try{ await _autoRefresh(); }catch(_){}
    renderCrewView();
  }
}
try{ window.mcOfferAnswer = mcOfferAnswer; }catch(e){}

/* ── THE NEVER LIST, THE CONTROL ───────────────────────────────────────────
   Beside quiet hours because they answer the same question from two sides:
   WHEN may AMV act without me, and WHO may it never approach. Both are things
   somebody says once and expects to hold for ever.

   A plain list, one per line, rather than a builder with add and remove
   buttons. Somebody writing this is thinking of three or four names and wants
   to type them; a row-at-a-time widget turns four seconds of typing into
   twelve taps, and on a phone that is the difference between writing it down
   and meaning to.

   What it does is stated exactly on the control, because overstating it would
   be the whole defect: AMV cannot send to anybody but the account holder, so
   this governs what it OFFERS - the cancellation letters it writes with an
   address already filled in. */
const MC_NEVER_MAX = 40;
function _mcNever(){
  try{ const v = load('amv_auto_never'); return Array.isArray(v) ? v : []; }catch(e){ return []; }
}
function _mcNeverRowHTML(){
  const list = _mcNever();
  return `<div class="mc-never">
    <label class="mc-never-h" for="mc-never-box">Never write to</label>
    <textarea id="mc-never-box" class="mc-never-box" rows="3" spellcheck="false"
      aria-describedby="mc-never-note"
      placeholder="mybank.com&#10;boss@work.com">${escH(list.join('\n'))}</textarea>
    <div class="mc-never-foot">
      <span id="mc-never-note" class="mc-never-note">One per line. An address, or a domain for everyone there. AMV never emails anyone but you - this stops it <b>offering</b> to write to them, which is the one place an address it read out of your mail would end up in front of you.</span>
      <button class="btn mc-mini" data-dact="mcNeverSave">Save</button>
    </div>
  </div>`;
}
async function mcNeverSave(){
  const box = document.getElementById('mc-never-box');
  if(!box) return;
  const list = String(box.value || '').split(/[\n,]/).map(s => s.trim()).filter(Boolean).slice(0, MC_NEVER_MAX);
  if(!(window.AMV_API && AMV_API.live && AMV_API.hasSession)){
    toast('Saved on this device. It only holds once AMV is connected to a backend - that is where the jobs run.','info',6000);
    try{ store('amv_auto_never', list); }catch(e){}
    return;
  }
  try{
    const d = await _autoApi('/auto/update', { action:'never', never: list });
    try{ store('amv_auto_never', d.never || []); }catch(e){}
    toast(list.length
      ? 'Saved. AMV will not offer to write to ' + (list.length === 1 ? list[0] : list.length + ' of them') + '.'
      : 'Cleared. AMV can offer to write to anyone again.', 'success', 4000);
    renderCrewView();
  }catch(e){
    /* The server refuses the WHOLE list when one entry is unreadable, and says
       which - so the person fixes that line rather than hunting for it. Saying
       "saved" here would leave them believing a rule holds that was refused. */
    toast('NOT saved' + ((e && e.message) ? ' - ' + e.message : '.')
        + ' Nothing has changed, so anything you had before is still in force.', 'error', 9000);
  }
}
try{ window.mcNeverSave = mcNeverSave; }catch(e){}
try{ window._planAllowsCrew=_planAllowsCrew; }catch(e){}

function renderCrewView(){
  const vc=$('vc'); if(!vc) return;
  /* THE CATALOGUE FIRST. Fetched the first time Crew opens (see
     _loadCrewData); until then the screen shows its frame and says it is
     loading, and draws itself once the catalogue arrives - or says plainly
     that it could not, with a way to try again. */
  if(!_cwCatalog()){
    vc.innerHTML='<div class="sv fi crew-view"><div class="vi"><div class="cw-loading" role="status" aria-live="polite">'+escH(T('Loading your Crew\u2026'))+'</div></div></div>';
    _loadCrewData().then(ok=>{
      if(S.tab!=='crew' && S.tab!=='extensions') return;
      if(ok){ renderCrewView(); return; }
      const box=vc.querySelector('.cw-loading'); if(!box) return;
      box.innerHTML=escH(T('Crew could not load. Check your connection and try again.'))+' <button class="btn bs" type="button" id="cw-load-retry">'+escH(T('Try again'))+'</button>';
      on($('cw-load-retry'),'click',()=>renderCrewView());
    });
    return;
  }
  /* The two country pages (see cwMoreCountries). Same for every plan: what is
     done where you live is the question before paying as much as after, and
     the cards themselves say what a plan unlocks. */
  if(_cwPageNow()==='countries'){ vc.innerHTML=_cwCountriesPageHTML(); _cwWireCountries(vc); return; }
  if(_cwPageNow()==='country'){ vc.innerHTML=_cwCountryPageHTML(); _cwWireCmd(vc); try{ _cwLocFill(); }catch(e){} return; }
  /* Say the one thing that is true and nothing else. No risk warnings, no
     half-working tool - what this does, which plan runs it, and the button. */
  /* WHAT SOMEBODY WHO HAS NOT PAID SEES.

     This used to be the whole screen for them: three paragraphs and a price.
     That is a description of a product shown to the one person whose entire
     decision is whether the product is worth money - and the catalogue sitting
     behind it, ninety real jobs with the exact instructions they run, is far
     more persuasive than any sentence anybody could write about it.

     So they get the catalogue. Every job, browsable, openable, with the
     specimen output and the real instruction. The toggles do not work for them
     and say so instead of failing silently, and every card leads to the price.
     Nothing here is a teaser version of a job that does not exist. */
  if(!_planAllowsCrew()){
    const P=(typeof PLANS!=='undefined'&&PLANS[CREW_REQUIRED_PLAN])||{name:'Pro',price:15};
    const jobs=_cwJobs();
    const bgJobs=jobs.filter(j=>_cwRunsUnattended(j)).length;
    vc.innerHTML=`<div class="sv fi crew-view"><div class="vi">
      <div class="cw-where-bar">${_cwWhereBtnHTML()}</div>
      <span class="eyebrow">Crew \u00b7 Autonomous work</span>
      <h2>AMV working while you are not</h2>
      ${/* TWO SENTENCES, NOT TWO PARAGRAPHS.

            Everything the long version said was true and none of it was the
            first thing anybody needs. Crew answers one question - what runs
            while you are not here - and a screen that takes four sentences to
            get there has already lost the person it was written for. The
            detail about grants and passwords has not gone; it is on
            Connectors, where somebody is actually deciding whether to hand
            one over. */ ''}
      <p class="vsub">It runs on AMV\u2019s servers on a schedule you set, so the work happens with this window
        closed and your laptop shut. You get the finished thing, not a reminder to go and do it.</p>
      <p class="vsub cw-open-note">Say what you want below. The examples are there if you want ideas.</p>

      ${/* THE BOX IS THE PRODUCT, AND IT WAS ONLY ON THE PAID SCREEN.

            "have the text box remember where you can type something it
            recognizes it and does it i still want that" - said twice, because
            it was there and could not be seen: the command box lived on the
            unlocked Crew view only. Anybody on Free, which is everybody
            before they pay, got a catalogue and no way to say a sentence.

            It is the first thing on the screen now, and it is the SAME box -
            same input id, same run path, so what somebody types here is
            treated exactly as it would be on the paid screen. */ ''}
      <div class="mc-cmd mc-cmd-lg cw-cmd-lead">
        <div class="mc-cmd-label">Tell AMV what to do
          <span>- say it in your own words and it works out the rest</span></div>
        <div class="mc-cmd-inner">
          <svg class="mc-cmd-ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/></svg>
          <textarea id="mc-cmd-input" class="mc-cmd-input" rows="1" autocomplete="off"
                 aria-label="Tell AMV what to do" enterkeyhint="go"
                 placeholder="e.g. summarize my last meetings"></textarea>
          <button class="mc-cmd-go" id="mc-cmd-go">Run</button>
        </div>
        <div class="mc-cmd-chips">${[
          'Summarize my last meetings',
          'What did I agree to this week?',
          'Find the cheapest supermarket near me',
          'What paperwork do I need to renew?'
        ].map(c=>`<button class="mc-cmd-chip" data-mccmd="${escH(c)}">${escH(c)}</button>`).join('')}</div>
        <div id="mc-cmd-result" class="mc-cmd-result"></div>
      </div>
      ${/* THE STATS BAND IS GONE.

            It said "104 examples, not a limit / 49 run with AMV closed /
            5 jobs at once on Pro / Included with Pro - $15/month", and the
            owner asked for it to come out. It was three numbers and a price
            standing between somebody and the thing that would actually
            convince them, which is the catalogue underneath. The plan and
            the price are on the Plans screen, where somebody who wants them
            goes looking. */ ''}
    </div>
    <div class="crew-jobs-sec cw-locked">
      ${/* THE ORDER IS THE ARGUMENT.

            Crew is autonomous work, so the screen goes: what it is, the box
            where you say what you want, where you live, and then a hundred
            examples if you want ideas. The one-off errands - the ones that
            open a chat rather than run on a schedule - are real and useful
            and are NOT what Crew is, so they sit at the bottom where somebody
            who wants one will still find them, instead of being the first
            thing between you and the point.

            Same reason "most used" moved down: it ranks what other people
            run, which is interesting once you know what this is and noise
            before. */ ''}
      ${_cwNotHereHTML('above')}
      ${_cwForYouHTML()}
      ${_cwMadeForHTML()}
      <div class="cw-filters">
        ${_cwFindBoxHTML(_cwAllJobs().filter(j=>_cwMatches(j,_cwFind)).length)}
      </div>
      ${_cwCatChips(_cwShowcase())}
      <div id="cw-jobs-body">${_cwJobsBody(_cwShowcase(), _cwLockedCard)}</div>
      ${_cwMostStartedHTML()}
      ${_cwErrandsHTML()}
      <section class="cw-morec" id="cw-morec">
        <button class="cw-morec-btn" data-dact="cwMoreCountries">${escH(T('See more countries'))}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
      </section>
      ${/* ONE LINE, NOT A BAND.

            The stats band came out because it was three numbers and a price
            standing in front of the catalogue. Taking it out left no route to
            the plan at all from this screen, which is the opposite mistake:
            somebody who reads a hundred jobs and decides they want it should
            not have to guess where to go. Every card already opens onto the
            price; this is for the person who has finished browsing and is
            looking for the way forward, and it is a sentence rather than a
            sales panel. */ ''}
      <div class="cw-plan-foot">
        <span>Crew runs on ${escH(P.name)} and above - AMV keeps working when you close it.</span>
        <button class="mc-sec-link" data-stab="plans">See plans \u2192</button>
      </div>
    </div></div>`;
    _cwWireCmd(vc);
    return;
  }
  const jobs=_cwJobs(); const appr=_cwApprovals();
  const jobCard=_cwJobCard;
  /* WHAT THE CARD COULD NOT SAY BEFORE YOU PRESSED THE BUTTON.

     It showed a title, a line about what was requested, and four buttons. Two
     things a person needs in order to decide were missing, and both of them
     are the difference between a considered click and a reflex:

       - WHETHER IT CAN BE TAKEN BACK. "Send" and "Save a draft" looked
         identical. A sent email cannot be recalled and the card said nothing
         about that at the one moment it mattered.
       - WHEN THE PERMISSION LAPSES. An item written a fortnight ago is not the
         same decision as one written this morning, and nothing on the screen
         distinguished them.

     Both come from the item the server wrote, not from a guess made here: the
     server sets `expiresAt` and `reversible` when the work is enqueued, and it
     refuses an expired approval regardless of what this screen drew. This is
     defence in depth and an explanation, in that order. */
  const _apvLapse=a=>{
    const exp=Number(a.expiresAt)||(Number(a.readyAt)?Number(a.readyAt)+7*86400000:0);
    if(!exp) return { expired:true, text:'AMV cannot tell how old this is' };
    const left=exp-Date.now();
    if(left<=0) return { expired:true, text:'Expired - run the job again for a fresh one' };
    const d=Math.floor(left/86400000), h=Math.floor(left/3600000);
    return { expired:false,
      text: d>=1 ? ('Expires in '+d+' day'+(d===1?'':'s'))
          : h>=1 ? ('Expires in '+h+' hour'+(h===1?'':'s'))
          : 'Expires within the hour' };
  };
  const apprCard=a=>{
    const act=_apvAction(a);
    const lapse=_apvLapse(a);
    /* Absent means unknown, and unknown is not "safe". An older item carries no
       `reversible` field, so it is described by what the action does rather
       than reassured about. */
    const oneWay = a.reversible === false || (a.reversible === undefined && act.verb === 'send');
    const meta=[
      a.project?['Project',a.project]:null,
      a.crewName?['Crew',a.crewName]:null,
      a.destination?['To',a.destination]:null,
      (a.recipients!=null)?['Recipients',String(a.recipients)]:null,
      a.scheduledAt?['Scheduled',a.scheduledAt]:null,
      a.readyAt?['Ready',_apvAgo(a.readyAt)]:null
    ].filter(Boolean);
    return `<div class="apv-card">
      <div class="apv-card-top">
        <span class="apv-ic">${_safeIcon(a.icon||'\u2709\uFE0F')}</span>
        <div class="apv-card-hd">
          <div class="apv-title">${escH(a.title)}</div>
          <div class="apv-req">${escH(a.requesting||act.line)}</div>
        </div>
        <span class="apv-status ${a.autoApprove?'auto':'wait'}">${a.autoApprove?'Auto-approve on':'Needs approval'}</span>
      </div>
      ${a.fromJob?`<div class="apv-fromjob">↻ From your running job${a.jobSchedule?` · ${escH(a.jobSchedule)}`:''}. It keeps running - you'll get a new one to review each time. The job stays in <b>Running jobs</b>.</div>`:''}
      ${meta.length?`<div class="apv-meta">${meta.map(m=>`<span class="apv-mi"><span class="apv-mk">${escH(m[0])}</span>${escH(m[1])}</span>`).join('')}</div>`:''}
      ${a.warning?`<div class="apv-warn">${escH(a.warning)}</div>`:''}
      <div class="apv-terms">
        <span class="apv-term ${oneWay?'oneway':'undoable'}">${oneWay?'Cannot be undone once sent':'You can undo this'}</span>
        <span class="apv-term ${lapse.expired?'lapsed':''}">${escH(lapse.text)}</span>
      </div>
      <div class="apv-act">
        <button class="btn apv-preview" data-dact="apvPreview" data-darg="${a.id}">Preview</button>
        <button class="btn apv-ghost" data-dact="apvEdit" data-darg="${a.id}">Edit</button>
        <button class="btn apv-ghost apv-reject" data-dact="apvReject" data-darg="${a.id}">Reject</button>
        <button class="btn apv-approve" data-dact="apvQuickApprove" data-darg="${a.id}">${escH(act.btn)}</button>
      </div>
    </div>`;
  };
  const st=_mcState();
  /* Ask the server what it is running, the first time this screen is opened in
     a session. The list is rendered from whatever is already known so the page
     appears instantly, and the refresh redraws it a moment later - which is the
     difference between a screen that is briefly out of date and one that is
     permanently wrong about jobs on another device. */
  if(!st.serverLoaded && !_mcAskedServer){
    _mcAskedServer = true;
    try{ if(typeof _autoRefresh === 'function') _autoRefresh().then(_cwRedrawIfChanged); }catch(e){}
    /* And what is connected, because that decides whether a job needing a
       mailbox says "runs with AMV closed" or "connect the account to run it
       closed". Without this the screen answers that question from an empty
       list and always gives the pessimistic answer. */
    try{ if(typeof _connLoad === 'function') _connLoad(false).then(_cwRedrawIfChanged); }catch(e){}
  }
  const paused=_autonomyPaused();
  const tiles=[
    ['appr','Needs approval',st.appr.length,'wait'],
    ['fail','Action required',st.failed.length,'err'],
    ['active','Active work',st.active.length,'active'],
    ['sched','Running jobs',st.server.length+_mcLocalOnly(st).length+st.auton.length,'info'],
    ['done','Completed',st.done.length,'muted']
  ];

  vc.innerHTML = `<div class="sv fi"><div class="crew-page mc-page">
    <header class="mc-head">
      <div class="mc-head-l">
        <div class="eyebrow">Crew · Autonomous work</div>
        <h2>Mission Control</h2>
        <p class="vsub">Crew is AMV working on its own. Tell it an outcome and it plans the steps, does the work across your connected apps, and stops for your approval before anything is sent. This page is where you watch it all - what needs you, what’s running, and what’s scheduled.</p>
        <p class="cw-open-note-in">The jobs below are <b>examples</b>, not the menu. Describe what you want in your
          own words and Crew takes it - the catalogue is here to show you the shape of a job, not the list of them.</p>
      </div>
      <div class="mc-head-r">
        ${_cwWhereBtnHTML()}
        ${(() => {
          /* A SAFETY CONTROL FOR WORK THAT IS NOT HAPPENING.

             "Pause all autonomous" was the loudest thing in this header and it
             was always there - including on an account with nothing running,
             which is every account on its first visit. The first control
             somebody meets on the Crew screen was an emergency brake for a
             machine that had not been started, and it plants the idea that
             something here needs stopping before they have turned anything on.

             When work IS running, pause is exactly right and stays. When
             nothing is, the useful thing to offer is the way in. Paused counts
             as active state on purpose: if somebody has paused autonomy they
             must always be able to resume it, whether or not a job is listed. */
          const running = st.server.length + _mcLocalOnly(st).length + st.auton.length;
          if (paused) {
            return `<button class="mc-pause paused" data-dact="resumeAllAutonomous">▶ Resume autonomy</button>`;
          }
          if (running > 0) {
            return `<button class="mc-pause" data-dact="pauseAllAutonomous">⏸ Pause all autonomous</button>`;
          }
          return `<button class="mc-browse" data-dact="openCowork">Create an automation</button>`;
        })()}
      </div>
    </header>
    ${(()=>{ const n=_crewJobAllowance(); const used=st.server.length+_mcLocalOnly(st).length+st.auton.length;
      /* The number, before they hit it. A limit discovered by bumping into it
         reads as a fault; the same limit stated up front reads as a plan. */
      return n?`<div class="mc-allow">${used} of ${n} background job${n===1?'':'s'} in use <span>\u00b7 your plan runs ${n}</span></div>`:''; })()}
    <div class="mc-cmd mc-cmd-lg">
      <div class="mc-cmd-label">Tell AMV what to do <span>- it recognizes what you mean and does it, right here</span></div>
      <div class="mc-cmd-inner">
        <svg class="mc-cmd-ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/></svg>
        <textarea id="mc-cmd-input" class="mc-cmd-input" rows="1" aria-label="Tell AMV what to do" enterkeyhint="go" placeholder="e.g. “email me a summary of my unread emails” or “research the top AI news and write a brief”" autocomplete="off"></textarea>
        <button class="mc-cmd-go" id="mc-cmd-go">Run</button>
      </div>
      <div class="mc-cmd-chips">${[
        'Email me a summary of my unread emails',
        'Research the top AI news today and write me a brief',
        'Draft a reply to my latest email',
        'Plan my week from my calendar'
      ].map(c=>`<button class="mc-cmd-chip" data-mccmd="${escH(c)}">${escH(c)}</button>`).join('')}</div>
      <div id="mc-cmd-result" class="mc-cmd-result"></div>
    </div>
    ${paused?`<div class="mc-paused-banner"><b>Autonomous work is paused.</b> Scheduled and standing jobs won’t run until you resume. Anything already waiting still needs your approval.</div>`:''}
    ${_mcOfferHTML()}
    ${_mcQuietRowHTML()}
    ${_mcNeverRowHTML()}
    <div class="mc-tiles">${tiles.map(t=>`<button class="mc-tile mc-${t[3]}${t[2]?'':' zero'}" data-mcjump="mc-${t[0]}"><span class="mc-tile-n">${t[2]}</span><span class="mc-tile-l">${t[1]}</span></button>`).join('')}</div>

    ${_mcCeilingHTML()}
    ${_mcStandingHTML()}

    <section id="mc-appr" class="mc-sec">
      <div class="sec-head"><h3>Needs your approval ${appr.length?`<span class="cw-badge">${appr.length}</span>`:''}</h3><span class="sec-sub">One-off drafts waiting for you. Nothing here sends until you approve it. A running job that is set to "ask first" also drops a fresh draft here each time it runs.</span></div>
      ${appr.length ? appr.map(apprCard).join('') :
        `<div class="mc-empty"><span class="mc-empty-ic">✓</span><div>You are all caught up. When AMV drafts something that would send or change anything, it waits right here for your review - you can read it, edit every detail, then send or delete it.</div><button class="mc-empty-cta" data-dact="cwDemo">Show me an example</button></div>`}
    </section>

    ${st.failed.length?`<section id="mc-fail" class="mc-sec">
      <div class="sec-head"><h3>Action required <span class="cw-badge err">${st.failed.length}</span></h3><span class="sec-sub">Blocked or failed - these need you.</span></div>
      <div class="mc-grid">${st.failed.map(_mcFailCard).join('')}</div>
    </section>`:''}

    ${st.active.length?`<section id="mc-active" class="mc-sec">
      <div class="sec-head"><h3>Active work</h3><span class="sec-sub">AMV is on these right now.</span></div>
      <div class="mc-grid">${st.active.map(_mcActiveCard).join('')}</div>
    </section>`:''}

    <section id="mc-sched" class="mc-sec">
      <div class="sec-head"><h3>Running jobs</h3><span class="sec-sub">Recurring work AMV runs on a schedule. Each run creates fresh content (a new email, a new summary). For each one you choose: <b>Autonomous</b> sends it for you automatically, or <b>Ask first</b> drops a draft in "Needs your approval" every time so you review before it sends.</span><button class="mc-sec-link" data-dact="openSchedManager">Manage</button></div>
      ${(()=>{
        const local = _mcLocalOnly(st);
        const rows = st.server.map(_mcServerSchedRow).join('')
                   + st.auton.map(_mcAutonSchedRow).join('')
                   + local.slice(0,8).map(t=>_mcSchedRow(t,st)).join('');
        if(rows) return `<div class="mc-sched">${rows}</div>`
          + (local.length?`<div class="mc-sched-note">The ${local.length===1?'job':local.length+' jobs'} above without "runs on AMV's servers" could not be registered to run in the background, so ${local.length===1?'it runs':'they run'} only while AMV is open.</div>`:'');
        /* A failed read is not an empty list. Saying "no running jobs" to
           somebody whose jobs are running, because the request failed, invites
           them to set everything up a second time. */
        if(st.serverError)
          return `<div class="mc-empty-row">Your running jobs could not be loaded (${escH(st.serverError)}). They have NOT stopped - this screen just cannot show them right now. <button class="mc-sec-link" data-dact="mcReloadJobs">Try again</button></div>`;
        return `<div class="mc-empty-row">No running jobs yet. Start a task above and choose how often it should repeat - it will show up here. You can also just tell AMV in chat: "every morning, summarize my unread email".</div>`;
      })()}
    </section>

    ${_mcActivityHTML()}

    ${st.done.length?`<section id="mc-done" class="mc-sec">
      <div class="sec-head"><h3>Recently completed</h3></div>
      <div class="mc-grid">${st.done.slice(-6).reverse().map(_mcDoneCard).join('')}</div>
    </section>`:''}

    <div class="crew-split-even">
      <section class="crew-do">
        <div class="sec-head"><h3>Run something now</h3><span class="sec-sub">AMV opens a workspace, asks what it needs, and actually does it.</span></div>
        <div class="cw-quick">
          ${[['\uD83D\uDDFA\uFE0F','Plan a trip','trip','openTripPlanner()'],
             ['\uD83D\uDCE7','Check email','gmail','crewRun(\'gmail\',\'Check email\')'],
             ['\uD83D\uDCC5','Plan my week','week','crewRun(\'week\',\'Plan my week\')'],
             ['\u2728','Autonomous task','auto','openCowork()']]
            .map(q=>`<button class="cw-quick-card" data-dact="_cwQuick" data-darg="${escH(q[2])}"><span class="cw-quick-ic" aria-hidden="true">${q[0]}</span><span>${escH(q[1])}</span></button>`).join('')}
        </div>
        <div id="crew-live" class="crew-live">${_crewResultsHTML()}</div>
      </section>
      <section>
        <div class="sec-head"><h3>Games you are running</h3><span class="sec-sub">A game is a link anybody can open - no account needed. You see who has answered; nobody sees the answers until you reveal them.</span></div>
        <div id="crew-games"></div>
      </section>
      <section>
        <div class="sec-head"><h3>Recurring work</h3><span class="sec-sub">Pick one to set it on a schedule - or describe your own. Many can run at once.</span></div>
        <div class="tpl-grid">
          ${[
            ['\uD83C\uDFAC','YouTube video','Produce a complete, production-ready YouTube video package about this week\'s stock market: a punchy title, a 0-3s hook, a full word-for-word voiceover script with timestamps, a scene-by-scene shot list, B-roll suggestions, on-screen text, an SEO description, 15 tags, and a thumbnail concept. I review before publishing.'],
            ['\uD83D\uDCF8','Instagram post','Produce a ready-to-post Instagram package about the latest in my field: a scroll-stopping caption with line breaks, 20-30 ranked hashtags, a carousel outline, a detailed image/visual concept, and the best post time. I approve before posting.'],
            ['\uD83D\uDC26','Social posts','Write 3 ready-to-publish posts for X and 2 for LinkedIn on what\'s trending in my industry today - each with the full copy, hooks, and hashtags. I approve before anything is published.'],
            ['\uD83D\uDCC8','Market brief','Every morning, produce a tight briefing of overnight market moves: major indices, notable movers, and the 3 headlines that matter to me, each with a one-line why-it-matters.'],
            /* Was "give a buy/hold view and prepare a $1 XRP order on Robinhood for
               one-tap approval". AMV has no Robinhood connector and cannot place an
               order anywhere, and a buy/hold view is the financial advice every
               money job here refuses to give - a template that promises both is a
               fake feature twice over. What it really does, said plainly. */
            ['\uD83D\uDCB0','Watchlist check-in','Each Monday, check the stocks and coins on my watchlist on the live web: last week\u2019s move for each with the actual figure, the news behind it with a link, and any earnings or unlock dates coming up. Information only - never tell me what to buy, sell or hold.'],
            ['\uD83C\uDFE6','Bank check-in','Every morning, check my linked bank account and report the balance, recent transactions, anything unusual, and my spend-vs-last-week. Prepare it as a clean daily report.'],
            ['\uD83D\uDCF0','News digest','Daily, gather the top developments in AI and produce a sharp 5-bullet briefing, each bullet with a link-worthy summary and why it matters.'],
            ['\u2709\uFE0F','Inbox triage','Each morning, read new emails, rank them by urgency with reasons, and draft a ready-to-send reply for each. I click send before anything goes out.']
          ].map(t=>`<button class="tpl-card" data-dact="openCoworkWith" data-darg="${escH(t[2])}"><span class="tpl-ic" aria-hidden="true">${t[0]}</span><span class="tpl-t">${escH(t[1])}</span></button>`).join('')}
        </div>
      </section>
    </div>
    ${_mcBoughtCrewsHTML()}
    ${/* NOTHING COMES AFTER THE CATALOGUE.

           Asked for, and right: the list of what Crew can do is what somebody
           came to this page to read, and it used to have three more sections
           and a marketplace panel stacked under it - so browsing to the bottom
           of a hundred jobs delivered you into "Recurring work", which is a
           second list of the same kind of thing. What is happening NOW goes
           above (it is state, and state is news), what Crew CAN do goes last
           and ends the page. */ ''}
    <div class="crew-jobs-sec mc-start">
      <div class="sec-head"><h3>Start new work</h3><span class="sec-sub">Turn on a standing job - AMV runs it automatically and emails you results.</span></div>
      ${_cwNotHereHTML('above')}
      ${/* Same order as the locked view, for the same reason: the standing
            work first, the one-offs last. */ ''}
      ${_cwForYouHTML()}
      ${_cwMadeForHTML()}
      <div class="cw-filters">
        ${_cwFindBoxHTML(_cwAllJobs().filter(j=>_cwMatches(j,_cwFind)).length)}
      </div>
      ${_cwCatChips(_cwShowcase())}
      <div id="cw-jobs-body">${_cwJobsBody(_cwShowcase(), jobCard)}</div>
      ${_cwMostStartedHTML()}
      ${_cwErrandsHTML()}
      <section class="cw-morec" id="cw-morec">
        <button class="cw-morec-btn" data-dact="cwMoreCountries">${escH(T('See more countries'))}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
      </section>
    </div>

  </div></div>`;
  try{ vc.querySelectorAll('[data-mcjump]').forEach(function(b){ on(b,'click',function(){ var el=document.getElementById(b.dataset.mcjump); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); }); }); }catch(e){}
  _cwWireCmd(vc);
  /* Filled after the view exists, never before: the panel renders into an
     element this function has only just written. */
  try{ if(typeof renderGames==='function') renderGames(); }catch(e){}
}
/* WIRED FROM BOTH VIEWS.

   This lived inline at the end of the unlocked render, so the command box and
   the example search only worked for somebody who was already paying. The box
   is now the first thing on the locked view too, and a box that does nothing
   when you press Enter is worse than no box - so the wiring is a function and
   both views call it. */
function _cwWireCmd(vc){
  if(!vc) return;
  // Command bar: type any goal - the real agent recognizes intent and does it.
  try{
    var _mcRun=function(){ var el=$('mc-cmd-input'); var v=el?el.value.trim():''; if(!v){ el&&el.focus(); return; } mcRunCommand(v); };
    on($('mc-cmd-go'),'click',_mcRun);
    /* Enter runs it, as it always did; Shift+Enter is a new line, the way
       the chat box works, because the box now takes a paragraph. An Enter
       that finishes composing a character (Chinese, Japanese, Korean input)
       is the input method's, not a Run. */
    var _ci=$('mc-cmd-input'); if(_ci){
      on(_ci,'keydown',function(e){ if(e.key==='Enter' && !e.shiftKey && !e.isComposing && e.keyCode!==229){ e.preventDefault(); _mcRun(); } });
      on(_ci,'input',function(){ _mcCmdFit(_ci); });
      /* In the next frame, not now: measuring here forced the whole freshly
         drawn Crew page to be laid out inside the click that opened it (130ms
         at a phone's speed), and the frame then laid it out again. */
      try{ requestAnimationFrame(function(){ _mcCmdFit(_ci); }); }catch(e){ _mcCmdFit(_ci); }
    }
    vc.querySelectorAll('[data-mccmd]').forEach(function(c){ on(c,'click',function(){ var el=$('mc-cmd-input'); if(el){ el.value=c.dataset.mccmd; _mcCmdFit(el); el.focus(); } }); });
  }catch(e){}
  /* The search re-renders on a pause rather than on every keystroke: this
     rebuilds a hundred cards, and doing that per character makes typing feel
     like wading. */
  try{
    var _fi=$('cw-find');
    if(_fi){
      var _t=null;
      on(_fi,'input',function(){ var v=this.value; clearTimeout(_t); _t=setTimeout(function(){ cwFind(v); },220); });
      on(_fi,'keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); clearTimeout(_t); cwFind(this.value); } });
    }
  }catch(e){}
}
try{ window._cwWireCmd=_cwWireCmd; }catch(e){}
function cwDemo(){
  const appr=_cwApprovals();
  const now=Date.now(), me=(S.user&&S.user.name)||'You', first=me.split(' ')[0];
  appr.unshift({
    id:'a'+now, icon:'\uD83D\uDCE7',
    title:'Weekly customer update - September',
    project:'Growth', crewName:'Content Crew',
    actionType:'send', resultType:'email', recipients:42,
    destination:'42 customers (newsletter list)', account:'you@amv.dev',
    requesting:'Send the finished monthly update to your customer list.',
    autoApprove:false,
    startedAt:now-26*6e4, readyAt:now-3*6e4,
    warning:'Goes to 42 recipients. Double-check the subject line before approving.',
    result:{ type:'email', from:'you@amv.dev', to:'42 customers (undisclosed recipients)',
      subject:'What we shipped this month + what\u2019s next',
      body:'Hi there,\n\nThis month we shipped three things you asked for: faster exports, a redesigned dashboard, and one-click sharing. Exports now finish in seconds, the dashboard puts your key numbers first, and sharing a report is now a single click.\n\nNext month we\u2019re focused on team workspaces - shared projects, roles, and a single bill. If you want early access, just reply to this email.\n\nThank you for building with us.\n\n- '+first },
    timeline:[
      {t:'9:02 AM', agent:'Planner', text:'Broke the update into research, draft, and review.'},
      {t:'9:06 AM', agent:'Researcher', text:'Pulled this month\u2019s shipped features and the top 3 customer requests.'},
      {t:'9:11 AM', agent:'Copywriter', text:'Wrote the subject line, intro, and the three highlights.'},
      {t:'9:15 AM', agent:'Reviewer', text:'Tightened the copy and flagged the subject line for your eyes.'},
      {t:'9:17 AM', agent:'AMV', text:'Ready for your approval.'}
    ],
    crew:[
      {role:'Planner', resp:'Structured the work', status:'done'},
      {role:'Researcher', resp:'Gathered the month\u2019s highlights', status:'done'},
      {role:'Copywriter', resp:'Wrote the email', status:'done'},
      {role:'Reviewer', resp:'Checked tone and accuracy', status:'done'}
    ],
    artifacts:[
      {name:'highlights.md', from:'Researcher', to:'Copywriter', note:'the month\u2019s shipped features'},
      {name:'draft-v1', from:'Copywriter', to:'Reviewer', note:'first email draft'},
      {name:'final-email', from:'Reviewer', to:'AMV', note:'approved-for-review copy'}
    ]
  });
  _cwSaveApprovals(appr); renderCrewView();
  toast('Example draft added - press Preview to see the full workspace','info',4000);
}

window.cwToggle=cwToggle;window.cwDemo=cwDemo;window.cwReject=cwReject;
