/* ============================================================
   AMV CO-WORKER  - autonomous agent: standing jobs + approval inbox
   The differentiator: it watches your connected accounts and proposes
   actions (draft replies, summaries, bookings). You approve or reject
   each one with a click. Nothing is sent without your OK.
   ============================================================ */
function _cwJobs(){ return load('amv_cw_jobs') || _cwDefaultJobs(); }
function _cwSaveJobs(j){ store('amv_cw_jobs', j); }
function _cwDefaultJobs(){ return [
  { id:'job_hunt', cat:'Work & career', icon:'\uD83D\uDCBC', title:'Job hunt - find and prepare applications', needs:'Email, Web research', on:false,
    desc:'AMV finds roles matched to your resume and prepares a tailored application for each one, ready for you to review and send. If a posting asks something you have not specified, it asks you first. Submitting on its own is not switched on - nothing reaches an employer without you.',
    prompt:'Find current job openings matching the roles, locations and salary floor in my Job Hunt profile. For each one: the title, company, location, pay if stated, why it fits me, and the direct link. Then draft a tailored application for the strongest matches, using my resume and stated preferences. Do not submit anything - present each as a finished draft for me to review. If a posting asks for something my profile does not answer, list the question instead of inventing an answer.' },
  { id:'morning_brief', cat:'Watching the world', icon:'\u2600\uFE0F', title:'Morning news & markets brief', desc:'Every morning at 7am, AMV researches overnight news and market movements, then emails you a concise brief on what happened and which stocks to watch today.', needs:'Email, Web research', on:false },
  { id:'inbox_digest', cat:'Inbox & calendar', icon:'\uD83D\uDCEC', title:'Daily inbox digest', desc:'AMV summarizes your important emails each evening and drafts replies for the ones that need them - you just approve and send.', needs:'Email', on:false },
  { id:'competitor_watch', cat:'Growing a business', icon:'\uD83D\uDD0D', title:'Competitor & industry watch', desc:'Weekly, AMV tracks your competitors and industry news, then emails you a summary of anything that matters.', needs:'Email, Web research', on:false },
  { id:'weekly_report', cat:'Inbox & calendar', icon:'\uD83D\uDCCA', title:'Weekly summary report', desc:'Every Friday, AMV compiles your week - tasks done, key metrics, what\u2019s pending - into a clean report and emails it to you or your team.', needs:'Email', on:false },
  { id:'content_calendar', every:'weekly', cat:'Growing a business', icon:'\u270D\uFE0F', title:'Social content drafts', desc:'AMV drafts a week of social posts based on trends in your space and queues them for your approval.', needs:'Web research', on:false },

  /* ---- The standing services below are what make Crew worth paying for:
     they run in the background and create value without you remembering to
     ask. Each carries the concrete instruction the autonomous runner
     executes, and an honest `needs` so it never pretends to run without the
     access it requires. ---- */

  { id:'opportunity_radar', cat:'Work & career', icon:'\uD83C\uDFAF', title:'Opportunity radar', needs:'Email, Web research', on:false,
    desc:'Every morning AMV hunts for things you could actually get - scholarships, grants, internships, jobs, competitions, fellowships, discounts and rebates that match your profile - and emails you only the ones you qualify for, with the deadline and the direct link.',
    prompt:'Search the live web for opportunities matching the user profile and interests: scholarships, grants, internships, jobs, competitions, fellowships, rebates and tax credits. Only include ones open NOW with a future deadline. For each: name, what it gives, eligibility, deadline, direct application link. Exclude anything they clearly do not qualify for. If you find nothing new, say so plainly.' },

  { id:'change_digest', cat:'Watching the world', icon:'\uD83D\uDD14', title:'Did anything change today?', needs:'Web research', on:false,
    desc:'You tell AMV what to watch - a page, a price, a competitor, a policy, a person, a job board - and each morning it checks every one and reports only what actually changed. No change, no noise.',
    prompt:'Check each item on the user watch list against its previous state. Report ONLY genuine changes: what changed, the old value, the new value, and why it might matter. If nothing changed, say "nothing changed" rather than padding the report.' },

  { id:'money_leaks', cat:'Money', icon:'\uD83D\uDCB8', title:'Money leak detector', needs:'Email', on:false,
    desc:'AMV reads your receipts and statements for subscriptions you stopped using, duplicate charges, silent price rises, and avoidable fees - then tells you exactly what to cancel and how much you would save.',
    prompt:'Scan recent receipts, invoices and statement emails. Identify: recurring charges that look unused, duplicate charges, subscription price increases versus previous months, and avoidable fees. For each, give the merchant, the amount, how often, and the annual cost of keeping it. Total the potential saving. Never guess a charge you cannot see evidence for.' },

  { id:'forgot_check', cat:'Inbox & calendar', icon:'\uD83E\uDDE0', title:'What did I forget?', needs:'Email, Calendar', on:false,
    desc:'Each morning AMV re-reads your recent mail and calendar for things you said you would do, questions nobody answered, and commitments with no follow-up - so nothing quietly slips.',
    prompt:'Review recent emails and calendar entries. List: promises the user made that have no follow-up, messages awaiting their reply, questions they asked that were never answered, and commitments with an approaching date. Be specific - quote the sentence and name the person. Only include real, evidenced items.' },

  { id:'renewal_watchdog', cat:'Money', icon:'\uD83D\uDCC4', title:'Contract & renewal watchdog', needs:'Email', on:false,
    desc:'Finds subscriptions, insurance, leases, warranties, domains and memberships heading for renewal, warns you BEFORE the auto-charge, and prepares the cancel-or-renegotiate message.',
    prompt:'Find upcoming renewals, expirations and auto-charges in the user mail: subscriptions, insurance, leases, warranties, domains, memberships, licences. For each: what it is, the renewal date, the amount, and whether it auto-renews. Flag anything renewing within 30 days first. Draft a cancellation or renegotiation email for anything that looks poor value.' },

  { id:'followups', cat:'Inbox & calendar', icon:'\uD83E\uDD1D', title:'Relationship follow-ups', needs:'Email', on:false,
    desc:'Tells you who is waiting on you and who you have gone quiet on - clients, recruiters, mentors, friends - with the context of your last exchange and a ready-to-send message.',
    prompt:'Find people awaiting a reply from the user, and important contacts with no exchange in a while. For each: who, when you last spoke, what it was about, and why now is a good moment. Draft a short, natural follow-up message for each. Never invent a shared history that is not in the thread.' },

  { id:'deal_watch', cat:'Money', icon:'\uD83C\uDFF7\uFE0F', title:'Price & deal watcher', needs:'Web research', on:false,
    desc:'Watches everything on your wish list and tells you when a price is genuinely good by its own history - not just when a site claims a sale.',
    prompt:'Check the current price of each item on the user wish list. Report the current price, the usual price, and whether this is genuinely a good price by historical standards. Explicitly call out fake or marketing-only discounts. Only flag a real drop.' },

  { id:'travel_guardian', cat:'Home & life', icon:'\u2708\uFE0F', title:'Travel guardian', needs:'Email, Calendar, Web research', on:false,
    desc:'From your booking confirmations it tracks flight delays, gate changes, weather at both ends, and check-in windows - and warns you early enough to actually do something.',
    prompt:'From the user booking confirmations, identify upcoming travel. Check flight status, gate and time changes, weather at origin and destination, and check-in windows. Report anything that needs action, with how much time remains to act. State clearly if a booking cannot be verified.' },

  { id:'meeting_prep', cat:'Inbox & calendar', icon:'\uD83D\uDCCB', title:'Meeting prep & follow-up', needs:'Calendar, Email, Web research', on:false,
    desc:'Before each meeting you get a brief on who you are meeting, their company and recent news, and the history of your thread. Afterwards it drafts the follow-up and the action list.',
    prompt:'For each upcoming meeting: who is attending, their role and company, relevant recent news, the history of prior correspondence, open items from last time, and 3 suggested talking points. After a meeting, draft a follow-up email and a task list. Never fabricate a fact about a person - if you cannot verify it, omit it.' },

  { id:'bills_due', cat:'Money', icon:'\uD83E\uDDFE', title:'Bills, payments & paycheck alerts', needs:'Email', on:false,
    desc:'Tells you what is due and when, flags failed payments and low balances early, and confirms when your pay or a refund actually lands.',
    prompt:'From receipts, invoices and bank notification emails, report: bills due in the next 14 days with amounts, any failed or declined payments, refunds that have or have not arrived, and expected income that has landed. Do not state a balance you cannot see evidence for.' },

  { id:'site_monitor', cat:'Watching the world', icon:'\uD83D\uDC41\uFE0F', title:'Website & application watch', needs:'Web research', on:false,
    desc:'Watches pages that matter - application portals, government pages, waitlists, admissions, job boards - and tells you the moment something opens or changes.',
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
    prompt:'Monitor the specified subreddits, forums and communities for the user keywords and topics. Report only genuinely relevant new threads: title, community, why it matters, and the link. Skip low-engagement noise and reposts.' },

  { id:'groceries', cat:'Home & life', icon:'\uD83D\uDED2', title:'Grocery & household restock', needs:'Email', on:false,
    desc:'Learns what you buy and how often, then reminds you before you run out - and builds the list for you, grouped the way a shop is laid out.',
    prompt:'From past orders and receipts, work out what the user buys and how often. Predict what is running low now, build a grouped shopping list, and note anything currently cheaper than usual. Only include items with real purchase history.' },

  { id:'chores', cat:'Home & life', icon:'\uD83E\uDDF9', title:'Chore & routine scheduling', needs:'Calendar', on:false,
    desc:'Keeps the recurring stuff on a sensible rhythm - cleaning, laundry, bins, plants, pets - scheduled around your actual calendar instead of nagging at random.',
    prompt:'Maintain the recurring chore schedule. Each run, report what is due today and this week, fitted around the real calendar so nothing lands during a meeting or while away. Reschedule anything missed rather than repeating the same reminder.' },

  { id:'coupons', cat:'Money', icon:'\uD83C\uDF9F\uFE0F', title:'Coupon & discount finder', needs:'Web research', on:false,
    desc:'Before you buy, AMV hunts for working codes, cashback, student or member discounts - and tells you the real final price rather than the advertised one.',
    prompt:'For the specified purchase or retailer, search for currently valid discount codes, cashback offers, student or membership discounts and price-match options. Report the real final price after each. State clearly if you cannot verify a code is still valid.' },

  { id:'hotel_watch', cat:'Home & life', icon:'\uD83C\uDFE8', title:'Hotel & stay price tracking', needs:'Web research', on:false,
    desc:'Watches the price of the places you actually want to stay for your real dates, and tells you when to book - including when a refundable rate drops so you can rebook cheaper.',
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
    prompt:'Review receipts and invoices since the last run. Identify expenses that are plausibly deductible for the user’s stated situation: work equipment, software, professional subscriptions, mileage, home office, education, charitable giving. For each: date, merchant, amount, and which category it likely falls under. Keep a running annual total. State clearly that this is organisation, not tax advice, and never assert an expense is deductible when the rules depend on facts you do not have.' },

  { id:'rate_watch', every:'weekly', cat:'Money', icon:'🏦', title:'Savings rate & refinance watch', needs:'Web research', on:false,
    desc:'Your savings sit at a rate the bank quietly cut, and your mortgage or loan may now be beatable. AMV tracks both against the live market and tells you the moment moving is worth the paperwork.',
    prompt:'Compare the user’s stated savings rate and loan or mortgage rate against current market rates from real providers. Report: the rate they hold, the best comparable rate available now, the annual difference in money, and whether the switching cost is worth it. Flag it only when the gap is genuinely material. Name the providers and the date the rate was checked.' },

  { id:'insurance_reshop', cat:'Money', icon:'🛡️', title:'Insurance re-shop before renewal', needs:'Email, Web research', on:false,
    desc:'Insurers price-walk loyal customers every year. Before each renewal lands, AMV checks what the same cover costs elsewhere and gives you the number to quote back.',
    prompt:'Find upcoming insurance renewals in the user’s mail with the renewal date and premium. Research the current market price for equivalent cover. Report: the renewal quote, the best comparable price found, the saving, and the date by which they must act. Note any difference in cover so a cheaper price is not mistaken for a like-for-like one.' },

  { id:'salary_bench', every:'weekly', cat:'Work & career', icon:'📈', title:'Salary benchmark & timing', needs:'Web research', on:false,
    desc:'Tells you what your role pays in your market right now, whether you have fallen behind, and when the evidence is strong enough to ask - with the numbers to bring.',
    prompt:'Research current pay for the user’s role, level, industry and location using real posted ranges and published surveys. Report the range, the midpoint, where the user sits against it, and how it has moved since the last check. If they are below market, assemble the specific evidence to use in a conversation. Cite where each figure came from and its date. Never invent a figure.' },

  { id:'recruiter_triage', cat:'Work & career', icon:'🎯', title:'Recruiter inbound triage', needs:'Email, Web research', on:false,
    desc:'Most recruiter mail is noise and one message a year is life-changing. AMV reads every one, researches the company behind it, and surfaces only the ones actually worth a reply - with the reply written.',
    prompt:'Review recruiter and hiring outreach received since the last run. For each: the company, the role, the stated or researched pay range, funding and stability signals, and how well it matches the user’s stated goals. Rank them and recommend which deserve a reply. Draft a short reply for the ones worth answering and a polite decline for the rest. Say plainly when a range is not stated rather than guessing one.' },

  { id:'employer_health', every:'weekly', cat:'Work & career', icon:'🩺', title:'Employer & industry health watch', needs:'Web research', on:false,
    desc:'The signals before a bad quarter are public - hiring freezes, funding news, exec departures, layoff reports, customer losses. AMV watches them for your employer and your industry so you are early rather than surprised.',
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
    prompt:'Check public review and rating sources for the user’s business or product. Report new reviews since the last run: rating, platform, what the reviewer actually said, and whether it needs a response. Identify recurring themes across reviews rather than listing them one by one. Draft a specific, non-generic reply for anything negative or unfair. Report the rating trend honestly, including when it is falling.' },

  { id:'lead_triage', cat:'Growing a business', icon:'📥', title:'Inbound lead triage & first reply', needs:'Email, Web research', on:false,
    desc:'Speed of first reply decides who wins the deal. AMV qualifies every inbound enquiry, researches who is asking, and has the reply written before you have opened the message.',
    prompt:'Review inbound enquiries since the last run. For each: who they are, the company and its size or funding where publicly known, what they are asking for, and how well it fits the user’s stated ideal customer. Rank by likely value. Draft a specific first reply for each that answers their actual question and proposes a clear next step. Do not invent details about a company you could not verify.' },

  { id:'rank_watch', every:'weekly', cat:'Growing a business', icon:'🔎', title:'Search ranking & visibility watch', needs:'Web research', on:false,
    desc:'Tells you when you move up or down for the searches that bring you customers, and who overtook you - so a slow slide gets caught in a week rather than a quarter.',
    prompt:'Check the user’s current search visibility for their specified keywords. Report position changes since the last run, which competitors moved, and what visibly changed on the pages that overtook them. Focus on the keywords that matter commercially rather than vanity terms. State the date and method of the check, and be explicit about the limits of what a single check can show.' },

  { id:'pricing_diff', every:'weekly', cat:'Growing a business', icon:'🏷️', title:'Competitor pricing page diff', needs:'Web research', on:false,
    desc:'A competitor changing price, adding a tier, or quietly removing a limit is the single most useful thing to know in your market - and it is never announced.',
    prompt:'Check each competitor pricing page against its previous state. Report only real changes: price moves, new or removed tiers, changed limits or included features, new trial or discount terms, and altered positioning language. Quote the before and after. If a page could not be read, say which one and why rather than reporting no change.' },

  { id:'ad_waste', cat:'Growing a business', icon:'🔥', title:'Ad spend waste check', needs:'Email', on:false,
    desc:'Campaigns keep spending long after they stop working. AMV reads your own reporting mail and tells you what to switch off and what to move the money to.',
    prompt:'From advertising reports and billing emails, summarise spend and results per campaign since the last run. Identify what is spending without returning, what is improving, and where cost per result has risen. Recommend specific pauses or budget shifts with the money involved. Use only figures present in the reports - never estimate performance.' },

  { id:'regulation_watch', every:'weekly', cat:'Watching the world', icon:'⚖️', title:'Rule & regulation change watch', needs:'Web research', on:false,
    desc:'A rule change in your industry, your visa category, your profession or your tax situation is expensive to learn late. AMV watches the sources that publish them and translates what it means for you.',
    prompt:'Monitor official and regulatory sources relevant to the user’s stated situation and industry for genuine changes: new rules, amendments, consultations, enforcement dates and guidance updates. For each: what changed, the date it takes effect, who it applies to, and the practical implication for the user. Link the official source. Distinguish clearly between a proposal and something in force, and state that this is information, not legal advice.' },

  { id:'breach_watch', cat:'Watching the world', icon:'🔐', title:'Breach & exposure watch', needs:'Web research', on:false,
    desc:'When a service you use is breached, you usually find out from the news months later. AMV watches for reported breaches at the companies you actually have accounts with and tells you exactly what to change.',
    prompt:'Check for newly reported data breaches and security incidents at the services the user has accounts with. For each: the service, the date reported, what data was reportedly exposed, and the specific action to take now such as changing a password or enabling two-factor. Rely only on publicly reported, attributed incidents and say when a report is unconfirmed. Never ask for or handle the user’s passwords.' },

  { id:'tool_advisories', every:'weekly', cat:'Watching the world', icon:'🛠️', title:'Updates & advisories for your tools', needs:'Web research', on:false,
    desc:'Breaking changes, deprecations, price changes and security advisories for the software you depend on - filtered to the versions you actually run.',
    prompt:'Monitor release notes, changelogs, advisories and status pages for the tools and services the user depends on. Report only what affects them: breaking changes, deprecations with deadlines, security advisories, pricing or plan changes, and outages with a pattern. Give the version affected and the action required. Skip routine minor releases with no impact.' },

  { id:'person_watch', cat:'Watching the world', icon:'👤', title:'Follow what someone publishes', needs:'Web research', on:false,
    desc:'Track the public output of the people who move your field - founders, researchers, investors, analysts - so you read the important post the day it lands rather than a month later.',
    prompt:'Monitor the public professional output of the named people: posts, articles, talks, papers, interviews and public announcements. Report only genuinely new items: who, what, why it matters to the user, and the link. Use public professional sources only - never track private activity, location, or personal life, and decline any name where the request is clearly personal rather than professional.' },

  { id:'brand_watch', cat:'Watching the world', icon:'📣', title:'Mentions & impersonation watch', needs:'Web research', on:false,
    desc:'Finds where your name or brand is being discussed, and catches fake accounts, copied sites and lookalike domains trading on it.',
    prompt:'Search for new public mentions of the user’s name, brand or product across the web, news, forums and social platforms. Separate genuine discussion from impersonation: fake profiles, copied content, lookalike domains, misuse of the name. For real mentions, report sentiment and whether a response is warranted. For suspected impersonation, report the evidence and the reporting route for that platform.' },

  { id:'paper_digest', every:'weekly', cat:'Learning', icon:'📚', title:'New research in my field', needs:'Web research', on:false,
    desc:'The handful of genuinely new papers, releases and findings in your field each week, explained in plain language, with why each one matters and whether it is worth your time.',
    prompt:'Find genuinely new publications, preprints and significant releases in the user’s stated field since the last run. For each: the title, who published it, what is actually new about it in plain language, why it matters, and whether it is worth reading in full. Prioritise substance over popularity. If the week was quiet, report the two best things rather than padding the list.' },

  { id:'deadline_radar', cat:'Learning', icon:'📅', title:'Assignment & deadline radar', needs:'Email, Calendar', on:false,
    desc:'Every due date pulled out of syllabi, portals and mail into one honest picture - what is due, how long each will really take, and what to start today to not be up at 3am.',
    prompt:'Collect every upcoming deadline from mail and calendar: assignments, exams, applications, submissions and their weightings where stated. Build a single ordered list with dates. Estimate realistic effort for each, identify what must start now to be finished on time, and flag any week where the load is genuinely not achievable. Only include deadlines you have evidence for.' },

  { id:'study_drill', cat:'Learning', icon:'🧠', title:'Spaced revision on a schedule', needs:'Email', on:false,
    desc:'Sends you the right questions at the right interval on whatever you are learning, harder on the things you keep getting wrong - the method that actually makes things stick.',
    prompt:'Maintain a spaced repetition schedule over the user’s stated study material. Each run, produce the set of questions due now, weighted toward material they have previously answered incorrectly or not seen recently. Include the answers separately so they can self-test first. Track which items are due next and adjust the interval based on reported performance.' },

  { id:'reading_queue', cat:'Learning', icon:'📖', title:'Turn my saved links into a briefing', needs:'Email', on:false,
    desc:'The articles you saved and never read, condensed into one briefing with the actual argument of each - so the reading list stops being a guilt pile.',
    prompt:'Take the user’s saved or emailed links since the last run. For each: the core argument or finding in a few sentences, what is genuinely useful in it, and whether the full piece is worth reading. Group related items and note where two sources disagree. If a link cannot be read, say which one rather than summarising from the title.' },

  { id:'health_admin', cat:'Health', icon:'🩺', title:'Prescriptions, appointments and screenings', needs:'Email, Calendar', on:false,
    desc:'Refills before you run out, appointments you meant to book, and the routine screenings that quietly slip by years - tracked so none of it depends on remembering.',
    prompt:'Track health admin from mail and calendar: prescription refill timing, upcoming and overdue appointments, referrals not yet booked, and routine screenings due based on stated intervals. Report what needs booking now and what is coming. Include the practice or pharmacy contact where it appears in the correspondence. This is scheduling and organisation only - never give medical advice, never interpret a symptom or result, and say clearly that clinical questions go to their clinician.' },

  { id:'appt_prep', cat:'Health', icon:'📋', title:'Appointment prep notes', needs:'Calendar, Email', on:false,
    desc:'Walks you into an appointment with the timeline written down and the questions you meant to ask - because you always remember them in the car afterwards.',
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
    prompt:'Track fares for the user’s specified routes and date ranges. Report the current best fare, the airline, how it compares to what has been seen since watching began, and whether to book now or wait. Include nearby dates or airports when they are materially cheaper. If the user already holds a refundable booking and the fare has dropped, state the rebooking saving explicitly. Never present a fare you have not actually seen.' },

  { id:'move_watch', every:'weekly', cat:'Home & life', icon:'📍', title:'Rent, property and neighbourhood watch', needs:'Web research', on:false,
    desc:'Watches what places like yours actually rent and sell for, and what is happening where you live or want to live - so a lease renewal or an offer is a decision made with numbers.',
    prompt:'Track the local market for the user’s stated area and property type: current asking and achieved prices or rents for comparable places, how they have moved, time on market, and relevant local developments such as transport, planning or school changes. Report what it means for a renewal, a purchase or a sale decision. Use real listings and cite the date checked.' },

  { id:'gift_radar', cat:'Home & life', icon:'🎁', title:'Birthdays, occasions and gift ideas', needs:'Calendar, Email, Web research', on:false,
    desc:'Warns you far enough ahead to do something good rather than something panicked, with ideas built from what that person has actually said they like, and the delivery cut-off.',
    prompt:'Track upcoming birthdays, anniversaries and occasions from the calendar and correspondence. For each, warn far enough ahead to act, and suggest specific ideas grounded in things that person has actually mentioned or shown interest in, within the user’s stated budget. Include current price, where to get it, and the delivery cut-off date to arrive in time. Never invent a preference the user has no record of.' },

  { id:'doc_expiry', cat:'Home & life', icon:'🛂', title:'Passport, visa and travel eligibility', needs:'Email, Calendar, Web research', on:false,
    desc:'Catches the trap that ruins trips: a passport too close to expiry for the country you booked, a visa or permit needing renewal, an entry rule that changed since you last flew.',
    prompt:'Check the user’s travel documents against their planned travel: passport expiry versus each destination’s validity requirement, visa or permit status and renewal timing, and current entry requirements for those destinations. Report anything that would block travel, how long the fix takes, and the latest date to start it. Verify entry rules against official government sources and give the date checked, since these change without notice.' },
]; }
/* ── WHAT A JOB NEEDS, AGAINST WHAT IS ACTUALLY CONNECTED ────────────────────

   Every preset already declared its requirements in `needs`, and nothing ever
   checked them. Turning on "Morning money summary" with no bank linked flipped
   a switch, showed an active card, and did nothing - forever, silently. With
   seventy jobs on the page that stops being an edge case and becomes the
   default experience, so the requirement is now read rather than displayed.

   Web research and web automation run server-side and need nothing from the
   user, which is why they are absent here. */
const CW_NEEDS_CHECK = {
  'Email':           { label:'Gmail',            has:()=>_cwHasGoogle() },
  'Calendar':        { label:'Google Calendar',  has:()=>_cwHasGoogle() },
  'Drive':           { label:'Google Drive',     has:()=>_cwHasGoogle() },
  /* Through the one accessor, so "is an account linked" has a single definition
     that the server refresh keeps current. Reading the key directly here meant
     this screen and the investing pane could disagree. */
  'Bank connection': { label:'a bank connection',
    has:()=>{ try{ return typeof AMVFinance!=='undefined' && AMVFinance.linked(); }catch(e){ return false; } } },
};
function _cwHasGoogle(){ try{ return typeof getGToken==='function' && !!getGToken(); }catch(e){ return false; } }

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
function _cwWhereLabel(j){
  return _cwRunsUnattended(j) ? 'Runs with AMV closed' : 'Runs while AMV is open';
}
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
const CW_CATS = ['Money','Work & career','Growing a business','Inbox & calendar',
                 'Watching the world','Home & life','Learning','Health'];
let _cwCat = 'all';
function cwCat(c){ _cwCat = c || 'all'; renderCrewView(); }
try{ window.cwCat=cwCat; }catch(e){}

function _cwCatChips(jobs){
  const count=c=>jobs.filter(j=>j.cat===c).length;
  const chip=(k,label,n)=>`<button class="cw-chip${_cwCat===k?' on':''}" data-dact="cwCat" data-darg="${escH(k)}">${escH(label)}<span class="cw-chip-n">${n}</span></button>`;
  return `<div class="cw-chips" role="group" aria-label="Filter jobs by category">`
    + chip('all','All',jobs.length)
    + CW_CATS.filter(c=>count(c)).map(c=>chip(c,c,count(c))).join('')
    + `</div>`;
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
    renderCrewView();
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
    sched
  };
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
function _mcAutonCard(j){
  return `<div class="mc-card"><div class="mc-card-top"><span class="mc-card-t">${escH(j.title)}</span><span class="mc-pill ok">On</span></div><div class="mc-card-sub">${escH(j.desc||'')}</div><div class="mc-card-act"><span class="mc-card-uses">Uses: ${escH(j.needs||'-')}</span><button class="btn mc-mini ghost" data-dact="cwToggle" data-darg="${j.id}">Turn off</button></div></div>`;
}
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
function _mcCancelSched(id){ try{ _saveSched(_loadSched().filter(t=>t.id!==id)); }catch(e){} toast('Scheduled task cancelled','info'); renderCrewView(); }
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
async function _mcScheduleServer(payload){
  if(!(window.AMV_API && AMV_API.live && typeof AMV_API._fetch==='function'))
    return { ok:false, code:'needs_service' };
  try{
    const r = await AMV_API._fetch('/api/schedule/create',{ method:'POST', body:JSON.stringify(payload) });
    const d = await r.json().catch(()=>({}));
    if(!r.ok || d.error) return { ok:false, code:d.code||'failed', error:d.error||'' };
    return { ok:true };
  }catch(e){ return { ok:false, code:'failed', error:(e&&e.message)||'' }; }
}
/* One sentence for where a just-created job will actually run. */
function _mcWhereItRuns(res){
  if(res.ok) return '';
  return res.code === 'needs_service'
    ? ' It runs only while AMV is open, because the AMV engine is not connected yet.'
    : ' It could NOT be registered to run in the background' + (res.error ? ' (' + res.error + ')' : '')
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
  if(!_planAllowsCrew()){
    const P=(typeof PLANS!=='undefined'&&PLANS[CREW_REQUIRED_PLAN])||{name:'Pro',price:15};
    vc.innerHTML='<div class="sv fi"><div class="vi">'+
      '<span class="eyebrow">Crew \u00b7 Autonomous work</span>'+
      '<h2>AMV working while you are not</h2>'+
      '<p class="vsub">Give it an outcome and it plans the steps, does the work across your connected apps, '+
        'and brings back something finished. On a schedule, if you want - every morning, every week, '+
        'whatever you set.</p>'+
      '<div class="ss2"><h3>Included with '+escH(P.name)+' \u00b7 $'+P.price+'/month</h3>'+
        '<p style="font-size:13.5px;color:var(--tx);line-height:1.7;margin:0 0 6px">'+
          escH(P.name)+' runs <b>'+CREW_JOBS_BY_PLAN.pro+' jobs</b> in the background, as often as every ten minutes. '+
          'Elite runs '+CREW_JOBS_BY_PLAN.elite+' and Ultra runs '+CREW_JOBS_BY_PLAN.ultra+'.</p>'+
        '<p style="font-size:12.5px;color:var(--mu);line-height:1.6;margin:0 0 14px">'+
          'A job keeps running whether or not AMV is open, which is why it is part of a paid plan.</p>'+
        '<button class="btn bp" data-stab="plans" style="font-size:12px">See plans \u2192</button>'+
      '</div>'+
    '</div></div>';
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
    return `<div class="cw-job ${j.on?'on':''}${miss.length?' blocked':''}">
      <div class="cw-job-ic">${j.icon}</div>
      <div style="flex:1;min-width:0">
        <div class="cw-job-t">${escH(j.title)}</div>
        <div class="cw-job-d">${escH(j.desc)}</div>
        <div class="cw-job-need">Uses: ${escH(j.needs)}
          <span class="cw-job-where ${_cwRunsUnattended(j)?'bg':'open'}">${escH(_cwWhereLabel(j))}</span>
        </div>
        ${note}
      </div>
      <button class="cw-toggle ${j.on?'on':''}" data-dact="cwToggle" data-darg="${j.id}" aria-label="toggle"><span class="cw-knob"></span></button>
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
  const paused=_autonomyPaused();
  const tiles=[
    ['appr','Needs approval',st.appr.length,'wait'],
    ['fail','Action required',st.failed.length,'err'],
    ['active','Active work',st.active.length,'active'],
    ['sched','Running jobs',st.sched.length+st.auton.length,'info'],
    ['done','Completed',st.done.length,'muted']
  ];

  vc.innerHTML = `<div class="sv fi"><div class="crew-page mc-page">
    <header class="mc-head">
      <div class="mc-head-l">
        <div class="eyebrow">Crew · Autonomous work</div>
        <h2>Mission Control</h2>
        <p class="vsub">Crew is AMV working on its own. Tell it an outcome and it plans the steps, does the work across your connected apps, and stops for your approval before anything is sent. This page is where you watch it all - what needs you, what’s running, and what’s scheduled.</p>
      </div>
      <div class="mc-head-r">
        <button class="mc-pause ${paused?'paused':''}" data-dact="${paused?'resumeAllAutonomous':'pauseAllAutonomous'}">${paused?'▶ Resume autonomy':'⏸ Pause all autonomous'}</button>
      </div>
    </header>
    ${(()=>{ const n=_crewJobAllowance(); const used=st.sched.length+st.auton.length;
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
      ${(st.sched.length||st.auton.length)?`<div class="mc-sched">${st.auton.map(_mcAutonSchedRow).join('')}${st.sched.slice(0,8).map(t=>_mcSchedRow(t,st)).join('')}</div>`:`<div class="mc-empty-row">No running jobs yet. Start a task above and choose how often it should repeat - it will show up here.</div>`}
    </section>

    ${st.done.length?`<section id="mc-done" class="mc-sec">
      <div class="sec-head"><h3>Recently completed</h3></div>
      <div class="mc-grid">${st.done.slice(-6).reverse().map(_mcDoneCard).join('')}</div>
    </section>`:''}

    <div class="crew-jobs-sec mc-start">
      <div class="sec-head"><h3>Start new work</h3><span class="sec-sub">Turn on a standing job - AMV runs it automatically and emails you results.</span></div>
      <div class="cw-anything">These are starting points, not the limit. Type <b>anything</b> in the box above and AMV works out which accounts, sites and tools it needs and does it - on a schedule if you ask. If something it needs is not connected yet, it tells you exactly what to add.</div>
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
            .map(q=>`<button class="cw-quick-card" onclick="${q[3]}"><span class="cw-quick-ic">${q[0]}</span><span>${q[1]}</span></button>`).join('')}
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
          ].map(t=>`<button class="tpl-card" onclick="openCoworkWith(${JSON.stringify(t[2]).replace(/"/g,'&quot;')})"><span class="tpl-ic">${t[0]}</span><span class="tpl-t">${t[1]}</span></button>`).join('')}
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
function _crewQueueHTML(){
  try{
    var q=(typeof _bgQueue!=='undefined'&&_bgQueue.tasks)?_bgQueue.tasks:[];
    if(!q.length) return '<div class="cw-empty">No background tasks running.</div>';
    var sc=s=>s==='done'?'#4ade80':s==='running'?'#5590ff':s==='failed'?'#ff4d4d':'#e0b341';
    var si=s=>s==='done'?'✓':s==='running'?'⟳':s==='failed'?'✕':'⏳';
    return q.slice().reverse().map(function(t){return '<div class="cw-qrow"><span style="color:'+sc(t.status)+'">'+si(t.status)+'</span><span style="flex:1">'+escH(t.title||t.type||'Task')+'</span><span style="font-size:11px;color:var(--mu)">'+(t.status||'')+'</span></div>';}).join('');
  }catch(e){ return '<div class="cw-empty">No background tasks running.</div>'; }
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
  if(_cwRunsUnattended(j)) return _cwToggleReal(jobs, j);

  /* Everything else needs this tab, because the mailbox and calendar tokens
     live here and the server never sees them. So it goes on the LOCAL schedule,
     which really does run these while AMV is open. Without this the switch was
     decorative for the other fifty jobs too - a card reading "runs while AMV is
     open" while nothing anywhere was scheduled. */
  _cwSyncLocalSched(j, !j.on);

  j.on=!j.on; _cwSaveJobs(jobs);
  // keep the engine's own on-flag in sync so AMVJobs.run() reflects the toggle
  if(id==='job_hunt' && typeof AMVJobs!=='undefined'){ try{ const c=AMVJobs.cfg(); c.on=j.on; AMVJobs.save(c); }catch(e){} }
  if(window.AMV_API && AMV_API.live){ AMV_API.toggleJob(id,j.on).catch(()=>{}); }
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
async function _cwToggleReal(jobs, j){
  const turningOn=!j.on;
  if(turningOn){
    if(typeof _scheduleTask!=='function'){ toast('Connect the AMV engine in Settings so jobs can run in the background.','error',6000); return; }
    if(_cwPending.has(j.id)) return;         // already being set up
    toast('Setting up "'+j.title+'"…','info',2500);
    let item=null;
    _cwPending.add(j.id);
    try{
      item=await _scheduleTask({ detail:(j.prompt||j.desc||j.title), repeat:(j.every||'daily'),
                                 kind:'research', notify:'app', approval:'auto' });
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
  if(window.AMV_API && AMV_API.live){ AMV_API.toggleJob(j.id,j.on).catch(()=>{}); }
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
function cwApprove(id){ const a=_cwApprovals().filter(x=>x.id!==id); _cwSaveApprovals(a); toast('Approved - sent','info'); renderCrewView(); }
function cwReject(id){
  const all=_cwApprovals(); const removed=all.find(x=>x.id===id); const idx=all.findIndex(x=>x.id===id);
  if(window.AMV_API && AMV_API.live){ AMV_API.actApproval(id,'reject').catch(()=>{}); }
  _cwSaveApprovals(all.filter(x=>x.id!==id)); renderCrewView();
  if(removed){ toastAction('Removed - it won’t be sent.','Return',()=>{ const list=_cwApprovals(); if(!list.some(x=>x.id===removed.id)){ list.splice(Math.min(idx,list.length),0,removed); _cwSaveApprovals(list); if(window.AMV_API && AMV_API.live){ AMV_API.actApproval(id,'restore').catch(()=>{}); } toast('Brought back','success'); renderCrewView(); } }); }
  else toast('Removed','info');
}
function cwEdit(id){ const item=_cwApprovals().find(x=>x.id===id); cwReject(id); setTab('chat'); setTimeout(()=>{ const ta=$('mta'); if(ta&&item){ ta.value='Help me revise this draft:\n\n'+item.preview; ta.focus(); } },120); }
window.cwToggle=cwToggle;window.cwDemo=cwDemo;window.cwApprove=cwApprove;window.cwReject=cwReject;window.cwEdit=cwEdit;
function cwTry(prompt){
  // Take a "try saying" example, drop the user into chat with it ready to send.
  try{
    setTab('chat');
    setTimeout(()=>{ const ta=$('mta'); if(ta){ ta.value=prompt; ta.dispatchEvent(new Event('input')); ta.focus(); } toast('Press send and AMV will set this up for you','info',3500); }, 120);
  }catch(e){}
}
window.cwTry=cwTry;

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
      <div class="pvw-web-stage desk"><div class="pvw-web-frame">${r.html?`<iframe class="pvw-web-if" title="Website preview"${src}></iframe>`:note}</div></div></div>`;
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
  r.innerHTML=`<div class="ov pvw-ov" id="pvw-bg"><div class="pvw" role="dialog" aria-label="Preview and approve">
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
  on($('pvw-bg'),'click',(e)=>{ if(e.target===e.currentTarget) apvClose(); });
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
  if(!confirm(act.line)) return;
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
  try{
    await AMV_API.actApproval(a.id,'approve');
  }catch(e){
    toast('That was NOT '+String(past).toLowerCase()+(e&&e.message?' ('+e.message+')':'')+
          '. It is still in your approvals - try again.','error',7000);
    renderCrewView();
    return { ok:false, code:'failed', error:(e&&e.message)||'' };
  }
  _cwSaveApprovals(_cwApprovals().filter(x=>x.id!==a.id));
  toast(past,'success');
  renderCrewView();
  return { ok:true };
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
  r.innerHTML=`<div class="ov ape-ov" id="ape-bg"><div class="ape" role="dialog" aria-label="Edit before sending">
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
  on($('ape-bg'),'click',(e)=>{ if(e.target===e.currentTarget) apvClose(); });
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
  return _mcScheduleServer({ goal:desc, sched:item.sched, freq:item.freq, approval:item.approval,
    payload:isEmail?{type:'email',result:a.result,to:a.destination,from:a.account}:null });
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
function _apvEditDelete(id){ if(!confirm('Delete this - it won’t be sent?')) return; apvClose(); cwReject(id); }
window._apvEditSave=_apvEditSave; window._apvEditSend=_apvEditSend; window._apvEditDelete=_apvEditDelete;
function apvRevise(id){
  const item=_cwApprovals().find(x=>x.id===id); apvClose();
  setTab('chat');
  setTimeout(()=>{ const ta=$('mta'); if(ta&&item){ ta.value='Revise this before it goes out - tell me what you changed and why:\n\n'+(item.result?.body||item.preview||item.title); ta.dispatchEvent(new Event('input')); ta.focus(); } },140);
}
window.apvPreview=apvPreview; window.apvClose=apvClose; window.apvApprove=apvApprove;
window.apvQuickApprove=apvQuickApprove; window.apvReject=apvReject; window.apvEdit=apvEdit; window.apvRevise=apvRevise;


