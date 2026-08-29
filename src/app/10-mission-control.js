/* ============================================================
   AMV CO-WORKER  - autonomous agent: standing jobs + approval inbox
   The differentiator: it watches your connected accounts and proposes
   actions (draft replies, summaries, bookings). You approve or reject
   each one with a click. Nothing is sent without your OK.
   ============================================================ */
function _cwJobs(){ return load('amv_cw_jobs') || _cwDefaultJobs(); }

/* ── THE EVERYDAY JOBS JOIN THE DEFINITIONS, NOT THE LIST ────────────────────

   The server sync rebuilds `amv_cw_jobs` from _cwDefaultJobs() on every run -
   deliberately, because the definitions are the source of truth for what a job
   IS and the server only says whether it is ON. Which means a job appended to
   somebody's saved list is silently deleted the next time that sync runs.

   So these are cached where the definitions are read from, and _cwDefaultJobs
   returns the built-in jobs FIRST and unchanged, with the everyday ones after.
   Nothing that was already there moves, changes id, or disappears. */
function _everydayDefs(){
  const d = load('amv_everyday_defs');
  return Array.isArray(d) ? d : [];
}
function _everydayCache(list){
  store('amv_everyday_defs', Array.isArray(list) ? list : []);
}
function _cwSaveJobs(j){ store('amv_cw_jobs', j); }
function _cwDefaultJobs(){ return [
  { id:'job_hunt', cat:'Work & career', icon:'\uD83D\uDCBC', title:'Job hunt - find and prepare applications', needs:'Email, Web research', on:false,
    desc:'AMV finds roles matched to your resume and prepares a tailored application for each one, ready for you to review and send. If a posting asks something you have not specified, it asks you first. Submitting on its own is not switched on - nothing reaches an employer without you.',
    prompt:'Find current job openings matching the roles, locations and salary floor in my Job Hunt profile. For each one: the title, company, location, pay if stated, why it fits me, and the direct link. Then draft a tailored application for the strongest matches, using my resume and stated preferences. Do not submit anything - present each as a finished draft for me to review. If a posting asks for something my profile does not answer, list the question instead of inventing an answer.' },
  { id:'morning_brief', cat:'Watching the world', icon:'\u2600\uFE0F', title:'Morning news & markets brief', needs:'Email, Web research', on:false,
    desc:'Every morning, AMV researches what happened overnight and emails you a short brief on the moves that matter and why - facts and figures, never a recommendation.',
    sample:['OVERNIGHT: three things moved, one matters to what you follow.','Chip index down 2.1% after an earnings miss in Asia. The miss was guidance, not revenue.','Energy flat despite the headline - the market had already priced it.','ON YOUR LIST: the two names you watch closed 0.4% and 1.8% down, in line with the sector rather than company news.','Information, not financial advice.'],
    prompt:'Search the live web now and report what happened overnight in news and markets relevant to what the user follows. Give the specific moves with numbers and the reason attributed to each, distinguishing a real cause from a headline the market had already priced. Cover the user\u2019s named interests explicitly, and say when nothing relevant happened rather than padding. You must NOT give financial advice: never tell the user to buy, sell, hold or wait, and never predict a price. End by stating this is information, not financial advice.' },
  { id:'inbox_digest', cat:'Inbox & calendar', icon:'\uD83D\uDCEC', title:'Daily inbox digest', needs:'Email', on:false,
    desc:'Each evening, the few emails that actually need you - summarised, with a ready-to-send reply drafted for each. Nothing goes out without you pressing send.',
    sample:['6 needed you today. 58 did not.','Client asking to move Thursday to Friday - reply drafted, says yes and proposes 2pm.','Invoice query from accounts - reply drafted, needs the PO number you have not given me.','Recruiter, second follow-up - drafted a short no, since you have not replied twice.','Every draft is ready to send and has NOT been sent.'],
    prompt:'Summarise the user\u2019s recent mail into the messages that genuinely need them and the count of those that do not. For each that needs action: who, what they want, and what is at stake if it waits. Draft a ready-to-send reply for each, in the user\u2019s own register. Where a reply needs information only the user has, say exactly what is missing rather than inventing it. State plainly on every draft that it is ready and has NOT been sent. Never describe an email you cannot actually see.' },
  { id:'competitor_watch', every:'weekly', cat:'Growing a business', icon:'\uD83D\uDD0D', title:'Competitor & industry watch', needs:'Email, Web research', on:false,
    desc:'Watches the companies you compete with and tells you what actually changed - pricing, launches, hiring, positioning - and what it means for you, not just that it happened.',
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

  { id:'opportunity_radar', cat:'Work & career', icon:'\uD83C\uDFAF', title:'Opportunity radar', needs:'Email, Web research', on:false,
    desc:'Every morning AMV hunts for things you could actually get - scholarships, grants, internships, jobs, competitions, fellowships, discounts and rebates that match your profile - and emails you only the ones you qualify for, with the deadline and the direct link.',
    sample:['6 open now that you actually qualify for. 2 close inside a fortnight.','Regional innovation grant - up to 5,000, closes in 11 days, needs a one-page plan you already have most of.','Industry fellowship - paid, closes in 6 weeks, needs two references. Ask this week, not that week.','Discarded 23: wrong region, wrong stage, or already closed. No point showing you those.'],
    asks:{ q:'What should I match against?', ph:'Your age, where you live, what you study or do, and the kinds of things you want - e.g. "17, Manchester UK, studying chemistry and maths, want scholarships and summer research"' },
    prompt:'Search the live web for opportunities matching the user profile and interests: scholarships, grants, internships, jobs, competitions, fellowships, rebates and tax credits. Only include ones open NOW with a future deadline. For each: name, what it gives, eligibility, deadline, direct application link. Exclude anything they clearly do not qualify for. If you find nothing new, say so plainly.' },

  { id:'change_digest', cat:'Watching the world', icon:'\uD83D\uDD14', title:'Did anything change today?', needs:'Web research', on:false,
    desc:'You tell AMV what to watch - a page, a price, a competitor, a policy, a person, a job board - and each morning it checks every one and reports only what actually changed. No change, no noise.',
    sample:['4 things on your watch list. 1 changed.','The supplier page: lead time went from 3 weeks to 6. Changed some time in the last 24 hours.','WHY IT MATTERS: your quote to the client assumed 3.','The other three are unchanged. Prices, the policy page, the job board - all identical to yesterday.'],
    asks:{ q:'What should I watch?', ph:'One per line: a page, a price, a competitor, a policy, a job board. Paste links where you have them.' },
    prompt:'Check each item on the user watch list against its previous state. Report ONLY genuine changes: what changed, the old value, the new value, and why it might matter. If nothing changed, say "nothing changed" rather than padding the report.' },

  { id:'money_leaks', cat:'Money', icon:'\uD83D\uDCB8', title:'Money leak detector', needs:'Email', on:false,
    desc:'AMV reads your receipts and statements for subscriptions you stopped using, duplicate charges, silent price rises, and avoidable fees - then tells you exactly what to cancel and how much you would save.',
    sample:['Found 4 things. Together they cost you 631 a year.','Design tool - 34/month, no login recorded in 5 months. 408/year.','Two charges from the same streaming service on the 3rd and the 17th. One is a duplicate.','Cloud storage went from 8 to 12 in January without an email about it. 48/year, quietly.','Every one of these is from a receipt I can point at. Nothing here is a guess.'],
    prompt:'Scan recent receipts, invoices and statement emails. Identify: recurring charges that look unused, duplicate charges, subscription price increases versus previous months, and avoidable fees. For each, give the merchant, the amount, how often, and the annual cost of keeping it. Total the potential saving. Never guess a charge you cannot see evidence for.' },

  { id:'forgot_check', cat:'Inbox & calendar', icon:'\uD83E\uDDE0', title:'What did I forget?', needs:'Email, Calendar', on:false,
    desc:'Each morning AMV re-reads your recent mail and calendar for things you said you would do, questions nobody answered, and commitments with no follow-up - so nothing quietly slips.',
    sample:['3 things you said you would do and have not.','You told Priya on the 4th you would send the revised figures \'tomorrow\'. That was 9 days ago.','Two people are waiting on a reply: the landlord (6 days) and the accountant (3 days).','You asked the supplier a question on the 8th and never got an answer. Worth chasing before the order.'],
    prompt:'Review recent emails and calendar entries. List: promises the user made that have no follow-up, messages awaiting their reply, questions they asked that were never answered, and commitments with an approaching date. Be specific - quote the sentence and name the person. Only include real, evidenced items.' },

  { id:'renewal_watchdog', cat:'Money', icon:'\uD83D\uDCC4', title:'Contract & renewal watchdog', needs:'Email', on:false,
    desc:'Finds subscriptions, insurance, leases, warranties, domains and memberships heading for renewal, warns you BEFORE the auto-charge, and prepares the cancel-or-renegotiate message.',
    sample:['3 renewals inside 30 days. One of them is bad value.','Insurance auto-renews on the 22nd at 840 - up from 690 last year, for the same cover.','Domain renews on the 30th, 14. Fine, leave it.','Gym renews on the 2nd, 45/month. You have been twice since November.','Cancellation email for the gym and a renegotiation email for the insurance, both drafted and NOT sent.'],
    prompt:'Find upcoming renewals, expirations and auto-charges in the user mail: subscriptions, insurance, leases, warranties, domains, memberships, licences. For each: what it is, the renewal date, the amount, and whether it auto-renews. Flag anything renewing within 30 days first. Draft a cancellation or renegotiation email for anything that looks poor value.' },

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
    prompt:'From the user booking confirmations, identify upcoming travel. Check flight status, gate and time changes, weather at origin and destination, and check-in windows. Report anything that needs action, with how much time remains to act. State clearly if a booking cannot be verified.' },

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

  { id:'goal_tracker', cat:'Home & life', icon:'\uD83D\uDE80', title:'Goal tracker & weekly plan', needs:'Email', on:false,
    desc:'Turns a real goal - save an amount, get fit, launch something, get into a school - into a weekly plan, checks your progress, and adapts when you fall behind instead of nagging.',
    prompt:'For each user goal: assess progress since last check, give the specific next actions for this week, and adapt the plan if they are behind. Be concrete and realistic. Encourage honestly - never claim progress that has not happened.' },

  { id:'deliveries', cat:'Home & life', icon:'\uD83D\uDCE6', title:'Package & delivery tracking', needs:'Email', on:false,
    desc:'Pulls tracking numbers out of your order confirmations and tells you what is arriving today, what is late, and what never shipped.',
    prompt:'From order and shipping confirmation emails, list every package in transit: what it is, carrier, tracking number, expected date, and current status. Flag anything late or never shipped. Only report packages you have evidence for.' },

  { id:'life_admin', cat:'Home & life', icon:'\uD83D\uDDD3\uFE0F', title:'Life admin & expiry reminders', needs:'Email, Calendar', on:false,
    desc:'Passport, licence, insurance, registration, medical checks, home and car maintenance - AMV tracks the dates and reminds you far enough ahead that renewing is easy.',
    prompt:'Track expiries and recurring life admin: passport, licence, insurance, vehicle registration and inspection, medical and dental checks, home and car maintenance. Report what is due in the next 90 days, how long renewal usually takes, and what to do first.' },

  { id:'vip_alerts', cat:'Inbox & calendar', icon:'\uD83D\uDEA8', title:'Important email alerts', needs:'Email', on:false,
    desc:'Not a daily digest - AMV pings you the moment something genuinely urgent lands: your boss, a client, an offer, an interview invite, a deadline or anything money-related.',
    prompt:'Watch incoming mail for genuinely urgent items: named VIP senders, offers, interview invitations, deadlines, legal or money matters, and anything explicitly marked urgent by a real person. Alert immediately with sender, subject and the one line that makes it urgent. Do NOT alert on newsletters, marketing or automated notifications.' },

  { id:'recurring_email', cat:'Inbox & calendar', icon:'\uD83D\uDCEE', title:'Recurring emails on a schedule', needs:'Email', on:false,
    desc:'Send a real email on any schedule - weekly reports to your team, monthly invoices, a check-in every Friday. AMV writes it fresh each time from current information and sends it through your own Gmail.',
    prompt:'At each scheduled run, compose the recurring email fresh from the latest information (do not resend a stale copy), then send it from the user Gmail account to the specified recipients. Confirm what was sent and to whom. If the recipient or content is unclear, ask instead of sending.' },

  { id:'calendar_brief', cat:'Inbox & calendar', icon:'\uD83C\uDF05', title:'Morning calendar briefing', needs:'Calendar', on:false,
    desc:'Your day in one message before it starts: every meeting, travel time between them, what needs prep, where the free blocks are, and the one thing you should protect time for.',
    prompt:'Summarise today from the calendar: each event with time and attendees, realistic travel or transition time between them, which need preparation, where the genuine free blocks are, and the single most important thing to protect time for. Flag any day that is overbooked.' },

  { id:'conflict_watch', cat:'Inbox & calendar', icon:'\u26A0\uFE0F', title:'Scheduling conflict alerts', needs:'Calendar', on:false,
    desc:'Catches double-bookings, meetings with no travel time between them, and things scheduled outside your working hours - before they become an awkward cancellation.',
    prompt:'Scan the calendar for problems: overlapping events, back-to-back meetings in different locations with no travel time, events outside stated working hours, and meetings with no agenda or attendees. Report each conflict and suggest the specific fix.' },

  { id:'meeting_docs', cat:'Inbox & calendar', icon:'\uD83D\uDCCE', title:'Prepare documents before meetings', needs:'Calendar, Email, Drive', on:false,
    desc:'Before a meeting AMV pulls together everything you will need - the last thread, the attached files, the previous notes, the numbers - into one place so you are never scrambling.',
    prompt:'For each upcoming meeting, gather the relevant material: prior email threads with attendees, attached documents, previous meeting notes and open action items. Produce one prep pack with the key facts and open questions. Only include documents that actually exist.' },

  { id:'project_pulse', cat:'Work & career', icon:'\uD83D\uDCC8', title:'Morning project updates', needs:'Email, Web research', on:false,
    desc:'A single morning read on everything moving: what progressed, what stalled, what is blocked on someone else, and what needs you today.',
    prompt:'Report the current state of each active project: what moved since the last update, what stalled, what is blocked and on whom, and what specifically needs the user today. Be concrete and short. Say plainly if a project had no activity.' },

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
    desc:'Tells you when your score moves and what caused it - a new account, a hard search, changed utilisation - and flags anything on your report you did not do.',
    prompt:'Report changes to the credit score and report since the last check: the movement, the likely cause, and anything unrecognised such as an unknown account or hard search. Explain what would raise it most. If the score cannot be read, say so plainly.' },

  { id:'budget_trend', cat:'Money', icon:'\uD83D\uDCCA', title:'Budget pace & spending review', needs:'Bank connection', on:false,
    desc:'Not a report after the damage - it tells you mid-month that you are trending over budget while you can still do something, and where the overspend is coming from.',
    asks:{ q:'What is your budget?', ph:'What you expect to spend on what, and the number that matters - e.g. "about 400 a month on food, and I must not go over 1200 total"' },
    prompt:'Work out the current month\u2019s spending pace against the user budget and project the month-end total. If trending over, identify which categories are driving it and what change would bring it back. Use real transactions only.' },

  { id:'target_buy', cat:'Money', icon:'\uD83D\uDECD\uFE0F', title:'Buy at my target price', needs:'Web research, Web automation', on:false, spend:true,
    desc:'Watches an item and buys it the moment it hits your target. Small purchases go through instantly with no interruption; anything above your auto-buy limit takes one tap. Your monthly cap can never be crossed.',
    prompt:'Monitor the specified item until it reaches the user target price. When it does, read the FINAL total including shipping, tax and any pre-ticked extras, and remove anything that was added without being asked for (warranties, protection plans, insurance). Check the total against the user spending limits: below the auto-buy limit, complete the purchase; above it, request one approval. Never exceed the per-purchase or monthly cap, never substitute a different item, size or colour, and always report the exact final total and what was bought.' },

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
    prompt:'Identify the user’s recurring bills and the amount paid for each. Research the current new-customer and retention pricing for the same service and comparable providers. For each bill where the user is paying materially above market: state what they pay, what is available now, the annual saving, and write the exact script to use with retentions, including the competing offer to cite. Only include bills you have real evidence of.' },

  { id:'tax_catch', cat:'Money', icon:'🧾', title:'Deductible expense catcher', needs:'Email', on:false,
    desc:'Deductions get lost because nobody tags them in January. AMV watches receipts all year, files the ones that count, and hands you an organised list instead of a shoebox in April.',
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
    asks:{ q:'What is your role?', ph:'Job title, level, industry and location - e.g. "backend engineer, senior, fintech, Manchester UK"' },
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
    prompt:'From recent activity, identify accomplishments worth recording: projects completed, things shipped, measurable results, new responsibilities, tools learned, recognition received. For each, draft one strong CV or profile line in the user’s voice with the concrete result. Maintain the running list between runs. Only include achievements with real evidence.' },

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
    prompt:'From advertising reports and billing emails, summarise spend and results per campaign since the last run. Identify what is spending without returning, what is improving, and where cost per result has risen. Recommend specific pauses or budget shifts with the money involved. Use only figures present in the reports - never estimate performance.' },

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

  { id:'study_drill', cat:'Learning', icon:'🧠', title:'Spaced revision on a schedule', needs:'Email', on:false,
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

  { id:'habit_pulse', cat:'Health', icon:'🏃', title:'Training plan that adapts', needs:'Email', on:false,
    desc:'Adjusts the plan to the week you actually had rather than the one you intended - so missing two sessions changes the plan instead of ending it.',
    prompt:'Review the user’s reported activity since the last run against their stated goal. Report what actually happened, adjust the coming week to fit their real availability and recent load, and progress or ease the plan accordingly. Be honest when a goal has drifted out of reach on the current trajectory and say what would bring it back. Never give medical advice or interpret pain or injury - direct those to a professional.' },

  { id:'home_seasonal', cat:'Home & life', icon:'🏠', title:'Home maintenance by season', needs:'Calendar', on:false,
    desc:'The jobs that cost thousands when skipped - boiler, gutters, filters, damp checks, roof, drains - scheduled at the right time of year for where you actually live.',
    prompt:'Maintain a seasonal home maintenance schedule for the user’s property type and climate. Each run, report what is due now, why it matters, roughly what it costs to do versus what neglecting it costs, and whether it is a job for them or a trade. Track what has already been done so nothing repeats needlessly.' },

  { id:'car_admin', cat:'Home & life', icon:'🚗', title:'Vehicle service, tax and inspection', needs:'Email, Calendar', on:false,
    desc:'Service intervals, inspection and tax dates, warranty expiry and open recalls for your actual vehicle - with enough warning to book rather than scramble.',
    prompt:'Track vehicle admin: service intervals against mileage or date, inspection and tax renewal dates, insurance renewal, warranty expiry, and any open safety recalls for the specific make, model and year. Report what is due in the next 90 days and what needs booking now. Check recalls against official sources only.' },

  { id:'flight_watch', cat:'Home & life', icon:'✈️', title:'Flight price watch for a real trip', needs:'Web research', on:false,
    desc:'Watches your actual route and dates, learns what a normal fare looks like, and tells you when a price is genuinely good - including when to rebook a refundable fare cheaper.',
    sample:['Your route, your dates. Watching for 3 weeks now.','Best right now: 214 return, direct. The usual since watching began has been 260-290.','This is the lowest it has been. Not by a little - by 46.','Flying out a day earlier saves another 31, if that works.','You already hold a refundable fare at 268. Rebooking now saves 54.'],
    asks:{ q:'Which trip?', ph:'Route and dates - e.g. "Manchester to Lisbon, leaving 14-16 June, back 21-23 June"' },
    prompt:'Track fares for the user’s specified routes and date ranges. Report the current best fare, the airline, how it compares to what has been seen since watching began, and whether to book now or wait. Include nearby dates or airports when they are materially cheaper. If the user already holds a refundable booking and the fare has dropped, state the rebooking saving explicitly. Never present a fare you have not actually seen.' },

  { id:'move_watch', every:'weekly', cat:'Home & life', icon:'📍', title:'Rent, property and neighbourhood watch', needs:'Web research', on:false,
    desc:'Watches what places like yours actually rent and sell for, and what is happening where you live or want to live - so a lease renewal or an offer is a decision made with numbers.',
    asks:{ q:'Which area and what kind of place?', ph:'e.g. "2-bed flat, Chorlton Manchester, renting"' },
    prompt:'Track the local market for the user’s stated area and property type: current asking and achieved prices or rents for comparable places, how they have moved, time on market, and relevant local developments such as transport, planning or school changes. Report what it means for a renewal, a purchase or a sale decision. Use real listings and cite the date checked.' },

  { id:'gift_radar', cat:'Home & life', icon:'🎁', title:'Birthdays, occasions and gift ideas', needs:'Calendar, Email, Web research', on:false,
    desc:'Warns you far enough ahead to do something good rather than something panicked, with ideas built from what that person has actually said they like, and the delivery cut-off.',
    sample:['Your sister\'s birthday is in 3 weeks. Long enough to do something good.','She mentioned twice in messages that her camera strap is falling apart.','A good replacement is 38 and ships in 4 days, so the last safe order date is the 19th.','Two other ideas grounded in things she has actually said, both under your 50.','Nothing here is invented - each one traces back to something she wrote.'],
    asks:{ q:'Who and when?', ph:'Names, dates, roughly what you would spend, and anything they have said they like' },
    prompt:'Track upcoming birthdays, anniversaries and occasions from the calendar and correspondence. For each, warn far enough ahead to act, and suggest specific ideas grounded in things that person has actually mentioned or shown interest in, within the user’s stated budget. Include current price, where to get it, and the delivery cut-off date to arrive in time. Never invent a preference the user has no record of.' },

  { id:'doc_expiry', cat:'Home & life', icon:'🛂', title:'Passport, visa and travel eligibility', needs:'Email, Calendar, Web research', on:false,
    desc:'Catches the trap that ruins trips: a passport too close to expiry for the country you booked, a visa or permit needing renewal, an entry rule that changed since you last flew.',
    sample:['You have a flight booked. Your passport is a problem.','It expires in 4 months. Spain requires 3 months\' validity beyond your return date - you clear it by 11 days.','That is too close. A delayed return or a date change breaks it.','A renewal takes about 3 weeks at the moment, so start before the 8th.','Entry rules checked against the government source today. These change without notice.'],
    prompt:'Check the user’s travel documents against their planned travel: passport expiry versus each destination’s validity requirement, visa or permit status and renewal timing, and current entry requirements for those destinations. Report anything that would block travel, how long the fix takes, and the latest date to start it. Verify entry rules against official government sources and give the date checked, since these change without notice.' },

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
    sample:['DONE TODAY: chemistry questions, history reading.','SLIPPED: the maths problem set. It is now due in 2 days and untouched.','TOMORROW: double free in the afternoon - that is enough for the whole maths set.','IF YOU DO ONE THING TONIGHT: read the essay question so it is in your head. 5 minutes.'],
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
    prompt:'Take a long text the user has to read and give them: the central argument in one sentence, the evidence used to support it, the weakest part of that argument, and which aspects are most likely to be examined and how. Then give comprehension questions with answers held separately, so they can test themselves honestly. This is a companion to the reading, not a replacement for it - say so, and do not summarise so completely that reading it becomes pointless.' },

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
    desc:'Hunts for scholarships, competitions, summer programmes, internships and free courses you genuinely qualify for - with the deadline and the direct link, and nothing you cannot enter.',
    sample:['4 open now that you qualify for. 2 close within a month.','Regional essay competition - 500 prize, closes in 18 days, needs 1500 words on a set theme. You have written on this before.','Summer research programme - free, closes in 5 weeks, needs a teacher reference. Ask now.','Dropped 11 others: age, region or grade requirements you do not meet. No point showing you those.'],
    asks:{ q:'Who are you, for eligibility?', ph:'Age, country and region, year group or level, what you study, and the kinds of things you want' },
    prompt:'Search the live web for opportunities the user genuinely qualifies for given their age, location, year group and interests: scholarships, competitions, summer programmes, internships, bursaries and free courses. Only include ones open now with a future deadline. For each: what it is, what it gives, what it requires, the deadline, and the direct link. Explicitly say how many you excluded and why, so they trust that the list is filtered rather than padded. Flag anything needing a reference or a document early, since those depend on other people.' },

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
    asks:{ q:'Where are you, and what does weather change for you?', ph:'Town or postcode, then what it affects - e.g. “Manchester, I cycle to work and my kids walk to school”' },
    sample:['Rain from 07:40 to about 09:15, then dry all day.','THAT MEANS: leave at 07:20 and you miss it, or leave at 09:30 and you miss it. 08:00 is the worst possible time.','14C, feels like 11 in the wind. Coat, not a jacket.','Tomorrow is the dry day this week, if you are moving anything outdoors.'],
    prompt:'Search the live web for today’s forecast for the user’s stated location, from a real forecast source you name. Do not just recite numbers: lead with the ONE thing the weather changes for them today, given what they told you it affects. Give the timing of any rain, snow or wind precisely enough to plan around - the hour it starts and the hour it stops - because a day that is “60% rain” is useless and “wet until nine, then dry” is a decision. Say what to wear only when it is not obvious. Mention tomorrow only if it is materially different and something could be moved to it. If the forecast source is uncertain or the models disagree, say so plainly rather than picking one. Never invent a temperature or a time.' },

  { id:'fuel_watch', every:'weekly', cat:'Money', icon:'⛽', title:'Where fuel is cheapest near me', needs:'Web research', on:false,
    desc:'Once a week, the real price at the stations you would actually drive to - what it costs to fill up at each, and whether the cheaper one is worth the detour or just further away.',
    asks:{ q:'Where do you fill up, and what do you drive?', ph:'Your area or postcode, the fuel type, roughly your tank size, and any loyalty card - e.g. “Leeds LS6, diesel, 55 litre tank, Costco member”' },
    sample:['Cheapest within a sensible drive: 138.9 a litre at the supermarket on Kirkstall Road.','A FULL TANK THERE: 76.40. At your usual station it is 81.35. You save 4.95.','THE CATCH: it is 2.6 miles further each way, which costs you about 0.90 in fuel. Real saving is roughly 4.','Prices rose about 2p across the area this week, so this is not the week to wait for better.'],
    prompt:'Search the live web for current fuel prices at stations near the user’s stated location, for their stated fuel type, from a real price source you name along with how recently it was updated. List the genuinely cheapest few, with the price per litre or gallon and what a full tank of their stated size actually costs at each. Then do the arithmetic they will not: compare against their usual station, subtract the fuel burned getting to a further one, and say whether the detour is actually worth it in money. Say which way prices are moving in their area this week, so they know whether to fill now or wait. If prices at a station are stale or unverified, say so rather than presenting them as current. Never invent a price or a station.' },

  { id:'store_deals', every:'daily', cat:'Money', icon:'🏷️', title:'Discounts where I actually shop',  needs:'Web research', on:false,
    desc:'Every morning, real current offers at the specific shops you buy from - and only on the things you actually buy. No vouchers for a shop you have never been to and no code that expired in March.',
    asks:{ q:'Which shops, and what do you buy there?', ph:'One per line - the shop and the kind of thing - e.g. “Tesco, weekly food shop” / “Uniqlo, basics” / “Boots, contact lenses”' },
    sample:['3 offers worth your time today, out of 41 running.','TESCO - 3 for 2 across the nappies you buy monthly. Works out at 11.32 saved on a normal shop. Ends Tuesday.','BOOTS - your lens brand is on the 25% multibuy again. It was 25% in January too, so this is the regular cycle, not a one-off.','UNIQLO - the basics you buy are NOT in the sale. The sale is outerwear.','Dropped 38: wrong shop, wrong products, or a “deal” that is the normal price.'],
    prompt:'Search the live web for offers running RIGHT NOW at the specific shops the user named, and only on the kinds of things they said they buy there. For each: what the offer is, what it saves on a realistic basket for them in money, when it ends, and a link. Then be the filter they came for: say how many offers you discarded and why, and explicitly call out any “deal” that is simply the usual price or a discount off an inflated one. If an offer runs on a predictable cycle, say so, because knowing it will be back in six weeks changes whether they buy today. Verify every offer is currently live and dated - an expired voucher is worse than no email. Never invent an offer, a code or a saving.' },

  { id:'local_basket', every:'weekly', cat:'Money', icon:'🍎', title:'Where the food shop is cheapest this week', needs:'Web research', on:false,
    desc:'The things you buy every week, priced across the shops you can actually reach - so you know where the fruit is cheap this week and whether the whole shop is worth moving.',
    asks:{ q:'Where do you shop, and what is on the list every week?', ph:'Your area, the shops within reach, then the items you always buy - e.g. “Birmingham B14, Aldi Lidl Tesco Asda, bananas milk eggs chicken rice nappies”' },
    sample:['Your usual list, priced across 4 shops: 38.60 to 47.15. That is a 22% spread on the same food.','FRUIT IS THE GAP THIS WEEK: bananas and apples are 40% cheaper at Aldi than Tesco. Everything else is within pennies.','SO: it is not worth moving the whole shop. It is worth buying fruit in one place.','CHICKEN went up everywhere, about 8%, so that is the market and not your shop.','Prices checked today from each retailer’s own listings.'],
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
    sample:['3 things open. One of them has been open 6 weeks.','THE HEADACHES: your surgery releases same-day slots at 08:00 and online booking opens at 07:30. That is the door, and calling at 09:30 is why you have not got in.','READY TO GO: your NHS number, the dates you have recorded, what you have already tried, and the three questions worth asking. All below, ready to read out.','THE DENTAL CHECK is overdue by 4 months. Two practices nearby are taking new NHS patients this month - both links below.','AMV has NOT booked anything. These are calls for you to make.'],
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
  { id:'account_watch', cat:'Watching the world', icon:'\uD83D\uDCE1', title:'Watch a public account and tell me what it means', needs:'Email, Web research', on:false,
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
    prompt:'Find restaurants that genuinely fit the user\u2019s occasion, party size, budget, location and dietary needs. Check real current availability for the date and time they asked for rather than assuming it. Present the options ranked by fit, saying honestly what is good and what is weaker about each - including where a dietary need is only nominally catered for. Name what is NOT available so the absence is visible. Do NOT reserve anything without the user choosing: present the options and wait. When they choose, make the booking in their name with the details they gave, then confirm back exactly what was booked, for when, and under what name and contact.' },
].concat(_everydayDefs()); }
/* ── WHAT A JOB NEEDS, AGAINST WHAT IS ACTUALLY CONNECTED ────────────────────

   Every preset already declared its requirements in `needs`, and nothing ever
   checked them. Turning on "Morning money summary" with no bank linked flipped
   a switch, showed an active card, and did nothing - forever, silently. With
   seventy jobs on the page that stops being an edge case and becomes the
   default experience, so the requirement is now read rather than displayed.

   Web research and web automation run server-side and need nothing from the
   user, which is why they are absent here. */
const CW_NEEDS_CHECK = {
  'Email':           { label:'Gmail',            has:()=>_cwConnHas('mail.read') },
  'Calendar':        { label:'Google Calendar',  has:()=>_cwConnHas('calendar.read') },
  'Drive':           { label:'Google Drive',     has:()=>_cwConnHas('drive.read') },
  /* Read-only, and on the same Google connection - so a student who has linked
     Google for their mail already has this. A job needing it that runs with
     nothing connected would switch on and do nothing for ever, which is the
     failure this whole table exists to prevent. */
  /* Asked of the CONNECTION, not of the sign-in. _cwHasGoogle answers "is
     somebody signed in with Google", which is a different question and was
     being used to answer this one: a student who had only ever pressed Sign in
     with Google was told Classroom was available, switched the job on, and it
     ran every morning with no permission to read anything. */
  'Classroom':       { label:'Google Classroom', has:()=>_cwConnHas('school.read') },
  /* Through the one accessor, so "is an account linked" has a single definition
     that the server refresh keeps current. Reading the key directly here meant
     this screen and the investing pane could disagree. */
  'Bank connection': { label:'a bank connection',
    has:()=>{ try{ return typeof AMVFinance!=='undefined' && AMVFinance.linked(); }catch(e){ return false; } } },
};
/* _cwHasGoogle STOOD HERE AND ANSWERED THE WRONG QUESTION FOR A LONG TIME.

   It meant "is Google linked", and screen after screen used it to decide
   whether AMV could READ somebody's account - which it never could answer,
   because a sign-in proves identity and grants access to nothing. That is how a
   row came to show Gmail as connected on an account that had granted no mail
   scope at all.

   Every one of those callers asks _cwConnHas(capability) now: the server's own
   list of grants, per capability, so a mailbox reads as connected exactly when
   the mailbox was granted. And the token machinery it was built on is gone -
   no Google credential reaches this browser any more, so there is nothing left
   here for it to look at.

   If you need "is this person signed in", that is S.user. If you need "may AMV
   do X", that is _cwConnHas('X'). They were one function for a while and that
   was the bug. */

/* ── WHERE A JOB CAN ACTUALLY RUN ────────────────────────────────────────────

   The unattended runner on the server can search the live web and write. It has
   no mailbox, no calendar and no browser session - those live in THIS tab,
   behind a Google token the server never sees.

   So a job needing only web research genuinely runs with AMV closed, and one
   needing Gmail genuinely does not. Both used to be the same switch, and that
   switch wrote a boolean nothing ever read: turning on a standing job created
   no scheduled work anywhere. A web-research job now creates a real automation
   on the server, and a job that needs this tab says so on its face rather than
   implying an inbox it will never reach. */
/* Jobs whose scheduled work is being created right now. Counted against the
   plan allowance so a fast hand cannot switch on more than it sells. */
const _cwPending = new Set();
function _cwRunsUnattended(j){
  const needs=String((j&&j.needs)||'').split(',').map(s=>s.trim()).filter(Boolean);
  return needs.length>0 && needs.every(n=>n==='Web research');
}
/* WHERE A JOB RUNS, SAID THE RIGHT WAY ROUND.

   Three states, not two. A job either runs on the server whatever you are
   doing, runs there as soon as the account it needs is connected, or genuinely
   needs this tab open.

   The middle one used to be phrased "Runs while AMV is open - connect the
   account to run it closed", and that is the wrong way round. It leads with
   the limitation and buries the capability, so forty-nine of a hundred and six
   jobs read as "this needs my laptop awake" when what is true is that they run
   without it the moment you connect an account. Only seven are genuinely
   open-only. Reported as exactly that: "there are so many that should say run
   when amv is closed but it says run when amv is open".

   Leading with what it does is not overpromising, because the condition is
   still in the sentence. Naming the account makes the condition actionable
   rather than a shrug. */
function _cwWhereState(j){
  if(_cwRunsUnattended(j)) return 'closed';
  if(typeof _cwUnattendedReady === 'function' && _cwUnattendedReady(j)) return 'closed';
  const needs = String((j && j.needs) || '').split(',').map(x => x.trim()).filter(Boolean);
  const mappable = needs.length && needs.every(n => n === 'Web research' || _CW_NEEDS_TO_USES[n]);
  return mappable ? 'pending' : 'open';
}
function _cwWhereLabel(j){
  const st = _cwWhereState(j);
  if(st === 'closed') return 'Runs with AMV closed';
  if(st === 'open')   return 'Runs while AMV is open';
  /* Name what is missing, so the sentence tells you what to do about it. */
  let missing = [];
  try{ missing = (typeof _cwNeedsMissing === 'function') ? _cwNeedsMissing(j) : []; }catch(_e){}
  const who = missing.length ? missing.slice(0, 2).join(' and ') : 'your account';
  return 'Runs with AMV closed - once ' + who + ' is connected';
}
try{ window._cwWhereState=_cwWhereState; window._cwWhereLabel=_cwWhereLabel; }catch(e){}
function _cwNeedsMissing(j){
  const out=[];
  String((j&&j.needs)||'').split(',').map(s=>s.trim()).filter(Boolean).forEach(n=>{
    const c=CW_NEEDS_CHECK[n];
    if(c && !c.has() && out.indexOf(c.label)<0) out.push(c.label);
  });
  return out;
}
function cwConnect(){ try{ S.tab='integrations'; setTab('integrations'); }catch(e){} }
try{ window.cwConnect=cwConnect; }catch(e){}

/* ── BROWSING SEVENTY JOBS ────────────────────────────────────────────────────
   A flat grid of seventy cards is a wall, and a wall reads as less capable than
   a shelf, not more. Grouped under headings with a filter, the same list reads
   as range. Order is deliberate: the categories people feel most keenly first. */
const CW_CATS = ['Money','Work & career','Growing a business','Making things','Inbox & calendar',
                 'Watching the world','Home & life','Family & kids','Learning','Health'];
let _cwCat = 'all';
function cwCat(c){ _cwCat = c || 'all'; renderCrewView(); }
try{ window.cwCat=cwCat; }catch(e){}

function _cwCatChips(jobs){
  const count=c=>jobs.filter(j=>j.cat===c).length;
  const chip=(k,label,n)=>`<button class="cw-chip${_cwCat===k?' on':''}" data-dact="cwCat" data-darg="${escH(k)}">${escH(label)}<span class="cw-chip-n">${n}</span></button>`;
  return `<div class="cw-chips" role="group" aria-label="Filter jobs by category">`
    + chip('all','All',jobs.length)
    /* The count is a filter aid, not a capability claim. Said once, here,
       because a lone number beside a catalogue reads as a ceiling - and the
       owner's point was exactly that: it makes AMV look like it can do 93
       things when the text box takes anything you can describe. */
    + CW_CATS.filter(c=>count(c)).map(c=>chip(c,c,count(c))).join('')
    + `</div>`;
}

/* ── WHAT PEOPLE ACTUALLY START ───────────────────────────────────────────────
   The owner asked for a top ten "based on actual data", and the whole value of
   that sentence is in the last two words. A hand-picked order dressed as a
   ranking is the exact thing this product is not allowed to ship, so this reads
   one number per job from the server and nothing else: how many times each job
   in the catalogue has been turned into scheduled work. No account is named, no
   instruction is stored, nothing about what any run produced.

   Below the server's floor it says there is not enough yet and shows no order
   at all. Six starts sorted into a "top ten" is three coincidences presented as
   a trend, and the first person to read it would be misled by their own data. */
let _cwPop = { state:'idle', data:null, err:'' };
async function _cwLoadPopular(){
  /* 'error' is terminal until somebody presses Try again. Without that a
     failing endpoint would be re-requested on every repaint of a screen
     that repaints on every toggle. */
  if(_cwPop.state==='loading' || _cwPop.state==='done' || _cwPop.state==='error') return;
  if(!(window.AMV_API && AMV_API.live && AMV_API.crewPopular)){
    _cwPop = { state:'off', data:null, err:'' }; _cwPopPaint(); return;
  }
  _cwPop.state='loading';
  try{
    const d = await AMV_API.crewPopular();
    _cwPop = { state:'done', data:(d&&typeof d==='object')?d:null, err:'' };
  }catch(e){
    /* Named, not swallowed. A ranking that quietly vanishes looks like a
       feature that was never built, and the owner would be right to ask. */
    _cwPop = { state:'error', data:null, err:String((e&&e.message)||'').slice(0,120) };
  }
  _cwPopPaint();
}
function _cwPopPaint(){
  try{ const el=document.getElementById('cw-pop-body'); if(el) el.innerHTML=_cwPopBodyHTML(); }catch(e){}
}
function cwPopReload(){ _cwPop={ state:'idle', data:null, err:'' }; _cwPopPaint(); _cwLoadPopular(); }
try{ window.cwPopReload=cwPopReload; }catch(e){}

function _cwPopularHTML(){
  /* Kicked off from the render that first puts the container on the page, so
     the request is made once per load rather than once per repaint. */
  try{ setTimeout(_cwLoadPopular, 0); }catch(e){}
  return `<section class="cw-pop" id="cw-pop">
    <div class="sec-head"><h3>${escH(T('Most used right now'))}</h3><span class="sec-sub">${escH(T('Ranked by how many times these jobs have actually been started across AMV. Counts only - no names, and nothing about what any job did.'))}</span></div>
    <div id="cw-pop-body" class="cw-pop-body">${_cwPopBodyHTML()}</div>
  </section>`;
}

function _cwPopBodyHTML(){
  const st=_cwPop;
  if(st.state==='off')
    return `<div class="cw-pop-note">${escH(T('This ranking is counted on AMV’s servers. This copy is not connected to one, so there is no real data to show - and an invented order would be worse than an empty space.'))}</div>`;
  if(st.state==='idle' || st.state==='loading')
    return `<div class="cw-pop-note" aria-busy="true">${escH(T('Reading what people are starting most...'))}</div>`;
  if(st.state==='error')
    return `<div class="cw-pop-note">${escH(T('The ranking could not be loaded'))}${st.err?' ('+escH(st.err)+')':''}. <button class="mc-sec-link" data-dact="cwPopReload">${escH(T('Try again'))}</button></div>`;

  const d=st.data||{};
  if(!d.enough){
    const have=Math.max(0, d.total|0);
    const need=Math.max(1, (d.need|0)||25);
    const pct=Math.min(100, Math.round((have/need)*100));
    return `<div class="cw-pop-note cw-pop-early">
      <b>${escH(T('Not enough data yet.'))}</b>
      ${escH(T('A ranking needs a real sample behind it. Once enough jobs have been started, the ten people reach for most appear here, counted rather than chosen.'))}
      <span class="cw-pop-prog" role="img" aria-label="${escH(have+' of '+need+' starts needed before a ranking is shown')}">
        <span class="cw-pop-prog-bar"><span style="width:${pct}%"></span></span>
        <span class="cw-pop-prog-n">${have} / ${need}</span>
      </span>
    </div>`;
  }

  /* Ids the catalogue no longer carries are dropped rather than shown raw. A
     row reading "gmail_sweep_v2  41 starts" is not a job anybody can open. */
  const byId={}; (_cwJobs()||[]).forEach(j=>{ if(j&&j.id) byId[j.id]=j; });
  const rows=(Array.isArray(d.top)?d.top:[])
    .map(x=>({ n:Math.max(0,(x&&x.n)|0), job:byId[(x&&x.id)||''] }))
    .filter(x=>x.job && x.n>0);
  if(!rows.length)
    return `<div class="cw-pop-note">${escH(T('What people are running most was described in their own words rather than picked from a card, so there is nothing here to rank yet. The box above takes anything you can write down.'))}</div>`;

  const max=rows[0].n||1;
  const total=Math.max(0, d.total|0);
  return `<ol class="cw-pop-list">`+rows.map((x,i)=>`<li class="cw-pop-row">
      <span class="cw-pop-rank" aria-hidden="true">${i+1}</span>
      <span class="cw-pop-ic" aria-hidden="true">${x.job.icon||'✨'}</span>
      <button class="cw-pop-b" data-dact="cwPeek" data-darg="${escH(x.job.id)}"
              aria-label="${escH('Number '+(i+1)+'. '+x.job.title+'. '+x.n+' start'+(x.n===1?'':'s')+'. See what it does')}">
        <span class="cw-pop-t">${escH(x.job.title)}</span>
        <span class="cw-pop-d">${escH(x.job.desc)}</span>
      </button>
      <span class="cw-pop-n">
        <span class="cw-pop-meter" aria-hidden="true"><span style="width:${Math.max(6,Math.round((x.n/max)*100))}%"></span></span>
        <span class="cw-pop-n-t"><b>${x.n}</b> ${escH(T(x.n===1?'start':'starts'))}</span>
      </span>
    </li>`).join('')+`</ol>
    <div class="cw-pop-foot">${escH(T('Counted from'))} ${total} ${escH(T(total===1?'job started across AMV.':'jobs started across AMV.'))}</div>`;
}

function _cwJobsBody(jobs, jobCard){
  if(_cwCat!=='all'){
    const sel=jobs.filter(j=>j.cat===_cwCat);
    return `<div class="cw-jobs-grid">${sel.map(jobCard).join('')}</div>`;
  }
  /* Anything without a known category still has to appear - a job that exists
     but renders nowhere is the failure this whole screen keeps having. */
  const known=CW_CATS.filter(c=>jobs.some(j=>j.cat===c));
  const rest=jobs.filter(j=>CW_CATS.indexOf(j.cat)<0);
  return known.map(c=>`<div class="cw-cat">
      <div class="cw-cat-h">${escH(c)}<span class="cw-cat-n">${jobs.filter(j=>j.cat===c).length}</span></div>
      <div class="cw-jobs-grid">${jobs.filter(j=>j.cat===c).map(jobCard).join('')}</div>
    </div>`).join('')
    + (rest.length?`<div class="cw-cat">
      <div class="cw-cat-h">More<span class="cw-cat-n">${rest.length}</span></div>
      <div class="cw-jobs-grid">${rest.map(jobCard).join('')}</div>
    </div>`:'');
}

/* ── THE ONE-OFF ERRANDS, AND WHY THEY ARE NOT JOBS ──────────────────────────

   Half the owner's list does not repeat. Nobody wants the fastest route to the
   airport every Tuesday - they want it once, now, for a flight at six.

   Those could have been cards on this screen that ran through crewRun, and
   that would have been the wrong place to put them: crewRun's generic path
   calls the model with no web tool at all. A "cheapest route" answered from
   memory is a confident, plausible, out-of-date answer, which is worse than no
   feature. Chat has the live web search. So these open a chat with the request
   already written, one blank left for the detail only the person has, and they
   press send when they have filled it in.

   Nothing is auto-sent. The composer is filled and focused, the same as the
   starter chips do, so the request they send is one they have actually read. */
const CW_ERRANDS = [
  ['route', '🗺️', 'Fastest route somewhere',
   'Find me the fastest realistic route from [WHERE I AM] to [WHERE I AM GOING], leaving at [WHEN]. '+
   'Check current conditions on the live web, not a typical journey time: traffic, engineering works, cancellations and anything closed. '+
   'Give me the route, the door-to-door time, and the time I actually have to leave. '+
   'If there is a genuinely better alternative - a different mode, a different departure time - say so and say why. '+
   'Tell me how confident you are and what could still go wrong.'],
  ['scamcheck', '🛡️', 'Is this a scam?',
   'I am about to pay for this and I want to know if it is a scam. Here is everything I have:\n\n[PASTE THE LISTING, MESSAGE, LINK, SELLER NAME OR OFFER HERE]\n\n'+
   'Check it against how this kind of fraud actually works right now. Look up the seller, the site, the payment method and the price against what this really costs. '+
   'Tell me the specific things that are wrong with it, the things that are genuinely fine, and what an honest version of this would look like. '+
   'If it is a known scam pattern, name the pattern. If you cannot tell, say you cannot tell rather than reassuring me. '+
   'Then tell me the safest way to buy this thing, and what to do if I have already paid.'],
  ['papers', '📄', 'Work out which papers I need',
   'I need to work out exactly what paperwork this requires: [WHAT I AM APPLYING FOR - e.g. a visa, a residency renewal, a passport, a licence] '+
   'for [WHO, NATIONALITY, WHERE THEY ARE NOW, AND WHERE THEY ARE APPLYING].\n\n'+
   'Go to the official government source and use that, not a summary on somebody else’s site. Give me: '+
   'every document required and what it must show, the exact forms with their real names and numbers, the fees, the order things must be done in, '+
   'how long each step takes, and what is most commonly refused or sent back. '+
   'Link the official page for each. Say clearly where the rules are unclear or recently changed. '+
   'You are not a lawyer and this is not legal advice - say so, and tell me when this is a case where I genuinely need one.'],
  ['booking', '🍽️', 'Get a table or an appointment ready',
   'I want to book [WHAT - a restaurant, a doctor, a garage, a haircut] in [WHERE], for [WHEN AND HOW MANY PEOPLE].\n\n'+
   'Find the real options that actually fit, check whether they take bookings online or by phone, and check what is actually available for that time. '+
   'Then prepare the booking so it takes me two minutes: the place, the number or the direct booking link, what to ask for, and anything I need to have ready. '+
   'Do not book, call, email or confirm anything on my behalf - hand me a call I can make or a link I can press. '+
   'If nothing is available at that time, say so and give me the nearest thing that is.'],
  ['pricecheck', '🔎', 'Am I paying too much for this?',
   'I am about to pay [AMOUNT] for [THE THING]. Tell me whether that is a fair price right now.\n\n'+
   'Check what it actually sells for today across real sellers, whether this is a normal price or an inflated one with a discount stuck on it, '+
   'and whether it is about to be cheaper - a known sale, a new model, a seasonal pattern. '+
   'Tell me the cheapest legitimate place to get it and what the catch is with each. '+
   'If it is a fair price, say so plainly instead of manufacturing a reason to wait.'],
];
function cwErrand(key){
  const e = CW_ERRANDS.find(x => x[0] === key);
  if(!e) return;
  try{ if(typeof newChat === 'function') newChat(); else setTab('chat'); }catch(_){ setTab('chat'); }
  setTimeout(()=>{
    const ta = $('mta');
    if(!ta){ toast('Open a chat and paste your question there.','info',4000); return; }
    ta.value = e[3];
    try{ ta.dispatchEvent(new Event('input')); }catch(_){}
    ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,220)+'px';
    ta.focus();
    /* The bracketed blank is the only part they have to write. Putting the
       caret on it beats asking somebody to hunt for it in eight lines. */
    try{
      const at = e[3].indexOf('[');
      if(at >= 0) ta.setSelectionRange(at, e[3].indexOf(']', at) + 1);
    }catch(_){}
    try{ if(typeof announce==='function') announce('Chat opened with your request ready. Fill in the highlighted part, then send.'); }catch(_){}
  }, 220);
}
try{ window.cwErrand=cwErrand; }catch(e){}

function _cwErrandsHTML(){
  return `<section class="cw-errands">
    <div class="sec-head"><h3>${escH(T('Things that do not repeat'))}</h3><span class="sec-sub">${escH(T('The jobs below run on a schedule. These are one-offs - AMV opens a chat with the request written out, you fill in the one blank, and it looks it up live.'))}</span></div>
    <div class="cw-errand-grid">${CW_ERRANDS.map(e=>`<button class="cw-errand" data-dact="cwErrand" data-darg="${escH(e[0])}">
      <span class="cw-errand-ic" aria-hidden="true">${e[1]}</span>
      <span class="cw-errand-t">${escH(T(e[2]))}</span>
    </button>`).join('')}</div>
  </section>`;
}

function _cwApprovals(){ return load('amv_cw_approvals') || []; }
function _cwSaveApprovals(a){ store('amv_cw_approvals', a); }

async function _crewSyncLive(){
  if(!(window.AMV_API && AMV_API.live)) return;
  try{
    const jobs=await AMV_API.jobs();
    const appr=await AMV_API.approvals();
    /* MERGED into the catalogue, not substituted for it.

       The server holds a row only for jobs that have ever been switched on.
       Replacing the list with those rows therefore threw away every job the
       user had not touched - the catalogue collapsed from seventy-odd to the
       handful they had used, on the next sync. It also dropped every field the
       mapping did not mention: the category (so the grouping fell apart), the
       instruction (so switching one on would have scheduled its TITLE), and the
       id of the automation it created (so switching it off could no longer stop
       it).

       The definitions are the source of truth for what a job IS. The server is
       the source of truth for whether it is ON. */
    if(Array.isArray(jobs)){
      const onByKey = {};
      jobs.forEach(j => { if(j && j.key) onByKey[j.key] = !!j.on_flag; });
      const byId = {};
      _cwJobs().forEach(j => { byId[j.id] = j; });
      store('amv_cw_jobs', _cwDefaultJobs().map(def => {
        const cur = byId[def.id] || {};
        return Object.assign({}, def, {
          on: (def.id in onByKey) ? onByKey[def.id] : !!cur.on,
          /* Local only - it is the handle on the scheduled work this device
             created, and the server's job row does not carry it. */
          autoId: cur.autoId || null,
        });
      }));
    }
    if(appr){ store('amv_cw_approvals', appr.map(a=>({id:a.id,icon:a.icon,title:a.title,preview:a.preview}))); }
    /* ONLY IF THEY ARE STILL LOOKING AT IT.

       This is fired when the tab opens and answers whenever the network
       answers. Somebody who moved on in the meantime would have the screen they
       are now reading replaced by the one they left - the stored state above is
       still updated, which is the point, so the next time they open Crew it is
       correct without anything being redrawn under them. */
    if(S.tab === 'crew' || S.tab === 'extensions') renderCrewView();
  }catch(e){}
}
/* ============================================================
   MISSION CONTROL  (Phase 2) - the workforce overview.
   Aggregates the real state of everything AMV is doing: what needs
   approval, what's active, what's autonomous, what's scheduled, what
   finished, and what's blocked. Reads only real stores; empty groups
   collapse to a quiet line instead of fabricating activity.
   ============================================================ */
/* Per account. Raw localStorage skips _scopeKey, so "Pause all autonomous" was
   device-wide: one account pausing stopped another account's jobs, and the
   first account resuming silently restarted them. A safety control that one
   person can toggle for somebody else is not one. */
function _autonomyPaused(){ try{ return loadStr('amv_autonomy_paused')==='1'; }catch(e){ return false; } }
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
  return `<div class="mc-sched-row">
    <div class="mc-sched-b">
      <div class="mc-sched-goal">${escH(t.goal||'Scheduled job')}</div>
      <div class="mc-sched-meta">${escH(when)}${ran?` · last ran ${escH(ran)}`:''}${next?` · next ${escH(next)}`:''}${t.localOnly?' · runs while AMV is open':''}</div>
      <div class="mc-sched-mode-row">${mode}${waitChip}</div>
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
function _mcCancelSched(id){
  let gone = false;
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
/* WHAT TODAY'S RUN IS WAITING FOR, ON TODAY'S RUN.

   The server sends the missing permissions as data rather than only as prose,
   so each one can be listed against the run that wanted it and can name the
   place it is fixed. That matters because the same job asks for different
   things on different days - a single line saying "needs access" on a job that
   runs every night tells somebody nothing about which night or what for. */
/* WHAT A JOB WILL NEED, SHOWN BEFORE IT GETS THERE.

   The one below says what a run that already stopped was missing, which is
   right and is too late to be the only place it is said. The server resolves
   the same question for every job on the list, so the gap is visible while
   somebody is still sitting in front of it. Rendered on the job row itself;
   this lives here because the two belong together and drift apart otherwise. */
function _mcWillNeed(item){
  const list = Array.isArray(item && item.willNeed) ? item.willNeed : [];
  if(!list.length) return '';
  return `<span class="mc-willneed" title="${escH(list.map(n=>String(n.needs||'')).join(' · '))}">
    Needs ${list.map(n=>escH(String(n.id||n.needs||''))).join(', ')} before this can run
  </span>`;
}

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

/* ── WHAT THIS JOB ACTUALLY PRODUCES ─────────────────────────────────────────

   The catalogue is the reason anybody pays for Crew, and a card in a grid can
   only say what a job is ABOUT. "Study coach that knows what you keep getting
   wrong" is a nice sentence and it is also what every AI product on the
   internet says about itself. Nobody buys a subscription off a sentence.

   So a card opens, and shows three things a sentence cannot:

   - A specimen of what lands in front of them. Labelled as a specimen, in so
     many words, because the one thing worse than a vague promise is a made-up
     result that reads like theirs.
   - The EXACT instruction the unattended runner is given. Nothing else in this
     product is as convincing as showing the machinery, and it costs nothing to
     show: it is not a secret, it is the thing they are buying.
   - Where it runs and what it needs, honestly - including "this one needs your
     mailbox and cannot run with AMV closed", which loses a sale occasionally
     and prevents every refund that starts with "it never did anything".

   A free visitor gets all of it. They are the person deciding whether this is
   worth money, and showing them a paywall instead of the product is how you
   lose somebody who would have paid. */
/* The same card, for somebody who has not paid: it opens, it shows everything,
   and where the switch would be it says what unlocks it. A dead toggle that
   silently does nothing would teach them the product is broken, which is a
   worse outcome than not selling to them. */
function _cwLockedCard(j){
  return `<div class="cw-job locked">
    <div class="cw-job-ic" aria-hidden="true">${j.icon}</div>
    <button class="cw-job-body" data-dact="cwPeek" data-darg="${j.id}"
            aria-label="See what ${escH(j.title)} does">
      <span class="cw-job-t">${escH(j.title)}</span>
      <span class="cw-job-d">${escH(j.desc)}</span>
      <span class="cw-job-need">Uses: ${escH(j.needs)}
        <span class="cw-job-where ${_cwWhereState(j)}">${escH(_cwWhereLabel(j))}</span>
      </span>
      <span class="cw-job-see">${Array.isArray(j.sample)&&j.sample.length?'See an example →':'See what it does →'}</span>
    </button>
  </div>`;
}

function cwPeek(id){
  const j = (_cwJobs()||[]).find(x=>x.id===id); if(!j) return;
  const r = $('ovr'); if(!r) return;
  const miss = _cwNeedsMissing(j);
  const bg = _cwRunsUnattended(j);
  const allowed = _planAllowsCrew();
  const every = j.every ? (_CREW_EVERY_UI[j.every] || j.every) : 'every day';
  const P = (typeof PLANS!=='undefined' && PLANS[CREW_REQUIRED_PLAN]) || { name:'Pro', price:15 };

  r.innerHTML = `<div class="ov" id="cwp-bg"><div class="cwp" role="dialog" aria-modal="true" aria-labelledby="cwp-t">
    <button class="cwp-x" id="cwp-close" aria-label="Close">✕</button>
    <div class="cwp-head">
      <span class="cwp-ic" aria-hidden="true">${j.icon||'✨'}</span>
      <div>
        <h2 class="cwp-t" id="cwp-t">${escH(j.title)}</h2>
        <div class="cwp-meta">
          <span class="cwp-pill">Runs ${escH(every)}</span>
          <span class="cwp-pill ${bg?'bg':'open'}">${bg?'Runs with AMV closed':'Runs while AMV is open'}</span>
          ${j.needs?`<span class="cwp-pill quiet">Uses ${escH(j.needs)}</span>`:''}
        </div>
      </div>
    </div>
    <p class="cwp-desc">${escH(j.desc)}</p>

    ${Array.isArray(j.sample)&&j.sample.length?`<div class="cwp-sec">
      <div class="cwp-sec-h">What you get</div>
      <div class="cwp-sample" aria-label="Example of what this job produces">
        ${j.sample.map(l=>`<div class="cwp-line">${escH(l)}</div>`).join('')}
      </div>
      <div class="cwp-note">An example of the shape and the level of detail. Your version is built from your own information, so the specifics will be yours, not these.</div>
    </div>`:''}

    ${j.prompt?`<div class="cwp-sec">
      <div class="cwp-sec-h">The exact instruction AMV follows</div>
      <pre class="cwp-prompt">${escH(j.prompt)}</pre>
      <div class="cwp-note">This is the real instruction, not a summary of it. You can change it after you turn the job on.</div>
    </div>`:''}

    ${j.asks&&j.asks.q?`<div class="cwp-sec">
      <div class="cwp-sec-h">It will ask you for</div>
      <div class="cwp-asks"><b>${escH(j.asks.q)}</b><span>${escH(j.asks.ph||'')}</span></div>
      <div class="cwp-note">This job works from what you tell it. Without it there is nothing for it to look at, so AMV asks once when you switch it on rather than running on nothing.</div>
    </div>`:''}

    ${miss.length?`<div class="cwp-warn"><b>Not ready yet.</b> This one needs ${escH(miss.join(', '))}, which ${miss.length>1?'are':'is'} not connected. It will not run until ${miss.length>1?'they are':'it is'} - AMV will not pretend otherwise.</div>`:''}
    ${!bg?`<div class="cwp-warn quiet">This job needs things that live in this browser, so it runs while AMV is open rather than on AMV's servers.</div>`:''}

    <div class="cwp-act">
      ${allowed
        ? `<button class="btn bp" id="cwp-go">${j.on?'Turn it off':'Turn it on'}</button>
           <button class="btn bs" id="cwp-cancel">Close</button>`
        : `<div class="cwp-buy">
             <div class="cwp-buy-t">Included with ${escH(P.name)} · $${P.price}/month</div>
             <div class="cwp-buy-s">${escH(P.name)} runs ${CREW_JOBS_BY_PLAN.pro} jobs like this in the background at once. Every one of them is real - this is the instruction it runs and the shape of what it sends back.</div>
             <button class="btn bp" id="cwp-plans">See plans →</button>
             <button class="btn bs" id="cwp-cancel">Close</button>
           </div>`}
    </div>
  </div></div>`;
  r.classList.add('on');

  /* Guarded by target===currentTarget rather than stopPropagation on the panel:
     a panel that stops propagation kills the delegated click handler for every
     button inside it. */
  onBackdrop($('cwp-bg'),closeOvr);
  on($('cwp-close'),'click',closeOvr);
  on($('cwp-cancel'),'click',closeOvr);
  on($('cwp-plans'),'click',()=>{ closeOvr(); setTab('plans'); });
  on($('cwp-go'),'click',()=>{ closeOvr(); try{ cwToggle(j.id); }catch(e){} });
}
try{ window.cwPeek = cwPeek; }catch(e){}

/* A job the SERVER is running, shown with the controls that reach the server.

   Every button here posts to the same /auto/update the chat tools use, so the
   screen and the conversation are two doors onto one job rather than two
   records that drift apart. */
function _mcServerSchedRow(x){
  const every = _CREW_EVERY_UI[String(x.repeat||'')] || 'on a schedule';
  const paused = x.active === false;
  const auto = x.approval === 'auto';
  const when = paused ? 'Paused' : ('Runs ' + every + (x.next ? ' · next ' + _mcWhen(x.next) : ''));
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
        return `<span class="mc-sched-mode ${eff==='auto'?'auto':''}">${escH(say)}</span>`
             + (eff!==own?`<span class="mc-sched-held">held back from “${escH(own)}” by your account setting</span>`:'');
      })()}</div>
    </div>
    <div class="mc-sched-acts">
      <button class="btn mc-mini ghost" data-dact="mcServerJob" data-darg="${escH(x.id)}|${paused?'resume':'pause'}">${paused?'Resume':'Pause'}</button>
      <button class="btn mc-mini ghost" data-dact="mcServerJob" data-darg="${escH(x.id)}|delete">Remove</button>
    </div>
  </div>`;
}
/* Frequencies in the words a person uses, shared with the chat tools. */
const _CREW_EVERY_UI = { '10min':'every 10 minutes', '30min':'every 30 minutes',
                         hourly:'every hour', daily:'every day', weekly:'every week' };
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
async function mcReloadJobs(){
  try{ if(typeof _autoRefresh === 'function') await _autoRefresh(); }catch(e){}
  renderCrewView();
}
try{ window.mcServerJob = mcServerJob; window.mcReloadJobs = mcReloadJobs; }catch(e){}

/* A standing job shown as a row in the unified Scheduled section. */
function _mcAutonSchedRow(j){
  return `<div class="mc-sched-row">
    <div class="mc-sched-b">
      <div class="mc-sched-goal">${escH(j.title)}</div>
      <div class="mc-sched-meta">${escH(j.desc||'Runs in the background')} · Uses: ${escH(j.needs||'-')}</div>
      <div class="mc-sched-mode-row"><span class="mc-sched-mode auto">Autonomous - emails you results automatically</span></div>
    </div>
    <div class="mc-sched-acts"><button class="btn mc-mini ghost" data-dact="cwToggle" data-darg="${j.id}">Turn off</button></div>
  </div>`;
}
/* Run a typed command INLINE on Mission Control - never leaves Crew. Recognizes
   intent, and if a needed app isn't connected it says so right here; once
   connected it actually performs the task on the real account. */
/* Fast, offline-safe check for obviously-missing details before running.
   Returns a list of short questions ([] = good to go). */
function _clarifyHeuristic(goal){
  const g=' '+String(goal||'').toLowerCase().trim()+' ';
  const words=g.trim().split(/\s+/).filter(Boolean);
  const qs=[];
  const hasEmail=/[\w.+-]+@[\w-]+\.[\w.-]+/.test(goal);
  const hasTo=/\bto\s+[a-z0-9@"']/i.test(goal) || /\bme\b|\bmy\b|\bmyself\b/i.test(g);
  const sendy=/\b(send|email|e-mail|message|text|dm|reply|respond|reach out|notify)\b/.test(g);
  const posty=/\b(post|publish|tweet|share|upload)\b/.test(g);
  const platform=/\b(twitter|\bx\b|linkedin|instagram|insta|facebook|fb|slack|youtube|tiktok|reddit|blog|website|discord)\b/.test(g);
  if(sendy && !hasEmail && !hasTo) qs.push('Who should this go to - a name or email address?');
  if(posty && !platform) qs.push('Where should this be posted (for example LinkedIn, X, or Instagram)?');
  if(words.length<4 && !sendy && !posty) qs.push('Can you add a little more detail about what you want AMV to produce?');
  return qs;
}
/* Scan a goal and decide whether AMV has enough to proceed. Uses the heuristic
   always, and the real model when the engine is connected - so it behaves like
   an assistant that asks before guessing. Returns {ok, questions}. */
async function _clarifyCheck(goal){
  let qs=_clarifyHeuristic(goal);
  if(!qs.length && typeof _aiBackendReady==='function' && _aiBackendReady()){
    try{
      const sys='You decide whether an autonomous task has enough detail to do it WELL without guessing at things the user would care about (who it goes to, exact content, destination, timing). Reply with ONLY JSON: {"ready":true} to proceed, or {"ready":false,"questions":["..."]} with at most 2 short, specific questions. Do not ask about things you can reasonably decide yourself.';
      const raw=await aiComplete('TASK: '+goal, sys, {max_tokens:220, json:true});
      const j=JSON.parse(String(raw).replace(/```json|```/g,'').trim());
      if(j && j.ready===false && Array.isArray(j.questions) && j.questions.length) qs=j.questions.slice(0,2).map(q=>String(q).slice(0,160));
    }catch(e){}
  }
  return { ok: qs.length===0, questions: qs };
}
/* Turn a recurring command into a running job, asking how it should run. */
/* Register a scheduled job on the SERVER, which is the only thing that makes it
   run while AMV is closed. The local schedule is walked by _runDueAuto in this
   browser, so a job that never reached the server runs only when the app
   happens to be open - which is not what "Running jobs" or "Autonomous" mean.
   It used to be fired and forgotten, and the success message went out either
   way. Returns what actually happened so the caller can say it. */
/* The interval the SERVER understands. Its scheduler works in repeat buckets,
   not in the client's cadence objects, and anything outside the set is refused
   with "invalid repeat interval". A monthly cadence has no server bucket, so it
   is registered weekly rather than not at all - the job still runs unattended,
   and the local schedule keeps the exact day. */
function _mcRepeatFor(payload){
  const cad = (payload.sched && payload.sched.cad) || payload.freq || 'daily';
  const map = { '10min':'10min', '30min':'30min', hourly:'hourly', daily:'daily',
                weekly:'weekly', monthly:'weekly' };
  return map[String(cad).toLowerCase()] || 'daily';
}
async function _mcScheduleServer(payload){
  if(!(window.AMV_API && AMV_API.live && typeof AMV_API._fetch==='function'))
    return { ok:false, code:'needs_service' };
  try{
    /* /auto/create, which is the scheduler the cron actually runs. This used to
       post to /api/schedule/create - a route the worker has never had - so every
       job created from Crew was registered nowhere and ran only while AMV was
       open. Nothing said so, because the call was fired and forgotten.

       There is no reason to build a second scheduler beside this one: it already
       has the plan gating, the monthly budget, the job limit and the pause flag,
       and the cron already walks it. */
    const r = await AMV_API._fetch('/auto/create',{ method:'POST', body:JSON.stringify({
      detail: payload.goal, repeat: _mcRepeatFor(payload),
      kind: payload.kind || 'task', approval: payload.approval === 'auto' ? 'auto' : 'require',
      /* Which catalogue entry this came from, so a most-used list can be built
         from what people actually run rather than from a guess. Counts only,
         nothing that identifies anybody - see crewPopular in the worker.
         Absent when somebody typed the job themselves, which is fine: the
         ranking is of catalogue entries. */
      srcId: payload.srcId || '',
      notify: payload.notify || 'app' }) });
    const d = await r.json().catch(()=>({}));
    if(!r.ok || d.error) return { ok:false, code:d.code||'failed', error:d.error||'' };
    return { ok:true, id:(d.item&&d.item.id)||'' };
  }catch(e){ return { ok:false, code:'failed', error:(e&&e.message)||'' }; }
}
/* One sentence for where a just-created job will actually run. */
function _mcWhereItRuns(res){
  if(res.ok) return '';
  if(res.code === 'needs_service')
    return ' It runs only while AMV is open, because the AMV engine is not connected yet.';
  /* A plan limit is not a failure - it is the answer, and it has somewhere to go. */
  /* job_limit belongs here too: it is what a PAYING account gets at its
     automation cap, and it was falling through to "could NOT be registered". */
  if(res.code === 'plan_required' || res.code === 'plan_limit' || res.code === 'job_limit')
    return ' ' + (res.error || 'Running work in the background is part of a paid plan.') +
           ' For now it runs only while AMV is open.';
  return ' It could NOT be registered to run in the background' + (res.error ? ' (' + res.error + ')' : '')
    + ', so for now it runs only while AMV is open.';
}
try{ window._mcScheduleServer=_mcScheduleServer; window._mcWhereItRuns=_mcWhereItRuns; }catch(e){}

function _mcAskRecurring(box, instruction, when){
  box.innerHTML='<div class="mc-cmd-msg ask">'+
    '<div class="mc-ask-h">This looks like recurring work - '+escH(when.label)+'.</div>'+
    '<div class="mc-ask-sub">Each run creates fresh content. How should AMV handle it?</div>'+
    '<div class="mc-ask-modes">'+
      '<label class="mc-ask-mode"><input type="radio" name="mcmode" value="require" checked><span><b>Ask first</b> - AMV prepares it and drops a draft in Needs your approval each time. Nothing sends until you approve.</span></label>'+
      '<label class="mc-ask-mode"><input type="radio" name="mcmode" value="auto"><span><b>Autonomous</b> - AMV completes and sends it automatically each time. It will not appear in Needs your approval.</span></label>'+
    '</div>'+
    '<div class="mc-cmd-actions"><button class="btn mc-mini bp" id="mc-ask-schedule">Add to Running jobs</button><button class="btn mc-mini ghost" id="mc-ask-cancel">Cancel</button></div>'+
  '</div>';
  on($('mc-ask-cancel'),'click',()=>{ box.innerHTML=''; });
  on($('mc-ask-schedule'),'click',async()=>{
    const mode=(document.querySelector('input[name="mcmode"]:checked')||{}).value||'require';
    const item={id:'a'+Date.now(), goal:instruction, approval:mode, created:Date.now(), lastRun:null};
    if(when.sched){ item.sched=when.sched; item.next=_schedNext(when.sched,Date.now()); }
    else { item.freq=when.freq||'daily'; item.next=_freqNext(item.freq,Date.now()); }
    const list=_loadSched(); list.push(item); _saveSched(list);
    const btn=$('mc-ask-schedule'); if(btn){ btn.disabled=true; btn.textContent='Adding…'; }
    const res = await _mcScheduleServer({ goal:instruction, sched:item.sched, freq:item.freq, approval:mode });
    /* The server's id for this job, kept so a later edit can target it. Without
       it an edit has nothing to name and can only report that it failed. */
    if(res.id){ const l2=_loadSched(); const me=l2.find(x=>x.id===item.id); if(me){ me.autoId=res.id; _saveSched(l2); } }
    toast('Added to Running jobs - '+when.label+(mode==='auto'?' · Autonomous':' · Ask first')+_mcWhereItRuns(res),
          res.ok?'success':'info', res.ok?4200:7000);
    renderCrewView();
  });
}
/* Show clarifying questions in the command bar and re-run once answered. */
function _mcAskDetails(box, instruction, questions){
  box.innerHTML='<div class="mc-cmd-msg ask">'+
    '<div class="mc-ask-h">A couple of quick details so I get this right:</div>'+
    '<ul class="mc-ask-qs">'+questions.map(q=>'<li>'+escH(q)+'</li>').join('')+'</ul>'+
    '<textarea id="mc-ask-input" class="mc-ask-input" rows="2" placeholder="Answer here, then Continue"></textarea>'+
    '<div class="mc-cmd-actions"><button class="btn mc-mini bp" id="mc-ask-go">Continue</button><button class="btn mc-mini ghost" id="mc-ask-skip">Skip, do your best</button></div>'+
  '</div>';
  const go=()=>{ const a=($('mc-ask-input')||{}).value||''; const combined=instruction+(a.trim()?('\n\nDetails: '+a.trim()):''); mcRunCommand(combined,{clarified:true}); };
  on($('mc-ask-go'),'click',go);
  on($('mc-ask-skip'),'click',()=>mcRunCommand(instruction,{clarified:true}));
  setTimeout(()=>{ try{ $('mc-ask-input').focus(); }catch(e){} },30);
}
async function mcRunCommand(instruction, opts){
  opts=opts||{};
  const box=document.getElementById('mc-cmd-result'); if(!box) return;
  instruction=(instruction||'').trim(); if(!instruction){ const i=document.getElementById('mc-cmd-input'); i&&i.focus(); return; }
  // Recurring? Make it a running job and ask how it should run (autonomous vs
  // approval). This comes first: scheduling doesn't need the app connected yet -
  // the job runs when it's due, once the integration is linked.
  if(!opts.clarified && typeof _parseWhen==='function'){
    const when=_parseWhen(instruction);
    if(when && when.kind==='recurring'){ _mcAskRecurring(box, instruction, when); return; }
  }
  // Scan for missing details and ask BEFORE anything else (like a real
  // assistant): understand the request first, then check what it needs.
  if(!opts.clarified){
    box.innerHTML='<div class="mc-cmd-msg run"><span class="rr-dot"></span> Reading your request…</div>';
    const c=await _clarifyCheck(instruction);
    if(!c.ok){ _mcAskDetails(box, instruction, c.questions); return; }
  }
  // UNIVERSAL AGENT: plan this request against every connector that exists
  // right now (not a fixed command list), bind each step to a REAL action, and
  // run it with everything visible. Steps that cannot run say exactly what is
  // missing and resume when it is provided. Falls through to the older path
  // only if the universal core is unavailable.
  if(typeof AMVUniversal!=='undefined' && typeof uniRun==='function'){
    box.innerHTML='<div class="mc-cmd-msg run"><span class="rr-dot"></span> Planning against your connected services…</div><div id="uni-live"></div>';
    try{
      const r=await uniRun(instruction, {autonomous:!!opts.autonomous});
      if(r && !r.blocked) return;
      if(r && r.blocked) return;
    }catch(e){ /* fall through to the legacy path */ }
  }
  const analysis=(typeof analyzeTaskIntent==='function')?analyzeTaskIntent(instruction):{matched:false,ready:false};
  // Needs an integration that isn't connected → explain here, stay in Crew.
  if(analysis.matched && !analysis.ready){
    const msg=(typeof taskRequirementMessage==='function')?taskRequirementMessage(analysis):'This task needs an app that isn’t connected yet.';
    box.innerHTML='<div class="mc-cmd-msg warn"><div>'+escH(msg.replace(/\*\*/g,''))+'</div><div class="mc-cmd-actions"><button class="btn mc-mini" data-dact="_mcGoConnect">Open Connectors</button></div></div>';
    return;
  }
  box.innerHTML='<div class="mc-cmd-msg run"><span class="rr-dot"></span> Working on it…</div>';
  try{
    if(typeof runAgentTask!=='function') throw new Error('agent-unavailable');
    const {steps,results}=await runAgentTask(instruction,{onStep:(s)=>{ const m=box.querySelector('.mc-cmd-msg'); if(m) m.innerHTML='<span class="rr-dot"></span> Running: '+escH(String(s.tool||'').replace(/_/g,' '))+'…'; }});
    let html;
    if(!steps.length){ html='<div>I couldn’t find a safe automatic action for that. Try being more specific, or use <b>Autonomous task</b> below to plan a multi-step job.</div>'; }
    else { html='<div class="mc-cmd-done-h">✓ Done - here’s what I did:</div><ul class="mc-cmd-steps">'+results.map((r,i)=>{ const label=(steps[i]&&steps[i].why)||r.tool; if(r.skipped) return '<li>⏭ Skipped: '+escH(label)+'</li>'; return '<li>'+(r.ok?'✓':'⚠')+' '+escH(label)+(r.ok?'':' - '+escH(r.error||'failed'))+'</li>'; }).join('')+'</ul>'; }
    box.innerHTML='<div class="mc-cmd-msg done">'+html+'</div>';
  }catch(e){
    const m=String(e&&e.message||'');
    if(/No integrations connected/i.test(m) || m==='agent-unavailable'){
      box.innerHTML='<div class="mc-cmd-msg warn"><div>To actually do this, connect an app (Google, Slack, or GitHub) in <b>Settings → Connectors</b>. The moment it’s connected, AMV performs the task for real - right here.</div><div class="mc-cmd-actions"><button class="btn mc-mini" data-dact="_mcGoConnect">Open Connectors</button></div></div>';
    } else {
      box.innerHTML='<div class="mc-cmd-msg warn"><div>'+escH(m||'Could not run that task.')+'</div></div>';
    }
  }
}
window.mcRunCommand=mcRunCommand;
function _mcGoConnect(){ try{ S.settingsPane='integrations'; setTab('settings'); }catch(e){} }
window._mcGoConnect=_mcGoConnect;
function _mcDoneCard(t){
  const snip=t.result?String(t.result).replace(/\s+/g,' ').trim():'';
  return `<div class="mc-card done"><div class="mc-card-top"><span class="mc-card-t">${escH(t.title||'Task')}</span><span class="mc-pill ok">Done</span></div>${snip?`<div class="mc-card-sub">${escH(snip.slice(0,140))}${snip.length>140?'…':''}</div>`:''}</div>`;
}

/* Which plan runs autonomous work, matching what the server enforces. Reading
   the same rule in both places is the point - a gate that only exists in the
   browser is not a gate, and one that only exists on the server is a dead end
   the user hits with no explanation. */
const CREW_REQUIRED_PLAN='pro';
const CREW_JOBS_BY_PLAN={free:0,pro:5,elite:25,ultra:100};
function _planAllowsCrew(){
  const plan=loadStr('amv_plan')||'free';
  const need=PLAN_RANK[CREW_REQUIRED_PLAN]||1;
  if(plan==='team') return true;
  if(plan==='custom') return (typeof _customRank==='function'?_customRank():0)>=need;
  return (PLAN_RANK[plan]||0)>=need;
}
function _crewJobAllowance(){
  const plan=loadStr('amv_plan')||'free';
  if(plan==='team'||plan==='custom') return null;   // depends on seats or price
  return CREW_JOBS_BY_PLAN[plan]||0;
}
try{ window._planAllowsCrew=_planAllowsCrew; }catch(e){}

function renderCrewView(){
  const vc=$('vc'); if(!vc) return;
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
      <span class="eyebrow">Crew \u00b7 Autonomous work</span>
      <h2>AMV working while you are not</h2>
      <p class="vsub">Give it an outcome and it plans the steps, does the work, and brings back something finished -
        every morning, every week, whatever you set. Here is every job it can run. Open any of them to see the
        exact instruction it follows and the shape of what it sends back.</p>
      <p class="vsub cw-open-note">${jobs.length} of them are written out below. They are <b>examples</b>, not the
        menu - Crew runs what you describe, in your own words, so anything you can write down is a job it can take.
        The catalogue is here to show you the shape of one.</p>
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
      ${/* These open a CHAT, not a Crew job, so they work without a plan and
            belong here as much as on the paid screen. */ ''}
      ${_cwErrandsHTML()}
      ${_cwPopularHTML()}
      ${_cwCatChips(jobs)}
      ${_cwJobsBody(jobs, _cwLockedCard)}
    </div></div>`;
    return;
  }
  const jobs=_cwJobs(); const appr=_cwApprovals();
  const jobCard=j=>{
    /* What this job declares it needs, against what is actually connected.
       Switching a job on used to flip a flag and nothing else, so a job needing
       a bank or a mailbox that was never linked sat there looking active and
       quietly did nothing forever. The card says which it is. */
    const miss=_cwNeedsMissing(j);
    const note=miss.length
      ? `<div class="cw-job-miss">${j.on?'Cannot run yet':'Needs'}: ${escH(miss.join(', '))} not connected. <button class="cw-job-fix" data-dact="cwConnect">Connect</button></div>`
      : '';
    /* The body is a real button, so the card opens with a keyboard and reads
       as something you can press. It was a div: the only interactive thing on
       a card was the toggle, which meant the only way to find out what a job
       did was to switch it on. */
    return `<div class="cw-job ${j.on?'on':''}${miss.length?' blocked':''}">
      <div class="cw-job-ic" aria-hidden="true">${j.icon}</div>
      <button class="cw-job-body" data-dact="cwPeek" data-darg="${j.id}"
              aria-label="See what ${escH(j.title)} does">
        <span class="cw-job-t">${escH(j.title)}</span>
        <span class="cw-job-d">${escH(j.desc)}</span>
        <span class="cw-job-need">Uses: ${escH(j.needs)}
          <span class="cw-job-where ${_cwWhereState(j)}">${escH(_cwWhereLabel(j))}</span>
        </span>
        <span class="cw-job-see">${Array.isArray(j.sample)&&j.sample.length?'See an example →':'See what it does →'}</span>
      </button>
      ${note}
      <button class="cw-toggle ${j.on?'on':''}" data-dact="cwToggle" data-darg="${j.id}" aria-label="Turn ${escH(j.title)} ${j.on?'off':'on'}"><span class="cw-knob"></span></button>
    </div>`;
  };
  const apprCard=a=>{
    const act=_apvAction(a);
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
        <span class="apv-ic">${a.icon||'\u2709\uFE0F'}</span>
        <div class="apv-card-hd">
          <div class="apv-title">${escH(a.title)}</div>
          <div class="apv-req">${escH(a.requesting||act.line)}</div>
        </div>
        <span class="apv-status ${a.autoApprove?'auto':'wait'}">${a.autoApprove?'Auto-approve on':'Needs approval'}</span>
      </div>
      ${a.fromJob?`<div class="apv-fromjob">↻ From your running job${a.jobSchedule?` · ${escH(a.jobSchedule)}`:''}. It keeps running - you'll get a new one to review each time. The job stays in <b>Running jobs</b>.</div>`:''}
      ${meta.length?`<div class="apv-meta">${meta.map(m=>`<span class="apv-mi"><span class="apv-mk">${escH(m[0])}</span>${escH(m[1])}</span>`).join('')}</div>`:''}
      ${a.warning?`<div class="apv-warn">${escH(a.warning)}</div>`:''}
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
    try{ if(typeof _autoRefresh === 'function') _autoRefresh().then(()=>{ if(S.tab==='crew') renderCrewView(); }); }catch(e){}
    /* And what is connected, because that decides whether a job needing a
       mailbox says "runs with AMV closed" or "connect the account to run it
       closed". Without this the screen answers that question from an empty
       list and always gives the pessimistic answer. */
    try{ if(typeof _connLoad === 'function') _connLoad(false).then(()=>{ if(S.tab==='crew') renderCrewView(); }); }catch(e){}
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
        <input id="mc-cmd-input" class="mc-cmd-input" type="text" placeholder="e.g. “email me a summary of my unread emails” or “research the top AI news and write a brief”" autocomplete="off">
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
        return `<div class="mc-empty-row">No running jobs yet. Start a task above and choose how often it should repeat - it will show up here. You can also just tell AMV in chat: "every morning, summarise my unread email".</div>`;
      })()}
    </section>

    ${_mcActivityHTML()}

    ${st.done.length?`<section id="mc-done" class="mc-sec">
      <div class="sec-head"><h3>Recently completed</h3></div>
      <div class="mc-grid">${st.done.slice(-6).reverse().map(_mcDoneCard).join('')}</div>
    </section>`:''}

    <div class="crew-jobs-sec mc-start">
      <div class="sec-head"><h3>Start new work</h3><span class="sec-sub">Turn on a standing job - AMV runs it automatically and emails you results.</span></div>
      <div class="cw-anything">These are starting points, not the limit. Type <b>anything</b> in the box above and AMV works out which accounts, sites and tools it needs and does it - on a schedule if you ask. If something it needs is not connected yet, it tells you exactly what to add.</div>
      ${_cwErrandsHTML()}
      ${_cwPopularHTML()}
      ${_cwCatChips(jobs)}
      ${_cwJobsBody(jobs, jobCard)}
    </div>

    <div class="crew-split-even">
      <section class="crew-do">
        <div class="sec-head"><h3>Run something now</h3><span class="sec-sub">AMV opens a workspace, asks what it needs, and actually does it.</span></div>
        <div class="cw-quick">
          ${[['\uD83D\uDDFA\uFE0F','Plan a trip','trip','openTripPlanner()'],
             ['\uD83D\uDCE7','Check Gmail','gmail','crewRun(\'gmail\',\'Check Gmail\')'],
             ['\uD83D\uDCC5','Plan my week','week','crewRun(\'week\',\'Plan my week\')'],
             ['\u2728','Autonomous task','auto','openCowork()']]
            .map(q=>`<button class="cw-quick-card" data-dact="_cwQuick" data-darg="${escH(q[2])}"><span class="cw-quick-ic" aria-hidden="true">${q[0]}</span><span>${escH(q[1])}</span></button>`).join('')}
        </div>
        <div id="crew-live" class="crew-live">${_crewResultsHTML()}</div>
      </section>
      <section>
        <div class="sec-head"><h3>Recurring work</h3><span class="sec-sub">Pick one to set it on a schedule - or describe your own. Many can run at once.</span></div>
        <div class="tpl-grid">
          ${[
            ['\uD83C\uDFAC','YouTube video','Produce a complete, production-ready YouTube video package about this week\'s stock market: a punchy title, a 0-3s hook, a full word-for-word voiceover script with timestamps, a scene-by-scene shot list, B-roll suggestions, on-screen text, an SEO description, 15 tags, and a thumbnail concept. I review before publishing.'],
            ['\uD83D\uDCF8','Instagram post','Produce a ready-to-post Instagram package about the latest in my field: a scroll-stopping caption with line breaks, 20-30 ranked hashtags, a carousel outline, a detailed image/visual concept, and the best post time. I approve before posting.'],
            ['\uD83D\uDC26','Social posts','Write 3 ready-to-publish posts for X and 2 for LinkedIn on what\'s trending in my industry today - each with the full copy, hooks, and hashtags. I approve before anything is published.'],
            ['\uD83D\uDCC8','Market brief','Every morning, produce a tight briefing of overnight market moves: major indices, notable movers, and the 3 headlines that matter to me, each with a one-line why-it-matters.'],
            ['\uD83D\uDCB0','Investing check-in','Each Monday, review my watchlist, give a clear buy/hold view with reasoning, and prepare a $1 XRP buy order on Robinhood. Present the exact order for my one-tap approval before placing it.'],
            ['\uD83C\uDFE6','Bank check-in','Every morning, check my linked bank account and report the balance, recent transactions, anything unusual, and my spend-vs-last-week. Prepare it as a clean daily report.'],
            ['\uD83D\uDCF0','News digest','Daily, gather the top developments in AI and produce a sharp 5-bullet briefing, each bullet with a link-worthy summary and why it matters.'],
            ['\u2709\uFE0F','Inbox triage','Each morning, read new emails, rank them by urgency with reasons, and draft a ready-to-send reply for each. I click send before anything goes out.']
          ].map(t=>`<button class="tpl-card" data-dact="openCoworkWith" data-darg="${escH(t[2])}"><span class="tpl-ic" aria-hidden="true">${t[0]}</span><span class="tpl-t">${escH(t[1])}</span></button>`).join('')}
        </div>
      </section>
    </div>
    ${_mcBoughtCrewsHTML()}
  </div></div>`;
  try{ vc.querySelectorAll('[data-mcjump]').forEach(function(b){ on(b,'click',function(){ var el=document.getElementById(b.dataset.mcjump); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); }); }); }catch(e){}
  // Command bar: type any goal → the real agent recognizes intent and does it.
  try{
    var _mcRun=function(){ var el=$('mc-cmd-input'); var v=el?el.value.trim():''; if(!v){ el&&el.focus(); return; } mcRunCommand(v); };
    on($('mc-cmd-go'),'click',_mcRun);
    var _ci=$('mc-cmd-input'); if(_ci) on(_ci,'keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); _mcRun(); } });
    vc.querySelectorAll('[data-mccmd]').forEach(function(c){ on(c,'click',function(){ var el=$('mc-cmd-input'); if(el){ el.value=c.dataset.mccmd; el.focus(); } }); });
  }catch(e){}
}
function cwToggle(id){
  const jobs=_cwJobs(); const j=jobs.find(x=>x.id===id); if(!j) return;
  // Job Hunt needs a profile before it can do anything - open setup on first
  // enable if the required details are missing, instead of silently turning on.
  if(id==='job_hunt' && !j.on && typeof AMVJobs!=='undefined' && AMVJobs.missingInfo({}, AMVJobs.cfg()).length){
    if(typeof openJobHunt==='function'){ openJobHunt(); return; }
  }
  /* The header says "X of N background jobs in use" and the plans page sells N.
     Nothing enforced it, so all seventy could be switched on under a plan that
     runs five - and the spend ceiling, not the plan, would have decided which
     ones actually ran. Refuse at the point of the promise, naming the number. */
  if(!j.on){
    const allow=_crewJobAllowance();
    /* Jobs still being created count too. Setting one up is a round trip, and
       without counting the ones in flight a fast hand switches on six while all
       six still read the same "none are on yet". */
    const used=jobs.filter(x=>x.on).length + _cwPending.size;
    if(allow && used>=allow){
      toast('Your plan runs '+allow+' background job'+(allow===1?'':'s')+' at once. Turn one off, or upgrade to run more.','info',7000);
      return;
    }
  }
  /* A job that CAN run unattended now creates real scheduled work on the server
     rather than setting a boolean. Switching one on used to write a flag into a
     record nothing in the cron has ever read, so every standing job on this
     screen was a switch attached to nothing. */
  if(_cwUnattendedReady(j)) return _cwToggleReal(jobs, j);

  /* Everything else needs this tab, because the mailbox and calendar tokens
     live here and the server never sees them. So it goes on the LOCAL schedule,
     which really does run these while AMV is open. Without this the switch was
     decorative for the other fifty jobs too - a card reading "runs while AMV is
     open" while nothing anywhere was scheduled. */
  _cwSyncLocalSched(j, !j.on);

  j.on=!j.on; _cwSaveJobs(jobs);
  // keep the engine's own on-flag in sync so AMVJobs.run() reflects the toggle
  if(id==='job_hunt' && typeof AMVJobs!=='undefined'){ try{ const c=AMVJobs.cfg(); c.on=j.on; AMVJobs.save(c); }catch(e){} }
  /* Swallowed on purpose, and only here: the schedule this switch really drives
     is the local one, already written above. `/api/jobs` is the copy your OTHER
     devices read, so a refusal means they show a stale switch - worth recording,
     not worth talking over the message below. */
  if(window.AMV_API && AMV_API.live){ AMV_API.toggleJob(id,j.on).catch(e=>_jobSyncFailed(j,e)); }
  /* Turning it on is kept - the intent is real and it starts the moment the
     account is linked. What is not kept is the impression that it is running.
     A job that needs a mailbox nobody connected will produce nothing, and being
     told that now beats discovering it from an empty inbox in a fortnight. */
  const miss=j.on?_cwNeedsMissing(j):[];
  if(miss.length){
    toast('Saved, but "'+j.title+'" cannot run until you connect '+miss.join(' and ')+'.','info',7000);
  } else if(j.on){
    toast('On: '+j.title+' - it runs while AMV is open.','info',5000);
  } else {
    toast('Off: '+j.title,'info');
  }
  renderCrewView();
}

/* A switch that moved here but not on the server. Recorded rather than shown,
   because on this device the job really is in the state the card says - it is
   the other devices that will be wrong until the next sync. An empty catch made
   that indistinguishable from a clean save. */
function _jobSyncFailed(j, e){
  try{ AEGIS.log('job_toggle_unsynced',{ id:(j&&j.id)||'', on:!!(j&&j.on),
       why:String((e&&e.message)||'').slice(0,120) }); }catch(_){}
}

/* A job needing this tab's accounts, put on (or taken off) the local schedule
   that `_runDueAuto` actually walks. Ask-first by default: these reach a real
   mailbox, and work that touches somebody's contacts should be seen before it
   goes anywhere. */
function _cwSyncLocalSched(j, turningOn){
  try{
    if(typeof _loadSched!=='function' || typeof _saveSched!=='function') return;
    const key='cw_'+j.id;
    let list=_loadSched().filter(t=>t.id!==key);
    if(turningOn){
      const freq=j.every||'daily';
      list.push({ id:key, goal:(j.prompt||j.desc||j.title), freq,
                  next:(typeof _freqNext==='function'?_freqNext(freq,Date.now()):Date.now()+864e5),
                  created:Date.now(), lastRun:null, localOnly:true, approval:'require',
                  fromCrewJob:j.id });
    }
    _saveSched(list);
  }catch(e){}
}

/* Turning a background job on and off for real. The switch only moves once the
   server has agreed, so a failure leaves the screen showing what is actually
   true rather than an on-looking card with nothing behind it. */
/* WHAT A JOB NEEDS, IN THE WORDS THE SERVER USES.

   `needs` is written for a person to read on a card ("Email, Web research").
   The runner needs a capability key it can check a grant against. Mapping them
   here keeps the cards in plain English and the wire precise, rather than
   making one of the two worse to save a lookup.

   Web research is absent on purpose: it needs no account, and listing it would
   make every job on the screen look like it wants a connection. */
const _CW_NEEDS_TO_USES = {
  'Email': 'mail.read',
  'Calendar': 'calendar.read',
  /* THE SCHOOL JOB DECLARED A NEED NOTHING COULD MAP.

     school_auto says needs:'Classroom' and its instruction is written around
     real coursework, but this table had no row for it - so _cwUsesFor returned
     an empty list, the job never asked for school.read, and the server never
     fetched anything. The job would switch on, run every morning, and plan a
     week from nothing while its own prompt told the model to name any class it
     could not read.

     A `needs` string with no row here is not a smaller job, it is a job whose
     whole input is missing, and nothing said so at any layer. */
  'Classroom': 'school.read',
};
function _cwUsesFor(j){
  return String((j && j.needs) || '').split(',').map(x => x.trim())
    .map(n => _CW_NEEDS_TO_USES[n]).filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
}

/* IS THERE A LIVE CONNECTION THAT WOULD LET THIS RUN UNATTENDED?

   Read from the connections the server reported, not from a local flag. An
   `unattended` connection is one the provider gave a long-lived token for; a
   `broken` one is a grant that has been revoked at the provider and would fail
   on the next run, which is worse than not having it, because the card would
   promise background work that silently produces nothing. */
function _cwConnHas(cap){
  try{
    const d = (typeof _connState !== 'undefined' && _connState) ? _connState.data : null;
    if(!d || !Array.isArray(d.items)) return false;
    return d.items.some(it => it && it.unattended && !it.broken
      && Array.isArray(it.scopes) && it.scopes.indexOf(cap) >= 0);
  }catch(e){ return false; }
}

/* WHERE THIS JOB CAN ACTUALLY RUN, NOW THAT THE SERVER CAN HOLD AN ACCOUNT.

   _cwRunsUnattended answers the old question: does this need nothing but web
   research. That was the whole story while provider tokens lived in the browser
   and the server had no way to reach a mailbox.

   It is no longer the whole story, and leaving it as the only test would have
   made everything above inert: a job needing Email would still have gone to the
   local schedule, so `uses` would never have reached the server and the runner
   would never have opened the mailbox it can now open. Correct at both ends and
   not joined in the middle - the same failure, one level further down.

   A need AMV has no capability for at all (a bank link) still runs foreground,
   because nothing here can change that. */
function _cwUnattendedReady(j){
  if(_cwRunsUnattended(j)) return true;
  const needs = String((j && j.needs) || '').split(',').map(x => x.trim()).filter(Boolean);
  const mappable = needs.every(n => n === 'Web research' || _CW_NEEDS_TO_USES[n]);
  if(!mappable) return false;
  const uses = _cwUsesFor(j);
  return uses.length > 0 && uses.every(_cwConnHas);
}

async function _cwToggleReal(jobs, j){
  const turningOn=!j.on;
  if(turningOn){
    if(typeof _scheduleTask!=='function'){ toast('Connect the AMV engine in Settings so jobs can run in the background.','error',6000); return; }
    if(_cwPending.has(j.id)) return;         // already being set up

    /* ASK FOR WHAT THE JOB ACTUALLY NEEDS, BEFORE IT RUNS ON NOTHING.

       A quarter of the catalogue tells the runner to work from something the
       person supposedly said - their watch list, their deadlines, their route
       and dates. The unattended runner receives exactly two things: the rules,
       and this job's own text. It has never had access to a list, a profile or
       a memory. So those jobs ran every morning against nothing and could only
       apologise or invent, and inventing is worse.

       That is the same failure this whole session has been about: a feature
       that is fully working from every angle except the one that matters. The
       answer goes into the job's detail, which IS what the runner is given, so
       what the person types is what the model reads.

       Cancelling means no job. A job created with the question skipped is
       precisely the broken one. */
    let extra = '';
    if(j.asks && j.asks.q){
      /* Said BEFORE they type it, not after. Refusing a pasted password is
         correct and is still a worse moment than never inviting one. */
      const said = await showTextPromptAsync(
        j.asks.q + '\n\n' + (j.asks.ph||'') +
        '\n\nDo not put passwords, card numbers or security codes here. AMV does not store them, '+
        'and this is kept on the server and read on every run. Connect an account in Integrations instead.',
        j.answer || '');
      if(said === null) return;                 // they backed out; nothing is created
      extra = String(said||'').trim();
      /* Before j.answer is written, not after. _scheduleTask refuses this too,
         but it refuses further down the line - and the line between here and
         there runs through localStorage. Saving a password to the device and
         then declining to send it is not a refusal, it is a second copy. */
      if(typeof refuseSecrets === 'function' && !refuseSecrets(extra, 'crew_ask')) return;
      if(!extra){
        toast('"'+j.title+'" needs that to work - without it, it would run every day on nothing. Nothing was set up.','info',7000);
        return;
      }
      j.answer = extra.slice(0, 1500);
    }

    toast('Setting up "'+j.title+'"…','info',2500);
    let item=null;
    _cwPending.add(j.id);
    try{
      const detail = (j.prompt||j.desc||j.title)
        + (extra ? '\n\nWhat the user has told you, which is the only information you have about them - use it and do not invent anything beyond it:\n' + j.answer : '');
      item=await _scheduleTask({ detail, repeat:(j.every||'daily'),
                                 kind:'research', notify:'app', approval:'auto',
                                 /* So the unattended run may open the account
                                    this job says it needs. The server filters
                                    this against its own allow-list and still
                                    checks the connection carries the scope. */
                                 uses: _cwUsesFor(j),
                                 /* Which catalogue job this is, so the most-used
                                    list is built from what people actually turn
                                    on rather than from a guess. */
                                 srcId: j.id });
    }catch(e){ item=null; }
    finally{ _cwPending.delete(j.id); }
    /* _scheduleTask reports the reason itself - a plan limit sends them to the
       plans page. Adding a second message here would just talk over it. */
    if(!item) return;
    j.on=true; j.autoId=item.id;
  } else {
    if(j.autoId && typeof _autoAction==='function'){
      const done=await _autoAction(j.autoId,'delete');
      /* Still scheduled on the server, so the switch must stay on. */
      if(!done){ toast('Could not stop "'+j.title+'" - it is still running.','error',6000); return; }
    }
    j.on=false; j.autoId=null;
  }
  _cwSaveJobs(jobs);
  /* Same as above: the real work was already created or deleted on the server
     by _scheduleTask / _autoAction, and refused to move the switch if that
     failed. This call only mirrors the flag across devices. */
  if(window.AMV_API && AMV_API.live){ AMV_API.toggleJob(j.id,j.on).catch(e=>_jobSyncFailed(j,e)); }
  toast(j.on?('On: '+j.title+' - it runs even with AMV closed. Results land in Tasks.')
            :('Off: '+j.title),'info',j.on?6000:3000);
  try{ if(typeof _autoRefresh==='function') _autoRefresh(); }catch(e){}
  renderCrewView();
}
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
/* cwApprove used to live here. It removed the item from the local list and
   toasted "Approved - sent" without calling the server at all - cwReject
   beside it does call AMV_API.actApproval - so had anything wired it, it would
   have told somebody their draft went out when nothing had been sent. It was
   superseded by apvApprove in the approval panel below and referenced by
   nothing, which made the lie dormant rather than harmless. One approval path,
   and it is the one that talks to the server. */
function cwReject(id){
  const all=_cwApprovals(); const removed=all.find(x=>x.id===id); const idx=all.findIndex(x=>x.id===id);
  if(window.AMV_API && AMV_API.live){ AMV_API.actApproval(id,'reject').catch(()=>{}); }
  _cwSaveApprovals(all.filter(x=>x.id!==id)); renderCrewView();
  if(removed){ toastAction('Removed - it won’t be sent.','Return',()=>{ const list=_cwApprovals(); if(!list.some(x=>x.id===removed.id)){ list.splice(Math.min(idx,list.length),0,removed); _cwSaveApprovals(list); if(window.AMV_API && AMV_API.live){ AMV_API.actApproval(id,'restore').catch(()=>{}); } toast('Brought back','success'); renderCrewView(); } }); }
  else toast('Removed','info');
}

window.cwToggle=cwToggle;window.cwDemo=cwDemo;window.cwReject=cwReject;


/* ============================================================
   APPROVAL + PREVIEW WORKSPACE  (Phase 1 of the Mission Control redesign)
   ------------------------------------------------------------
   Task -> Plan -> Agent execution -> PREVIEW -> APPROVAL -> Final action.
   AMV stops before any consequential external action unless Auto Approve
   is on. This module renders the "Needs your approval" cards and the full
   Preview workspace: the finished result, what happened while you were away,
   the Crew that did it, artifact handoffs, and a plain-language final-action
   summary with a specific Approve button.

   Everything renders from real data on the approval object and degrades
   honestly: sections with no data are hidden, never fabricated. No token
   cost, model cost, or price is ever shown on an approval or preview.
   ============================================================ */

/* Derive the specific final action from the approval's actionType. */
function _apvAction(a){
  const t=(a.actionType||'').toLowerCase();
  const n=a.recipients, dest=a.destination||'', when=a.scheduledAt||'';
  const map={
    send:    {btn:'Approve & send',     verb:'send',     line:'Approve to send this '+(a.resultType==='email'?'email':'message')+(n!=null?(' to '+n+' recipient'+(n===1?'':'s')):(dest?(' to '+dest):''))+'.'},
    publish: {btn:'Approve & publish',  verb:'publish',  line:'Approve to publish'+(dest?(' to '+dest):' this')+(when?(' on '+when):'')+'.'},
    schedule:{btn:'Approve & schedule', verb:'schedule', line:'Approve to schedule this'+(when?(' for '+when):'')+'.'},
    post:    {btn:'Approve & post',     verb:'post',     line:'Approve to post'+(dest?(' to '+dest):'')+(when?(' - scheduled for '+when):'')+'.'},
    submit:  {btn:'Approve & submit',   verb:'submit',   line:'Approve to submit this'+(dest?(' to '+dest):'')+'.'},
    update:  {btn:'Approve & update',   verb:'update',   line:'Approve to update'+(n!=null?(' '+n+' record'+(n===1?'':'s')):(dest?(' '+dest):' this data'))+'.'},
    deploy:  {btn:'Approve & deploy',   verb:'deploy',   line:'Approve to deploy'+(dest?(' to '+dest):'')+'.'}
  };
  return map[t]||{btn:'Approve', verb:'approve', line:'Approve to complete this action.'};
}

/* Human "x ago" / "in x" for timestamps (accepts ms epoch or a string). */
function _apvAgo(ts){
  if(typeof ts!=='number') return String(ts||'');
  const d=Date.now()-ts, abs=Math.abs(d), fut=d<0;
  const m=Math.round(abs/6e4), h=Math.round(abs/36e5), day=Math.round(abs/864e5);
  let s = m<1?'just now' : m<60?(m+' min') : h<24?(h+' hr') : (day+' day'+(day===1?'':'s'));
  if(s==='just now') return s;
  return fut ? ('in '+s) : (s+' ago');
}

/* ---- the finished result, rendered as close to reality as the data allows ---- */
function _apvFrame(a){
  const r=a.result||{}, type=r.type||a.resultType||'doc';
  const par=txt=>String(txt||'').split(/\n\n+/).map(p=>'<p>'+escH(p).replace(/\n/g,'<br>')+'</p>').join('');
  if(type==='email'){
    return `<div class="pvw-frame email"><div class="pvw-mail">
      <div class="pvw-mail-hd">
        <div class="pvw-mail-row"><span class="pvw-mail-k">From</span><span>${escH(r.from||'you@amv.dev')}</span></div>
        <div class="pvw-mail-row"><span class="pvw-mail-k">To</span><span>${escH(r.to||a.destination||'')}</span></div>
        <div class="pvw-mail-row subj"><span class="pvw-mail-k">Subject</span><span>${escH(r.subject||a.title||'')}</span></div>
      </div>
      <div class="pvw-mail-body">${par(r.body||a.preview)}</div>
    </div></div>`;
  }
  if(type==='social'){
    const plat=(r.platform||'Post');
    return `<div class="pvw-frame social"><div class="pvw-post">
      <div class="pvw-post-hd"><span class="pvw-post-av">${escH((r.handle||'A').replace(/^@/,'')[0]||'A').toUpperCase()}</span>
        <div><div class="pvw-post-name">${escH(r.name||S.user?.name||'You')}</div><div class="pvw-post-h">${escH(r.handle||'')} · ${escH(plat)}</div></div></div>
      <div class="pvw-post-body">${par(r.text||a.preview)}</div>
      ${r.image?`<div class="pvw-post-img" style="background-image:url('${encodeURI(r.image)}')"></div>`:''}
    </div></div>`;
  }
  if(type==='website'){
    const src=r.html?` srcdoc="${escH(r.html)}"`:'';
    const note=r.html?'':`<div class="pvw-web-note">Live preview appears here after the site is generated.</div>`;
    return `<div class="pvw-frame web"><div class="pvw-web-tabs"><button class="pvw-web-tab on" data-apvweb="desk">Desktop</button><button class="pvw-web-tab" data-apvweb="mob">Mobile</button><span class="pvw-web-url">${escH(r.url||a.destination||'')}</span></div>
      <div class="pvw-web-stage desk"><div class="pvw-web-frame">${r.html?`<iframe class="pvw-web-if" title="Website preview" sandbox="allow-scripts"${src}></iframe>`:note}</div></div></div>`;
  }
  if(type==='data'){
    const rows=(r.rows||[]);
    return `<div class="pvw-frame data"><div class="pvw-data-lead">${escH(r.summary||((rows.length||a.recipients||0)+' record'+((rows.length||a.recipients)===1?'':'s')+' will change'))}</div>
      <table class="pvw-data-tbl"><thead><tr><th>Field</th><th>Current</th><th>New</th></tr></thead>
      <tbody>${rows.slice(0,60).map(x=>`<tr><td>${escH(x.field||'')}</td><td class="old">${escH(x.old==null?'-':x.old)}</td><td class="new">${escH(x.new==null?'-':x.new)}</td></tr>`).join('')||`<tr><td colspan="3" class="pvw-empty-cell">Change details appear here.</td></tr>`}</tbody></table></div>`;
  }
  // report / doc / generic
  return `<div class="pvw-frame doc"><div class="pvw-doc">${r.title?`<h1>${escH(r.title)}</h1>`:''}<div class="pvw-doc-body">${par(r.body||a.preview)}</div></div></div>`;
}

/* ---- what happened while you were away: a readable work history ---- */
function _apvTimeline(a){
  const tl=a.timeline||[];
  if(!tl.length){
    const bits=[];
    if(a.startedAt) bits.push('Started '+_apvAgo(a.startedAt));
    if(a.readyAt) bits.push('Ready '+_apvAgo(a.readyAt));
    if(!bits.length) return '';
    return `<div class="pvw-sec"><div class="pvw-sec-h">Activity</div><div class="pvw-tl-min">${escH(bits.join(' · '))}</div></div>`;
  }
  return `<div class="pvw-sec"><div class="pvw-sec-h">What happened while you were away</div>
    <ol class="pvw-tl">${tl.map(e=>`<li class="pvw-tl-ev"><span class="pvw-tl-dot"></span>
      <div class="pvw-tl-b"><div class="pvw-tl-top"><span class="pvw-tl-agent">${escH(e.agent||'AMV')}</span><span class="pvw-tl-t">${escH(e.t||'')}</span></div>
      <div class="pvw-tl-txt">${escH(e.text||'')}</div></div></li>`).join('')}</ol></div>`;
}

/* ---- the Crew: restrained identity (initials + role + status dot) ---- */
function _apvCrew(a){
  const crew=a.crew||[];
  if(!crew.length) return '';
  const ini=n=>String(n||'A').trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
  return `<div class="pvw-sec"><div class="pvw-sec-h">Crew</div>
    <div class="pvw-crew">${crew.map((c,i)=>`<div class="pvw-agent">
      <span class="pvw-agent-mk m${i%5}">${escH(ini(c.name||c.role))}</span>
      <div class="pvw-agent-b"><div class="pvw-agent-role">${escH(c.role||c.name||'Agent')}</div>
        <div class="pvw-agent-resp">${escH(c.resp||'')}</div></div>
      <span class="pvw-agent-st ${c.status==='done'?'done':c.status==='blocked'?'blocked':'active'}">${escH(c.status==='done'?'Done':c.status==='blocked'?'Blocked':c.status||'Working')}</span>
    </div>`).join('')}</div></div>`;
}

/* ---- artifact handoffs: click an artifact to inspect it ---- */
function _apvArtifacts(a){
  const arts=a.artifacts||[];
  if(!arts.length) return '';
  return `<div class="pvw-sec"><div class="pvw-sec-h">Work handed between agents</div>
    <div class="pvw-hand">${arts.map((x,i)=>`<div class="pvw-hand-row">
      <span class="pvw-hand-a">${escH(x.from||'')}</span>
      <button class="pvw-hand-art" data-apvart="${i}" title="Inspect">${escH(x.name||'artifact')}</button>
      <span class="pvw-hand-arrow">→</span><span class="pvw-hand-a">${escH(x.to||'')}</span>
    </div>`).join('')}</div></div>`;
}

/* Skeleton shown while a preview's data / iframe is genuinely loading. */
function _apvSkeleton(){
  return `<div class="pvw-body"><main class="pvw-stage"><div class="pvw-skel-frame">
      <div class="skel skel-l"></div><div class="skel skel-l"></div><div class="skel skel-l w70"></div>
      <div class="skel skel-block"></div><div class="skel skel-l"></div><div class="skel skel-l w80"></div></div></main>
    <aside class="pvw-side"><div class="skel skel-card"></div><div class="skel skel-card"></div></aside></div>`;
}

/* Open the full-page Preview workspace for an approval. */
function apvPreview(id){
  const a=_cwApprovals().find(x=>x.id===id); if(!a){ toast('That item is no longer waiting','info'); return; }
  const r=$('ovr'); if(!r) return;
  const act=_apvAction(a);
  // Shell + skeleton first (real progressive render; iframe results keep the skeleton until load).
  r.innerHTML=`<div class="ov pvw-ov" id="pvw-bg"><div class="pvw" role="dialog" aria-modal="true" aria-label="Preview and approve">
    <header class="pvw-top">
      <button class="pvw-back" data-dact="apvClose" aria-label="Back">← <span>Back</span></button>
      <div class="pvw-top-mid"><span class="pvw-top-ic">${a.icon||'✉️'}</span><span class="pvw-top-t">${escH(a.title)}</span>${a.project?`<span class="pvw-chip">${escH(a.project)}</span>`:''}</div>
      <div class="pvw-top-r">${a.timeline&&a.timeline.length?`<button class="pvw-quiet" data-apvhist="1">View history</button>`:''}<span class="pvw-mode ${a.autoApprove?'auto':'wait'}">${a.autoApprove?'Auto-approve on':'Auto-approve off'}</span></div>
    </header>
    <div id="pvw-mount">${_apvSkeleton()}</div>
    <footer class="pvw-foot">
      <div class="pvw-foot-line"><span class="pvw-foot-ic">●</span>${escH(act.line)}</div>
      <div class="pvw-foot-act">
        <button class="btn pvw-revise" data-dact="apvRevise" data-darg="${a.id}">Ask AMV to revise</button>
        <button class="btn pvw-edit" data-dact="apvEdit" data-darg="${a.id}">Edit</button>
        <button class="btn pvw-reject" data-dact="apvReject" data-darg="${a.id}">Reject</button>
        <button class="btn pvw-approve" data-dact="apvApprove" data-darg="${a.id}">${escH(act.btn)}</button>
      </div>
      <button class="pvw-more" data-apvmore="1" aria-label="More actions">⋯</button>
    </footer>
  </div></div>`;
  onBackdrop($('pvw-bg'),apvClose);
  setTimeout(()=>{ try{ document.querySelector('.pvw-back').focus(); }catch(e){} },30);
  const hist=r.querySelector('[data-apvhist]'); if(hist) on(hist,'click',()=>{ const s=r.querySelector('.pvw-side'); if(s) s.scrollIntoView({behavior:'smooth'}); });
  const more=r.querySelector('[data-apvmore]'); if(more) on(more,'click',()=>r.querySelector('.pvw-foot-act')?.classList.toggle('open'));
  // Progressive render: paint the skeleton, then mount the real content next frame.
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const m=$('pvw-mount'); if(!m) return;
    m.innerHTML=`<div class="pvw-body">
      <main class="pvw-stage">
        <div class="pvw-stage-h"><span>Final result</span><span class="pvw-stage-sub">This is exactly what will ${escH(act.verb)}.</span></div>
        ${_apvFrame(a)}
      </main>
      <aside class="pvw-side">
        <div class="pvw-final">
          <div class="pvw-final-h">Before you approve</div>
          <div class="pvw-final-line">${escH(act.line)}</div>
          ${a.warning?`<div class="pvw-final-warn">${escH(a.warning)}</div>`:''}
          <div class="pvw-final-meta">
            ${a.crewName?`<span class="pvw-fm"><span>Crew</span>${escH(a.crewName)}</span>`:''}
            ${a.destination?`<span class="pvw-fm"><span>Destination</span>${escH(a.destination)}</span>`:''}
            ${a.scheduledAt?`<span class="pvw-fm"><span>When</span>${escH(a.scheduledAt)}</span>`:''}
            ${a.account?`<span class="pvw-fm"><span>Account</span>${escH(a.account)}</span>`:''}
          </div>
        </div>
        ${_apvTimeline(a)}
        ${_apvCrew(a)}
        ${_apvArtifacts(a)}
      </aside>
    </div>`;
    // website preview: reveal iframe only once it has genuinely loaded
    const ifr=m.querySelector('.pvw-web-if');
    if(ifr){ ifr.style.opacity='0'; ifr.addEventListener('load',()=>{ ifr.style.transition='opacity .2s'; ifr.style.opacity='1'; }); }
    m.querySelectorAll('[data-apvweb]').forEach(b=>on(b,'click',()=>{ m.querySelectorAll('[data-apvweb]').forEach(x=>x.classList.remove('on')); b.classList.add('on'); const st=m.querySelector('.pvw-web-stage'); if(st){ st.classList.toggle('mob',b.dataset.apvweb==='mob'); st.classList.toggle('desk',b.dataset.apvweb==='desk'); } }));
    m.querySelectorAll('[data-apvart]').forEach(b=>on(b,'click',()=>{ const art=(a.artifacts||[])[+b.dataset.apvart]; if(art) _apvInspectArtifact(art); }));
  }));
}
function apvClose(){ const x=$('ovr'); if(x) x.innerHTML=''; }
function _apvInspectArtifact(art){
  toast((art.name||'Artifact')+(art.note?(' - '+art.note):': intermediate work handed between agents'),'info',4200);
}
/* Approve straight from a card (no preview) with a confirm on the consequence. */
async function apvQuickApprove(id){
  const a=_cwApprovals().find(x=>x.id===id); if(!a){ renderCrewView(); return; }
  const act=_apvAction(a);
  if(!await showConfirmAsync(act.line)) return;
  await _apvDoApprove(a);
}
async function apvApprove(id){
  const a=_cwApprovals().find(x=>x.id===id); if(!a){ apvClose(); return; }
  apvClose();
  await _apvDoApprove(a);
}
const _APV_PAST={send:'Sent',publish:'Published',schedule:'Scheduled',post:'Posted',submit:'Submitted',update:'Updated',deploy:'Deployed',approve:'Done'};
/* Approving is what actually SENDS the thing. This fired the request, forgot
   it, removed the item from the queue, and said "Sent" - so a failed call meant
   nothing went out, the draft was gone, and the person believed their email had
   been sent. With no engine connected nothing was even attempted, and it still
   said "Sent". An email that was never sent, reported as sent, is the kind of
   mistake somebody loses a client over.

   It now waits, and on failure the approval STAYS in the queue, because the one
   thing worse than not sending is not sending and losing the draft too. */
async function _apvDoApprove(a){
  const act=_apvAction(a);
  const past=_APV_PAST[act.verb]||'Done';
  if(!(window.AMV_API && AMV_API.live)){
    toast('Nothing was '+String(past).toLowerCase()+' - AMV is not connected to a backend, so it has nowhere to send this. '+
          'It is still waiting for you.','error',7000);
    renderCrewView();
    return { ok:false, code:'needs_service' };
  }
  let d;
  try{
    d = await AMV_API.actApproval(a.id,'approve');
  }catch(e){
    toast('That was NOT '+String(past).toLowerCase()+(e&&e.message?' ('+e.message+')':'')+
          '. It is still in your approvals - try again.','error',7000);
    renderCrewView();
    return { ok:false, code:'failed', error:(e&&e.message)||'' };
  }
  _cwSaveApprovals(_cwApprovals().filter(x=>x.id!==a.id));
  /* "Sent" only when the server actually sent it. An item that was approved but
     has no email provider behind it is APPROVED, which is a different word. */
  if(d && d.delivered === false){
    toast('Approved, but not emailed - no email provider is connected to this deployment, so nothing left AMV.','info',7000);
  } else {
    toast(past,'success');
  }
  renderCrewView();
  return { ok:true, delivered: d ? d.delivered : null };
}
function apvReject(id){ apvClose(); cwReject(id); }
/* The body text of an approval, wherever it lives for that result type. */
function _apvBodyField(a){
  const r=a.result||{}; const type=r.type||a.resultType||'doc';
  if(type==='social') return r.text||a.preview||'';
  return r.body||a.preview||'';
}
/* Write an edited body back into the right field for the result type. */
function _apvSetBody(a,val){
  a.result=a.result||{}; const type=a.result.type||a.resultType||'doc';
  if(type==='social') a.result.text=val; else a.result.body=val;
  a.preview=val;
}
/* Full editor: change the message, who it goes to, and when - then save,
   send, or delete. Edits persist to the approval store (and the backend when
   connected), so what you approve is exactly what you edited. */
function apvEdit(id){
  const a=_cwApprovals().find(x=>x.id===id); if(!a){ toast('That item is no longer waiting','info'); return; }
  const r=$('ovr'); if(!r) return;
  const type=(a.result&&a.result.type)||a.resultType||'doc';
  const isEmail=type==='email';
  const to=(a.result&&a.result.to)||a.destination||'';
  const subject=(a.result&&a.result.subject)||a.title||'';
  const body=_apvBodyField(a);
  const when=a.scheduledAt||'';
  const recips=(a.recipients!=null)?a.recipients:'';
  r.innerHTML=`<div class="ov ape-ov" id="ape-bg"><div class="ape" role="dialog" aria-modal="true" aria-label="Edit before sending">
    <header class="ape-top">
      <button class="pvw-back ape-back" data-dact="apvClose" aria-label="Back">← <span>Back</span></button>
      <div class="ape-top-t">Edit before it sends</div>
      <span class="pvw-mode ${a.autoApprove?'auto':'wait'}">${a.autoApprove?'Auto-approve on':'Needs approval'}</span>
    </header>
    <div class="ape-body">
      <label class="ape-f"><span>Title</span><input id="ape-title" type="text" value="${escH(a.title||'')}"></label>
      <label class="ape-f"><span>${isEmail?'To':'To / where it goes'}</span><input id="ape-to" type="text" value="${escH(to)}" placeholder="${isEmail?'who this email goes to':'who or where this goes'}"></label>
      <label class="ape-f"><span>Number of people</span><input id="ape-recips" type="number" min="0" value="${escH(String(recips))}" placeholder="how many recipients"></label>
      ${isEmail?`<label class="ape-f"><span>Subject</span><input id="ape-subject" type="text" value="${escH(subject)}"></label>`:''}
      <label class="ape-f"><span>Message</span><textarea id="ape-body" rows="10">${escH(body)}</textarea></label>
      <label class="ape-f"><span>When to send</span><input id="ape-when" type="text" value="${escH(when)}" placeholder='e.g. “now” or “Tomorrow 9:00 AM”'></label>
    </div>
    <footer class="ape-foot">
      <button class="btn ape-del" data-dact="_apvEditDelete" data-darg="${a.id}">Delete</button>
      <div class="ape-foot-r">
        <button class="btn ape-save" data-dact="_apvEditSave" data-darg="${a.id}">Save changes</button>
        <button class="btn pvw-approve" data-dact="_apvEditSend" data-darg="${a.id}">Save &amp; send</button>
      </div>
    </footer>
  </div></div>`;
  onBackdrop($('ape-bg'),apvClose);
  setTimeout(()=>{ try{ $('ape-title').focus(); }catch(e){} },30);
}
/* Turn a plain-English "when" into a normalized schedule. Understands "now",
   "every hour", "every day at 9", "every morning", "every Monday 9am",
   "weekly", "monthly", or a one-off phrase kept as-is. */
function _parseWhen(raw){
  const s=(raw||'').trim().toLowerCase();
  if(!s || /^(now|asap|immediately|right away)$/.test(s)) return {kind:'now', label:''};
  const hourFrom=(txt)=>{
    const m=txt.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) || txt.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/);
    if(m){ let h=parseInt(m[1],10); const ap=(m[3]||'').toLowerCase(); if(ap==='pm'&&h<12)h+=12; if(ap==='am'&&h===12)h=0; if(h>=0&&h<=23) return h; }
    if(/\bmorning\b/.test(txt)) return 9;
    if(/\b(noon|midday)\b/.test(txt)) return 12;
    if(/\bafternoon\b/.test(txt)) return 15;
    if(/\b(evening|tonight)\b/.test(txt)) return 19;
    if(/\bnight\b/.test(txt)) return 21;
    return 9;
  };
  const DOW={sunday:0,sun:0,monday:1,mon:1,tuesday:2,tue:2,tues:2,wednesday:3,wed:3,thursday:4,thu:4,thurs:4,friday:5,fri:5,saturday:6,sat:6};
  const recurring=/\b(every|each|daily|weekly|hourly|monthly)\b/.test(s);
  if(recurring){
    if(/\bhour/.test(s)) return {kind:'recurring', freq:'hourly', label:'Every hour'};
    let days=[]; for(const k in DOW){ if(new RegExp('\\b'+k+'\\b').test(s)) days.push(DOW[k]); }
    days=[...new Set(days)];
    const hour=hourFrom(s);
    if(days.length){ const sc={cad:'weekly',days,hour}; return {kind:'recurring', sched:sc, label:_schedHumanOf(sc)}; }
    if(/\bweek/.test(s)){ const sc={cad:'weekly',days:[1],hour}; return {kind:'recurring', sched:sc, label:_schedHumanOf(sc)}; }
    if(/\bmonth/.test(s)){ const sc={cad:'monthly',dom:1,hour}; return {kind:'recurring', sched:sc, label:_schedHumanOf(sc)}; }
    const sc={cad:'daily',hour}; return {kind:'recurring', sched:sc, label:_schedHumanOf(sc)};
  }
  return {kind:'once', label:raw.trim()};
}
/* Read the form back into the approval object and persist it. Returns the
   updated approval (or null if it vanished). */
function _apvCollectEdit(id){
  const list=_cwApprovals(); const a=list.find(x=>x.id===id); if(!a) return null;
  const g=k=>{ const el=$(k); return el?el.value:undefined; };
  const title=g('ape-title'); if(title!=null) a.title=title.trim()||a.title;
  const to=g('ape-to');
  if(to!=null){ a.destination=to.trim(); a.result=a.result||{}; if((a.result.type||a.resultType||'doc')==='email') a.result.to=to.trim(); }
  const rc=g('ape-recips');
  if(rc!=null){ const n=parseInt(rc,10); a.recipients = (rc.trim()==='' || isNaN(n)) ? null : n; }
  const subj=g('ape-subject');
  if(subj!=null){ a.result=a.result||{}; a.result.subject=subj.trim(); }
  const body=g('ape-body'); if(body!=null) _apvSetBody(a,body);
  const when=g('ape-when');
  if(when!=null){
    const p=_parseWhen(when);
    a.scheduledAt = p.label || '';
    a._recur = (p.kind==='recurring') ? (p.sched?{sched:p.sched}:(p.freq?{freq:p.freq}:null)) : null;
    if(p.kind==='recurring') a.actionType='schedule';
    else if(p.kind==='once' && a.scheduledAt) a.actionType=a.actionType||'schedule';
  }
  // Emails always go FROM the signed-in account - never a placeholder.
  if((a.result&&a.result.type)==='email'){ a.result.from=(S.user&&S.user.email)||a.result.from||''; a.account=a.result.from; }
  _cwSaveApprovals(list);
  // Persist the edit to the backend when connected, so the real send uses it.
  if(window.AMV_API && AMV_API.live && typeof AMV_API._fetch==='function'){
    try{ AMV_API._fetch('/api/approvals/edit',{method:'POST',body:JSON.stringify({id:a.id,patch:{title:a.title,destination:a.destination,recipients:a.recipients,scheduledAt:a.scheduledAt,recurrence:a._recur,from:a.account,result:a.result}})}).catch(()=>{}); }catch(e){}
  }
  return a;
}
/* If the edit set a recurring "when", register it as scheduled work so it shows
   in Scheduled and actually recurs (backend when connected). Returns true if it
   became a schedule. */
/* Always returns a result OBJECT, never a bare boolean - three callers read
   this, and one of them was checking it for truthiness. Once it became async a
   bare promise would have been truthy every time, so every caller would have
   claimed the job was scheduled. `code:'none'` means there was nothing
   recurring to register at all. */
async function _apvRegisterRecur(a){
  if(!a._recur) return { ok:false, code:'none' };
  const list=_loadSched();
  const isEmail=(a.result&&a.result.type)==='email';
  const desc=isEmail?('Send email “'+(a.result.subject||a.title||'')+'” to '+(a.destination||a.result.to||'recipients')):('Do: '+(a.title||'task'));
  const item={id:'a'+Date.now(), goal:desc, approval:a.autoApprove?'auto':'require', created:Date.now(), lastRun:null};
  if(a._recur.sched){ item.sched=a._recur.sched; item.next=_schedNext(a._recur.sched,Date.now()); }
  else { item.freq=a._recur.freq||'daily'; item.next=_freqNext(item.freq,Date.now()); }
  list.push(item); _saveSched(list);
  /* Registered on the server, and the caller is told whether that worked -
     a recurring job that only exists in this browser runs when AMV is open and
     not otherwise, which is the opposite of what scheduling one means. */
  const res = await _mcScheduleServer({ goal:desc, sched:item.sched, freq:item.freq, approval:item.approval,
    payload:isEmail?{type:'email',result:a.result,to:a.destination,from:a.account}:null });
  if(res.id){ const l2=_loadSched(); const me=l2.find(x=>x.id===item.id); if(me){ me.autoId=res.id; _saveSched(l2); } }
  return res;
}
async function _apvEditSave(id){
  const a=_apvCollectEdit(id); if(!a){ apvClose(); return; } apvClose();
  if(a._recur){
    const res = await _apvRegisterRecur(a);
    _cwSaveApprovals(_cwApprovals().filter(x=>x.id!==a.id));
    toast('Scheduled - '+(a.scheduledAt||'recurring')+_mcWhereItRuns(res),
          res.ok?'success':'info', res.ok?3500:7000);
  }
  else toast('Changes saved','success');
  if(S.tab==='crew') renderCrewView();
}
async function _apvEditSend(id){
  const a=_apvCollectEdit(id); if(!a){ apvClose(); return; } apvClose();
  if(a._recur){
    const res = await _apvRegisterRecur(a);
    _cwSaveApprovals(_cwApprovals().filter(x=>x.id!==a.id));
    toast('Scheduled - '+(a.scheduledAt||'recurring')+_mcWhereItRuns(res),
          res.ok?'success':'info', res.ok?3500:7000);
    if(S.tab==='crew') renderCrewView();
    return;
  }
  await _apvDoApprove(a);
}
async function _apvEditDelete(id){ if(!await showConfirmAsync('Delete this draft?\n\nIt will not be sent, and it is not kept anywhere.')) return; apvClose(); cwReject(id); }
window._apvEditSave=_apvEditSave; window._apvEditSend=_apvEditSend; window._apvEditDelete=_apvEditDelete;
function apvRevise(id){
  const item=_cwApprovals().find(x=>x.id===id); apvClose();
  setTab('chat');
  setTimeout(()=>{ const ta=$('mta'); if(ta&&item){ ta.value='Revise this before it goes out - tell me what you changed and why:\n\n'+(item.result?.body||item.preview||item.title); ta.dispatchEvent(new Event('input')); ta.focus(); } },140);
}
window.apvPreview=apvPreview; window.apvClose=apvClose; window.apvApprove=apvApprove;
window.apvQuickApprove=apvQuickApprove; window.apvReject=apvReject; window.apvEdit=apvEdit; window.apvRevise=apvRevise;


