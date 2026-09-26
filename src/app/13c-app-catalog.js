/* ══════════════════════════════════════════════════════════════════════════
   THE APPS PEOPLE ACTUALLY USE, IN THE ORDER AMV CAN CONNECT THEM.

   Asked for: "the top apps in the world, not random ones - CapCut, Canva",
   every topic in the same format as Email, no "Everything else, by topic",
   the ones AMV can really connect to first, and Notify me on the rest - with
   a way found to connect those later.

   WHAT A ROW PROMISES. A row with Connect opens a flow that exists in this
   product and ends in a working connection: AMV's own sign-in with the
   provider (Google, Microsoft, GitHub), a mailbox over IMAP (sixty providers
   in the server's list), a calendar's shared link, Telegram, a text number,
   Canvas, a bank link. Nothing else gets that button. A row whose app AMV
   cannot reach yet says so and offers Notify me, which records the request on
   the server's existing waitlist - and that list is what decides which one is
   built next. Slack, Notion, Linear and Discord used to sit up here labelled
   Autonomous, with a Connect button whose only effect was a message saying
   the sign-in was not finished. They are Notify me now, because that is what
   they are.

   WHAT IS LEFT OUT ON PURPOSE.
     · Other AI products. AMV does not send people to them.
     · Password managers. An agent that can read the vault can read every
       account in it; there is no scope narrow enough to make that a good
       trade, however many people would press the button.
     · Anything whose only use would be generating images or video.

   `how` is what Connect does. Empty means Notify me. The codes:
     g        Google, through Connected accounts (Gmail, Calendar, Drive, Classroom)
     ms       Microsoft, through Connected accounts (Outlook mail and calendar)
     gh       GitHub, through Connected accounts
     mail     the mailbox picker; mail:<id> opens it on that provider (ids are the
              server's MAIL_PROVIDERS keys - a wrong id just opens the picker)
     cal      a calendar's shared link, read-only
     tg sms canvas bank predict jobs everyday coverage file vscode
              AMV's own flows, each already on this page before this rewrite

   The third field is the sentence under the name. Rows that connect say what
   AMV does there; rows that do not say what the app is, and nothing more. */

const AMV_APP_CATS = [
  { id:'email', t:'Email', q:'email', apps:[
    'Gmail|g|Reads, sorts and drafts your email. You choose what AMV may do.',
    'Outlook and Hotmail|ms|Mail across your Microsoft account, read and drafted.',
    'Mail worldwide|mail|Any provider that speaks IMAP, in 22 countries. Pick yours from the list.',
    'Yahoo Mail|mail:yahoo|', 'iCloud Mail|mail:icloud|', 'AOL Mail|mail:aol|', 'Zoho Mail|mail:zoho|',
    'Fastmail|mail:fastmail|', 'GMX|mail:gmx|', 'WEB.DE|mail:webde|', 'mail.com|mail:mailcom|',
    'Yandex Mail|mail:yandex|', 'Mail.ru|mail:mailru|', 'QQ Mail|mail:qq|', 'NetEase 163 Mail|mail:netease163|',
    'Naver Mail|mail:naver|', 'Daum Mail|mail:daum|', 'Yahoo! Japan Mail|mail:yahoojp|', 'Rediffmail|mail:rediff|',
    'UOL Mail|mail:uol|', 'Seznam.cz|mail:seznam|', 'WP.pl Poczta|mail:wppl|', 'Libero Mail|mail:libero|',
    'Orange Mail|mail:orange|', 'T-Online|mail:tonline|', 'BT Mail|mail:bt|', 'Xfinity Mail|mail:comcast|',
    'Proton Mail||Encrypted email from Switzerland.', 'Tuta||Encrypted email and calendar.',
    'HEY||Email with a screener for new senders.', 'Superhuman||A fast email app for Gmail and Outlook.',
    'Spark Mail||Email for individuals and teams.', 'Front||Shared inboxes for teams.',
  ]},
  { id:'calendar', t:'Calendar &amp; scheduling', q:'calendar', apps:[
    'Google Calendar|g|Your week, read and arranged. Events are added only when you allow it.',
    'Outlook Calendar|ms|Your Microsoft calendar, read and arranged.',
    'Apple iCloud Calendar|cal|Read-only, through the calendar’s shared link.',
    'Any other calendar|cal|iCloud, Fastmail, Nextcloud, Yandex, Zoho, a university timetable - anything that publishes a link. Read-only: AMV sees your week and can never change it.',
    'Fastmail Calendar|cal|', 'Proton Calendar|cal|', 'Zoho Calendar|cal|', 'Nextcloud Calendar|cal|', 'Yandex Calendar|cal|',
    'Calendly||Booking links for meetings.', 'Cal.com||Open scheduling for meetings.',
    'Microsoft Bookings||Appointments for Microsoft 365.', 'Doodle||Find a time that suits everyone.',
    'Fantastical||A calendar app for Apple devices.', 'Notion Calendar||A calendar that works with Notion.',
    'TimeTree||Shared calendars for families and groups.', 'Acuity Scheduling||Client booking and payments.',
    'Setmore||Appointment booking for small businesses.', 'SimplyBook.me||Online booking for services.',
  ]},
  { id:'messaging', t:'Chat &amp; messaging', q:'messaging', apps:[
    'Telegram|tg|Run AMV from Telegram and get your background work there - through a bot you own and can revoke.',
    'Text messages (SMS)|sms|Run AMV from any phone by text - “check Project X”, “draft a reply”.',
    'WhatsApp||Messages and calls.', 'Slack||Team channels and direct messages.', 'Microsoft Teams||Chat and meetings for work.',
    'Discord||Servers, voice and chat.', 'Messenger||Chat from Facebook.', 'Zoom||Video meetings and chat.',
    'Google Chat||Chat for Google Workspace.', 'Google Meet||Video meetings.', 'Signal||Private messaging.',
    'WeChat||Messaging, payments and mini-programs.', 'LINE||Messaging across Japan, Taiwan and Thailand.',
    'KakaoTalk||Korea’s messenger.', 'Viber||Messages and calls.', 'Zalo||Vietnam’s messenger.',
    'Webex||Meetings and calling.', 'Snapchat||Photos and chat.', 'iMessage||Apple’s messaging.',
    'Mattermost||Open-source team chat.', 'Rocket.Chat||Self-hosted team chat.', 'Element||Chat on the Matrix network.',
  ]},
  { id:'files', t:'Files &amp; documents', q:'storage', apps:[
    'Google Drive|g|Finds and reads your files. Writes only to copies AMV makes.',
    'Google Docs|g|Read through your Google connection.', 'Google Sheets|g|Read through your Google connection.',
    'Google Slides|g|Read through your Google connection.',
    'Excel and CSV|file|Upload a sheet - AMV runs formulas, builds pivots and charts, then you download.',
    'Word|file|Reports, proposals and letters - written and exported, ready to edit.',
    'PowerPoint|file|Describe a deck and AMV builds the slides - export the .pptx.',
    'Dropbox||Cloud storage and sharing.', 'OneDrive||Microsoft’s cloud storage.', 'Box||Cloud content for business.',
    'iCloud Drive||Apple’s cloud storage.', 'Evernote||Notes and web clips.', 'OneNote||Microsoft’s notebook.',
    'Adobe Acrobat||PDFs: read, sign and edit.', 'Google Keep||Quick notes and lists.', 'Apple Notes||Notes on Apple devices.',
    'Obsidian||Notes in plain files on your own computer.', 'Coda||Docs that work like apps.', 'Mega||Encrypted cloud storage.',
    'pCloud||Cloud storage from Switzerland.', 'WPS Office||Documents, sheets and slides.', 'iLovePDF||PDF tools in the browser.',
    'Smallpdf||PDF tools in the browser.', 'Scribd||Books, documents and audiobooks.',
  ]},
  { id:'money', t:'Bank &amp; money', q:'finance', apps:[
    'Bank account|bank|Real balances and real transactions, read-only. The sign-in happens on your bank’s own page - AMV never sees your password and cannot move money. Morning money summary, unusual charges, low balance warnings and the money leak detector all read from this.',
    'Prediction markets|predict|Kalshi or Polymarket, depending on where you are. AMV shows you the exact trade and places it only after you confirm those numbers - it can never place one on its own.',
    'PayPal||Payments and transfers.', 'Stripe||Payments for businesses.', 'Wise||Money across currencies.',
    'Revolut||Banking and cards.', 'Venmo||Payments between friends.', 'Cash App||Send, spend and save.', 'Zelle||Bank transfers in the US.',
    'Coinbase||Buy and hold crypto.', 'Binance||Crypto exchange.', 'Kraken||Crypto exchange.', 'Robinhood||Stocks and crypto.',
    'Interactive Brokers||Investing worldwide.', 'eToro||Social investing.', 'Trading 212||Stocks and ETFs.',
    'Monzo||Banking in the UK.', 'N26||Mobile banking in Europe.', 'Nubank||Banking in Latin America.', 'Chime||Mobile banking in the US.',
    'Klarna||Pay later.', 'Alipay||Payments across China.', 'WeChat Pay||Payments inside WeChat.', 'Paytm||Payments in India.',
    'PhonePe||UPI payments in India.', 'Google Pay||Payments and passes.', 'M-Pesa||Mobile money in Africa.',
    'Mercado Pago||Payments in Latin America.', 'GCash||Mobile wallet in the Philippines.',
    'QuickBooks||Accounting for small businesses.', 'Xero||Online accounting.', 'FreshBooks||Invoicing and accounting.',
    'Square||Payments and point of sale.', 'YNAB||Budgeting.', 'Splitwise||Share bills with friends.', 'Expensify||Receipts and expenses.',
  ]},
  { id:'dev', t:'Developer tools', q:'developer', apps:[
    'GitHub|gh|Reviews PRs, opens issues, reads repos and ships fixes you approve.',
    'VS Code|vscode|No editor extension yet. AMV works in your project folder through your connected computer, with an Undo for every change.',
    'GitLab||Code, CI and issues.', 'Bitbucket||Git hosting for teams.', 'Linear||Issue tracking.', 'Jira||Issues and projects.',
    'Vercel||Deploy web apps.', 'Netlify||Deploy web sites.', 'Supabase||Postgres, auth and storage.', 'Firebase||Backend for apps.',
    'Postman||Build and test APIs.', 'Stack Overflow||Questions and answers for developers.', 'Docker Hub||Container images.',
    'npm||JavaScript packages.', 'Replit||Code in the browser.', 'CodePen||Front-end playground.', 'Expo||Build React Native apps.',
    'JetBrains IDEs||IntelliJ, PyCharm, WebStorm and the rest.', 'Xcode Cloud||Builds for Apple platforms.',
  ]},
  { id:'school', t:'School &amp; learning', q:'research', apps:[
    'Canvas LMS|canvas|Reads what is due, makes your own copy of the doc an assignment points at, and shares it with your teacher when you say to.',
    'Google Classroom|g|What is due, read-only. AMV cannot hand anything in.',
    'Moodle||Courses and assignments.', 'Blackboard||Courses and assignments.', 'Schoology||Classes and coursework.',
    'Brightspace||Courses from D2L.', 'PowerSchool||Grades and attendance.', 'Seesaw||Student portfolios.', 'ClassDojo||Class updates for families.',
    'Remind||School messages.', 'Duolingo||Learn a language.', 'Khan Academy||Free lessons and practice.', 'Coursera||Online courses.',
    'Udemy||Online courses.', 'edX||University courses online.', 'Quizlet||Flashcards and study sets.', 'Anki||Spaced-repetition flashcards.',
    'Zotero||Research references.', 'Mendeley||Papers and references.', 'Google Scholar||Search academic papers.',
    'Notability||Notes and annotation.', 'GoodNotes||Handwritten notes.', 'Photomath||Step-by-step maths.', 'Brainly||Homework help.',
  ]},
  { id:'jobs', t:'Jobs &amp; careers', q:'jobs', apps:[
    'Job boards worldwide|jobs|StepStone, Reed, Pracuj, Naukri, Saramin, 51job, Rikunabi and more - AMV applies where a posting takes email, and prepares the rest.',
    'LinkedIn||Profiles, jobs and your network.', 'Indeed||Job search.', 'Glassdoor||Jobs, salaries and reviews.',
    'ZipRecruiter||Job search in the US.', 'Upwork||Freelance work.', 'Fiverr||Freelance services.', 'Monster||Job search.',
    'Handshake||Jobs for students.', 'Wellfound||Jobs at startups.', 'Freelancer||Freelance projects.', 'Seek||Jobs in Australia and New Zealand.',
    'Dice||Tech jobs.', 'Toptal||Freelance talent.', 'CareerBuilder||Job search.',
  ]},
  { id:'home', t:'Home &amp; everyday life', q:'iot', apps:[
    'Everyday life where you live|everyday|Bills, renewals, fines, official letters and school dates - watched and dated for your country, not somebody else’s.',
    'AMV around the world|coverage|Every country AMV works in, and what it can do there - mail, job boards, and where it can apply for you.',
    'Google Home||Smart home from Google.', 'Amazon Alexa||Voice and smart home.', 'Apple Home||Smart home on Apple devices.',
    'SmartThings||Samsung’s smart home.', 'Philips Hue||Smart lighting.', 'Google Nest||Thermostats, cameras and doorbells.',
    'Ring||Doorbells and cameras.', 'Tesla||Your car, from your phone.', 'Home Assistant||Open-source home automation.',
    'Sonos||Speakers around the house.', 'ecobee||Smart thermostats.', 'Tuya Smart||Smart devices.', 'Xiaomi Home||Xiaomi’s smart devices.',
    'Arlo||Security cameras.', 'TP-Link Kasa||Smart plugs and lights.', 'iRobot||Robot vacuums.',
  ]},
  { id:'work', t:'Work &amp; projects', q:'productivity', apps:[
    'Notion||Docs, wikis and projects.', 'Trello||Boards and cards.', 'Asana||Work management.', 'Monday.com||Work management.',
    'ClickUp||Tasks, docs and goals.', 'Todoist||To-do lists.', 'Microsoft To Do||Tasks and lists.', 'Google Tasks||Tasks with Gmail and Calendar.',
    'Basecamp||Projects and team communication.', 'Miro||Online whiteboard.', 'Confluence||Team wiki.', 'Wrike||Project management.',
    'Smartsheet||Work management in sheets.', 'TickTick||Tasks and habits.', 'Things||Tasks on Apple devices.', 'Microsoft Planner||Team tasks.',
    'Zoho Projects||Project management.', 'Loom||Video messages for work.', 'Craft||Documents and notes.',
  ]},
  { id:'design', t:'Design &amp; creativity', q:'design', apps:[
    'Canva||Designs, social posts and presentations.', 'Figma||Interface design together.', 'Adobe Photoshop||Photo editing.',
    'Adobe Illustrator||Vector graphics.', 'Adobe Express||Quick designs and social posts.', 'Adobe Lightroom||Photo editing and organising.',
    'Procreate||Drawing on iPad.', 'Sketch||Design on the Mac.', 'Framer||Design and publish sites.', 'Webflow||Build websites visually.',
    'Wix||Website builder.', 'Squarespace||Websites and online stores.', 'WordPress||Websites and blogs.', 'Behance||Creative portfolios.',
    'Dribbble||Design inspiration.', 'Unsplash||Free photos.', 'Picsart||Photo and video editing.', 'VSCO||Photo editing.',
    'Snapseed||Photo editing.', 'Affinity||Design, photo and publishing.', 'Blender||3D creation.', 'GIMP||Open-source image editing.',
  ]},
  { id:'video', t:'Video &amp; streaming', q:'media', apps:[
    'CapCut||Video editing.', 'YouTube||Videos and channels.', 'TikTok||Short videos.', 'Netflix||Films and series.',
    'Twitch||Live streams.', 'Vimeo||Video hosting.', 'Adobe Premiere Pro||Video editing.', 'DaVinci Resolve||Editing and colour.',
    'Final Cut Pro||Video editing on the Mac.', 'iMovie||Video editing on Apple devices.', 'InShot||Video editing on phones.',
    'Disney+||Films and series.', 'Prime Video||Films and series.', 'Max||Films and series.', 'Hulu||Films and series.',
    'Crunchyroll||Anime.', 'Plex||Your media library.', 'OBS Studio||Recording and streaming.', 'Bilibili||Videos from China.',
    'Riverside||Record podcasts and video.', 'StreamYard||Live streaming.',
  ]},
  { id:'music', t:'Music &amp; audio', q:'music', apps:[
    'Spotify||Music and podcasts.', 'Apple Music||Music streaming.', 'YouTube Music||Music streaming.', 'SoundCloud||Music from creators.',
    'Amazon Music||Music streaming.', 'Deezer||Music streaming.', 'Tidal||Music streaming.', 'Pandora||Radio and music.',
    'Shazam||Name that song.', 'Audible||Audiobooks.', 'Apple Podcasts||Podcasts.', 'Pocket Casts||Podcasts.',
    'JioSaavn||Music in India.', 'Anghami||Music in the Middle East.', 'Boomplay||Music in Africa.', 'NetEase Cloud Music||Music in China.',
    'QQ Music||Music in China.', 'GarageBand||Make music on Apple devices.', 'Bandcamp||Music from artists.', 'Last.fm||Your listening history.',
  ]},
  { id:'social', t:'Social networks', q:'social', apps:[
    'Instagram||Photos, reels and messages.', 'Facebook||Friends, groups and pages.', 'X||Posts and news.', 'Threads||Text posts from Instagram.',
    'Reddit||Communities and discussion.', 'Pinterest||Ideas and boards.', 'Bluesky||An open social network.', 'Mastodon||Decentralised social network.',
    'Tumblr||Blogs and communities.', 'Quora||Questions and answers.', 'VK||Russia’s social network.', 'Weibo||China’s microblog.',
    'Xiaohongshu||Lifestyle posts from China.', 'Douyin||Short videos in China.', 'Nextdoor||Your neighbourhood.', 'BeReal||One photo a day.',
  ]},
  { id:'shop', t:'Shopping', q:'ecommerce', apps:[
    'Amazon||Shopping.', 'eBay||Buy and sell.', 'AliExpress||Shopping from China.', 'Temu||Shopping.', 'Shein||Fashion.',
    'Walmart||Shopping.', 'Etsy||Handmade and vintage.', 'Shopify||Run an online store.', 'Mercado Libre||Shopping in Latin America.',
    'Flipkart||Shopping in India.', 'Rakuten||Shopping in Japan.', 'Taobao||Shopping in China.', 'JD.com||Shopping in China.',
    'Shopee||Shopping in Southeast Asia.', 'Lazada||Shopping in Southeast Asia.', 'Coupang||Shopping in Korea.', 'Target||Shopping.',
    'Costco||Warehouse shopping.', 'IKEA||Furniture and home.', 'Zalando||Fashion in Europe.', 'Best Buy||Electronics.',
    'Instacart||Grocery delivery.', 'Vinted||Second-hand fashion.', 'Wayfair||Home goods.',
  ]},
  { id:'travel', t:'Travel', q:'travel', apps:[
    'Airbnb||Stays and experiences.', 'Booking.com||Hotels and stays.', 'Expedia||Flights, hotels and cars.', 'Tripadvisor||Reviews and bookings.',
    'Skyscanner||Compare flights.', 'Google Flights||Search flights.', 'Kayak||Compare travel.', 'Trip.com||Flights and hotels.',
    'Agoda||Hotels in Asia.', 'Hotels.com||Hotels.', 'Hopper||Flight and hotel deals.', 'TripIt||Your itineraries in one place.',
    'Trainline||Trains and buses in Europe.', 'Rome2Rio||Get anywhere, any way.', 'Hostelworld||Hostels.',
  ]},
  { id:'maps', t:'Maps &amp; rides', q:'maps', apps:[
    'Google Maps||Maps and directions.', 'Apple Maps||Maps on Apple devices.', 'Waze||Driving directions.', 'Uber||Rides.', 'Lyft||Rides in North America.',
    'Bolt||Rides in Europe and Africa.', 'Grab||Rides and food in Southeast Asia.', 'DiDi||Rides in China and Latin America.',
    'Ola||Rides in India.', 'Gojek||Rides and payments in Indonesia.', 'Yandex Go||Rides and delivery.', 'Citymapper||Public transport.',
    'Moovit||Public transport.', 'Lime||Scooters and bikes.', 'BlaBlaCar||Shared rides.',
  ]},
  { id:'food', t:'Food &amp; delivery', q:'food', apps:[
    'Uber Eats||Food delivery.', 'DoorDash||Food delivery.', 'Deliveroo||Food delivery.', 'Just Eat||Food delivery.',
    'Swiggy||Food delivery in India.', 'Zomato||Food delivery in India.', 'Meituan||Food delivery in China.', 'Rappi||Delivery in Latin America.',
    'Glovo||Delivery in Europe and Africa.', 'Grubhub||Food delivery.', 'iFood||Delivery in Brazil.', 'foodpanda||Delivery in Asia.',
    'Talabat||Delivery in the Middle East.', 'OpenTable||Restaurant bookings.', 'Yelp||Local reviews.',
  ]},
  { id:'health', t:'Health &amp; fitness', q:'health', apps:[
    'Apple Health||Health data on iPhone.', 'Health Connect||Health data on Android.', 'Strava||Running and cycling.', 'Fitbit||Activity and sleep.',
    'Garmin Connect||Training and activity.', 'Oura||Sleep and readiness.', 'WHOOP||Strain and recovery.', 'MyFitnessPal||Food and calories.',
    'Samsung Health||Health on Galaxy devices.', 'Withings||Scales and health devices.', 'Peloton||Workouts.', 'Nike Run Club||Running.',
    'Headspace||Meditation.', 'Calm||Sleep and meditation.', 'Flo||Cycle tracking.', 'Clue||Cycle tracking.', 'Zwift||Indoor cycling.',
  ]},
  { id:'news', t:'News &amp; reading', q:'news', apps:[
    'Kindle||Books.', 'Goodreads||Books you read.', 'Medium||Articles and writers.', 'Substack||Newsletters.', 'Feedly||News feeds.',
    'Flipboard||News magazine.', 'Apple News||News on Apple devices.', 'Google News||Top stories.', 'The New York Times||News.',
    'BBC News||News.', 'Instapaper||Save articles for later.', 'Readwise||Highlights from what you read.', 'Wattpad||Stories.',
    'Webtoon||Comics.', 'Inoreader||News feeds.',
  ]},
  { id:'biz', t:'Business &amp; sales', q:'crm', apps:[
    'Salesforce||CRM.', 'HubSpot||CRM and marketing.', 'Pipedrive||Sales pipeline.', 'Zoho CRM||CRM.', 'Microsoft Dynamics 365||Business apps.',
    'Close||Sales CRM.', 'Copper||CRM for Google Workspace.', 'Freshsales||CRM.', 'Odoo||Business apps.', 'SAP||Business software.',
    'NetSuite||Business management.', 'Typeform||Forms and surveys.', 'Google Forms||Forms and surveys.', 'SurveyMonkey||Surveys.',
    'Jotform||Online forms.', 'Tally||Simple forms.',
  ]},
  { id:'marketing', t:'Marketing', q:'marketing', apps:[
    'Mailchimp||Email marketing.', 'Klaviyo||Email and SMS marketing.', 'Google Ads||Advertising.', 'Meta Ads Manager||Facebook and Instagram ads.',
    'Google Analytics||Website analytics.', 'Semrush||SEO and marketing.', 'Ahrefs||SEO tools.', 'Hootsuite||Social media management.',
    'Buffer||Schedule social posts.', 'Later||Plan social posts.', 'Brevo||Email and SMS campaigns.', 'Constant Contact||Email marketing.',
    'LinkedIn Ads||Advertising on LinkedIn.', 'TikTok Ads||Advertising on TikTok.', 'Sprout Social||Social media management.',
  ]},
  { id:'support', t:'Customer support', q:'support', apps:[
    'Zendesk||Support tickets.', 'Intercom||Customer messaging.', 'Freshdesk||Support tickets.', 'Help Scout||Shared inbox for support.',
    'Gorgias||Support for online stores.', 'Zoho Desk||Support tickets.', 'Crisp||Live chat.', 'LiveChat||Live chat.',
    'Tidio||Live chat for stores.', 'Trustpilot||Customer reviews.', 'Kustomer||Customer service platform.',
  ]},
  { id:'auto', t:'Automation', q:'automation', apps:[
    'Zapier||Connect apps with automations.', 'Make||Visual automations.', 'IFTTT||Simple automations.', 'n8n||Open-source automation.',
    'Power Automate||Automations for Microsoft 365.', 'Apple Shortcuts||Automations on Apple devices.', 'Tasker||Automation on Android.',
    'Pipedream||Automations for developers.', 'Airtable Automations||Automations inside Airtable.',
  ]},
  { id:'data', t:'Data &amp; analytics', q:'database', apps:[
    'Airtable||Spreadsheet-database.', 'Tableau||Dashboards and analytics.', 'Power BI||Microsoft’s analytics.', 'Looker Studio||Google’s dashboards.',
    'Snowflake||Data warehouse.', 'BigQuery||Google’s data warehouse.', 'Databricks||Data and analytics platform.', 'MongoDB Atlas||Cloud database.',
    'PostgreSQL||Open-source database.', 'MySQL||Open-source database.', 'Metabase||Open-source dashboards.', 'Mixpanel||Product analytics.',
    'Amplitude||Product analytics.', 'Segment||Customer data.',
  ]},
  { id:'cloud', t:'Cloud &amp; hosting', q:'cloud', apps:[
    'Amazon Web Services||Cloud computing.', 'Google Cloud||Cloud computing.', 'Microsoft Azure||Cloud computing.', 'Cloudflare||Network, security and hosting.',
    'DigitalOcean||Cloud servers.', 'Heroku||Run apps in the cloud.', 'Render||Hosting for apps and sites.', 'Fly.io||Run apps near users.',
    'Linode||Cloud servers.', 'Hetzner||Servers in Europe.', 'Alibaba Cloud||Cloud computing.', 'Oracle Cloud||Cloud computing.',
  ]},
  { id:'monitor', t:'Monitoring &amp; logs', q:'monitoring', apps:[
    'Sentry||Errors and performance.', 'Datadog||Monitoring and logs.', 'Grafana||Dashboards and alerts.', 'New Relic||Observability.',
    'PagerDuty||On-call and incidents.', 'Better Stack||Uptime and logs.', 'UptimeRobot||Uptime monitoring.', 'Splunk||Logs and security.',
    'Prometheus||Open-source monitoring.', 'Opsgenie||Alerts and on-call.',
  ]},
  { id:'security', t:'Security', q:'security', apps:[
    'Have I Been Pwned||Check if your email was in a breach.', 'VirusTotal||Scan files and links.', 'Okta||Sign-in for organisations.',
    'Cloudflare Zero Trust||Secure access for teams.', 'Snyk||Find vulnerabilities in code.', 'CrowdStrike||Endpoint security.',
    'Malwarebytes||Malware protection.', 'Norton||Device security.', 'Proton VPN||Private browsing.', 'NordVPN||VPN.',
  ]},
  { id:'legal', t:'Legal &amp; contracts', q:'legal', apps:[
    'DocuSign||Sign documents.', 'Adobe Acrobat Sign||Sign documents.', 'Dropbox Sign||Sign documents.', 'PandaDoc||Proposals and contracts.',
    'Ironclad||Contract management.', 'Clio||Practice management for lawyers.', 'LegalZoom||Legal services online.', 'Juro||Contracts for teams.',
  ]},
  { id:'hr', t:'People &amp; HR', q:'hr', apps:[
    'Workday||HR and finance.', 'BambooHR||HR for small businesses.', 'Gusto||Payroll and benefits.', 'Rippling||HR, IT and payroll.',
    'Deel||Hire and pay worldwide.', 'ADP||Payroll.', 'Personio||HR in Europe.', 'HiBob||HR platform.', 'Remote||Hire worldwide.',
    'Greenhouse||Hiring.', 'Lever||Hiring.', 'Workable||Hiring.', 'Lattice||Performance and engagement.',
  ]},
  { id:'testing', t:'Testing &amp; QA', q:'testing', apps:[
    'BrowserStack||Test on real browsers and devices.', 'Sauce Labs||Automated testing.', 'LambdaTest||Cross-browser testing.',
    'Cypress Cloud||End-to-end test runs.', 'TestRail||Test case management.', 'Checkly||Monitoring with tests.', 'Percy||Visual testing.',
  ]},
  { id:'games', t:'Games', q:'games', apps:[
    'Steam||PC games.', 'Xbox||Games and friends.', 'PlayStation||Games and friends.', 'Nintendo||Switch games and friends.',
    'Roblox||Games and worlds.', 'Epic Games||Games and Fortnite.', 'Minecraft||Build and explore.', 'Chess.com||Play chess.',
    'Lichess||Free chess.', 'Battle.net||Blizzard games.', 'EA app||EA games.', 'Riot Games||League of Legends and Valorant.',
  ]},
];

/* Parsed once. A row is { name, how, desc, slug }. */
let _APP_ROWS = null;
function _appCats(){
  if(_APP_ROWS) return _APP_ROWS;
  _APP_ROWS = AMV_APP_CATS.map(c => ({ id:c.id, t:c.t, q:c.q, apps:c.apps.map(s => {
    const [name, how, desc] = String(s).split('|');
    return { name, how:how||'', desc:desc||'',
             slug:String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) };
  }) }));
  return _APP_ROWS;
}
/* How many apps are listed, counted rather than claimed. */
function _appCount(){ return _appCats().reduce((n, c) => n + c.apps.length, 0); }
try{ window.AMV_APP_CATS = AMV_APP_CATS; window._appCats = _appCats; window._appCount = _appCount; }catch(e){}
